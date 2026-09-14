/* =========================================================
   当日トラックバイアス（馬場傾向）診断
   - netkeibaの同日・同開催の前レース結果を自動取込
   - 馬券内(3着内)の馬の 脚質(4角通過順から逃げ/先行/差し/追込)・枠・人気・上がり・時計を集計
   - 導出したバイアスをAI印エンジンへ反映
   ========================================================= */
var PAR_TIME = {
  // 概算基準(良馬場・JRA級の標準勝ち時計・秒) ※近似。土日馬場差の目安に使う
  turf:{1000:57.5, 1150:66, 1200:69.0, 1400:82.5, 1600:96.0, 1800:109.5, 2000:122.5, 2200:135.0, 2400:148.0, 2500:154.0, 2600:160.0, 3000:188.0, 3200:205.0, 3600:228.0},
  dirt:{1000:59.0, 1200:71.5, 1400:84.5, 1700:105.0, 1800:112.0, 2000:126.5, 2100:130.0, 2400:153.0, 2500:160.0, 2600:166.0}
};
function nkToSec(s){
  if (s == null) return null;
  var m = String(s).match(/(\d{1,2}):(\d{1,2})[.:](\d{1,2})/);
  if (m) return parseInt(m[1],10)*60 + parseInt(m[2],10) + parseInt(m[3],10)/10;
  /* 2026-09-11 第14弾: ドット区切り（1.12.4 / 3.11.2）も拾うようにしました。
     netkeiba の DB ページや、障害戦の時計（3分台＝3.11.2 のような表記）でこの形式が出ます。
     これを拾えないと parseFloat('3.11.2')=3.112 秒になってしまい、障害の時計が全部落ちていました。 */
  m = String(s).match(/^\s*(\d{1,2})\.(\d{1,2})\.(\d{1,2})\s*$/);
  if (m) return parseInt(m[1],10)*60 + parseInt(m[2],10) + parseInt(m[3],10)/10;
  m = String(s).match(/(\d{1,2}):(\d{1,2})(?:[.:](\d{1,2}))?/);
  if (m && m[2] && parseInt(m[2],10) < 60){
    var c = m[3] ? parseInt(m[3],10)/10 : 0; // 末尾2桁を1/10秒に丸める
    if (String(m[3]).length === 1) c = parseInt(m[3],10)/10;
    return parseInt(m[1],10)*60 + parseInt(m[2],10) + c;
  }
  var n = parseFloat(String(s));
  return isNaN(n) ? null : n;
}
function nkClr(t){ return nkDecode(String(t==null?'':t).replace(/<[^>]+>/g,' ')).replace(/[ \t\u3000]+/g,' ').trim(); }

/* ===== トラックバイアス用: 脚質(逃げ/先行/差し/追込)ベースの集計 =====
   4角通過位置から脚質を推定する(勝ち馬=1角から先頭は「逃げ」等)。
   旧仕様の「前/中/後」保存データも重みに変換して後方互換する。 */
var BIAS_STYLE_KEYS = ['逃げ','先行','差し','追込'];
var BIAS_STYLE_COLORS = { 逃げ:'#c0392b', 先行:'#d68910', 差し:'#1f6fb2', 追込:'#6c3483' };
function biasPosToStyle(pos, n){
  pos = parseInt(pos,10);
  n = parseInt(n,10);
  if (!pos || pos < 1) return '';
  if (n > 1 && pos > n) return '';
  if (pos === 1) return '逃げ';
  if (n > 1){
    var r = (pos - 1) / (n - 1);
    if (r <= 0.30) return '先行';
    if (r <= 0.65) return '差し';
    return '追込';
  }
  return pos <= 3 ? '先行' : (pos <= 9 ? '差し' : '追込');
}
function biasHorseStyle(h){
  if (!h) return '';
  if (h.sty && BIAS_STYLE_KEYS.indexOf(h.sty) >= 0) return h.sty;
  var b = h.bucket; // 旧「前/中/後」→ 代表脚質(クリックで補正可能)
  if (b === 'front') return '先行';
  if (b === 'back') return '追込';
  if (b === 'mid') return '差し';
  return '';
}
/* 脚質が「前残り(逃げ・先行優勢の決着)」にどの程度寄るか 0..1 */
function biasStyleFrontWeight(st){
  if (st === '逃げ') return 1.0;
  if (st === '先行') return 0.78;
  if (st === '差し') return 0.38;
  if (st === '追込') return 0.06;
  return -1; // 不明
}

/* ===== 1レースの結果ページ解析 ===== */
function nkBiasParseResult(html){
  var out = { finished:false, dist:'', surface:'', baba:'', rname:'', rows:[], allRows:[], winSec:null };
  if (!html || html.indexOf('All_Result_Table') < 0) return out;   // 未発走・未確定
  out.finished = true;
  // レース情報
  var rd = html.match(/<div class="RaceData01">([\s\S]*?)<\/div>/);
  if (rd){
    var rdTxt = nkClr(rd[1]);
    var dm = rdTxt.match(/(芝|ダ(?:ート)?|障(?:害)?)?\s*(\d{3,4})m/);
    if (dm){ out.surface = (dm[1] || '').replace(/ダート/,'ダ'); out.dist = dm[2]; }
    var bm = rdTxt.match(/馬場[:：]\s*([^\s/]+)/);
    if (bm) out.baba = bm[1];
  }
  var h1 = html.match(/<h1 class="RaceName">([\s\S]*?)<\/h1>/i);
  if (h1) out.rname = nkClr(h1[1]).replace(/[Ｓ]/g,'S');
  // 着順テーブル
  var i = html.indexOf('<table summary="全着順"');
  if (i < 0) i = html.indexOf('All_Result_Table');
  if (i < 0) return out;
  var seg = null, depth = 0, reT = /<\/?table\b[^>]*>/gi, m;
  while ((m = reT.exec(html)) !== null){
    if (m.index < i) continue;
    if (m[0].charAt(1) === '/'){ depth--; if (depth === 0){ seg = html.slice(i, m.index); break; } }
    else depth++;
  }
  if (!seg) return out;
  var rows = seg.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  var all = [];
  rows.forEach(function(tr){
    if (/<th/i.test(tr)) return;
    var cells = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!cells || cells.length < 12) return;
    var v = function(ci){ return nkClr(cells[ci]); };
    var rank = parseInt(v(0),10);
    if (isNaN(rank) || rank < 1) return;
    var frame = '', noTxt = v(2).replace(/[^\d]/g,'');
    var fm = (cells[1].match(/class="[^"]*Waku(\d)/) || [,''])[1];
    if (fm) frame = fm;
    var nmA = cells[3].match(/title="([^"]*)"[^>]*>/i);
    // コーナー通過順の列を探す（「3-4-4-4」のような数字のダッシュ区切り）
    var passing = '';
    // コーナー通過順: まず「3-4-4-4」のようにハイフン区切り1セルの形式を探し、
    // 無ければ単純な整数セルが並ぶ(角別セル)形式を拾う。いずれも着順表の
    // 末尾側(後3Fより後)に限定して、人気・馬番などの単独数字と衝突しないようにする
    for (var cix = 12; cix < cells.length; cix++){
      var txt = nkClr(cells[cix]).replace(/[\s\u3000]/g,'');
      if (/^\d{1,2}(?:[-\uFF0D]\d{1,2}){1,4}$/.test(txt)){ passing = txt.replace(/\uFF0D/g,'-'); break; }
    }
    if (!passing){
      var run = [];
      for (var cx = 12; cx < cells.length; cx++){
        var t2 = nkClr(cells[cx]).replace(/[\s\u3000]/g,'');
        var iv = /^\d{1,2}$/.test(t2) ? parseInt(t2,10) : -1;
        if (iv >= 1 && iv <= 18) run.push(iv);
        else if (run.length >= 2) break;
        else run = [];
      }
      if (run.length >= 2) passing = run.join('-');
    }
    all.push({
      rank: rank, no: noTxt, name: nmA ? nkClr(nmA[1]) : v(3),
      frame: frame, timeStr: v(7), gap: v(8),
      pop: parseInt(v(9),10), odds: parseFloat(v(10)),
      agari: parseFloat(v(11)), passing: passing
    });
  });
  all.sort(function(a,b){ return a.rank - b.rank; });
  out.allRows = all;                                  // 第16弾: 全着順（コーナー位置の母数に使う）
  var nFull = all.filter(function(r){ return r.rank >= 1; }).length;
  // 馬券内(上位3着)を格納。コーナー通過順があれば4角位置から脚質を自動分類
  out.rows = all.filter(function(r){ return r.rank <= 3; }).map(function(it){
    var sty = '';
    if (it.passing){
      var parts = String(it.passing).split('-');
      var p4 = parseInt(parts[parts.length - 1], 10);
      if (p4 && nFull > 1){
        sty = biasPosToStyle(p4, nFull);
        it.sty = sty;
        it.bucket = { 逃げ:'front', 先行:'front', 差し:'mid', 追込:'back' }[sty] || '';
      }
      it.pos4 = p4 || null;
    }
    return it;
  });
  if (out.rows[0]) out.winSec = nkToSec(out.rows[0].timeStr);
  return out;
}

/* 距離・馬場で基準時計(秒) */
function nkParSec(surface, dist, baba){
  var s = (surface||'').indexOf('ダ') >= 0 ? 'dirt' : 'turf';
  var d = parseInt(dist,10);
  if (!d) return null;
  var keys = Object.keys(PAR_TIME[s]).map(Number).sort(function(a,b){ return a-b; });
  var best = null;
  for (var i=0;i<keys.length;i++){
    if (Math.abs(keys[i]-d) <= 40){ best = keys[i]; break; }
  }
  if (best == null) return null;
  var par = PAR_TIME[s][best];
  var adj = { '稍重': 1.4, '重': 3.0, '不良': 5.0 } [baba] || 0;
  return par + adj;
}

