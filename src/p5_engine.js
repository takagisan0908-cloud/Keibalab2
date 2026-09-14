/* =========================================================
   展開予想 + AI印エンジン（ブラウザ内統計モデル）
   ========================================================= */
function normText(s){ return String(s==null?'':s).replace(/[\s　]/g,''); }
function styleClass(st){
  var s = normText(st);
  if (!s) return '';
  if (/逃/.test(s)) return 'E';
  if (/先|好位|自在|前/.test(s)) return 'S';
  if (/追/.test(s)) return 'C';   // 追込
  if (/差/.test(s)) return 'K';   // 差し
  return '';
}
function styleLabel(st){
  var c = styleClass(st);
  return {E:'逃げ',S:'先行',K:'差し',C:'追込'} [c] || '−';
}
function isFrontStyle(st){ var c = styleClass(st); return c==='E' || c==='S'; }

/* ---------- 展開(ペース)診断 ----------
   override を渡すとペース診断を「手動想定」に上書きできる
   （例: スロー想定 0.2 / ハイ想定 0.75 など） */
function paceAnalysis(horses, raceMeta, override){
  var hs = horses.filter(function(h){ return h.no && (h.name || h.odds); });
  var n = hs.length;
  var cnt = {E:0, S:0, K:0, C:0};
  hs.forEach(function(h){ var c = styleClass(h.style); if (c) cnt[c]++; });
  var nF = cnt.E + cnt.S;   // 前に行きたい馬
  var nB = cnt.K + cnt.C;   // 後方待機
  var frontOddsPow = 0, frontCount = 0;
  hs.forEach(function(h){
    if (isFrontStyle(h.style)){
      var o = num(h.odds);
      if (o && o > 1){ frontOddsPow += Math.sqrt(1/o); frontCount++; }
    }
  });
  var S = frontCount ? frontOddsPow / frontCount : 0.4;   // 前に行く馬の実力(0..1)
  // ペース基準点の再較正: 頭数効果は逓減させ、行き脚のある前馬の実力で調整
  // （従来は「逃げ先行2頭超で0.16/頭」加算だったため、脚質を入力するとほぼ確実に
  //   ハイペース寄りになっていた。実戦分布に近づけ、加算を穏やかに・上限付きにした）
  var s0 = 0.50;
  var excessFront = nF - 2;                       // 逃げ・先行が2頭を超えるぶん
  if (excessFront > 0) s0 += Math.min(excessFront, 6) * 0.045;   // 頭数効果は頭打ち
  else s0 += Math.max(excessFront, -2) * 0.06;    // 前が少ないとややスロー寄り
  s0 += clamp((S - 0.5) * 0.22, -0.08, 0.12);     // 人気上位の強い逃げ先行がいるとややペースアップ
  var baba = raceMeta.baba || '';
  if (/soft|yield/.test(baba)) s0 -= 0.02; else if (/good/.test(baba)) s0 += 0.02;
  var dist = parseFloat(raceMeta.dist);
  if (dist) s0 += (dist > 2600 ? -0.10 : dist < 1400 ? +0.12 : 0); // 長丁場はゆっくり
  var manual = (override != null && isFinite(override));
  var adjNote = [];
  if (!manual){
    // ① その日の同開催の「先行利き」実測(トラックバイアス) → 前残り日は速くなりすぎず、差し有利日は速め
    try {
      if (typeof biasVerdict === 'function'){
        var bv = biasVerdict();
        if (bv && bv.frontScore != null && bv.known >= 3){
          var adjToday = (0.5 - bv.frontScore) * 0.12;
          if (adjToday < -0.03){ s0 += adjToday; adjNote.push('今日は前残り傾向(' + bv.posLabel + ')のためペースを少し抑えめに補正'); }
          else if (adjToday > 0.03){ s0 += adjToday; adjNote.push('今日は差し・追込に分がある傾向(' + bv.posLabel + ')のためペースを少し速めに補正'); }
        }
      }
    } catch(e){}
    // ② このレースの過去の傾向(展開学習hist) → 差し・追込が馬券に絡みやすいレースは速めに
    try {
      if (state && state.learn && state.learn.hist && state.learn.hist.counts && state.learn.hist.n >= 3){
        var cc = state.learn.hist.counts;
        var nf = (cc['逃げ'] || 0) + (cc['先行'] || 0), nb = (cc['差し'] || 0) + (cc['追込'] || 0), tt = nf + nb;
        if (tt >= 3 && nb > nf){
          var adj2 = Math.min(0.08, ((nb - nf) / tt) * 0.14);
          s0 += adj2;
          adjNote.push('このレースは過去、差し・追込が結果に絡みがち(' + (state.learn.hist.label || '') + ')のためペースを速めに補正');
        } else if (tt >= 3 && nf >= nb * 1.5){
          var adj3 = -Math.min(0.06, ((nf - nb) / tt) * 0.10);
          s0 += adj3;
          adjNote.push('このレースは過去、前が残りがちな決着のためペースを抑えめに補正');
        }
      }
    } catch(e){}
    s0 = clamp(s0, 0.04, 0.96);
  }
  if (manual) s0 = clamp(+override, 0.04, 0.96);
  s0 = clamp(s0, 0.04, 0.96);
  var label, sub;
  if (s0 < 0.36){ label='スロー'; sub='淡々と流れ、前残りの可能性大。差し・追込は展開利が薄い。'; }
  else if (s0 < 0.46){ label='ややスロー'; sub='平均をやや下回るペース。好位〜先行が有利に運べる。'; }
  else if (s0 < 0.56){ label='平均'; sub='平均的な流れ。脚質問わず力関係が表れやすい。'; }
  else if (s0 < 0.66){ label='ややハイ'; sub='中間点からやや速い。中団以降の差し・追込に分が出るかも。'; }
  else if (s0 < 0.78){ label='ハイ'; sub='ハイペース想定。前が潰れ、直線で差し・追込の台頭が考えられる。'; }
  else { label='超ハイ'; sub='超ハイペース。逃げ・先行は厳しく、追込馬の一発に注意。'; }

  var names = {};
  ['E','S','K','C'].forEach(function(k){ names[k] = hs.filter(function(h){ return styleClass(h.style)===k; }).map(function(h){ return h.no; }); });
  function jl(list){ return list.length ? list.join('・') : 'なし'; }
  var favs = hs.slice().sort(function(a,b){ return (num(a.odds)||999)-(num(b.odds)||999); }).slice(0,3);
  var favNote = '1〜3番人気: ' + favs.map(function(h){ return h.no + (h.name?'('+h.name+')':'') + (styleClass(h.style)?'['+styleLabel(h.style)+']':''); }).join(' / ');
  var scenario =
    '逃げ馬: <b>' + jl(names.E) + '</b>（' + cnt.E + '頭） ・ 先行: <b>' + jl(names.S) + '</b>（' + cnt.S + '頭）' +
    ' ／ 差し: ' + jl(names.K) + '（' + cnt.K + '頭） ・ 追込: ' + jl(names.C) + '（' + cnt.C + '頭）';

  var story;
  var E = names.E.slice(0,2), S = names.S.slice(0,3);
  if (cnt.E) story = 'スタート直後は <b>' + E.join('・') + '</b> がハナを主張。';
  else if (cnt.S) story = '押し出し気味に <b>' + S.join('・') + '</b> あたりが先団を作る展開へ。';
  else story = 'どの馬も脚を溜めたい構成で、隊列はゆったり作られるか。';
  var mid;
  if (s0 > 0.66) mid = '中間点からペースが上がり、前がバテ始める可能性。';
  else if (s0 > 0.5) mid = '中盤は標準的な流れ、勝負どころで隊列が動きそう。';
  else mid = '終始ゆったり。直線勝負になり、前の馬が粘り込むイメージ。';
  if (cnt.K + cnt.C) story += '差し・追込は <b>' + jl(names.K.concat(names.C)) + '</b> あたりが後方待機。';
  story += mid + ' <b>' + label + '</b>なら' + (s0 < 0.5 ? '先行・好位勢の粘り込みに注意。' : '後方からの差し込みも射程圏内。');
  return {
    score: s0, label: label, sub: sub, scenario: scenario, story: story, fav: favNote,
    nE: cnt.E, nS: cnt.S, nK: cnt.K, nC: cnt.C, nF: nF, nB: nB, frontStrength: S,
    baba: baba, dist: dist || null, manual: !!manual, adjust: adjNote
  };
}

