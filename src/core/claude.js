// 呼叫 AI：組 prompt、驗證回傳、錯誤訊息轉成中文
(function (root) {
  const L = root.Logic;
  const MSG = {
    rate_limited: 'AI 的用量暫時到上限，等一下再試，或先手動新增品項。',
    image_rejected: '這張照片讀不了，換一張試試。',
    disabled: '還沒設定 AI 金鑰，到概覽頁的 AI 設定填寫。',
    bad_key: '金鑰無效或沒有權限，到 AI 設定檢查。',
    invalid: '這次沒估出來，再試一次，或直接手動新增品項。',
    chat_empty: `${root.Profile?.text.coachWord ?? '教練'}沒有回應，再試一次。`,
  };
  // 聊天裡沒有「手動新增品項」可以按，換掉那句
  const CHAT_MSG = {
    [MSG.rate_limited]: 'AI 的用量暫時到上限，等一下再試。',
    [MSG.disabled]: '還沒設定 AI 金鑰，到概覽頁的 AI 設定填寫。',
    [MSG.invalid]: MSG.chat_empty,
  };
  const PERMANENT = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  let sample = null, ctl = null;
  // 教練人設（名字、代名詞、目標、口吻）來自 profile.js
  const P = () => root.Profile.coach;

  function fail(e) {
    const code = e?.code || 'upstream_error';
    if (code === 'cancelled') return { code, message: '' };
    if (PERMANENT.includes(code)) { sample = null; return { code, message: MSG.disabled }; }
    return { code, message: MSG[code] || MSG.invalid };
  }

  async function call(kind, prompt, opts = {}) {
    if (!sample) throw { code: 'not_granted', message: MSG.disabled };
    // 一次只跑一個 AI 呼叫：新的呼叫會取消進行中的那一個
    ctl?.abort();
    const c = ctl = new AbortController();
    try {
      if (kind === 'json') return await sample.json(prompt, { ...opts, signal: c.signal });
      const r = await sample(prompt, { ...opts, signal: c.signal });
      return kind === 'full' ? r : r.text;
    } catch (e) { throw fail(e); }
  }

  const itemLine = (name, it) => `- ${it.emoji || ''}${name}：每份 ${it.kcal} kcal，蛋白質 ${it.protein} g，碳水 ${it.carbs} g，脂肪 ${it.fat} g，纖維 ${it.fiber ?? 0} g，鈉 ${it.sodium ?? 0} mg`;

  // 列出傳入的每一家有記錄過品項的店（要帶哪幾家由呼叫端決定）
  const storesText = stores => Object.entries(stores ?? {})
    .filter(([, items]) => items && Object.keys(items).length)
    .map(([name, items]) => `${P().who}在「${name}」記錄過的品項：\n${Object.entries(items).map(([n, it]) => itemLine(n, it)).join('\n')}`)
    .join('\n\n');

  // 照片估份量：先估重量再換算，用台灣常見份量當基準（衛福部食物代換表）；實際用起來偏高估，所以明講不要往高估
  const PORTION = `估份量的方法：
- 先認出每一樣食物，再用照片裡的東西當比例尺估「熟重」：餐盤約 25 cm、飯碗、便當盒、筷子約 23 cm、湯匙、手掌、杯子。照片實際看到多少就估多少，不要直接套「通常一份」的量；小碗就是小碗，沒吃完、剩下的要扣掉。
- 用重量乘上每 100 g 的營養換算，不要憑印象直接給熱量。
- 份量基準：飯碗八分滿白飯約 160 g、280 kcal，便當的飯通常約 1–1.5 碗；掌心大小一指厚的肉約 90 g；一份青菜約 100 g、約 25 kcal；一顆蛋約 55 g、75 kcal；一茶匙油 5 g、45 kcal；手搖飲中杯 500 ml、大杯 700 ml，全糖大杯約 50 g 糖，半糖減半、微糖約三成。
- 看不到的油用一般店家的量：炒青菜一份約 1 茶匙油，炒飯、炒麵約 2–3 茶匙，油炸另算麵衣和吸油；醬汁、勾芡、湯汁有喝才算。不要每一道都加到最多。
- 給最可能的數字，不要為了保險往高估，也不要往低估。
- portion 寫一份的估計重量和依據，例如「約 250 g（1.5 碗）」，15 字內。`;

  const RULES = `規則：
- 每個品項只給單一估值，不要範圍。營養素是「一份」的數字。
- 同一個品項吃了好幾份，用 qty 表示，不要重複列。
- 同一家店的同名品項，一律沿用上面記錄過的數字。
- 每個品項都填 store（這個品項的店名，看不出來填空字串）。一餐有好幾家店時，各自填各自的店名。
- 便當、套餐這類組合要拆成菜色，每道菜各自一個品項，group 都填同一個組合名稱（例如「雞腿便當」）；單點的品項 group 填 null。
- qty 可以是 0.5 的倍數，例如飯吃一半填 0.5。
- 只有在估算誤差可能超過約 100 kcal 時，才在 question 問一個最關鍵的問題，否則 question 填 null。就算要問，也要先給最佳估值。
- summary 是一句話結論，最多一個 emoji。
- tips 最多兩條，每條一句、口語。可以根據今天剩下的熱量和蛋白質給建議。不鼓勵極端節食。
- emoji 選一個最像這個品項的食物 emoji。
- fiber 是膳食纖維（g），sodium 是鈉（mg）。湯、醬料、醃漬物的鈉都要算進去。鈉從照片很難估，偏鹹的餐要在 tips 提醒「鈉只是參考」。`;

  function buildEstimatePrompt({ hasImage, note, mealType, context: c }) {
    const store = storesText(c.stores) || '描述裡沒有提到記錄過的店。';
    const recent = c.recentItems.length ? c.recentItems.map(r => itemLine((r.store ? r.store + ' ' : '') + r.item.name, r.item)).join('\n') : '（還沒有）';
    const { name, who, goal } = P();
    return `你是${goal}營養教練「${name}」，幫使用者把一餐拆成品項並估算營養。${who}住在台灣，常吃外食、便當、迴轉壽司、單點小吃。
${hasImage ? '附上的照片就是這一餐。' : '這一餐沒有照片，只有文字描述。'}
餐別：${mealType}
${who}的補充說明：${note || '（無）'}
${who}的每日目標 ${c.settings.target} kcal、蛋白質 ${c.settings.protein} g；今天已經吃了 ${c.todayTotals.kcal} kcal、蛋白質 ${c.todayTotals.protein} g。

${store}

${who}最近吃過的品項：
${recent}

${RULES}

${PORTION}

只回 JSON，格式如下：
{"store":"店名，看不出來就填空字串","summary":"…","items":[{"emoji":"🍣","name":"鮭魚握壽司","qty":3,"portion":"約 35 g（一貫）","kcal":120,"protein":6,"carbs":18,"fat":3,"fiber":0,"sodium":450,"store":"壽司郎","group":null}],"tips":["…"],"question":null}`;
  }

  const chatRules = ({ name, who, goal, style, limit, focus, exercise }) => `你是${goal}營養教練「${name}」，具備營養師的專業知識，陪使用者聊飲食和${goal}。${who}住在台灣，常吃外食、便當、小吃。
回答規則：
${style}
- 對話中的 [月/日] 標記表示那之後訊息的日期。之前幾天說的餐點和數字不是今天的，今天的紀錄以「今天吃了」為準。
- 建議要根據下面${who}的紀錄。數字一律標單位（kcal、g、ml）。
- 不取代醫療建議。疾病、用藥、懷孕、哺乳或飲食疾患相關的問題，請${who}諮詢醫師或營養師。
${limit}
${focus}
- 運動和飲食一樣重要。回顧今天或這週時，飲食和運動要一起看（肌力訓練這週練了幾天、對照每週目標）；指令可以是運動，不一定都是飲食。${who}有練的那天，提醒練完把蛋白質補上。平常聊天不用每則都提運動，同一天提醒一次就好。
${exercise}
- 只有${who}說要記錄吃了什麼時，才在回答最後另起一行附上 <meal>JSON</meal>，一次一餐。份量不清楚、誤差可能超過約 100 kcal 時，先問${who}，不要附。
  JSON 格式：{"mealType":"早餐、午餐、晚餐或點心","store":"店名，看不出來填空字串","summary":"一句話","items":[{"emoji":"🍱","name":"雞腿便當","qty":1,"portion":"約 550 g（一盒）","kcal":780,"protein":35,"carbs":90,"fat":28,"fiber":4,"sodium":1500,"store":"","group":null}]}
  營養素是「一份」的數字，同一品項吃好幾份用 qty；同一家店記錄過的品項沿用記錄的數字。每個品項填 store；便當、套餐拆成菜色，group 填同一個組合名稱；qty 可以是 0.5 的倍數。
${PORTION}`;

  function buildChatPreamble({ summary, body, todayDetail, stores, now }) {
    const known = storesText(stores);
    const store = known ? `\n${known}\n` : '';
    return `${chatRules(P())}

現在時間：${now}
${P().who}最近兩週的紀錄：
${summary}
${body ? `\n${body}\n` : ''}
今天吃了：
${todayDetail}
${store}
接下來是你們的對話。`;
  }

  const Coach = {
    init(s) { sample = s || null; ctl = null; },
    get available() { return !!sample; },
    cancel() { ctl?.abort(); },
    buildEstimatePrompt,
    buildChatPreamble,

    async estimate({ image, note, mealType, context }) {
      // 有照片時用比較強的模型看份量（慢幾秒、多用一點額度）
      const raw = await call('json', buildEstimatePrompt({ hasImage: !!image, note, mealType, context }), image ? { images: [image], modelTier: 'complex' } : {});
      const r = L.validateEstimate(raw);
      if (!r.ok) throw { code: 'invalid_json', message: MSG.invalid };
      return r.value;
    },

    async estimateItem(name, store) {
      const prompt = `你是${P().goal}營養教練「${P().name}」。估算台灣${store ? `「${store}」的` : ''}「${name}」一份的營養。
只回 JSON：{"emoji":"🍣","name":"${name}","kcal":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sodium":0}
每個數字只給單一估值。emoji 選一個最像這個品項的食物 emoji。`;
      const raw = await call('json', prompt, { modelTier: 'quick' });
      const r = L.validateEstimate(Array.isArray(raw?.items) ? raw : { items: [{ ...raw, qty: 1 }] });
      if (!r.ok) throw { code: 'invalid_json', message: MSG.invalid };
      return { ...r.value.items[0], qty: 1 };
    },

    async estimateExercise(name) {
      const prompt = `你是${P().goal}教練「${P().name}」。估算「${name}」這項運動以一般強度進行時的 MET 值（可參考 Compendium of Physical Activities）。
只回 JSON：{"met":6.8,"note":"一句很短的說明，例如：中等強度室內飛輪"}
met 只給一個數字，不要範圍。`;
      const raw = await call('json', prompt, { modelTier: 'quick' });
      const met = Number(raw?.met);
      if (!Number.isFinite(met) || met < 1 || met > 20) throw { code: 'invalid_json', message: MSG.invalid };
      return { met: Math.round(met * 10) / 10, note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 40) : '' };
    },

    async insight(summaryText) {
      const { name, who, goal, insightTone } = P();
      const prompt = `你是${goal}營養教練「${name}」，用${insightTone}的口吻，給使用者這週的回顧。
以下是${who}上週和這週每天的紀錄（只列到今天）：
${summaryText}

以今天為基準回答：今天之後的日子還沒到，不是漏記，不要說「後面還沒有紀錄」；今天還沒過完，不要把今天的數字當成一整天來評論。
這週過完的天數少於 3 天時，主要回顧上週，再簡短說這週開始得如何；3 天以上時回顧這週，並和上週比較變化（平均熱量、蛋白質、肌力訓練天數、體重 7 日平均）。

用繁體中文寫 3–5 行，每行一個重點、每行開頭一個 emoji：
第一行是一句結論；接著「📊」一句和上週的比較；接著「✅」一個做得好的地方；「⚠️」一個要注意的地方（沒有就省略）；最後「🎯」一個下週能做到的具體建議。
運動和飲食一樣重要：至少一行要講運動（這週肌力訓練練了幾天、和每週目標差多少），🎯 也可以是運動建議。
每行一句話，最關鍵的數字或字詞用 **粗體**（全部最多 3 處）。不要用標題、表格。不鼓勵極端節食。`;
      const text = String((await call('text', prompt, { cache: false })) ?? '').trim();
      if (!text) throw { code: 'invalid_json', message: MSG.invalid };
      return text;
    },

    async chat({ messages, image, context, onText }) {
      const opts = { cache: false };
      if (image) opts.images = [image];
      if (onText) opts.onText = ({ text }) => onText(L.chatVisible(text));
      let res;
      try { res = await call('full', L.chatTurns(buildChatPreamble(context), messages), opts); }
      catch (e) { throw { ...e, message: CHAT_MSG[e.message] ?? e.message }; }
      const r = L.splitMeal(res?.text);
      if (res?.truncated) r.interrupted = true;   // 回答被截斷：照樣存，標「（中斷）」
      if (!r.text && r.meal) r.text = r.meal.summary || '幫你整理好了。';
      if (!r.text && !r.meal) throw { code: 'invalid_json', message: MSG.chat_empty };
      return r;
    },
  };

  root.Coach = Coach;
  if (typeof module !== 'undefined') module.exports = Coach;
})(typeof window !== 'undefined' ? window : globalThis);
