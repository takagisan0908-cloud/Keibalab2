/* =========================================================
   44 馬柱AI評価（芝・ダ替わりの適正 / 得意コース・距離・馬場）
   ---------------------------------------------------------
   各馬の馬柱戦績（p34 hdParseRecords の解析結果＝khl_hd_v1）を
   芝とダートで区別して集計し、
     - 芝とダそれぞれの実績（走数・3着内率）→「芝替わり・ダ替わり」の適正
     - 得意コース（競馬場）・得意距離帯・得意馬場状態
     - 好走時の展開傾向（4角位置）
   をAIが短評し、②タブの「AI予想」欄に表示する。
   データは「📊 バ場好走率データを取得」と同じ馬柱キャッシュを利用。
   ========================================================= */
function aihRecOf(nk){
  try { var ls = hdLs(); return (nk && ls[String(nk).trim()]) || null; } catch(e){ return null; }
}
function aihPct(a, b){ return b > 0 ? Math.round(a / b * 100) : -1; }
/* 1頭の戦績から芝/ダ別・得意条件を集計 */
function aihAnalyze(rec){
  var rows = (rec && rec.r) || [];
  var res = { n: 0, surface: {}, venue: {}, dist: {}, baba: {}, prevSurf: '', lastSurf: '', styles: { 逃げ:0, 先行:0, 差し:0, 追込:0 } };
  rows.forEach(function(r){
    if (!r || r.order < 1) return;
    res.n++;
    var sf = r.surface === '芝' || r.surface === 'ダ' ? r.surface : '他';
    var g = res.surface[sf] = res.surface[sf] || { n: 0, win: 0, top3: 0 };
    g.n++; if (r.order === 1) g.win++; if (r.order <= 3) g.top3++;
    if (r.venueName){ var v = res.venue[r.venueName] = res.venue[r.venueName] || { n: 0, top3: 0 }; v.n++; if (r.order <= 3) v.top3++; }
    if (r.m){ var band = hdBand(r.m); if (band){ var d = res.dist[band] = res.dist[band] || { n: 0, top3: 0 }; d.n++; if (r.order <= 3) d.top3++; } }
    var bb = String(r.baba || '').trim();
    if (bb === '良' || bb === '稍重' || bb === '重' || bb === '不良'){ var b = res.baba[bb] = res.baba[bb] || { n: 0, top3: 0 }; b.n++; if (r.order <= 3) b.top3++; }
    if (r.order <= 3 && typeof histStyle === 'function'){
      try {
        var hd = parseInt(r.head, 10);
        var st = histStyle(r.passing, (hd > 1 ? hd : 18));
        if (st && st.tag && res.styles[st.tag] != null) res.styles[st.tag]++;
      } catch(e){}
    }
    if (sf === '芝' || sf === 'ダ') res.lastSurf = sf;
  });
  if (!res.surface.芝) res.surface.芝 = { n: 0, win: 0, top3: 0 };
  if (!res.surface.ダ) res.surface.ダ = { n: 0, win: 0, top3: 0 };
  return res;
}
function aihBest(groups, minN){
  var best = null, bestKey = '';
  for (var k in groups){ var g = groups[k]; if (g.n < minN) continue; var rate = aihPct(g.top3, g.n); if (!best || rate > best){ best = rate; bestKey = k; } else if (rate === best && g.n > groups[bestKey].n){ best = rate; bestKey = k; } }
  return bestKey;
}
/* 1頭分のAI短評（芝替わり/ダ替わり・得意条件・展開傾向） */
function aihComment(rec, curSurf){
  var a = aihAnalyze(rec);
  var parts = [];
  var totalP = aihPct((a.surface.芝.top3 || 0) + (a.surface.ダ.top3 || 0), a.n);
  // 面の適正
  var pref = null;
  function rateOf(sf){ var g = a.surface[sf]; return g.n >= 2 ? aihPct(g.top3, g.n) : -1; }
  var rT = rateOf('芝'), rD = rateOf('ダ');
  if (rT >= 0 && (rD < 0 || rT >= rD + 15)) pref = '芝';
  else if (rD >= 0 && (rT < 0 || rD >= rT + 15)) pref = 'ダ';
  // 前走との比較で替わりを判定
  var prevSurf = '';
  try { var rr = rec.r || []; prevSurf = rr.length ? (rr[rr.length - 1].surface === '芝' || rr[rr.length - 1].surface === 'ダ' ? rr[rr.length - 1].surface : '') : ''; } catch(e){}
  if (curSurf && (curSurf === '芝' || curSurf === 'ダ')){
    var g2 = a.surface[curSurf];
    if (g2.n === 0){
      parts.push('今回' + curSurf + 'は' + (prevSurf ? '前走' + prevSurf + 'からの' + curSurf + '替わりで、' + curSurf + '実績なし' : '初挑戦級') + ' → 割引評価');
    } else {
      var p = aihPct(g2.top3, g2.n);
      var mark = p >= 45 ? '◎' : p >= 28 ? '○' : p >= 15 ? '△' : '×';
      parts.push(curSurf + '実績は複勝圏' + p + '%（' + mark + '）');
      if (prevSurf && prevSurf !== curSurf) parts.push('前走' + prevSurf + 'から「' + curSurf + '替わり」');
    }
  }
  if (pref) parts.push('得意は' + pref);
  else if (rT >= 0 && rD >= 0) parts.push('芝ダ兼用タイプ');
  // 得意コース
  var v = aihBest(a.venue, 3);
  if (v) parts.push('コース: ' + v + 'が得意');
  // 得意距離
  var d = aihBest(a.dist, 3);
  if (d) parts.push('距離: ' + d + 'が得意');
  // 得意馬場
  var b = aihBest(a.baba, 3);
  if (b) parts.push('馬場: ' + b + 'が得意');
  // 展開傾向
  var sc = a.styles;
  var order2 = [['逃げ', sc.逃げ], ['先行', sc.先行], ['差し', sc.差し], ['追込', sc.追込]];
  order2.sort(function(x, y){ return y[1] - x[1]; });
  if (order2[0] && order2[0][1] > 0){
    var posTxt = order2[0][0] + (order2[1] && order2[1][1] > 0 ? '・' + order2[1][0] : '');
    parts.push('好走時は' + posTxt + '気味');
  }
  return { totalP: totalP, text: parts.length ? parts.join('、') + '。' : 'データなし', parts: parts };
}
/* 現在レースの全出走馬を対象に評価HTMLを生成 */
function aihHorses(){
  var out = [];
  (state && state.horses || []).forEach(function(h, i){
    if (!h || !h.no) return;
    var nk = String(h.nk || '').trim();
    var rec = nk ? aihRecOf(nk) : null;
    out.push({ i: i, no: h.no, name: h.name || '', nk: nk, rec: rec });
  });
  return out;
}
function aihCurSurf(){
  try {
    var pl = String(readRaceMeta().place || (state.race && state.race.place) || '');
    if (/ダ/.test(pl)) return 'ダ';
    if (/芝/.test(pl)) return '芝';
    var nm = String(state.race && state.race.name || '');
    if (/ダート|ダ/.test(nm)) return 'ダ';
    if (/芝/.test(nm)) return '芝';
  } catch(e){}
  return '';
}
/* ===== 出馬表(グリッド)の各行へAI評価を自動入力 =====
   馬柱キャッシュ(khl_hd_v1)がある馬は「馬名」の下にAI短評を自動表示する。
   キャッシュが無い馬は空欄（取得は下の aihAutoRun が自動で行う）。 ===== */
