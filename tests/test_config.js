// node test_config.js — 設定模組：預設值、合併、current、金鑰不進備份
const assert = require('assert');
require('../src/core/logic.js');
require('../src/local/ai.js');
const LocalDB = require('../src/local/db.js');
const Config = require('../src/local/config.js');

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const st = fakeStorage();
const cfg = Config.create(st);
const P = globalThis.LocalAI.PROVIDERS;

// 預設值
const d = cfg.get();
assert.strictEqual(d.provider, 'anthropic');
assert.deepStrictEqual(d.keys, { anthropic: '', openai: '', gemini: '' });
assert.deepStrictEqual(d.model, { anthropic: P.anthropic.model, openai: P.openai.model, gemini: P.gemini.model });
assert.strictEqual(d.coachName, '教練');
assert.strictEqual(cfg.hasKey(), false);

// keys／model 一層合併，只改傳進來的那家
cfg.save({ keys: { anthropic: 'k1' } });
cfg.save({ keys: { openai: 'k2' }, model: { openai: 'm2' } });
const g = cfg.get();
assert.strictEqual(g.keys.anthropic, 'k1');
assert.strictEqual(g.keys.openai, 'k2');
assert.strictEqual(g.model.openai, 'm2');
assert.strictEqual(g.model.anthropic, P.anthropic.model);
assert.strictEqual(cfg.hasKey(), true);       // 目前是 anthropic，有 k1

// 切換服務
cfg.save({ provider: 'gemini', keys: { gemini: 'k3' } });
assert.deepStrictEqual(cfg.current(), { provider: 'gemini', key: 'k3', model: P.gemini.model });
cfg.save({ coachName: '小明' });
assert.strictEqual(cfg.get().coachName, '小明');
assert.strictEqual(cfg.get().provider, 'gemini');

// 存在 diet-coach:config，重新建立後還在
assert.ok(JSON.parse(st.getItem('diet-coach:config')).keys.openai === 'k2');
assert.strictEqual(Config.create(st).get().keys.anthropic, 'k1');

// 壞掉的內容退回預設；model 空字串退回預設
st.setItem('diet-coach:config', '{oops');
assert.strictEqual(Config.create(st).get().provider, 'anthropic');
cfg.save({ model: { gemini: '' } });
assert.strictEqual(cfg.current().model, P.gemini.model);

// 金鑰不會進備份
(async () => {
  const s2 = fakeStorage();
  const c2 = Config.create(s2);
  c2.save({ keys: { anthropic: 'SECRET-A', openai: 'SECRET-O', gemini: 'SECRET-G' } });
  const db = LocalDB.create(s2);
  await db.collection('data').doc('2026-10-15').set({ kcal: 100 });
  const json = JSON.stringify(db.exportAll());
  assert.ok(json.includes('2026-10-15'));
  for (const k of ['SECRET-A', 'SECRET-O', 'SECRET-G']) assert.ok(!json.includes(k), '備份含金鑰');
  console.log('ok');
})();
