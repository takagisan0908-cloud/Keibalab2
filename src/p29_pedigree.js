/* =========================================================
   29 父名・母父名の検出と血統別の傾向（旧⑧血統タブの一覧UIは削除。⑥の血統まとめと p36 drFetchHorse が使用）
   ---------------------------------------------------------
   - 出走馬それぞれの競走馬IDから netkeiba DB の血統AJAX
     (db.netkeiba.com/horse/ajax_horse_pedigree.html) を取得し
     父名(sire)と母父名(msire)を h.pedi に保存（キャッシュ付き）
   - 「AI予想の自己学習(p30)」の自動記録(開いているレースの全馬データ)から
     同競馬場×同距離 / 全レース の 父・母父別 単勝・複勝回収率 を集計
   ========================================================= */
var PG_LS = 'khl_ped_v1';
function pgLoad(){ try { return JSON.parse(cmpUnpack(localStorage.getItem(PG_LS)) || '{"ped":{}}'); } catch(e){ return { ped: {} }; } }
function pgSave(o){ try { localStorage.setItem(PG_LS, cmpPack(JSON.stringify(o))); } catch(e){} }

/* リレー経由で血統AJAXを取得 */
function pgFetchRaw(nk){
  var url = 'https://db.netkeiba.com/horse/ajax_horse_pedigree.html?input=UTF-8&output=json&id=' + nk;
  var cands = (typeof nkRelayCandidates === 'function') ? nkRelayCandidates() : [];
  var lastErr = null;
  return new Promise(function(res, rej){
    function tryNext(i){
      if (i >= cands.length){ rej(new Error('血統取得に失敗: ' + (lastErr ? lastErr.message : '中継なし'))); return; }
      var full = nkRelayBuild(cands[i], url);
      (typeof nkFetchTimeout === 'function' ? nkFetchTimeout(full, 15000) : Promise.reject(new Error('no fetch')))
        .then(function(t){ res(t); })
        .catch(function(e){ lastErr = e; tryNext(i + 1); });
    }
    tryNext(0);
  });
}
/* 血統AJAX JSONの data(html) → {sire, msire}
   netkeibaの血統表は td の文書順が
   左側「父(rowspan=2) 父父 父母」→ 右側「母(rowspan=2) 母父 母母」の並び。
   rowspan=2 の親セル位置から「父・母」を特定し、母の次の通常セルを母父として復元する。 */
