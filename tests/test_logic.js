// node test_logic.js
const assert = require('assert');
const L = require('../src/core/logic.js');

// 160 cm、60 kg、25 歲：10*60 + 6.25*160 - 125 - 161 = 1314
assert.strictEqual(L.bmr({ weight: 60, height: 160, age: 25 }), 1314);
assert.strictEqual(L.tdee({ weight: 60, height: 160, age: 25, activity: 1.375 }), 1807);

// 重訓 60 分：(3.5-1)*60*1 = 150，加回一半 75；每種運動都算
assert.deepStrictEqual(L.exercise('重訓', { minutes: 60 }, 60), { net: 150 });   // (3.5 − 1) × 60
assert.strictEqual(L.dayAddBack({ exercise: [L.exercise('重訓', { minutes: 60 }, 60)] }, 150), 75);
assert.strictEqual(L.dayAddBack({ exercise: [L.exercise('慢跑', { minutes: 30 }, 60)] }, 150), 90);   // 每種運動都算：180 的一半
assert.strictEqual(L.dayAddBack({ exercise: [L.exercise('慢跑', { minutes: 90 }, 60)] }, 150), 150); // 上限
assert.strictEqual(L.dayAddBack({ exercise: [{ type: '散步', minutes: 20, net: 40, eligible: false }] }, 150), 20);   // 舊紀錄的「不加回」也算

assert.strictEqual(L.addDays('2026-03-01', -1), '2026-02-28');
assert.strictEqual(L.diffDays('2026-10-01', '2026-10-15'), 14);

const days = (ws) => ws.map(([date, weight]) => ({ date, weight }));
const t = '2026-10-15';
assert.strictEqual(L.weekAdvice(days([[t, 60]]), t).level, 'info');
assert.strictEqual(L.weekAdvice(days([[t, 59], ['2026-10-08', 60]]), t).level, 'up');       // 掉 1.7%
assert.strictEqual(L.weekAdvice(days([[t, 59.9], ['2026-10-08', 60]]), t).level, 'ok');
assert.strictEqual(L.weekAdvice(days([[t, 60], ['2026-10-08', 60], ['2026-10-01', 60]]), t).level, 'down');

const meal = kcal => ({ meals: [{ kcal }] });
const low = ['2026-10-14', '2026-10-13', '2026-10-12'].map(date => ({ date, ...meal(1000) }));
assert.strictEqual(L.lowIntake(low, t), true);
assert.strictEqual(L.lowIntake([...low.slice(0, 2), { date: '2026-10-12', ...meal(1400) }], t), false);

assert.strictEqual(L.defaultMealType(8), '早餐');
assert.strictEqual(L.defaultMealType(19), '晚餐');
// ---------- v2 ----------
const v1meal = { id: 'a', time: '12:00', type: '午餐', name: '雞腿便當', portion: '一個', kcal: 750, protein: 35, carbs: 90, fat: 25, confidence: '中' };
const n1 = L.normalizeMeal(v1meal);
assert.strictEqual(n1.items.length, 1);
assert.deepStrictEqual(n1.items[0], { emoji: '🍽️', name: '雞腿便當 一個', qty: 1, kcal: 750, protein: 35, carbs: 90, fat: 25 });
assert.strictEqual(n1.store, '');
assert.strictEqual(n1.id, 'a');
assert.strictEqual(n1.confidence, undefined);
const v2meal = { id: 'b', time: '19:00', type: '晚餐', store: '壽司郎', items: [
  { emoji: '🍣', name: '鮭魚握壽司', qty: 3, kcal: 120, protein: 6, carbs: 18, fat: 3 },
  { emoji: '🍮', name: '茶碗蒸', qty: 1, kcal: 80, protein: 5, carbs: 4, fat: 4.4 }] };
assert.strictEqual(L.normalizeMeal(v2meal), v2meal);
assert.deepStrictEqual(L.mealTotals(v2meal), { kcal: 440, protein: 23, carbs: 58, fat: 13, fiber: 0, sodium: 0 });
assert.strictEqual(L.mealEmoji(v2meal), '🍣');
assert.strictEqual(L.mealEmoji({ items: [] }), '🍽️');
// v1 和 v2 混在同一天
assert.deepStrictEqual(L.totals({ meals: [v1meal, v2meal], water: [250, 500] }), { kcal: 1190, protein: 58, carbs: 148, fat: 38, fiber: 0, sodium: 0, water: 750 });

const nm = L.newMeal('午餐', new Date(2026, 9, 15, 12, 5));
assert.strictEqual(nm.type, '午餐'); assert.strictEqual(nm.time, '12:05'); assert.strictEqual(nm.store, ''); assert.deepStrictEqual(nm.items, []);
assert.ok(nm.id.length >= 6);

assert.strictEqual(L.setQty(v2meal, 0, 5).items[0].qty, 5);
assert.strictEqual(L.setQty(v2meal, 0, 0).items.length, 1);           // 0 = 移除
assert.strictEqual(L.setQty(v2meal, 0, 99).items[0].qty, 50);         // 上限 50
assert.strictEqual(v2meal.items[0].qty, 3);                           // 不改原物件
assert.strictEqual(L.updateItem(v2meal, 1, { kcal: 90 }).items[1].kcal, 90);
assert.strictEqual(L.addItem(v2meal, { emoji: '🍣', name: '鮭魚握壽司', qty: 2, kcal: 120, protein: 6, carbs: 18, fat: 3 }).items[0].qty, 5);
assert.strictEqual(L.addItem(v2meal, { emoji: '🍵', name: '綠茶', kcal: 0, protein: 0, carbs: 0, fat: 0 }).items[2].qty, 1);

