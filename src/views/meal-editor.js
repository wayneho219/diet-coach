// 品項清單編輯器：記一餐的草稿和詳細頁共用
(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const NUT = [['kcal', '大卡'], ['protein', '蛋白質 g'], ['carbs', '碳水 g'], ['fat', '脂肪 g'], ['fiber', '纖維 g'], ['sodium', '鈉 mg']];

  // takenTypes：這一天其他餐已經用掉的餐別（詳細頁不能切過去，否則兩筆合併後 id 會不見）
  // noType：加品項時餐別跟著原本那一餐，不顯示餐別
  function render(container, meal, { onChange, mode = 'draft', takenTypes = [], noType = false } = {}) {
    const { el, sticker, fmt, typeChips, nutriRow, toast } = root.UI;
    const L = root.Logic, Coach = root.Coach;
    const seq = container._meSeq = (container._meSeq || 0) + 1;
    const live = () => container._meSeq === seq && container.isConnected;
    let m = meal, openIdx = -1, adding = false, busy = false, newName = '';
    const openGroups = new Set();

    const emit = next => { m = next; onChange?.(m); setTimeout(() => { if (live()) draw(); }, 0); };

    function itemRow(it, i, nested = false) {
      const isOpen = openIdx === i;
      const row = el('li', { class: 'item-row' + (nested ? ' nested' : '') },
        el('button', { class: 'item-main', 'aria-expanded': String(isOpen), onclick: () => { openIdx = isOpen ? -1 : i; draw(); } },
          sticker(it.emoji, 'sm'),
          el('span', {}, it.name, el('small', {}, `每份 ${fmt(it.kcal)} 大卡${it.portion ? '・' + it.portion : ''}`))),
        el('div', { class: 'stepper' },
          el('button', { 'aria-label': `${it.name} 減半份`, onclick: () => { if (it.qty <= 0.5) { if (i === openIdx) openIdx = -1; else if (i < openIdx) openIdx--; } emit(L.setQty(m, i, it.qty - 0.5)); } }, '−'),
          el('span', { class: 'qty' }, String(it.qty)),
          el('button', { 'aria-label': `${it.name} 加半份`, onclick: () => emit(L.setQty(m, i, it.qty + 0.5)) }, '＋')),
        el('span', { class: 'num' }, fmt(it.kcal * it.qty)));
      if (isOpen) row.append(el('div', { class: 'item-edit' },
        el('div', { class: 'grid2' },
          el('label', { class: 'field' }, '名稱', el('input', { type: 'text', value: it.name, onchange: e => { const v = e.target.value.trim(); if (v) emit(L.updateItem(m, i, { name: v })); } })),
          el('label', { class: 'field' }, 'Emoji', el('input', { type: 'text', value: it.emoji, onchange: e => emit(L.updateItem(m, i, { emoji: e.target.value.trim() || '🍽️' })) }))),
        el('div', { class: 'grid2' },
          el('label', { class: 'field' }, '店名', el('input', { type: 'text', maxlength: '30', value: L.itemStore(m, it), onchange: e => { const v = e.target.value.trim(); if (it.group) openGroups.add(`${v}|${it.group}`); emit(L.updateItem(m, i, { store: v })); } })),
          el('label', { class: 'field' }, '組合', el('input', { type: 'text', maxlength: '30', value: it.group || '', placeholder: '單點留白', onchange: e => { const v = e.target.value.trim(); if (v) openGroups.add(`${L.itemStore(m, it)}|${v}`); emit(L.updateItem(m, i, { group: v })); } }))),
        el('div', { class: 'nutri-inputs' }, NUT.map(([k, label]) =>
          el('label', { class: 'field' }, label, el('input', { type: 'number', inputmode: 'decimal', min: '0', max: k === 'sodium' ? '10000' : '3000', value: String(it[k] ?? 0), onchange: e => emit(L.updateItem(m, i, { [k]: clamp(e.target.value, 0, k === 'sodium' ? 10000 : 3000) })) }))))));
      return row;
    }

    // 組合（便當）：一列顯示加總，點一下展開菜色
    function groupRow(e, store) {
      const key = store + '|' + e.group, isOpen = openGroups.has(key);
      const row = el('li', { class: 'item-row group-row' },
        el('button', { class: 'item-main', 'aria-expanded': String(isOpen), onclick: () => { if (isOpen) openGroups.delete(key); else openGroups.add(key); draw(); } },
          sticker('🍱', 'sm'),
          el('span', {}, e.group, el('small', {}, `${e.items.length} 道菜`))),
        el('span', { class: 'group-caret', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸'),
        el('span', { class: 'num' }, fmt(e.kcal)));
      if (isOpen) row.append(el('ul', { class: 'items group-items' }, e.items.map(x => itemRow(x.it, x.i, true))));
      return row;
    }

    // 新增的品項沿用這一餐最後一個品項的店名
    const lastStore = () => m.items.length ? L.itemStore(m, m.items[m.items.length - 1]) : (m.store || '');

    async function estimateNew() {
      const name = newName.trim();
      if (!name) return toast('先寫品項名稱。', true);
      busy = true; draw();
      try {
        const store = lastStore();
        const item = await Coach.estimateItem(name, store);
        if (!live()) return;
        adding = false; newName = '';
        emit(L.addItem(m, { ...item, store, time: new Date().toTimeString().slice(0, 5) }));
      } catch (e) {
        if (e.code !== 'cancelled') toast(e.message, true);
      } finally { busy = false; if (live()) draw(); }
    }
    function manualNew() {
      const name = newName.trim();
      if (!name) return toast('先寫品項名稱。', true);
      adding = false; newName = '';
      const store = lastStore();
      const next = L.addItem(m, { emoji: '🍽️', name, qty: 1, kcal: 0, protein: 0, carbs: 0, fat: 0, store, time: new Date().toTimeString().slice(0, 5) });
      openIdx = next.items.findIndex(it => it.name === name && L.itemStore(next, it) === store && !it.group);
      emit(next);
    }

    function addForm() {
      if (busy) return el('p', { class: 'thinking' }, `${root.Profile.text.coachWord}估算中…`);
      return el('div', { class: 'card' },
        el('label', { class: 'field' }, '新品項名稱', el('input', { type: 'text', value: newName, placeholder: '例如：炙燒起司鮭魚', oninput: e => { newName = e.target.value; } })),
        el('div', { class: 'row' },
          Coach?.available ? el('button', { class: 'btn btn-soft', onclick: estimateNew }, `讓${root.Profile.text.coachWord}估`) : null,
          el('button', { class: 'btn btn-ghost', onclick: manualNew }, '手動填數字'),
          el('button', { class: 'btn btn-ghost', onclick: () => { adding = false; newName = ''; draw(); } }, '取消')));
    }

    function draw() {
      if (openIdx >= m.items.length) openIdx = -1;
      const sections = L.groupItems(m), multi = sections.length > 1;
      const shop = sections[0]?.store ?? (m.store || '');
      const list = sections.flatMap(sec => [
        multi ? el('div', { class: 'store-head' }, el('span', {}, [sec.store || '其他', sec.time].filter(Boolean).join(' ')), el('span', { class: 'num' }, `${fmt(sec.kcal)} 大卡`)) : null,
        el('ul', { class: 'items' }, sec.entries.map(e => e.group ? groupRow(e, sec.store) : itemRow(e.it, e.i))),
      ]);
      container.replaceChildren(...[
        // 只有一家店（或都沒有店名）時，上方的店名套用到全部品項；多家店時改到各品項裡改
        multi ? null : el('label', { class: 'field' }, '店名', el('input', { type: 'text', maxlength: '30', value: shop, placeholder: '例如：壽司郎（家裡煮的可以留白）', onchange: e => { const v = e.target.value.trim(); emit({ ...m, store: v, items: m.items.map(it => ({ ...it, store: v })) }); } })),
        noType ? null : typeChips(m.type, type => type !== m.type && takenTypes.includes(type) ? toast(`這天已經有${type}了，到那一餐加品項。`, true) : emit({ ...m, type })),
        nutriRow(L.mealTotals(m)),
        root.UI.microLine(L.mealTotals(m)),
        ...(m.items.length ? list : [el('p', { class: 'empty' }, mode === 'draft' ? '還沒有品項，按下面新增。' : '這餐沒有品項了。可以新增，或刪除這餐。')]),
        adding ? addForm() : el('button', { class: 'btn btn-soft btn-block', onclick: () => { adding = true; draw(); } }, '＋ 加一個品項'),
      ].filter(Boolean));
    }

    draw();
  }

  const MealEditor = { render };
  root.MealEditor = MealEditor;
  if (typeof module !== 'undefined') module.exports = MealEditor;
})(typeof window !== 'undefined' ? window : globalThis);
