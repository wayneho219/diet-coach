// 資料層：db 訂閱、寫入佇列、樂觀更新
(function (root) {
  const L = root.Logic;
  const DEFAULTS = { height: null, weight: null, age: null, activity: 1.375, target: 1800, protein: 90, water: 2000, cup: 500, customEx: {}, cap: 150, fiber: 25, sodium: 2300, strengthGoal: 3, ...root.Profile?.defaults };   // profile 可以覆寫（例如增重版）
  const READ_ONLY_MSG = '資料沒辦法存到這個瀏覽器。';

  let S, col, queue, cb, unsubs = [], pending = 0, held = new Map();
  function reset() {
    unsubs.forEach(u => u()); unsubs = [];
    S = { days: [], foods: { stores: {} }, settings: { ...DEFAULTS }, insight: null, chat: [], ready: false, readOnly: true,
      loaded: { days: false, foods: false, settings: false, insight: false, chat: false } };
    col = null; pending = 0; held = new Map(); queue = Promise.resolve(); cb = { onData() {}, onError() {} };
  }
  reset();

  const emptyDay = key => ({ kind: 'day', date: key, meals: [], water: [], exercise: [], weight: null });
  const normDay = d => ({ ...emptyDay(d.date), ...structuredClone(d), meals: L.mergeSameType((d.meals ?? []).map(m => L.normalizeMeal(structuredClone(m)))) });   // 同餐別只留一筆，下次寫入時存回

  function errMsg(e) {
    switch (e?.code) {
      case 'quota_exceeded': return '瀏覽器儲存空間滿了，先匯出備份再清掉舊資料。';
      default: return '剛剛那筆沒存到，請再試一次。';
    }
  }

  // 依序送出；某一筆失敗不會卡住後面的寫入
  function enqueue(fn) {
    pending++;
    const p = queue.then(fn);
    queue = p.catch(() => {}).then(() => {
      pending = Math.max(0, pending - 1);
      if (pending > 0) return;
      try {
        const fns = [...held.values()]; held.clear();
        if (fns.length) { fns.forEach(f => f()); cb.onData(); }
      } catch (e) {
        try { cb.onError('畫面更新失敗，請重新開啟頁面。'); } catch (_) {}
      }
    }).catch(() => {});
    return p.catch(e => { cb.onError(errMsg(e)); throw e; });
  }
  // 有寫入排隊或進行中時，先把快照留著，佇列清空後再套用最新的一份
  function apply(key, fn) {
    if (pending > 0) held.set(key, fn); else { fn(); cb.onData(); }
  }
  // 沒有 db 就唯讀；第一份快照還沒到之前不能寫，否則會用空資料蓋掉使用者的紀錄
  function guard(...needs) {
    if (!col) { cb.onError(READ_ONLY_MSG); return false; }
    if (needs.some(k => !S.loaded[k])) { cb.onError('還在載入，等一下再試。'); return false; }
    return true;
  }
  const denied = () => Promise.reject({ code: col ? 'not_loaded' : 'read_only' });

  const Store = {
    DEFAULTS,
    get days() { return S.days; },
    get foods() { return S.foods; },
    get settings() { return S.settings; },
    get insight() { return S.insight; },
    get chat() { return S.chat; },
    get ready() { return S.ready; },
    get readOnly() { return S.readOnly; },

    init(db, uid, callbacks = {}) {
      reset();
      Object.assign(cb, callbacks);
      if (!db || !uid) { S.ready = true; cb.onData(); return; }
      col = db.collection('data/users/' + uid);
      S.readOnly = false;
      const since = L.addDays(L.dayKey(), -120);
      unsubs.push(col.where('kind', '==', 'day').where('date', '>=', since).orderBy('date', 'desc').limit(130).onSnapshot(
        snap => apply('days', () => { S.days = snap.docs.map(d => normDay(d.data())).sort((a, b) => b.date.localeCompare(a.date)); S.ready = true; S.loaded.days = true; }),
        e => cb.onError(errMsg(e))));
      const single = (id, fn) => unsubs.push(col.doc(id).onSnapshot(snap => apply(id, () => { S.loaded[id] = true; if (snap.exists) fn(structuredClone(snap.data())); }), e => cb.onError(errMsg(e))));
      single('foods', d => { S.foods = { stores: {}, ...d }; });
      single('settings', d => { S.settings = { ...DEFAULTS, ...d }; });
      single('insight', d => { S.insight = d; });
      single('chat', d => { S.chat = L.trimChat(d.messages); });
    },

    day(key) { return S.days.find(d => d.date === key) ?? emptyDay(key); },

    updateDay(key, mutate) {
      if (!guard('days')) return denied();
      const day = structuredClone(Store.day(key));
      mutate(day);
      day.meals = L.mergeSameType(day.meals);   // 同一天同餐別永遠只有一筆
      S.days = [day, ...S.days.filter(d => d.date !== key)].sort((a, b) => b.date.localeCompare(a.date));
      cb.onData();
      const snapshot = structuredClone(day);
      return enqueue(() => col.doc('day-' + key).set(snapshot));
    },

    saveMeal(key, meal) {
      if (!guard('days', 'foods')) return denied();
      const m = L.syncMealStore(meal);
      const p = Store.updateDay(key, d => {
        const i = d.meals.findIndex(x => x.id === m.id);
        if (i >= 0) d.meals[i] = structuredClone(m); else d.meals.push(structuredClone(m));
      });
      return Promise.all([p, Store.saveFoods(L.mergeFoods(S.foods, m, key))]);
    },

    deleteMeal(key, id) { return Store.updateDay(key, d => { d.meals = d.meals.filter(m => m.id !== id); }); },

    saveSettings(patch) {
      if (!guard('settings')) return denied();
      S.settings = { ...S.settings, ...patch }; cb.onData();
      const data = { ...S.settings };
      return enqueue(() => col.doc('settings').set(data));
    },
    saveFoods(foods) {
      if (!guard('foods')) return denied();
      S.foods = foods; cb.onData();
      const data = structuredClone(foods);
      return enqueue(() => col.doc('foods').set(data));
    },
    saveInsight(obj) {
      if (!guard('insight')) return denied();
      S.insight = obj; cb.onData();
      return enqueue(() => col.doc('insight').set({ ...obj }));
    },
    saveChat(messages) {
      if (!guard('chat')) return denied();
      S.chat = L.trimChat(messages); cb.onData();
      const data = { messages: structuredClone(S.chat) };
      return enqueue(() => col.doc('chat').set(data));
    },
    clearChat() { return Store.saveChat([]); },
  };

  root.Store = Store;
  if (typeof module !== 'undefined') module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