const day = (date, n = 1) => ({ date, meals: Array.from({ length: n }, () => ({ items: [] })) });
// 連續達標：熱量 85%–105% 且蛋白質達標才算
const sk = { target: 1500, protein: 100, cap: 150, water: 2000 };
const sd = (date, kcal, protein = 100, water = [2000]) => ({ date, meals: [{ items: [{ name: 'x', qty: 1, kcal, protein, carbs: 0, fat: 0 }] }], exercise: [], water });
assert.strictEqual(L.streak([sd('2026-10-15', 1500), sd('2026-10-14', 1400), sd('2026-10-12', 1500)], '2026-10-15', sk), 2);
assert.strictEqual(L.streak([sd('2026-10-15', 900), sd('2026-10-14', 1500), sd('2026-10-13', 1500)], '2026-10-15', sk), 2);   // 今天還沒達標，從昨天算
assert.strictEqual(L.streak([sd('2026-10-14', 1500, 80), sd('2026-10-13', 1500)], '2026-10-15', sk), 0);   // 蛋白質沒到就斷
assert.strictEqual(L.streak([sd('2026-10-14', 1700), sd('2026-10-13', 1500)], '2026-10-15', sk), 0);      // 熱量超過 105% 就斷
assert.strictEqual(L.streak([day('2026-10-14', 0)], '2026-10-15', sk), 0);
assert.strictEqual(L.streak([sd('2026-10-14', 1500, 100, [500, 500, 500]), sd('2026-10-13', 1500)], '2026-10-15', sk), 0);   // 水只喝 1500 ml 就斷
assert.strictEqual(L.streak([sd('2026-10-14', 1500, 100, [1000, 1000])], '2026-10-15', sk), 1);   // 剛好喝到也算
assert.strictEqual(L.streak([{ ...sd('2026-10-14', 1600), exercise: [{ net: 300 }] }], '2026-10-15', sk), 1);   // 運動加回 150 → 目標 1650，1600 算達標

assert.strictEqual(L.weekStart('2026-10-15'), '2026-10-12');   // 週四 → 週一
assert.strictEqual(L.weekStart('2026-10-18'), '2026-10-12');   // 週日 → 同一週的週一
assert.strictEqual(L.weekStart('2026-10-12'), '2026-10-12');
assert.strictEqual(L.weekStart('2026-03-01'), '2026-02-23');   // 跨月

const S0 = { target: 1450, cap: 150 };
const ws = L.weekSeries([
  { date: '2026-10-13', meals: [v2meal], water: [250], exercise: [{ type: '重訓', minutes: 60, net: 232, eligible: true }], weight: 60 },
  { date: '2026-10-14', meals: [], water: [], exercise: [], weight: null },
], '2026-10-12', S0);
assert.strictEqual(ws.length, 7);
assert.strictEqual(ws[0].date, '2026-10-12'); assert.strictEqual(ws[0].kcal, null); assert.strictEqual(ws[0].water, null);
assert.strictEqual(ws[1].kcal, 440); assert.strictEqual(ws[1].water, 250); assert.strictEqual(ws[1].exerciseNet, 232);
assert.strictEqual(ws[1].weight, 60); assert.strictEqual(ws[1].avg7, 60);
assert.strictEqual(ws[2].kcal, null); assert.strictEqual(ws[2].exerciseNet, null); assert.strictEqual(ws[2].weight, null);
assert.strictEqual(L.seriesAverage(ws, 'kcal'), 440);
assert.strictEqual(L.seriesAverage(ws, 'weight'), 60);
assert.strictEqual(L.seriesAverage([{ kcal: null }], 'kcal'), null);

const rdays = [
  { date: '2026-10-15', meals: [v2meal] },
  { date: '2026-10-14', meals: [{ store: '壽司郎', items: [{ emoji: '🍣', name: '鮭魚握壽司', qty: 1, kcal: 999, protein: 0, carbs: 0, fat: 0 }] }, v1meal] },
  { date: '2026-09-01', meals: [{ store: '', items: [{ emoji: '🍜', name: '牛肉麵', qty: 1, kcal: 600, protein: 30, carbs: 70, fat: 20 }] }] },
];
const ri = L.recentItems(rdays, '2026-10-15', 10);
assert.deepStrictEqual(ri.map(r => r.store + '|' + r.item.name), ['壽司郎|茶碗蒸', '壽司郎|鮭魚握壽司', '|雞腿便當 一個']);
assert.strictEqual(ri[1].item.kcal, 120);        // 取最新的一筆
assert.strictEqual(ri[1].item.qty, undefined);   // 不帶數量
assert.strictEqual(L.recentItems(rdays, '2026-10-15', 1).length, 1);

const foods = { stores: { '壽司郎': { lastUsed: '2026-10-10', items: {} }, '八方雲集': { lastUsed: '2026-10-14', items: {} }, '其他': { lastUsed: '2026-10-15', items: {} } } };
assert.deepStrictEqual(L.storesByRecent(foods), ['其他', '八方雲集', '壽司郎']);
assert.deepStrictEqual(L.storesByRecent(undefined), []);
assert.strictEqual(L.detectStore(foods, '今天去壽司郎吃'), '壽司郎');
assert.strictEqual(L.detectStore(foods, '其他東西'), null);       // 「其他」不算店名
assert.strictEqual(L.detectStore(foods, ''), null);
assert.strictEqual(L.detectStore({ stores: { '八方': {}, '八方雲集': {} } }, '八方雲集鍋貼'), '八方雲集');   // 最長的優先

const merged = L.mergeFoods(foods, v2meal, '2026-10-15');
assert.strictEqual(merged.stores['壽司郎'].lastUsed, '2026-10-15');
assert.deepStrictEqual(merged.stores['壽司郎'].items['茶碗蒸'], { emoji: '🍮', kcal: 80, protein: 5, carbs: 4, fat: 4, fiber: 0, sodium: 0 });
assert.deepStrictEqual(foods.stores['壽司郎'].items, {});          // 不改原物件
const merged2 = L.mergeFoods(undefined, { store: '  ', items: [{ emoji: '🍙', name: '飯糰', qty: 1, kcal: 200, protein: 5, carbs: 40, fat: 3 }] }, '2026-10-15');
assert.ok(merged2.stores['其他'].items['飯糰']);                  // 空白店名 → 其他
const older = L.mergeFoods(merged, { store: '壽司郎', items: [] }, '2026-10-01');
assert.strictEqual(older.stores['壽司郎'].lastUsed, '2026-10-15');  // 補記舊日期不會讓 lastUsed 倒退

