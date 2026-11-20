// node test_store.js — 用假的 db 測 Store
const assert = require('assert');
require('../src/core/logic.js');
const Store = require('../src/core/store.js');

function fakeDb({ failWith, failTimes, deferSnapshots } = {}) {
  let fails = failTimes || 0;
  const docs = new Map(), subs = [], writes = [], deferred = [];
  const first = f => { if (deferSnapshots) deferred.push(f); else f(); };
  const notify = () => subs.forEach(f => f());
  const docRef = path => ({
    async set(d) {
      await new Promise(r => setTimeout(r, Math.random() * 5));
      if (failWith) throw { code: failWith, message: 'x' };
      if (fails > 0) { fails--; throw { code: 'invalid_argument', message: 'x' }; }
      writes.push(path); docs.set(path, JSON.parse(JSON.stringify(d))); notify();
    },
    onSnapshot(next) { const f = () => next({ exists: docs.has(path), data: () => docs.get(path) }); subs.push(f); first(f); return () => {}; },
  });
  const query = (prefix, filters) => ({
    where: (f, op, v) => query(prefix, [...filters, [f, op, v]]),
    orderBy() { return this; },
    limit() { return this; },
    onSnapshot(next) {
      const f = () => next({ docs: [...docs].filter(([p, d]) => p.startsWith(prefix + '/') && filters.every(([k, op, v]) => op === '==' ? d[k] === v : op === '>=' ? d[k] >= v : true)).map(([, d]) => ({ data: () => d })) });
      subs.push(f); first(f); return () => {};
    },
  });
  return { docs, writes, fire() { deferred.splice(0).forEach(f => f()); }, collection: p => ({ ...query(p, []), doc: id => docRef(p + '/' + id) }) };
}

