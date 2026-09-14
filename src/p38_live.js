/* =========================================================
   38 ライブ情報（出馬表タブ内の3サブタブ + 自動更新）
   ---------------------------------------------------------
   出馬表 / オッズ / 結果・払戻 を race.sp 風に切り替え。
   - オッズ: netkeiba 単勝JSON(リレー不要)でリアルタイム取得 → 表へ反映
   - 結果・払戻: race.netkeiba 結果ページ(要: 中継or直接OK環境)から
     全着順＋払戻を取得。自動更新ONなら 30/60/120秒ごとにチェックし、
     競走中止・オッズ変化・結果確定(払戻)を通知します。
   ========================================================= */

var lvState = {
  tab: 'shutuba',
  auto: false,
  intMs: 60000,
  timer: null,
  oddsAt: 0,
  prevOdds: {},      // no -> odds（1回前）
  rid: '',
  fin: null,         // null=未確認 / true=確定 / false=未確定
  lastResTry: 0,
  busy: false
};

/* --- 小道具 --- */
function lvRid(){
  var r = (typeof state !== 'undefined' && state.raceId) ? state.raceId : '';
  if (!r && typeof nkExtractRaceId === 'function' && $('urlImport')) r = nkExtractRaceId($('urlImport').value || '');
  return r || '';
}
function lvMsgTxt(s, err){
  var el = $('lvMsg');
  if (el){ el.textContent = s || ''; el.style.color = err ? '#a3442f' : '#33513f'; }
}
function lvClockNow(){
  var el = $('lvClock');
  if (el) el.textContent = '最終更新: ' + (new Date()).toLocaleTimeString('ja-JP');
}
function lvNote(id, s, err){
  var el = $(id);
  if (el){ el.innerHTML = s || ''; }
}

/* --- サブタブ切替 --- */
function lvSwitch(tab){
  lvState.tab = tab;
  var order = ['shutuba', 'odds', 'result'];
  order.forEach(function(t){
    var sec = $('live-' + t);
    if (sec) sec.classList.toggle('hid', t !== tab);
  });
  var btns = document.querySelectorAll && document.querySelectorAll('.lsbtn[data-lt]');
  if (btns && btns.forEach) btns.forEach(function(b){
    b.classList.toggle('ls-a', b.getAttribute('data-lt') === tab);
  });
  if (tab === 'odds') lvRefreshOdds(true);
  else if (tab === 'result') lvRefreshResult(true);
}