const good = L.validateEstimate({ store: ' 壽司郎 ', summary: '還行 🍣', items: [
  { emoji: '🍣', name: '鮭魚', qty: 3, kcal: '120', protein: 6, carbs: 18, fat: 3 },
  { name: '味噌湯', qty: 0, kcal: 40, protein: 2, carbs: 4, fat: 1.6 },
  { emoji: '🍵', name: '茶', qty: 2.5, kcal: 0, protein: 0, carbs: 0, fat: 0 }],
  tips: ['a', 'b', 'c', '', 5], question: '  ' });
assert.strictEqual(good.ok, true);
assert.strictEqual(good.value.store, '壽司郎');
assert.strictEqual(good.value.items[0].kcal, 120);
assert.strictEqual(good.value.items[1].emoji, '🍽️');
assert.strictEqual(good.value.items[1].qty, 1);
assert.strictEqual(good.value.items[1].fat, 2);
assert.strictEqual(good.value.items[2].qty, 2.5);
assert.deepStrictEqual(good.value.tips, ['a', 'b']);
assert.strictEqual(good.value.question, null);
assert.strictEqual(L.validateEstimate({ items: [] }).ok, false);
assert.strictEqual(L.validateEstimate(null).ok, false);
assert.strictEqual(L.validateEstimate({ items: [{ name: 'x', kcal: 1, protein: 0, carbs: 0, fat: 0, portion: ' 約 250 g（1.5 碗） ' }] }).value.items[0].portion, '約 250 g（1.5 碗）');
assert.strictEqual(L.validateEstimate({ items: [{ name: 'x', kcal: 1, protein: 0, carbs: 0, fat: 0, portion: 250 }] }).value.items[0].portion, undefined);
assert.strictEqual(L.validateEstimate({ items: [{ name: 'x', kcal: -5, protein: 0, carbs: 0, fat: 0 }] }).ok, false);
assert.strictEqual(L.validateEstimate({ items: [{ name: 'x', kcal: 3001, protein: 0, carbs: 0, fat: 0 }] }).ok, false);
assert.strictEqual(L.validateEstimate({ items: [{ name: '', kcal: 1, protein: 0, carbs: 0, fat: 0 }] }).ok, false);
assert.strictEqual(L.validateEstimate({ items: [{ name: 'x', kcal: 'abc', protein: 0, carbs: 0, fat: 0 }] }).ok, false);

const txt = L.weekSummaryText([{ date: '2026-10-13', meals: [v2meal], water: [250], exercise: [], weight: 60 }], '2026-10-15', { target: 1450, protein: 100, water: 2000, cap: 150 });
assert.ok(txt.includes('這週'));
assert.ok(txt.includes('2026-10-13 熱量 440 kcal'));
assert.ok(!txt.includes('2026-10-16'));          // 不列未來的日期
assert.ok(txt.includes('目標：每日 1450 kcal'));
// ---------- 纖維與鈉 ----------
const salty = { items: [
  { emoji: '🍜', name: '豚骨拉麵', qty: 1, kcal: 700, protein: 25, carbs: 80, fat: 28, fiber: 3, sodium: 2800 },
  { emoji: '🥚', name: '溏心蛋', qty: 2, kcal: 70, protein: 6, carbs: 0, fat: 5, fiber: 0, sodium: 150.4 }] };
assert.deepStrictEqual(L.mealTotals(salty), { kcal: 840, protein: 37, carbs: 80, fat: 38, fiber: 3, sodium: 3101 });
const vm2 = L.validateEstimate({ items: [{ name: 'x', kcal: 1, protein: 0, carbs: 0, fat: 0, fiber: '4', sodium: 99999 }] });
assert.strictEqual(vm2.ok, true);                       // 選填欄位不合法不會讓估算失敗
assert.strictEqual(vm2.value.items[0].fiber, 4);
assert.strictEqual(vm2.value.items[0].sodium, 0);
assert.strictEqual(L.validateEstimate({ items: [{ name: 'x', kcal: 1, protein: 0, carbs: 0, fat: 0 }] }).value.items[0].sodium, 0);
assert.strictEqual(L.mergeFoods(undefined, { store: '一蘭', ...salty }, '2026-10-15').stores['一蘭'].items['豚骨拉麵'].sodium, 2800);
const sdays = [
  { date: '2026-10-14', meals: [salty] }, { date: '2026-10-13', meals: [salty] }, { date: '2026-10-12', meals: [v2meal] },
  { date: '2026-10-15', meals: [salty] }, { date: '2026-10-01', meals: [salty] }];
assert.strictEqual(L.highSodiumDays(sdays, '2026-10-15', 2300), 2);   // 不含今天，只看前 7 天
assert.strictEqual(L.weekSeries(sdays, '2026-10-12', { target: 1450, cap: 150 })[2].sodium, 3101);
assert.ok(L.weekSummaryText(sdays, '2026-10-15', { target: 1450, protein: 100, water: 2000, cap: 150 }).includes('鈉 3101 mg'));
assert.strictEqual(L.customMet(400, 60, 60), 6.7);
assert.strictEqual(L.customMet(10, 60, 60), 1);          // 下限 1
assert.strictEqual(L.customMet(9000, 60, 10), 20);       // 上限 20
assert.deepStrictEqual(L.exercise('飛輪課', { minutes: 60 }, 60, { customEx: { 飛輪課: 6.7 } }), { net: 342 });
assert.strictEqual(L.exercise('不存在', { minutes: 30 }, 60).net, Math.round(3 * 60 * 0.5));   // 預設 MET 4
assert.deepStrictEqual(L.macroTargets({ target: 1450, protein: 100 }), { protein: 100, fat: 48, carbs: 154 });
const g = L.monthGrid(2026, 10);                 // 2026-10-01 是週四
assert.strictEqual(g.length, 34);
assert.deepStrictEqual(g.slice(0, 4), [null, null, null, '2026-10-01']);
assert.strictEqual(g.at(-1), '2026-10-31');
assert.strictEqual(L.monthGrid(2026, 2).length, 34);   // 2026-02-01 是週日 → 前面 6 格 + 28 天
const sCal = { target: 1450, protein: 100, cap: 150 };
const md = (kcal, protein = 50) => ({ meals: [{ kcal, protein }] });
assert.deepStrictEqual(L.dayStatus(md(1300, 100), sCal), { kcal: 'good', protein: true });
assert.strictEqual(L.dayStatus(md(1600), sCal).kcal, 'over');
assert.strictEqual(L.dayStatus(md(1000), sCal).kcal, 'under');
assert.deepStrictEqual(L.dayStatus({ meals: [] }, sCal), { kcal: 'none', protein: false });
assert.deepStrictEqual(L.dayStatus(undefined, sCal), { kcal: 'none', protein: false });
assert.strictEqual(L.dayStatus({ ...md(1600), exercise: [{ net: 400, eligible: true }] }, sCal).kcal, 'good');  // 加回 150 → 目標 1600
const mdays = [
  { date: '2026-10-01', ...md(1300, 100) }, { date: '2026-10-02', ...md(1700) }, { date: '2026-10-03', ...md(900) },
  { date: '2026-10-04', meals: [] }, { date: '2026-10-20', ...md(1300) }, { date: '2026-09-30', ...md(1300) }];
