/* =========================================================
   p52_histfeat.js — 学習DBから「レース前の情報だけ」で馬ごとの特徴量を作る
   （#2026-09-12 第17弾・提案3）

   ★ なぜこれが要るか（2026-09-12 のコード調査で判明）
   1) 自己検証の3モデル(apUScores)が見ていた特徴量は「オッズ」「脚質」「出遅れ率」の3つだけで、
      しかも脚質(colK)は apStyleVal() の4段階固定値（逃げ0.63/先行0.59/差し0.51/追込0.43）。
      → 1万レース学習しても、材料が増えないので精度の上限は上がりません。
   2) さらに apStyleOf() は脚質を『そのレース自身の通過順』(result の passing)から判定していた。
      → 自分が当てに行くレースの走りを事前情報として使う **いかさま(look-ahead bias)** で、
        学習DBの的中率・回収率が見かけ上よく出ます。

   この2つを同時に直す。方針:
     ・特徴は「そのレースの日付より前のレース」だけから作る（同日も使わない＝保守側）
     ・馬の履歴は 馬ID(db.netkeiba の horse_id) があればそれで、無ければ馬名キーで照合
     ・上り3F(結果の last3)やタイム(結果の time)は **そのレースのものは使わない**。
       過去戦での「上りが何番目に速かったか」だけを特徴にする
     ・馬体重の増減(weightChg)と斤量(weight)は当日計量＝レース前に分かるので使ってよい

   作る特徴（すべて 0〜1 に正規化してモデルへ渡す）
     colAbl … 総合能力（過去戦の3着内率＋上りの相対順位＋同距離適性＋騎手の勝率）
     colK   … 脚質（**過去戦の通過順**から判定。いかさまを修正）
     colRest… 休養・鉄砲・2走目（p49と同じ定義: 90日以上が鉄砲、その直後が2走目）
     colW   … 馬体重の増減（大幅増減は割引）
   ========================================================= */

var HF_MIN_PREV = 1;        // 過去戦がこの数以上あれば「実績」を出す
var HF_REST_TEPP = 90;      // 鉄砲＝90日以上の休み明け（p49 と同じ定義）
var HF_LOOKBACK = 6;        // 上り・着順の平均を見る直近戦数

/* ---------- 日付 ---------- */
function hfDate(d8){
  var s = String(d8 || '');
  if (!/^\d{8}$/.test(s)) return null;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}
function hfDays(a8, b8){
  var a = hfDate(a8), b = hfDate(b8);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}
/* ---------- 数値・文字列 ---------- */
function hfNum(v){
  if (typeof apNum === 'function') return apNum(v);
  var x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return isNaN(x) ? null : x;
}
function hfNameKey(s){
  if (typeof pfNameKey === 'function') return pfNameKey(s);
  return String(s == null ? '' : s).replace(/[（(].*?[)）]/g, '').replace(/[\s\u3000・．.、]/g, '').toUpperCase();
}
/* タイム '1:58.4' / '58.4' → 秒 */
function hfTimeSec(v){
  if (typeof evaluateTimeStr === 'function'){
    try { var t = evaluateTimeStr(v); if (t != null) return t; } catch(e){}
  }
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/(\d+):([\d.]+)/);
  if (m) return (+m[1]) * 60 + parseFloat(m[2]);
  var x = parseFloat(s.replace(/[^\d.]/g, ''));
  return isFinite(x) && x > 0 ? x : null;
}
/* 馬体重 '480(+12)' / '480(-4)' → +12 / -4 */
function hfWeightChg(v){
  var s = String(v == null ? '' : v);
  var m = s.match(/([+-]\d+)/);
  if (m) return parseInt(m[1], 10);
  var m2 = s.match(/[（(]\s*([+-]?\d+)\s*[)）]/);
  if (m2) return parseInt(m2[1], 10);
  return null;
}
/* 通過順 '6-6-5-4' → 4角の位置 */
function hfLastPos(passing){
  if (typeof pfLastPos === 'function') return pfLastPos(passing);
  var a = String(passing || '').replace(/[^\d-]/g, '').split('-').filter(function(x){ return x !== ''; });
  return a.length ? (parseInt(a[a.length - 1], 10) || 0) : 0;
}
/* 4角位置 → 脚質（p14 の histStyle と同じ境目） */
function hfStyleOf(pos4, n){
  var p = parseInt(pos4, 10) || 0, nn = parseInt(n, 10) || 0;
  if (p < 1) return '';
  if (p === 1) return '逃げ';
  var r = (nn > 1) ? (p - 1) / (nn - 1) : 0.5;
  if (r <= 0.30) return '先行';
  if (r <= 0.65) return '差し';
  return '追込';
}
/* 距離帯（p50 があればそれを使う） */
function hfBand(m){
  if (typeof pfBandOf === 'function'){ var b = pfBandOf(m); return b ? b.k : ''; }
  var d = parseInt(m, 10) || 0;
  if (!d) return '';
  if (d <= 1400) return 'd1';
  if (d <= 1800) return 'm1';
  if (d <= 2200) return 'm2';
  return 'l1';
}

