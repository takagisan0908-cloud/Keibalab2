/* =========================================================
   入力タブ：出馬表グリッドの描画とイベント
   ========================================================= */
var STYLE_OPTS = ['逃げ','先行','差し','追込','自在先行','自在'];
var MARK_OPTS  = ['◎','○','▲','△','☆','×'];

function selopts(list, cur, blankLabel){
  var s = '<option value="">' + (blankLabel || '') + '</option>';
  list.forEach(function(o){
    s += '<option' + (cur === o ? ' selected' : '') + '>' + o + '</option>';
  });
  return s;
}
function v(x){ return esc(x == null ? '' : x); }

function findHorseByUid(uid){
  for (var i=0;i<state.horses.length;i++) if (state.horses[i].uid == uid) return state.horses[i];
  return null;
}
function buildHorseRowHTML(h, i){
  // 第16弾: 騎手成績・乗り替わり・○ヶ月休養・鉄砲・2走目（馬柱の戦績から計算。未取得なら空）
  var jlay = '', jlayJ = '';
  if (typeof jlInfoFor === 'function'){
    try {
      var ji = jlInfoFor(h, (typeof jlRaceD8 === 'function' ? jlRaceD8() : ''), null);
      jlay = (typeof jlHTML === 'function') ? jlHTML(ji) : '';
      jlayJ = (typeof jlJockeyHTML === 'function') ? jlJockeyHTML(ji, !(ji && ji.noRecs)) : '';
    } catch(e){}
  }
  return '<tr data-uid="' + h.uid + '">' +
    '<td class="muted">' + (i+1) + '</td>' +
    '<td><span style="display:flex;gap:3px;align-items:center;justify-content:center">' +
      '<span class="fc" style="background:' + frameColor(h.frame) + '"></span>' +
      '<input data-f="frame" class="sm" style="' + frameCellStyle(h.frame) + '" value="' + v(h.frame) + '" maxlength="1" title="枠番（1枠=白 2枠=黒 3枠=赤 4枠=青 5枠=黄 6枠=緑 7枠=橙 8枠=ピンク）"></span></td>' +
    '<td><input data-f="no" class="sm" value="' + v(h.no) + '" maxlength="2" title="馬番"></td>' +
    '<td style="white-space:nowrap"><span style="display:inline-flex;gap:3px;align-items:center">' +
      '<input data-f="name" class="nm" value="' + v(h.name) + '" title="馬名">' +
      (typeof hbBadgeHTML === 'function' ? hbBadgeHTML(h) : '') +
      (typeof tlBadgeHTML === 'function' ? tlBadgeHTML(h) : '') +
      '</span>' +
      '<div class="aih-note" data-aih="' + h.uid + '" style="font-size:9px;line-height:1.2;color:var(--acc-ink);max-width:132px;white-space:normal"></div></td>' +
    '<td><input data-f="sexAge" class="sm" value="' + v(h.sexAge) + '" title="性齢 例: 牡5"></td>' +
    '<td><input data-f="weight" class="sm" value="' + v(h.weight) + '" title="斤量 例: 58"></td>' +
    /* ★2026-09-13 第26弾④: 騎手名をタップすると 🏇騎手・調教師DB の詳細が開きます。
       「いつでもDB上にアクセスしやすいように」というご依頼に対応。
       入力欄そのものは編集用にそのまま残し、右に 🏇 ボタンを付けました。
       調教師名（trainer）が別途ある場合は 🏇 を2つ出します。 */
    '<td><span style="display:inline-flex;align-items:center;gap:2px">' +
      '<input data-f="jockey" value="' + v(h.jockey) + '" style="min-width:78px" title="騎手">' +
      (v(h.jockey) ? '<button type="button" class="btn small ghost jdbopen" data-kind="jockey" ' +
        'data-nm="' + esc(v(h.jockey)) + '" title="🏇 騎手DBを開く: ' + esc(v(h.jockey)) + '" ' +
        'style="padding:0 4px;line-height:1.4;font-size:11px;flex:none">🏇</button>' : '') +
      (v(h.trainer) ? '<button type="button" class="btn small ghost jdbopen" data-kind="trainer" ' +
        'data-nm="' + esc(v(h.trainer)) + '" title="🏇 調教師DBを開く: ' + esc(v(h.trainer)) + '" ' +
        'style="padding:0 4px;line-height:1.4;font-size:11px;flex:none">🏠</button>' : '') +
    '</span>' + jlayJ + '</td>' +
    '<td class="jlcell">' + jlay + '</td>' +
    '<td><input data-f="odds" class="sm" value="' + v(h.odds) + '" placeholder="4.5" title="単勝オッズ"></td>' +
    '<td><select data-f="style" title="脚質">' + selopts(STYLE_OPTS, h.style, '不明') + '</select></td>' +
    '<td><select data-f="mark" title="あなたの印(参考材料)">' + selopts(MARK_OPTS, h.mark, '−') + '</select></td>' +
    '<td><span style="display:inline-flex;gap:2px;align-items:center">' +
      '<input data-f="slow" inputmode="numeric" class="sm" maxlength="3" value="' + v(h.slow) + '" placeholder="10" title="出遅れ率(％・0〜100)。' +
        ((h.slowSrc && h.slowAll) ? ('netkeiba過去' + h.slowAll + '走から自動計算（明示' + (h.slowN||0) + '回・推定' + (h.slowI||0) + '回）。') : '') +
        '手入力も可。100を超える値は100に丸めます（出遅れ率は割合なので0〜100%です）。数字が大きい馬は逃げ・先行型ほど評価が下がります">' +
      (h.slowSrc && !h.slowTouched && h.slowAll ? '<span class="chip" style="padding:0 3px;font-size:9px;line-height:14px;color:var(--warn-ink);background:var(--card2);border:1px solid var(--line2)" title="出遅れ率を netkeiba の過去レースから自動計算しました（編集すると手動設定になります）">⚡自動</span>' : '') +
      '</span></td>' +
    '<td><input data-f="yobi" value="' + v(h.yobi) + '" style="min-width:148px" placeholder="6F 83.5-5F 69.1-3F 38.9" title="最終追い切り等の調教ラップ"></td>' +
    '<td>' +
      // 持ちタイム欄: 「上3F(netkeibaで取得した前走上がり3F=1位黄/2位青/3位ピンク)」を主データとして先頭に表示。
      // 下の入力欄には「今回と同距離±200mの前走タイム」を自動反映する(手入力も可)
      ((typeof nkGridLast3HTML === 'function' && h.last3f) ? nkGridLast3HTML(h) : '') +
      '<input data-f="time" value="' + v(h.time) + '" style="min-width:60px" placeholder="' + (h.last3f ? '' : '1:59.9') + '" title="持ちタイム(前走タイム): 今回と同距離または±200mの前走レースタイムを自動反映。手入力も可">' +
      (h.time && h.prevD ? '<div style="font-size:9px;color:var(--ok-ink);line-height:1.15;white-space:nowrap" title="前走タイムの距離">前走 ' + v(h.prevD) + 'm</div>' : '') +
    '</td>' +
    '<td><span style="display:inline-flex;gap:4px;align-items:center;white-space:nowrap">' +
      (typeof nkHorseModal === 'function' ? '<button type="button" class="pedbtn" title="netkeibaから馬プロフィールと直近5走の馬柱を表示（上り3Fはレース内順位で色分け: 1位黄/2位青/3位ピンク）">🐎馬情報</button>' : '') +
      '<button class="rowdel" title="この馬を削除">✕</button>' +
      '</span></td></tr>' +
    buildSubRowHTML(h);
}
function buildSubRowHTML(h){
  // 馬柱はポップアップ表示(nkHorseModal: netkeiba馬データ)へ変更したため、行内の開閉サブ行には残さない。
  // （追加のサブ表示が必要になった場合はここへ）
  return '';
}

