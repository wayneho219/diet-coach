// localStorage 版資料庫替身：介面對齊 Store 用到的 db（collection / doc / where / orderBy / limit / onSnapshot）
// ponytail: localStorage 約 5 MB、一天約 3 KB；快滿再改 IndexedDB
(function (root) {
  const clone = v => JSON.parse(JSON.stringify(v));

  function create(storage, prefix = 'diet-coach:') {
    const subs = new Set();   // { col, run, active }
    const quota = () => ({ code: 'quota_exceeded' });

    function write(path, data) {
      try { storage.setItem(prefix + path, JSON.stringify(data)); } catch (_) { throw quota(); }
    }
    function readAll(col) {
      const head = prefix + col + '/', out = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(head) && !k.slice(head.length).includes('/')) {
          out.push({ id: k.slice(head.length), raw: storage.getItem(k) });
        }
      }
      return out;
    }
    // 在 microtask 通知訂閱者（col 為 null 表示全部）
    function notify(cols) {
      queueMicrotask(() => [...subs].forEach(s => { if (s.active && (!cols || cols.has(s.col))) s.run(); }));
    }
    function subscribe(col, run, error) {
      const s = { col, active: true, run: () => { try { run(); } catch (e) { if (error) error(e); } } };
      subs.add(s);
      queueMicrotask(() => { if (s.active) s.run(); });
      return () => { s.active = false; subs.delete(s); };
    }

    function query(col, filters, order, max) {
      const q = {
        where: (f, op, v) => query(col, [...filters, [f, op, v]], order, max),
        orderBy: (f, dir = 'asc') => query(col, filters, [f, dir], max),
        limit: n => query(col, filters, order, n),
        onSnapshot(next, error) {
          return subscribe(col, () => {
            let rows = readAll(col).map(r => ({ id: r.id, d: JSON.parse(r.raw) }))
              .filter(({ d }) => filters.every(([f, op, v]) => op === '==' ? d[f] === v : op === '>=' ? d[f] >= v : false));
            if (order) {
              const [f, dir] = order, sign = dir === 'desc' ? -1 : 1;
              rows.sort((a, b) => (a.d[f] < b.d[f] ? -1 : a.d[f] > b.d[f] ? 1 : 0) * sign);
            }
            if (max != null) rows = rows.slice(0, max);   // 排序後才截斷
            next({ docs: rows.map(({ id, d }) => ({ id, data: () => clone(d) })) });
          }, error);
        },
      };
      return q;
    }

    return {
      collection(col) {
        return {
          ...query(col, [], null, null),
          doc(id) {
            const path = col + '/' + id;
            return {
              async set(data) { write(path, data); notify(new Set([col])); },
              onSnapshot(next, error) {
                return subscribe(col, () => {
                  const raw = storage.getItem(prefix + path);
                  next({ exists: raw !== null, data: () => (raw === null ? undefined : JSON.parse(raw)) });
                }, error);
              },
            };
          },
        };
      },

      exportAll() {
        const head = prefix + 'data/', docs = {};
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(head)) docs[k.slice(prefix.length)] = JSON.parse(storage.getItem(k));
        }
        return { app: 'diet-coach', version: 1, docs };
      },

      async importAll(obj) {
        const ok = obj && obj.app === 'diet-coach' && obj.version === 1 && obj.docs && typeof obj.docs === 'object' && !Array.isArray(obj.docs)
          && Object.entries(obj.docs).every(([k, v]) => k.startsWith('data/') && v && typeof v === 'object' && !Array.isArray(v));
        if (!ok) throw { code: 'invalid_backup' };
        const entries = Object.entries(obj.docs);
        const head = prefix + 'data/';
        // 先記下所有舊的 data/ 資料（不含 config），失敗時整批還原
        const old = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(head)) old.push([k, storage.getItem(k)]);
        }
        try {
          old.forEach(([k]) => storage.removeItem(k));
          entries.forEach(([k, v]) => write(k, v));
        } catch (e) {
          entries.forEach(([k]) => { try { storage.removeItem(prefix + k); } catch (_) {} });
          old.forEach(([k, raw]) => { try { storage.setItem(k, raw); } catch (_) {} });
          throw e;
        }
        notify(null);
      },
    };
  }

  const LocalDB = { create };
  root.LocalDB = LocalDB;
  if (typeof module !== 'undefined') module.exports = LocalDB;
})(typeof window !== 'undefined' ? window : globalThis);
