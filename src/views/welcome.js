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

  const shouldShow = cfg => !cfg.get().onboarded && !cfg.hasKey();

  function open() {
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
        await ping();
        Cfg.save({ onboarded: true });
        root.App.reinitAI();
        sheet.close();
        toast('✓ 連線成功，可以開始用了。');
      } catch (e) {
        msg.textContent = errorText(e); msg.hidden = false;
      } finally { go.disabled = false; go.textContent = '測試並開始'; }
    } }, '測試並開始');

    sheet.open(el('div', { class: 'sheet-body' },
      el('h2', { class: 'sheet-title', 'data-drag': '' }, '歡迎 👋'),
      el('p', {}, '先選一個 AI 服務並貼上 API 金鑰，拍照估熱量和聊天才能用。'),
      el('label', { class: 'field' }, '服務', provider),
      el('label', { class: 'field' }, '金鑰', key),
      link, msg, go,
      el('button', { class: 'btn btn-ghost btn-block', onclick: () => sheet.close() }, '先跳過，只手動記錄'),
      el('p', { class: 'hint' }, '照片和文字會傳給你選的 AI 服務。'),
      el('p', { class: 'hint' }, 'API 費用由你自己負擔。'),
      el('p', { class: 'hint' }, 'iPhone 請用 Safari「加入主畫面」打開，資料才不會被清除。'),
      el('p', { class: 'hint' }, '之後可以在概覽頁最下面的「⚙️ AI 設定」修改。')),
      // 不管是存好、按跳過、還是滑掉，都算看過了，之後不再自動跳出
      { onClose: () => { Cfg.save({ onboarded: true }); root.App.reinitAI(); } });
  }

  const Welcome = { open, shouldShow, errorText, ping };
  root.Welcome = Welcome;
  if (typeof module !== 'undefined') module.exports = Welcome;
})(typeof window !== 'undefined' ? window : globalThis);