function countAndSave(){
  var n = state.horses.length;
  var chip = $('horseCount');
  if (chip){
    chip.textContent = n + ' / 18頭';
    chip.className = 'chip' + (n === 0 ? ' warn' : '');
  }
  var add = $('btnAddHorse');
  if (add) add.disabled = (n >= 18);
  saveNow();
}

function rebuildHorseTable(){
  var tb = $('horseBody');
  if (!tb) return;
  /* ★2026-09-13 第19弾③: 出馬表を出力するたびに、端末に貯まっている馬柱キャッシュから
     上3F・持ちタイムを自動で埋め直す（新規通信なし／既に両方入っている馬は何もしない）。
     読み込み直した直後に空欄になっていたものが、ここで復活します。 */
  try { if (typeof nkAutoFill === 'function') nkAutoFill(); } catch(e){}
  tb.innerHTML = state.horses.map(buildHorseRowHTML).join('');
  countAndSave();
  updateGridHints();
  // 出馬表の出力段階で、馬柱AI評価（芝/ダ実績・替わり適正・得意条件）を自動入力する
  if (typeof aihAutoRun === 'function'){ try { aihAutoRun(); } catch(e){} }
  // 出馬表取得のたびに「前走の勝ちタイムのレベル」を評価し直す（🎯/⚠️バッジ・②の表に反映）
  if (typeof tlScanAll === 'function'){
    try { tlScanAll(true); if (typeof tlRender === 'function') tlRender(); } catch(e){}
  }
}
function updateGridHints(){
  var tip = $('raceHint');
  if (tip) tip.style.display = (!readRaceMeta().dist && state.horses.some(function(h){ return h.time; })) ? '' : 'none';
  if ($('kentaiEmpty')) $('kentaiEmpty').style.display = state.horses.length ? 'none' : '';
}

