// node test_localdb.js — 用假 storage 測 LocalDB
const assert = require('assert');
require('../src/core/logic.js');
const Store = require('../src/core/store.js');
const LocalDB = require('../src/local/db.js');

function fakeStorage() {
  const m = new Map();
  return {
    m, failSet: false,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (this.failSet) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    key(i) { return [...m.keys()][i] ?? null; },
    get length() { return m.size; },
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const next = (ref) => new Promise((res, rej) => ref.onSnapshot(res, rej));

(async () => {
  // doc 讀寫
  let st = fakeStorage(), db = LocalDB.create(st);
  const col = db.collection('data/users/local');
  const none = await next(col.doc('settings'));
  assert.strictEqual(none.exists, false);
  await col.doc('settings').set({ a: 1 });
  const snap = await next(col.doc('settings'));
  assert.strictEqual(snap.exists, true);
  assert.deepStrictEqual(snap.data(), { a: 1 });
  snap.data().a = 99;
  assert.deepStrictEqual(snap.data(), { a: 1 });   // data() 回傳新物件

  // 查詢
  for (let i = 1; i <= 5; i++) await col.doc('day-2026-01-0' + i).set({ kind: 'day', date: '2026-01-0' + i });
  await col.doc('foods').set({ kind: 'foods' });
  const q = () => col.where('kind', '==', 'day').where('date', '>=', '2026-01-02').orderBy('date', 'desc').limit(3);
  const qs = await next(q());
  assert.deepStrictEqual(qs.docs.map(d => d.data().date), ['2026-01-05', '2026-01-04', '2026-01-03']);

  // 查詢訂閱 + 後續 set
  const got = [];
  const unsub = q().onSnapshot(s => got.push(s.docs.map(d => d.data().date)));
  await tick();
  assert.strictEqual(got.length, 1);
  await col.doc('day-2026-01-06').set({ kind: 'day', date: '2026-01-06' });
  await tick();
  assert.strictEqual(got.length, 2);
  assert.deepStrictEqual(got[1], ['2026-01-06', '2026-01-05', '2026-01-04']);
  unsub();
  await col.doc('day-2026-01-07').set({ kind: 'day', date: '2026-01-07' });
  await tick();
  assert.strictEqual(got.length, 2);

  // export / import
  st.setItem('diet-coach:config', '{"key":"secret"}');
  const dump = db.exportAll();
  assert.strictEqual(dump.app, 'diet-coach');
  assert.strictEqual(dump.version, 1);
  assert.ok(dump.docs['data/users/local/settings']);
  assert.ok(!Object.keys(dump.docs).some(k => k.includes('config')));
  const st2 = fakeStorage(), db2 = LocalDB.create(st2);
  await db2.importAll(dump);
  assert.deepStrictEqual(db2.exportAll(), dump);
  assert.strictEqual(st2.getItem('diet-coach:config'), null);

  // importAll 會清掉舊的 data/，但保留 config
  st2.setItem('diet-coach:config', 'keep');
  st2.setItem('diet-coach:data/users/local/extra', '{"x":1}');
  await db2.importAll(dump);
  assert.strictEqual(st2.getItem('diet-coach:data/users/local/extra'), null);
  assert.strictEqual(st2.getItem('diet-coach:config'), 'keep');
  assert.deepStrictEqual(db2.exportAll(), dump);
  st2.removeItem('diet-coach:config');

  // 壞掉的 JSON 項目略過，不影響其他文件
  st2.setItem('diet-coach:data/users/local/broken', '{oops');
  assert.deepStrictEqual(db2.exportAll(), dump);
  st2.removeItem('diet-coach:data/users/local/broken');

  // 驗證失敗不改資料
  const before = JSON.stringify(db2.exportAll());
  for (const bad of [{ app: 'other', version: 1, docs: {} }, { app: 'diet-coach', version: 2, docs: {} }, null, { app: 'diet-coach', version: 1, docs: { 'data/x/y': 'str' } }]) {
    await assert.rejects(db2.importAll(bad), { code: 'invalid_backup' });
  }
  assert.strictEqual(JSON.stringify(db2.exportAll()), before);

  // quota
  st.failSet = true;
  await assert.rejects(col.doc('settings').set({ a: 2 }), { code: 'quota_exceeded' });
  st.failSet = false;

  // 接 Store
  const st3 = fakeStorage();
  Store.init(LocalDB.create(st3), 'local');
  await tick();
  await Store.saveSettings({ target: 1700 });
  Store.init(LocalDB.create(st3), 'local');
  await tick();
  assert.strictEqual(Store.settings.target, 1700);

  // 重置：刪掉所有 diet-coach: 開頭的資料（含設定），其他 key 不動
  {
    const s3 = fakeStorage();
    s3.setItem('diet-coach:data/users/local/settings', '{}');
    s3.setItem('diet-coach:config', '{}');
    s3.setItem('other-app:x', '1');
    assert.strictEqual(LocalDB.clearAll(s3), 2);
    assert.deepStrictEqual([...s3.m.keys()], ['other-app:x']);
  }

  console.log('test_localdb: ok');
})().catch(e => { console.error(e); process.exit(1); });
