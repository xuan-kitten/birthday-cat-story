/* ==========================================================
 * model.js —— 剧情数据模型
 *  - seedStory(): 按大纲生成的初始骨架（文字为占位，可在编辑器里改）
 *  - normalize(): 兼容导入的旧/缺字段数据
 *  - validate(): 播放/检查时的配置校验
 *  - renderText(): {变量} 替换
 * ========================================================== */
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  const MOOD_IDS = ['mystery', 'tracking', 'daily', 'warm'];
  const TYPE_LABELS = { text: '剧情', choice: '选择', select: '选角', end: '结局' };

  function makeId(prefix) {
    return (prefix || 'n') + '_' + Math.random().toString(36).slice(2, 8);
  }

  function defaultTransform() {
    return { x: 0, y: 0, scale: 1 };
  }

  function newNode(patch) {
    const base = {
      id: makeId('n'),
      title: '新节点',
      type: 'text',
      mood: 'daily',
      img: '',            // 图片文件名；'' 表示按 imgInherit 处理
      imgInherit: false,  // true = 沿用上一节点图片
      imgTransform: defaultTransform(),
      bg: '',             // 背景照片文件名
      bgInherit: true,    // true = 沿用上一节点背景，否则用当前氛围的默认背景
      text: '',
      choices: [],        // [{ text, target }]
      options: [],        // [{ label, value }]
      next: '',
      var: 'playerBreed', // select 节点写入的变量名
      speaker: '',        // '' 旁白 / 'player' 我 / '小白' / '小黑'
      end: false
    };
    const merged = Object.assign(base, patch || {});
    merged.id = merged.id || makeId('n');
    merged.choices = Array.isArray(merged.choices) ? merged.choices : [];
    merged.options = Array.isArray(merged.options) ? merged.options : [];
    merged.imgTransform = Object.assign(defaultTransform(), merged.imgTransform || {});
    return merged;
  }

  /* ---------------- 初始剧情骨架 ---------------- */
  function seedStory() {
    const n = newNode;
    const nodesList = [
      n({
        id: 'start', title: '你是谁？', type: 'select', mood: 'daily',
        bg: '1.jpeg', bgInherit: false,
        text: '先告诉我——你是一只什么猫？',
        var: 'playerBreed', next: 'intro',
        options: [
          { label: '橘白猫', value: '橘白猫', img: 'opt/orange.webp' },
          { label: '狸花猫', value: '狸花猫', img: 'opt/tabby.webp' },
          { label: '简州猫', value: '简州猫', img: 'opt/jianzhou.webp' },
          { label: '三花猫', value: '三花猫', img: 'opt/calico.webp' },
          { label: '玄猫', value: '玄猫', img: 'opt/black.webp' },
          { label: '白猫', value: '白猫', img: 'opt/white.webp' },
          { label: '奶牛猫', value: '奶牛猫', img: 'opt/cow.webp' }
        ]
      }),
      n({
        id: 'intro', title: '日常开场', type: 'text', mood: 'mystery',
        img: 'cat_intro.gif', bgInherit: false,
        text: '你是一只{playerBreed}。今天……好像有哪里不太对劲。',
        next: 'meet'
      }),
      n({
        id: 'meet', title: '小花猫报信', type: 'text', mood: 'mystery',
        img: 'cat_npc.gif', speaker: '小白',
        text: '小花猫凑过来：「平时最懒的小黑，最近突然忙起来了，肯定有猫腻。」',
        next: 'q1'
      }),
      n({
        id: 'q1', title: '你怎么想？', type: 'choice', mood: 'mystery',
        img: 'cat_npc.gif',
        text: '你怎么想？',
        choices: [
          { text: '跟踪小黑', target: 'track1' },
          { text: '不关我事', target: 'skip1' }
        ]
      }),
      n({
        id: 'track1', title: '跟上去', type: 'text', mood: 'tracking',
        img: '', imgInherit: true,
        text: '你悄悄跟上了小黑。',
        next: 'track_park'
      }),
      n({
        id: 'track_park', title: '公园花坛', type: 'text', mood: 'tracking',
        img: 'cat_park_flower.gif',
        text: '小黑进了公园，在花坛边溜达，叼走几朵小花就走。它叼花干什么？',
        next: 'track2'
      }),
      n({
        id: 'track2', title: '挑衅大狗', type: 'text', mood: 'tracking',
        img: 'cat_dog.gif',
        text: '小黑跑去挑衅大狗。',
        next: 'track3'
      }),
      n({
        id: 'track3', title: '调狗离窝', type: 'text', mood: 'tracking',
        img: 'cat_dog_chase.gif',
        text: '大狗追了出去，小黑却溜回狗窝，叼走一根火腿肠。',
        next: 'track4'
      }),
      n({
        id: 'track4', title: '卖萌', type: 'text', mood: 'tracking',
        img: 'cat_act_cute.gif',
        text: '小黑收起嚣张，凑到人类脚边卖萌。',
        next: 'track5'
      }),
      n({
        id: 'track5', title: '罐头到手', type: 'text', mood: 'tracking',
        img: 'cat_can.gif',
        text: '人类给了罐头。小黑叼起就跑，躲躲藏藏，警惕性很高。',
        next: 'track6'
      }),
      n({
        id: 'track6', title: '跟丢了', type: 'text', mood: 'tracking',
        img: 'cat_lost.gif',
        text: '转角处，小黑不见了。你跟丢了。',
        next: 'skip2'
      }),
      n({
        id: 'skip1', title: '不关我事', type: 'text', mood: 'daily',
        img: '', imgInherit: false, speaker: 'player',
        text: '不关我事，回家晒太阳。',
        next: 'skip2'
      }),
      n({
        id: 'skip2', title: '吃睡几天', type: 'text', mood: 'daily',
        img: '', imgInherit: false,
        text: '吃了睡，睡了吃，几天就这么过去了。',
        next: 'skip3'
      }),
      n({
        id: 'skip3', title: '门口的小黑', type: 'text', mood: 'daily',
        img: 'cat_xiaohei_come.gif',
        text: '小黑突然出现在门口，嘴里叼着东西。',
        next: 'final'
      }),
      n({
        id: 'final', title: '罐头蛋糕', type: 'text', mood: 'warm',
        img: 'cat_cake.gif',
        text: '小黑把这几天的收获拼成一个歪歪扭扭的「罐头蛋糕」——上面插着一根火腿肠，边上还插着几朵小花，摆得很认真，然后推到你的面前。',
        next: 'end'
      }),
      n({
        id: 'end', title: '生日快乐', type: 'end', mood: 'warm',
        img: 'cat_cake.gif', end: true, speaker: '小黑',
        text: '小黑小声说：「生日快乐。」像是怕别人听见。'
      })
    ];
    return buildSeed(nodesList);
  }

  function buildSeed(nodesList) {
    const nodes = {};
    nodesList.forEach(function (node) { nodes[node.id] = node; });
    return {
      version: 3,
      meta: { title: '重生之我穿越到了一只小猫身上', author: '' },
      startNodeId: 'start',
      bgByMood: {
        mystery: { src: 'bg_night.jpg', dim: 0.18 },
        tracking: { src: 'bg_street.jpg', dim: 0.2 },
        daily: { src: 'bg_home.jpg', dim: 0.08 },
        warm: { src: 'bg_warm.jpg', dim: 0.12 }
      },
      nodes: nodes,
      assets: [
        'cat_intro.gif', 'cat_npc.gif', 'cat_park_flower.gif', 'cat_dog.gif',
        'cat_dog_chase.gif', 'cat_act_cute.gif', 'cat_can.gif', 'cat_lost.gif',
        'cat_xiaohei_come.gif', 'cat_cake.gif',
        'bg_night.jpg', 'bg_street.jpg', 'bg_home.jpg', 'bg_warm.jpg',
        '1.jpeg',
        'opt/orange.webp', 'opt/tabby.webp', 'opt/jianzhou.webp',
        'opt/calico.webp', 'opt/black.webp', 'opt/white.webp', 'opt/cow.webp',
        '小白.png', '小黑.png',
        'opt/xiaobai.webp', 'opt/xiaohei.webp'
      ]
    };
  }
  /* ---------------- 归一化（导入/加载时兜底补字段） ---------------- */
  function normalize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    let rawNodes = src.nodes;
    if (Array.isArray(rawNodes)) {
      const map = {};
      rawNodes.forEach(function (node) { if (node && node.id) map[node.id] = node; });
      rawNodes = map;
    }
    const nodes = {};
    Object.keys(rawNodes || {}).forEach(function (key) {
      const node = Object.assign({}, rawNodes[key]);
      node.id = node.id || key;
      const built = newNode(node);
      // 兼容 end:true 却没有 type:"end" 的旧数据
      if (built.end && built.type !== 'end') built.type = 'end';
      if (built.type === 'end') built.end = true;
      // 选项统一成 { label, value, img }
      built.options = (built.options || []).map(function (o) {
        if (!o || typeof o !== 'object') {
          return { label: String(o || ''), value: String(o || ''), img: '' };
        }
        return {
          label: o.label || '',
          value: o.value || o.label || '',
          img: typeof o.img === 'string' ? o.img : ''
        };
      });
      nodes[built.id] = built;
    });

    let startId = src.startNodeId;
    if (!startId || !nodes[startId]) startId = Object.keys(nodes)[0] || '';

    const bgByMood = {};
    MOOD_IDS.forEach(function (m) {
      const preset = (src.bgByMood && src.bgByMood[m]) || {};
      bgByMood[m] = {
        src: typeof preset.src === 'string' ? preset.src : '',
        dim: typeof preset.dim === 'number' ? Math.max(0, Math.min(0.8, preset.dim)) : 0.15
      };
    });

    const assets = Array.isArray(src.assets) ? src.assets.slice() : [];
    Object.keys(nodes).forEach(function (id) {
      const node = nodes[id];
      const name = node.img;
      if (name && assets.indexOf(name) < 0) assets.push(name);
      const bgName = node.bg;
      if (bgName && assets.indexOf(bgName) < 0) assets.push(bgName);
      (node.options || []).forEach(function (option) {
        if (option.img && assets.indexOf(option.img) < 0) assets.push(option.img);
      });
    });
    MOOD_IDS.forEach(function (m) {
      const bgName = bgByMood[m].src;
      if (bgName && assets.indexOf(bgName) < 0) assets.push(bgName);
    });

    return {
      version: 3,
      meta: Object.assign({ title: '重生之我穿越到了一只小猫身上', author: '' }, src.meta || {}),
      startNodeId: startId,
      bgByMood: bgByMood,
      nodes: nodes,
      assets: assets
    };
  }

  /* ---------------- 校验 ---------------- */
  function validate(story) {
    const errors = [];
    const warnings = [];
    if (!story || !story.nodes) {
      return { errors: ['剧情数据为空'], warnings: warnings, ok: false };
    }
    const ids = Object.keys(story.nodes);
    if (!ids.length) errors.push('还没有任何节点');

    if (!story.startNodeId) {
      errors.push('没有设置开始节点');
    } else if (!story.nodes[story.startNodeId]) {
      errors.push('开始节点「' + story.startNodeId + '」不存在');
    }

    let hasEnd = false;
    ids.forEach(function (id) {
      const node = story.nodes[id];
      const label = node.title || id;
      if (node.type === 'end' || node.end) hasEnd = true;

      if (node.type === 'choice') {
        if (!node.choices.length) errors.push('「' + label + '」是选择节点，但没有选项');
        node.choices.forEach(function (c, i) {
          if (!c.target) {
            errors.push('「' + label + '」第 ' + (i + 1) + ' 个选项没有设置跳转');
          } else if (!story.nodes[c.target]) {
            errors.push('「' + label + '」第 ' + (i + 1) + ' 个选项指向不存在的节点「' + c.target + '」');
          }
          if (!c.text) warnings.push('「' + label + '」第 ' + (i + 1) + ' 个选项没有文字');
        });
      } else if (node.type === 'select') {
        if (!node.options.length) errors.push('「' + label + '」是选角节点，但没有选项');
        if (!node.next) {
          errors.push('「' + label + '」没有设置选中后的跳转');
        } else if (!story.nodes[node.next]) {
          errors.push('「' + label + '」跳转到不存在的节点「' + node.next + '」');
        }
      } else if (node.type === 'text') {
        if (!node.next) {
          warnings.push('「' + label + '」没有设置 next，播到这里会停住');
        } else if (!story.nodes[node.next]) {
          errors.push('「' + label + '」跳转到不存在的节点「' + node.next + '」');
        }
      }
      if (!String(node.text || '').trim()) {
        warnings.push('「' + label + '」还没有剧情文字');
      }
    });

    if (!hasEnd) warnings.push('还没有结局节点');
    return { errors: errors, warnings: warnings, ok: errors.length === 0 };
  }

  /* ---------------- 变量替换：{playerBreed} → 玩家选的猫品种 ---------------- */
  const VAR_FALLBACK = { playerBreed: '小猫' };

  function renderText(text, vars) {
    const source = String(text == null ? '' : text);
    return source.replace(/\{(\w+)\}/g, function (match, key) {
      const v = vars && vars[key];
      if (v !== undefined && v !== null && v !== '') return String(v);
      if (VAR_FALLBACK[key] !== undefined) return VAR_FALLBACK[key];
      return match;
    });
  }

  /** 汇总剧情里出现过的全部图片文件名（角色图 + 背景图） */
  function collectAssetNames(story) {
    const list = [];
    (story.assets || []).forEach(function (name) {
      if (name && list.indexOf(name) < 0) list.push(name);
    });
    Object.keys(story.nodes || {}).forEach(function (id) {
      const node = story.nodes[id];
      if (node.img && list.indexOf(node.img) < 0) list.push(node.img);
      if (node.bg && list.indexOf(node.bg) < 0) list.push(node.bg);
      (node.options || []).forEach(function (option) {
        if (option.img && list.indexOf(option.img) < 0) list.push(option.img);
      });
    });
    MOOD_IDS.forEach(function (m) {
      const bg = story.bgByMood && story.bgByMood[m];
      if (bg && bg.src && list.indexOf(bg.src) < 0) list.push(bg.src);
    });
    return list;
  }

  BS.model = {
    MOOD_IDS: MOOD_IDS,
    TYPE_LABELS: TYPE_LABELS,
    newNode: newNode,
    makeId: makeId,
    defaultTransform: defaultTransform,
    seedStory: seedStory,
    normalize: normalize,
    validate: validate,
    renderText: renderText,
    collectAssetNames: collectAssetNames
  };
})();
