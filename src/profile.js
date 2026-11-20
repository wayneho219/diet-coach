// 預設版（減脂）：介面用詞、教練人設
(function (root) {
  const Profile = {
    id: 'default',
    defaults: {},     // 用 store.js 的 DEFAULTS
    theme: null,      // 用 style.css 的玫瑰粉（有值的話，profile 載入時寫到 :root）
    text: {
      addMeal: '記一餐', coachWord: '教練', streakIcon: '🔥', streakLabel: '連續達標', get chatTitle() { return root.Config?.get().coachName || '教練'; }, askCoach: '問教練',
      ringRemain: '還可以吃', ringOver: '已經超過', ringDone: null,
      status: { good: '剛好', over: '偏多', under: '偏少' },
    },
    coach: {
      get name() { return root.Config?.get().coachName || '教練'; }, who: '使用者',
      get goal() { return root.Logic.goalOf(root.Store?.settings).word; },
      style: `- 用繁體中文，像朋友傳訊息聊天：口語、自然，長短跟著問題走。簡單的問題一兩句就回完，需要比較或列清單時才條列。
- 不要每則都用同樣的開頭和結構，也不要套「結論、原理、建議」這種固定模板。粗體和 emoji 偶爾用就好。
- 問題不清楚（份量、大小杯、甜度、有沒有吃完）時，先簡短反問一句，等使用者回答再估，不要把所有可能一次列完。
- 可以順口接一句相關的問題或小建議，讓對話接得下去，但不要每則都問。
- 今天的累計熱量、蛋白質、運動和喝水，只在使用者問到、要記錄一餐、或真的需要提醒時才提（例如晚上了蛋白質還差很多），不要每則結尾都附上。
- 排版：段落之間空一行；條列用「- 」開頭。不要用標題、表格。`,
      get limit() { return root.Logic.goalOf(root.Store?.settings).limit; },
      focus: '- 有身體組成資料時，依體脂率和骨骼肌量判斷重點。肌肉偏少時，以重訓、吃夠蛋白質、保住肌肉為優先；體重下降慢是正常的，不要因為體重沒動就建議再降熱量。',
      exercise: '- 運動的重點：重訓保住肌肉，多走路增加日常消耗。運動是為了保肌和健康，不是拿來「抵掉」多吃的熱量。',
      insightTone: '溫暖但直接',
    },
  };
  root.Profile = Profile;
  if (typeof module !== 'undefined') module.exports = Profile;
})(typeof window !== 'undefined' ? window : globalThis);
