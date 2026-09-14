/* =========================================================
   p51_apdiag.js — 🔬 AI予想の「診断」（計測だけをする。印の付け方は一切変えない）
   （#2026-09-12 第17弾・提案1）

   背景（2026-09-12 のコード調査で判明したこと）:
     ・メインエンジン(p5_engine)の最終確率は `0.745×市場確率 + 0.255×モデル` なので
       実効オッズ依存が約79%。→ ◎が1番人気に寄るのは仕様どおりで、寄りすぎ。
     ・🎯的中率重視(apUScores mode='hit')は `marketU + (colK-0.5)*0.5` で、
       脚質が動かせる幅は±0.25しかない。1番人気と2番人気の marketU 差は普通0.27前後なので、
       脚質評価の差が0.55以上無い限り◎は1番人気から動かない。
     ・💰回収率重視(mode='roi')は1〜4番人気を強制排除するが、その中の順位づけが
       colK(脚質)とオッズの高さだけ。→ 妙味ではなく単なる人気フィルター。

   そこで「実際にどれだけ人気に寄っているか」「市場を上回れているか」を
   保存済みの自己検証レコードから計測して数字で出す。改善の方向を決めるための計測。

   ★ 用語
     市場期待勝率 mi = (1/オッズ) ÷ Σ(1/オッズ)  … 控除後オッズから逆算した「市場の見立て」
     リフト          = 実勝率 − 市場期待勝率       … プラスなら「AIはその集団を正しく見抜いた」
     基準線A         = 1番人気を毎レース単勝100円買い続けた回収率
     基準線B         = 全頭均等買い（＝ランダム1頭買い）の回収率 = mean(勝馬オッズ ÷ 頭数)
                       ※ JRAの単勝は控除後なので普通 70〜85% になる。ここを超えられていなければ
                          そのモデルに「市場に対する優位性」は無い。
   ========================================================= */

var APD_MIN_N = 100;      // 「判定できる」と言える最低レース数
var APD_LIFT_MIN = 10;    // リフトの判定（✅/⚠）を出すのに必要な最低頭数。これ未満は結論を出さない
var APD_MODELS = [
  { id: 'hit', label: '🎯 的中率重視' },
  { id: 'roi', label: '💰 回収率重視' },
  { id: 'hyb', label: '🔰 ハイブリッド' },
  /* ★2026-09-12 第17弾: 出走前に実際に保存しておいた「①のAI印」。
     hit/roi/hyb は結果ページから印を作り直した**再シミュレーション**（apUScores の3要素）ですが、
     こちらは p5_engine の7要素＋展開学習で実際に出した印なので **本当の成績** です。
     ①の「📥 その日の出馬表を一括取得」でレース前に取り込んでおいたレースだけに入ります。 */
  { id: 'pre', label: '📌 事前予想（実際の印）', src: 'preMarks' },
  /* ★2026-09-12 第18弾: 🕰バックテスト。過去レースを「その日付より前の出走データだけ」で予想し直し、
     あとで結果と照合したもの（p53 preBacktest → rec.preBt / rec.preBtMarks）。
     📌事前予想と同じエンジン・同じ条件（出馬表＋オッズ＋履歴からの脚質）なので、
     こちらの方が**サンプルが桁違いに多い**ぶん、実力の測定が安定します。 */
  { id: 'bt', label: '🕰 バックテスト（過去を予想し直し）', src: 'preBtMarks' }
];
/* 市場期待勝率の帯（キャリブレーション表用） */
var APD_CAL_BANDS = [
  { k: 'b1', label: '〜5%',   min: 0,    max: 0.05 },
  { k: 'b2', label: '5〜10%', min: 0.05, max: 0.10 },
  { k: 'b3', label: '10〜20%',min: 0.10, max: 0.20 },
  { k: 'b4', label: '20〜35%',min: 0.20, max: 0.35 },
  { k: 'b5', label: '35%〜',  min: 0.35, max: 1.01 }
];

function apdNum(v){
  if (typeof apNum === 'function') return apNum(v);
  var x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return isNaN(x) ? 0 : x;
}
function apdPct(x, d){
  if (x == null || !isFinite(x)) return '—';
  return (x * 100).toFixed(d == null ? 1 : d) + '%';
}
/* 95%信頼区間の半幅（±何ポイントか） */
function apdCI(p, n){
  if (n < 1 || p == null || !isFinite(p)) return null;
  return 1.96 * Math.sqrt(Math.max(0, p * (1 - p)) / n);
}

