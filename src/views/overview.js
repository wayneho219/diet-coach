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
      adviceCard(today), settingsCard());
  }
  const rerender = () => render({ today: root.App.today() });

  // 「⚙️ AI 設定」：服務、金鑰、模型、教練名稱，加上備份匯出／匯入（放在最下面，預設收合）
  // 沒按儲存的輸入與展開狀態：頁面重繪（切回分頁、資料更新）時不能被洗掉
  let draft = null, detailsOpen = null;
  // 查過的模型清單，key 是「服務|金鑰」：{ ids } 或 { error }；只放記憶體，重新整理頁面才會再查
  const modelLists = {};
  const CUSTOM = '__custom__', ALL = '__all__';
  let showAll = false;   // 使用者按過「顯示全部模型」
  function settingsCard() {
    const { el, toast, confirmTap } = root.UI, Cfg = root.Config, App = root.App, P = root.LocalAI.PROVIDERS;
    const c = Cfg.get();
    const seed = g => ({ provider: g.provider, key: g.keys[g.provider], model: g.model[g.provider], coachName: g.coachName, typed: {} });
    if (!draft) draft = seed(c);
    const provider = el('select', {}, Object.entries(P).map(([k, v]) => el('option', { value: k, selected: k === draft.provider }, v.label)));
    const key = el('input', { type: 'password', autocomplete: 'off', value: draft.key, placeholder: '貼上 API 金鑰' });
    // model 文字欄是真正的值；查到清單時改顯示下拉選單，選「自訂…」才露出文字欄
    const model = el('input', { type: 'text', autocomplete: 'off', value: draft.model, placeholder: '模型名稱' });
    const modelSel = el('select', { hidden: true });
    const modelHint = el('small', { class: 'muted' });
    const name = el('input', { type: 'text', value: draft.coachName });
    const showModels = () => {
      const k = key.value.trim(), entry = modelLists[provider.value + '|' + k];
      modelHint.textContent = !k ? '' : !entry || entry.loading ? '載入模型清單中…' : entry.error ? '查不到模型清單：' + root.Welcome.errorText(entry.error) : '';
      if (!entry?.ids?.length) { modelSel.hidden = true; model.hidden = false; return; }
      // 平常只列強／中／快三檔；選了「顯示全部」或目前的模型不在三檔裡，才列完整清單
      const tiers = root.LocalAI.tiers(provider.value, entry.ids);
      const inList = entry.ids.includes(model.value);
      const full = showAll || !tiers.length || (inList && !tiers.some(t => t.id === model.value));
      const opts = full ? entry.ids.map(id => [id, id]) : tiers.map(t => [t.id, `${t.label}｜${t.id}`]);
      modelSel.replaceChildren(...opts.map(([v, text]) => el('option', { value: v, selected: v === model.value }, text)),
        full ? null : el('option', { value: ALL }, '顯示全部模型…'),
        el('option', { value: CUSTOM, selected: !inList }, '自訂…'));
      modelSel.hidden = false; model.hidden = inList;
    };
    let loadTimer = null;
    const loadModels = () => {
      clearTimeout(loadTimer);
      const p = provider.value, k = key.value.trim(), id = p + '|' + k;
      showModels();
      if (!k || modelLists[id]) return;
      loadTimer = setTimeout(async () => {   // 貼金鑰時等打完再查
        modelLists[id] = { loading: true };   // 查詢中：重繪出來的新卡片不要再查一次
        try { modelLists[id] = { ids: await root.LocalAI.listModels({ provider: p, key: k }, (...a) => fetch(...a)) }; }
        catch (e) { modelLists[id] = { error: e }; }
        // 這張卡片可能已經被重繪換掉了：換掉就重畫概覽，還在就只更新選單（不搶走輸入框的焦點）
        if (!modelSel.isConnected) { if (root.App.state.tab === 'overview') rerender(); }
        else if (provider.value === p && key.value.trim() === k) showModels();
      }, 500);
    };
    modelSel.addEventListener('change', () => {
      if (modelSel.value === ALL) { showAll = true; showModels(); return; }
      if (modelSel.value === CUSTOM) { model.hidden = false; model.focus(); }
      else { model.value = modelSel.value; model.hidden = true; }
      sync();
    });
    // 每次輸入都記進 draft；切換服務時，金鑰和模型欄換成那家打過的值，沒打過就用已儲存的
    const sync = () => {
      draft.provider = provider.value; draft.key = key.value; draft.model = model.value; draft.coachName = name.value;
      draft.typed[draft.provider] = { key: key.value, model: model.value };
    };
    [key, model].forEach(i => i.addEventListener('input', sync));
    key.addEventListener('input', loadModels);
    name.addEventListener('input', () => { draft.coachName = name.value; });
    provider.addEventListener('change', () => {
      const g = Cfg.get(), p = provider.value, t = draft.typed[p];
      key.value = t ? t.key : g.keys[p]; model.value = t ? t.model : g.model[p];
      sync();
      loadModels();
    });
    loadModels();
    const save = () => {
      const p = provider.value;
      Cfg.save({ provider: p, keys: { [p]: key.value.trim() }, model: { [p]: model.value.trim() }, coachName: name.value.trim() });
      App.reinitAI();
      draft = seed(Cfg.get());   // 卡片還在畫面上，事件處理器要有新的草稿可讀
    };
    const test = async () => {
      save();
      try { await root.Welcome.ping(); toast('✓ 連線成功'); }
      catch (e) { toast(root.Welcome.errorText(e), true); }
    };
    const exportBackup = () => {
      const blob = new Blob([JSON.stringify(App.db.exportAll())], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `diet-coach-${root.Logic.dayKey()}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const file = el('input', { type: 'file', accept: 'application/json', hidden: true });
    let pending = null;
    const doImport = async () => {
      try { await App.db.importAll(pending); App.loadStore(); toast('已匯入備份。'); }
      catch (e) { toast(e?.code === 'invalid_backup' ? '這不是本 App 的備份檔。' : '匯入失敗，資料沒有變動。', true); }
      pending = null;
    };
    const importBtn = confirmTap(el('button', { class: 'btn btn-soft', hidden: true }, '確定匯入（會取代目前所有紀錄）'), doImport, '再點一次確定，會取代所有紀錄');
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      try { pending = JSON.parse(await f.text()); } catch (_) { toast('這不是本 App 的備份檔。', true); return; }
      importBtn.hidden = false;
      toast('選好備份了。按下方按鈕會取代目前所有紀錄。');
    });
    const pickBtn = el('button', { class: 'btn btn-soft', onclick: () => file.click() }, '匯入備份');
    // 重置：清掉這個 App 在瀏覽器裡的所有資料（紀錄、設定、金鑰），回到第一次打開的狀態
    const resetBtn = confirmTap(el('button', { class: 'btn btn-ghost', style: 'grid-column:1/-1' }, '重置 App（刪除所有資料）'), () => {
      root.LocalDB.clearAll(localStorage);
      location.reload();
    }, '再點一次確定：紀錄、設定和金鑰都會刪掉');
    const det = el('details', { class: 'card', open: detailsOpen ?? false },
      el('summary', { class: 'card-title' }, '⚙️ AI 設定'),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, '服務', provider),
        el('label', { class: 'field' }, '教練名稱', name),
        el('label', { class: 'field' }, '金鑰', key),
        el('label', { class: 'field' }, '模型', modelSel, model, modelHint),
        el('button', { class: 'btn btn-primary', onclick: () => { save(); toast('設定已儲存。'); } }, '儲存'),
        el('button', { class: 'btn btn-soft', onclick: test }, '測試連線'),
        el('button', { class: 'btn btn-soft', onclick: exportBackup }, '匯出備份'),
        pickBtn, file, importBtn, resetBtn),
      el('p', { class: 'hint' }, '照片和文字會傳給你選的 AI 服務。'),
      el('p', { class: 'hint' }, 'API 費用由你自己負擔。'),
      el('p', { class: 'hint' }, 'iPhone 請用 Safari「加入主畫面」打開，資料才不會被清除。'),
      el('p', { class: 'hint' }, '重置前想留著紀錄的話，先按「匯出備份」。'));
    det.addEventListener('toggle', () => { detailsOpen = det.open; });
    return det;
  }

  function planCard() {
    const { el, fmt, toast } = root.UI, Store = root.Store, L = root.Logic;
    const s = Store.settings, weight = Store.days.find(d => d.weight)?.weight ?? s.weight;
    // 卡片只顯示資料；改設定要按「編輯」，在彈出視窗裡改
    const rows = list => list.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]);
    const block = (title, list) => { const r = rows(list); return r.length ? [el('h3', { class: 'plan-sub' }, title), el('dl', { class: 'calc' }, r)] : []; };
    const rmr = L.restingKcal(s, weight);   // 有 InBody 就用 InBody 當基準
    const td = rmr ? Math.round(rmr * s.activity) : null;
    const plan = td ? L.weightPlan(td, s, weight) : null;   // 有目標體重和日期時，建議目標照速度算
    const wk = plan?.weekly ? `每週約 ${plan.weekly > 0 ? '+' : ''}${plan.weekly} kg` : null;
    const view = [
      ...block('每日目標', [
        ['目標', L.goalOf(s).word], ['熱量', `${fmt(s.target)} 大卡`], ['蛋白質', `${s.protein} g`], ['飲水', `${fmt(s.water)} ml`],
        ['纖維', `${s.fiber} g`], ['鈉上限', `${fmt(s.sodium)} mg`], ['肌力訓練', `每週 ${s.strengthGoal} 次`]]),
      ...block('目標體重', L.goalOf(s).key === 'recomp' ? [] : [
        ['目標體重', s.targetWeight ? `${s.targetWeight} kg` : null], ['目標日期', s.targetDate || null], ['預計速度', s.targetWeight && s.targetDate ? wk : null]]),
      ...block('身體狀態', [
        ['身高', s.height ? `${s.height} cm` : null], ['年齡', s.age ? `${s.age} 歲` : null], ['體重', weight ? `${weight} kg` : null],
        ['體脂率', s.bodyFat ? `${s.bodyFat}%` : null], ['骨骼肌量', s.smm ? `${s.smm} kg` : null],
        ['去脂體重', L.leanMass(s, weight) ? `${L.leanMass(s, weight).toFixed(1)} kg` : null],
        ['內臟脂肪', s.visceral ? `等級 ${s.visceral}` : null], ['InBody 日期', s.bodyDate || null]]),
      ...block('代謝參考', rmr ? [
        [s.bmrInBody ? '基礎代謝（InBody）' : s.bodyFat ? '基礎代謝（估）' : '基礎代謝', `${fmt(rmr)} 大卡`],
        ['每日總消耗', `${fmt(td)} 大卡`], ['建議目標', `${fmt(plan.target)} 大卡`], ['建議飲水', `${fmt(L.waterTarget(weight))} ml`]] : []),
      plan?.error ? el('p', { class: 'hint' }, '目標體重和目標方向對不上：減脂要比現在輕，增重要比現在重。') : null,
      plan?.capped ? el('p', { class: 'hint' }, `照目標日期的速度太快，建議目標已調整到安全範圍，大約要 ${plan.weeksNeeded} 週。`) : null,
    ];

    const inputs = {};
    const num = (k, label, extra = {}) => el('label', { class: 'field' }, label, inputs[k] = el('input', { type: 'number', inputmode: 'decimal', value: s[k] ?? '', ...extra }));
    inputs.activity = el('select', {}, [['1.2', '久坐（幾乎不運動）'], ['1.375', '輕度（每週 1–3 次）'], ['1.55', '中度（每週 3–5 次）'], ['1.725', '高度（每週 6–7 次）']]
      .map(([v, t]) => el('option', { value: v, selected: Number(v) === s.activity }, t)));
    const pick = (opts, cur) => opts.map(([v, t]) => el('option', { value: v, selected: v === cur }, t));
    inputs.goal = el('select', {}, pick(Object.values(L.GOALS).map(g => [g.key, g.word]), L.goalOf(s).key));
    inputs.sex = el('select', {}, pick([['f', '女'], ['m', '男']], s.sex === 'm' ? 'm' : 'f'));
    const form = el('div', { class: 'grid2' },
      el('label', { class: 'field' }, '目標', inputs.goal), el('label', { class: 'field' }, '性別', inputs.sex),
      num('height', '身高（cm）'), num('age', '年齡', { placeholder: '填了才能算代謝' }),
      el('label', { class: 'field', style: 'grid-column:1/-1' }, '平常活動量', inputs.activity),
      num('targetWeight', '目標體重（kg）'),
      el('label', { class: 'field' }, '目標日期', inputs.targetDate = el('input', { type: 'date', value: s.targetDate ?? '' })),
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
        for (const [k, input] of Object.entries(inputs)) v[k] = input.value === '' ? null : ['bodyDate', 'targetDate', 'goal', 'sex'].includes(k) ? input.value : Number(input.value);
        if (!(v.target >= 800 && v.protein > 0 && v.water > 0 && v.height > 0)) return toast('熱量（至少 800）、蛋白質、飲水和身高都要填。', true);
        const out = (x, lo, hi) => x != null && !(x >= lo && x <= hi);
        if (out(v.bodyFat, 3, 70) || out(v.smm, 5, 60) || out(v.visceral, 1, 30) || out(v.bmrInBody, 600, 3000) || out(v.bodyWeight, 30, 200) || out(v.targetWeight, 30, 200)) return toast('體脂率 3–70、骨骼肌量 5–60、內臟脂肪等級 1–30、基礎代謝 600–3000、體重和目標體重 30–200。', true);
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
      L.goalOf(s).floorHint ? el('p', { class: 'hint', style: 'grid-column:1/-1' }, L.goalOf(s).floorHint) : null);

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
      L.lowIntake(Store.days, today, s) ? el('p', { class: 'warnbox' }, L.goalOf(s).lowText) : null,
      salty ? el('p', { class: 'hint' }, `這週有 ${salty} 天鈉超過 ${fmt(s.sodium)} mg。吃得比較鹹的隔天，體重上升多半是水分，不是脂肪。`) : null);
  }

  const Overview = { render };
  root.Overview = Overview;
  if (typeof module !== 'undefined') module.exports = Overview;
})(typeof window !== 'undefined' ? window : globalThis);
