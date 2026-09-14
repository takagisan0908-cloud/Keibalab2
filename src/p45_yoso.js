/* =========================================================
   45 コース種別(洋芝/野芝)の持ちタイム適性と、各競馬場ごとの
      持ちタイム・上がり3F一覧
   ---------------------------------------------------------
   背景:
     中央の芝コースは 札幌・函館＝「洋芝」、その他＝「野芝」。
     洋芝は野芝より時計のかかる(タフな)馬場で、他場(野芝)の持ちタイムを
     そのまま比べると 洋芝巧者/野芝専科 の適性差が正しく評価できない。
   このファイルで行うこと:
     ① 各馬の馬柱戦績(p34 hdParseRecords → khl_hd_v1 キャッシュ)から
        「競馬場ごと」「コース種別ごと」の最速持ちタイムと最速上がり3Fを抽出
     ② 今回のレースと 同じコース種別(洋芝/野芝)・同じ距離(±200m) の
        最速持ちタイム・最速上がり3F を比較して適性値(0〜1)を算出
        → p5(analyzeRace) が「🏔 洋芝・コース適性」重みとしてAI印へ加点
     ③ 各競馬場ごとの 持ちタイム・上がり3F を一覧表(ポップアップ)で確認できる
   データ未取得の馬は全馬平均へ縮退し、レース全体の序列は崩さない。
   ========================================================= */
var YO_YOBA = ['札幌', '函館'];                                  // 洋芝開催場
var YO_ALL = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
var YO_BAND = 200;                                              // 同距離とみなす許容差(m)
var YO_PRIOR = 1.5;                                             // 縮退の擬似サンプル数
var YO_MEMO = { key: '', val: null };