/* ---------- 1レコードを診断用の形に整える ---------- */
/* → { rid, n, runners:[{no,name,order,odds,mi,rank}], byNo:{}, models:{hit:[marks],...} } */
function apdNormalize(rec){
  if (!rec || !rec.result) return null;
  var rows = (rec.result.rows || []).filter(function(r){ return r && apdNum(r.order) >= 1 && r.no != null; });
  if (rows.length < 3) return null;
  var runners = rows.map(function(r){
    var o = apdNum(r.odds);
    return {
      no: String(r.no), name: String(r.name || ''),
      order: apdNum(r.order), odds: (o > 1) ? o : null,
      pop: apdNum(r.pop) || 0, mi: 0, rank: 99
    };
  });
  // 市場期待勝率（オッズ未入力の馬は母数から除く）
  var inv = 0, cnt = 0;
  runners.forEach(function(x){ if (x.odds){ inv += 1 / x.odds; cnt++; } });
  if (!(inv > 0)) return null;
  runners.forEach(function(x){ x.mi = x.odds ? (1 / x.odds) / inv : 0; });
  // 人気順（オッズ昇順。同じオッズは馬番順）
  var sorted = runners.filter(function(x){ return x.odds; })
    .slice().sort(function(a, b){ return (a.odds - b.odds) || (a.no < b.no ? -1 : 1); });
  sorted.forEach(function(x, i){ x.rank = i + 1; });
  var byNo = {};
  runners.forEach(function(x){ byNo[x.no] = x; });
  // モデルごとの印（古いレコードは cMarks が無いので marks で代用）
  var cm = rec.cMarks || {};
  var models = {};
  APD_MODELS.forEach(function(m){
    var arr = (m.src === 'preMarks') ? (rec.preMarks || [])
            : (m.src === 'preBtMarks') ? (rec.preBtMarks || [])
            : (cm[m.id] || (m.id === 'hyb' ? rec.marks : null) || []);
    models[m.id] = arr.filter(function(k){ return k && k.no != null; }).map(function(k){
      var rn = byNo[String(k.no)] || null;
      return {
        no: String(k.no), name: k.name || '', mark: k.mark || '',
        aiRank: apdNum(k.aiRank) || 0,
        oddsRank: apdNum(k.oddsRank) || (rn ? rn.rank : 99),
        odds: (rn && rn.odds) ? rn.odds : apdNum(k.odds),
        order: (rn ? rn.order : apdNum(k.order)),
        mi: rn ? rn.mi : 0, pu: apdNum(k.pu) || 0, u: apdNum(k.u) || 0
      };
    });
  });
  return { rid: String(rec.rid || ''), ym: String(rec.ym || ''), n: runners.length,
           runners: runners, byNo: byNo, models: models };
}

/* ---------- 空の集計器 ---------- */
function apdCnt(){ return { n: 0, win: 0, top3: 0, expWin: 0, ret: 0 }; }
function apdAddCnt(c, order, odds, mi){
  c.n++;
  c.expWin += (mi || 0);
  if (order === 1){ c.win++; c.ret += (odds || 0); }
  if (order >= 1 && order <= 3) c.top3++;
}
/* 集計器 → { winRate, expRate, lift, liftRatio, top3Rate, roi, ci } */
function apdFin(c){
  if (!c.n) return null;
  var w = c.win / c.n, e = c.expWin / c.n;
  return {
    n: c.n, win: c.win, top3: c.top3,
    winRate: w, expRate: e, lift: w - e, liftRatio: e > 0 ? w / e : null,
    top3Rate: c.top3 / c.n,
    roi: c.ret / c.n,                      // 1点100円の単勝回収率
    ci: apdCI(w, c.n)
  };
}