/* =========================================================
   インデックス作成（学習DB全体を1回なめる）
   ========================================================= */
function hfCollectRaces(){
  var out = [];
  try {
    if (typeof diLs !== 'function') return out;
    var db = diLs() || {};
    var races = db.races || {};
    for (var rid in races){
      if (!Object.prototype.hasOwnProperty.call(races, rid)) continue;
      var r = races[rid];
      if (!r || !r.rows || !r.rows.length) continue;
      var meta = r.meta || {};
      var d8 = String(r.date8 || meta.date8 || '');
      if (!/^\d{8}$/.test(d8)) continue;
      var m = parseInt(meta.m, 10) || 0;
      if (!m && meta.dist){ var dm = String(meta.dist).match(/(\d{3,4})/); if (dm) m = parseInt(dm[1], 10); }
      // 各レース内で「上り3Fの順位」を付けておく（1=最速）
      var rows = r.rows.map(function(x){
        return {
          no: String(x.no == null ? '' : x.no), name: String(x.name || ''),
          hid: String(x.id || ''), jockey: String(x.jockey || ''),
          order: parseInt(x.order, 10) || 0,
          odds: hfNum(x.odds), pop: parseInt(x.pop, 10) || 0,
          last3: hfNum(x.last3), timeSec: hfTimeSec(x.time),
          passing: String(x.passing || ''), weightChg: hfWeightChg(x.weightChg),
          l3rank: 0, l3n: 0
        };
      }).filter(function(x){ return x.no && x.order >= 1; });
      var wl3 = rows.filter(function(x){ return x.last3 && x.last3 > 0; });
      wl3.slice().sort(function(a, b){ return a.last3 - b.last3; }).forEach(function(x, i){ x.l3rank = i + 1; });
      rows.forEach(function(x){ x.l3n = wl3.length; });
      out.push({
        rid: rid, d8: d8, place: String(meta.place || ''), surface: String(meta.surface || ''),
        m: m, band: hfBand(m), baba: String(meta.baba || ''), n: rows.length, rows: rows,
        xd: r.xd || null
      });
    }
  } catch(e){}
  out.sort(function(a, b){ return a.d8 < b.d8 ? -1 : (a.d8 > b.d8 ? 1 : 0); });
  return out;
}

/* 馬・騎手の履歴インデックス（日付昇順＋累積和） */
function hfBuildIndex(races){
  var byHorse = {}, byJockey = {};
  (races || []).forEach(function(rc){
    rc.rows.forEach(function(x){
      var key = x.hid || hfNameKey(x.name);
      if (!key) return;
      (byHorse[key] = byHorse[key] || []).push({
        d8: rc.d8, rid: rc.rid, order: x.order, odds: x.odds, band: rc.band, m: rc.m,
        surface: rc.surface, place: rc.place, pos4: hfLastPos(x.passing), n: rc.n,
        l3rank: x.l3rank, l3n: x.l3n, jockey: x.jockey, no: x.no, name: x.name
      });
      var jk = hfNameKey(x.jockey);
      if (jk && jk.length >= 2){
        (byJockey[jk] = byJockey[jk] || []).push({ d8: rc.d8, order: x.order });
      }
    });
  });
  // 累積和を付けておく（d8 < X の範囲を O(log n) で引くため）
  function finalize(list){
    list.sort(function(a, b){ return a.d8 < b.d8 ? -1 : (a.d8 > b.d8 ? 1 : 0); });
    var cn = 0, cw = 0, ct = 0;
    list.forEach(function(e){
      cn++; if (e.order === 1) cw++; if (e.order >= 1 && e.order <= 3) ct++;
      e._n = cn; e._w = cw; e._t = ct;
    });
    return list;
  }
  for (var k in byHorse){ if (Object.prototype.hasOwnProperty.call(byHorse, k)) finalize(byHorse[k]); }
  for (var j in byJockey){ if (Object.prototype.hasOwnProperty.call(byJockey, j)) finalize(byJockey[j]); }
  return { byHorse: byHorse, byJockey: byJockey, races: (races || []).length };
}

