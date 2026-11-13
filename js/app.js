/* corp-watch 대시보드: output/metrics.json 을 읽어 KPI·차트·표를 그린다. */
const DATA_URL = "output/metrics.json";

// 탭별 차트 구성. type: bar(분기 발생액) | line(비율·잔액)
// y2: 오른쪽 축(우)에 선으로 그릴 지표, qOnly: 분기 주기에서만 그림(연간이면 앞 차트와 같아짐)
const CHARTS = {
  "Main": [],
  "수익성": [
    { t: "매출액", type: "bar", s: ["revenue"], y2: ["revenue_yoy"], n: "매출액", n2: "YoY(우)" },
    { t: "매출액(4분기 누적)", type: "bar", s: ["revenue_ttm"], y2: ["revenue_growth"], qOnly: true, n: "매출액", n2: "YoY(우)" },
    { t: "영업이익·EBITDA", type: "bar", s: ["op", "ebitda"] },
    { t: "당기순이익", type: "bar", s: ["ni"] },
    { t: "영업이익률", type: "line", s: ["op_margin", "op_margin_ttm", "op_margin_3y"] },
    { t: "EBITDA마진", type: "line", s: ["ebitda_margin_ttm", "ebitda_margin_3y"] },
    { t: "매출원가율", type: "line", s: ["cogs_ratio"] },
    { t: "당기순이익률(4분기 누적)", type: "line", s: ["ni_margin_ttm"] },
    { t: "4분기 누적 영업이익·EBITDA", type: "line", s: ["op_ttm", "ebitda_ttm"] },
  ],
  "레버리지": [
    { t: "차입금", type: "line", s: ["debt", "net_debt", "net_debt_lease"] },
    { t: "총차입금/EBITDA", type: "line", s: ["debt_ebitda", "debt_ebitda_ttm", "debt_ebitda_3y"] },
    { t: "순차입금/EBITDA", type: "line", s: ["netdebt_ebitda_ttm", "netdebt_ebitda_3y"] },
    { t: "차입금의존도", type: "line", s: ["dep_ratio", "dep_ratio_ttm", "dep_ratio_3y"] },
    { t: "차입금의존도(리스부채 포함, 4분기 누적)", type: "line", s: ["dep_ratio_lease_ttm"] },
    { t: "부채비율", type: "line", s: ["debt_ratio", "debt_ratio_ttm", "debt_ratio_3y"] },
    { t: "레버리지 비율(총자산/총자본)", type: "line", s: ["leverage", "leverage_ttm", "leverage_3y"] },
    { t: "현금성자산·총금융리스부채", type: "line", s: ["cash_like", "lease"] },
  ],
  "유동성": [
    { t: "단기 차입 비중", type: "line", s: ["st_fin_share", "st_debt_share"] },
    { t: "유동성갭(유동자산-유동부채)", type: "bar", s: ["liq_gap"] },
    { t: "유동비율(4분기 누적)", type: "line", s: ["current_ratio_ttm"] },
    { t: "현금성자산/유동부채(4분기 누적)", type: "line", s: ["cash_cl_ttm"] },
  ],
  "현금흐름": [
    { t: "영업활동현금흐름", type: "bar", s: ["ocf"] },
    { t: "FCF", type: "bar", s: ["fcf", "fcf_lease"] },
    { t: "4분기 누적 현금흐름", type: "line", s: ["ocf_ttm", "fcf_ttm", "fcf_lease_ttm"] },
    { t: "OCF/영업이익(4분기 누적)", type: "line", s: ["ocf_op_ttm"] },
    { t: "EBITDA/이자비용(4분기 누적)", type: "line", s: ["ebitda_int_ttm"] },
    { t: "배당금 지급(4분기 누적)", type: "bar", s: ["dividend_ttm"] },
  ],
};

// 상단 KPI. bad: 기준선을 넘으면 안 좋은 방향(up=클수록 나쁨, down=작을수록 나쁨)
const KPIS = [
  { k: "revenue_ttm", d: "pct" },
  { k: "op_ttm", d: "pct" },
  { k: "op_margin_ttm", d: "diff", bad: "down" },
  { k: "ebitda_margin_ttm", d: "diff", bad: "down" },
  { k: "net_debt", d: "pct" },
  { k: "netdebt_ebitda_ttm", d: "diff", bad: "up" },
  { k: "debt_ratio", d: "diff", bad: "up" },
  { k: "dep_ratio", d: "diff", bad: "up" },
  { k: "ebitda_int_ttm", d: "diff", bad: "down" },
  { k: "current_ratio_ttm", d: "diff", bad: "down" },
];

