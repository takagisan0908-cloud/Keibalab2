/* =========================================================
   p50_pacefit.js — 展開（ペース）適性とコーナー位置バイアスの学習
   （#2026-09-12 第16弾）

   学習DB（p32 で保存したレース結果）に、第16弾から
     ・コーナー通過順（馬番ごとの1〜4角位置）
     ・ペース（S=スロー / M=ミドル / H=ハイ）
     ・200mごとのラップタイム
     ・払戻金（全8券種）
   が入るようになったので、それを使って次の3つを学習します。

   1) 🐎 馬ごとの展開適性
      「この馬はハイペースだと走るが、スローではほぼ届かない」を
      学習DB内の同名馬の過去レース（ペース × 着順）から集計します。
   2) 🏟 コーナー位置バイアス（競馬場 × 面 × 距離帯）
      「4角で何番手だった馬が3着内に来やすいか」を競馬場ごとに集計します。
      → 開催日が経ってレースが溜まるほど、その競馬場の有利不利がはっきりします。
   3) 🌊 ペース × 脚質 の3着内率
      「ハイペースの日は差しが有利」などを、全レース＋競馬場別で集計します。

   ★ 集計は「学習DBに入っているレース」だけを使います。
     トラックバイアス（p13）は従来どおり当日ぶんのみですが、
     こちらは履歴が溜まるほど精度が上がる「長期の学習」です。

   ★ 全部まとめて 1つのオブジェクト（pfLearn の返り値）にして
     localStorage(keiba_pf_v1) へ保存するので、画面を開くたびに集計し直しません。
   ========================================================= */

var PF_LS = 'keiba_pf_v1';
var PF_MIN = 5;          // 「根拠あり」として倍率に使う最低サンプル数
var PF_MIN_SHOW = 3;     // 表に出す最低サンプル数
var PF_STYLES = ['逃げ', '先行', '差し', '追込'];
/* 4角の位置（頭数で区切った帯） */
var PF_POS_BANDS = [
  { k: '1', label: '1番手', test: function(p, n){ return p === 1; } },
  { k: '2-3', label: '2〜3番手', test: function(p, n){ return p >= 2 && p <= 3; } },
  { k: '4-6', label: '4〜6番手', test: function(p, n){ return p >= 4 && p <= 6; } },
  { k: '7-10', label: '7〜10番手', test: function(p, n){ return p >= 7 && p <= 10; } },
  { k: '11-', label: '11番手以降', test: function(p, n){ return p >= 11; } }
];
var PF_DIST_BANDS = [
  { k: 'd1', label: '〜1400m', min: 0, max: 1400 },
  { k: 'm1', label: '1500〜1800m', min: 1401, max: 1800 },
  { k: 'm2', label: '1900〜2200m', min: 1801, max: 2200 },
  { k: 'l1', label: '2300m〜', min: 2201, max: 99999 }
];

function pfBandOf(m){
  var d = parseInt(m, 10) || 0;
  for (var i = 0; i < PF_DIST_BANDS.length; i++){
    if (d >= PF_DIST_BANDS[i].min && d <= PF_DIST_BANDS[i].max) return PF_DIST_BANDS[i];
  }
  return null;
}
function pfPosBandOf(pos){
  var p = parseInt(pos, 10) || 0;
  if (p < 1) return null;
  for (var i = 0; i < PF_POS_BANDS.length; i++){
    if (PF_POS_BANDS[i].test(p)) return PF_POS_BANDS[i];
  }
  return null;
}
/* ② 展開予想のラベル（スロー/ややスロー/平均/ややハイ/ハイ/超ハイ）→ S/M/H */
function pfPaceOfLabel(label){
  var s = String(label || '');
  if (/^スロー|^ややスロー|遅い/.test(s)) return 'S';
  if (/^平均|^ミドル|^M/.test(s)) return 'M';
  if (/ハイ|^速い|^H/.test(s)) return 'H';
  return '';
}
/* ② 展開予想のスコア(0..1) → S/M/H（paceAnalysis の label 判定と同じ境目） */
function pfPaceOfScore(sc){
  var x = parseFloat(sc);
  if (!isFinite(x)) return '';
  if (x < 0.46) return 'S';
  if (x < 0.66) return 'M';
  return 'H';
}
/* 馬名の照合用（スペース・中黒・括弧の中を落とす） */
function pfNameKey(s){
  return String(s == null ? '' : s)
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s\u3000・．.、]/g, '')
    .toUpperCase();
}
/* 4角の位置 → 脚質 */
function pfStyleAt(pos, n){
  if (typeof rdPosStyle === 'function') return rdPosStyle(pos, n);
  var p = parseInt(pos, 10) || 0, nn = parseInt(n, 10) || 0;
  if (!(p >= 1) || !(nn >= 2)) return '';
  if (p === 1) return '逃げ';
  var r = (p - 1) / (nn - 1);
  if (r <= 0.3) return '先行';
  if (r <= 0.6) return '差し';
  return '追込';
}
/* 通過順 '6-7-6-8' → 4角の位置 8 */
function pfLastPos(passing){
  var s = String(passing || '').replace(/[^\d-]/g, '');
  if (!s) return 0;
  var a = s.split('-').filter(function(x){ return x !== ''; });
  if (!a.length) return 0;
  return parseInt(a[a.length - 1], 10) || 0;
}
function pfCnt(){ return { n: 0, top3: 0, win: 0, orders: [] }; }
function pfAdd(c, order){
  var o = parseInt(order, 10) || 0;
  if (o < 1) return;                 // 中止・取消・除外は数えない
  c.n++;
  c.orders.push(o);
  if (o === 1) c.win++;
  if (o <= 3) c.top3++;
}
function pfRate(c){ return (c && c.n) ? c.top3 / c.n : null; }
function pfWinRate(c){ return (c && c.n) ? c.win / c.n : null; }
function pfPct(x, digits){
  if (x == null || !isFinite(x)) return '—';
  return (x * 100).toFixed(digits == null ? 0 : digits) + '%';
}

