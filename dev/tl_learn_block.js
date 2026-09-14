/* =========================================================
   🎓 タイム換算の学習
   （④「年指定で過去データを自動取込（学習DB用・JRA全レース）」と連携）
   ---------------------------------------------------------
   学習DB（JRA全レースの勝ち時計）と馬柱キャッシュ（着差から復元した勝ち時計）から、
   「距離 × クラス × 年齢 × 競馬場 × 年 × 馬場」の**基準時計そのもの**を学習します。
   結果は khl_tllearn_v1 に保存し、tlBaseSec() と tlBabaAdj() が学習値を優先して使います。
   学習データが無ければ従来の静的テーブル（PAR_TIME＋クラス補正）のままなので、動きは変わりません。

   ■ モデルのかたち（2段）
     基準時計 = 距離レベル(面|距離)
              + クラス補正(面|クラス) + 年齢補正(面|2歳/3歳/3歳以上/4歳以上)
              + 競馬場補正(面|場) + 年補正(年) + 距離×クラスの個別補正(件数が十分ある組合せだけ)
     → 主効果（距離・クラス・年齢・場・年）はどの組み合わせでも埋まるので、
       「ダート3400mのG1」のような珍しい条件でも基準時計が出せます（＝馬柱の母集団と基準がズレない）。
       件数がある組み合わせだけは、さらに個別補正を足して精度を上げます。

   ■ 学習のしかた（メディアンポリッシュ＝中央値を順番に抜いていく）
     1. 「面|距離」のセルごとに勝ち時計の**中央値**を抜く（＝距離レベル）
     2. 残りを「面|クラス」→「面|年齢」→「面|競馬場」→「年」の順に抜く（＝それぞれの補正）
     3. 良以外で走ったサンプルに残った残りの中央値＝使った馬場補正の誤差 → **馬場補正を学習**
     4. 学習した馬場補正でもう一度良換算し直して 1〜3 を繰り返す（2回で収束）
     5. 最後に「面|距離|クラス」の組み合わせで残りを抜く（＝個別補正）
     平均でなく中央値を使うのは、新馬戦・少頭数・極端な馬場などの外れ値に引っ張られないため。
     件数が足りないグループ（n < しきい値）は**補正をかけずに捨てる**ので、
     珍しい条件の外れ値が競馬場補正や年補正を壊しません（旧版で ダ|東京 +77.9秒 が出た不具合の対策）。

   ■ いつ学習するか
     ・年指定の一括取込が終わったとき（自動・結果を表示）
     ・日付指定/バックアップ復元の取込が終わったとき（6秒デバウンスで自動）
     ・「🎓 学習し直す」ボタン（手動）
   学習すると②⏱カードの判定基準がその場で切り替わり、出走馬がいれば自動で評価し直します。
   ========================================================= */
var TL_LEARN_LS = 'khl_tllearn_v1';
var TL_LEARN_MIN = 8;          // 距離×クラスの個別補正: この件数以上あれば上乗せ
var TL_LEARN_MIND = 10;        // 距離レベル・クラス補正
var TL_LEARN_MINV = 15;        // 競馬場・年・年齢の補正
var TL_LEARN_MINB = 10;        // 馬場補正
var TL_LEARN_MIN_TOTAL = 60;   // これよりサンプルが少ないと学習しない（ノイズのほうが多い）
var TL_LEARN_CLS = ['新馬', '未勝利', '1勝クラス', '2勝クラス', '3勝クラス', '特別', 'OP', 'L', 'G3', 'G2', 'G1'];
var TL_LEARN_AGES = ['2歳', '3歳', '3歳以上', '4歳以上'];
var TL_JRA_VENUES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
var tlLearnMem = null, tlLearnTimer = null;

