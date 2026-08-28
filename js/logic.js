/**
 * MH Analyzer — 계산 로직 (화면과 분리). 규칙은 전부 여기와 test/logic.test.js 에 고정한다.
 * 사내 실데이터는 이 저장소에 넣지 않는다 — 예제는 scripts/make_samples.py 가 만든 가짜 값을 쓴다.
 */
'use strict';

// ── 1. Item Master ──────────────────────────────────────────────
// listRows: [{partNo, partName, stmCategory}]  — 품목 원장(품번 기준)
// mhRows:   [{stmCategory, qty, mh}]           — STM분류·개수별 공수(MH) 테이블
// 출력: listRows 에 있는 각 품번에, 같은 STM분류를 가진 mhRows 전부를 조인한 평면 테이블.
function buildItemMaster(listRows, mhRows) {
  var mhByCategory = {};
  mhRows.forEach(function (r) {
    if (!mhByCategory[r.stmCategory]) mhByCategory[r.stmCategory] = [];
    mhByCategory[r.stmCategory].push(r);
  });

  var out = [];
  var unmatchedCategories = new Set();
  listRows.forEach(function (item) {
    var mhList = mhByCategory[item.stmCategory];
    if (!mhList) {
      unmatchedCategories.add(item.stmCategory);
      return;
    }
    mhList.forEach(function (mhRow) {
      out.push({
        partNo: item.partNo,
        partName: item.partName,
        stmCategory: item.stmCategory,
        qty: mhRow.qty,
        mh: mhRow.mh
      });
    });
  });

  return {
    rows: out,
    // 조용히 빠뜨리지 않는다 — STM분류 테이블에 없는 품목은 결과에 안 나오는 대신 여기 남긴다.
    unmatchedCategories: Array.from(unmatchedCategories)
  };
}

// 품번+개수로 MH 를 찾는 조회표를 만든다. (partNo, qty) 조합이 유일해야 정확하다.
function buildMhLookup(itemMasterRows) {
  var map = new Map();
  itemMasterRows.forEach(function (r) {
    map.set(r.partNo + '|' + r.qty, r.mh);
  });
  return map;
}

// ── 2. BOM 비교 ──────────────────────────────────────────────────
// bomRows: [{assy, partNo, partName, qty}]
// 반환: assy+partNo 키로 Old/New 를 대조해 신규·삭제·변경·동일을 판정.
function diffBomLines(oldRows, newRows) {
  var oldMap = new Map();
  oldRows.forEach(function (r) { oldMap.set(r.assy + '|' + r.partNo, r); });
  var newMap = new Map();
  newRows.forEach(function (r) { newMap.set(r.assy + '|' + r.partNo, r); });

  var keys = new Set([].concat(Array.from(oldMap.keys()), Array.from(newMap.keys())));
  var result = [];
  keys.forEach(function (key) {
    var o = oldMap.get(key);
    var n = newMap.get(key);
    var status;
    if (o && !n) status = '삭제';
    else if (!o && n) status = '신규';
    else if (o.qty !== n.qty) status = '변경';
    else status = '동일';

    var ref = n || o;
    result.push({
      assy: ref.assy, partNo: ref.partNo, partName: ref.partName, condition: ref.condition,
      oldQty: o ? o.qty : null, newQty: n ? n.qty : null, status: status
    });
  });
  return result;
}

// bomRows 를 Item Master 조회표로 MH 환산해 assy 별로 합산한다.
// 조회에 안 걸리는 (partNo, qty) 조합은 조용히 0 으로 두지 않고 unmatched 에 모은다.
function sumMhByAssy(bomRows, mhLookup) {
  var totals = new Map();
  var unmatched = [];
  bomRows.forEach(function (r) {
    var key = r.partNo + '|' + r.qty;
    var mh = mhLookup.get(key);
    if (mh === undefined) {
      unmatched.push({ assy: r.assy, partNo: r.partNo, qty: r.qty });
      return;
    }
    totals.set(r.assy, (totals.get(r.assy) || 0) + mh);
  });
  return { totals: totals, unmatched: unmatched };
}