/* ---------- 基本ユーティリティ ---------- */
function yoIsYoso(v){ return YO_YOBA.indexOf(String(v || '')) >= 0; }
function yoCourseLabel(isYoso){ return isYoso ? '洋芝' : '野芝'; }
/* '1:59.9' '1.59.9' '59.9' '1:09' → 秒。不可なら null */
function yoParseTime(str){
  var s = String(str == null ? '' : str).replace(/[^0-9.:]/g, '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})[:.](\d{1,2})[.:](\d{1,2})$/);      // 1:59.9 / 1.59.9
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3], 10) / 10;
  m = s.match(/^(\d{1,2})[:.](\d{1,2})$/);                       // 1:09 / 59.9
  if (m){
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (s.indexOf(':') >= 0 || s.indexOf('.') >= 0){
      if (b < 60 && a < 10) return a * 60 + b;                    // 1:09
      if (a >= 30) return a + parseInt(m[2], 10) / 10;             // 59.9 (秒)
    }
    return a * 60 + b;
  }
  m = s.match(/^(\d{2,4})$/);
  if (m){ var v = parseInt(m[1], 10); return v > 60 ? v : null; }
  return null;
}
/* 秒 → 'm:ss.s' */
function yoFmt(sec){
  if (sec == null || !isFinite(sec)) return '';
  var m = Math.floor(sec / 60), r = sec - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
/* 上がり3F '33.5' → 33.5 */
function yoL3(str){
  var m = String(str == null ? '' : str).match(/(\d{2})\.(\d)/);
  return m ? parseInt(m[1], 10) + parseInt(m[2], 10) / 10 : null;
}
/* 馬の馬柱戦績(p34 キャッシュ) */
function yoRecs(h){
  if (!h || !h.nk) return [];
  try {
    var ls = (typeof hdLs === 'function') ? hdLs() : {};
    var rec = ls[String(h.nk).trim()];
    if (rec && Array.isArray(rec.r)) return rec.r;
  } catch(e){}
  return [];
}
/* 今回のレース文脈(開催場・コース種別・距離) */
function yoCourse(){
  var place = '', dist = 0;
  try { var rm = readRaceMeta(); place = String(rm.place || ''); dist = parseInt(rm.dist, 10) || 0; } catch(e){}
  try { if (!place) place = String((state.race && state.race.place) || ''); } catch(e){}
  try { if (!dist) dist = parseInt(String((state.race && state.race.dist) || '').replace(/[^0-9]/g, ''), 10) || 0; } catch(e){}
  var venue = '';
  for (var i = 0; i < YO_ALL.length; i++){ if (place.indexOf(YO_ALL[i]) >= 0){ venue = YO_ALL[i]; break; } }
  var surf = '';
  if (/芝/.test(place)) surf = '芝';
  else if (/ダ/.test(place)) surf = 'ダ';
  else if (/障/.test(place)) surf = '障';
  var isYoso = surf === '芝' && yoIsYoso(venue);
  return { venue: venue, surf: surf, dist: dist, isYoso: isYoso, label: yoCourseLabel(isYoso), placeTxt: place };
}

/* ---------- 1頭分: 競馬場×コース種別の最速タイム・最速上がり3F ---------- */
/* 返り値: { all:{n,t:{sec,dist,venue,date},l3:{v,dist,venue,date},d:{sec,dist,date}},
            venue:{ 場名:{n,t,l3,dn,dt} },
            type:{ '洋芝':{...}, '野芝':{...} } } */
function yoStats(h){
  var recs = yoRecs(h);
  var o = { all: { n: 0, t: null, l3: null, d: null }, venue: {}, type: {} };
  function ensureType(k){ return o.type[k] = o.type[k] || { n: 0, t: null, l3: null }; }
  ensureType('洋芝'); ensureType('野芝');
  recs.forEach(function(r){
    if (!r) return;
    var v = String(r.venueName || '');
    if (!v) return;
    if (!o.venue[v]) o.venue[v] = { n: 0, t: null, l3: null, dn: 0, dt: null };
    var V = o.venue[v];
    var isTurf = (String(r.surface || '') === '芝') || /芝/.test(String(r.dist || ''));
    var sec = yoParseTime(r.time);
    var l3 = yoL3(r.last3);
    if (!isTurf){
      // ダート/障害の最速も参考として場ごとに保持
      if (sec != null && String(r.surface || '') !== '障'){
        V.dn++;
        if (!V.dt || sec < V.dt.sec) V.dt = { sec: sec, dist: r.m || 0, date: r.date || '' };
      }
      return;
    }
    V.n++;
    if (sec != null){
      if (!V.t || sec < V.t.sec) V.t = { sec: sec, dist: r.m || 0, date: r.date || '' };
      o.all.n++;
      if (!o.all.t || sec < o.all.t.sec) o.all.t = { sec: sec, dist: r.m || 0, venue: v, date: r.date || '' };
    }
    if (l3 != null && (!V.l3 || l3 < V.l3.v)) V.l3 = { v: l3, dist: r.m || 0, date: r.date || '' };
    if (l3 != null && (!o.all.l3 || l3 < o.all.l3.v)) o.all.l3 = { v: l3, dist: r.m || 0, venue: v, date: r.date || '' };
    // コース種別(洋芝/野芝)ごと
    var T = ensureType(yoIsYoso(v) ? '洋芝' : '野芝');
    T.n++;
    if (sec != null && (!T.t || sec < T.t.sec)) T.t = { sec: sec, dist: r.m || 0, venue: v, date: r.date || '' };
    if (l3 != null && (!T.l3 || l3 < T.l3.v)) T.l3 = { v: l3, dist: r.m || 0, venue: v, date: r.date || '' };
  });
  // ダート最速(全場)
  recs.forEach(function(r){
    if (!r) return;
    if (!/(ダ)/.test(String(r.dist || ''))) return;
    var sec = yoParseTime(r.time);
    if (sec == null) return;
    o.all.dn = (o.all.dn || 0) + 1;
    if (!o.all.d || sec < o.all.d.sec) o.all.d = { sec: sec, dist: r.m || 0, venue: r.venueName || '', date: r.date || '' };
  });
  return o;
}

/* ---------- 1頭分: 今回のレース条件に合う最速持ちタイム/上がり3F ----------
   優先順位(同距離±200m の範囲で絞り、条件の強い順に採用):
     tier1: 今回と同じ競馬場・同じコース種別
     tier2: 同じコース種別(洋芝/野芝)の他場
     tier3: 距離だけ同じ(場・種別不問)
     tier4: コース種別のみ同じ(距離不問・参考値)                     */
function yoBestFor(h, ctx){ return yoBestFromRecs(yoRecs(h), ctx); }
/* recs(馬柱戦績の配列)から直接計算する版(取得直後=キャッシュ前でも使える) */
function yoBestFromRecs(recs, ctx){
  recs = recs || [];
  /* ★2026-09-13 第24弾④a: bandOk / gapM を追加。
     tier4 は「コース種別が同じなら距離は問わない」段なので、今回が芝1200mなのに
     芝2600mの時計が最速として拾われることがあります（＝その馬が走っていない距離の時計が
     持ちタイム欄に出る、というご指摘の症状）。計算の材料には使いつつ、
     表示側で「今回距離とどれだけ離れているか」を必ず分かるようにします。 */
  var out = { tier: 0, sec: null, dist: 0, venue: '', date: '', l3: null, l3dist: 0, n: 0, type: ctx.isYoso ? '洋芝' : '野芝',
              bandOk: false, gapM: null };
  if (!recs.length || ctx.surf !== '芝') return out;
  var rows = [];
  recs.forEach(function(r){
    if (!r) return;
    if (!(parseInt(r.order, 10) >= 1)) return;
    if (!(String(r.surface || '') === '芝' || /芝/.test(String(r.dist || '')))) return;
    var sec = yoParseTime(r.time);
    rows.push({ r: r, sec: sec, l3: yoL3(r.last3), v: String(r.venueName || ''), m: r.m || 0 });
  });
  var band = function(x){ return ctx.dist && x.m && Math.abs(x.m - ctx.dist) <= YO_BAND; };
  var sameType = function(x){ return yoIsYoso(x.v) === ctx.isYoso; };
  var trials = [
    { tier: 1, f: function(x){ return band(x) && sameType(x) && x.v === ctx.venue; } },
    { tier: 2, f: function(x){ return band(x) && sameType(x); } },
    { tier: 3, f: function(x){ return band(x); } },
    { tier: 4, f: function(x){ return sameType(x); } }
  ];
  for (var i = 0; i < trials.length; i++){
    var hit = rows.filter(trials[i].f);
    if (!hit.length) continue;
    var withT = hit.filter(function(x){ return x.sec != null; });
    if (!withT.length) continue;
    // 距離の違うタイムは単純比較できないため「今回距離に最も近い走り」を優先し、
    // 同じ距離差なら速度(m/秒)が速いものを採用する。
    withT.sort(function(a, b){
      var da = ctx.dist ? Math.abs(a.m - ctx.dist) : 0, db = ctx.dist ? Math.abs(b.m - ctx.dist) : 0;
      if (da !== db) return da - db;
      return (b.m / b.sec) - (a.m / a.sec);
    });
    var best = withT[0];
    var withL3 = hit.filter(function(x){ return x.l3 != null; }).sort(function(a, b){ return a.l3 - b.l3; });
    out.tier = trials[i].tier;
    out.sec = best.sec; out.dist = best.m; out.venue = best.v; out.date = best.r.date || '';
    out.spd = best.m ? (best.m / best.sec) : null;   // 距離差を吸収した比較用の速度
    out.gapM = (ctx.dist && best.m) ? (best.m - ctx.dist) : null;   // 今回距離との差(m) 正＝長い
    out.bandOk = !!(ctx.dist && best.m && Math.abs(best.m - ctx.dist) <= YO_BAND);
    out.l3 = withL3.length ? withL3[0].l3 : null;
    out.l3dist = withL3.length ? withL3[0].m : 0;
    out.n = hit.length;
    return out;
  }
  return out;
}

/* ---------- フィールド全体の適性値(0〜1) ---------- */
function yoComputeFor(hs){
  hs = hs || [];
  var ctx = yoCourse();
  var nk = '';
  hs.forEach(function(h){ nk += '|' + (h && h.nk ? h.nk : '-'); });
  var key = String((state && state.raceId) || '') + '|' + ctx.venue + '|' + ctx.surf + '|' + ctx.dist + '|' + nk;
  if (YO_MEMO.key === key && YO_MEMO.val) return YO_MEMO.val;

  var out = { usable: false, why: '', ctx: ctx, items: [], usedN: 0, richN: 0, bestYo: null, tierNote: '' };
  function fallback(){
    for (var z = 0; z < hs.length; z++) out.items.push({ rate: 0.5, tier: 0, sec: null, dist: 0, venue: '', l3: null, n: 0, no: '', name: '' });
    return out;
  }
  var ids = hs.filter(function(h){ return h && h.nk; }).length;
  if (!ids){ out.why = '出走馬に netkeiba の馬IDがありません（「netkeiba URLから直接取込」で出馬表を読むと馬IDが付き集計できます）'; YO_MEMO = { key: key, val: fallback() }; return YO_MEMO.val; }
  if (ctx.surf !== '芝'){ out.why = 'このレースは' + (ctx.surf || '芝以外') + 'のため、洋芝/野芝の持ちタイム比較は行いません（AIの持ちタイム列は従来どおり）'; YO_MEMO = { key: key, val: fallback() }; return YO_MEMO.val; }
  if (!ctx.venue){ out.why = '開催場が未設定のためコース種別を判定できません（開催場を入力してください）'; YO_MEMO = { key: key, val: fallback() }; return YO_MEMO.val; }

  var per = hs.map(function(h, i){
    var it = { rate: 0.5, tier: 0, sec: null, dist: 0, venue: '', l3: null, n: 0, no: (h && h.no) || '', name: (h && h.name) || '' };
    if (!h || !h.nk) return it;
    var b = yoBestFor(h, ctx);
    it.tier = b.tier; it.sec = b.sec; it.dist = b.dist; it.venue = b.venue; it.l3 = b.l3; it.n = b.n; it.date = b.date;
    it.spd = (b.spd != null) ? b.spd : ((b.sec != null && b.dist) ? (b.dist / b.sec) : null);
    return it;
  });
  /* 比較母集団は「今回と同じコース種別(洋芝/野芝)を走った経験がある馬(tier1〜2)」に限定する。
     洋芝は野芝より時計がかかるため、コース種別をまたいで生タイムを並べると
     洋芝巧者を過小評価してしまう(＝ご指摘の「洋芝/野芝の持ちタイムの重要性」)。
     経験のない馬(tier3〜4＝他方のコース種別の時計しかない馬)は
     「今回のコース種別では未証明」として控えめに評価する。 */
  var exp = per.filter(function(x){ return x.tier <= 2 && (x.sec != null || x.l3 != null); });   // 同種別の経験馬
  var oth = per.filter(function(x){ return x.tier >= 3 && x.sec != null; });                    // 別種別しかない馬
  function mm(arr, key){
    var mn = null, mx = null;
    arr.forEach(function(x){ var v = x[key]; if (v == null) return; mn = (mn == null || v < mn) ? v : mn; mx = (mx == null || v > mx) ? v : mx; });
    return { mn: mn, mx: mx };
  }
  // 時計は速度(m/秒・大きいほど速い)で比較する。距離が±200m違っても公平に比べるため。
  function rankRate(v, mn, mx, big){
    if (v == null || mn == null) return null;
    if (mx - mn < 0.05) return 0.7;                 // 差が小さすぎる(同程度)なら中庸やや上
    return big ? ((v - mn) / (mx - mn)) : (1 - (v - mn) / (mx - mn));
  }
  var mS = mm(exp, 'spd'), mL = mm(exp, 'l3');
  var oS = mm(oth, 'spd');
  per.forEach(function(x){
    var rS, rL, r, base;
    if (x.tier <= 2 && (x.sec != null || x.l3 != null)){
      // ① 同じコース種別での実績がある馬: 同種別内で時計・上がりを比較して加点
      rS = rankRate(x.spd, mS.mn, mS.mx, true);      // 速度: 大きいほど高評価
      rL = rankRate(x.l3, mL.mn, mL.mx, false);      // 上がり3F: 小さいほど高評価
      if (rS != null && rL != null) r = 0.68 * rS + 0.32 * rL;   // 持ちタイム主・上がり3F従
      else r = (rS != null ? rS : rL);
      base = 0.45 + (r == null ? 0.5 : r) * 0.55;                // 経験馬は 0.45〜1.00
    } else if (x.tier >= 3 && x.sec != null){
      // ② 他方のコース種別しか走っていない馬: 未証明として控えめ(0.35〜0.60)
      var r2 = rankRate(x.spd, oS.mn, oS.mx, true);
      base = 0.35 + (r2 == null ? 0.6 : r2) * 0.25;
    } else {
      base = 0.40;                                              // ③ データなし
    }
    x.rate = clamp(base, 0.05, 1.0);
    x.pct = Math.round(x.rate * 100);
    x.exp = (x.tier <= 2 && (x.sec != null || x.l3 != null)) ? 'type' : (x.sec != null ? 'other' : 'none');
  });
  out.items = per;
  out.usedN = exp.filter(function(x){ return x.sec != null; }).length;
  out.richN = exp.filter(function(x){ return x.n >= 2; }).length;
  out.otherN = oth.length;
  // 該当コース種別での最速馬(経験馬の中から)
  var yos = exp.filter(function(x){ return x.spd != null; }).sort(function(a, b){ return b.spd - a.spd; });
  if (yos.length) out.bestYo = { name: yos[0].name, no: yos[0].no, sec: yos[0].sec, venue: yos[0].venue, dist: yos[0].dist };
  out.tierNote = ctx.label + '(' + ctx.venue + ')・' + (ctx.dist ? ctx.dist + 'm' : '距離未入力') + 'で比較' +
    (out.otherN ? '（' + ctx.label + '未経験 ' + out.otherN + '頭は控えめ評価）' : '');
  if (out.usedN >= 2){
    out.usable = true;
    out.label = ctx.label + 'での持ちタイム適性';
  } else if (!exp.length){
    out.why = '同コース種別(' + ctx.label + ')・同距離(' + (ctx.dist ? ctx.dist + 'm±' + YO_BAND : '距離未入力') + ')の持ちタイムを持つ馬が見つかりません。「⏱ 競馬場別の持ちタイム」または「📊 馬柱データ」を取得すると集計できます';
  } else {
    out.why = '同コース種別(' + ctx.label + ')の経験馬が少なすぎるため自動OFF（対象 ' + out.usedN + '頭。未経験 ' + out.otherN + '頭）';
  }
  YO_MEMO = { key: key, val: out };
  return out;
}
function yoInvalidate(){ YO_MEMO = { key: '', val: null }; }

/* ================= 各競馬場ごとの持ちタイム・上がり3F 一覧(ポップアップ) ================= */
function yoPanelMsg(m, isErr){
  var el = $('yoMsg');
  if (el) el.innerHTML = (isErr ? '<span style="color:var(--err-ink)">⚠ ' : '<span style="color:var(--ok-ink)">') + esc(m) + '</span>';
}
function yoOpenPanel(){
  var hs = (state && state.horses || []).filter(function(h){ return h && (h.nk || h.name); });
  if (!hs.length){ yoPanelMsg('馬がいません。「netkeiba URLから直接取込」で出馬表を読み込んでください。', true); return; }
  if (!hs.some(function(h){ return h.nk; })){ yoPanelMsg('netkeibaの馬IDが付いた馬がいません（URL取込の出馬表が必要です）。', true); return; }
  var ctx = yoCourse();
  var stats = hs.map(function(h){ return { h: h, st: yoStats(h), best: yoBestFor(h, ctx) }; });
  if (!stats.some(function(x){ return x.st.all.n || x.st.all.dn; })){
    yoPanelMsg('馬柱データがまだありません。「📊 馬柱データ」を取得すると、競馬場ごとの持ちタイム・上がり3Fを表示できます。', true);
    return;
  }
  // 表示する競馬場(データがある場のみ・JRA開催場の標準順)
  var useV = YO_ALL.filter(function(v){ return stats.some(function(x){ return x.st.venue[v]; }); });
  // 今回の同距離帯(±200m)での芝最速タイム(赤字用)
  var bestSec = {};
  useV.forEach(function(v){
    var mn = null;
    stats.forEach(function(x){
      var t = x.st.venue[v] && x.st.venue[v].t;
      if (t && ctx.dist && t.dist && Math.abs(t.dist - ctx.dist) <= YO_BAND && (mn == null || t.sec < mn)) mn = t.sec;
    });
    bestSec[v] = mn;
  });
  var h = [];
  h.push('<h2 style="margin:0 0 4px">⏱ 競馬場ごとの 持ちタイム・上がり3F</h2>');
  h.push('<div class="small muted" style="margin-bottom:6px">馬柱戦績(db.netkeiba)から <b>競馬場ごとの最速持ちタイム(芝)</b> と <b>最速上がり3F</b> を検出した一覧です。上段=持ちタイム(距離)／下段=上がり3F。セルは 出走数 つき。<br>' +
    '今回のレース: <b>' + esc(ctx.placeTxt || '(未入力)') + '</b>' + (ctx.dist ? '　' + esc(String(ctx.dist)) + 'm' : '') +
    '　コース種別: <b style="color:' + (ctx.isYoso ? 'var(--ok-ink)' : 'var(--warn-ink)') + '">' + esc(ctx.surf === '芝' ? ctx.label : (ctx.surf || '—')) + '</b>' +
    (ctx.isYoso ? '（札幌・函館＝洋芝）' : (ctx.surf === '芝' ? '（洋芝以外）' : '')) + '</div>');
  h.push('<div style="overflow:auto;max-height:66vh">');
  h.push('<table class="lr-tbl" style="font-size:.72rem;white-space:nowrap"><thead><tr>' +
    '<th style="text-align:left">馬番</th><th style="text-align:left">馬名</th>');
  useV.forEach(function(v){
    var cls = yoIsYoso(v) ? ' style="background:var(--card2)"' : '';
    h.push('<th' + cls + '>' + esc(v) + (yoIsYoso(v) ? '<br><span style="font-weight:400;font-size:.9em">洋芝</span>' : '') + '</th>');
  });
  h.push('<th style="background:var(--card2)">洋芝最速<br><span style="font-weight:400;font-size:.9em">札幌/函館</span></th>' +
    '<th style="background:var(--card2)">野芝最速<br><span style="font-weight:400;font-size:.9em">他場</span></th>' +
    '<th style="background:var(--card2)">今回条件<br><span style="font-weight:400;font-size:.9em">合致(優先順)</span></th></tr></thead><tbody>');
  stats.sort(function(a, b){
    var na = parseInt(String(a.h.no).replace(/[^0-9]/g, ''), 10), nb = parseInt(String(b.h.no).replace(/[^0-9]/g, ''), 10);
    return (isNaN(na) ? 99 : na) - (isNaN(nb) ? 99 : nb);
  });
  var tierLabel = { 1: '同場', 2: '同種別', 3: '同距離', 4: '参考' };
  stats.forEach(function(x){
    var hh = x.h, st = x.st, b = x.best;
    h.push('<tr><td style="text-align:left"><b>' + esc(hh.no || '') + '</b></td><td style="text-align:left">' + esc(hh.name || '') + '</td>');
    useV.forEach(function(v){
      var V = st.venue[v];
      if (!V || (!V.t && !V.l3 && !V.dt)){ h.push('<td class="muted">−</td>'); return; }
      var isBest = (V.t && bestSec[v] != null && V.t.sec === bestSec[v]);
      var cell = '<div>' + (V.t
        ? '<b' + (isBest ? ' style="color:var(--err-ink)"' : '') + '>' + esc(yoFmt(V.t.sec)) + '</b><span class="muted">(' + esc(String(V.t.dist || '') ) + ')</span>'
        : '<span class="muted">−</span>') + '</div>';
      cell += '<div style="font-size:.94em">' + (V.l3 ? esc(V.l3.v.toFixed(1)) + '<span class="muted">' + esc(String(V.l3.dist || '')) + '</span>' : '<span class="muted">−</span>') + '</div>';
      cell += '<div class="muted" style="font-size:.88em">' + V.n + '走' + (V.dt ? '／ダ' + esc(yoFmt(V.dt.sec)) : '') + '</div>';
      h.push('<td style="vertical-align:top' + (isBest ? ';background:var(--card2)' : (yoIsYoso(v) ? ';background:var(--card)' : '')) + '">' + cell + '</td>');
    });
    var yo = st.type['洋芝'], no = st.type['野芝'];
    h.push('<td style="vertical-align:top;background:var(--card)">' + (yo && yo.t ? '<b>' + esc(yoFmt(yo.t.sec)) + '</b><span class="muted">(' + esc(String(yo.t.dist)) + '・' + esc(yo.t.venue) + ')</span>' + (yo.l3 ? '<div style="font-size:.94em">' + yo.l3.v.toFixed(1) + '</div>' : '') : '<span class="muted">出走なし</span>') + '</td>');
    h.push('<td style="vertical-align:top;background:var(--card)">' + (no && no.t ? '<b>' + esc(yoFmt(no.t.sec)) + '</b><span class="muted">(' + esc(String(no.t.dist)) + '・' + esc(no.t.venue) + ')</span>' + (no.l3 ? '<div style="font-size:.94em">' + no.l3.v.toFixed(1) + '</div>' : '') : '<span class="muted">出走なし</span>') + '</td>');
    h.push('<td style="vertical-align:top;background:var(--card)">' + (b && b.sec != null
      ? '<b' + (b.tier <= 2 ? ' style="color:var(--ok-ink)"' : '') + '>' + esc(yoFmt(b.sec)) + '</b><span class="muted">(' + esc(String(b.dist)) + 'm)</span>' +
        '<div style="font-size:.9em">' + esc(tierLabel[b.tier] || '') + (b.n ? '・' + b.n + '走' : '') + (b.l3 != null ? '・上' + b.l3.toFixed(1) : '') + '</div>'
      : '<span class="muted">データなし</span>') + '</td>');
    h.push('</tr>');
  });
  h.push('</tbody></table></div>');
  h.push('<div class="small muted" style="margin-top:6px">' +
    '■ 持ちタイム＝その競馬場の芝で記録した最速タイム(括弧内は距離)。上がり3F＝その競馬場の芝で記録した最速上がり。<br>' +
    '■ 「洋芝最速」(札幌・函館)と「野芝最速」(他場)を分けて表示。洋芝は野芝より時計がかかるため、コース種別をまたいで生タイムを比べると<b>洋芝巧者を過小評価</b>してしまいます。<br>' +
    '■ AIの「🏔 洋芝・コース適性」は <b>①今回と同じコース種別での最速持ちタイム・最速上がり3F</b>（同競馬場→同種別の他場の優先順）を比較し、洋芝開催では<b>洋芝で最速タイムを刻んでいる馬を加点</b>します。②今回のコース種別を走った実績が無い馬は「未証明」として控えめ（0.35〜0.60）、③データが無い馬は一律0.40で評価します（経験馬でも時計が遅ければ評価は下がります）。<br>' +
    '■ 「今回条件 合致」は ①同競馬場・同距離±200m → ②同コース種別・同距離 → ③同距離 → ④同コース種別(参考) の優先順で採用した値です。</div>');
  h.push('<div style="text-align:right;margin-top:10px"><button class="btn primary" data-yocl>閉じる</button></div>');
  showModal(h.join(''), function(root){
    var b = root.querySelector('[data-yocl]');
    if (b) b.addEventListener('click', closeModal);
  });
}
/* ボタン: 馬柱データが無ければ取得を促す */
function yoEnsureThenPanel(){
  var hs = (state && state.horses || []).filter(function(h){ return h && h.nk; });
  if (!hs.length){ yoPanelMsg('netkeibaの馬IDが付いた馬がいません（URL取込の出馬表が必要です）。', true); return; }
  var have = hs.some(function(h){ return yoRecs(h).length; });
  if (have){ yoOpenPanel(); return; }
  yoPanelMsg('馬柱データを取得しています…');
  var fn = (typeof bbEnsure === 'function') ? bbEnsure : null;
  if (!fn){ yoPanelMsg('取得手段がありません（①タブの「📊 馬柱データ」から取得してください）。', true); return; }
  fn(false, function(m){ yoPanelMsg(m); }).then(function(){ yoInvalidate(); yoOpenPanel(); })
    .catch(function(e){ yoPanelMsg('取得できませんでした: ' + ((e && e.message) || e), true); });
}
function initYo(){
  var b = $('btnYoTime');
  if (b) b.addEventListener('click', function(){ if (!b.disabled) yoEnsureThenPanel(); });
}
