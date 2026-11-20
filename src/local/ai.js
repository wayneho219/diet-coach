// BYOK AI 轉接：把 Anthropic / OpenAI / Gemini 包成 Artifact `sample` 的介面
(function (root) {
  // 預設模型（使用者可在設定頁改）；來源見 2026-11 官方文件
  const PROVIDERS = {
    anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-5-5' },
    openai: { label: 'OpenAI', model: 'gpt-6.2-sol' },
    gemini: { label: 'Google Gemini', model: 'gemini-3.8-flash' },
  };
  const MAX_TOKENS = 4096;

  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // 每家：build 組 request，pick 從一個 SSE 事件取 { delta, stop }
  const ADAPTERS = {
    anthropic: {
      build(msgs, imgs, cfg) {
        const messages = msgs.map((m, i) => ({
          role: m.role,
          content: imgs.length && i === msgs.length - 1
            ? [...imgs.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })), { type: 'text', text: m.content }]
            : m.content,
        }));
        return {
          url: 'https://api.anthropic.com/v1/messages',
          headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: { model: cfg.model, max_tokens: MAX_TOKENS, stream: true, messages },
        };
      },
      pick(e) {
        if (e.type === 'error') return { error: true };
        if (e.type === 'content_block_delta') return { delta: e.delta && e.delta.text };
        if (e.type === 'message_delta') return { stop: e.delta && e.delta.stop_reason === 'max_tokens' };
        return {};
      },
    },
    openai: {
      build(msgs, imgs, cfg) {
        const messages = msgs.map((m, i) => ({
          role: m.role,
          content: imgs.length && i === msgs.length - 1
            ? [...imgs.map(d => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + d } })), { type: 'text', text: m.content }]
            : m.content,
        }));
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          headers: { Authorization: 'Bearer ' + cfg.key },
          body: { model: cfg.model, max_completion_tokens: MAX_TOKENS, stream: true, messages },
        };
      },
      pick(e) {
        if (e.error) return { error: true };
        const c = e.choices && e.choices[0];
        return c ? { delta: c.delta && c.delta.content, stop: c.finish_reason === 'length' } : {};
      },
    },
    gemini: {
      build(msgs, imgs, cfg) {
        const contents = msgs.map((m, i) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: imgs.length && i === msgs.length - 1
            ? [...imgs.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d } })), { text: m.content }]
            : [{ text: m.content }],
        }));
        return {
          url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(cfg.model) + ':streamGenerateContent?alt=sse',
          headers: { 'x-goog-api-key': cfg.key },
          body: { contents, generationConfig: { maxOutputTokens: MAX_TOKENS } },
        };
      },
      pick(e) {
        if (e.error) return { error: true };
        const c = e.candidates && e.candidates[0];
        if (!c) return {};
        const parts = (c.content && c.content.parts) || [];
        return { delta: parts.map(p => p.text || '').join(''), stop: c.finishReason === 'MAX_TOKENS' };
      },
    },
  };

  const err = code => ({ code });
  const isAbort = e => e && e.name === 'AbortError';

  function parseJson(text) {
    try { return JSON.parse(text); } catch (_) { /* 往下容錯 */ }
    const s = String(text);
    const a = s.search(/[{[]/);
    if (a >= 0) {
      const close = s[a] === '{' ? '}' : ']';
      const b = s.lastIndexOf(close);
      if (b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { /* fallthrough */ } }
    }
    throw err('invalid');
  }

  function create({ getConfig, fetch: fetchFn }) {
    async function run(input, opts = {}) {
      const cfg0 = getConfig() || {};
      const prov = PROVIDERS[cfg0.provider], ad = ADAPTERS[cfg0.provider];
      if (!prov || !cfg0.key) throw err('not_granted');
      const cfg = { key: cfg0.key, model: cfg0.model || prov.model };
      const msgs = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
      try {
        const imgs = await Promise.all((opts.images || []).map(toBase64));
        const req = ad.build(msgs, imgs, cfg);
        const res = await fetchFn(req.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...req.headers },
          body: JSON.stringify(req.body),
          signal: opts.signal,
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) throw err('bad_key');
          if (res.status === 429) throw err('rate_limited');
          throw err('upstream_error');
        }
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = '', text = '', truncated = false;
        const line = l => {
          if (!l.startsWith('data:')) return;
          const d = l.slice(5).trim();
          if (!d || d === '[DONE]') return;
          let evt; try { evt = JSON.parse(d); } catch (_) { return; }
          const { delta, stop, error } = ad.pick(evt);
          if (error) throw err('upstream_error');
          if (stop) truncated = true;
          if (delta) { text += delta; if (opts.onText) opts.onText({ text }); }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
        }
        buf += dec.decode();
        if (buf) line(buf.replace(/\r$/, ''));
        return { text, truncated };
      } catch (e) {
        if (isAbort(e)) throw err('cancelled');
        if (e && e.code) throw e;
        throw err('upstream_error');
      }
    }
    const sample = (input, opts) => run(input, opts);
    sample.json = async (input, opts) => parseJson((await run(input, opts)).text);
    return sample;
  }

  const LocalAI = { PROVIDERS, create, parseJson };
  root.LocalAI = LocalAI;
  if (typeof module !== 'undefined') module.exports = LocalAI;
})(typeof window !== 'undefined' ? window : globalThis);
