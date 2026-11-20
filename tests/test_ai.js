// LocalAI 測試：假 fetch + SSE ReadableStream
const assert = require('assert');
const LocalAI = require('../src/local/ai.js');

const enc = new TextEncoder();
function sseBody(chunks) {
  let i = 0;
  return new ReadableStream({
    pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close(); },
  });
}
function mk(cfg, resp) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    return typeof resp === 'function' ? resp(init) : resp;
  };
  return { calls, sample: LocalAI.create({ getConfig: () => cfg, fetch: f }) };
}
// 把一串事件字串拆成不對齊行界的三塊
function split3(s) { const a = Math.floor(s.length / 3); return [s.slice(0, a), s.slice(a, 2 * a + 1), s.slice(2 * a + 1)]; }
const ok = chunks => ({ ok: true, status: 200, body: sseBody(chunks) });
const jpg = () => new Blob([Uint8Array.of(1, 2, 3)], { type: 'image/jpeg' });
const msgs = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
const ev = o => 'data: ' + JSON.stringify(o) + '\n\n';
const rejects = async (p, code) => { try { await p; } catch (e) { assert.strictEqual(e.code, code); return; } assert.fail('should reject ' + code); };

const specs = {
  anthropic: {
    cfg: { provider: 'anthropic', key: 'K', model: 'm1' },
    sse: (a, b, stop) => ev({ type: 'message_start' }) + ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: a } })
      + ev({ type: 'content_block_delta', delta: { text: b } }) + ev({ type: 'message_delta', delta: { stop_reason: stop } }),
  },
  openai: {
    cfg: { provider: 'openai', key: 'K', model: 'm1' },
    sse: (a, b, stop) => ev({ choices: [{ delta: { content: a } }] }) + ev({ choices: [{ delta: { content: b } }] })
      + ev({ choices: [{ delta: {}, finish_reason: stop }] }) + 'data: [DONE]\n\n',
  },
  gemini: {
    cfg: { provider: 'gemini', key: 'K', model: 'm1' },
    sse: (a, b, stop) => ev({ candidates: [{ content: { parts: [{ text: a }] } }] })
      + ev({ candidates: [{ content: { parts: [{ text: b }] }, finishReason: stop }] }),
  },
};
const stops = { anthropic: ['end_turn', 'max_tokens'], openai: ['stop', 'length'], gemini: ['STOP', 'MAX_TOKENS'] };