/* ---------- 保存/読込 ---------- */
function tlLearnLoad(){
  if (tlLearnMem) return tlLearnMem;
  try {
    var o = JSON.parse(localStorage.getItem(TL_LEARN_LS) || 'null');
    tlLearnMem = (o && o.dist) ? o : null;
  } catch(e){ tlLearnMem = null; }
  return tlLearnMem;
}
function tlLearnSave(m){
  try { localStorage.setItem(TL_LEARN_LS, JSON.stringify(m)); tlLearnMem = m; return true; }
  catch(e){ tlLearnMem = m; return false; }
}
function tlLearnClear(){
  try { localStorage.removeItem(TL_LEARN_LS); } catch(e){}
  tlLearnMem = null;
}
function tlLearnReady(m){ return !!(m && m.dist && m.nS >= TL_LEARN_MIN_TOTAL); }
function tlLearnHas(){ return tlLearnReady(tlLearnLoad()); }

/* ---------- 分類（学習時も評価時も同じ関数を使う＝ズレない） ---------- */
function tlLearnCls(name, grade){
  var n = String(name || '');
  var g = String(grade || '').replace(/\s+/g, '').toUpperCase();
  var t = g || String((n.match(/[(（]\s*(G\s*(?:III|II|I|3|2|1)|Jpn\s*[123]|L|OP|LISTED)\s*[)）]/i) || [])[1] || '').replace(/\s+/g, '').toUpperCase();
  if (/^JPN1$/.test(t) || /^G(I|1)$/.test(t)) return 'G1';
  if (/^JPN2$/.test(t) || /^G(II|2)$/.test(t)) return 'G2';
  if (/^JPN3$/.test(t) || /^G(III|3)$/.test(t)) return 'G3';
  if (t === 'L' || t === 'LISTED') return 'L';
  if (t === 'OP' || /オープン/.test(n)) return 'OP';
  if (/新馬|メイドン/.test(n)) return '新馬';
  var c = tlClassOf(n);
  if (c) return c;
  return '特別';
}
function tlLearnSurf(x){
  var s = String(x || '');
  return s.indexOf('ダ') >= 0 ? 'ダ' : (s.indexOf('障') >= 0 ? '障' : '芝');
}
/* 年齢区分（レース名から）。2歳戦は明らかに時計がかかるのでクラスとは別に補正します */
function tlLearnAge(name){
  var n = String(name || '');
  if (/2歳/.test(n)) return '2歳';
  if (/3歳以上/.test(n)) return '3歳以上';
  if (/4歳以上/.test(n)) return '4歳以上';
  if (/3歳/.test(n)) return '3歳';
  return '';
}

