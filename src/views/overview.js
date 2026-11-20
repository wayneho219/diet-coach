// 概覽：計畫、AI 洞察、四張週圖、教練建議
(function (root) {
  const offsets = { weight: 0, kcal: 0, exercise: 0, water: 0 };
  let insightBusy = false;
  const CHART = {
    weight: { title: '體重', unit: 'kg', field: 'weight', digits: 1 },
    kcal: { title: '卡路里', unit: '大卡', field: 'kcal', target: s => s.target },
    exercise: { title: '運動消耗', unit: '大卡', field: 'exerciseNet' },
    water: { title: '飲水', unit: 'ml', field: 'water', target: s => s.water },
  };
  const md = key => { const [, m, d] = key.split('-').map(Number); return `${m}月${d}日`; };

  function render({ today }) {
    const { $, el } = root.UI;
    if (!root.Store.ready) { $('view-overview').replaceChildren(el('p', { class: 'empty' }, '載入中…')); return; }
    $('view-overview').replaceChildren(
      el('h1', { class: 'page-title' }, '概覽'),
      planCard(today), insightCard(today),
      chartCard('weight', today), chartCard('kcal', today), chartCard('exercise', today), chartCard('water', today),
      adviceCard(today));
  }
  const rerender = () => render({ today: root.App.today() });

  function planCard() {
    const { el, fmt, toast } = root.UI, Store = root.Store, L = root.Logic;
    const s = Store.settings, weight = Store.days.find(d => d.weight)?.weight ?? s.weight;
    // 卡片只顯示資料；改設定要按「編輯」，在彈出視窗裡改
    const rows = list => list.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]);
    const block = (title, list) => { const r = rows(list); return r.length ? [el('h3', { class: 'plan-sub' }, title), el('dl', { class: 'calc' }, r)] : []; };
    const rmr = L.restingKcal(s, weight);   // 有 InBody 就用 InBody 當基準
    const td = rmr ? Math.round(rmr * s.activity) : null;
    const view = [
      ...block('每日目標', [
        ['熱量', `${fmt(s.target)} 大卡`], ['蛋白質', `${s.protein} g`], ['飲水', `${fmt(s.water)} ml`],
        ['纖維', `${s.fiber} g`], ['鈉上限', `${fmt(s.sodium)} mg`], ['肌力訓練', `每週 ${s.strengthGoal} 次`]]),
      ...block('身體狀態', [
        ['身高', s.height ? `${s.height} cm` : null], ['年齡', s.age ? `${s.age} 歲` : null], ['體重', weight ? `${weight} kg` : null],
        ['體脂率', s.bodyFat ? `${s.bodyFat}%` : null], ['骨骼肌量', s.smm ? `${s.smm} kg` : null],
        ['去脂體重', L.leanMass(s, weight) ? `${L.leanMass(s, weight).toFixed(1)} kg` : null],
        ['內臟脂肪', s.visceral ? `等級 ${s.visceral}` : null], ['InBody 日期', s.bodyDate || null]]),
      ...block('代謝參考', rmr ? [
        [s.bmrInBody ? '基礎代謝（InBody）' : s.bodyFat ? '基礎代謝（估）' : '基礎代謝', `${fmt(rmr)} 大卡`],
        ['每日總消耗', `${fmt(td)} 大卡`], ['建議目標', `${fmt(L.suggestTarget(td, s))} 大卡`]] : []),
    ];

    const inputs = {};
    const num = (k, label, extra = {}) => el('label', { class: 'field' }, label, inputs[k] = el('input', { type: 'number', inputmode: 'decimal', value: s[k] ?? '', ...extra }));
    inputs.activity = el('select', {}, [['1.2', '久坐（幾乎不運動）'], ['1.375', '輕度（每週 1–3 次）'], ['1.55', '中度（每週 3–5 次）'], ['1.725', '高度（每週 6–7 次）']]
      .map(([v, t]) => el('option', { value: v, selected: Number(v) === s.activity }, t)));
    const form = el('div', { class: 'grid2' },
      num('height', '身高（cm）'), num('age', '年齡', { placeholder: '填了才能算代謝' }),
      el('label', { class: 'field', style: 'grid-column:1/-1' }, '平常活動量', inputs.activity),
      num('target', '熱量目標（大卡）'), num('protein', '蛋白質（g）'),
      num('water', '飲水（ml）'), num('cup', '每杯容量（ml）'), num('cap', '運動加回上限（大卡）'),
      num('fiber', '纖維目標（g）'), num('sodium', '鈉上限（mg）'),
      num('strengthGoal', '肌力訓練（次／週）'),
      num('bodyFat', '體脂率（%）'), num('smm', '骨骼肌量（kg）'),
      num('visceral', '內臟脂肪等級'), num('bmrInBody', 'InBody 基礎代謝（大卡）'),
      num('bodyWeight', '量測時體重（kg）'),
      el('label', { class: 'field' }, '量測日期', inputs.bodyDate = el('input', { type: 'date', value: s.bodyDate ?? '' })),
      el('button', { class: 'btn btn-primary', style: 'grid-column:1/-1', onclick: () => {
        const v = {};
        for (const [k, input] of Object.entries(inputs)) v[k] = input.value === '' ? null : k === 'bodyDate' ? input.value : Number(input.value);
        if (!(v.target >= 800 && v.protein > 0 && v.water > 0 && v.height > 0)) return toast('熱量（至少 800）、蛋白質、飲水和身高都要填。', true);
        const out = (x, lo, hi) => x != null && !(x >= lo && x <= hi);
        if (out(v.bodyFat, 3, 70) || out(v.smm, 5, 60) || out(v.visceral, 1, 30) || out(v.bmrInBody, 600, 3000) || out(v.bodyWeight, 30, 200)) return toast('體脂率 3–70、骨骼肌量 5–60、內臟脂肪等級 1–30、基礎代謝 600–3000、體重 30–200。', true);
        v.cup = v.cup ?? Store.DEFAULTS.cup;
        if (!(v.cup >= 50 && v.cup <= 2000)) return toast('每杯容量請填 50 到 2000 ml。', true);
        v.cap = v.cap ?? Store.DEFAULTS.cap;
        v.fiber = v.fiber ?? Store.DEFAULTS.fiber;
        v.sodium = v.sodium ?? Store.DEFAULTS.sodium;
        v.strengthGoal = v.strengthGoal ?? Store.DEFAULTS.strengthGoal;
        if (!(v.strengthGoal >= 0 && v.strengthGoal <= 7)) return toast('肌力訓練請填每週 0 到 7 次。', true);
        root.UI.sheet.close();
        Store.saveSettings(v).then(() => toast('計畫已儲存。')).catch(() => {});
      } }, '儲存計畫'),
      s.goal === 'bulk' ? null : el('p', { class: 'hint', style: 'grid-column:1/-1' }, '熱量目標不建議低於 1,200 大卡。'));

    const edit = () => root.UI.sheet.open(el('div', { class: 'sheet-body' }, el('h2', { class: 'sheet-title' }, '編輯計畫'), form));
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, '我的計畫'),
        el('button', { class: 'btn btn-soft', onclick: edit }, '編輯')),
      ...view);
  }

  function insightCard(today) {
    const { el, toast } = root.UI, Store = root.Store, L = root.Logic, Coach = root.Coach;
    const ins = Store.insight;
    const run = async () => {
      insightBusy = true; rerender();
      try {
        const body = L.bodyCompText(Store.settings, Store.days.find(d => d.weight)?.weight ?? Store.settings.weight);
        const text = await Coach.insight(L.weekSummaryText(Store.days, today, Store.settings) + (body ? '\n' + body : ''));
        await Store.saveInsight({ weekStart: L.weekStart(today), text, createdAt: new Date().toISOString() });
      } catch (e) { if (e?.code !== 'cancelled' && e?.message) toast(e.message, true); }
      finally { insightBusy = false; rerender(); }
    };
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { class: 'card-title' }, '✨ AI 健康洞察'),
        ins ? el('span', { class: 'card-sub' }, ins.createdAt ? `${md(L.dayKey(new Date(ins.createdAt)))} 分析` : null) : null),
      ins ? el('div', { class: 'rich' }, root.UI.rich(ins.text)) : null,
      insightBusy ? el('p', { class: 'thinking' }, `${root.Profile.text.coachWord}分析中…`)
        : Coach.available ? el('button', { class: 'btn btn-soft', onclick: run }, ins ? '重新分析這週' : '分析這週') : null);
  }

  function chartCard(kind, today) {
    const { el, svg: mkSvg, fmt } = root.UI, Store = root.Store, L = root.Logic, Charts = root.Charts;
    const c = CHART[kind], s = Store.settings;
    const start = L.addDays(L.weekStart(today), -7 * offsets[kind]);
    const end = L.addDays(start, 6);
    const minStart = L.weekStart(L.addDays(today, -120));
    const series = L.weekSeries(Store.days, start, s);
    const avg = L.seriesAverage(series, c.field);
    const svg = mkSvg('0 0 340 190', `${c.title}，${md(start)} 到 ${md(end)}`);
    const tip = el('p', { class: 'tip' });
    const shift = d => { offsets[kind] += d; rerender(); };
    const card = el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, c.title),
        el('span', { class: 'card-sub' }, avg == null ? '沒有資料' : `${c.digits ? avg.toFixed(c.digits) : fmt(avg)} ${c.unit}／每日平均`)),
      el('div', { class: 'weeknav' },
        el('button', { class: 'icon-btn', 'aria-label': '上一週', disabled: start <= minStart, onclick: () => shift(1) }, '‹'),
        el('span', {}, `${md(start)} – ${md(end)}`),
        el('button', { class: 'icon-btn', 'aria-label': '下一週', disabled: offsets[kind] === 0, onclick: () => shift(-1) }, '›')),
      kind === 'weight' ? el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'k-dot' }), '每天體重'), el('span', {}, el('i', { class: 'k-line' }), '7 日平均')) : null,
      svg, tip);
    if (kind === 'weight') Charts.line(svg, series.map(p => ({ date: p.date, w: p.weight, avg: p.avg7 })), { tipEl: tip, unit: 'kg', digits: 1 });
    else Charts.bars(svg, series.map(p => ({ date: p.date, value: p[c.field] })), { tipEl: tip, unit: c.unit, target: c.target ? c.target(s) : null });
    return card;
  }

  function adviceCard(today) {
    const { el, fmt, toast } = root.UI, Store = root.Store, L = root.Logic;
    const s = Store.settings, adv = L.weekAdvice(Store.days, today, s), cw = root.Profile.text.coachWord;
    const nt = adv.delta ? L.clampTarget(s.target + adv.delta, s) : null;
    const salty = L.highSodiumDays(Store.days, today, s.sodium);
    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, `🧭 ${cw}建議`),
      el('p', { style: 'margin:0' }, adv.text),
      nt && nt !== s.target ? el('button', { class: 'btn btn-soft', onclick: () => Store.saveSettings({ target: nt }).then(() => toast('目標已更新。')).catch(() => {}) }, `把目標改成 ${fmt(nt)} 大卡`) : null,
      L.lowIntake(Store.days, today, s) ? el('p', { class: 'warnbox' }, s.goal === 'bulk'
        ? '最近三天都沒吃到目標的 85%。增肌要每天吃夠，今天先把蛋白質補滿。'
        : '最近三天記錄的熱量都低於 1,200 大卡。吃太少容易掉肌肉，今天記得吃夠蛋白質和主食。') : null,
      salty ? el('p', { class: 'hint' }, `這週有 ${salty} 天鈉超過 ${fmt(s.sodium)} mg。吃得比較鹹的隔天，體重上升多半是水分，不是脂肪。`) : null);
  }

  const Overview = { render };
  root.Overview = Overview;
  if (typeof module !== 'undefined') module.exports = Overview;
})(typeof window !== 'undefined' ? window : globalThis);