/* d8 より strictly 前の要素数（累積和を引く位置） */
function hfBefore(list, d8){
  var lo = 0, hi = list.length;
  while (lo < hi){
    var mid = (lo + hi) >> 1;
    if (list[mid].d8 < d8) lo = mid + 1; else hi = mid;
  }
  return lo;   // list[0..lo-1] が d8 より前
}

/* =========================================================
   1頭ぶんの「レース前」特徴
   ========================================================= */
function hfHorseFeat(idx, horseKey, jockeyKey, d8, band, curWeightChg){
  var f = { has: false, prevN: 0, top3Rate: null, winRate: null, l3RankAvg: null,
            sameDistN: 0, sameDistTop3Rate: null, restDays: null, isTeppo: false, is2nd: false,
            style: '', styleN: 0, jockeyN: 0, jockeyWinRate: null, jockeyTop3Rate: null, abl: null };
  if (!idx) return f;
  var list = idx.byHorse[horseKey];
  if (list && list.length){
    var c = hfBefore(list, d8);           // ★ この日付より前の出走だけを使う（いかさま防止）
    if (c >= HF_MIN_PREV){
      var last = list[c - 1];
      f.has = true;
      f.prevN = c;
      var e = list[c - 1];
      f.top3Rate = e._t / c;
      f.winRate = e._w / c;
      f.restDays = hfDays(last.d8, d8);
      // 上りの相対順位（直近 HF_LOOKBACK 戦）
      var s = 0, sn = 0;
      for (var i = Math.max(0, c - HF_LOOKBACK); i < c; i++){
        if (list[i].l3rank && list[i].l3n){ s += list[i].l3rank / list[i].l3n; sn++; }
      }
      if (sn) f.l3RankAvg = s / sn;       // 小さいほど上りが速い
      // 同距離帯の実績
      var dn = 0, dt = 0;
      for (var j2 = 0; j2 < c; j2++){
        if (band && list[j2].band === band){ dn++; if (list[j2].order <= 3) dt++; }
      }
      if (dn){ f.sameDistN = dn; f.sameDistTop3Rate = dt / dn; }
      // 脚質＝**過去戦の通過順**から（直近3戦の4角位置の中央値）
      var ps = [];
      for (var k2 = Math.max(0, c - 3); k2 < c; k2++){
        if (list[k2].pos4 >= 1 && list[k2].n >= 2) ps.push({ p: list[k2].pos4, n: list[k2].n });
      }
      if (ps.length){
        var tags = ps.map(function(x){ return hfStyleOf(x.p, x.n); }).filter(function(t){ return t; });
        if (tags.length){
          var order4 = ['逃げ', '先行', '差し', '追込'];
          var nums = tags.map(function(t){ return order4.indexOf(t); }).sort(function(a, b){ return a - b; });
          f.style = order4[nums[Math.floor(nums.length / 2)]] || '';
          f.styleN = tags.length;
        }
      }
      // 鉄砲 / 2走目（p49 と同じ定義）
      if (f.restDays != null && f.restDays >= HF_REST_TEPP) f.isTeppo = true;
      if (c >= 2){
        var prevGap = hfDays(list[c - 2].d8, list[c - 1].d8);
        if (prevGap != null && prevGap >= HF_REST_TEPP && f.restDays != null && f.restDays < HF_REST_TEPP) f.is2nd = true;
      }
    }
  }
  // 騎手（この日付より前の学習DB内成績）
  if (jockeyKey && idx.byJockey[jockeyKey]){
    var jl = idx.byJockey[jockeyKey];
    var jc = hfBefore(jl, d8);
    if (jc > 0){
      var je = jl[jc - 1];
      f.jockeyN = jc;
      f.jockeyWinRate = je._w / jc;
      f.jockeyTop3Rate = je._t / jc;
    }
  }
  f.weightChg = (curWeightChg == null) ? null : curWeightChg;
  return f;
}