const state = { data: null, comp: null, basis: "C", freq: "Q", range: 5, tab: "수익성" };
let charts = [];
let META = {};

const $ = (s) => document.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------------------------------------------------------------- 포맷
function fmt(v, unit, short) {
  if (v == null || Number.isNaN(v)) return "–";
  if (unit === "%") return (v * 100).toFixed(1) + "%";
  if (unit === "배") return v.toFixed(2) + "배";
  return Math.round(v).toLocaleString("ko-KR") + (short ? "" : "억");
}
function plotVal(v, unit) { return v == null ? null : unit === "%" ? v * 100 : v; }
function axisFmt(unit) {
  return (v) => unit === "%" ? v + "%" : unit === "배" ? v + "배" : v.toLocaleString("ko-KR");
}
function periodLabel(p, freq) {
  if (freq === "A") return p;
  const [y, m] = p.split("-");
  return `${y.slice(2)}.${Math.ceil(+m / 3)}Q`;
}
function label(key) {
  let lb = META[key].label;
  if (state.freq === "A") {
    lb = lb.replace("(분기 연율화)", "").replace("(분기)", "").replace("(4분기 누적, YoY)", "(YoY)")
           .replace(", 4분기 누적", "").replace("(4분기 누적)", "").replace("4분기 누적", "연간");
  }
  return lb.trim();
}

// ---------------------------------------------------------------- 선택 상태
function view() {
  const b = state.comp.bases[state.basis][state.freq];
  let n = b.periods.length;
  let start = 0;
  if (state.range) start = Math.max(0, n - state.range * (state.freq === "Q" ? 4 : 1));
  return { b, start, periods: b.periods.slice(start), prelim: b.prelim.slice(start) };
}
// 연간 모드에선 분기값과 4분기 누적값이 같아지므로 짝이 있는 _ttm 시리즈는 뺀다
function seriesKeys(keys) {
  if (state.freq !== "A") return keys;
  const base = { debt_ebitda_ttm: "debt_ebitda", dep_ratio_ttm: "dep_ratio", debt_ratio_ttm: "debt_ratio",
                 leverage_ttm: "leverage", op_margin_ttm: "op_margin" };
  return keys.filter((k) => !(base[k] && keys.includes(base[k])));
}

// ---------------------------------------------------------------- 렌더
function setChips(id, val, avail) {
  document.querySelectorAll(`#${id} button`).forEach((b) => {
    b.classList.toggle("on", b.dataset.v === String(val));
    if (avail) b.disabled = !avail.includes(b.dataset.v);
  });
}

function render() {
  const c = state.comp;
  setChips("basis", state.basis, Object.keys(c.bases));
  setChips("freq", state.freq, Object.keys(c.bases[state.basis]));
  setChips("range", state.range);
  const std = c.standard[state.basis] || "";
  const v = view();
  const last = v.periods[v.periods.length - 1];
  $("#status").textContent =
    `${c.name} · ${c.listed ? "상장" : "비상장"} · ${std} ${state.basis === "C" ? "연결" : "별도"} · ` +
    `${state.freq === "Q" ? "분기" : "연간"} · 최근 ${periodLabel(last, state.freq)}` +
    (c.default_freq === "A" && state.freq === "Q" ? " · 이 회사는 분기 데이터가 일부 연도만 있어요" : "");
  renderKpis(v);
  if (state.tab === "표") renderTable(v); else renderCharts(v);
}