function addHorseRow(h){
  if (state.horses.length >= 18) return null;
  if (!h) h = mkHorse();
  state.horses.push(h);
  return h;
}
function appendOneHorseAuto(){
  var used = {};
  state.horses.forEach(function(h){ if (h.no) used[h.no] = true; });
  var no = '';
  for (var i=1;i<=18;i++){ if (!used[i]) { no = String(i); break; } }
  var h = mkHorse({ no: no });
  state.horses.push(h);
  rebuildHorseTable();
}

/* 馬番でupsert(取込時に使用)。戻り値: 対象の馬 index または新規追加なら index */
function upsertByNo(no, patch){
  no = cleanInt(no);
  var idx = -1;
  state.horses.forEach(function(h, i){ if (h.no === no) idx = i; });
  if (idx >= 0){
    Object.keys(patch).forEach(function(k){
      var val = patch[k];
      if (val !== undefined && val !== null && String(val) !== '') state.horses[idx][k] = val;
    });
    return idx;
  }
  if (state.horses.length >= 18) return -1;
  var h = mkHorse(Object.assign({ no: no }, patch));
  state.horses.push(h);
  return state.horses.length - 1;
}

/* ---------- 初期表示用に DOM → state(再読み込み時に state → DOM) ---------- */
function syncRaceDomFromState(){
  ['rName','rPlace','rBaba','rDist','rClass','rTime','rCushion'].forEach(function(id){
    var key = {rName:'name',rPlace:'place',rBaba:'baba',rDist:'dist',rClass:'grade',rTime:'time',rCushion:'cushion'}[id];
    var el = $(id); if (el) el.value = state.race[key] || '';
  });
}
function raceInputChanged(){
  var map = {rName:'name',rPlace:'place',rBaba:'baba',rDist:'dist',rClass:'grade',rTime:'time',rCushion:'cushion'};
  ['rName','rPlace','rBaba','rDist','rClass','rTime','rCushion'].forEach(function(id){
    var el = $(id);
    if (el) state.race[map[id]] = el.value.trim();
  });
  refreshRaceLine();
  saveNow();
}
function refreshRaceLine(){
  var rm = readRaceMeta();
  var el = $('raceHeaderLine');
  if (el){
    var parts = [];
    if (rm.name) parts.push(rm.name);
    if (rm.place) parts.push(rm.place);
    var babaL = { fast:'良', good:'稍重', yield:'重', soft:'不良', dirt_fast:'ダート良', dirt_seal:'ダート重' }[rm.baba] || '';
    if (rm.dist) parts.push(rm.dist + 'm');
    if (babaL) parts.push(babaL);
    if (rm.cushion) parts.push('クッション' + rm.cushion);
    if (rm.grade) parts.push(rm.grade);
    el.textContent = parts.length ? '対象レース: ' + parts.join(' / ') : '';
  }
  updateGridHints();
  if (typeof renderCourseInfo === 'function') renderCourseInfo();
}