assert.deepStrictEqual(L.monthSummary(mdays, 2026, 10, '2026-10-15', sCal), { logged: 3, good: 1, over: 1, under: 1, protein: 1 });
const egg = { emoji: '🥚', name: '水煮蛋', qty: 2, kcal: 70, protein: 6, carbs: 1, fat: 5 };
const baseMeal = { id: 'b1', type: '早餐', time: '08:00', store: '', items: [egg] };
const powder = { emoji: '🥤', name: '乳清蛋白粉', qty: 1, kcal: 120, protein: 24, carbs: 3, fat: 2 };
const merged3 = L.mergeIntoMeal(baseMeal, [{ ...egg, qty: 1 }, powder], '好市多');
assert.strictEqual(merged3.items.length, 3);   // 原品項沒有店名，新蛋是「好市多」的蛋，不合併
assert.strictEqual(merged3.items[0].qty, 2); assert.strictEqual(merged3.items[0].store, '');
assert.strictEqual(merged3.items[1].name, '水煮蛋'); assert.strictEqual(merged3.items[1].store, '好市多');
assert.strictEqual(merged3.items[2].name, '乳清蛋白粉'); assert.strictEqual(merged3.items[2].store, '好市多');
for (const x of merged3.items) assert.ok(Object.values(x).every(v => v !== undefined));
assert.strictEqual(merged3.id, 'b1'); assert.strictEqual(merged3.type, '早餐'); assert.strictEqual(merged3.time, '08:00');
assert.strictEqual(merged3.store, '');
assert.strictEqual(baseMeal.items.length, 1); assert.strictEqual(baseMeal.items[0].qty, 2);   // 不改原物件
const cross = L.mergeIntoMeal({ ...baseMeal, store: '全家' }, [powder], '好市多');
assert.strictEqual(cross.store, '');                      // 兩家店 → 整餐店名留白
assert.strictEqual(cross.items[0].store, '全家');          // 原本的品項不能失去店名
assert.strictEqual(cross.items[1].store, '好市多');

// 聊天：裁切、明細、turns、串流顯示、記餐區塊
const msgs = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'm' + i, at: String(i) }));
const trimmed = L.trimChat([...msgs, null, { role: 'system', text: 'x' }, { role: 'user', text: 5 }]);
assert.strictEqual(trimmed.length, 20);
assert.strictEqual(trimmed[0].text, 'm5');
assert.strictEqual(trimmed[19].text, 'm24');
assert.strictEqual(L.trimChat([{ role: 'user', text: 'x'.repeat(5000) }])[0].text.length, 4000);
assert.deepStrictEqual(L.trimChat(undefined), []);
assert.notStrictEqual(L.trimChat(msgs)[0], msgs[5]);   // 回傳新物件

assert.strictEqual(L.todayDetailText({ meals: [] }), '今天還沒有記錄餐點。\n運動：今天還沒有記錄運動。');
const detail = L.todayDetailText({ meals: [{ id: 'x', type: '午餐', time: '12:00', store: '八方雲集', items: [
  { emoji: '🥟', name: '鍋貼', qty: 10, kcal: 50, protein: 2, carbs: 5, fat: 2 },
  { emoji: '🍜', name: '酸辣湯', qty: 1, kcal: 120, protein: 6, carbs: 12, fat: 5 }] }] });
assert.strictEqual(detail, '午餐（八方雲集）：鍋貼×10、酸辣湯×1，共 620 kcal、蛋白質 26 g\n運動：今天還沒有記錄運動。');
assert.strictEqual(L.todayDetailText({ meals: [], exercise: [{ type: '重訓', minutes: 40, net: 75 }, { type: '散步', steps: 6000, net: 90 }] }),
  '今天還沒有記錄餐點。\n運動：重訓 40 分（淨消耗 75 kcal）、散步 6000 步（淨消耗 90 kcal）');
// 肌力訓練：名稱有重訓或肌力；這週（週一起）有練的天數
assert.ok(L.isStrength('重訓') && L.isStrength('功能性肌力訓練') && !L.isStrength('慢跑'));
const exDays = [{ date: '2026-10-12', exercise: [{ type: '重訓', net: 1 }, { type: '功能性肌力訓練', net: 1 }] }, { date: '2026-10-14', exercise: [{ type: '慢跑', net: 1 }] },
  { date: '2026-10-15', exercise: [{ type: '功能性肌力訓練', net: 1 }] }, { date: '2026-10-11', exercise: [{ type: '重訓', net: 1 }] }];
assert.strictEqual(L.strengthDays(exDays, '2026-10-15'), 2);   // 10-11 是上週日
const wtxt = L.weekSummaryText(exDays, '2026-10-15', { target: 1450, protein: 100, water: 2000, cap: 150 });
assert.ok(wtxt.includes('2026-10-14 熱量 未記錄') && wtxt.includes('運動 慢跑（淨消耗 1 kcal）'));
assert.ok(wtxt.includes('運動 無'));
assert.ok(wtxt.includes('肌力訓練每週 3 次（這週已練 2 天）'));

const turns = L.chatTurns('規則', [
  { role: 'user', text: '第一句' }, { role: 'user', text: '', image: true },
  { role: 'assistant', text: '回答' }, { role: 'user', text: '這個呢', image: true }]);