function renderKpis(v) {
  const step = state.freq === "Q" ? 4 : 1;
  const all = v.b.values;
  const html = KPIS.map(({ k, d, bad }) => {
    const m = META[k];
    const arr = all[k] || [];
    let i = arr.length - 1;
    while (i >= 0 && arr[i] == null) i--;
    if (i < 0) return `<div class="kpi"><div class="t">${label(k)}</div><div class="v">–</div></div>`;
    const cur = arr[i], prev = i - step >= 0 ? arr[i - step] : null;
    let delta = "";
    if (prev != null) {
      if (d === "pct" && prev < 0 && cur >= 0) delta = "흑자전환";
      else if (d === "pct" && prev >= 0 && cur < 0) delta = "적자전환";
      else if (d === "pct" && prev < 0) delta = cur > prev ? "적자 축소" : "적자 확대";
      else if (d === "pct" && prev !== 0) {
        const g = cur / prev - 1;
        delta = `${g >= 0 ? "▲" : "▼"} ${(Math.abs(g) * 100).toFixed(1)}%`;
      } else if (d === "diff") {
        const x = cur - prev;
        delta = `${x >= 0 ? "▲" : "▼"} ` + (m.unit === "%" ? (Math.abs(x) * 100).toFixed(1) + "%p" : Math.abs(x).toFixed(2) + "배");
      }
      if (/[▲▼]/.test(delta)) delta += state.freq === "Q" ? " 전년동기 대비" : " 전년 대비";
    }
    const th = m.thresholds || [];
    let flag = "";
    if (bad && th.length) {
      const t = bad === "up" ? Math.min(...th) : Math.max(...th);
      if ((bad === "up" && cur > t) || (bad === "down" && cur < t))
        flag = `<div class="flag">기준선 ${fmt(t, m.unit)} ${bad === "up" ? "초과" : "미달"}</div>`;
    }
    const p = v.b.periods[i];
    const pre = v.b.prelim[i] ? " 잠정" : "";
    return `<div class="kpi"><div class="t">${label(k)} · ${periodLabel(p, state.freq)}${pre}</div>
      <div class="v">${fmt(cur, m.unit)}</div><div class="d">${delta || "&nbsp;"}</div>${flag}</div>`;
  }).join("");
  $("#kpis").innerHTML = html;
}

// ---------------------------------------------------------------- 차트 (엑셀 스타일, Plotly)
// 엑셀 견본 그림(사용자가 준 EBIT 마진 차트, 폭 475px)에서 잰 치수. 화면 폭에 맞춰 전부 같은 배율로 키운다
// -> 어느 폭에서 보든·복사하든 견본과 글자·선·여백 비율이 같다. 가로:세로는 8:6.
const REF_W = 475;
const REF = {
  font: 13.7,   // 축·범례 글자
  title: 16.5,  // 제목
  titleY: 30,   // 제목 세로 위치(위에서)
  l: 52, r: 13, t: 57, b: 33,   // 그림 영역 여백
  axis: 1,      // 축선 굵기
  tick: 5,      // 눈금 길이
  yStand: 3, xStand: 6,         // 눈금 라벨 간격
  legItem: 42,  // 범례 선 견본 길이
  ref: 2,       // 기준선(점선) 굵기
};
const FONT_FAMILY = "'Malgun Gothic','맑은 고딕',sans-serif";
const BAR = ["#2e75b6", "#a6a6a6", "#7f7f7f"];
const RED = "#ff0000", BLUE = "#0070c0";
// 기준선 색: 넘어서면 나쁜 방향(up=클수록 나쁨)
const BAD_DIR = {
  debt_ebitda: "up", debt_ebitda_ttm: "up", debt_ebitda_3y: "up", netdebt_ebitda_ttm: "up", netdebt_ebitda_3y: "up",
  dep_ratio_ttm: "up", dep_ratio_lease_ttm: "up", debt_ratio: "up", leverage_3y: "up",
};

// 선 스타일: 기간 창이 길수록 진하고 굵게(3년 누적=검정 굵게, 4분기 누적=회색)
const baseKey = (x) => x.replace(/_(ttm|3y)$/, "");
// 같은 지표를 기간 창만 달리해 비교하는 차트인지(예: op_margin, op_margin_ttm, op_margin_3y)
const sameFamily = (keys) => keys.some((x) => /_(ttm|3y)$/.test(x)) && new Set(keys.map(baseKey)).size === 1;

function lineStyle(key, keys, i) {
  const windowed = sameFamily(keys);
  const thick = { color: "#000000", width: 4.5 };   // 굵기는 견본 기준 px
  if (keys.length === 1) return thick;
  if (windowed) {
    const has3y = keys.some((k) => k.endsWith("_3y"));
    if (key.endsWith("_3y")) return thick;
    if (key.endsWith("_ttm")) return has3y ? { color: "#a6a6a6", width: 3 } : thick;
    return { color: "#c9c9c9", width: 1.5 };
  }
  return [thick, { color: "#a6a6a6", width: 4.5 }, { color: BLUE, width: 3 }][i] || { color: "#7f7f7f", width: 1.5 };
}

