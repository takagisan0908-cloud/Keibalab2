/* =========================================================
   21 レース結果メモ（レース後の内容保存 → 次走以降の参考表示）
   netkeibaの結果ページからそのレースの「内容（展開）を自動要約」し、
   出走していた馬ごとに保存。次にその馬が出走するとき（次走・以降）、
   この画面の「今回の出走馬に保存されている過去の結果メモ」に表示します。
   ========================================================= */
var RN_LS = 'khl_rnotes_v1';
var rnPending = null;

function rnLoad(){
  try { return JSON.parse(localStorage.getItem(RN_LS) || '{"races":[]}'); } catch(e){ return { races: [] }; }
}
function rnSave2(o){
  try {
    if ((o.races || []).length > 40) o.races = o.races.slice(o.races.length - 40);
    safeSetItem(RN_LS, JSON.stringify(o));   /* 📌レースのメモ・結果メモ＝今の作業 */
  } catch(e){}
}
function rnLog(msg, tone){
  var el = $('rnInfo'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = tone === 'err' ? '#c33' : '';
}
function rnL(html){ var el=$('rnList'); if(el) el.innerHTML = html; }
function rnN(html){ var el=$('rnNext'); if(el) el.innerHTML = html; }

/* ---------- 結果ページ解析 ---------- */
function rnParseResult(html, rid){
  var out = { rid: rid, name:'', date:'', place:'', rnum:'', dist:'', surface:'', baba:'', weather:'', rows:[], n:0, winTime:'' };
  var mt = html.match(/<h1 class="RaceName"[^>]*>([\s\S]*?)<\/h1>/i);
  if (mt) out.name = esc2(mt[1]);
  var meta = (typeof histParseMeta === 'function') ? histParseMeta(html) : {};
  out.date = meta.date || ''; out.place = meta.place || ''; out.rnum = meta.rnum || '';
  out.dist = meta.dist || ''; out.surface = meta.surface || ''; out.baba = meta.baba || '';
  out.weather = meta.weather || '';
  var gt = html.match(/<(?:span|p)[^>]*class="RaceData[^"]*"[^>]*>([\s\S]*?)<\/(?:span|p)>/i);
  if (!gt){
    var dv = html.match(/<div class="RaceData01">([\s\S]*?)<\/div>/);
    if (dv) gt = dv;
  }
  if (gt){
    var t2 = esc2(gt[1]);
    var dm = t2.match(/(芝|ダート|ダ|障(?:害)?)[^0-9]*(\d{3,4})m/);
    if (dm){ out.surface = dm[1].replace('ダート','ダ'); out.dist = dm[2]; }
    var bm = t2.match(/馬場[:：]\s*([^\s\/]+)/);
    if (bm && !out.baba) out.baba = bm[1];
    var wm = t2.match(/天候[:：]\s*([^\s\/]+)/);
    if (wm) out.weather = wm[1];
  }
  // 全着順テーブル(馬IDリンクも取得)。ヘッダ行は <br/> を含むことがあるので
  // 全角/半角空白・改行を除いたラベルで列を特定する（db.netkeiba と race.netkeiba 両対応）
  function rnCl(s){ return String(s == null ? '' : s).replace(/[\s\u3000]/g, ''); }
  function rnCell(h){ return String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  var seg = '';
  var tm = html.match(/<table[^>]*summary="全着順"[^>]*>([\s\S]*?)<\/table>/);
  if (tm) seg = tm[1];
  if (!seg){
    var tm2 = html.match(/<table[^>]*summary="レース結果"[^>]*>([\s\S]*?)<\/table>/);
    if (tm2) seg = tm2[1];
  }
  if (!seg){
    var tbs = html.match(/<table[^>]*>([\s\S]*?)<\/table>/g) || [];
    for (var k = 0; k < tbs.length && !seg; k++){
      var hdrCells = tbs[k].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
      for (var q = 0; q < hdrCells.length; q++){
        if (rnCl(rnCell(hdrCells[q])) === '着順'){ seg = tbs[k].replace(/^<table[^>]*>/i, '').replace(/<\/table>$/i, ''); break; }
      }
    }
  }
  if (!seg) return out;
  var ths = [];
  var thead = seg.match(/<thead[^>]*>([\s\S]*?)<\/thead>/);
  var thBlock = thead ? thead[1] : seg.slice(0, 800);
  ths = thBlock.split(/<th[^>]*>/i).slice(1).map(function(x){ return rnCell(x.split('</th>')[0]); });
  var fix = { '着順':0, 枠:1, 馬番:2, 馬名:3, 性齢:4, 斤量:5, 騎手:6, タイム:7, 着差:8, 人気:9, '単勝オッズ':10, 単勝:10, '後3F':11, 上り:11, 'コーナー通過順':12, 通過:12, 枠番:1 };
  var idx = {};
  ths.forEach(function(t, k){
    var key = rnCl(t);
    if (fix[key] != null) idx[key] = k;
  });
  function col(i_, l){
    if (idx[l] != null && i_[idx[l]] != null) return i_[idx[l]];
    var f = fix[l];
    if (f != null && i_[f] != null) return i_[f];
    return '';
  }
  var trs = seg.split(/<tr[^>]*>/i);
  trs.forEach(function(tr){
    if (!/<t[dh]/i.test(tr)) return;
    // ヘッダ行(項目名のみ)は除外
    if (/<th[^>]*>/i.test(tr) && !/<td[ >]/i.test(tr) && !/<td>/i.test(tr)) return;
    var nkM = tr.match(/horse\/(\d+)/i);
    var tds = tr.split(/<t[dh][^>]*>/i).slice(1).map(function(x){ return x.replace(/<\/t[dh]>/i, ''); });
    var cells = tds.map(rnCell);
    var name = col(cells, '馬名');
    if (!name && !col(cells, '着順')) return;
    var o = parseInt(col(cells, '着順'), 10);
    var sea = col(cells, '性齢');
    var ageM = String(sea || '').match(/(\d{1,2})\s*歳?$/);
    out.rows.push({
      order: isNaN(o) ? 0 : o, no: col(cells, '馬番'), name: name,
      nk: nkM ? nkM[1] : '',
      sea: sea, age: ageM ? parseInt(ageM[1], 10) : 0,
      time: col(cells, 'タイム'), odds: col(cells, '単勝オッズ') || col(cells, '単勝'), pop: col(cells, '人気'),
      last3: col(cells, '後3F') || col(cells, '上り'), passing: col(cells, 'コーナー通過順') || col(cells, '通過')
    });
  });
  out.rows = out.rows.filter(function(r){ return r.name; });
  out.n = out.rows.filter(function(r){ return r.order >= 1; }).length;
  var w = out.rows[0]; if (w) out.winTime = w.time;
  // 払い戻し（全券種: 単勝・複勝・枠連・ワイド・馬連・馬単・3連複・3連単）
  // race.netkeiba と db.netkeiba の両形式を共通パーサで処理し、
  // out.payouts(生リスト)と out.payout({win,place,..} の {nos,pays} 正規化)を保存する
  try {
    if (typeof bfParsePayback === 'function'){
      out.payouts = bfParsePayback(html);
      out.payout = (typeof bfPayoutMap === 'function') ? bfPayoutMap(out.payouts) : null;
    } else {
      // 共通パーサ未読込時の縮退: 従来どおり単勝・複勝のみ
      var payBox = html.match(/<table[^>]*summary="[^"]*払戻[^"]*"[^>]*>([\s\S]*?)<\/table>/);
      if (payBox){
        var pb = payBox[1];
        function rowPay(cls){
          var tr = pb.match(new RegExp('<tr[^>]*class="' + cls + '"[^>]*>([\\s\\S]*?)<\\/tr>', 'i'));
          if (!tr) return null;
          var seg3 = tr[1];
          var nos = [];
          var resM = seg3.match(/<td class="Result">([\s\S]*?)<\/td>/i);
          if (resM){
            var sps = resM[1].match(/<span[^>]*>([^<]*)<\/span>/g) || [];
            for (var i=0;i<sps.length;i++){
              var t = sps[i].replace(/<[^>]*>/g,'').trim();
              if (t) nos.push(t);
            }
          }
          var pays = [];
          var payM = seg3.match(/<td class="Payout">([\s\S]*?)<\/td>/i);
          if (payM){
            var ps = payM[1].match(/(\d[\d,]*)円/g) || [];
            for (var j=0;j<ps.length;j++) pays.push(ps[j].replace(/[^0-9.]/g,''));
          }
          return { nos: nos, pays: pays };
        }
        out.payout = { win: rowPay('Tansho'), place: rowPay('Fukusho') };
      }
    }
  } catch(e){ /* 払戻解析は失敗しても無視 */ }
  return out;
}

/* 脚質タグ（p14と同じ基準） */
function rnStyle(r, n){
  if (typeof histStyle === 'function'){
    var s = histStyle(r.passing, n);
    return s.tag || '';
  }
  return '';
}

/* 自動要約文の生成 */
function rnBuildAutoNote(p){
  var L = [];
  var head = [p.date, (p.place||'') + (p.rnum?p.rnum+'R':''), p.name].filter(Boolean).join(' ');
  L.push(head + '：' + [p.dist + 'm', p.surface, p.baba].filter(Boolean).join(' ') + (p.weather ? '（天候:' + p.weather + '）' : ''));
  var w = null;
  for (var i = 0; i < p.rows.length; i++) if (p.rows[i].order === 1) w = p.rows[i];
  if (w){
    L.push('1着 ' + (w.no||'') + ' ' + w.name + ' ' + (w.time||'') + '（' + (w.pop||'-') + '人気 ' + (w.odds||'-') + '倍、上3F ' + (w.last3||'-') + '）');
  }
  var top = p.rows.filter(function(r){ return r.order >= 1 && r.order <= 3; });
  if (top.length){
    var tags = top.map(function(r){ return rnStyle(r, p.n); }).filter(Boolean);
    var paceTag = '';
    var winTag = w ? rnStyle(w, p.n) : '';
    var wpos = w ? histPos4(w.passing) : null;
    if (winTag === '逃げ') paceTag = '逃げ切り（先手を取ってそのまま）';
    else {
      var front = tags.filter(function(t){ return t === '逃げ' || t === '先行'; }).length;
      var back = tags.filter(function(t){ return t === '差し' || t === '追込'; }).length;
      if (front >= 2 && front > back) paceTag = '先行勢が優勢（前が止まらない/前残り気味）';
      else if (back >= 2 && back > front) paceTag = '差し・追込勢が届く決着（上がり勝負）';
      else paceTag = '中団〜好位で競り合うバランス型';
      if (winTag === '差し' || winTag === '追込') paceTag = '差し・追込が決めた（勝ち馬は後方から）' + (tags.length ? '、上位' + tags.length + '頭中' + back + '頭が後方勢' : '');
    }
    if (paceTag) L.push('内容: ' + paceTag + '。');
    L.push('馬券内: ' + top.map(function(r){ return r.order + '着' + r.no + ' ' + r.name + (rnStyle(r, p.n) ? '[' + rnStyle(r,p.n) + ']' : ''); }).join(' ／ '));
  }
  return L.join('\n');
}
function histPos4(passing){
  if (!passing) return null;
  var vals = String(passing).split(/[^0-9]/).map(function(x){ return parseInt(x,10); }).filter(function(x){ return !isNaN(x); });
  return vals.length ? vals[vals.length - 1] : null;
}

/* 取込実行 */
function rnGet(){
  var inp = $('rnUrl'), url = inp ? inp.value.trim() : '';
  var rid = url ? nkExtractRaceId(url) : (state.raceId || '');
  if (!url) url = '';
  if (!rid){ rnLog('⚠ レースIDを抽出できませんでした。結果ページのURL か race_id=12桁 を入力してください。', 'err'); return; }
  var target = url;
  if (!/result\.html/.test(target)) target = 'https://race.netkeiba.com/race/result.html?race_id=' + rid;
  rnLog('結果ページを取得中…（' + rid + '）');
  $('btnRnGet').disabled = true;
  var fn = (typeof histFetchHtml === 'function') ? histFetchHtml : null;
  if (!fn){
    var cand = function(){ return Promise.reject(new Error('取得関数がありません')); };
    fn = cand;
  }
  fn(target).then(function(html){
    if (!html || html.indexOf('All_Result_Table') < 0){
      throw new Error('まだ確定結果がありません（結果ページが出ていない・未発走）。もう少し待ってから再度お試しください。');
    }
    var p = rnParseResult(html, rid);
    if (!p.rows.length) throw new Error('結果行を解析できませんでした（netkeiba側の表示変更の可能性）');
    rnPending = p;
    var head = '<b>' + esc([p.date, (p.place||'')+(p.rnum?p.rnum+'R':''), p.name].filter(Boolean).join(' ')) + '</b>'
      + ' <span class="muted">' + esc([p.dist+'m', p.surface, p.baba].filter(Boolean).join(' ')) + '</span>';
    var tb = '<table style="max-width:720px"><thead><tr><th>着</th><th>馬番</th><th>馬名</th><th>タイム</th><th>上3F</th><th>通過</th><th>脚質</th><th>人気</th></tr></thead><tbody>';
    p.rows.filter(function(r){ return r.order >= 1 && r.order <= 6; }).forEach(function(r){
      tb += '<tr><td>' + r.order + '</td><td>' + esc(r.no) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.time) + '</td><td>' + esc(r.last3||'') + '</td><td>' + esc(r.passing||'') + '</td><td>' + esc(rnStyle(r, p.n)) + '</td><td>' + esc(r.pop||'') + '</td></tr>';
    });
    tb += '</tbody></table>';
    $('rnPrev').innerHTML = head + '<div style="margin-top:6px">' + tb + '</div>';
    $('rnNote').value = rnBuildAutoNote(p);
    $('rnEditWrap').classList.remove('hid');
    rnLog('取込OK: 実出走 ' + p.n + '頭。下のメモ欄を自由に編集して「保存」してください。');
    if (typeof refreshRaceLine === 'function') refreshRaceLine();
  }).catch(function(e){
    rnLog('⚠ ' + String(e && e.message || e), 'err');
  }).then(function(){ $('btnRnGet').disabled = false; });
}

/* 保存 */
function rnSave(){
  if (!rnPending){ rnLog('先に「結果を取込」してください。', 'err'); return; }
  var note = $('rnNote') ? $('rnNote').value.trim() : '';
  if (!note){ rnLog('メモが空です。内容を記入してから保存してください。', 'err'); return; }
  var st = rnLoad();
  var p = rnPending;
  var entry = {
    key: p.rid, savedAt: new Date().toISOString(),
    date: p.date, place: p.place, rnum: p.rnum, name: p.name,
    dist: p.dist, surface: p.surface, baba: p.baba, note: note,
    runners: p.rows.filter(function(r){ return r.nk; }).map(function(r){
      return { nk: r.nk, no: r.no, name: r.name, order: r.order };
    })
  };
  var replaced = false;
  st.races = (st.races || []).map(function(r){ if (r.key === entry.key){ replaced = true; return entry; } return r; });
  if (!replaced) st.races.push(entry);
  rnSave2(st);
  // AI予想の自己学習: この結果で自動検証（同じレースIDの予想と照合）
  if (typeof apEval === 'function'){
    try { apEval(p, p.rid, true); if (typeof apRender === 'function') apRender(); } catch(e){}   // nosess: 一括取込セッション集計には含めない
  }
  rnPending = null;
  rnLog('💾 保存しました（' + entry.runners.length + '頭分の馬メモ）。このレースに出ていた馬が次のレースに来たら自動表示されます。');
  $('rnPrev').innerHTML = ''; $('rnEditWrap').classList.add('hid');
  rnRefresh();
}

function rnDel(key){
  if (typeof showConfirm === 'function'){
    showConfirm('この結果メモを削除しますか？（このレースに出ていた全馬からも消えます）', function(){
      var st = rnLoad();
      st.races = (st.races || []).filter(function(r){ return r.key !== key; });
      rnSave2(st); rnRefresh(); rnLog('削除しました。');
    });
  } else {
    var st = rnLoad();
    st.races = (st.races || []).filter(function(r){ return r.key !== key; });
    rnSave2(st); rnRefresh();
  }
}

/* 保存済み一覧 + 今回の出走馬のメモ */
function rnRefresh(){
  var st = rnLoad();
  var races = (st.races || []).slice().sort(function(a,b){ return (b.savedAt||'').localeCompare(a.savedAt||''); });
  var lis = races.slice(0, 12).map(function(r){
    return '<div style="padding:5px 2px;border-bottom:1px dotted var(--line2)">' +
      '<div><b>' + esc(r.date || '') + '</b> ' + esc([(r.place||'')+(r.rnum?r.rnum+'R':''), r.name].filter(Boolean).join(' ')) +
      (r.baba || r.dist ? ' <span class="muted">' + esc([r.dist + 'm', r.surface, r.baba].filter(Boolean).join(' ')) + '</span>' : '') +
      ' <button class="btn ghost smbtn" data-rndel="' + esc(r.key) + '" style="float:right">削除</button></div>' +
      '<div class="small">' + esc(r.note) + '</div></div>';
  }).join('');
  rnL(lis ? '<b>保存済みメモ（直近）</b><div>' + lis + '</div>' : '<span class="small muted">まだ保存された結果メモはありません。</span>');

  // 今回の出走馬と突き合わせ
  var hs = (state.horses || []).filter(function(h){ return h.nk; });
  if (!hs.length){ rnN('<span class="muted">今回の出走馬に競走馬IDがありません（①でnetkeiba URL取込をすると対象になります）。</span>'); return; }
  var parts = [];
  hs.forEach(function(h){
    var hits = [];
    races.forEach(function(r){
      (r.runners || []).forEach(function(rn2){
        if (rn2.nk === h.nk) hits.push({ r: r, ord: rn2.order });
      });
    });
    if (hits.length){
      var rows = hits.slice(0, 3).map(function(hit){
        var label = hit.ord >= 1 ? (hit.ord + '着') : '着外';
        return '<div class="small" style="margin:3px 0;padding-left:6px;border-left:3px solid var(--line2)">' +
          '<b>' + esc(hit.r.date || '') + '</b> ' + esc(hit.r.name || '') +
          (hit.r.dist ? ' <span class="muted">' + esc([hit.r.dist + 'm', hit.r.baba].filter(Boolean).join(' ')) + '</span>' : '') +
          '（この馬は' + label + '）<br>　' + esc(hit.r.note) + '</div>';
      }).join('');
      parts.push('<div style="margin-top:6px"><b>' + esc(h.no || '') + ' ' + esc(h.name || '') + '</b> <span class="chip">メモあり</span><div>' + rows + '</div></div>');
    }
  });
  rnN(parts.length ? parts.join('') : '<span class="muted">今回の出走馬には保存済みの結果メモはまだありません（過去の結果メモを保存すると、その馬が次に走る時にここに表示されます）。</span>');
}

function initRn(){
  if (typeof on !== 'function') return;
  on('btnRnGet', 'click', rnGet);
  on('btnRnSave', 'click', rnSave);
  on('btnRnRefresh', 'click', rnRefresh);
  var list = $('rnList');
  if (list) list.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-rndel]');
    if (b) rnDel(b.getAttribute('data-rndel'));
  });
}
