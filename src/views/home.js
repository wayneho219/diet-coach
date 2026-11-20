// 首頁（某一天）與一餐詳細頁
(function (root) {
  let exOpen = false, wOpen = false, exOther = false, exType = null, exMin = null, exSteps = '';
  let exName = '', exKcal = '', exBusy = false, exNote = '';
  let shownDate = null;
  const T = () => root.Profile.text;

  function render({ dateKey, today }) {
    if (dateKey !== shownDate) { exOpen = false; wOpen = false; exOther = false; exType = null; exMin = null; exSteps = ''; exName = ''; exKcal = ''; exNote = ''; exBusy = false; shownDate = dateKey; }
    const { $, el } = root.UI, Store = root.Store, L = root.Logic;
    if (!Store.ready) { $('view-home').replaceChildren(el('p', { class: 'empty' }, '載入中…')); return; }
    const s = Store.settings, day = Store.day(dateKey);
    const t = L.totals(day), add = L.dayAddBack(day, s.cap, s.goal), target = s.target + add;
    $('view-home').replaceChildren(
      dateBar(dateKey, today),
      kcalCard(t, s, add, target),
      ...mealSection(dateKey, day),
      waterCard(dateKey, day, s),
      exerciseCard(dateKey, day, s, add),
      weightCard(dateKey, day));
  }

  function dateBar(dateKey, today) {
    const { el, dayLabel } = root.UI, L = root.Logic, App = root.App;
    const n = L.streak(root.Store.days, today, root.Store.settings);
    return el('header', { class: 'datebar' },
      el('button', { class: 'icon-btn', 'aria-label': '前一天', disabled: dateKey <= L.addDays(today, -120), onclick: () => App.setDate(L.addDays(dateKey, -1)) }, '‹'),
      el('button', { class: 'datebar-label', 'aria-label': `選擇日期，目前 ${dayLabel(dateKey)}`, onclick: () => root.Calendar.open({ dateKey, today }) },
        dateKey === today ? `今天・${dayLabel(dateKey)}` : dayLabel(dateKey), el('span', { class: 'datebar-caret', 'aria-hidden': 'true' }, '▾')),
      el('button', { class: 'icon-btn', 'aria-label': '後一天', disabled: dateKey >= today, onclick: () => App.setDate(L.addDays(dateKey, 1)) }, '›'),
      el('span', { class: 'streak', 'aria-label': `${T().streakLabel} ${n} 天` }, `${T().streakIcon} ${n}`));
  }

  function kcalCard(t, s, add, target) {
    const { el, fmt, ring } = root.UI;
    // 三大營養素的目標跟著加回後的熱量走，和大圓環同一個基準
    // 增重：吃到目標就算達標，超過 115% 才是超標
    const bulk = root.Logic.goalOf(s).ringBulk, remain = target - t.kcal, over = bulk ? t.kcal > target * 1.15 : remain < 0;
    const goal = root.Logic.macroTargets({ ...s, target });
    const label = over ? T().ringOver : bulk && remain <= 0 ? T().ringDone : T().ringRemain;
    const macro = (key, emoji, name, val) => {
      const state = root.Logic.macroState(key, val, goal[key], s.goal);
      return el('div', { class: 'macro' },
        ring(val / goal[key], { size: 72, stroke: 9, cls: state || key }, el('span', { class: 'ring-emoji', 'aria-hidden': 'true' }, emoji)),
        el('span', { class: 'macro-name' }, name),
        state === 'over'
          ? el('span', { class: 'macro-val num over-text' }, `超過 ${fmt(val - goal[key])}g`)
          : el('span', { class: 'macro-val num' + (state === 'good' ? ' good-text' : '') }, `${fmt(val)}/${goal[key]}g`));
    };
    return el('section', { class: 'card hero-rings' },
      el('div', { class: 'kcal-ring-row' },
        ring(t.kcal / target, { size: 168, stroke: 14, cls: over ? 'over' : 'kcal' },
          el('span', { class: 'ring-label' }, label),
          el('b', { class: 'ring-big num' }, (bulk && remain < 0 ? '+' : '') + fmt(Math.abs(remain))),
          el('span', { class: 'ring-unit' }, '大卡')),
        el('div', { class: 'kcal-side' },
          el('div', {}, '已吃', el('b', { class: 'num' }, fmt(t.kcal))),
          el('div', {}, '目標', el('b', { class: 'num' }, fmt(s.target)), add ? el('small', {}, `＋運動 ${add}`) : null))),
      el('div', { class: 'macro-rings' },
        macro('protein', '🥚', '蛋白質', t.protein), macro('carbs', '🍙', '碳水', t.carbs), macro('fat', '🥑', '脂肪', t.fat)),
      root.UI.microLine(t, { fiber: s.fiber, sodium: s.sodium }));
  }

  function mealSection(dateKey, day) {
    const { el, MEAL_TYPES, MEAL_EMOJI } = root.UI;
    const cards = [], slots = [];
    for (const type of MEAL_TYPES) {
      const meals = day.meals.filter(m => m.type === type);
      meals.forEach(m => cards.push(mealCard(dateKey, m)));
      if (!meals.length) slots.push(el('button', { class: 'add-slot', onclick: () => root.AddMeal.open({ dateKey, mealType: type }) }, `${MEAL_EMOJI[type]} ＋ 記${type}`));
    }
    if (slots.length) cards.push(el('div', { class: 'add-slots' }, slots));
    return cards;
  }

  // 一個餐別一張卡：多家店時每家一段（店名＋時間），整排往右滑
  function mealCard(dateKey, m) {
    const { el, fmt, sticker, MEAL_EMOJI } = root.UI;
    const t = root.Logic.mealTotals(m), open = () => openMeal(dateKey, m.id), label = root.Logic.storeLabel(m);
    const sections = root.Logic.groupItems(m), multi = sections.length > 1;
    const cell = e => e.group
      ? el('button', { class: 'sticker-cell', onclick: open },
          sticker('🍱', 'md'),
          el('span', { class: 'sticker-name' }, e.group),
          el('span', { class: 'sticker-kcal' }, `${fmt(e.kcal)} 大卡`))
      : el('button', { class: 'sticker-cell', onclick: open },
          sticker(e.it.emoji, 'md'),
          el('span', { class: 'sticker-name' }, e.it.qty !== 1 ? `${e.it.name}×${e.it.qty}` : e.it.name),
          el('span', { class: 'sticker-kcal' }, `${fmt(e.it.kcal * e.it.qty)} 大卡`));
    const sub = multi ? '' : [label, sections[0]?.time || m.time].filter(Boolean).join(' ');
    return el('section', { class: 'card' },
      el('button', { class: 'card-head', onclick: open },
        el('span', { class: 'card-title' }, `${MEAL_EMOJI[m.type] ?? '🍽️'} ${m.type}`, sub ? el('span', { class: 'card-sub' }, sub) : null),
        el('b', {}, `${fmt(t.kcal)} 大卡`)),
      el('div', { class: 'sticker-row' },
        multi
          ? sections.map(sec => el('div', { class: 'sticker-seg' },
              el('span', { class: 'seg-label' }, [sec.store || '其他', sec.time].filter(Boolean).join(' ')),
              el('div', { class: 'seg-items' }, sec.entries.map(cell))))
          : sections.flatMap(sec => sec.entries).map(cell),
        el('button', { class: 'sticker-cell add-cell', onclick: () => root.AddMeal.open({ dateKey, mealType: m.type, appendTo: m.id }) },
          el('span', { class: 'sticker sticker-md add-sticker', 'aria-hidden': 'true' }, '＋'),
          el('span', { class: 'sticker-name' }, '加品項'))));
  }

  // 詳細頁：改動 0.5 秒後才存，關閉面板時立刻存
  function openMeal(dateKey, id) {
    const { el, sticker, sheet, confirmTap } = root.UI, Store = root.Store, L = root.Logic;
    let meal = Store.day(dateKey).meals.find(m => m.id === id);
    if (!meal) return;
    let timer = null, dirty = false;
    const flush = () => { clearTimeout(timer); if (dirty) Store.saveMeal(dateKey, meal).catch(() => {}); dirty = false; };
    const title = el('div', { class: 'detail-title' });
    const hero = el('div', { class: 'detail-hero' });
    const drawHead = () => {
      hero.replaceChildren(sticker(L.mealEmoji(meal), 'lg'), title);
      title.textContent = `${L.storeLabel(meal) ? L.storeLabel(meal) + '・' : ''}${meal.type} ${meal.time}`;
    };
    const editor = el('div', { class: 'sheet-body' });
    const del = confirmTap(el('button', { class: 'btn btn-danger' }, '刪除這餐'), () => {
      clearTimeout(timer); dirty = false;
      Store.deleteMeal(dateKey, id).catch(() => {});
      sheet.close();
    });
    drawHead();
    sheet.open(el('div', { class: 'sheet-body' }, hero, editor,
      el('div', { class: 'row' }, del, el('button', { class: 'btn btn-primary', onclick: () => sheet.close() }, '完成'))),
      { onClose: () => { root.Coach.cancel(); flush(); } });
    const takenTypes = Store.day(dateKey).meals.filter(x => x.id !== id).map(x => x.type);
    root.MealEditor.render(editor, meal, { mode: 'saved', takenTypes, onChange: next => {
      meal = next; dirty = true; drawHead();
      clearTimeout(timer); timer = setTimeout(flush, 500);
    } });
  }

  function waterCard(dateKey, day, s) {
    const { el, fmt } = root.UI, Store = root.Store;
    const total = root.Logic.totals(day).water;
    const cup = s.cup || 500, had = day.water.length;
    const cells = Math.min(7, Math.max(Math.ceil(s.water / cup), had + 1, 1));
    const shownFull = had >= cells ? cells - 1 : had;     // 喝超過 7 格時，最後一格留給「＋」
    const cups = [];
    for (let i = 0; i < cells; i++) {
      if (i < shownFull - 1) cups.push(el('span', { class: 'cup full', 'aria-hidden': 'true' }));
      else if (i === shownFull - 1) cups.push(el('button', { class: 'cup full', 'aria-label': '收回最後一杯', onclick: () => Store.updateDay(dateKey, d => { d.water.pop(); }).catch(() => {}) }, had > shownFull ? String(had) : null));
      else if (i === shownFull) cups.push(el('button', { class: 'cup next', 'aria-label': `喝了一杯 ${cup} ml`, onclick: () => Store.updateDay(dateKey, d => { d.water.push(cup); }).catch(() => {}) }, '＋'));
      else cups.push(el('span', { class: 'cup', 'aria-hidden': 'true' }));
    }
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { class: 'card-title' }, '💧 飲水'), el('b', {}, `${fmt(total)}／${fmt(s.water)} ml`)),
      el('div', { class: 'cups' }, cups),
      el('p', { class: 'hint' }, `一杯 ${cup} ml`));
  }

  // 運動：每種都算；輸入時即時顯示熱量。走路、跑步可以填步數或分鐘（至少一個）
  function exerciseCard(dateKey, day, s, add) {
    const { el, fmt, toast, confirmTap } = root.UI, Store = root.Store, L = root.Logic;
    const weight = Store.days.find(d => d.weight)?.weight ?? s.weight;
    const list = el('ul', { class: 'log' }, day.exercise.map((e, i) => el('li', {},
      el('span', {}, `${e.type}${e.minutes ? ` ${e.minutes} 分` : ''}${e.steps ? ` ${fmt(e.steps)} 步` : ''}・淨消耗 ${fmt(e.net)} 大卡`),
      confirmTap(el('button', { class: 'btn btn-ghost', 'aria-label': `刪除 ${e.type}` }, '刪除'),
        () => Store.updateDay(dateKey, d => { d.exercise.splice(i, 1); }).catch(() => {})))));
    const names = [...Object.keys(L.MET), ...Object.keys(s.customEx || {})];
    const redraw = () => render({ dateKey, today: root.App.today() });
    const typeSel = el('select', { 'aria-label': '運動種類', onchange: () => {
      exType = typeSel.value; exNote = '';   // 分鐘只有使用者自己打過才保留（exMin 不是 null）
      exOther = exType === '__other';
      redraw();
    } },
      names.map(k => el('option', { value: k, selected: k === exType }, k)),
      el('option', { value: '__other', selected: exType === '__other' }, '其他（自己輸入）'));
    const type = typeSel.value, steppy = L.usesSteps(type);
    const nameIn = el('input', { type: 'text', maxlength: '20', placeholder: '例如 飛輪課', value: exName, 'aria-label': '運動名稱', oninput: () => { exName = nameIn.value; } });
    const kcalIn = el('input', { type: 'number', inputmode: 'numeric', value: exKcal, 'aria-label': '消耗大卡', oninput: () => { exKcal = kcalIn.value; if (coachBtn) coachBtn.hidden = !!exKcal.trim(); } });
    let coachBtn = null;
    const preview = el('p', { class: 'hint', style: 'grid-column:1/-1', 'aria-live': 'polite' });
    const num = v => Math.round(Number(v)) || 0;
    // 目前輸入的運動；資料不夠就回 null
    const current = () => {
      if (exOther) return null;
      const minutes = num(minIn.value), steps = steppy ? num(stepsIn.value) : 0;
      if (!minutes && !steps) return null;
      return { minutes, steps, ...L.exercise(type, { minutes, steps }, weight, s) };
    };
    const showPreview = () => { const r = current(); preview.textContent = r ? `約 ${fmt(r.net)} 大卡` : ''; };
    const minIn = el('input', { type: 'number', inputmode: 'numeric', value: exMin ?? (steppy ? '' : '30'), placeholder: steppy ? '選填' : '', 'aria-label': '分鐘', oninput: () => { exMin = minIn.value; showPreview(); } });
    const stepsIn = el('input', { type: 'number', inputmode: 'numeric', value: exSteps, placeholder: '選填', 'aria-label': '步數', oninput: () => { exSteps = stepsIn.value; showPreview(); } });
    const resetForm = () => { exOpen = false; exOther = false; exType = null; exMin = null; exSteps = ''; exName = ''; exKcal = ''; exNote = ''; };
    const checkName = name => {
      if (!(name.length >= 1 && name.length <= 20)) return '名稱請填 1 到 20 字。';
      if (name === '__other' || ['__proto__', 'constructor', 'toString'].includes(name)) return '這個名稱不能用，換一個試試。';
      return '';
    };
    // 新運動：請教練估一次強度（MET）並記住，之後就跟內建的運動一樣直接算
    const askCoach = async () => {
      const name = nameIn.value.trim();
      exMin = minIn.value;
      const bad = checkName(name);
      if (bad) return toast(bad, true);
      if (Object.hasOwn(L.MET, name) || Object.hasOwn(Store.settings.customEx || {}, name)) { exOther = false; exType = name; exName = ''; return redraw(); }   // 已經有的運動不用再估
      exBusy = true; redraw();
      const at = shownDate;
      try {
        const { met } = await root.Coach.estimateExercise(name);
        if (shownDate !== at) return;    // 估算期間使用者換了日期，結果丟掉
        Store.saveSettings({ customEx: { ...(Store.settings.customEx || {}), [name]: met } }).catch(() => {});
        exOther = false; exType = name; exName = ''; exKcal = '';
      } catch (e) {
        if (e?.code !== 'cancelled') toast(e?.message || '這次沒估出來，再試一次。', true);
      } finally {
        if (shownDate === at) { exBusy = false; redraw(); }
      }
    };
    const record = () => {
      if (!exOther) {
        const minutes = num(minIn.value), steps = steppy ? num(stepsIn.value) : 0;
        if (steppy && !minutes && !steps) return toast('步數或分鐘至少填一個。', true);
        if ((minutes || !steppy) && !(minutes >= 1 && minutes <= 600)) return toast('分鐘數請填 1 到 600。', true);
        if (steps && !(steps >= 1 && steps <= 100000)) return toast('步數請填 1 到 100,000。', true);
        const e = { type, net: L.exercise(type, { minutes, steps }, weight, s).net };
        if (minutes) e.minutes = minutes;
        if (steps) e.steps = steps;
        resetForm();
        return Store.updateDay(dateKey, d => { d.exercise.push(e); }).catch(() => {});
      }
      // 其他：有手錶的數字就用手錶的，並反推強度記住
      const minutes = num(minIn.value), name = nameIn.value.trim(), kcal = num(kcalIn.value);
      if (!(minutes >= 1 && minutes <= 600)) return toast('分鐘數請填 1 到 600。', true);
      const bad = checkName(name);
      if (bad) return toast(bad, true);
      if (!kcalIn.value.trim()) return toast(root.Coach.available ? `先按「讓${T().coachWord}估」，或填手錶上的數字。` : '請填消耗大卡。', true);
      if (!(kcal >= 1 && kcal <= 3000)) return toast('消耗大卡請填 1 到 3000。', true);
      const met = L.customMet(kcal, weight, minutes);
      const net = Math.max(0, Math.round(kcal - weight * minutes / 60));
      resetForm();
      Store.updateDay(dateKey, d => { d.exercise.push({ type: name, minutes, net }); }).catch(() => {});
      if (!Object.hasOwn(L.MET, name)) Store.saveSettings({ customEx: { ...(s.customEx || {}), [name]: met } }).catch(() => {});
    };
    const form = el('div', { class: 'grid2' },
      el('label', { class: 'field' }, '種類', typeSel),
      el('label', { class: 'field' }, '分鐘', minIn),
      !exOther && steppy ? el('label', { class: 'field' }, '步數', stepsIn) : null,
      exOther ? el('label', { class: 'field' }, '名稱', nameIn) : null,
      exOther ? el('label', { class: 'field' }, '手錶消耗大卡（選填）', kcalIn) : null,
      exNote ? el('p', { class: 'hint', style: 'grid-column:1/-1' }, exNote) : null,
      exOther ? null : preview,
      exBusy ? el('p', { class: 'thinking', style: 'grid-column:1/-1' }, `${T().coachWord}估算中…`)
        : el('div', { class: 'row', style: 'grid-column:1/-1' },
          exOther && root.Coach.available ? (coachBtn = el('button', { class: 'btn btn-soft', hidden: !!exKcal.trim(), onclick: askCoach }, `讓${T().coachWord}估`)) : null,
          el('button', { class: 'btn btn-primary', onclick: record }, '記錄運動')));
    showPreview();
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { class: 'card-title' }, '🏃 運動'), el('span', { class: 'card-sub' }, add ? `加回 ${add} 大卡` : '')),
      day.exercise.length ? list : null,
      exOpen ? form : el('button', { class: 'btn btn-soft btn-block', onclick: () => { exOpen = true; render({ dateKey, today: root.App.today() }); } }, '＋ 記錄運動'));
  }

  function weightCard(dateKey, day) {
    const { el, toast } = root.UI, Store = root.Store;
    const input = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '例如 57.8', 'aria-label': '體重 kg' });
    const save = () => {
      const w = Math.round(Number(input.value) * 10) / 10;
      if (!(w >= 30 && w <= 200)) return toast('體重請填 30 到 200 之間的數字（kg）。', true);
      wOpen = false;
      Store.updateDay(dateKey, d => { d.weight = w; }).catch(() => {});
    };
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, '⚖️ 體重'),
        day.weight ? el('b', {}, `${day.weight} kg`) : null),
      wOpen
        ? el('div', { class: 'grid2' }, el('label', { class: 'field' }, '體重（kg）', input), el('button', { class: 'btn btn-primary', style: 'align-self:end', onclick: save }, '記錄'))
        : el('button', { class: 'btn btn-soft btn-block', onclick: () => { wOpen = true; render({ dateKey, today: root.App.today() }); } }, day.weight ? '修改體重' : '記錄體重'));
  }

  const Home = { render, openMeal };
  root.Home = Home;
  if (typeof module !== 'undefined') module.exports = Home;
})(typeof window !== 'undefined' ? window : globalThis);
