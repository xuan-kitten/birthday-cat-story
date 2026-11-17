/* ==========================================================
 * player.js —— 播放模式
 *  - 打字机：逐字显示，点击立刻补全
 *  - text 节点点击空白按 next 推进
 *  - choice 显示分支按钮，select 显示选角按钮
 *  - end 显示「再玩一次」
 *  - 图片按节点保存的 transform 渲染，双缓冲交叉淡入
 * ========================================================== */
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  const SPEED = 34;         // 每字基础毫秒
  const PAUSE_COMMA = 110;  // 逗号顿一下
  const PAUSE_STOP = 230;   // 句末停一下

  let els = null;
  let story = null;
  let vars = {};
  let current = null;
  let typing = null;        // { timer, chars, i, full }
  let activeLayer = 'a';
  let currentImg = null;
  let lastResolved = null;  // 用于「沿用上一张」
  let bgLayer = 'a';
  let currentBg = null;
  let lastBg = null;
  let selectState = null;   // 选角轮播状态
  const portraitCache = new Map();  // 头像文件探测缓存
  const NPC_PORTRAITS = {
    '小白': ['opt/xiaobai.webp', '小白.png', '小白.jpg', '小白.jpeg', '小白.gif', 'xiaobai.png', 'xiaobai.jpg'],
    '小黑': ['opt/xiaohei.webp', '小黑.png', '小黑.jpg', '小黑.jpeg', '小黑.gif', 'xiaohei.png', 'xiaohei.jpg']
  };
  let getUrl = function (name) { return 'assets/' + encodeURIComponent(name); };

  function init(elements, options) {
    els = elements;
    if (options && options.getImageUrl) getUrl = options.getImageUrl;
    els.stage.addEventListener('click', onStageClick);
    window.addEventListener('resize', relayout);
    document.addEventListener('keydown', onKeyDown);
  }

  /* ---------------- 流程控制 ---------------- */

  function start(nextStory, opts) {
    story = nextStory;
    vars = {};
    lastResolved = null;
    currentImg = null;
    lastBg = null;
    currentBg = null;
    const nodeId = (opts && opts.nodeId) || story.startNodeId;
    go(nodeId);
  }

  function go(nodeId) {
    const node = story && story.nodes ? story.nodes[nodeId] : null;
    if (!node) {
      stopTyping();
      current = null;
      els.text.textContent = '节点「' + nodeId + '」不存在，请回到编辑模式检查。';
      els.choices.innerHTML = '';
      els.hint.textContent = '';
      return;
    }

    stopTyping();
    current = node;

    /* 氛围：结局强制 warm */
    const mood = BS.moods.moodForNode(node);
    BS.moods.apply(els.stage, mood);

    const isEnding = node.type === 'end' || !!node.end;
    els.stage.classList.toggle('is-ending', isEnding);
    els.stage.classList.toggle('is-select', node.type === 'select');
    if (els.selectChoices) els.selectChoices.innerHTML = '';

    /* 背景照片 */
    const bgName = resolveBg(node, mood);
    if (bgName) showBg(bgName, bgDimOf(mood));
    else hideBg();

    /* 图片 */
    const imgName = resolveImage(node);
    if (imgName) showImage(imgName, node.imgTransform);
    else hideImages();

    /* 说话人立绘 */
    renderPortrait(node);

    /* 文字 */
    els.choices.innerHTML = '';
    els.choices.className = 'choices';
    if (els.selectChoices) els.selectChoices.className = 'select-choices';
    selectState = null;
    els.hint.textContent = '';
    els.hint.classList.remove('is-pulse');

    typeText(BS.model.renderText(node.text, vars));
  }

  function resolveImage(node) {
    if (node.img) {
      lastResolved = node.img;
      return node.img;
    }
    if (node.imgInherit === false) return null;
    return lastResolved;
  }

  /** 背景优先级：本节点指定 > 沿用上一节点 > 当前氛围默认 */
  function resolveBg(node, mood) {
    if (node.bg) {
      lastBg = node.bg;
      return node.bg;
    }
    if (node.bgInherit !== false && lastBg) return lastBg;
    // 明确使用氛围默认（或没有可沿用的图）时，断开继承链
    lastBg = null;
    const preset = story.bgByMood && story.bgByMood[mood];
    return preset && preset.src ? preset.src : null;
  }

  function bgDimOf(mood) {
    const preset = story.bgByMood && story.bgByMood[mood];
    const dim = preset && typeof preset.dim === 'number' ? preset.dim : 0.15;
    return Math.max(0, Math.min(0.8, dim));
  }

  function bgLayerFor(key) {
    return key === 'a' ? els.bgA : els.bgB;
  }

  function showBg(name, dim) {
    if (name === currentBg) {
      els.bgA.style.setProperty('--bg-dim', dim);
      els.bgB.style.setProperty('--bg-dim', dim);
      return;
    }
    currentBg = name;
    const prevKey = bgLayer;
    const nextKey = prevKey === 'a' ? 'b' : 'a';
    const layer = bgLayerFor(nextKey);
    const url = getUrl(name);

    // 先加载，加载成功才淡入；失败就保持渐变底，不会出现黑屏
    const probe = new Image();
    probe.onload = function () {
      if (currentBg !== name) return;
      layer.style.backgroundImage = 'url("' + url + '")';
      layer.style.setProperty('--bg-dim', dim);
      requestAnimationFrame(function () {
        layer.classList.add('is-on');
        bgLayerFor(prevKey).classList.remove('is-on');
      });
      bgLayer = nextKey;
    };
    probe.onerror = function () {
      if (currentBg !== name) return;
      layer.classList.remove('is-on');
      bgLayerFor(prevKey).classList.remove('is-on');
    };
    probe.src = url;
  }

  function hideBg() {
    currentBg = null;
    els.bgA.classList.remove('is-on');
    els.bgB.classList.remove('is-on');
  }

  function restart() { start(story); }

  function previewFrom(nodeId) { start(story, { nodeId: nodeId }); }

  /* ---------------- 打字机 ---------------- */

  function typeText(full) {
    els.text.textContent = '';
    els.text.classList.add('is-typing');
    const chars = Array.from(full || '');
    if (!chars.length) {
      finishTyping();
      return;
    }
    const state = { chars: chars, i: 0, timer: null, full: full };
    typing = state;

    function step() {
      state.i += 1;
      els.text.textContent = state.chars.slice(0, state.i).join('');
      if (state.i >= state.chars.length) {
        typing = null;
        els.text.classList.remove('is-typing');
        showControls();
        return;
      }
      const ch = state.chars[state.i - 1];
      let delay = SPEED;
      if ('，,、；;'.indexOf(ch) >= 0) delay += PAUSE_COMMA;
      if ('。！？…!?'.indexOf(ch) >= 0) delay += PAUSE_STOP;
      state.timer = setTimeout(step, delay);
    }

    state.timer = setTimeout(step, SPEED);
  }

  function stopTyping() {
    if (typing && typing.timer) clearTimeout(typing.timer);
    typing = null;
    if (els) els.text.classList.remove('is-typing');
  }

  function finishTyping() {
    if (!typing) return;
    const full = typing.full || '';
    if (typing.timer) clearTimeout(typing.timer);
    typing = null;
    els.text.textContent = full;
    els.text.classList.remove('is-typing');
    showControls();
  }

  /* ---------------- 交互 ---------------- */

  function onStageClick(event) {
    if (event.target.closest('button') || event.target.closest('.btn')) return;
    if (!current) return;

    if (typing) {
      finishTyping();
      return;
    }

    if (current.type === 'text' && current.next) go(current.next);
  }

  function onKeyDown(event) {
    if (document.body.dataset.mode === 'edit') return;
    if (!current) return;
    const key = event.key;
    const isSelect = current.type === 'select' && !!selectState;

    if (key === 'ArrowLeft' && isSelect) {
      event.preventDefault();
      carouselMove(-1);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      if (typing) { finishTyping(); return; }
      if (isSelect) { carouselMove(1); return; }
      if (current.type === 'text' && current.next) go(current.next);
      return;
    }
    if (key === ' ' || key === 'Enter') {
      event.preventDefault();
      if (typing) { finishTyping(); return; }
      if (isSelect) { carouselConfirm(); return; }
      if (current.type === 'text' && current.next) go(current.next);
    }
  }

  /* ---------------- 选项 / 选角 / 结局 ---------------- */

  function showControls() {
    if (!current) return;
    els.choices.innerHTML = '';
    els.choices.className = 'choices';
    els.hint.classList.remove('is-pulse');

    if (current.type === 'choice') {
      renderChoices();
    } else if (current.type === 'select') {
      renderSelect();
    } else if (current.type === 'end' || current.end) {
      renderEnding();
    } else if (current.type === 'text') {
      if (current.next) {
        els.hint.textContent = '点击空白处继续 ›';
        els.hint.classList.add('is-pulse');
      } else {
        els.hint.textContent = '（这个节点还没有设置下一跳）';
      }
    }
  }

  function makeButton(label, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className || 'choice-btn';
    btn.textContent = label;
    return btn;
  }

  function renderChoices() {
    (current.choices || []).forEach(function (choice) {
      const btn = makeButton(choice.text || '（未命名选项）');
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (choice.target) go(choice.target);
      });
      els.choices.appendChild(btn);
    });
    els.hint.textContent = '选一个 ›';
  }

  function renderSelect() {
    const host = els.selectChoices || els.choices;
    host.className = 'select-choices';
    host.innerHTML = '';

    const options = (current.options || []).filter(function (o) {
      return o && (o.img || o.label || o.value);
    });
    if (!options.length) {
      els.hint.textContent = '还没有可选的猫猫';
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'carousel';

    const main = document.createElement('div');
    main.className = 'carousel-main';

    const prevBtn = makeArrow('‹', '上一只');
    const nextBtn = makeArrow('›', '下一只');

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'carousel-card';

    const frame = document.createElement('span');
    frame.className = 'carousel-frame';

    const img = document.createElement('img');
    img.className = 'carousel-img';
    img.alt = '';
    img.decoding = 'async';
    img.hidden = true;

    const fallback = document.createElement('span');
    fallback.className = 'carousel-fallback';

    const nameEl = document.createElement('span');
    nameEl.className = 'carousel-name';

    frame.appendChild(img);
    frame.appendChild(fallback);
    card.appendChild(frame);
    card.appendChild(nameEl);

    main.appendChild(prevBtn);
    main.appendChild(card);
    main.appendChild(nextBtn);

    const footer = document.createElement('div');
    footer.className = 'carousel-footer';

    const dots = document.createElement('div');
    dots.className = 'carousel-dots';

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-primary carousel-confirm';

    const dotEls = options.map(function (option, index) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel-dot';
      dot.setAttribute('aria-label', '第 ' + (index + 1) + ' 只');
      dot.addEventListener('click', function (event) {
        event.stopPropagation();
        const from = selectState ? selectState.index : 0;
        carouselSet(index, index >= from ? 1 : -1);
      });
      dots.appendChild(dot);
      return dot;
    });

    footer.appendChild(dots);
    footer.appendChild(confirm);
    wrap.appendChild(main);
    wrap.appendChild(footer);
    host.appendChild(wrap);

    selectState = {
      index: 0,
      options: options,
      img: img,
      fallback: fallback,
      frame: frame,
      nameEl: nameEl,
      confirm: confirm,
      dots: dotEls,
      card: card
    };

    prevBtn.addEventListener('click', function (event) { event.stopPropagation(); carouselMove(-1); });
    nextBtn.addEventListener('click', function (event) { event.stopPropagation(); carouselMove(1); });
    card.addEventListener('click', function (event) {
      event.stopPropagation();
      if (swiped) return;
      carouselConfirm();
    });
    confirm.addEventListener('click', function (event) { event.stopPropagation(); carouselConfirm(); });
    img.addEventListener('error', function () {
      img.hidden = true;
      if (!selectState) return;
      selectState.frame.classList.add('is-missing');
      selectState.fallback.textContent = selectState.nameEl.textContent;
    });

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let swiped = false;
    main.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.carousel-arrow')) return;
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
    });
    main.addEventListener('pointerup', function (event) {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) {
        swiped = true;
        setTimeout(function () { swiped = false; }, 400);
        carouselMove(dx < 0 ? 1 : -1);
      }
    });
    main.addEventListener('pointercancel', function () { tracking = false; });

    carouselSet(0, 0);
    els.hint.textContent = '左右切换，点猫猫或按钮确认 ›';
  }
  function makeArrow(text, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'carousel-arrow';
    btn.textContent = text;
    btn.setAttribute('aria-label', label);
    return btn;
  }

  function carouselSet(index, dir) {
    if (!selectState) return;
    const total = selectState.options.length;
    if (!total) return;

    const nextIndex = ((index % total) + total) % total;
    selectState.index = nextIndex;
    const option = selectState.options[nextIndex];
    const label = option.label || option.value || '（未命名）';

    selectState.nameEl.textContent = label;
    selectState.confirm.textContent = '就选「' + label + '」';
    selectState.frame.classList.remove('is-missing');
    selectState.fallback.textContent = '';

    if (option.img) {
      const url = getUrl(option.img);
      if (selectState.img.getAttribute('src') !== url) {
        selectState.img.hidden = false;
        selectState.img.src = url;
      } else {
        selectState.img.hidden = false;
      }
    } else {
      selectState.img.hidden = true;
      selectState.img.removeAttribute('src');
      selectState.frame.classList.add('is-missing');
      selectState.fallback.textContent = label;
    }

    selectState.dots.forEach(function (dot, i) {
      dot.classList.toggle('is-active', i === nextIndex);
      dot.setAttribute('aria-current', i === nextIndex ? 'true' : 'false');
    });

    if (dir && selectState.card.animate) {
      selectState.card.animate(
        [
          { opacity: 0, transform: 'translateX(' + (dir > 0 ? 34 : -34) + 'px)' },
          { opacity: 1, transform: 'translateX(0)' }
        ],
        { duration: 240, easing: 'ease-out' }
      );
    }
  }

  function carouselMove(delta) {
    if (!selectState) return;
    carouselSet(selectState.index + delta, delta);
  }

  function carouselConfirm() {
    if (!selectState) return;
    const option = selectState.options[selectState.index];
    if (!option) return;
    const varName = current.var || 'playerBreed';
    vars[varName] = option.value || option.label || '';
    vars.playerPortrait = option.img || '';
    if (current.next) go(current.next);
  }

  /* ---------------- 说话人立绘 ---------------- */

  function hidePortrait(el) {
    if (!el) return;
    el.hidden = true;
    el.classList.remove('has-img');
    const img = el.querySelector('img');
    const fallback = el.querySelector('.portrait-fallback');
    if (img) {
      img.hidden = true;
      img.removeAttribute('src');
    }
    if (fallback) fallback.textContent = '';
  }

  function playerPortraitName() {
    if (vars.playerPortrait) return vars.playerPortrait;
    const start = story.nodes && story.nodes[story.startNodeId];
    if (start && start.options) {
      let found = '';
      if (vars.playerBreed) {
        start.options.forEach(function (option) {
          if (!found && option.img &&
              (option.value === vars.playerBreed || option.label === vars.playerBreed)) {
            found = option.img;
          }
        });
      }
      if (!found) {
        start.options.forEach(function (option) {
          if (!found && option.img) found = option.img;
        });
      }
      return found;
    }
    return '';
  }

  function showPortrait(el, candidates, label) {
    if (!el) return;
    const img = el.querySelector('img');
    const fallback = el.querySelector('.portrait-fallback');
    if (!img) return;

    el.hidden = false;
    el.classList.remove('has-img');
    img.hidden = true;
    img.removeAttribute('src');
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = label;
    }

    function showImageFile(name) {
      img.onload = function () {
        img.hidden = false;
        el.classList.add('has-img');
        if (fallback) fallback.hidden = true;
      };
      img.onerror = function () {
        img.hidden = true;
        el.classList.remove('has-img');
        if (fallback) {
          fallback.hidden = false;
          fallback.textContent = label;
        }
      };
      img.src = getUrl(name);
    }

    let index = 0;
    function tryNext() {
      if (index >= candidates.length) return;
      const name = candidates[index++];
      if (!name) return tryNext();
      const state = portraitCache.get(name);
      if (state === 'bad') return tryNext();
      if (state === 'ok') return showImageFile(name);

      const probe = new Image();
      probe.onload = function () {
        portraitCache.set(name, 'ok');
        showImageFile(name);
      };
      probe.onerror = function () {
        portraitCache.set(name, 'bad');
        tryNext();
      };
      probe.src = getUrl(name);
    }

    tryNext();
  }

  function renderPortrait(node) {
    hidePortrait(els.portraitLeft);
    hidePortrait(els.portraitRight);

    const speaker = node.speaker || '';
    if (!speaker) return;

    if (speaker === 'player') {
      const name = playerPortraitName();
      if (name) showPortrait(els.portraitRight, [name], '我');
      return;
    }

    const candidates = NPC_PORTRAITS[speaker];
    if (candidates && candidates.length) {
      showPortrait(els.portraitLeft, candidates, speaker);
    }
  }

  function renderEnding() {
    const btn = makeButton('↺ 再玩一次', 'btn btn-primary ending-btn');
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      restart();
    });
    els.choices.appendChild(btn);
    els.hint.textContent = '— 完 —';
  }

  /* ---------------- 图片渲染 ---------------- */

  function layerFor(key) {
    return key === 'a' ? els.imgA : els.imgB;
  }

  function showImage(name, transform) {
    if (name === currentImg) {
      // 同一张图：只更新位置/缩放，避免 GIF 从头播放
      els.stage.querySelectorAll('.img-holder').forEach(function (holder) {
        applyTransform(holder, transform);
      });
      return;
    }

    currentImg = name;
    const prevKey = activeLayer;
    const nextKey = prevKey === 'a' ? 'b' : 'a';
    const layer = layerFor(nextKey);
    layer.innerHTML = '';

    const holder = document.createElement('div');
    holder.className = 'img-holder';

    const img = document.createElement('img');
    img.alt = name;
    img.decoding = 'async';
    img.addEventListener('error', function () {
      // 没有这张图就不显示占位框，直接露出背景
      if (currentImg === name) currentImg = null;
      layer.classList.remove('is-on');
      layer.innerHTML = '';
    });

    holder.appendChild(img);
    layer.appendChild(holder);
    img.src = getUrl(name);
    applyTransform(holder, transform);

    requestAnimationFrame(function () {
      layer.classList.add('is-on');
      layerFor(prevKey).classList.remove('is-on');
    });
    activeLayer = nextKey;
  }

  function hideImages() {
    currentImg = null;
    els.imgA.classList.remove('is-on');
    els.imgB.classList.remove('is-on');
  }

  function applyTransform(holder, transform) {
    if (!holder) return;
    const t = Object.assign({ x: 0, y: 0, scale: 1 }, transform || {});
    const rect = els.stage.getBoundingClientRect();
    holder.style.transform =
      'translate(' + (t.x * rect.width).toFixed(1) + 'px,' +
      (t.y * rect.height).toFixed(1) + 'px) scale(' + t.scale + ')';
  }

  function relayout() {
    if (!current) return;
    els.stage.querySelectorAll('.img-holder').forEach(function (holder) {
      applyTransform(holder, current.imgTransform);
    });
  }

  BS.player = {
    init: init,
    start: start,
    restart: restart,
    previewFrom: previewFrom,
    go: go,
    getCurrent: function () { return current; },
    getVars: function () { return vars; }
  };
})();
