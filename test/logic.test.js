'use strict';
var assert = require('assert');
var logic = require('../js/logic.js');

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('[Item Master]');
test('buildItemMaster: STM분류 기준 조인, 개수별 MH 전개', function () {
  var list = [
    { partNo: 'P-001', partName: 'WASHER', stmCategory: 'A' },
    { partNo: 'P-002', partName: 'BOLT', stmCategory: 'A' }
  ];
  var mh = [
    { stmCategory: 'A', qty: 1, mh: 0.4 },
    { stmCategory: 'A', qty: 2, mh: 0.62 }
  ];
  var out = logic.buildItemMaster(list, mh);
  assert.strictEqual(out.rows.length, 4);
  assert.strictEqual(out.unmatchedCategories.length, 0);
  var p001Qty2 = out.rows.find(function (r) { return r.partNo === 'P-001' && r.qty === 2; });
  assert.strictEqual(p001Qty2.mh, 0.62);
});

test('buildItemMaster: MH 테이블에 없는 STM분류는 unmatchedCategories 에 남는다', function () {
  var list = [{ partNo: 'P-999', partName: 'UNKNOWN', stmCategory: 'Z' }];
  var mh = [{ stmCategory: 'A', qty: 1, mh: 0.1 }];
  var out = logic.buildItemMaster(list, mh);
  assert.strictEqual(out.rows.length, 0);
  assert.deepStrictEqual(out.unmatchedCategories, ['Z']);
});

console.log('[BOM 비교]');
test('diffBomLines: 신규/삭제/변경/동일 판정', function () {
  var oldRows = [
    { assy: 'ASSY-1', partNo: 'P-001', partName: 'WASHER', qty: 2 },
    { assy: 'ASSY-1', partNo: 'P-002', partName: 'BOLT', qty: 4 },
    { assy: 'ASSY-1', partNo: 'P-003', partName: 'NUT', qty: 4 }
  ];
  var newRows = [
    { assy: 'ASSY-1', partNo: 'P-001', partName: 'WASHER', qty: 3 },   // 변경
    { assy: 'ASSY-1', partNo: 'P-002', partName: 'BOLT', qty: 4 },     // 동일
    { assy: 'ASSY-1', partNo: 'P-004', partName: 'PIN', qty: 1 }       // 신규 (P-003 삭제)
  ];
  var diff = logic.diffBomLines(oldRows, newRows);
  var byPart = {};
  diff.forEach(function (d) { byPart[d.partNo] = d.status; });
  assert.strictEqual(byPart['P-001'], '변경');
  assert.strictEqual(byPart['P-002'], '동일');
  assert.strictEqual(byPart['P-003'], '삭제');
  assert.strictEqual(byPart['P-004'], '신규');
});

test('sumMhByAssy: (품번,개수) 매칭으로 assy 별 MH 합산, 미매칭은 unmatched 로', function () {
  var bom = [
    { assy: 'ASSY-1', partNo: 'P-001', qty: 2 },
    { assy: 'ASSY-1', partNo: 'P-999', qty: 1 }
  ];
  var lookup = logic.buildMhLookup([{ partNo: 'P-001', qty: 2, mh: 0.62 }]);
  var out = logic.sumMhByAssy(bom, lookup);
  assert.strictEqual(out.totals.get('ASSY-1'), 0.62);
  assert.strictEqual(out.unmatched.length, 1);
  assert.strictEqual(out.unmatched[0].partNo, 'P-999');
});

test('compareAssyMH: Old/New MH 와 ΔMH 를 assy 별로 낸다', function () {
  var itemMaster = [
    { partNo: 'P-001', partName: 'WASHER', stmCategory: 'A', qty: 2, mh: 0.62 },
    { partNo: 'P-001', partName: 'WASHER', stmCategory: 'A', qty: 3, mh: 0.72 },
    { partNo: 'P-002', partName: 'BOLT', stmCategory: 'A', qty: 4, mh: 0.82 }
  ];
  var oldBom = [
    { assy: 'ASSY-1', partNo: 'P-001', partName: 'WASHER', qty: 2 },
    { assy: 'ASSY-1', partNo: 'P-002', partName: 'BOLT', qty: 4 }
  ];
  var newBom = [
    { assy: 'ASSY-1', partNo: 'P-001', partName: 'WASHER', qty: 3 },
    { assy: 'ASSY-1', partNo: 'P-002', partName: 'BOLT', qty: 4 }
  ];
  var out = logic.compareAssyMH(oldBom, newBom, itemMaster);
  var a1 = out.byAssy.find(function (r) { return r.assy === 'ASSY-1'; });
  assert.strictEqual(a1.oldMH, 1.44);
  assert.strictEqual(a1.newMH, 1.54);
  assert.strictEqual(a1.deltaMH, 0.1);
  assert.strictEqual(out.lineDiff.find(function (d) { return d.partNo === 'P-001'; }).status, '변경');
});

console.log('[대표사양]');
test('buildRepSpecTable: 기종별 isRep=true 만 골라낸다', function () {
  var rows = [
    { model: 'DX80R', optionCode: 'C_FHYD', optionValue: 'NOR', optionName: 'Hydraulic fluid', valueName: 'Normal(VG46)', isRep: true },
    { model: 'DX80R', optionCode: 'C_FHYD', optionValue: 'ARC', optionName: 'Hydraulic fluid', valueName: 'Arctic', isRep: false }
  ];
  var out = logic.buildRepSpecTable(rows);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].total, 2);
  assert.strictEqual(out[0].selected, 1);
  assert.strictEqual(out[0].reps[0].optionValue, 'NOR');
});

test('buildRepSpecTable: 대표사양이 하나도 없는 기종도 selected:0 으로 명시된다(조용히 빠뜨리지 않음)', function () {
  var rows = [{ model: 'EX10', optionCode: 'C_X', optionValue: 'A', optionName: 'X', valueName: 'A', isRep: false }];
  var out = logic.buildRepSpecTable(rows);
  assert.strictEqual(out[0].selected, 0);
});

test('diffRepSpec: 대표사양 조합이 바뀌면 changed:true', function () {
  var oldRows = [{ model: 'DX80R', optionCode: 'C_FHYD', optionValue: 'NOR', optionName: 'X', valueName: 'Y', isRep: true }];
  var newRows = [{ model: 'DX80R', optionCode: 'C_FHYD', optionValue: 'ARC', optionName: 'X', valueName: 'Y', isRep: true }];
  var out = logic.diffRepSpec(oldRows, newRows);
  assert.strictEqual(out[0].changed, true);
});

console.log('\n' + (fail === 0 ? 'O' : 'X') + ' ' + pass + ' 통과 / ' + fail + ' 실패');
if (fail > 0) process.exit(1);
