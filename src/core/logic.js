// 純計算邏輯（減脂 cut／增重 bulk 依 settings.goal）（index.html 與 test_logic.js 共用）
(function (root) {
  // 常見運動的 MET 值
  const MET = { 散步: 3, 快走: 4.3, 慢跑: 7, 騎腳踏車: 5.8, 游泳: 6, 有氧舞蹈: 6.5, 重訓: 3.5, 瑜伽: 2.5 };
  const WALK = new Set(['散步', '快走']), RUN = new Set(['慢跑']);   // 這幾種可以用步數算

  const pad = n => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (key, n) => { const d = parse(key); d.setDate(d.getDate() + n); return dayKey(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

  // Mifflin-St Jeor：女性 −161、男性 +5（sex 沒填當女性）
  // 缺體重、身高或年齡時回 null（第一次打開還沒填資料）
  const bmr = ({ weight, height, age, sex }) => !weight || !height || !age ? null : Math.round(10 * weight + 6.25 * height - 5 * age + (sex === 'm' ? 5 : -161));
  const tdee = s => { const b = bmr(s); return b == null ? null : Math.round(b * s.activity); };

  // InBody 不常量，所以量到的結果當固定基準，用到下次量測：
  // 去脂體重用「量測時體重」算一次（沒填才退回目前體重），基礎代謝優先用 InBody 印的數字
  const leanMass = (s, weight) => s?.bodyFat && (s.bodyWeight || weight) ? (s.bodyWeight || weight) * (1 - s.bodyFat / 100) : null;
  function restingKcal(s, weight) {
    if (s?.bmrInBody) return s.bmrInBody;
    const lean = leanMass(s, weight);
    if (lean) return 370 + 21.6 * lean;                      // Katch-McArdle
    return s?.age && s?.height && weight ? bmr({ weight, height: s.height, age: s.age, sex: s.sex }) : null;
  }
  // MET 假設靜止代謝是每公斤每小時 1 大卡；用使用者自己的基礎代謝校正，限制在 0.7–1.2
  function metFactor(s, weight) {
    if (!weight) return 1;
    const rmr = restingKcal(s, weight);
    return rmr ? Math.min(1.2, Math.max(0.7, rmr / (weight * 24))) : 1;
  }
  const usesSteps = type => WALK.has(type) || RUN.has(type);

  // 淨消耗（每種運動都算）：
  // - 走路、跑步有步數時：步幅依身高（走 0.415、跑 0.65 倍身高），淨消耗走 0.5、跑 0.9 大卡／公斤／公里
  // - 其他：(MET − 1) × 體重 × 小時
  // 兩種都再乘上 metFactor。ponytail: 係數是一般成人的平均值，要調整就改這裡
  function exercise(type, { minutes = 0, steps = 0 } = {}, weight, s = {}) {
    const f = metFactor(s, weight);
    if (steps > 0 && usesSteps(type)) {
      const run = RUN.has(type), km = steps * (s.height || 160) * (run ? 0.65 : 0.415) / 100000;
      return { net: Math.max(0, Math.round((run ? 0.9 : 0.5) * weight * km * f)) };
    }
    const met = MET[type] ?? s.customEx?.[type] ?? 4;
    return { net: Math.max(0, Math.round((met - 1) * weight * minutes / 60 * f)) };
  }

  // 自訂運動：由手錶上的消耗大卡反推 MET，限制在 1–20
  const customMet = (kcal, weight, minutes) => Math.min(20, Math.max(1, Math.round(kcal / (weight * minutes / 60) * 10) / 10));

  // 脂肪佔熱量目標 30%，蛋白質用設定值，剩下的給碳水
  const macroTargets = s => ({
    protein: s.protein,
    fat: Math.round(s.target * 0.3 / 9),
    carbs: Math.max(0, Math.round((s.target - s.protein * 4 - s.target * 0.3) / 4)),
  });

  // 蛋白質是下限：吃到就算達標；碳水、脂肪是上限：超過才警告（增重 bulk 不警告）
  const macroState = (key, val, goal, mode = 'cut') => key === 'protein' ? (val >= goal ? 'good' : '') : (mode !== 'bulk' && val > goal ? 'over' : '');

  // 一天的加回：所有運動的淨消耗，減脂取一半、增重全部，再套每日上限
  const dayAddBack = (day, cap, goal = 'cut') =>
    Math.min(Math.round((day?.exercise ?? []).reduce((a, e) => a + (Number(e.net) || 0), 0) / (goal === 'bulk' ? 1 : 2)), cap);

  // 建議熱量目標：減脂 TDEE − 300（最低 1,200）；增重 TDEE + 400
  const suggestTarget = (td, s) => s?.goal === 'bulk' ? td + 400 : Math.max(1200, td - 300);
  // 套用調整後的目標：減脂不低於 1,200
  const clampTarget = (kcal, s) => s?.goal === 'bulk' ? kcal : Math.max(1200, kcal);

  const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat'];
  const MICROS = ['fiber', 'sodium'];          // 選填：缺少時當作 0
  const ALL = [...NUTRIENTS, ...MICROS];
  const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 });

  // v1 的 meal 沒有 items：轉成單一品項。v2 原樣回傳
  function normalizeMeal(m) {
    if (Array.isArray(m.items)) return m;
    const { name = '', portion = '', kcal = 0, protein = 0, carbs = 0, fat = 0, confidence, ...rest } = m;
    return { ...rest, store: '', items: [{ emoji: '🍽️', name: [name, portion].filter(Boolean).join(' ') || '餐點', qty: 1, kcal, protein, carbs, fat }] };
  }

  // 品項的店名：品項自己有就用自己的，舊資料沿用整餐的店名
  const itemStore = (meal, it) => (typeof it.store === 'string' ? it.store : meal.store || '').trim();

  // 品項的時間：品項自己有就用自己的，舊資料沿用整餐的時間
  const itemTime = (meal, it) => typeof it.time === 'string' && it.time ? it.time : (meal.time || '');

  // 同一天、同餐別只留一筆：保留第一筆的 id 和時間，品項帶上原本那筆的店名和時間
  function mergeSameType(meals) {
    const out = [];
    for (const raw of meals ?? []) {
      const m = normalizeMeal(raw);
      const base = out.find(x => x.type === m.type);
      if (!base) { out.push(m); continue; }
      const stamp = (meal, list) => list.map(it => ({ ...it, store: itemStore(meal, it), time: itemTime(meal, it) }));
      const merged = { ...base, items: [...stamp(base, base.items), ...stamp(m, m.items)] };
      out[out.indexOf(base)] = syncMealStore(merged);
    }
    return out;
  }

  // 存檔前：把每個品項的店名寫實；整餐的店名只在全部同一家時才填
  function syncMealStore(meal) {
    const m = normalizeMeal(meal);
    const items = m.items.map(it => ({ ...it, store: itemStore(m, it) }));
    if (!items.length) return { ...m, items };
    const names = [...new Set(items.map(it => it.store))];
    return { ...m, items, store: names.length === 1 ? names[0] : '' };
  }

  // 畫面分組：依店家分段（沒有店名的放最後），段落裡同組合的菜色收成一項；i 是品項在 meal.items 的位置
  function groupItems(meal) {
    const sections = [];
    const kcalOf = it => (Number(it.kcal) || 0) * (Number(it.qty) || 0);
    meal.items.forEach((it, i) => {
      const store = itemStore(meal, it);
      let sec = sections.find(s => s.store === store);
      if (!sec) sections.push(sec = { store, time: itemTime(meal, it), kcal: 0, entries: [] });
      if (itemTime(meal, it) && (!sec.time || itemTime(meal, it) < sec.time)) sec.time = itemTime(meal, it);
      sec.kcal += kcalOf(it);
      if (it.group) {
        let g = sec.entries.find(e => e.group === it.group);
        if (!g) sec.entries.push(g = { group: it.group, kcal: 0, items: [] });
        g.kcal += kcalOf(it);
        g.items.push({ i, it });
      } else sec.entries.push({ i, it });
    });
    for (const s of sections) {
      s.kcal = Math.round(s.kcal);
      for (const e of s.entries) if (e.group) e.kcal = Math.round(e.kcal);
    }
    return [...sections.filter(s => s.store), ...sections.filter(s => !s.store)];
  }

  const storeLabel = meal => meal.items?.length
    ? [...new Set(meal.items.map(it => itemStore(meal, it)).filter(Boolean))].join('・')
    : (meal.store || '');

  function mealTotals(meal) {
    const t = zero();
    for (const it of normalizeMeal(meal).items) for (const k of ALL) t[k] += (Number(it[k]) || 0) * (Number(it.qty) || 0);
    for (const k of ALL) t[k] = Math.round(t[k]);
    return t;
  }

  const mealEmoji = meal => normalizeMeal(meal).items[0]?.emoji || '🍽️';

  function totals(day) {
    const t = zero();
    for (const m of day?.meals ?? []) { const mt = mealTotals(m); for (const k of ALL) t[k] += mt[k]; }
    t.water = (day?.water ?? []).reduce((a, b) => a + b, 0);
    return t;
  }

  // 7 日平均：從 key 往前 7 個日曆天（含當天）內有量的體重
  function avg7(days, key) {
    const from = addDays(key, -6);
    const w = days.filter(d => d.weight && d.date >= from && d.date <= key).map(d => d.weight);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  }

  function weekAdvice(days, today, s = {}) {
    const [w0, w1, w2] = [0, 7, 14].map(n => avg7(days, addDays(today, -n)));
    if (w0 == null || w1 == null) return { level: 'info', text: '體重資料還不到兩週，先照目前的目標吃。' };
    if (s.goal === 'bulk') {
      const gain = w0 - w1;
      if (gain > 0.5)
        return { level: 'down', delta: -100, text: `這週 7 日平均增加 ${gain.toFixed(1)} kg，超過 0.5 kg，多半是脂肪，建議目標降 100 kcal。` };
      if (w0 <= w1 && w2 != null && w1 <= w2)
        return { level: 'up', delta: 150, text: '7 日平均已經連續兩週沒增加，建議目標加 150 kcal。' };
      if (w0 <= w1) return { level: 'info', text: '這週 7 日平均沒有增加，先確認每天都吃到目標，再觀察一週。' };
      return { level: 'ok', text: `這週 7 日平均增加 ${gain.toFixed(1)} kg，速度合格，維持目前目標。` };
    }
    const drop = (w1 - w0) / w1;
    if (drop > 0.01)
      return { level: 'up', delta: 100, text: `這週 7 日平均掉了 ${(drop * 100).toFixed(1)}%，超過 1%，建議目標加 100 kcal，保護肌肉。` };
    if (w0 >= w1 && w2 != null && w1 >= w2)
      return { level: 'down', delta: -125, text: '7 日平均已經連續兩週沒下降，建議目標降 100–150 kcal。' };
    if (w0 >= w1) return { level: 'info', text: '這週 7 日平均沒有下降，先別急著調整，再觀察一週。' };
    return { level: 'ok', text: `這週 7 日平均下降 ${(w1 - w0).toFixed(1)} kg，速度剛好，維持目前目標。` };
  }

  // 今天以前、有記錄餐點的最近 3 天都吃太少：減脂低於 1,200 kcal；增重低於目標的 85%
  function lowIntake(days, today, s = {}) {
    const logged = days.filter(d => d.date < today && d.meals?.length).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    const floor = s.goal === 'bulk' ? s.target * 0.85 : 1200;
    return logged.length === 3 && logged.every(d => totals(d).kcal < floor);
  }

  const defaultMealType = hour => hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 17 ? '點心' : hour < 21 ? '晚餐' : '點心';

  const newMeal = (type, now = new Date()) => ({
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    type, time: now.toTimeString().slice(0, 5), store: '', items: [],
  });

  // 份數一次 0.5：四捨五入到 0.5 的倍數（也吃掉浮點誤差），上限 50
  const roundQty = q => Math.min(50, Math.round((Number(q) || 0) * 2) / 2);
  function setQty(meal, i, qty) {
    const q = roundQty(qty);
    return { ...meal, items: meal.items.map((it, j) => j === i ? { ...it, qty: q } : it).filter(it => it.qty > 0) };
  }
  const updateItem = (meal, i, patch) => ({ ...meal, items: meal.items.map((it, j) => j === i ? { ...it, ...patch } : it) });
  // 同店、同名、同組合才算同一個品項
  const sameItem = (meal, a, b) => a.name === b.name && itemStore(meal, a) === itemStore(meal, b) && (a.group || '') === (b.group || '');
  function addItem(meal, item) {
    const j = meal.items.findIndex(it => sameItem(meal, it, item));
    if (j >= 0) return setQty(meal, j, meal.items[j].qty + (item.qty || 1));
    return { ...meal, items: [...meal.items, { ...item, qty: item.qty || 1 }] };
  }
  // 把新品項加進既有的一餐：同店同名同組合的份數相加，其餘接在後面。
  // 新品項沒有店名時用 store；原有品項保留自己的店名
  function mergeIntoMeal(base, items, store = '') {
    let m = syncMealStore(base);
    for (const it of items) m = addItem(m, { ...it, store: typeof it.store === 'string' && it.store.trim() ? it.store.trim() : store });
    return syncMealStore(m);
  }

  // 連續達標：熱量在合格範圍（減脂 85%–105%、增重 90%–115%）、蛋白質吃到、飲水喝到（月曆的綠色＋黑點，再加水量）；今天還沒達標就從昨天算
  function streak(days, today, s) {
    const has = new Set(days.filter(d => { const st = dayStatus(d, s); return st.kcal === 'good' && st.protein && totals(d).water >= s.water; }).map(d => d.date));
    let k = has.has(today) ? today : addDays(today, -1), n = 0;
    while (has.has(k)) { n++; k = addDays(k, -1); }
    return n;
  }

  const weekStart = key => addDays(key, -((parse(key).getDay() + 6) % 7));

  function weekSeries(days, start, settings) {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i), d = days.find(x => x.date === date), t = totals(d);
      const logged = !!d?.meals?.length;
      out.push({
        date,
        kcal: logged ? t.kcal : null,
        protein: logged ? t.protein : null,
        carbs: logged ? t.carbs : null,
        fat: logged ? t.fat : null,
        fiber: logged ? t.fiber : null,
        sodium: logged ? t.sodium : null,
        water: t.water || null,
        exerciseNet: d?.exercise?.length ? d.exercise.reduce((a, e) => a + e.net, 0) : null,
        weight: d?.weight ?? null,
        avg7: d?.weight ? avg7(days, date) : null,
      });
    }
    return out;
  }

  function seriesAverage(series, field) {
    const v = series.map(p => p[field]).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  // 最近 14 天內，依「店名|品項名」去重，越新的越前面
  function recentItems(days, today, n = 10) {
    const from = addDays(today, -13), seen = new Set(), out = [];
    const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
    for (const d of sorted) {
      if (d.date < from || d.date > today) continue;
      for (const raw of [...(d.meals ?? [])].reverse()) {
        const m = normalizeMeal(raw);
        for (const it of [...m.items].reverse()) {   // 同一餐裡，後加的品項比較新
          const store = itemStore(m, it);
          const key = store + '|' + it.name;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ store, item: { emoji: it.emoji, name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, fiber: it.fiber ?? 0, sodium: it.sodium ?? 0 } });
          if (out.length >= n) return out;
        }
      }
    }
    return out;
  }

  const storesByRecent = foods => Object.entries(foods?.stores ?? {})
    .sort((a, b) => (b[1].lastUsed || '').localeCompare(a[1].lastUsed || ''))
    .map(([name]) => name);

  // 我的最愛：foods.favorites = [{ store, name, ...營養 }]，使用者自己標記；營養以店家清單最新的為準
  const favKey = (store, name) => (store || '') + '|' + name;
  const isFavorite = (foods, store, name) => (foods?.favorites ?? []).some(f => favKey(f.store, f.name) === favKey(store, name));
  function toggleFavorite(foods, store, item) {
    const favs = foods?.favorites ?? [], k = favKey(store, item.name);
    const { emoji, name, kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0, sodium = 0 } = item;
    const next = favs.some(f => favKey(f.store, f.name) === k)
      ? favs.filter(f => favKey(f.store, f.name) !== k)
      : [...favs, { store: store || '', name, emoji, kcal, protein, carbs, fat, fiber, sodium }];
    return { ...(foods ?? {}), favorites: next };
  }
  const favItems = foods => (foods?.favorites ?? []).map(f => ({ ...f, ...(foods.stores?.[f.store || '其他']?.items?.[f.name] ?? {}), name: f.name, store: f.store }));

  // 描述裡提到的所有記過的店：長的優先，被更長的命中包含的不算（「八方」在「八方雲集」裡）；「其他」不算店名
  function detectStores(foods, note) {
    if (!note) return [];
    const hits = Object.keys(foods?.stores ?? {}).filter(n => n !== '其他' && note.includes(n));
    return hits.filter(n => !hits.some(o => o !== n && o.includes(n))).sort((a, b) => b.length - a.length);
  }
  const detectStore = (foods, note) => detectStores(foods, note)[0] ?? null;

  // 店家記憶：每個品項記到它自己的店（沒有店名的歸「其他」）；組合不記
  function mergeFoods(foods, meal, dateKey) {
    const stores = { ...(foods?.stores ?? {}) };
    for (const it of meal.items) {
      const name = itemStore(meal, it) || '其他';
      const prev = stores[name] ?? { lastUsed: '', items: {} };
      stores[name] = {
        lastUsed: dateKey > (prev.lastUsed || '') ? dateKey : prev.lastUsed,
        items: { ...prev.items, [it.name]: { emoji: it.emoji, kcal: Math.round(it.kcal), protein: Math.round(it.protein), carbs: Math.round(it.carbs), fat: Math.round(it.fat), fiber: Math.round(it.fiber || 0), sodium: Math.round(it.sodium || 0) } },
      };
    }
    return { ...(foods ?? {}), stores };
  }

  const nutrient = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 3000 ? Math.round(n) : null; };
  function cleanItem(it) {
    if (!it || typeof it !== 'object') return null;
    const name = String(it.name ?? '').trim();
    if (!name) return null;
    const emoji = typeof it.emoji === 'string' && it.emoji.trim() ? Array.from(it.emoji.trim()).slice(0, 8).join('') : '🍽️';
    const out = { emoji, name: name.slice(0, 40) };
    for (const k of NUTRIENTS) { const v = nutrient(it[k]); if (v == null) return null; out[k] = v; }
    for (const k of MICROS) { const n = Number(it[k]); out[k] = Number.isFinite(n) && n >= 0 && n <= (k === 'sodium' ? 10000 : 200) ? Math.round(n) : 0; }
    const q = Number(it.qty);
    out.qty = Number.isFinite(q) && q >= 0.5 && q <= 50 && Number.isInteger(q * 2) ? q : 1;
    for (const k of ['store', 'group', 'portion']) if (typeof it[k] === 'string' && it[k].trim()) out[k] = it[k].trim().slice(0, 30);
    return out;
  }
  function validateEstimate(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items) || !obj.items.length) return { ok: false, error: 'no_items' };
    const items = obj.items.map(cleanItem);
    if (items.some(i => !i)) return { ok: false, error: 'bad_item' };
    const str = v => typeof v === 'string' ? v.trim() : '';
    return { ok: true, value: {
      store: str(obj.store).slice(0, 30),
      summary: str(obj.summary),
      items,
      tips: Array.isArray(obj.tips) ? obj.tips.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()).slice(0, 2) : [],
      question: str(obj.question) || null,
    } };
  }

  // 今天以前 7 天內、有記錄的日子裡，鈉超過上限的天數
  const highSodiumDays = (days, today, limit) =>
    days.filter(d => d.date < today && d.date >= addDays(today, -7) && d.meals?.length && totals(d).sodium > limit).length;

  // 肌力訓練：名稱有「重訓」或「肌力」就算。ponytail: 用名稱判斷，自訂運動取名沒這兩個字就不算
  const isStrength = type => /重訓|肌力/.test(type || '');
  // 這週（週一起算到 today）有做肌力訓練的天數
  const strengthDays = (days, today) => {
    const from = weekStart(today);
    return days.filter(d => d.date >= from && d.date <= today && (d.exercise ?? []).some(e => isStrength(e.type))).length;
  };
  // 一天的運動給教練看：種類、時間或步數、淨消耗
  const exerciseText = list => (list ?? []).map(e =>
    `${e.type}${e.minutes ? ` ${e.minutes} 分` : ''}${e.steps ? ` ${e.steps} 步` : ''}（淨消耗 ${e.net} kcal）`).join('、');

  function weekSummaryText(days, today, s) {
    const done = Math.round((Date.parse(today) - Date.parse(weekStart(today))) / 864e5);   // 這週已經過完的天數（週一＝0）
    const lines = [`今天是 ${today}（週${'一二三四五六日'[done]}），這週已經過完 ${done} 天；今天還沒過完，之後的日子還沒到。`];
    for (const [label, start] of [['上週', addDays(weekStart(today), -7)], ['這週', weekStart(today)]]) {
      lines.push(label + '：');
      for (const p of weekSeries(days, start, s)) {
        if (p.date > today) continue;
        const ex = exerciseText(days.find(d => d.date === p.date)?.exercise);
        lines.push(`${p.date} 熱量 ${p.kcal == null ? '未記錄' : p.kcal + ' kcal'}、蛋白質 ${p.protein ?? '-'} g、碳水 ${p.carbs ?? '-'} g、脂肪 ${p.fat ?? '-'} g、纖維 ${p.fiber ?? '-'} g、鈉 ${p.sodium ?? '-'} mg、飲水 ${p.water ?? 0} ml、運動 ${ex || '無'}、體重 ${p.weight ?? '-'}${p.avg7 ? `（7日平均 ${p.avg7.toFixed(1)}）` : ''}${p.date === today ? '（今天，還在進行中）' : ''}`);
      }
    }
    lines.push(`目標：每日 ${s.target} kcal、蛋白質 ${s.protein} g、飲水 ${s.water} ml、肌力訓練每週 ${s.strengthGoal ?? 3} 次（這週已練 ${strengthDays(days, today)} 天）。`);
    return lines.join('\n');
  }

  // 身體組成（InBody）：有填才回傳一段給教練看的文字；去脂體重用最近的體重估算
  function bodyCompText(s, weight) {
    const parts = [];
    if (s?.bodyFat) parts.push(`體脂率 ${s.bodyFat}%`);
    if (s?.smm) parts.push(`骨骼肌量 ${s.smm} kg`);
    if (s?.visceral) parts.push(`內臟脂肪等級 ${s.visceral}`);
    if (s?.bmrInBody) parts.push(`InBody 基礎代謝 ${s.bmrInBody} kcal`);
    if (!parts.length) return '';
    const lean = leanMass(s, weight);
    if (lean) parts.push(`去脂體重${s.bodyWeight ? '' : '約'} ${lean.toFixed(1)} kg`);
    return `身體組成（InBody${s.bodyDate ? ' ' + s.bodyDate : ''}）：${parts.join('、')}`;
  }

  // 聊天：保存與送出的上限相同，畫面上看到的就是教練記得的
  const CHAT_MAX = 20, CHAT_TEXT_MAX = 4000;
  function trimChat(messages) {
    return (Array.isArray(messages) ? messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map(m => ({ ...m, text: m.text.slice(0, CHAT_TEXT_MAX) }))
      .slice(-CHAT_MAX);
  }

  function todayDetailText(day) {
    const meals = day?.meals ?? [], ex = exerciseText(day?.exercise);
    return mealsDetail(meals) + `\n運動：${ex || '今天還沒有記錄運動。'}`;
  }
  function mealsDetail(meals) {
    if (!meals.length) return '今天還沒有記錄餐點。';
    return meals.map(m => {
      const t = mealTotals(m);
      const items = normalizeMeal(m).items.map(i => `${i.name}×${i.qty}`).join('、');
      return `${m.type}${m.store ? `（${m.store}）` : ''}：${items}，共 ${t.kcal} kcal、蛋白質 ${t.protein} g`;
    }).join('\n');
  }

  // sample 的 turns 要角色交替、以 user 結尾；相鄰同角色（例如上次失敗留下的 user）合併
  function chatTurns(preamble, messages) {
    const turns = [{ role: 'user', content: preamble }, { role: 'assistant', content: '好的。' }];
    let lastDate = '';
    for (const m of messages) {
      // 換日期時標一次，AI 才分得出哪些是之前幾天說的
      const d = m.at ? new Date(m.at) : null;
      const date = d && !isNaN(d) ? `${d.getMonth() + 1}/${d.getDate()}` : '';
      const mark = date && date !== lastDate ? `[${date}]\n` : '';
      if (date) lastDate = date;
      const content = mark + (m.text || (m.image ? '' : '（空）')) + (m.image ? '（附照片）' : '');
      const last = turns[turns.length - 1];
      if (last.role === m.role) last.content += '\n\n' + content;
      else turns.push({ role: m.role, content });
    }
    return turns;
  }

  // 串流中不顯示記餐區塊，也不顯示還沒打完的 <meal 殘片
  const chatVisible = text => String(text ?? '').split('<meal')[0].replace(/<m?e?a?$/, '').trimEnd();

  const CHAT_MEAL_TYPES = ['早餐', '午餐', '晚餐', '點心'];
  function splitMeal(text) {
    const s = String(text ?? '');
    const i = s.lastIndexOf('<meal>');
    if (i < 0) return { text: s.trim(), meal: null };
    const j = s.indexOf('</meal>', i);
    const body = s.slice(i + 6, j < 0 ? undefined : j).trim().replace(/^`{3}(?:json)?\s*|\s*`{3}$/g, '');
    const rest = (s.slice(0, i) + (j < 0 ? '' : s.slice(j + 7))).trim();
    let meal = null;
    try {
      const raw = JSON.parse(body), r = validateEstimate(raw);
      if (r.ok) meal = { mealType: CHAT_MEAL_TYPES.includes(raw.mealType) ? raw.mealType : null, store: r.value.store, summary: r.value.summary, items: r.value.items };
    } catch { /* 壞掉的 JSON：只顯示文字 */ }
    return { text: rest, meal };
  }

  // 一天的表現：熱量和目標（含運動加回）比，蛋白質是否達標
  function dayStatus(day, s) {
    if (!day?.meals?.length) return { kcal: 'none', protein: false };
    const t = totals(day), ratio = t.kcal / (s.target + dayAddBack(day, s.cap, s.goal));
    const [lo, hi] = s.goal === 'bulk' ? [0.9, 1.15] : [0.85, 1.05];
    return { kcal: ratio < lo ? 'under' : ratio > hi ? 'over' : 'good', protein: t.protein >= s.protein };
  }
  // 月曆格：週一開始，前面補 null
  function monthGrid(year, month) {
    const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7, n = new Date(year, month, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)];
  }
  // 這個月（今天以前、含今天）有記錄的天數統計
  function monthSummary(days, year, month, today, s) {
    const prefix = `${year}-${pad(month)}-`, out = { logged: 0, good: 0, over: 0, under: 0, protein: 0 };
    for (const d of days) {
      if (!d.date.startsWith(prefix) || d.date > today) continue;
      const st = dayStatus(d, s);
      if (st.kcal === 'none') continue;
      out.logged++; out[st.kcal]++; if (st.protein) out.protein++;
    }
    return out;
  }

  root.Logic = { MET, NUTRIENTS, dayKey, addDays, diffDays, bmr, tdee, exercise, customMet, leanMass, restingKcal, metFactor, usesSteps, macroTargets, macroState, dayAddBack, suggestTarget, clampTarget, totals, avg7, weekAdvice, lowIntake, defaultMealType,
    normalizeMeal, itemStore, itemTime, mergeSameType, syncMealStore, groupItems, storeLabel, detectStores, mealTotals, mealEmoji, newMeal, setQty, updateItem, addItem, mergeIntoMeal, streak, weekStart, weekSeries, seriesAverage,
    recentItems, storesByRecent, isFavorite, toggleFavorite, favItems, detectStore, mergeFoods, validateEstimate, weekSummaryText, isStrength, strengthDays, exerciseText, MICROS, highSodiumDays, dayStatus, monthGrid, monthSummary,
    bodyCompText, CHAT_MAX, CHAT_TEXT_MAX, trimChat, todayDetailText, chatTurns, chatVisible, splitMeal };
  if (typeof module !== 'undefined') module.exports = root.Logic;
})(typeof window !== 'undefined' ? window : globalThis);