/* ---------- サンプル集め: 学習DB（年指定の一括取込）＋馬柱キャッシュ ---------- */
function tlLearnSamples(){
  var out = [], seen = {}, nDb = 0, nHd = 0, bad = 0, drop = 0;
  function push(o){
    if (!o) return;
    var sf = tlLearnSurf(o.surface);
    if (sf === '障') { drop++; return; }                       // 障害は時計の土俵が違う
    var m = parseInt(o.m, 10);
    if (!(m >= 800 && m <= 4000)) { drop++; return; }
    var sec = parseFloat(o.sec);
    if (!(sec > 20 && sec < 500)) { drop++; return; }
    var d8 = tlD8(o.d8);
    if (!d8) { drop++; return; }
    var ven = String(o.venue || '');
    if (TL_JRA_VENUES.indexOf(ven) < 0) { drop++; return; }     // 地方・海外は時計の土俵が違う
    var cls = o.cls || tlLearnCls(o.name, o.grade);
    // 同じレース（同日・同場・同名・同距離・同勝ち時計）は1件に集約
    var k = d8 + '|' + ven + '|' + sf + '|' + m + '|' + cls + '|' + Math.round(sec * 10);
    if (seen[k]) return;
    seen[k] = 1;
    out.push({ d8: d8, year: d8.slice(0, 4), venue: ven, surface: sf, m: m, cls: cls,
               age: tlLearnAge(o.name), baba: tlBaba(o.baba) || '', sec: sec, name: o.name || '', src: o.src || '' });
  }
  /* 1) 学習DB: ④で年指定取込したJRA全レース（1着のタイムをそのまま使う） */
  try {
    var db = (typeof diLs === 'function') ? diLs() : null;
    var races = (db && db.races) || {};
    Object.keys(races).forEach(function(rid){
      var rec = races[rid];
      if (!rec || !rec.meta) return;
      var rows = rec.rows || [];
      if (!rows.length) return;
      var w = null;
      for (var i = 0; i < rows.length; i++){ if (parseInt(rows[i].order, 10) === 1){ w = rows[i]; break; } }
      if (!w) w = rows[0];
      var sec = (typeof nkToSec === 'function') ? nkToSec(w.time) : null;
      if (!sec){ bad++; return; }
      push({ d8: rec.meta.date8 || String(rid).slice(0, 8), venue: rec.meta.place, surface: rec.meta.surface,
             m: rec.meta.m, baba: rec.meta.baba, name: rec.meta.name, grade: rec.meta.grade, sec: sec, src: 'db' });
      nDb++;
    });
  } catch(e){}
  /* 2) 馬柱キャッシュ: 1着以外の行も「自分の時計 − 着差」で勝ち時計を復元して使う */
  try {
    var ls = (typeof hdLs === 'function') ? hdLs() : {};
    var best = {};
    Object.keys(ls).forEach(function(nk){
      var rows = (ls[nk] && ls[nk].r) || [];
      rows.forEach(function(r){
        if (!r) return;
        var ord = parseInt(r.order, 10);
        if (!(ord >= 1)) return;
        var sec0 = (typeof nkToSec === 'function') ? nkToSec(r.time) : null;
        if (!sec0) return;
        var wsec;
        if (ord === 1) wsec = sec0;
        else {
          var gp = parseFloat(String(r.margin || '').replace(/[^0-9.]/g, ''));
          if (!isFinite(gp) || gp < 0 || gp > 20) return;
          wsec = sec0 - gp;                                      // 着差は「勝ち馬までの秒差」なので引く
        }
        var d8 = tlD8(r.date);
        var rk = d8 + '|' + (r.venueName || '') + '|' + String(r.r || '') + '|' + (r.name || '') + '|' + r.m;
        var prev = best[rk];
        if (!prev || ord < prev.order) best[rk] = { order: ord, sec: wsec, d8: d8, venue: r.venueName, surface: r.surface, m: r.m, baba: r.baba, name: r.name };
      });
    });
    Object.keys(best).forEach(function(k){
      var b = best[k];
      push({ d8: b.d8, venue: b.venue, surface: b.surface, m: b.m, baba: b.baba, name: b.name, sec: b.sec, src: 'hd' });
      nHd++;
    });
  } catch(e){}
  return { list: out, nDb: nDb, nHd: nHd, bad: bad, drop: drop };
}

/* ---------- メディアンポリッシュ: グループごとの中央値を抜いて store に積む ----------
   minN に満たないグループは補正せず、そのサンプルに x.thin を立てて後の工程から外します
   （外すと、珍しい条件の外れ値が競馬場補正や年補正を壊しません） */
