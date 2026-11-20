// 月曆面板：點首頁日期打開，顏色代表當天熱量，小點代表蛋白質達標（載入時不碰 DOM）
(function (root) {
  let year = 0, month = 0, ctx = null;   // 目前顯示的年月；ctx = { dateKey, today }

  const ym = key => [Number(key.slice(0, 4)), Number(key.slice(5, 7))];

  function draw() {
    const { el } = root.UI, L = root.Logic, Store = root.Store, App = root.App;
    const { dateKey, today } = ctx, s = Store.settings, STATUS_TEXT = root.Profile.text.status;
    const oldest = L.addDays(today, -120), [ty, tm] = ym(today);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    // 換月後整塊重畫，焦點放回同一顆箭頭；那顆變成不能按就換另一顆
    const go = delta => {
      const d = new Date(year, month - 1 + delta, 1); year = d.getFullYear(); month = d.getMonth() + 1; refresh();
      const [prev, next] = root.UI.$('cal-body').querySelectorAll('.cal-head .icon-btn');
      const want = delta < 0 ? prev : next;
      (want.disabled ? (delta < 0 ? next : prev) : want).focus();
    };
    const pick = key => { App.setDate(key); root.UI.sheet.close(); };

    const cells = L.monthGrid(year, month).map(key => {
      if (!key) return el('span', { 'aria-hidden': 'true' });
      const day = Store.day(key), st = L.dayStatus(day, s), n = Number(key.slice(8));
      const label = `${month}月${n}日，` + (st.kcal === 'none' ? '沒有紀錄' : STATUS_TEXT[st.kcal] + (st.protein ? '，蛋白質達標' : ''));
      return el('button', {
        class: ['cal-day', st.kcal !== 'none' && st.kcal, key === today && 'today', key === dateKey && 'selected'].filter(Boolean).join(' '),
        'aria-label': label, 'aria-pressed': key === dateKey ? 'true' : null,
        disabled: key > today || key < oldest, onclick: () => pick(key),
      }, String(n), st.protein ? el('span', { class: 'cal-dot' }) : null);
    });

    const sum = L.monthSummary(Store.days, year, month, today, s);
    const dot = color => el('i', { style: `background:${color}` });
    return [
      el('div', { class: 'cal-head' },
        el('button', { class: 'icon-btn', 'aria-label': '上個月', disabled: first <= oldest, onclick: () => go(-1) }, '‹'),
        el('span', {}, `${year}年${month}月`),
        el('button', { class: 'icon-btn', 'aria-label': '下個月', disabled: year * 12 + month >= ty * 12 + tm, onclick: () => go(1) }, '›')),
      el('div', { class: 'cal-week', 'aria-hidden': 'true' }, [...'一二三四五六日'].map(w => el('span', {}, w))),
      el('div', { class: 'cal-grid' }, cells),
      el('div', { class: 'cal-legend' },
        el('span', {}, dot('var(--good)'), STATUS_TEXT.good), el('span', {}, dot('var(--warn)'), STATUS_TEXT.over),
        el('span', {}, dot('var(--under)'), STATUS_TEXT.under), el('span', {}, dot('var(--ink)'), '蛋白質達標')),
      el('p', { class: 'hint' }, sum.logged
        ? `記錄 ${sum.logged} 天・${STATUS_TEXT.good} ${sum.good} 天・${STATUS_TEXT.over} ${sum.over} 天・${STATUS_TEXT.under} ${sum.under} 天・蛋白質達標 ${sum.protein} 天`
        : '這個月還沒有紀錄'),
      el('button', { class: 'btn btn-soft btn-block', onclick: () => pick(today) }, '回到今天'),
    ];
  }

  // 只重畫內容，面板不關
  function refresh() {
    const body = root.UI.$('cal-body');
    if (body) body.replaceChildren(...draw());
  }

  function open({ dateKey, today }) {
    ctx = { dateKey, today };
    [year, month] = ym(dateKey);
    const { el, sheet } = root.UI;
    sheet.open(el('div', { class: 'sheet-body', id: 'cal-body' }, draw()));
  }

  root.Calendar = { open };
  if (typeof module !== 'undefined') module.exports = root.Calendar;
})(typeof window !== 'undefined' ? window : globalThis);
