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
      const { $, sheet, toast } = root.UI;
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
      const use = n => root.claude?.use ? root.claude.use(n).catch(() => null) : Promise.resolve(null);
      const [db, user, sample] = await Promise.all([use('db'), use('user'), use('sample')]);
      const uid = user ? await user.id().catch(() => null) : null;
      root.Coach.init(sample);
      root.Store.init(db, uid, { onData: App.onData, onError: msg => toast(msg, true) });
    },
  };

  root.App = App;
  if (typeof module !== 'undefined') module.exports = App;
  if (typeof document !== 'undefined' && document.getElementById) App.start();
})(typeof window !== 'undefined' ? window : globalThis);
