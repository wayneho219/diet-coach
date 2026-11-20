// 共用 UI 小工具（載入時不碰 DOM）
(function (root) {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(Number(n) || 0).toLocaleString('zh-TW');
  const WEEK = '日一二三四五六';
  const MEAL_TYPES = ['早餐', '午餐', '晚餐', '點心'];
  const MEAL_EMOJI = { 早餐: '🍳', 午餐: '🍱', 晚餐: '🍲', 點心: '🍪' };

  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'value') e.value = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }

  function svg(viewBox, label) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'chart'); s.setAttribute('viewBox', viewBox);
    s.setAttribute('role', 'img'); s.setAttribute('aria-label', label);
    return s;
  }

  // 圓環進度：ratio 0–1（超過的部分截掉），從 12 點鐘方向順時針畫；center 放在環中間
  function ring(ratio, { size = 72, cls = '', stroke = 8 } = {}, ...center) {
    const sw = stroke * 100 / size, r = 50 - sw / 2, c = 2 * Math.PI * r;
    const r01 = Math.min(1, Math.max(0, Number(ratio) || 0));
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('aria-hidden', 'true');
    const circle = (klass, extra = {}) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const attrs = { cx: 50, cy: 50, r, class: klass, 'stroke-width': sw, ...extra };
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      return e;
    };
    s.append(circle('ring-track'),
      circle('ring-fill ' + cls, { 'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - r01), 'stroke-linecap': 'round', transform: 'rotate(-90 50 50)' }));
    return el('div', { class: 'ring', style: `width:${size}px;height:${size}px` }, s, el('div', { class: 'ring-center' }, center));
  }

  let toastTimer;
  function toast(text, isError = false) {
    const t = $('toast');
    clearTimeout(toastTimer);
    t.textContent = text;
    t.classList.toggle('err', isError);
    t.hidden = false;
    t.onclick = () => { t.hidden = true; };
    if (!isError) toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  // 下滑關閉：內容捲在最上面時往下拉超過 80px 就關掉，不到就彈回；先往上捲就當成一般捲動
  let dragBound = false;
  function bindDrag() {
    if (dragBound) return;
    dragBound = true;
    const s = $('sheet');
    let y0 = null, dy = 0, handle = false;
    const reset = () => { y0 = null; handle = false; s.classList.remove('dragging'); s.style.transform = ''; };
    // 從標題列（data-drag）拉，不管內容捲到哪都能關；其他地方要捲到最上面才算
    s.addEventListener('touchstart', e => {
      handle = !!e.target.closest?.('[data-drag]');
      y0 = handle || s.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0;
    }, { passive: true });
    s.addEventListener('touchmove', e => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy < 0 || (!handle && s.scrollTop > 0)) return reset();
      e.preventDefault();
      s.classList.add('dragging');
      s.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    s.addEventListener('touchend', () => {
      if (y0 == null || dy <= 80) return reset();
      // 確定要關：從手指的位置繼續往下滑出去，滑完才真的關掉
      y0 = null;
      s.classList.remove('dragging');
      s.style.transform = 'translateY(100%)';
      $('sheet-backdrop').classList.add('fading');
      setTimeout(() => {
        if (s.style.transform !== 'translateY(100%)') return;   // 這段時間內又開了新的視窗
        sheet.close();
        s.style.transform = '';
        $('sheet-backdrop').classList.remove('fading');
      }, 200);
    });
    s.addEventListener('touchcancel', reset);
  }

  let onCloseCb = null;
  const sheet = {
    open(node, { onClose } = {}) {
      bindDrag();
      if (sheet.isOpen) sheet.close();
      $('sheet').style.transform = '';
      $('sheet-backdrop').classList.remove('fading');
      onCloseCb = onClose || null;
      $('sheet').replaceChildren(el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }), node);
      $('sheet').hidden = false;
      $('sheet-backdrop').hidden = false;
      document.body.classList.add('locked');
      $('sheet').scrollTop = 0;
    },
    close() {
      if (!sheet.isOpen) return;
      $('sheet').hidden = true;
      $('sheet-backdrop').hidden = true;
      document.body.classList.remove('locked');
      const cb = onCloseCb; onCloseCb = null;
      cb?.();
      $('sheet').replaceChildren();
    },
    get isOpen() { return !!$('sheet') && !$('sheet').hidden; },
  };

  const sticker = (emoji, size = 'md') => el('span', { class: `sticker sticker-${size}`, 'aria-hidden': 'true' }, emoji || '🍽️');

  function confirmTap(button, onConfirm, label = '再點一次確定') {
    const original = button.textContent;
    let armed = false, timer;
    // 確認後也要還原：畫面沒關掉的地方（例如聊天的清除）按鈕才會變回原本的字
    const disarm = () => { clearTimeout(timer); armed = false; button.textContent = original; button.classList.remove('armed'); };
    button.addEventListener('click', () => {
      if (armed) { disarm(); return onConfirm(); }
      armed = true; button.textContent = label; button.classList.add('armed');
      timer = setTimeout(disarm, 3000);
    });
    return button;
  }

  function dayLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `${m}月${d}日 週${WEEK[new Date(y, m - 1, d).getDay()]}`;
  }

  const typeChips = (selected, onPick) => el('div', { class: 'chips', role: 'group', 'aria-label': '餐別' },
    MEAL_TYPES.map(t => el('button', { class: 'chip', 'aria-pressed': String(t === selected), onclick: () => onPick(t) }, `${MEAL_EMOJI[t]} ${t}`)));

  const nutriCell = (icon, label, value) => el('div', { class: 'nutri-cell' },
    el('span', { class: 'nutri-icon', 'aria-hidden': 'true' }, icon), el('b', { class: 'nutri-val num' }, value), el('span', { class: 'nutri-label' }, label));
  const nutriRow = t => el('div', { class: 'nutri' },
    nutriCell('🔥', '大卡', fmt(t.kcal)), nutriCell('🥚', '蛋白質', fmt(t.protein) + 'g'),
    nutriCell('🍙', '碳水', fmt(t.carbs) + 'g'), nutriCell('🥑', '脂肪', fmt(t.fat) + 'g'));

  // 纖維與鈉：有給 targets 就顯示目標，鈉超過上限用警告色
  function microLine(t, targets) {
    const over = targets && t.sodium > targets.sodium;
    return el('p', { class: 'hint' },
      `纖維 ${fmt(t.fiber)}${targets ? '/' + targets.fiber : ''} g・`,
      el('span', { class: over ? 'over-text' : null }, `鈉 ${fmt(t.sodium)}${targets ? '/' + fmt(targets.sodium) : ''} mg`));
  }

  // 教練回答的簡單排版：**粗體** 變重點色、「- 」開頭變條列、空行分段。全部走 textContent，不吃 HTML
  function rich(text) {
    const out = [];
    let list = null;
    for (const line of String(text ?? '').split('\n')) {
      const t = line.trim().replace(/^#+\s*/, '');
      if (!t) { list = null; if (out.length) out.push(el('div', { class: 'rich-gap' })); continue; }
      const bullet = /^[-•]\s+/.test(t);
      const inline = t.replace(/^[-•]\s+/, '').split(/\*\*(.+?)\*\*/g).map((p, i) => i % 2 ? el('strong', { class: 'hl' }, p) : p).filter(Boolean);
      if (bullet) { if (!list) out.push(list = el('ul', { class: 'rich-list' })); list.append(el('li', {}, inline)); }
      else { list = null; out.push(el('p', { class: 'rich-p' }, inline)); }
    }
    return out;
  }

  // 轉成 JPEG 並把長邊縮到 1600px（處理 HEIC 和超大檔）。失敗就用原檔
  async function toJpeg(file) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', 0.85));
    } catch { return file; }
  }

  const UI = { $, el, svg, fmt, toast, sheet, sticker, confirmTap, dayLabel, MEAL_TYPES, MEAL_EMOJI, typeChips, nutriRow, microLine, ring, toJpeg, rich };
  root.UI = UI;
  if (typeof module !== 'undefined') module.exports = UI;
})(typeof window !== 'undefined' ? window : globalThis);
