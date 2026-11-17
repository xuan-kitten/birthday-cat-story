/* ==========================================================
 * app.js —— 入口：加载剧情、模式切换、图片 URL 缓存、自动保存
 * ========================================================== */
(function () {
  'use strict';
  const BS = window.BS;
  const $ = function (id) { return document.getElementById(id); };

  let story = null;
  let mode = 'play';
  let saveTimer = null;
  let toastTimer = null;
  const urlCache = new Map();   // name -> { url, updatedAt }

  /* ---------------- 启动 ---------------- */

  async function loadInitialStory() {
    const local = await BS.storage.loadStory();
    if (local) return local;

    // 发布版：优先读取同目录的 story.json（编辑模式导出的剧情）
    try {
      const res = await fetch('story.json', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const raw = data && data.story ? data.story : data;
      const images = (data && data.images) || {};

      for (const name of Object.keys(images)) {
        const value = images[name];
        if (typeof value !== 'string' || value.indexOf('data:') !== 0) continue;
        try {
          const blob = dataUrlToBlob(value);
          await BS.storage.saveAsset(name, blob, blob.type);
        } catch (err) {
          console.warn('[app] story.json 图片写入失败：', name, err);
        }
      }
      return raw;
    } catch (err) {
      return null;
    }
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const meta = parts[0] || '';
    const body = parts[1] || '';
    const mimeMatch = meta.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function boot() {
    try {
      await BS.storage.open();
    } catch (err) {
      console.warn('[app] IndexedDB 不可用：', err);
    }

    const loaded = await loadInitialStory();
    story = BS.model.normalize(loaded || BS.model.seedStory());
    applyStarterBackground(story);
    applyCatOptionImages(story);
    applyStoryFixes(story);
    $('storyTitle').textContent = story.meta.title || NEW_TITLE;
    await refreshAssets();

    BS.player.init({
      stage: $('stage'),
      text: $('storyText'),
      choices: $('choices'),
      hint: $('clickHint'),
      selectChoices: $('selectChoices'),
      imgA: $('imgLayerA'),
      imgB: $('imgLayerB'),
      bgA: $('bgLayerA'),
      bgB: $('bgLayerB'),
      portraitLeft: $('portraitLeft'),
      portraitRight: $('portraitRight')
    }, { getImageUrl: urlFor });

    BS.editor.init({
      story: story,
      getImageUrl: urlFor,
      refreshAssets: refreshAssets,
      onPreview: function (nodeId) { setMode('play', nodeId); },
      onChange: scheduleSave,
      onToast: toast,
      onReplaceStory: replaceStory
    });

    bindTopbar();
    setMode('play');

    if (!BS.storage.isIDBAvailable()) {
      toast('当前环境不能使用 IndexedDB 存图片，建议用「启动本地预览.bat」打开页面', 'error', 6000);
    }
  }

  /* 一次性迁移：给旧的已保存剧情补上选角背景（不覆盖用户自己设过的背景） */
  function applyStarterBackground(s) {
    if (!s || !s.meta || s.meta.starterBgApplied) return;
    const start = s.nodes[s.startNodeId];
    if (!start) return;
    if (!start.bg) {
      start.bg = '1.jpeg';
      start.bgInherit = false;
      if (start.type === 'select' && start.mood === 'mystery') start.mood = 'daily';
      if (s.assets.indexOf('1.jpeg') < 0) s.assets.push('1.jpeg');
      scheduleSave();
    }
    s.meta.starterBgApplied = true;
  }

  /* 一次性迁移：按品种名字给旧的已保存剧情补上选角头像 */
  const CAT_OPTION_IMAGES = {
    '橘白猫': 'opt/orange.webp',
    '狸花猫': 'opt/tabby.webp',
    '简州猫': 'opt/jianzhou.webp',
    '三花猫': 'opt/calico.webp',
    '玄猫': 'opt/black.webp',
    '白猫': 'opt/white.webp',
    '奶牛猫': 'opt/cow.webp'
  };

  function applyCatOptionImages(s) {
    if (!s || !s.meta || s.meta.catOptionsApplied) return;
    let touched = false;
    Object.keys(s.nodes || {}).forEach(function (id) {
      const node = s.nodes[id];
      if (node.type !== 'select' || !Array.isArray(node.options)) return;
      node.options.forEach(function (option) {
        const img = CAT_OPTION_IMAGES[option.label || option.value];
        if (!img || option.img) return;
        option.img = img;
        touched = true;
        if (s.assets.indexOf(img) < 0) s.assets.push(img);
      });
    });
    s.meta.catOptionsApplied = true;
    if (touched) scheduleSave();
  }

  const NEW_TITLE = '重生之我穿越到了一只小猫身上';

  /* 一次性修正：标题、跟丢后的支线、已知节点的说话人 */
  function applyStoryFixes(s) {
    if (!s || !s.nodes) return;
    if (!s.meta) s.meta = {};
    let touched = false;

    if (!s.meta.title || s.meta.title === '生日文游') {
      s.meta.title = NEW_TITLE;
      touched = true;
    }

    if (!s.meta.branchFixed) {
      const lost = s.nodes.track6;
      if (lost && lost.next === 'final') {
        lost.next = 'skip2';
        touched = true;
      }
      s.meta.branchFixed = true;
    }

    if (!s.meta.speakersApplied) {
      const speakers = { meet: '小白', skip1: 'player', end: '小黑' };
      Object.keys(speakers).forEach(function (id) {
        const node = s.nodes[id];
        if (node && !node.speaker) {
          node.speaker = speakers[id];
          touched = true;
        }
      });
      s.meta.speakersApplied = true;
    }

    if (touched) scheduleSave();
  }

  /* ---------------- 图片 URL 缓存（IndexedDB blob → objectURL） ---------------- */

  async function refreshAssets() {
    let records = [];
    try {
      records = await BS.storage.listAssets();
    } catch (err) {
      records = [];
    }

    const seen = {};
    records.forEach(function (rec) {
      seen[rec.name] = true;
      const old = urlCache.get(rec.name);
      if (old && old.updatedAt === rec.updatedAt) return;
      const url = URL.createObjectURL(rec.blob);
      urlCache.set(rec.name, { url: url, updatedAt: rec.updatedAt });
      if (old && old.url) {
        setTimeout(function () { URL.revokeObjectURL(old.url); }, 6000);
      }
    });

    // 清理已经不在库里的
    Array.from(urlCache.keys()).forEach(function (name) {
      if (seen[name]) return;
      const old = urlCache.get(name);
      urlCache.delete(name);
      if (old && old.url) setTimeout(function () { URL.revokeObjectURL(old.url); }, 6000);
    });
  }

  /** 有导入的图 → blob URL；没有 → 退回 assets/ 目录里的同名文件（支持 opt/ 子目录） */
  function urlFor(name) {
    const rec = urlCache.get(name);
    if (rec && rec.url) return rec.url;
    const parts = String(name).split('/');
    return 'assets/' + parts.map(encodeURIComponent).join('/');
  }

  /* ---------------- 保存 ---------------- */

  function setTip(text) {
    $('saveTip').textContent = text;
  }

  function timeNow() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function scheduleSave() {
    setTip('保存中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      try {
        const result = await BS.storage.saveStory(story);
        setTip('已保存 ' + timeNow() + (result && result.saved === 'localStorage' ? '（本机）' : ''));
      } catch (err) {
        setTip('保存失败');
        console.error('[app] 保存失败', err);
      }
    }, 420);
  }

  function replaceStory(nextStory) {
    story = nextStory;
    $('storyTitle').textContent = story.meta.title || NEW_TITLE;
    BS.editor.setStory(story);
    setMode('edit');
    scheduleSave();
  }

  /* ---------------- 模式切换 ---------------- */

  function setMode(next, previewNodeId) {
    if (next === 'edit') {
      mode = 'edit';
      document.body.dataset.mode = 'edit';
      $('stage').hidden = true;
      $('editor').hidden = false;
      $('btnMode').textContent = '▶ 播放模式';
      document.title = '编辑中 · ' + (story.meta.title || NEW_TITLE);
      BS.editor.refresh();
      return;
    }

    if (!story.nodes[story.startNodeId]) {
      toast('没有有效的开始节点，先在编辑模式里设置一个', 'error');
      return;
    }

    const check = BS.model.validate(story);
    if (check.errors.length) {
      toast(
        '配置有 ' + check.errors.length + ' 个问题：' + check.errors.slice(0, 2).join('；') +
        '（仍可试玩，建议先修）',
        'error',
        5400
      );
    }

    mode = 'play';
    document.body.dataset.mode = 'play';
    $('editor').hidden = true;
    $('stage').hidden = false;
    $('btnMode').textContent = '✎ 编辑模式';
    document.title = story.meta.title || NEW_TITLE;
    BS.player.start(story, previewNodeId ? { nodeId: previewNodeId } : undefined);
  }

  function bindTopbar() {
    $('btnMode').addEventListener('click', function () {
      setMode(mode === 'play' ? 'edit' : 'play');
    });
  }

  /* ---------------- 轻提示 ---------------- */

  function toast(message, type, duration) {
    const el = $('toast');
    if (!el) return;
    el.hidden = false;
    el.className = 'toast' + (type ? ' is-' + type : '');
    el.textContent = message;
    void el.offsetWidth;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
      setTimeout(function () { el.hidden = true; }, 320);
    }, duration || 3000);
  }

  /* ---------------- 杂项 ---------------- */

  window.addEventListener('beforeunload', function () {
    if (!story) return;
    // saveStory 会先同步写 localStorage，离开页面前兜一层
    try { BS.storage.saveStory(story); } catch (err) { /* ignore */ }
  });

  BS.app = {
    setMode: setMode,
    getStory: function () { return story; },
    toast: toast
  };

  boot();
})();
