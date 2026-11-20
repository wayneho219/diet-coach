// node test_coach.js — 用假的 sample 測 Coach
const assert = require('assert');
require('../src/profile.js');
require('../src/core/logic.js');
const Coach = require('../src/core/claude.js');

const ctx = {
  stores: { '壽司郎': { '鮭魚握壽司': { emoji: '🍣', kcal: 120, protein: 6, carbs: 18, fat: 3 } } },
  recentItems: [{ store: '', item: { emoji: '🍜', name: '牛肉麵', kcal: 600, protein: 30, carbs: 70, fat: 20 } }],
  settings: { target: 1450, protein: 100 },
  todayTotals: { kcal: 300, protein: 20 },
};

function fakeSample(jsonResult, { fail } = {}) {
  const calls = [];
  const fn = async (prompt, opts) => { calls.push({ kind: 'text', prompt, opts }); if (fail) throw { code: fail }; return { text: '  這週做得不錯。  ' }; };
  fn.json = async (prompt, opts) => { calls.push({ kind: 'json', prompt, opts }); if (fail) throw { code: fail }; return jsonResult; };
  fn.calls = calls;
  return fn;
}

(async () => {
  const p = Coach.buildEstimatePrompt({ hasImage: true, note: '壽司郎 鮭魚 3 盤', mealType: '晚餐', context: ctx });
  assert.ok(p.includes('鮭魚握壽司：每份 120 kcal'));
  assert.ok(p.includes('牛肉麵'));
  assert.ok(p.includes('壽司郎 鮭魚 3 盤'));
  assert.ok(p.includes('晚餐'));
  assert.ok(p.includes('附上的照片'));
  assert.ok(p.includes('"items"'));
  const pm = Coach.buildEstimatePrompt({ hasImage: false, note: '全家飯糰、星巴克拿鐵', mealType: '早餐', context: { ...ctx,
    stores: { '全家': { '鮭魚飯糰': { emoji: '🍙', kcal: 200, protein: 5, carbs: 40, fat: 3 } }, '星巴克': { '拿鐵': { emoji: '☕', kcal: 150, protein: 8, carbs: 12, fat: 6 } }, '新店': null } } });
  assert.ok(pm.includes('使用者在「全家」記錄過的品項'));
  assert.ok(pm.includes('使用者在「星巴克」記錄過的品項'));
  assert.ok(!pm.includes('使用者在「新店」'));                    // 沒有記錄的店不列
  assert.ok(pm.includes('"store"') && pm.includes('"group"'));
  assert.ok(pm.includes('0.5'));
  const p2 = Coach.buildEstimatePrompt({ hasImage: false, note: '', mealType: '午餐', context: { ...ctx, stores: {}, recentItems: [] } });
  assert.ok(p2.includes('沒有照片'));
  assert.ok(p2.includes('（還沒有）'));

  Coach.init(null);
  assert.strictEqual(Coach.available, false);
  await assert.rejects(Coach.estimate({ note: 'x', mealType: '午餐', context: ctx }), e => e.code === 'not_granted' && /金鑰/.test(e.message));

  const good = { store: '壽司郎', summary: '不錯 🍣', items: [{ emoji: '🍣', name: '鮭魚握壽司', qty: 3, kcal: 120, protein: 6, carbs: 18, fat: 3 }], tips: ['a', 'b', 'c'], question: null };
  let s = fakeSample(good);
  Coach.init(s);
  assert.strictEqual(Coach.available, true);
  const blob = { fake: 'image' };
  const est = await Coach.estimate({ image: blob, note: '', mealType: '晚餐', context: ctx });
  assert.strictEqual(est.items[0].qty, 3);
  assert.deepStrictEqual(est.tips, ['a', 'b']);
  assert.deepStrictEqual(s.calls[0].opts.images, [blob]);
  assert.ok(s.calls[0].opts.signal);
  assert.strictEqual(s.calls[0].opts.modelTier, 'complex');            // 照片用比較強的模型
  for (const w of ['份量基準', '熟重', '不要為了保險往高估', '"portion"']) assert.ok(s.calls[0].prompt.includes(w), '估算 prompt 少了 ' + w);
  s.calls.length = 0;
  await Coach.estimate({ note: '牛肉麵', mealType: '晚餐', context: ctx });
  assert.strictEqual(s.calls[0].opts.modelTier, undefined);              // 只有文字照舊

  s = fakeSample({ items: [] }); Coach.init(s);
  await assert.rejects(Coach.estimate({ note: 'x', mealType: '午餐', context: ctx }), e => e.code === 'invalid_json' && e.message.length > 0);

  s = fakeSample({ emoji: '🍵', name: '綠茶', kcal: 0, protein: 0, carbs: 0, fat: 0 }); Coach.init(s);
  const item = await Coach.estimateItem('綠茶', '壽司郎');
  assert.strictEqual(item.name, '綠茶'); assert.strictEqual(item.qty, 1);
  assert.strictEqual(s.calls[0].opts.modelTier, 'quick');
  assert.ok(s.calls[0].prompt.includes('壽司郎'));

  s = fakeSample(null); Coach.init(s);
  assert.strictEqual(await Coach.insight('資料'), '這週做得不錯。');
  assert.strictEqual(s.calls[0].opts.cache, false);
  assert.ok(s.calls[0].prompt.includes('至少一行要講運動'));

  s = fakeSample(null, { fail: 'rate_limited' }); Coach.init(s);
  await assert.rejects(Coach.estimate({ note: 'x', mealType: '午餐', context: ctx }), e => e.code === 'rate_limited' && /上限/.test(e.message));
  assert.strictEqual(Coach.available, true);

  s = fakeSample(null, { fail: 'not_granted' }); Coach.init(s);
  await assert.rejects(Coach.estimate({ note: 'x', mealType: '午餐', context: ctx }));
  assert.strictEqual(Coach.available, false);

  s = fakeSample(null, { fail: 'cancelled' }); Coach.init(s);
  await assert.rejects(Coach.estimate({ note: 'x', mealType: '午餐', context: ctx }), e => e.code === 'cancelled' && e.message === '');
  s = fakeSample(null); const bare = async () => ({ text: undefined }); bare.json = s.json; Coach.init(bare);
  await assert.rejects(Coach.insight('資料'), e => e.code === 'invalid_json' && e.message.length > 0);
  s = fakeSample({ met: '6.84', note: '  中等強度室內飛輪  ' }); Coach.init(s);
  assert.deepStrictEqual(await Coach.estimateExercise('飛輪課'), { met: 6.8, note: '中等強度室內飛輪' });
  assert.strictEqual(s.calls[0].opts.modelTier, 'quick');
  assert.ok(s.calls[0].prompt.includes('飛輪課'));
  s = fakeSample({ met: 50 }); Coach.init(s);
  await assert.rejects(Coach.estimateExercise('x'), e => e.code === 'invalid_json');
  s = fakeSample({ note: 'no met' }); Coach.init(s);
  await assert.rejects(Coach.estimateExercise('x'), e => e.code === 'invalid_json');

  // 聊天
  const chatCtx = { summary: '這週：2026-10-15 熱量 1200 kcal', todayDetail: '午餐：鍋貼×10',
    stores: { '壽司郎': { '鮭魚握壽司': { emoji: '🍣', kcal: 120, protein: 6, carbs: 18, fat: 3 } } }, now: '2026/10/15 12:30' };
  const pre = Coach.buildChatPreamble(chatCtx);
  assert.ok(pre.includes('"group"'));                          // 聊天的 <meal> 也要 store、group
  assert.ok(Coach.buildChatPreamble({ ...chatCtx, body: '身體組成（InBody）：體脂率 30%' }).includes('身體組成（InBody）：體脂率 30%'));
  assert.ok(!pre.includes('身體組成（InBody'));   // 沒填就不提
  for (const s of ['教練', '先簡短反問', '不要每則結尾都附上', '醫師或營養師', '1,200', '<meal>', '這週：2026-10-15', '午餐：鍋貼×10', '鮭魚握壽司：每份 120 kcal', '2026/10/15 12:30'])
    assert.ok(pre.includes(s), '前言少了 ' + s);
  for (const s of ['運動和飲食一樣重要', '肌力訓練', '多走路']) assert.ok(pre.includes(s), '前言少了運動規則 ' + s);
  assert.ok(!Coach.buildChatPreamble({ ...chatCtx, stores: {} }).includes('」記錄過的品項：'));
  assert.ok(pre.includes('份量基準') && pre.includes('"portion"'));   // 聊天記餐也照同一套份量估法

  const mealJson = '{"mealType":"晚餐","store":"","summary":"好","items":[{"emoji":"🍱","name":"雞腿便當","qty":1,"kcal":780,"protein":35,"carbs":90,"fat":28,"fiber":4,"sodium":1500}]}';
  const reply = `可以，幫你整理好了。\n<meal>${mealJson}</meal>`;
  const streamed = [];
  const chatSample = async (input, opts) => {
    chatSample.calls.push({ input, opts });
    opts.onText?.({ text: '可以，', delta: '可以，' });
    opts.onText?.({ text: '可以，幫你整理好了。\n<me', delta: '' });
    opts.onText?.({ text: reply, delta: '' });
    return { text: reply, truncated: false };
  };
  chatSample.calls = []; chatSample.json = async () => null;
  Coach.init(chatSample);
  const img = { fake: 'blob' };
  const res = await Coach.chat({ messages: [{ role: 'user', text: '幫我記晚餐雞腿便當', at: '1', image: true }], image: img, context: chatCtx, onText: t => streamed.push(t) });
  assert.strictEqual(res.text, '可以，幫你整理好了。');
  assert.strictEqual(res.meal.items[0].name, '雞腿便當');
  assert.strictEqual(res.meal.mealType, '晚餐');
  assert.ok(streamed.every(t => !t.includes('<me')), '串流時不能顯示記餐區塊');
  const c0 = chatSample.calls[0];
  assert.strictEqual(c0.opts.cache, false);
  assert.strictEqual(c0.opts.tools, undefined);
  assert.deepStrictEqual(c0.opts.images, [img]);
  assert.strictEqual(c0.input[0].role, 'user');
  assert.ok(c0.input[0].content.includes('教練'));
  assert.deepStrictEqual(c0.input.at(-1), { role: 'user', content: '[1/1]\n幫我記晚餐雞腿便當（附照片）' });

  chatSample.calls = [];
  await Coach.chat({ messages: [{ role: 'user', text: '嗨', at: '1' }], context: chatCtx });
  assert.strictEqual(chatSample.calls[0].opts.images, undefined);

  const mealOnly = async () => ({ text: '<meal>{"mealType":"午餐","summary":"雞胸沙拉","items":[{"name":"雞胸沙拉","qty":1,"kcal":350,"protein":30,"carbs":20,"fat":12}]}</meal>' }); mealOnly.json = async () => null;
  Coach.init(mealOnly);
  const mo = await Coach.chat({ messages: [{ role: 'user', text: '記午餐', at: '1' }], context: chatCtx });
  assert.ok(mo.text && mo.text.length > 0, '只有 meal 區塊時 text 不可為空');
  assert.ok(mo.meal, '應解析出 meal');

  const emptySample = async () => ({ text: '  ' }); emptySample.json = async () => null;
  Coach.init(emptySample);
  await assert.rejects(Coach.chat({ messages: [{ role: 'user', text: '嗨', at: '1' }], context: chatCtx }), e => e.code === 'invalid_json' && e.message.length > 0);
  s = fakeSample(null, { fail: 'rate_limited' }); Coach.init(s);
  await assert.rejects(Coach.chat({ messages: [{ role: 'user', text: '嗨', at: '1' }], context: chatCtx }), e => e.code === 'rate_limited' && !e.message.includes('手動'));
  const cut = async () => ({ text: '先說結論：\n<meal>{"mealType"', truncated: true }); cut.json = async () => null;
  Coach.init(cut);
  const tr = await Coach.chat({ messages: [{ role: 'user', text: '嗨', at: '1' }], context: chatCtx });
  assert.deepStrictEqual([tr.text, tr.meal, tr.interrupted], ['先說結論：', null, true]);
  assert.strictEqual(res.interrupted, undefined);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