/* ---------- 学習DB（＋当日のトラックバイアス）から「1レース」の形に整える ---------- */
/* → { rid, date8, place, surface, m, band, baba, pace, paceSrc, n,
       horses:[{ no, name, key, order, pos4, style, posBand }] }  作れなければ null */
function pfNormalizeRace(rec){
  if (!rec || !rec.rows || !rec.rows.length) return null;
  var meta = rec.meta || {};
  var xd = rec.xd || (rec.result && rec.result.xd) || null;
  var m = parseInt(meta.m, 10) || 0;
  var surface = String(meta.surface || '');
  var place = String(meta.place || '');
  if (!m && meta.dist){ var dm = String(meta.dist).match(/(\d{3,4})/); if (dm) m = parseInt(dm[1], 10); }
  var n = parseInt(rec.n, 10) || rec.rows.length;
  // ペース: netkeiba の表示 → 無ければラップの前3F-後3Fから推定
  var pace = xd && xd.pace ? String(xd.pace).toUpperCase().charAt(0) : '';
  var paceSrc = (xd && xd.paceSrc) || '';
  if (!pace && xd && xd.shape && xd.shape.d != null){
    var d = xd.shape.d;
    pace = d >= 1.5 ? 'S' : (d <= -1.5 ? 'H' : 'M');
    paceSrc = 'lap';
  }
  var horses = [];
  rec.rows.forEach(function(r){
    if (!r) return;
    var order = parseInt(r.order, 10) || 0;
    if (order < 1) return;
    var no = String(r.no || '');
    var pos4 = 0;
    if (xd && xd.pos && xd.pos[no] && xd.pos[no].length) pos4 = xd.pos[no][xd.pos[no].length - 1];
    if (!pos4) pos4 = pfLastPos(r.passing);
    var pb = pfPosBandOf(pos4);
    horses.push({
      no: no, name: String(r.name || ''), key: pfNameKey(r.name),
      order: order, pos4: pos4,
      style: pos4 ? pfStyleAt(pos4, n) : '',
      posBand: pb ? pb.k : '', posBandLabel: pb ? pb.label : ''
    });
  });
  if (!horses.length) return null;
  return {
    rid: String(rec.rid || ''), date8: String(rec.date8 || meta.date8 || ''),
    place: place, surface: surface, m: m, band: (pfBandOf(m) || {}).k || '', bandLabel: (pfBandOf(m) || {}).label || '',
    baba: String(meta.baba || ''), pace: pace, paceSrc: paceSrc, n: horses.length,
    horses: horses,
    laps: xd && xd.laps ? xd.laps.length : 0,
    hasXD: !!xd
  };
}

/* 学習に使うレースを集める（学習DB + 当日のトラックバイアス） */
function pfRaces(opt){
  opt = opt || {};
  var out = [], seen = {};
  function push(rec){
    if (!rec || !rec.rid || seen[rec.rid]) return;
    var r = pfNormalizeRace(rec);
    if (!r) return;
    seen[rec.rid] = 1;
    out.push(r);
  }
  try {
    if (typeof diLs === 'function'){
      var db = diLs() || {};
      var races = db.races || {};
      for (var rid in races){ if (Object.prototype.hasOwnProperty.call(races, rid)) push(races[rid]); }
    }
  } catch(e){}
  // 当日のトラックバイアスにも第16弾から xd が入るので、学習DBに無いぶんを足す
  if (!opt.skipBias){
    try {
      var br = (typeof state !== 'undefined' && state && state.biasRaces) ? state.biasRaces : [];
      br.forEach(function(b){
        if (!b || !b.xd || seen[b.id]) return;
        push({
          rid: b.id, date8: b.date || '', n: b.n || 0,
          meta: { place: b.venue || '', surface: b.surface || '', m: b.dist || 0, dist: (b.surface || '') + (b.dist || '') + 'm', baba: b.baba || '' },
          rows: (b.allRows || b.money || []).map(function(x){
            return { order: x.rank, no: x.no, name: x.name, passing: x.passing };
          }),
          xd: b.xd
        });
      });
    } catch(e){}
  }
  return out;
}