function tlAbsorb(list, store, keyFn, minN, asDelta, markThin){
  var grp = {};
  list.forEach(function(x){
    if (x.thin) return;
    var k = keyFn(x);
    if (!k) return;
    (grp[k] = grp[k] || []).push(x);
  });
  Object.keys(grp).forEach(function(k){
    var a = grp[k];
    if (a.length < minN){
      if (markThin) a.forEach(function(x){ x.thin = 1; });
      return;
    }
    var md = tlMedian(a.map(function(x){ return x.r; }));
    if (!isFinite(md)) return;
    var prev = store[k] || { s: 0, o: 0, n: 0 };
    store[k] = asDelta ? { o: +(prev.o + md).toFixed(3), n: a.length }
                       : { s: +(prev.s + md).toFixed(2), n: a.length };
    a.forEach(function(x){ x.r -= md; });
  });
  return store;
}
function tlLearnAdjUse(x, babaTbl){
  if (!x.baba || x.baba === '良') return 0;
  var k = x.surface + '|' + x.baba;
  if (babaTbl && babaTbl[k] && babaTbl[k].n >= TL_LEARN_MINB) return babaTbl[k].o;
  return tlBabaAdjStatic(x.baba, x.surface);
}
/* ---------- 学習本体 ---------- */
function tlLearnBuild(){
  var S = tlLearnSamples();
  var list = S.list || [];
  if (list.length < TL_LEARN_MIN_TOTAL) return { err: 'サンプル不足', nS: list.length, nDb: S.nDb, nHd: S.nHd };
  var model = {
    v: 2, at: new Date().toISOString(), nS: list.length, nDb: S.nDb, nHd: S.nHd, drop: S.drop, bad: S.bad,
    dist: {}, cls: {}, age: {}, ven: {}, yr: {}, baba: {}, cell: {}, nbaba: 0
  };
  var it;
  for (it = 0; it < 2; it++){
    list.forEach(function(x){ x.t = x.sec - tlLearnAdjUse(x, model.baba); x.r = x.t; x.thin = 0; });
    model.dist = {}; model.cls = {}; model.age = {}; model.ven = {}; model.yr = {};
    tlAbsorb(list, model.dist, function(x){ return x.surface + '|' + x.m; }, TL_LEARN_MIND, false, true);
    tlAbsorb(list, model.cls, function(x){ return x.surface + '|' + x.cls; }, TL_LEARN_MIND, true, false);
    tlAbsorb(list, model.age, function(x){ return x.age ? (x.surface + '|' + x.age) : ''; }, TL_LEARN_MINV, true, false);
    tlAbsorb(list, model.ven, function(x){ return x.surface + '|' + x.venue; }, TL_LEARN_MINV, true, false);
    tlAbsorb(list, model.yr, function(x){ return x.year; }, TL_LEARN_MINV, true, false);
    /* 馬場補正: 良以外に残った残りの中央値＝いま使った補正の誤差 → 学習値 = 使った値 + 誤差 */
    var bg = {};
    list.forEach(function(x){
      if (x.thin || !x.baba || x.baba === '良') return;
      var k = x.surface + '|' + x.baba;
      (bg[k] = bg[k] || []).push(x.r);
    });
    var nb = {};
    Object.keys(bg).forEach(function(k){
      var a = bg[k];
      if (a.length < TL_LEARN_MINB) return;
      var md = tlMedian(a);
      if (!isFinite(md)) return;
      var p = k.split('|');
      var used = tlLearnAdjUse({ surface: p[0], baba: p[1] }, model.baba);
      nb[k] = { o: +(used + md).toFixed(3), n: a.length };
    });
    model.baba = nb;
    model.nbaba = Object.keys(nb).length;
  }
  /* 距離×クラスの個別補正（主効果で取りきれない交互作用。件数がある組合せだけ） */
  list.forEach(function(x){ x.r0 = x.r; });
  model.cell = {};
  tlAbsorb(list, model.cell, function(x){ return x.surface + '|' + x.m + '|' + x.cls; }, TL_LEARN_MIN, true, false);
  /* 学習の当てはまり（残りのバラつき）と、静的テーブルとの差 */
  var used = list.filter(function(x){ return !x.thin; });
  var ab = used.map(function(x){ return Math.abs(x.r); });
  model.fitMae = ab.length ? +(ab.reduce(function(a, b){ return a + b; }, 0) / ab.length).toFixed(2) : 0;
  model.nThin = list.length - used.length;
  model.dists = { '芝': [], 'ダ': [] };
  Object.keys(model.dist).forEach(function(k){
    var p = k.split('|');
    if (model.dists[p[0]]) model.dists[p[0]].push(+p[1]);
  });
  Object.keys(model.dists).forEach(function(sf){ model.dists[sf].sort(function(a, b){ return a - b; }); });
  model.years = Object.keys(model.yr).sort();
  var diffs = [];
  model.dists['芝'].concat(model.dists['ダ']).forEach(function(){});
  Object.keys(model.dist).forEach(function(kd){
    var sf = kd.split('|')[0], d = +kd.split('|')[1];
    TL_LEARN_CLS.forEach(function(c){
      var st = tlBaseSecStatic(sf, d, c);
      if (st == null) return;
      var L = tlLearnBaseOf(model, sf, d, c, '', '', '');
      if (L == null) return;
      diffs.push({ k: sf + '|' + d + '|' + c, learn: +L.toFixed(2), stat: +st.toFixed(2), d: +(L - st).toFixed(2) });
    });
  });
  diffs.sort(function(a, b){ return Math.abs(b.d) - Math.abs(a.d); });
  model.diffTop = diffs.slice(0, 8);
  model.diffAvg = diffs.length ? +(diffs.reduce(function(a, x){ return a + x.d; }, 0) / diffs.length).toFixed(2) : 0;
  model.cells = Object.keys(model.cell).length;
  return model;
}