(async () => {
  // 第一次打開：db 全空，settings 用 DEFAULTS，身高體重是 null
  {
    const db = fakeDb();
    Store.init(db, 'local', {});
    assert.strictEqual(Store.settings.height, null);
    assert.strictEqual(Store.settings.target, 1800);
    assert.strictEqual(global.Logic.tdee({ ...Store.settings, weight: null }), null);
  }
  const today = Logic.dayKey();
  // 沒有 db：唯讀
  let errs = [];
  Store.init(null, null, { onData() {}, onError: m => errs.push(m) });
  assert.strictEqual(Store.readOnly, true);
  assert.strictEqual(Store.ready, true);
  await assert.rejects(Store.updateDay(today, d => d.water.push(250)));
  assert.match(errs[0], /沒辦法存到這個瀏覽器/);
  assert.deepStrictEqual(Store.day(today).water, []);

  // 正常讀寫
  const db = fakeDb(); let renders = 0; errs = [];
  Store.init(db, 'u1', { onData: () => renders++, onError: m => errs.push(m) });
  assert.strictEqual(Store.readOnly, false);
  assert.strictEqual(Store.settings.target, 1800);
  assert.deepStrictEqual(Store.day(today), { kind: 'day', date: today, meals: [], water: [], exercise: [], weight: null });

  // 快速連點：最後狀態要等於最後一次（Review Focus 4）
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push(Store.updateDay(today, d => d.water.push(250)));
  await Promise.all(ps);
  assert.deepStrictEqual(db.docs.get(`data/users/u1/day-${today}`).water, [250, 250, 250, 250, 250, 250]);
  assert.strictEqual(Store.day(today).water.length, 6);
  assert.ok(renders > 0);

  // saveMeal：新增、取代，並更新品項庫
  const meal = { id: 'm1', type: '午餐', time: '12:00', store: '壽司郎', items: [{ emoji: '🍣', name: '鮭魚', qty: 2, kcal: 120, protein: 6, carbs: 18, fat: 3 }] };
  await Store.saveMeal(today, meal);
  await Store.saveMeal(today, { ...meal, items: [{ ...meal.items[0], qty: 4 }] });
  const saved = db.docs.get(`data/users/u1/day-${today}`);
  assert.strictEqual(saved.meals.length, 1);
  assert.strictEqual(saved.meals[0].items[0].qty, 4);
  assert.strictEqual(db.docs.get('data/users/u1/foods').stores['壽司郎'].items['鮭魚'].kcal, 120);
  assert.strictEqual(Store.foods.stores['壽司郎'].lastUsed, today);

  await Store.deleteMeal(today, 'm1');
  assert.strictEqual(db.docs.get(`data/users/u1/day-${today}`).meals.length, 0);

  // v1 舊資料讀進來會轉成 v2 格式
  db.docs.set('data/users/u1/day-2026-01-01', { kind: 'day', date: '2026-01-01', meals: [{ id: 'x', name: '便當', kcal: 700, protein: 30, carbs: 80, fat: 25 }], water: [] });
  Store.init(db, 'u1', { onData() {}, onError() {} });
  // 2026-01-01 不在 120 天內就不會出現；改用今天驗證轉換
  db.docs.set(`data/users/u1/day-${today}`, { kind: 'day', date: today, meals: [{ id: 'x', name: '便當', kcal: 700, protein: 30, carbs: 80, fat: 25 }], water: [] });
  Store.init(db, 'u1', { onData() {}, onError() {} });
  assert.strictEqual(Store.day(today).meals[0].items[0].name, '便當');
  assert.deepStrictEqual(Store.day(today).exercise, []);

  await Store.saveSettings({ target: 1350 });
  assert.strictEqual(db.docs.get('data/users/u1/settings').target, 1350);
  assert.strictEqual(Store.settings.protein, 90);

  // 寫入被拒（Review Focus 5）
  const bad = fakeDb({ failWith: 'invalid_argument' }); errs = [];
  Store.init(bad, 'u2', { onData() {}, onError: m => errs.push(m) });
  await assert.rejects(Store.updateDay(today, d => d.water.push(250)));
  assert.match(errs[0], /沒存到/);
  // 失敗之後佇列還能繼續用
  const ok2 = fakeDb(); Store.init(ok2, 'u3', { onData() {}, onError() {} });
  await Store.updateDay(today, d => { d.weight = 57.5; });
  assert.strictEqual(ok2.docs.get(`data/users/u3/day-${today}`).weight, 57.5);

  // (a) 佇列進行中收到舊快照，不能把樂觀狀態蓋回去
  const dbA = fakeDb(); Store.init(dbA, 'u4', { onData() {}, onError() {} });
  const pa = [1, 2, 3].map(() => Store.updateDay(today, d => d.water.push(250)));
  await pa[0];
  assert.strictEqual(Store.day(today).water.length, 3);
  pa.push(Store.updateDay(today, d => d.water.push(250)));
  await Promise.all(pa);
  assert.strictEqual(dbA.docs.get(`data/users/u4/day-${today}`).water.length, 4);

  // (b) 同一個佇列：第一筆失敗，第二筆仍會寫入
  const dbB = fakeDb({ failTimes: 1 }); errs = [];
  Store.init(dbB, 'u5', { onData() {}, onError: m => errs.push(m) });
  await assert.rejects(Store.updateDay(today, d => d.water.push(250)));
  assert.match(errs[0], /沒存到/);
  await Store.updateDay(today, d => { d.weight = 56; });
  assert.strictEqual(dbB.docs.get(`data/users/u5/day-${today}`).weight, 56);

  // (c) 畫面更新丟錯，寫入佇列也不能停
  const dbC = fakeDb(); let nC = 0, setup = true; errs = [];
  Store.init(dbC, 'u6', { onData() { if (!setup && ++nC === 2) throw new Error('render'); }, onError: m => errs.push(m) });
  setup = false;
  await Store.updateDay(today, d => d.water.push(250));
  await new Promise(r => setTimeout(r, 20));
  await Store.updateDay(today, d => d.water.push(250));
  await Store.updateDay(today, d => d.water.push(250));
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(dbC.docs.get(`data/users/u6/day-${today}`).water.length, 3);

  // (d) 第一份快照到之前不能寫入，避免蓋掉使用者的資料
  const dbD = fakeDb({ deferSnapshots: true }); errs = [];
  dbD.docs.set('data/users/u7/foods', { stores: { 老店: { lastUsed: '2026-01-01', items: { 滷肉飯: { emoji: '🍚', kcal: 500, protein: 15, carbs: 70, fat: 18 } } } } });
  Store.init(dbD, 'u7', { onData() {}, onError: m => errs.push(m) });
  await assert.rejects(Store.updateDay(today, d => d.water.push(250)), { code: 'not_loaded' });
  assert.strictEqual(dbD.writes.length, 0);
  assert.match(errs[0], /還在載入/);
  await assert.rejects(Store.saveSettings({ target: 1200 }), { code: 'not_loaded' });
  await assert.rejects(Store.saveMeal(today, meal), { code: 'not_loaded' });
  assert.strictEqual(dbD.writes.length, 0);
  dbD.fire();
  await Store.updateDay(today, d => d.water.push(250));
  await Store.saveMeal(today, meal);
  assert.strictEqual(dbD.docs.get(`data/users/u7/day-${today}`).meals.length, 1);
  assert.strictEqual(dbD.docs.get('data/users/u7/foods').stores['老店'].items['滷肉飯'].kcal, 500);
  assert.ok(dbD.docs.get('data/users/u7/foods').stores['壽司郎']);

  // chat：讀寫、20 則上限、壞資料過濾、清除、載入前不能寫
  const dbE = fakeDb(); errs = [];
  dbE.docs.set('data/users/u8/chat', { messages: [{ role: 'user', text: '舊的', at: '1' }, { role: 'bot', text: 'x' }] });
  Store.init(dbE, 'u8', { onData() {}, onError: m => errs.push(m) });
  assert.deepStrictEqual(Store.chat, [{ role: 'user', text: '舊的', at: '1' }]);
  const many = Array.from({ length: 23 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 't' + i, at: String(i) }));
  const pChat = Store.saveChat(many);
  assert.strictEqual(Store.chat.length, 20);              // 同步更新
  await pChat;
  assert.strictEqual(dbE.docs.get('data/users/u8/chat').messages.length, 20);
  assert.strictEqual(dbE.docs.get('data/users/u8/chat').messages[0].text, 't3');
  await Store.clearChat();
  assert.deepStrictEqual(dbE.docs.get('data/users/u8/chat'), { messages: [] });
  assert.deepStrictEqual(Store.chat, []);

  const dbF = fakeDb({ deferSnapshots: true }); errs = [];
  Store.init(dbF, 'u9', { onData() {}, onError: m => errs.push(m) });
  await assert.rejects(Store.saveChat([{ role: 'user', text: 'hi', at: '1' }]), { code: 'not_loaded' });
  assert.deepStrictEqual(Store.chat, []);
  assert.strictEqual(dbF.writes.length, 0);

  Store.init(null, null, { onData() {}, onError() {} });
  await assert.rejects(Store.saveChat([{ role: 'user', text: 'hi', at: '1' }]), { code: 'read_only' });
  assert.deepStrictEqual(Store.chat, []);

  // saveMeal：多店的餐，整餐店名同步、店家記憶各記各的
  const dbG = fakeDb();
  Store.init(dbG, 'u10', { onData() {}, onError() {} });
  const multi = { id: 'mm', type: '早餐', time: '08:00', store: '全家', items: [
    { emoji: '🍙', name: '飯糰', qty: 1, kcal: 200, protein: 5, carbs: 40, fat: 3 },
    { emoji: '☕', name: '拿鐵', qty: 1, kcal: 150, protein: 8, carbs: 12, fat: 6, store: '星巴克' }] };
  await Store.saveMeal(today, multi);
  const savedM = dbG.docs.get(`data/users/u10/day-${today}`).meals[0];
  assert.strictEqual(savedM.store, '');
  assert.deepStrictEqual(savedM.items.map(x => x.store), ['全家', '星巴克']);
  const fg = dbG.docs.get('data/users/u10/foods').stores;
  assert.ok(fg['全家'].items['飯糰']);
  assert.ok(fg['星巴克'].items['拿鐵']);

  // 讀取時同餐別合併；下次寫入這一天就存成合併後的樣子
  const dbH = fakeDb();
  dbH.docs.set(`data/users/u11/day-${today}`, { kind: 'day', date: today, water: [], exercise: [], weight: null, meals: [
    { id: 'd1', type: '晚餐', time: '20:10', store: 'Sukiya', items: [{ emoji: '🍚', name: '牛丼', qty: 1, kcal: 380, protein: 14, carbs: 55, fat: 11 }] },
    { id: 'd2', type: '晚餐', time: '20:12', store: 'Tryall', items: [{ emoji: '🥤', name: '乳清', qty: 1, kcal: 122, protein: 22, carbs: 3, fat: 3 }] }] });
  Store.init(dbH, 'u11', { onData() {}, onError() {} });
  assert.strictEqual(Store.day(today).meals.length, 1);
  assert.strictEqual(Logic.totals(Store.day(today)).kcal, 502);
  await Store.updateDay(today, d => d.water.push(500));
  const savedH = dbH.docs.get(`data/users/u11/day-${today}`).meals;
  // 寫入後同餐別仍只有一筆（例如在別處改了餐別）
  await Store.updateDay(today, d => { d.meals.push({ id: 'd3', type: '晚餐', time: '21:00', store: '', items: [{ emoji: '🍵', name: '茶', qty: 1, kcal: 0, protein: 0, carbs: 0, fat: 0 }] }); });
  assert.strictEqual(Store.day(today).meals.length, 1);
  assert.strictEqual(dbH.docs.get(`data/users/u11/day-${today}`).meals.length, 1);
  assert.strictEqual(savedH.length, 1);
  assert.deepStrictEqual(savedH[0].items.map(x => [x.store, x.time]), [['Sukiya', '20:10'], ['Tryall', '20:12']]);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
