/* ============================================================
   p64_jockeyui.js — ★2026-09-13 第25弾②: 🏇 騎手・調教師DB タブのUI
   ------------------------------------------------------------
   p63_jockeydb.js の取得・パース・キャッシュを使って、
   「検索して引く → 成績を見る」をできるようにします。
   参照サイト（keibalab.jp/db/）風の、情報を詰め込んだ表表示にしています。
   ============================================================ */

var JDB_MAX_PAGE = 12;          // リーディング一覧の取得ページ数上限（1ページ30名＝最大360名）

function jdbKind(){ var e = $('jdbKind'); return (e && e.value === 'trainer') ? 'trainer' : 'jockey'; }
function jdbStat(html){ var e = $('jdbStat'); if (e) e.innerHTML = html || ''; }
function jdbProg(html){ var e = $('jdbProg'); if (e) e.innerHTML = html || ''; }

/* 登録簿・キャッシュの状況を表示 */
function jdbRefreshStat(){
  try {
    var nj = klRegCount('jockey'), nt = klRegCount('trainer');
    var reg = klRegLoad();
    var at = reg && reg.at ? new Date(reg.at) : null;
    jdbStat('登録簿: <b>騎手 ' + nj + '名</b> / <b>調教師 ' + nt + '名</b>' +
      (at ? '<span class="muted">（最終取得 ' + at.toLocaleString('ja-JP') + '）</span>' : '<span class="warn">（未取得）</span>'));
  } catch(e){}
}

/* ---- 一覧取得（登録簿を作る） ---- */
function jdbBuildRegistry(){
  var kind = jdbKind();
  jdbProg('⏳ ' + (kind === 'trainer' ? '調教師' : '騎手') + 'リーディングを取得中…');
  klBuildRegistry(kind, JDB_MAX_PAGE, function(done, pages, got){
    jdbProg('⏳ ' + done + ' / ' + pages + ' ページ目…（' + got + '件登録）');
  }).then(function(r){
    jdbProg('✅ 完了: ' + (r.added || 0) + '件を追加登録（合計 ' + (r.total || 0) + '件）');
    jdbRefreshStat();
    jdbSearch();
  }).catch(function(e){
    jdbProg('<span class="warn">❌ 取得失敗: ' + esc(String(e && e.message || e)) + '</span>');
  });
}

