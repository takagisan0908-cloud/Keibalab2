/* =========================================================
   37 馬券の点数計算・WIN5点数計算（トップページのクイックツール）
   ---------------------------------------------------------
   - ボックス / 軸流し / フォーメーション の点数と金額を計算
   - WIN5 は 5レースの選択頭数の積
   どちらも単純な算術（自己責任の参考用）。
   ========================================================= */

/* --- 組合わせ nCk / 順列 nPk --- */
function bcC(n, k){
  if (!(n >= k) || k < 0) return 0;
  var r = 1;
  for (var i = 0; i < k; i++) r *= (n - i);
  for (var i = 2; i <= k; i++) r /= i;
  return Math.round(r);
}
function bcP(n, k){
  if (!(n >= k) || k < 0) return 0;
  var r = 1;
  for (var i = 0; i < k; i++) r *= (n - i);
  return r;
}
var BC_KIND_NAME = {
  tan: '単勝', fuku: '複勝', uren: '枠連', umaren: '馬連',
  wide: 'ワイド', umatan: '馬単', sanren: '三連複', santan: '三連単'
};
var BC_MODE_NAME = { box: 'ボックス', naga: '軸流し', fo: 'フォーメーション' };

/* --- 入力欄の描画（買い方で形を変える） --- */
function bcFields(){
  var mode = $('bcMode').value;
  var kind = $('bcKind').value;
  var h = [];
  if (mode === 'box'){
    var nMax = (kind === 'tan' || kind === 'fuku') ? 18 : 12;
    h.push('<label class="small">選ぶ<b>頭数</b>: <input id="bcN1" type="number" min="1" max="' + nMax + '" value="6" style="width:70px"> 頭</label>');
    h.push('<span class="muted">（全頭同列で全通り買う＝ボックス）</span>');
  } else if (mode === 'naga'){
    if (kind === 'tan' || kind === 'fuku'){
      h.push('<label class="small">買う<b>頭数</b>（1点ずつ）: <input id="bcN1" type="number" min="1" max="18" value="3" style="width:70px"> 頭</label>');
    } else {
      h.push('<label class="small"><b>軸</b>の頭数: <input id="bcN1" type="number" min="1" max="3" value="1" style="width:60px"> 頭</label>');
      h.push('<label class="small"><b>相手</b>の頭数: <input id="bcN2" type="number" min="1" max="18" value="8" style="width:60px"> 頭</label>');
    }
  } else { // fo
    var cols = (kind === 'santan' || kind === 'sanren') ? 3 : 2;
    var lab1 = (kind === 'santan' || kind === 'sanren') ? '1着側' : '1列目';
    var lab2 = (kind === 'santan' || kind === 'sanren') ? '2着側' : '2列目';
    var lab3 = '3着側';
    h.push('<label class="small">' + lab1 + ': <input id="bcN1" type="number" min="1" max="9" value="2" style="width:55px"> 頭</label>');
    h.push('<label class="small">' + lab2 + ': <input id="bcN2" type="number" min="1" max="9" value="5" style="width:55px"> 頭</label>');
    if (cols === 3) h.push('<label class="small">' + lab3 + ': <input id="bcN3" type="number" min="1" max="9" value="8" style="width:55px"> 頭</label>');
    h.push('<span class="muted">（列ごとに違う馬で選ぶ場合の目安。重複は除いて各自ご確認ください）</span>');
  }
  return h.join('');
}

