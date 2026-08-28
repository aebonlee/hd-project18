# MH Analyzer

ERP·MES 생산 데이터로 OEM MH(작업시간) 계약용 옵션 조립비를 산출하는 도구.
기획: 이제명 (HD건설기계 글로벌생산기술팀). 배경·범위는 [CLAUDE.md](CLAUDE.md) 참고.

- 배포: https://aebonlee.github.io/hd-project18/
- 백엔드 없음 — 업로드한 엑셀은 브라우저 안에서만 처리되고 서버로 전송되지 않는다.
- 실행: 저장소를 클론해 `index.html`을 열거나 위 배포 주소로 접속.

## 구현 범위

| 탭 | 상태 |
|---|---|
| ① Item Master | 완료 |
| ② BOM 비교 | 완료 |
| ③ 대표사양 | 완료 |
| ④ MH 산출 | 다음 단계 (화면에 안내만) |
| ⑤ MH 옵션 분석 | 다음 단계 (화면에 안내만) |

## 예제 데이터

`sample/`의 6개 파일은 전부 가상 데이터다(`scripts/make_samples.py`로 재생성 가능).
실제 HD건설기계 자재명세·품번과 무관하다.

## 테스트

```sh
node test/logic.test.js       # 계산 로직 단위 테스트
node test/smoke.browser.js    # 화면 연기 테스트 (playwright 필요)
```
