# 公開版飲食記錄 App（diet-coach）設計

## 目標

把現有的私有飲食記錄 App 整理成可以公開的版本：任何人 clone 或 fork 下來，用自己的 AI API 金鑰就能用，資料只存在自己的瀏覽器。

- 新專案 `~/diet-coach`，新的 git 歷史，之後開公開 GitHub repo。
- 程式碼從私有專案複製一份，之後兩邊各自發展，不做同步。
- 成功標準：沒有 Claude 帳號的人，照 README 在電腦或手機上打開，填好金鑰，就能用文字或照片記一餐、和教練聊天、看週回顧；程式碼和 git 歷史裡沒有任何私人資料。

## 不做的事

- 跨裝置同步、登入、後端伺服器。
- Artifact 版本的相容（公開版只跑 BYOK，Bring Your Own Key，使用者自帶金鑰）。
- 快速／精準兩種模型分流（每家只用一個模型）。
- 多語系（介面和 prompt 維持繁體中文、台灣飲食）。

## 架構

現有程式只在 `app.js` 向 Artifact 要兩個物件：`db` 交給 `Store`，`sample` 交給 `Coach`。公開版寫兩個介面相同的替身，`store.js`、`claude.js` 的邏輯和所有畫面不用改結構。

```
app.js ──► LocalDB  (src/local/db.js)  ──► Store (store.js，不改結構)
       └─► LocalAI  (src/local/ai.js)  ──► Coach (claude.js，只改文字)
                         ├─ anthropic
                         ├─ openai
                         └─ gemini
```

### LocalDB：`src/local/db.js`

只實作 `store.js` 實際用到的部分：

- `collection(path).doc(id)`：`set(data)`、`onSnapshot(next, error)`，快照有 `exists`、`data()`。
- `collection(path).where('kind','==',v).where('date','>=',v).orderBy('date','desc').limit(n).onSnapshot(next, error)`：快照的形狀照 `store.js` 讀取的方式（實作時對照 `store.js` 確認）。
- 底層用 localStorage，一份文件一個 key：`diet-coach:<path>/<id>`，值是 JSON 字串。
  - 容量約 5 MB；一天約 3 KB，可以存好幾年。程式碼用 `ponytail:` 註解標明上限，以及快滿時改用 IndexedDB 的升級方向。
- `set` 寫入後，用 microtask 通知同一份文件和符合條件查詢的訂閱者。只考慮單一分頁，不處理多分頁同步。
- localStorage 寫入失敗（`QuotaExceededError`）時，用 `{ code: 'quota_exceeded' }` 拒絕；`store.js` 的錯誤訊息照常顯示。
- 匯出／匯入：
  - `exportAll()` 回傳 `{ app: 'diet-coach', version: 1, docs: { <key>: <data> } }`，不含金鑰。
  - `importAll(obj)` 先驗證 `app` 和 `version`，清掉舊資料再寫入，然後通知所有訂閱者。
- `uid` 固定為 `'local'`，所以 `store.js` 的路徑 `data/users/local` 照用。

### LocalAI：`src/local/ai.js`

模擬 `sample` 的介面：

- `sample(input, opts)` 回傳 `{ text, truncated }`；`sample.json(input, opts)` 回傳解析後的值。
- `input` 可以是字串，或 `[{ role: 'user'|'assistant', content }]`。
- `opts` 支援：
  - `onText({ text })`：串流時每次給完整的累積文字。
  - `signal`：取消。
  - `images: Blob[]`：照片。
  - 其他欄位（`modelTier`、`cache`）忽略。
- JSON 容錯：先試 `JSON.parse` 整段回覆；失敗就抓第一個 `{` 或 `[` 到最後一個對應的 `}` 或 `]` 再解析；再失敗就用 `{ code: 'invalid' }` 拒絕。
- 照片：Blob 轉成 base64，格式固定 `image/jpeg`（`UI.toJpeg` 已經轉過）。
- 錯誤碼對應（拒絕時丟 `{ code }`）：

| 狀況 | code |
|---|---|
| 沒設定金鑰 | `not_granted` |
| HTTP 401、403 | `bad_key`（新增） |
| HTTP 429 | `rate_limited` |
| 使用者取消（AbortError） | `cancelled` |
| 網路失敗、其他 HTTP 錯誤 | `upstream_error` |

三家的轉接函式（每家只負責「組 request、把串流解析成文字」）：

| | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| 端點 | `POST https://api.anthropic.com/v1/messages` | `POST https://api.openai.com/v1/chat/completions` | `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse` |
| 金鑰標頭 | `x-api-key`，另加 `anthropic-version: 2023-06-01`、`anthropic-dangerous-direct-browser-access: true` | `Authorization: Bearer <key>` | `x-goog-api-key` |
| 照片 | `{type:'image', source:{type:'base64', media_type:'image/jpeg', data}}` | `{type:'image_url', image_url:{url:'data:image/jpeg;base64,…'}}` | `{inline_data:{mime_type:'image/jpeg', data}}` |
| 串流文字 | SSE `content_block_delta` 的 `delta.text` | SSE `choices[0].delta.content`，`[DONE]` 結束 | SSE `candidates[0].content.parts[].text` |
| assistant 角色名 | `assistant` | `assistant` | `model` |

- 照片附在最後一則 user 訊息上。
- 每次都用串流（`stream: true`），沒有傳 `onText` 也一樣，最後回傳累積的全文。
- 預設模型名稱寫在一個常數表裡，實作時查三家官方文件，填當下可用、支援看圖的模型；使用者可以在設定頁改。
- `max_tokens` 統一 4096（Anthropic 必填，其他家也帶上同義欄位）。

### 設定：`src/local/config.js` 加設定卡

- localStorage 的 `diet-coach:config` 存 `{ provider, keys: { anthropic, openai, gemini }, model: { … }, coachName }`。
  - 每家的金鑰分開存，切換服務時不會被清掉。
  - 匯出資料時不包含 config。
- 概覽頁最上方加一張「⚙️ AI 設定」卡：
  - 選服務（下拉選單）、金鑰（`type="password"`）、模型（文字欄，預設帶入常數表裡的值）。
  - 「測試連線」按鈕：送一句很短的請求，成功顯示 ✓，失敗顯示錯誤訊息。
  - 教練名稱：預設「教練」。
  - 「匯出備份」「匯入備份」按鈕。
  - 固定提醒三句：照片和文字會傳給你選的 AI 服務；API 費用由你自己負擔；iPhone 請「加入主畫面」，避免 Safari 清除資料。
- 還沒填金鑰時，這張卡自動展開，其他功能照常顯示；手動記錄不需要 AI，也能用。

### 安全

- 金鑰只存在使用者的 localStorage，不寫進 repo、不寫進匯出檔。
- `index.html` 加 CSP（Content Security Policy，限制網頁能載入和連線的來源）：
  - `default-src 'self'`
  - `img-src 'self' blob: data:`
  - `connect-src` 只允許上面三個 API 網域
- 確認 `UI.rich`（顯示 AI 回覆）只用 `textContent` 和 DOM 建立節點，不用 `innerHTML`，避免 AI 回覆裡的內容被當成程式碼執行，進而偷走金鑰。

## 目標設定：減脂／增肌減脂／增重

`settings.goal` 有三個值：`cut`、`recomp`（新增）、`bulk`。預設 `cut`。

`logic.js` 把目前散在各函式的 `goal === 'bulk'` 判斷，集中成一張 `GOALS` 表。各函式從表裡讀數字：

| | 減脂 `cut` | 增肌減脂 `recomp` | 增重 `bulk` |
|---|---|---|---|
| 建議每日熱量 | TDEE − 300 大卡，最低 1,200 | TDEE − 100 大卡，最低 1,200 | TDEE + 400 大卡 |
| 熱量目標下限 | 1,200 大卡 | 1,200 大卡 | 無 |
| 運動加回 | 淨消耗的 1/2 | 淨消耗的 1/2 | 淨消耗全部 |
| 碳水、脂肪超過目標 | 顯示超過 | 顯示超過 | 不顯示 |
| 🔥 達標的熱量範圍 | 目標的 85%–105% | 目標的 90%–105% | 目標的 90%–115% |
| 吃太少警告 | 最近 3 天都 < 1,200 大卡 | 最近 3 天都 < 1,200 大卡 | 最近 3 天都 < 目標的 85% |
| 首頁圓環 | 現有減脂行為 | 同減脂 | 現有增重行為 |
| prompt 的目標詞 | 減脂 | 增肌減脂 | 增重 |

（TDEE 是每日總消耗熱量 = 基礎代謝 × 活動係數。）

每週體重建議 `weekAdvice`（用 7 日平均體重，比較這週和上週）：

