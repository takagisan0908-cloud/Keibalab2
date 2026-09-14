/* =========================================================
   40 netkeiba 馬データ抽出（旧jiro8 を廃止し、netkeiba に一本化）
   ---------------------------------------------------------
   仕組み:
   1) ①データ入力の netkeiba URL取込(nkImportCard等)で、出馬表の各馬に
      netkeiba競走馬ID(h.nk = 例 2023107165)が付いた状態にする
   2) 出馬表各行の「🐎 馬情報」ボタン(旧「📜馬柱」相当)で nkHorseModal():
      - db.netkeiba.com/horse/<id>/         … プロフィール
      - db.netkeiba.com/horse/result/<id>/  … 戦績全件(日付/場/R/レース名/頭数/着順/
                                                人気/単勝/タイム/通過/上り3F/馬体重/距離/馬場/騎手/斤量)
      を取得し、直近5走を netkeiba 風の「馬情報＋馬柱」モーダルで表示
   3) 各過去レースの「上り3F」セルは、そのレース内での速さ順位で色分け:
        上り1位=黄  /  上り2位=青  /  上り3位=ピンク   (netkeibaの見せ方に準拠)
      順位は該当レースの結果ページ(db.netkeiba.com/race/<rid>)の全馬 上り3F から算出
   4) 「全馬に前走の上3F・タイムを自動反映」ボタン(nkFetchAll): 各馬の「今回より前の
      直近レース」(前走)の上り3F と、今回と同距離±200m以内の前走タイムを
      出馬表へ自動反映し、AI予想(調教/持ちタイム比較)にそのまま使える。
   5) 各馬の過去レース(戦績全件)の「位置取り(通過)」から「出遅れ」を検出・集計するが、
      出馬表の「出遅れ率%」列は【手入力運用】のため自動では書き込まない(参考表示のみ)。
      ※ 2026-09-10 変更: 以前は nkSlowApply() で h.slow へ自動セットしていた。
      - 表記「(出遅れ)」等があるレースは明示カウント
      - 表記が無い場合は、1コーナー最後方付近なのに後で順位を戻したレースを
        「推定」としてカウント(hdSlowStat / hdRaceSlowKey 参照)
      AI(展開エンジン)は従来どおり「出遅れ率(％)」列(h.slow)を読み、
      逃げ・先行型ほどペナルティを効かせて展開適性を補正する。
   取得結果は端末内(localStorage)にキャッシュされ、同じ馬・同じレースは2回目から高速。
   ========================================================= */

var NK_LS = 'keiba_nk_v1';
function nkLs(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(NK_LS)) || '{}') || {}; } catch(e){ return {}; } }
function nkSave(ls){ try { localStorage.setItem(NK_LS, cmpPack(JSON.stringify(ls))); } catch(e){} }
function nkGet2(url){
  if (typeof drGet === 'function') return drGet(url);
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  return Promise.reject(new Error('netkeiba 取得手段(中継)がありません。①の「URL取込の通信設定」をご確認ください。'));
}
function nkNowRid(){
  try {
    if (state && state.raceId) return String(state.raceId);
    if (typeof nkExtractRaceId === 'function' && $('urlImport')) return nkExtractRaceId($('urlImport').value || '');
  } catch(e){}
  return '';
}
/* 今回レースの開催日8桁(YYYYMMDD)
   ★2026-09-12 第16弾で修正: netkeiba の race_id は「年+場コード+回+日+R」で
     【日付ではありません】（例: 202506050809 = 2025年 中山(06) 5回 8日目 9R = 2025/12/28）。
     旧実装は先頭8桁を日付として使っていたため「直近5走」の絞り込みがずれていました。
     → jlRaceD8()（state.raceDate8 があればそれ、無ければ今日）に統一します。 */