/* ---------- 集計（学習） ---------- */
function pfLearn(races){
  var L = {
    v: 1, at: 0, races: 0, withPace: 0, withXD: 0, withCorner: 0,
    pace: { S: {}, M: {}, H: {} },                       // ペース × 脚質 → 3着内率
    paceAll: { S: pfCnt(), M: pfCnt(), H: pfCnt() },     // ペースごとの全馬
    corner: {},                                          // '場|面|距離帯' × 脚質
    pos: {},                                             // '場|面|距離帯' × 4角の位置帯
    posAll: {},                                          // 距離帯 × 4角の位置帯（全場まとめ）
    horse: {},                                           // 馬名 → ペース別成績
    venue: {},                                           // 場 → レース数・日数
    dist: {}                                             // 距離帯 → レース数
  };
  PF_STYLES.forEach(function(s){
    L.pace.S[s] = pfCnt(); L.pace.M[s] = pfCnt(); L.pace.H[s] = pfCnt();
  });
  (races || []).forEach(function(r){
    L.races++;
    if (r.pace) L.withPace++;
    if (r.hasXD) L.withXD++;
    var hasCorner = false;
    var ck = r.place && r.band ? (r.place + '|' + (r.surface || '?') + '|' + r.band) : '';
    if (ck){
      L.corner[ck] = L.corner[ck] || {};
      L.pos[ck] = L.pos[ck] || {};
      PF_STYLES.forEach(function(s){ if (!L.corner[ck][s]) L.corner[ck][s] = pfCnt(); });
      PF_POS_BANDS.forEach(function(pb){ if (!L.pos[ck][pb.k]) L.pos[ck][pb.k] = pfCnt(); });
    }
    var pk = r.band || '?';
    L.posAll[pk] = L.posAll[pk] || {};
    PF_POS_BANDS.forEach(function(pb){ if (!L.posAll[pk][pb.k]) L.posAll[pk][pb.k] = pfCnt(); });
    L.dist[pk] = (L.dist[pk] || 0) + 1;
    if (r.place){
      var vv = L.venue[r.place] = L.venue[r.place] || { races: 0, days: {} };
      vv.races++;
      if (r.date8) vv.days[r.date8] = 1;
    }
    r.horses.forEach(function(h){
      if (h.pos4) hasCorner = true;
      // 1) ペース × 脚質
      if (r.pace && h.style){
        pfAdd(L.pace[r.pace][h.style], h.order);
        pfAdd(L.paceAll[r.pace], h.order);
      }
      // 2) コーナー位置バイアス（場別 / 全体）
      if (h.style && ck) pfAdd(L.corner[ck][h.style], h.order);
      if (h.posBand){
        if (ck) pfAdd(L.pos[ck][h.posBand], h.order);
        pfAdd(L.posAll[pk][h.posBand], h.order);
      }
      // 3) 馬ごとの展開適性
      if (h.key){
        var hk = L.horse[h.key] = L.horse[h.key] || { name: h.name, S: pfCnt(), M: pfCnt(), H: pfCnt(), all: pfCnt(), place: {} };
        pfAdd(hk.all, h.order);
        if (r.pace) pfAdd(hk[r.pace], h.order);
        if (r.place){
          hk.place[r.place] = hk.place[r.place] || pfCnt();
          pfAdd(hk.place[r.place], h.order);
        }
      }
    });
    if (hasCorner) L.withCorner++;
  });
  // 場ごとの開催日数
  for (var v in L.venue){ if (Object.prototype.hasOwnProperty.call(L.venue, v)) L.venue[v].days = Object.keys(L.venue[v].days).length; }
  L.at = Date.now();
  return L;
}