assert.deepStrictEqual(turns, [
  { role: 'user', content: '規則' }, { role: 'assistant', content: '好的。' },
  { role: 'user', content: '第一句\n\n（附照片）' }, { role: 'assistant', content: '回答' },
  { role: 'user', content: '這個呢（附照片）' }]);
assert.deepStrictEqual(L.chatTurns('規則', [{ role: 'assistant', text: '嗨' }, { role: 'user', text: '問' }]).map(t => t.role), ['user', 'assistant', 'user']);

const dated = L.chatTurns('規則', [
  { role: 'user', text: '昨天', at: '2026-10-20T12:00:00' }, { role: 'assistant', text: '好', at: '2026-10-20T12:01:00' },
  { role: 'user', text: '今天', at: '2026-10-21T09:00:00' }, { role: 'assistant', text: '嗯', at: '2026-10-21T09:01:00' }]).slice(2).map(t => t.content);
assert.deepStrictEqual(dated, ['[10/20]\n昨天', '好', '[10/21]\n今天', '嗯'], '換日期時標一次');
assert.strictEqual(L.chatVisible('多吃蛋白質。\n<meal>{"items"'), '多吃蛋白質。');
assert.strictEqual(L.chatVisible('多吃蛋白質。\n<me'), '多吃蛋白質。');
assert.strictEqual(L.chatVisible('a < b'), 'a < b');

const mealJson = '{"mealType":"午餐","store":"","summary":"不錯","items":[{"emoji":"🍱","name":"雞腿便當","qty":1,"kcal":780,"protein":35,"carbs":90,"fat":28,"fiber":4,"sodium":1500}]}';
let sm = L.splitMeal(`幫你整理好了。\n<meal>${mealJson}</meal>`);
assert.strictEqual(sm.text, '幫你整理好了。');
assert.strictEqual(sm.meal.mealType, '午餐');
assert.strictEqual(sm.meal.items[0].name, '雞腿便當');
const fence = '`'.repeat(3);
sm = L.splitMeal(`好。\n<meal>\n${fence}json\n${mealJson.replace('午餐', '宵夜')}\n${fence}\n</meal>`);
assert.strictEqual(sm.meal.items[0].kcal, 780);           // 有圍欄照樣解析
assert.strictEqual(sm.meal.mealType, null);               // 不合法的餐別交給畫面依時間判斷
sm = L.splitMeal('好。<meal>{壞掉</meal>');
assert.deepStrictEqual(sm, { text: '好。', meal: null });
sm = L.splitMeal('好。<meal>{"items":[]}</meal>');
assert.strictEqual(sm.meal, null);                        // 沒通過 validateEstimate
sm = L.splitMeal('只是聊天');
assert.deepStrictEqual(sm, { text: '只是聊天', meal: null });
sm = L.splitMeal(`好。<meal>${mealJson}`);              // 沒有結尾標籤
assert.strictEqual(sm.text, '好。');
assert.strictEqual(sm.meal.items.length, 1);
assert.ok(L.chatTurns('規則', [{ role: 'user', text: '問' }, { role: 'assistant', text: '' }, { role: 'user', text: '再問' }]).every(t => t.content.length > 0), 'chatTurns 不可有空內容');
assert.strictEqual(L.macroState('protein', 100, 100), 'good');   // 蛋白質吃到就達標
assert.strictEqual(L.macroState('protein', 99, 100), '');
assert.strictEqual(L.macroState('carbs', 151, 150), 'over');
assert.strictEqual(L.macroState('fat', 48, 48), '');
assert.strictEqual(L.macroTargets({ protein: 100, target: 1600 }).fat, 53);   // 加回後的熱量 → 脂肪目標跟著變
assert.strictEqual(L.bodyCompText({ bodyFat: 30, smm: 20, visceral: 8, bodyDate: '2026-01-02' }, 60),
  '身體組成（InBody 2026-01-02）：體脂率 30%、骨骼肌量 20 kg、內臟脂肪等級 8、去脂體重約 42.0 kg');
assert.strictEqual(L.bodyCompText({ smm: 20 }, 60), '身體組成（InBody）：骨骼肌量 20 kg');
assert.strictEqual(L.bodyCompText({ target: 1450 }, 60), '');
// InBody 當基準：去脂體重用量測時體重算，基礎代謝優先用 InBody 的數字
assert.strictEqual(L.leanMass({ bodyFat: 30, bodyWeight: 60 }, 55), 42);          // 不隨目前體重變
assert.strictEqual(L.leanMass({ bodyFat: 30 }, 55), 38.5);                       // 沒填量測時體重才用目前體重
assert.strictEqual(L.restingKcal({ bmrInBody: 1100, bodyFat: 30 }, 60), 1100);
assert.strictEqual(L.restingKcal({ bodyFat: 30, bodyWeight: 60 }, 55), 370 + 21.6 * 42);
assert.strictEqual(L.metFactor({ bmrInBody: 1200 }, 50), 1);                     // 1200 ÷ (50 × 24)
assert.strictEqual(L.bodyCompText({ bodyFat: 30, bodyWeight: 60, bmrInBody: 1100 }, 55),
  '身體組成（InBody）：體脂率 30%、InBody 基礎代謝 1100 kcal、去脂體重 42.0 kg');
// 多店家與組合
const it = (name, kcal, extra = {}) => ({ emoji: '🍽️', name, qty: 1, kcal, protein: 0, carbs: 0, fat: 0, ...extra });
const legacy = { id: 'x', type: '早餐', time: '08:00', store: '全家', items: [it('飯糰', 200)] };
assert.strictEqual(L.itemStore(legacy, legacy.items[0]), '全家');            // 舊資料沿用整餐店名
assert.strictEqual(L.itemStore(legacy, it('拿鐵', 150, { store: ' 星巴克 ' })), '星巴克');
assert.strictEqual(L.normalizeMeal(legacy), legacy);                          // v2 原樣回傳

