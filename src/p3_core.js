/* =========================================================
   競馬AIラボ core
   ========================================================= */
'use strict';

/* ---------- utils ---------- */
function $(id){ return document.getElementById(id); }
/* 要素が無い場合は何もしない（存在しないIDで ここが例外を投げると
   boot() の途中で残りの初期化が全部止まってしまうため。#2026-09-10修正） */
var INIT_ERRORS = [];
function on(el, ev, fn){
  var t = (typeof el === 'string') ? $(el) : el;
  if (!t || typeof t.addEventListener !== 'function'){
    if (typeof el === 'string') INIT_ERRORS.push('要素なし: ' + el);
    return null;
  }
  t.addEventListener(ev, fn);
  return t;
}
/* ===== 取得テキストの文字コード自動修復（2026-09-10） =====
   古い中継(リレー)をそのまま使っていると、EUC-JP のページ(db.netkeiba.com)を
   UTF-8 として返してしまい、日本語が化けて解析が全滅する。症状は
   「出馬表は取れるのに、馬データ・全馬プロフィール・重賞データ分析・過去データが空」。
   化けを検出したら EUC-JP / Shift_JIS として読み直して復元する。 */
function nkJPCount(s){ return (String(s == null ? '' : s).match(/[\u3040-\u30ff\u3400-\u9fff\u3005\u3006]/g) || []).length; }
function nkLooksGarbled(t){
  t = String(t == null ? '' : t);
  if (t.length < 200) return false;
  var jp = nkJPCount(t);
  var hi = (t.match(/[\u0080-\u00ff\u0192\u201a\u201c\u201d\u2018\u2019\u20ac\u2122\u2026]/g) || []).length;
  return hi >= 20 && jp < hi / 4;
}
function nkRepairText(t){
  t = String(t == null ? '' : t);
  if (!nkLooksGarbled(t)) return t;
  var bytes = new Uint8Array(t.length), allLow = true;
  for (var i = 0; i < t.length; i++){ var c = t.charCodeAt(i); if (c > 255){ allLow = false; break; } bytes[i] = c; }
  if (!allLow) return t;
  var best = t, bestN = nkJPCount(t);
  ['euc-jp','shift_jis','utf-8'].forEach(function(enc){
    try {
      var c2 = new TextDecoder(enc).decode(bytes);
      if (/\uFFFD/.test(c2.slice(0, 4000))) return;
      var n = nkJPCount(c2);
      if (n > bestN){ best = c2; bestN = n; }
    } catch(e){}
  });
  return best;
}
/* ===== 中継(リレー)URLの組み立て（2026-09-10） =====
   中継URLの書き方はサービスごとに違う。次の3通りに対応する。
     1) 既定      http://host/relay + '?url=' + エンコードしたURL
     2) {url}     例 https://xxx.com/?target={url}     … エンコード済みURLを差し込む
     3) {rawurl}  例 https://cors.eu.org/{rawurl}       … URLそのものを差し込む
   （GAS / Deno Deploy / 一部の公開プロキシは 2)3) の形になる） */
function nkRelayBuild(base, target, method, body){
  base = String(base || ''); target = String(target || '');
  var url;
  if (base.indexOf('{rawurl}') >= 0) url = base.split('{rawurl}').join(target);
  else if (base.indexOf('{url}') >= 0) url = base.split('{url}').join(encodeURIComponent(target));
  else url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'url=' + encodeURIComponent(target);
  if (method && String(method).toUpperCase() !== 'GET'){
    url += '&method=' + encodeURIComponent(method) + '&body=' + encodeURIComponent(body || '');
  }
  return url;
}
/* 予備の中継（公開プロキシ）。アカウント不要で使えるが、遅い/不安定なことがある。
   自前の中継（Vercel/Cloudflare/Deno/GAS）が使えないときの緊急用。 */
function nkRelayPresets(){
  return [
    { name: '予備: cors.eu.org（公開プロキシ）', url: 'https://cors.eu.org/{rawurl}', pub: true },
    { name: '予備: allorigins（公開プロキシ）', url: 'https://api.allorigins.win/raw?url={url}', pub: true }
  ];
}
/* 文字コードの判定。中継が文字コードを変換せずに素通しすると、EUC-JP のページが
   U+FFFD だらけになる。バイト列から「置換文字が少ない読み方」を選ぶ。 */