/* ---------- 市場（基準線）の集計 ---------- */
function apdMarket(list){
  var out = { races: 0, runners: 0, byRank: [], favBuy: null, randBuy: null, cal: {}, winOddsSum: 0 };
  var rankAgg = [];
  for (var i = 0; i < 20; i++) rankAgg.push(apdCnt());
  APD_CAL_BANDS.forEach(function(b){ out.cal[b.k] = apdCnt(); });
  var favRet = 0, favN = 0, randSum = 0;
  list.forEach(function(r){
    out.races++; out.runners += r.n;
    var winOdds = 0;
    r.runners.forEach(function(x){
      if (x.rank >= 1 && x.rank <= 20) apdAddCnt(rankAgg[x.rank - 1], x.order, x.odds, x.mi);
      var b = null;
      for (var j = 0; j < APD_CAL_BANDS.length; j++){
        if (x.mi >= APD_CAL_BANDS[j].min && x.mi < APD_CAL_BANDS[j].max){ b = APD_CAL_BANDS[j]; break; }
      }
      if (b) apdAddCnt(out.cal[b.k], x.order, x.odds, x.mi);
      if (x.order === 1 && x.odds) winOdds = x.odds;
    });
    out.winOddsSum += winOdds;
    // 基準線A: 1番人気を単勝100円
    var fav = null;
    r.runners.forEach(function(x){ if (x.rank === 1) fav = x; });
    if (fav){ favN++; if (fav.order === 1) favRet += (fav.odds || 0); }
    // 基準線B: 全頭均等買い（= 勝馬オッズ ÷ 頭数）
    if (winOdds && r.n) randSum += winOdds / r.n;
  });
  out.byRank = rankAgg.map(function(c, i){
    var f = apdFin(c);
    return f ? Object.assign({ rank: i + 1 }, f) : null;
  }).filter(function(x){ return x; });
  out.favBuy = favN ? { n: favN, roi: favRet / favN } : null;
  out.randBuy = out.races ? { n: out.races, roi: randSum / out.races } : null;
  out.calRows = APD_CAL_BANDS.map(function(b){
    var f = apdFin(out.cal[b.k]);
    return f ? Object.assign({ band: b.label, k: b.k }, f) : null;
  }).filter(function(x){ return x; });
  return out;
}

/* ---------- モデル1つの集計 ---------- */
function apdModel(list, id){
  var out = {
    id: id, races: 0, skipped: 0,
    popHist: [], favN: 0,
    honmei: { fav: apdCnt(), nonfav: apdCnt(), all: apdCnt() },
    marks5: { eq: apdCnt(), plan: { cost: 0, back: 0, n: 0 } },
    lift: { up: apdCnt(), same: apdCnt(), down: apdCnt() },
    raceWin: 0, raceTop3: 0,
    favRace: { n: 0, win: 0, top3: 0, back: 0 },
    nonfavRace: { n: 0, win: 0, top3: 0, back: 0 }
  };
  for (var i = 0; i < 20; i++) out.popHist.push(0);
  list.forEach(function(r){
    var ms = (r.models && r.models[id]) || [];
    if (!ms.length){ out.skipped++; return; }
    out.races++;
    // 印5頭（1点100円均等 / 信頼度配分1万円）
    var eqRet = 0, hit1 = false, hit3 = false;
    ms.forEach(function(m){
      apdAddCnt(out.marks5.eq, m.order, m.odds, m.mi);
      if (m.order === 1){ eqRet += (m.odds || 0); hit1 = true; }
      if (m.order >= 1 && m.order <= 3) hit3 = true;
      // リフト（AIが人気より上げた/下げた）
      var g = (m.aiRank && m.oddsRank && m.aiRank < m.oddsRank) ? 'up'
            : (m.aiRank && m.oddsRank && m.aiRank > m.oddsRank) ? 'down' : 'same';
      apdAddCnt(out.lift[g], m.order, m.odds, m.mi);
    });
    out.marks5.eqRet = (out.marks5.eqRet || 0) + eqRet;
    if (typeof apBetPlan === 'function'){
      try {
        var pl = apBetPlan(ms);
        if (pl && pl.pool && pl.pool.length){
          var cost = 0;
          pl.pool.forEach(function(m){ cost += (pl.stakeOf(m.no) || 0); });
          if (cost > 0){
            out.marks5.plan.cost += cost;
            out.marks5.plan.n++;
            ms.forEach(function(m){
              var amt = pl.stakeOf(m.no) || 0;
              if (m.order === 1 && m.odds && amt) out.marks5.plan.back += m.odds * amt;
            });
          }
        }
      } catch(e){}
    }
    if (hit1) out.raceWin++;
    if (hit3) out.raceTop3++;
    // 本命(◎)
    var hon = null;
    ms.forEach(function(m){ if (!hon || (m.aiRank && m.aiRank < hon.aiRank)) hon = m; });
    if (hon){
      var isFav = (hon.oddsRank === 1);
      var bucket = isFav ? out.honmei.fav : out.honmei.nonfav;
      apdAddCnt(out.honmei.all, hon.order, hon.odds, hon.mi);
      apdAddCnt(bucket, hon.order, hon.odds, hon.mi);
      if (isFav) out.favN++;
      if (hon.oddsRank >= 1 && hon.oddsRank <= 20) out.popHist[hon.oddsRank - 1]++;
      var rr = isFav ? out.favRace : out.nonfavRace;
      rr.n++;
      if (hon.order === 1){ rr.win++; rr.back += (hon.odds || 0); }
      if (hon.order >= 1 && hon.order <= 3) rr.top3++;
    }
  });
  // 仕上げ
  out.favRate = out.races ? out.favN / out.races : null;
  out.honmei.all.f = apdFin(out.honmei.all);
  out.honmei.fav.f = apdFin(out.honmei.fav);
  out.honmei.nonfav.f = apdFin(out.honmei.nonfav);
  out.marks5.f = apdFin(out.marks5.eq);
  // 印5頭を「1点100円均等」で買ったときの回収率
  //   1点ごとに100円 → 総投資 = 100×(印の延べ頭数)、払戻 = 100×(勝った印のオッズ合計)
  //   なので 回収率 = オッズ合計 ÷ 延べ頭数（頭数が5未満のレースがあっても正しい）
  out.marks5.roi5 = (out.marks5.eq.n) ? (out.marks5.eqRet || 0) / out.marks5.eq.n : null;
  out.marks5.planRoi = out.marks5.plan.cost > 0 ? out.marks5.plan.back / out.marks5.plan.cost : null;
  ['up', 'same', 'down'].forEach(function(k){ out.lift[k].f = apdFin(out.lift[k]); });
  out.raceWinRate = out.races ? out.raceWin / out.races : null;
  out.raceTop3Rate = out.races ? out.raceTop3 / out.races : null;
  return out;
}