/* ---------- 馬ごとの素点 ---------- */
function horseRaw(h){
  var raw = { odds:null, yobi:null, time:null };
  var o = num(h.odds);
  if (o && o >= 1) raw.odds = 1/o;
  var ev = evaluateLapStr(h.yobi);
  if (ev.per != null) raw.yobi = ev.per;           // 1Fあたり秒 小さいほど速い
  var ts = evaluateTimeStr(h.time);
  if (ts != null) raw.time = ts;
  // netkeiba自動入力の前走タイムは「実際に走った距離」(同距離±200m)が判明している
  var pd = /^\d{3,4}$/.test(String(h.prevD || '')) ? parseInt(h.prevD, 10) : null;
  return { ev:ev, raw:raw, timeSec: ts, prevD: pd };
}

function normCol(arr, reverse, fallback){
  // arr: 数値 or null。null は fallback 固定
  var vals = arr.filter(function(v){ return v != null; });
  if (!vals.length) return arr.map(function(){ return 0.5; });
  var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  var span = (mx - mn) || 1;
  return arr.map(function(v){
    if (v == null) return fallback;
    var t = reverse ? (mx - v) / span : (v - mn) / span;  // reverse: 小さいほど高評価
    return 0.3 + t * 0.7;
  });
}

/* ---------- 印決定 ---------- */
var MARKS = [{s:'◎',cls:'mk-1'},{s:'○',cls:'mk-2'},{s:'▲',cls:'mk-3'},{s:'☆',cls:'mk-4'},{s:'△',cls:'mk-5'}];
function markForRank(r){ if (r <= 0 || r > 5) return {s:'',cls:''}; return MARKS[r-1]; }