/* 総合能力（0〜1）。材料が無い項目は 0.5（中立）にして、ある項目だけで平均する */
function hfAbility(f){
  if (!f || !f.has) return null;
  var parts = [], ws = [];
  if (f.top3Rate != null && f.prevN >= 2){ parts.push(f.top3Rate / 0.30); ws.push(1.2); }   // 3着内率30%で0.5相当→1.0
  if (f.l3RankAvg != null){ parts.push(1 - f.l3RankAvg); ws.push(1.0); }                     // 上りが速いほど高い
  if (f.sameDistTop3Rate != null && f.sameDistN >= 2){ parts.push(f.sameDistTop3Rate / 0.30); ws.push(0.8); }
  if (f.jockeyWinRate != null && f.jockeyN >= 20){ parts.push(f.jockeyWinRate / 0.10); ws.push(0.6); }
  if (!parts.length) return null;
  var s = 0, w = 0;
  parts.forEach(function(v, i){ s += clamp01(v) * ws[i]; w += ws[i]; });
  return w ? s / w : null;
}
function clamp01(x){ return x < 0 ? 0 : (x > 1 ? 1 : x); }
/* ★注意: clamp() をここで再定義してはいけません。p3_core.js の clamp(v,a,b) が全体共通で、
   引数順が違う同名関数を置くと全ファイルの clamp が壊れます（2026-09-12 に実際に踏んだ）。 */

/* 休養・鉄砲 → 倍率（1.0 が中立。p49 で取れる「鉄砲成績」の代わりに、
   学習DB内で『鉄砲だった回の実績』を集計して出す） */
function hfRestMul(f, teppoStat){
  if (!f) return 1;
  if (f.isTeppo && teppoStat && teppoStat.n >= 10){
    var r = teppoStat.top3 / teppoStat.n, base = teppoStat.allTop3 || (1 / 3);
    return clamp(1 + (base > 0 ? (r / base - 1) : 0) * 0.25, 0.85, 1.20);
  }
  if (f.is2nd && teppoStat && teppoStat.n2 >= 10){
    var r2 = teppoStat.top32 / teppoStat.n2, base2 = teppoStat.allTop3 || (1 / 3);
    return clamp(1 + (base2 > 0 ? (r2 / base2 - 1) : 0) * 0.25, 0.85, 1.20);
  }
  if (f.restDays != null && f.restDays >= 180) return 0.94;   // 半年以上の休養明けは軽く割引
  return 1;
}

/* 学習DB全体で「鉄砲だった馬」「2走目だった馬」の成績を集計（日付に依存しない全体統計） */
function hfTeppoStat(idx){
  var st = { n: 0, top3: 0, n2: 0, top32: 0, all: 0, allTop3n: 0, allTop3: 1 / 3 };
  if (!idx) return st;
  for (var k in idx.byHorse){
    if (!Object.prototype.hasOwnProperty.call(idx.byHorse, k)) continue;
    var list = idx.byHorse[k];
    for (var i = 0; i < list.length; i++){
      st.all++; if (list[i].order <= 3) st.allTop3n++;
      if (i === 0) continue;
      var gap = hfDays(list[i - 1].d8, list[i].d8);
      if (gap == null) continue;
      if (gap >= HF_REST_TEPP){ st.n++; if (list[i].order <= 3) st.top3++; }
      else if (i >= 2){
        var gap0 = hfDays(list[i - 2].d8, list[i - 1].d8);
        if (gap0 != null && gap0 >= HF_REST_TEPP){ st.n2++; if (list[i].order <= 3) st.top32++; }
      }
    }
  }
  if (st.all) st.allTop3 = st.allTop3n / st.all;
  return st;
}

/* =========================================================
   1レースぶんの特徴を作る（apFeats から呼ばれる）
   ========================================================= */
var hfIdxCache = null, hfIdxN = -1;
var HF_REBUILD_EVERY = 200;   // 学習DBのレース数がこれだけ増えたら作り直す
/* ★ 一括取込は3,600レース規模になるので、1レースごとにインデックスを作り直すと O(n^2) で固まります。
   インデックスが古くても「その日付より前の出走だけ」を引く(hfBefore)ので **いかさまにはなりません**
   （古い＝材料が少し減るだけ）。なので作り直しは 200 レースごと＋取込完了時の明示ドロップにします。 */
function hfIndex(force){
  try {
    var n = 0;
    if (typeof diLs === 'function'){
      var db = diLs() || {};
      n = Object.keys(db.races || {}).length;
    }
    if (!force && hfIdxCache && Math.abs(n - hfIdxN) < HF_REBUILD_EVERY) return hfIdxCache;
    var races = hfCollectRaces();
    hfIdxCache = hfBuildIndex(races);
    hfIdxCache.teppo = hfTeppoStat(hfIdxCache);
    hfIdxN = n;
    return hfIdxCache;
  } catch(e){ return null; }
}
function hfDropCache(){
  hfIdxCache = null; hfIdxN = -1;
  // ★2026-09-12 第18弾: 学習DBが変わったら「前日の馬場」の集計も作り直す（p57）
  try { if (typeof pbDrop === 'function') pbDrop(); } catch(e){}
}