/* ---------- 学習結果 → 倍率・説明文 ---------- */
/* ペース × 脚質 の3着内率から倍率を作る（1.0 = ふつう） */
function pfPaceStyleMul(L, pace, style){
  if (!L || !pace || !style || !L.pace[pace] || !L.pace[pace][style]) return { mul: 1, txt: '', n: 0 };
  var c = L.pace[pace][style];
  var all = L.paceAll[pace];
  if (c.n < PF_MIN || !all || all.n < PF_MIN) return { mul: 1, txt: '', n: c.n };
  var base = pfRate(all) || (1 / 3);
  var r = pfRate(c);
  if (r == null) return { mul: 1, txt: '', n: c.n };
  var mul = Math.max(0.72, Math.min(1.32, 1 + (r / base - 1) * 0.35));
  return {
    mul: Math.round(mul * 1000) / 1000, n: c.n,
    txt: '過去の' + (rdPaceJa ? rdPaceJa(pace) : pace) + 'ペースでは' + style + 'の3着内率 ' + pfPct(r) +
         '（' + c.n + '戦・全体の ' + pfPct(base) + ' に対して）'
  };
}
/* 4角の位置帯 × 距離帯（場があれば場別）の3着内率から倍率を作る */
function pfPosMul(L, place, surface, band, posBand){
  if (!L || !posBand) return { mul: 1, txt: '', n: 0 };
  var ck = place && band ? (place + '|' + (surface || '?') + '|' + band) : '';
  var src = null, where = '';
  if (ck && L.pos[ck] && L.pos[ck][posBand] && L.pos[ck][posBand].n >= PF_MIN){
    src = L.pos[ck][posBand]; where = place + 'の' + (L.pos[ck] ? '' : '');
  } else if (band && L.posAll[band] && L.posAll[band][posBand]){
    src = L.posAll[band][posBand]; where = '全場の' + ((pfBandLabel(band)) || '');
  }
  if (!src || src.n < PF_MIN_SHOW) return { mul: 1, txt: '', n: 0 };
  // 母数（その条件の全出走）に対する3着内率
  var tot = 0, tot3 = 0;
  var pool = (ck && L.pos[ck] && src === L.pos[ck][posBand]) ? L.pos[ck] : (L.posAll[band] || {});
  for (var k in pool){
    if (!Object.prototype.hasOwnProperty.call(pool, k)) continue;
    tot += pool[k].n; tot3 += pool[k].top3;
  }
  var base = tot ? tot3 / tot : (1 / 3);
  var r = pfRate(src);
  if (r == null || !base) return { mul: 1, txt: '', n: src.n };
  var mul = Math.max(0.75, Math.min(1.30, 1 + (r / base - 1) * 0.30));
  var pb = null;
  PF_POS_BANDS.forEach(function(x){ if (x.k === posBand) pb = x; });
  return {
    mul: Math.round(mul * 1000) / 1000, n: src.n,
    txt: (where ? where + '・' : '') + '4角' + (pb ? pb.label : posBand) + 'の3着内率 ' + pfPct(r) +
         '（' + src.n + '戦・同条件全体の ' + pfPct(base) + ' に対して）'
  };
}
function pfBandLabel(k){
  for (var i = 0; i < PF_DIST_BANDS.length; i++) if (PF_DIST_BANDS[i].k === k) return PF_DIST_BANDS[i].label;
  return '';
}
/* 馬ごとの展開適性（今回のペース予想に対して） */
function pfHorseFit(L, name, pace){
  var key = pfNameKey(name);
  if (!L || !key || !L.horse[key]) return null;
  var h = L.horse[key];
  var out = { name: h.name, all: h.all, S: h.S, M: h.M, H: h.H, pace: pace || '', mul: 1, txt: '' };
  if (!pace || !h[pace] || h[pace].n < PF_MIN){
    out.txt = '学習DBにこの馬の' + (pace ? (rdPaceJa ? rdPaceJa(pace) : pace) + 'ペース時の' : '') +
              '出走が ' + ((h[pace] && h[pace].n) || 0) + ' 戦しかなく、展開適性は判定できません（全' + h.all.n + '戦の3着内率 ' + pfPct(pfRate(h.all)) + '）';
    return out;
  }
  var r = pfRate(h[pace]);
  var rAll = pfRate(h.all);
  var base = rAll || (1 / 3);
  var mul = Math.max(0.70, Math.min(1.40, 1 + (r / base - 1) * 0.40));
  out.mul = Math.round(mul * 1000) / 1000;
  out.txt = 'この馬は' + (rdPaceJa ? rdPaceJa(pace) : pace) + 'ペースで ' + h[pace].top3 + '/' + h[pace].n +
            '（3着内率 ' + pfPct(r) + '）。全ペースでは ' + h.all.top3 + '/' + h.all.n + '（' + pfPct(rAll) + '）' +
            (r > rAll ? ' → 今回のペースは【向く】' : (r < rAll ? ' → 今回のペースは【割引】' : ' → ほぼ平均的'));
  return out;
}

/* 1頭ぶんの総合倍率と説明（AI予想・展開適性の表示から呼ぶ） */
function pfScoreFor(L, h, ctx){
  ctx = ctx || {};
  var out = { mul: 1, notes: [], fit: null, paceStyle: null, pos: null };
  if (!L || !h) return out;
  var pace = ctx.pace || '';
  var style = String(h.style || '').trim();
  var band = ctx.band || (pfBandOf(ctx.m) || {}).k || '';
  var surface = ctx.surface || '';
  var place = ctx.place || '';
  // 1) 馬ごとの展開適性
  var fit = pfHorseFit(L, h.name, pace);
  out.fit = fit;
  if (fit && fit.mul !== 1){ out.mul *= fit.mul; out.notes.push('🐎 ' + fit.txt); }
  // 2) ペース × 脚質
  if (pace && style){
    var ps = pfPaceStyleMul(L, pace, style);
    out.paceStyle = ps;
    if (ps.mul !== 1){ out.mul *= ps.mul; out.notes.push('🌊 ' + ps.txt); }
  }
  // 3) コーナー位置バイアス（脚質を4角位置の帯に読み替えて照会）
  var posBand = { '逃げ': '1', '先行': '2-3', '差し': '4-6', '追込': '11-' }[style] || '';
  if (posBand){
    var pm = pfPosMul(L, place, surface, band, posBand);
    out.pos = pm;
    if (pm.mul !== 1){ out.mul *= pm.mul; out.notes.push('🏟 ' + pm.txt); }
  }
  out.mul = Math.round(Math.max(0.6, Math.min(1.6, out.mul)) * 1000) / 1000;
  return out;
}