/* ================= オッズ ================= */
function lvRefreshOdds(force){
  var rid = lvRid();
  if (!rid){
    if (force) lvNote('lvOddsMsg', '<span class="small" style="color:var(--err-ink)">レースIDがありません。「🔗 netkeiba URLから直接取込」で出馬表を読み込んでください。</span>');
    return;
  }
  lvState.rid = rid;
  if (typeof nkFetchOddsAny !== 'function'){ lvNote('lvOddsMsg', 'オッズ取得関数がありません。'); return; }
  var noteEl = $('lvOddsMsg');
  if (noteEl) noteEl.innerHTML = '<span class="small muted">オッズを取得中…</span>';
  var t0 = Date.now();
  return nkFetchOddsAny(rid).then(function(payload){
    var p = (typeof nkParseOddsData === 'function') ? nkParseOddsData(payload) : { odds: [] };
    var list = p.odds || [];
    if (!list.length){
      lvNote('lvOddsMsg', '<span class="small" style="color:var(--err-ink)">単勝オッズがまだ取得できません（発走前の締切後や非売出し中など）。少し待って「🔄 手動で更新」を押してください。</span>');
      var ch = $('lvOddsChip'); if (ch) ch.textContent = '空(発走前など)';
      lvClockNow();
      return;
    }
    var delta = lvState.prevOdds && Object.keys(lvState.prevOdds).length ? lvState.prevOdds : null;
    // 1回前として保存
    lvState.prevOdds = {};
    list.forEach(function(o){ lvState.prevOdds[o.no] = o.odds; });
    lvRenderOdds(list, delta);
    lvNote('lvOddsMsg', '<span class="small muted">' + (Date.now() - t0) + 'ms ・ ' + list.length + '頭分を取得しました。表は人気順。</span>');
    var ch2 = $('lvOddsChip'); if (ch2) ch2.textContent = '更新 ' + new Date().toLocaleTimeString('ja-JP');
    lvClockNow();
    // 出馬表の「単勝」欄へ反映(行を再構築せず value のみ更新 → 編集中も安全)
    var changed = lvWriteCells(list);
    if (changed) lvMsgTxt('🔄 単勝オッズを ' + changed + ' 頭分更新しました。');
  }).catch(function(e){
    lvNote('lvOddsMsg', '<span class="small" style="color:var(--err-ink)">オッズ取得に失敗: ' + esc((e && e.message) || e) + '</span>');
  });
}
/* 馬番ごとに状態更新＋行セルへ反映。更新した頭数を返す */
function lvWriteCells(list){
  var changed = 0;
  if (typeof state === 'undefined' || !state.horses) return 0;
  state.horses.forEach(function(h){
    for (var j = 0; j < list.length; j++){
      if (String(h.no) === String(list[j].no)){
        var val = String(list[j].odds);
        if (String(h.odds || '') !== val){ h.odds = val; changed++; }
        break;
      }
    }
  });
  if (changed && typeof saveNow === 'function') saveNow();
  // DOM側セルを直接更新（行を再構築しない → 編集中のセルも安全）
  var tb = $('horseBody');
  if (!tb || !tb.querySelectorAll) return changed;
  var rows = tb.querySelectorAll('tr[data-uid]');
  for (var i = 0; i < rows.length; i++){
    var tr = rows[i];
    var noEl = tr.querySelector && tr.querySelector('input[data-f="no"]');
    var odEl = tr.querySelector && tr.querySelector('input[data-f="odds"]');
    if (!noEl || !odEl) continue;
    var no = String(noEl.value || '').trim();
    for (var j = 0; j < list.length; j++){
      if (String(list[j].no) === no){
        if (String(odEl.value || '').trim() !== String(list[j].odds)) odEl.value = list[j].odds;
        break;
      }
    }
  }
  return changed;
}
function lvRenderOdds(list, prev){
  var body = $('lvOddsBody');
  if (!body) return;
  var sorted = list.slice().sort(function(a, b){ return (a.ninki || 99) - (b.ninki || 99) || a.no - b.no; });
  var h = [];
  sorted.forEach(function(o, i){
    var d = (prev && prev[o.no] != null) ? (o.odds - prev[o.no]) : null;
    var dTxt = '−';
    var cls = 'muted';
    if (d != null && Math.abs(d) > 0.04){
      if (d > 0){ dTxt = '↑+' + d.toFixed(1); cls = 'lv-up'; }
      else { dTxt = '↓' + Math.abs(d).toFixed(1); cls = 'lv-down'; }
    }
    h.push('<tr><td>' + (i + 1) + '人気</td><td><b>' + o.no + '</b></td><td>' + esc(lvHorseName(o.no)) + '</td>' +
      '<td><b>' + o.odds.toFixed(1) + '</b></td><td class="' + cls + '">' + dTxt + '</td>' +
      '<td>' + (o.ninki ? o.ninki + '人気' : '−') + '</td></tr>');
  });
  body.innerHTML = h.join('');
}
function lvHorseName(no){
  try {
    if (typeof state !== 'undefined' && state.horses){
      for (var i = 0; i < state.horses.length; i++){
        if (String(state.horses[i].no) === String(no)) return state.horses[i].name || '';
      }
    }
  } catch(e){}
  return '';
}