function nkScoreDecoded(s){
  s = String(s == null ? '' : s);
  var fffd = (s.match(/\uFFFD/g) || []).length;
  return nkJPCount(s) - fffd * 3;
}
function nkDecodeBytes(buf, urlHint){
  var bytes = (buf && buf.byteLength != null) ? new Uint8Array(buf) : new Uint8Array(0);
  var hint = '';
  var u = String(urlHint || '');
  if (/db\.netkeiba\.com/.test(u)) hint = 'euc-jp';
  else if (/jra\.go\.jp/.test(u)) hint = 'shift_jis';
  var tryUtf8 = null;
  try { tryUtf8 = new TextDecoder('utf-8').decode(bytes); } catch(e){}
  if (tryUtf8 != null && (tryUtf8.match(/\uFFFD/g) || []).length < 5) return nkRepairText(tryUtf8);
  var encs = [];
  if (hint) encs.push(hint);
  ['euc-jp','shift_jis','utf-8'].forEach(function(e){ if (encs.indexOf(e) < 0) encs.push(e); });
  var best = tryUtf8, bestScore = (tryUtf8 == null) ? -Infinity : nkScoreDecoded(tryUtf8);
  encs.forEach(function(enc){
    try {
      var s = new TextDecoder(enc).decode(bytes);
      var sc = nkScoreDecoded(s);
      if (sc > bestScore){ bestScore = sc; best = s; }
    } catch(e){}
  });
  return nkRepairText(best == null ? '' : best);
}
/* fetch のレスポンスを「文字コードを直したテキスト」にする */
function nkRespText(r, urlHint){
  return r.arrayBuffer().then(function(buf){ return nkDecodeBytes(buf, urlHint); });
}
/* 「あれば配線する」版。HTMLに無いUI(旧バージョンのピッカー等)でも例外にしない */
function bindIf(id, ev, fn){
  var t = $(id);
  if (!t || typeof t.addEventListener !== 'function') return null;
  t.addEventListener(ev, fn);
  return t;
}
/* 初期化の失敗をまとめて報告（1つ失敗してもアプリ全体は動く） */
function reportInitErrors(){
  if (!INIT_ERRORS || !INIT_ERRORS.length) return;
  var uniq = [];
  INIT_ERRORS.forEach(function(x){ if (uniq.indexOf(x) < 0) uniq.push(x); });
  try { console.warn('[keiba-lab] 初期化の警告 ' + uniq.length + '件: ' + uniq.join(' / ')); } catch(e){}
  var st = (typeof $ === 'function') ? $('saveState') : null;
  if (st && st.textContent != null){
    st.textContent = String(st.textContent || '') +
      ' ⚠ 一部の初期化で警告がありました（' + uniq.length + '件・コンソール参照）: ' + uniq.slice(0,3).join(' / ');
  }
}
/* 初期化1つが失敗しても他を止めない */
function safeInit(name, fn){
  try { fn(); return true; }
  catch(e){
    INIT_ERRORS.push(name + ': ' + ((e && e.message) || e));
    try { console.warn('[keiba-lab] 初期化に失敗: ' + name, e); } catch(e2){}
    return false;
  }
}
function esc(s){ return String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function num(s){ // "12.5(1番人気)" 等から先頭数値
  var m = String(s==null?'':s).match(/[-+]?\d{1,3}(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',','.')) : null;
}
function cleanInt(v){ var n = parseInt(v,10); return isNaN(n) ? '' : String(n); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function todayStr(){ var d = new Date(); return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日'; }

/* ---------- 出遅れ率（％）は 0〜100 の範囲で扱う ----------
   2026-09-12 第15弾: 以前は入力欄が「0〜999」で、999 のような値もそのまま
   AI予想のファクター（勝率ペナルティ）へ渡っていました。出遅れ率は「割合」なので
   取り得る値は 0〜100% です。ここで一括して 0〜100 に丸めます。
   - slowPctOf(v) : 数値(0〜100)で返す。空・不正値は 0
   - slowValTxt(v): 入力欄・保存用の文字列で返す（空は空のまま＝未入力） */
function slowPctOf(v){
  if (v == null) return 0;
  var x = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (!isFinite(x) || x <= 0) return 0;
  return x > 100 ? 100 : x;
}
function slowValTxt(v){
  var s = String(v == null ? '' : v).replace(/[^0-9.]/g, '').trim();
  if (!s) return '';
  var x = slowPctOf(s);
  var r = Math.round(x * 10) / 10;                 // 小数第1位まで（12.5% など）
  return String(r);
}

/* ---------- 枠色（競馬新聞・JRA と同じ配色） ----------
   1枠=白 / 2枠=黒 / 3枠=赤 / 4枠=青 / 5枠=黄 / 6枠=緑 / 7枠=橙 / 8枠=ピンク
   FRAME_COLORS[1..8] を枠番で引く（[0] はダミー。以前は色が1つずれていた）。 */
var FRAME_COLORS = [
  '#888888',   /* 0: 未使用 */
  '#ffffff',   /* 1枠 白 */
  '#111111',   /* 2枠 黒 */
  '#e60012',   /* 3枠 赤 */
  '#1a5fb4',   /* 4枠 青 */
  '#ffd400',   /* 5枠 黄 */
  '#12a35a',   /* 6枠 緑 */
  '#f58220',   /* 7枠 橙 */
  '#f2a0c0'    /* 8枠 ピンク */
];
function frameColor(f){
  var n = parseInt(f,10);
  if (n >= 1 && n <= 8) return FRAME_COLORS[n];
  return '#7a7a7a';
}
/* 枠色の上に載せる文字色（白・黄・ピンクは暗い文字、それ以外は白文字） */
function frameTextColor(f){
  var n = parseInt(f,10);
  return (n === 1 || n === 5 || n === 8) ? '#111111' : '#ffffff';
}
/* 枠の入力欄・セルに当てるインラインスタイル（新聞と同じく枠番自体を枠色で塗る） */
function frameCellStyle(f){
  return 'background:' + frameColor(f) + ';color:' + frameTextColor(f) +
    ';border-color:rgba(0,0,0,.4);font-weight:800';
}
/* 枠番号を「新聞風のチップ」にするHTML（背景＝枠色 / 文字＝読める色） */
function frameChipHTML(f, txt){
  return '<span class="fcno" style="background:' + frameColor(f) + ';color:' + frameTextColor(f) + '">' +
    String(txt == null ? (f || '') : txt) + '</span>';
}

/* ---------- state ---------- */
var LS_KEY = 'keiba-lab-v1';
/* ★2026-09-13 第21弾⑤: 「🧠 あなたの印」を重み設定の項目から削除しました（mark は常に0）。
   印の入力欄そのものは残ります（メモ・買い目の照合・自己学習の記録として使えます）が、
   AI印の計算には一切使いません ＝ 自分の予想がAIの答えに影響して自己強化するのを止めます。
   古い保存データに mark>0 が残っていても loadFromLS で 0 に落とします。 */
function defaultWeights(){ return { odds:7, yobi:6, time:6, tenkai:7, mark:0, baba:4, yoso:5,
  abl:6,  /* ★2026-09-12 第17弾・提案3: 学習DB履歴の総合能力(過去戦の3着内率・上り順位・同距離・騎手) */
  waku:3  /* ★2026-09-13 第24弾①: 枠順（重賞のみ・⑥過去10年の歴代結果から有利枠を判定）。
             重賞以外のレースや⑥の分析データが無いときは、この重みは自動的に使われません */ }; }
function defaultRace(){
  return { name:'', place:'', baba:'', dist:'', grade:'', time:'' };
}
function defaultLearn(){
  // 結果から学んだ「展開傾向」の補正（useHist: このレースの過去結果を反映するか）
  return { useHist: true, hist: null, updated: '' };
}
function freshState(){
  return { race:defaultRace(), weights:defaultWeights(), horses: [], memo:'', savedAt:'', urlRelay:'', raceId:'', biasRaces:[],
    learn: defaultLearn(), paceOverride: null, biasOverride: '' };
}
var state = freshState();

/* ---------- 2026-09-11 第13弾: ♻️また取り直せるキャッシュの圧縮 ----------
   fflate(zlib) で圧縮し、バイナリを2byteずつUTF-16文字に詰めて localStorage に入れます
   （Base64 にすると33%増えるので使いません）。実測: 学習DB 1レース 9.8KB → 1.9KB（80.3%減）、
   馬柱キャッシュ 1レースぶん 42KB → 3KB。解凍は1件0.36ms。
   先頭に CMP_MAGIC（長さ付き）を付けるので、圧縮していない古いデータもそのまま読めます（後方互換）。 */
var CMP_MAGIC = '\u0001Z1';
var CMP_MIN = 1200;                       // これより小さい文字列は圧縮しない（効果より手間が勝つ）
var CMP_STAT = { n: 0, raw: 0, packed: 0, skip: 0, fail: 0 };
function cmpHas(){
  try { return (typeof fflate !== 'undefined' && fflate && typeof fflate.zlibSync === 'function' &&
    typeof fflate.unzlibSync === 'function' && typeof fflate.strToU8 === 'function' && typeof fflate.strFromU8 === 'function'); }
  catch(e){ return false; }
}
function cmpPack(str){
  try {
    if (typeof str !== 'string' || str.length < CMP_MIN || !cmpHas()) { CMP_STAT.skip++; return str; }
    var u8 = fflate.zlibSync(fflate.strToU8(str), { level: 9 });
    var body = '';
    for (var i = 0; i < u8.length; i += 2) body += String.fromCharCode(u8[i] | (i + 1 < u8.length ? u8[i + 1] << 8 : 0));
    var out = CMP_MAGIC + u8.length.toString(36) + ':' + body;
    if (out.length >= str.length){ CMP_STAT.skip++; return str; }   // 減らなければ生のまま
    CMP_STAT.n++; CMP_STAT.raw += str.length; CMP_STAT.packed += out.length;
    return out;
  } catch(e){ CMP_STAT.fail++; return str; }
}
function cmpUnpack(v){
  if (typeof v !== 'string' || v.indexOf(CMP_MAGIC) !== 0) return v;   // 非圧縮（古いデータ）はそのまま
  try {
    var p = v.indexOf(':', CMP_MAGIC.length);
    if (p < 0) return v;
    var n = parseInt(v.slice(CMP_MAGIC.length, p), 36);
    var bin = v.slice(p + 1);
    if (!n || !isFinite(n)) return v;
    var u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++){ var c = bin.charCodeAt(i >> 1); u8[i] = (i & 1) ? ((c >> 8) & 255) : (c & 255); }
    return fflate.strFromU8(fflate.unzlibSync(u8));
  } catch(e){ return v; }
}
/* 圧縮の効果（画面表示用） */
function cmpText(){
  if (!cmpHas()) return '<span class="muted">♻️ 圧縮は使えません（この環境に fflate がありません）</span>';
  if (!CMP_STAT.n && !CMP_STAT.skip) return '';
  var saved = (CMP_STAT.raw - CMP_STAT.packed) * 2;
  return '♻️ 圧縮: <b>' + CMP_STAT.n + ' 件</b>' +
    (CMP_STAT.n ? '（' + (CMP_STAT.raw * 2 / 1048576).toFixed(2) + 'MB → ' + (CMP_STAT.packed * 2 / 1048576).toFixed(2) + 'MB・<b>' +
      (saved / 1048576).toFixed(2) + 'MB 節約</b>' + (CMP_STAT.raw > CMP_STAT.packed ? '・' + (CMP_STAT.raw / CMP_STAT.packed).toFixed(1) + '分の1' : '') + '）' : '') +
    (CMP_STAT.fail ? '　<span style="color:var(--bad-ink,#c00)">失敗 ' + CMP_STAT.fail + ' 件</span>' : '');
}
/* ---------- 2026-09-11 第12弾: 保存の優先順位 ----------
   🥇 第一優先（学習DB・AI予想の学習）と 📌 今の作業（出馬表・メモ・馬ノート）は絶対に消さず、
   ♻️ また取り直せるキャッシュだけを大きい順に消して空きを作り、学習データを必ず保存する。
   ※ 分類は p12_urlimport.js の STORE_DESC / storeDescOf が正。ここは単体テストのように
      p12 が読み込まれていない環境でも動くように、前方一致のリストも持っている。 */
var STORE_SAFE_KEYS = ['khl_hd_v1', 'khl_bf_v1', 'khl_ped_v1', 'khl_dr_v1', 'keiba_nk_v1', 'keiba_gcl_v1',
  'keiba_tenki_v1', 'khl_kai_v2', 'khl_hist_v1', 'khl_rs_v1', 'khl_jra_v1', 'khl_jra_video_v1'];
var STORE_LIMIT = 5 * 1048576;   // 端末の保存領域の目安（5MB）
var STORE_TRIM_LOG = [];         // 自動で消した履歴（画面に出す）
function storeIsSafeKey(k){
  k = String(k);
  if (typeof storeDescOf === 'function'){ try { return storeDescOf(k)[2] === 'safe'; } catch(e){} }
  for (var i = 0; i < STORE_SAFE_KEYS.length; i++) if (k.indexOf(STORE_SAFE_KEYS[i]) === 0) return true;
  return false;
}
function storeMakeRoom(needBytes){
  var freed = 0, removed = [];
  try {
    var u = storeUse();
    var need = needBytes || 0;
    if (u.bytes + need <= STORE_LIMIT * 0.92) return { freed: 0, removed: removed, ok: true, bytes: u.bytes };
    var target = STORE_LIMIT * 0.80;          // 逼迫していたら80%まで空ける
    var cands = u.keys.filter(function(it){ return storeIsSafeKey(it.k); });
    for (var i = 0; i < cands.length; i++){
      if (u.bytes - freed + need <= target) break;
      try { localStorage.removeItem(cands[i].k); freed += cands[i].n; removed.push(cands[i].k); } catch(e){}
    }
    if (removed.length){
      STORE_TRIM_LOG.push({ at: new Date().toISOString(), freed: freed, removed: removed, need: need });
      if (STORE_TRIM_LOG.length > 20) STORE_TRIM_LOG.shift();
    }
    return { freed: freed, removed: removed, ok: (u.bytes - freed + need) <= STORE_LIMIT, bytes: u.bytes - freed };
  } catch(e){ return { freed: freed, removed: removed, ok: false, err: String((e && e.message) || e) }; }
}
/* 🥇第一優先のデータ（学習DB・AI予想）と📌今の作業は、空きを作りながら必ず保存する */
function safeSetItem(k, v){
  var val = (v == null ? '' : String(v));
  try { localStorage.setItem(k, val); return true; }
  catch(e){
    var need = (String(k).length + val.length) * 2;
    storeMakeRoom(need);
    try { localStorage.setItem(k, val); return true; } catch(e2){}
    storeMakeRoom(need * 4);                 // 学習DBは1件ずつ増えるので、まとめて空けておく
    try { localStorage.setItem(k, val); return true; } catch(e3){
      try {
        if (typeof storeMsg === 'function')
          storeMsg('⚠️ 端末の保存領域がいっぱいで、<b>' + (typeof storeDescOf === 'function' ? esc(storeDescOf(k)[1]) : esc(String(k))) +
            '</b> を保存できませんでした。♻️また取り直せるキャッシュは自動で削除しましたが足りません。' +
            '①の「💾 使用量を確認」で状況を確認してください。', true);
      } catch(e4){}
      return false;
    }
  }
}
/* 自動整理の履歴（画面用） */
function storeTrimText(){
  if (!STORE_TRIM_LOG.length) return '';
  var n = 0, tot = 0;
  STORE_TRIM_LOG.forEach(function(x){ n += x.removed.length; tot += x.freed; });
  return '<br><span class="small">♻️ 保存領域が足りなくなったとき、<b>また取り直せるキャッシュを ' + n + ' 件（' +
    (tot / 1048576).toFixed(2) + 'MB）自動で削除</b>して、🥇学習DB・AI予想の保存を優先しました。</span>';
}
/* ---------- 永続化(同一URL内) ---------- */
function saveNow(){
  try {
    state.savedAt = new Date().toISOString();
    safeSetItem(LS_KEY, JSON.stringify(state));   /* 📌今の作業＝出馬表そのもの。足りなければ♻️キャッシュを自動で消して保存 */
    var s = $('saveState'); if (s) s.textContent = '✓ 保存 ' + state.savedAt.slice(5,16).replace('T',' ');
    /* ★2026-09-13 第25弾④: 出遅れ率・予想印などの入力を「📋読み込み履歴」のスナップショットにも反映。
       入力のたびに履歴全体を書き直すと重いので、kaiTouchHist() 側で 900ms 防抖しています。 */
    try { if (typeof kaiTouchHist === 'function') kaiTouchHist(); } catch(e){}
  } catch(e){ /* 容量超過等は無視 */ }
}
function loadFromLS(){
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    var o = JSON.parse(raw);
    if (o && Array.isArray(o.horses)) {
      state = Object.assign(freshState(), o);
      state.race = Object.assign(defaultRace(), o.race || {});
      state.weights = Object.assign(defaultWeights(), o.weights || {});
      state.weights.mark = 0;   // ★第21弾⑤: あなたの印はAI計算から完全に外す（古い保存データの上書き）
      state.learn = Object.assign(defaultLearn(), o.learn || {});
      if (o.paceOverride == null) state.paceOverride = null;
      // 古い保存データの馬に新項目(slow等)を補う＋出遅れ率を0〜100%へ丸め直す
      state.horses = state.horses.map(function(h){
        if (h && h.slow == null) h = Object.assign({}, h, { slow: '', last3f: '', last3raw: '', prevD: '' });
        if (h && h.slow != null){
          var st = slowValTxt(h.slow);
          if (st !== String(h.slow)) h = Object.assign({}, h, { slow: st });
        }
        return h;
      });
      return true;
    }
  } catch(e){}
  return false;
}

/* ---------- 馬モデル ---------- */
var _uid = 1;
/* ★2026-09-13 第19弾③: 出馬表を出し直したときに「上3F・持ちタイムが抜ける」原因の1つが、
   ここに項目が登録されていなかったこと（last3rank＝上3Fのレース内順位／timeSrc＝持ちタイムの出どころ／
   ninki＝人気）。保存(saveNow)・復元(loadFromLS)・入れ替え(applyNkHorses)のすべてが
   このモデルを通るため、派生項目は必ずここで定義します。 */
function mkHorse(p){
  p = p || {};
  return {
    uid: p.uid || _uid++,
    frame: p.frame || '', no: p.no || '', name: p.name || '',
    sexAge: p.sexAge || '', weight: p.weight || '', jockey: p.jockey || '',
    odds: p.odds || '', style: p.style || '', mark: p.mark || '',
    yobi: p.yobi || '', time: p.time || '', nk: p.nk || '',
    slow: (p.slow != null ? slowValTxt(p.slow) : ''), last3f: p.last3f || '', last3raw: p.last3raw || '',
    prevD: p.prevD || '',
    /* --- 第19弾③で追加した派生項目（消えると表示・評価が落ちる） --- */
    last3rank: (parseInt(p.last3rank, 10) || 0),   // 前走上り3Fのレース内順位(1=最速) → 出馬表の色分けに使用
    timeSrc: p.timeSrc || '',                      // 持ちタイムの出どころ: prev / same-venue / same-course / same-dist
    ninki: p.ninki || '',                          // netkeiba オッズAPI が返す人気順
    /* --- ★2026-09-13 第21弾③: 「前走」と「持ちタイム」を別々に持つ ---
       prevD は【h.time(持ちタイム) が何m の時計か】を表す値で、前走の距離とは限りません
       （前走が距離違いだと「同じコース種別の同距離最速タイム」を採用するため）。
       ここを取り違えて「前走距離」として表示していたのが第21弾③の修正対象です。
       本当の前走情報は下の prevM / prevDate8 / prevVenue / prevR / prevOrder / prevSurf に入ります。 */
    prevM: (parseInt(p.prevM, 10) || 0),           // 前走の距離(m)
    prevDate8: p.prevDate8 || '',                  // 前走の日付(YYYYMMDD)
    prevVenue: p.prevVenue || '',                  // 前走の競馬場
    prevR: p.prevR || '',                          // 前走のレース番号
    prevOrder: (parseInt(p.prevOrder, 10) || 0),   // 前走の着順
    prevSurf: p.prevSurf || '',                    // 前走のコース(芝/ダ/障)
    prevBaba: p.prevBaba || '',                    // 前走の馬場状態(良/稍重/重/不良)
    styleSrc: p.styleSrc || '',                    // 脚質の出どころ: manual / histdb / ai
    styleConf: (parseInt(p.styleConf, 10) || 0),   // 脚質AI推定の確信度(%)
    slowSrc: p.slowSrc || '', slowTouched: !!p.slowTouched,
    slowAll: (parseInt(p.slowAll, 10) || 0), slowN: (parseInt(p.slowN, 10) || 0), slowI: (parseInt(p.slowI, 10) || 0),
    ped: Array.isArray(p.ped) ? p.ped.slice() : []
  };
}

/* ---------- サンプル18頭 (有馬記念風・あくまでデモ) ---------- */
function demoHorses(){
  var rows = [
    [1,1,'ドウデュース','牡5','58','武豊','4.2','先','◎','6F 83.2-5F 68.8-4F 53.9-3F 38.4','2:24.1'],
    [1,2,'ウシュバテソーロ','牡8','58','川田将雅','9.8','先行','○','6F 83.9-5F 69.3-4F 54.3-3F 38.7','2:26.0'],
    [2,3,'シャフリヤール','牡7','58','クリストフルメール','7.1','差し','▲','6F 84.0-5F 69.4-4F 54.4-3F 38.9','2:25.6'],
    [2,4,'イクイノックス','牡5','58','C.ルメール','2.1','差し','◎','6F 82.9-5F 68.6-4F 53.7-3F 38.2','2:23.8'],
    [3,5,'タイトルホルダー','牡6','58','横山武史','3.5','逃げ','○','6F 83.0-5F 68.9-4F 54.0-3F 38.5','2:24.4'],
    [3,6,'リバティアイランド','牝4','55','川田将雅','5.6','先行','◎','6F 83.4-5F 69.0-4F 54.1-3F 38.6','2:25.0'],
    [4,7,'タスティエーラ','牡4','58','石川裕紀人','14.2','差し','▲','6F 84.2-5F 69.5-4F 54.6-3F 39.1','2:25.8'],
    [4,8,'ソールオリエンス','牡5','58','松山弘平','10.5','差し','△','6F 84.1-5F 69.6-4F 54.7-3F 39.2','2:26.4'],
    [5,9,'ジャスティンパレス','牡6','58','三浦皇成','18.0','差し','','6F 84.5-5F 70.0-4F 55.0-3F 39.4','2:26.9'],
    [5,10,'ステラヴェローチェ','牡7','58','坂井瑠星','30.5','追込','','6F 84.8-5F 70.2-4F 55.1-3F 39.5','2:27.4'],
    [6,11,'パンサラッサ','牡10','58','M.デムーロ','26.0','逃げ','☆','6F 83.3-5F 69.1-4F 54.2-3F 38.8','2:24.9'],
    [6,12,'レモンポップ','牡8','57','藤岡佑介','32.0','先行','','6F 85.0-5F 70.3-4F 55.1-3F 39.6','2:27.8'],
    [7,13,'エフフォーリア','牡8','58','蛯名正義','42.0','先行','','6F 85.2-5F 70.5-4F 55.3-3F 39.8','2:28.1'],
    [7,14,'キタサンブラック','牡13','59','藤田晋','80.0','差し','','6F 85.8-5F 71.0-4F 55.6-3F 40.1','2:29.0'],
    [8,15,'アーモンドアイ','牝8','57','C.スミヨン','55.0','追込','','6F 85.5-5F 70.8-4F 55.5-3F 40.0','2:28.7'],
    [8,16,'ブエナビスタ','牝12','56','北村宏司','68.0','追込','','6F 85.6-5F 70.9-4F 55.5-3F 40.0','2:29.3'],
    [9,17,'ディープインパクト','牡15','60','岩田康誠','90.0','差し','','6F 86.0-5F 71.2-4F 55.8-3F 40.3','2:29.9'],
    [9,18,'オルフェーヴル','牡14','58','池添謙一','95.0','追込','','6F 86.2-5F 71.4-4F 55.9-3F 40.4','2:30.2']
  ];
  return rows.map(function(r){
    return mkHorse({ frame:String(r[0]), no:String(r[1]), name:r[2], sexAge:r[3], weight:r[4], jockey:r[5], odds:String(r[6]), style:r[7], mark:r[8], yobi:r[9], time:r[10] });
  });
}