/* ---------- モデルから基準時計を組み立てる（内部） ---------- */
function tlLearnBaseOf(M, surface, m, cls, venue, d8, age){
  if (!tlLearnReady(M)) return null;
  var S = tlLearnSurf(surface);
  if (S === '障') return null;
  m = parseInt(m, 10);
  if (!m) return null;
  cls = cls || '特別';
  /* 1) 距離レベル（無ければ前後の距離から線形補間／両端は傾きで外挿・400m超は使わない） */
  var ds = [];
  Object.keys(M.dist).forEach(function(k){
    var p = k.split('|');
    if (p[0] !== S) return;
    if ((M.dist[k].n || 0) < TL_LEARN_MIND) return;
    ds.push({ m: +p[1], s: M.dist[k].s });
  });
  if (!ds.length) return null;
  ds.sort(function(a, b){ return a.m - b.m; });
  var lo = null, hi = null, sec;
  ds.forEach(function(x){ if (x.m <= m) lo = x; if (x.m >= m && hi == null) hi = x; });
  if (lo && hi && lo.m !== hi.m) sec = lo.s + (hi.s - lo.s) * (m - lo.m) / (hi.m - lo.m);
  else if (lo && hi) sec = lo.s;
  else {
    var e = lo || hi;
    if (Math.abs(e.m - m) > 400) return null;
    var slope = ds.length >= 2 ? (ds[ds.length - 1].s - ds[0].s) / (ds[ds.length - 1].m - ds[0].m) : (e.s / e.m);
    sec = e.s + slope * (m - e.m);
  }
  if (!(sec > 10)) return null;
  /* 2) 主効果の補正 */
  function addO(tbl, k, minN){
    if (!tbl || !k) return;
    var e = tbl[k];
    if (e && e.n >= minN) sec += e.o;
  }
  addO(M.cls, S + '|' + cls, TL_LEARN_MIND);
  addO(M.age, age ? (S + '|' + age) : '', TL_LEARN_MINV);
  addO(M.ven, venue ? (S + '|' + venue) : '', TL_LEARN_MINV);
  var y = String(tlD8(d8) || '').slice(0, 4);
  if (y && M.yr){
    if (M.yr[y] && M.yr[y].n >= TL_LEARN_MINV) sec += M.yr[y].o;
    else {
      var bestY = null;
      Object.keys(M.yr).forEach(function(k){
        var dd = Math.abs(parseInt(k, 10) - parseInt(y, 10));
        if (dd > 2 || dd === 0 || !(M.yr[k].n >= TL_LEARN_MINV)) return;
        if (!bestY || dd < bestY.d) bestY = { d: dd, o: M.yr[k].o };
      });
      if (bestY) sec += bestY.o;
    }
  }
  /* 3) 距離×クラスの個別補正 */
  addO(M.cell, S + '|' + m + '|' + cls, TL_LEARN_MIN);
  return sec;
}
/* ---------- 学習値の参照（基準時計） ---------- */
function tlLearnBase(surface, m, cls, venue, d8, age){
  return tlLearnBaseOf(tlLearnLoad(), surface, m, cls, venue, d8, age);
}
/* ---------- 学習値の参照（馬場補正） ---------- */
function tlLearnBabaAdj(baba, surface){
  var b = tlBaba(baba);
  if (!b || b === '良') return 0;
  var M = tlLearnLoad();
  if (!tlLearnReady(M) || !M.baba) return null;
  var e = M.baba[tlLearnSurf(surface) + '|' + b];
  return (e && e.n >= TL_LEARN_MINB) ? e.o : null;
}

