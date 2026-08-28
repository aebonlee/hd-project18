'use strict';
/* global XLSX, MHLogic */

function switchTab(id, btn) {
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id === 'tab4' || id === 'tab5') maybeShowTentativeModal();
}
window.switchTab = switchTab;

// ④⑤ 잠정 로직 안내 — 세션당 1회만, 처음 그 탭에 들어갈 때.
var TENTATIVE_MODAL_KEY = 'hd18-tentative-modal-seen';
function maybeShowTentativeModal() {
  try {
    if (sessionStorage.getItem(TENTATIVE_MODAL_KEY)) return;
  } catch (e) { /* sessionStorage 막힌 환경(프라이빗 모드 등) — 매번 뜨는 쪽이 안전하니 그냥 진행 */ }
  var modal = document.getElementById('tentative-modal');
  if (!modal) return;
  modal.hidden = false;
  document.getElementById('tentative-modal-close').focus();
}
function closeTentativeModal() {
  var modal = document.getElementById('tentative-modal');
  if (!modal) return;
  modal.hidden = true;
  try { sessionStorage.setItem(TENTATIVE_MODAL_KEY, '1'); } catch (e) { /* 무시 — 다음에도 또 뜰 뿐, 기능은 안 죽는다 */ }
}
document.addEventListener('DOMContentLoaded', function () {
  var modal = document.getElementById('tentative-modal');
  if (!modal) return;
  document.getElementById('tentative-modal-close').addEventListener('click', closeTentativeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeTentativeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeTentativeModal();
  });
});

// 업로드된 파일(xlsx/xls/csv) 을 [{컬럼명: 값}, ...] 배열로 읽는다.
function readSheetAsRows(file, cb) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', codepage: 949 });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    cb(null, rows);
  };
  reader.onerror = function () { cb(new Error('파일을 읽지 못했습니다')); };
  reader.readAsArrayBuffer(file);
}

