'use strict';
/* global XLSX, MHLogic */

function switchTab(id, btn) {
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
}
window.switchTab = switchTab;

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
});

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
      return { assy: String(r['Assy'] || '').trim(), partNo: String(r['품번'] || '').trim(), partName: r['품명'], qty: Number(r['개수']) };
    }).filter(function (r) { return r.assy && r.partNo; });
    state['bom' + (which === 'old' ? 'Old' : 'New')] = parsed;
    markLoaded('dz-bom-' + which, file.name + ' (' + parsed.length + '행)');
    checkBomReady();
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
      '</td><td class="' + statusClass[d.status] + '">' + d.status + '</td><td>' + (d.oldQty == null ? '—' : d.oldQty) +
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