// 그림 복사 버튼(클립보드에 PNG)
const COPY_ICON = { width: 24, height: 24, path: "M8 2h14v14h-6v-2h4V4H10v4H8z M2 8h12v14H2z M4 10v10h8V10z" };
async function copyChart(gd) {
  const opts = { format: "png", width: gd._fullLayout.width, height: gd._fullLayout.height, scale: 2 };
  try {
    // 클릭 직후 바로 write 를 호출해야 브라우저가 허용한다(이미지는 Promise 로 넘김)
    const blob = Plotly.toImage(gd, opts).then((url) => fetch(url)).then((r) => r.blob());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast("그림을 복사했어요. 엑셀·파워포인트에 붙여넣기 하세요");
  } catch (e) {
    // 클립보드 권한이 없는 환경이면 PNG 파일로 대신 저장
    Plotly.downloadImage(gd, { ...opts, filename: gd.dataset.fname || "chart" });
    toast("이 브라우저에선 복사가 막혀 있어 PNG로 저장했어요");
  }
}
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 1600);
}

// 범례는 짧게: 같은 지표의 기간 창 비교 차트면 창 이름만(예: "4분기 누적", "3년 누적")
const PLAIN_LEG = { op_margin: "분기", debt_ebitda: "분기(연율화)", dep_ratio: "분기말", debt_ratio: "분기말", leverage: "분기말" };
function legendName(k, keys) {
  if (!sameFamily(keys)) return label(k);
  if (k.endsWith("_3y")) return "3년 누적";
  if (k.endsWith("_ttm")) return state.freq === "A" ? "연간" : "4분기 누적";
  return state.freq === "A" ? "연간" : PLAIN_LEG[k] || "분기";
}

// 도구모음 한글 이름
Plotly.register({ moduleType: "locale", name: "ko", dictionary: {
  "Download plot as a png": "그림 저장(PNG)", "Download plot as a PNG": "그림 저장(PNG)", "Zoom": "확대 영역 선택", "Pan": "이동",
  "Zoom in": "확대", "Zoom out": "축소", "Autoscale": "자동 범위", "Reset axes": "원래대로",
} });

function disposeCharts() { charts.forEach((el) => Plotly.purge(el)); charts = []; }

function chartTitle(def, unit) {
  let t = def.t;
  if (state.freq === "A") t = t.replace("(4분기 누적, YoY)", "(YoY)").replace("(4분기 누적)", "").replace("4분기 누적", "연간").trim();
  return unit === "억원" ? `${t} (억원)` : t;
}

// 보기 좋은 눈금 간격(1·2·5 x 10^n, 엑셀과 같은 방식)과 축 범위(엑셀처럼 눈금 단위로 끊음)
function niceAxis(lo, hi, target = 5) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
  return { step, min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step };
}