/* ---------- 保存・読込 ---------- */
function pfSave(L){
  try {
    if (typeof cmpPack === 'function') localStorage.setItem(PF_LS, cmpPack(JSON.stringify(L)));
    else localStorage.setItem(PF_LS, JSON.stringify(L));
  } catch(e){}
}
function pfLoad(){
  try {
    var raw = (typeof cmpUnpack === 'function') ? cmpUnpack(localStorage.getItem(PF_LS)) : localStorage.getItem(PF_LS);
    if (!raw) return null;
    var o = JSON.parse(raw);
    return (o && o.v === 1) ? o : null;
  } catch(e){ return null; }
}
var pfMem = null;
/* 集計を取り直す（学習DBを取り込んだあとに呼ぶ）
   ※ 0レースのときは「空の集計」を記憶も保存もしない。
      起動直後（まだ何も取り込んでいない）に呼ばれても、その後に取り込んだぶんが
      ちゃんと集計し直されるようにするため。 */
function pfRebuild(save){
  var races = pfRaces();
  var L = pfLearn(races);
  pfMem = (L && L.races) ? L : null;
  if (save !== false && L && L.races) pfSave(L);
  return L;
}
function pfGet(){
  if (pfMem) return pfMem;
  var L = pfLoad();
  if (!L || !L.races) L = pfRebuild(false);
  if (L && L.races) pfMem = L;
  return L;
}
/* 連続取込中に何度も集計し直さないためのまとめ実行 */
var pfTimer = null;
function pfSchedule(ms){
  if (pfTimer) return;
  pfTimer = setTimeout(function(){
    pfTimer = null;
    try { pfRebuild(true); pfPaint(); } catch(e){}
  }, ms || 2500);
}