/* ---------- まとめ ---------- */
function apdReport(opt){
  opt = opt || {};
  var recs = [];
  try { recs = (typeof apCompleted === 'function') ? (apCompleted() || []) : []; } catch(e){ recs = []; }
  if (opt.ym) recs = recs.filter(function(r){ return String(r.ym || '').slice(0, 6) === String(opt.ym).slice(0, 6); });
  var list = recs.map(apdNormalize).filter(function(x){ return x; });
  var rep = { races: list.length, records: recs.length, at: Date.now(),
              market: apdMarket(list), models: [] };
  APD_MODELS.forEach(function(m){ rep.models.push(apdModel(list, m.id)); });
  rep.verdicts = apdVerdicts(rep);
  return rep;
}

/* ---------- 自動診断コメント（要点を1行ずつ） ---------- */
function apdVerdicts(rep){
  var v = [];
  if (!rep || !rep.races){ return ['📚 まだ結果が確定したレースがありません。過去データを取り込むと診断できます。']; }
  var mk = rep.market;
  if (rep.races < APD_MIN_N){
    v.push('⚠ サンプルが ' + rep.races + ' レースしかなく、' + APD_MIN_N + ' レース未満です。' +
      'この段階の回収率・的中率のブレは ±' + Math.round(1.96 * Math.sqrt(0.25 / rep.races) * 100) +
      ' ポイント程度出るので、数字は「傾向」程度に見てください（あと ' + (APD_MIN_N - rep.races) + ' レース）。');
  }
  if (mk.favBuy && mk.randBuy){
    v.push('📏 基準線: 1番人気を毎レース単勝100円 = <b>' + apdPct(mk.favBuy.roi, 1) + '</b>（' + mk.favBuy.n + 'レース）／' +
      '全頭均等買い（ランダム） = <b>' + apdPct(mk.randBuy.roi, 1) + '</b>（' + mk.randBuy.n + 'レース）。' +
      '<b>この2本を超えられないモデルには市場に対する優位性がありません。</b>');
  }
  APD_MODELS.forEach(function(mm){
    var s = null;
    rep.models.forEach(function(x){ if (x.id === mm.id) s = x; });
    if (!s || !s.races) return;
    var tags = [];
    if (s.favRate != null){
      tags.push('◎が1番人気だった率 <b>' + apdPct(s.favRate, 0) + '</b>（' + s.favN + '/' + s.races + '）');
      if (s.favRate >= 0.75 && mm.id !== 'roi') tags.push('<span style="color:var(--warn-ink)">← ほぼ人気順</span>');
    }
    var hf = s.honmei.all.f;
    if (hf) tags.push('◎の勝率 ' + apdPct(hf.winRate, 1) + '（市場期待 ' + apdPct(hf.expRate, 1) +
      ' → リフト ' + (hf.lift >= 0 ? '+' : '') + (hf.lift * 100).toFixed(1) + 'pt）');
    if (s.marks5.roi5 != null) tags.push('印5頭の回収率 ' + apdPct(s.marks5.roi5, 1));
    var up = s.lift.up.f, dn = s.lift.down.f;
    if (up && up.n >= APD_LIFT_MIN && dn && dn.n >= APD_LIFT_MIN){
      var ok = up.lift > 0 && up.lift > dn.lift;
      tags.push('<b>人気より上げた馬</b> ' + up.n + '頭 実勝率 ' + apdPct(up.winRate, 1) + '（期待 ' + apdPct(up.expRate, 1) +
        '／リフト ' + (up.lift >= 0 ? '+' : '') + (up.lift * 100).toFixed(1) + 'pt）' +
        (ok ? ' <span style="color:var(--ok-ink)">✅ 独自情報が効いている</span>'
            : ' <span style="color:var(--warn-ink)">⚠ 上げた馬が期待以上に走っていない＝独自情報が効いていない</span>'));
    } else if ((up && up.n) || (dn && dn.n)){
      tags.push('<span class="muted">人気より上げ下げした馬がまだ ' + ((up ? up.n : 0) + (dn ? dn.n : 0)) +
        ' 頭しかなく、リフトの判定は ' + APD_LIFT_MIN + ' 頭以上になってから行います</span>');
    }
    v.push(mm.label + '（' + s.races + 'レース）: ' + tags.join(' ／ '));
  });
  return v;
}