function nkTodayD8(){
  /* ★2026-09-13 第19弾③: state.raceDate8 が未設定のとき jlRaceD8() は「今日」を返すため、
     過去レースを読み込んだ場合に「直近5走」の基準日がずれて
     上3F・持ちタイムが空になったり別レースのものになったりしていました。
     ここでは hfCurD8()（raceDate8 → レース名の日付 → 今日の順）を優先します。 */
  if (typeof hfCurD8 === 'function'){ try { var h = hfCurD8(); if (/^\d{8}$/.test(String(h || ''))) return String(h); } catch(e){} }
  if (typeof jlRaceD8 === 'function'){ try { return jlRaceD8(); } catch(e){} }
  var d = new Date();
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
/* 馬1頭のプロフィール+戦績ページを取得しパース(キャッシュ) */
/* opt.only: 'recs'(戦績だけ/軽い) 'prof'(プロフィールだけ) 未指定=両方
   一括取得では戦績ページだけを取り、プロフィールは「🐎馬情報」を開いた時に取りに行く。
   → 馬1頭あたりの通信が半分になり、中継(サーバーレス関数)の連続アクセスで
     弾かれて「1頭目以降が失敗」する事象が起きにくくなる。 */
function nkFetchHorsePages(id, opt){
  opt = opt || {};
  var ls = nkLs();
  var hit = ls.h && ls.h[id];
  var needRecs = (opt.only !== 'prof') && !(hit && hit.recs && hit.recs.length);
  var needProf = (opt.only === 'prof') ? true : (opt.only === 'recs' ? false : !(hit && hit.prof && Object.keys(hit.prof).length));
  if (hit && !needRecs && !needProf && (opt.only !== 'prof')) return Promise.resolve(hit);
  /* ★2026-09-13 第20弾: ①「🧾 全馬のプロフィール・戦績・成績分析」(p34 / khl_hd_v1) と
     ここ (keiba_nk_v1) は【同じURL・同じパーサ】なのにキャッシュが別だったため、
     自動マクロで両方を走らせると 1頭あたり2回 取得していました。
     p34 側に新鮮なキャッシュがあればそれを写すだけで済ませます（通信ゼロ）。 */
  if (needRecs || needProf){
    try {
      if (typeof hdLs === 'function' && typeof hdCacheKey === 'function'){
        var hr = hdLs()[hdCacheKey(id)];
        if (hr && hr.r && hr.r.length && needRecs){
          var data0 = hit || { id: id, prof: {}, recs: [], slow: null };
          data0.recs = hr.r;
          if (hr.p && Object.keys(hr.p).length) data0.prof = hr.p;
          data0.slow = (typeof hdSlowStat === 'function') ? hdSlowStat(hr.r) : null;
          data0.id = id; data0.at = Date.now();
          ls.h = ls.h || {}; ls.h[id] = data0;
          nkSave(ls);
          return Promise.resolve(data0);
        }
      }
    } catch(e){}
  }
  var jobs = [];
  if (needProf) jobs.push(nkGet2('https://db.netkeiba.com/horse/' + id + '/'));
  if (needRecs) jobs.push(nkGet2('https://db.netkeiba.com/horse/result/' + id + '/'));
  if (!jobs.length) return Promise.resolve(hit);
  return Promise.all(jobs).then(function(rs){
    var i = 0;
    var data = hit || { id: id, prof: {}, recs: [], slow: null };
    if (needProf){
      var htmlP = rs[i++];
      data.prof = (typeof hdParseProfile === 'function') ? hdParseProfile(htmlP) : {};
    }
    if (needRecs){
      var htmlR = rs[i++];
      data.recs = (typeof hdParseRecords === 'function') ? hdParseRecords(htmlR) : [];
      data.slow = (typeof hdSlowStat === 'function') ? hdSlowStat(data.recs) : null;
    }
    data.id = id; data.at = Date.now();
    ls.h = ls.h || {}; ls.h[id] = data;
    nkSave(ls);
    return data;
  }).catch(function(e){
    throw new Error('馬ページを取得できませんでした(競走馬ID ' + id + '): ' + ((e && e.message) || e));
  });
}
/* 戦績行の日付 '2026/8/23' → '20260823' */
function nkRecD8(row){
  /* ★2026-09-13 第19弾③: netkeiba の戦績は '2026/8/23' 形式ですが、取込元によっては
     '2026-08-23' や '2026.8.23' も混ざります。区切りが違うだけで「直近5走」が全滅して
     上3F・持ちタイムが空欄になっていたため、区切り文字を問わず拾えるようにしました。 */
  var m = String(row && row.date || '').match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  return m ? m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) : '';
}
/* 今回より前の戦績を新しい順に最大 limit 件 */
function nkRunsBefore(recs, curD8, limit){
  var rows = (recs || []).filter(function(r){
    var d = nkRecD8(r);
    return d && (!curD8 || d < curD8);
  });
  rows.sort(function(a, b){ return nkRecD8(b).localeCompare(nkRecD8(a)); });
  return rows.slice(0, limit || 5);
}
/* 前走レースの rid を解決(日付×場×R)。中央開催のみ。 */
function nkResolveRid(row){
  if (!row) return Promise.resolve('');
  if (typeof drPrevRid !== 'function') return Promise.resolve('');
  var vname = row.venueName || row.venue || '';
  return drPrevRid({ d: row.date, vname: vname, r: row.r }).catch(function(){ return ''; });
}
/* レース結果全馬の上り3Fから、指定値の速さ順位(1=最速)を返す */
function nkRankOfLast3(rid, last3val){
  if (!rid || last3val == null) return Promise.resolve(0);
  if (typeof drFetchRace !== 'function') return Promise.resolve(0);
  var target = parseFloat(String(last3val).replace(/[^0-9.]/g, ''));
  if (isNaN(target)) return Promise.resolve(0);
  return drFetchRace(rid).then(function(rec){
    var vals = [];
    (rec.rows || []).forEach(function(x){
      if (!(x.order >= 1)) return;
      var t = parseFloat(String(x.last3 == null ? '' : x.last3).replace(/[^0-9.]/g, ''));
      if (!isNaN(t)) vals.push(t);
    });
    if (!vals.length) return 0;
    var faster = 0;
    for (var i = 0; i < vals.length; i++) if (vals[i] < target - 0.0001) faster++;
    return faster + 1;
  }).catch(function(){ return 0; });
}
/* 上り順位 → 色クラス(1=黄,2=青,3=ピンク) */
function nkRankClass(rank){
  if (rank === 1) return 'nkr r1';
  if (rank === 2) return 'nkr r2';
  if (rank === 3) return 'nkr r3';
  return '';
}
/* 馬柱モーダル内の「上り3F」セル(順位色付き) */
function nkLast3Cell(r){
  var v = String(r.last3 == null ? '' : r.last3).trim();
  var rank = parseInt(r.rank, 10) || 0;
  if (!v || v === '中止') return '<span class="muted">−</span>';
  var color = nkRankClass(rank);
  if (color) return '<span class="' + color + '" title="このレースの上り' + rank + '位">' + esc(v) + '</span>';
  return '<span>' + esc(v) + '</span>';
}
/* 馬柱モーダル内の「通過(位置取り)」セル。
   出遅れだったレースは、通過順の右に「出遅れ」表記を付ける
   (位置取りそのものに「(出遅れ)」等の明示がある=m、表記が無いが
   1コーナー最後方付近を通過し、直後のコーナーで大きく順位を挽回したレースを推定=i。hdRaceSlowKey参照) */