/* ================= 結果・払戻 ================= */
function lvParseGroups(seg){
  // 券種行の Result セル内を <ul>/<div> の切れ目でグループ化して数字を取り出す
  var groups = [];
  var parts = String(seg || '').split(/<\/(?:ul|div)>/);
  parts.forEach(function(pt){
    var nums = [];
    var sps = pt.match(/<span[^>]*>[\s\S]*?<\/span>/g) || [];
    for (var i = 0; i < sps.length; i++){
      var t = sps[i].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (t) nums.push(t);
    }
    if (nums.length) groups.push(nums);
  });
  return groups;
}
function lvParsePayouts(html){
  var out = [];
  var names = { Tansho:'単勝', Fukusho:'複勝', Wakuren:'枠連', Umaren:'馬連', Wide:'ワイド', Umatan:'馬単', Fuku3:'3連複', Tan3:'3連単' };
  var rows = String(html).match(/<tr[^>]*class="(Tansho|Fukusho|Wakuren|Umaren|Wide|Umatan|Fuku3|Tan3)"[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (var i = 0; i < rows.length; i++){
    var tr = rows[i];
    var cm = tr.match(/class="(Tansho|Fukusho|Wakuren|Umaren|Wide|Umatan|Fuku3|Tan3)"/);
    if (!cm) continue;
    var resM = tr.match(/<td class="Result">([\s\S]*?)<\/td>/i);
    var payM = tr.match(/<td class="Payout">([\s\S]*?)<\/td>/i);
    var nkM = tr.match(/<td class="Ninki">([\s\S]*?)<\/td>/i);
    var groups = resM ? lvParseGroups(resM[1]) : [];
    var pays = [];
    if (payM){
      var ps = payM[1].match(/(\d[\d,]*)円/g) || [];
      for (var q = 0; q < ps.length; q++) pays.push(ps[q]);
    }
    var nks = [];
    if (nkM){
      var ks = nkM[1].match(/<span[^>]*>([\s\S]*?)<\/span>/g) || [];
      for (var w = 0; w < ks.length; w++){
        var t = ks[w].replace(/<[^>]*>/g, '').trim();
        if (t) nks.push(t);
      }
    }
    out.push({ name: names[cm[1]], groups: groups, pays: pays, nks: nks });
  }
  return out;
}
function lvRefreshResult(force){
  var rid = lvRid();
  if (!rid){ lvResNoRace(); return; }
  lvState.rid = rid;
  var now = Date.now();
  // 自動時は節度を保つ（未確定60s・確定120s 以上の間隔）
  if (!force && lvState.fin !== null && now - lvState.lastResTry < (lvState.fin ? 120000 : 60000)) return;
  if (typeof histFetchHtml !== 'function'){ lvResMsg('結果の取得手段(中継等)がありません。', true); return; }
  lvState.lastResTry = now;
  lvResBusy(true);
  var u = 'https://race.netkeiba.com/race/result.html?race_id=' + rid;
  return histFetchHtml(u).then(function(html){
    lvResBusy(false);
    if (!html || html.length < 400) throw new Error('結果ページを取得できませんでした');
    var p = (typeof rnParseResult === 'function') ? rnParseResult(html, rid) : { rows: [], name: '' };
    var pay = lvParsePayouts(html);
    var fin = (p.rows || []).some(function(r){ return r.order === 1; });
    var wasFin = lvState.fin;
    lvState.fin = fin;
    if (fin && wasFin === false){
      // 結果確定を初めて検出 → ポップアップで払戻提示
      if (typeof showModal === 'function') lvNotifyFinish(p, pay);
    }
    lvRenderResult(p, pay);
  }).catch(function(e){
    lvResBusy(false);
    lvResMsg((e && e.message) || String(e), true);
  });
}
function lvResBusy(b){
  var el = $('lvResChip');
  if (el) el.textContent = b ? '取得中…' : '確認済み';
}
function lvResNoRace(){
  var el = $('lvResBody'); if (el) el.innerHTML = '';
  lvResMsg('レースIDがありません。「🔗 netkeiba URLから直接取込」で読み込んだレースを対象に結果を確認します。', false);
}
function lvResMsg(txt, err){
  var el = $('lvResMsg');
  if (el){ el.innerHTML = '<span class="small" style="color:' + (err ? 'var(--err-ink)' : 'var(--ok-ink)') + '">' + esc(txt) + '</span>'; }
}
/* 上り3F文字列("35.8" / "1:06.8") → 秒。不可なら NaN */
function lvLast3Sec(s){
  var t = String(s == null ? '' : s).replace(/[^0-9.:]/g, '');
  if (!t) return NaN;
  var cm = t.match(/(\d{1,2}):(\d{1,2})(?:\.(\d+))?/);
  if (cm) return parseInt(cm[1],10) * 60 + parseInt(cm[2],10) + (cm[3] ? parseInt(cm[3],10) / Math.pow(10, cm[3].length) : 0);
  var n = parseFloat(t);
  return isNaN(n) ? NaN : n;
}
function lvRenderResult(p, pay){
  var chip = $('lvResChip');
  var rows = p.rows || [];
  var fin = rows.some(function(r){ return r.order === 1; });
  if (chip) chip.textContent = fin ? '🏁 結果確定' : '⏳ 結果待ち';
  if (chip) chip.className = 'chip' + (fin ? '' : '');
  var msg = [];
  msg.push((p.date || '') + ' ' + ((p.place || '') + (p.rnum ? p.rnum + 'R' : '')) + ' ' + (p.name || '') + '　' +
    (p.dist ? p.dist + 'm' : '') + (p.surface || '') + (p.baba || '') + (p.weather ? '（' + p.weather + '）' : ''));
  if (!fin){
    msg.push('まだ結果が発表されていません。自動更新ONで確定と同時に払戻を表示します。');
    lvResMsg(msg.join('<br>'), false);
    var body = $('lvResBody'); if (body) body.innerHTML = '';
    lvClockNow();
    return;
  }
  lvResMsg(msg.join('<br>'), false);
  /* コースレコード更新 / タイ記録 */
  var recInfo = null;
  if (typeof crCheckResult === 'function'){
    try { recInfo = crCheckResult({ place:p.place, surface:p.surface, dist:p.dist, baba:p.baba, rows:rows }); } catch(e){}
  }
  /* 上り3Fの速さ順位（同タイムは同位）→ 1位=黄 / 2位=青 / 3位=ピンク */
  var l3ranks = {};
  rows.forEach(function(r){
    if (!(r.order >= 1)) return;
    var v = lvLast3Sec(r.last3);
    if (isNaN(v)) return;
    var faster = 0;
    rows.forEach(function(q){
      if (!(q.order >= 1)) return;
      var w = lvLast3Sec(q.last3);
      if (isNaN(w)) return;
      if (w < v - 0.0001) faster++;
    });
    l3ranks[r.no + ':' + r.name + ':' + r.last3] = faster + 1;
  });
  var hasL3 = Object.keys(l3ranks).length > 0;
  var h = [];
  if (recInfo){
    var rc = recInfo.base;
    var rcTxt = '従来 ' + esc(rc.t) + '（' + esc(rc.h) + ' ' + esc(rc.d || '記録日不明') + '）';
    if (recInfo.kind === 'new'){
      h.push('<div class="lvrecd" role="alert"><span class="lvreci">🏆</span> <b>コースレコード更新！</b> ' +
        '<span class="lvrecwin">1着 ' + esc(recInfo.win) + '</span>　' + rcTxt + '</div>');
    } else {
      h.push('<div class="lvrecd lvrecd-tie" role="alert"><span class="lvreci">🎯</span> <b>コースレコード・タイ記録</b>　' +
        '<span class="lvrecwin">1着 ' + esc(recInfo.win) + '</span>（' + esc(rc.h) + ' ' + esc(rc.d || '') + 'と同タイム）</div>');
    }
  }
  if (hasL3){
    h.push('<div class="small muted" style="margin:2px 0 4px">上3Fはレース内の速さ順位で色分け: ' +
      '<span class="lgb" style="background:#ffe13b;border:1px solid var(--line2)">1位(最速)</span> ' +
      '<span class="lgb" style="background:#7fc4ff;border:1px solid #4a9ff0">2位</span> ' +
      '<span class="lgb" style="background:#ffaad4;border:1px solid #f47fb4">3位</span>（同タイムは同位）</div>');
  }
  h.push('<div class="tblwrap"><table class="htbl" style="min-width:560px"><thead><tr>' +
    '<th>着順</th><th>馬番</th><th>馬名</th><th>騎手</th><th>タイム</th><th>上3F</th><th>人気</th><th>単勝</th></tr></thead><tbody>');
  var scrapped = [];
  rows.forEach(function(r){
    if (r.order >= 1){
      var sp = (r.order === 1) ? 'background:#fff6da' : (r.order <= 3 ? 'background:#f6fbf3' : '');
      var l3cell = esc(r.last3 || '');
      var rk = l3ranks[r.no + ':' + r.name + ':' + r.last3];
      if (rk && (rk === 1 || rk === 2 || rk === 3)){
        l3cell = '<span class="nkr r' + rk + '" title="このレースの上り3F ' + rk + '位（同タイムは同位）">' + esc(r.last3) + '</span>';
      }
      var timeCell = esc(r.time || '');
      if (r.order === 1 && recInfo){
        timeCell = '<span class="lvwinrec">' + timeCell +
          (recInfo.kind === 'new' ? ' <span class="lvbadge">NEW</span>' : ' <span class="lvbadge lvbadge-tie">TIE</span>') + '</span>';
      }
      h.push('<tr style="' + sp + '"><td><b>' + r.order + '</b></td><td>' + (r.no || '') + '</td>' +
        '<td>' + esc(r.name) + '</td><td class="muted">' + esc(r.jockey || '') + '</td>' +
        '<td>' + timeCell + '</td><td>' + l3cell + '</td>' +
        '<td>' + (r.pop || '') + (r.pop ? '人気' : '') + '</td><td>' + esc(r.odds || '') + '</td></tr>');
    } else {
      scrapped.push(r);
    }
  });
  h.push('</tbody></table></div>');
  if (scrapped.length){
    var lst = [];
    scrapped.forEach(function(r){
      lst.push((r.order === 0 ? '−' : r.order) + '番' + (r.no ? r.no + '番 ' : '') + esc(r.name) + '');
    });
    h.push('<div class="small" style="margin-top:6px;color:var(--err-ink)">⚠ 競走中止・除外など: ' + lst.join(' ／ ') + '</div>');
  }
  // 払戻
  if (pay && pay.length){
    h.push('<div style="margin-top:10px;font-weight:800;color:var(--ok-ink)">💰 払戻</div><div style="display:flex;flex-wrap:wrap;gap:6px">');
    pay.forEach(function(row){
      if (!row.groups.length || !row.pays.length) return;
      var lines = [];
      for (var i = 0; i < row.groups.length; i++){
        var num = row.groups[i].join('-');
        var amt = row.pays[i] || row.pays[row.pays.length - 1] || '';
        var nk = row.nks[i] || '';
        lines.push('<span>' + esc(num) + ' ' + esc(amt) + (nk ? '（' + esc(nk) + '）' : '') + '</span>');
      }
      h.push('<div style="border:1px solid var(--line2);background:var(--card);border-radius:8px;padding:5px 9px;min-width:140px">' +
        '<b>' + esc(row.name) + '</b><div class="small">' + lines.join('<br>') + '</div></div>');
    });
    h.push('</div>');
  } else {
    h.push('<div class="small muted" style="margin-top:6px">払戻データは解析できませんでした（単勝・複勝など一部のみ表示の可能性）。</div>');
  }
  var body2 = $('lvResBody');
  if (body2) body2.innerHTML = h.join('');
  lvClockNow();
}
function lvNotifyFinish(p, pay){
  var rows = p.rows || [];
  var top = rows.filter(function(r){ return r.order >= 1 && r.order <= 3; });
  var h = ['<h2>🏁 結果が確定しました</h2>'];
  if (p.date) h.push('<div class="small muted">' + esc((p.date || '') + ' ' + (p.name || '')) + '</div>');
  var t = [];
  top.forEach(function(r){
    t.push('<b>' + r.order + '着 ' + (r.no ? r.no + '番 ' : '') + esc(r.name) + '</b>（' + (r.pop ? r.pop + '人気' : '') + ' ' + esc(r.odds || '') + '倍）');
  });
  h.push('<div style="margin:6px 0">' + t.join('<br>') + '</div>');
  if (pay && pay.length){
    var first = pay.filter(function(x){ return x.name === '単勝' || x.name === '馬連' || x.name === '3連単'; });
    var one = [];
    first.forEach(function(r){
      if (r.groups.length && r.pays.length) one.push(esc(r.name) + ' ' + esc(r.groups[0].join('-')) + ' = <b>' + esc(r.pays[0]) + '</b>');
    });
    if (one.length) h.push('<div class="small" style="margin:4px 0">払戻: ' + one.join(' ／ ') + '</div>');
  }
  h.push('<p class="small">「🏁 結果・払戻」サブタブに全着順と全券種の払戻を表示しています。次のレースのAI予想の自己学習にもそのまま使えます。</p>');
  h.push('<div style="text-align:right;margin-top:6px"><button class="btn primary" data-mcl>閉じる</button></div>');
  showModal(h.join(''), function(root){
    var b = root.querySelector('[data-mcl]');
    if (b) b.addEventListener('click', closeModal);
  });
}

/* ================= 自動更新 ================= */
function lvAutoTick(){
  if (!lvState.auto) return;
  var rid = lvRid();
  if (rid) lvRefreshOdds(false);
  // 結果チェック（節度あり）。レース終了後に自動で「結果確定」を拾う
  if (rid) lvRefreshResult(false);
  lvSchedule();
}
function lvSchedule(){
  if (lvState.timer) clearTimeout(lvState.timer);
  lvState.timer = setTimeout(function(){ lvAutoTick(); }, lvState.intMs);
}
function lvAutoChanged(){
  lvState.auto = !!($('lvAuto') && $('lvAuto').checked);
  var iv = parseInt(($('lvInt') && $('lvInt').value) || '60', 10);
  lvState.intMs = (iv >= 30 ? iv : 60) * 1000;
  if (lvState.timer) clearTimeout(lvState.timer);
  if (lvState.auto){
    lvMsgTxt('🟢 自動更新ON（' + (lvState.intMs / 1000) + '秒ごと）。OFFにすると手動の「🔄 手動で更新」だけになります。');
    lvSchedule();
    lvAutoTick();
  } else {
    lvMsgTxt('自動更新OFF。必要なときは「🔄 手動で更新」を押してください。');
  }
}

/* ================= 初期化 ================= */
function initLive(){
  var bar = $('lvAuto');
  if (!bar) return;
  // サブタブ切替（イベント委譲）
  var card = bar.parentNode;
  var root = null, el = bar;
  while (el && el.id !== 't-input' && el.tagName !== 'SECTION') el = el.parentNode;
  root = el && el.id === 't-input' ? el : document;
  // 委譲: t-input 内の .lsbtn を拾う
  var section = $('t-input');
  if (section && section.addEventListener){
    section.addEventListener('click', function(e){
      var b = (e.target && e.target.closest) ? e.target.closest('.lsbtn[data-lt]') : null;
      if (b) lvSwitch(b.getAttribute('data-lt'));
    });
  } else if (document.addEventListener){
    document.addEventListener('click', function(e){
      var b = (e.target && e.target.closest) ? e.target.closest('.lsbtn[data-lt]') : null;
      if (b) lvSwitch(b.getAttribute('data-lt'));
    });
  }
  var now = $('lvNow');
  if (now) now.addEventListener('click', function(){
    lvMsgTxt('🔄 手動更新: オッズと結果を取得します…');
    var rid = lvRid();
    if (rid) lvRefreshOdds(true);
    if (rid) lvRefreshResult(true);
    else lvMsgTxt('レースIDがありません。netkeiba URL取込を先にしてください。', true);
  });
  if (bar) bar.addEventListener('change', lvAutoChanged);
  var iv = $('lvInt');
  if (iv) iv.addEventListener('change', lvAutoChanged);
  lvAutoChanged();
  lvClockNow();
}