/* ---------- 表の部品 ---------- */
function apdTbl(title, head, rows, note){
  if (!rows || !rows.length) return '<div class="small muted" style="margin:6px 0">' + esc(title) + ': データなし</div>';
  var h = ['<div style="margin:10px 0 4px;font-weight:700">' + title + '</div>',
    '<div style="overflow:auto"><table class="tbl" style="font-size:.78rem;min-width:520px"><thead><tr>'];
  head.forEach(function(x){ h.push('<th>' + x + '</th>'); });
  h.push('</tr></thead><tbody>');
  rows.forEach(function(r){
    h.push('<tr>');
    r.forEach(function(c, i){ h.push((i === 0) ? '<th style="text-align:left;white-space:nowrap">' + c + '</th>' : '<td>' + c + '</td>'); });
    h.push('</tr>');
  });
  h.push('</tbody></table></div>');
  if (note) h.push('<div class="small muted" style="margin:2px 0 6px">' + note + '</div>');
  return h.join('');
}
function apdLiftCell(f){
  if (!f) return '—';
  var pt = (f.lift * 100);
  var col = pt > 0.5 ? 'var(--ok-ink)' : (pt < -0.5 ? 'var(--warn-ink)' : 'var(--fg)');
  return '<span style="color:' + col + ';font-weight:700">' + (pt >= 0 ? '+' : '') + pt.toFixed(1) + 'pt</span>' +
    '<span class="muted"> (' + apdPct(f.winRate, 1) + ' / 期待' + apdPct(f.expRate, 1) + ')</span>';
}

