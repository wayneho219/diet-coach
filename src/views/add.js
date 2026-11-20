// 記一餐：AI 估算／我的最愛／店家清單／最近吃過，最後都進入草稿
(function (root) {
  let st = null;

  function open({ dateKey, mealType, appendTo } = {}) {
    const { el, sheet } = root.UI;
    st = { dateKey, type: mealType || root.Logic.defaultMealType(new Date().getHours()), view: 'menu',
      file: null, fileUrl: null, note: '', answer: '', draft: null, est: null, storeName: null, counts: {}, busy: false,
      appendTo: appendTo || null };
    if (st.appendTo && !baseMeal()) st.appendTo = null;   // 找不到那一餐，當成一般模式
    sheet.open(el('div', { class: 'sheet-body', id: 'add-body' }), { onClose: () => {
      root.Coach.cancel();
      if (st?.fileUrl) URL.revokeObjectURL(st.fileUrl);
      st = null;
    } });
    draw();
  }

  // append 模式下，重新讀出那一餐目前的版本（可能已被刪掉，回傳 undefined）
  const baseMeal = () => root.Store.day(st.dateKey).meals.find(m => m.id === st.appendTo);

  function draw() {
    if (!st) return;
    const body = root.UI.$('add-body');
    if (body) body.replaceChildren(...VIEWS[st.view]().filter(Boolean));
  }
  // ☆／★：加入或移除我的最愛
  function star(store, item) {
    const Store = root.Store, on = root.Logic.isFavorite(Store.foods, store, item.name);
    return root.UI.el('button', { class: 'star', 'aria-pressed': String(on), 'aria-label': `${item.name} ${on ? '移出' : '加入'}我的最愛`,
      onclick: () => { Store.saveFoods(root.Logic.toggleFavorite(Store.foods, store, item)).catch(() => {}); draw(); } }, on ? '★' : '☆');
  }

  // 可選份數的品項列表（我的最愛、店家清單共用）；rows = [[key, item]]，item 帶自己的 store
  // 我的最愛：排版跟「最近吃過」一樣、顯示店名、不放星星（整張都是最愛，左滑移除）
  function pickList(rows, fav) {
    const { el, sticker, fmt } = root.UI;
    const step = (k, d) => { st.counts[k] = Math.round(Math.max(0, Math.min(50, (st.counts[k] || 0) + d)) * 2) / 2; draw(); };
    const picked = rows.filter(([k]) => (st.counts[k] || 0) > 0).map(([k, it]) => ({ ...it, qty: st.counts[k] }));
    // 我的最愛只放份數，總熱量看下面的記錄按鈕；左滑露出「移除」（CSS scroll-snap，不用自己算手勢）
    const list = el('ul', { class: fav ? 'log' : 'items' }, rows.map(([k, it]) => {
      const cells = [
        el('span', { class: 'item-main' }, fav ? null : star(it.store, it), sticker(it.emoji, 'sm'), el('span', {}, it.name, el('small', {}, fav ? `${it.store ? it.store + '・' : ''}${fmt(it.kcal)} 大卡` : `每份 ${fmt(it.kcal)} 大卡`))),
        el('div', { class: 'stepper' },
          el('button', { 'aria-label': `${it.name} 減半份`, onclick: () => step(k, -0.5) }, '−'),
          el('span', { class: 'qty' }, String(st.counts[k] || 0)),
          el('button', { 'aria-label': `${it.name} 加半份`, onclick: () => step(k, 0.5) }, '＋'))];
      if (!fav) return el('li', { class: 'item-row' }, cells, el('span', { class: 'num' }, fmt(it.kcal * (st.counts[k] || 0))));
      const unfav = () => { delete st.counts[k]; root.Store.saveFoods(root.Logic.toggleFavorite(root.Store.foods, it.store, it)).catch(() => {}); draw(); };
      return el('li', { class: 'swipe' }, el('div', { class: 'swipe-row' }, cells),
        el('button', { class: 'swipe-del', 'aria-label': `${it.name} 移出我的最愛`, onclick: unfav }, '移除'));
    }));
    return { list, picked, total: picked.reduce((a, it) => a + it.kcal * it.qty, 0) };
  }
  const recordPicked = (store, items) => { st.draft = { ...root.Logic.newMeal(st.type), store, items }; save(); };

  const go = view => { st.view = view; if (view === 'menu') { st.storeName = null; st.counts = {}; } draw(); root.UI.$('sheet').scrollTop = 0; };

  function startDraft(store, items) {
    const s = store || (st.appendTo && baseMeal()?.store) || '';
    st.draft = { ...root.Logic.newMeal(st.type), store: s, items: items.map(it => ({ ...it, store: typeof it.store === 'string' && it.store ? it.store : s })) };
    go('draft');
  }

  async function pickPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const cur = st;
    root.UI.toast('照片處理中…');
    const blob = await root.UI.toJpeg(f);
    if (st !== cur) return;
    st.file = blob;
    if (st.fileUrl) URL.revokeObjectURL(st.fileUrl);
    st.fileUrl = URL.createObjectURL(st.file);
    go('estimate');
  }

  async function runEstimate() {
    const { toast } = root.UI, L = root.Logic, Store = root.Store;
    const note = st.note.trim();
    if (!st.file && !note) return toast('先拍照，或寫下吃了什麼。', true);
    const names = st.storeName ? [st.storeName] : L.detectStores(Store.foods, note);
    const baseStores = st.appendTo && baseMeal() ? [...new Set(baseMeal().items.map(it => L.itemStore(baseMeal(), it)).filter(Boolean))] : [];
    const appendStore = baseStores.length === 1 ? baseStores[0] : '';
    // 品項沒有店名時的預設：指定的店 → 描述裡只提到一家 → 加品項的那一餐
    const fallback = st.storeName || (names.length === 1 ? names[0] : '') || appendStore;
    const context = {
      stores: Object.fromEntries([...new Set([...names, ...baseStores].filter(Boolean))].map(n => [n, Store.foods.stores?.[n]?.items ?? null])),
      recentItems: L.recentItems(Store.days, st.dateKey, 30),
      settings: Store.settings,
      todayTotals: L.totals(Store.day(st.dateKey)),
    };
    const cur = st;
    st.busy = true; draw();
    try {
      const est = await root.Coach.estimate({ image: st.file, note, mealType: st.type, context });
      if (st !== cur) return;
      st.est = est;
      const store = est.store || fallback;
      st.draft = { ...L.newMeal(st.type), store, items: est.items.map(it => ({ ...it, store: it.store || store })) };
      st.view = 'draft';
    } catch (e) {
      if (st !== cur || e.code === 'cancelled') return;
      toast(e.message, true);
      if (!st.draft?.items?.length) st.draft = { ...L.newMeal(st.type), store: fallback, items: [] };
      if (!st.draft.items.length) st.est = null;
      st.view = 'draft';
    } finally {
      if (st === cur) { st.busy = false; draw(); }
    }
  }

  // 從聊天的記餐小卡進來：直接進草稿畫面
  // onSaved：真的存進去之後呼叫（聊天用來把小卡標成「已記錄」）
  function openDraft({ dateKey, mealType, store, items, onSaved }) {
    open({ dateKey, mealType });
    st.onSaved = onSaved;
    st.draft = { ...root.Logic.newMeal(st.type), store: store || '', items: structuredClone(items).map(it => ({ ...it, store: it.store || store || '' })) };
    go('draft');
  }

  function save() {
    const { toast, sheet } = root.UI;
    if (!st.draft.items.length) return toast('至少要有一個品項。', true);
    const key = st.dateKey;
    // 儲存時重讀：加品項模式找原本那一餐；一般模式找同一天同餐別的那一餐（每個餐別只有一筆）
    const base = (st.appendTo && baseMeal()) || root.Store.day(key).meals.find(m => m.type === st.draft.type) || null;
    const items = st.draft.items.map(it => ({ ...it, time: it.time || st.draft.time }));   // 每個品項記下自己的時間
    const meal = base ? root.Logic.mergeIntoMeal(base, items, st.draft.store) : { ...st.draft, items };
    const onSaved = st.onSaved;
    root.Store.saveMeal(key, meal).then(() => { toast(base ? '加好了。' : '記好了。'); onSaved?.(); }).catch(() => {});
    sheet.close();
  }

  const VIEWS = {
    menu() {
      const { el, sticker, fmt, typeChips } = root.UI, L = root.Logic, Store = root.Store;
      const stores = L.storesByRecent(Store.foods).slice(0, 8);
      const recent = L.recentItems(Store.days, st.dateKey, 10);
      const fav = pickList(L.favItems(Store.foods).map(it => [it.store + '|' + it.name, it]), true);
      const base = st.appendTo ? baseMeal() : null;
      return [
        el('h2', { class: 'sheet-title' }, base ? `加到${base.type}${L.storeLabel(base) ? '・' + L.storeLabel(base) : ''}` : root.Profile.text.addMeal),
        base ? null : typeChips(st.type, t => { st.type = t; draw(); }),
        el('div', { class: 'grid2' },
          el('label', { class: 'btn btn-primary btn-big', for: 'add-photo' }, el('span', { 'aria-hidden': 'true' }, '📷'), '拍照'),
          el('button', { class: 'btn btn-soft btn-big', onclick: () => { st.file = null; go('estimate'); } }, el('span', { 'aria-hidden': 'true' }, '✏️'), '打字描述')),
        el('input', { class: 'sr', type: 'file', id: 'add-photo', accept: 'image/*', onchange: pickPhoto }),
        root.Coach.available ? null : el('p', { class: 'hint' }, '目前不能用 AI 估算，請手動新增。'),
        stores.length ? el('div', { class: 'card' },
          el('h3', { class: 'card-title' }, '常去的店'),
          el('div', { class: 'chips' }, stores.map(n => el('button', { class: 'chip', onclick: () => { st.storeName = n; st.counts = {}; go('store'); } }, n)))) : null,
        fav.list.children.length ? el('div', { class: 'card' },
          el('h3', { class: 'card-title' }, '我的最愛'),
          fav.list,
          fav.picked.length ? el('button', { class: 'btn btn-primary btn-block', onclick: () => recordPicked('', fav.picked) },
            `${st.appendTo ? '加進這一餐' : '記錄這餐'}（${fmt(fav.total)} 大卡）`) : null) : null,
        recent.length ? el('div', { class: 'card' },
          el('h3', { class: 'card-title' }, '最近吃過'),
          el('ul', { class: 'log' }, recent.map(r => el('li', {},
            el('button', { class: 'item-main', onclick: () => startDraft(r.store, [{ ...r.item, qty: 1 }]) },
              sticker(r.item.emoji, 'sm'),
              el('span', {}, r.item.name, el('small', {}, `${r.store ? r.store + '・' : ''}${fmt(r.item.kcal)} 大卡`))),
            star(r.store, r.item))))) : null,
      ];
    },

    estimate() {
      const { el } = root.UI;
      const noteBox = el('textarea', { id: 'add-note', rows: '3', placeholder: '例如：壽司郎，鮭魚 3 盤、茶碗蒸', oninput: e => { st.note = e.target.value; } });
      noteBox.value = st.note;
      return [
        el('h2', { class: 'sheet-title' }, st.file ? '這一餐的照片' : '描述這一餐'),
        st.fileUrl && st.file ? el('img', { class: 'photo-preview', src: st.fileUrl, alt: '這一餐的照片' }) : null,
        el('label', { class: 'field' }, st.file ? '補充說明（選填）：店名、份量、沒吃完的部分' : '吃了什麼', noteBox),
        st.busy
          ? el('div', { class: 'row' }, el('p', { class: 'thinking' }, `${root.Profile.text.coachWord}估算中，通常要十幾秒…`), el('button', { class: 'btn btn-ghost', onclick: () => root.Coach.cancel() }, '停止'))
          : el('div', { class: 'row' },
              el('button', { class: 'btn btn-ghost', onclick: () => go('menu') }, '返回'),
              root.Coach.available
                ? el('button', { class: 'btn btn-primary', onclick: runEstimate }, '估算')
                : el('button', { class: 'btn btn-primary', onclick: () => startDraft('', []) }, '手動新增品項')),
      ];
    },

    store() {
      const { el, fmt } = root.UI;
      const shop = st.storeName === '其他' ? '' : st.storeName;
      const { list, picked, total } = pickList(Object.entries(root.Store.foods.stores?.[st.storeName]?.items ?? {}).map(([name, it]) => [name, { ...it, name, store: shop }]));
      return [
        el('h2', { class: 'sheet-title' }, st.storeName),
        list,
        el('p', { class: 'muted' }, `合計 ${fmt(total)} 大卡`),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost', onclick: () => go('menu') }, '返回'),
          el('button', { class: 'btn btn-soft', onclick: () => startDraft(shop, picked) }, '＋ 新品項')),
        el('button', { class: 'btn btn-primary btn-block', disabled: !picked.length, onclick: () => recordPicked(shop, picked) }, st.appendTo ? '加進這一餐' : '記錄這餐'),
      ];
    },

    draft() {
      const { el } = root.UI;
      const editor = el('div', { class: 'sheet-body' });
      root.MealEditor.render(editor, st.draft, { mode: 'draft', noType: !!st.appendTo, onChange: m => { st.draft = m; } });
      const e = st.est;
      const answer = el('textarea', { rows: '2', placeholder: `回答${root.Profile.text.coachWord}的問題`, oninput: ev => { st.answer = ev.target.value; } });
      return [
        el('h2', { class: 'sheet-title' }, st.appendTo ? '要加進這一餐的品項' : '確認這一餐'),
        e?.summary ? el('p', { style: 'margin:0;font-weight:700' }, e.summary) : null,
        e?.tips?.length ? el('ul', { class: 'tips' }, e.tips.map(t => el('li', {}, t))) : null,
        e?.question ? el('div', { class: 'question' },
          el('p', { style: 'margin:0 0 8px' }, e.question), answer,
          el('button', { class: 'btn btn-soft btn-block', style: 'margin-top:8px', disabled: st.busy, onclick: () => {
            if (st.answer?.trim()) st.note = `${st.note.trim()}\n（補充：${e.question} → ${st.answer.trim()}）`;
            st.answer = '';
            go('estimate'); runEstimate();
          } }, '重新估算')) : null,
        editor,
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost', onclick: () => root.UI.sheet.close() }, '取消'),
          el('button', { class: 'btn btn-primary', onclick: save }, st.appendTo ? '加進這一餐' : '記錄這餐')),
      ];
    },
  };

  const AddMeal = { open, openDraft };
  root.AddMeal = AddMeal;
  if (typeof module !== 'undefined') module.exports = AddMeal;
})(typeof window !== 'undefined' ? window : globalThis);
