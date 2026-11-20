// 週圖：7 欄長條圖與折線圖，純 SVG。顏色只用 CSS class
(function (root) {
  const W = 340, H = 190, PL = 42, PR = 10, PT = 14, PB = 36;
  const WD = '一二三四五六日';
  const colW = (W - PL - PR) / 7;
  const cx = i => PL + (i + 0.5) * colW;
  const md = key => { const [, m, d] = key.split('-').map(Number); return `${m}/${d}`; };
  const num = (v, digits) => digits ? v.toFixed(digits) : Math.round(v).toLocaleString('zh-TW');
  const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };

  const xAxis = pts => pts.map((p, i) =>
    `<text class="tick" x="${cx(i)}" y="${H - 20}" text-anchor="middle">${WD[i]}</text>` +
    `<text class="tick" x="${cx(i)}" y="${H - 6}" text-anchor="middle">${md(p.date)}</text>`).join('');
  const yGrid = (ticks, y, digits) => ticks.map(v =>
    `<line class="grid-line" x1="${PL}" x2="${W - PR}" y1="${y(v)}" y2="${y(v)}"/>` +
    `<text class="tick" x="${PL - 6}" y="${y(v) + 4}" text-anchor="end">${num(v, digits)}</text>`).join('');

  // 十字線與 tooltip：點或移動到某一欄就顯示那天的數字
  function attachHover(svg, pts, tipEl, textFor) {
    const idle = '點圖表看每天的數字';
    if (tipEl) tipEl.textContent = idle;
    const pick = e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(6, Math.floor((px - PL) / colW)));
      const c = svg.querySelector('.cross');
      c.setAttribute('x1', cx(i)); c.setAttribute('x2', cx(i)); c.setAttribute('visibility', 'visible');
      if (tipEl) tipEl.textContent = `${md(pts[i].date)} 週${WD[i]}　${textFor(pts[i])}`;
    };
    svg.onpointermove = svg.onpointerdown = pick;
    svg.onpointerleave = e => {   // 觸控放開時保留最後點到的那天
      if (e.pointerType !== 'mouse') return;
      svg.querySelector('.cross')?.setAttribute('visibility', 'hidden');
      if (tipEl) tipEl.textContent = idle;
    };
  }
  const cross = `<line class="cross" y1="${PT}" y2="${H - PB}" visibility="hidden"/>`;

  // 上方圓角、底部貼齊基線的長條
  function barPath(x0, x1, top, base) {
    const r = Math.min(4, (x1 - x0) / 2, (base - top) / 2);
    return `M${x0} ${base}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x1 - r}Q${x1} ${top} ${x1} ${top + r}V${base}Z`;
  }

  function bars(svg, pts, { tipEl, unit, target = null, digits = 0 } = {}) {
    const vals = pts.map(p => p.value).filter(v => v != null);
    const max = niceMax(Math.max(target ?? 0, ...vals, 0));
    const y = v => PT + (1 - v / max) * (H - PT - PB);
    const bw = colW * 0.5;
    let g = yGrid([0, max / 2, max], y, 0) + xAxis(pts);
    if (target) g += `<line class="target-line" x1="${PL}" x2="${W - PR}" y1="${y(target)}" y2="${y(target)}"/>`;
    pts.forEach((p, i) => {
      if (p.value == null || p.value <= 0) return;
      g += `<path class="bar-rect" d="${barPath(cx(i) - bw / 2, cx(i) + bw / 2, Math.min(y(p.value), y(0) - 2), y(0))}"/>`;
    });
    svg.innerHTML = g + cross;
    attachHover(svg, pts, tipEl, p => p.value == null ? '沒有資料' : `${num(p.value, digits)} ${unit}`);
  }

  function line(svg, pts, { tipEl, unit, digits = 1 } = {}) {
    const vals = pts.flatMap(p => [p.w, p.avg]).filter(v => v != null);
    if (!vals.length) {
      svg.innerHTML = xAxis(pts) + `<text class="chart-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">這週還沒有體重紀錄</text>`;
      if (tipEl) tipEl.textContent = '';
      svg.onpointermove = svg.onpointerdown = svg.onpointerleave = null;
      return;
    }
    const lo = Math.floor(Math.min(...vals) * 2) / 2 - 0.5, hi = Math.ceil(Math.max(...vals) * 2) / 2 + 0.5;
    const y = v => PT + (hi - v) / (hi - lo) * (H - PT - PB);
    let g = yGrid([lo, (lo + hi) / 2, hi], y, 1) + xAxis(pts);
    const avgPts = pts.map((p, i) => [i, p.avg]).filter(([, v]) => v != null);
    if (avgPts.length > 1) g += `<path class="avg" d="${avgPts.map(([i, v], k) => `${k ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}"/>`;
    pts.forEach((p, i) => { if (p.w != null) g += `<circle class="dot" cx="${cx(i)}" cy="${y(p.w)}" r="4"/>`; });
    const last = avgPts.at(-1);
    if (last) g += `<circle class="end" cx="${cx(last[0])}" cy="${y(last[1])}" r="5.5"/>`;
    svg.innerHTML = g + cross;
    attachHover(svg, pts, tipEl, p => p.w == null ? '沒有量體重' : `體重 ${num(p.w, digits)} ${unit}　7 日平均 ${num(p.avg, digits)} ${unit}`);
  }

  const Charts = { bars, line };
  root.Charts = Charts;
  if (typeof module !== 'undefined') module.exports = Charts;
})(typeof window !== 'undefined' ? window : globalThis);
