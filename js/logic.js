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
      assy: ref.assy, partNo: ref.partNo, partName: ref.partName,
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

var MHLogicExports = {
  buildItemMaster: buildItemMaster,
  buildMhLookup: buildMhLookup,
  diffBomLines: diffBomLines,
  sumMhByAssy: sumMhByAssy,
  compareAssyMH: compareAssyMH,
  buildRepSpecTable: buildRepSpecTable,
  diffRepSpec: diffRepSpec
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MHLogicExports;
}
if (typeof window !== 'undefined') {
  window.MHLogic = MHLogicExports;
}