/* rows（結果ページの行）→ { '馬番': feat } を返す。d8 より前のデータだけを使う */
function hfFeatures(rows, d8, band){
  var idx = hfIndex(false);
  if (!idx) return null;
  var out = {};
  (rows || []).forEach(function(r){
    if (!r || r.no == null) return;
    var key = String(r.id || '') || hfNameKey(r.name);
    var f = hfHorseFeat(idx, key, hfNameKey(r.jockey), d8, band, hfWeightChg(r.weightChg));
    f.abl = hfAbility(f);
    f.restMul = hfRestMul(f, idx.teppo);
    out[String(r.no)] = f;
  });
  return out;
}

/* 特徴 → 表示用のテキスト（🏇馬柱や④の説明に使う） */
function hfTxt(f){
  if (!f || !f.has) return '';
  var a = [];
  if (f.prevN) a.push('学習DB内 ' + f.prevN + '戦 ' + (f.top3Rate * 100).toFixed(0) + '%');
  if (f.l3RankAvg != null) a.push('上り順位 ' + (f.l3RankAvg * 100).toFixed(0) + '%');
  if (f.sameDistN) a.push('同距離 ' + f.sameDistN + '戦 ' + (f.sameDistTop3Rate * 100).toFixed(0) + '%');
  if (f.jockeyN) a.push('騎手 ' + f.jockeyN + '戦 ' + (f.jockeyWinRate * 100).toFixed(1) + '%');
  if (f.restDays != null){
    if (f.isTeppo) a.push('鉄砲(' + f.restDays + '日ぶり)');
    else if (f.is2nd) a.push('2走目(前走が鉄砲)');
    else if (f.restDays >= 21) a.push('中' + Math.floor((f.restDays - 1) / 7) + '週');
  }
  return a.join(' / ');
}

/* =========================================================
   今回開いているレース（①の出馬表）についての特徴
   p5_engine(①のAI印) / p51(診断) / p53(一括取得) の3か所から共通で使う
   ========================================================= */
/* 今のレースの日付(YYYYMMDD)を探す。分からなければ ''（＝履歴を引けないので特徴は出ない） */
function hfCurD8(){
  var d8 = '';
  try { if (typeof state !== 'undefined' && state && state.raceDate8) d8 = String(state.raceDate8); } catch(e){}
  if (!/^\d{8}$/.test(d8)){
    try { if (typeof apMetaCur === 'function'){ var mm = apMetaCur(); if (mm && /^\d{8}$/.test(String(mm.date8 || ''))) d8 = String(mm.date8); } } catch(e){}
  }
  if (!/^\d{8}$/.test(d8)){
    // レース名から拾えなかったときは jlRaceD8()（state.raceDate8 があればそれ、無ければ今日）
    try { if (typeof jlRaceD8 === 'function'){ var j = jlRaceD8(); if (/^\d{8}$/.test(String(j || ''))) d8 = String(j); } } catch(e){}
  }
  return /^\d{8}$/.test(d8) ? d8 : '';
}
/* 今のレースの距離帯キー */
function hfCurBand(){
  var m = 0;
  try {
    if (typeof state !== 'undefined' && state && state.race){
      var dm = String(state.race.dist || '').match(/(\d{3,4})/);
      if (dm) m = parseInt(dm[1], 10);
    }
    if (!m && typeof readRaceMeta === 'function'){
      var mm = readRaceMeta() || {};
      var d2 = String(mm.dist || '').match(/(\d{3,4})/);
      if (d2) m = parseInt(d2[1], 10);
      if (!m){ var d3 = String(mm.name || '').match(/[芝ダ障]\s*(\d{3,4})/); if (d3) m = parseInt(d3[1], 10); }
    }
  } catch(e){}
  return m ? hfBand(m) : '';
}
/* → { d8, band, map: { '馬番': feat }, any: bool }。引けなければ null */
function hfCurFeatures(hs){
  try {
    var d8 = hfCurD8();
    if (!d8) return null;
    var band = hfCurBand();
    hfIndex(false);
    var map = hfFeatures(hs || [], d8, band);
    if (!map) return null;
    var any = false;
    for (var k in map){ if (Object.prototype.hasOwnProperty.call(map, k) && map[k] && map[k].has){ any = true; break; } }
    return { d8: d8, band: band, map: map, any: any };
  } catch(e){ return null; }
}