/* --- 点数計算 --- */
function bcCalc(){
  var kind = $('bcKind').value;
  var mode = $('bcMode').value;
  var yen = parseInt($('bcYen').value, 10) || 100;
  var a = parseInt(($('bcN1') || {}).value, 10) || 0;
  var b = parseInt(($('bcN2') || {}).value, 10) || 0;
  var c = parseInt(($('bcN3') || {}).value, 10) || 0;
  var pts = 0, why = '', warn = '';
  var kn = BC_KIND_NAME[kind];
  var paired = (kind === 'uren' || kind === 'umaren' || kind === 'wide');
  var single = (kind === 'tan' || kind === 'fuku');

  if (mode === 'box'){
    if (single){ pts = a; why = '買う頭数 ' + a + ' → 1点ずつ ' + pts + ' 点'; }
    else if (kind === 'umatan'){ pts = bcP(a, 2); why = a + '頭ボックス: ' + a + '×' + (a - 1) + ' = ' + pts; }
    else if (kind === 'santan'){ pts = bcP(a, 3); why = a + '頭ボックス: ' + a + '×' + (a - 1) + '×' + (a - 2) + ' = ' + pts; }
    else if (kind === 'sanren'){ pts = bcC(a, 3); why = a + '頭ボックス C(' + a + ',3) = ' + pts; }
    else { pts = bcC(a, 2); why = a + '頭ボックス C(' + a + ',2) = ' + pts; }
  } else if (mode === 'naga'){
    if (single){ pts = a; why = a + '頭 → ' + pts + ' 点'; }
    else if (kind === 'umatan'){ pts = a * b; why = '軸' + a + '頭×相手' + b + '頭 = ' + pts; }
    else if (paired){ pts = a * b; why = '軸' + a + '頭×相手' + b + '頭 = ' + pts; }
    else if (kind === 'sanren'){
      if (a === 1){ pts = bcC(b, 2); why = '1頭軸+相手' + b + '頭: C(' + b + ',2) = ' + pts; }
      else if (a === 2){ pts = b; why = '2頭軸+相手' + b + '頭 = ' + pts; }
      else { why = ''; warn = '三連複の軸は1〜2頭で入力してください。'; }
    } else { // santan
      if (a === 1){ pts = bcP(b, 2); why = '1頭軸(1着固定)+相手' + b + '頭: ' + b + '×' + (b - 1) + ' = ' + pts; }
      else if (a === 2){ pts = 2 * b; why = '2頭軸マルチ+相手' + b + '頭 = 2×' + b + ' = ' + pts; }
      else { why = ''; warn = '三連単の軸は1〜2頭で入力してください（軸3頭以上はボックスでどうぞ）。'; }
    }
  } else { // fo
    if (kind === 'umatan' || kind === 'umaren' || kind === 'wide' || kind === 'uren'){
      pts = a * b;
      why = a + '頭 × ' + b + '頭 = ' + pts;
    } else if (kind === 'santan'){
      pts = a * b * c;
      why = a + '×' + b + '×' + c + ' = ' + pts;
    } else if (kind === 'sanren'){
      why = '';
      warn = '三連複のフォーメーションは列の重複条件が複雑なため、ここでは未対応です（ボックス／軸流しで計算してください）。';
    } else {
      why = '';
      warn = kn + 'はフォーメーション対象外です（ボックス／軸流しでどうぞ）。';
    }
  }
  var el = $('bcRes');
  if (!el) return;
  if (warn){
    el.innerHTML = '<span class="small" style="color:var(--err-ink)">⚠ ' + esc(warn) + '</span>';
    return;
  }
  var money = pts * yen;
  el.innerHTML = '<div style="font-weight:800;color:var(--ok-ink)">' + esc(kn) + ' ' + esc(BC_MODE_NAME[mode]) + ' → <span style="font-size:1.2rem">' + pts.toLocaleString('ja-JP') + ' 通り</span></div>' +
    '<div class="small" style="margin-top:2px">' + esc(why || '') +
    ' ／ 金額(1点' + yen.toLocaleString('ja-JP') + '円) <b>' + money.toLocaleString('ja-JP') + '円</b></div>' +
    '<div class="small muted" style="margin-top:2px">参考: 1点100円なら ' + (pts * 100).toLocaleString('ja-JP') + '円 ／ 500円なら ' + (pts * 500).toLocaleString('ja-JP') + '円</div>';
}

/* --- WIN5 --- */
function bcWin5(){
  var v = [1, 1, 1, 1, 1];
  ['bc5a', 'bc5b', 'bc5c', 'bc5d', 'bc5e'].forEach(function(id, i){
    var x = parseInt(($(id) || {}).value, 10);
    v[i] = (!isNaN(x) && x >= 1 && x <= 18) ? x : 0;
  });
  var pts = v[0] * v[1] * v[2] * v[3] * v[4];
  var el = $('bc5Res');
  if (!el) return;
  if (v.indexOf(0) >= 0){
    el.innerHTML = '<span class="small" style="color:var(--err-ink)">⚠ 各レースの頭数を 1〜18 で入れてください。</span>';
    return;
  }
  var money = pts * 100;
  el.innerHTML = '<div style="font-weight:800;color:var(--info-ink)">' + v.join('×') + ' = <span style="font-size:1.2rem">' + pts.toLocaleString('ja-JP') + ' 通り</span>（1点100円）</div>' +
    '<div class="small">金額: <b>' + money.toLocaleString('ja-JP') + '円</b> ／ 全レースを2頭にすると 2×2×2×2×2 = 32通り = 3,200円</div>';
}

/* --- 初期化 --- */
function bcRender(){
  var box = $('bcInputs');
  if (box) box.innerHTML = bcFields();
  ['bcN1', 'bcN2', 'bcN3'].forEach(function(id){
    var el = $(id);
    if (el) el.addEventListener('input', function(){ bcCalc(); });
  });
  bcCalc(); bcWin5();
}
function initBetCalc(){
  var k = $('bcKind'), m = $('bcMode');
  if (k) k.addEventListener('change', function(){ bcRender(); });
  if (m) m.addEventListener('change', function(){ bcRender(); });
  // 数値欄は入力のたびに再計算するだけで、入力欄は作り直さない
  ['bcYen', 'bc5a', 'bc5b', 'bc5c', 'bc5d', 'bc5e'].forEach(function(id){
    var el = $(id);
    if (el) el.addEventListener('input', function(){ bcCalc(); bcWin5(); });
  });
  bcRender();
}