/* ---------- 実行（学習して保存して表示） ---------- */
function tlLearnRun(auto, quiet){
  var t0 = Date.now();
  var m = tlLearnBuild();
  if (m && m.err){
    if (!auto) tlLearnMsg('🎓 学習できませんでした: ' + m.err + '（集まった勝ち時計 ' + (m.nS || 0) + ' 件／学習DB ' + (m.nDb || 0) + ' レース＋馬柱 ' + (m.nHd || 0) + ' レース）。④で年を指定して過去データを取り込むと学習できます。', true);
    tlLearnRender();
    return null;
  }
  if (!m) return null;
  var saved = tlLearnSave(m);
  m.ms = Date.now() - t0;
  var msg = '🎓 タイム換算を学習しました: 勝ち時計 ' + m.nS + ' 件（学習DB ' + m.nDb + ' レース＋馬柱 ' + m.nHd + ' レース）から ' +
    '距離 ' + Object.keys(m.dist).length + '・クラス ' + Object.keys(m.cls).length + '・年齢 ' + Object.keys(m.age).length +
    '・競馬場 ' + Object.keys(m.ven).length + '・年 ' + Object.keys(m.yr).length + '・馬場 ' + m.nbaba +
    '・距離×クラスの個別補正 ' + m.cells + '（当てはまり MAE ' + m.fitMae + '秒／' + m.ms + 'ms）' +
    (saved ? '' : '　⚠ 保存領域が足りず保存できませんでした');
  if (!quiet) tlLearnMsg(msg, !saved);
  /* 判定基準が切り替わったので、出走馬がいれば評価し直す（出馬表の🎯/⚠️も更新） */
  try {
    var hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : [];
    if (hs && hs.length){
      var r = tlScanAll(!!auto);
      if (typeof tlRender === 'function') tlRender();
      if (typeof rebuildHorseTable === 'function') rebuildHorseTable();
      if (!quiet) tlLearnMsg(msg + '　→ ⏱の評価も新しい基準でやり直しました（' + r.n + ' 頭／🎯 ' + r.fast + '／⚠️ ' + r.slow + '）', !saved);
    }
  } catch(e){}
  tlLearnRender();
  return m;
}
/* 取込が終わるたびに呼ぶ（連続取込中はまとめて1回だけ学習するようにデバウンス） */
function tlLearnSchedule(delay){
  try { if (tlLearnTimer) clearTimeout(tlLearnTimer); } catch(e){}
  tlLearnTimer = setTimeout(function(){
    tlLearnTimer = null;
    try { tlLearnRun(true, true); } catch(e){}
  }, delay || 6000);
}
function tlLearnMsg(m, err){
  var e = $('tlLearnMsg');
  if (e) e.innerHTML = m ? '<span' + (err ? ' style="color:var(--err-ink)"' : '') + '>' + esc(m) + '</span>' : '';
}

/* ---------- 表示 ---------- */
function tlLearnWhen(m){
  var a = String((m && m.at) || '');
  if (!a) return '';
  var d = new Date(a);
  if (isNaN(d.getTime())) return a.slice(0, 10);
  return d.getFullYear() + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) +
    ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
