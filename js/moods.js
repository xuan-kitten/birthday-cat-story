/* ==========================================================
 * moods.js —— 氛围（mood）定义与切换
 * 真正换肤靠 CSS 里 .stage[data-mood="x"] .mood-layer[data-mood="x"]{opacity:1}
 * 这里只负责改写宿主元素上的 data-mood
 * ========================================================== */
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  const LIST = [
    { id: 'mystery', label: '悬疑', desc: '深夜蓝 / 重暗角 / 冷色阴影' },
    { id: 'tracking', label: '跟踪', desc: '深灰蓝 / 高对比 / 轻噪点' },
    { id: 'daily', label: '日常', desc: '米白暖色 / 柔和' },
    { id: 'warm', label: '温暖', desc: '暖橘金 / 烛光光晕' }
  ];

  function isMood(id) {
    return LIST.some(function (m) { return m.id === id; });
  }

  function labelOf(id) {
    for (let i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i].label;
    return id || '';
  }

  /**
   * 把 mood 应用到舞台元素（改 data-mood → CSS 交叉淡入）
   * @param {HTMLElement} el   .stage 或 .ed-stage
   * @param {string} mood
   */
  function apply(el, mood) {
    if (!el) return;
    const next = isMood(mood) ? mood : 'daily';
    if (el.dataset.mood !== next) el.dataset.mood = next;
  }

  /** 结局节点强制 warm */
  function moodForNode(node) {
    if (!node) return 'daily';
    if (node.type === 'end' || node.end) return 'warm';
    return isMood(node.mood) ? node.mood : 'daily';
  }

  BS.moods = {
    list: LIST,
    ids: LIST.map(function (m) { return m.id; }),
    isMood: isMood,
    label: labelOf,
    apply: apply,
    moodForNode: moodForNode
  };
})();
