# 飲食教練

純瀏覽器 JS 的 AI 飲食追蹤 App（自帶 API 金鑰），資料存 localStorage，無建置、無 npm 依賴。

## 檔案結構

- `index.html`、`style.css`
- `src/profile.js`：預設版介面用詞與教練人設
- `src/local/`：`ai.js`（LocalAI，三家 AI 服務轉接）、`db.js`（localStorage 資料庫替身）、`config.js`（服務／金鑰／模型／教練名稱）
- `src/core/`：`logic.js`（純邏輯）、`ui.js`、`charts.js`、`store.js`、`claude.js`
- `src/views/`：`meal-editor.js`、`home.js`、`add.js`、`overview.js`、`calendar.js`、`chat.js`
- `src/app.js`：啟動
- `tests/test_*.js`、`docs/`（spec 與計畫）

## 載入順序

見 `index.html`：`local/ai` → `local/db` → `local/config` → `profile` → `core/logic` → `core/ui` → `core/charts` → `core/store` → `core/claude` → `views/*`（meal-editor、home、add、overview、calendar、chat）→ `app`。全域物件掛在 `window`（node 測試時用 `module.exports`）。

## 測試

```bash
for t in tests/test_*.js; do node "$t" || exit 1; done
```

## 資料格式

`Store` 透過 `LocalDB` 讀寫 `data/users/local/*`，每份文件在 localStorage 的 key 是 `diet-coach:<path>/<id>`：

- `day-YYYY-MM-DD`：`{ kind: 'day', date, meals, water, exercise, weight }`
- `foods`：常用食物與店家
- `settings`：個人設定與目標
- `insight`：AI 洞察
- `chat`：對話紀錄

金鑰與模型設定在獨立的 `diet-coach:config`，不進備份檔。備份格式 `{ app: 'diet-coach', version: 1, docs }`。

## 目標

`settings.goal` 為 `cut`、`recomp`、`bulk`（預設 `cut`）。熱量差、下限、運動加回比例、警告與提示文字全在 `Logic.GOALS`（`src/core/logic.js`），新增目標或改數字只改那張表。

## 規則

- 私人資料（人名、關係、身體數據、私人專案名稱、個人連結）不得進 repo、程式碼、文件或 commit 訊息。
- 金鑰只放使用者瀏覽器，不寫進任何檔案。
- Commit 訊息用英文 Conventional Commit。
