#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MH Analyzer 예제 파일 생성기.
사내 실데이터를 저장소에 넣지 않는다는 원칙(CLAUDE.md §3.8·hd-project13 관례)에 따라
전부 지어낸 가상 부품/기종으로 만든다. 실행: python3 scripts/make_samples.py
"""
import os
from openpyxl import Workbook

OUT = os.path.join(os.path.dirname(__file__), "..", "sample")
os.makedirs(OUT, exist_ok=True)


def save(rows, header, filename):
    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    path = os.path.join(OUT, filename)
    wb.save(path)
    print("생성:", path, f"({len(rows)}행)")


# 1) Item Master — 품목 원장(품번→STM분류)
item_list_rows = [
    ["SMP-1001", "WASHER-SPACER 8mm", "STM-A"],
    ["SMP-1002", "BOLT M8x20", "STM-A"],
    ["SMP-1003", "BRACKET SWING", "STM-B"],
    ["SMP-1004", "PIPE ASSY FUEL", "STM-B"],
    ["SMP-1005", "COVER UNDER", "STM-C"],
]
save(item_list_rows, ["품번", "품명", "STM분류"], "item_master_list.xlsx")

# 2) Item Master — STM분류·개수별 공수(MH) 테이블
mh_table_rows = [
    ["STM-A", 1, 0.35], ["STM-A", 2, 0.62], ["STM-A", 3, 0.90], ["STM-A", 4, 1.10],
    ["STM-B", 1, 1.20], ["STM-B", 2, 2.10],
    ["STM-C", 1, 0.55], ["STM-C", 2, 1.05], ["STM-C", 3, 1.50],
]
save(mh_table_rows, ["STM분류", "개수", "작업시간(MH)"], "item_master_mh.xlsx")

# 3) BOM — Old(-1Q) / New(0Q). 가상 Assy 4개, 일부는 신규/삭제/변경.
# "조립조건" 컬럼 추가: Common=무조건 포함, "옵션코드=옵션값"(콤마 연결시 AND)=그 옵션 조합일 때만 포함.
# 대표사양 샘플(아래 5번)의 DX80R=C_OCOL/BCC(old)·DSC(new), EX10=C_X/A(new) 와 실제로 맞물리게 심어서
# ④⑤ 탭 필터링이 0건이 아니라 검증 가능한 값을 내도록 한다.
bom_old_rows = [
    ["ASSY-FRAME-01", "SMP-1001", "WASHER-SPACER 8mm", 2, "Common"],
    ["ASSY-FRAME-01", "SMP-1002", "BOLT M8x20", 4, "Common"],
    ["ASSY-FRAME-01", "SMP-1003", "BRACKET SWING", 1, "Common"],
    ["ASSY-PIPING-01", "SMP-1004", "PIPE ASSY FUEL", 1, "Common"],
    ["ASSY-PIPING-01", "SMP-1005", "COVER UNDER", 1, "Common"],
    ["ASSY-COLOR-BCC", "SMP-1001", "WASHER-SPACER 8mm", 4, "C_OCOL=BCC"],
    ["ASSY-COLOR-DSC", "SMP-1002", "BOLT M8x20", 2, "C_OCOL=DSC"],
    ["ASSY-OPTX-A", "SMP-1005", "COVER UNDER", 2, "C_X=A"],
]
save(bom_old_rows, ["Assy", "품번", "품명", "개수", "조립조건"], "bom_old.xlsx")

bom_new_rows = [
    ["ASSY-FRAME-01", "SMP-1001", "WASHER-SPACER 8mm", 3, "Common"],   # 개수 변경 2→3
    ["ASSY-FRAME-01", "SMP-1002", "BOLT M8x20", 4, "Common"],           # 동일
    # SMP-1003 삭제
    ["ASSY-PIPING-01", "SMP-1004", "PIPE ASSY FUEL", 2, "Common"],      # 개수 변경 1→2
    ["ASSY-PIPING-01", "SMP-1005", "COVER UNDER", 1, "Common"],         # 동일
    ["ASSY-PIPING-01", "SMP-1001", "WASHER-SPACER 8mm", 1, "Common"],   # 신규 편입
    ["ASSY-COLOR-BCC", "SMP-1001", "WASHER-SPACER 8mm", 4, "C_OCOL=BCC"],   # 동일(BCC 조건 유지)
    ["ASSY-COLOR-DSC", "SMP-1002", "BOLT M8x20", 3, "C_OCOL=DSC"],          # 개수 변경 2→3
    ["ASSY-OPTX-A", "SMP-1005", "COVER UNDER", 3, "C_X=A"],                  # 개수 변경 2→3
]
save(bom_new_rows, ["Assy", "품번", "품명", "개수", "조립조건"], "bom_new.xlsx")

# 4) 대표사양 — 기종(model)별 옵션코드/값 언피벗 + 대표사양 선정 플래그
rep_old_rows = [
    ["DX80R", "C_FHYD", "NOR", "Hydraulic fluid", "Normal(VG46)", "TRUE"],
    ["DX80R", "C_FHYD", "ARC", "Hydraulic fluid", "Arctic", "FALSE"],
    ["DX80R", "C_OCOL", "BCC", "Color", "Bobcat Orange", "TRUE"],
    ["EX10", "C_X", "A", "옵션X", "값A", "FALSE"],
]
save(rep_old_rows, ["기종", "옵션코드", "옵션값", "옵션명", "값이름", "대표사양"], "repspec_old.xlsx")

rep_new_rows = [
    ["DX80R", "C_FHYD", "NOR", "Hydraulic fluid", "Normal(VG46)", "TRUE"],
    ["DX80R", "C_FHYD", "ARC", "Hydraulic fluid", "Arctic", "FALSE"],
    ["DX80R", "C_OCOL", "DSC", "Color", "Discovery Grey", "TRUE"],  # 대표사양 변경(BCC→DSC)
    ["EX10", "C_X", "A", "옵션X", "값A", "TRUE"],
]
save(rep_new_rows, ["기종", "옵션코드", "옵션값", "옵션명", "값이름", "대표사양"], "repspec_new.xlsx")

print("완료 — 전부 가상 데이터, 실제 회사 자재명세와 무관.")
