"""DataGuide 엑셀(DataGuide 시트) -> 표준 개념 -> 주요 지표 계산.

사용법:
    python scripts/build_metrics.py                 # data/ 폴더의 *DataGuide*.xlsx 자동 탐색
    python scripts/build_metrics.py 파일경로.xlsx

출력:
    output/metrics.json      대시보드용(회사 x 연결/별도 x 분기/연간)
    output/metrics_long.csv  검증·엑셀 확인용 긴 표
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import math
import os
import re
import sys

import openpyxl
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concepts import CONCEPTS, METRICS, THRESHOLDS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIT = 100_000  # 천원 -> 억원


# ---------------------------------------------------------------- 시트 읽기
def find_source(argv: list[str]) -> str:
    if len(argv) > 1:
        return argv[1]
    files = [f for f in glob.glob(os.path.join(ROOT, "data", "*DataGuide*.xlsx"))
             if not os.path.basename(f).startswith("~$")]
    if not files:
        sys.exit("data/ 폴더에 DataGuide 엑셀이 없습니다.")
    return max(files, key=os.path.getmtime)


def read_sheet(path: str):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["DataGuide"]
    rows = list(ws.iter_rows(values_only=True))

    updated = None
    for r in rows[:12]:
        for v in r:
            if isinstance(v, str) and v.startswith("Last Updated:"):
                updated = v.split(":", 1)[1].strip()

    # 헤더 행: '코드', '코드명' 이 연속으로 나오는 행
    h = c0 = None
    for i, r in enumerate(rows):
        for j in range(len(r) - 1):
            if r[j] == "코드" and r[j + 1] == "코드명":
                h, c0 = i, j
                break
        if h is not None:
            break
    if h is None:
        sys.exit("DataGuide 시트에서 헤더(코드/코드명)를 찾지 못했습니다.")

    hdr = rows[h]
    date_cols = [(j, hdr[j]) for j in range(c0 + 6, len(hdr)) if isinstance(hdr[j], dt.datetime)]
    # 분기말(3·6·9·12월 말일)만 사용. 마지막 '최근일자' 열은 제외
    date_cols = [(j, d) for j, d in date_cols if d.month in (3, 6, 9, 12)
                 and (d + dt.timedelta(days=1)).day == 1]
    periods = [d.strftime("%Y-%m") for _, d in date_cols]

    recs = []
    for r in rows[h + 1:]:
        if not r[c0]:
            continue
        code, name, typ, icode, iname, freq = r[c0:c0 + 6]
        m = re.match(r"(.*)\(([A-Z])\)", str(typ))
        std, basis = (m.group(1), m.group(2)) if m else (str(typ), "C")
        vals = [r[j] if isinstance(r[j], (int, float)) else None for j, _ in date_cols]
        recs.append(dict(code=code, name=name, std=std, basis=basis, icode=str(icode),
                         iname=re.sub(r"\(천원\)$", "", str(iname)).strip(), freq=freq,
                         s=pd.Series(vals, index=periods, dtype="float64") / UNIT))
    return updated, periods, recs


# ---------------------------------------------------------------- 개념 시리즈
def match(rec, cand: str) -> bool:
    cand = cand.lstrip("-")
    if cand.startswith("code:"):
        return rec["icode"][-9:] == cand[5:]
    return rec["iname"] == cand


def cand_label(recs, cand: str) -> str:
    """화면 표시용 후보 이름. code: 후보는 실제 항목명+코드로 바꾼다."""
    if not cand.lstrip("-").startswith("code:"):
        return cand.lstrip("-")
    for rec in recs:
        if match(rec, cand):
            return f"{rec['iname']}({cand.lstrip('-')[5:]})"
    return cand.lstrip("-")


def concept_series(recs, freq: str, cands: list[str]):
    """후보를 순서대로 시도해 기간별 첫 유효값. (값, 사용한 후보 index) 반환."""
    out = src = None
    for k, cand in enumerate(cands):
        sign = -1.0 if cand.startswith("-") else 1.0
        for rec in recs:
            if rec["freq"] != freq or not match(rec, cand):
                continue
            s = rec["s"] * sign
            if freq == "ANNUAL":  # 연간값은 그해 4개 분기에 반복 -> 12월만
                s = s[[p.endswith("-12") for p in s.index]]
                s.index = [p[:4] for p in s.index]
            if out is None:
                out = pd.Series(float("nan"), index=s.index)
                src = pd.Series(float("nan"), index=s.index)
            fill = out.isna() & s.notna()
            out[fill] = s[fill]
            src[fill] = k
    return out, src


# ---------------------------------------------------------------- 지표 계산
def div(a, b):
    b = b.where(b != 0)
    return a / b


def compute(r: dict, w: int, w3: int, k: int) -> dict:
    """w: 4분기 누적 창(분기=4, 연간=1), w3: 3년 창(12/3), k: 연율화 배수(4/1)."""
    S = lambda s, n: s.rolling(n, min_periods=n).sum()   # noqa: E731
    M = lambda s, n: s.rolling(n, min_periods=n).mean()  # noqa: E731
    z = lambda s: s.fillna(0)                            # noqa: E731
    has = r["revenue"].notna() | r["assets"].notna()

    m = {}
    m["revenue"] = r["revenue"]
    m["revenue_ttm"] = S(r["revenue"], w)
    m["revenue_growth"] = div(m["revenue_ttm"], m["revenue_ttm"].shift(w)) - 1
    m["cogs_ratio"] = div(r["cogs"], r["revenue"])
    m["opex"] = r["cogs"] + r["sga"]
    m["op"] = r["op"]
    m["op_ttm"] = S(r["op"], w)
    m["op_margin"] = div(r["op"], r["revenue"])
    m["op_margin_ttm"] = div(S(r["op"], w), S(r["revenue"], w))
    m["op_margin_3y"] = div(S(r["op"], w3), S(r["revenue"], w3))
    ebitda = r["op"] + r["da"]
    m["ebitda"] = ebitda
    m["ebitda_ttm"] = S(ebitda, w)
    m["ebitda_margin_ttm"] = div(S(ebitda, w), S(r["revenue"], w))
    m["ebitda_margin_3y"] = div(S(ebitda, w3), S(r["revenue"], w3))
    m["ni"] = r["ni"]
    m["ni_ttm"] = S(r["ni"], w)
    m["ni_margin_ttm"] = div(S(r["ni"], w), S(r["revenue"], w))

    debt = r["debt"]
    m["debt"] = debt
    m["debt_ebitda"] = div(debt, ebitda * k)
    m["debt_ebitda_ttm"] = div(M(debt, w), M(ebitda, w) * k)
    m["debt_ebitda_3y"] = div(M(debt, w3), M(ebitda, w3) * k)
    cash_like = (r["cash"] + z(r["st_fin_prod"]) + z(r["st_sec"])).where(has)
    m["cash_like"] = cash_like
    net_debt = debt - cash_like
    m["net_debt"] = net_debt
    m["lease"] = r["lease"]
    m["net_debt_lease"] = net_debt + z(r["lease"])
    m["netdebt_ebitda_ttm"] = div(M(net_debt, w), M(ebitda, w) * k)
    m["netdebt_ebitda_3y"] = div(M(net_debt, w3), M(ebitda, w3) * k)
    m["dep_ratio"] = div(debt, r["assets"])
    m["dep_ratio_ttm"] = div(M(debt, w), M(r["assets"], w))
    m["dep_ratio_3y"] = div(M(debt, w3), M(r["assets"], w3))
    m["dep_ratio_lease_ttm"] = div(M(debt, w) + M(z(r["lease"]).where(debt.notna()), w), M(r["assets"], w))
    m["debt_ratio"] = div(r["liab"], r["equity"])
    m["debt_ratio_ttm"] = div(M(r["liab"], w), M(r["equity"], w))
    m["debt_ratio_3y"] = div(M(r["liab"], w3), M(r["equity"], w3))
    m["leverage"] = div(r["assets"], r["equity"])
    m["leverage_ttm"] = div(M(r["assets"], w), M(r["equity"], w))
    m["leverage_3y"] = div(M(r["assets"], w3), M(r["equity"], w3))

    m["st_fin_share"] = div(r["st_fin_liab"], r["st_fin_liab"] + r["lt_fin_liab"])
    m["st_debt_share"] = div(r["st_debt"] + z(r["cur_ltd"]), debt)
    m["liq_gap"] = r["cur_assets"] - r["cur_liab"]
    m["current_ratio_ttm"] = div(M(r["cur_assets"], w), M(r["cur_liab"], w))
    m["cash_cl_ttm"] = div(M(r["cash"], w), M(r["cur_liab"], w))

    ocf = r["ocf"]
    m["ocf"] = ocf
    m["ocf_ttm"] = S(ocf, w)
    m["ocf_op_ttm"] = div(S(ocf, w), S(r["op"], w))
    cov = div(S(ebitda, w), S(r["interest"], w))
    m["ebitda_int_ttm"] = cov.where(cov >= 0)
    fcf = ocf - z(r["capex"]) - z(r["interest"])
    m["fcf"] = fcf
    m["fcf_ttm"] = S(fcf, w)
    fcf_lease = fcf + (r["lease"] - r["lease"].shift(1))
    m["fcf_lease"] = fcf_lease
    m["fcf_lease_ttm"] = S(fcf_lease, w)
    m["dividend_ttm"] = S(z(r["dividend"]).where(has), w)
    return m


# ---------------------------------------------------------------- 조립
def clean(v):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), 6)


def build(path: str):
    updated, periods, recs = read_sheet(path)
    companies, long_rows = [], []

    keys = []
    for r in recs:
        if (r["code"], r["name"]) not in keys:
            keys.append((r["code"], r["name"]))

    for code, name in keys:
        crecs = [r for r in recs if r["code"] == code]
        comp = {"code": code, "name": name, "listed": str(code).startswith("A"),
                "standard": {}, "bases": {}}
        for basis in ("C", "S"):
            brecs = [r for r in crecs if r["basis"] == basis]
            if not brecs:
                continue
            comp["standard"][basis] = brecs[0]["std"]
            comp["bases"][basis] = {}
            for fk, freq, w, w3, k in (("Q", "4Q", 4, 12, 4), ("A", "ANNUAL", 1, 3, 1)):
                raw, src = {}, {}
                for ck, (_, _, cands) in CONCEPTS.items():
                    s, sc = concept_series(brecs, freq, cands)
                    idx = periods if fk == "Q" else sorted({p[:4] for p in periods})
                    raw[ck] = (s if s is not None else pd.Series(dtype="float64")).reindex(idx)
                    src[ck] = (sc if sc is not None else pd.Series(dtype="float64")).reindex(idx)
                m = compute(raw, w, w3, k)
                df = pd.DataFrame(m)
                live = df.notna().any(axis=1)
                if not live.any():
                    continue
                df = df.loc[live.idxmax():live[::-1].idxmax()]
                idx = list(df.index)
                prelim = [bool(pd.notna(raw["revenue"].get(p)) and pd.isna(raw["assets"].get(p)))
                          for p in idx]
                comp["bases"][basis][fk] = {
                    "periods": idx,
                    "prelim": prelim,
                    "values": {mk: [clean(v) for v in df[mk]] for mk in df.columns},
                    "raw": {ck: [clean(raw[ck].get(p)) for p in idx] for ck in raw},
                    "src": {ck: [None if pd.isna(src[ck].get(p)) else int(src[ck].get(p)) for p in idx]
                            for ck in src},
                }
                for mk in df.columns:
                    for p, v in zip(idx, df[mk]):
                        if pd.notna(v):
                            long_rows.append((code, name, basis, fk, p, mk, float(v)))

        # 기본 주기: 최근 연간 결산연도의 4개 분기 매출이 다 있으면 분기, 아니면 연간
        q = comp["bases"].get("C", comp["bases"].get("S", {})).get("Q")
        default = "A"
        if q:
            rev = dict(zip(q["periods"], q["values"]["revenue"]))
            years = [p[:4] for p, v in rev.items() if p.endswith("-12") and v is not None]
            if years and all(rev.get(f"{years[-1]}-{mm}") is not None for mm in ("03", "06", "09", "12")):
                default = "Q"
        comp["default_freq"] = default
        comp["default_basis"] = "C" if "C" in comp["bases"] else "S"
        companies.append(comp)

    out = {
        "generated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source_file": os.path.basename(path),
        "source_updated": updated,
        "unit": "억원",
        "concepts": {k: {"label": v[0], "kind": v[1], "candidates": [cand_label(recs, c) for c in v[2]]}
                     for k, v in CONCEPTS.items()},
        "metrics": [{"key": k, "label": lb, "group": g, "unit": u, "thresholds": THRESHOLDS.get(k, [])}
                    for k, lb, g, u in METRICS],
        "companies": companies,
    }
    os.makedirs(os.path.join(ROOT, "output"), exist_ok=True)
    with open(os.path.join(ROOT, "output", "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    pd.DataFrame(long_rows, columns=["code", "name", "basis", "freq", "period", "metric", "value"]) \
        .to_csv(os.path.join(ROOT, "output", "metrics_long.csv"), index=False, encoding="utf-8-sig")

    for c in companies:
        b = c["bases"][c["default_basis"]][c["default_freq"]]
        print(f"{c['name']:<12} 기본 {c['default_basis']}/{c['default_freq']}  "
              f"{b['periods'][0]} ~ {b['periods'][-1]}  잠정 {sum(b['prelim'])}개 기간")
    print(f"지표 {len(METRICS)}개, 원본 갱신 {updated} -> output/metrics.json")
    return out


if __name__ == "__main__":
    build(find_source(sys.argv))