function nkPassCell(r){
  var v = String(r.pass == null ? '' : r.pass).trim();
  var key = null;
  if (typeof hdRaceSlowKey === 'function'){
    try { key = hdRaceSlowKey(r); } catch(e){}
  }
  var txt = v ? esc(v) : '<span class="muted">−</span>';
  if (!key) return '<td style="text-align:left;white-space:nowrap">' + txt + '</td>';
  if (key === 'm'){
    return '<td style="text-align:left;white-space:nowrap">' + txt +
      ' <span class="chip" style="background:var(--card2);border:1px solid var(--line2);color:var(--err-ink);padding:0 4px;font-size:9px;line-height:15px;font-weight:700" title="位置取りの表記に「出遅れ」あり（スタートで出遅れたレース）">🐢出遅れ</span></td>';
  }
  return '<td style="text-align:left;white-space:nowrap">' + txt +
    ' <span class="chip" style="background:var(--card2);border:1px solid var(--line2);color:var(--warn-ink);padding:0 4px;font-size:9px;line-height:15px;font-weight:700" title="通過から推定: 1コーナー最後方付近なのに直後に順位を挽回（ゲートで出遅れた可能性が高いレース）">🐢出遅れ?</span></td>';
}
/* 出馬表グリッドの「上3F」主表示(前走分・順位色付き) */
function nkGridLast3HTML(h){
  if (!h || !h.last3f) return '';
  var rk = parseInt(h.last3rank, 10) || 0;
  var cls = nkRankClass(rk);
  var tit = 'netkeibaから取得した前走上り3F' + (rk ? '（前走レース内で上り' + rk + '位）' : '') +
    (h.last3raw ? '　' + h.last3raw : '');
  return '<div style="line-height:1.3;white-space:nowrap" title="' + esc(tit) + '">' +
    (cls ? '<span class="' + cls + '">上3F&nbsp;' + v(h.last3f) + '</span>'
         : '<span class="l3plain">上3F&nbsp;' + v(h.last3f) + '</span>') +
    (rk ? '<span class="muted" style="font-size:9px">(' + rk + ')</span>' : '') + '</div>';
}