const synced = L.syncMealStore({ ...legacy, items: [...legacy.items, it('拿鐵', 150, { store: '星巴克' })] });
assert.strictEqual(synced.store, '');
assert.deepStrictEqual(synced.items.map(x => x.store), ['全家', '星巴克']);
assert.strictEqual(L.syncMealStore(legacy).store, '全家');
assert.strictEqual(L.syncMealStore(legacy).items[0].store, '全家');
assert.strictEqual(L.syncMealStore({ ...legacy, items: [] }).store, '全家');   // 沒有品項：保留
assert.strictEqual(legacy.items[0].store, undefined);                          // 不改原物件

// 份數 0.5
const half = { ...legacy, items: [it('白飯', 280, { qty: 0.5 })] };
assert.strictEqual(L.setQty(half, 0, 0.5 + 0.5).items[0].qty, 1);
assert.strictEqual(L.setQty(half, 0, 0.5 - 0.5).items.length, 0);             // 0 → 刪除
assert.strictEqual(L.setQty(half, 0, 60).items[0].qty, 50);                   // 上限 50
assert.strictEqual(L.setQty(half, 0, 0.74).items[0].qty, 0.5);                // 四捨五入到 0.5
assert.strictEqual(L.setQty(half, 0, 1.3 - 0.1 - 0.1 - 0.1).items[0].qty, 1);  // 浮點誤差不影響
assert.strictEqual(L.validateEstimate({ items: [it('飯', 100, { qty: 0.5 })] }).value.items[0].qty, 0.5);
assert.strictEqual(L.validateEstimate({ items: [it('飯', 100, { qty: 0.3 })] }).value.items[0].qty, 1);

// addItem：同店同名同組合才合併
const shop = { ...legacy, store: '', items: [it('茶', 0, { store: 'A' })] };
assert.strictEqual(L.addItem(shop, it('茶', 0, { store: 'A' })).items[0].qty, 2);
assert.strictEqual(L.addItem(shop, it('茶', 0, { store: 'B' })).items.length, 2);
assert.strictEqual(L.addItem(shop, it('茶', 0, { store: 'A', group: '套餐' })).items.length, 2);

// cleanItem 保留 store、group
const vg = L.validateEstimate({ store: '', items: [it('雞腿', 350, { store: ' 池上 ', group: '雞腿便當' }), it('拿鐵', 150, { store: 5, group: '' })] });
assert.strictEqual(vg.value.items[0].store, '池上');
assert.strictEqual(vg.value.items[0].group, '雞腿便當');
assert.strictEqual('store' in vg.value.items[1], false);                      // 非字串丟掉
assert.strictEqual('group' in vg.value.items[1], false);                      // 空字串丟掉
assert.strictEqual(L.validateEstimate({ items: [it('x', 1, { group: 'g'.repeat(40) })] }).value.items[0].group.length, 30);

// groupItems：依店分段、沒店名在最後、組合收成一列
const mixed = { id: 'm', type: '午餐', time: '12:00', store: '', items: [
  it('雜項', 50, { store: '' }),
  it('雞腿', 350, { store: '池上', group: '雞腿便當' }),
  it('白飯', 280, { store: '池上', group: '雞腿便當', qty: 0.5 }),
  it('紅茶', 100, { store: '池上' }),
  it('拿鐵', 150, { store: '星巴克' })] };
const secs = L.groupItems(mixed);
assert.deepStrictEqual(secs.map(s => [s.store, s.kcal]), [['池上', 590], ['星巴克', 150], ['', 50]]);
assert.strictEqual(secs[0].entries.length, 2);
assert.strictEqual(secs[0].entries[0].group, '雞腿便當');
assert.strictEqual(secs[0].entries[0].kcal, 490);
assert.deepStrictEqual(secs[0].entries[0].items.map(x => x.i), [1, 2]);
assert.strictEqual(secs[0].entries[1].i, 3);
assert.strictEqual(L.groupItems(legacy)[0].store, '全家');                    // 舊資料
assert.strictEqual(L.storeLabel(mixed), '池上・星巴克');
assert.strictEqual(L.storeLabel(legacy), '全家');
assert.strictEqual(L.storeLabel({ store: '老店', items: [] }), '老店');

// mergeIntoMeal：原有品項保留自己的店名（沒有店名的不會被改成新店）
const noStore = { id: 'n', type: '早餐', time: '08:00', store: '', items: [it('蛋', 70)] };
const adopt = L.mergeIntoMeal(noStore, [it('蛋', 70)], '好市多');
assert.strictEqual(adopt.store, '');
assert.strictEqual(adopt.items.length, 2);
assert.strictEqual(adopt.items[0].store, ''); assert.strictEqual(adopt.items[1].store, '好市多');
for (const x of L.syncMealStore(noStore).items) assert.ok(Object.values(x).every(v => v !== undefined));

// mergeFoods：依品項店名、不存 group
const mf = L.mergeFoods({ stores: {} }, mixed, '2026-10-15');
assert.deepStrictEqual(Object.keys(mf.stores).sort(), ['其他', '星巴克', '池上'].sort());
assert.ok(mf.stores['池上'].items['雞腿']);
assert.strictEqual('group' in mf.stores['池上'].items['雞腿'], false);
assert.strictEqual(mf.stores['星巴克'].lastUsed, '2026-10-15');

// recentItems：依品項店名
const rr = L.recentItems([{ date: '2026-10-15', meals: [mixed] }], '2026-10-15', 10);
assert.ok(rr.some(r => r.store === '星巴克' && r.item.name === '拿鐵'));

// detectStores
const fs2 = { stores: { '八方': {}, '八方雲集': {}, '全家': {}, '其他': {} } };
assert.deepStrictEqual(L.detectStores(fs2, '八方雲集鍋貼、全家豆漿'), ['八方雲集', '全家']);
assert.deepStrictEqual(L.detectStores(fs2, ''), []);
assert.strictEqual(L.detectStore(fs2, '全家'), '全家');