/* ---------- HTML ---------- */
function apdHTML(rep){
  if (!rep || !rep.races){
    return '<div class="small muted">📚 まだ結果が確定したレースがありません。' +
      '過去データ（日付指定・年指定の一括取得・結果メモの📥取込）でレースを取り込むと診断できます。</div>';
  }
  var mk = rep.market, h = [];

  // 0) 要点
  h.push('<div class="small" style="border-left:3px solid #c78f1f;padding-left:8px;margin:6px 0;line-height:1.8">');
  rep.verdicts.forEach(function(t){ h.push('<div>' + t + '</div>'); });
  h.push('</div>');

  // 1) モデル × 基準線
  var rows1 = [];
  if (mk.favBuy) rows1.push(['📏 1番人気買い（基準線A）', mk.favBuy.n, '—', '—', '—', '<b>' + apdPct(mk.favBuy.roi, 1) + '</b>', '—']);
  if (mk.randBuy) rows1.push(['📏 全頭均等＝ランダム（基準線B）', mk.randBuy.n, '—', '—', '—', '<b>' + apdPct(mk.randBuy.roi, 1) + '</b>', '—']);
  rep.models.forEach(function(s){
    if (!s.races) return;
    var mm = null; APD_MODELS.forEach(function(x){ if (x.id === s.id) mm = x; });
    rows1.push([
      (mm ? mm.label : s.id), s.races,
      s.favRate == null ? '—' : '<b>' + apdPct(s.favRate, 0) + '</b>',
      s.honmei.all.f ? apdPct(s.honmei.all.f.winRate, 1) : '—',
      s.marks5.f ? apdPct(s.marks5.f.top3Rate, 1) : '—',
      s.marks5.roi5 == null ? '—' : '<b>' + apdPct(s.marks5.roi5, 1) + '</b>',
      s.marks5.planRoi == null ? '—' : apdPct(s.marks5.planRoi, 1)
    ]);
  });
  h.push(apdTbl('① 各モデルと基準線の比較',
    ['モデル', 'レース', '◎が1番人気の率', '◎の勝率', '印5頭の3着内率', '印5頭の回収率<br>(1点100円均等)', '同(1万円を信頼度配分)'],
    rows1,
    '「◎が1番人気の率」が高いほど、そのモデルは人気順と同じことをしています。' +
    '回収率が基準線A・Bを超えていなければ、手間をかけた分の見返りがありません。'));

  // 2) ◎の人気別分布（1〜7番は個別、8番以降はまとめて1列）
  var rows2 = [];
  rep.models.forEach(function(s){
    if (!s.races) return;
    var mm = null; APD_MODELS.forEach(function(x){ if (x.id === s.id) mm = x; });
    var cells = [mm ? mm.label : s.id];
    var rest = 0;
    for (var i = 0; i < 20; i++){
      var c = s.popHist[i] || 0;
      if (i < 7) cells.push(c ? (c + '<span class="muted"> (' + Math.round(c / s.races * 100) + '%)</span>') : '<span class="muted">0</span>');
      else rest += c;
    }
    cells.push(rest ? (rest + '<span class="muted"> (' + Math.round(rest / s.races * 100) + '%)</span>') : '<span class="muted">0</span>');
    rows2.push(cells);
  });
  h.push(apdTbl('② 本命(◎)は何番人気に打たれているか',
    ['モデル', '1番', '2番', '3番', '4番', '5番', '6番', '7番', '8番以降'], rows2,
    '1番人気の列が大きいほど、そのモデルは人気順をなぞっているだけです。' +
    '💰回収率重視は1〜4番人気を本命から外す式なので、1〜4番の列が0になるのが正常です。'));

  // 3) 本命を1番人気に打ったレース vs 打ち替えレース
  var rows3 = [];
  rep.models.forEach(function(s){
    if (!s.races) return;
    var mm = null; APD_MODELS.forEach(function(x){ if (x.id === s.id) mm = x; });
    var f = s.honmei.fav.f, nf = s.honmei.nonfav.f;
    rows3.push([mm ? mm.label : s.id,
      f ? (f.n + 'レース／勝率 ' + apdPct(f.winRate, 1) + '／回収率 ' + apdPct(f.roi, 1)) : '0レース',
      nf ? (nf.n + 'レース／勝率 ' + apdPct(nf.winRate, 1) + '／回収率 ' + apdPct(nf.roi, 1)) : '0レース',
      (f && nf && f.n >= 5 && nf.n >= 5)
        ? ((nf.winRate > f.winRate)
            ? '<span style="color:var(--ok-ink)">打ち替えの方が勝率が高い＝独自判断が効いている</span>'
            : '<span class="muted">打ち替えの勝率は1番人気以下（当然だが、回収率で上回れているかを見る）</span>')
        : '<span class="muted">サンプル不足</span>'
    ]);
  });
  h.push(apdTbl('③ 本命を「1番人気」に打ったレース vs「打ち替えた」レース',
    ['モデル', '◎=1番人気', '◎≠1番人気（打ち替え）', '判定'], rows3,
    '打ち替えレースの回収率が基準線A（1番人気買い）を超えていれば、そのモデルは「人気を裏切る判断」で価値を出しています。'));

  // 4) リフト（AIが人気順より上げた/下げた馬）
  var rows4 = [];
  rep.models.forEach(function(s){
    if (!s.races) return;
    var mm = null; APD_MODELS.forEach(function(x){ if (x.id === s.id) mm = x; });
    rows4.push([mm ? mm.label : s.id, apdLiftCell(s.lift.up.f), apdLiftCell(s.lift.same.f), apdLiftCell(s.lift.down.f),
      s.lift.up.f ? apdPct(s.lift.up.f.roi, 1) : '—']);
  });
  h.push(apdTbl('④ リフト ＝ 実勝率 − 市場期待勝率（印5頭のうち）',
    ['モデル', '⬆ 人気より上げた', '＝ 同じ', '⬇ 人気より下げた', '上げた馬の単勝回収率'], rows4,
    '<b>これが一番大事な表です。</b>「上げた馬」のリフトがプラスなら、モデルは市場が見落としている馬を見つけられています。' +
    '0以下なら、印は人気順をなぞっているだけで独自情報がありません（＝今の構造では o255 のモデル側がほぼ埋もれている状態）。'));

  // 5) 人気別の実績（市場そのものの癖）
  var rows5 = mk.byRank.slice(0, 10).map(function(x){
    return [x.rank + '番人気', x.n, apdPct(x.winRate, 1), apdPct(x.expRate, 1),
      ((x.lift * 100) >= 0 ? '+' : '') + (x.lift * 100).toFixed(1) + 'pt',
      apdPct(x.top3Rate, 1), apdPct(x.roi, 1)];
  });
  h.push(apdTbl('⑤ 人気別の実績（学習DBの全出走馬＝市場の校准）',
    ['人気', '出走', '実勝率', '市場期待勝率', '差', '3着内率', '単勝回収率'], rows5,
    '「実勝率」と「市場期待勝率」がほぼ一致していれば、オッズはよく校准されています。' +
    '特定の人気帯だけ差が大きければ、そこが狙い目（または落とし穴）です。'));

  // 6) 市場期待勝率の帯別（どのオッズ帯に妙味があるか）
  var rows6 = (mk.calRows || []).map(function(x){
    return [x.band, x.n, apdPct(x.winRate, 1), apdPct(x.expRate, 1),
      ((x.lift * 100) >= 0 ? '+' : '') + (x.lift * 100).toFixed(1) + 'pt', apdPct(x.roi, 1)];
  });
  h.push(apdTbl('⑥ 市場期待勝率の帯別（どのオッズ帯が儲かるか／儲からないか）',
    ['期待勝率の帯', '出走', '実勝率', '期待勝率', '差', '単勝回収率'], rows6,
    '💰回収率重視モデルが狙うべき帯がここで分かります。回収率が100%を超える帯があれば、' +
    '「5番人気以下」という人気フィルターではなく<b>その帯を狙う</b>ように式を変える価値があります。'));

  // 7) 今回の出走馬の「レース前の特徴」（第17弾・提案3 でモデルが見るようになった材料）
  try {
    var cf = apdCurFeats();
    if (cf && cf.rows.length){
      h.push(apdTbl('⑦ 今回の出走馬の「レース前の特徴」（学習DBの履歴から・' + esc(cf.d8Label) + ' 以前のみ使用）',
        ['馬', '脚質<br>(過去戦から)', '過去戦', '3着内率', '上り順位', '同距離', '騎手', '休み', '総合能力'],
        cf.rows,
        '★ <b>いかさま防止</b>: ここに出る値は全て「このレースの日付より前の出走」だけから作っています。' +
        'そのレース自身の通過順・上り・着順は一切使っていません（従来は脚質をそのレースの通過順から判定していました）。' +
        '「上り順位」は小さいほど過去戦で上りが速かったことを示します（0%=毎回最速 / 50%=平均）。' +
        '学習DBに過去戦が無い馬は総合能力を出さず、脚質は出馬表の入力値を使います。'));
    }
  } catch(e){}

  // 8) サンプル数
  var need = Math.max(0, APD_MIN_N - rep.races);
  h.push('<div class="small muted" style="margin-top:8px">📊 対象: 結果が確定した <b>' + rep.races + '</b> レース' +
    '（保存レコード ' + rep.records + ' 件）／判定の目安 ' + APD_MIN_N + ' レース' +
    (need > 0 ? ' → <b>あと ' + need + ' レース</b>' : ' → ✅ 判定可能') +
    '　集計時刻: ' + new Date(rep.at).toLocaleString('ja-JP') + '</div>');
  return h.join('');
}