function aihRowNote(h){
  try {
    if (!h || !h.nk) return '';
    var rec = aihRecOf(String(h.nk).trim());
    if (!rec) return '';
    var c = aihComment(rec, aihCurSurf());
    var t = String(c.text || '');
    if (!t || t === 'データなし') return '';
    // 行内に収まる長さに要約（先頭3項目まで）
    var parts = (c.parts || []).slice(0, 3);
    return parts.join('、') + '。';
  } catch(e){ return ''; }
}
/* グリッド内のAI評価欄だけを書き換える（表の再描画なし） */
function aihPaintRows(){
  try {
    var tb = $('horseBody'); if (!tb) return;
    (state.horses || []).forEach(function(h){
      if (!h || h.uid == null) return;
      var tr = tb.querySelector('tr[data-uid="' + h.uid + '"]');
      if (!tr) return;
      var cell = tr.querySelector('[data-aih]');
      if (!cell) return;
      var note = aihRowNote(h);
      cell.textContent = note ? ('🤖 ' + note) : '';
      cell.title = note ? '馬柱AI評価（出馬表の出力時に自動入力）: ' + note : '';
    });
  } catch(e){}
}
/* ===== 自動実行（出馬表の出力時） =====
   - まずキャッシュ分だけで即時表示（通信なし）
   - 未取得の馬があれば自動で馬柱を取得 → 揃った分から随時表示
   - 同じ馬立てで何度も rebuild されても取得は1回だけ（署名で判定） ===== */
