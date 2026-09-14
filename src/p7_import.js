/* =========================================================
   データ取込：テキスト貼り付け のみ（スクリーンショットOCRは廃止）
   ========================================================= */
/* ラップ表示（6F 83.5-5F 69.1-3F 38.9）と時計表示のヘルパ */
function fmtLap(ev){
  if (!ev || !ev.laps || !ev.laps.length) return '';
  return ev.laps.map(function(l){ return l[0] + 'F ' + String(l[1]); }).join('-');
}
function fmtTime(sec){
  if (sec == null || !isFinite(sec)) return '';
  var m = Math.floor(sec / 60), s2 = sec - m * 60;
  var sStr = s2.toFixed(1);
  if (s2 < 10) sStr = '0' + sStr;
  return m + ':' + sStr;
}

function countReal(items){ var c=0; items.forEach(function(i){ if (i.apply) c++; }); return c; }

function applyParsedByType(type, parsed, logEl, silent){
  var lines = [], added = 0, updated = 0;
  if (type === 'card'){
    if (!silent) lines.push('出馬表: ' + parsed.rows.length + '頭を認識 → 取込');
    parsed.rows.forEach(function(r){
      var idx = upsertByNo(r.no, { frame:r.frame, no:r.no, name:r.name, sexAge:r.sexAge, weight:r.weight, jockey:r.jockey });
      if (idx === -1) lines.push('⚠ 上限18頭のため取込スキップ: ' + r.no + ' ' + r.name); else if (idx === -2) lines.push('⚠ 取込エラー: ' + r.line);
    });
    if (parsed.rejects.length && !silent) lines.push('読み飛ばした行: ' + parsed.rejects.length + '行(表外の行・ノイズの可能性)');
  } else if (type === 'odds'){
    if (!silent) lines.push('単勝オッズ: ' + parsed.odds.length + '頭分を更新');
    parsed.odds.forEach(function(o){
      var idx = upsertByNo(o.no, { odds: String(o.odds) });
      if (idx === -1) lines.push('⚠ 該当馬番なし: ' + o.no);
    });
    if (parsed.rejects.length && !silent) lines.push('読み飛ばした行: ' + parsed.rejects.length + '行');
  } else if (type === 'yobi'){
    var rows = parsed.filter(function(i){ return i.ok; });
    if (!silent) lines.push('調教タイム: ' + rows.length + '件を認識');
    return mapAndApply(rows, type, logEl, lines);
  } else if (type === 'time'){
    var rowsT = parsed.filter(function(i){ return i.ok && i.timeSec != null; });
    if (!silent) lines.push('持ちタイム: ' + rowsT.length + '件を認識');
    return mapAndApply(rowsT, type, logEl, lines);
  }
  showLogLines(logEl, lines);
  rebuildHorseTable();
}

function showLogLines(el, lines){
  if (!el) return;
  el.innerHTML = lines.map(function(l){ return esc(l) + '<br>'; }).join('');
}

/* 調教・持ちタイムは「馬名」→「登録馬」の割当ダイアログ */
function mapAndApply(items, type, logEl, lines){
  if (!items.length){ showLogLines(logEl, ['対象を認識できませんでした。書き方例: 「ドウデュース 6F 83.2-5F 68.8-3F 38.4」']); return; }
  var horses = state.horses.slice();
  var names = horses.map(function(h){ return h.name; });
  var rowsHtml = '';
  items.forEach(function(it, idx){
    var sug = suggestNameIdx(it.name, names);
    var opts = '<option value="">（スキップ）</option>';
    horses.forEach(function(h, hi){
      opts += '<option value="' + h.uid + '"' + (hi === sug ? ' selected' : '') + '>' + esc(h.no) + ' ' + esc(h.name) + '</option>';
    });
    var rec = type === 'yobi' ? esc(fmtLap(it.ev)) : esc(fmtTime(it.timeSec));
    rowsHtml += '<div class="maprow">' +
      '<div><b>' + esc(it.name || '(名前なし)') + '</b><div class="muted small">' + esc(it.line) + '</div></div>' +
      '<span class="badge">' + (type==='yobi'?'調教':'タイム') + '</span>' +
      '<span class="nowrap">' + rec + '</span>' +
      '<select data-mi="' + idx + '">' + opts + '</select></div>';
  });
  var body = '<h2>' + (type==='yobi' ? '調教タイム' : '持ちタイム') + 'の馬名を確認</h2>' +
    '<p class="small muted">貼り付けで読んだ馬名と登録中の出馬表を突き合わせます。合っていればそのまま「取り込む」でOK。</p>' +
    '<div class="mmaphead maprow"><span>読み取り内容</span><span></span><span>記録</span><span>登録馬</span></div>' + rowsHtml +
    '<div style="text-align:right;margin-top:12px"><button class="btn ghost" data-mcl>キャンセル</button> ' +
    '<button class="btn primary" data-mok>選択を反映して取り込む</button></div>';
  showModal(body, function(root){
    root.querySelector('[data-mcl]').addEventListener('click', closeModal);
    root.querySelector('[data-mok]').addEventListener('click', function(){
      var nApply = 0, nSkip = 0;
      root.querySelectorAll('select[data-mi]').forEach(function(sel){
        var idx = parseInt(sel.dataset.mi,10);
        var uid = parseInt(sel.value,10);
        var it = items[idx];
        if (isNaN(uid) || !it) { nSkip++; return; }
        var h = findHorseByUid(uid);
        if (!h) { nSkip++; return; }
        if (type === 'yobi'){
          var ev = evaluateLapStr(it.ev ? fmtLap(it.ev) : it.line);
          if (ev.laps.length) h.yobi = fmtLap(ev);
        } else {
          h.time = fmtTime(it.timeSec);
        }
        nApply++;
      });
      lines.push((type==='yobi'?'調教':'持ちタイム') + 'を ' + nApply + '頭に反映（スキップ ' + nSkip + '件）');
      showLogLines(logEl, lines);
      rebuildHorseTable();
      closeModal();
    });
  });
}

/* ---------- テキスト貼り付け実行 ---------- */
/* ★2026-09-13 第19弾④: 折り込み表示にしたので、ログ（#pasteLog）が閉じた中に隠れないよう
   取り込みのたびに必ず開くようにしました。 */
function pasteFoldOpen(){
  var f = $('pasteFold');
  if (f && !f.open) f.open = true;
}
function runPaste(){
  pasteFoldOpen();
  var type = $('pasteType').value;
  var txt = $('pasteTxt').value;
  var logEl = $('pasteLog');
  if (!txt.trim()){ showLogLines(logEl, ['テキストを貼り付けてから押してください']); return; }
  var parsed = applyTextByType(type, txt);
  if (!parsed){
    showLogLines(logEl, ['解析方式のエラー']);
    try { var ta = $('pasteTxt'); if (ta) ta.focus(); } catch(e){}
    return;
  }
  applyParsedByType(type, parsed, logEl, false);
}

/* ---------- 初期化(テキスト貼り付けのみ) ---------- */
function initImport(){
  on('btnPaste', 'click', runPaste);
}
