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
          headers: ANTHROPIC_HEADERS(cfg.key),
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

  // 非 2xx：帶上狀態碼和服務商的錯誤說明（例如額度不足、找不到模型），方便使用者排查；說明裡不含金鑰
  async function httpError(res) {
    if (res.status === 401 || res.status === 403) throw err('bad_key');
    if (res.status === 429) throw err('rate_limited');
    let detail = '';
    try { const j = await res.json(); detail = String(j?.error?.message || j?.[0]?.error?.message || '').slice(0, 200); } catch (_) { /* 沒有 JSON 就算了 */ }
    throw { code: 'upstream_error', status: res.status, detail };
  }

  // 列出這把金鑰能用的對話模型，較新的排前面
  const ANTHROPIC_HEADERS = k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  const LISTS = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: ANTHROPIC_HEADERS,
      ids: j => (j.data || []).map(m => m.id),   // API 已經依新到舊排好
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      headers: k => ({ Authorization: 'Bearer ' + k }),
      // 清單混了語音、圖片、向量模型，只留對話模型
      ids: j => (j.data || [])
        .filter(m => /^(gpt-|o\d)/.test(m.id) && !/audio|realtime|tts|transcribe|image|search|embedding/.test(m.id))
        .sort((a, b) => (b.created || 0) - (a.created || 0)).map(m => m.id),
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      headers: k => ({ 'x-goog-api-key': k }),
      // 沒有日期欄位，用名稱數字由大到小近似新到舊
      ids: j => (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && !/embedding|imagen|aqa|tts|image-generation|audio/.test(m.name))
        .map(m => m.name.replace(/^models\//, ''))
        .sort((a, b) => b.localeCompare(a, 'en', { numeric: true })),
    },
  };
  async function listModels({ provider, key }, fetchFn) {
    const L = LISTS[provider];
    if (!L || !key) throw err('not_granted');
    let res;
    try { res = await fetchFn(L.url, { headers: L.headers(key) }); }
    catch (_) { throw { code: 'upstream_error', network: true }; }
    if (!res.ok) await httpError(res);
    return L.ids(await res.json());
  }
  // 強／中／快三檔：每檔先找正式版名稱（strict），找不到才放寬到預覽版（loose）；清單已是新到舊，取第一個符合的
  // ponytail: 純靠名稱判斷，服務商改命名規則就要更新這張表；選單裡永遠有「顯示全部」可以退回
  const TIERS = {
    anthropic: [['強', /opus/, /opus/], ['中', /sonnet/, /sonnet/], ['快', /haiku/, /haiku/]],
    openai: [
      ['強', /^gpt-\d+(\.\d+)?$/, /^gpt-\d(?!.*(mini|nano))/],
      ['中', /^gpt-\d+(\.\d+)?-mini$/, /^gpt-\d.*mini/],
      ['快', /^gpt-\d+(\.\d+)?-nano$/, /^gpt-\d.*nano/]],
    gemini: [
      ['強', /^gemini-[\d.]+-pro$/, /^gemini-.*-pro/],
      ['中', /^gemini-[\d.]+-flash$/, /^gemini-.*-flash(?!-lite)/],
      ['快', /^gemini-[\d.]+-flash-lite$/, /^gemini-.*-flash-lite/]],
  };
  function tiers(provider, ids) {
    const out = [];
    for (const [label, strict, loose] of TIERS[provider] || []) {
      const id = ids.find(i => strict.test(i)) || ids.find(i => loose.test(i));
      if (id && !out.some(t => t.id === id)) out.push({ label, id });
    }
    return out;
  }
  // 目前的模型在清單裡就留著；不在（例如預設名稱已下架）就換成「中」檔，沒有就清單第一個
  const pickModel = (ids, current, provider) => {
    if (ids.includes(current) || !ids.length) return current;
    return tiers(provider, ids).find(t => t.label === '中')?.id || ids[0];
  };

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
        if (!res.ok) await httpError(res);
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
        throw { code: 'upstream_error', network: true };   // fetch 本身失敗：沒網路、被 CSP／擴充套件擋下
      }
    }
    const sample = (input, opts) => run(input, opts);
    sample.json = async (input, opts) => parseJson((await run(input, opts)).text);
    return sample;
  }

  const LocalAI = { PROVIDERS, create, parseJson, listModels, pickModel, tiers };
  root.LocalAI = LocalAI;
  if (typeof module !== 'undefined') module.exports = LocalAI;
})(typeof window !== 'undefined' ? window : globalThis);
