/* ==========================================================
 * editor.js —— 编辑模式
 *  - 节点增删 / 复制 / 设为开始
 *  - 文字、类型、氛围、next、选项、选角选项编辑
 *  - 拖入/选择图片 → 存 IndexedDB → 绑定当前节点
 *  - 拖拽位置、滚轮/双指/滑杆缩放
 *  - 导出完整包 / 纯配置、导入 JSON
 * ========================================================== */
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  let story = null;
  let els = {};
  let selectedId = null;
  let assetRecords = [];        // IndexedDB 中已导入的图片
  let getUrl = function (name) { return 'assets/' + encodeURIComponent(name); };
  let callbacks = {};

  let pointerMap = new Map();
  let dragState = null;
  let pinchState = null;
  let uploadTarget = 'img';   // 'img' | 'bg' | { type:'option', index }
  let pickerIndex = null;     // 当前正在为哪个选角选项选图
  const assetProbeCache = new Map();  // name|url -> 'ok' | 'bad'

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(str) { return escapeHtml(str); }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* ---------------- 初始化 ---------------- */

  function init(options) {
    story = options.story;
    callbacks = options;
    if (options.getImageUrl) getUrl = options.getImageUrl;

    els = {
      nodeList: $('nodeList'),
      nodeCount: $('nodeCount'),
      props: $('edProps'),
      stage: $('edStage'),
      holder: $('edHolder'),
      img: $('edImg'),
      missing: $('edMissing'),
      bgA: $('edBgLayerA'),
      bgB: $('edBgLayerB'),
      caption: $('edCaption'),
      current: $('edCurrent'),
      file: $('assetFile'),
      addBtn: $('btnAddNode'),
      validateBtn: $('btnValidate'),
      previewBtn: $('btnPreviewNode'),
      importBtn: $('btnImport'),
      importFile: $('importFile'),
      exportFull: $('btnExportFull'),
      exportConfig: $('btnExportConfig'),
      picker: $('imgPicker'),
      pickerBody: $('imgPickerBody'),
      pickerClose: $('imgPickerClose'),
      pickerUpload: $('imgPickerUpload'),
      pickerClear: $('imgPickerClear')
    };

    els.nodeList.addEventListener('click', function (event) {
      const item = event.target.closest('.node-item');
      if (item && item.dataset.id) select(item.dataset.id);
    });

    els.addBtn.addEventListener('click', addNode);
    els.validateBtn.addEventListener('click', validateNow);
    els.previewBtn.addEventListener('click', function () {
      if (!selectedId) return onToast('先选择一个节点', 'error');
      if (callbacks.onPreview) callbacks.onPreview(selectedId);
    });

    els.props.addEventListener('input', onPropInput);
    els.props.addEventListener('change', onPropChange);
    els.props.addEventListener('click', onPropClick);

    /* 背景拖放区（属性面板内） */
    els.props.addEventListener('dragover', function (event) {
      const zone = event.target.closest('.bg-drop');
      if (!zone) return;
      event.preventDefault();
      zone.classList.add('is-drop');
    });
    els.props.addEventListener('dragleave', function (event) {
      const zone = event.target.closest('.bg-drop');
      if (zone) zone.classList.remove('is-drop');
    });
    els.props.addEventListener('drop', function (event) {
      const zone = event.target.closest('.bg-drop');
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('is-drop');
      if (event.dataTransfer && event.dataTransfer.files.length) {
        uploadFiles(event.dataTransfer.files, 'bg');
      }
    });

    els.file.addEventListener('change', function () {
      const target = uploadTarget;
      uploadTarget = 'img';
      if (els.file.files && els.file.files.length) uploadFiles(els.file.files, target);
      els.file.value = '';
    });

    els.importBtn.addEventListener('click', function () { els.importFile.click(); });
    els.importFile.addEventListener('change', function () {
      const file = els.importFile.files && els.importFile.files[0];
      els.importFile.value = '';
      if (file) importJsonFile(file);
    });
    els.exportFull.addEventListener('click', function () { exportStory(true); });
    els.exportConfig.addEventListener('click', function () { exportStory(false); });

    /* 选角选项的图片选择弹层 */
    els.pickerClose.addEventListener('click', closeImagePicker);
    els.picker.addEventListener('click', function (event) {
      if (event.target === els.picker) closeImagePicker();
    });
    els.pickerBody.addEventListener('click', onPickerClick);
    els.pickerUpload.addEventListener('click', function () {
      if (pickerIndex == null) return;
      uploadTarget = { type: 'option', index: pickerIndex };
      els.file.click();
    });
    els.pickerClear.addEventListener('click', function () {
      if (pickerIndex == null) return closeImagePicker();
      const node = getNode();
      if (node && node.options[pickerIndex]) node.options[pickerIndex].img = '';
      closeImagePicker();
      renderProps();
      markDirty();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !els.picker.hidden) closeImagePicker();
    });

    /* 拖入图片 */
    els.stage.addEventListener('dragover', function (event) {
      event.preventDefault();
      els.stage.classList.add('is-drop');
    });
    els.stage.addEventListener('dragleave', function () {
      els.stage.classList.remove('is-drop');
    });
    els.stage.addEventListener('drop', function (event) {
      event.preventDefault();
      els.stage.classList.remove('is-drop');
      if (event.dataTransfer && event.dataTransfer.files.length) {
        uploadFiles(event.dataTransfer.files, 'img');
      }
    });

    /* 拖动 / 双指缩放 */
    els.stage.addEventListener('pointerdown', onPointerDown);
    els.stage.addEventListener('pointermove', onPointerMove);
    els.stage.addEventListener('pointerup', onPointerUp);
    els.stage.addEventListener('pointercancel', onPointerUp);
    els.stage.addEventListener('wheel', onWheel, { passive: false });

    els.img.addEventListener('error', function () {
      if (!els.img.getAttribute('src')) return;
      els.img.hidden = true;
      els.missing.hidden = false;
    });
    els.img.addEventListener('load', function () {
      els.img.hidden = false;
      els.missing.hidden = true;
    });

    selectedId = story.startNodeId || Object.keys(story.nodes)[0] || null;
    refresh();
    reloadAssets();
  }

  function onToast(message, type) {
    if (callbacks.onToast) callbacks.onToast(message, type);
  }

  function markDirty() {
    if (callbacks.onChange) callbacks.onChange();
  }

  function moodColor(mood) {
    const map = {
      mystery: '#6f8fd6',
      tracking: '#9aa7b8',
      daily: '#e0c48a',
      warm: '#f2a14a'
    };
    return map[mood] || '#999';
  }
  /* ---------------- 节点列表 ---------------- */

  function renderList() {
    if (!story) return;
    const ids = Object.keys(story.nodes);
    els.nodeCount.textContent = ids.length + ' 个';
    els.nodeList.innerHTML = ids.map(function (id) {
      const node = story.nodes[id];
      const mood = BS.moods.moodForNode(node);
      const isStart = story.startNodeId === id;
      const imgLabel = node.img ? node.img : (node.imgInherit ? '沿用上一张' : '无图');
      return (
        '<div class="node-item' + (id === selectedId ? ' is-active' : '') + '" data-id="' + escapeAttr(id) + '">' +
          '<div class="node-item-top">' +
            '<span class="node-title">' +
              (isStart ? '<span class="start-star" title="开始节点">★ </span>' : '') +
              escapeHtml(node.title || id) +
            '</span>' +
            '<span class="node-type t-' + escapeAttr(node.type) + '">' +
              escapeHtml(BS.model.TYPE_LABELS[node.type] || node.type) +
            '</span>' +
          '</div>' +
          '<div class="node-item-sub">' +
            '<span class="mood-dot" style="--mood-color:' + moodColor(mood) + '"></span>' +
            escapeHtml(BS.moods.label(mood)) + ' · ' + escapeHtml(imgLabel) +
            (node.speaker ? ' · ' + escapeHtml(node.speaker === 'player' ? '我' : node.speaker) : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
    if (!ids.length) els.nodeList.innerHTML = '<div class="empty">还没有节点</div>';
  }

  function select(id) {
    if (!story.nodes[id]) return;
    selectedId = id;
    renderList();
    renderProps();
    renderStage();
  }

  function refresh() {
    renderList();
    renderProps();
    renderStage();
  }

  async function reloadAssets() {
    try {
      assetRecords = await BS.storage.listAssets();
    } catch (err) {
      assetRecords = [];
    }
    renderProps();
  }

  function getNode() {
    return selectedId ? story.nodes[selectedId] : null;
  }
  /* ---------------- 属性面板 ---------------- */

  function renderProps() {
    const node = getNode();
    if (!node) {
      els.props.innerHTML = '<div class="empty">在左侧选择一个节点</div>';
      els.current.textContent = '未选择节点';
      return;
    }
    els.current.textContent = (node.title || node.id) + ' · ' + node.id;
    els.props.innerHTML = buildPropsHtml(node);
    updateScaleUI();
    hydrateProbeImages(els.props);
  }

  function nodeOptions(selected, emptyLabel) {
    const opts = Object.keys(story.nodes).map(function (id) {
      const n = story.nodes[id];
      return '<option value="' + escapeAttr(id) + '"' + (id === selected ? ' selected' : '') + '>' +
        escapeHtml(n.title || id) + '（' + escapeHtml(id) + '）</option>';
    }).join('');
    const empty = emptyLabel
      ? '<option value=""' + (selected ? '' : ' selected') + '>' + escapeHtml(emptyLabel) + '</option>'
      : '';
    return empty + opts;
  }

  function assetTiles(node, act) {
    const action = act || 'bind';
    const names = [];
    BS.model.collectAssetNames(story).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    assetRecords.forEach(function (rec) {
      if (names.indexOf(rec.name) < 0) names.push(rec.name);
    });
    if (!names.length) return '<div class="muted">还没有图片：拖一张进来，或点「选择图片」</div>';

    return names.map(function (name) {
      const bound = action === 'bind-bg' ? node.bg === name : node.img === name;
      return (
        '<button type="button" class="asset-tile' + (bound ? ' is-bound' : '') + '"' +
          ' data-act="' + action + '" data-name="' + escapeAttr(name) + '" title="' + escapeAttr(name) + '">' +
          '<img data-probe="' + escapeAttr(name) + '" alt="" loading="lazy" hidden>' +
          '<span class="tile-empty">' + escapeHtml(name) + '</span>' +
          '<span class="asset-tile-name">' + escapeHtml(name) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  /** 让缩略图真实探测 assets/ 里是否存在同名文件（不只看 IndexedDB） */
  function hydrateProbeImages(root) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('img[data-probe]'), function (img) {
      const name = img.getAttribute('data-probe');
      if (!name) return;
      const url = getUrl(name);
      const key = name + '|' + url;
      const applyOk = function () {
        img.hidden = false;
        img.src = url;
        const parent = img.parentNode;
        if (!parent) return;
        parent.classList.add('has-img');
        const fallback = parent.querySelector('.tile-empty, .opt-thumb-text');
        if (fallback) fallback.style.display = 'none';
      };
      if (assetProbeCache.get(key) === 'ok') { applyOk(); return; }
      if (assetProbeCache.get(key) === 'bad') return;
      const probe = new Image();
      probe.onload = function () { assetProbeCache.set(key, 'ok'); applyOk(); };
      probe.onerror = function () { assetProbeCache.set(key, 'bad'); img.hidden = true; };
      probe.src = url;
    });
  }

  /* ---------------- 背景辅助 ---------------- */

  function previewPrevBg(node) {
    const ids = Object.keys(story.nodes);
    let last = null;
    for (let i = 0; i < ids.length; i++) {
      const other = story.nodes[ids[i]];
      if (other.bg) last = other.bg;
      if (ids[i] === node.id) break;
    }
    return last;
  }

  function previewBgName(node) {
    if (node.bg) return node.bg;
    if (node.bgInherit !== false) {
      const prev = previewPrevBg(node);
      if (prev) return prev;
    }
    const mood = BS.moods.moodForNode(node);
    const preset = story.bgByMood && story.bgByMood[mood];
    return preset && preset.src ? preset.src : null;
  }

  function bgDimFor(mood) {
    const preset = story.bgByMood && story.bgByMood[mood];
    return preset && typeof preset.dim === 'number' ? preset.dim : 0.15;
  }

  function bgStateText(node) {
    const mood = BS.moods.moodForNode(node);
    const preset = story.bgByMood && story.bgByMood[mood];
    const moodName = preset && preset.src ? ('氛围默认：' + preset.src) : '氛围默认：纯渐变';
    if (node.bg) return '本节点背景：' + node.bg;
    if (node.bgInherit !== false) {
      const prev = previewPrevBg(node);
      if (prev) return '沿用上一节点：' + prev;
    }
    return moodName;
  }

  /* ---------------- 选角图片选择弹层 ---------------- */

  function openImagePicker(index) {
    const node = getNode();
    if (!node || !node.options[index]) return;
    pickerIndex = index;
    renderPickerBody();
    els.picker.hidden = false;
  }

  function closeImagePicker() {
    pickerIndex = null;
    els.picker.hidden = true;
  }

  function renderPickerBody() {
    const names = [];
    BS.model.collectAssetNames(story).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    assetRecords.forEach(function (rec) {
      if (names.indexOf(rec.name) < 0) names.push(rec.name);
    });

    const node = getNode();
    const currentName = node && node.options[pickerIndex] ? node.options[pickerIndex].img : '';

    if (!names.length) {
      els.pickerBody.innerHTML = '<div class="muted">还没有图片，点下方「上传新图片」</div>';
      return;
    }

    els.pickerBody.innerHTML = names.map(function (name) {
      return '<button type="button" class="asset-tile' + (name === currentName ? ' is-bound' : '') + '"' +
        ' data-act="pick-option-asset" data-name="' + escapeAttr(name) + '" title="' + escapeAttr(name) + '">' +
        '<img data-probe="' + escapeAttr(name) + '" alt="" loading="lazy" hidden>' +
        '<span class="tile-empty">' + escapeHtml(name) + '</span>' +
        '<span class="asset-tile-name">' + escapeHtml(name) + '</span>' +
      '</button>';
    }).join('');
    hydrateProbeImages(els.pickerBody);
  }

  function onPickerClick(event) {
    const btn = event.target.closest('[data-act="pick-option-asset"]');
    if (!btn) return;
    const node = getNode();
    const index = pickerIndex;
    if (!node || index == null || !node.options[index]) return;
    node.options[index].img = btn.dataset.name || '';
    closeImagePicker();
    renderProps();
    markDirty();
  }

  function propsBaseHtml(node) {
    const typeOpts = Object.keys(BS.model.TYPE_LABELS).map(function (t) {
      return '<option value="' + t + '"' + (node.type === t ? ' selected' : '') + '>' +
        BS.model.TYPE_LABELS[t] + '</option>';
    }).join('');
    const moodOpts = BS.moods.list.map(function (m) {
      return '<option value="' + m.id + '"' + (node.mood === m.id ? ' selected' : '') + '>' +
        m.label + ' · ' + m.desc + '</option>';
    }).join('');

    return '<label class="field"><span>节点 ID（只读）</span><input value="' + escapeAttr(node.id) + '" readonly></label>' +
      '<label class="field"><span>节点标题（只用于编辑器列表）</span><input data-field="title" value="' + escapeAttr(node.title) + '"></label>' +
      '<div class="row2">' +
        '<label class="field"><span>类型</span><select data-field="type">' + typeOpts + '</select></label>' +
        '<label class="field"><span>氛围 mood</span><select data-field="mood">' + moodOpts + '</select></label>' +
      '</div>';
  }

  function propsImageHtml(node) {
    const imgState = node.img
      ? '已绑定：' + node.img
      : (node.imgInherit ? '沿用上一张节点图片' : '不显示图片');

    return '<div class="prop-group">' +
      '<div class="group-title">配图</div>' +
      '<div class="img-state">' + escapeHtml(imgState) + '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-small" data-act="pickfile" type="button">选择图片</button>' +
        '<button class="btn btn-small" data-act="inheritimg" type="button">沿用上一张</button>' +
        '<button class="btn btn-small" data-act="clearimg" type="button">不显示</button>' +
      '</div>' +
      '<div class="asset-strip">' + assetTiles(node) + '</div>' +
      '<label class="field"><span>缩放 <b id="scaleVal">' + node.imgTransform.scale.toFixed(2) + '×</b></span>' +
        '<input type="range" data-field="scale" min="0.2" max="4" step="0.05" value="' + node.imgTransform.scale + '"></label>' +
      '<button class="btn btn-small" data-act="resetTransform" type="button">复位位置与缩放</button>' +
      '<div class="muted" style="margin-top:6px">也可以直接在左边舞台里拖动图片、滚轮/双指缩放。</div>' +
    '</div>';
  }

  function propsBackgroundHtml(node) {
    const mood = BS.moods.moodForNode(node);
    const dim = bgDimFor(mood);
    return '<div class="prop-group">' +
      '<div class="group-title">背景照片</div>' +
      '<div class="img-state">' + escapeHtml(bgStateText(node)) + '</div>' +
      '<div class="bg-drop" data-act="bg-pick">把背景图拖到这里，或点此选择</div>' +
      '<div class="asset-strip">' + assetTiles(node, 'bind-bg') + '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-small" data-act="bg-inherit" type="button">沿用上一张</button>' +
        '<button class="btn btn-small" data-act="bg-mood" type="button">用氛围默认</button>' +
      '</div>' +
      '<button class="btn btn-small" data-act="set-mood-bg" type="button" style="width:100%">' +
        '把当前背景设为「' + BS.moods.label(mood) + '」默认</button>' +
      '<label class="field" style="margin-top:10px"><span>该氛围背景压暗 <b id="bgDimVal">' +
        Math.round(dim * 100) + '%</b></span>' +
        '<input type="range" data-field="bgDim" min="0" max="0.7" step="0.01" value="' + dim + '"></label>' +
      '<div class="muted">背景自动 cover 铺满；压暗只影响照片，不影响暗角和噪点。</div>' +
    '</div>';
  }

  function speakerOptions(selected) {
    const list = [
      ['', '旁白 / 无立绘'],
      ['player', '我（立绘在右侧）'],
      ['小白', '小白（立绘在左侧）'],
      ['小黑', '小黑（立绘在左侧）']
    ];
    return list.map(function (pair) {
      return '<option value="' + pair[0] + '"' + (selected === pair[0] ? ' selected' : '') + '>' +
        pair[1] + '</option>';
    }).join('');
  }

  function propsTextHtml(node) {
    return '<div class="prop-group">' +
      '<div class="group-title">剧情文字</div>' +
      '<label class="field"><span>说话人（决定立绘位置）</span>' +
        '<select data-field="speaker">' + speakerOptions(node.speaker || '') + '</select></label>' +
      '<textarea data-field="text" rows="5" placeholder="在这里输入这一节点的文字…">' + escapeHtml(node.text) + '</textarea>' +
      '<div class="chips">' +
        '<button class="chip" data-act="insert-var" data-var="playerBreed" type="button">{playerBreed}</button>' +
        '<span class="muted">播放时替换成玩家选的猫品种</span>' +
      '</div>' +
      '<div class="muted" style="margin-top:6px">「我」使用玩家选中的猫立绘；小白/小黑读取 assets/ 里同名图片。</div>' +
    '</div>';
  }

  function updateScaleUI() {
    const node = getNode();
    if (!node) return;
    const range = els.props.querySelector('[data-field="scale"]');
    const label = $('scaleVal');
    if (range) range.value = String(node.imgTransform.scale);
    if (label) label.textContent = node.imgTransform.scale.toFixed(2) + '×';
  }
  function propsStructureHtml(node) {
    let html = '';

    if (node.type === 'choice') {
      html += '<div class="prop-group">' +
        '<div class="group-title">选项分支</div>' +
        '<div>' + (node.choices.length ? node.choices.map(function (c, i) {
          return '<div class="choice-row">' +
            '<input data-list="choices" data-index="' + i + '" data-key="text" value="' + escapeAttr(c.text || '') + '" placeholder="选项文字">' +
            '<select data-list="choices" data-index="' + i + '" data-key="target">' +
              nodeOptions(c.target, '跳转到…') +
            '</select>' +
            '<button class="icon-btn" data-act="del-choice" data-index="' + i + '" type="button" title="删除选项">✕</button>' +
          '</div>';
        }).join('') : '<div class="muted">还没有选项</div>') + '</div>' +
        '<button class="btn btn-small" data-act="add-choice" type="button">＋ 添加选项</button>' +
      '</div>';
    } else if (node.type === 'select') {
      html += '<div class="prop-group">' +
        '<div class="group-title">选角选项（写入变量）</div>' +
        '<label class="field"><span>变量名</span><input data-field="var" value="' + escapeAttr(node.var || 'playerBreed') + '"></label>' +
        '<div>' + (node.options.length ? node.options.map(function (o, i) {
          const thumb = (o.img
            ? '<img data-probe="' + escapeAttr(o.img) + '" alt="" hidden>'
            : '') +
            '<span class="opt-thumb-text">' + escapeHtml(o.img || '选图') + '</span>';
          return '<div class="option-edit">' +
            '<button class="opt-thumb' + (o.img ? ' has-img' : '') + '" data-act="pick-option-img" ' +
              'data-index="' + i + '" type="button" title="' + escapeAttr(o.img || '为这个选项选择图片') + '">' +
              thumb + '</button>' +
            '<div class="opt-fields">' +
              '<input data-list="options" data-index="' + i + '" data-key="label" value="' + escapeAttr(o.label || '') + '" placeholder="名字 / alt">' +
              '<input data-list="options" data-index="' + i + '" data-key="value" value="' + escapeAttr(o.value || '') + '" placeholder="写入值">' +
            '</div>' +
            '<button class="icon-btn" data-act="del-option" data-index="' + i + '" type="button" title="删除选项">✕</button>' +
          '</div>';
        }).join('') : '<div class="muted">还没有选项</div>') + '</div>' +
        '<button class="btn btn-small" data-act="add-option" type="button">＋ 添加选项</button>' +
        '<div class="muted" style="margin-top:6px">点选项左边的方块可以选猫猫图片；绑了图的选项在播放时显示为圆形头像。</div>' +
        '<label class="field" style="margin-top:10px"><span>选中后跳转到</span>' +
          '<select data-field="next">' + nodeOptions(node.next, '（未设置）') + '</select></label>' +
      '</div>';
    } else if (node.type === 'text') {
      html += '<div class="prop-group">' +
        '<div class="group-title">推进</div>' +
        '<label class="field"><span>点击空白 / 空格 后跳到</span>' +
          '<select data-field="next">' + nodeOptions(node.next, '（未设置，播到这里停住）') + '</select></label>' +
      '</div>';
    } else if (node.type === 'end') {
      html += '<div class="prop-group"><div class="group-title">结局</div>' +
        '<div class="muted">结局节点播放时自动用 warm 氛围，显示「再玩一次」，不需要设置 next。</div></div>';
    }

    return html;
  }

  function propsActionsHtml() {
    return '<div class="prop-group node-actions">' +
      '<button class="btn btn-small" data-act="set-start" type="button">设为开始节点</button>' +
      '<button class="btn btn-small" data-act="duplicate" type="button">复制节点</button>' +
      '<button class="btn btn-small" data-act="preview" type="button">▶ 从这里试玩</button>' +
      '<button class="btn btn-small danger" data-act="delete" type="button">删除节点</button>' +
    '</div>';
  }

  function buildPropsHtml(node) {
    let head = '<div class="prop-head"><strong>' + escapeHtml(node.title || node.id) + '</strong>' +
      '<span class="pill">' + escapeHtml(BS.model.TYPE_LABELS[node.type] || node.type) + '</span></div>';
    if (story.startNodeId === node.id) head += '<div class="badge-start">★ 开始节点</div>';

    return head +
      '<div class="prop-group">' + propsBaseHtml(node) + '</div>' +
      propsImageHtml(node) +
      propsBackgroundHtml(node) +
      propsTextHtml(node) +
      propsStructureHtml(node) +
      propsActionsHtml();
  }
  /* ---------------- 属性面板事件 ---------------- */

  function onPropInput(event) {
    const node = getNode();
    if (!node) return;
    const target = event.target;
    const field = target.dataset.field;

    if (field === 'text') {
      node.text = target.value;
      markDirty();
      return;
    }
    if (field === 'title') {
      node.title = target.value;
      renderList();
      els.current.textContent = (node.title || node.id) + ' · ' + node.id;
      markDirty();
      return;
    }
    if (field === 'scale') {
      node.imgTransform.scale = clamp(Number(target.value) || 1, 0.2, 4);
      updateScaleUI();
      applyTransform();
      markDirty();
      return;
    }
    if (field === 'bgDim') {
      const mood = BS.moods.moodForNode(node);
      if (story.bgByMood && story.bgByMood[mood]) {
        story.bgByMood[mood].dim = clamp(Number(target.value) || 0, 0, 0.7);
      }
      const label = $('bgDimVal');
      if (label) label.textContent = Math.round(Number(target.value) * 100) + '%';
      renderStage();
      markDirty();
      return;
    }

    const list = target.dataset.list;
    if (list) {
      const index = Number(target.dataset.index);
      const key = target.dataset.key;
      const arr = list === 'choices' ? node.choices : node.options;
      if (arr && arr[index]) {
        arr[index][key] = target.value;
        markDirty();
      }
    }
  }

  function onPropChange(event) {
    const node = getNode();
    if (!node) return;
    const target = event.target;
    const field = target.dataset.field;

    if (field === 'type') {
      node.type = target.value;
      node.end = node.type === 'end';
      renderList();
      renderProps();
      renderStage();
      markDirty();
      return;
    }
    if (field === 'mood') {
      node.mood = target.value;
      renderList();
      renderStage();
      markDirty();
      return;
    }
    if (field === 'next') {
      node.next = target.value;
      markDirty();
      return;
    }
    if (field === 'var') {
      node.var = target.value;
      markDirty();
      return;
    }
    if (field === 'speaker') {
      node.speaker = target.value;
      markDirty();
      return;
    }
    if (target.dataset.list) {
      onPropInput(event);
    }
  }

  function onPropClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const node = getNode();

    if (!node) return;

    if (act === 'pickfile') {
      uploadTarget = 'img';
      els.file.click();
      return;
    }
    if (act === 'bg-pick') {
      uploadTarget = 'bg';
      els.file.click();
      return;
    }
    if (act === 'bind-bg') {
      const name = btn.dataset.name;
      if (!name) return;
      node.bg = name;
      node.bgInherit = true;
      renderProps();
      renderStage();
      renderList();
      markDirty();
      return;
    }
    if (act === 'bg-inherit') {
      node.bg = '';
      node.bgInherit = true;
      renderProps();
      renderStage();
      renderList();
      markDirty();
      return;
    }
    if (act === 'bg-mood') {
      node.bg = '';
      node.bgInherit = false;
      renderProps();
      renderStage();
      renderList();
      markDirty();
      return;
    }
    if (act === 'set-mood-bg') {
      const mood = BS.moods.moodForNode(node);
      const name = previewBgName(node);
      if (!name) {
        onToast('当前没有可用的背景图，先拖一张进来', 'error');
        return;
      }
      story.bgByMood[mood] = {
        src: name,
        dim: (story.bgByMood[mood] && typeof story.bgByMood[mood].dim === 'number')
          ? story.bgByMood[mood].dim
          : 0.15
      };
      if (story.assets.indexOf(name) < 0) story.assets.push(name);
      renderProps();
      renderStage();
      renderList();
      markDirty();
      onToast('已设为「' + BS.moods.label(mood) + '」默认背景：' + name, 'ok');
      return;
    }
    if (act === 'inheritimg') {
      node.img = '';
      node.imgInherit = true;
      renderProps();
      renderStage();
      renderList();
      markDirty();
      return;
    }
    if (act === 'clearimg') {
      node.img = '';
      node.imgInherit = false;
      renderProps();
      renderStage();
      renderList();
      markDirty();
      return;
    }
    if (act === 'bind') {
      const name = btn.dataset.name;
      if (!name) return;
      node.img = name;
      node.imgInherit = true;
      renderProps();
      renderStage();
      renderList();
      markDirty();
      return;
    }
    if (act === 'resetTransform') {
      node.imgTransform = { x: 0, y: 0, scale: 1 };
      updateScaleUI();
      applyTransform();
      markDirty();
      return;
    }
    if (act === 'insert-var') {
      const area = els.props.querySelector('[data-field="text"]');
      const varText = '{' + (btn.dataset.var || 'playerBreed') + '}';
      if (area) {
        const start = area.selectionStart == null ? area.value.length : area.selectionStart;
        const end = area.selectionEnd == null ? area.value.length : area.selectionEnd;
        area.value = area.value.slice(0, start) + varText + area.value.slice(end);
        area.focus();
        area.selectionStart = area.selectionEnd = start + varText.length;
        node.text = area.value;
      } else {
        node.text = (node.text || '') + varText;
      }
      markDirty();
      return;
    }
    if (act === 'add-choice') {
      node.choices.push({ text: '新选项', target: '' });
      renderProps();
      markDirty();
      return;
    }
    if (act === 'del-choice') {
      node.choices.splice(Number(btn.dataset.index), 1);
      renderProps();
      markDirty();
      return;
    }
    if (act === 'pick-option-img') {
      openImagePicker(Number(btn.dataset.index));
      return;
    }
    if (act === 'add-option') {
      node.options.push({ label: '新选项', value: '新选项', img: '' });
      renderProps();
      markDirty();
      return;
    }
    if (act === 'del-option') {
      node.options.splice(Number(btn.dataset.index), 1);
      renderProps();
      markDirty();
      return;
    }
    if (act === 'set-start') {
      story.startNodeId = node.id;
      renderList();
      renderProps();
      onToast('已把「' + (node.title || node.id) + '」设为开始节点', 'ok');
      markDirty();
      return;
    }
    if (act === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(node));
      copy.id = BS.model.makeId('n');
      copy.title = (node.title || '节点') + ' 副本';
      story.nodes[copy.id] = copy;
      selectedId = copy.id;
      refresh();
      markDirty();
      return;
    }
    if (act === 'preview') {
      if (callbacks.onPreview) callbacks.onPreview(node.id);
      return;
    }
    if (act === 'delete') {
      deleteNode(node.id);
    }
  }

  function deleteNode(id) {
    const node = story.nodes[id];
    if (!node) return;
    if (!window.confirm('删除节点「' + (node.title || id) + '」？指向它的跳转会一并清空。')) return;
    delete story.nodes[id];

    Object.keys(story.nodes).forEach(function (key) {
      const other = story.nodes[key];
      if (other.next === id) other.next = '';
      other.choices = (other.choices || []).filter(function (c) { return c.target !== id; });
    });

    if (story.startNodeId === id) {
      story.startNodeId = Object.keys(story.nodes)[0] || '';
    }
    selectedId = story.startNodeId || Object.keys(story.nodes)[0] || null;
    refresh();
    markDirty();
  }
  /* ---------------- 舞台预览 ---------------- */

  function previewImageName(node) {
    if (node.img) return node.img;
    if (node.imgInherit === false) return null;
    const ids = Object.keys(story.nodes);
    let last = null;
    for (let i = 0; i < ids.length; i++) {
      const other = story.nodes[ids[i]];
      if (other.img) last = other.img;
      if (ids[i] === node.id) break;
    }
    return last;
  }

  function renderStage() {
    const node = getNode();
    if (!node) {
      els.stage.dataset.mood = 'daily';
      els.img.hidden = true;
      els.img.removeAttribute('src');
      els.img.dataset.name = '';
      els.missing.hidden = false;
      const empty = els.missing.querySelector('.missing-name');
      if (empty) empty.textContent = '未选择节点';
      els.caption.textContent = '';
      els.bgA.classList.remove('is-on');
      els.bgA.dataset.name = '';
      els.bgA.style.backgroundImage = '';
      return;
    }

    const mood = BS.moods.moodForNode(node);
    BS.moods.apply(els.stage, mood);

    const name = previewImageName(node);
    const nameEl = els.missing.querySelector('.missing-name');
    if (nameEl) nameEl.textContent = name || '未绑定图片';

    if (name) {
      if (els.img.dataset.name !== name) {
        els.img.dataset.name = name;
        els.img.hidden = false;
        els.img.src = getUrl(name);
      }
    } else {
      els.img.dataset.name = '';
      els.img.hidden = true;
      els.img.removeAttribute('src');
    }
    els.missing.hidden = !!name && !els.img.hidden;

    applyTransform();
    renderEditorBg(node, mood);
    const bgName = previewBgName(node);
    els.caption.textContent =
      (node.title || node.id) + ' · ' + (name || '无图') +
      ' · 背景 ' + (bgName || '渐变') + ' · ' + BS.moods.label(mood);
  }

  function applyTransform() {
    const node = getNode();
    if (!node) return;
    const rect = els.stage.getBoundingClientRect();
    const t = node.imgTransform;
    els.holder.style.transform =
      'translate(' + (t.x * rect.width).toFixed(1) + 'px,' +
      (t.y * rect.height).toFixed(1) + 'px) scale(' + t.scale + ')';
  }

  function renderEditorBg(node, mood) {
    const name = previewBgName(node);
    els.bgA.style.setProperty('--bg-dim', bgDimFor(mood));

    if (!name) {
      els.bgA.classList.remove('is-on');
      els.bgA.dataset.name = '';
      els.bgA.style.backgroundImage = '';
      return;
    }
    if (els.bgA.dataset.name === name) return;

    const url = getUrl(name);
    const probe = new Image();
    probe.onload = function () {
      const current = getNode();
      if (!current || previewBgName(current) !== name) return;
      els.bgA.style.backgroundImage = 'url("' + url + '")';
      els.bgA.dataset.name = name;
      els.bgA.classList.add('is-on');
    };
    probe.onerror = function () {
      els.bgA.classList.remove('is-on');
      els.bgA.dataset.name = '';
      els.bgA.style.backgroundImage = '';
    };
    probe.src = url;
  }

  /* ---------------- 拖动 / 缩放 ---------------- */

  function onPointerDown(event) {
    const node = getNode();
    if (!node) return;
    if (!previewImageName(node)) return;
    if (event.target.closest('button')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    try { els.stage.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerMap.size === 1) {
      dragState = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseX: node.imgTransform.x,
        baseY: node.imgTransform.y
      };
      els.holder.classList.add('is-dragging');
    } else if (pointerMap.size === 2) {
      dragState = null;
      startPinch();
    }
  }

  function startPinch() {
    const node = getNode();
    if (!node) return;
    const pts = Array.from(pointerMap.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    pinchState = { startDist: dist, baseScale: node.imgTransform.scale };
  }

  function onPointerMove(event) {
    if (!pointerMap.has(event.pointerId)) return;
    pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const node = getNode();
    if (!node) return;

    if (pointerMap.size >= 2 && pinchState) {
      const pts = Array.from(pointerMap.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      node.imgTransform.scale = clamp(pinchState.baseScale * (dist / pinchState.startDist), 0.2, 4);
      applyTransform();
      updateScaleUI();
      return;
    }

    if (dragState && dragState.id === event.pointerId) {
      const rect = els.stage.getBoundingClientRect();
      node.imgTransform.x = clamp(dragState.baseX + (event.clientX - dragState.startX) / rect.width, -2, 2);
      node.imgTransform.y = clamp(dragState.baseY + (event.clientY - dragState.startY) / rect.height, -2, 2);
      applyTransform();
    }
  }

  function onPointerUp(event) {
    if (!pointerMap.has(event.pointerId)) return;
    pointerMap.delete(event.pointerId);
    els.holder.classList.remove('is-dragging');
    if (pointerMap.size < 2) pinchState = null;
    if (pointerMap.size === 0) {
      dragState = null;
      markDirty();
    }
  }

  function onWheel(event) {
    const node = getNode();
    if (!node) return;
    if (!previewImageName(node)) return;
    event.preventDefault();
    const step = event.deltaY > 0 ? -0.06 : 0.06;
    node.imgTransform.scale = clamp(node.imgTransform.scale + step, 0.2, 4);
    applyTransform();
    updateScaleUI();
    markDirty();
  }

  /* ---------------- 节点增删 / 校验 ---------------- */

  function addNode() {
    const current = getNode();
    const node = BS.model.newNode({
      title: '新节点 ' + (Object.keys(story.nodes).length + 1),
      mood: current ? current.mood : 'daily',
      type: 'text'
    });
    story.nodes[node.id] = node;
    selectedId = node.id;
    refresh();
    markDirty();
    setTimeout(function () {
      const area = els.props.querySelector('[data-field="text"]');
      if (area) area.focus();
    }, 40);
  }

  function validateNow() {
    const result = BS.model.validate(story);
    if (result.errors.length) {
      onToast('发现 ' + result.errors.length + ' 个问题：' + result.errors.slice(0, 4).join('；'), 'error');
    } else if (result.warnings.length) {
      onToast('配置可用，提醒：' + result.warnings.slice(0, 3).join('；'), 'ok');
    } else {
      onToast('配置检查通过 ✓', 'ok');
    }
    return result;
  }
  /* ---------------- 图片导入 ---------------- */

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(gif|png|jpe?g|webp|avif|svg)$/i.test(file.name || '');
  }

  async function uploadFiles(fileList, target) {
    const mode = target && target.type ? target.type : (target === 'bg' ? 'bg' : 'img');
    const optionIndex = target && target.type === 'option' ? target.index : null;
    const files = Array.prototype.slice.call(fileList || []).filter(isImageFile);
    if (!files.length) {
      onToast('只支持图片文件（GIF / PNG / JPG / WebP）', 'error');
      return;
    }

    const node = getNode();
    let first = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        await BS.storage.saveAsset(file.name, file, file.type);
      } catch (err) {
        onToast('图片保存失败：' + (err && err.message ? err.message : err), 'error');
        continue;
      }
      if (story.assets.indexOf(file.name) < 0) story.assets.push(file.name);
      if (!first) first = file.name;
    }

    if (!first) return;

    if (node) {
      if (mode === 'bg') {
        node.bg = first;
        node.bgInherit = true;
      } else if (mode === 'option') {
        if (node.options[optionIndex]) node.options[optionIndex].img = first;
      } else {
        node.img = first;
        node.imgInherit = true;
      }
    }

    if (callbacks.refreshAssets) await callbacks.refreshAssets();
    await reloadAssets();
    if (mode === 'option') closeImagePicker();
    renderList();
    renderProps();
    renderStage();
    markDirty();

    const kind = mode === 'bg' ? '背景' : (mode === 'option' ? '选项图片' : '配图');
    onToast(
      node
        ? '已导入 ' + files.length + ' 张图片，并把「' + first + '」设为当前节点的' + kind
        : '已导入 ' + files.length + ' 张图片（选中节点后再点缩略图绑定）',
      'ok'
    );
  }

  /* ---------------- 导入 / 导出 ---------------- */

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
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

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function dateStamp() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  async function exportStory(embedImages) {
    try {
      const payload = {
        type: 'birthday-story',
        version: 2,
        exportedAt: new Date().toISOString(),
        story: story,
        images: {}
      };

      if (embedImages) {
        const used = BS.model.collectAssetNames(story);
        const records = await BS.storage.listAssets();
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          if (used.indexOf(rec.name) < 0) continue;
          payload.images[rec.name] = await blobToDataUrl(rec.blob);
        }
        if (!Object.keys(payload.images).length) {
          onToast('还没有导入图片，这次只导出配置', 'ok');
        }
      }

      const suffix = embedImages ? '完整包' : '配置';
      downloadJson(payload, '重生小猫-' + suffix + '-' + dateStamp() + '.json');
      onToast('已导出' + suffix, 'ok');
    } catch (err) {
      console.error(err);
      onToast('导出失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function importJsonFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rawStory = data && data.story ? data.story : data;
      const images = (data && data.images) || {};
      const names = Object.keys(images);

      for (let i = 0; i < names.length; i++) {
        const value = images[names[i]];
        if (typeof value !== 'string' || value.indexOf('data:') !== 0) continue;
        const blob = dataUrlToBlob(value);
        await BS.storage.saveAsset(names[i], blob, blob.type);
      }

      const nextStory = BS.model.normalize(rawStory);
      if (callbacks.onReplaceStory) callbacks.onReplaceStory(nextStory);
      else story = nextStory;

      selectedId = story.startNodeId || Object.keys(story.nodes)[0] || null;
      if (callbacks.refreshAssets) await callbacks.refreshAssets();
      await reloadAssets();
      refresh();
      markDirty();
      onToast(
        '导入成功：' + Object.keys(story.nodes).length + ' 个节点' +
        (names.length ? '，' + names.length + ' 张图片' : ''),
        'ok'
      );
    } catch (err) {
      console.error(err);
      onToast('导入失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  /* ---------------- 对外接口 ---------------- */

  BS.editor = {
    init: init,
    refresh: refresh,
    select: select,
    validateNow: validateNow,
    reloadAssets: reloadAssets,
    setStory: function (nextStory) {
      story = nextStory;
      selectedId = story.startNodeId || Object.keys(story.nodes)[0] || null;
      refresh();
      reloadAssets();
    },
    getStory: function () { return story; }
  };
})();