function pgParseData(data){
  var out = { sire: '', msire: '', dam: '' };
  if (!data) return out;
  var m = data.match(/<table[^>]*class="blood_table"[^>]*>([\s\S]*?)<\/table>/);
  var seg = m ? m[1] : data;
  var names = [], spans = [];
  var cells = seg.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
  for (var i = 0; i < cells.length; i++){
    var c = cells[i];
    var a = c.match(/<a[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/a>/i);
    if (!a){ var s2 = c.match(/<span[^>]*>([^<]+)<\/span>/); if (s2) a = s2; }
    if (a){
      var t = String(a[1] || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (t){ names.push(t); spans.push(/rowspan/i.test(c) ? 1 : 0); }
    }
  }
  if (!names.length) return out;
  // rowspan=2 の親: 最初=父、次=母（その直後が母父）
  var sireI = -1, damI = -1;
  for (var k = 0; k < spans.length; k++){ if (spans[k]){ if (sireI < 0) sireI = k; else if (damI < 0){ damI = k; break; } } }
  if (sireI >= 0 && damI >= 0){
    out.sire = names[sireI];
    out.dam = names[damI];
    if (names[damI + 1]) out.msire = names[damI + 1];
    else if (names[damI - 2]) out.msire = names[damI - 2];
  } else {
    // 構造が変わった場合のフォールバック（旧形式の固定位置）
    if (names.length >= 1) out.sire = names[0];
    if (names.length >= 4) out.dam = names[3];
    if (names.length >= 5) out.msire = names[4];
  }
  return out;
}
function pgFetchHorse(nk){
  return pgFetchRaw(nk).then(function(t){
    var o = null;
    try { o = JSON.parse(t); } catch(e){}
    if (!o || o.status !== 'OK') throw new Error('血統API応答不正 (' + nk + ')');
    var ped = pgParseData(o.data || '');
    if (!ped.sire && !ped.msire) throw new Error('血統を解析できません (' + nk + ')');
    var cache = pgLoad();
    cache.ped[nk] = { sire: ped.sire, msire: ped.msire, dam: ped.dam, at: new Date().toISOString() };
    pgSave(cache);
    return cache.ped[nk];
  });
}
/* 全出走馬に適用（順次取得） */
function pgApplyAll(progress){
  progress = progress || function(){};
  var hs = (state.horses || []).filter(function(h){ return h.nk; });
  if (!hs.length){
    progress('出走馬に競走馬IDがありません。出馬表をnetkeiba URL取込（①）で読み込んでください。', true);
    return Promise.resolve(0);
  }
  var cache = pgLoad();
  var idx = 0, done = 0;
  var seq = Promise.resolve();
  hs.forEach(function(h){
    seq = seq.then(function(){
      idx++;
      if (cache.ped[h.nk]){
        h.pedi = { sire: cache.ped[h.nk].sire || '', msire: cache.ped[h.nk].msire || '' };
        done++;
        progress('キャッシュから: ' + idx + '/' + hs.length + ' ' + (h.name || ''));
        return;
      }
      progress('血統を取得中 ' + idx + '/' + hs.length + '：' + (h.name || h.nk) + '…');
      return pgFetchHorse(h.nk).then(function(ped){
        h.pedi = { sire: ped.sire || '', msire: ped.msire || '' };
        done++;
      }).catch(function(e){
        progress('⚠ ' + (h.name || h.nk) + ' → ' + ((e && e.message) || '取得失敗'), true);
      });
    });
  });
  return seq.then(function(){
    if (typeof saveNow === 'function') saveNow();
    if (typeof apSyncPedi === 'function') apSyncPedi();
    if (typeof rebuildHorseTable === 'function') rebuildHorseTable();
    progress('✅ 父・母父を ' + done + '/' + hs.length + '頭 分セットしました。', false, true);
    pgRender();
    return done;
  });
}
function pgCurHorses(){
  return (state.horses || []).filter(function(h){ return h.pedi && (h.pedi.sire || h.pedi.msire); });
}
/* ---------- 回収率集計（p30 学習DBから） ---------- */
function pgAcc(acc, key, order, odds, placePay){
  var g = acc[key] = acc[key] || { n:0, win:0, top3:0, retW:0, retP:0 };
  if (!(order >= 1)) return;
  g.n++;
  if (order === 1){ g.win++; g.retW += odds || 0; }
  if (order <= 3){ g.top3++; g.retP += (placePay[order] || 0) / 100; }
}
function pgPlaceMap(rec){
  var m = {};
  var pl = rec.result && rec.result.payout && rec.result.payout.place;
  if (pl && pl.nos && pl.pays){
    // nos/pays は着順順（1着〜）と仮定し、着順で引けるように
    for (var i = 0; i < pl.nos.length; i++){
      var o = (function(){ var rr = (rec.result.rows || []).filter(function(x){ return String(x.no) === String(pl.nos[i]); })[0]; return rr ? rr.order : 0; })();
      if (o >= 1 && o <= 3) m[o] = parseFloat(String(pl.pays[i] || '').replace(/[^0-9.]/g, '')) || 0;
    }
  }
  return m;
}
function pgRoi(){
  var mm = apMetaCur();
  var pl = mm.place, dist = parseFloat(mm.dist) || 0;
  var comp = apCompleted();
  var exact = {}, any = {};
  comp.forEach(function(rec){
    var a = rec.meta || {};
    var samePlace = a.place === pl;
    var sameDist = dist && Math.abs((parseFloat(a.dist) || 0) - dist) <= 0;
    var pmap = pgPlaceMap(rec);
    (rec.predHorses || []).forEach(function(ph){
      if (!ph.pedi || !ph.pedi.sire && !ph.pedi.msire) return;
      var row = (rec.result.rows || []).filter(function(x){ return String(x.no) === String(ph.no); })[0];
      var order = row ? row.order : 0;
      var odds = parseFloat(String(row && row.odds || '').replace(/[^0-9.]/g, '')) || 0;
      if (ph.pedi.sire) pgAcc(any, '父:' + ph.pedi.sire, order, odds, pmap);
      if (ph.pedi.msire) pgAcc(any, '母父:' + ph.pedi.msire, order, odds, pmap);
      if (samePlace && sameDist){
        if (ph.pedi.sire) pgAcc(exact, ph.pedi.sire, order, odds, pmap);
        if (ph.pedi.msire) pgAcc(exact, ph.pedi.msire, order, odds, pmap);
      }
    });
  });
  return { exact: exact, any: any, place: pl, dist: mm.dist };
}
function pgRoiRowHTML(label, g, extra){
  if (!g) return '';
  return '<tr><td>' + esc(label) + '</td><td>' + g.n + '</td><td>' + g.win + '</td><td>' + g.top3 + '</td>' +
    '<td>' + (g.n ? (g.retW / g.n * 100).toFixed(0) + '%' : '−') + '</td>' +
    '<td>' + (g.n ? (g.retP / g.n * 100).toFixed(0) + '%' : '−') + '</td></tr>' + (extra || '');
}
function pgRoiHTML(){
  var roi = pgRoi();
  var rows = [];
  Object.keys(roi.exact).forEach(function(k){ rows.push(pgRoiRowHTML(k, roi.exact[k])); });
  var h = [];
  if (rows.length){
    h.push('<div class="small" style="font-weight:bold">💰 ' + esc(roi.place) + ' ' + esc(roi.dist) + 'm における父・母父別の単勝/複勝回収率（学習DBの結果レースから）</div>');
    h.push('<table class="lr-tbl"><thead><tr><th>父・母父</th><th>出走</th><th>1着</th><th>3着内</th><th>単勝回収</th><th>複勝回収</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>');
  }
  var rows2 = [];
  Object.keys(roi.any).sort().forEach(function(k){ rows2.push(pgRoiRowHTML(k, roi.any[k])); });
  if (rows2.length){
    h.push('<div class="small" style="font-weight:bold;margin-top:8px">📊 保存済みレース全体（競馬場・距離を問わない参考）</div>');
    h.push('<table class="lr-tbl"><thead><tr><th>父・母父</th><th>出走</th><th>1着</th><th>3着内</th><th>単勝回収</th><th>複勝回収</th></tr></thead><tbody>' + rows2.join('') + '</tbody></table>');
  }
  if (!rows.length && !rows2.length){
    h.push('<div class="small muted">回収率の集計対象がありません。この後「レース結果メモ」で結果を取込むほど、父・母父ごとの回収率が自動で貯まっていきます。</div>');
  }
  return h.join('');
}
function pgRender(){
  var box = $('pgTab'); if (!box) return;
  var hs = pgCurHorses();
  var h = [];
  if (!hs.length){
    box.innerHTML = '<div class="small muted">まだ父・母父のデータがありません。上の「📥 父・母父を取得」を押すと、出走馬全頭の父名・母父名をnetkeibaから取得します（出馬表をnetkeiba URL取込で読み込んでいる必要があります）。</div>';
  } else {
    h.push('<table class="lr-tbl"><thead><tr><th>馬番</th><th>馬名</th><th>父</th><th>母父</th></tr></thead><tbody>');
    (state.horses || []).forEach(function(hh){
      if (!hh.pedi) return;
      h.push('<tr><td>' + esc(hh.no) + '</td><td>' + esc(hh.name) + '</td><td>' + esc(hh.pedi.sire || '−') + '</td><td>' + esc(hh.pedi.msire || '−') + '</td></tr>');
    });
    h.push('</tbody></table>');
    // 父・母父で同系が多いもの（傾向）
    var by = {};
    hs.forEach(function(hh){
      if (hh.pedi.sire) by['父:' + hh.pedi.sire] = (by['父:' + hh.pedi.sire] || 0) + 1;
      if (hh.pedi.msire) by['母父:' + hh.pedi.msire] = (by['母父:' + hh.pedi.msire] || 0) + 1;
    });
    var dup = Object.keys(by).filter(function(k){ return by[k] >= 2; });
    if (dup.length){
      h.push('<div class="small" style="margin-top:6px">🔎 複数頭が同じ系統: ' + dup.map(function(k){ return esc(k) + '×' + by[k]; }).join('，') + '</div>');
    }
    box.innerHTML = h.join('');
  }
  var r = $('pgRoi'); if (r) r.innerHTML = pgRoiHTML();
}
function pgRefresh(){
  var el = $('pgMsg'); if (el) el.textContent = '';
  pgRender();
}
function pgStatus(msg, isErr){
  var el = $('pgMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  el.style.color = isErr ? '#b3261e' : '';
}
function initPg(){
  var b = $('pgBtn');
  if (b) b.addEventListener('click', function(){
    b.disabled = true;
    pgStatus('血統データを取得しています…（1頭につき1〜2秒）');
    pgApplyAll(function(msg, isErr){ pgStatus(msg, isErr); }).finally(function(){ b.disabled = false; });
  });
  var r = $('pgReload');
  if (r) r.addEventListener('click', function(){ pgRender(); });
  pgRender();
}