function analyzeRace(){
  var hs = state.horses.filter(function(h){ return h.no && (h.name || h.odds); });
  var res = { ok:false, msg:'', rows: [], pace:null };
  if (!hs.length){ res.msg = '馬番の入った馬がいません'; return res; }
  var raceMeta = readRaceMeta();
  // ペース想定(手動シナリオ)があるときは上書き
  var pmode = null;
  try {
    var _po = (typeof state !== 'undefined') ? state.paceOverride : null;
    if (_po != null && isFinite(_po)) pmode = +_po;
  } catch(e){}
  var pace = paceAnalysis(hs, raceMeta, pmode);
  res.pace = pace;

  // --- 評価列 ---
  var infos = hs.map(horseRaw);
  var colO = normCol(infos.map(function(i){ return i.raw.odds; }), false, 0.25);
  var colY = normCol(infos.map(function(i){ return i.raw.yobi; }), true, 0.25);   // 秒小さい=速い
  var colT, timeUsable = false;
  // 🏔 馬柱戦績があれば「今回と同じコース種別(洋芝/野芝)・同じ距離±200m」の最速持ちタイムで比較する。
  //    他場(野芝)の時計と単純比較すると洋芝開催で洋芝巧者を過小評価するため、コース種別を揃える。
  var yoInfo = null;
  try { if (typeof yoComputeFor === 'function') yoInfo = yoComputeFor(hs); } catch(e){ yoInfo = null; }
  var yoUsable = !!(yoInfo && yoInfo.usable);
  if (raceMeta.dist){
    var spds = infos.map(function(i, ix){
      // 速度比較は「実際に走った距離」(馬柱の最速持ちタイム距離、無ければ同距離±200mの前走距離、無ければ今回距離)
      var yoIt = (yoUsable && yoInfo.items && yoInfo.items[ix]) ? yoInfo.items[ix] : null;
      if (yoIt && yoIt.sec != null && yoIt.dist){
        return yoIt.dist / yoIt.sec;
      }
      var d = (i.prevD && i.prevD >= 800) ? i.prevD : raceMeta.dist;
      return i.timeSec != null ? d / i.timeSec : null;
    });
    var has = spds.some(function(v){ return v!=null; });
    timeUsable = has;
    colT = normCol(spds, false, 0.25);
  } else {
    colT = infos.map(function(){ return 0.5; });
  }
  // 脚質評価の補正＝本日のバイアス(自動 or 手動) × 展開学習(このレースの過去結果) × 出遅れ率
  /* ★2026-09-13 第25弾①: このブロックを tenkaiRaw より【前】に移動しました。
     ペース想定を実測バイアスで上書きするのに biasM.v.frontScore が必要になったためです
     （従来は tenkaiRaw → biasM の順で、 pace.score だけが脚質評価を決めていました）。 */
  var biasManual = '';
  try { biasManual = String((state && state.biasOverride) || ''); } catch(e){}
  var biasM = null, biasV = null;
  if (biasManual && biasManual !== 'off'){
    var prM = (typeof biasManualPreset === 'function') ? biasManualPreset(biasManual) : null;
    if (prM){
      biasV = prM;
      biasM = { mul: (typeof biasMulFromFront === 'function') ? biasMulFromFront(prM.frontScore) : null, v: prM };
    }
  } else if (!biasManual){
    biasM = biasStyleMul();
    biasV = biasM ? biasM.v : null;
  }

  /* 展開適性
     ★2026-09-13 第25弾①: 「ハイペースになればなるほど差し・追込が来る」を
        **実測のトラックバイアスで上書き**します（ご指定: 実測最優先方式）。
     --- 問題 ---
       従来は pace.score(s) だけで脚質評価を決めていました:
         s=1(ハイペース) → 逃げ0.30 / 先行0.34 / 差し0.82 / 追込0.74
       ところが実際の馬場が「前残り」だと、ハイペースでも差し・追込は全く届きません。
       biasMulFromFront() の倍率は最大±28%しかなく、0.82 まで上がった差しを
       後から掛け算で引き戻すことはできませんでした（0.82×0.72=0.59 でもなお最強）。
     --- 修正 ---
       実測の前残り寄与度 frontScore(0.5=フラット / 1.0=完全前残り / 0.06=差し決着)から
       「実際に効いているペース」 sBias = 1 - frontScore を逆算し、
       サンプル数に応じた信頼度 w でペース想定 s とブレンドした sEff を使います。
         w = known / (known + TENKAI_BIAS_K)      … known = 当日＋前日の3着内サンプル数
       実測が増えるほど w→1 になり、**ペース想定より実測馬場が主役**になります。
       実測が無い(w=0)ときは従来どおり pace.score 100%なので、既存挙動は壊しません。 */
  var sEff = pace.score, sBias = null, biasW = 0;
  try {
    var fv = (biasM && biasM.v) ? biasM.v : null;
    if (fv && fv.frontScore != null && isFinite(fv.frontScore)){
      sBias = Math.max(0, Math.min(1, 1 - fv.frontScore));
      var kn = fv.known || 0;
      biasW = kn / (kn + TENKAI_BIAS_K);
      sEff = pace.score * (1 - biasW) + sBias * biasW;
    }
  } catch(e){}
  var tenkaiRaw = hs.map(function(h){
    var c = styleClass(h.style);
    var s = sEff;
    var v = 0.45;
    if (c==='E')      v = 0.30 + (1 - s) * 0.66; // 逃げはスロー展開で有利
    else if (c==='S') v = 0.34 + (1 - s) * 0.50;
    else if (c==='K') v = 0.20 + s * 0.62;
    else if (c==='C') v = 0.12 + s * 0.62;
    return v;
  });
  var histM = null, learnN = 0, slowN = 0;
  try {
    if (state.learn && state.learn.useHist !== false && state.learn.hist && state.learn.hist.mul){
      // 別レースで学習した内容は反映しない（race_idが一致するときだけ）
      var curRid = String(state.raceId || '');
      var histRid = String(state.learn.hist.rid || '');
      if (curRid && histRid && curRid === histRid){
        histM = state.learn.hist.mul; learnN = state.learn.hist.n || 0;
      }
    }
  } catch(e){}
  var styleM = { E:1, S:1, K:1, C:1 };
  // 手動指定バイアスは常時、自動バイアスは「🎓 展開学習: 反映する」ONのときだけ脚質評価へ適用
  var learnOn = !(state.learn && state.learn.useHist === false);
  // ★2026-09-12 第16弾: 学習DB(コーナー通過順・ペース・200mラップ・払戻)から集計した
  // 「展開適性」を1頭ずつ掛ける。①その馬が今回のペース予想で過去どう走ったか
  // ②この競馬場×距離帯で4角の位置(先行/差し)が有利か ③ペース×脚質の3着内率
  // 集計がまだ無い・サンプルが薄い馬は 1.0（何もしない）になる。
  var pfMuls = null;
  try {
    if (learnOn && typeof pfHorseMuls === 'function') pfMuls = pfHorseMuls(hs, state, pace);
  } catch(e){}
  var applyBias = (biasManual === 'off') ? false : (biasManual ? true : learnOn);
  if (applyBias && biasM && biasM.mul){
    ['E','S','K','C'].forEach(function(k){ styleM[k] *= biasM.mul[k] || 1; });
  }
  if (histM){
    ['E','S','K','C'].forEach(function(k){ if (histM[k] != null) styleM[k] *= histM[k]; });
  }
  tenkaiRaw = tenkaiRaw.map(function(v, i){
    var h = hs[i];
    var c = styleClass(h.style);
    var m = c ? (styleM[c] || 1) : 1;
    var out = v * m;
    if (pfMuls && pfMuls[i] != null) out *= pfMuls[i];   // 展開学習(第16弾)の倍率
    // 出遅れ率は「脚質によらず共通の勝率ペナルティ」。先行型だけ過大に効かせると
    // 実データ(差し・追込にも出遅れはある)とずれるため、率を線形ではなく逓減させて掛ける
    // ※ 出遅れ率は 0〜100% の範囲で扱う（#2026-09-12 第15弾・slowPctOfで0〜100に丸める）
    var slow = slowPctOf(h.slow) / 100;
    if (slow > 0.02){
      var mul2 = Math.max(0.55, 1 - Math.pow(slow * 100 - 2, 0.75) / 60);
      out *= mul2;
      if (slow >= 0.10) slowN++;
    }
    return out;
  });
  var colK = normCol(tenkaiRaw, false, 0.5);

  // あなたの印(入力表の印列)を軽い参考情報として使用
  var markV = hs.map(function(h){
    var m = normText(h.mark);
    if (m.indexOf('◎') >= 0) return 1.0;
    if (m.indexOf('○') >= 0 || m.indexOf('〇') >= 0) return 0.75;
    if (m.indexOf('▲') >= 0) return 0.5;
    if (m.indexOf('☆') >= 0) return 0.55;
    if (m.indexOf('△') >= 0) return 0.4;
    return 0.5;
  });
  var colM = normCol(markV, false, 0.5);

  var w = state.weights;
  /* ★2026-09-12 第17弾・提案4: ファクター別の自己学習。
     「そのファクターを高く評価した馬が、市場の期待以上に走ったか（リフト）」を
     事前予想のスナップショット(rec.pre)から集計し、効いていないファクターの重みを自動で下げる。
     state.weights 自体は書き換えず、この中の計算だけに入れるコピーを作る。
     ※ odds は市場とのブレンド率(blend)にも使うのでここではスケールしない（利用者のスライダーに任せる）。 */
  try {
    var fsc = (typeof apFactorScale === 'function' && !(state.learn && state.learn.useFactor === false))
      ? apFactorScale() : null;
    /* ★2026-09-13 第21弾⑤: コピーは【常に】作る。state.weights を直接いじらないためと、
       「🧠 あなたの印」を AI 計算から外す（mark=0）ためです。 */
    var wc = {};
    for (var wk in state.weights){ if (Object.prototype.hasOwnProperty.call(state.weights, wk)) wc[wk] = state.weights[wk]; }
    wc.mark = 0;   // あなたの印は重み設定の項目から削除（印の入力欄は残る。AI印には一切使いません）
    if (fsc){
      Object.keys(fsc).forEach(function(k){ if (wc[k] != null && k !== 'odds') wc[k] = Math.max(0, wc[k] * fsc[k]); });
    }
    w = wc;
  } catch(e){}
  // 🔁 自己学習による展開(脚質)加点の割引（p30 apActive。データが溜まり、
  //    「AIが人気より上げた馬」が伸び悩むと自動で反映）
  var apL = null;
  try { if (typeof apActive === 'function') apL = apActive(); } catch(e){ apL = null; }
  /* 🔁自己学習の展開割引率（第21弾⑤の自動補正を掛けたあとも同じ率を掛け直せるようにしておく） */
  var apPen = (apL && apL.apply) ? Math.max(0, 1 - apL.penalty) : 1;
  var wK = Math.max(0, w.tenkai * apPen);
  var bfA = null;
  try {
    if (typeof bfActiveVector === 'function'){ bfA = bfActiveVector(hs); if (bfA && bfA.length !== hs.length) bfA = null; }
  } catch(e){ bfA = null; }
  // 🏟 バ場好走率(同開催場×同馬場)ファクター: p43(馬柱戦績)から取得
  var babaInfo = null, colB = null;
  if ((w.baba||0) > 0 && typeof bbComputeFor === 'function'){
    try { babaInfo = bbComputeFor(hs); } catch(e){ babaInfo = null; }
    if (babaInfo && babaInfo.usable){
      colB = normCol(babaInfo.items.map(function(v){ return v.rate; }), false, 0.5);
    }
  }
  var babaOn = !!colB;
  // 🏔 洋芝・コース適性(同コース種別の最速持ちタイム＋最速上がり3F)。
  //    洋芝開催(札幌・函館の芝)では特に重要。馬柱データが要るため、無ければ自動OFF。
  var colY2 = null;
  if ((w.yoso||0) > 0 && yoUsable){
    colY2 = normCol(yoInfo.items.map(function(v){ return v.rate; }), false, 0.5);
  }
  var yosoOn = !!colY2;
  /* ★2026-09-13 第24弾①: 🎯 枠順ファクター（重賞のみ）
     ⑥重賞データ分析の samples（対象重賞の過去10年ぶん・1〜3着が照合済み）の歴代結果から
     「有利な枠順」を判定した結果を使い、各馬の枠番を 0〜1（0.5=中立）のスコアにします。
     重賞以外／⑥の分析データが無い／対象レースが食い違う 場合は wakuStatForRace() が null を返すので
     自動的に OFF になり、重み waku は sumW にも入りません（他の材料のバランスを崩しません）。 */
  var wakuSt = null, colW = null;
  if ((w.waku||0) > 0 && typeof wakuStatForRace === 'function'){
    try { wakuSt = wakuStatForRace(); } catch(e){ wakuSt = null; }
    if (wakuSt){
      var cw = hs.map(function(h){
        try { return (typeof wakuScoreOf === 'function') ? wakuScoreOf(h && h.frame, wakuSt) : null; } catch(e){ return null; }
      });
      var anyW = false;
      for (var wi = 0; wi < cw.length; wi++){ if (cw[wi] != null){ anyW = true; break; } }
      if (anyW) colW = cw;
    }
  }
  var wakuOn = !!colW;
  /* 📚 学習DB履歴の総合能力ファクター（★2026-09-12 第17弾・提案3の残件＝①のAI印にも入れた）
     過去戦の3着内率・上り3Fの相対順位・同距離帯の実績・騎手の勝率を p52_histfeat.js が
     「そのレースの日付より前の出走だけ」から作る（いかさま防止）。
     学習DBに過去戦が無い馬は null → 0.5 の中立。1頭も引けなければファクター自体をOFF。 */
  var ablInfo = null, colA = null;
  if ((w.abl||0) > 0 && typeof hfCurFeatures === 'function'){
    try { ablInfo = hfCurFeatures(hs); } catch(e){ ablInfo = null; }
    if (ablInfo && ablInfo.any){
      colA = normCol(hs.map(function(h){
        var f = ablInfo.map ? ablInfo.map[String(h.no)] : null;
        return (f && typeof hfAbility === 'function') ? hfAbility(f) : null;
      }), false, 0.5);
    }
  }
  var ablOn = !!colA;
  /* =========================================================
     ★2026-09-13 第21弾⑤: レースごとの重み自動補正（オーバーレイ方式）
     ---------------------------------------------------------
     スライダーの値（state.weights）は【書き換えず】、このレースで各材料がどれだけ揃っているか
     ＋当日のトラックバイアスの充実度を見て ×0.30〜×1.60 を掛けます。
     材料が半分しか無い馬列で満点の重みを掛けると、データの無い馬が中立(0.5)に寄って
     データの有る馬だけ損をするゆがみが出るため、揃い具合に応じて重みを落とします。
     各列（colB/colY2/colA・infos）を作った直後なので、馬柱や学習DBを読み直す二度手間はありません。 */
  try {
    if (typeof wtEffective === 'function' && typeof wtCovBuild === 'function'){
      var wtc = wtCovBuild({
        n: hs.length,
        yobi:   infos.map(function(i){ return (i.raw && i.raw.yobi != null) ? 1 : 0; }),
        time:   infos.map(function(i){ return (i.timeSec != null && i.prevD >= 800) ? 1 : (i.timeSec != null ? 0.6 : 0); }),
        tenkai: hs.map(function(h){ return (typeof styleClass === 'function' && styleClass(h.style)) ? 1 : 0; }),
        baba:   hs.map(function(h, i){
          var it = (babaInfo && babaInfo.items) ? babaInfo.items[i] : null;
          return (it && it.n) ? 1 : ((colB && colB[i] != null) ? 0.5 : 0);
        }),
        yoso:   hs.map(function(h, i){
          var it = (yoInfo && yoInfo.items) ? yoInfo.items[i] : null;
          return (it && (it.sec != null || it.l3 != null)) ? 1 : 0;
        }),
        abl:    hs.map(function(h, i){
          var f = (ablInfo && ablInfo.map) ? ablInfo.map[String(h.no)] : null;
          return f ? 1 : ((colA && colA[i] != null) ? 0.4 : 0);
        })
      });
      var wte = wtEffective(w, wtc);
      if (wte && wte.w){ w = wte.w; res.wtAuto = wte.wt || null; }
    }
  } catch(e){}
  wK = Math.max(0, (w.tenkai || 0) * apPen);   // 補正後の tenkai 重みに掛け直す
  var sumW = (w.odds + w.yobi + w.time + wK + (w.mark||0) + (babaOn ? (w.baba||0) : 0) + (yosoOn ? (w.yoso||0) : 0) + (ablOn ? (w.abl||0) : 0) + (wakuOn ? (w.waku||0) : 0)) || 1;
  var _num = (typeof num === 'function') ? num : function(s){ var x = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return isNaN(x) ? null : x; };
  var U = hs.map(function(h, i){
    var score = w.odds*colO[i] + w.yobi*colY[i] + w.time*colT[i] + wK*colK[i] + (w.mark||0)*colM[i];
    if (babaOn) score += (w.baba||0) * colB[i];
    if (yosoOn) score += (w.yoso||0) * colY2[i];
    if (ablOn) score += (w.abl||0) * colA[i];   // 📚 学習DB履歴の総合能力
    // 🎯 枠順（重賞のみ）。判定できない枠の馬は中立(0.5)にして不利にも有利にもしない
    if (wakuOn) score += (w.waku||0) * (colW[i] != null ? colW[i] : 0.5);
    var u = score / sumW;
    if (bfA && bfA[i] > 0) u += 0.05;   // 🧬 血統ファクター(⑥でON)の僅かな加点（オカルト反映）
    // 出遅れ率も「評価点」に直接効かせる(脚質経由だけでなく総合評価自体を逓減)
    var slw = slowPctOf(h.slow) / 100;
    if (slw > 0.02) u *= Math.max(0.6, 1 - Math.pow(slw * 100 - 2, 0.8) / 55);
    return u;
  });
  // ソフトマックス(総合評価U)と市場確率(1/オッズ)のブレンド。
  // 単純なソフトマックスだけだと調教1項目などで人気と大きく乖離した印になり、
  // 「過去検証は高いのに当日印が外れる」原因になる。オッズ列の重みに応じて
  // 市場(実際の支持)へ引き寄せ、評価の上振れ馬だけを上に出す。
  var tau = 0.30;
  var ex = U.map(function(u){ return Math.exp(u/tau); });
  var se = ex.reduce(function(a,b){ return a+b; },0);
  var pModel = ex.map(function(e){ return se ? e/se : 1/hs.length; });
  var pMkt = hs.map(function(h){ var o = num(h.odds); return (o && o > 1) ? (1/o) : null; });
  var pMktSum = 0, pMktN = 0;
  pMkt.forEach(function(v){ if (v != null){ pMktSum += v; pMktN++; } });
  // 市場(実オッズ)は最も信頼できる単一指標なので基本は市場を軸にする。
  // 「オッズ列の重み」が小さい(＝他の材料を重視したい)ほどモデル評価を効かせる:
  //   odds重み0 → モデル最大50% / 既定(7)以上 → モデル25%・市場75% に落ち着く
  var blend = (w && w.odds != null) ? clamp(0.50 - (w.odds || 0) * 0.035, 0.25, 0.6) : 0.35;
  var prob = hs.map(function(h, i){
    var pm = pModel[i];
    if (pMkt[i] != null && pMktSum > 0){
      var pn = pMkt[i] / pMktSum;            // 市場確率の正規化(オッズ未入力馬は除いた母数)
      // モデルが市場より明確に上位評価する馬(人気薄の実力馬)だけはモデルをやや強めに効かせる
      var b2 = pm > pn * 1.7 ? Math.min(blend + 0.12, 0.55) : blend;
      return (1 - b2) * pn + b2 * pm;
    }
    return pm;
  });
  var psum2 = 0; prob.forEach(function(v){ psum2 += v; });
  if (psum2 > 0) prob = prob.map(function(v){ return v / psum2; });

  var order = hs.map(function(h,i){ return i; }).sort(function(a,b){ return prob[b]-prob[a]; });

  // オッズ比較(妙味)
  function mine(h, p){ var o = num(h.odds); return (o && o>1) ? o * p : null; }

  var rows = order.map(function(idx, rank){
    var h = hs[idx];
    var p = prob[idx];
    var mk = markForRank(rank+1);
    var mineR = mine(h,p);
    return {
      idx: idx, h: h, rank: rank+1, prob: p,
      mark: mk.s, markCls: mk.cls,
      fO: colO[idx], fY: colY[idx], fT: colT[idx], fK: colK[idx], fB: colB ? colB[idx] : null,
      fA: colA ? colA[idx] : null, ablHit: (ablInfo && ablInfo.map) ? (ablInfo.map[String(h.no)] || null) : null,
      babaHit: (babaInfo && babaInfo.items) ? babaInfo.items[idx] : null,
      fY2: colY2 ? colY2[idx] : null,
      fW: colW ? colW[idx] : null,
      wakuHit: (wakuSt && typeof wakuInfoOf === 'function') ? wakuInfoOf(h.frame, wakuSt) : null,
      yosoHit: (yoInfo && yoInfo.items) ? yoInfo.items[idx] : null,
      U: U[idx],
      ev: infos[idx].ev, timeSec: infos[idx].timeSec,
      mine: mineR, mineFlag: (mineR!=null && mineR > 1.15)
    };
  });

  // 分かりやすいコメント
  rows.forEach(function(r, pos){
    var t = [];
    var h = r.h;
    var o = num(h.odds);
    if (r.rank === 1) t.push('本命候補');
    else if (r.rank === 2) t.push('対抗');
    else if (r.rank >= 3) t.push('穴目は単勝も視野');
    if (o != null && o <= 3) t.push('オッズ上も人気');
    if (o != null && o >= 25) t.push('人気薄・波乱候補');
    if (r.ev && r.ev.per != null && r.fY > 0.8) t.push('調教タイム良好');
    if (r.timeSec != null && r.fT > 0.8) t.push('持ちタイム上位');
    if (r.yosoHit && r.yosoHit.sec != null && r.fY2 != null && r.fY2 > 0.8){
      t.push((yoInfo && yoInfo.ctx && yoInfo.ctx.isYoso ? '洋芝適性上位' : 'コース適性上位') +
        (r.yosoHit.tier <= 2 ? '（同コース種別 ' + yoFmt(r.yosoHit.sec) + '）' : ''));
    }
    var slowP = slowPctOf(h.slow);
    if (slowP >= 10) t.push('出遅れ率' + slowP + '%');
    var sc = styleClass(h.style);
    if (sc){
      if (pace.score < 0.45 && (sc==='E'||sc==='S')) t.push('スローなら' + styleLabel(h.style) + 'が展開利');
      if (pace.score > 0.65 && (sc==='K'||sc==='C')) t.push('ハイペースで' + styleLabel(h.style) + '有利');
    }
    if (r.mineFlag && o != null) t.push('妙味' + (+r.mine.toFixed(2)));
    r.comment = t.join(' / ') || '—';
    r.mineStr = r.mine != null ? (+r.mine.toFixed(2)).toFixed(2) : '—';
  });

  // 印の着順2頭目以降表示用 display
  res.rows = rows;
  res.order = order;
  res.ok = true;
  res.note = '';
  if (!hs.some(function(h){ return num(h.odds) != null; })) res.note = '単勝オッズが未入力のため、人気要素は使われていません。';
  if (!hs.some(function(h){ return h.style; })) res.note += ' 脚質が未入力のため展開適性は全馬均等扱いです。';
  if (!timeUsable && hs.some(function(h){ return h.time; })) res.note += ' 距離が未入力のため持ちタイム比較をスキップしました。';
  res.colsAvail = { odds: colO.some(function(v){return v!==0.25 && v!==0.5;}), yobi: colY.some(function(v){return v!==0.25&&v!==0.5;}), time: timeUsable, baba: babaOn, yoso: yosoOn };
  res.yosoOn = yosoOn;
  res.yosoTimeBased = yoUsable;   // 持ちタイム列が「馬柱の最速持ちタイム」基準になったか
  /* ★2026-09-13 第25弾①: 展開短評と「ペース想定 vs 実測馬場」のズレを res に載せる */
  try {
    res.paceScoreRaw = (pace && pace.score != null) ? pace.score : null;
    res.paceScoreEff = sEff;
    res.paceBiasW = biasW;
    res.paceSBias = sBias;
    var tst = (typeof tenkaiStat === 'function') ? tenkaiStat() : null;
    res.tenkaiStat = tst;
    var conflict = '';
    if (sBias != null && biasW > 0){
      var dPace = (pace && pace.score != null) ? pace.score : 0.5;
      // ペース想定はハイ（差し有利）なのに実測は前残り → 従来の予想がいちばん外れるパターン
      if (dPace >= 0.60 && sBias <= 0.38 && biasW >= 0.20)
        conflict = '⚠ ペース想定は「' + (pace && pace.label ? pace.label : 'ハイペース') + '」で差し・追込有利のはずですが、' +
          '実測馬場は前残り（前残り寄与度 ' + (biasV && biasV.frontScore != null ? biasV.frontScore.toFixed(2) : '?') + '）です。' +
          'ハイペースでも後ろが全く届かない馬場の可能性があるため、**実測を優先して差し・追込の上乗せを' +
          Math.round(biasW * 100) + '%ぶん抑えました**';
      else if (dPace <= 0.40 && sBias >= 0.62 && biasW >= 0.20)
        conflict = '⚠ ペース想定はスロー（逃げ・先行有利）ですが、実測馬場は差し有利（前残り寄与度 ' +
          (biasV && biasV.frontScore != null ? biasV.frontScore.toFixed(2) : '?') + '）です。実測を優先して差し・追込を' +
          Math.round(biasW * 100) + '%ぶん上乗せしました';
    }
    res.tenkaiConflict = conflict;
    var cm = (typeof tenkaiComment === 'function') ? tenkaiComment(biasV, tst, { conflict: conflict }) : [];
    res.tenkaiComment = (typeof tenkaiCommentReady === 'function' && tenkaiCommentReady(tst)) ? cm : [];
    res.tenkaiCommentAll = cm;
  } catch(e){}
  res.wakuStat = wakuOn ? wakuSt : null;   // ★第24弾①: 枠順ファクターで使用した統計（重賞のみ・nullなら不使用）
  res.wakuOn = wakuOn;
  /* 枠順ファクターを「使った/使わなかった」を必ず画面に出す（黙って効かせる・黙って無視しない） */
  try {
    if (wakuOn){
      var nJudged = 0;
      for (var wj = 0; wj < hs.length; wj++){ if (colW[wj] != null) nJudged++; }
      res.wakuAppliedNote = '🎯 枠順ファクターを適用（重賞のみ）: ⑥で集めた<b>この重賞の過去10年 ' + wakuSt.n + ' 走</b>の歴代結果から有利枠を判定／' +
        (typeof wakuSummaryText === 'function' ? esc(wakuSummaryText(wakuSt)) : '') +
        '　<span style="font-weight:400">（' + nJudged + '/' + hs.length + '頭に適用・判定できない枠は中立。有利度=実際の3着内数÷その頭数での期待3着内数、1.00=平均）</span>';
    } else if ((w.waku||0) > 0){
      res.wakuAppliedNote = '🎯 枠順ファクターは<b>今回は不使用</b>（重賞でない、または⑥重賞データ分析の過去10年データが無い／対象レースが一致しません）。重賞で⑥の分析をすると自動で使われます';
    }
  } catch(e){}
  res.babaOn = babaOn;
  if ((w.baba||0) > 0){
    if (babaOn && babaInfo){
      var hitN = babaInfo.items.filter(function(v){ return v.n > 0; }).length;
      var hitS = babaInfo.items.filter(function(v){ return v.n > 0; }).map(function(v){ return v.no + '番' + v.pct + '%'; }).join(' / ');
      res.babaAppliedNote = '🏟 バ場好走率を反映: 対象' + babaInfo.usedN + '走（' + babaInfo.usedR + '頭中' + hitN + '頭にデータ）。' + babaInfo.babaLabel + 'の3着内率を重み' + w.baba + 'で加味' + (hitS ? '（' + hitS + '）' : '') + '。';
    } else {
      var bwhy = (babaInfo && babaInfo.why) ? babaInfo.why : '馬柱データがまだ取得されていません';
      res.babaAppliedNote = '🏟 バ場好走率: 未使用（' + bwhy + '）。重み設定下の「📊 バ場好走率データを取得」ボタンで馬柱を取込むと反映されます。';
    }
  }
  if ((w.yoso||0) > 0){
    if (yosoOn && yoInfo){
      var yHit = yoInfo.items.filter(function(v){ return v.sec != null; });
      var yTop = yoInfo.bestYo;
      res.yosoAppliedNote = '🏔 ' + esc(yoInfo.ctx.label) + '適性を反映: ' + esc(yoInfo.tierNote) +
        '・最速持ちタイム馬 ' + yHit.length + '頭を重み' + w.yoso + 'で加味' +
        (yTop ? '（最速: ' + esc(yTop.no || '') + '番' + esc(yTop.name || '') + ' ' + yoFmt(yTop.sec) + '・' + esc(yTop.venue || '') + ' ' + (yTop.dist || '') + 'm）' : '') +
        (yoInfo.ctx.isYoso ? '。洋芝開催のため<b>洋芝での持ちタイムを優先</b>評価しています' : '') + '。' +
        (yoUsable ? '（ホバーで詳細・「⏱ 競馬場別の持ちタイム」ボタンで一覧）' : '');
    } else {
      var ywhy = (yoInfo && yoInfo.why) ? yoInfo.why : '馬柱データがまだ取得されていません';
      res.yosoAppliedNote = '🏔 ' + esc((yoInfo && yoInfo.ctx ? yoInfo.ctx.label : 'コース')) + '適性: 未使用（' + esc(ywhy) + '）。「⏱ 競馬場別の持ちタイム」ボタンで馬柱を取り込むと反映されます。';
    }
  }
  res.bias = biasV || null;
  res.slowN = slowN;
  res.paceManual = pmode != null;
  res.biasManual = (biasManual && biasManual !== 'off') ? biasManual : '';
  if (biasManual && biasManual !== 'off' && biasV){
    res.biasAppliedNote = '🎚 手動トラックバイアス「' + biasV.posLabel + '」を脚質評価に反映（展開予想欄で指定。逃げ・先行/差し・追込の評価を補正）';
  } else if (!biasManual && learnOn && biasV && biasV.posLabel && biasV.posLabel !== '前後フラット'){
    res.biasAppliedNote = '📈 トラックバイアス「' + biasV.posLabel + '」を脚質評価に反映（逃げ・先行/差し・追込の評価を補正）';
  }
  if (histM){
    var lnLabel = (state.learn && state.learn.hist && state.learn.hist.label) ? state.learn.hist.label : '';
    res.learnAppliedNote = '🎓 展開学習（このレースの過去' + learnN + '回の結果）を反映: ' + esc(lnLabel || '脚質傾向を補正') +
      '（逃げ' + (styleM.E).toFixed(2) + ' / 先行' + (styleM.S).toFixed(2) + ' / 差し' + (styleM.K).toFixed(2) + ' / 追込' + (styleM.C).toFixed(2) + '）';
  }
  if (slowN > 0){
    res.slowAppliedNote = '🐢 出遅れ率を反映: 出遅れ率10%以上の馬 ' + slowN + '頭（先行型ほどペナルティ大）。下の表のコメント欄にも表示しています。';
  }
  if (pmode != null){
    res.paceManualNote = '🎚 ペースは「手動想定」で ' + pace.label + ' に固定しています（「自動AI推定」に戻すと再計算します）';
  }
  if (apL && apL.apply && apL.note){
    res.selfLearnNote = apL.note + '（「🔁 AI予想の自己学習」カードで反映をOFFにできます）';
    res.apApplied = true;
  }
  if (bfA && bfA.some(function(v){ return v > 0; })){
    res.bfAppliedNote = (typeof bfAppliedNote === 'function') ? bfAppliedNote() : '🧬 血統ファクターを反映しました（⑥重賞データ分析でONにしたファクター該当馬を加点）';
  }
  return res;
}