/* ---------- イベント登録 ---------- */
function initInputTab(){
  var tb = $('horseBody');
  on(tb, 'click', function(e){
    var t = e.target;
    /* ★2026-09-13 第26弾④: 🏇ボタン（騎手名/調教師名の隣）→ 騎手・調教師DBの詳細を開く。
       DBタブに移動して、その場で検索・表示します。未取得なら取得してから表示。 */
    var jb = t && t.closest ? t.closest('.jdbopen') : null;
    if (jb){
      e.preventDefault(); e.stopPropagation();
      var nm = String(jb.getAttribute('data-nm') || '').trim();
      var kd = String(jb.getAttribute('data-kind') || 'jockey');
      if (!nm) return;
      try {
        if (typeof jdbOpenByName === 'function') jdbOpenByName(nm, kd);
        else if (typeof goTab === 'function') goTab('t-jockeydb');
      } catch(err){}
      return;
    }
    if (t && t.className === 'pedbtn'){
      var tr = t.closest('tr'); if (!tr) return;
      var uid = tr.getAttribute('data-uid');
      var h = findHorseByUid(uid);
      if (typeof nkHorseModal === 'function') nkHorseModal(h);
      return;
    }
  });
  on(tb, 'input', function(e){
    var el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return;
    var tr = el.closest('tr'); if (!tr) return;
    var h = findHorseByUid(tr.dataset.uid); var f = el.dataset.f;
    if (!h || !f) return;
    h[f] = el.value;
    if (f === 'time' && !el.value.trim()) h.prevD = '';  // 手入力でクリアしたら持ちタイムの距離メモも消す
    /* ★2026-09-13 第21弾②: 脚質を手で入力したら「手動」として印を付ける。
       🧠脚質のAI推定（自動マクロ）は手動入力を絶対に上書きしません。 */
    if (f === 'style'){ h.styleSrc = el.value.trim() ? 'manual' : ''; }
    if (f === 'slow'){
      // 出遅れ率は 0〜100% の範囲（#2026-09-12 第15弾・旧「0〜999」を廃止）。
      // 入力中は「数字と . 以外を落とす／100を超えたら100に丸める」だけにして、
      // 「12.」のように打っている途中の文字は消さない（保存値は必ず0〜100に正規化）。
      var raw = String(el.value).replace(/[^0-9.]/g, '');
      if (raw !== String(el.value)) el.value = raw;
      var xp = parseFloat(raw);
      if (isFinite(xp) && xp > 100) el.value = '100';
      h.slow = slowValTxt(el.value);
      h.slowTouched = true; h.slowSrc = '';               // 出遅れ率は手入力優先(以後の自動上書きをやめる)
    }
    if (f === 'frame'){
      var dot = tr.querySelector('.fc');
      if (dot) dot.style.background = frameColor(el.value);      // 枠色ドット
      var cs = frameCellStyle(el.value);                          // 枠番の入力欄も同じ枠色に
      cs.split(';').forEach(function(kv){
        var p2 = kv.split(':'); if (p2.length === 2) el.style[p2[0].trim()] = p2.slice(1).join(':').trim();
      });
    }
    saveNow();
  });
  on(tb, 'change', function(e){
    // 出遅れ率はフォーカスが外れたときに 0〜100% の表示へ確定させる
    var el2 = e.target;
    if (el2 && el2.tagName === 'INPUT' && el2.dataset && el2.dataset.f === 'slow'){
      var tr2 = el2.closest && el2.closest('tr');
      var h2 = tr2 ? findHorseByUid(tr2.dataset.uid) : null;
      var sv2 = slowValTxt(el2.value);
      if (sv2 !== String(el2.value)) el2.value = sv2;
      if (h2){ h2.slow = sv2; h2.slowTouched = true; h2.slowSrc = ''; }
    }
    countAndSave(); updateGridHints();
  });

  on(tb, 'click', function(e){
    var btn = e.target.closest('.rowdel');
    if (!btn) return;
    var tr = btn.closest('tr'); if (!tr) return;
    var uid = parseInt(tr.dataset.uid, 10);
    state.horses = state.horses.filter(function(h){ return h.uid !== uid; });
    rebuildHorseTable();
  });

  var cbx = $('courseBox');
  if (cbx){
    cbx.addEventListener('click', function(e){
      var b = e.target && e.target.closest && e.target.closest('[data-cs]');
      if (!b) return;
      if (typeof courseSetSurf === 'function') courseSetSurf(b.getAttribute('data-cs'));
    });
  }
  on('btnAddHorse', 'click', appendOneHorseAuto);
  on('btnSort', 'click', function(){
    state.horses.sort(function(a,b){
      var na = parseInt(a.no,10), nb = parseInt(b.no,10);
      if (isNaN(na) && isNaN(nb)) return 0;
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
    rebuildHorseTable();
  });
  on('btnClear', 'click', function(){
    showConfirm('全' + state.horses.length + '頭の馬データを削除しますか？', function(){ state.horses = []; rebuildHorseTable(); });
  });
  on('btnDemo', 'click', function(){
    showConfirm('現在のデータを「サンプル18頭」に入れ替えます。よろしいですか？', function(){
      state.horses = demoHorses();
      Object.assign(state.race, { name:'サンプル: 有馬記念風', place:'中山11R 芝2500m', baba:'fast', dist:'2500', grade:'G1' });
      syncRaceDomFromState(); refreshRaceLine();
      rebuildHorseTable();
      goTab('t-input');
    });
  });

  ['rName','rPlace','rBaba','rDist','rClass','rTime','rCushion'].forEach(function(id){
    on(id, 'input', raceInputChanged);
  });
}