function renderCharts(v) {
  disposeCharts();
  $("#tablebox").hidden = true;
  const box = $("#charts");
  box.hidden = false;
  box.innerHTML = "";
  const n = v.periods.length;
  const cats = v.periods.map((p, i) => periodLabel(p, state.freq) + (v.prelim[i] ? "*" : ""));

  // x축: 연도마다 경계에 눈금, 라벨은 'YY. 기간이 길면 라벨은 2년 간격
  const years = new Set(v.periods.map((p) => p.slice(0, 4))).size;
  const every = years > 12 ? 2 : 1;
  const yearStart = v.periods.map((p, i) => i).filter((i) => state.freq === "A" || v.periods[i].endsWith("-03"));
  const lblIdx = yearStart.filter((i) => +v.periods[i].slice(0, 4) % every === 0);

  if (!CHARTS[state.tab].length) {
    box.innerHTML = `<p class="muted placeholder">신용평가사들이 자주 보는 핵심 지표로 채울 예정이에요.</p>`;
    return;
  }

  CHARTS[state.tab].forEach((def) => {
    if (def.qOnly && state.freq !== "Q") return;
    const keys = seriesKeys(def.s).filter((k) => META[k] && v.b.values[k]);
    const unit = META[keys[0]].unit;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="chart"></div>`;
    box.appendChild(card);
    const el = card.querySelector(".chart");
    const W = el.clientWidth, H = W * 6 / 8;
    const k = W / REF_W;                          // 엑셀 견본 그림 대비 배율
    const font = { family: FONT_FAMILY, size: REF.font * k, color: "#000000" };

    const traces = keys.map((key, i) => {
      const y = v.b.values[key].slice(v.start).map((x) => plotVal(x, unit));
      const hv = unit === "%" ? "%{y:.1f}%" : unit === "배" ? "%{y:.2f}배" : "%{y:,.0f}억";
      const nm = def.n || legendName(key, keys);
      const t = { type: def.type === "bar" ? "bar" : "scatter", name: nm, x: cats, y,
                  hovertemplate: `${hv}<extra>${nm}</extra>` };
      if (def.type === "bar") {
        t.marker = { color: y.map((_, j) => (v.prelim[j] ? "#bdd7ee" : BAR[i] || BAR[0])) };
      } else {
        t.mode = "lines";
        const ls = lineStyle(key, keys, i);
        t.line = { color: ls.color, width: ls.width * k, shape: "spline", smoothing: 0.5 }; // 엑셀 '완만한 선'
        t.connectgaps = false;
      }
      return t;
    });
    // 오른쪽 축(우) 선
    const keys2 = (def.y2 || []).filter((k) => META[k] && v.b.values[k]);
    const unit2 = keys2.length ? META[keys2[0]].unit : null;
    const traces2 = keys2.map((key, i) => {
      const y = v.b.values[key].slice(v.start).map((x) => plotVal(x, unit2));
      const hv = unit2 === "%" ? "%{y:.1f}%" : unit2 === "배" ? "%{y:.2f}배" : "%{y:,.0f}억";
      const nm = def.n2 || label(key) + "(우)";
      return { type: "scatter", mode: "lines", yaxis: "y2", name: nm, x: cats, y, connectgaps: false,
               line: { color: ["#c00000", "#000000"][i] || "#7f7f7f", width: 4.5 * k, shape: "spline", smoothing: 0.5 },
               hovertemplate: `${hv}<extra>${nm}</extra>` };
    });
    const ys2 = traces2.flatMap((t) => t.y).filter((y) => y != null);
    const ax2 = ys2.length ? niceAxis(Math.min(...ys2), Math.max(...ys2)) : null;
    const ys = traces.flatMap((t) => t.y).filter((y) => y != null);
    if (!ys.length) { el.className = "chart empty"; el.textContent = "이 기간에 데이터가 없어요"; return; }

    // 기준선: 하나면 빨강, 둘이면 나쁜 쪽 빨강·좋은 쪽 파랑 (점선)
    const th = [...new Set(keys.flatMap((kk) => META[kk].thresholds || []))].sort((a, b) => a - b);
    const thv = th.map((t) => plotVal(t, unit));
    const dir = keys.map((kk) => BAD_DIR[kk]).find(Boolean) || "down";

    // y축 범위: 데이터·기준선(막대면 0 포함)을 눈금 단위로 감싼다
    let lo = Math.min(...ys, ...thv), hi = Math.max(...ys, ...thv);
    if (def.type === "bar") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const ax = niceAxis(lo, hi);
    // 가로축은 엑셀처럼 0에서 교차(0이 범위 밖이면 아래 끝)
    const cross = ax.min < 0 && ax.max > 0 ? 0 : ax.min;

    const AXIS = "#868686";
    const atBottom = cross === ax.min;   // 가로축이 맨 아래면 Plotly 축선·눈금을 그대로 쓴다
    const shapes = [
      // 0에서 교차하는 가로축과 연도 경계 눈금(아래로) — 그림 영역 안이라 도형으로 그린다
      ...(atBottom ? [] : [{ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: cross, y1: cross,
        line: { color: AXIS, width: REF.axis * k }, layer: "above" }]),
      ...(atBottom ? [] : yearStart).map((i) => ({
        type: "line", xref: "x", x0: i - 0.5, x1: i - 0.5, yref: "y", ysizemode: "pixel", yanchor: cross,
        y0: 0, y1: -REF.tick * k, line: { color: AXIS, width: REF.axis * k },
      })),
      ...th.map((t, i) => {
        const bad = th.length === 1 || (dir === "up" ? i === th.length - 1 : i === 0);
        return { type: "line", xref: "paper", x0: 0, x1: 1, y0: thv[i], y1: thv[i],
                 line: { color: bad ? RED : BLUE, width: REF.ref * k, dash: "dash" }, layer: "below" };
      }),
    ];

    const legend = traces.length + traces2.length > 1;
    const axisStyle = { showline: true, linecolor: AXIS, linewidth: REF.axis * k,
      ticks: "outside", ticklen: REF.tick * k, tickwidth: REF.axis * k, tickcolor: AXIS,
      ticklabelstandoff: REF.yStand * k, showgrid: false, zeroline: false, automargin: false };
    const fmtOf = (u) => ({ ticksuffix: u === "%" ? "%" : u === "배" ? "배" : "", tickformat: u === "억원" ? "," : "" });
    const layout = {
      width: W, height: H, font,
      paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff",
      title: { text: chartTitle(def, unit), x: 0.5, xanchor: "center", y: 1 - REF.titleY * k / H, yanchor: "middle",
               font: { ...font, size: REF.title * k } },
      showlegend: legend,
      // 범례는 엑셀 견본처럼 그림 영역 안쪽 위
      legend: { orientation: "h", x: 0.5, xanchor: "center", y: 1, yanchor: "top", font,
                bgcolor: "rgba(0,0,0,0)", itemwidth: Math.max(30, REF.legItem * k), tracegroupgap: 0 },
      margin: { l: REF.l * k, r: (ax2 ? REF.l : REF.r) * k, t: REF.t * k, b: REF.b * k, pad: 0 },
      barmode: "group", bargap: 0.25, bargroupgap: 0.05,
      hovermode: "x unified",
      hoverlabel: { bgcolor: "#ffffff", bordercolor: "#a6a6a6", font: { family: FONT_FAMILY, size: 11, color: "#000000" } },
      xaxis: { type: "category", range: [-0.5, n - 0.5], tickmode: "array",
               tickvals: lblIdx.map((i) => cats[i]), ticktext: lblIdx.map((i) => "'" + v.periods[i].slice(2, 4)),
               showticklabels: false,   // 라벨은 아래 annotations 로 연도 경계 눈금 가운데에 둔다
               unifiedhovertitle: { text: "<b>%{x}</b>" },
               showline: atBottom, linecolor: AXIS, linewidth: REF.axis * k,
               ticks: atBottom ? "outside" : "", tickson: "boundaries", ticklen: REF.tick * k,
               tickwidth: REF.axis * k, tickcolor: AXIS,
               showgrid: false, zeroline: false, automargin: false },
      yaxis: { range: [ax.min, ax.max], tick0: ax.min, dtick: ax.step, autorange: false, ...axisStyle, ...fmtOf(unit) },
      ...(ax2 ? { yaxis2: { overlaying: "y", side: "right", range: [ax2.min, ax2.max], tick0: ax2.min, dtick: ax2.step,
                            autorange: false, ...axisStyle, ...fmtOf(unit2) } } : {}),
      shapes,
      annotations: lblIdx.map((i) => ({
        xref: "x", x: i - 0.5, yref: "paper", y: 0, yanchor: "top", xanchor: "center",
        yshift: -(REF.tick + REF.xStand) * k, showarrow: false, text: "'" + v.periods[i].slice(2, 4), font,
      })),
    };
    const config = {
      responsive: false, displaylogo: false, displayModeBar: "hover", locale: "ko",
      modeBarButtons: [
        [{ name: "그림 복사", icon: COPY_ICON, click: (gd) => copyChart(gd) }, "toImage"],
        ["zoom2d", "pan2d", "zoomIn2d", "zoomOut2d", "autoScale2d", "resetScale2d"],
      ],
      toImageButtonOptions: { format: "png", filename: `${state.comp.name}_${chartTitle(def, unit)}`, scale: 2 },
    };
    el.dataset.fname = config.toImageButtonOptions.filename;
    Plotly.newPlot(el, [...traces, ...traces2], layout, config);
    charts.push(el);
  });
}

function renderTable(v) {
  disposeCharts();
  $("#charts").hidden = true;
  $("#tablebox").hidden = false;
  const heads = v.periods.map((p, i) => `<th class="${v.prelim[i] ? "pre" : ""}">${periodLabel(p, state.freq)}${v.prelim[i] ? "*" : ""}</th>`).join("");
  $("#tbl thead").innerHTML = `<tr><th class="l">지표</th>${heads}</tr>`;
  let body = "", grp = "";
  state.data.metrics.forEach((m) => {
    if (state.freq === "A" && m.key.endsWith("_ttm") && v.b.values[m.key.replace("_ttm", "")]) return;
    if (m.group !== grp) { grp = m.group; body += `<tr class="grp"><td colspan="${v.periods.length + 1}">${grp}</td></tr>`; }
    const vals = (v.b.values[m.key] || []).slice(v.start);
    body += `<tr><td class="l">${label(m.key)}</td>${vals.map((x) => `<td>${fmt(x, m.unit, true)}</td>`).join("")}</tr>`;
  });
  $("#tbl tbody").innerHTML = body;
  const wrap = $("#tablewrap");
  wrap.scrollLeft = wrap.scrollWidth; // 최신 기간이 오른쪽 끝

  // 데이터 출처: 개념별로 실제 쓰인 후보와 기간 수
  const rows = Object.entries(state.data.concepts).map(([ck, c]) => {
    const src = (v.b.src[ck] || []).slice(v.start);
    const cnt = {};
    src.forEach((s) => { if (s != null) cnt[s] = (cnt[s] || 0) + 1; });
    const used = Object.entries(cnt).map(([i, n]) => `${c.candidates[i].replace(/^-/, "")}${Object.keys(cnt).length > 1 ? ` (${n}개 기간)` : ""}`).join(", ");
    const last = [...src].reverse().find((s) => s != null);
    return `<tr><td class="l">${c.label}</td><td class="l">${used || "<span class='muted'>값 없음</span>"}</td>
      <td class="l">${last != null ? c.candidates[last].replace(/^-/, "") : "–"}</td>
      <td class="l muted">${c.candidates.map((x) => x.replace(/^-/, "")).join(" → ")}</td></tr>`;
  }).join("");
  $("#srctbl thead").innerHTML = `<tr><th class="l">개념</th><th class="l">사용한 항목</th><th class="l">최근 기간 항목</th><th class="l">후보 우선순위</th></tr>`;
  $("#srctbl tbody").innerHTML = rows;
}

// ---------------------------------------------------------------- 이벤트
function pickCompany(code) {
  state.comp = state.data.companies.find((c) => c.code === code);
  state.basis = state.comp.default_basis;
  state.freq = state.comp.default_freq;
  render();
}

function bind() {
  $("#company").addEventListener("change", (e) => pickCompany(e.target.value));
  $("#basis").addEventListener("click", (e) => {
    const v = e.target.dataset.v; if (!v || e.target.disabled) return;
    state.basis = v;
    if (!state.comp.bases[v][state.freq]) state.freq = Object.keys(state.comp.bases[v])[0];
    render();
  });
  $("#freq").addEventListener("click", (e) => {
    const v = e.target.dataset.v; if (!v || e.target.disabled) return;
    state.freq = v; render();
  });
  $("#range").addEventListener("click", (e) => {
    const v = e.target.dataset.v; if (v == null) return;
    state.range = +v; render();
  });
  let rh;
  window.addEventListener("resize", () => {
    clearTimeout(rh);
    rh = setTimeout(() => { if (state.tab !== "표" && state.comp) renderCharts(view()); }, 200);
  });
  $("#tabs").addEventListener("click", (e) => {
    const t = e.target.dataset.tab; if (!t) return;
    state.tab = t;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    render();
  });
}

fetch(DATA_URL)
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => {
    state.data = d;
    d.metrics.forEach((m) => (META[m.key] = m));
    $("#updated").textContent = `· DataGuide 갱신 ${d.source_updated || "-"} · 계산 ${d.generated_at}`;
    $("#company").innerHTML = d.companies.map((c) => `<option value="${c.code}">${c.name}</option>`).join("");
    bind();
    pickCompany(d.companies[0].code);
  })
  .catch((e) => { $("#status").textContent = `데이터를 불러오지 못했어요 (${DATA_URL}): ${e.message}. scripts/build_metrics.py 를 먼저 실행하세요.`; });