/* 買い目・妙味のサマリ */
function buildBets(res){
  var rows = res.rows;
  if (!rows.length) return [];
  var bet = function(label, txt, note){ return { label: label, txt: txt, note: note }; };
  var out = [];
  var top = rows[0], two = rows[1];
  if (top.h.odds) out.push(bet('単勝/複勝', top.mark + ' ' + top.h.no + ' ' + top.h.name + '（' + top.h.odds + '倍）', 'AI最上位'));
  out.push(bet('馬連(軸)', top.mark + top.h.no + '−' + rows.slice(1,5).map(function(r){ return r.mark + r.h.no + (r.h.name?'('+r.h.name+')':''); }).join(' / '), '1着固定で相手4点ほど'));
  var b3 = rows.slice(0,3).map(function(r){ return r.h.no; });
  out.push(bet('3連複 Box', b3.join('-'), '上位3頭ボックス 1点'));
  out.push(bet('3連複 F(1,2着候補)', '軸' + two.mark + ' 相手 ' + rows.slice(0,5).map(function(r){return r.h.no;}).join(',') , '1-2着どちらに軸が入るかを見る形'));
  return out;
}

/* メモ・テーブル等のための単体ヘルパ */
/* ★2026-09-13 第25弾①: ペース想定を実測バイアスで上書きするときのブレンド定数。
   w = known / (known + K) で、known=当日＋前日の3着内サンプル数。
   K=12 なら 3頭→w=0.20 / 12頭→0.50 / 36頭→0.75 / 120頭→0.91。
   朝イチ（サンプル数頭）はペース想定寄り、終盤（実測が溜まる）は実測馬場が主役になります。 */
var TENKAI_BIAS_K = 12;
function readRaceMeta(){
  var g = function(id){ var el = $(id); return el ? el.value.trim() : ''; };
  return { name: g('rName'), place: g('rPlace'), baba: g('rBaba'), dist: g('rDist'), grade: g('rClass'), time: g('rTime'), cushion: g('rCushion') };
}