/* 今回の出走馬について、学習DBの履歴から「レース前の特徴」を引いて表にする */
function apdCurFeats(){
  try {
    var hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : [];
    if (!hs || !hs.length) return null;
    var mm = null;
    try { mm = (typeof apMetaCur === 'function') ? apMetaCur() : null; } catch(e){ mm = null; }
    var d8 = (mm && mm.date8) || '';
    if (!/^\d{8}$/.test(String(d8))){
      try { if (!d8 && typeof state !== 'undefined' && state && state.raceDate8) d8 = String(state.raceDate8); } catch(e){}
    }
    if (!/^\d{8}$/.test(String(d8))) return null;
    var distM = 0;
    try {
      var dm = String((mm && (mm.dist || mm.name)) || '').match(/(\d{3,4})/);
      if (dm) distM = parseInt(dm[1], 10);
    } catch(e){}
    var band = (distM && typeof hfBand === 'function') ? hfBand(distM) : '';
    if (typeof hfIndex === 'function') hfIndex(false);
    var map = (typeof hfFeatures === 'function') ? hfFeatures(hs, d8, band) : null;
    if (!map) return null;
    var rows = [], any = false;
    hs.forEach(function(x){
      if (!x || x.no == null) return;
      var f = map[String(x.no)];
      var nm = String(x.no) + ' ' + esc(x.name || '');
      if (!f || !f.has){
        rows.push([nm, esc(x.style || (f && f.style) || '不明'), '<span class="muted">0</span>',
          '<span class="muted">—</span>', '<span class="muted">—</span>', '<span class="muted">—</span>',
          '<span class="muted">—</span>', '<span class="muted">—</span>', '<span class="muted">履歴なし</span>']);
        return;
      }
      any = true;
      var rest = '—';
      if (f.isTeppo) rest = '<b>鉄砲</b>' + (f.restDays != null ? ' (' + f.restDays + '日)' : '');
      else if (f.is2nd) rest = '<b>2走目</b>' + (f.restDays != null ? ' (' + f.restDays + '日)' : '');
      else if (f.restDays != null && f.restDays >= 21) rest = '中' + Math.floor((f.restDays - 1) / 7) + '週';
      else if (f.restDays != null) rest = f.restDays + '日';
      var abl = (typeof hfAbility === 'function') ? hfAbility(f) : null;
      rows.push([
        nm,
        esc(f.style || x.style || '不明'),
        f.prevN + '戦',
        f.top3Rate != null ? apdPct(f.top3Rate, 0) : '—',
        f.l3RankAvg != null ? apdPct(f.l3RankAvg, 0) : '—',
        f.sameDistN ? (f.sameDistN + '戦 ' + apdPct(f.sameDistTop3Rate, 0)) : '—',
        f.jockeyN ? (f.jockeyN + '戦 ' + apdPct(f.jockeyWinRate, 1)) : '—',
        rest,
        abl != null ? '<b>' + abl.toFixed(3) + '</b>' : '<span class="muted">—</span>'
      ]);
    });
    if (!any) return null;
    return { rows: rows, d8Label: String(d8).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') };
  } catch(e){ return null; }
}

/* ---------- 描画 ---------- */
var apdCache = null;
function apdPaint(){
  var box = null;
  try { box = document.getElementById('apdBox'); } catch(e){}
  if (!box) return;
  try { apdCache = apdReport({}); } catch(e){ apdCache = null; }
  box.innerHTML = apdCache ? apdHTML(apdCache) : '<div class="small muted">診断の集計に失敗しました。</div>';
  // ⑧ ファクター別の学習（提案4）
  try {
    var fb = document.getElementById('flBox');
    if (fb && typeof flPaint === 'function') flPaint();
  } catch(e){}
  try {
    var b = document.getElementById('apdRun');
    if (b) b.addEventListener('click', function(){ apdPaint(); });
  } catch(e){}
}
function apdInit(){
  try {
    var d = document.getElementById('apdCard');
    if (d) d.addEventListener('toggle', function(){ if (d.open) apdPaint(); });
    var b = document.getElementById('apdRun');
    if (b) b.addEventListener('click', function(){ apdPaint(); });
  } catch(e){}
}
