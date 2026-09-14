/* =========================================================
   36 ⑥ 重賞データ分析（navi-keiba風・同名レース 過去10年）
   ---------------------------------------------------------
   いま読み込んでいる重賞(G1〜G3)と同じレース名の過去10回分について、
   出馬馬・結果(全着順)と「出走各馬の個別データ(前走・血統・生産者・
   生月・キャリア等)」を netkeiba から取得し、
   「馬券内(3着以内)に当てはまりそうな共通点」を多数の表で集計表示。
   - データはすべて netkeiba から（中継リレー経由）
   - 初回は1〜3分程度（進行表示あり）。結果は端末キャッシュ(khl_dr_v1)
     に保存し、2回目以降は同じレースは即時表示
   - 対象外: 非重賞レース / 馬IDが付かない時代の古い着順
   ========================================================= */
var DR_LS = 'khl_dr_v1';
var DR_LIMIT_YEARS = 10;               // 同名レースの直近10回
function drLs(){
  try { var o = JSON.parse(cmpUnpack(localStorage.getItem(DR_LS)) || '{}'); if (!o || typeof o !== 'object') return {}; return o; }
  catch(e){ return {}; }
}
/* drSave: 並列実行でも書き込みを失わないよう常に最新ストアへマージ保存 */
function drSave(o){
  try {
    var cur = {};
    try { cur = JSON.parse(cmpUnpack(localStorage.getItem(DR_LS)) || '{}') || {}; } catch(e){ cur = {}; }
    if (!cur.races) cur.races = {}; if (!cur.horse) cur.horse = {};
    if (!cur.prevRank) cur.prevRank = {}; if (!cur.prevDay) cur.prevDay = {};
    if (!cur.seek) cur.seek = {};
    if (o.races) Object.assign(cur.races, o.races);
    if (o.horse) Object.assign(cur.horse, o.horse);
    if (o.prevRank) Object.assign(cur.prevRank, o.prevRank);
    if (o.prevDay) Object.assign(cur.prevDay, o.prevDay);
    if (o.seek) Object.assign(cur.seek, o.seek);
    if (o.last) cur.last = o.last;
    localStorage.setItem(DR_LS, cmpPack(JSON.stringify(cur)));
  } catch(e){}
}
function drCl(s){ return String(s == null ? '' : s).replace(/[\s\u3000]/g, ''); }
function drNum(s){
  var m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function drD8(s){ // '2020/08/23' or '20200823' → '2020/08/23'
  var x = String(s || '').trim();
  if (/^\d{8}$/.test(x)) return x.slice(0,4) + '/' + x.slice(4,6) + '/' + x.slice(6,8);
  var m = x.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2) : '';
}
function drGet(url){
  if (typeof bfGet === 'function') return bfGet(url);
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  if (typeof kaiFetchAny === 'function') return kaiFetchAny(url);
  if (typeof nkFetchTimeout === 'function') return nkFetchTimeout(url, 25000);
  return Promise.reject(new Error('中継(リレー)が未設定です'));
}
var DR_RETRY_MS = 800;   // 取得失敗時のリトライ間隔（1回目=800ms, 2回目=1600ms）
function drWait(ms){ return new Promise(function(r){ setTimeout(r, ms || 0); }); }
/* 中継が返しがちな「エラーページ/空応答」の判定。
   0件(該当なし)と通信失敗を区別しないと、通信エラーが「レースが見つかりません」に化ける。 */
function drBadPage(html){
  var s = String(html == null ? '' : html);
  if (!s || s.length < 300) return '応答が空（' + s.length + 'B）';
  var head = s.slice(0, 4000);
  var m = head.match(/upstream HTTP \d+|Too Many Requests|403 Forbidden|404 Not Found|Access Denied|Bad Gateway|Service Unavailable|Gateway Time-?out/i);
  if (m) return 'エラーページ（' + m[0] + '）';
  if (/^\s*(bad url|fetch error[:\s])/i.test(s)) return '中継エラー（' + s.slice(0, 60).replace(/\s+/g, ' ') + '）';
  return '';
}
/* 取得（失敗時は少し待って再試行）。中継の 429/502 で「0件」に化けさせないための共通経路。 */
function drGetRetry(url, tries, progress){
  var n = 0;
  tries = Math.max(1, tries || 3);
  function attempt(){
    n++;
    return drGet(url).then(function(html){
      var bad = drBadPage(html);
      if (bad) throw new Error(bad);
      return String(html);
    }).catch(function(e){
      var msg = (e && e.message) || String(e);
      if (n < tries){
        if (progress) progress('⚠ 取得失敗（' + msg + '）→ ' + (n + 1) + '/' + tries + ' 回目を再試行中…');
        return drWait(DR_RETRY_MS * n).then(attempt);
      }
      throw new Error(msg);
    });
  }
  return attempt();
}
function drVenueName(v){
  for (var i = 0; i < HD_VENUES.length; i++){ if ((v || '').indexOf(HD_VENUES[i]) >= 0) return HD_VENUES[i]; }
  return '';
}
function drVenueCode(name){
  var i = HD_VENUES.indexOf(name); return i < 0 ? '' : ('0' + (i + 1)).slice(-2);
}
function drGrade(){
  try {
    var g = (state && state.race && state.race.grade) || '';
    if (g === 'G1' || g === 'G2' || g === 'G3') return g;
    if (typeof bfGrade === 'function'){ var g2 = bfGrade(); if (g2) return g2; }
    var nm = (state && state.race && state.race.name) || '';
    var m = String(nm).match(/\((G[123])\)/);
    return m ? m[1] : '';
  } catch(e){ return ''; }
}
function drDateStr(d8){ // 'YYYYMMDD' → 'YYYY/MM/DD'
  return d8.slice(0,4) + '/' + d8.slice(4,6) + '/' + d8.slice(6,8);
}

