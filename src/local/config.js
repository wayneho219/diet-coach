// 本機設定：AI 服務、金鑰、模型、教練名稱，存在 localStorage 'diet-coach:config'（不會進備份檔）
(function (root) {
  const KEY = 'diet-coach:config';
  const NAMES = ['anthropic', 'openai', 'gemini'];

  function defaults() {
    const P = root.LocalAI.PROVIDERS;
    const model = {}, keys = {};
    for (const n of NAMES) { model[n] = P[n].model; keys[n] = ''; }
    return { provider: 'anthropic', keys, model, coachName: '教練', onboarded: false };
  }

  function create(storage) {
    let cache = null;
    const clean = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

    function load() {
      const d = defaults();
      let saved = {};
      try { saved = clean(JSON.parse(storage.getItem(KEY))); } catch (_) { /* 壞掉就用預設 */ }
      const out = { ...d, ...saved, keys: { ...d.keys, ...clean(saved.keys) }, model: { ...d.model, ...clean(saved.model) } };
      if (!NAMES.includes(out.provider)) out.provider = d.provider;
      if (typeof out.coachName !== 'string' || !out.coachName.trim()) out.coachName = d.coachName;
      return out;
    }

    const cfg = {
      get() { return cache || (cache = load()); },
      save(patch = {}) {
        const cur = cfg.get();
        const next = { ...cur, ...patch, keys: { ...cur.keys, ...clean(patch.keys) }, model: { ...cur.model, ...clean(patch.model) } };
        storage.setItem(KEY, JSON.stringify(next));
        cache = next;
        return next;
      },
      current() {
        const c = cfg.get(), d = defaults();
        return { provider: c.provider, key: c.keys[c.provider] || '', model: (c.model[c.provider] || '').trim() || d.model[c.provider] };
      },
      hasKey: () => !!cfg.current().key,
    };
    return cfg;
  }

  const Config = { create };
  // 瀏覽器：全域 Config 是用 localStorage 建好的實例；node：保留 { create } 給測試
  // （新版 node 有會警告的全域 localStorage，所以同時要求有 window）
  root.Config = typeof window !== 'undefined' && typeof localStorage !== 'undefined' ? create(localStorage) : Config;
  if (typeof module !== 'undefined') module.exports = Config;
})(typeof window !== 'undefined' ? window : globalThis);