/* ---- 検索 ---- */
function jdbSearch(){
  var kind = jdbKind();
  var q = klStr(($('jdbQuery') || {}).value || '');
  var reg = klRegLoad();
  var bag = (reg && reg[kind]) || {};
  var keys = Object.keys(bag);
  var qk = klNameKey(q);
  var hits = [];
  keys.forEach(function(k){
    var e = bag[k];
    if (!e) return;
    if (!qk || k.indexOf(qk) >= 0 || klNameKey(e.name || '').indexOf(qk) >= 0) hits.push(e);
  });
  /* 順位順（無ければ勝率順） */
  hits.sort(function(a, b){
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return (b.w1 || 0) - (a.w1 || 0);
  });
  var card = $('jdbListCard');
  if (card) card.style.display = '';
  var box = $('jdbList');
  var cnt = $('jdbListCount');
  if (cnt) cnt.textContent = hits.length + ' 件' + (q ? '（「' + q + '」）' : '（全件）');
  if (!box) return;
  if (!hits.length){
    box.innerHTML = '<div class="muted">' + (keys.length
      ? '該当なし。' : '<b>登録簿がまだ空です。</b>上の「📥 一覧を取得して登録簿を作る」を押してください。') + '</div>';
    return;
  }
  var top3 = $('jdbTop3Only') && $('jdbTop3Only').checked;
  var show = top3 ? hits.slice(0, 3) : hits.slice(0, 100);
  box.innerHTML = '<div style="overflow-x:auto"><table class="grid"><thead><tr>' +
    '<th>位</th><th>名前</th><th>所属</th><th>1着</th><th>2着</th><th>3着</th><th>着外</th><th>騎乗</th>' +
    '<th>勝率</th><th>連対率</th><th>複勝率</th><th>賞金(万)</th><th></th></tr></thead><tbody>' +
    show.map(function(e){
      return '<tr>' +
        '<td>' + (e.rank ? e.rank : '-') + '</td>' +
        '<td style="white-space:nowrap"><b>' + esc(e.name || '') + '</b>' +
          '<span class="muted small"> ' + esc(klId(e.id)) + '</span></td>' +
        '<td class="small">' + esc(e.branch || '') + '</td>' +
        '<td>' + (e.w1 != null ? e.w1 : '-') + '</td><td>' + (e.w2 != null ? e.w2 : '-') + '</td>' +
        '<td>' + (e.w3 != null ? e.w3 : '-') + '</td><td>' + (e.out != null ? e.out : '-') + '</td>' +
        '<td>' + (e.rides != null ? e.rides : '-') + '</td>' +
        '<td>' + (e.winRate != null ? e.winRate : '-') + '</td>' +
        '<td>' + (e.placeRate != null ? e.placeRate : '-') + '</td>' +
        '<td>' + (e.showRate != null ? e.showRate : '-') + '</td>' +
        '<td>' + (e.money != null ? Math.round(e.money).toLocaleString('ja-JP') : '-') + '</td>' +
        '<td><button class="btn small" data-jdb="' + esc(e.id) + '" data-kind="' + kind + '">詳細</button></td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>' +
    (top3 ? '' : (hits.length > show.length ? '<div class="muted small">上位 ' + show.length + ' 件を表示（全 ' + hits.length + ' 件）</div>' : ''));
}

/* ---- 成績テーブルの描画 ---- */
function jdbRecTable(rec, caption){
  if (!rec) return '';
  var rows = ['平地','障害','全レース'].filter(function(k){ return rec[k]; }).map(function(k){
    var r = rec[k];
    return '<tr><th>' + k + '</th>' +
      ['w1','w2','w3','out','rides','winRate','placeRate','showRate'].map(function(f){
        var v = r[f];
        return '<td' + (f === 'winRate' && v != null && v >= 12 ? ' style="color:var(--ok-ink);font-weight:700"' : '') + '>' +
          (v != null ? (f === 'rides' || f === 'out' ? Math.round(v).toLocaleString('ja-JP') : v) : '-') + '</td>';
      }).join('') + '</tr>';
  });
  if (!rows.length) return '';
  return '<div style="overflow-x:auto"><table class="grid"><thead><tr><th>' + esc(caption) + '</th>' +
    '<th>1着</th><th>2着</th><th>3着</th><th>着外</th><th>騎乗</th><th>勝率%</th><th>連対率%</th><th>3着内率%</th>' +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}

/* ★2026-09-13 第26弾④: 名前を指定して 🏇DBタブを開き、その人の詳細を表示する。
   出馬表の騎手名横の 🏇 ボタンから呼ばれます。
   登録簿に名前が無ければ「未取得」を案内し、登録簿の取得を促します（勝手に大量通信しない）。 */
function jdbOpenByName(name, kind){
  kind = (kind === 'trainer') ? 'trainer' : 'jockey';
  try { if (typeof goTab === 'function') goTab('t-jockeydb'); } catch(e){}
  var kEl = $('jdbKind'); if (kEl) kEl.value = kind;
  var qEl = $('jdbQuery'); if (qEl) qEl.value = klStr(name);
  jdbRefreshStat();
  jdbSearch();
  var id = klFindId(name, kind);
  if (!id){
    var box = $('jdbDetail'), card = $('jdbDetailCard');
    if (card) card.style.display = '';
    if (box) box.innerHTML = '<div class="warn">「' + esc(klStr(name)) + '」が<b>登録簿に見つかりません</b>。<br>' +
      '上の <b>「📥 一覧を取得して登録簿を作る」</b> を一度押すと、' + (kind === 'trainer' ? '調教師' : '騎手') + 'の名前→IDが登録され、' +
      '以降はいつでもタップだけで開けます（登録簿は7日もちます・自動削除されません）。</div>';
    return;
  }
  /* キャッシュがあれば即表示（通信しない）／無ければ取得 */
  var cached = klEntGet(kind, id);
  jdbOpenDetail(id, kind, !cached);
}

/* ---- 詳細表示 ---- */
function jdbShowDetail(d, kind){
  var card = $('jdbDetailCard'), box = $('jdbDetail');
  if (!box) return;
  if (card) card.style.display = '';
  if (!d){ box.innerHTML = '<div class="warn">詳細を取得できませんでした（登録簿に名前が無い可能性があります）。</div>'; return; }
  var form = klFormOf(d);
  var ab = d.ability || { courses: [], baba: [], cond: [], time: [] };
  var b = d.basic || {};
  var h = '';
  h += '<div class="row" style="align-items:baseline;gap:8px;flex-wrap:wrap">' +
    '<h3 style="margin:0">' + esc(d.name || '') + '</h3>' +
    (d.yomi ? '<span class="muted small">' + esc(d.yomi) + '</span>' : '') +
    '<span class="muted small">' + (kind === 'trainer' ? '調教師' : '騎手') + ' ' + esc(klId(d.id)) + '</span>' +
    (form.label ? '<span class="chip' + (/好調|絶好調/.test(form.label) ? ' ok' : /不調/.test(form.label) ? ' warn' : '') + '">' +
      esc(form.label) + (form.ratio != null ? '（本年÷累計 ' + form.ratio.toFixed(2) + '）' : '') + '</span>' : '') +
    '</div>';
  /* 調子の根拠 */
  if (form.todayRuns > 0){
    h += '<div class="muted small" style="margin-top:2px">今週の騎乗: <b>' + form.todayRuns + '戦' + form.todayWins + '勝</b>' +
      '（勝率 ' + (form.todayRate * 100).toFixed(1) + '%）</div>';
  }
  /* 基本情報 */
  var kv = [];
  if (b['生年月日']) kv.push(['生年月日', b['生年月日']]);
  if (b['初免許年']) kv.push(['初免許年', b['初免許年']]);
  if (b['所属']) kv.push(['所属', b['所属']]);
  if (b['所属厩舎']) kv.push(['所属厩舎', b['所属厩舎']]);
  if (b['平地初勝利']) kv.push(['平地初勝利', b['平地初勝利']]);
  if (kv.length){
    h += '<table class="grid" style="margin-top:8px"><tbody>' + kv.map(function(x){
      return '<tr><th style="white-space:nowrap">' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  /* イチ推しアビリティ */
  if ((d.abilityItems || []).length){
    h += '<div style="margin-top:8px"><b>⭐ イチ推しアビリティ</b><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">' +
      (ab.courses || []).map(function(c){ return '<span class="chip ok">' + esc(c.text) + '</span>'; }).join('') +
      (ab.baba || []).map(function(x){ return '<span class="chip">' + esc(x.text) + '</span>'; }).join('') +
      (ab.cond || []).map(function(x){ return '<span class="chip">' + esc(x) + '</span>'; }).join('') +
      (ab.time || []).map(function(x){ return '<span class="chip">' + esc(x) + '</span>'; }).join('') +
      (ab.unknown || []).map(function(x){ return '<span class="chip muted">' + esc(x) + '</span>'; }).join('') +
      '</div></div>';
  }
  /* 成績 */
  h += '<div style="margin-top:10px">' + jdbRecTable(d.thisYear, '本年成績') + '</div>';
  h += '<div style="margin-top:6px">' + jdbRecTable(d.career, '累計成績') + '</div>';
  /* 年度別×着順別のリンク */
  var yr = new Date().getFullYear();
  h += '<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">' +
    '<span class="muted small">年度別×着順別の履歴:</span>' +
    [yr, yr - 1, yr - 2].map(function(y){
      return '<span class="small"><b>' + y + '年</b> ' +
        [['全',''],['1着',1],['2着',2],['3着',3],['着外',4]].map(function(a){
          return '<a href="' + esc(klHistoryUrl(kind, d.id, y, a[1] || null)) + '" target="_blank" rel="noopener">' + a[0] + '</a>';
        }).join(' / ') + '</span>';
    }).join('<span class="muted">｜</span>') +
    '</div>';
  /* 今週の騎乗馬 */
  if ((d.weekly || []).length){
    h += '<div style="margin-top:10px"><b>📅 今週の騎乗馬</b>' + d.weekly.map(function(day){
      return '<div class="muted small" style="margin-top:4px">' + esc(day.y + '年' + day.mo + '月' + day.d + '日') +
        (day.kai ? ' ' + esc(day.kai + '回' + (day.venue || '') + day.dayNo + '日目') : '') +
        ' <b>' + (day.runs || 0) + '戦' + (day.wins || 0) + '勝</b></div>' +
        (day.races && day.races.length ? '<div style="overflow-x:auto"><table class="grid"><thead><tr>' +
          '<th>場</th><th>R</th><th>レース名</th><th>コース</th><th>人</th><th>着</th><th>馬名</th><th>斤量</th><th>厩舎</th><th>コンビ</th><th>間隔</th>' +
          '</tr></thead><tbody>' + day.races.map(function(r){
            return '<tr><td>' + esc(r.venue || '') + '</td><td>' + (r.rnum || '-') + '</td>' +
              '<td style="white-space:nowrap">' + (r.raceId
                ? '<a href="' + esc('https://www.keibalab.jp/db/race/' + r.raceId + '/') + '" target="_blank" rel="noopener">' + esc(r.raceName || '') + '</a>'
                : esc(r.raceName || '')) + '</td>' +
              '<td>' + esc(r.course || '') + '</td><td>' + (r.pop != null ? r.pop : '') + '</td>' +
              '<td' + (r.rank === 1 ? ' style="color:var(--ok-ink);font-weight:700"' : '') + '>' + (r.rank != null ? r.rank : '') + '</td>' +
              '<td style="white-space:nowrap">' + esc(r.horseName || '') + '</td>' +
              '<td>' + (r.weight != null ? r.weight : '') + '</td><td class="small">' + esc(r.trainer || '') + '</td>' +
              '<td class="small">' + esc(r.combo || '') + '</td><td class="small">' + esc(r.interval || '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '');
    }).join('') + '</div>';
  }
  box.innerHTML = h;
}
function jdbOpenDetail(id, kind, force){
  id = klId(id);
  var box = $('jdbDetail');
  if (box){ box.innerHTML = '<div class="muted">⏳ 取得中… ' + esc(id) + '</div>'; }
  var card = $('jdbDetailCard'); if (card) card.style.display = '';
  klFetchDetail(kind, id, !!force).then(function(d){
    jdbShowDetail(d, kind);
  }).catch(function(e){
    if (box) box.innerHTML = '<div class="warn">❌ 取得失敗: ' + esc(String(e && e.message || e)) + '</div>';
  });
}

/* ---- 今日の出走表の騎手・調教師を一括取得（③ファクター用） ---- */
function jdbRaceTargets(){
  var out = [];
  try {
    (state.horses || []).forEach(function(h){
      if (!h) return;
      var j = klStr(h.jockey || h.rider || '');
      if (j) out.push({ kind: 'jockey', name: j, horse: klStr(h.name) });
      var t = klStr(h.trainer || '');
      if (t) out.push({ kind: 'trainer', name: t.replace(/^[\[［][^】\]]*[】\]]/, ''), horse: klStr(h.name) });
    });
  } catch(e){}
  /* 名前ごとに1件に集約 */
  var seen = {}, res = [];
  out.forEach(function(x){
    var k = x.kind + '|' + klNameKey(x.name);
    if (!k || seen[k]) return;
    seen[k] = 1; res.push(x);
  });
  return res;
}
function jdbFetchForRace(){
  var kind = jdbKind();
  var box = $('jdbRaceStat'), tbl = $('jdbRaceTable');
  var tg = jdbRaceTargets().filter(function(x){ return x.kind === kind; });
  if (!tg.length){
    if (box) box.innerHTML = '<span class="warn">現在の出馬表に' + (kind === 'trainer' ? '調教師' : '騎手') + '名が見つかりません。</span>';
    return;
  }
  if (box) box.innerHTML = '⏳ 0 / ' + tg.length + ' 件…';
  var done = 0, okc = 0, miss = [], rows = [];
  function next(i){
    if (i >= tg.length){
      if (box) box.innerHTML = '✅ ' + okc + ' / ' + tg.length + ' 件を取得' +
        (miss.length ? '（<span class="warn">未登録: ' + esc(miss.join(', ')) + '</span>）' : '');
      if (tbl) tbl.innerHTML = rows.length ? '<div style="overflow-x:auto"><table class="grid"><thead><tr>' +
        '<th>' + (kind === 'trainer' ? '調教師' : '騎手') + '</th><th>ID</th><th>調子</th><th>本年勝率</th><th>累計勝率</th>' +
        '<th>本年3着内率</th><th>今週</th><th>得意コース</th><th>今回の条件との一致</th></tr></thead><tbody>' +
        rows.join('') + '</tbody></table></div>' : '';
      return;
    }
    var t = tg[i];
    var id = klFindId(t.name, kind);
    if (!id){ miss.push(t.name); done++; next(i + 1); return; }
    klFetchDetail(kind, id, false).then(function(d){
      done++;
      if (d && !d.err){
        okc++;
        var f = klFormOf(d);
        var am = klAbilityMatch(d, {
          venue: (state.race || {}).place, surface: /ダ/.test(String((state.race || {}).baba || '')) ? '' : '芝',
          dist: parseInt((state.race || {}).dist || 0, 10), baba: (state.race || {}).baba,
          rnum: parseInt((String((state.race || {}).name || '').match(/(\d{1,2})R/) || [])[1] || 0, 10),
          heads: (state.horses || []).length
        });
        var ty = d.thisYear && d.thisYear['全レース'], ca = d.career && d.career['全レース'];
        rows.push('<tr><td style="white-space:nowrap"><b>' + esc(d.name || t.name) + '</b></td>' +
          '<td class="muted small">' + esc(id) + '</td>' +
          '<td' + (/好調/.test(f.label) ? ' style="color:var(--ok-ink);font-weight:700"' : /不調/.test(f.label) ? ' style="color:var(--warn-ink)"' : '') + '>' +
            esc(f.label || '-') + '</td>' +
          '<td>' + (ty && ty.winRate != null ? ty.winRate : '-') + '</td>' +
          '<td>' + (ca && ca.winRate != null ? ca.winRate : '-') + '</td>' +
          '<td>' + (ty && ty.showRate != null ? ty.showRate : '-') + '</td>' +
          '<td class="small">' + (f.todayRuns ? f.todayRuns + '戦' + f.todayWins + '勝' : '-') + '</td>' +
          '<td class="small">' + esc(((d.ability || {}).courses || []).map(function(c){ return c.text; }).join(' / ') || '-') + '</td>' +
          '<td class="small">' + esc((am.notes || []).join('・') || '一致なし') + '</td></tr>');
      } else { miss.push(t.name); }
      if (box) box.innerHTML = '⏳ ' + done + ' / ' + tg.length + ' 件…';
      next(i + 1);
    }).catch(function(){ done++; miss.push(t.name); if (box) box.innerHTML = '⏳ ' + done + ' / ' + tg.length + ' 件…'; next(i + 1); });
  }
  next(0);
}

/* ---- 配線 ---- */
function jockeyDbInit(){
  var btn;
  if ((btn = $('jdbBuild'))) btn.addEventListener('click', function(){ jdbBuildRegistry(); });
  if ((btn = $('jdbSearch'))) btn.addEventListener('click', function(){ jdbSearch(); });
  if ((btn = $('jdbFetchRace'))) btn.addEventListener('click', function(){ jdbFetchForRace(); });
  if ((btn = $('jdbDropCache'))) btn.addEventListener('click', function(){
    if (!confirm('成績キャッシュを消しますか？（登録簿は残ります）')) return;
    klEntDrop(); jdbProg('🗑 成績キャッシュを消しました');
  });
  if ((btn = $('jdbDropReg'))) btn.addEventListener('click', function(){
    if (!confirm('名前→ID の登録簿を消しますか？')) return;
    klRegDrop(); jdbRefreshStat(); jdbSearch(); jdbProg('🗑 登録簿を消しました');
  });
  var q = $('jdbQuery');
  if (q) q.addEventListener('keydown', function(e){ if (e.key === 'Enter') jdbSearch(); });
  var kd = $('jdbKind');
  if (kd) kd.addEventListener('change', function(){ jdbRefreshStat(); jdbSearch(); });
  var t3 = $('jdbTop3Only');
  if (t3) t3.addEventListener('change', function(){ jdbSearch(); });
  /* 一覧の「詳細」ボタン（イベント委譲） */
  var list = $('jdbList');
  if (list) list.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-jdb]');
    if (!b) return;
    jdbOpenDetail(b.getAttribute('data-jdb'), b.getAttribute('data-kind') || jdbKind(), false);
  });
  jdbRefreshStat();
}
/* タブを開いたときに状況を更新 */
function jockeyDbOnShow(){ try { jdbRefreshStat(); } catch(e){} }