/* ===== netkeibaから同日の前レース群を自動取得 ===== */
function nkBiasRelayCandidates(){
  var list = [];
  if (state.urlRelay) list.push(state.urlRelay);
  list.push('/api/race');
  return list;
}
function nkBiasFetchText(url){
  var cands = nkBiasRelayCandidates(), k = 0;
  return new Promise(function(res, rej){
    function next(){
      if (k >= cands.length){ rej(new Error('中継が未設定のため自動取込できません（出馬表URL取込と同じ設定が必要）。OCR・テキスト取込でも入力できます。')); return; }
      var base = cands[k++];
      var full = nkRelayBuild(base, url);
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 15000);
      fetch(full, { signal: ctrl ? ctrl.signal : undefined, cache:'no-store',
        headers:{'Accept':'text/html,application/json,*/*'} })
      .then(function(r){ clearTimeout(timer); if(!r.ok) throw new Error('HTTP '+r.status); return nkRespText(r, url); })
      .then(function(t){ res(t); })
      .catch(function(e){ clearTimeout(timer); if(k < cands.length) next(); else rej(e); });
    }
    next();
  });
}
function nkBiasRaceId(){
  var inp = $('urlImport');
  var rid = inp ? nkExtractRaceId(inp.value) : '';
  return rid || (state.raceId || '');
}
function nkBiasToday8(){
  var d = new Date();
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
/* 対象レースの開催日（YYYYMMDD）。既存の記録 → ①のレース情報 → 結果/出馬表ページのタイトル の順に調べる */
function nkBiasTargetDate(base, rid){
  var rs = state.biasRaces || [];
  for (var i = 0; i < rs.length; i++){
    var id = String(rs[i].id || '');
    if (id.slice(0, 10) !== base || !rs[i].date) continue;
    var d8a = String(rs[i].date).replace(/[^0-9]/g, '').slice(0, 8);
    if (d8a.length === 8) return Promise.resolve(d8a);
  }
  var di = null;
  try { di = biasDayInfo(); } catch(e){}
  var fromState = (di && di.src && di.src !== 'today') ? (di.y + ('0' + di.m).slice(-2) + ('0' + di.d).slice(-2)) : '';
  if (fromState) return Promise.resolve(fromState);
  var urls = [
    'https://race.netkeiba.com/race/result.html?race_id=' + rid,
    'https://race.netkeiba.com/race/shutuba.html?race_id=' + rid
  ];
  var tryOne = function(k){
    if (k >= urls.length) return Promise.resolve('');
    return nkBiasFetchText(urls[k]).then(function(t){
      var d = '';
      try { if (typeof histParseDetail === 'function') d = (histParseDetail(t).meta || {}).date || ''; } catch(e){}
      if (!d){
        var dm = String(t).match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
        if (dm) d = dm[1] + '/' + dm[2] + '/' + dm[3];
      }
      var d8 = String(d).replace(/[^0-9]/g, '').slice(0, 8);
      if (d8.length === 8) return d8;
      return tryOne(k + 1);
    }).catch(function(){ return tryOne(k + 1); });
  };
  return tryOne(0).then(function(d8){ return d8 || nkBiasToday8(); });
}
/* 中継の一時的な失敗（429/502/タイムアウト）だけリトライする。
   「まだ確定していないレース」は false を返すだけなのでリトライしない（無駄な通信を増やさない） */
function nkBiasFetchTextRetry(url, tries){
  var left = (tries == null) ? 2 : tries;
  return nkBiasFetchText(url).catch(function(e){
    if (left > 0) return new Promise(function(r){ setTimeout(r, 700); }).then(function(){ return nkBiasFetchTextRetry(url, left - 1); });
    throw e;
  });
}
/* 1レースぶんの結果を取り込む（成功=true） */
function nkBiasFetchOne(x, isToday){
  return nkBiasFetchTextRetry('https://race.netkeiba.com/race/result.html?race_id=' + x.rid).then(function(t){
    var p = nkBiasParseResult(t);
    if (!p.finished || !p.rows.length) return false;
    /* ★2026-09-12 第16弾: トラックバイアス取得時も「コーナー通過順・ペース(S/M/H)・200mごとのラップタイム」を
       一緒に残します。ページはすでに取得したものを使うので追加の通信はありません。
       → 開催日が経つにつれて「何角の何番手が有利か」を競馬場ごとに判別できるようになります。 */
    var xd = null;
    try {
      if (typeof rdParseExtra === 'function' && typeof rdCompact === 'function'){
        var exB = rdParseExtra(t, { dist: parseInt(p.dist, 10) || 0 });
        if (exB && exB.ok) xd = rdCompact(exB, (p.allRows || p.rows || []).length);
      }
    } catch(e){}
    var dmeta = null;
    try {
      if (typeof histParseDetail === 'function'){
        var d = histParseDetail(t);
        if (d && d.rows && d.rows.length){
          dmeta = d.meta || null;
          if (typeof lnIngest === 'function') lnIngest(d, x.rid);   // 展開学習も同時更新
        }
      }
    } catch(e){}
    addBiasRace(p, x.rid, x.rno, (dmeta && dmeta.date) ? dmeta.date : '', x.venue, xd);
    return true;
  }).catch(function(){ return false; });
}
/* 取得キューを順に処理（1レースずつ＝中継への負荷を抑える） */
function nkBiasRunQueue(todo, isToday, onDone){
  var got = 0, missed = [];
  var total = todo.length;
  var seq = Promise.resolve(), idx = 0;
  todo.forEach(function(x){
    seq = seq.then(function(){
      idx++;
      nkLog2(['取得中…（' + idx + ' / ' + total + '）' + x.venue + ' ' + x.rno + 'R' +
        (x.name ? ' ' + x.name : '') + (x.time ? ' ' + x.time + '発走' : '')]);
      return nkBiasFetchOne(x, isToday).then(function(ok){
        if (ok) got++;
        else missed.push(x.venue + x.rno + 'R');
      });
    });
  });
  return seq.then(function(){
    if (onDone) onDone(got, missed, total);
    return got;
  });
}
/* 同日・同競馬場のみ（レース一覧が取れなかったときの従来動作） */
function nkBiasFetchSameVenue(base, targetR){
  var got = 0, missed = [];
  var venue = '';
  try { venue = biasVenueOfCode(base.slice(4, 6)) || ''; } catch(e){}
  var seq = Promise.resolve();
  for (var r = 1; r < targetR; r++){
    (function(rr){
      var rid = base + (rr < 10 ? '0' : '') + rr;
      seq = seq.then(function(){
        return nkBiasFetchOne({ rid: rid, rno: rr, venue: venue }, true).then(function(ok){
          if (ok) got++; else missed.push(rr + 'R');
        });
      });
    })(r);
  }
  return seq.then(function(){ return { got: got, missed: missed, total: Math.max(0, targetR - 1), fallback: true }; });
}
/* 当日の全競馬場（レース一覧 → 各場の全レース）を取り込む */
function nkBiasFetchAll(){
  var rid = nkBiasRaceId();
  if (!/^\d{10,12}$/.test(rid || '')){
    nkLog2(['⚠ 対象レースが特定できません。上部「URLから直接取込」の欄にnetkeibaのレースURL(race_id含む)を貼り、「出馬表を取込」を実行してください（raceIdが記憶されます）。']);
    return;
  }
  var base = String(rid).slice(0, 10);
  var targetR = parseInt(String(rid).slice(10, 12), 10) || 12;
  nkLog2(['対象レースの開催日を確認しています…']);
  return nkBiasTargetDate(base, rid).then(function(d8){
    var dLabel = d8.slice(0, 4) + '/' + (+d8.slice(4, 6)) + '/' + (+d8.slice(6, 8));
    nkLog2(['開催日: ' + dLabel + '　当日の全競馬場のレース結果を取り込みます…']);
    // レース一覧: PC版(race_list_sub.html)は中継経由だと空になることがあるため、
    // ①データ入力・④と同じ「候補URLを順に試す」経路（SP版ふくむ）を使う
    var listP = (typeof kaiFetchListHtml === 'function')
      ? kaiFetchListHtml(d8).catch(function(e){
          nkLog2(['レース一覧の取得に失敗（' + ((e && e.message) || e) + '）→ 同日・同競馬場の前レースだけ取り込みます…']);
          return { html: '', venues: [] };
        })
      : nkBiasFetchText('https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + d8)
          .then(function(html){ return { html: html, venues: (typeof kaiParseList === 'function') ? kaiParseList(html) : [] }; })
          .catch(function(){ return { html: '', venues: [] }; });
    return listP.then(function(got){
      var venues = (got && got.venues) || [];
      if (!venues.length){
        // 一覧が取れない（地方のみの日・中継の不調など）→ 従来どおり同日・同場の前レースだけ
        nkLog2(['レース一覧を取得できないため、同日・同競馬場の前レースのみ取り込みます…']);
        return nkBiasFetchSameVenue(base, targetR);
      }
      var queue = [];
      venues.forEach(function(v){
        (v.races || []).forEach(function(rr){
          queue.push({ rid: rr.raceId, rno: rr.r, venue: v.venue, time: rr.time || '', name: rr.name || '' });
        });
      });
      var has = {};
      (state.biasRaces || []).forEach(function(x){ has[x.id] = 1; });
      var isToday = (d8 === nkBiasToday8());
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var todo = [], skipHad = 0, skipFut = 0;
      queue.forEach(function(x){
        if (has[x.rid]){ skipHad++; return; }
        if (isToday && /^\d{1,2}:\d{2}$/.test(x.time)){
          var hm = x.time.split(':');
          if ((parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10)) > nowMin + 2){ skipFut++; return; }
        }
        todo.push(x);
      });
      nkLog2([dLabel + ' は ' + venues.length + '場 ' + queue.length + 'レース。未取得 ' + todo.length +
        ' レースを取得します（取得済み ' + skipHad + (skipFut ? '／未発走 ' + skipFut : '') + '）。']);
      return nkBiasRunQueue(todo, isToday, null).then(function(got){
        return { got: got, missed: [], total: todo.length, venues: venues.length };
      });
    });
  }).then(function(r){
    r = r || {};
    var msg = '✅ 既出走 ' + (r.got || 0) + ' レース分を取り込みました';
    if (r.venues) msg += '（' + r.venues + '場開催・取得対象 ' + (r.total || 0) + 'レース）';
    if (r.got === 0 && !r.fallback){
      msg = '⚠ 取り込めたレースがありませんでした。当日のレースがまだ始まっていない時間帯か、中継(リレー)の設定をご確認ください（各画面の「🔧 通信を診断」）。下の「テキストを記録に追加」でも手入力できます。';
    } else if (r.fallback && r.got === 0){
      msg = '⚠ 前レースの結果を取得できませんでした（未発走の時間帯か、中継(リレー)の設定）。';
    }
    nkLog2([msg]);
    renderBiasCard();
    try {
      if (typeof lnCompute === 'function'){
        var lr = lnCompute();
        if (typeof renderLearnCard === 'function') renderLearnCard();
        if (lr) nkLog2([msg + ' ／ 🎓 展開学習も同時更新: ' + lr.label]);
      }
    } catch(e){}
    if (r.got) showAnalysis();
  }).catch(function(e){
    nkLog2(['⚠ ' + (e && e.message || e)]);
  });
}
function addBiasRace(p, raceId, rno, dateStr, venueName, xd){
  // 重複を避けて先頭挿入
  state.biasRaces = state.biasRaces.filter(function(b){ return b.id !== raceId; });
  var ags = p.rows.filter(function(x){ return x.agari != null; });
  var par = nkParSec(p.surface, p.dist, p.baba);
  var vName = venueName || biasRaceVenue({ id: raceId }) || biasVenueOfCode(String(raceId).slice(4, 6)) || '';
  state.biasRaces.push({
    id: raceId, rno: rno, date: dateStr || '', venue: vName,
    label: (rno ? rno + 'R' : '') + (p.rname ? ' ' + p.rname : ''),
    dist: p.dist, surface: p.surface, baba: p.baba, winSec: p.winSec, winStr: p.rows[0] ? p.rows[0].timeStr : '',
    agariAvg: ags.length ? +(ags.reduce(function(a,b){ return a+b.agari; },0)/ags.length).toFixed(1) : null,
    money: p.rows,
    /* 第16弾: コーナー通過順（馬番ごとの1〜4角位置）・ペース(S/M/H)・200mごとのラップタイム・払戻。
       null の場合は「このページには無かった」＝従来の脚質集計だけを使います。 */
    xd: xd || null
  });
  saveNow();
}
function nkLog2(lines){ var el=$('biasLog'); if(el) el.innerHTML = lines.map(esc).join('<br>'); }

/* ===== 集計・判定 ===== */
function biasStyleCounts(){
  var st = { 逃げ:0, 先行:0, 差し:0, 追込:0, known:0, legacy:0 };
  biasRacesOurs().forEach(function(rc){
    (rc.money || []).forEach(function(h){
      if (!h || h.rank < 1 || h.rank > 3) return;
      var sty = biasHorseStyle(h);
      if (!sty) return;
      st[sty]++;
      st.known++;
      if (!h.sty) st.legacy++;
    });
  });
  return st;
}
function biasVerdict(){
  var b = biasStyleCounts();
  var known = b.known;
  if (known < 3) return null;
  // 前残り寄与度の重み平均(逃げ1.0 / 先行0.78 / 差し0.38 / 追込0.06)
  // ※ バイアスは競馬場ごとに傾向が違うため、対象レースと同じ競馬場の記録だけで判定する
  var ours = biasRacesOurs();
  var sum = 0, cnt = 0;
  ours.forEach(function(rc){
    (rc.money || []).forEach(function(h){
      if (!h || h.rank < 1 || h.rank > 3) return;
      var sty = biasHorseStyle(h);
      var w = sty ? biasStyleFrontWeight(sty) : -1;
      if (w < 0) return;
      sum += w; cnt++;
    });
  });
  if (cnt < 3) return null;
  var frontScore = sum / cnt;
  var posLabel = '', note = '';
  if (frontScore >= 0.60){ posLabel='前残り・先行有利'; note = '馬券内は逃げ・先行型が中心の「前が止まらない」流れの可能性。逃げ・先行馬の評価を引き上げます。'; }
  else if (frontScore <= 0.42){ posLabel='差し・追込有利'; note = '後方から差してくる馬が馬券内に入る「差しが届く」展開の可能性。差し・追込馬の評価を引き上げます。'; }
  else { posLabel='前後バランス型'; note = '脚質による有利不利は小さい印象（その他の指標を参考に）。'; }
  var frontCnt = (b['逃げ'] || 0) + (b['先行'] || 0);
  var backCnt  = (b['差し'] || 0) + (b['追込'] || 0);
  // 時計水準
  var ds = ours.filter(function(rc){ return rc.winSec && rc.dist && rc.surface; });
  var tSum = 0, tN = 0, tNote = '';
  ds.forEach(function(rc){
    var par = nkParSec(rc.surface, rc.dist, rc.baba);
    if (par) { tSum += rc.winSec - par; tN++; }
  });
  var speed = null, speedLbl = '';
  if (tN){
    speed = tSum / tN;
    if (speed <= -1.2) speedLbl = 'やや時計の出る速い馬場';
    else if (speed <= 0) speedLbl = '標準よりやや速い';
    else if (speed <= 1.4) speedLbl = 'ほぼ標準';
    else speedLbl = '時計がかかる重い傾向';
  }
  // 配当傾向
  var ods = [];
  ours.forEach(function(rc){ (rc.money||[]).forEach(function(h){ if (h.odds && h.odds>1) ods.push(h.odds); }); });
  var avgOd = ods.length ? ods.reduce(function(a,b){return a+b;},0)/ods.length : null;
  var payout = avgOd == null ? '' : (avgOd <= 6 ? '堅い決着が続く（人気サイド）' : avgOd <= 14 ? '平均的な荒れ方' : '波乱含み（人気薄が絡む）');
  // 枠の内外
  var frames = [];
  ours.forEach(function(rc){
    if (!(rc.money||[]).length) return;
    (rc.money||[]).forEach(function(h){ if (h.frame) frames.push(parseInt(h.frame,10)); });
  });
  var lane = { inner:0, mid:0, outer:0 };
  frames.forEach(function(f){ if (f<=3) lane.inner++; else if (f>=7) lane.outer++; else lane.mid++; });
  return {
    counts: { front: frontCnt, mid: 0, back: backCnt },
    styles: b, frontScore: frontScore, posLabel: posLabel, posNote: note,
    speed: speed, speedLbl: speedLbl, payout: payout, moneyAvg: avgOd,
    lane: lane, known: known, races: ours.length,
    laneTotal: frames.length, legacy: b.legacy
  };
}
function biasMulFromFront(f){
  // front有利: 逃げ/先行を引き上げ 差し/追込を引き下げ
  var up = (f - 0.5) * 2;         // -1..1
  function m(x){ return +(1 + x*0.28).toFixed(3); }
  return { E: m(up*0.9), S: m(up*0.7), K: m(-up*0.8), C: m(-up) };
}
function biasStyleMul(){
  /* ★2026-09-12 第18弾: バックテスト中は「当日ぶんの記録(state.biasRaces)」を見ない。
     あれは画面に入力されている今日の記録で、過去レースを解析するときには別日のものになってしまうため。
     学習DBから引いた **前日の馬場だけ** で想定する（p57 pbStyleMulFallback(true)）。 */
  var bt = false;
  try { bt = !!window.BT_MODE; } catch(e){}
  if (bt){
    var fb0 = null;
    try { if (typeof pbStyleMulFallback === 'function') fb0 = pbStyleMulFallback(true); } catch(e){}
    if (fb0) return fb0;
    return { mul: {E:1,S:1,K:1,C:1}, v: null };
  }
  var v = biasVerdict();
  if (v){
    /* 当日ぶんがある場合も、サンプルが薄いうちは前日の馬場とブレンドする（p57）。
       当日の3着内 known 頭に対して w = known/(known+12) で当日を信用するので、
       朝イチ（数レース分）は前日寄り、終盤は当日の実測が主役になります。 */
    try {
      if (typeof pbStyleMulFallback === 'function' && pbUseOn()){
        var pv = pbCurPrev();
        if (pv && !pv.skip && pv.frontScore != null){
          var w = (v.known || 0) / ((v.known || 0) + PB_BLEND_K);
          if (w < 0.999){
            var fb = pbStyleMulFallback(false);
            if (fb && fb.v) return fb;      // fb 側で同じブレンド式を使って v を作り直している
          }
        }
      }
    } catch(e){}
    return { mul: biasMulFromFront(v.frontScore), v: v };
  }
  /* 当日ぶんの記録がまだ無い（レース前・序盤）→ 前日の馬場を想定として使う */
  try {
    if (typeof pbStyleMulFallback === 'function'){
      var f2 = pbStyleMulFallback(false);
      if (f2) return f2;
    }
  } catch(e){}
  return { mul: {E:1,S:1,K:1,C:1}, v: null };
}

/* ---- トラックバイアス手動指定（展開予想欄での調整用） ---- */
function biasCurManual(){
  try { return (state && state.biasOverride != null) ? String(state.biasOverride) : ''; }
  catch(e){ return ''; }
}
function biasManualPreset(kind){
  var f = (kind === 'front') ? 0.8 : (kind === 'back') ? 0.2 : 0.5;
  var posLabel, posNote;
  if (kind === 'front'){ posLabel = '前残り・先行有利'; posNote = '逃げ・先行型の評価を引き上げ、差し・追込を引き下げます。'; }
  else if (kind === 'back'){ posLabel = '差し・追込有利'; posNote = '後方待機の差し・追込型の評価を引き上げ、逃げ・先行を引き下げます。'; }
  else { posLabel = '前後バランス型'; posNote = '脚質による有利不利は小さい想定として補正しません。'; }
  return { frontScore: f, posLabel: posLabel, posNote: posNote, manual: kind,
    styles: null, counts: {front:0, mid:0, back:0}, speed: null, speedLbl: '',
    payout: '', moneyAvg: null, lane: null, laneTotal: 0, known: 0, races: 0, legacy: 0 };
}
function biasManualRowHTML(){
  var cur = biasCurManual();
  var opts = [
    { v:'',     label:'自動',           hint:'記録した前レースの結果から自動判定（「🎓展開学習」の反映スイッチと連動）' },
    { v:'front',label:'前残り・先行有利', hint:'逃げ・先行を高く、差し・追込を低く補正' },
    { v:'mid',  label:'バランス',        hint:'脚質バイアスは無し（フラット）相当' },
    { v:'back', label:'差し・追込有利',  hint:'差し・追込を高く、逃げ・先行を低く補正' },
    { v:'off',  label:'反映しない',      hint:'バイアス補正をかけない' }
  ];
  return '<div class="biasmanual">' +
    '<div class="small" style="font-weight:700;margin:6px 0 2px">🎚 トラックバイアスを手動で指定（展開適性＝脚質評価へ反映）</div>' +
    '<div class="small muted" style="margin-bottom:4px">当日の前レース記録が無い日や「今日はこう読む」と決めたときは手動で指定できます。「自動」に戻すと記録データからの判定を使います。</div>' +
    '<div style="display:flex;gap:5px;flex-wrap:wrap">' + opts.map(function(o){
      var on = cur === o.v;
      return '<button type="button" data-bm="' + o.v + '" class="btn ' + (on ? 'primary' : 'ghost') + '" style="padding:3px 10px;font-size:.8rem" title="' + esc(o.hint) + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>' +
    '<div class="small" id="biasManualNote" style="margin-top:5px"></div></div>';
}
function renderBiasManualRow(){
  var box = $('biasManualRow'); if (!box) return;
  box.innerHTML = biasManualRowHTML();
  var note = $('biasManualNote'), chip = $('biasChip');
  var cur = biasCurManual();
  if (cur === 'off'){
    if (note) note.innerHTML = '<span class="muted">※ 現在「反映しない」のため、AI印の脚質評価にはバイアス補正をかけていません。</span>';
    if (chip){ chip.textContent = (state.biasRaces && state.biasRaces.length) ? '反映OFF' : '未設定'; chip.className = 'chip warn'; }
  } else if (cur){
    var v = biasManualPreset(cur);
    if (chip){ chip.textContent = v.posLabel + '（手動）'; chip.className = 'chip'; }
    if (note) note.innerHTML = '<span style="color:var(--ok-ink);font-weight:600">✅ 反映中: 「' + esc(v.posLabel) + '」' + esc(v.posNote) + '</span>';
  } else if (note){ note.innerHTML = ''; }
}
function setBiasManual(v){
  state.biasOverride = (v == null) ? '' : String(v);
  saveNow();
  renderBiasCard();
  if (typeof renderBiasManualRow === 'function') renderBiasManualRow();
  if (typeof showAnalysis === 'function') showAnalysis();
}

/* ===== 手入力テキスト解析（上級者向け） =====
   1行例: 阪神1R 芝1400 良 | 1着:3(2) 2着:7(5) 3着:1(9) | 1:21.3
   カッコ=4角通過位置 */
function nkBiasParseText(text){
  var races = [];
  String(text).split(/\r?\n/).forEach(function(line){
    if (!line.trim()) return;
    var parts = line.split('|').map(function(s){ return s.trim(); });
    var head = parts[0] || '';
    var rankM = null, money = [], tTok = parts.length > 2 ? parts[2] : '';
    if (parts.length >= 2){
      var seg = parts[1];
      var re = /(\d{1,2})\s*(?:着)?[:：]?\s*(\d{1,2})(?:\s*[（(]\s*(\d{1,2})\s*[)）])?/g, mm;
      while ((mm = re.exec(seg)) !== null){
        var rank = parseInt(mm[1],10);
        if (rank >= 1 && rank <= 3){
          var no = parseInt(mm[2],10);
          var pos = mm[3] ? parseInt(mm[3],10) : null;
          var bSty = pos == null ? '' : biasPosToStyle(pos, 18);
          money.push({ rank: rank, no: String(no), sty: bSty, pos: pos,
            bucket: bSty ? { '逃げ':'front', '先行':'front', '差し':'mid', '追込':'back' }[bSty] : '' });
        }
      }
    }
    var winSec = nkToSec(tTok);
    var dm = head.match(/(芝|ダ(?:ート)?|障(?:害)?)?\s*(\d{3,4})m/);
    var bm = head.match(/[^|]*?(良|稍重|重|不良)/);
    var rnm = head.match(/(\d{1,2})R/);
    races.push({
      label: head, rno: rnm ? rnm[1] : '', dist: dm ? dm[2] : '', surface: dm ? (dm[1]||'').replace(/ダート/,'ダ') : '',
      baba: bm ? bm[1] : '', winSec: winSec, winStr: tTok, agariAvg: null, money: money, manual: true
    });
  });
  return races;
}

/* ===== UI ===== */
function bucketHTML(h){
  // 脚質(逃げ/先行/差し/追込)をボタンで設定。旧データ(bucket)は代表脚質へ変換して表示
  var cur = biasHorseStyle(h);
  function b(v){
    return '<button data-bk="' + v + '" class="bk ' + (cur===v?'on':'') +
      '" style="' + (cur===v ? ('background:'+(BIAS_STYLE_COLORS[v]||'#888')+';border-color:'+(BIAS_STYLE_COLORS[v]||'var(--line2)')+';color:var(--on-accent)') : '') +
      '" title="決着内容から判断した脚質を設定">' + v + '</button>';
  }
  return '<div class="bkset">' + BIAS_STYLE_KEYS.map(b).join('') + '</div>';
}
/* =========================================================
   ★2026-09-13 第25弾①: 展開に関する短評（実データだけから生成・捏造しない）
   ---------------------------------------------------------
   当日の結果 ＋ 前日の確定レース結果（学習DBの4角通過順・着順）を集計し、
   「逃げ切りが多い／後方待機は届かない／先行までにいないと馬券内にならない」
   のような**展開の短評**を文章で出します。
   数字はすべて biasRacesOurs() の実測カウントです（サンプルが薄い項目は出しません）。
   ========================================================= */
function tenkaiStat(){
  var o = { races: 0, top3: 0, win: {}, in3: {}, raceWinEscape: 0, raceAnyChase: 0,
            known: 0, legacy: 0, frames: { inner:0, mid:0, outer:0 } };
  ['逃げ','先行','差し','追込'].forEach(function(k){ o.win[k] = 0; o.in3[k] = 0; });
  var rows = [];
  try { rows = biasRacesOurs() || []; } catch(e){ rows = []; }
  o.races = rows.length;
  rows.forEach(function(rc){
    var gotWin = '';
    (rc.money || []).forEach(function(h){
      if (!h || !(h.rank >= 1) || !(h.rank <= 3)) return;
      var sty = biasHorseStyle(h);
      if (!sty) return;
      o.in3[sty]++; o.top3++; o.known++;
      if (!h.sty) o.legacy++;
      if (h.rank === 1){ o.win[sty]++; gotWin = sty; }
      if (h.frame){
        var f = parseInt(h.frame, 10);
        if (f >= 1){ if (f <= 3) o.frames.inner++; else if (f >= 7) o.frames.outer++; else o.frames.mid++; }
      }
    });
    if (gotWin === '逃げ') o.raceWinEscape++;
    if (gotWin === '差し' || gotWin === '追込') o.raceAnyChase++;
  });
  return o;
}
function tenkaiPct(a, b){ return b > 0 ? (a / b * 100) : 0; }
/* 短評の文章を配列で返す（上位ほど強い根拠） */
function tenkaiComment(v, st, extra){
  var out = [];
  if (!st || !st.top3) return out;
  var n = st.top3;
  var pEscape = tenkaiPct(st.win['逃げ'], st.races);          // 逃げ切り率（レースあたり）
  var pFront3 = tenkaiPct(st.in3['逃げ'] + st.in3['先行'], n);  // 馬券内が逃げ・先行の割合
  var pChase3 = tenkaiPct(st.in3['差し'] + st.in3['追込'], n);  // 馬券内が差し・追込の割合
  var pComa3  = tenkaiPct(st.in3['追込'], n);                  // 後方待機(追込)の馬券内率
  var pSashi3 = tenkaiPct(st.in3['差し'], n);

  /* --- 逃げ・先行 --- */
  if (st.raceWinEscape >= 2 && pEscape >= 25)
    out.push({ t: '逃げ切り勝ちが ' + st.raceWinEscape + '/' + st.races + ' レース（' + pEscape.toFixed(0) + '%）と多く、前が行ってそのままの展開が目立ちます', k: 'escape' });
  else if (st.win['逃げ'] >= 1 && pFront3 >= 60)
    out.push({ t: '逃げ残り気味。馬券内の ' + pFront3.toFixed(0) + '% が逃げ・先行で、前が止まりません', k: 'front' });
  if (pFront3 >= 66)
    out.push({ t: '先行までにいないと馬券内にはならない流れ（逃げ・先行で馬券内 ' + pFront3.toFixed(0) + '%・' + (st.in3['逃げ'] + st.in3['先行']) + '/' + n + '）', k: 'frontstrict' });

  /* --- 差し・追込 --- */
  if (pComa3 <= 6 && st.in3['追込'] <= 1 && n >= 9)
    out.push({ t: '後方待機は全く届かず（追込の馬券内 ' + st.in3['追込'] + '/' + n + '・' + pComa3.toFixed(0) + '%）。どんなにハイペースでも後ろからは届いていません', k: 'nocomma' });
  else if (pSashi3 >= 40)
    out.push({ t: '中段からは差しが決まる（差しの馬券内 ' + pSashi3.toFixed(0) + '%・' + st.in3['差し'] + '/' + n + '）', k: 'sashi' });
  if (st.raceAnyChase >= 2 && pChase3 >= 45)
    out.push({ t: '差し・追込で ' + st.raceAnyChase + ' 勝しており、流れ込む展開が効いています（差し・追込の馬券内 ' + pChase3.toFixed(0) + '%）', k: 'chase' });

  /* --- 時計・馬場 --- */
  if (v && v.speedLbl)
    out.push({ t: '馬場は「' + v.speedLbl + '」' + (v.speed != null ? '（基準比 ' + (v.speed > 0 ? '+' : '') + v.speed.toFixed(1) + '秒）' : ''), k: 'speed' });
  /* --- 枠 --- */
  var lt = (st.frames.inner + st.frames.mid + st.frames.outer);
  if (lt >= 12){
    var pi = tenkaiPct(st.frames.inner, lt), po = tenkaiPct(st.frames.outer, lt);
    if (pi >= 50) out.push({ t: '内枠(1〜3枠)の馬券内が ' + pi.toFixed(0) + '% と多く、内を通った馬が有利', k: 'inner' });
    else if (po >= 45) out.push({ t: '外枠(7〜8枠)の馬券内が ' + po.toFixed(0) + '% と多く、外を回す形でも届いています', k: 'outer' });
  }
  /* --- ペース想定と実測のズレ（第25弾①の肝） --- */
  if (extra && extra.conflict) out.push({ t: extra.conflict, k: 'conflict' });
  /* --- 配当 --- */
  if (v && v.payout) out.push({ t: v.payout + (v.moneyAvg ? '（馬券内平均オッズ ' + v.moneyAvg.toFixed(1) + '倍）' : ''), k: 'payout' });

  out.sort(function(a, b){
    var ord = { nocomma:0, frontstrict:1, escape:2, chase:3, sashi:4, front:5, conflict:6, inner:7, outer:8, speed:9, payout:10 };
    return (ord[a.k] == null ? 99 : ord[a.k]) - (ord[b.k] == null ? 99 : ord[b.k]);
  });
  return out;
}
/* サンプルが薄いときは短評を出さない（3着内6頭分＝2レース分未満） */
function tenkaiCommentReady(st){ return !!(st && st.top3 >= 6 && st.races >= 2); }
function biasVerdictHTML(v){
  var chip = $('biasChip');
  var noneMsg = '<div class="muted small">各レースの馬券内(3着内)の脚質(逃げ/先行/差し/追込)が3頭分以上入力されると、脚質バイアスの判定を出します。下のボタンで各馬の脚質を設定してください（netkeiba取込時は4角通過順から自動判定）。</div>';
  if (!v){
    if (chip){ chip.textContent = state.biasRaces.length ? '記録 ' + state.biasRaces.length + 'レース' : '未設定'; chip.className = 'chip warn'; }
    return noneMsg;
  }
  if (chip){ chip.textContent = v.posLabel; chip.className = 'chip'; }
  var st = v.styles || { 逃げ:0, 先行:0, 差し:0, 追込:0 };
  var tot = (st['逃げ']||0)+(st['先行']||0)+(st['差し']||0)+(st['追込']||0) || 1;
  function pct(n){ return (n/tot*100).toFixed(1); }
  var bar = '<div class="barbg" style="width:auto;display:block;height:12px"><div style="display:flex;height:100%;width:100%">' +
    BIAS_STYLE_KEYS.map(function(k){
      return '<div style="width:' + pct(st[k]||0) + '%;background:' + (BIAS_STYLE_COLORS[k]) + '" title="' + k + '"></div>';
    }).join('') + '</div></div>' +
    '<div class="small muted" style="display:flex;justify-content:space-between;margin-top:2px;flex-wrap:wrap">' +
    BIAS_STYLE_KEYS.map(function(k){ return '<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + BIAS_STYLE_COLORS[k] + '"></i> ' + k + ' ' + (st[k]||0) + '</span>'; }).join('') +
    '</div>';
  var bullets = [];
  bullets.push('<b>' + esc(v.posLabel) + '</b> ' + esc(v.posNote));
  bullets.push('馬券内の脚質: 逃げ ' + (st['逃げ']||0) + ' / 先行 ' + (st['先行']||0) + ' / 差し ' + (st['差し']||0) + ' / 追込 ' + (st['追込']||0) + '（判定対象 ' + v.known + '頭・' + v.races + 'レース）' +
    (v.legacy ? '<span style="color:var(--warn-ink)"> ※ 一部は旧「前/中/後」データからの変換値。ボタンで補正してください</span>' : ''));
  if (v.speedLbl) bullets.push('当日の時計水準: ' + esc(v.speedLbl) + (v.speed!=null ? '（基準比 ' + (v.speed>0?'+':'') + v.speed.toFixed(1) + '秒）' : ''));
  if (v.payout) bullets.push('決着傾向: ' + esc(v.payout) + '（馬券内の平均単勝 ' + (v.moneyAvg ? v.moneyAvg.toFixed(1) : '?') + '倍）');
  if (v.laneTotal) bullets.push('枠位置（内1-3枠/中4-6/外7-8）: 内 ' + v.lane.inner + '・中 ' + v.lane.mid + '・外 ' + v.lane.outer);
  return '<div class="biasverdict"><div style="flex:1;min-width:240px">' +
    bullets.map(function(b){ return '<div class="small" style="margin:1px 0">' + b + '</div>'; }).join('') +
    '</div><div style="min-width:180px;flex:1">' + bar + '</div></div>';
}
/* =========================================================
   ===== 要望7: 当日トラックバイアス欄の追加情報 =====
   (1) 当日の時計が「同じ時期の過去」と比べて速い/遅いか
   (2) 「同じ競馬場開催」のデータで判定しているか
   ========================================================= */
var BIAS_VENUES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
function biasVenueOfCode(code){
  var c = String(code || '');
  if (!/^\d{2}$/.test(c)) return '';
  if (typeof gcVenue === 'function'){ var v = gcVenue(c); if (v) return v; }
  if (typeof bfVenueByCode === 'function'){ var v2 = bfVenueByCode(c); if (v2) return v2; }
  return { '01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉' }[c] || '';
}
function biasVenueOfText(txt){
  var t = String(txt || '');
  for (var i = 0; i < BIAS_VENUES.length; i++) if (t.indexOf(BIAS_VENUES[i]) >= 0) return BIAS_VENUES[i];
  return '';
}
/* 対象レースの開催場（race_id の場コード優先 → レース情報の文字列） */
function biasTargetVenue(){
  var rid = String((state && state.raceId) || '').trim();
  var code = /^\d{12}$/.test(rid) ? rid.slice(4, 6) : '';
  var name = biasVenueOfCode(code);
  if (!name){
    var pl = '';
    try { pl = String((state.race && state.race.place) || readRaceMeta().place || ''); } catch(e){ pl = String((state.race && state.race.place) || ''); }
    name = biasVenueOfText(pl);
  }
  return { rid: rid, code: code, name: name };
}
function biasRaceVenue(rc){
  if (rc && rc.venue) return String(rc.venue);
  var rid = String((rc && rc.id) || '');
  if (/^\d{12}$/.test(rid)){ var v = biasVenueOfCode(rid.slice(4, 6)); if (v) return v; }
  return biasVenueOfText(rc && rc.label);
}
/* 対象レースと同じ競馬場の記録だけ（バイアス判定は場ごとに見るため）。
   同場の記録が1つも無いときは全体で代用（従来互換） */
function biasRacesOurs(){
  // トラックバイアスは「その日の馬場」の話なので、別日の記録を混ぜてはいけない
  var all = biasRowsOfDay().day;
  var tv = biasTargetVenue();
  if (!tv.name) return all.slice();
  var mine = all.filter(function(rc){ return biasRaceVenue(rc) === tv.name; });
  return mine.length ? mine : all.slice();
}
/* 記録を競馬場ごとにまとめる（表示順: 対象場 → 開催順） */
function biasRacesByVenue(rows){
  var tv = biasTargetVenue();
  var groups = {}, order = [];
  (rows || biasRowsOfDay().day).forEach(function(rc){
    var v = biasRaceVenue(rc) || '（場名不明）';
    if (!groups[v]){ groups[v] = []; order.push(v); }
    groups[v].push(rc);
  });
  order.sort(function(a, b){
    if (a === tv.name) return -1;
    if (b === tv.name) return 1;
    return a.localeCompare(b, 'ja');
  });
  return order.map(function(v){
    return { venue: v, races: groups[v].slice().sort(function(a, b){ return (a.rno || 99) - (b.rno || 99); }) };
  });
}
/* 対象日の月日（記録レースの日付 → 無ければ今日） */
function biasDayInfo(){
  // 対象日 = ①で読み込んだレースの日付 → 一番新しい記録の日付 → 今日
  // （従来は「最初に日付を持つ記録」＝最も古い記録を見ていたため、別日の記録が残っていると
  //   判定も表示もその古い日に引きずられていた）
  var src = '';
  try { src = String((state.race && state.race.date) || ''); } catch(e){ src = ''; }
  if (!/\d{4}/.test(src)){
    var rs = (state.biasRaces || []);
    for (var i = rs.length - 1; i >= 0; i--){ if (rs[i] && rs[i].date){ src = String(rs[i].date); break; } }
  }
  var y = 0, m = 0, d = 0;
  var mm = String(src || '').match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (mm){ y = parseInt(mm[1], 10); m = parseInt(mm[2], 10); d = parseInt(mm[3], 10); }
  if (!m || !d){ var now = new Date(); y = now.getFullYear(); m = now.getMonth() + 1; d = now.getDate(); src = 'today'; }
  var dt = new Date(y, m - 1, d);
  var doy = Math.round((dt - new Date(dt.getFullYear(), 0, 0)) / 86400000);
  return { y: y, m: m, d: d, doy: doy, label: y + '/' + ('0' + m).slice(-2) + '/' + ('0' + d).slice(-2), src: src };
}
/* 対象日(YYYYMMDD) */
function biasDay8(){
  var d = biasDayInfo();
  if (!d || !d.m || !d.d) return '';
  return String(d.y) + ('0' + d.m).slice(-2) + ('0' + d.d).slice(-2);
}
/* 1件の記録が「いつのレースか」(YYYYMMDD)。日付不明なら ''（＝当日扱いにして手入力を無駄にしない） */
function biasRecDay8(rc){
  var s8 = String((rc && rc.date) || '').replace(/[^0-9]/g, '').slice(0, 8);
  if (s8.length === 8) return s8;
  // 日付を持たない記録は、同じ「場・回・日目」(race_id 先頭10桁)の記録の日付を流用する
  var pre = String((rc && rc.id) || '').slice(0, 10);
  if (pre.length === 10){
    var rs = state.biasRaces || [];
    for (var i = 0; i < rs.length; i++){
      if (String(rs[i].id || '').slice(0, 10) !== pre) continue;
      var t = String(rs[i].date || '').replace(/[^0-9]/g, '').slice(0, 8);
      if (t.length === 8) return t;
    }
  }
  return '';
}
/* 記録を「対象日のぶん」と「別日のぶん」に振り分ける */
function biasRowsOfDay(){
  var d8 = biasDay8();
  var day = [], other = [];
  (state.biasRaces || []).forEach(function(rc){
    var rd = biasRecDay8(rc);
    if (!d8 || !rd || rd === d8) day.push(rc); else other.push(rc);
  });
  return { day: day, other: other, d8: d8 };
}
function biasDoyOfDate(str){
  var mm = String(str || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!mm) return null;
  var dt = new Date(parseInt(mm[1], 10), parseInt(mm[2], 10) - 1, parseInt(mm[3], 10));
  if (isNaN(dt.getTime())) return null;
  return { y: parseInt(mm[1], 10), doy: Math.round((dt - new Date(dt.getFullYear(), 0, 0)) / 86400000), date: mm[0] };
}
function biasDoyNear(a, b, win){
  var diff = Math.abs(a - b);
  if (diff > 182) diff = 365 - diff;      // 年またぎ
  return diff <= (win || 21);
}
/* 同じ時期（±3週）の過去の勝ち時計を、出走馬の馬柱(過去戦績)から集計 */
function biasPastFromHorsebook(venue, surface, dist){
  var out = { n: 0, sec: 0, spd: 0, list: [], src: '出走馬の馬柱' };
  if (typeof hdLs !== 'function' || !venue || !dist) return out;
  var ls;
  try { ls = hdLs(); } catch(e){ return out; }
  var day = biasDayInfo();
  var secs = [], spds = [];
  var seen = {};
  Object.keys(ls || {}).forEach(function(nk){
    var rec = ls[nk];
    var rows = (rec && rec.r) || [];
    rows.forEach(function(r){
      if (!r || !(parseInt(r.order, 10) === 1)) return;         // 勝ち時計のみ
      if (String(r.venueName || '') !== venue) return;          // 同じ競馬場
      if (String(r.surface || '') !== surface) return;          // 同じ面(芝/ダ)
      if (!r.m || Math.abs(r.m - dist) > 200) return;           // 同距離±200m
      var dd = biasDoyOfDate(r.date);
      if (!dd || dd.y >= day.y) return;                         // 今回は除く(過去のみ)
      if (!biasDoyNear(dd.doy, day.doy, 21)) return;            // 同じ時期(±3週)
      var sec = nkToSec(r.time);
      if (!sec) return;
      var key = r.date + '|' + r.name + '|' + sec;
      if (seen[key]) return; seen[key] = 1;
      secs.push(sec); spds.push(r.m / sec);
      out.list.push({ date: r.date, m: r.m, sec: sec, venue: r.venueName });
    });
  });
  if (secs.length){
    out.n = secs.length;
    out.sec = secs.reduce(function(a, b){ return a + b; }, 0) / secs.length;
    out.spd = spds.reduce(function(a, b){ return a + b; }, 0) / spds.length;
  }
  return out;
}
/* 同じ時期の過去を、⑥重賞データ分析が取得済みの過去レース(キャッシュ)からも集計 */
function biasPastFromAnalysis(venue, surface, dist){
  var out = { n: 0, sec: 0, spd: 0, list: [], src: '⑥分析の過去レース', venueHit: 0 };
  if (typeof drLs !== 'function' || !dist) return out;
  var ls;
  try { ls = drLs(); } catch(e){ return out; }
  var day = biasDayInfo();
  Object.keys((ls && ls.races) || {}).forEach(function(rid){
    var rec = ls.races[rid];
    var meta = (rec && rec.meta) || {};
    var rows = (rec && rec.rows) || [];
    if (!rows.length) return;
    var d8 = String(meta.date8 || '');
    if (!/^\d{8}$/.test(d8)) return;
    var dateStr = d8.slice(0, 4) + '/' + d8.slice(4, 6) + '/' + d8.slice(6, 8);
    var dd = biasDoyOfDate(dateStr);
    if (!dd || dd.y >= day.y) return;
    if (!biasDoyNear(dd.doy, day.doy, 21)) return;              // 同じ時期(±3週)
    var surf = String(rows[0].surface || meta.surface || '');
    var m = parseInt(rows[0].dist || meta.dist || 0, 10);
    if (surface && surf && surf.indexOf(surface.charAt(0)) < 0) return;
    if (!m || Math.abs(m - dist) > 200) return;
    var win = rows.filter(function(r){ return parseInt(r.order, 10) === 1; })[0];
    var sec = win ? nkToSec(win.time || win.timeStr || '') : null;
    if (!sec) return;
    var vv = biasVenueOfText(meta.place || '');
    if (venue && vv === venue) out.venueHit++;
    out.list.push({ date: dateStr, m: m, sec: sec, venue: vv || String(meta.place || '') });
  });
  if (out.list.length){
    out.n = out.list.length;
    out.sec = out.list.reduce(function(a, b){ return a + b.sec; }, 0) / out.n;
    var sp = out.list.filter(function(x){ return x.sec; }).map(function(x){ return x.m / x.sec; });
    out.spd = sp.length ? sp.reduce(function(a, b){ return a + b; }, 0) / sp.length : 0;
  }
  return out;
}
function biasPastSamePeriod(venue, surface, dist){
  var a = biasPastFromHorsebook(venue, surface, dist);
  if (a.n >= 3) return a;
  var b = biasPastFromAnalysis(venue, surface, dist);
  if (b.n > a.n) return b;
  return a;
}
/* --- (1) 当日の時計 vs 同じ時期の過去 --- */
function biasTimeCheckHTML(){
  var split0 = biasRowsOfDay();
  var all = split0.day;                 // 別日の記録は「当日の時計」として混ぜない
  var tv = biasTargetVenue();
  var day = biasDayInfo();
  if (!all.length){
    return '<div class="card" style="margin-top:8px;border-color:var(--line2);background:linear-gradient(180deg,var(--card),var(--card))">' +
      '<div class="small" style="font-weight:700">⏱ 当日の時計チェック（同じ時期の過去との比較）</div>' +
      '<div class="small muted" style="margin-top:3px">前レースの記録がまだありません。上の「🔍 前レース結果を自動取込」を押すと、<b>その日の開催全場（例: 中山・阪神・中京）</b>のレース結果を取り込み、<b>競馬場ごとの表</b>で時計を比べます。</div></div>';
  }
  var groups = biasRacesByVenue(all);
  var h = [];
  h.push('<div class="card" style="margin-top:8px;border-color:var(--line2);background:linear-gradient(180deg,var(--card),var(--card))">');
  h.push('<div class="small" style="font-weight:700">⏱ 当日の時計チェック（同じ時期の過去＝' + esc(day.label) + '前後3週 との比較）</div>');
  h.push('<div class="small muted" style="margin:3px 0 5px">当日の勝ち時計を、<b>①同競馬場・同面・同じ距離帯(±200m)で「同じ時期(±3週)」の過去の勝ち時計</b>と、<b>②距離別の基準時計(パータイム)</b>の両方と比べます。速度(m/秒)で比べるため距離差があっても判定できます。<b>開催場ごとに表を分けています</b>（バイアスは競馬場で違うため）。</div>');
  h.push('<div class="small muted">本日の記録: <b>' + all.length + ' レース</b>（' + groups.map(function(g){ return esc(g.venue) + ' ' + g.races.length + 'R'; }).join('・') + '）' +
    (split0.other.length ? ' ／ 別日の記録 ' + split0.other.length + ' 件は集計から除外しています' : '') + '</div>');
  h.push('</div>');

  var allJudged = [];
  groups.forEach(function(grp){
    var ours = (tv.name && grp.venue === tv.name) ? true : false;
    var judged = [];
    var trs = grp.races.map(function(rc){
      var venue = grp.venue;
      var surface = String(rc.surface || '');
      var dist = parseInt(rc.dist, 10) || 0;
      var par = (rc.winSec && dist && surface) ? nkParSec(surface, dist, rc.baba) : null;
      var dPar = (par && rc.winSec) ? (rc.winSec - par) : null;
      var past = (venue && dist) ? biasPastSamePeriod(venue, surface, dist) : { n: 0 };
      var nowSpd = (rc.winSec && dist) ? dist / rc.winSec : null;
      var dSpd = (past && past.spd && nowSpd) ? (nowSpd - past.spd) : null;
      var verdict = '';
      if (dSpd != null){
        if (dSpd >= 0.08) verdict = '<b style="color:var(--ok-ink)">過去より速い</b>';
        else if (dSpd <= -0.08) verdict = '<b style="color:var(--err-ink)">過去より遅い</b>';
        else verdict = 'ほぼ同じ水準';
      } else if (dPar != null){
        verdict = dPar <= -1.0 ? '基準より速い' : (dPar >= 1.4 ? '基準より遅い' : 'ほぼ基準どおり');
      } else verdict = '<span class="muted">判定不可</span>';
      judged.push({ rc: rc, dPar: dPar, dSpd: dSpd, past: past });
      return '<tr><td style="text-align:left">' + esc(rc.label || rc.id) + '</td>' +
        '<td style="text-align:left">' + esc((surface || '?') + ' ' + (dist ? dist + 'm' : '') + ' ' + (rc.baba || '')) + '</td>' +
        '<td>' + esc(rc.winStr || (rc.winSec ? rc.winSec.toFixed(1) + 's' : '−')) + '</td>' +
        '<td>' + (dPar != null ? (dPar > 0 ? '+' : '') + dPar.toFixed(1) + 's' : '−') + '</td>' +
        '<td style="text-align:left">' + (past && past.n ? (past.sec.toFixed(1) + 's（' + past.n + '走・' + esc(past.src) + '）') : '<span class="muted">データなし</span>') + '</td>' +
        '<td>' + (dSpd != null ? (dSpd > 0 ? '+' : '') + dSpd.toFixed(2) + 'm/s' : '−') + '</td>' +
        '<td style="text-align:left">' + verdict + '</td></tr>';
    }).join('');
    allJudged = allJudged.concat(judged);
    var sp = judged.filter(function(j){ return j.dSpd != null; });
    var avg = sp.length ? sp.reduce(function(a, b){ return a + b.dSpd; }, 0) / sp.length : null;
    var pd = judged.filter(function(j){ return j.dPar != null; });
    var avgPar = pd.length ? pd.reduce(function(a, b){ return a + b.dPar; }, 0) / pd.length : null;
    var sumTxt;
    if (avg != null){
      sumTxt = avg >= 0.08 ? '<b>この開催は同じ時期の過去より速い（時計が出やすい馬場）</b>'
             : avg <= -0.08 ? '<b>この開催は同じ時期の過去より遅い（時計がかかる馬場）</b>'
             : '<b>この開催は同じ時期の過去とほぼ同じ時計水準</b>';
      sumTxt += '（平均 ' + (avg > 0 ? '+' : '') + avg.toFixed(2) + 'm/s・' + sp.length + 'レース）';
    } else {
      sumTxt = '<span class="muted">同じ時期の過去データがまだありません（馬柱取得や⑥重賞データ分析の実行で精度が上がります）</span>';
    }
    if (avgPar != null) sumTxt += '　基準時計(パー)との差は平均 ' + (avgPar > 0 ? '+' : '') + avgPar.toFixed(1) + 's';
    h.push('<div class="card" style="margin-top:8px;border-color:' + (ours ? 'var(--line2)' : 'var(--line2)') + '">');
    h.push('<div class="small" style="font-weight:700">🏇 ' + esc(grp.venue) + '開催（' + grp.races.length + 'レース）' +
      (ours ? '<span class="chip" style="margin-left:6px">対象レースと同じ場</span>' : '') + '</div>');
    h.push('<div style="overflow-x:auto"><table class="lr-tbl" style="font-size:.76rem;white-space:nowrap"><thead><tr>' +
      '<th style="text-align:left">レース</th><th style="text-align:left">条件</th><th>1着時計</th><th>対 基準時計</th>' +
      '<th style="text-align:left">同じ時期の過去(勝ち時計)</th><th>対 過去</th><th style="text-align:left">判定</th></tr></thead><tbody>' +
      trs + '</tbody></table></div>');
    h.push('<div class="small" style="margin-top:5px">📝 ' + sumTxt + '</div>');
    h.push('</div>');
  });

  // 全体（全場合計）の総合コメント
  var spds = allJudged.filter(function(j){ return j.dSpd != null; });
  var avgAll = spds.length ? spds.reduce(function(a, b){ return a + b.dSpd; }, 0) / spds.length : null;
  h.push('<div class="card" style="margin-top:8px;border-color:var(--line2);background:linear-gradient(180deg,var(--card),var(--card))">');
  h.push('<div class="small" style="font-weight:700">📊 本日 ' + groups.length + '場のまとめ</div>');
  if (avgAll != null){
    h.push('<div class="small" style="margin-top:3px">' +
      (avgAll >= 0.08 ? '本日は<b>全体に時計が出やすい（速い）</b>傾向' : (avgAll <= -0.08 ? '本日は<b>全体に時計がかかる（遅い）</b>傾向' : '本日の時計は<b>ほぼ例年並み</b>')) +
      '（平均 ' + (avgAll > 0 ? '+' : '') + avgAll.toFixed(2) + 'm/s・' + spds.length + 'レース）</div>');
  } else {
    h.push('<div class="small muted" style="margin-top:3px">同じ時期の過去データがまだありません。「📥 馬柱を取得（①の出馬表）」または「⑥重賞データ分析」を実行すると、同競馬場・同じ時期の過去の勝ち時計がキャッシュされ、ここに自動で反映されます。</div>');
  }
  h.push('<div class="small muted" style="margin-top:3px">※ AI印へ反映するバイアス判定は<b>対象レースと同じ競馬場（' + esc(tv.name || '不明') + '）</b>の記録だけを使います（他場の記録は参考表示）。</div>');
  h.push('</div>');
  return h.join('');
}
/* --- (2) 同競馬場開催かどうか --- */
function biasVenueCheckHTML(){
  var tv = biasTargetVenue();
  var splitV = biasRowsOfDay();
  var rows = splitV.day;      // 別日の記録を「当日取り込み済み」に混ぜない
  var h = [];
  h.push('<div class="card" style="margin-top:8px;border-color:var(--line2);background:linear-gradient(180deg,var(--card2),var(--card))">');
  h.push('<div class="small" style="font-weight:700">📍 同競馬場開催のチェック</div>');
  h.push('<div class="small muted" style="margin:3px 0 5px">トラックバイアスは<b>競馬場ごとに傾向が違う</b>ため、いま判定に使っているデータが「対象レースと同じ競馬場」のものかを確認できます。</div>');
  h.push('<div class="small">対象レース: <b>' + esc((state.race && state.race.name) || '') + '</b> ／ 開催場: <b>' + esc(tv.name || '不明') + '</b>' + (tv.code ? '（コード' + esc(tv.code) + '）' : '') + '</div>');
  if (!rows.length){
    h.push('<div class="small muted" style="margin-top:4px">当日（' + esc(biasDayInfo().label) + '）の前レース記録がまだありません（取り込むと、同じ競馬場かどうかを1レースずつ照合して表示します）。' +
      (splitV.other.length ? '<br>※ 別日の記録が ' + splitV.other.length + ' 件あります（当日の判定には使いません）。' : '') + '</div>');
  } else {
    var same = 0, diff = [];
    rows.forEach(function(rc){
      var v = biasRaceVenue(rc);
      if (!tv.name || !v || v === tv.name) same++;
      else diff.push({ rc: rc, v: v });
    });
    h.push('<div class="small" style="margin-top:3px">当日（' + esc(biasDayInfo().label) + '）取り込み済み ' + rows.length + 'レース: <b style="color:var(--ok-ink)">同競馬場 ' + same + '件</b>' +
      (diff.length ? ' ／ <b style="color:var(--err-ink)">別競馬場 ' + diff.length + '件</b>' : ' ／ 別競馬場 0件') +
      (splitV.other.length ? ' ／ <span class="muted">別日の記録 ' + splitV.other.length + '件は判定に不使用</span>' : '') + '</div>');
    if (diff.length){
      h.push('<div class="small" style="color:var(--err-ink)">⚠ 別競馬場のデータが混ざっています（バイアス判定から外すことを推奨）: ' +
        diff.map(function(x){ return esc((x.rc.label || x.rc.id) + '＝' + x.v); }).join(' / ') + '</div>');
      h.push('<div class="small muted" style="margin-top:2px">※ 以前の開催の記録が残っているとこの表示は消えません。' +
        '下のボタンで<b>別競馬場ぶんだけ削除</b>するか、<b>キャッシュを消して取り直し</b>てください（削除は「戻す」で復元できます）。</div>');
    } else {
      h.push('<div class="small" style="color:var(--ok-ink)">✅ すべて対象レースと同じ「' + esc(tv.name || '同') + '」開催のデータで判定しています。</div>');
    }
  }
  // キャッシュの一時削除と再取得（別競馬場の記録が残って表示が消えないとき用）
  (function(){
    var tv2 = biasTargetVenue();
    var sp2 = biasRowsOfDay();
    var diffN = 0;
    sp2.day.forEach(function(rc){
      var v = biasRaceVenue(rc);
      if (tv2.name && v && v !== tv2.name) diffN++;
    });
    var trashN = (state.biasTrash || []).length;
    h.push('<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">');
    h.push('<button type="button" class="btn ghost" data-biasact="dropvenue"' + (diffN ? '' : ' disabled') +
      ' title="対象レースと別の競馬場の記録だけを消します（当日の同競馬場ぶんは残る）">🧹 別競馬場ぶんだけ削除' +
      (diffN ? '（' + diffN + '件）' : '') + '</button>');
    h.push('<button type="button" class="btn ghost" data-biasact="refetch"' + (sp2.day.length ? '' : ' disabled') +
      ' title="当日の記録キャッシュをいったん全部消して、netkeiba から取り直します">♻️ キャッシュを消して取り直す（' + sp2.day.length + '件）</button>');
    if (trashN) h.push('<button type="button" class="btn ghost" data-biasact="untrash" title="さっき削除した記録を戻します">↩️ 削除を戻す（' + trashN + '件）</button>');
    if (sp2.other.length){
      h.push('<span class="small muted">別日の記録 ' + sp2.other.length + '件は判定に使っていません（「🧹 別日の記録を消す」は上のカード）</span>');
    }
    h.push('</div>');
  })();
  // 展開学習DBに含まれる他場レース
  if (typeof lnLoad === 'function'){
    try {
      var st = lnLoad();
      var es = (st && st.entries) || [];
      if (es.length){
        var sameN = 0, otherN = 0;
        es.forEach(function(e){
          if (!tv.name){ return; }
          if (String(e.place || '').indexOf(tv.name) >= 0) sameN++; else otherN++;
        });
        h.push('<div class="small" style="margin-top:4px">🎓 展開学習DB: 記録 ' + es.length + '件のうち <b>同競馬場(' + esc(tv.name || '?') + ') ' + sameN + '件</b>' +
          (otherN ? ' ／ 他場 ' + otherN + '件（同じ開催場のレースだけを優先して集計します）' : '') + '</div>');
      }
    } catch(e){}
  }
  h.push('</div>');
  return h.join('');
}

function renderBiasCard(){
  var box = $('biasBox'), sum = $('biasSummary');
  if (!box) return;
  var chip = $('biasChip');
  if (!state.biasRaces.length){
    if (chip){ chip.textContent = '未設定'; chip.className = 'chip warn'; }
    box.innerHTML = '<div class="empty" style="padding:18px"><div class="big" style="font-size:.98rem">まだ記録がありません</div>' +
      '<p class="small muted">対象レースの開催当日に、同じコースで走り終えた前レースの結果を取り込むと、今日の馬場傾向(トラックバイアス)を判定し、AI印の脚質評価に反映します（下の「🎓 展開学習」カードの「反映する」ON時のみAI印へ適用）。</p>' +
      '<button class="btn primary" id="btnBiasFetch">🔍 前レース結果を自動取込（netkeiba）</button>' +
      '<p class="small muted" style="margin-top:6px">※ 自動取込には出馬表URL取込と同じ中継設定が必要です。設定しない場合も、下の「手入力・テキストで追記」で1レースずつ記録できます。</p></div>' +
      biasTimeCheckHTML() + biasVenueCheckHTML();
  } else {
    var oneCell = function(rc){
      var mone = (rc.money || []).slice().sort(function(a,b){ return a.rank-b.rank; });
      var cells = mone.map(function(h){
        return '<div class="mk">' + esc(h.no) + (h.name ? '<span class="muted small"> ' + esc(h.name) + '</span>' : '') +
          '<span class="muted small">' + (h.odds ? ' ' + h.odds + '倍' : '') + '</span>' +
          bucketHTML(h) + '</div>';
      });
      while (cells.length < 3) cells.push('<div class="mk muted small">(未着)</div>');
      var par = (rc.winSec && rc.dist && rc.surface) ? nkParSec(rc.surface, rc.dist, rc.baba) : null;
      var diff = (par && rc.winSec) ? (rc.winSec - par) : null;
      var ag = rc.agariAvg != null ? '上' + rc.agariAvg : '';
      return '<div class="biascell" data-rid="' + rc.id + '">' +
        '<div class="browtop">' +
          '<b>' + esc(rc.label || rc.id) + '</b>' +
          '<span class="muted small">' + esc(rc.dist ? ((rc.surface||'芝') + ' ' + rc.dist + 'm') : '') + ' ' + esc(rc.baba||'') + '</span>' +
          '<span class="muted small">' + esc(rc.winStr || '') + (diff!=null ? ' <span class="' + (diff<-1?'tdown':'') + (diff>1.4?'tup':'') + '">(' + (diff>0?'+':'') + diff.toFixed(1) + 's)</span>' : '') + '</span>' +
          '<span class="muted small">' + ag + '</span>' +
          '<span class="sp"></span><button class="rowdel" data-del="1" title="この記録を消す">✕</button></div>' +
        '<div class="brow">' + cells.join('') + '</div></div>';
    };
    // 競馬場ごとに折り込んで表示（その日の全場を取り込んでも縦に伸びないように）
    var split = biasRowsOfDay();
    var groups = biasRacesByVenue(split.day);
    var dayLbl = (function(){ var d = biasDayInfo(); return d.label; })();
    var tvm = (typeof biasTargetVenue === 'function') ? biasTargetVenue() : { name:'' };
    var ghtml = groups.map(function(g){
      var isOurs = (tvm.name && g.venue === tvm.name);
      var trs = g.races.map(oneCell).join('');
      // 1日のレース数は最大12。それを超えていたら「別日が混ざっている」サインとして警告を出す
      var over = g.races.length > 12;
      return '<details class="card fold"' + (isOurs ? ' open' : '') + ' style="margin:8px 0">' +
        '<summary class="foldhead"><span class="fmark"></span>' +
        '<b>' + esc(g.venue) + '</b><span class="chip' + (over ? ' warn' : '') + '">' + g.races.length + 'レース' +
        (over ? '（⚠12R超＝別日が混在）' : '') + '</span>' +
        (isOurs ? '<span class="small" style="font-weight:400">対象レースと同じ場（AI印の判定に使用）</span>' : '<span class="small muted" style="font-weight:400">参考（判定には使いません）</span>') +
        '<span class="sp"></span><span class="foldhint"></span></summary>' +
        '<div class="foldbody"><div class="biasgrid">' + trs + '</div></div></details>';
    }).join('');
    box.innerHTML =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
      '<button class="btn primary" id="btnBiasFetch">🔍 前レースを追加取込</button>' +
      '<button class="btn ghost" id="btnBiasClr">記録をすべて消去</button>' +
      '<span class="small muted" style="align-self:center">当日（' + esc(dayLbl) + '） ' + groups.length + '場 / ' + split.day.length + 'レース記録済み' +
        (split.other.length ? ' ／ <b>別日の記録 ' + split.other.length + '件</b>（判定には使っていません）' : '') + '</span>' +
      (split.other.length ? '<button class="btn ghost" data-biasact="clearother" title="対象日以外の記録だけを消します">🧹 別日の記録を消す</button>' : '') +
      '</div>' +
      ghtml +
      '<div class="small muted" style="margin-top:6px">各馬の脚質（逃げ/先行/差し/追込）をクリックで設定・補正できます。netkeiba自動取込時は4角通過順から自動判定済みです（未入力は判定に含まれません）。</div>' +
      biasTimeCheckHTML() + biasVenueCheckHTML();
  }
  if (sum) sum.innerHTML = biasVerdictHTML(biasVerdict());
  // 手動指定の反映表示（chipはここで手動優先で上書き）
  if (typeof renderBiasManualRow === 'function') renderBiasManualRow();
}
/* 更新後に分析・表示を再描画 */
function showAnalysis(){
  if ($('kentaiBody') && !$('kentaiBody').classList.contains('hid')) renderKentaiFull();
}

/* 📍同競馬場開催のチェック: キャッシュの一時削除と再取得
   削除した行は state.biasTrash に入れておき「↩️ 削除を戻す」で復元できます。 */
function biasCacheAct(act){
  var tv = biasTargetVenue();
  var sp = biasRowsOfDay();
  if (act === 'untrash'){
    var back = state.biasTrash || [];
    if (!back.length) return;
    var have = {};
    (state.biasRaces || []).forEach(function(x){ have[x.id] = 1; });
    back.forEach(function(x){ if (!have[x.id]) state.biasRaces.push(x); });
    state.biasTrash = [];
    saveNow(); renderBiasCard(); showAnalysis();
    return;
  }
  if (act === 'dropvenue'){
    var drop = sp.day.filter(function(rc){
      var v = biasRaceVenue(rc);
      return !!(tv.name && v && v !== tv.name);
    });
    if (!drop.length) return;
    var ids = {};
    drop.forEach(function(rc){ ids[rc.id] = 1; });
    showConfirm('対象レース（' + (tv.name || '?') + '）と別の競馬場の記録 ' + drop.length + ' 件を削除しますか？\n（「↩️ 削除を戻す」で復元できます）', function(){
      state.biasTrash = drop.slice();
      state.biasRaces = (state.biasRaces || []).filter(function(x){ return !ids[x.id]; });
      saveNow(); renderBiasCard(); showAnalysis();
    });
    return;
  }
  if (act === 'refetch'){
    if (!sp.day.length) return;
    showConfirm('当日（' + biasDayInfo().label + '）の記録 ' + sp.day.length + ' 件を消して、netkeiba から取り直しますか？\n（別日の記録は残ります・「↩️ 削除を戻す」で復元できます）', function(){
      state.biasTrash = sp.day.slice();
      state.biasRaces = sp.other.slice();
      saveNow(); renderBiasCard(); showAnalysis();
      if (typeof nkBiasFetchAll === 'function') nkBiasFetchAll();
    });
  }
}
function initBias(){
  document.addEventListener('click', function(e){
    var t = e.target;
    var bk = t.closest && t.closest('[data-bk]');
    if (bk){
      var cell = bk.closest('.biascell'); if (!cell) return;
      var rid = cell.dataset.rid;
      var rankNo = null;
      // 対応馬: 行内の順番で特定するため、bucketボタンが含まれる .mk から該当horse indexを求める
      var mkDiv = bk.closest('.mk');
      var rc = state.biasRaces.filter(function(x){ return x.id === rid; })[0];
      if (!rc || !mkDiv) return;
      var mone = (rc.money||[]).slice().sort(function(a,b){ return a.rank-b.rank; });
      var idx = Array.prototype.indexOf.call(mkDiv.parentNode.children, mkDiv);
      var h = mone[idx];
      if (h){
        h.sty = bk.dataset.bk;
        h.bucket = { '逃げ':'front', '先行':'front', '差し':'mid', '追込':'back' }[h.sty] || h.bucket;
      }
      saveNow(); renderBiasCard(); showAnalysis();
      e.preventDefault(); return;
    }
    var ba = t.closest && t.closest('[data-biasact]');
    if (ba && ba.getAttribute('data-biasact') === 'clearother'){
      e.preventDefault();
      var sp = biasRowsOfDay();
      if (!sp.other.length) return;
      showConfirm('対象日（' + biasDayInfo().label + '）以外の ' + sp.other.length + ' レースの記録を消しますか？当日ぶんは残ります。', function(){
        state.biasRaces = sp.day.slice(); saveNow(); renderBiasCard(); showAnalysis();
      });
      return;
    }
    if (ba){
      var act = ba.getAttribute('data-biasact');
      if (act === 'dropvenue' || act === 'refetch' || act === 'untrash'){
        e.preventDefault();
        biasCacheAct(act);
        return;
      }
    }
    var mb = t.closest && t.closest('[data-bm]');
    if (mb){
      e.preventDefault();
      setBiasManual(mb.getAttribute('data-bm'));
      return;
    }
    var del = t.closest && t.closest('[data-del]');
    if (del){
      var c2 = del.closest('.biascell'); if (c2){
        state.biasRaces = state.biasRaces.filter(function(x){ return x.id !== c2.dataset.rid; });
        saveNow(); renderBiasCard(); showAnalysis();
        e.preventDefault(); return;
      }
    }
    if (t.id === 'btnBiasFetch'){ e.preventDefault(); nkBiasFetchAll(); }
    if (t.id === 'btnBiasClr'){
      e.preventDefault();
      showConfirm('トラックバイアスの記録をすべて消去しますか？', function(){
        state.biasRaces = []; saveNow(); renderBiasCard(); showAnalysis();
      });
    }
  });
  on('btnBiasPaste', 'click', function(){
    var txt = $('biasPasteTxt').value;
    var el = $('biasLog');
    if (!txt.trim()){ if(el) el.innerHTML = 'テキストを貼ってください'; return; }
    var races = nkBiasParseText(txt);
    if (!races.length){ if(el) el.innerHTML = '形式が読み取れませんでした（例: 阪神1R 芝1400 良 | 1着:3(2) 2着:7(5) 3着:1(9) | 1:21.3）'; return; }
    races.forEach(function(rc){
      var key = rc.label || ('manual'+Date.now());
      state.biasRaces = state.biasRaces.filter(function(x){ return x.id !== key && x.label !== rc.label; });
      rc.id = key;
      state.biasRaces.push(rc);
    });
    saveNow(); renderBiasCard(); showAnalysis();
    if(el) el.innerHTML = '✅ ' + races.length + 'レース分を記録しました';
  });
}

/* ★2026-09-12 第17弾: 事前予想(rec.pre)と一緒に保存する「当日のトラックバイアス予想」のスナップショット。
   レース前に何と判定していたかを残しておき、結果が出たときに
   「バイアスの事前予想が当たっていたか（前残り判定だったのに差しが決まった 等）」を
   後から検証できるようにする。p30 の apSnapPred() から呼ばれる。 */
function biasSnapshotFor(){
  try {
    var v = null;
    try { v = biasVerdict(); } catch(e){ v = null; }
    var manual = '';
    try { manual = String((typeof state !== 'undefined' && state && state.biasOverride) || ''); } catch(e){}
    var d8 = '', venue = '';
    try { if (typeof biasDay8 === 'function') d8 = biasDay8() || ''; } catch(e){}
    try { if (typeof biasTargetVenue === 'function') venue = biasTargetVenue() || ''; } catch(e){}
    // 当日ぶんも手動指定も無くても、前日の馬場から想定が作れていればそれを残す（第18弾）
    if (!v && !manual){
      var pv0 = null;
      try { if (typeof pbCurPrev === 'function' && pbUseOn()) pv0 = pbCurPrev(); } catch(e){}
      if (!pv0 || pv0.skip || pv0.frontScore == null) return null;
    }
    /* ★2026-09-12 第18弾: 実際にエンジンが使うバイアス（当日ぶん＋前日想定のブレンド）と、
       その元になった「前日の馬場」も一緒に残す。事前予想の検証で
       「バイアス想定が当たっていたか」を後から測れるようにするため。 */
    var used = null, prev = null;
    try { if (typeof biasStyleMul === 'function') used = biasStyleMul(); } catch(e){}
    try { if (typeof pbCurPrev === 'function') prev = pbCurPrev(); } catch(e){}
    var uv = (used && used.v) || null;
    return {
      at: (typeof apNow === 'function') ? apNow() : new Date().toISOString(),
      d8: d8, venue: venue, manual: manual,
      races: v ? (v.races || 0) : 0, known: v ? (v.known || 0) : 0,
      frontScore: v ? v.frontScore : null, posLabel: v ? (v.posLabel || '') : '',
      speedLbl: v ? (v.speedLbl || '') : '',
      mul: (v && typeof biasMulFromFront === 'function') ? biasMulFromFront(v.frontScore) : null,
      used: uv ? { frontScore: uv.frontScore, posLabel: uv.posLabel || '', mul: (used && used.mul) || null,
                   prevDay: !!uv.prevDay, blend: !!uv.blend, known: uv.known || 0 } : null,
      prev: (prev && !prev.skip) ? { d8: prev.d8, gap: prev.gap, venue: prev.venue, races: prev.races,
                                     known: prev.known, raw: prev.raw, frontScore: prev.frontScore,
                                     posLabel: prev.posLabel || '', rawLabel: prev.rawLabel || '',
                                     speedLbl: prev.speedLbl || '', baba: prev.baba || '' } : null
    };
  } catch(e){ return null; }
}