// 運動：身體資料校正、步數
assert.strictEqual(L.metFactor({}, 60), 1);
assert.strictEqual(L.metFactor({ bodyFat: 30 }, 60).toFixed(3), '0.887');                 // (370 + 21.6 × 42) ÷ (60 × 24)
assert.strictEqual(L.metFactor({ bodyFat: 60 }, 60), 0.7);                                 // 下限
assert.strictEqual(L.metFactor({ age: 30, height: 165 }, 60), Math.round(10 * 60 + 6.25 * 165 - 150 - 161) / 1440);   // bmr 先四捨五入
assert.strictEqual(L.exercise('重訓', { minutes: 60 }, 60, { bodyFat: 30 }).net, 133);    // 150 × 0.887
assert.strictEqual(L.exercise('快走', { steps: 10000 }, 60, { height: 160 }).net, 199);   // 6.64 km × 0.5 × 60
assert.strictEqual(L.exercise('慢跑', { steps: 5000, minutes: 99 }, 60, { height: 160 }).net, 281);   // 有步數就用步數
assert.strictEqual(L.exercise('瑜伽', { steps: 5000, minutes: 60 }, 60).net, 90);         // 瑜伽不用步數
assert.strictEqual(L.usesSteps('散步'), true);
assert.strictEqual(L.usesSteps('重訓'), false);

// 同餐別合併、品項時間
const bk1 = { id: 'b1', type: '晚餐', time: '20:10', store: 'Sukiya', items: [it('牛丼', 380)] };
const bk2 = { id: 'b2', type: '晚餐', time: '20:12', store: 'Tryall', items: [it('乳清', 122)] };
const bk3 = { id: 'b3', type: '早餐', time: '08:00', store: '', items: [it('蛋', 70)] };
const ms = L.mergeSameType([bk1, bk3, bk2]);
assert.strictEqual(ms.length, 2);
assert.strictEqual(ms[0].id, 'b1');
assert.strictEqual(ms[0].time, '20:10');
assert.deepStrictEqual(ms[0].items.map(x => [x.name, x.store, x.time]), [['牛丼', 'Sukiya', '20:10'], ['乳清', 'Tryall', '20:12']]);
assert.strictEqual(ms[0].store, '');
assert.strictEqual(ms[1], bk3);                                        // 沒有合併的餐原樣保留
assert.strictEqual(L.mergeSameType([bk1, bk2, { ...bk2, id: 'b4', time: '21:00' }])[0].items.length, 3);
assert.deepStrictEqual(L.groupItems(ms[0]).map(s => [s.store, s.time]), [['Sukiya', '20:10'], ['Tryall', '20:12']]);
assert.strictEqual(L.itemTime(bk1, bk1.items[0]), '20:10');
assert.strictEqual(bk1.items[0].time, undefined);                      // 不改原物件
// 增重 bulk
const B = { goal: 'bulk', target: 2200, protein: 100, cap: 300, water: 2000 };
assert.strictEqual(L.bmr({ weight: 52.3, height: 172, age: 26, sex: 'm' }), Math.round(523 + 1075 - 130 + 5));
assert.strictEqual(L.bmr({ weight: 60, height: 160, age: 25 }), Math.round(600 + 1000 - 125 - 161));   // 沒填 sex 用女性
assert.strictEqual(L.suggestTarget(1820, B), 2220);
assert.strictEqual(L.suggestTarget(1400, {}), 1200);                         // 減脂最低 1,200
assert.strictEqual(L.clampTarget(1100, B), 1100);
assert.strictEqual(L.clampTarget(1100, {}), 1200);
assert.strictEqual(L.dayAddBack({ exercise: [{ net: 200 }] }, 300, 'bulk'), 200);   // 全部加回
assert.strictEqual(L.dayAddBack({ exercise: [{ net: 400 }] }, 300, 'bulk'), 300);   // 上限
assert.strictEqual(L.macroState('fat', 90, 73, 'bulk'), '');                        // 增重不警告超量
assert.strictEqual(L.macroState('protein', 100, 100, 'bulk'), 'good');
const bm = kcal => ({ meals: [{ kcal, protein: 100 }] });
assert.strictEqual(L.dayStatus(bm(2000), B).kcal, 'good');    // 91%
assert.strictEqual(L.dayStatus(bm(1950), B).kcal, 'under');   // 89%
assert.strictEqual(L.dayStatus(bm(2500), B).kcal, 'good');    // 114%
assert.strictEqual(L.dayStatus(bm(2560), B).kcal, 'over');    // 116%
assert.strictEqual(L.dayStatus({ ...bm(2350), exercise: [{ net: 200 }] }, B).kcal, 'good');   // 目標 2400
assert.strictEqual(L.dayStatus({ ...bm(1950), exercise: [{ net: 200 }] }, B).kcal, 'under');  // 81%
assert.strictEqual(L.weekAdvice(days([[t, 53], ['2026-10-08', 52.3]]), t, B).delta, -100);     // +0.7 kg
assert.strictEqual(L.weekAdvice(days([[t, 52.3], ['2026-10-08', 52.3], ['2026-10-01', 52.4]]), t, B).delta, 150);
assert.strictEqual(L.weekAdvice(days([[t, 52.3], ['2026-10-08', 52.3], ['2026-10-01', 52]]), t, B).level, 'info');
assert.strictEqual(L.weekAdvice(days([[t, 52.6], ['2026-10-08', 52.3]]), t, B).level, 'ok');
assert.strictEqual(L.weekAdvice(days([[t, 59], ['2026-10-08', 60]]), t).level, 'up');         // 沒給 s 照減脂
const blow = ['2026-10-14', '2026-10-13', '2026-10-12'].map(date => ({ date, ...meal(1800) }));
assert.strictEqual(L.lowIntake(blow, t, B), true);                                             // < 1,870
assert.strictEqual(L.lowIntake([...blow.slice(0, 2), { date: '2026-10-12', ...meal(1900) }], t, B), false);
assert.strictEqual(L.lowIntake(blow, t), false);                                               // 減脂只看 1,200
// 增肌減脂 recomp
const R = { goal: 'recomp', target: 1900, protein: 100, cap: 300, water: 2000 };
assert.strictEqual(L.goalOf({}).key, 'cut');
assert.strictEqual(L.goalOf(undefined).key, 'cut');
assert.strictEqual(L.goalOf({ goal: 'x' }).key, 'cut');
assert.strictEqual(L.goalOf(R).word, '增肌減脂');
assert.strictEqual(L.suggestTarget(2000, R), 1900);
assert.strictEqual(L.suggestTarget(1250, R), 1200);           // 下限
assert.strictEqual(L.clampTarget(1000, R), 1200);
assert.strictEqual(L.dayAddBack({ exercise: [{ net: 200 }] }, 150, 'recomp'), 100);
assert.strictEqual(L.macroState('fat', 80, 60, 'recomp'), 'over');
assert.strictEqual(L.dayStatus(bm(1672), R).kcal, 'under');   // 88%
assert.strictEqual(L.dayStatus(bm(1748), R).kcal, 'good');    // 92%
{
  const a1 = L.weekAdvice(days([[t, 59.6], ['2026-10-08', 60]]), t, R);     // -0.67%
  assert.strictEqual(a1.delta, 100); assert.strictEqual(a1.level, 'up'); assert.ok(a1.text.includes('降了 0.7%'));
  const a2 = L.weekAdvice(days([[t, 60.4], ['2026-10-08', 60]]), t, R);     // +0.67%
  assert.strictEqual(a2.delta, -100); assert.strictEqual(a2.level, 'down'); assert.ok(a2.text.includes('升了 0.7%'));
  const a3 = L.weekAdvice(days([[t, 60.1], ['2026-10-08', 60]]), t, R);     // +0.17%
  assert.strictEqual(a3.delta, undefined); assert.strictEqual(a3.level, 'ok');
}
assert.strictEqual(L.lowIntake(['2026-10-14', '2026-10-13', '2026-10-12'].map(date => ({ date, ...meal(1100) })), t, R), true);
console.log('ok');