/* ================= 馬情報モーダル ================= */
function nkHorseModal(h){
  if (!h || typeof showModal !== 'function') return;
  if (!h.nk){
    showModal('<h2>🐎 馬情報</h2>' +
      '<div class="small">この馬には netkeiba 競走馬ID がありません。「① データ入力」で <b>netkeiba の出馬表URL</b> を取込むと、各行にこのボタンが使えるようになります。' +
      '<div style="margin-top:10px"><input id="nkDirectId" placeholder="netkeiba競走馬ID（例: 2023107165）" style="width:100%;box-sizing:border-box;padding:5px 7px;font-family:inherit"></div>' +
      '<div style="text-align:right;margin-top:10px"><button class="btn ghost" data-mcl>閉じる</button>' +
      '<button class="btn primary" id="nkDirectGo" style="margin-left:6px">このIDで開く</button></div></div>',
      function(root){
        var go = root.querySelector('#nkDirectGo');
        if (go) go.addEventListener('click', function(){
          var v = ((root.querySelector('#nkDirectId') || {}).value || '').replace(/[^0-9]/g, '');
          if (v.length >= 8){ closeModal(); nkHorseById(v, ''); }
        });
        var cl = root.querySelector('[data-mcl]');
        if (cl) cl.addEventListener('click', closeModal);
      });
    return;
  }
  nkHorseById(h.nk, h.name || '');
}
function nkHorseById(id, hName){
  var body = $('modalBody');
  if (!body) return;
  var curD8 = nkTodayD8();
  var head2 = '<h2>🐎 馬情報を取得中…</h2>' +
    '<div class="small muted" id="nkProg">netkeibaからプロフィールと戦績を取得しています（初回は数秒）。</div>' +
    '<div style="text-align:right;margin-top:12px"><button class="btn ghost" data-mcl2>閉じる</button></div>';
  showModal(head2, function(root){
    var cl = root.querySelector('[data-mcl2]'); if (cl) cl.addEventListener('click', closeModal);
  });
  nkFetchHorsePages(id).then(function(data){        // プロフィール未取得ならここで取りに行く
    var prof = data.prof || {};
    var name = hName || hdP(prof, ['馬名']) || '';
    var runs = nkRunsBefore(data.recs, curD8, 5);
    var di = 0;
    var chain = Promise.resolve();
    runs.forEach(function(run){
      chain = chain.then(function(){
        var prgEl = $('nkProg');
        if (prgEl && runs.length) prgEl.textContent = '直近' + runs.length + '走の上り3F順位を確認中… ' + (di + 1) + '/' + runs.length;
        di++;
        return nkResolveRid(run).then(function(rid){
          run.rid = rid || '';
          if (!rid) return;
          return nkRankOfLast3(rid, run.last3).then(function(r){ run.rank = r || 0; });
        }).catch(function(){ run.rank = 0; });
      });
    });
    chain.then(function(){
      var st = null;
      try {
        if (state && state.horses){
          var hh = state.horses.filter(function(h2){ return String(h2.nk || '') === String(id); })[0];
          if (hh) st = nkSlowApply(hh, data);
        }
      } catch(e){}
      nkRenderHorseModal(id, prof, runs, name, st);
    }).catch(function(){
      var st2 = null;
      try {
        if (state && state.horses){
          var hh2 = state.horses.filter(function(h2){ return String(h2.nk || '') === String(id); })[0];
          if (hh2) st2 = nkSlowApply(hh2, data);
        }
      } catch(e){}
      nkRenderHorseModal(id, prof, runs, name, st2);
    });
  }).catch(function(e){
    if (!body) return;
    body.innerHTML = '<h2>⚠ 取得エラー</h2><div class="small" style="color:var(--err-ink)">' + esc((e && e.message) || e) +
      '</div><div class="small muted" style="margin-top:6px">中継(リレー)が未設定の場合、db.netkeiba のページは取得できません。①の「URL取込の通信設定」→ 中継設定をご確認ください。</div>' +
      '<div style="text-align:right;margin-top:12px"><button class="btn primary" data-mcl3>閉じる</button></div>';
    var b = body.querySelector('[data-mcl3]'); if (b) b.addEventListener('click', closeModal);
  });
}
function nkRenderHorseModal(id, prof, runs, name, slowStat){
  try {
    if (state && state.horses && state.horses.length){
      var hh = state.horses.filter(function(h){ return String(h.nk || '') === String(id); })[0];
      if (hh && hh.no) no = (hh.frame ? hh.frame + '枠' : '') + hh.no + '番';
    }
  } catch(e){}
  var h = [];
  h.push('<h2 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">🐎 ' + esc(name || id) +
    (no ? '<span class="chip">' + esc(no) + '</span>' : '') +
    '<span class="sp"></span><span class="muted small">netkeiba競走馬ID ' + esc(id) + '</span></h2>');
  // プロフィール要約
  var bits = [];
  var bd = hdP(prof, ['生年月日']); if (bd) bits.push('生年月日 ' + esc(bd));
  var sex = hdP(prof, ['性別','牡牝セ']); if (sex) bits.push(esc(sex));
  var jockey = hdP(prof, ['調教師']); if (jockey) bits.push('調教師 ' + esc(jockey));
  var owner = hdP(prof, ['馬主']); if (owner) bits.push('馬主 ' + esc(owner));
  var breeder = hdP(prof, ['生産者']); if (breeder) bits.push('生産者 ' + esc(breeder));
  var prize = hdP(prof, ['収得賞金','賞金']); if (prize) bits.push('収得賞金 ' + esc(prize));
  if (bits.length) h.push('<div class="small" style="border:1px solid var(--line2);background:var(--card2);padding:6px 10px;border-radius:10px;margin-bottom:8px">' + bits.join('　／　') + '</div>');
  // 出遅れ(自動集計)の要約
  if (typeof hdSlowText === 'function' && slowStat && slowStat.total){
    h.push('<div class="small" style="border:1px solid var(--line2);background:var(--card2);padding:6px 10px;border-radius:10px;margin-bottom:8px">🐢 ' + esc(hdSlowText(slowStat)) +
      '<span class="muted">　※ 過去レースの位置取りから自動検出。「推定」は1コーナー最後方付近なのに直後に順位を挽回したレース＝ゲートで出遅れて立て直した走り。後方待機のまま終盤伸びた差し・追込は数えません。数字が大きい馬は逃げ・先行型ほどAI評価が下がります。</span></div>');
  }
  if (!runs.length){
    h.push('<div class="small muted" style="border:1px dashed var(--line2);border-radius:10px;padding:8px 11px;background:var(--card)">今回より前の戦績がまだありません（新馬・未出走の可能性）。</div>');
    h.push('<div style="text-align:right;margin-top:10px"><button class="btn primary" data-mcl>閉じる</button></div>');
    showModal(h.join(''), function(root){
      var b0 = root.querySelector('[data-mcl]'); if (b0) b0.addEventListener('click', closeModal);
    });
    return;
  }
  // 色の凡例
  h.push('<div class="small muted" style="margin:2px 0 6px">直近' + runs.length + '走の「上3F」は、<b>そのレース内での速さ順位</b>で色分け: ' +
    '<span class="lgb r1" style="background:#ffe13b">上り1位</span> ' +
    '<span class="lgb r2" style="background:#7fc4ff">上り2位</span> ' +
    '<span class="lgb r3" style="background:#ffaad4">上り3位</span>（同タイムは同位）。中央開催のみ判定、旧開催・地方は無色です。</div>');
  h.push('<div style="overflow-x:auto"><table class="lr-tbl nkm-table" style="min-width:780px"><thead><tr>' +
    '<th>日付</th><th>場</th><th>R</th><th style="text-align:left">レース名</th><th>距離・馬場</th><th>頭数</th><th>着順</th>' +
    '<th>人気</th><th>単勝</th><th>タイム</th><th>通過</th><th>上3F</th><th>馬体重</th><th>騎手</th></tr></thead><tbody>');
  runs.forEach(function(r){
    var cls = '';
    if (r.order === 1) cls = 'background:#fff6da';
    else if (r.order >= 2 && r.order <= 3) cls = 'background:#f3faf3';
    else if (!(r.order >= 1)) cls = 'background:#f4efe7';
    h.push('<tr style="' + cls + '">' +
      '<td style="white-space:nowrap">' + esc((r.date || '').replace(/\//g, '/')) + '</td>' +
      '<td>' + esc(r.venueName || '') + '</td>' +
      '<td>' + esc(String(r.r || '')) + '</td>' +
      '<td style="text-align:left;white-space:nowrap">' + esc(r.name || '') + '</td>' +
      '<td>' + esc(r.dist || '') + (r.baba ? '<span class="muted">(' + esc(r.baba) + ')</span>' : '') + '</td>' +
      '<td>' + esc(String(r.head == null ? '' : r.head)) + '</td>' +
      '<td><b>' + (r.order >= 1 ? r.order : esc(r.status || r.orderRaw || '−')) + '</b></td>' +
      '<td>' + esc(String(r.pop || '')) + '</td>' +
      '<td>' + esc(String(r.odds || '')) + '</td>' +
      '<td>' + esc(String(r.time || '')) + '</td>' +
      '<!-- 通過(位置取り)＋出遅れ表記 -->' + nkPassCell(r) +
      '<td>' + nkLast3Cell(r) + '</td>' +
      '<td>' + esc(String(r.wchg || '')) + '</td>' +
      '<td>' + esc(String(r.jockey || '')) + '</td></tr>');
  });
  h.push('</tbody></table></div>');
  h.push('<div class="small muted" style="margin-top:6px">※ 今回の出馬表には、上の一覧の「1番上の行＝前走」の上3Fと、今回と同距離±200m以内の前走タイムを自動反映できます。下の一括ボタンをご利用ください。</div>');
  h.push('<div style="text-align:right;margin-top:10px"><button class="btn primary" data-mcl>閉じる</button></div>');
  showModal(h.join(''), function(root){
    var b = root.querySelector('[data-mcl]'); if (b) b.addEventListener('click', closeModal);
  });
}

/* ================= 出馬表への前走 上3F・タイム 自動反映 ================= */
function nkRecMeters(row){
  var mm = String(row && row.dist || '').match(/[芝ダ障](\d{3,4})/);
  return mm ? parseInt(mm[1], 10) : 0;
}
/* 時計文字列の正規化:
   netkeiba戦績表の「1.07.1」→「1:07.1」 / 「54.2」→「0:54.2」 / 「1:07.1」はそのまま */
function nkTimeOk(t){
  if (!t) return '';
  var s = String(t).replace(/[^0-9.:]/g, '').trim();
  if (!s) return '';
  if (s.indexOf(':') < 0){
    var m1 = s.match(/^(\d{1,3})\.(\d{2})\.(\d)$/);   // 1.07.1
    if (m1) return m1[1] + ':' + m1[2] + '.' + m1[3];
    var m2 = s.match(/^(\d{2,3})\.(\d)$/);              // 54.2
    if (m2 && parseInt(m2[1], 10) < 60) return '0:' + s;
  }
  return s;
}
/* 1頭分: 前走=runs[0] から上3F・タイムを反映。戻り値 {ok, msg[]}
   ★2026-09-13 第21弾③: 「前走距離」がおかしかった件を修正しました。
   原因: h.prevD には【h.time(持ちタイム) が何m の時計か】を入れていたのに、
         画面では「前走距離」として表示していました。前走が今回と距離違い(-±200m超)のときは
         yoBestFromRecs() が「同じコース種別・同距離の最速タイム」を採用するため、
         h.prevD = その最速タイムの距離 になり、前走の距離と食い違います。
         さらに h.prevD は「h.time が空のとき」しか設定されなかったので、
         持ちタイムが既に入っている馬は前走距離が空/古い値のまま残っていました。
   対策: 前走(runs[0])の実データは prevM / prevDate8 / prevVenue / prevR / prevOrder / prevSurf に
         【h.time の有無に関係なく必ず】入れ、prevD は従来どおり「持ちタイムの距離」として
         AI評価(p5_engine の速度比較)専用に使います。表示は両方を分けて出します。 */
function nkApplyOne(h, runs){
  if (!h || !runs || !runs.length) return { ok: false, msg: [] };
  var prev = runs[0];
  var curDist = 0;
  try { curDist = parseInt(readRaceMeta().dist, 10) || 0; } catch(e){}
  var msg = [], changed = false;
  /* --- 前走の実データ（距離・日付・場・R・着順・コース）は必ず入れる --- */
  try {
    var pM = nkRecMeters(prev);
    var pD8 = (typeof nkRecD8 === 'function') ? nkRecD8(prev) : '';
    var pV = String(prev.venueName || prev.venue || '');
    var pR = String(prev.r || '');
    var pO = parseInt(prev.order, 10) || 0;
    var pS = String(prev.surface || '').replace(/[^芝ダ障]/g, '');
    if (!pS){ var sm = String(prev.dist || '').match(/(芝|ダ|障)/); pS = sm ? sm[1] : ''; }
    var pB = String(prev.baba || '').replace(/[^良稍重不]/g, '');
    if (h.prevM !== pM || h.prevDate8 !== pD8 || h.prevOrder !== pO || h.prevVenue !== pV){
      h.prevM = pM; h.prevDate8 = pD8; h.prevVenue = pV; h.prevR = pR;
      h.prevOrder = pO; h.prevSurf = pS; h.prevBaba = pB;
      changed = true;
    }
  } catch(e){}
  var last3 = String(prev.last3 == null ? '' : prev.last3).trim();
  var pv = last3.match(/\d+\.\d/);
  if (pv){
    h.last3f = pv[0];
    h.last3raw = 'netkeiba:' + (prev.venueName || '') + (prev.r ? prev.r + 'R' : '') +
      (prev.dist ? ' ' + prev.dist : '') + (prev.order >= 1 ? ' ' + prev.order + '着' : '');
    h.last3rank = parseInt(prev.rank, 10) || 0;
    msg.push('上3F ' + pv[0] + (prev.rank ? '(上り' + prev.rank + '位)' : ''));
    changed = true;
  }
  if (!h.time){
    var pm = nkRecMeters(prev);
    var t = nkTimeOk(prev.time);
    if (t && pm && curDist && Math.abs(pm - curDist) <= 200){
      h.time = t;
      h.prevD = String(pm);
      h.timeSrc = 'prev';
      msg.push('前走 ' + pm + 'm ' + t);
      changed = true;
    } else if (t && !curDist && pm){
      // 今回距離が未入力でも前走タイムは参考として入れる(距離判明後にAI側で判定)
      h.time = t; h.prevD = String(pm); h.timeSrc = 'prev';
      msg.push('前走 ' + pm + 'm ' + t);
      changed = true;
    }
  } else {
    /* ★第21弾③: 持ちタイムが既に入っている馬は prevD(=その時計が何mか) が空のままだった。
       空だと p5_engine が「今回距離の時計」として速度換算してしまう（距離が違うと時計の意味が変わる）ので、
       前走のタイムと一致するなら前走距離を、一致しないなら 0（不明）を入れて誤換算を防ぎます。 */
    var pd = String(h.prevD || '');
    if (!/^\d{3,4}$/.test(pd)){
      var pm2 = nkRecMeters(prev), t2 = nkTimeOk(prev.time);
      if (pm2 && t2 && String(h.time) === t2){ h.prevD = String(pm2); h.timeSrc = h.timeSrc || 'prev'; changed = true; }
    }
  }
  if (!h.time){
    // 前走が今回と距離違い(-±200m超)の場合: 同じコース種別(洋芝=札幌/函館・野芝=他場)の
    // 同距離(±200m)で最速の持ちタイムを馬柱から採用する。洋芝/野芝の違いで時計が比較できないため
    // コース種別を揃えた上で評価できるようにする。
    try {
      if (typeof yoBestFromRecs === 'function' && typeof yoCourse === 'function' && curDist){
        var ctx = yoCourse();
        var b = yoBestFromRecs(runs, ctx);
        if (b && b.sec != null && b.tier && b.tier <= 3){
          h.time = yoFmt(b.sec);
          h.prevD = String(b.dist || '');
          h.timeSrc = (b.tier === 1 ? 'same-venue' : b.tier === 2 ? 'same-course' : 'same-dist');
          msg.push('同コース別走 ' + b.dist + 'm ' + h.time + (b.tier === 2 ? '（' + yoCourseLabel(yoIsYoso(b.venue)) + '）' : ''));
          changed = true;
        }
      }
    } catch(e){}
  }
  return { ok: changed, msg: msg };
}

/* =========================================================
   ★2026-09-13 第19弾③: 出馬表の出力時に「上3F・持ちタイム」を自動で埋め直す
   ---------------------------------------------------------
   症状: 出馬表を読み込み直す（日付指定・URL取込・テキスト貼り付け）と、
         一度入っていた 上3F と 持ちタイム が抜けて空欄になる。
   原因: ① 入れ替え(applyNkHorses)が last3rank / timeSrc など派生項目を引き継いでいなかった
         ② 前走の絞り込み基準日が「今日」になっていた（過去レースで空になる）
         ③ 上3F・持ちタイムは「🐎 戦績を反映」ボタンを押した時しか入らず、
            馬柱AI評価の自動取得（aihAutoRun）で馬柱が貯まっても再利用していなかった
   対策: ここ nkAutoFill() を出馬表の描画(rebuildHorseTable)から呼び、
         端末に already 貯まっている馬柱キャッシュだけを使って埋め直す（新規通信なし）。
   ========================================================= */
function nkAutoFill(force){
  if (typeof state === 'undefined' || !state.horses || !state.horses.length) return 0;
  // 埋める必要のある馬がいなければ、localStorage の展開すらしない（描画のたびに走るため）
  var need = state.horses.filter(function(h){ return h && h.nk && (!h.last3f || !h.time); });
  if (!need.length && !force) return 0;
  var ls = null;
  try { ls = nkLs() || {}; } catch(e){ return 0; }
  var hh = (ls && ls.h) || {};
  if (!hh || !Object.keys(hh).length) return 0;
  var curD8 = '';
  try { curD8 = nkTodayD8(); } catch(e){}
  var changed = 0;
  state.horses.forEach(function(h){
    if (!h || !h.nk) return;
    if (!force && h.last3f && h.time) return;
    var rec = hh[String(h.nk).trim()];
    if (!rec || !rec.recs || !rec.recs.length) return;
    var runs = nkRunsBefore(rec.recs, curD8, 5);
    if (!runs.length) return;
    var before = String(h.last3f || '') + '|' + String(h.time || '');
    try { nkApplyOne(h, runs); } catch(e){ return; }
    if (String(h.last3f || '') + '|' + String(h.time || '') !== before) changed++;
  });
  return changed;
}
/* 出遅れ率は「手入力」で運用するため、netkeibaからは自動計算・自動反映しない（#2026-09-10）。
   ここでは取得した戦績から数値を計算して返すだけ（表示用の参考値）。
   出馬表の「出遅れ率」欄には書き込みません（手入力値をそのまま尊重）。 */
function nkSlowApply(h, data){
  if (!data) return null;
  var st = data.slow || null;
  if (!st && typeof hdSlowStat === 'function') st = hdSlowStat(data.recs || []) || null;
  if (!st || !st.total) return null;
  return st;   // ※ h.slow 等への書き込みは行わない
}
/* 取得ログ。以前は毎回上書きしていたため「最後に処理した1頭」しか見えず、
   途中経過が分からなかった（他の馬の結果が出てこないように見えた）。追記式にする。 */
var nkLogLines = [];
function nkLogReset(){
  nkLogLines = [];
  nkLogRender();
}
function nkLogRender(){
  var e = $('nkLog'); if (!e) return;
  var tail = nkLogLines.slice(-80);
  e.innerHTML = (nkLogLines.length > tail.length ? '<div class="small muted">… 以前の ' + (nkLogLines.length - tail.length) + ' 行は省略 …</div>' : '') +
    tail.map(function(m){ return esc(m); }).join('<br>');
}
function nkLog3(msgs){
  (msgs || []).forEach(function(m){ nkLogLines.push(m); });
  nkLogRender();
}
/* 取得結果の一覧表（全馬ぶんを1枚の表で確認できるように）
   ★2026-09-13 第21弾③: 「前走距離」列が【持ちタイムの距離】を表示していて前走と食い違っていたため、
   「前走（日付・場・距離・着順）」と「持ちタイム（距離・出どころ）」を別の列に分けました。 */
function nkPrevText(r){
  if (!r || !r.prevM) return (r && r.prevDate8) ? esc(r.prevDate8) : '—';
  var d = String(r.prevDate8 || '');
  var dl = /^\d{8}$/.test(d) ? (d.slice(4,6) + '/' + d.slice(6,8)) : d;
  return esc((dl ? dl + ' ' : '') + (r.prevVenue || '') + ' ' + (r.prevSurf || '') + r.prevM + 'm' +
    (r.prevOrder ? ' ' + r.prevOrder + '着' : ''));
}
function nkTimeText(r){
  if (!r || !r.time) return '—';
  var src = { prev:'前走', 'same-venue':'同場', 'same-course':'同コース種別', 'same-dist':'同距離' }[r.timeSrc] || '';
  var dm = /^\d{3,4}$/.test(String(r.dist || '')) ? (r.dist + 'm') : '';
  return esc(r.time + ((dm || src) ? '（' + [dm, src].filter(function(x){ return x; }).join('・') + '）' : ''));
}
/* ★第21弾③: 取得結果の1行を作る（前走の実データと持ちタイムの出どころを分けて持つ） */
function nkSumRow(h, applied, note){
  return {
    no: (h && h.no) || '', name: (h && h.name) || '',
    last3f: (h && h.last3f) || '', last3rank: (h && h.last3rank) || 0,
    time: (applied && h) ? (h.time || '') : '', dist: (applied && h) ? (h.prevD || '') : '',
    timeSrc: (applied && h) ? (h.timeSrc || '') : '',
    prevM: (h && h.prevM) || 0, prevDate8: (h && h.prevDate8) || '', prevVenue: (h && h.prevVenue) || '',
    prevSurf: (h && h.prevSurf) || '', prevOrder: (h && h.prevOrder) || 0,
    applied: !!applied, note: note || ''
  };
}
function nkSummaryTable(rows){
  var e = $('nkLog'); if (!e) return;
  var ok = rows.filter(function(r){ return r.applied; }).length;
  var h = ['<div style="margin-top:8px;font-weight:bold">📋 取得結果（' + rows.length + '頭中 ' + ok + '頭に反映）</div>',
    '<div class="small muted" style="margin:2px 0">「前走」＝直近1走の実データ／「持ちタイム」＝AIが実力比較に使う時計（前走が距離違いのときは<b>同じコース種別・同距離の最速タイム</b>を採用するため、前走と距離が異なることがあります）</div>',
    '<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.76rem;white-space:nowrap">',
    '<thead><tr><th>馬番</th><th style="text-align:left">馬名</th><th style="text-align:left">前走（日付・場・距離・着順）</th><th>前走上3F</th><th style="text-align:left">持ちタイム（距離・出どころ）</th><th style="text-align:left">取得内容</th></tr></thead><tbody>'];
  rows.forEach(function(r){
    h.push('<tr><td style="text-align:center">' + esc(r.no || '') + '</td><td style="text-align:left">' + esc(r.name || '') + '</td>' +
      '<td style="text-align:left">' + nkPrevText(r) + '</td>' +
      '<td style="text-align:center">' + esc(r.last3f || '') + (r.last3rank ? '<span class="muted">(' + esc(String(r.last3rank)) + '位)</span>' : '') + '</td>' +
      '<td style="text-align:left">' + nkTimeText(r) + '</td>' +
      '<td style="text-align:left" class="muted">' + esc(r.note || '') + '</td></tr>');
  });
  h.push('</tbody></table></div>');
  e.innerHTML += h.join('');
}
function nkBusy3(b){
  var g = $('btnNkGo'); if (g) g.disabled = b;
  var r = $('btnNkReload'); if (r) r.disabled = b;
}
/* 失敗した馬の記録（「失敗した馬だけ再取得」用） */
var nkFailed = [];
/* 取得のリトライ: 中継(リレー)が一時的に失敗(タイムアウト/502/混雑)しても取り直す */
function nkFetchWithRetry(id, tries, opt){
  tries = tries || 2;
  var n = 0;
  function once(){
    n++;
    return nkFetchHorsePages(id, opt).then(function(d){ nkThrottleDown(); return d; }).catch(function(e){
      nkThrottleUp();
      if (n < tries) return new Promise(function(res){ setTimeout(res, 1200 * n); }).then(once);
      throw e;
    });
  }
  return once();
}
/* 馬1頭ずつの間隔。連続アクセスで中継(サーバーレス関数)やサイト側に
   弾かれる(429/502)ことがあり、その場合は「1頭目だけ成功して以降すべて失敗」に見える。
   失敗が続いたら自動で間隔を広げる（適応スロットル）。 */
var nkGapMs = 350;
function nkGap(){ return new Promise(function(res){ setTimeout(res, nkGapMs); }); }
function nkThrottleUp(){ nkGapMs = Math.min(2500, Math.round(nkGapMs * 2)); }
function nkThrottleDown(){ nkGapMs = Math.max(350, Math.round(nkGapMs * 0.8)); }
/* 失敗した馬だけを再取得 */
function nkRetryFailedRun(){
  if (!nkFailed.length){ return; }
  var ids = nkFailed.slice(); nkFailed = [];
  var targets = state.horses.filter(function(h){ return ids.indexOf(h.uid) >= 0; });
  nkLog3(['', '🔄 失敗した ' + targets.length + ' 頭を再取得します…']);
  var seq = Promise.resolve(), ok = 0, ng = 0;
  targets.forEach(function(h){
    seq = seq.then(function(){
      return nkGap().then(function(){ return nkFetchWithRetry(h.nk, 3, { only:'recs' }); }).then(function(data){
        var runs = nkRunsBefore(data.recs, nkTodayD8(), 5);
        if (!runs.length){ ok++; nkLog3(['　' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': 戦績なし']); return; }
        return nkResolveRid(runs[0]).then(function(rid){ if (rid){ runs[0].rid = rid; return nkRankOfLast3(rid, runs[0].last3).then(function(r){ runs[0].rank = r || 0; }); } })
          .catch(function(){}).then(function(){
            var res = nkApplyOne(h, runs);
            if (res.ok){ ok++; nkLog3(['　' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': ' + (res.msg.join(' / ') || '前走データは条件外')]); }
            else { ng++; nkLog3(['　' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': 反映できる前走データなし']); }
          });
      }).catch(function(e){
        ng++; nkFailed.push(h.uid);
        nkLog3(['　⚠ ' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': ' + ((e && e.message) || e)]);
      });
    });
  });
  seq.then(function(){
    if (typeof rebuildHorseTable === 'function') rebuildHorseTable();
    if (typeof saveNow === 'function') saveNow();
    nkLog3(['🔄 再取得 完了: 反映 ' + ok + '頭' + (ng ? '／まだ失敗 ' + ng + '頭' : '') + '。']);
    if (nkFailed.length){
      var e = $('nkLog');
      if (e) e.innerHTML += '<div style="margin-top:6px"><button type="button" class="btn ghost" id="nkRetryBtn">🔄 失敗した馬だけ再取得（' + nkFailed.length + '頭）</button></div>';
    }
  });
}
/* 全馬一括 */
/* ★2026-09-13 第20弾: 自動マクロ(p59)から連鎖で呼べるように Promise を返すようにしました。
   戻り値 { ok: 反映頭数, fail: 対象外/失敗, skip?: true } */
function nkFetchAll(){
  if (typeof state === 'undefined' || !state.horses || !state.horses.length){
    nkLog3(['⚠ 出馬表がありません。先に ① で netkeiba 出馬表URL を取込んでください。']);
    return Promise.resolve({ ok:0, fail:0, skip:true });
  }
  var target = state.horses.filter(function(h){ return h.nk; });
  if (!target.length){
    nkLog3(['⚠ どの馬にも netkeiba競走馬ID がありません。🔗「netkeiba URLから直接取込」で出馬表を読み込んでください。']);
    return Promise.resolve({ ok:0, fail:0, skip:true });
  }
  nkBusy3(true);
  nkLogReset();
  nkLog3(['netkeiba から ' + target.length + ' 頭の戦績を取得します（1頭あたり1〜3秒・初回のみ）。']);
  var ok = 0, fail = 0;
  var summary = [];
  var noNk = state.horses.filter(function(h){ return !h.nk; });
  nkFailed = [];
  if (noNk.length){
    nkLog3(['⚠ netkeiba競走馬IDが無い馬が ' + noNk.length + ' 頭あります（' +
      noNk.map(function(h){ return (h.no ? h.no + '番' : '') + (h.name || '?'); }).join('、') +
      '）。この馬は戦績を取得できません。①の「netkeiba URLから直接取込」で出馬表を読み込み直すとIDが付きます。']);
  }
  var seq = Promise.resolve();
  target.forEach(function(h){
    seq = seq.then(function(){
      return nkGap().then(function(){ return nkFetchWithRetry(h.nk, 2, { only:'recs' }); }).then(function(data){   // 一括は戦績ページのみ（プロフィールは馬情報を開いた時）
        // ※出遅れ率は手入力のため、ここでは計算・表示しない
        var runs = nkRunsBefore(data.recs, nkTodayD8(), 5);
        if (!runs.length){
          ok++;
          nkLog3(['　' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': 戦績なし']);
          summary.push(nkSumRow(h, true, '戦績なし（反映できる前走データなし）'));
          return;
        }
        return nkResolveRid(runs[0]).then(function(rid){
          if (!rid) return;
          runs[0].rid = rid || '';
          return nkRankOfLast3(rid, runs[0].last3).then(function(r){ runs[0].rank = r || 0; });
        }).catch(function(){}).then(function(){
          var res = nkApplyOne(h, runs);
          if (res.ok){
            ok++;
            var line = (res.msg.length ? res.msg.join(' / ') : '前走データは条件外');
            nkLog3(['　' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': ' + line]);
            summary.push(nkSumRow(h, true, line));
          } else {
            fail++;
            nkLog3(['　' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': 反映できる前走データなし（戦績なし/距離条件外 等）']);
            summary.push(nkSumRow(h, false, '反映できる前走データなし（距離条件外など）'));
          }
        });
      }).catch(function(e){
        fail++;
        var em = (e && e.message) || String(e);
        nkLog3(['　⚠ ' + (h.no ? h.no + '番 ' : '') + (h.name || h.nk) + ': ' + em +
          '（アクセス間隔を ' + nkGapMs + 'ms に広げています。失敗した馬は下の「🔄 失敗した馬だけ再取得」でやり直せます）']);
        summary.push(nkSumRow(h, false, '取得失敗: ' + em));
        nkFailed.push(h.uid);
      });
    });
  });
  return seq.then(function(){
    if (typeof rebuildHorseTable === 'function') rebuildHorseTable();
    if (typeof saveNow === 'function') saveNow();
    nkLog3(['✅ 完了: ' + ok + '頭に前走データを反映' + (fail ? '（対象外/失敗 ' + fail + '）' : '') + '。',
      '　（取得ログは上に追記されています。下の表で全馬ぶんの結果を確認できます）']);
    // 馬番順に並べて全馬の結果を1枚の表にまとめる
    summary.sort(function(a, b){ return (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0); });
    nkSummaryTable(summary);
    if (nkFailed.length){
      var e2 = $('nkLog');
      if (e2) e2.innerHTML += '<div style="margin-top:6px"><button type="button" class="btn ghost" id="nkRetryBtn">🔄 失敗した馬だけ再取得（' + nkFailed.length + '頭）</button>' +
        '<span class="small muted"> 一度だけ自動でリトライ済みです。それでも失敗する場合は中継(リレー)の診断（🔧）をご確認ください。</span></div>';
    }
    nkBusy3(false);
    return { ok: ok, fail: fail };
  }).catch(function(e){
    nkLog3(['⚠ ' + ((e && e.message) || e)]);
    nkBusy3(false);
    return { ok: ok, fail: fail, err: String((e && e.message) || e) };
  });
}
function nkClearCache(){
  try { localStorage.removeItem(NK_LS); } catch(e){}
  nkLog3(['netkeiba 馬データのキャッシュを消去しました。']);
}
function initNk(){
  var go = $('btnNkGo');
  if (go) go.addEventListener('click', nkFetchAll);
  document.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.id === 'nkRetryBtn'){ e.preventDefault(); nkRetryFailedRun(); }
  });
  var cl = $('btnNkReload');
  if (cl) cl.addEventListener('click', nkClearCache);
}
