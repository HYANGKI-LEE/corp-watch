"""엑셀 Main 시트(저장된 계산값)와 build_metrics.py 결과를 대조.

Main은 B4 회사(기본 SGC에너지)·E4 연결/별도·F4 주기 기준으로만 계산돼 있어서 그 조합만 비교한다.
사용법: python scripts/validate_main.py [엑셀경로]
"""
import datetime as dt
import json
import math
import os
import sys

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_metrics import ROOT, find_source  # noqa: E402

# Main 행 -> 지표 키 (회사는 E열 코드로 판별)
ROWS = {
    16: "revenue", 17: "revenue", 21: "revenue_ttm", 22: "revenue_ttm", 26: "revenue_growth",
    47: "cogs_ratio", 61: "opex", 76: "op", 77: "op", 83: "op_ttm", 84: "op_ttm",
    92: "op_margin", 93: "op_margin", 108: "op_margin_ttm", 109: "op_margin_ttm", 122: "op_margin_3y",
    135: "ebitda", 139: "ebitda_ttm", 144: "ebitda_margin_ttm", 152: "ebitda_margin_3y",
    160: "ni", 163: "ni_ttm", 168: "ni_margin_ttm",
    177: "debt", 182: "debt_ebitda", 184: "debt_ebitda_ttm", 187: "debt_ebitda_3y",
    210: "net_debt", 214: "lease", 218: "net_debt_lease", 222: "cash_like",
    228: "netdebt_ebitda_ttm", 243: "netdebt_ebitda_3y",
    279: "dep_ratio", 285: "dep_ratio_ttm", 294: "dep_ratio_3y", 312: "dep_ratio_lease_ttm",
    317: "st_fin_share", 337: "debt_ratio", 341: "debt_ratio_ttm", 344: "debt_ratio_3y",
    363: "leverage", 365: "leverage_ttm", 367: "leverage_3y",
    390: "liq_gap", 393: "current_ratio_ttm", 409: "cash_cl_ttm",
    425: "ocf", 431: "ocf_op_ttm", 448: "ebitda_int_ttm", 466: "ocf_ttm",
    486: "fcf", 490: "fcf_ttm", 507: "fcf_lease", 511: "fcf_lease_ttm", 527: "dividend_ttm",
    552: "st_debt_share",
}


def main():
    path = find_source(sys.argv)
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Main"]
    basis, freq, code0 = ws["E4"].value, ws["F4"].value, ws["B4"].value
    data = json.load(open(os.path.join(ROOT, "output", "metrics.json"), encoding="utf-8"))
    comps = {c["code"]: c for c in data["companies"]}

    cols = [(c, ws.cell(13, c).value) for c in range(12, ws.max_column + 1)]
    cols = [(c, d.strftime("%Y-%m")) for c, d in cols if isinstance(d, dt.datetime)]

    print(f"Main 기준: {code0} / {basis} / {freq}")
    print(f"{'행':>4} {'지표':<22} {'비교':>5} {'일치':>5} {'최대차이':>10}  예시(기간 Main vs 계산)")
    for row, key in ROWS.items():
        code = ws.cell(row, 5).value or code0
        comp = comps.get(code)
        if comp is None:
            continue
        b = comp["bases"][basis]["Q" if freq == "Q" else "A"]
        mine = dict(zip(b["periods"], b["values"][key]))
        n = ok = 0
        worst, ex = 0.0, ""
        for c, p in cols:
            v = ws.cell(row, c).value
            if not isinstance(v, (int, float)) or v == 0:
                continue
            m = mine.get(p)
            if m is None:
                continue
            n += 1
            rel = abs(m - v) / max(abs(v), 1e-9)
            if rel < 1e-6 or abs(m - v) < 1e-6:
                ok += 1
            elif rel > worst:
                worst, ex = rel, f"{p} {v:,.4f} vs {m:,.4f}"
        print(f"{row:>4} {key:<22} {n:>5} {ok:>5} {worst:>10.2%}  {ex}")


if __name__ == "__main__":
    main()