// 我的最愛：切換、營養以店家清單為準、不同店同名分開
{
  const egg = { emoji: '🥚', name: '水煮蛋', kcal: 48, protein: 5, carbs: 1, fat: 3 };
  let f = { stores: { '石安牧場': { items: { '水煮蛋': { ...egg, kcal: 50 } } } } };
  f = L.toggleFavorite(f, '石安牧場', egg);
  assert.ok(L.isFavorite(f, '石安牧場', '水煮蛋') && !L.isFavorite(f, '', '水煮蛋'));
  assert.strictEqual(L.favItems(f)[0].kcal, 50, '營養用店家清單最新的');
  f = L.toggleFavorite(f, '', { ...egg, name: '乳清' });
  assert.deepStrictEqual(L.favItems(f).map(x => x.name + '@' + x.store), ['水煮蛋@石安牧場', '乳清@'], '沒有店名的品項用快照');
  f = L.toggleFavorite(f, '石安牧場', egg);
  assert.deepStrictEqual(L.favItems(f).map(x => x.name), ['乳清']);
  assert.ok(f.stores['石安牧場'], '不動到店家清單');
  assert.deepStrictEqual(L.favItems({ stores: {} }), []);
}

// 週摘要以今天為基準：標出今天、不列之後的日子
{
  const t = L.weekSummaryText([{ date: '2026-11-17', meals: [{ type: '早餐', items: [{ name: '蛋', qty: 1, kcal: 70, protein: 6, carbs: 0, fat: 5 }] }] }], '2026-11-17', { target: 1450, protein: 90, water: 2000 });
  assert.ok(t.startsWith('今天是 2026-11-17（週二），這週已經過完 1 天'), t.split('\n')[0]);
  assert.ok(t.includes('2026-11-17 熱量 70 kcal') && t.includes('（今天，還在進行中）'));
  assert.ok(!t.includes('2026-11-18'), '之後的日子不列');
}

// 目標體重＋期限：每日熱量差 = 差幾公斤 × 7700 ÷ 天數，速度有上限
{
  const today = '2026-01-01';
  const cut = { goal: 'cut', targetWeight: 58, targetDate: '2026-03-26' };   // 12 週減 2 kg
  let p = L.weightPlan(2000, cut, 60, today);
  assert.strictEqual(p.target, 1820);                 // 2000 − 2/12×7700/7 ≈ 1817 → 1820
  assert.strictEqual(p.protein, 96);                  // 60 × 1.6
  assert.strictEqual(p.capped, false);
  assert.strictEqual(p.weekly, -0.16);
  assert.strictEqual(p.weeksNeeded, null);
  // 太快：4 週減 6 kg → 上限每週 1%（0.6 kg）
  p = L.weightPlan(2000, { ...cut, targetWeight: 54, targetDate: '2026-01-29' }, 60, today);
  assert.strictEqual(p.capped, true);
  assert.strictEqual(p.target, 1340);                 // 2000 − 0.6×1100 = 1340
  assert.strictEqual(p.weeksNeeded, 10);   // 6 ÷ 0.6
  // 套 1,200 下限後，回報的是實際速度
  p = L.weightPlan(1500, { ...cut, targetWeight: 54, targetDate: '2026-01-29' }, 60, today);
  assert.strictEqual(p.target, 1200);
  assert.strictEqual(p.weekly, -0.27);
  assert.strictEqual(p.weeksNeeded, 23);   // 6 ÷ 0.27
  // 方向不對：減脂卻要變重；增重卻要變輕
  assert.strictEqual(L.weightPlan(2000, { ...cut, targetWeight: 62 }, 60, today).error, 'direction');
  assert.strictEqual(L.weightPlan(2000, { goal: 'bulk', targetWeight: 58, targetDate: '2026-03-26' }, 60, today).error, 'direction');
  // 增重：上限每週 0.5%
  p = L.weightPlan(2000, { goal: 'bulk', targetWeight: 66, targetDate: '2026-02-26' }, 60, today);
  assert.strictEqual(p.capped, true);
  assert.strictEqual(p.target, 2330);                 // 2000 + 0.3×1100
  // 沒填目標或是增肌減脂：沿用固定差值
  assert.strictEqual(L.weightPlan(2000, { goal: 'cut' }, 60, today).target, 1700);
  assert.strictEqual(L.weightPlan(2000, { goal: 'recomp', targetWeight: 55, targetDate: '2026-03-26' }, 60, today).target, 1900);
  assert.strictEqual(L.weightPlan(2000, { goal: 'recomp' }, 60, today).weekly, null);
}
console.log('weightPlan ok');
