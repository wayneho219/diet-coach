// 聊天：右下角 💬 打開，和 教練多輪對話；教練附的記餐小卡會進到記一餐草稿
(function (root) {
  let st = null, draft = '';   // draft：關掉視窗（Escape、下滑）時打到一半的字，下次打開放回去

  function open() {
    const { el, sheet, confirmTap } = root.UI;
    st = { image: null, sentImage: null, imageUrl: null, thumbs: new Map(), busy: false, stream: '', seen: null, list: null, send: null, input: null, preview: null };
    st.list = el('div', { class: 'chat-list' });
    st.say = el('p', { class: 'sr', 'aria-live': 'polite' });   // 只念教練回完的那一則，串流時不吵
    const clear = confirmTap(el('button', { class: 'btn btn-ghost chat-clear' }, '清除'), () => {
      if (st.busy) return;
      root.Store.clearChat().catch(() => {});
    });
    sheet.open(el('div', { class: 'sheet-body chat' },
      el('div', { class: 'chat-head', 'data-drag': '' }, el('h2', { class: 'sheet-title' }, root.Profile.text.chatTitle), clear),
      st.list, st.say,
      compose()), { onClose: () => {
        root.Coach.cancel();
        draft = st?.input?.value ?? '';
        if (st?.imageUrl) URL.revokeObjectURL(st.imageUrl);
        st?.thumbs.forEach(u => URL.revokeObjectURL(u));
        st = null;
      } });
    draw();
    grow();
  }

  // 輸入框跟著字數長高，最高到 CSS 的 max-height
  const grow = () => { const t = st?.input; if (!t) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + t.offsetHeight - t.clientHeight + 'px'; };   // border-box：加回上下框線

  // 輸入區只建一次，重畫訊息時不碰它，打到一半的字和焦點才不會掉
  function compose() {
    const { el } = root.UI;
    if (!root.Coach.available) return el('p', { class: 'hint chat-compose' }, '目前不能用 AI');
    st.input = el('textarea', { class: 'chat-input', rows: '1', maxlength: '4000', placeholder: root.Profile.text.askCoach + '…', 'aria-label': '訊息', oninput: grow });
    st.input.value = draft;
    st.preview = el('div', { class: 'chat-preview' });
    st.send = el('button', { class: 'btn btn-primary', onclick: () => st.busy ? root.Coach.cancel() : send() }, '送出');
    return el('div', { class: 'chat-compose' }, st.preview,
      el('div', { class: 'chat-row' },
        el('label', { class: 'btn btn-soft chat-photo', for: 'chat-photo', 'aria-label': '附照片' }, '📷'),
        el('input', { class: 'sr', type: 'file', id: 'chat-photo', accept: 'image/*', onchange: pickPhoto }),
        st.input, st.send));
  }

  async function pickPhoto(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const cur = st;
    const blob = await root.UI.toJpeg(f);
    if (st !== cur) return;
    if (st.imageUrl) URL.revokeObjectURL(st.imageUrl);
    st.image = blob; st.imageUrl = URL.createObjectURL(blob);
    drawPreview();
  }

  function drawPreview() {
    const { el } = root.UI;
    st.preview.replaceChildren(...(st.imageUrl ? [
      el('img', { src: st.imageUrl, alt: '要附的照片' }),
      el('button', { class: 'btn btn-ghost', 'aria-label': '移除照片', onclick: () => { URL.revokeObjectURL(st.imageUrl); st.image = st.imageUrl = null; drawPreview(); } }, '✕'),
    ] : []));
  }

  function send() {
    const text = st.input.value.trim();
    const image = st.image;
    if (!text && !image) return;
    const msg = { role: 'user', text, at: new Date().toISOString(), ...(image ? { image: true } : {}) };
    root.Store.saveChat([...root.Store.chat, msg]).catch(() => {});
    if (root.Store.chat.at(-1)?.at !== msg.at) return;   // 沒存進去（唯讀或還在載入），Store 已經跳出提示
    if (st.imageUrl) st.thumbs.set(msg.at, st.imageUrl);
    st.input.value = ''; st.imageUrl = null; grow();
    st.sentImage = image; st.image = null;              // 照片 blob 移到 sentImage，失敗重試時還能一起送
    drawPreview();
    ask();
  }

  async function ask() {
    const L = root.Logic, Store = root.Store, today = root.App.today();
    const last = Store.chat.at(-1);
    const names = L.detectStores(Store.foods, last?.text);
    const context = {
      summary: L.weekSummaryText(Store.days, today, Store.settings),
      body: L.bodyCompText(Store.settings, Store.days.find(d => d.weight)?.weight ?? Store.settings.weight),
      todayDetail: L.todayDetailText(Store.day(today)),
      stores: Object.fromEntries(names.map(n => [n, Store.foods.stores?.[n]?.items ?? null])),
      now: new Date().toLocaleString('zh-TW', { hour12: false }),
    };
    const cur = st;
    st.busy = true; st.stream = ''; draw();
    try {
      // 重開視窗後照片已經不在了，不要再跟教練說「附照片」
      const photo = last?.image ? st.sentImage : null;
      const messages = last?.image && !photo ? [...Store.chat.slice(0, -1), { ...last, image: false }] : Store.chat;
      const r = await root.Coach.chat({ messages, image: photo, context,
        onText: t => { if (st === cur) { st.stream = t; drawStream(); } } });
      if (st !== cur) return;
      st.sentImage = null;
      Store.saveChat([...Store.chat, { role: 'assistant', text: r.text, at: new Date().toISOString(), ...(r.meal ? { meal: r.meal } : {}), ...(r.interrupted ? { interrupted: true } : {}) }]).catch(() => {});
      st.say.textContent = r.text;
    } catch (e) {
      if (st !== cur) return;
      if (st.stream.trim()) { st.sentImage = null; Store.saveChat([...Store.chat, { role: 'assistant', text: st.stream, at: new Date().toISOString(), interrupted: true }]).catch(() => {}); }
      else if (e?.message) root.UI.toast(e.message, true);
    } finally {
      if (st === cur) { st.busy = false; st.stream = ''; draw(); }
    }
  }

  // 小時間戳：今天只顯示時間，其他天加上月/日
  function stamp(at, role) {
    const d = new Date(at);
    if (!at || Number.isNaN(d.getTime())) return null;
    const hm = d.toTimeString().slice(0, 5), day = root.Logic.dayKey(d);
    return root.UI.el('time', { class: `stamp ${role}`, datetime: at }, day === root.App.today() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`);
  }

  function bubble(m, i, all) {
    const { el, fmt } = root.UI, L = root.Logic;
    const thumb = st.thumbs.get(m.at);
    const node = el('div', { class: `bubble ${m.role}` },
      thumb ? el('img', { src: thumb, alt: '附的照片' }) : m.image ? el('span', { 'aria-label': '附照片' }, '📷 ') : null,
      m.role === 'assistant' ? root.UI.rich(m.text) : m.text, m.interrupted ? el('span', { class: 'muted' }, '（中斷）') : null);
    const out = [stamp(m.at, m.role), node].filter(Boolean);
    if (m.meal?.items?.length) {
      const type = m.meal.mealType || L.defaultMealType(Number.isNaN(new Date(m.at).getHours()) ? new Date().getHours() : new Date(m.at).getHours());
      const n = m.meal.items.length;
      out.push(el('div', { class: 'meal-card' },
        el('span', {}, `${type}・${m.meal.items[0].name}${n > 1 ? `等 ${n} 項` : ''}・約 ${fmt(L.mealTotals(m.meal).kcal)} 大卡`),
        m.logged ? el('button', { class: 'btn btn-soft', disabled: true }, '已記錄')
          : el('button', { class: 'btn btn-primary', onclick: () => root.AddMeal.openDraft({ dateKey: root.App.today(), mealType: type, store: m.meal.store, items: m.meal.items,
              onSaved: () => root.Store.saveChat(root.Store.chat.map(x => x.at === m.at && x.role === 'assistant' ? { ...x, logged: true } : x)).catch(() => {}) }) }, '確認記錄')));
    }
    // 最後一則是使用者的、而且沒有在等回答：上次失敗或被停止，給重試
    // 只有照片、照片又已經不在了，就沒東西可重送
    if (i === all.length - 1 && m.role === 'user' && !st.busy && root.Coach.available && (m.text || st.sentImage))
      out.push(el('button', { class: 'btn btn-soft chat-retry', onclick: ask }, '重試'));
    return out;
  }

  function drawStream() {
    const node = st.list.querySelector('.bubble.streaming');
    if (node) { node.replaceChildren(...(st.stream ? root.UI.rich(st.stream) : ['…'])); scrollEnd(); }
  }

  function draw() {
    if (!st) return;
    const { el } = root.UI, msgs = root.Store.chat;
    st.seen = msgs;
    // replaceChildren 會把 null 印成文字「null」，所以閒置時不能傳 null
    st.list.replaceChildren(...msgs.flatMap(bubble),
      ...(st.busy ? [el('div', { class: 'bubble assistant streaming' }, st.stream ? root.UI.rich(st.stream) : '…')] : []));
    if (st.send) st.send.textContent = st.busy ? '停止' : '送出';
    scrollEnd();
  }

  const scrollEnd = () => { const s = root.UI.$('sheet'); s.scrollTop = s.scrollHeight; };

  const Chat = {
    open,
    // App 每次收到資料都會呼叫；只有對話真的換了才重畫，避免別的資料更新時跳動
    refresh() { if (st && root.Store.chat !== st.seen) draw(); },
  };
  root.Chat = Chat;
  if (typeof module !== 'undefined') module.exports = Chat;
})(typeof window !== 'undefined' ? window : globalThis);
