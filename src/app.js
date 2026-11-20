// 啟動、導覽、全域狀態
(function (root) {
  let lastToday = null;
  // 跨午夜：停在「昨天」的人跟著換到今天；不能停在未來
  function syncToday() {
    const t = App.today();
    if (lastToday && App.state.dateKey === lastToday && t !== lastToday) App.state.dateKey = t;
    lastToday = t;
    if (!App.state.dateKey || App.state.dateKey > t) App.state.dateKey = t;
    return t;
  }

  const App = {
    state: { tab: 'home', dateKey: null },
    today: () => root.Logic.dayKey(),

    render() {
      const today = syncToday();
      root.UI.$('banner').hidden = !root.Store.ready || !root.Store.readOnly;
      if (App.state.tab === 'home') root.Home.render({ dateKey: App.state.dateKey, today });
      else root.Overview.render({ today });
      root.Chat?.refresh();
    },
    onData() { App.render(); },

    go(tab) {
      App.state.tab = tab;
      const { $ } = root.UI;
      $('view-home').hidden = tab !== 'home';
      $('view-overview').hidden = tab !== 'overview';
      for (const t of ['home', 'overview']) {
        if (t === tab) $('tab-' + t).setAttribute('aria-current', 'page'); else $('tab-' + t).removeAttribute('aria-current');
      }
      root.scrollTo(0, 0);
      App.render();
    },

    setDate(key) {
      App.state.dateKey = key > App.today() ? App.today() : key;
      App.render();
    },

    async start() {
      const { $, sheet } = root.UI;
      const P = root.Profile;
      if (P) { $('fab').setAttribute('aria-label', P.text.addMeal); $('chat-fab').setAttribute('aria-label', P.text.askCoach); }
      $('tab-home').onclick = () => App.go('home');
      $('tab-overview').onclick = () => App.go('overview');
      $('fab').onclick = () => { syncToday(); root.AddMeal.open({ dateKey: App.state.tab === 'home' ? App.state.dateKey : App.today() }); };
      $('chat-fab').onclick = () => root.Chat.open();
      $('sheet-backdrop').onclick = () => sheet.close();
      document.addEventListener('keydown', e => { if (e.key === 'Escape') sheet.close(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) App.render(); });
      App.render();
      const db = root.LocalDB.create(localStorage);
      App.db = db;   // 匯出／匯入用
      App.reinitAI();
      App.loadStore();
      if (root.Welcome.shouldShow(root.Config)) root.Welcome.open();   // 第一次打開才出現
    },

    // 存完設定後重建 AI 轉接（Coach 遇到永久錯誤會把 sample 清掉）
    reinitAI() {
      root.Coach.init(root.LocalAI.create({ getConfig: () => root.Config.current(), fetch: (...a) => fetch(...a) }));
    },
    // 匯入備份後也用這個重新載入
    loadStore() {
      root.Store.init(App.db, 'local', { onData: App.onData, onError: msg => root.UI.toast(msg, true) });
    },
  };

  root.App = App;
  if (typeof module !== 'undefined') module.exports = App;
  if (typeof document !== 'undefined' && document.getElementById) App.start();
})(typeof window !== 'undefined' ? window : globalThis);
