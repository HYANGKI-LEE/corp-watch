/* corp-watch 대시보드: output/metrics.json 을 읽어 KPI·차트·표를 그린다. */
const DATA_URL = "output/metrics.json";

// 탭별 차트 구성. type: bar(분기 발생액) | line(비율·잔액)
const CHARTS = {
  "수익성": [
    { t: "매출액", type: "bar", s: ["revenue"] },
    { t: "영업이익·EBITDA", type: "bar", s: ["op", "ebitda"] },
    { t: "당기순이익", type: "bar", s: ["ni"] },
    { t: "매출증가율(4분기 누적, YoY)", type: "bar", s: ["revenue_growth"] },
    { t: "영업이익률", type: "line", s: ["op_margin", "op_margin_ttm", "op_margin_3y"] },
    { t: "EBITDA마진", type: "line", s: ["ebitda_margin_ttm", "ebitda_margin_3y"] },
    { t: "매출원가율", type: "line", s: ["cogs_ratio"] },
    { t: "당기순이익률(4분기 누적)", type: "line", s: ["ni_margin_ttm"] },
    { t: "4분기 누적 손익", type: "line", s: ["revenue_ttm", "op_ttm", "ebitda_ttm"] },
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

function disposeCharts() { charts.forEach((c) => c.dispose()); charts = []; }

function renderCharts(v) {
  disposeCharts();
  $("#tablebox").hidden = true;
  const box = $("#charts");
  box.hidden = false;
  box.innerHTML = "";
  const colors = [css("--s1"), css("--s2"), css("--s3"), css("--s4")];
  const ink = css("--muted"), grid = css("--grid"), ref = css("--ref"), surface = css("--card"), fg = css("--fg");
  const cats = v.periods.map((p, i) => periodLabel(p, state.freq) + (v.prelim[i] ? "*" : ""));

  CHARTS[state.tab].forEach((def) => {
    const keys = seriesKeys(def.s).filter((k) => META[k] && v.b.values[k]);
    const unit = META[keys[0]].unit;
    const card = document.createElement("div");
    card.className = "card";
    const th = [...new Set(keys.flatMap((k) => META[k].thresholds || []))];
    const leg = keys.length > 1 || th.length
      ? `<div class="legend">${keys.map((k, i) => `<span><i style="background:${colors[i]}"></i>${label(k)}</span>`).join("")}` +
        (th.length ? `<span><i class="dash"></i>기준선</span>` : "") + `</div>` : "";
    card.innerHTML = `<h4>${state.freq === "A" ? def.t.replace("(4분기 누적, YoY)", "(YoY)").replace("(4분기 누적)", "").replace("4분기 누적", "연간") : def.t}<span class="u">${unit === "억원" ? "억원" : unit}</span></h4>${leg}<div class="chart"></div>`;
    box.appendChild(card);

    const series = keys.map((k, si) => {
      const raw = v.b.values[k].slice(v.start);
      const data = raw.map((x, i) => {
        const y = plotVal(x, unit);
        if (def.type !== "bar") return y;
        return { value: y, itemStyle: { borderRadius: y < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0], opacity: v.prelim[i] ? 0.45 : 1 } };
      });
      const s = {
        name: label(k), type: def.type, data, color: colors[si],
        emphasis: { focus: "none" },
      };
      if (def.type === "bar") Object.assign(s, { barMaxWidth: 18, barGap: "15%" });
      else Object.assign(s, { lineStyle: { width: 2 }, symbol: "circle", symbolSize: 8, showSymbol: false, connectNulls: false });
      if (si === 0 && th.length) {
        s.markLine = {
          silent: true, symbol: "none",
          lineStyle: { color: ref, type: "dashed", width: 1 },
          label: { color: ink, fontSize: 10, formatter: (p) => fmt(unit === "%" ? p.value / 100 : p.value, unit), position: "insideEndTop" },
          data: th.map((t) => ({ yAxis: plotVal(t, unit) })),
        };
      }
      return s;
    });

    const has = series.some((s) => s.data.some((x) => (x && typeof x === "object" ? x.value : x) != null));
    const el = card.querySelector(".chart");
    if (!has) { el.className = "empty"; el.textContent = "이 기간에 데이터가 없어요"; return; }

    const ch = echarts.init(el, null, { renderer: "svg" });
    ch.setOption({
      animation: false,
      grid: { left: 8, right: 12, top: 14, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis", axisPointer: { type: def.type === "bar" ? "shadow" : "line", lineStyle: { color: ink } },
        backgroundColor: surface, borderColor: grid, textStyle: { color: fg, fontSize: 12 },
        formatter: (ps) => {
          const i = ps[0].dataIndex;
          let h = `<b>${periodLabel(v.periods[i], state.freq)}</b>${v.prelim[i] ? " (잠정)" : ""}`;
          ps.forEach((p) => {
            const val = p.value == null ? null : (unit === "%" ? p.value / 100 : p.value);
            h += `<br>${p.marker}${p.seriesName}: <b>${fmt(val, unit)}</b>`;
          });
          return h;
        },
      },
      xAxis: { type: "category", data: cats, axisLine: { lineStyle: { color: grid } }, axisTick: { show: false },
               axisLabel: { color: ink, fontSize: 10, hideOverlap: true } },
      yAxis: { type: "value", scale: def.type === "line" && unit !== "억원", splitLine: { lineStyle: { color: grid } },
               ...thresholdRange(series, th.map((t) => plotVal(t, unit))),
               axisLabel: { color: ink, fontSize: 10, formatter: axisFmt(unit) } },
      series,
    });
    charts.push(ch);
  });
}

// 기준선이 데이터 범위 밖이면 축을 넓혀 보이게 한다(눈금이 깔끔하도록 반올림)
function thresholdRange(series, ths) {
  if (!ths.length) return {};
  const ys = series.flatMap((s) => s.data.map((x) => (x && typeof x === "object" ? x.value : x))).filter((y) => y != null);
  if (!ys.length) return {};
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const tlo = Math.min(...ths), thi = Math.max(...ths);
  if (tlo >= lo && thi <= hi) return {};
  lo = Math.min(lo, tlo); hi = Math.max(hi, thi);
  const step = Math.pow(10, Math.floor(Math.log10(hi - lo || 1))) / 2;
  return { min: Math.floor((lo - step * 0.2) / step) * step, max: Math.ceil((hi + step * 0.2) / step) * step };
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
  $("#tabs").addEventListener("click", (e) => {
    const t = e.target.dataset.tab; if (!t) return;
    state.tab = t;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    render();
  });
  window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
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