(async () => {
  assert.deepStrictEqual(Object.keys(LocalAI.PROVIDERS).sort(), ['anthropic', 'gemini', 'openai']);
  assert.strictEqual(LocalAI.PROVIDERS.anthropic.model, 'claude-sonnet-5-5');

  for (const name of Object.keys(specs)) {
    const { cfg, sse } = specs[name];
    // 串流 + onText + 跨塊
    let seen = [];
    let t = mk(cfg, ok(split3(sse('你', '好', stops[name][0]))));
    let r = await t.sample('hi', { onText: x => seen.push(x.text) });
    assert.deepStrictEqual(r, { text: '你好', truncated: false }, name);
    assert.deepStrictEqual(seen, ['你', '你好'], name);
    // 單字串包成 user 訊息、request 形狀
    const c = t.calls[0];
    if (name === 'anthropic') {
      assert.strictEqual(c.url, 'https://api.anthropic.com/v1/messages');
      assert.strictEqual(c.headers['x-api-key'], 'K');
      assert.strictEqual(c.headers['anthropic-version'], '2023-06-01');
      assert.strictEqual(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
      assert.strictEqual(c.body.max_tokens, 4096); assert.strictEqual(c.body.stream, true);
      assert.strictEqual(c.body.model, 'm1');
      assert.deepStrictEqual(c.body.messages, [{ role: 'user', content: 'hi' }]);
    } else if (name === 'openai') {
      assert.strictEqual(c.url, 'https://api.openai.com/v1/chat/completions');
      assert.strictEqual(c.headers.Authorization, 'Bearer K');
      assert.strictEqual(c.body.max_completion_tokens, 4096); assert.strictEqual(c.body.stream, true);
    } else {
      assert.strictEqual(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/m1:streamGenerateContent?alt=sse');
      assert.strictEqual(c.headers['x-goog-api-key'], 'K');
      assert.strictEqual(c.body.generationConfig.maxOutputTokens, 4096);
    }
    // 多輪 + 照片
    t = mk(cfg, ok([sse('x', 'y', stops[name][0])]));
    await t.sample(msgs, { images: [jpg()] });
    const b = t.calls[0].body;
    if (name === 'anthropic') {
      assert.deepStrictEqual(b.messages.map(m => m.role), ['user', 'assistant', 'user']);
      assert.strictEqual(b.messages[0].content, 'a');
      assert.deepStrictEqual(b.messages[2].content, [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
        { type: 'text', text: 'c' }]);
    } else if (name === 'openai') {
      assert.deepStrictEqual(b.messages.map(m => m.role), ['user', 'assistant', 'user']);
      assert.deepStrictEqual(b.messages[2].content, [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
        { type: 'text', text: 'c' }]);
    } else {
      assert.deepStrictEqual(b.contents.map(m => m.role), ['user', 'model', 'user']);
      assert.deepStrictEqual(b.contents[1].parts, [{ text: 'b' }]);
      assert.deepStrictEqual(b.contents[2].parts, [
        { inline_data: { mime_type: 'image/jpeg', data: 'AQID' } }, { text: 'c' }]);
    }
    // 截斷
    t = mk(cfg, ok([sse('x', 'y', stops[name][1])]));
    assert.strictEqual((await t.sample('hi')).truncated, true, name);
    // 中途取消
    const ac = new AbortController();
    t = mk(cfg, init => ({ ok: true, status: 200, body: new ReadableStream({
      pull() { return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))); },
    }) }));
    const p = t.sample('hi', { signal: ac.signal }); setTimeout(() => ac.abort(), 5);
    await rejects(p, 'cancelled');
    // sample.json
    t = mk(cfg, ok([sse('{"a":', '1}', stops[name][0])]));
    assert.deepStrictEqual(await t.sample.json('hi'), { a: 1 });
  }

  // 共用錯誤
  let t = mk({ provider: 'openai', key: '', model: '' }, ok([]));
  await rejects(t.sample('hi'), 'not_granted'); assert.strictEqual(t.calls.length, 0);
  const cfg = specs.openai.cfg;
  for (const [st, code] of [[401, 'bad_key'], [403, 'bad_key'], [429, 'rate_limited'], [500, 'upstream_error']]) {
    t = mk(cfg, { ok: false, status: st, body: null });
    await rejects(t.sample('hi'), code);
  }
  t = mk(cfg, () => { throw new TypeError('fail'); });
  await rejects(t.sample('hi'), 'upstream_error');
  await t.sample('hi').catch(e => assert.strictEqual(e.network, true));
  // 其他 HTTP 錯誤帶上狀態碼和服務商的說明
  t = mk(cfg, { ok: false, status: 400, json: async () => ({ error: { message: 'credit balance is too low' } }) });
  await t.sample('hi').then(() => assert.fail('should reject'), e => assert.deepStrictEqual(e, { code: 'upstream_error', status: 400, detail: 'credit balance is too low' }));
  t = mk(cfg, { ok: false, status: 404, json: async () => { throw new Error('not json'); } });
  await t.sample('hi').then(() => assert.fail('should reject'), e => assert.deepStrictEqual(e, { code: 'upstream_error', status: 404, detail: '' }));
  // model 空值退回預設
  t = mk({ provider: 'openai', key: 'K', model: '' }, ok([specs.openai.sse('a', 'b', 'stop')]));
  await t.sample('hi'); assert.strictEqual(t.calls[0].body.model, LocalAI.PROVIDERS.openai.model);

  // 串流中的錯誤事件要 reject，不能當成功
  for (const body of [ev({ type: 'error', error: { type: 'overloaded_error' } }), ev({ error: { message: 'boom' } })]) {
    const prov = body.includes('"type":"error"') ? 'anthropic' : null;
    for (const p of prov ? [prov] : ['openai', 'gemini']) {
      t = mk({ provider: p, key: 'K', model: 'm' }, ok([body]));
      await rejects(t.sample('hi'), 'upstream_error');
    }
  }

  // parseJson
  assert.deepStrictEqual(LocalAI.parseJson('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(LocalAI.parseJson('好的：\n{"a":1}\n以上'), { a: 1 });
  assert.deepStrictEqual(LocalAI.parseJson('```json\n[1,2]\n```'), [1, 2]);
  try { LocalAI.parseJson('{"a":'); assert.fail(); } catch (e) { assert.strictEqual(e.code, 'invalid'); }
  console.log('test_ai: all passed');
})().catch(e => { console.error(e); process.exit(1); });