/* ⏱カードの上部に出す「いま使っている基準」の1行 */
function tlLearnUseHTML(){
  var m = tlLearnLoad();
  if (!tlLearnReady(m)) return '';
  return '<div class="small" style="margin:0 0 6px;padding:4px 8px;border:1px solid var(--line2);border-radius:8px;background:var(--card2)">' +
    '🎓 <b>学習した基準時計を使用しています</b>（勝ち時計 ' + m.nS + ' 件＝学習DB ' + m.nDb + ' レース＋馬柱 ' + m.nHd +
    ' レース／距離・クラス・年齢・競馬場・年・馬場を学習値で換算・学習 ' + tlLearnWhen(m) + '）' +
    '　<span class="muted">④で年を取り込むと自動で学習し直します。学習データが無い条件は従来の基準時計（パータイム＋クラス補正）を使います。</span></div>';
}
function tlLearnChips(tbl, minN, fmt){
  var ks = Object.keys(tbl || {}).filter(function(k){ return tbl[k].n >= minN; });
  ks.sort(function(a, b){ return tbl[a].o - tbl[b].o; });
  return ks.map(function(k){
    return '<span class="chip" style="font-size:.7rem">' + fmt(k, tbl[k]) + '</span>';
  }).join(' ');
}
function tlLearnRender(){
  var chip = $('tlLearnChip'), stat = $('tlLearnStat'), tbl = $('tlLearnTbl');
  var m = tlLearnLoad();
  if (chip) chip.textContent = tlLearnReady(m) ? ('学習済み ' + m.nS + ' 件') : '未学習';
  if (!stat || !tbl) return;
  if (!tlLearnReady(m)){
    stat.innerHTML = '<span class="muted">まだ学習していません。いまは<b>基準時計の静的テーブル（パータイム＋クラス補正）</b>で判定しています。' +
      '④で年を指定して過去データを取り込むと、その年のJRA全レースの勝ち時計から基準を学習して自動で切り替わります。</span>';
    tbl.innerHTML = '';
    return;
  }
  stat.innerHTML = '学習: <b>' + tlLearnWhen(m) + '</b>　勝ち時計 <b>' + m.nS + '</b> 件（学習DB ' + m.nDb + ' レース／馬柱 ' + m.nHd + ' レース・使わなかった ' + (m.drop || 0) + ' 件）' +
    '　→ 距離 ' + Object.keys(m.dist).length + '・クラス ' + Object.keys(m.cls).length + '・年齢 ' + Object.keys(m.age).length +
    '・競馬場 ' + Object.keys(m.ven).length + '・年 ' + Object.keys(m.yr).length + '・馬場 ' + m.nbaba + '・個別補正 ' + m.cells +
    '<br><span class="muted">当てはまり: 平均絶対誤差 <b>' + m.fitMae + '秒</b>（1レースの勝ち時計をこの誤差で言い当てられる）。' +
    '静的テーブルとの平均差 ' + (m.diffAvg > 0 ? '+' : '') + m.diffAvg + ' 秒。件数が足りないグループは補正しません（n&lt;' + TL_LEARN_MIN + '）。</span>';
  var h = [];
  ['芝', 'ダ'].forEach(function(sf){
    var ds = (m.dists && m.dists[sf]) || [];
    if (!ds.length) return;
    var cls = TL_LEARN_CLS.filter(function(c){ return (m.cls[sf + '|' + c] || { n: 0 }).n >= TL_LEARN_MIND; });
    h.push('<div style="font-weight:700;margin:8px 0 2px">' + (sf === '芝' ? '🌱 芝' : '🟤 ダート') +
      '　学習した基準時計（良馬場・3歳以上相当・競馬場/年の補正なし・秒）</div>');
    h.push('<div style="overflow-x:auto"><table class="ktbl" style="font-size:.72rem;white-space:nowrap">');
    h.push('<tr><th>距離</th>' + (cls.length ? cls.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') : '<th>基準</th>') + '</tr>');
    ds.forEach(function(d){
      var dl = m.dist[sf + '|' + d];
      var tds = (cls.length ? cls : ['']).map(function(c){
        var L = tlLearnBaseOf(m, sf, d, c || '特別', '', '', '');
        var st = c ? tlBaseSecStatic(sf, d, c) : null;
        if (L == null) return '<td class="muted">-</td>';
        var dd = (st != null) ? (L - st) : null;
        var ce = c ? m.cell[sf + '|' + d + '|' + c] : null;
        return '<td title="n=' + (dl ? dl.n : 0) + (ce ? '／個別補正 ' + (ce.o > 0 ? '+' : '') + ce.o.toFixed(2) + '秒(n=' + ce.n + ')' : '') +
          (dd != null ? '／静的テーブル比 ' + (dd > 0 ? '+' : '') + dd.toFixed(1) + '秒' : '') + '"><b>' + L.toFixed(1) + '</b>' +
          (dd != null && Math.abs(dd) >= 0.5 ? ' <span class="muted" style="font-size:.9em">(' + (dd > 0 ? '+' : '') + dd.toFixed(1) + ')</span>' : '') + '</td>';
      });
      h.push('<tr><th>' + d + 'm</th>' + tds.join('') + '</tr>');
    });
    h.push('</table></div>');
  });
  function sec2(v){ return (v > 0 ? '+' : '') + v.toFixed(2) + '秒'; }
  h.push('<div style="font-weight:700;margin:8px 0 2px">クラス補正（未勝利を0とした各クラスの差）</div><div class="small">');
  ['芝', 'ダ'].forEach(function(sf){
    var ks = TL_LEARN_CLS.filter(function(c){ return (m.cls[sf + '|' + c] || { n: 0 }).n >= TL_LEARN_MIND; });
    if (!ks.length) return;
    h.push('<div style="margin:2px 0">' + (sf === '芝' ? '🌱 芝' : '🟤 ダート') + ': ' + ks.map(function(c){
      var e = m.cls[sf + '|' + c];
      return '<span class="chip" style="font-size:.7rem">' + esc(c) + ' ' + sec2(e.o) + ' <span class="muted">n=' + e.n + '</span></span>';
    }).join(' ') + '</div>');
  });
  h.push('</div>');
  h.push('<div style="font-weight:700;margin:8px 0 2px">年齢区分の補正（＋＝時計がかかる／−＝速い）</div><div class="small">' +
    tlLearnChips(m.age, TL_LEARN_MINV, function(k, v){ var p = k.split('|'); return (p[0] === '芝' ? '🌱' : '🟤') + ' ' + esc(p[1]) + ' ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>'; }) + '</div>');
  h.push('<div style="font-weight:700;margin:8px 0 2px">競馬場補正（＋＝時計がかかる／−＝速い）</div><div class="small">' +
    tlLearnChips(m.ven, TL_LEARN_MINV, function(k, v){ var p = k.split('|'); return (p[0] === '芝' ? '🌱' : '🟤') + ' ' + esc(p[1]) + ' ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>'; }) + '</div>');
  h.push('<div style="font-weight:700;margin:8px 0 2px">年補正（コース改修や時計の出方の年差）</div><div class="small">' +
    tlLearnChips(m.yr, TL_LEARN_MINV, function(k, v){ return k + '年 ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>'; }) + '</div>');
  /* 馬場補正（学習値 vs 静的値） */
  var bk = Object.keys(m.baba);
  if (bk.length){
    h.push('<div style="font-weight:700;margin:8px 0 2px">馬場補正（良換算するために引く秒数）</div>');
    h.push('<table class="ktbl" style="font-size:.74rem"><tr><th>面</th><th>馬場</th><th>学習値</th><th>静的テーブル</th><th>差</th><th>件数</th></tr>');
    bk.sort().forEach(function(k){
      var p = k.split('|'), e = m.baba[k];
      var st = tlBabaAdjStatic(p[1], p[0]);
      h.push('<tr><td>' + (p[0] === '芝' ? '芝' : 'ダート') + '</td><td>' + esc(p[1]) + '</td><td><b>' + sec2(e.o) + '</b></td>' +
        '<td class="muted">' + sec2(st) + '</td><td>' + sec2(e.o - st) + '</td><td class="muted">' + e.n + '</td></tr>');
    });
    h.push('</table>');
  }
  if ((m.diffTop || []).length){
    h.push('<details style="margin-top:6px"><summary class="small">静的テーブルとの差が大きい条件 上位' + m.diffTop.length + '件（＝学習の効果が出るところ）</summary>' +
      '<table class="ktbl" style="font-size:.72rem;margin-top:4px"><tr><th>面</th><th>距離</th><th>クラス</th><th>学習値</th><th>静的</th><th>差</th></tr>');
    m.diffTop.forEach(function(d){
      var p = d.k.split('|');
      h.push('<tr><td>' + p[0] + '</td><td>' + p[1] + 'm</td><td>' + esc(p[2]) + '</td><td><b>' + d.learn.toFixed(1) + '</b></td>' +
        '<td class="muted">' + d.stat.toFixed(1) + '</td><td style="color:' + (d.d > 0 ? 'var(--err-ink)' : 'var(--acc)') + '">' + sec2(d.d) + '</td></tr>');
    });
    h.push('</table></details>');
  }
  tbl.innerHTML = h.join('');
}