var AIH_SIG = '', AIH_BUSY = false, AIH_TMR = null;
function aihSignature(){
  var ids = (state.horses || []).filter(function(h){ return h && h.nk; }).map(function(h){ return String(h.nk); });
  return ids.join(',');
}
function aihAutoRun(force){
  var sig = aihSignature();
  if (AIH_TMR){ clearTimeout(AIH_TMR); AIH_TMR = null; }
  AIH_TMR = setTimeout(function(){
    AIH_TMR = null;
    try { aihPaintRows(); aihRender(); } catch(e){}
    if (!sig || AIH_BUSY) return;
    if (!force && sig === AIH_SIG) return;                 // 同じ馬立ては取得を繰り返さない
    var miss = (state.horses || []).filter(function(h){ return h && h.nk && !aihRecOf(String(h.nk).trim()); });
    if (!miss.length) return;                              // 全馬キャッシュ済み
    AIH_SIG = sig; AIH_BUSY = true;
    var m = $('aihMsg');
    if (m) m.textContent = '出馬表の出力に合わせて馬柱を自動取得しています（残り ' + miss.length + ' 頭）…';
    var p;
    try { p = bbEnsure(false, function(t){ if (m) m.textContent = String(t); }); }
    catch(e){ p = Promise.resolve(); }
    (p || Promise.resolve()).then(function(r){
      AIH_BUSY = false;
      if (r && r.err > 0 && !r.ok){
        AIH_SIG = '';   // 全滅（中継未設定など）のときは、後で条件が変わったら再試行できるようにする
        if (m) m.textContent = '⚠ 馬柱の自動取得に失敗しました（中継設定をご確認ください）。①の「🔧 中継を診断」で確認できます。';
      } else if (m){
        m.textContent = '✅ 出馬表の出力時に馬柱AI評価を自動入力しました。';
      }
      try { aihPaintRows(); aihRender(); } catch(e){}
      /* ★2026-09-13 第19弾③: 馬柱が取れた直後は、まだ空欄だった 上3F・持ちタイム を
         キャッシュから埋め直せる。埋まった時だけ出馬表を描き直す（rebuildHorseTable 内でも
         nkAutoFill が走るが、AIH_SIG により再取得ループにはなりません）。 */
      try {
        if (typeof nkAutoFill === 'function' && nkAutoFill() && typeof rebuildHorseTable === 'function'){
          rebuildHorseTable();
          if (typeof updateGridHints === 'function') updateGridHints();
          var m2 = $('aihMsg');
          if (m2) m2.textContent = '✅ 馬柱AI評価と 上3F・持ちタイム を自動入力しました。';
        }
      } catch(e){}
    }, function(){ AIH_BUSY = false; AIH_SIG = ''; });
  }, 400);
}

/* ===== 2026-09-12 第15弾: 折り込んだままでも狙い目が読める「文章の要約」 =====
   🏇馬柱AI評価はカードごと折り込む代わりに、summary 内（#aihPick）へ
   今回の条件（芝/ダ・開催場・距離帯・馬場）に合う馬をスコア順の文章で常時表示します。
   スコアの内訳: ①今回の面の実績(55%) ②同じ開催場(25%) ③同じ距離帯(20%)
                 ④同じ馬場状態(15%) ⑤全体の3着内率(10%)   ※実績なしは減点 */
