AI diet & nutrition tracker for Taiwanese meals — bring your own Claude/OpenAI/Gemini API key; data stays in your browser.

# 飲食教練

用拍照或文字記錄每一餐，由 AI 估算熱量與營養，並依你的目標給建議。純瀏覽器 App，沒有後端、不需要建置。

## 功能

- 記一餐：拍照或輸入文字，AI 估算食物、熱量與營養素，可手動修改份量。
- 每日追蹤：熱量、蛋白質、碳水、脂肪、纖維、鈉、飲水、運動與體重。
- 三種目標：減脂、增肌減脂、增重，熱量與提示文字依目標調整。
- 概覽：每日目標、身體狀態、週圖表、AI 健康洞察與教練建議。
- 日曆：回顧每天的記錄狀況。
- 問教練：用對話詢問飲食與運動問題。
- 備份：可匯出與匯入全部紀錄。

## 快速開始

```bash
python3 -m http.server 8000
```

開啟 `http://localhost:8000`，在概覽頁的「⚙️ AI 設定」選擇服務、貼上金鑰，按「儲存」。

## 手機使用

1. Fork 這個 repo。
2. 到 Settings → Pages，Source 選 `main` / root。
3. 用手機打開 Pages 網址。
4. Safari 分享 →「加入主畫面」。iPhone 請用這種方式打開，資料才不會被清除。

## 申請 API 金鑰

- Anthropic Claude：https://console.anthropic.com
- OpenAI：https://platform.openai.com
- Google Gemini：https://aistudio.google.com

ChatGPT Plus、Claude Pro 等訂閱不含 API 額度，API 要另外儲值，費用由你自己負擔。

## 隱私

- 所有紀錄存在瀏覽器的 localStorage，不會上傳到任何伺服器。
- 照片和當次對話內容會直接從你的瀏覽器送到你選的 AI 服務。
- 金鑰只存在這個瀏覽器，不會進匯出檔。

## 備份

在「⚙️ AI 設定」卡片按「匯出備份」下載 JSON；「匯入備份」會取代目前所有紀錄。換手機或清除瀏覽器資料前請先匯出。

## 開發

沒有 npm 依賴，直接用 node 跑測試：

```bash
for t in tests/test_*.js; do node "$t" || exit 1; done
```

## 授權

MIT，見 `LICENSE`。