/* DB結果ページの「騎手名→騎手ID」を取り出す（結果テーブルの jockey/result/recent/<id> リンク） */
function drParseRiderIds(html){
  var m = {};
  var re = /db\.netkeiba\.com\/jockey\/result\/recent\/(\d{5,})\/"[^>]*>([\s\S]{0,24}?)<\/a>/g, x;
  while ((x = re.exec(String(html))) !== null){
    var nm = bfStrip(x[2]);
    if (nm && m[nm] == null) m[nm] = x[1];
  }
  return m;
}
/* ---------- キャッシュ付き: 過去レースの全着順 ---------- */
function drFetchRace(rid, progress){
  var ls = drLs();
  if (ls.races && ls.races[rid] && ls.races[rid].rows) return Promise.resolve(ls.races[rid]);
  return drGetRetry('https://db.netkeiba.com/race/' + rid + '/', 3, progress).then(function(html){
    var pr = bfParseDbResult(html);
    if (!pr.rows || !pr.rows.length) throw new Error('結果を解析できません: ' + rid);
    var rec = { meta: pr.meta, rows: pr.rows, jids: drParseRiderIds(html), at: Date.now() };
    ls.races = ls.races || {}; ls.races[rid] = rec;
    drSave(ls);
    return rec;
  });
}
/* ---------- 馬1頭の個別データ(前走・血統・生産者・生月・キャリア) ---------- */
function drTrim(recs){
  var arr = [];
  (recs || []).forEach(function(r){
    if (!r || !r.date) return;
    var wm = String(r.wchg || '').replace(/[()（）]/g, ' ').split(/\s+/).filter(Boolean);
    var w = drNum(wm[0]);          // 体重本体
    var wd = drNum(wm[1]);         // 増減
    arr.push({ d: drD8(r.date), v: r.venue || '', r: String(r.r || ''), nm: r.name || '',
      od: (r.order || 0), pop: drNum(r.pop), l3: drNum(r.last3), pass: r.pass || '',
      w: w, wd: wd, dist: r.dist || '' });
  });
  return arr;
}
function drFetchHorse(id){
  var ls = drLs();
  if (ls.horse && ls.horse[id]) return Promise.resolve(ls.horse[id]);
  var p1 = drGet('https://db.netkeiba.com/horse/' + id + '/');
  var p2 = drGet('https://db.netkeiba.com/horse/result/' + id + '/');
  return Promise.all([p1, p2]).then(function(rs){
    var prof = hdParseProfile(rs[0]);
    var recs = hdParseRecords(rs[1]);
    var month = 0, prod = '', tr = '';
    var birth = drCl(hdP(prof, ['生年月日', '生年月日']));
    var bm = String(birth).match(/(\d{1,2})月/);
    if (bm) month = parseInt(bm[1], 10);
    prod = hdP(prof, ['生産者']);
    tr = hdP(prof, ['調教師']);
    var pedi = null;
    try { if (typeof pgFetchHorse === 'function'){ pedi = null; } } catch(e){}
    var rec = { id: id, month: month, prod: prod, tr: tr, races: drTrim(recs), at: Date.now(), pedi: null };
    var done = function(ped){
      if (ped) rec.pedi = { sire: ped.sire || '', msire: ped.msire || '' };
      ls.horse = ls.horse || {}; ls.horse[id] = rec;
      drSave(ls);
      return rec;
    };
    if (typeof pgFetchHorse === 'function'){
      return pgFetchHorse(id).then(function(ped){ return done(ped); }).catch(function(){ return done(null); });
    }
    return done(null);
  });
}
/* 前走のrid解決(開催日×場×R) → キャッシュ */
function drPrevRid(prev){
  var ls = drLs();
  var date8 = drD8(prev.d).replace(/\//g, '');
  var code = drVenueCode(prev.vname);
  var key = date8 + '|' + code + '|' + prev.r;
  if (!code) return Promise.resolve('');
  if (ls.prevDay && ls.prevDay[key]) return Promise.resolve(ls.prevDay[key]);
  if (typeof bfDateRaces !== 'function') return Promise.resolve('');
  return bfDateRaces(date8).then(function(items){
    var hit = null;
    for (var i = 0; i < items.length; i++){
      var it = items[i];
      if (it.code === code && String(it.rid).slice(-2) === ('0' + prev.r).slice(-2)){ hit = it.rid; break; }
    }
    ls.prevDay = ls.prevDay || {}; ls.prevDay[key] = hit || '';
    drSave(ls);
    return hit || '';
  }).catch(function(){ return ''; });
}
/* 馬名の照合キー: 空白（全角含む）・中点・括弧などを除去して比較する */
function drNameKey(s){
  return String(s == null ? '' : s)
    .replace(/[\s\u3000]+/g, '')
    .replace(/[・･\-\u2010-\u2015―ー]/g, '')
    .replace(/[()（）\[\]［］]/g, '')
    .toUpperCase();
}
/* 前走レースの「上がり順位」→ 各馬ランク表 */
function drPrevRankCalc(rid){
  var ls = drLs();
  if (ls.prevRank && ls.prevRank[rid]) return Promise.resolve(ls.prevRank[rid]);
  return drFetchRace(rid).then(function(rec){
    var rows = rec.rows.filter(function(x){ return x.order >= 1 && x.last3; });
    var vals = rows.map(function(x){ return { name: x.name, l3: drNum(x.last3) }; })
      .filter(function(x){ return x.l3 != null; });
    vals.sort(function(a, b){ return a.l3 - b.l3; });
    var by = {};
    var rank = 0, prevV = -1;
    vals.forEach(function(x){
      if (x.l3 !== prevV){ rank++; prevV = x.l3; }
      by[drNameKey(x.name)] = rank;          // 馬名の正規化キーで持つ
    });
    ls.prevRank = ls.prevRank || {};
    ls.prevRank[rid] = { by: by, n: vals.length };
    drSave(ls);
    return ls.prevRank[rid];
  }).catch(function(){ ls.prevRank = ls.prevRank || {}; ls.prevRank[rid] = { by: {}, n: 0 }; drSave(ls); return ls.prevRank[rid]; });
}

/* ========== 集計エンジン ========== */
function drNew(){ return { n: 0, w: 0, t2: 0, t3: 0, oth: 0, roiW: 0 }; }
function drAdd(g, s){
  var o = s ? s.o : 0;
  if (!(o >= 1)) return;
  g.n++;
  if (o === 1){ g.w++; g.roiW += (s.odds || 0); }
  else if (o === 2) g.t2++;
  else if (o === 3) g.t3++;
  else g.oth++;
}
function drRate(a, b){ return b > 0 ? (a / b * 100) : 0; }

/* =========================================================
   ★2026-09-13 第24弾①: 枠順ファクター（重賞のみ）
   ---------------------------------------------------------
   ご指定どおり【⑥重賞データ分析の samples（対象重賞の過去10年ぶん・1〜3着が照合済み）】
   の歴代結果から「有利な枠順」を判定し、AI予想のファクター判定に使います。
   学習DBの「場×距離」統計は使いません。
   --- 頭数ぶんの補正 ---
   枠の有利不利は頭数で意味が変わります（8頭立ての8枠と18頭立ての8枠は別物）。
   そこで各出走に「その頭数で3着内に入る期待確率 = min(3,頭数) ÷ 頭数」を積み上げて期待値とし、
     有利度 ratio = 実際の3着内数 ÷ 期待3着内数
   とします。1.00=平均 / 1より大きい=有利 / 小さい=不利。頭数が違う年を混ぜても公平です。
   ========================================================= */
var WAKU_MIN_TOTAL = 40;   // 判定に使う最低サンプル数（これ未満なら枠順ファクターは使わない）
var WAKU_MIN_N = 8;        // 1つの枠についての最低出走数（これ未満の枠は判定しない）
var WAKU_GAIN = 0.5;       // 有利度(ratio) → 0〜1スコア の傾き（ratio1.4→0.70 / ratio0.6→0.30）
function wakuStatFrom(samples){
  var m = {}, total = 0, totalExp = 0, total3 = 0;
  (samples || []).forEach(function(s){
    if (!s) return;
    var f = parseInt(s.frame, 10);
    var o = parseInt(s.o, 10);
    var rn = parseInt(s.raceN, 10);
    if (!(f >= 1 && f <= 8)) return;
    if (!(o >= 1)) return;
    if (!(rn >= 4)) return;                       // 極端な少頭数は期待確率が歪むので除外
    var exp = Math.min(3, rn) / rn;               // この頭数での3着内期待確率
    var g = m[f] || (m[f] = { f: f, n: 0, w: 0, t3: 0, exp3: 0 });
    g.n++; g.exp3 += exp;
    if (o === 1) g.w++;
    if (o <= 3) g.t3++;
    total++; totalExp += exp; total3 += (o <= 3 ? 1 : 0);
  });
  var frames = [];
  for (var f2 = 1; f2 <= 8; f2++){
    var g2 = m[f2];
    if (!g2 || !g2.n){ frames.push({ f: f2, n: 0, w: 0, t3: 0, exp3: 0, ratio: null, pct3: 0, pctW: 0, judge: 0 }); continue; }
    var ratio = g2.exp3 > 0 ? (g2.t3 / g2.exp3) : null;
    frames.push({ f: f2, n: g2.n, w: g2.w, t3: g2.t3, exp3: g2.exp3, ratio: ratio,
      pct3: g2.n ? (g2.t3 / g2.n * 100) : 0, pctW: g2.n ? (g2.w / g2.n * 100) : 0,
      judge: wakuJudge(ratio, g2.n) });
  }
  return { frames: frames, n: total, exp3: totalExp, t3: total3,
           baseRatio: totalExp > 0 ? (total3 / totalExp) : null };
}
/* ratio → 3段階の判定（1=有利 / 0=ふつう / -1=不利）。サンプル不足は 0 */
function wakuJudge(ratio, n){
  if (ratio == null || !(n >= WAKU_MIN_N)) return 0;
  if (ratio >= 1.18) return 1;
  if (ratio <= 0.82) return -1;
  return 0;
}
/* 枠番 → 0〜1 の評価スコア（0.5=中立）。判定できない枠は null */
function wakuScoreOf(frame, st){
  if (!st || !st.frames) return null;
  var f = parseInt(frame, 10);
  if (!(f >= 1 && f <= 8)) return null;
  var g = null;
  for (var i = 0; i < st.frames.length; i++){ if (st.frames[i].f === f){ g = st.frames[i]; break; } }
  if (!g || !g.n || g.ratio == null || g.n < WAKU_MIN_N) return null;
  var v = 0.5 + (g.ratio - 1) * WAKU_GAIN;
  return Math.max(0, Math.min(1, v));
}
/* 枠番 → 判定の詳細（表示用） */
function wakuInfoOf(frame, st){
  if (!st || !st.frames) return null;
  var f = parseInt(frame, 10);
  if (!(f >= 1 && f <= 8)) return null;
  for (var i = 0; i < st.frames.length; i++){ if (st.frames[i].f === f) return st.frames[i]; }
  return null;
}
/* いま①で開いているレースについて使える枠順統計を返す（重賞のみ・対象レース一致のみ） */
var WAKU_MEMO = { key: '', done: false, val: null };
function wakuStatForRace(){
  var key = '';
  try {
    key = String((typeof DR_LAST !== 'undefined' && DR_LAST && DR_LAST.rid) || '') + '|' +
          String((typeof DR_LAST !== 'undefined' && DR_LAST && DR_LAST.samples) ? DR_LAST.samples.length : 0) + '|' +
          String((typeof state !== 'undefined' && state && state.raceId) || '');
  } catch(e){}
  if (WAKU_MEMO.done && WAKU_MEMO.key === key) return WAKU_MEMO.val;
  var val = null;
  try {
    var last = (typeof DR_LAST !== 'undefined' && DR_LAST) ? DR_LAST : null;
    if (last && last.samples && last.samples.length){
      /* ⑥の分析対象と「今選ばれているレース」が同じでなければ使わない。
         （第24弾⑤で直した血統ファクターと同じ食い違いを、こちらでも起こさないため） */
      var cur = String((state && state.raceId) || '');
      var pick = (typeof drPickRid === 'function') ? drPickRid() : null;
      var want = (pick && pick.rid) ? String(pick.rid) : cur;
      var have = String(last.rid || '');
      var sameRace = !have || !want || have === want;
      /* 重賞のみ（ユーザー指定）。grade が取れないときはレース名の重賞表記で判定 */
      var g = '';
      try { g = String((typeof drGrade === 'function' ? drGrade() : '') || ''); } catch(e){}
      if (!g){ try { g = String((typeof drTargetGrade === 'function' ? drTargetGrade() : '') || ''); } catch(e){} }
      var isGrade = /^(G[123]|Jpn[123]?)/i.test(g);
      if (!isGrade){
        try { isGrade = !!(last.name && drGradeMark(last.name)); } catch(e){}
      }
      if (sameRace && isGrade){
        var st = wakuStatFrom(last.samples);
        if (st && st.n >= WAKU_MIN_TOTAL) val = st;
      }
    }
  } catch(e){ val = null; }
  WAKU_MEMO = { key: key, done: true, val: val };
  return val;
}
/* 有利/不利な枠を文章にする（表示・説明用） */
function wakuSummaryText(st){
  if (!st || !st.frames) return '';
  var good = [], bad = [];
  st.frames.forEach(function(g){
    if (!g || g.ratio == null || g.n < WAKU_MIN_N) return;
    if (g.judge > 0) good.push(g);
    else if (g.judge < 0) bad.push(g);
  });
  function fmt(a){
    return a.map(function(g){
      return g.f + '枠(' + g.ratio.toFixed(2) + '倍・3着内' + g.pct3.toFixed(1) + '%/' + g.n + '走)';
    }).join('、');
  }
  var t = [];
  if (good.length) t.push('有利: ' + fmt(good));
  if (bad.length) t.push('不利: ' + fmt(bad));
  if (!t.length) t.push('枠順による明確な差は見つかりませんでした（すべて平均的）');
  return t.join('　／　');
}
/* 汎用ビルダ: labelFn(sample) -> [{k,label}] or null */
function drBuild(samples, labelFn){
  var m = {};
  samples.forEach(function(s){
    var labs = labelFn(s);
    if (!labs || !labs.length) return;
    labs.forEach(function(lb){
      if (!lb) return;
      var o = m[lb.k] || (m[lb.k] = { label: lb.label, g: drNew(), sub: lb.sub || '', sys: lb.sys || '' });
      drAdd(o.g, s);
    });
  });
  var out = [];
  Object.keys(m).forEach(function(k){ out.push({ k: k, label: m[k].label, g: m[k].g, sub: m[k].sub, sys: m[k].sys }); });
  return out;
}
/* 前走レース別: 同じレース名を年をまたいで1行に合算する。
   年ごとの内訳は yearRows に入れておき、表では行内の「年別」ボタンで開く（行も列も増やさない）。 */
function drBuildPrevRace(samples){
  var m = {};
  (samples || []).forEach(function(s){
    var pr = s.prev;
    if (!pr || !pr.nm) return;
    var base = drPrevRaceBase(pr.nm);
    var yr = String(pr.d || '').slice(0, 4);
    var k = 'rn' + base + '|' + (pr.vname || '') + '|' + (pr.dist || '');
    var o = m[k] || (m[k] = {
      k: k,
      label: base + (pr.vname ? '（' + pr.vname + (pr.dist ? ' ' + pr.dist : '') + '）' : ''),
      g: drNew(), sub: '', sys: '', _y: {}
    });
    drAdd(o.g, s);
    if (yr){
      if (!o._y[yr]) o._y[yr] = drNew();
      drAdd(o._y[yr], s);
    }
  });
  var out = [];
  Object.keys(m).forEach(function(k){
    var o = m[k];
    var ys = Object.keys(o._y).sort();
    o.years = ys;                                     // 出現した年（古い順）
    o.yearRows = ys.slice().reverse().map(function(y){  // 表示は新しい順
      var g = o._y[y];
      return { y: y, n: g.n, w: g.w, t2: g.t2, t3: g.t3, oth: g.oth };
    });
    delete o._y;
    out.push(o);
  });
  return out;
}
function drIsHot(g, base){
  if (!g || base == null || !g.n) return false;
  var in3 = g.w + g.t2 + g.t3;
  if (in3 === 0) return false;
  var rate = drRate(in3, g.n);
  if (g.n >= 8) return rate >= Math.min(100, base + 10);
  if (g.n >= 4) return rate >= Math.min(100, base + 16);
  return g.n >= 3 && rate >= Math.min(100, base + 18);
}
function drHtmlTable(title, note, rows, opts){
  opts = opts || {};
  drHtmlTable._seq = (drHtmlTable._seq || 0);
  var h = [];
  h.push('<div style="border:1px solid var(--line2);border-radius:12px;margin:10px 0;overflow:hidden">');
  h.push('<div style="padding:7px 11px;background:var(--card2);border-bottom:1px solid var(--line2);display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
    '<b style="font-size:.93rem;color:var(--ok-ink)">' + title + '</b>' +
    (note ? '<span class="small muted">' + note + '</span>' : '') + '</div>');
  if (!rows || !rows.length){
    h.push('<div class="small muted" style="padding:8px 11px">データなし</div></div>');
    return h.join('');
  }
  var ncol = 9 + (opts.subcol ? 1 : 0);
  h.push('<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.76rem"><thead><tr>' +
    '<th style="text-align:left">区分</th><th>出走</th><th>1着</th><th>2着</th><th>3着</th><th>4着以下</th>' +
    '<th>勝率</th><th>複勝率</th><th>単回収率</th>' + (opts.subcol ? '<th style=\"text-align:left\">' + opts.subcol + '</th>' : '') + '</tr></thead><tbody>');
  rows.forEach(function(r){
    var g = r.g;
    var hot = drIsHot(g, opts.base);
    // 年別の内訳（2年以上あるときだけ開閉ボタンを付ける）
    var yr = (opts.expand && r.yearRows && r.yearRows.length > 1) ? r.yearRows : null;
    var sid = '', tog = '';
    if (yr){
      sid = 'drsub' + (++drHtmlTable._seq);
      tog = ' <button type="button" class="drsub" data-drsub="' + sid + '" title="年ごとの内訳を開く/閉じる">年別' +
        yr.length + ' <span class="ar">▸</span></button>';
    }
    h.push('<tr' + (hot ? ' style="background:var(--card2)"' : '') + '>' +
      '<td style="text-align:left;white-space:nowrap"><b>' + esc(r.label) + '</b>' +
      (hot ? ' <span title="傾向候補" style="color:var(--warn-ink)">★</span>' : '') + tog + '</td>' +
      '<td>' + g.n + '</td><td>' + g.w + '</td><td>' + g.t2 + '</td><td>' + g.t3 + '</td><td>' + g.oth + '</td>' +
      '<td>' + (g.n ? drRate(g.w, g.n).toFixed(0) + '%' : '−') + '</td>' +
      '<td>' + (g.n ? drRate(g.w + g.t2 + g.t3, g.n).toFixed(0) + '%' : '−') + '</td>' +
      '<td>' + (g.n && g.roiW > 0 ? (g.roiW / g.n * 100).toFixed(0) + '%' : '−') + '</td>' +
      (opts.subcol ? '<td class="muted">' + esc(drSubOf(r)) + '</td>' : '') + '</tr>');
    if (sid){
      // 内訳は同じ表の中の隠し行（列を増やさないので表は横に広がらない）
      var chips = yr.map(function(y){
        return '<span class="dryr"><b>' + esc(y.y) + '年</b> ' + y.n + '走' +
          (y.w ? ' <i class="w">1着' + y.w + '</i>' : '') + (y.t2 ? ' <i class="t2">2着' + y.t2 + '</i>' : '') +
          (y.t3 ? ' <i class="t3">3着' + y.t3 + '</i>' : '') +
          ((!y.w && !y.t2 && !y.t3) ? ' <i class="muted">馬券内なし</i>' : '') + '</span>';
      }).join('');
      h.push('<tr id="' + sid + '" class="drsubrow" style="display:none"><td colspan="' + ncol + '" ' +
        'style="text-align:left;background:var(--card);padding:5px 10px">' +
        '<span class="small muted">年別の内訳（新しい順）: </span>' + chips + '</td></tr>');
    }
  });
  h.push('</tbody></table></div></div>');
  return h.join('');
}
function drSortByN(arr){ arr.sort(function(a, b){ return b.g.n - a.g.n || (b.g.w + b.g.t2 + b.g.t3) - (a.g.w + a.g.t2 + a.g.t3); }); return arr; }

/* 脚質の簡易推定(そのレースの通過4角位置) */
function drStyle(pass, raceN){
  if (!pass) return '';
  var toks = String(pass).split('-').filter(Boolean);
  if (!toks.length) return '';
  var pos = parseInt(toks[toks.length - 1], 10);
  if (!(pos >= 1) || !(raceN >= 1)) return '';
  if (pos === 1) return '逃げ';
  if (pos <= Math.max(2, Math.round(raceN * 0.18))) return '先行';
  if (pos >= Math.round(raceN * 0.55)) return '追込';
  return '差し';
}
/* 前走レース名から「年・回・クラス表記」を除いた素のレース名（年まとめ用） */
function drPrevRaceBase(nm){
  var s = String(nm || '');
  s = s.replace(/^第\s*\d+\s*回/, '');
  s = s.replace(/\((G|Jpn|OP|L|Listed|GI{1,3}|[123])\s*\)/gi, '');   // 格付け括弧を外す
  return s.replace(/[\s\u3000]+/g, '').trim();
}
/* 前走クラス(レース名から簡易判定) */
function drPrevClass(nm){
  var n = String(nm || '');
  if (/G1|GⅠ|Ｇ１/.test(n)) return 'G1';
  if (/G2|GⅡ|Ｇ２/.test(n)) return 'G2';
  if (/G3|GⅢ|Ｇ３/.test(n)) return 'G3';
  if (/オープン|OP|リステッド|(L)\b|特指/.test(n)) return 'オープン等';
  return '条件戦等';
}

/* レース名の正規化（記念冠名やスポンサー冠を外し、前後装飾差を吸収して比較） */
function drRaceCore(s){
  var t = bfBaseName2(s);
  t = t.replace(/ディープインパクト記念$/, '');
  t = t.replace(/^報知杯/, '');
  return t;
}
/* スポンサー冠(先頭に付くだけの装飾)。「先頭一致」ではなく『外したら完全一致』のときだけ同一視する。
   例: 産経大阪杯 ⇄ 大阪杯 / 報知杯弥生賞 ⇄ 弥生賞。部分一致で広く拾うと
   ジャパンカップ と ジャパンカップダート のような別レースを混ぜてしまうため採用しない。 */
var DR_SPON = ['報知杯','産経賞','産経杯','産経','サンケイスポーツ杯','サンケイスポーツ','サンケイ',
  '朝日杯','毎日新聞杯','中日新聞杯','中日スポーツ杯','中日','東京新聞杯','東京中日スポーツ杯',
  'スポーツニッポン賞','スポーツニッポン杯','スポーツニッポン','スポニチ杯','日刊スポーツ賞','日刊スポーツ杯',
  'ニッポン放送賞','ラジオNIKKEI賞','ラジオNIKKEI杯','フジテレビ賞','テレビ東京賞','ＴＢＳ賞','TBS賞',
  '読売新聞杯','日本経済新聞杯','日本経済新聞賞','共同通信杯','時事通信杯','NHK賞','JRA賞'];
var DR_ALIAS = [   // 改称など、装飾除去では一致しない組み合わせだけを明示
  ['阪神牝馬ステークス','阪神牝馬特別'],
  ['京阪杯','京阪杯'],
  ['シリウスステークス','シリウスステークス'],
  ['セントライト記念','セントライト記念']
];
function drStripAggressive(s){
  var t = drCl(s);
  DR_SPON.forEach(function(p){ if (t.indexOf(p) === 0 && t.length > p.length + 1) t = t.slice(p.length); });
  t = t.replace(/ハンデキャップ$|ハンデ$/, '');
  return t;
}
/* 全角の英数→半角（DB側の表記ゆれ対策） */
function drHalf(s){
  return String(s == null ? '' : s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c){
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}
/* netkeiba 表記の略称をそろえる。DBのレース名は強く省略されるので、
   その省略形まで寄せる（実際のDB名で確認した組だけを入れる）:
     ジャパンカップ→ジャパンC / マイルチャンピオンシップ→マイルチャンピオンS
     阪神カップ→阪神C / 阪神ジュベナイルフィリーズ→阪神ジュベナイルF
     アイビスサマーダッシュ→アイビスサマーD / 京成杯オータムハンデ→京成杯オータムH
     ニュージーランドトロフィー→ニュージーランドT / 阪神スプリングジャンプ→阪神スプリングJ
     アメリカジョッキークラブカップ→アメリカジョッキーC / サウジアラビアロイヤルカップ→サウジアラビアRC
   末尾の「競走」(地方競馬の正式名)も外す: 東京大賞典競走 ⇄ 東京大賞典 */
/* netkeiba が使う「2文字以上の略号」→日本語 の対応表（名前の末尾に付く形）。
   実測で確認したものだけを入れる:
     京成杯AH   ⇄ 京成杯オータムハンデ(キャップ)   … race一覧/結果ページは「京成杯AH」、DBは「京成杯オータムH」
     アメリカJCC / AJCC ⇄ アメリカジョッキークラブカップ
     京王杯SC   ⇄ 京王杯スプリングカップ            アイビスSD ⇄ アイビスサマーダッシュ
     ダービー卿CT ⇄ ダービー卿チャレンジトロフィー   朝日杯FS ⇄ 朝日杯フューチュリティステークス
     阪神JF     ⇄ 阪神ジュベナイルフィリーズ        マイルCS ⇄ マイルチャンピオンシップ
     中山GJ / 京都HJ / 京都JS ⇄ グランド・ハイ・ジャンプ(ステークス)
     ヴィクトリアM ⇄ ヴィクトリアマイル */
var DR_ABBR_EXP = [
  ['AJCC', 'アメリカジョッキークラブカップ'],
  ['JCC',  'ジョッキークラブカップ'],
  ['AH',   'オータムハンデ'],
  ['SC',   'スプリングカップ'],
  ['SD',   'サマーダッシュ'],
  ['CT',   'チャレンジトロフィー'],
  ['FS',   'フューチュリティステークス'],
  ['JF',   'ジュベナイルフィリーズ'],
  ['CS',   'チャンピオンシップ'],
  ['HJ',   'ハイジャンプ'],
  ['GJ',   'グランドジャンプ'],
  ['JS',   'ジャンプステークス'],
  ['M',    'マイル']
];
/* 末尾の略号を日本語に展開する（例: 京成杯AH → 京成杯オータムハンデ）。DB検索のキーワード作りにも使う */
function drExpandAbbr(s){
  var t = drHalf(drCl(s));
  for (var i = 0; i < DR_ABBR_EXP.length; i++){
    var a = DR_ABBR_EXP[i][0];
    // 「AJCC」のように名前まるごとが略号のケースも展開する（1文字略号 'M' 単体は展開しない）
    var whole = (a.length >= 2 && t === a);
    if (whole || (t.length > a.length + 1 && t.slice(-a.length) === a)) return t.slice(0, t.length - a.length) + DR_ABBR_EXP[i][1];
  }
  return t;
}
function drAbbrNorm(s){
  var t = drExpandAbbr(s);                 // ★先に略号(AH/SC/CT/M…)を日本語へ展開する
  t = t.replace(/競走$/, '');
  // ★「ハンデキャップ」は「カップ→C」より先に処理する（後だと「オータムHC」になって DB名「オータムH」とズレる）
  t = t.replace(/ハンデキャップ|ハンデ/g, 'H');
  t = t.replace(/クラブカップ$/, 'C');        // アメリカジョッキークラブカップ
  t = t.replace(/ロイヤルカップ$/, 'RC');     // サウジアラビアロイヤルカップ
  t = t.replace(/カップ/g, 'C').replace(/ステークス/g, 'S');
  t = t.replace(/チャンピオンシップ/g, 'チャンピオンS');   // マイルチャンピオンS
  t = t.replace(/スプリングジャンプ/g, 'スプリングJ').replace(/ジャンプ/g, 'J');
  t = t.replace(/トロフィー/g, 'T');
  t = t.replace(/フィリーズ/g, 'F');
  t = t.replace(/ダッシュ/g, 'D');
  return t;
}
/* 末尾の半角略号1字の有無だけの差を同一視する。
   例) ダービー卿チャレンジトロフィー(→…チャレンジT) ⇄ DB表記「ダービー卿チャレンジ」
       朝日杯フューチュリティステークス(→フューチュリティS) ⇄ DB表記「朝日フューチュリティ」 */
function drDropTailLetter(a, b){
  var x = drAbbrNorm(a), y = drAbbrNorm(b);
  if (x === y) return true;
  var tx = /[A-Z]$/.test(x), ty = /[A-Z]$/.test(y);
  if (!tx && !ty) return false;              // 略号が無い組はここでは扱わない
  if (tx && ty) return false;                // 両方に略号がある組は通常の比較に任せる（サマーD ⇄ サマーJ を混ぜない）
  var cx = tx ? x.slice(0, -1) : x;
  var cy = ty ? y.slice(0, -1) : y;
  if (cx.length < 5 || cy.length < 5) return false;   // 「阪神C ⇄ 阪神」のような短い組は同一視しない
  if (cx === cy) return true;
  return drTailEq(cx, cy);   // 朝日杯フューチュリティS ⇄ 朝日フューチュリティ 等
}
/* 冠(スポンサー名・協賛社名)が先頭に付くだけの差を同一視する。
   例) 日刊スポ賞中山金杯 ⇄ 中山金杯 / スポニチ賞京都金杯 ⇄ 京都金杯 / テレビ東京杯青葉賞 ⇄ 青葉賞
   安全のため「短い方の名前の後ろに、12文字以内の冠が付いているだけ」に限定する
   （部分一致で広く拾うと ジャパンC と ジャパンCダート のような別レースを混ぜてしまう）。 */
function drTailEq(a, b){
  var s = (a.length <= b.length) ? a : b;
  var l = (a.length <= b.length) ? b : a;
  if (s.length < 3 || l.length <= s.length) return false;
  if (l.slice(l.length - s.length) !== s) return false;
  var pre = l.slice(0, l.length - s.length);
  // 冠は3文字以上を基本。ただし「読売マイラーズC ⇄ マイラーズカップ」のような
  // 2文字冠（読売・報知 など）は、後ろが長い名前(6文字以上)のときだけ認める
  var minPre = (s.length >= 6) ? 2 : 3;
  if (!pre || pre.length < minPre || pre.length > 12) return false;
  if (/\d/.test(pre)) return false;
  if (/^(未勝利|新馬|1勝クラス|2勝クラス|3勝クラス|オープン|特別|記念|賞|杯)$/.test(s)) return false;
  return true;
}
function drRaceEq(a, b){
  var x = drRaceCore(a), y = drRaceCore(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // まず「冠を外さない形」で略称をそろえて比較する。
  // 冠を外すと壊れる名前があるため（例: 朝日杯FS → 'FS'）。
  if (drAbbrNorm(x) === drAbbrNorm(y)) return true;
  if (drDropTailLetter(x, y)) return true;
  // スポンサー冠だけが違う（外すと完全一致）の場合のみ同一視
  var xa = drStripAggressive(x), ya = drStripAggressive(y);
  if (xa === ya) return true;
  // 略称(カップ/ステークス/競走の有無)をそろえて比較
  if (drAbbrNorm(xa) === drAbbrNorm(ya)) return true;
  if (drDropTailLetter(xa, ya)) return true;
  if (drTailEq(drAbbrNorm(xa), drAbbrNorm(ya))) return true;
  if (drTailEq(xa, ya)) return true;
  for (var i = 0; i < DR_ALIAS.length; i++){
    if ((DR_ALIAS[i][0] === x && DR_ALIAS[i][1] === y) || (DR_ALIAS[i][1] === x && DR_ALIAS[i][0] === y)) return true;
  }
  return false;
}
/* 同名レース過去開催を探索（p31の開催カレンダー/日別レース一覧キャッシュを再利用。
   名前の装飾差(記念冠名・スポンサー)は drRaceEq で吸収） */
function drSeekYears(inf, progress, venueOnly){
  progress = progress || function(){};
  var y0 = inf.year || new Date().getFullYear();
  var years = [];
  for (var t = y0; t >= y0 - 11; t--) years.push(t);
  var found = [];
  var seq = Promise.resolve();
  years.forEach(function(year){
    seq = seq.then(function(){
      var foundRid = null;
      var wins = [];
      for (var d = -1; d <= 1; d++){
        var yy = year, mm = inf.month + d;
        if (mm < 1){ mm = 12; yy--; } else if (mm > 12){ mm = 1; yy++; }
        wins.push({ y: yy, m: mm });
      }
      var mseq = Promise.resolve();
      wins.forEach(function(w){
        mseq = mseq.then(function(){
          if (foundRid) return;
          return bfCal(w.y, w.m).then(function(cal){
            var dates = Object.keys(cal).filter(function(d8){
              if (!inf.venue) return true;
              var vs = cal[d8] || [];
              return vs.indexOf(inf.venue) >= 0;
            });
            var dseq = Promise.resolve();
            dates.forEach(function(d8){
              dseq = dseq.then(function(){
                if (foundRid) return;
                progress('同名レースを探索中: ' + year + '年 ' + d8.slice(0, 4) + '/' + (+d8.slice(4, 6)) + '/' + (+d8.slice(6, 8)) + ' …');
                return bfDateRaces(d8).then(function(items){
                  for (var i = 0; i < items.length; i++){
                    var it = items[i];
                    if (!it || !it.name || !it.rid) continue;
                    if (!drRaceEq(it.name, inf.name)) continue;
                    if (venueOnly && it.code && bfVenueByCode(it.code) !== inf.venue) continue;
                    if (inf.venue && it.code && bfVenueByCode(it.code) !== inf.venue) continue;   // 同名でも別場は除外
                    if (inf.surf && it.surf && it.surf !== inf.surf) continue;                     // 芝⇄ダートは除外
                    foundRid = it.rid; break;
                  }
                  return null;
                }).catch(function(){});
              });
            });
            return dseq;
          }).catch(function(){});
        });
      });
      return mseq.then(function(){ if (foundRid) found.push({ year: year, rid: foundRid }); });
    });
  });
  return seq.then(function(){ return found; });
}
/* ========== 本体: 全データ収集 ========== */
function drSeekSeries(inf, progress){
  progress = progress || function(){};
  var ls = drLs();
  // v3: レース名照合の改良（冠スポンサー・略称カップ/C・競走 の統一、地方Jpn対応）で
  //     探索結果が変わるため、旧キャッシュ(v2以前)とは別キーにする
  var key = 'v3|' + bfBaseName2(inf.name) + '@' + (inf.venue || '*') + '|' + (inf.surf || '');
  if (ls.seek && ls.seek[key] && ls.seek[key].rows && ls.seek[key].rows.length){
    return Promise.resolve(ls.seek[key].rows);
  }
  if (typeof bfVenueByCode !== 'function') return Promise.resolve([]);
  var req = function(){
    return drSeekDb(inf, progress).catch(function(e){
      // 通信エラーを「0件」として扱うと、その後50秒かけてカレンダーを走査して同じ失敗を繰り返す。
      // 原因がユーザーに伝わるようにそのまま上位へ投げる。
      var msg = String((e && e.message) || e);
      if (/検索に失敗|応答が空|エラーページ|中継エラー/.test(msg)) throw e;
      return [];
    }).then(function(rows){
      if (rows.length >= 5) return rows;                       // DB検索が成功
      if (typeof bfCal === 'function' && typeof bfDateRaces === 'function'){
        return drSeekYears(inf, progress, true).then(function(a){
          if (a.length >= 7) return a;
          return drSeekYears(inf, progress, false).then(function(b){
            var map = {};
            a.forEach(function(r){ map[r.year] = r.rid; });
            b.forEach(function(r){ if (map[r.year] == null) map[r.year] = r.rid; });
            var out = [];
            Object.keys(map).forEach(function(y){ out.push({ year: +y, rid: map[y] }); });
            return out;
          });
        });
      }
      return rows;
    });
  };
  return req().then(function(all){
    all = all || [];
    all.sort(function(a, b){ return a.year - b.year; });
    var recent = all.slice(-DR_LIMIT_YEARS);
    ls.seek = ls.seek || {};
    ls.seek[key] = { rows: recent, all: all.length, at: new Date().toISOString() };
    drSave(ls);
    return recent;
  });
}
/* DBレース検索(部分一致)で同名レースの全開催ridを取得（中央のみ・高速）。
   db.netkeiba.com は input=UTF-8 を渡せばUTF-8のまま検索できる */
/* 競馬場名（中央＋地方）。DB検索結果の行判定・場名抽出に使う */
var DR_VEN_NAMES = '(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|大井|川崎|船橋|浦和|門別|盛岡|水沢|金沢|笠松|名古屋|園田|姫路|高知|佐賀|帯広|福山|荒尾|高崎|三条|旭川|北見|岩見沢)';
var DR_VEN_RE = new RegExp('\\d{1,2}' + DR_VEN_NAMES + '\\d');
/* 重賞・特別戦など「その名前で1つのレース」と言えるか。
   条件戦(未勝利・新馬・◯勝クラス等)は同名が各場に多数あるため、開催場も合わせて照合する。 */
function drGradeMark(nm){
  return /G[123]|G[ⅠⅡⅢ]|Jpn|リステッド|\((?:L|OP)\)|オープン|重賞/i.test(String(nm || ''));
}
function drNameGeneric(nm){
  if (drGradeMark(nm)) return false;
  var t = drAbbrNorm(drRaceCore(nm));
  if (/^(サラ系)?[0-9０-９]{0,2}歳?(以上)?(未勝利|新馬|1勝クラス|2勝クラス|3勝クラス)/.test(t)) return true;
  if (/^(未勝利|新馬|障害|牝馬限定|3歳以上|4歳以上)/.test(t)) return true;
  return t.length < 4;
}
/* DB検索に使うキーワード候補（長い順）。
   年によって冠スポンサー名の表記が変わる（例: 中山金杯 ⇄ 日刊スポーツ賞中山金杯、
   京都金杯 ⇄ スポーツニッポン賞京都金杯）ため、「冠を落とした素のレース名」でも検索する。
   DB検索は部分一致なので、短い語で広く拾っても最終的な名前照合(drRaceEq)で弾ける。 */
function drSearchWords(nm){
  var out = [];
  function push(w){
    w = drHalf(String(w || '').replace(/[\s\u3000]/g, '')).replace(/競走$/, '');
    if (w.length < 2) return;
    for (var i = 0; i < out.length; i++){ if (out[i] === w) return; }
    out.push(w);
  }
  // 名前がnetkeibaの略称表記（例: マイルチャンピオンS, 阪神C）のときは、
  // 半角略号のままだとDB検索が0件になる（word=ジャパンC→0件、word=ジャパンカップ→20件）。
  // そこで略号を展開した語と、略号を落とした前方一致語（例: マイルチャンピオン）も候補にする。
  var EXP = { C: ['カップ', 'シップ'], S: ['ステークス', 'シップ'], D: ['ダッシュ'], H: ['ハンデ'],
              F: ['フィリーズ'], T: ['トロフィー'], J: ['ジャンプ'], M: ['マイル'] };
  function pushVariants(b){
    b = drHalf(b);
    push(b);
    var t = b.slice(-1);
    if (EXP[t] && b.length >= 3){
      EXP[t].forEach(function(w){ push(b.slice(0, -1) + w); });
      push(b.slice(0, -1));      // 前方一致語（DB側の表記が何であれ拾える）
    }
  }
  var core = drRaceCore(drExpandName(nm));   // 短縮名(マイルCS等)は先に正式名へ戻す
  var exp = drExpandAbbr(core);              // 2文字略号(京成杯AH等)は日本語へ展開（略号形だとDB検索が0件になる）
  // 1) 正式名でまず検索（DB検索は部分一致なので、正式名が一番よく当たる）
  pushVariants(exp);
  // 2) 冠スポンサー名を落とした素の名前（例: 日刊スポーツ賞中山金杯 → 中山金杯、サンスポ杯阪神牝馬S → 阪神牝馬S）
  var m = String(drHalf(exp)).match(/^.{2,14}?(賞|杯)/);
  var bare = (m && String(drHalf(exp)).length > m[0].length + 1) ? String(drHalf(exp)).slice(m[0].length) : '';
  if (bare) pushVariants(bare);
  // 3) 最後の手段として、渡された表記そのものと略称形（カップ→C など）
  if (exp !== core) push(core);
  push(drAbbrNorm(exp));
  if (bare) push(drAbbrNorm(bare));
  return out;
}

function drSeekDb(inf, progress){
  var words = drSearchWords(inf.name);
  if (!words.length || typeof drGet !== 'function') return Promise.resolve([]);
  var okPages = 0, errs = [];
  // 候補の語を順に試し、最初に1件以上ヒットした語の結果を採用する
  // ※ 取得失敗(中継の429/502等)は「0件」とは別に数え、全語が失敗したら通信エラーとして上位へ投げる
  function tryWord(k){
    if (k >= words.length){
      if (!okPages && errs.length){
        return Promise.reject(new Error('netkeiba DB の検索に失敗しました（' + errs[0] + '／' + errs.length + '語すべて）。' +
          '※「レース名が見つからない」のではなく通信エラーです。数秒おいて「📥 この重賞の過去10年を分析」をもう一度押してください。' +
          '繰り返す場合は「①データ入力」→「URL取込の通信設定」→「🔧 中継を診断」で中継を確認してください。'));
      }
      return Promise.resolve([]);
    }
    var word = words[k];
    progress('「' + word + '」の同名レースをDB検索中…');
    var url = 'https://db.netkeiba.com/race/list.html?word=' + encodeURIComponent(word) + '&input=UTF-8&list=1';
    return drGetRetry(url, 3, progress).then(function(html){
      okPages++;
      var rows = [];
      var parts = String(html).split(/<tr/i);
      for (var i = 0; i < parts.length; i++){
        var seg = parts[i];
        var ridM = seg.match(/href="https?:\/\/db\.netkeiba\.com\/race\/(\d{12})\//);
        if (!ridM) continue;
        var txt = seg.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        // 中央＋地方(Jpn)の開催（例: "2026/03/08 2中山4 …" "2025/11/03 8船橋1 …"）
        if (!DR_VEN_RE.test(txt)) continue;
        var dm = txt.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (!dm) continue;
        // リンクのテキスト＝実際のレース名。名前・開催場・面が一致する行だけ採用する
        // （DB検索は部分一致なので、名前を確認せずに使うと別レースを混ぜてしまう）
        var nmM = seg.match(/<a[^>]*race\/\d{12}\/[^>]*>([\s\S]*?)<\/a>/i);
        var nm = nmM ? drCl(bfStrip(nmM[1])) : drCl(txt);
        if (!drRaceEq(nm, inf.name)) continue;
        var vm = txt.match(new RegExp('\\d{1,2}' + DR_VEN_NAMES + '\\d'));
        var vName = vm ? vm[1] : '';
        // 条件戦は同名が各場にあるため開催場も一致必須。重賞・特別戦は場替え(京都→中京など)や
        // 地方Jpnの持ち回り開催でも同一レースなので、場が違っても採用する（場違いはフラグを立てる）
        var venueDiff = !!(inf.venue && vName && vName !== inf.venue);
        if (venueDiff && drNameGeneric(inf.name)) continue;
        var sm = txt.match(/(芝|ダート|ダ|障(?:害)?)\s*(\d{3,4})/);
        var sSurf = sm ? (/障/.test(sm[1]) ? '障' : (/ダ/.test(sm[1]) ? 'ダ' : '芝')) : '';
        var sDist = sm ? (parseInt(sm[2], 10) || 0) : 0;
        if (inf.surf && sSurf && sSurf !== inf.surf) continue;   // 芝⇄ダートの別レースを除外
        rows.push({ rid: ridM[1], year: parseInt(dm[1], 10), name: nm, venue: vName, surf: sSurf, dist: sDist,
          venueDiff: venueDiff || undefined,
          date8: dm[1] + ('0' + dm[2]).slice(-2) + ('0' + dm[3]).slice(-2) });
      }
      rows.sort(function(a, b){ return b.date8.localeCompare(a.date8); });
      // 同じ年は1件（最新）に絞って新しい順の上位から採用
      var seenY = {}, picked = [];
      // 同じ年は「開催場が一致する行」を優先して1件に絞る
      rows.forEach(function(r){
        var k = String(r.year);
        if (seenY[k] === 2) return;
        if (seenY[k] === 1 && r.venueDiff) return;
        seenY[k] = r.venueDiff ? 1 : 2;
        if (seenY[k] === 2){
          for (var q = picked.length - 1; q >= 0; q--){ if (String(picked[q].year) === k){ picked.splice(q, 1); } }
        }
        picked.push({ year: r.year, rid: r.rid, name: r.name, venue: r.venue, dist: r.dist, venueDiff: r.venueDiff });
      });
      return picked.slice(0, 30);
    }).catch(function(e){ errs.push((e && e.message) || String(e)); return null; }).then(function(out){
      if (out && out.length) return out;
      // ヒット0件(または取得失敗)なら冠を落とした語で再検索。連続アクセスを避けるため少し待つ
      return drWait(out === null ? DR_RETRY_MS : 350).then(function(){ return tryWord(k + 1); });
    });
  }
  return tryWord(0);
}

function drPool(items, fn, conc){
  conc = Math.max(1, conc || 4);
  var total = items.length;
  return new Promise(function(res){
    if (!total){ res(); return; }
    var next = 0, running = 0, finished = 0;
    function launch(){
      while (running < conc && next < total){
        (function(idx){
          running++;
          Promise.resolve().then(function(){ return fn(items[idx]); })
            .then(function(){ tick(); }, function(){ tick(); });
        })(next++);
      }
    }
    function tick(){
      running--; finished++;
      if (finished === total){ res(); return; }
      launch();
    }
    launch();
  });
}
function drRunAll(progress, opt){
  opt = opt || {};
  progress = progress || function(){};
  var out = { samples: [], tables: [], errors: [], base: 0 };
  // #2026-09-10修正: 重賞以外でも「同じ名前の過去レース」が取れれば集計できるようにした
  // （以前は grade が無いと即エラーで、ボタンを押しても何も起きないように見えていた）
  var g = drGrade();
  var nmNow = (state && state.race && state.race.name) || '';
  if (!g) progress('※重賞(G1〜G3)の指定がありません。同名レースの過去回を探して集計します（見つかった回のみ）。');
  else progress('レース情報を確認: ' + nmNow + '（' + g + '）');
  return (typeof bfCurrentInfo === 'function' ? bfCurrentInfo() : Promise.reject(new Error('初期化が不完全です'))).then(function(inf){
    out.name = inf.name;
    return drAnalyzeFromInf(inf, opt, progress, out);
  });
}
/* ⑩カレンダー等から「ridを直接指定して」同じ分析を実行（現在のstateは変更しない） */
function drAnalyzeRid(rid, opt, progress){
  opt = opt || {};
  progress = progress || function(){};
  var out = { samples: [], tables: [], errors: [], base: 0 };
  if (!/^\d{12}$/.test(String(rid || ''))) return Promise.reject(new Error('レースIDが不正です'));
  out.rid = String(rid);
  return drInfForRid(String(rid)).then(function(inf){
    if (!inf || !inf.name) return Promise.reject(new Error('レース情報を取得できませんでした: ' + rid));
    progress('分析対象: ' + inf.name + '（' + (inf.venue || '') + '・' + inf.year + '年）');
    out.name = inf.name;
    return drAnalyzeFromInf(inf, opt, progress, out);
  });
}
/* rid → {name, venue, year, month}（race.netkeiba結果ページ、なければDB結果ページ） */
/* ================= レース名の展開（netkeibaの短縮名 → 正式名） ================= */
/* レースページの見出しは netkeiba の短縮名のことがある
   （例: マイルCS／阪神JF／ジャパンC）。そのままだとDB検索も名前照合も空振りするため、
   別名表と「重賞日程（正式名）」から正式名に戻してから使う。
   骨格は p18 の rsBase（別名→語尾の S/C/ステークス等を落とす）を流用する。 */
function drAliasOf(nm){
  var n = drCl(nm);
  var t = { '日本ダービー': '東京優駿', 'ダービー': '東京優駿', 'オークス': '優駿牝馬',
    'マイルCS': 'マイルチャンピオンシップ', 'NHKマイルC': 'NHKマイルカップ',
    'ジャパンC': 'ジャパンカップ', '阪神JF': '阪神ジュベナイルフィリーズ',
    '朝日杯FS': '朝日杯フューチュリティステークス',
    '朝日杯': '朝日杯フューチュリティステークス', 'ホープフルS': 'ホープフルステークス' };
  if (t[n]) return t[n];
  try { if (typeof RS_ALIAS !== 'undefined' && RS_ALIAS && RS_ALIAS[n]) return RS_ALIAS[n]; } catch(e){}
  return '';
}
function drNameSkeleton(nm){
  // rsBase は「末尾の略号1文字を落とす」方式なので、京成杯AH のような2文字略号を取りこぼす
  // （'京成杯AH'→'京成杯A' となり、日程表の '京成杯オータムハンデ' と一致しない）。
  // drAbbrNorm（略号を展開してから統一略号に寄せる）を比較キーにする。
  return drAbbrNorm(drRaceCore(nm));
}
function drExpandName(nm, y, venue, mo){
  var n = drCl(nm);
  if (!n) return n;
  var al = drAliasOf(n);
  if (al) n = al;
  var key = drNameSkeleton(n);
  if (!key || key.length < 3) return n;
  var ls = null;
  try { ls = (typeof gcLs === 'function') ? gcLs() : null; } catch(e){ ls = null; }
  if (!ls || !ls.sched) return n;
  var cands = [];
  [y, (y || 0) - 1, (y || 0) + 1].forEach(function(yy){
    var arr = (ls.sched && ls.sched[yy]) || [];
    arr.forEach(function(r){
      if (r && r.name && drNameSkeleton(r.name) === key) cands.push(r);
    });
  });
  if (!cands.length) return n;
  var pick = null;
  cands.forEach(function(r){
    var m2 = parseInt(String(r.date).slice(4, 6), 10);
    if (mo && m2 === mo && (!venue || !r.venue || String(r.venue).indexOf(venue) >= 0)) pick = pick || r;
  });
  if (!pick) pick = cands[0];
  return pick.name || n;
}
function drInfForRid(rid){
  var tryFetch = function(urls){
    if (!urls.length) return Promise.resolve(null);
    return drGet(urls[0]).then(function(html){ return html; }).catch(function(){ return tryFetch(urls.slice(1)); });
  };
  return tryFetch([
    'https://race.netkeiba.com/race/result.html?race_id=' + rid,
    'https://db.netkeiba.com/race/' + rid + '/'
  ]).then(function(html){
    if (!html) return null;
    var name = '', venue = '';
    var hm = html.match(/<h1[^>]*class="RaceName"[^>]*>([\s\S]*?)<\/h1>/i);
    if (hm) name = bfStrip(hm[1]);
    if (!name){
      var tm = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (tm) name = bfStrip(tm[1]).split('\uFF5C')[0].split('|')[0].replace(/\s*(結果.*|レース情報.*)$/, '');
    }
    var whole = bfStrip(html);
    var vmm = whole.match(/(\d{1,2})回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|大井|川崎|船橋|浦和|帯広|門別|盛岡|水沢|金沢|笠松|名古屋|園田|姫路|高知|佐賀|荒尾|益田|福山|北海道)/);
    if (vmm) venue = vmm[2];
    if (!venue){
      // 現在の結果ページは「4回 阪神 2日目」のように span 分割される。
      // RaceData02 の中の競馬場名を取り、それでも不明なら race_id の場コードから補う。
      var r2 = html.match(/<div[^>]*class="RaceData02"[^>]*>([\s\S]*?)<\/div>/i);
      var r2t = r2 ? bfStrip(r2[1]) : '';
      var vm2 = r2t.match(/(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|大井|川崎|船橋|浦和|帯広|門別|盛岡|水沢|金沢|笠松|名古屋|園田|姫路|高知|佐賀|荒尾|益田|福山)/);
      if (vm2) venue = vm2[1];
    }
    if (!venue && typeof bfVenueByCode === 'function') venue = bfVenueByCode(String(rid).slice(4, 6)) || '';
    if (!name){
      // DBページmeta名から
      var pr = (typeof bfParseDbResult === 'function') ? bfParseDbResult(html) : { meta: {} };
      if (pr.meta && pr.meta.name){ name = pr.meta.name.replace(/^第\s*\d+\s*回/, ''); if (!venue && pr.meta.place) venue = pr.meta.place; }
    }
    if (!name) return null;
    name = String(name).replace(/^第\s*\d+\s*回/, '');
    var y = 0, mo = 0;
    var dm = whole.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (dm){ y = parseInt(dm[1], 10); mo = parseInt(dm[2], 10); }
    if (!y){ var d2 = new Date(); y = d2.getFullYear(); mo = d2.getMonth() + 1; }
    // 面(芝/ダ/障)と距離。同名でも ジャパンカップ と ジャパンカップダート のような
    // 別レース(別条件)を混ぜないための照合キーに使う。
    var surf = '', dist = 0;
    // 面・距離は RaceData01（「芝1200m」等）から。ページ後方にある場合も拾えるよう全体から探す
    var sd = whole.match(/(芝|ダート|ダ|障(?:害)?)\s*(?:右|左|直|内|外)?\s*(\d{3,4})\s*m/);
    if (sd){
      surf = /障/.test(sd[1]) ? '障' : (/ダ/.test(sd[1]) ? 'ダ' : '芝');
      dist = parseInt(sd[2], 10) || 0;
    }
    var inf = { rid: rid, name: name, venue: venue, year: y, month: mo || 1, surf: surf, dist: dist };
    // 短縮名（マイルCS 等）なら重賞日程から正式名に戻す（重賞日程は年1リクエスト・キャッシュあり）
    var prep = Promise.resolve(null);
    if (typeof gcYearSchedule === 'function'){
      prep = gcYearSchedule(y).catch(function(){ return null; });
    }
    return prep.then(function(){
      inf.nameFull = inf.name;
      inf.name = drExpandName(inf.name, y, venue, mo);
      return inf;
    });
  });
}
/* ================= 本パイプライン: inf(開催情報)から集計表まで ================= */
function drAnalyzeFromInf(inf, opt, progress, out){
  opt = opt || {}; progress = progress || function(){}; out = out || {};
  out.yearsUsed = 0; out.samples = out.samples || []; out.errors = out.errors || []; out.tables = [];
  out.racesUsed = []; out.excluded = []; out.venueDiff = [];
  return (typeof drSeekSeries === 'function' ? drSeekSeries(inf, progress) : Promise.resolve([])).then(function(rows){
    if (!rows || !rows.length) throw new Error('同名レースの過去開催をnetkeibaに見つけられませんでした。');
    var years = rows.slice(-DR_LIMIT_YEARS);
    if (opt.limitYears && opt.limitYears > 0) years = years.slice(-opt.limitYears);
    out.yearsUsed = years.length;
    progress('過去 ' + years.length + ' 回分の結果を取得します（' + years[0].year + '〜' + years[years.length-1].year + '）…');
    var samples = [];
    var horseIds = [];
    var riderIdsByRid = {};
    var raceSeq = Promise.resolve();
    years.forEach(function(yr){
      raceSeq = raceSeq.then(function(){
        return drFetchRace(yr.rid).then(function(rec){
          if (rec.jids) riderIdsByRid[yr.rid] = rec.jids;
          var meta = rec.meta || {};
          var dateStr = meta.date8 ? drDateStr(meta.date8) : '';
          var rows = rec.rows || [];
          // 中継が不安定なときは「別のページ（DB検索結果など）」が返ることがある。
          // それを「照合で除外」に混ぜると原因が分からなくなるため、取得失敗として数える。
          if (!meta.name || /のレース検索結果|検索結果です|ログイン|Error/i.test(String(meta.name))){
            out.errors.push({ year: yr.year, rid: yr.rid, msg: 'レースページを取得できませんでした（中継が不安定な可能性）' });
            return;
          }
          // 照合: 実際に取得したレース名・開催場が対象レースと一致するか確認
          // (DB検索/カレンダー探索の取り違え・別条件レースの混入をここで必ず弾く)
          var okName = meta.name
            ? drRaceEq(drExpandName(meta.name, yr.year, inf.venue, inf.month), drExpandName(inf.name, inf.year, inf.venue, inf.month))
            : true;
          var strictVenue = drNameGeneric(inf.name);     // 条件戦は開催場も一致必須
          var okVenue = (!inf.venue || !meta.place) ? true : (String(meta.place).indexOf(inf.venue) >= 0 || !strictVenue);
          var venueDiffNote = (!okVenue) ? '' : ((strictVenue || !inf.venue || !meta.place || String(meta.place).indexOf(inf.venue) >= 0) ? '' : '場替え');
          if (!okName || !okVenue){
            out.excluded.push({ year: yr.year, rid: yr.rid, name: meta.name || '', place: meta.place || '',
              reason: (!okName ? 'レース名が不一致' : (strictVenue ? '開催場が不一致' : 'レース条件が不一致')) });
            return;
          }
          if (venueDiffNote){
            out.venueDiff = out.venueDiff || [];
            out.venueDiff.push({ year: yr.year, place: meta.place || '', rid: yr.rid });
          }
          out.racesUsed.push({ year: yr.year, rid: yr.rid, date: dateStr, name: meta.name || '',
            place: meta.place || '', rnum: meta.rnum || '', venueDiff: !!venueDiffNote,
            dist: meta.dist || (rows[0] ? (rows[0].dist || '') : ''),
            grade: meta.grade || '' });
          var raceN = rows.length;
          rows.forEach(function(rw){
            if (!rw.id || !(rw.order >= 1)) return;
            samples.push({ yr: yr.year, rid: yr.rid, o: rw.order, no: rw.no || '', frame: rw.frame || '',
              name: rw.name || '', id: rw.id, pop: drNum(rw.pop), odds: drNum(rw.odds),
              jockey: rw.jockey || '', pass: rw.passing || '', raceN: raceN, dateStr: dateStr,
              train: rw.trainer || '', wchg: rw.weightChg || '', dist: meta.dist || rw.dist || '',
              metaName: meta.name || '', metaPlace: meta.place || '' });
            if (horseIds.indexOf(rw.id) < 0) horseIds.push(rw.id);
          });
        }).catch(function(e){ out.errors.push('レース取得失敗 ' + yr.rid + ': ' + ((e && e.message) || e)); });
      });
    });
    return raceSeq.then(function(){
      progress('出走馬の個別データを取得中（' + horseIds.length + '頭・初回は1頭あたり数秒）…');
      var horseMap = {};
      var hidx = 0, hfail = 0;
      return drPool(horseIds, function(id){
        return drFetchHorse(id).then(function(rec){ horseMap[id] = rec; hidx++; progress('馬データ ' + hidx + '/' + horseIds.length); })
          .catch(function(){ hfail++; });
      }, 4).then(function(){
        out.fetchHorseOk = hidx; out.fetchHorseTotal = horseIds.length;
        var needPrev = [];
        samples.forEach(function(s){
          var h = horseMap[s.id];
          var prev = null;
          if (h && h.races && h.races.length && s.dateStr){
            var best = null;
            for (var i = 0; i < h.races.length; i++){
              var r = h.races[i];
              if (r.d < s.dateStr){ if (!best || r.d > best.d) best = r; }
            }
            if (best) prev = best;
          }
          s.horse = h; s.prev = prev;
          if (prev){
            prev.vname = drVenueName(prev.v);
            s.prevRidKey = prev.d.replace(/\//g, '') + '|' + drVenueCode(prev.vname) + '|' + prev.r;
          }
          s.profM = h ? h.month : 0;
          s.prod = h ? h.prod : '';
          s.sire = h && h.pedi ? h.pedi.sire : '';
          s.msire = h && h.pedi ? h.pedi.msire : '';
          s.pRank = 0; s.pRankRid = '';
          if (prev && prev.vname && prev.r) needPrev.push(s);
        });
        // 前走レース(=同じ日付×場×R)ごとにまとめ、レースごとの「上がり3F順位表」を作ってから
        // そのレースを前走に持つ【全サンプル】へ配る。
        // ※以前は (1)順位表を馬名で引くべきところをレース名で引いていた (2)1レースにつき1頭にしか
        //   配っていなかった ため、上がり3F順位別成績がほぼ検出できなかった（#2026-09-10修正）。
        var uniq = {};   // key -> その前走レースを走ったサンプル全員
        needPrev.forEach(function(s){ (uniq[s.prevRidKey] = uniq[s.prevRidKey] || []).push(s); });
        var keys = Object.keys(uniq);
        progress('前走レースの上がり順位を計算中（前走 ' + keys.length + ' レース）…');
        var pidx = 0;
        return drPool(keys, function(k){
          var group = uniq[k];
          var prev = group[0].prev;
          return drPrevRid(prev).then(function(rid){
            group.forEach(function(s2){ s2.pRankRid = rid || ''; });
            if (!rid) return;
            return drPrevRankCalc(rid).then(function(rk){
              var by = (rk && rk.by) || {};
              group.forEach(function(s2){
                var nm = drNameKey(s2.name);                 // ★馬名で引く（以前はレース名で引いていた）
                var rank = by[nm];
                if (rank == null && s2.name){
                  // 表記ゆれ(全角スペース・・・記号など)に備えて総当たりで照合
                  var alts = Object.keys(by);
                  for (var ai = 0; ai < alts.length; ai++){
                    if (drNameKey(alts[ai]) === nm){ rank = by[alts[ai]]; break; }
                  }
                }
                s2.pRank = rank || 0;
              });
              pidx++; progress('前走集計 ' + pidx + '/' + keys.length);
            });
          }).catch(function(){ group.forEach(function(s2){ s2.pRankRid = ''; }); });
        }, 4).then(function(){
          // 騎手の所属(美浦/栗東)を補完（結果ページの騎手ID → プロフィールの所属）
          return drEnrichRiderAff(samples, riderIdsByRid, progress).then(function(){
            samples.forEach(function(s){ drFinalizeSample(s); });
            out.samples = samples;
            return drComputeTables(samples);
          });
        });
      });
    });
  }).then(function(tables){
    out.tables = tables;
    return out;
  });
}
/* ---- 騎手の所属(美浦/栗東/その他) 補完 ----
   各回の結果ページで採取した 騎手名→ID を使い、そのIDのプロフィールページから所属を得る。
   所属は「現在」の登録情報のため、過去年度の騎乗時と所属が異なる騎手は現在値で表記する。 */
function drEnrichRiderAff(samples, riderIdsByRid, progress){
  progress = progress || function(){};
  var ls = drLs();
  var want = {};
  samples.forEach(function(s){
    var map = (riderIdsByRid && riderIdsByRid[s.rid]) || {};
    var id = map[s.jockey];
    if (id) want[id] = 1;
  });
  var ids = Object.keys(want);
  if (!ids.length) return Promise.resolve();
  progress('騎手の所属（美浦/栗東）をプロフィールで確認中（' + ids.length + '人）…');
  var affMap = {};
  return drPool(ids, function(id){
    if (ls.jaff && ls.jaff[id]) { affMap[id] = ls.jaff[id]; return; }
    return drGet('https://db.sp.netkeiba.com/jockey/' + id + '/').then(function(html){
      var h = String(html);
      var aff = '';
      var i = h.indexOf('歳)');
      if (i < 0) i = h.indexOf('歳<');
      var seg = i >= 0 ? h.slice(i, i + 4000) : h.slice(0, 12000);
      if (seg.indexOf('美浦') >= 0) aff = '美浦';
      else if (seg.indexOf('栗東') >= 0) aff = '栗東';
      else aff = 'その他';
      ls.jaff = ls.jaff || {}; ls.jaff[id] = aff;
      drSave(ls);
      affMap[id] = aff;
    }).catch(function(){ affMap[id] = 'その他'; });
  }, 4).then(function(){
    samples.forEach(function(s){
      var map = (riderIdsByRid && riderIdsByRid[s.rid]) || {};
      var id = map[s.jockey];
      s.jid = id || '';
      s.aff = id ? (affMap[id] || '不明') : '';
    });
  });
}

function drFinalizeSample(s){
  // 当日体重・増減
  var w = null, wd = null;
  var m1 = String(s.wchg || '').match(/(\d{3,4})\s*[\(（]\s*([+-]?\d+)\s*[\)）]/);
  if (m1){ w = parseInt(m1[1], 10); wd = parseInt(m1[2], 10); }
  s.w = w; s.wd = wd;
  // 東西(関東/関西/海外)
  var tr = s.train;
  var region = '';
  if (/\[東\]|美浦/.test(tr)) region = '関東馬(美浦)';
  else if (/\[西\]|栗東/.test(tr)) region = '関西馬(栗東)';
  else if (/\[外\]|海外/.test(tr)) region = '海外馬';
  else if (s.horse && s.horse.tr){ region = 'その他'; }
  else region = 'その他';
  s.region = region;
  // キャリア(前走まで)
  var starts = 0, wins = 0;
  if (s.horse && s.horse.races){
    s.horse.races.forEach(function(r){
      if (r.d < s.dateStr){ starts++; if (r.od === 1) wins++; }
    });
  }
  s.career = starts; s.careerW = wins;
  // 前走差分(体重)
  s.pDelta = null;
  if (s.prev && s.w != null && s.prev.w != null) s.pDelta = s.w - s.prev.w;
}

/* 表を作る */
function drComputeTables(samples){
  var all = drNew();
  var used = 0;
  samples.forEach(function(s){ drAdd(all, s); if (s.horse) used++; });
  var tables = [];
  // 全員サンプル基準の複勝率
  var baseRate = drRate(all.w + all.t2 + all.t3, all.n);
  function tb(title, rows, opts){
    opts = opts || {};
    opts.base = opts.base == null ? baseRate : opts.base;
    tables.push({ title: title, rows: drSortByN(rows), opts: opts, kind: opts.kind || 'g' });
    return rows;
  }
  // --- 枠・馬番・人気 ---
  tb('枠順別成績', drBuild(samples, function(s){ return s.frame ? [{ k: 'f' + s.frame, label: s.frame + '枠' }] : null; }));
  tb('馬番別成績', drBuild(samples, function(s){ return s.no ? [{ k: 'n' + s.no, label: s.no + '番' }] : null; }), { kind: 'no' });
  tb('当日の人気帯別成績', drBuild(samples, function(s){
    var p = s.pop; if (!(p >= 1)) return null;
    var lb;
    if (p === 1) lb = '1番人気';
    else if (p === 2) lb = '2番人気';
    else if (p === 3) lb = '3番人気';
    else if (p <= 6) lb = '4〜6番人気';
    else if (p <= 9) lb = '7〜9番人気';
    else lb = '10番人気以下';
    return [{ k: lb, label: lb }];
  }), { kind: 'pop' });
  tb('4番人気以下で馬券内に入った馬', drBuild(samples, function(s){
    if (!(s.pop >= 4) || !(s.o <= 3)) return null;
    return [{ k: 'p4win', label: '4番人気以下で馬券内' }];
  }), { kind: 'pick' });
  // --- 走り方 ---
  tb('脚質別成績（通過順から簡易推定）', drBuild(samples, function(s){
    var st = drStyle(s.pass, s.raceN); return st ? [{ k: st, label: st }] : null;
  }));
  tb('前走の4角位置別成績', drBuild(samples, function(s){
    var pr = s.prev; if (!pr || !pr.pass) return null;
    var toks = String(pr.pass).split('-').filter(Boolean); var pos = parseInt(toks[toks.length - 1], 10);
    if (!(pos >= 1)) return null;
    var lb = pos <= 2 ? '前(1〜2番手)' : (pos <= 6 ? '中(3〜6番手)' : '後(7番手以下)');
    return [{ k: lb, label: lb }];
  }));
  tb('前走の上がり3F順位別成績', drBuild(samples, function(s){
    if (!s.pRankRid || !s.pRank) return null;
    var lb = s.pRank === 1 ? '前走で上がり1位' : (s.pRank <= 3 ? '前走で上がり2〜3位' : '前走で上がり4位以下');
    return [{ k: (s.pRank === 1 ? 'a1' : (s.pRank <= 3 ? 'a23' : 'a4')), label: lb }];
  }), { kind: 'prevr', note: '前走レース内での上がり3Fの速さ順位（同タイムは同順位）。順位を特定できた馬だけを集計しています。' });
  // --- 馬体重 ---
  tb('当日の馬体重帯別成績', drBuild(samples, function(s){
    if (s.w == null) return null;
    var lb;
    if (s.w < 430) lb = '〜429kg';
    else if (s.w < 450) lb = '430〜449';
    else if (s.w < 470) lb = '450〜469';
    else if (s.w < 490) lb = '470〜489';
    else if (s.w < 510) lb = '490〜509';
    else lb = '510kg〜';
    return [{ k: lb, label: lb }];
  }));
  tb('前走との馬体重差別成績', drBuild(samples, function(s){
    if (s.pDelta == null) return null;
    var d = s.pDelta, lb;
    if (d <= -9) lb = '-9kg以上減';
    else if (d <= -5) lb = '-5〜-8kg';
    else if (d <= -1) lb = '-1〜-4kg';
    else if (d === 0) lb = '±0kg';
    else if (d <= 4) lb = '+1〜+4kg';
    else if (d <= 8) lb = '+5〜+8kg';
    else lb = '+9kg以上増';
    return [{ k: lb, label: lb }];
  }));
  // --- 騎手 ---
  tb('騎手別成績（上位・所属つき）', drBuild(samples, function(s){ return s.jockey ? [{ k: 'j' + s.jockey, label: s.jockey, sub: drRiderAffLabel(s.aff) }] : null; }), { kind: 'jockey', subcol: '騎手の所属' });
  tb('騎手の所属別成績（美浦・栗東ほか）', drBuild(samples, function(s){
    var a = s.aff; if (!a) return null;
    return [{ k: 'ra' + a, label: drRiderAffLabel(a) + 'の騎手が騎乗' }];
  }), { note: '対象期間中の出走馬に騎乗した騎手の所属（美浦/栗東はnetkeibaプロフィールより・その他は地方/海外等を含みます）', rule: false });
  // --- 東西 ---
  tb('関東馬・関西馬・海外馬別', drBuild(samples, function(s){ return [{ k: s.region, label: s.region }]; }));
  // --- 馬の属性 ---
  tb('父（種牡馬）別成績（主要）', drBuild(samples, function(s){
    return s.sire ? [{ k: 's' + s.sire, label: s.sire, sys: drSireLine(s.sire) }] : null;
  }), { subcol: '系統', subfn: 1, hidden: true });
  tb('母父（BMS）別成績（主要）', drBuild(samples, function(s){
    return s.msire ? [{ k: 'm' + s.msire, label: s.msire, sys: drSireLine(s.msire) }] : null;
  }), { subcol: '系統', subfn: 2, hidden: true });
  tb('キャリア別（前走までの出走数）', drBuild(samples, function(s){
    var c = s.career; if (c == null) return null;
    var lb = c <= 3 ? '3戦以下' : (c <= 6 ? '4〜6戦' : (c <= 10 ? '7〜10戦' : (c <= 15 ? '11〜15戦' : '16戦以上')));
    return [{ k: lb, label: lb }];
  }));
  tb('生まれ月別成績', drBuild(samples, function(s){
    if (!s.profM) return null;
    var lb;
    if (s.profM <= 3) lb = '1〜3月生まれ';
    else if (s.profM <= 6) lb = '4〜6月生まれ';
    else if (s.profM <= 9) lb = '7〜9月生まれ';
    else lb = '10〜12月生まれ';
    return [{ k: lb, label: lb }];
  }));
  tb('生産者別成績（主要）', drBuild(samples, function(s){
    return s.prod ? [{ k: 'pd' + s.prod, label: s.prod }] : null;
  }), { kind: 'prod' });
  // --- 前走情報 ---
  tb('前走クラス別成績', drBuild(samples, function(s){
    var nm = s.prev ? s.prev.nm : ''; return nm ? [{ k: drPrevClass(nm), label: drPrevClass(nm) }] : null;
  }));
  // 前走レース別: 以前は〔年ごと〕〔年まとめ〕の2枚を出していたが、
  // 〔年ごと〕は同じレース名が年のぶんだけ何行も出て分かりにくかったため 2026-09-11 に1枚へ統合。
  // 同じレース名は年をまたいで合算し、年別の内訳は行内の「年別」ボタンで開く。
  tb('主な前走レース別成績（2頭以上・年をまたいで合算）', drBuildPrevRace(samples),
    { kind: 'prevrace', expand: true,
      note: '同じレース名は年をまたいで1行にまとめています。「年別」を押すと年ごとの内訳が開きます。' });
  tb('前走の人気帯別成績', drBuild(samples, function(s){
    var p = s.prev ? s.prev.pop : 0; if (!(p >= 1)) return null;
    var lb;
    if (p === 1) lb = '前走1番人気';
    else if (p === 2) lb = '前走2番人気';
    else if (p <= 4) lb = '前走3〜4番人気';
    else if (p <= 9) lb = '前走5〜9番人気';
    else lb = '前走10番人気以下';
    return [{ k: lb, label: lb }];
  }), { kind: 'prevpop' });
  tb('前走2番人気以下で馬券内に入った馬', drBuild(samples, function(s){
    var p = s.prev ? s.prev.pop : 0;
    if (!(p >= 2) || !(s.o <= 3)) return null;
    return [{ k: 'pr2', label: '前走2番人気以下で馬券内' }];
  }), { kind: 'pick' });
  tb('前走着順帯別成績', drBuild(samples, function(s){
    var od = s.prev ? s.prev.od : 0; if (!(od >= 1)) return null;
    var lb = od === 1 ? '前走1着' : (od === 2 ? '前走2着' : (od === 3 ? '前走3着' : (od <= 6 ? '前走4〜6着' : '前走7着以下')));
    return [{ k: lb, label: lb }];
  }));
  tables.all = all; tables.base = baseRate;
  return tables;
}
/* 主要種牡馬の簡易系統ラベル */
var DR_SIRE_LINES = {
  'サンデーサイレンス': 'サンデーサイレンス系', 'Sunday Silence': 'サンデーサイレンス系',
  'ディープインパクト': 'サンデーサイレンス系', 'Deep Impact': 'サンデーサイレンス系',
  'ステイゴールド': 'サンデーサイレンス系', 'Stay Gold': 'サンデーサイレンス系',
  'ブラックタイド': 'サンデーサイレンス系', 'Black Tide': 'サンデーサイレンス系',
  'キタサンブラック': 'サンデーサイレンス系', 'Kitasan Black': 'サンデーサイレンス系',
  'ハーツクライ': 'サンデーサイレンス系', "Heart's Cry": 'サンデーサイレンス系',
  'ネオユニヴァース': 'サンデーサイレンス系', 'Neo Universe': 'サンデーサイレンス系',
  'アグネスタキオン': 'サンデーサイレンス系', 'Agnes Tachyon': 'サンデーサイレンス系',
  'ダイワメジャー': 'サンデーサイレンス系', 'Daiwa Major': 'サンデーサイレンス系',
  'マンハッタンカフェ': 'サンデーサイレンス系', 'Manhattan Cafe': 'サンデーサイレンス系',
  'ゼンノロブロイ': 'サンデーサイレンス系', 'Zenno Rob Roy': 'サンデーサイレンス系',
  'スペシャルウィーク': 'サンデーサイレンス系', 'Special Week': 'サンデーサイレンス系',
  'ダンスインザダーク': 'サンデーサイレンス系', 'Dance in the Dark': 'サンデーサイレンス系',
  'フジキセキ': 'サンデーサイレンス系', 'Fuji Kiseki': 'サンデーサイレンス系',
  'キズナ': 'サンデーサイレンス系', 'Kizuna': 'サンデーサイレンス系',
  'サトノダイヤモンド': 'サンデーサイレンス系', 'オルフェーヴル': 'サンデーサイレンス系',
  'ゴールドシップ': 'サンデーサイレンス系', 'Gold Ship': 'サンデーサイレンス系',
  'ジャスタウェイ': 'サンデーサイレンス系', 'Just a Way': 'サンデーサイレンス系',
  'スワーヴリチャード': 'サンデーサイレンス系', 'リアルスティール': 'サンデーサイレンス系',
  'フィエールマン': 'サンデーサイレンス系', 'サリオス': 'サンデーサイレンス系',
  'レイデオロ': 'ミスタープロスペクター系', 'Rey de Oro': 'ミスタープロスペクター系',
  'キングカメハメハ': 'ミスタープロスペクター系', 'King Kamehameha': 'ミスタープロスペクター系',
  'ロードカナロア': 'ミスタープロスペクター系', 'Lord Kanaloa': 'ミスタープロスペクター系',
  'ドゥラメンテ': 'ミスタープロスペクター系', 'Duramente': 'ミスタープロスペクター系',
  'キングマンボ': 'ミスタープロスペクター系', 'Kingmambo': 'ミスタープロスペクター系',
  'ミスタープロスペクター': 'ミスタープロスペクター系', 'Mr. Prospector': 'ミスタープロスペクター系',
  'リオンディーズ': 'ミスタープロスペクター系', 'モーリス': 'ヘイルトゥリーズン系', 'Maurice': 'ヘイルトゥリーズン系',
  'シンボリクリスエス': 'ヘイルトゥリーズン系', 'Symboli Kris S': 'ヘイルトゥリーズン系',
  'エピファネイア': 'ヘイルトゥリーズン系', 'Epiphaneia': 'ヘイルトゥリーズン系',
  'ブライアンズタイム': 'ヘイルトゥリーズン系', "Brian's Time": 'ヘイルトゥリーズン系',
  'タニノギムレット': 'ヘイルトゥリーズン系', 'Tanino Gimlet': 'ヘイルトゥリーズン系',
  'スクリーンヒーロー': 'ヘイルトゥリーズン系', 'Screen Hero': 'ヘイルトゥリーズン系',
  'シルバーホーク': 'ヘイルトゥリーズン系', 'Silver Hawk': 'ヘイルトゥリーズン系',
  'ヘイルトゥリーズン': 'ヘイルトゥリーズン系', 'Hail to Reason': 'ヘイルトゥリーズン系',
  'ロベルト': 'ヘイルトゥリーズン系', 'Roberto': 'ヘイルトゥリーズン系',
  'サドラーズウェルズ': 'ノーザンダンサー系', "Sadler's Wells": 'ノーザンダンサー系',
  'ノーザンダンサー': 'ノーザンダンサー系', 'Northern Dancer': 'ノーザンダンサー系',
  'デインヒル': 'ノーザンダンサー系', 'Danehill': 'ノーザンダンサー系',
  'シングスピール': 'ノーザンダンサー系', 'Singspiel': 'ノーザンダンサー系',
  'ディープスカイ': 'ノーザンダンサー系', 'Deep Sky': 'ノーザンダンサー系',
  'ディープブリランテ': 'ノーザンダンサー系', 'Deep Brillante': 'ノーザンダンサー系',
  'ノヴェリスト': 'ノーザンダンサー系', 'Novellist': 'ノーザンダンサー系',
  'ガリレオ': 'ノーザンダンサー系', 'Galileo': 'ノーザンダンサー系',
  'フランケル': 'ノーザンダンサー系', 'Frankel': 'ノーザンダンサー系',
  'モンジュー': 'ノーザンダンサー系', 'Montjeu': 'ノーザンダンサー系'
};
function drSireLine(nm){
  var n = drCl(nm || '');
  if (DR_SIRE_LINES[n]) return DR_SIRE_LINES[n];
  if (DR_SIRE_LINES[nm]) return DR_SIRE_LINES[nm];
  return '';
}

/* ====== 表示・UI（⑥タブ） ====== */
function drMsgSet(m, isErr){
  var el = $('drMsg'); if (!el) return;
  el.innerHTML = (isErr ? '<span style="color:var(--err-ink)">⚠ ' + esc(m) + '</span>' : esc(m));
  el.style.color = isErr ? 'var(--err-ink)' : '';
}
function drBusy(b){
  var a = $('drBtn'); if (a) a.disabled = b;
}
function drStat(txt){
  var el = $('drStat'); if (!el) return;
  el.innerHTML = txt || '';
}
/* 傾向ルール検出 */
function drRiderAffLabel(a){
  if (a === '美浦') return '美浦';
  if (a === '栗東') return '栗東';
  if (a === 'その他') return '地方・海外等';
  return '不明';
}
function drDetectRules(tables, samples){
  var all = tables.all || drNew();
  var base = tables.base != null ? tables.base : drRate(all.w + all.t2 + all.t3, all.n || 1);
  var rules = [];
  tables.forEach(function(t){
    if (t.kind === 'no' || t.kind === 'pick' || (t.opts && t.opts.rule === false) || !t.rows) return;
    var rows = t.rows.filter(function(r){ return r && r.g && r.g.n >= 3; });
    rows.forEach(function(r){
      var g = r.g;
      var rate = drRate(g.w + g.t2 + g.t3, g.n);
      if (!drIsHot(g, base)) return;
      var gain = rate - base;
      rules.push({ t: t.title, label: r.label, g: g, rate: rate, gain: gain, n: g.n });
    });
  });
  rules.sort(function(a, b){
    return (b.gain + Math.min(0.4, b.g.n / 40)) - (a.gain + Math.min(0.4, a.g.n / 40)) || b.g.n - a.g.n;
  });
  return rules.slice(0, 14);
}
function drSubOf(r){
  return r.sub || r.sys || '';
}
/* navi-keiba風: 表1枚ごとの「短評」を自動生成（馬券内率と単勝回収率から文章化） */
function drShortNote(t, rows, base){
  var cand = (rows || []).filter(function(r){ return r.g && r.g.n >= 3; });
  if (!cand.length){
    return '<div class="drshort">📝 <span class="lab">' + esc(t.title || 'この項目') + '</span>: 1区分あたりの出走が少なく、はっきりした傾向は出ていません。参考程度に見てください。</div>';
  }
  function in3(r){ return drRate(r.g.w + r.g.t2 + r.g.t3, r.g.n); }
  function roi(r){ return r.g.roiW > 0 ? (r.g.roiW / r.g.n * 100) : 0; }
  var base2 = (base == null) ? 0 : base;
  var byGain = cand.slice().sort(function(a, b){
    return (in3(b) - base2) - (in3(a) - base2) ||
           ((b.g.w + b.g.t2 + b.g.t3) - (a.g.w + a.g.t2 + a.g.t3)) || (b.g.n - a.g.n);
  });
  var top = byGain[0];
  var tIn3 = in3(top), gain = tIn3 - base2;
  var roiRows = cand.filter(function(r){ return roi(r) >= 100; }).sort(function(a, b){ return roi(b) - roi(a); });
  var rTop = roiRows[0];
  var parts = [];
  parts.push('📝 <span class="lab">' + esc(t.title || 'この項目') + '</span>: ');
  if (gain >= 8){
    parts.push('「' + esc(top.label) + '」は出走' + top.g.n + '頭で馬券内率<b class="good">' + tIn3.toFixed(0) + '%</b>（全体' +
      base2.toFixed(0) + '%比 <b class="good">+' + gain.toFixed(0) + 'pt</b>）と、このデータが<b class="good">馬券内によく絡む</b>傾向。');
  } else if (gain >= 3){
    parts.push('「' + esc(top.label) + '」は出走' + top.g.n + '頭で馬券内率' + tIn3.toFixed(0) + '%（全体' +
      base2.toFixed(0) + '%比 +' + gain.toFixed(0) + 'pt）とやや高め。');
  } else if (gain <= -8){
    parts.push('「' + esc(top.label) + '」でも馬券内率' + tIn3.toFixed(0) + '%（全体' + base2.toFixed(0) + '%比 ' +
      gain.toFixed(0) + 'pt）と、このデータはむしろ馬券内に絡みにくい傾向。');
  } else {
    parts.push('「' + esc(top.label) + '」が出走' + top.g.n + '頭で馬券内率' + tIn3.toFixed(0) +
      '%（全体' + base2.toFixed(0) + '%）と最も高いものの、突出した傾向は見られません。');
  }
  if (rTop){
    parts.push(' 回収率では「' + esc(rTop.label) + '」が単勝回収率<b class="good">' + roi(rTop).toFixed(0) +
      '%</b>と100%超え（単勝1点買いがプラスになる目安・高回収率）。');
  } else if (top.g.w > 0 && top.g.roiW > 0){
    parts.push(' ただし「' + esc(top.label) + '」でも単勝回収率は' + roi(top).toFixed(0) + '%と100%未満。絡みやすさに比べ回収率は控えめ。');
  }
  return '<div class="drshort">' + parts.join('') + '</div>';
}
function drRenderTableOne(t, base){
  var opts = t.opts || {};
  if (opts.hidden) return '';   // 血統は「血統まとめ」1枚に集約して表示する
  var baseRate = base;
  // 一部は頭数でフィルタ（少数はまとめる）
  var rows = t.rows;
  if (t.kind === 'no'){ rows = rows.filter(function(r){ return r.g.n >= 2; }); }
  if (t.kind === 'jockey'){ rows = rows.slice(0, 12); }
  if (t.kind === 'prod'){ rows = rows.slice(0, 10); }
  if (t.kind === 'prevrace'){ rows = rows.filter(function(r){ return r.g.n >= 2; }).slice(0, 12); }
  if (t.kind === 'prevpop'){ /* all */ }
  if (t.kind === 'prevr' || t.kind === 'pick'){ /* all */ }
  var sortByRateDesc = (t.kind === 'pick' || t.kind === 'prevr');
  if (sortByRateDesc){
    rows = rows.slice().sort(function(a, b){
      return drRate(b.g.w + b.g.t2 + b.g.t3, b.g.n) - drRate(a.g.w + a.g.t2 + a.g.t3, a.g.n);
    });
  } else {
    rows = rows.slice().sort(function(a, b){
      return b.g.n - a.g.n || drRate(b.g.w + b.g.t2 + b.g.t3, b.g.n) - drRate(a.g.w + a.g.t2 + a.g.t3, a.g.n);
    });
  }
  // prevrace は区分列にレース名が出るので subcol（空列）は付けない＝表を横に広げない
  var subcol = opts.subcol ? opts.subcol : '';
  return drHtmlTable(t.title, opts.note || '', rows, { base: base, subcol: subcol, expand: !!opts.expand }) +
    drShortNote({ title: t.title, kind: t.kind }, rows, base);
}
/* ===== 血統(父・母父)まとめ: 1枚に集約した表 ===== */
function drPedBlock(samples, base){
  var sires = drBuild(samples, function(s){ return s.sire ? [{ k: 's' + s.sire, label: s.sire, sys: drSireLine(s.sire) }] : null; });
  var msires = drBuild(samples, function(s){ return s.msire ? [{ k: 'm' + s.msire, label: s.msire, sys: drSireLine(s.msire) }] : null; });
  var lines = drBuild(samples, function(s){ return s.sire ? [{ k: 'L' + drSireLine(s.sire), label: drSireLine(s.sire) }] : null; });
  var noSys = samples.filter(function(s){ return s.sire && !drSireLine(s.sire); }).length;
  var rowsN = samples.filter(function(s){ return !!s.sire; }).length;
  function sortRate(a, b){
    var ra = a.g.n ? (a.g.w + a.g.t2 + a.g.t3) / a.g.n : 0, rb = b.g.n ? (b.g.w + b.g.t2 + b.g.t3) / b.g.n : 0;
    return rb - ra || b.g.n - a.g.n;
  }
  function row(r){
    var g = r.g;
    var in3 = drRate(g.w + g.t2 + g.t3, g.n);
    var gain = in3 - (base || 0);
    var hot = drIsHot(g, base);
    var sub = drSubOf(r);
    return '<tr' + (hot ? ' style="background:var(--card2)"' : '') + '>' +
      '<td style="text-align:left;white-space:nowrap;padding-left:22px"><b>' + esc(r.label) + '</b>' +
      (hot ? ' <span title="傾向候補" style="color:var(--warn-ink)">&#9733;</span>' : '') + (sub ? ' <span class="muted" style="font-size:.92em">' + esc(sub) + '</span>' : '') + '</td>' +
      '<td>' + g.n + '</td><td>' + (g.n ? drRate(g.w, g.n).toFixed(0) + '%' : '−') + '</td>' +
      '<td>' + (g.n ? drRate(g.w + g.t2 + g.t3, g.n).toFixed(0) + '%' : '−') + '</td>' +
      '<td>' + (gain >= 5 ? '<b style="color:var(--ok-ink)">+' + gain.toFixed(0) + '</b>' : (gain <= -5 ? '<span class="muted">' + gain.toFixed(0) + '</span>' : (gain > 0 ? '+' + gain.toFixed(0) : '±0'))) + '</td>' +
      '<td>' + (g.n && g.roiW > 0 ? (g.roiW / g.n * 100).toFixed(0) + '%' : '−') + '</td></tr>';
  }
  function section(title, arr, lim, note){
    var top = arr.slice().sort(sortRate).slice(0, lim);
    var rest = arr.length - top.length;
    var html = '<tr><td colspan="6" style="text-align:left;background:var(--card2);font-weight:bold;color:var(--info-ink);padding:4px 8px">' + esc(title) +
      (note ? ' <span class="muted" style="font-weight:400;font-size:.92em">' + esc(note) + '</span>' : '') + '</td></tr>';
    if (!top.length) return html + '<tr><td colspan="6" class="muted" style="text-align:left;padding-left:22px">データなし</td></tr>';
    html += top.map(row).join('');
    if (rest > 0) html += '<tr><td colspan="6" class="muted" style="text-align:left;padding-left:22px">ほか ' + rest + '件省略（★ルール検出には含まれます）</td></tr>';
    return html;
  }
  var h = [];
  h.push('<div style="border:1px solid var(--line2);border-radius:12px;margin:10px 0;overflow:hidden">');
  h.push('<div style="padding:7px 11px;background:var(--card2);border-bottom:1px solid var(--line2)">' +
    '<b style="font-size:.93rem;color:var(--info-ink)">🧬 血統まとめ（父・母父・系統）</b>' +
    '<span class="small muted"> 出走' + rowsN + '頭分。馬券内率の高い順の上位のみ（全体 ' + (base || 0).toFixed(0) + '%との差つき）。</span></div>');
  h.push('<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.76rem"><thead><tr>' +
    '<th style="text-align:left">区分</th><th>出走</th><th>勝率</th><th>馬券内率</th><th>全体差</th><th>単回収率</th></tr></thead><tbody>');
  h.push(section('父の系統別', lines, 6));
  h.push(section('父（種牡馬）別', sires, 10));
  h.push(section('母父（BMS）別', msires, 10));
  h.push('</tbody></table></div>');
  var sTop = sires.slice().sort(sortRate)[0], mTop = msires.slice().sort(sortRate)[0];
  var parts = [];
  if (sTop && sTop.g.n >= 2){
    var r1 = drRate(sTop.g.w + sTop.g.t2 + sTop.g.t3, sTop.g.n);
    parts.push('父では <b>' + esc(sTop.label) + '</b>産駒が' + sTop.g.n + '頭出走で馬券内率 <b>' + r1.toFixed(0) + '%</b>' +
      (r1 - (base || 0) >= 5 ? '（全体比 +' + (r1 - (base || 0)).toFixed(0) + 'pt）' : '') + '。');
  }
  if (mTop && mTop.g.n >= 2){
    var r2 = drRate(mTop.g.w + mTop.g.t2 + mTop.g.t3, mTop.g.n);
    parts.push('母父では <b>' + esc(mTop.label) + '</b>が' + mTop.g.n + '頭で馬券内率 <b>' + r2.toFixed(0) + '%</b>。');
  }
  if (noSys) parts.push('系統不明の種牡馬が' + noSys + '頭（簡易判定のため）。');
  h.push('<div class="drshort" style="padding:7px 11px">📝 ' + (parts.join(' ') || '血統データが少数のため目立った傾向は出ていません。') + '</div>');
  h.push('</div>');
  return h.join('');
}

/* ===== 対象レース一覧(この分析が元にしているレースの検証表示) ===== */
function drRacesUsedBlock(res){
  var arr = res.racesUsed || [];
  if (!arr.length) return '';
  var cnt = {};
  (res.samples || []).forEach(function(s){ cnt[s.rid] = (cnt[s.rid] || 0) + 1; });
  var h = [];
  h.push('<div style="border:1px solid var(--line2);background:var(--card);border-radius:12px;padding:8px 11px;margin:8px 0">');
  h.push('<div style="font-weight:bold;color:var(--ok-ink);margin-bottom:3px">🗂 この分析が参照した過去レース（' + arr.length + '件）' +
    '<span class="small muted" style="font-weight:400"> 名前・開催場を1件ずつ照合済みです。一致しないレースは集計から除外しました。</span></div>');
  h.push('<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.74rem;white-space:nowrap"><thead><tr>' +
    '<th>年</th><th>日付</th><th>開催</th><th>R</th><th style="text-align:left">レース名</th><th style="text-align:left">距離</th><th>集計頭数</th></tr></thead><tbody>');
  arr.slice().sort(function(a, b){ return String(a.date).localeCompare(String(b.date)); }).forEach(function(r){
    h.push('<tr><td>' + esc(String(r.year || '')) + '</td><td>' + esc(r.date || '') + '</td><td>' + esc(r.place || '') + '</td>' +
      '<td>' + esc(r.rnum || '') + '</td><td style="text-align:left">' + esc(r.name || '') + '</td>' +
      '<td style="text-align:left">' + esc(r.dist || '') + '</td><td>' + (cnt[r.rid] || 0) + '</td></tr>');
  });
  h.push('</tbody></table></div>');
  if ((res.excluded || []).length){
    h.push('<div class="small" style="color:var(--warn-ink);margin-top:4px">⚠ 名前・開催場が一致しなかったため除外: ' +
      (res.excluded || []).map(function(x){ return esc(x.year + '年 ' + (x.rid || '')) +
        (x.name ? '（DB表記: ' + esc(x.name) + (x.place ? '・' + esc(x.place) : '') + '）' : '') +
        '：' + esc(x.reason || '') + (x.place && !x.name ? '（' + esc(x.place) + '）' : ''); }).join(' / ') + '</div>');
  }
  h.push('</div>');
  return h.join('');
}

/* 直近の分析結果（⑥の血統オカルトファクターが「分析用データ」から抽出するために共有） */
var DR_LAST = null;
function drRenderAll(res, boxEl){
  try { DR_LAST = res; } catch(e){}
  var box = boxEl || $('drOut'); if (!box) return;
  var tables = res.tables;
  var samples = res.samples;
  var all = tables.all || drNew();
  var baseRate = tables.base != null ? tables.base : 0;
  var rules = drDetectRules(tables, samples);
  var html = [];
  var hOk = res.fetchHorseOk != null ? res.fetchHorseOk : 0;
  var hTot = res.fetchHorseTotal != null ? res.fetchHorseTotal : 0;
  html.push('<div class="small" style="margin:2px 0 6px">対象: <b>' + esc(res.name || '') + '</b> ／ 過去 ' +
    esc(res.yearsUsed || (samples.length ? '' : 0)) + ' 回・全出走 <b>' + all.n + '</b> 頭（内訳 1着' + all.w +
    '・2着' + all.t2 + '・3着' + all.t3 + '・4着以下' + all.oth + '）<br>全体の馬券内率(3着内) <b>' + baseRate.toFixed(0) + '%</b>・単回収率 <b>' +
    (all.roiW > 0 ? (all.roiW / (all.n || 1) * 100).toFixed(0) + '%' : '−') + '</b>' +
    (res.rid ? '<br><span class="muted">対象レースID: ' + esc(res.rid) + '</span>' : '') +
    ((res.venueDiff && res.venueDiff.length) ? '<br><span class="muted">※ 開催場が異なる年（場替え・地方Jpnの持ち回り開催など）も同じレースとして含めています: ' +
      res.venueDiff.map(function(x){ return esc(String(x.year) + '年(' + (x.place || '?') + ')'); }).join('・') + '</span>' : '') +
    (hOk < hTot && hTot > 0 ? '<br><span class="muted">※ 個別データ(血統・前走など)が取得できた馬は ' + hOk + '/' + hTot + ' 頭です（それ以外は枠・馬番・人気など結果だけの集計に含まれます）</span>' : '') + '</div>');
  // 傾向サマリ
  html.push('<div style="border:1px solid var(--line2);background:linear-gradient(180deg,var(--card),var(--card));border-radius:12px;padding:10px 13px;margin:8px 0">');
  html.push('<div style="font-weight:bold;color:var(--warn-ink);margin-bottom:4px">📌 馬券内に入りそうな共通点（自動検出・あくまで傾向）</div>');
  if (!rules.length){
    html.push('<span class="small muted">該当する強い傾向が見つかりませんでした（全体的に拮抗 or サンプル不足）。下の表で人気・枠などの傾向を確認してください。</span>');
  } else {
    html.push('<ol style="margin:2px 0 0;padding-left:1.3em" class="small">');
    rules.forEach(function(r, i){
      html.push('<li style="margin:3px 0">【' + esc(r.t) + '】' + esc(r.label) +
        ': 出走' + r.n + '頭で馬券内 <b>' + (r.g.w + r.g.t2 + r.g.t3) + '</b> 回（内1着 ' + r.g.w + '）複勝率 <b>' + r.rate.toFixed(0) + '%</b>' +
        (r.g.w ? '・単回収 ' + (r.g.roiW > 0 ? (r.g.roiW / r.g.n * 100).toFixed(0) + '%' : '−') : '') + '</li>');
    });
    html.push('</ol>');
    html.push('<div class="small muted" style="margin-top:3px">※ 上の★付き行・オレンジ背景の行が「傾向候補」です。過去の実績であり的中を保証するものではありません。人気(オッズ)や枠・馬番は抽選等の要因を含みます。</div>');
  }
  html.push('</div>');
  // 集計0件のときは理由と対処を出す（通信エラーと照合ミスを取り違えないように）
  var nUsed = (res.racesUsed || []).length;
  if (!nUsed){
    var nErr = (res.errors || []).length;
    var nEx = (res.excluded || []).length;
    var byReason = {};
    (res.excluded || []).forEach(function(x){ byReason[x.reason || '理由不明'] = (byReason[x.reason || '理由不明'] || 0) + 1; });
    var rTxt = Object.keys(byReason).map(function(k){ return esc(k) + ' ' + byReason[k] + '件'; }).join('・');
    html.push('<div class="small" style="border:1px solid var(--line2);background:var(--card2);border-radius:10px;padding:8px 11px;margin:6px 0">' +
      '<b style="color:var(--err-ink)">⚠ 集計に使えた過去レースが 0 件でした。</b>（ページ取得エラー ' + nErr + '件 / 照合で除外 ' + nEx + '件' +
      (rTxt ? '：' + rTxt : '') + '）<br>' +
      '・通信エラーが多い場合は中継（リレー）が不安定なだけのことがあります。①データ入力の「🔧 中継を診断」で中継を確認し、もう一度実行してください。<br>' +
      '・「レース名が不一致」が多い場合は、netkeiba側のレース名表記が想定と違う可能性があります（下の除外一覧に出たDB側の名前をお知らせいただければ照合ルールに追加します）。</div>');
  } else if ((res.errors || []).length){
    html.push('<div class="small muted" style="margin:2px 0 4px">※ 過去 ' + nUsed + ' 回のうち ' + (res.errors || []).length +
      ' 回はページ取得に失敗したため集計に含めていません（中継が不安定なときに起こります）。</div>');
  }
  // 参照した過去レースの検証表示（どのレースを元に集計したかを明示）
  html.push(drRacesUsedBlock(res));
  // 各表
  var mainTables = tables.filter(function(t){ return t.kind !== 'pick'; });
  mainTables.forEach(function(t){
    html.push(drRenderTableOne({ kind: t.kind, title: t.title, rows: t.rows, opts: t.opts }, baseRate));
    if (t.title === '関東馬・関西馬・海外馬別') html.push(drPedBlock(samples, baseRate));   // 血統は1枚に集約
  });
  // ピックアップ(条件を満たした1着馬)の個別表
  var pickTables = tables.filter(function(t){ return t.kind === 'pick' && t.rows && t.rows.length; });
  pickTables.forEach(function(t){
    var rows = t.rows.slice();
    rows.sort(function(a, b){ return b.g.w - a.g.w || b.g.n - a.g.n; });
    var items = [];
    rows.forEach(function(r){
      if (!r.g.n) return;
      items.push(esc(r.label) + '：' + r.g.n + '頭（1着' + r.g.w + '・2着' + r.g.t2 + '・3着' + r.g.t3 + '）');
    });
    if (items.length){
      html.push('<div style="border:1px dashed var(--line2);border-radius:10px;padding:6px 11px;margin:6px 0;background:var(--card)">' +
        '<b style="font-size:.86rem">🔍 ' + esc(t.title) + '</b><div class="small" style="margin-top:2px">' + items.join('<br>') + '</div></div>');
    }
  });
  html.push('<div class="small muted" style="margin-top:6px">※ 系統ラベルは主要種牡馬のみの簡易判定です。騎手の所属（美浦/栗東/その他）は db.sp.netkeiba の騎手プロフィールから取得（同じ名前・騎手IDに紐づく場合のみ）。騎手IDを取得できない過去回・騎手は「所属」欄が空欄です。</div>');
  box.innerHTML = html.join('');
}
/* ===== ⑥の対象レース解決（①データ入力 ⇄ 📅カレンダー ⇄ 📊分析 を連携させる） =====
   2026-09-11修正: 以前は📊のボタンが「①で読み込んだレース」しか見ておらず、
   ⑥のカレンダーからレースを選んでも📊側は「分析するレースがまだありません」のままだった。 */
function drPickRid(){
  var rid = '';
  try { rid = String((state && state.raceId) || '').trim(); } catch(e){}
  var sel = {};
  try { sel = (state && state.gradeSel) || {}; } catch(e){}
  var hasImp = /^\d{12}$/.test(rid), hasCal = /^\d{12}$/.test(String(sel.rid || ''));
  /* 2026-09-11: ①で出馬表を読み込んだあとに📅カレンダーでレースを選んだら、
     📊分析・🧬血統ファクター・🏛過去データはすべて「カレンダーで選んだレース」に切り替わります。
     逆にカレンダー選択後に①で新しい出馬表を読み込めば、そちらが対象に戻ります。 */
  var impAt = 0, calAt = 0;
  try { impAt = parseInt(state && state.raceAt, 10) || 0; } catch(e){}
  try { calAt = parseInt(sel.at, 10) || 0; } catch(e){}
  if (hasCal && calAt > impAt) return { rid: String(sel.rid), from: '📅カレンダー' };
  if (hasImp) return { rid: rid, from: '①データ入力' };
  if (hasCal) return { rid: String(sel.rid), from: '📅カレンダー' };
  try { if (DR_LAST && /^\d{12}$/.test(String(DR_LAST.rid || ''))) return { rid: String(DR_LAST.rid), from: '直近の分析' }; } catch(e){}
  return null;
}
/* 対象レースのグレード（📅カレンダーの行情報を優先） */
function drTargetGrade(){
  try {
    var sel = (state && state.gradeSel) || {};
    var pick = drPickRid();
    if (pick && pick.from === '📅カレンダー' && sel.grade) return String(sel.grade);
    var nm = drTargetName();
    var m = nm.match(/\((G[123]|Jpn[123]?)\)/) || nm.match(/(G[123])/);
    if (m) return m[1];
    try { if ((state.race && state.race.grade) && pick && pick.from === '①データ入力') return String(state.race.grade); } catch(e){}
  } catch(e){}
  return '';
}
/* 対象レースが切り替わったら、連動する表示（🏛過去データ・🧬血統）も更新する */
function drTargetChanged(){
  try { if (typeof histRefreshHeader === 'function') histRefreshHeader(); } catch(e){}
  try { if (typeof bfRenderTarget === 'function') bfRenderTarget(); } catch(e){}
  try { if (typeof drRenderPick === 'function') drRenderPick(); } catch(e){}
}
function drTargetName(){
  var sel = {};
  try { sel = (state && state.gradeSel) || {}; } catch(e){}
  var impAt = 0, calAt = 0;
  try { impAt = parseInt(state && state.raceAt, 10) || 0; } catch(e){}
  try { calAt = parseInt(sel.at, 10) || 0; } catch(e){}
  var nm = '';
  if (sel.name && calAt > impAt) nm = String(sel.name);          // 📅カレンダーの選択が新しければそれを優先
  if (!nm){ try { nm = String((state && state.race && state.race.name) || ''); } catch(e){} }
  if (!nm){ try { nm = String(sel.name || ''); } catch(e){} }
  if (!nm){ try { nm = String((DR_LAST && DR_LAST.name) || ''); } catch(e){} }
  return nm;
}
function drSetTarget(rid, name, extra){
  var g0 = {};
  try { g0 = (state && state.gradeSel) || {}; } catch(e){}
  var nm = String(name || g0.name || '');
  var gr = (extra && extra.grade) || g0.grade || '';
  if (!gr){ var m = nm.match(/\((G[123]|Jpn[123]?)\)/); if (m) gr = m[1]; }
  var g = { rid: String(rid || ''), name: nm, grade: gr,
    venue: (extra && extra.venue) || g0.venue || '', date: (extra && extra.date) || g0.date || '', at: Date.now() };
  try { state.gradeSel = g; if (typeof saveNow === 'function') saveNow(); } catch(e){}
  try { drTargetChanged(); } catch(e){}
  return g;
}
/* 📅カレンダーが保持している重賞日程（新しい年度ぶん）→ {year, rows} */
function drCalRows(){
  try {
    var ls = (typeof gcLs === 'function') ? gcLs() : null;
    var sched = (ls && ls.sched) || {};
    var ys = Object.keys(sched).filter(function(y){ return sched[y] && sched[y].length; })
      .sort(function(a, b){ return (+b) - (+a); });
    if (!ys.length) return null;
    return { year: +ys[0], rows: sched[ys[0]] };
  } catch(e){ return null; }
}
/* 対象レースを選ぶUI（#drPick）を描画。中身は差し替わるので操作は document 委任で受ける */
function drRenderPick(){
  var box = $('drPick'); if (!box) return;
  var pick = drPickRid();
  var nm = drTargetName();
  var cal = drCalRows();
  var h = [];
  h.push('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">');
  h.push('<span>🎯 対象レース: <b>' + esc(nm || (pick ? pick.rid : '未選択')) + '</b>' +
    (pick && nm ? '<span class="muted small">（' + esc(pick.from) + '）</span>' : '') + '</span>');
  if (cal && cal.rows && cal.rows.length){
    var byM = {}, ms = [];
    cal.rows.forEach(function(r){
      var m = parseInt(String(r.date || '').slice(4, 6), 10) || 0;
      if (!m) return;
      if (!byM[m]){ byM[m] = []; ms.push(m); }
      byM[m].push(r);
    });
    ms.sort(function(a, b){ return b - a; });
    var opts = ['<option value="">— ' + cal.year + '年の重賞から選ぶ —</option>'];
    ms.forEach(function(m){
      opts.push('<optgroup label="' + m + '月">');
      byM[m].forEach(function(r){
        var d = String(r.date || '');
        var v = d + '|' + (r.name || '') + '|' + (r.venue || '');
        opts.push('<option value="' + esc(v) + '">' + esc(d.slice(4, 6) + '/' + d.slice(6, 8) + ' ' +
          (r.grade || '') + ' ' + (r.name || '') + '（' + (r.venue || '') + '）') + '</option>');
      });
      opts.push('</optgroup>');
    });
    h.push('<select id="drSelRace" style="flex:1 1 240px;max-width:420px">' + opts.join('') + '</select>');
    h.push('<button type="button" class="btn" data-dract="pick">このレースを分析</button>');
  }
  h.push('</div>');
  h.push('<div class="small muted" style="margin-top:4px">' +
    (cal ? '' : '📅重賞カレンダーを読み込むと、このプルダウンからレースを選べるようになります。') +
    '上の📅カレンダーでレース名をクリックした場合も、この📊に同じ結果が自動で表示されます（①でレースURLを取り込めばそのレースが対象になります）。</div>');
  box.innerHTML = h.join('');
  var hint = $('drTargetHint');
  if (hint) hint.textContent = nm ? ('対象: ' + nm) : '対象: ①で読み込んだレース／📅カレンダーで選んだレース';
}
/* プルダウンで選んだレースを分析（日程には race_id が無いので⑥カレンダーと同じ経路で解決） */
function drRunPick(){
  var sel = $('drSelRace');
  var v = sel ? String(sel.value || '') : '';
  if (!v){ drMsgSet('上のプルダウンでレースを選んでから「このレースを分析」を押してください。', true); return; }
  var p = v.split('|');
  var date8 = p[0] || '', name = p[1] || '', venue = p[2] || '';
  drSetTarget('', name, { venue: venue, date: date8 });
  drMsgSet('「' + name + '」のレースIDを照合しています…');
  drStat('読み込み中…');
  if (typeof gcResolveRid !== 'function' || !date8 || !name){
    drMsgSet('レースIDを解決できません。📅カレンダーを読み直してからお試しください。', true);
    return;
  }
  gcResolveRid(date8, name, function(m){ drMsgSet(m); }, venue).then(function(rid){
    if (!rid){
      // race_id がまだ無い（今年の後半など開催前）→ レース名から過去開催を集計する
      drSetTarget('', name, { venue: venue, date: date8 });
      drRenderPick();
      drRunForName(name, venue, date8, '');
      return;
    }
    drSetTarget(rid, name, { venue: venue, date: date8 });
    drRenderPick();
    drRunForRid(rid, name);
  }).catch(function(e){ drMsgSet(String((e && e.message) || e), true); });
}
/* race_id がまだ無いレース（今年の後半など未掲載・開催前）を「レース名」から集計する。
   過去10年の集計に今年の race_id は不要で、netkeiba DB のレース名検索が過去の同名レースを引く。 */
function drAnalyzeByName(name, venue, date8, dist, progress){
  progress = progress || function(){};
  if (!name) return Promise.reject(new Error('レース名がありません'));
  var d8 = String(date8 || '');
  var now = new Date();
  var inf = {
    rid: '', name: String(name), venue: String(venue || ''),
    year: parseInt(d8.slice(0, 4), 10) || now.getFullYear(),
    month: parseInt(d8.slice(4, 6), 10) || (now.getMonth() + 1),
    surf: '', dist: parseInt(String(dist == null ? '' : dist).replace(/[^0-9]/g, ''), 10) || 0
  };
  // 日程の距離表記（例: '芝1600' / 'ダ1800'）から面も拾う（芝⇄ダの別レースを混ぜないため）
  var dtext = String(dist == null ? '' : dist);
  var surf0 = /障/.test(dtext) ? '障' : (/ダ/.test(dtext) ? 'ダ' : (/芝/.test(dtext) ? '芝' : ''));
  var dist0 = parseInt(dtext.replace(/[^0-9]/g, ''), 10) || 0;
  inf.surf = surf0; inf.dist = dist0;
  var out = { name: String(name), rid: '', samples: [], tables: [], errors: [], base: 0 };
  progress('レース名「' + name + '」の過去開催を netkeiba DB から探しています…（今年のレースIDは未確定のため使いません）');
  return drAnalyzeFromInf(inf, {}, progress, out).then(function(res){
    res = res || out;
    if (!res.name) res.name = String(name);
    res.byName = true;          // 「レース名から集計した」目印（表示に注記を出す）
    return res;
  });
}
/* 分析結果の共通の後処理（表示・対象レースの記憶・完了メッセージ） */
function drFinishRun(res, name, rid, viaName){
  drRenderAll(res);
  var nm = (res && res.name) || name || '';
  var ls = drLs();
  ls.last = { name: nm, at: Date.now(), count: (res.samples || []).length };
  drSave(ls);
  /* 2026-09-11 第11弾: ここで DR_LAST を「rid/name だけ」で上書きしていたため、
     drRenderAll() が入れた samples（＝実際に集計に使った1〜3着馬）が消え、
     🧬血統ファクターが常に「⑥の分析データがありません」になっていた。→ samples を保持したまま補完する。 */
  try {
    if (res && typeof res === 'object' && res.samples && res.samples.length){
      if (!res.rid) res.rid = String(rid || '');
      if (!res.name) res.name = nm;
      res.at = Date.now();
      DR_LAST = res;
    } else {
      DR_LAST = { rid: String(rid || (res && res.rid) || ''), name: nm, at: Date.now() };
    }
  } catch(e){}
  drSetTarget(rid || '', nm);
  drRenderPick();
  var all = (res.tables && res.tables.all) || { n: 0 };
  drMsgSet('✅ 完了: 「' + nm + '」の過去 ' + ((res.racesUsed || []).length || res.yearsUsed || 0) +
    ' 回・出走延べ ' + all.n + '頭を集計しました。' +
    (viaName ? '（今年のレースIDがまだ無いため、レース名から過去開催を集計しました）' : ''), false);
  drStat('最終更新: ' + new Date().toLocaleString('ja-JP') + '　対象: ' + esc(nm || rid));
  /* ★2026-09-13 第20弾: 🤖自動マクロ(D) — ⑥の過去10年分析が終わり次第、
     ⑦の「🧬 血統を抽出して今回の出走馬を検出」を自動で続けます。
     📅カレンダーからの選択・①からの取込・⑥のボタン、どの経路でも drFinishRun に集まるので
     ここで連鎖させます。①の「🤖 自動マクロ」カードの☑「(D) ⑥→🧬血統まで自動」でOFFにできます。 */
  try { if (typeof amDrChain === 'function') amDrChain(res); } catch(e){}
}
/* レース名だけを指定して📊側の分析を実行（rid が無いレース用） */
function drRunForName(name, venue, date8, dist){
  var b = $('drBtn'); if (b) b.disabled = true;
  drMsgSet('このレースはまだ race_id がありません（開催前・netkeiba未掲載）。レース名から過去10年を集計します…');
  drStat('読み込み中…');
  drAnalyzeByName(name, venue, date8, dist, function(m){ drMsgSet(m); }).then(function(res){
    drFinishRun(res, name, '', true);
  }).catch(function(e){
    drMsgSet(String((e && e.message) || e), true);
    drStat('');
  }).finally(function(){
    if (b) b.disabled = false;
  });
}
/* rid を指定して📊側の分析を実行（①の state.race は書き換えない） */
function drRunForRid(rid, name){
  var b = $('drBtn'); if (b) b.disabled = true;
  drMsgSet('分析を開始します…（初回は1〜3分。進行状況が下に出ます）');
  drStat('読み込み中…');
  drAnalyzeRid(rid, {}, function(m){ drMsgSet(m); }).then(function(res){
    drFinishRun(res, name, rid, false);
  }).catch(function(e){
    drMsgSet(String((e && e.message) || e), true);
    drStat('');
  }).finally(function(){
    if (b) b.disabled = false;
  });
}
/* 旧 drMirror（📅カレンダーの結果を📊にも写す）は、表示先を📊カード1枚に統合したため廃止しました。
   カレンダー側のクリックは gcAnalyzeRid → drFinishRun で直接ここに描画されます。 */
function drRun(force){
  // 対象レース: ①で読み込んだレース → 📅カレンダーで選んだレース → 直近の分析（の順）
  var hasRace = !!((state && state.race && state.race.name) || (state && state.raceId));
  var pick = drPickRid();
  if (!hasRace){
    if (pick){ drRunForRid(pick.rid, drTargetName()); return; }
    // race_id は無いが名前だけ決まっている（開催前の重賞を📅カレンダーで選んだ等）→ 名前から集計する
    var nmOnly = drTargetName();
    var sel0 = {};
    try { sel0 = (state && state.gradeSel) || {}; } catch(e){}
    if (nmOnly){ drRunForName(nmOnly, sel0.venue || '', sel0.date || '', ''); return; }
    // どれも無いときは、何をすればよいか具体的に案内する（無反応に見えるのを防ぐ）
    drMsgSet('分析するレースがまだありません。上の📅重賞カレンダーのレース名をクリックするか、' +
      'このカードのプルダウンで重賞を選ぶか、①「データ入力」でレースURLを取り込んでください。', true);
    drRenderPick();
    var cv = $('drCard'); if (cv) cv.classList.remove('hid');
    return;
  }
  var b = $('drBtn'); if (b) b.disabled = true;
  drMsgSet('分析を開始します…（初回は1〜3分。進行状況が下に出ます）');
  drStat('読み込み中…');
  drRunAll(function(m){ drMsgSet(m); }).then(function(res){
    res.name = (state && state.race && state.race.name) || res.name || '';
    drRenderAll(res);
    var ls = drLs();
    ls.last = { name: res.name || '', at: Date.now(), count: (res.samples || []).length };
    drSave(ls);
    drRenderPick();
    drMsgSet('✅ 完了: 過去 ' + (res.samples || []).length + ' 件（出走延べ ' + (res.tables.all ? res.tables.all.n : 0) + '頭）を集計しました。', false);
    drStat('最終更新: ' + new Date().toLocaleString('ja-JP') + '　対象: ' + esc(res.name || ''));
  }).catch(function(e){
    drMsgSet((e && e.message) || String(e), true);
  }).finally(function(){
    if (b) b.disabled = false;
  });
}
function drClearCache(){
  try { localStorage.removeItem(DR_LS); } catch(e){}
  drMsgSet('分析キャッシュを消去しました。');
  var box = $('drOut'); if (box) box.innerHTML = '';
  drStat('');
}
function initDr(){
  var b = $('drBtn');
  if (b) b.addEventListener('click', function(){ drRun(false); });
  var c = $('drClear');
  if (c) c.addEventListener('click', drClearCache);
  drRenderPick();
  // #drPick の中身は差し替わる（＝要素に直接 bind すると消える）ため document 委任で受ける
  if (!initDr._bound){
    initDr._bound = true;
    document.addEventListener('click', function(e){
      var t = e && e.target;
      // 表の「年別」内訳の開閉（前走レース別など）
      var sb = (t && t.closest) ? t.closest('[data-drsub]') : null;
      if (sb){
        e.preventDefault();
        var tr = document.getElementById(sb.getAttribute('data-drsub'));
        if (tr){
          var open = tr.style.display !== 'none';
          tr.style.display = open ? 'none' : '';
          var ar = sb.querySelector ? sb.querySelector('.ar') : null;
          if (ar) ar.textContent = open ? '▸' : '▾';
          sb.classList[open ? 'remove' : 'add']('open');
        }
        return;
      }
      var btn = (t && t.closest) ? t.closest('[data-dract]') : null;
      if (!btn) return;
      if (btn.getAttribute('data-dract') === 'pick'){ e.preventDefault(); drRunPick(); }
    });
  }
  // 直前の分析を再表示
  try {
    var ls = drLs();
    if (ls.last && ls.last.name){
      var s2 = $('drStat'); if (s2) s2.textContent = '前回分析: ' + (ls.last.name || '') + '（' + (ls.last.count || 0) + '件）';
    }
  } catch(e){}
  // 前回のカレンダー選択を復元（①を読み込まなくても📊が動くように）
  try {
    var g0 = (state && state.gradeSel) || null;
    if (g0 && g0.rid && !drTargetName()) drSetTarget(g0.rid, g0.name || '');
  } catch(e){}
}