var AIH_VENUES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
function aihVenueOf(txt){
  var s2 = String(txt == null ? '' : txt);
  for (var i = 0; i < AIH_VENUES.length; i++){ if (s2.indexOf(AIH_VENUES[i]) >= 0) return AIH_VENUES[i]; }
  return '';
}
function aihBabaOf(v){
  return { fast: '良', good: '稍重', yield: '重', soft: '不良', dirt_fast: '良', dirt_seal: '重' }[String(v || '')] || '';
}
function aihBandShort(b){ return String(b || '').replace(/[(（].*$/, ''); }
function aihRaceCtx(){
  var meta = {};
  try { meta = readRaceMeta() || {}; } catch(e){}
  var r = (typeof state !== 'undefined' && state && state.race) || {};
  var dist = parseInt(meta.dist || r.dist || '', 10) || 0;
  var bv = (meta.baba != null && meta.baba !== '') ? meta.baba : r.baba;
  return {
    surf: aihCurSurf(),
    venue: aihVenueOf(meta.place || r.place || ''),
    dist: dist,
    band: dist ? hdBand(dist) : '',
    baba: aihBabaOf(bv)
  };
}
/* 1頭ぶんの「今回の条件との合い方」を採点する */
function aihPickScore(x, ctx){
  var a = aihAnalyze(x.rec);
  var sc = 0, why = [], bad = [];
  function rate(g){ return (g && g.n) ? aihPct(g.top3, g.n) : -1; }
  // ① 今回の面（芝/ダ）
  if (ctx.surf === '芝' || ctx.surf === 'ダ'){
    var g = a.surface[ctx.surf] || { n: 0, win: 0, top3: 0 };
    if (g.n >= 2){
      var p = aihPct(g.top3, g.n);
      sc += p * 0.55;
      why.push(ctx.surf + (g.win ? g.win + '勝・' : '') + '複勝圏' + p + '%(' + g.n + '走)');
    } else if (g.n === 1){
      sc += (g.top3 ? 22 : 5);
      why.push(ctx.surf + 'は1走のみ(' + (g.top3 ? '3着内' : '着外') + ')');
    } else {
      sc -= 22;
      bad.push(ctx.surf + '実績なし' + (a.lastSurf ? '(前走' + a.lastSurf + '→替わり)' : '(初)'));
    }
  }
  // ② 同じ開催場
  if (ctx.venue){
    var gv = a.venue[ctx.venue];
    if (gv && gv.n >= 2){
      sc += rate(gv) * 0.25;
      why.push(ctx.venue + ' ' + gv.n + '走で3着内' + rate(gv) + '%');
    } else if (gv && gv.n === 1){
      sc += (gv.top3 ? 8 : 0);
    } else {
      var vb = aihBest(a.venue, 3);
      if (vb) why.push('得意は' + vb + '(今回' + ctx.venue + 'は初)');
    }
  } else {
    var vb2 = aihBest(a.venue, 3);
    if (vb2) why.push(vb2 + 'が得意');
  }
  // ③ 同じ距離帯
  if (ctx.band){
    var gd = a.dist[ctx.band];
    if (gd && gd.n >= 2){
      sc += rate(gd) * 0.20;
      why.push(aihBandShort(ctx.band) + ' ' + gd.n + '走で3着内' + rate(gd) + '%');
    } else if (!gd){
      var db = aihBest(a.dist, 3);
      if (db && db !== ctx.band) why.push('得意距離は' + aihBandShort(db));
    }
  }
  // ④ 同じ馬場状態
  if (ctx.baba){
    var gb = a.baba[ctx.baba];
    if (gb && gb.n >= 2){
      sc += rate(gb) * 0.15;
      if (rate(gb) >= 40) why.push(ctx.baba + 'で3着内' + rate(gb) + '%');
    }
  }
  // ⑤ 全体の3着内率（母数の多さも少し評価）
  var tp = aihPct((a.surface.芝.top3 || 0) + (a.surface.ダ.top3 || 0), a.n);
  if (a.n >= 3 && tp >= 0) sc += tp * 0.10;
  return { sc: sc, why: why, bad: bad, n: a.n, tp: tp };
}
/* 狙い目の文章（summary 内へ入れるHTML） */
function aihPickHTML(){
  var ctx = aihRaceCtx();
  var horses = aihHorses().filter(function(x){ return x.rec; });
  if (!horses.length) return '';
  var scored = horses.map(function(x){
    var r = aihPickScore(x, ctx);
    return { x: x, sc: r.sc, why: r.why, bad: r.bad };
  }).sort(function(a, b){ return (b.sc - a.sc) || String(a.x.no).localeCompare(String(b.x.no)); });
  var head = [];
  if (ctx.surf) head.push('今回' + ctx.surf);
  if (ctx.venue) head.push(ctx.venue);
  if (ctx.dist) head.push(ctx.dist + 'm');
  if (ctx.baba) head.push(ctx.baba);
  var MARK = ['①', '②', '③', '④', '⑤'];
  var picks = [], avoid = [];
  scored.forEach(function(o){
    var nm = esc(o.x.no) + '番' + esc(o.x.name);
    if (o.bad.length){ avoid.push(nm + '（' + esc(o.bad[0]) + '）'); return; }
    if (picks.length < 3 && o.sc > 0 && o.why.length){
      picks.push(MARK[picks.length] + '<b>' + nm + '</b>（' + esc(o.why.slice(0, 3).join('／')) + '）');
    }
  });
  var h = ['🎯 <b>狙い目</b>' + (head.length ? '<span class="muted">［' + esc(head.join('・')) + '］</span>' : '') + ': '];
  if (picks.length) h.push(picks.join('　'));
  else h.push('<span class="muted">今回の条件で強調できる馬はありません（馬柱の走数が少ない・条件が初めて）。</span>');
  if (avoid.length) h.push('　<span class="pickwarn">⚠ 割引: ' + avoid.slice(0, 3).join('、') + (avoid.length > 3 ? ' ほか' + (avoid.length - 3) + '頭' : '') + '</span>');
  h.push('<span class="muted">（馬柱の実績からの目安・表を開くと馬ごとの内訳が出ます）</span>');
  return h.join('');
}
function aihPaintPick(){
  var el = $('aihPick'); if (!el) return;
  var html = '';
  try { html = aihPickHTML(); } catch(e){ html = ''; }
  el.innerHTML = html || '🎯 <b>狙い目</b>: 出馬表を取り込むと、芝・ダ替わりの適正／得意コース・距離・馬場から今回の狙い目馬をここに文章で要約します。';
}

function aihRender(){
  var box = $('aihOut'); if (!box) return;
  var horses = aihHorses();
  var curSurf = aihCurSurf();
  var have = horses.filter(function(x){ return x.rec; });
  try { aihPaintPick(); } catch(e){}
  if (!have.length){
    box.innerHTML = '<div class="small muted">まだ馬柱データがありません。出馬表をnetkeibaから取り込むと<b>自動で馬柱を取得</b>し、芝・ダの実績と替わりの適正・得意コース/距離/馬場を馬ごとにAIが短評します（馬IDが必要なため、出馬表は「netkeiba URLから直接取込」で読込んでください）。</div>';
    var cc = $('aihChip'); if (cc) cc.textContent = '未取得';
    return;
  }
  var miss = horses.length - have.length;
  var h = [];
  h.push('<div class="small muted" style="margin-bottom:4px">' + (curSurf ? '今回の想定は【' + curSurf + '】。' : '今回の芝/ダが未設定のため、両面の実績を併記します。') + '「複勝圏」=3着内率。データは直近の馬柱から集計した目安です。</div>');
  h.push('<div class="tblwrap"><table class="lr-tbl"><thead><tr><th>馬</th><th>芝の実績</th><th>ダートの実績</th><th>AI短評（替わり・得意条件）</th></tr></thead><tbody>');
  have.forEach(function(x){
    var c = aihComment(x.rec, curSurf);
    var a = aihAnalyze(x.rec);
    function fmt(sf){
      var g = a.surface[sf];
      if (!g || g.n === 0) return '<span class="muted">なし</span>';
      var p = aihPct(g.top3, g.n);
      return g.n + '走' + (g.win ? ' ' + g.win + '勝' : '') + '<br><b>' + p + '%</b>';
    }
    h.push('<tr><td style="white-space:nowrap"><b>' + esc(x.no) + '</b> ' + esc(x.name) + '</td>' +
      '<td>' + fmt('芝') + '</td><td>' + fmt('ダ') + '</td>' +
      '<td style="text-align:left" class="small">' + esc(c.text) + '</td></tr>');
  });
  h.push('</tbody></table></div>');
  if (miss) h.push('<div class="small muted" style="margin-top:4px">馬柱が未取得の馬が ' + miss + ' 頭います（取得すると追記されます）。</div>');
  box.innerHTML = h.join('');
  var cc2 = $('aihChip'); if (cc2) cc2.textContent = have.length + '頭評価';
}
function initAih(){
  var b = $('aihBtn');
  if (b) b.addEventListener('click', function(){
    if (b.disabled) return;
    b.disabled = true;
    var m = $('aihMsg'); if (m) m.textContent = '馬柱データを確認・取得しています…';
    var p;
    try { p = bbEnsure(false, function(t){ if (m) m.textContent = t; }); }
    catch(e){ p = Promise.resolve(); }
    (p || Promise.resolve()).then(function(){
      if (m) m.textContent = '完了。下に芝・ダ別のAI評価を表示します。';
      aihRender();
      b.disabled = false;
    });
  });
  try { aihPaintRows(); aihRender(); } catch(e){}
  // 出馬表の出力（再描画）に合わせて自動で馬柱AI評価を入れる
  try { aihAutoRun(true); } catch(e){}
}
