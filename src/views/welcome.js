// 第一次打開：選 AI 服務、貼金鑰、測試連線；存好或跳過之後不再自動出現（config.onboarded）
(function (root) {
  const KEY_URL = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    gemini: 'https://aistudio.google.com/apikey',
  };
  const ERR = {
    bad_key: '金鑰無效或沒有權限，檢查一下金鑰。',
    rate_limited: 'AI 的用量暫時到上限，等一下再試。',
    not_granted: '還沒填金鑰。',
  };

  // 測試連線失敗時給使用者看的原因（設定卡也用）
  function errorText(e) {
    if (ERR[e?.code]) return ERR[e.code];
    const why = e?.status ? `（HTTP ${e.status}${e.detail ? '：' + e.detail : ''}）` : e?.network ? '（請求沒送出去：沒網路，或被瀏覽器擋下）' : '';
    return '連不上，檢查網路或模型名稱。' + why;
  }

  // 用目前的設定送一句很短的請求
  const ping = () => root.LocalAI.create({ getConfig: () => root.Config.current(), fetch: (...a) => fetch(...a) })('回覆 OK 兩個字');

  // 基本資料和 AI 金鑰都是必填，兩步都完成才算設定好
  const shouldShow = cfg => !cfg.get().onboarded;

  // 第 1 步：基本資料與目標，即時算出建議熱量；第 2 步：AI 服務與金鑰。同一個面板換內容
  function open() {
    const { el, sheet } = root.UI;
    const body = el('div', { class: 'sheet-body' });
    sheet.open(body, { locked: true });   // 兩步都完成前關不掉
    profileStep(body);
  }

  function profileStep(body) {
    const { el, fmt, toast } = root.UI, L = root.Logic, Store = root.Store, s = Store.settings;
    const pick = (opts, cur) => opts.map(([v, t]) => el('option', { value: v, selected: v === cur }, t));
    const sex = el('select', {}, pick([['f', '女'], ['m', '男']], s.sex === 'm' ? 'm' : 'f'));
    const activity = el('select', {}, pick([['1.2', '久坐（幾乎不運動）'], ['1.375', '輕度（每週運動 1–3 次）'], ['1.55', '中度（每週 3–5 次）'], ['1.725', '高度（每週 6–7 次）']], String(s.activity)));
    const goal = el('select', {}, pick(Object.values(L.GOALS).map(g => [g.key, g.word]), L.goalOf(s).key));
    const num = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', value: v ?? '', placeholder: ph });
    const age = num(s.age, '歲'), height = num(s.height, 'cm'), weight = num(s.weight, 'kg');
    const targetWeight = num(s.targetWeight, 'kg'), weeks = num(null, '週');
    const targetBox = el('div', { class: 'grid2' },
      el('label', { class: 'field' }, '目標體重（kg）', targetWeight), el('label', { class: 'field' }, '預計幾週達成', weeks));
    const summary = el('p', { class: 'hint' });
    const n = i => (i.value === '' ? null : Number(i.value));

    const read = () => {
      const w = n(weight), wk = n(weeks), today = L.dayKey();
      const v = { sex: sex.value, age: n(age), height: n(height), activity: Number(activity.value), goal: goal.value,
        targetWeight: goal.value === 'recomp' ? null : n(targetWeight),
        targetDate: goal.value !== 'recomp' && wk > 0 ? L.addDays(today, Math.round(wk * 7)) : null };
      const td = L.tdee({ ...v, weight: w });
      return { v, w, td, plan: td ? L.weightPlan(td, v, w, today) : null };
    };
    const update = () => {
      targetBox.hidden = goal.value === 'recomp';
      const { td, plan } = read();
      if (!plan) { summary.textContent = '填好年齡、身高、體重，就會算出建議的熱量。'; return; }
      if (plan.error) { summary.textContent = '目標體重和目標方向對不上：減脂要比現在輕，增重要比現在重。'; return; }
      const wk = plan.weekly ? `，每週約 ${plan.weekly > 0 ? '+' : ''}${plan.weekly} kg` : '';
      const slow = plan.capped ? `。這個速度太快，已調整到安全範圍，大約要 ${plan.weeksNeeded} 週` : '';
      summary.textContent = `每日總消耗約 ${fmt(td)} 大卡 → 建議每天吃 ${fmt(plan.target)} 大卡、蛋白質 ${plan.protein} g、喝水 ${fmt(L.waterTarget(read().w))} ml${wk}${slow}。`;
    };
    for (const i of [sex, activity, goal, age, height, weight, targetWeight, weeks]) i.addEventListener('input', update);
    update();

    const next = async () => {
      const { v, w, plan } = read();
      if (!(v.age > 0 && v.height > 0 && w > 0)) return toast('年齡、身高、體重都要填。', true);
      if (plan?.error) return toast('目標體重和目標方向對不上。', true);
      try {
        await Store.saveSettings({ ...v, weight: w, target: plan.target, protein: plan.protein, water: L.waterTarget(w) });
        await Store.updateDay(L.dayKey(), d => { d.weight = w; });
      } catch (_) { return; }   // Store 已經跳出提示
      aiStep(body);
    };

    body.replaceChildren(
      el('h2', { class: 'sheet-title', 'data-drag': '' }, '歡迎 👋'),
      el('p', {}, '先填一些基本資料，用來算你每天該吃多少。'),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, '性別', sex), el('label', { class: 'field' }, '年齡', age),
        el('label', { class: 'field' }, '身高（cm）', height), el('label', { class: 'field' }, '體重（kg）', weight)),
      el('label', { class: 'field' }, '平常活動量', activity),
      el('label', { class: 'field' }, '目標', goal),
      targetBox, summary,
      el('button', { class: 'btn btn-primary btn-block', onclick: next }, '下一步'));
  }

  function aiStep(body) {
    // 上一步：回去改基本資料
    const back = () => profileStep(body);
    const { el, sheet, toast } = root.UI, Cfg = root.Config, P = root.LocalAI.PROVIDERS;
    const c = Cfg.get();
    const provider = el('select', {}, Object.entries(P).map(([k, v]) => el('option', { value: k, selected: k === c.provider }, v.label)));
    const key = el('input', { type: 'password', autocomplete: 'off', placeholder: '貼上 API 金鑰' });
    const link = el('a', { target: '_blank', rel: 'noopener' }, '去哪裡拿金鑰？');
    const msg = el('p', { class: 'warnbox', hidden: true, role: 'alert' });
    const setLink = () => { link.href = KEY_URL[provider.value]; };
    provider.addEventListener('change', setLink); setLink();

    const go = el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const p = provider.value, k = key.value.trim();
      if (!k) { msg.textContent = '先貼上金鑰。'; msg.hidden = false; return; }
      go.disabled = true; go.textContent = '測試中…'; msg.hidden = true;
      Cfg.save({ provider: p, keys: { [p]: k } });
      try {
        // 先查這把金鑰能用的模型；預設模型不在清單裡（例如已下架）就換成「中」檔，再測試
        const ids = await root.LocalAI.listModels({ provider: p, key: k }, (...a) => fetch(...a));
        const cur = Cfg.current().model, m = root.LocalAI.pickModel(ids, cur, p);
        if (m !== cur) Cfg.save({ model: { [p]: m } });
        await ping();
        Cfg.save({ onboarded: true });
        root.App.reinitAI();
        sheet.close({ force: true });
        toast('✓ 連線成功，可以開始用了。');
      } catch (e) {
        msg.textContent = errorText(e); msg.hidden = false;
      } finally { go.disabled = false; go.textContent = '測試並開始'; }
    } }, '測試並開始');

    body.replaceChildren(
      el('h2', { class: 'sheet-title', 'data-drag': '' }, '設定 AI'),
      el('p', {}, '選一個 AI 服務並貼上 API 金鑰，拍照估熱量和聊天才能用。'),
      el('label', { class: 'field' }, '服務', provider),
      el('label', { class: 'field' }, '金鑰', key),
      link, msg, go,
      root.UI.el('button', { class: 'btn btn-ghost btn-block', onclick: back }, '上一步'),
      el('p', { class: 'hint' }, '照片和文字會傳給你選的 AI 服務。'),
      el('p', { class: 'hint' }, 'API 費用由你自己負擔。'),
      el('p', { class: 'hint' }, 'iPhone 請用 Safari「加入主畫面」打開，資料才不會被清除。'),
      el('p', { class: 'hint' }, '之後可以在概覽頁最下面的「⚙️ AI 設定」修改。'));
    root.UI.$('sheet').scrollTop = 0;
  }

  const Welcome = { open, shouldShow, errorText, ping };
  root.Welcome = Welcome;
  if (typeof module !== 'undefined') module.exports = Welcome;
})(typeof window !== 'undefined' ? window : globalThis);
