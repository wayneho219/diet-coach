// node test_contracts.js — 在 node 載入所有瀏覽器端檔案，檢查全域名稱和函式（載入時不可碰 DOM）
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const CONTRACT = {
  'src/local/ai.js': ['LocalAI', ['create', 'parseJson', 'listModels', 'pickModel', 'tiers']],
  'src/local/db.js': ['LocalDB', ['create', 'clearAll']],
  'src/local/config.js': ['Config', ['create']],
  'src/profile.js': ['Profile', []],
  'src/core/logic.js': ['Logic', ['normalizeMeal', 'mealTotals', 'validateEstimate', 'weekSeries', 'mergeFoods']],
  'src/core/ui.js': ['UI', ['$', 'el', 'svg', 'fmt', 'toast', 'sticker', 'confirmTap', 'dayLabel', 'typeChips', 'nutriRow', 'microLine', 'ring', 'toJpeg', 'rich']],
  'src/core/charts.js': ['Charts', ['bars', 'line', 'niceMax']],
  'src/core/store.js': ['Store', ['init', 'day', 'updateDay', 'saveMeal', 'deleteMeal', 'saveSettings', 'saveFoods', 'saveInsight', 'saveChat', 'clearChat']],
  'src/core/claude.js': ['Coach', ['init', 'estimate', 'estimateItem', 'estimateExercise', 'insight', 'chat', 'cancel', 'buildEstimatePrompt', 'buildChatPreamble']],
  'src/views/meal-editor.js': ['MealEditor', ['render']],
  'src/views/home.js': ['Home', ['render', 'openMeal']],
  'src/views/add.js': ['AddMeal', ['open', 'openDraft']],
  'src/views/overview.js': ['Overview', ['render']],
  'src/views/calendar.js': ['Calendar', ['open']],
  'src/views/chat.js': ['Chat', ['open', 'refresh']],
  'src/views/welcome.js': ['Welcome', ['open', 'shouldShow', 'errorText', 'ping']],
  'src/app.js': ['App', ['start', 'go', 'setDate', 'onData', 'render', 'reinitAI']],
};

for (const [file, [name, fns]] of Object.entries(CONTRACT)) {
  assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} 不存在`);
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  assert.ok(globalThis[name], `${file} 沒有掛上 ${name}`);
  for (const fn of fns) assert.strictEqual(typeof globalThis[name][fn], 'function', `${name}.${fn} 不是函式`);
}
assert.strictEqual(typeof globalThis.UI.sheet.open, 'function');
// Y 軸：刻度（0、一半、最大）不能四捨五入成重複的數字
const nm = globalThis.Charts.niceMax;
assert.strictEqual(nm(0), 100);
assert.strictEqual(nm(1), 10);
assert.strictEqual(nm(3), 10);
assert.strictEqual(nm(1800), 2000);
assert.strictEqual(nm(2300), 3000);
for (const v of [0, 0.4, 1, 3, 7, 12, 150, 1800, 2300]) {
  const m = nm(v), ticks = [0, m / 2, m].map(x => Math.round(x));
  assert.strictEqual(new Set(ticks).size, 3, `niceMax(${v}) 刻度重複：${ticks}`);
}
// 第一次使用：沒金鑰、沒看過才跳出；錯誤原因的文字
const W = globalThis.Welcome;
const fakeCfg = (onboarded, key) => ({ get: () => ({ onboarded }), hasKey: () => key });
assert.strictEqual(W.shouldShow(fakeCfg(false, false)), true);
assert.strictEqual(W.shouldShow(fakeCfg(true, false)), false);
assert.strictEqual(W.shouldShow(fakeCfg(false, true)), true);   // 有金鑰但沒走完設定，還是要填
assert.strictEqual(W.errorText({ code: 'bad_key' }), '金鑰無效或沒有權限，檢查一下金鑰。');
assert.ok(W.errorText({ code: 'upstream_error', status: 400, detail: 'credit balance is too low' }).includes('HTTP 400：credit balance is too low'));
assert.ok(W.errorText({ code: 'upstream_error', network: true }).includes('請求沒送出去'));
assert.deepStrictEqual(globalThis.UI.MEAL_TYPES, ['早餐', '午餐', '晚餐', '點心']);
assert.strictEqual(globalThis.UI.fmt(1234.6), '1,235');
assert.strictEqual(globalThis.UI.dayLabel('2026-10-15'), '10月15日 週四');
// index.html 依序載入所有檔案（路徑同 CONTRACT 的檔案路徑）
const want = Object.keys(CONTRACT);
for (const page of ['index.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  // 每個 script 和 style.css 都帶同一個 ?v= 版本號，發布新版時瀏覽器才會重新抓
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const vers = new Set([...srcs, html.match(/href="(style\.css[^"]*)"/)[1]].map(u => u.split('?v=')[1]));
  assert.strictEqual(vers.size, 1, page + ' 的版本號不一致：' + [...vers]);
  assert.ok([...vers][0], page + ' 缺版本號');
  const order = srcs.map(u => u.split('?')[0]);
  assert.deepStrictEqual(order, want, page);
  for (const f of order) assert.ok(fs.existsSync(path.join(ROOT, f)), `${page} 引用的 ${f} 不存在`);
  assert.ok(/^<!doctype html>/i.test(html) && html.includes('<meta charset="utf-8">') && html.includes('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'), page + ' 缺 doctype／charset／viewport');
  assert.ok(html.includes('id="chat-fab"'), page);
  // PWA：manifest 和圖示都要存在
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, html.match(/rel="manifest" href="([^"]+)"/)[1]), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), `manifest 的 ${icon.src} 不存在`);
  assert.ok(fs.existsSync(path.join(ROOT, html.match(/rel="apple-touch-icon" href="([^"]+)"/)[1])), 'apple-touch-icon 不存在');
}
const ling = require('../src/profile.js');
globalThis.Profile = ling;
// UI.rich：用假的 DOM 檢查排版結果（粗體、條列、空行、不吃 HTML）
{
  class N { constructor(tag) { this.tag = tag; this.kids = []; this.className = ''; } append(...c) { this.kids.push(...c); } setAttribute() {} addEventListener() {} }
  globalThis.Node = N;
  globalThis.document = { createElement: t => new N(t) };
  const txt = n => typeof n === 'string' ? n : n.kids.map(txt).join('');
  const out = globalThis.UI.rich('結論：**少 200 kcal** 🎯\n\n- 第一點\n- **第二**點\n## 標題\n<b>x</b>');
  assert.deepStrictEqual(out.map(n => n.tag), ['p', 'div', 'ul', 'p', 'p']);
  assert.strictEqual(out[0].kids[1].tag, 'strong');
  assert.strictEqual(out[0].kids[1].className, 'hl');
  assert.strictEqual(txt(out[0]), '結論：少 200 kcal 🎯');
  assert.deepStrictEqual(out[2].kids.map(txt), ['第一點', '第二點']);
  assert.strictEqual(txt(out[3]), '標題');                    // # 標題變一般段落
  assert.strictEqual(out[4].kids[0], '<b>x</b>');              // HTML 當純文字
  assert.deepStrictEqual(globalThis.UI.rich(''), []);
  delete globalThis.document; delete globalThis.Node;
}
console.log('ok');