// Old/New BOM 을 구조 비교 + MH 비교까지 한 번에 낸다.
function compareAssyMH(oldBomRows, newBomRows, itemMasterRows) {
  var mhLookup = buildMhLookup(itemMasterRows);
  var lineDiff = diffBomLines(oldBomRows, newBomRows);
  var oldMh = sumMhByAssy(oldBomRows, mhLookup);
  var newMh = sumMhByAssy(newBomRows, mhLookup);

  var assySet = new Set([].concat(
    oldBomRows.map(function (r) { return r.assy; }),
    newBomRows.map(function (r) { return r.assy; })
  ));

  var byAssy = [];
  assySet.forEach(function (assy) {
    var o = oldMh.totals.get(assy) || 0;
    var n = newMh.totals.get(assy) || 0;
    byAssy.push({ assy: assy, oldMH: round2(o), newMH: round2(n), deltaMH: round2(n - o) });
  });
  byAssy.sort(function (a, b) { return Math.abs(b.deltaMH) - Math.abs(a.deltaMH); });

  return {
    lineDiff: lineDiff,
    byAssy: byAssy,
    unmatched: oldMh.unmatched.concat(newMh.unmatched)
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ── 3. 대표사양 ──────────────────────────────────────────────────
// rows: [{model, optionCode, optionValue, optionName, valueName, isRep}]
// 기종(model)별로 대표사양(isRep===true)만 골라낸다. 기종에 대표사양이
// 하나도 없으면 "선정 안 됨"으로 명시한다 — 조용히 빠뜨리지 않는다.
function buildRepSpecTable(rows) {
  var byModel = new Map();
  rows.forEach(function (r) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  });

  var result = [];
  byModel.forEach(function (list, model) {
    var reps = list.filter(function (r) { return r.isRep === true; });
    result.push({
      model: model,
      total: list.length,
      selected: reps.length,
      reps: reps.map(function (r) {
        return { optionCode: r.optionCode, optionValue: r.optionValue, optionName: r.optionName, valueName: r.valueName };
      })
    });
  });
  return result;
}

// 대표사양 Old/New 비교 — 기종별 대표사양 조합이 바뀌었는지.
function diffRepSpec(oldRows, newRows) {
  var oldTable = buildRepSpecTable(oldRows);
  var newTable = buildRepSpecTable(newRows);
  var newByModel = new Map(newTable.map(function (t) { return [t.model, t]; }));

  return oldTable.map(function (o) {
    var n = newByModel.get(o.model);
    var oldKey = JSON.stringify(o.reps.map(function (r) { return r.optionCode + '=' + r.optionValue; }).sort());
    var newKey = n ? JSON.stringify(n.reps.map(function (r) { return r.optionCode + '=' + r.optionValue; }).sort()) : null;
    return { model: o.model, changed: newKey !== null && oldKey !== newKey, old: o, current: n || null };
  });
}

// ── 4. MH 산출·MH 옵션 분석 — 조건부 필터링 엔진 ──────────────────
//
// ⚠ 잠정 로직: 이메일 원문("④전분기 대비 MH 변동사항 가시화 및 최종 MH 산출",
// "⑤옵션별 MH 변동 분석")에는 집계 공식이 없었다. 첨부 스크린샷의 BOM비교 탭
// "조립조건"(Common/옵션코드=값) 컬럼과 MH옵션분석 탭의 "옵션 선택(AND 조합)" UI,
// MH산출 탭의 "④대표사양 선정 11/11" 전제조건 표기를 근거로 역추론했다.
// 제출자(이제명) 확인 전까지 잠정 — CLAUDE.md/Dev_md 참고, 화면에도 배지로 안내한다.
//
// BOM 라인은 이제 partNo/qty 외에 condition 을 가진다: "Common"(무조건 포함)
// 또는 "옵션코드=옵션값"(콤마로 이으면 AND, 예: "C_OCOL=BCC,C_CVEN=4TH").

// "Common" 이면 null(무조건), 아니면 {옵션코드: 옵션값, ...} 로 파싱.
function parseCondition(conditionStr) {
  if (!conditionStr || conditionStr === 'Common') return null;
  var pairs = {};
  conditionStr.split(',').forEach(function (part) {
    var kv = part.split('=');
    if (kv.length === 2) pairs[kv[0].trim()] = kv[1].trim();
  });
  return pairs;
}

// bomRows 를 selectedConditions([{optionCode,optionValue}, ...]) 로 필터링한다.
// Common 라인은 항상 포함. 조건부 라인은 자신의 조건 K=V 전부가 selectedConditions 에
// AND 로 있어야 포함 — 하나라도 없으면 제외한다(조용히 포함시키지 않는다).
function filterAssyByCondition(bomRows, selectedConditions) {
  var selectedMap = {};
  (selectedConditions || []).forEach(function (c) { selectedMap[c.optionCode] = c.optionValue; });
  return bomRows.filter(function (r) {
    var cond = parseCondition(r.condition);
    if (cond === null) return true;
    return Object.keys(cond).every(function (code) { return selectedMap[code] === cond[code]; });
  });
}

// selectedConditions 로 좁힌 BOM 한 시점의 총 MH. Common + 조건 만족 라인 전부 합산 —
// "이 조건 조합으로 조립되는 1대분 총 MH"를 낸다(④가 이 함수를 기종별로 자동 실행한다).
function sumConditionalMH(bomRows, itemMasterRows, selectedConditions) {
  var filtered = filterAssyByCondition(bomRows, selectedConditions);
  var mhLookup = buildMhLookup(itemMasterRows);
  var sum = sumMhByAssy(filtered, mhLookup);
  var total = 0;
  sum.totals.forEach(function (v) { total += v; });
  return {
    total: round2(total),
    matchedAssy: new Set(filtered.map(function (r) { return r.assy; })),
    unmatched: sum.unmatched
  };
}

// ⑤ "선택 조건 상세" — Old/New 두 시점을 같은 조건으로 좁혀 MH 변동·구성변경을 낸다.
function computeConditionalMH(oldBomRows, newBomRows, itemMasterRows, selectedConditions) {
  var oldCalc = sumConditionalMH(oldBomRows, itemMasterRows, selectedConditions);
  var newCalc = sumConditionalMH(newBomRows, itemMasterRows, selectedConditions);
  var filteredOld = filterAssyByCondition(oldBomRows, selectedConditions);
  var filteredNew = filterAssyByCondition(newBomRows, selectedConditions);

  var lineDiff = diffBomLines(filteredOld, filteredNew);
  var changeCounts = { 신규: 0, 삭제: 0, 변경: 0 };
  lineDiff.forEach(function (d) { if (changeCounts[d.status] !== undefined) changeCounts[d.status]++; });

  var matchedAssy = new Set([].concat(Array.from(oldCalc.matchedAssy), Array.from(newCalc.matchedAssy)));

  return {
    oldMH: oldCalc.total,
    newMH: newCalc.total,
    deltaMH: round2(newCalc.total - oldCalc.total),
    matchedAssyCount: matchedAssy.size,
    changeCounts: changeCounts,
    lineDiff: lineDiff,
    unmatched: oldCalc.unmatched.concat(newCalc.unmatched)
  };
}

// ── ④ MH 산출 — 기종별 대표사양 조건으로 sumConditionalMH 를 자동 실행 ──
// OLD 1대분 MH = 기종의 OLD 대표사양 조건 × OLD BOM. NEW 1대분 MH = 기종의
// NEW 대표사양 조건 × NEW BOM. (BOM 자체엔 기종 컬럼이 없다는 전제 — Common 은
// 전 기종 공통, 조건부 라인만 기종을 가른다. 기종마다 BOM Assy 구성 자체가 다르다면
// 이 전제가 깨지므로 이 로직은 재설계가 필요하다 — Dev_md에 명시)
function computeModelMH(oldRepRows, newRepRows, oldBomRows, newBomRows, itemMasterRows) {
  var oldTable = buildRepSpecTable(oldRepRows);
  var newTable = buildRepSpecTable(newRepRows);
  var oldByModel = new Map(oldTable.map(function (t) { return [t.model, t]; }));
  var newByModel = new Map(newTable.map(function (t) { return [t.model, t]; }));
  var models = new Set([].concat(
    oldTable.map(function (t) { return t.model; }),
    newTable.map(function (t) { return t.model; })
  ));

  var result = [];
  models.forEach(function (model) {
    var oldRep = oldByModel.get(model);
    var newRep = newByModel.get(model);
    var oldConditions = oldRep ? oldRep.reps.map(function (r) { return { optionCode: r.optionCode, optionValue: r.optionValue }; }) : [];
    var newConditions = newRep ? newRep.reps.map(function (r) { return { optionCode: r.optionCode, optionValue: r.optionValue }; }) : [];
    var oldMH = sumConditionalMH(oldBomRows, itemMasterRows, oldConditions).total;
    var newMH = sumConditionalMH(newBomRows, itemMasterRows, newConditions).total;
    result.push({
      model: model,
      repSelected: newRep ? (newRep.selected + '/' + newRep.total) : (oldRep ? (oldRep.selected + '/' + oldRep.total) : '0/0'),
      oldMH: oldMH,
      newMH: newMH,
      deltaMH: round2(newMH - oldMH),
      oldConditions: oldConditions,
      newConditions: newConditions
    });
  });
  result.sort(function (a, b) { return Math.abs(b.deltaMH) - Math.abs(a.deltaMH); });
  return result;
}

// ── ⑤ MH 옵션 분석 — 옵션값 단독(AND 조합 아님) 랭킹 ──────────────
// 각 (옵션코드,옵션값)이 "그 옵션을 택했을 때 추가·변경되는 MH"를 단독으로 보여준다.
// Common 라인은 일부러 뺀다 — Common 을 넣으면 모든 옵션 행에 같은 공통분모가 섞여
// 옵션 자체의 영향력을 가린다(④는 총량이 목적이라 Common 포함, ⑤랭킹은 "이 옵션의
// 몫"이 목적이라 제외 — 서로 다른 질문에 다른 집계라 의도적으로 갈랐다).
function rankOptionValueMH(oldRepRows, newRepRows, oldBomRows, newBomRows, itemMasterRows) {
  var seen = new Map();
  [].concat(oldRepRows, newRepRows).forEach(function (r) {
    var key = r.optionCode + '|' + r.optionValue;
    if (!seen.has(key)) {
      seen.set(key, { optionCode: r.optionCode, optionValue: r.optionValue, optionName: r.optionName, valueName: r.valueName });
    }
  });

  var mhLookup = buildMhLookup(itemMasterRows);
  var rows = [];
  seen.forEach(function (info) {
    var oldLines = oldBomRows.filter(function (r) {
      var cond = parseCondition(r.condition);
      return cond !== null && cond[info.optionCode] === info.optionValue;
    });
    var newLines = newBomRows.filter(function (r) {
      var cond = parseCondition(r.condition);
      return cond !== null && cond[info.optionCode] === info.optionValue;
    });
    var oldSum = sumMhByAssy(oldLines, mhLookup);
    var newSum = sumMhByAssy(newLines, mhLookup);
    var oldTotal = 0; oldSum.totals.forEach(function (v) { oldTotal += v; });
    var newTotal = 0; newSum.totals.forEach(function (v) { newTotal += v; });
    var matchedAssy = new Set([].concat(oldLines.map(function (r) { return r.assy; }), newLines.map(function (r) { return r.assy; })));

    rows.push({
      optionCode: info.optionCode, optionValue: info.optionValue,
      optionName: info.optionName, valueName: info.valueName,
      matchedAssyCount: matchedAssy.size,
      oldMH: round2(oldTotal), newMH: round2(newTotal), deltaMH: round2(newTotal - oldTotal)
    });
  });
  rows.sort(function (a, b) { return Math.abs(b.deltaMH) - Math.abs(a.deltaMH); });
  return rows;
}

var MHLogicExports = {
  buildItemMaster: buildItemMaster,
  buildMhLookup: buildMhLookup,
  diffBomLines: diffBomLines,
  sumMhByAssy: sumMhByAssy,
  compareAssyMH: compareAssyMH,
  buildRepSpecTable: buildRepSpecTable,
  diffRepSpec: diffRepSpec,
  parseCondition: parseCondition,
  filterAssyByCondition: filterAssyByCondition,
  sumConditionalMH: sumConditionalMH,
  computeConditionalMH: computeConditionalMH,
  computeModelMH: computeModelMH,
  rankOptionValueMH: rankOptionValueMH
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MHLogicExports;
}
if (typeof window !== 'undefined') {
  window.MHLogic = MHLogicExports;
}