/* ---------- 表示 ---------- */
function pfBar(rate, base){
  var w = rate == null ? 0 : Math.max(2, Math.min(100, Math.round(rate * 100)));
  var col = (rate != null && base != null && rate > base) ? 'var(--ok-ink)' : ((rate != null && base != null && rate < base) ? 'var(--warn-ink)' : 'var(--acc-ink)');
  return '<span style="display:inline-block;vertical-align:middle;width:64px;height:7px;border-radius:4px;background:var(--card2);border:1px solid var(--line2);overflow:hidden">' +
    '<i style="display:block;height:100%;width:' + w + '%;background:' + col + '"></i></span>';
}
function pfTable(title, head, rows, note){
  var h = ['<div style="margin-top:8px"><b>' + title + '</b>'];
  if (note) h.push('<div class="small muted" style="line-height:1.6">' + note + '</div>');
  h.push('<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.76rem;white-space:nowrap;margin-top:4px"><thead><tr>');
  head.forEach(function(x){ h.push('<th>' + x + '</th>'); });
  h.push('</tr></thead><tbody>');
  if (!rows.length) h.push('<tr><td colspan="' + head.length + '" class="muted">まだデータがありません</td></tr>');
  rows.forEach(function(r){ h.push('<tr>' + r.map(function(c){ return '<td>' + c + '</td>'; }).join('') + '</tr>'); });
  h.push('</tbody></table></div></div>');
  return h.join('');
}
function pfLearnHTML(L, ctx){
  ctx = ctx || {};
  var h = [];
  if (!L || !L.races){
    return '<div class="small muted">学習DBにレースがありません。📅日付指定／📚年指定の一括取得で結果を取り込むと、' +
      'コーナー通過順・ペース・200mラップが一緒に保存され、ここに出てきます。</div>';
  }
  h.push('<div class="small muted" style="line-height:1.7">学習レース <b>' + L.races + '</b> 件' +
    '（ペースが分かったもの <b>' + L.withPace + '</b> 件／コーナー通過順が分かったもの <b>' + L.withCorner + '</b> 件／追加情報あり <b>' + L.withXD + '</b> 件）' +
    '　更新: ' + (L.at ? new Date(L.at).toLocaleString('ja-JP') : '—') + '</div>');

  // 1) ペース × 脚質
  var rows1 = [];
  ['S', 'M', 'H'].forEach(function(p){
    var all = L.paceAll[p];
    var base = pfRate(all);
    PF_STYLES.forEach(function(st, i){
      var c = L.pace[p][st];
      if (!c || c.n < PF_MIN_SHOW) return;
      var r = pfRate(c);
      rows1.push([
        i === 0 ? '<b>' + (rdPaceJa ? rdPaceJa(p) : p) + '</b>（' + all.n + '戦）' : '',
        st, c.n + '戦', c.top3 + '回', pfBar(r, base) + ' ' + pfPct(r),
        base == null ? '—' : pfPct(base),
        (r == null || base == null) ? '' : (r > base ? '<span style="color:var(--ok-ink);font-weight:700">有利</span>' : (r < base ? '<span style="color:var(--warn-ink)">不利</span>' : '互角'))
      ]);
    });
  });
  h.push(pfTable('🌊 ペース別の脚質有利・不利（学習DBの全レース）',
    ['ペース', '脚質', '出走', '3着内', '3着内率', '同ペース全体', '判定'], rows1,
    '「ハイペースの日は差しが来る」などを、結果が確定したレースだけで数えています。サンプルが ' + PF_MIN_SHOW + ' 戦未満の行は出しません。'));

  // 2) コーナー位置バイアス（今回の競馬場があればそれを、無ければ距離帯の全体）
  var place = ctx.place || '', surface = ctx.surface || '', band = ctx.band || '';
  var ck = place && band ? (place + '|' + (surface || '?') + '|' + band) : '';
  var src = (ck && L.pos[ck]) ? L.pos[ck] : (band && L.posAll[band] ? L.posAll[band] : null);
  var srcName = src === (ck ? L.pos[ck] : null) ? (place + '・' + (surface || '') + '・' + pfBandLabel(band)) : ('全場・' + pfBandLabel(band));
  if (src){
    var tot = 0, tot3 = 0;
    for (var k in src){ if (Object.prototype.hasOwnProperty.call(src, k)){ tot += src[k].n; tot3 += src[k].top3; } }
    var base2 = tot ? tot3 / tot : null;
    var rows2 = [];
    PF_POS_BANDS.forEach(function(pb){
      var c = src[pb.k];
      if (!c || c.n < PF_MIN_SHOW) return;
      var r = pfRate(c);
      rows2.push([pb.label, c.n + '戦', c.win + '回', c.top3 + '回', pfBar(r, base2) + ' ' + pfPct(r),
        (r == null || base2 == null) ? '' : (r > base2 ? '<span style="color:var(--ok-ink);font-weight:700">有利</span>' : (r < base2 ? '<span style="color:var(--warn-ink)">不利</span>' : '互角'))]);
    });
    h.push(pfTable('🏟 コーナー通過順のバイアス（4角の位置別・' + srcName + '）',
      ['4角の位置', '出走', '1着', '3着内', '3着内率', '判定'], rows2,
      '開催日が経ってレースが溜まるほど、この競馬場の「前が有利か・差しが利くか」がはっきりします。' +
      (ck && L.pos[ck] ? 'まずは今回の条件（' + srcName + '）を出し、サンプルが足りないときは全場の同じ距離帯で代用します。' : '今回は条件が特定できないため全場の同じ距離帯で出しています。')));
  }

  // 3) 競馬場ごとのデータ量
  var rows3 = [];
  Object.keys(L.venue).sort(function(a, b){ return L.venue[b].races - L.venue[a].races; }).forEach(function(v){
    var vv = L.venue[v];
    rows3.push([v, vv.races + ' レース', vv.days + ' 日']);
  });
  h.push(pfTable('📅 競馬場ごとの学習量', ['競馬場', 'レース数', '開催日数'], rows3,
    'トラックバイアスは当日ぶんのみですが、この学習は履歴が溜まるほど精度が上がります。'));
  return h.join('');
}

/* 今回の出走馬ごとの展開適性（①の出馬表と②の展開予想に接続） */
function pfHorsesHTML(L, ctx){
  if (!L || !L.races) return '';
  var hs = [];
  try { hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : []; } catch(e){}
  if (!hs.length) return '';
  var rows = [];
  hs.forEach(function(h){
    if (!h || !h.name) return;
    var sc = pfScoreFor(L, h, ctx);
    var fit = sc.fit;
    if (!fit) return;
    rows.push([
      (h.no || '') + ' ' + esc(h.name || ''),
      (h.style || '不明'),
      fit.all ? (fit.all.top3 + '/' + fit.all.n) : '—',
      fit.S && fit.S.n ? (fit.S.top3 + '/' + fit.S.n) : '—',
      fit.M && fit.M.n ? (fit.M.top3 + '/' + fit.M.n) : '—',
      fit.H && fit.H.n ? (fit.H.top3 + '/' + fit.H.n) : '—',
      sc.mul === 1 ? '<span class="muted">—</span>' :
        '<b style="color:' + (sc.mul > 1 ? 'var(--ok-ink)' : 'var(--warn-ink)') + '">' + (sc.mul > 1 ? '×' : '×') + sc.mul.toFixed(3) + '</b>',
      '<span class="small" style="white-space:normal">' + esc(fit.txt || '') + '</span>'
    ]);
  });
  if (!rows.length) return '<div class="small muted">学習DBに今回の出走馬の過去レースがまだありません。</div>';
  return pfTable('🐎 今回の出走馬の展開適性（学習DBの同名馬から集計）',
    ['馬', '脚質', '全', 'スロー', 'ミドル', 'ハイ', '予想への補正', '根拠'], rows,
    '3着内率を「そのペースのとき」と「全ペース」で比べて、今回のペース予想に合うかを倍率にしています。' +
    'サンプルが ' + PF_MIN + ' 戦未満の馬は倍率を掛けません（根拠が薄いので判定しない）。');
}