- `cut`、`bulk`：照現有規則不變。
- `recomp`：
  - 降超過 0.5%：建議每日目標 +100 大卡（「掉太快，增肌減脂不需要減重這麼快」）。
  - 升超過 0.5%：建議每日目標 −100 大卡（「上升太快，可能多長了脂肪」）。
  - 在 ±0.5% 以內：維持（「體重穩定，看腰圍和體脂變化」）。
  - 資料不足兩週：沿用現有的提示文字。

prompt 依目標加一句重點：

- `recomp`：「重點是重訓和吃夠蛋白質；體重大致不變是正常的，不要因為體重沒降就建議少吃。」
- `cut`、`bulk`：沿用現有的 `limit` 文字，例如減脂的「不鼓勵每天低於 1,200 kcal」，增重的「不鼓勵用高糖高油的垃圾食物硬塞熱量」。

依目標不同的介面文字（`ringDone`、吃太少警告、1,200 提示）也放進 `GOALS` 表。

「我的計畫」卡加兩個欄位：

- 目標（三選一）。切換目標時，如果有足夠資料算出 TDEE，顯示「建議目標 X 大卡」讓使用者自己套用，不自動改目標熱量。
- 性別（女／男）。`bmr` 已經支援 `sex`；目前畫面上沒有這個欄位，預設女性。

## 清理個人內容

- profile：
  - 改成通用版 `src/profile.js`：名稱「飲食教練」，教練名稱從 config 的 `coachName` 讀。
  - 代稱 `who` 改「使用者」，口吻用現在的對話式風格，拿掉只適用特定個人的內容（例如碳水 130 g 的提醒）。
  - `goal` 改成從 settings 讀。
- `store.js`：
  - `DEFAULTS` 的身高、體重改成 `null`，目標熱量 1,800、蛋白質 90。
  - 錯誤訊息裡提到特定人名或「Editor 權限」的句子，改成一般說法。
  - `READ_ONLY_MSG` 改成「資料沒辦法存到這個瀏覽器。」
- `claude.js`：錯誤訊息裡的「Claude」改「AI」。
  - `disabled` 改成「還沒設定 AI 金鑰，到概覽頁的 AI 設定填寫。」
  - 新增 `bad_key`：「金鑰無效或沒有權限，到 AI 設定檢查。」
- 程式碼註解：「她」改「使用者」。
- 測試：fixture 裡的個人數字換成一般數字；拿掉 Artifact 專用的 contract 測試，改成檢查 `index.html` 載入的檔案都存在。
- 不帶過去的檔案：私有專案的 `CLAUDE.md`、`docs/`、所有 spec 和 plan、`.git`。新專案的 `CLAUDE.md` 重新寫。
- 檢查方式：最後用 grep 掃一次人名、Artifact 網址、email、私有專案的身高體重數字，必須零結果。

## 文件與授權

- `README.md`：
  - 功能介紹。
  - 本機使用：`python3 -m http.server`，打開 `http://localhost:8000`。
  - 手機使用：fork → 開 GitHub Pages → 手機打開網址 → 加入主畫面。
  - 怎麼申請三家的 API 金鑰，並說明 ChatGPT／Claude 訂閱不含 API 額度。
  - 隱私說明：資料存在哪、會傳給誰。
  - 備份方式。
- `LICENSE`：MIT。
- `.gitignore`：`.DS_Store`、`.superpowers/`。

## 測試

用現有的 node 測試方式：`for t in tests/test_*.js; do node "$t"; done`。

- `test_logic.js`：
  - `recomp` 的建議目標、1,200 下限、運動加回、達標範圍、`weekAdvice` 三種情況。
  - `cut`、`bulk` 現有的測試照舊通過。
- `test_localdb.js`（新增）：
  - `set` 後 `onSnapshot` 收到資料。
  - 查詢的 `where`、`orderBy`、`limit` 結果正確。
  - 匯出再匯入後資料一樣。
  - 容量滿時丟 `quota_exceeded`。
  - node 測試裡用一個簡單的 localStorage 假物件。
- `test_ai.js`（新增）：
  - 用假的 `fetch` 回傳 SSE 文字，三家各驗證：request 的網址、標頭、照片格式，以及串流解析出的文字。
  - 401 → `bad_key`、429 → `rate_limited`、取消 → `cancelled`。
  - JSON 容錯解析：純 JSON、前後有說明文字、包在 ```json 區塊裡、壞掉的 JSON。
- 手動驗證：三家各用真的金鑰，在瀏覽器試一次「照片估一餐」和「聊天」。照片估算的準確度只做人工抽查，不寫自動測試。