function wireDropzone(zoneId, inputId, onFile) {
  var zone = document.getElementById(zoneId);
  var input = document.getElementById(inputId);
  zone.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () {
    if (input.files[0]) onFile(input.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
  });
  zone.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

function markLoaded(zoneId, filename) {
  var el = document.getElementById(zoneId).querySelector('.fname');
  el.textContent = '✓ ' + filename;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ── 상태 ──────────────────────────────────────────────────────
var state = {
  itemList: null, itemMh: null, itemMaster: null,
  bomOld: null, bomNew: null,
  repOld: null, repNew: null
};

// ── 1. Item Master ────────────────────────────────────────────
wireDropzone('dz-item-list', 'in-item-list', function (file) {
  readSheetAsRows(file, function (err, rows) {
    if (err) return alert(err.message);
    state.itemList = rows.map(function (r) {
      return { partNo: String(r['품번'] || '').trim(), partName: r['품명'], stmCategory: String(r['STM분류'] || '').trim() };
    }).filter(function (r) { return r.partNo; });
    markLoaded('dz-item-list', file.name + ' (' + state.itemList.length + '행)');
    checkItemMasterReady();
  });
});
wireDropzone('dz-item-mh', 'in-item-mh', function (file) {
  readSheetAsRows(file, function (err, rows) {
    if (err) return alert(err.message);
    state.itemMh = rows.map(function (r) {
      return { stmCategory: String(r['STM분류'] || '').trim(), qty: Number(r['개수']), mh: Number(r['작업시간(MH)']) };
    }).filter(function (r) { return r.stmCategory; });
    markLoaded('dz-item-mh', file.name + ' (' + state.itemMh.length + '행)');
    checkItemMasterReady();
  });
});

function checkItemMasterReady() {
  document.getElementById('btn-build-item-master').disabled = !(state.itemList && state.itemMh);
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('btn-build-item-master').addEventListener('click', function () {
    var result = MHLogic.buildItemMaster(state.itemList, state.itemMh);
    state.itemMaster = result.rows;
    renderItemMaster(result);
    checkBomReady();
    checkTab4Ready();
  });

  document.getElementById('btn-compare-bom').addEventListener('click', function () {
    var out = MHLogic.compareAssyMH(state.bomOld, state.bomNew, state.itemMaster || []);
    renderBomCompare(out);
  });

  document.getElementById('btn-build-repspec').addEventListener('click', function () {
    var diff = MHLogic.diffRepSpec(state.repOld, state.repNew);
    renderRepSpec(diff);
  });

  wireExport('export-item-master', function () { return state.itemMaster; },
    ['partNo', 'partName', 'stmCategory', 'qty', 'mh'], ['품번', '품명', 'STM분류', '개수', '작업시간(MH)']);

  document.getElementById('btn-compute-model-mh').addEventListener('click', function () {
    var out = MHLogic.computeModelMH(state.repOld, state.repNew, state.bomOld, state.bomNew, state.itemMaster || []);
    state.modelMH = out;
    renderModelMH(out);
  });

  document.getElementById('btn-rank-options').addEventListener('click', function () {
    var out = MHLogic.rankOptionValueMH(state.repOld, state.repNew, state.bomOld, state.bomNew, state.itemMaster || []);
    renderRankOptions(out);
  });

  document.getElementById('btn-clear-conditions').addEventListener('click', function () {
    document.getElementById('cond-detail-card').style.display = 'none';
  });
});

// ── ④ MH 산출 / ⑤ MH 옵션 분석 — 전제조건 체크 ─────────────────
// 탭1~3의 업로드·계산 버튼이 눌릴 때마다 이것도 같이 불러 갱신한다.
function checkTab4Ready() {
  var okItem = !!state.itemMaster;
  var okBom = !!(state.bomOld && state.bomNew);
  var okRep = !!(state.repOld && state.repNew);
  // "선정" 은 참고 표시일 뿐 실행을 막지 않는다 — 일부 기종이 아직 대표사양
  // 미선정이어도(예: EX10 old) computeModelMH 가 Common-only 로 안전하게 계산하고
  // renderModelMH 가 그 사실을 결과에 명시한다(조용히 빠뜨리지 않는다 원칙).
  var okRepSel = false;
  if (okRep) {
    var oldTable = MHLogic.buildRepSpecTable(state.repOld);
    var newTable = MHLogic.buildRepSpecTable(state.repNew);
    okRepSel = (oldTable.length > 0 && oldTable.some(function (t) { return t.selected > 0; })) ||
      (newTable.length > 0 && newTable.some(function (t) { return t.selected > 0; }));
  }
  setPrecond('pc-item', okItem);
  setPrecond('pc-bom', okBom);
  setPrecond('pc-rep', okRep);
  setPrecond('pc-repsel', okRepSel);

  var allReady = okItem && okBom && okRep;
  document.getElementById('btn-compute-model-mh').disabled = !allReady;
  document.getElementById('btn-rank-options').disabled = !(okItem && okBom && okRep);
}

function setPrecond(id, ok) {
  var el = document.getElementById(id);
  el.classList.toggle('pc-ok', ok);
  el.classList.toggle('pc-pending', !ok);
}

function renderItemMaster(result) {
  var body = document.getElementById('item-master-body');
  document.getElementById('item-master-count').textContent = result.rows.length + '행';
  body.innerHTML = result.rows.slice(0, 200).map(function (r) {
    return '<tr><td>' + escapeHtml(r.partNo) + '</td><td>' + escapeHtml(r.partName) + '</td><td>' +
      escapeHtml(r.stmCategory) + '</td><td>' + r.qty + '</td><td>' + r.mh + '</td></tr>';
  }).join('');
  var note = document.getElementById('item-master-note');
  if (result.unmatchedCategories.length) {
    note.className = 'note warn';
    note.textContent = '⚠ 공수(MH) 테이블에 없는 STM분류 ' + result.unmatchedCategories.length + '건 — ' + result.unmatchedCategories.join(', ');
  } else {
    note.className = 'note';
    note.textContent = '전체 STM분류가 공수 테이블과 매칭됐습니다.';
  }
  document.getElementById('item-master-result').style.display = 'block';
}

// ── 2. BOM 비교 ───────────────────────────────────────────────
wireDropzone('dz-bom-old', 'in-bom-old', function (file) { loadBom(file, 'old'); });
wireDropzone('dz-bom-new', 'in-bom-new', function (file) { loadBom(file, 'new'); });

function loadBom(file, which) {
  readSheetAsRows(file, function (err, rows) {
    if (err) return alert(err.message);
    var parsed = rows.map(function (r) {
      // "조립조건" 컬럼이 없는 구 양식 업로드도 깨지지 않게 기본값 Common으로 채운다.
      var condition = String(r['조립조건'] || 'Common').trim() || 'Common';
      return { assy: String(r['Assy'] || '').trim(), partNo: String(r['품번'] || '').trim(), partName: r['품명'], qty: Number(r['개수']), condition: condition };
    }).filter(function (r) { return r.assy && r.partNo; });
    state['bom' + (which === 'old' ? 'Old' : 'New')] = parsed;
    markLoaded('dz-bom-' + which, file.name + ' (' + parsed.length + '행)');
    checkBomReady();
    checkTab4Ready();
  });
}

function checkBomReady() {
  document.getElementById('btn-compare-bom').disabled = !(state.bomOld && state.bomNew);
}

function renderBomCompare(out) {
  var statusClass = { '신규': 'status-new', '삭제': 'status-del', '변경': 'status-chg', '동일': 'status-same' };
  document.getElementById('bom-assy-body').innerHTML = out.byAssy.map(function (r) {
    var cls = r.deltaMH > 0 ? 'delta-pos' : (r.deltaMH < 0 ? 'delta-neg' : '');
    return '<tr><td>' + escapeHtml(r.assy) + '</td><td>' + r.oldMH + '</td><td>' + r.newMH +
      '</td><td class="' + cls + '">' + (r.deltaMH > 0 ? '+' : '') + r.deltaMH + '</td></tr>';
  }).join('');

  var changed = out.lineDiff.filter(function (d) { return d.status !== '동일'; });
  document.getElementById('bom-line-body').innerHTML = changed.map(function (d) {
    return '<tr><td>' + escapeHtml(d.assy) + '</td><td>' + escapeHtml(d.partNo) + '</td><td>' + escapeHtml(d.partName) +
      '</td><td>' + escapeHtml(d.condition) + '</td><td class="' + statusClass[d.status] + '">' + d.status + '</td><td>' + (d.oldQty == null ? '—' : d.oldQty) +
      '</td><td>' + (d.newQty == null ? '—' : d.newQty) + '</td></tr>';
  }).join('');

  var note = document.getElementById('bom-note');
  if (out.unmatched.length) {
    note.className = 'note warn';
    note.textContent = '⚠ Item Master 에서 (품번,개수) 조합을 못 찾아 MH 미반영 ' + out.unmatched.length + '건. Item Master 를 먼저 만들지 않았다면 1번 탭부터 진행하세요.';
  } else {
    note.className = 'note';
    note.textContent = '전체 라인이 Item Master 와 매칭됐습니다. 총 ' + changed.length + '건 변경(신규+삭제+변경).';
  }
  document.getElementById('bom-result').style.display = 'block';
}

// ── 3. 대표사양 ───────────────────────────────────────────────
wireDropzone('dz-rep-old', 'in-rep-old', function (file) { loadRep(file, 'old'); });
wireDropzone('dz-rep-new', 'in-rep-new', function (file) { loadRep(file, 'new'); });

function loadRep(file, which) {
  readSheetAsRows(file, function (err, rows) {
    if (err) return alert(err.message);
    var parsed = rows.map(function (r) {
      return {
        model: String(r['기종'] || '').trim(), optionCode: r['옵션코드'], optionValue: r['옵션값'],
        optionName: r['옵션명'], valueName: r['값이름'],
        isRep: String(r['대표사양'] || '').trim().toUpperCase() === 'TRUE'
      };
    }).filter(function (r) { return r.model; });
    state['rep' + (which === 'old' ? 'Old' : 'New')] = parsed;
    markLoaded('dz-rep-' + which, file.name + ' (' + parsed.length + '행)');
    document.getElementById('btn-build-repspec').disabled = !(state.repOld && state.repNew);
    checkTab4Ready();
  });
}

function renderRepSpec(diff) {
  document.getElementById('repspec-body').innerHTML = diff.map(function (d) {
    var repsText = d.current ? d.current.reps.map(function (r) { return r.optionName + ':' + r.valueName; }).join(', ') : '—';
    return '<tr><td>' + escapeHtml(d.model) + '</td><td>' + (d.current ? d.current.selected + '/' + d.current.total : '—') +
      '</td><td>' + escapeHtml(repsText) + '</td><td class="' + (d.changed ? 'status-chg' : 'status-same') + '">' +
      (d.changed ? '변경됨' : '동일') + '</td></tr>';
  }).join('');
  document.getElementById('repspec-result').style.display = 'block';
}

// ── ④ MH 산출 ────────────────────────────────────────────────
function renderModelMH(list) {
  document.getElementById('model-mh-body').innerHTML = list.map(function (m, i) {
    var cls = m.deltaMH > 0 ? 'delta-pos' : (m.deltaMH < 0 ? 'delta-neg' : '');
    return '<tr class="clickable-row" data-idx="' + i + '"><td>' + escapeHtml(m.model) + '</td><td>' + escapeHtml(m.repSelected) +
      '</td><td>' + m.oldMH + '</td><td>' + m.newMH + '</td><td class="' + cls + '">' +
      (m.deltaMH > 0 ? '+' : '') + m.deltaMH + '</td></tr>';
  }).join('');
  document.querySelectorAll('#model-mh-body tr').forEach(function (tr) {
    tr.addEventListener('click', function () { showModelDetail(list[Number(tr.dataset.idx)]); });
  });
  document.getElementById('model-mh-note').textContent =
    list.length + '개 기종 — ③에서 선정된 대표사양 조건(Common 포함)으로 1대분 총 MH를 계산했습니다. 잠정 로직입니다.';
  document.getElementById('model-mh-result').style.display = 'block';
  document.getElementById('model-mh-detail').style.display = 'block';
}

function showModelDetail(m) {
  var fmtCond = function (list) {
    return list.length ? list.map(function (c) { return c.optionCode + '=' + c.optionValue; }).join(', ') : '(대표사양 없음 — Common만)';
  };
  document.getElementById('model-mh-detail-body').innerHTML =
    '<strong>' + escapeHtml(m.model) + '</strong><br>' +
    'Old 조건: ' + escapeHtml(fmtCond(m.oldConditions)) + ' → Old MH ' + m.oldMH + '<br>' +
    'New 조건: ' + escapeHtml(fmtCond(m.newConditions)) + ' → New MH ' + m.newMH + '<br>' +
    'ΔMH: ' + (m.deltaMH > 0 ? '+' : '') + m.deltaMH;
}

// ── ⑤ MH 옵션 분석 ──────────────────────────────────────────
function renderRankOptions(rows) {
  document.getElementById('rank-options-body').innerHTML = rows.map(function (r, i) {
    var cls = r.deltaMH > 0 ? 'delta-pos' : (r.deltaMH < 0 ? 'delta-neg' : '');
    return '<tr><td>' + escapeHtml(r.optionCode) + '</td><td>' + escapeHtml(r.optionValue) + '</td><td>' +
      escapeHtml(r.optionName) + '</td><td>' + escapeHtml(r.valueName) + '</td><td>' + r.matchedAssyCount +
      '</td><td>' + r.oldMH + '</td><td>' + r.newMH + '</td><td class="' + cls + '">' +
      (r.deltaMH > 0 ? '+' : '') + r.deltaMH + '</td><td><button class="btn-link" data-idx="' + i + '">상세</button></td></tr>';
  }).join('');
  document.querySelectorAll('#rank-options-body .btn-link').forEach(function (btn) {
    btn.addEventListener('click', function () { showConditionDetail([rows[Number(btn.dataset.idx)]]); });
  });
  if (!rows.length) {
    document.getElementById('rank-options-body').innerHTML = '<tr><td colspan="9" class="note">대표사양 데이터에 옵션값이 없습니다.</td></tr>';
  }
}

// selected: [{optionCode, optionValue, optionName?, valueName?}]
function showConditionDetail(selected) {
  var conditions = selected.map(function (s) { return { optionCode: s.optionCode, optionValue: s.optionValue }; });
  var out = MHLogic.computeConditionalMH(state.bomOld, state.bomNew, state.itemMaster || [], conditions);

  document.getElementById('cond-selected-chips').innerHTML = selected.map(function (s) {
    return '<span class="badge-chip">' + escapeHtml(s.optionCode) + '=' + escapeHtml(s.optionValue) + '</span>';
  }).join(' ');

  document.getElementById('cond-stats').innerHTML =
    '매칭 Assy ' + out.matchedAssyCount + '종 · MH ' + out.oldMH + ' → ' + out.newMH +
    ' (ΔMH ' + (out.deltaMH > 0 ? '+' : '') + out.deltaMH + ') · 구성변경 ' +
    (out.changeCounts['신규'] + out.changeCounts['삭제'] + out.changeCounts['변경']) + '종 ' +
    '(신규' + out.changeCounts['신규'] + '/삭제' + out.changeCounts['삭제'] + '/변경' + out.changeCounts['변경'] + ')';

  var changed = out.lineDiff.filter(function (d) { return d.status !== '동일'; });
  var statusClass = { '신규': 'status-new', '삭제': 'status-del', '변경': 'status-chg', '동일': 'status-same' };
  document.getElementById('cond-line-body').innerHTML = changed.map(function (d) {
    return '<tr><td class="' + statusClass[d.status] + '">' + d.status + '</td><td>' + escapeHtml(d.assy) + '</td><td>' +
      escapeHtml(d.partNo) + '</td><td>' + escapeHtml(d.partName) + '</td><td>' + (d.oldQty == null ? '—' : d.oldQty) +
      '</td><td>' + (d.newQty == null ? '—' : d.newQty) + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="note">이 조건에 해당하는 변경 라인이 없습니다.</td></tr>';

  document.getElementById('cond-detail-card').style.display = 'block';
}

// ── 엑셀 내보내기 ─────────────────────────────────────────────
function wireExport(btnId, getRows, keys, headers) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', function () {
    var rows = getRows();
    if (!rows || !rows.length) { alert('내보낼 데이터가 없습니다. 먼저 생성하세요.'); return; }
    var aoa = [headers].concat(rows.map(function (r) { return keys.map(function (k) { return r[k]; }); }));
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, btnId + '.xlsx');
  });
}