/* 折り込んだままでも要点が読めるように summary（#pfPick）へ1行出す
   ※ 第15弾の⑤⑥⑦と同じ方針: 説明が長いものは折り込み、閉じたままでも狙い目が分かるようにする */
function pfHead(L, ctx){
  try {
    var cnt = document.getElementById('pfCount');
    var pick = document.getElementById('pfPick');
    var ctxEl = document.getElementById('pfCtx');
    var races = (L && L.races) ? L.races : 0;
    var horses = (L && L.horse) ? Object.keys(L.horse).length : 0;
    if (cnt) cnt.textContent = races ? (races + 'レース学習中') : '未学習';
    if (ctxEl){
      ctxEl.textContent = (ctx.place || '?') + '・' + (ctx.surface || '?') +
        (ctx.m ? ctx.m + 'm' : '') + '・今回のペース予想: ' +
        (ctx.paceLabel ? ctx.paceLabel + '(' + (ctx.pace || '?') + ')' : (ctx.pace || '未判定'));
    }
    if (!pick) return;
    if (!races){
      pick.textContent = '📚 まだ展開の学習データがありません。学習DBにレースを取り込むと、コーナー通過順・ペース・200mラップが一緒に保存されて学習が始まります。';
      return;
    }
    var bits = [];
    bits.push('📚 ' + races + 'レース（' + horses + '頭ぶん）から集計済み');
    // 今回のペースで有利な脚質
    if (ctx.pace && L.pace && L.pace[ctx.pace]){
      var best = null;
      PF_STYLES.forEach(function(st){
        var c = L.pace[ctx.pace][st];
        if (!c || c.n < PF_MIN_SHOW) return;
        var r = pfRate(c);
        if (r == null) return;
        if (!best || r > best.r) best = { st: st, r: r, n: c.n };
      });
      if (best) bits.push((rdPaceJa ? rdPaceJa(ctx.pace) : ctx.pace) + 'ペースは【' + best.st + '】が有利（3着内率 ' + pfPct(best.r) + '・' + best.n + '戦）');
    }
    // 4角の位置バイアス
    var ck = (ctx.place && ctx.band) ? (ctx.place + '|' + (ctx.surface || '?') + '|' + ctx.band) : '';
    var src = (ck && L.pos && L.pos[ck]) ? L.pos[ck] : ((ctx.band && L.posAll && L.posAll[ctx.band]) ? L.posAll[ctx.band] : null);
    if (src){
      var tot = 0, tot3 = 0, top = null;
      PF_POS_BANDS.forEach(function(pb){
        var c = src[pb.k];
        if (!c || c.n < PF_MIN_SHOW) return;
        tot += c.n; tot3 += c.top3;
        var r = pfRate(c);
        if (r == null) return;
        if (!top || r > top.r) top = { label: pb.label, r: r, n: c.n };
      });
      if (top && tot) bits.push('4角【' + top.label + '】の3着内率が最も高い（' + pfPct(top.r) + '・' + top.n + '戦／全体 ' + pfPct(tot3 / tot) + '）');
    }
    // 今回の出走馬で展開が一番向く馬
    var hs = [];
    try { hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : []; } catch(e){}
    var topH = null;
    hs.forEach(function(h){
      if (!h || !h.name) return;
      var sc = pfScoreFor(L, h, ctx);
      if (sc.mul === 1) return;
      if (!topH || sc.mul > topH.mul) topH = { h: h, mul: sc.mul, fit: sc.fit };
    });
    if (topH) bits.push('🎯 今回の狙い目: ' + esc((topH.h.no || '') + ' ' + (topH.h.name || '')) +
      '（展開補正 ×' + topH.mul.toFixed(3) + (topH.fit && topH.fit.txt ? '・' + esc(topH.fit.txt) : '') + '）');
    else bits.push('🎯 今回の出走馬に展開学習で判定できた馬はいません（学習DBに過去レースが無い・サンプル ' + PF_MIN + ' 戦未満）');
    pick.innerHTML = bits.join(' ／ ');
  } catch(e){}
}

/* カードの描画 */
function pfPaint(){
  var box = null;
  try { box = document.getElementById('pfBox'); } catch(e){}
  if (!box) return;
  var L = pfGet();
  var ctx = pfCtx();
  pfHead(L, ctx);
  var h = [];
  h.push(pfLearnHTML(L, ctx));
  h.push(pfHorsesHTML(L, ctx));
  h.push('<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
    '<button type="button" class="btn ghost" id="pfRebuild" title="学習DBの全レースから集計し直します">🔄 集計し直す</button>' +
    '<span class="small muted">集計は自動で走ります（学習DBを取り込んだ2.5秒後）。</span></div>');
  box.innerHTML = h.join('');
  try {
    var b = document.getElementById('pfRebuild');
    if (b) b.addEventListener('click', function(){ pfRebuild(true); pfPaint(); });
  } catch(e){}
}
/* ---------- AI予想（p5_engine の展開適性）から呼ばれる入口 ---------- */
// 出走馬1頭ずつの倍率(0.6〜1.6)を返す。学習データが無い・反映OFFのときは null（＝何もしない）。
function pfHorseMuls(hs, st, paceInfo){
  try {
    /* ★2026-09-12 第18弾: バックテスト中はOFF。
       展開学習は学習DB「全体」の集計で日付フィルタを持たないため、
       対象レース自身の結果（通過順・ペース）が混ざって いかさま になってしまう。 */
    try { if (window.BT_MODE) return null; } catch(e){}
    var chk = document.getElementById('pfUseChk');
    if (chk && !chk.checked) return null;
    var L = pfGet();
    if (!L || !L.horse || !Object.keys(L.horse).length) return null;
    var ctx = pfCtx();
    // エンジンが計算した「今回のペース予想」があればそちらを優先（AI印と同じ前提にする）
    var sc = (paceInfo && paceInfo.score != null) ? Number(paceInfo.score) : NaN;
    if (isFinite(sc)) ctx.pace = pfPaceOfScore(sc) || ctx.pace;
    if (!ctx.pace) ctx.pace = 'M';
    return (hs || []).map(function(h){
      try { return pfScoreFor(L, { name: h.name, style: h.style }, ctx).mul; } catch(e){ return 1; }
    });
  } catch(e){ return null; }
}
/* AI予想の行ごとの説明（🏇馬柱AI評価・④分析の展開適性セルの title に出す用） */
function pfExplain(name, style){
  try {
    var L = pfGet();
    if (!L || !L.horse || !Object.keys(L.horse).length) return '';
    var ctx = pfCtx();
    if (!ctx.pace) ctx.pace = 'M';
    var r = pfScoreFor(L, { name: name, style: style }, ctx);
    if (!r.notes || !r.notes.length) return '';
    return '展開学習（' + PF_MIN + '戦以上で判定）: 倍率 ' + r.mul.toFixed(3) + ' ／ ' + r.notes.join(' ／ ');
  } catch(e){ return ''; }
}
/* 起動・タブを開いたときの初回描画 */
function pfBoot(){
  try {
    pfPaint();
    var chk = document.getElementById('pfUseChk');
    if (chk && !chk.pfBound){
      chk.pfBound = true;
      chk.addEventListener('change', function(){
        try { if (typeof rebuildHorseTable === 'function') rebuildHorseTable(); } catch(e){}
        try { if (typeof pfPaint === 'function') pfPaint(); } catch(e){}
      });
    }
  } catch(e){}
  setTimeout(function(){ try { pfPaint(); } catch(e){} }, 400);
}

/* 今回のレース条件（①の入力欄から） */
function pfCtx(){
  var ctx = { place: '', surface: '', m: 0, band: '', pace: '' };
  try {
    if (typeof readRaceMeta === 'function'){
      var mm = readRaceMeta() || {};
      var txt = (mm.place || '') + ' ' + (mm.name || '');
      var vm = txt.match(/(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)/);
      if (vm) ctx.place = vm[1];
      var dm = txt.match(/(芝|ダ(?:ート)?|障(?:害)?)/);
      if (dm) ctx.surface = /障/.test(dm[1]) ? '障' : (/ダ/.test(dm[1]) ? 'ダ' : '芝');
      var d2 = String(mm.dist || '').match(/(\d{3,4})/);
      if (d2) ctx.m = parseInt(d2[1], 10);
      if (!ctx.m && txt){ var d3 = txt.match(/(芝|ダ|障)\s*(\d{3,4})/); if (d3) ctx.m = parseInt(d3[2], 10); }
    }
  } catch(e){}
  var b = pfBandOf(ctx.m);
  if (b){ ctx.band = b.k; ctx.bandLabel = b.label; }
  try {
    if (typeof paceAnalysis === 'function' && typeof state !== 'undefined' && state && state.horses){
      var pa = paceAnalysis(state.horses, (typeof readRaceMeta === 'function' ? readRaceMeta() : {}));
      if (pa){
        ctx.paceLabel = pa.label || '';
        ctx.pace = pfPaceOfLabel(pa.label) || pfPaceOfScore(pa.score);
      }
    }
  } catch(e){}
  return ctx;
}

/* ---------- 初期化（p10_main.js の boot() から呼ばれる） ---------- */
function initPf(){
  try {
    var L = pfLoad();
    if (L) pfMem = L;                      // 保存済みの集計があればすぐ使える
    pfBoot();
  } catch(e){}
}
