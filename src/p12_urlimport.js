/* =========================================================
   netkeiba URL取込（出馬表HTML + 単勝オッズJSONP）
   ※ 出馬表HTMLはCORS制限のため、同サイトの小さな中継関数
      (/api/race) か、設定した
      リレーURL経由で取得します。単勝オッズはJSONPで直取得可能。
   ========================================================= */

var NK_ODDS_API = 'https://race.netkeiba.com/api/api_get_jra_odds.html';
var NK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function nkExtractRaceId(url){
  if (!url) return '';
  var s = String(url);
  var m = s.match(/race_id=(\d{10,12})/);
  if (m) return m[1];
  m = s.match(/(?:\/race\/|db\.netkeiba\.com\/race\/)(\d{10,12})/);
  if (m) return m[1];
  if (/^\d{10,12}$/.test(s.trim())) return s.trim();
  return '';
}
function nkDecode(s){
  return String(s == null ? '' : s)
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0*39;/g,"'")
    .replace(/&#x([0-9a-fA-F]+);/g, function(a,h){ return String.fromCodePoint(parseInt(h,16)); })
    .replace(/&#(\d+);/g, function(a,d){ return String.fromCodePoint(parseInt(d,10)); });
}
function nkStrip(html){
  return nkDecode(String(html||'').replace(/<[^>]*>/g,' ')).replace(/[ \t\u3000]+/g,' ').replace(/\s+/g,' ').trim();
}
function nkCleanName(s){ return nkStrip(s).replace(/\s+/g,' ').trim(); }

/* ===== リレー候補 ===== */
function nkRelayCandidates(){
  var list = [];
  var custom = state.urlRelay || '';
  if (custom) list.push(custom);
  // 同一配信の関数を優先（Vercel / Cloudflare Pages）
  list.push('/api/race');
  return list;
}

function nkFetchTimeout(url, ms){
  return new Promise(function(res, rej){
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, ms);
    fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store',
      headers: { 'Accept': 'text/html,application/json,*/*' } })
    .then(function(r){ clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return nkRespText(r, url); })
    .then(function(t){ res(t); })
    .catch(function(e){ clearTimeout(timer); rej(e); });
  });
}

/* =========================================================
   ★2026-09-13 第21弾①: 出馬表HTMLのキャッシュ（同じレースを2回取りに行かない）
   ---------------------------------------------------------
   症状: 「📥 その日の出馬表を一括取得」は全レースの出馬表を取りに行くのに、
         その下の「📅 日付を選んで出馬表を取込」でレースを選ぶと、
         さっき取ったばかりの【同じ出馬表】をもう一度 netkeiba に取りに行っていた
         （毎回数秒待ち・中継(リレー)にも無駄な負荷・失敗も2倍）。
   対策: 取得した出馬表HTMLを端末内に圧縮保存しておき、次からは通信ゼロで返します。
         ・当日/未来のレース → 30分だけ有効（出走取消・馬場変更などに追随するため）
         ・過去のレース      → 7日有効（内容は変わらないので取り直す意味がありません）
         ・opt.force=true（「🔄 取り直す」）でいつでも強制取得できます
   容量: 最大 NK_CARD_MAX 件＋期限切れを自動で掃除するので膨らみません。
         保存領域が足りなくなったら古いものから落として retry します
         （学習DB・AI予想の保存が第一優先なので、そちらは絶対に削りません）。
   ========================================================= */
var NK_CARD_LS = 'khl_card_v1';
/* ★2026-09-13 第23弾④: 「その日の出馬表を一括取得したら、どのレースを選んでも
   再取得せずパッと表示される」ようにするため、保持量と有効期間を見直しました。
     ・40件 → 80件（JRAは1日 3場×12R=36レース なので、**2日ぶん**まるごと持てます）
     ・当日 30分 → **その日の終わり(23:59:59)まで**
       従来は朝に一括取得しても30分で期限切れになり、午後には全レース取り直しになっていました。
       出走取消・馬場変更を追いたいときは「🔄 取り直す（再取得）」ボタンでいつでも強制取得できます。
     ・さらに「合計 2.5MB」の byte 上限も追加（localStorage 5MB を圧迫して
       学習DB・AI予想の保存を邪魔しないための安全弁。古いものから落とします）
   実測: 出馬表1レースぶんは圧縮後 約8KB（生HTML 48KB → deflate 13KB → 保存 7.8KB）。
        80件でも 約0.6MB なので余裕があります。 */
var NK_CARD_MAX = 80;                            // 出馬表 約80レースぶん（2日ぶん）
var NK_CARD_BYTES_MAX = 2.5 * 1024 * 1024;       // 出馬表キャッシュの合計上限（超えたら古い順に落とす）
var NK_CARD_TTL_NOW = 30 * 60 * 1000;            // （廃止・下参考）当日: 30分
var NK_CARD_TTL_MIN = 30 * 60 * 1000;            // 当日・未来でも最低これだけは持つ
var NK_CARD_TTL_PAST = 7 * 24 * 3600 * 1000;     // 過去: 7日
var NK_CARD_STAT = { hit: 0, miss: 0, set: 0, drop: 0 };

function nkCardToday8(){
  var d = new Date();
  return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
}
function nkCardEndOfDay(){ var d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }
/* 1件の有効期間（ms）。過去=7日 / 当日・未来=その日の終わりまで（最低30分） */
function nkCardTtlMs(it){
  var t = (it && it.t) || 0;
  if (!t) return 0;
  if (it && it.d8 && it.d8 < nkCardToday8()) return NK_CARD_TTL_PAST;
  var ms = nkCardEndOfDay() - t;
  return ms > NK_CARD_TTL_MIN ? ms : NK_CARD_TTL_MIN;
}
/* 保存済みデータの合計バイト数（localStorage に載る JSON 文字列ベースの概算） */
function nkCardBytes(o){
  var n = 0, h = (o && o.h) || {};
  for (var k in h){ if (h[k] && h[k].s) n += k.length + String(h[k].s).length + 40; }
  return n * 2;   // JS文字列は UTF-16 なので ×2
}
function nkCardLs(){
  try {
    var o = JSON.parse(localStorage.getItem(NK_CARD_LS) || 'null');
    if (!o || typeof o !== 'object' || !o.h) o = { h: {} };
    return o;
  } catch(e){ return { h: {} }; }
}
function nkCardSave(o){
  try { localStorage.setItem(NK_CARD_LS, JSON.stringify(o)); return true; }
  catch(e){
    // 保存領域がいっぱい → 古いものから半分落として1回だけ retry
    try {
      var ks = Object.keys(o.h || {}).sort(function(a, b){ return (o.h[a].t || 0) - (o.h[b].t || 0); });
      for (var i = 0; i < Math.ceil(ks.length / 2); i++){ delete o.h[ks[i]]; NK_CARD_STAT.drop++; }
      localStorage.setItem(NK_CARD_LS, JSON.stringify(o));
      return true;
    } catch(e2){ return false; }
  }
}
/* 期限切れ・件数超過の掃除（保存のたびについでにやる） */
function nkCardPrune(o){
  var ks = Object.keys(o.h || {}), dropped = 0;
  ks.forEach(function(k){
    var it = o.h[k];
    if (!it || !it.s){ delete o.h[k]; dropped++; return; }
    if (!it.t || (Date.now() - it.t) > nkCardTtlMs(it)){ delete o.h[k]; dropped++; }
  });
  var rest = Object.keys(o.h).sort(function(a, b){ return (o.h[a].t || 0) - (o.h[b].t || 0); });
  while (rest.length > NK_CARD_MAX){ delete o.h[rest.shift()]; dropped++; }
  /* ★第23弾④: 件数だけでなく合計バイトでも抑える（学習DB・AI予想の保存が第一優先） */
  var guard = 0;
  while (rest.length > 1 && nkCardBytes(o) > NK_CARD_BYTES_MAX && guard++ < 500){
    var k2 = rest.shift(); if (k2 == null) break;
    delete o.h[k2]; dropped++;
  }
  NK_CARD_STAT.drop += dropped;
  return dropped;
}
/* キャッシュから返せるか（返せればHTML文字列、だめなら null） */
function nkCardGet(rid){
  rid = String(rid || '');
  if (!rid) return null;
  var o = nkCardLs(), it = o.h[rid];
  if (!it || !it.s) return null;
  if (!it.t || (Date.now() - it.t) > nkCardTtlMs(it)){
    delete o.h[rid]; nkCardSave(o);
    return null;
  }
  try {
    var html = (typeof cmpUnpack === 'function') ? cmpUnpack(it.s) : it.s;
    if (!html || html.length < 300) return null;
    NK_CARD_STAT.hit++;
    return html;
  } catch(e){ return null; }
}
/* 保存済みかどうかだけ（呼び出し側が「キャッシュから復元」と表示するため） */
function nkCardHas(rid){ return !!nkCardGet(rid); }
/* ★第22弾: 出馬表HTMLの <title> からレース名を拾う
   （「チャレンジＣ(G3) 出馬表 | 2026年9月12日 阪神11R レース情報(JRA) - netkeiba」→「チャレンジＣ(G3)」）
   記事から参照したときに「何というレースの出馬表か」を出せるようにするため。 */
function nkCardNameFromHtml(html){
  var s = String(html == null ? '' : html);
  var m = s.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  var t = m[1].replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
  t = t.split(/[|｜]/)[0].trim();
  t = t.replace(/(出馬表|結果|払戻|レース情報).*/g, '').trim();
  return t.slice(0, 40);
}
function nkCardSet(rid, html, d8){
  rid = String(rid || '');
  if (!rid || !html || html.length < 300) return false;
  var o = nkCardLs();
  var body = (typeof cmpPack === 'function') ? cmpPack(html) : html;
  var nm = '';
  try { nm = nkCardNameFromHtml(html); } catch(e){}
  o.h[rid] = { t: Date.now(), s: body, d8: /^\d{8}$/.test(String(d8 || '')) ? String(d8) : '', n: html.length, name: nm };
  nkCardPrune(o);
  var okk = nkCardSave(o);
  if (okk) NK_CARD_STAT.set++;
  return okk;
}
function nkCardClear(){
  try { localStorage.removeItem(NK_CARD_LS); } catch(e){}
  NK_CARD_STAT.hit = NK_CARD_STAT.miss = NK_CARD_STAT.set = NK_CARD_STAT.drop = 0;
}
function nkCardCount(){
  var o = nkCardLs();
  return Object.keys(o.h || {}).length;
}

/* 出馬表HTMLをリレー経由で取得（★第21弾①: 取得済みなら通信せずキャッシュから返す）
   opt.force=true でキャッシュを無視して取り直す。opt.d8 があれば期限判定に使います。 */
/* ★第22弾: 出馬表HTMLから開催日(YYYYMMDD)を拾う。
   race_id の先頭8桁は**日付ではありません**（YYYYMM+回）。
   → race_id だけ分かって d8 を渡せない呼び出し元（記事からのレース参照など）でも、
     取得したページの見出し（「… | 2026年9月12日 阪神11R レース情報(JRA) - netkeiba」）から
     日付を拾ってキャッシュに持たせないと、過去のレースなのに TTL が当日扱い(30分)になり
     すぐ消えてしまいます。 */
function nkCardD8FromHtml(html){
  var s = String(html == null ? '' : html);
  var m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return '';
  return m[1] + ('0' + parseInt(m[2], 10)).slice(-2) + ('0' + parseInt(m[3], 10)).slice(-2);
}
function nkFetchCardText(raceId, opt){
  opt = opt || {};
  if (!opt.force){
    var cached = nkCardGet(raceId);
    if (cached) return Promise.resolve(cached);
  }
  NK_CARD_STAT.miss++;
  var u = 'https://race.netkeiba.com/race/shutuba.html?race_id=' + raceId;
  var candidates = nkRelayCandidates();
  var direct = true; // 最後に直接も試す(CORSが通る環境向け)
  var lastErr = null;
  return new Promise(function(res, rej){
    /* ★第21弾①: 取れたHTMLは必ずキャッシュに保存してから返す（次回は通信ゼロ）
       ★第22弾: d8 が渡されなかった場合はページ見出しから開催日を拾う（TTL判定に使う） */
    var okCard = function(t){
      try { nkCardSet(raceId, t, opt.d8 || nkCardD8FromHtml(t)); } catch(e){}
      res(t);
    };
    var tryNext = function(i){
      if (i >= candidates.length){
        if (direct){ direct = false; i = candidates.length; doDirect(); return; }
        rej(new Error('出馬表の取得に失敗しました。通信方法の設定が必要です（下の「URL取込の通信設定」を開いて手順をご確認ください）。' + (lastErr ? ' 詳細:' + lastErr.message : '')));
        return;
      }
      var base = candidates[i];
      var full = nkRelayBuild(base, u);
      nkFetchTimeout(full, 15000).then(function(t){
        var looksEmpty = !t || t.length < 300;
        var looksJson  = !looksEmpty && /^\s*[\{\[]/.test(t) && !/<html/i.test(t);
        if (looksEmpty || looksJson) { lastErr = new Error('中継応答が空(' + base + ')'); tryNext(i+1); return; }
        okCard(t);
      }).catch(function(e){ lastErr = e; tryNext(i+1); });
    };
    var doDirect = function(){
      fetch(u, { cache: 'no-store', headers: { 'Accept': 'text/html' } })
        .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return nkRespText(r, u); })
        .then(function(t){ okCard(t); })
        .catch(function(e){ rej(new Error('直接取得も失敗: '+e.message+'。※netkeiba側がCORS未対応のため、公開サイトからは中継設定が必要です。')); });
    };
    tryNext(0);
  });
}

/* 単勝オッズをJSONPで直取得（リレー不要） */
function nkFetchOddsJsonp(raceId){
  return new Promise(function(res, rej){
    var cbName = '__nkcb_' + Math.floor(Math.random()*1e6) + '_' + Date.now();
    var q = NK_ODDS_API + '?pid=api_get_jra_odds&input=UTF-8&output=jsonp&callback=' + cbName +
            '&race_id=' + raceId + '&type=1&action=init&sort=odds&compress=0';
    var done = false, timer = null;
    window[cbName] = function(data){ finish(null, data); };
    function cleanup(){
      if (window[cbName]) delete window[cbName];
      var s = document.getElementById('__nkjsonp');
      if (s && s.parentNode) s.parentNode.removeChild(s);
      if (timer) clearTimeout(timer);
    }
    function finish(err, data){
      if (done) return; done = true; cleanup();
      if (err) rej(err); else res(data);
    }
    timer = setTimeout(function(){ finish(new Error('オッズ取得がタイムアウトしました')); }, 15000);
    var sc = document.createElement('script');
    sc.id = '__nkjsonp';
    sc.src = q;
    sc.onerror = function(){ finish(new Error('オッズAPIへの接続に失敗しました')); };
    document.head.appendChild(sc);
  });
}

/* 単勝オッズの取得: ①同梱中継(odds関数)があればそこから(JSON)
   ②なければJSONPで直接取得（静的サイト・file://でも動く） */
function nkOddsApiEndpoints(){ return ['/api/odds']; }
function nkFetchOddsAny(raceId){
  var eps = nkOddsApiEndpoints(), k = 0;
  return new Promise(function(res, rej){
    function next(){
      if (k >= eps.length){
        // JSONPフォールバック
        nkFetchOddsJsonp(raceId).then(res).catch(rej);
        return;
      }
      var full = eps[k++] + '?race_id=' + raceId;
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 4000);
      fetch(full, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
        .then(function(r){ clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function(j){ if (j && j.data && j.data.odds) res(j); else next(); })
        .catch(function(){ clearTimeout(timer); next(); });
    }
    next();
  });
}

/* ===== 出馬表HTMLパース ===== */
function nkParseRaceMeta(html){
  var meta = { name:'', date:'', place:'', rnum:'', dist:'', surface:'', baba:'', startTime:'', grade:'', className:'' };
  // description 例: 2026年9月6日 阪神11R セントウルＳ(G2)の出馬表です。…
  var dm = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
  var desc = dm ? nkDecode(dm[1]) : '';
  var dmu = desc.match(/(\d{4}年\d{1,2}月\d{1,2}日)\s+([^\s]+?)(\d{1,2})R\s+(\S+?)(?:\(([^)]*)\))?\s*の出馬表/);
  if (dmu){
    meta.date = dmu[1]; meta.place = dmu[2]; meta.rnum = dmu[3];
    var nm = dmu[4].replace(/[Ｓ]/g,'S');
    var gr = dmu[5] || '';
    if (gr === 'G1' || gr === 'G2' || gr === 'G3') meta.grade = gr;
    else if (gr === 'L' || gr === 'OP') meta.grade = 'オープン';
    else if (gr === 'C1') meta.grade = '';
    meta.name = nm;
  } else {
    // フォールバック: h1.RaceName
    var h1 = html.match(/<h1 class="RaceName">([\s\S]*?)<\/h1>/i);
    if (h1) meta.name = nkCleanName(h1[1]).replace(/[Ｓ]/g,'S');
  }
  // title から開催(description失敗時)も補完
  if (!meta.place || !meta.date){
    var tm = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (tm){
      var t2 = nkCleanName(tm[1]);
      var tt = t2.match(/(\d{4}年\d{1,2}月\d{1,2}日)\s+([^\s|]+?)(\d{1,2})R/);
      if (tt){ if(!meta.date) meta.date = tt[1]; if(!meta.place){ meta.place = tt[2].replace(/^.*?\s/,''); meta.rnum = tt[3]; } }
    }
  }
  // RaceData01: 距離・芝ダ・発走・馬場
  var rd = html.match(/<div class="RaceData01">([\s\S]*?)<\/div>/);
  if (rd){
    var rdTxt = nkCleanName(rd[1]);
    var st = rdTxt.match(/(\d{1,2}:\d{2})\s*発走/);
    if (st) meta.startTime = st[1];
    var dm = rdTxt.match(/(芝|ダ(?:ート)?|障(?:害)?)?\s*(\d{3,4})m/);
    if (dm){ meta.surface = (dm[1] || '').replace(/ダート/,'ダ'); meta.dist = dm[2]; }
    var bm = rdTxt.match(/馬場[:：]\s*([^\s/]+)/);
    if (bm) meta.baba = bm[1];
  }
  // RaceData02: 開催地・クラス
  var rd2 = html.match(/<div class="RaceData02">([\s\S]*?)<\/div>/);
  if (rd2){
    var spans = (rd2[1].match(/<span[^>]*>([\s\S]*?)<\/span>/g) || []).map(function(s){ return nkCleanName(s); });
    for (var i=0;i<spans.length;i++){
      var t = spans[i];
      if (!meta.place && /^(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)$/.test(t)) meta.place = t;
      if (/新馬/.test(t)) meta.className = '新馬';
      else if (/未勝利/.test(t)) meta.className = '未勝利';
      else if (/1勝クラス|1勝|500万/.test(t)) meta.className = '1勝クラス';
      else if (/2勝クラス|2勝|1000万/.test(t)) meta.className = '2勝クラス';
      else if (/3勝クラス|3勝|1600万/.test(t)) meta.className = '3勝クラス';
      else if (/オープン/.test(t)) meta.className = 'オープン';
    }
  }
  return meta;
}

function nkParseShutuba(html){
  var horses = [];
  // テーブル内にネストがあるため <table> 開始位置から本物の </table> までを取得
  var start = html.search(/<table[^>]*class="[^"]*Shutuba_Table[^"]*"[^>]*>/i);
  if (start < 0) return horses;
  var depth = 0, seg = '', i = start;
  var reTag = /<\/?table\b[^>]*>/gi, m;
  var pos = start;
  while ((m = reTag.exec(html)) !== null){
    if (m.index < start) continue;
    if (m[0].charAt(1) === '/'){ depth--; if (depth === 0){ seg = html.slice(start, m.index); break; } }
    else depth++;
  }
  if (!seg) seg = html.slice(start);
  var rows = seg.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  rows.forEach(function(tr){
    if (/<th/i.test(tr)) return;
    var cells = tr.match(/<td([^>]*)>([\s\S]*?)<\/td>/gi);
    if (!cells) return;
    var h = { frame:'', no:'', name:'', sexAge:'', weight:'', jockey:'' };
    var bareiIdx = -1;
    for (var ci=0; ci<cells.length; ci++){
      var open = cells[ci].match(/^<td([^>]*)>/i)[1] || '';
      var cls = (open.match(/class="([^"]*)"/) || [,''])[1];
      var body = cells[ci].replace(/^<td[^>]*>/i,'').replace(/<\/td>$/i,'');
      var mW = cls.match(/(?:^|\s)Waku([1-8])(?:\s|$)/);
      if (mW && !h.frame){ h.frame = mW[1]; continue; }
      if (/Umaban/.test(cls) && !h.no){
        h.no = nkCleanName(body).replace(/\s/g,'');   // 馬番はセルの文字列
        continue;
      }
      if (/HorseInfo/.test(cls) && !h.name){
        // 馬名は db.netkeiba.com/horse リンクの title から（他img等を混ぜないため）
        var nmA = body.match(/<a[^>]*title="([^"]*)"[^>]*href="https:\/\/db\.netkeiba\.com\/horse\//i)
               || body.match(/<a[^>]*title="([^"]*)"[^>]*>/i);
        h.name = nmA ? nkCleanName(nmA[1]) : nkCleanName(body);
        /* ★第22弾: 末尾スラッシュ・クエリ付き（/horse/2022103995/?rf=link_news）でも拾えるようにした。
           実物の出馬表は /horse/2022105175 の形だが、netkeiba のニュース記事など一部ページは
           末尾に / や ?rf=… が付く。そこで競走馬IDを取りこぼすと
           「記事 → 該当馬」の照合が馬名頼みになり、改名・同名馬で誤爆しやすくなる。 */
        var hk = body.match(/href="https:\/\/db\.netkeiba\.com\/horse\/(\d{8,12})/i);
        if (hk) h.nk = hk[1];   // 過去成績から脚質をAI推定するための競走馬ID
        continue;
      }
      if (/Barei/.test(cls) && !h.sexAge){ h.sexAge = nkCleanName(body); bareiIdx = ci; continue; }
      if (/Jockey/.test(cls) && !h.jockey){
        var ja = body.match(/<a[^>]*title="([^"]*)"[^>]*>/i);
        h.jockey = ja ? nkCleanName(ja[1]) : nkCleanName(body);
        continue;
      }
      // 斤量セル(Bareiの直後の無装飾数値セル)
      if (bareiIdx >= 0 && ci === bareiIdx + 1 && !h.weight){
        var wv = nkCleanName(body);
        if (/^\d{2}(\.\d)?$/.test(wv)) h.weight = wv.replace(/\.0$/,'');
      }
    }
    if (h.no && /^\d{1,2}$/.test(h.no) && (h.name || h.sexAge)) horses.push(h);
  });
  var seen = {}, out = [];
  horses.slice().sort(function(a,b){ return parseInt(a.no,10) - parseInt(b.no,10); }).forEach(function(h){
    if (!seen[h.no]){ seen[h.no] = true; out.push(h); }
  });
  return out;
}

/* ===== オッズJSONパース ===== */
function nkParseOddsData(payload){
  // payload: コールバック除去済みオブジェクト { data:{odds:{1:{01:[odds,..,ninki]}}} }
  var res = { odds: [] };
  try {
    var d = payload && payload.data;
    var win = d && d.odds && d.odds['1'];
    if (!win) return res;
    Object.keys(win).forEach(function(key){
      var no = parseInt(key,10);
      var arr = win[key];
      var od = parseFloat(arr && arr[0]);
      var ninki = parseInt(arr && arr[2], 10);
      if (no >= 1 && no <= 18 && isFinite(od) && od > 1.0){
        res.odds.push({ no: no, odds: od, ninki: isFinite(ninki) ? ninki : null });
      }
    });
    res.odds.sort(function(a,b){ return a.no - b.no; });
  } catch(e){}
  return res;
}

/* ===== UI適用 ===== */
function applyNkRaceMeta(meta){
  var map = { '芝': '', 'ダート': '' };
  var dist = meta.dist || '';
  var surface = meta.surface || '';
  var babaRaw = meta.baba || '';
  var babaOpt = '';
  var babaMap = { '良':'fast','稍重':'good','重':'yield','不良':'soft','ダート': '' };
  if (surface.indexOf('ダ') >= 0 || surface.indexOf('ダート') >= 0){
    babaOpt = (babaRaw === '良') ? 'dirt_fast' : ((babaRaw===''||!babaRaw)?'dirt_fast':'dirt_seal');
  } else {
    babaOpt = babaMap[babaRaw] || '';
  }
  var nameParts = [];
  if (meta.date) nameParts.push(meta.date);
  if (meta.place && meta.rnum) nameParts.push(meta.place + meta.rnum + 'R');
  var nm = (meta.grade ? meta.grade + ' ' : '') + meta.name;
  if (nm.trim()) nameParts.push(nm);
  state.race.name = nameParts.join(' ');
  if (meta.place) state.race.place = meta.place;
  if (dist) state.race.dist = dist;
  if (surface) state.race.surface = surface;
  if (babaOpt) state.race.baba = babaOpt;
  if (meta.startTime) state.race.time = meta.startTime;
  if (meta.className && !/G\d/.test(meta.grade||'')) state.race.grade = meta.className;
  else if (meta.grade && /^G\d$/.test(meta.grade)) state.race.grade = meta.grade;
  syncRaceDomFromState(); refreshRaceLine();
}

function applyNkHorses(list, logLines){
  /* 既存の 調教・持ちタイム・上3F・脚質・印 を馬番で引き継ぎつつ置き換え。
     ★2026-09-13 第19弾③: 以前は「引き継ぐ項目を名前で見繕って mkHorse に渡す」方式だったため、
       後から追加した派生項目（last3rank＝上3Fの順位色 / timeSrc＝持ちタイムの出どころ /
       slowSrc・slowTouched＝出遅れ率の自動計算フラグ 等）が silently 抜け落ちて、
       「出馬表を出し直したら上3F・持ちタイムが抜ける」状態になっていました。
       ここでは【旧オブジェクトの全項目を土台に、netkeiba 由来の基本項目だけ上書き】する方式に変更し、
       今後項目が増えても勝手に消えないようにしました。 */
  var prev = {};
  state.horses.forEach(function(h){ if (h.no) prev[h.no] = h; });
  var next = list.map(function(p){
    var old = prev[p.no];
    var base = old ? old : {};
    var h = mkHorse({
      // netkeiba 出馬表から毎回取り直す基本項目
      frame: p.frame, no: p.no, name: p.name, sexAge: p.sexAge, weight: p.weight, jockey: p.jockey,
      nk: p.nk || base.nk || '',
      // 引き継ぐ項目（旧オブジェクトにあればそのまま）
      odds: base.odds || '', style: base.style || '', mark: base.mark || '',
      slow: base.slow, ninki: base.ninki || '',
      last3f: base.last3f || '', last3raw: base.last3raw || '', last3rank: base.last3rank || 0,
      prevD: base.prevD || '', time: base.time || '', timeSrc: base.timeSrc || '',
      yobi: base.yobi || '',
      ped: Array.isArray(base.ped) ? base.ped.slice() : (Array.isArray(p.ped) ? p.ped.slice() : [])
    });
    // mkHorse が知らない派生項目も丸ごと引き継ぐ（uid は既存のものを維持＝DOMやキャッシュの対応が崩れない）
    if (old){
      for (var k in old){
        if (!Object.prototype.hasOwnProperty.call(old, k)) continue;
        if (h[k] === undefined || h[k] === '' || h[k] === 0) h[k] = old[k];
      }
      if (old.uid) h.uid = old.uid;
    }
    return h;
  });
  var kept = 0;
  state.horses.forEach(function(h){ if (h.no && !list.some(function(p){ return p.no === h.no; }) && (h.yobi || h.time)) kept++; });
  state.horses = next;
  if (list.length){
    var dropped = 0;
    Object.keys(prev).forEach(function(no){
      if (!list.some(function(p){ return p.no === no; })) dropped++;
    });
    if (dropped) logLines.push('出馬表から外れた馬: ' + dropped + '頭（調教・持ちタイム等が残っていた場合は保持）');
  }
  rebuildHorseTable();
}

/* ===== メインエントリ ===== */
function nkLog(lines){ var el = $('urlLog'); if (el) el.innerHTML = lines.map(function(l){ return esc(l); }).join('<br>'); }
function nkBusy(b){ var b1=$('btnUrlCard'), b2=$('btnUrlOdds'); if (b1) b1.disabled = b; if (b2) b2.disabled = b; }

/* ===== 💾 端末の保存領域（localStorage）の表示と整理・2026-09-11 第11弾 =====
   保存領域がいっぱいになると setItem が黙って失敗し、
   「📊 合計集計が積み上がらない」「🧬 血統の抽出結果が出ない」等の症状が出ます。
   何が入っていて何が消せるかを見えるようにし、安全に消せるものだけをワンタッチで整理できるようにしました。 */
var STORE_DESC = [
  /* [キー(前方一致), 説明, 自動整理 safe|keep, 優先度の表示]
     🥇 keep+第一優先 = 学習DB・AI予想の学習（絶対に消さない。逼迫時は他を消してでも保存する）
     📌 keep+今の作業 = 出馬表・メモ・馬ノート・テーマ（自動整理では消さない。☑を入れれば手動で消せる）
     ♻️ safe          = また取り直せるキャッシュ（逼迫したら自動で消される・🧹で消える） */
  ['khl_di_',        '④ 学習DB（年指定で取り込んだ過去データ・JRA全レース）', 'keep', '🥇 第一優先'],
  ['khl_date_idb_on','④ 学習DBを IndexedDB で持つ設定', 'keep', '🥇 第一優先'],
  ['keiba_date_v1',  '④ 過去データ取込（学習DBの元になったデータ）', 'keep', '🥇 第一優先'],
  ['keiba_date_backup_', '④ 過去データ取込のバックアップ', 'keep', '🥇 第一優先'],
  ['khl_date_v1',    '④ 学習DBの索引', 'keep', '🥇 第一優先'],
  ['khl_tllearn_v1', '🎓 学習した基準時計（タイム換算＝④の学習の成果）', 'keep', '🥇 第一優先'],
  ['khl_timelv_v1',  '⏱ 前走タイムの評価・🎯/⚠️マーク（学習の成果）', 'keep', '🥇 第一優先'],
  ['keiba_ap_v1',    '② AI印の学習データ', 'keep', '🥇 第一優先'],
  ['khl_apm_',       '② AI印の学習（年月ごとの集計）', 'keep', '🥇 第一優先'],
  ['khl_ap_',        '② AI印の学習（レース別）', 'keep', '🥇 第一優先'],
  ['khl_aplearn_v1', '🎓 AI印の学習', 'keep', '🥇 第一優先'],
  ['khl_learn_v1',   '🎓 予想の学習', 'keep', '🥇 第一優先'],
  ['khl_style_v1',   '🏇 脚質の学習', 'keep', '🥇 第一優先'],
  ['khl_baba_v1',    '🟫 馬場別好走率の学習', 'keep', '🥇 第一優先'],
  ['keiba-lab-v1',   '①出馬表・レース情報・入力した内容（今の作業そのもの）', 'keep', '📌 今の作業'],
  ['khl_memo_v1',    '📝 メモ', 'keep', '📌 今の作業'],
  ['khl_rnotes_v1',  '📝 レースのメモ・結果メモ', 'keep', '📌 今の作業'],
  ['khl_horsebook_v1','📔 馬ノート（手入力）', 'keep', '📌 今の作業'],
  ['khl_theme_v1',   '🎨 画面の色（テーマ）の設定', 'keep', '📌 今の作業'],
  ['khl_hd_v1',      '🐎 馬柱キャッシュ（過去戦績・取得し直せます）', 'safe', '♻️ また取れます'],
  ['khl_bf_v1',      '🧬 血統・血統ファクターのキャッシュ（取得し直せます）', 'safe', '♻️ また取れます'],
  ['khl_ped_v1',     '🧬 血統表のキャッシュ（取得し直せます）', 'safe', '♻️ また取れます'],
  ['khl_dr_v1',      '📊 ⑥重賞データ分析のキャッシュ（取得し直せます）', 'safe', '♻️ また取れます'],
  ['keiba_nk_v1',    '🔗 netkeiba 取込のキャッシュ', 'safe', '♻️ また取れます'],
  ['keiba_gcl_v1',   '📅 重賞カレンダーのキャッシュ', 'safe', '♻️ また取れます'],
  ['keiba_tenki_v1', '☀️ 天気のキャッシュ', 'safe', '♻️ また取れます'],
  ['khl_kai_v2',     '📅 開催情報・レース一覧のキャッシュ', 'safe', '♻️ また取れます'],
  ['khl_hist_v1',    '🏛 このレースの過去データ（同名レースの過去成績）', 'safe', '♻️ また取れます'],
  ['khl_rs_v1',      '🔎 レース名検索のキャッシュ', 'safe', '♻️ また取れます'],
  ['khl_jra_v1',     '🏇 JRA公式（馬場情報など）のキャッシュ', 'safe', '♻️ また取れます'],
  ['khl_jra_video_v1','🎬 レース映像リンクのキャッシュ', 'safe', '♻️ また取れます'],
  /* ★2026-09-13 第26弾①: 🏇騎手・調教師DBは【学習DBと同等の優先度】に格上げしました。
     ご依頼「学習DBと同等の優先度とし、キャッシュは極力削除しない方向として
     いつでも色々な検索を可能とする」に対応します。
     → 'keep' なので storeMakeRoom() の自動整理では**絶対に消されません**。
       保存領域が逼迫しても、代わりに ♻️safe のキャッシュが削られます。 */
  ['khl_jdb_reg',    '🏇 騎手・調教師DB（名前→IDの登録簿・検索の土台）', 'keep', '🥇 第一優先'],
  ['khl_jdb_ent',    '🏇 騎手・調教師DB（成績・得意コース・今週の騎乗）', 'keep', '🥇 第一優先'],
  ['khl_jdb_combo',  '🏇 騎手×調教師の相性成績（回収率・馬券内率）', 'keep', '🥇 第一優先']
  /* khl_simagg_v1（📊合計集計）は第12弾で localStorage をやめて「③タブを開いている間だけのメモリ保持」に
     変更したので、この一覧には出しません（起動時に simAggDropOld() が旧データを削除します）。 */
];
/* 2026-09-11 第12弾: 保存の優先順位（STORE_LIMIT / storeMakeRoom / safeSetItem / storeTrimText）は
   p3_core.js に置きました（単体テストのように p12 を読み込まない環境でも動くようにするため）。
   ここでは分類表 STORE_DESC / storeDescOf と、💾保存領域の表示・整理UI を持ちます。 */
/* 学習DBがいまどこに保存されているか（IndexedDB なら localStorage の 5MB 制限の対象外） */
function storeDiWhere(){
  try {
    var mode = (typeof diMode !== 'undefined') ? diMode : '';
    var n = 0;
    try { if (typeof diCount === 'function') n = diCount(); } catch(e){}
    if (!n && typeof diLs === 'function'){ try { n = Object.keys(diLs().races || {}).length; } catch(e){} }
    if (mode === 'idb'){
      return '🥇 <b>学習DBの保存先: IndexedDB（大容量）</b> — 保存済み <b>' + n + ' レース</b>。' +
        'IndexedDB は localStorage の 5MB 制限の対象外（<b>ディスクの空き次第で数百MB〜GB級</b>）なので、' +
        '<b>取り込んだ過去データは圧縮しなくても全部そのまま持っておけます</b>。④の欄に「IndexedDB 大容量保存中: 目安 N MB」と出ます。';
    }
    var mark = false; try { mark = !!localStorage.getItem('khl_date_idb_on'); } catch(e){}
    if (mark){
      return '🥇 <b>学習DBの保存先: localStorage（5MB制限）</b> — 保存済み <b>' + n + ' レース</b>。' +
        '<span style="color:var(--bad-ink,#c00)">⚠ 以前は IndexedDB（大容量）に保存されていましたが、いまの環境では IndexedDB が使えていません</span>' +
        '（プライベートブラウズ／古いブラウザ／一部アプリ内ブラウザ）。④の欄の警告も確認してください。';
    }
    return '🥇 <b>学習DBの保存先: localStorage（5MB制限）</b> — 保存済み <b>' + n + ' レース</b>。' +
      'この環境では IndexedDB を使っていないので、<b>約 419 レース</b>が目安です（それ以上は古いレースから自動で入れ替わります）。' +
      'IndexedDB が使えるブラウザ（Chrome / Edge / Safari 16.4以降 / Firefox 113以降）なら容量は実質無制限になります。';
  } catch(e){ return '🥇 学習DBの保存先: 確認できませんでした'; }
}
function storeDescOf(k){
  for (var i = 0; i < STORE_DESC.length; i++){
    if (k === STORE_DESC[i][0] || k.indexOf(STORE_DESC[i][0]) === 0) return STORE_DESC[i];
  }
  return [k, '（その他のデータ）', 'keep', '📌 今の作業'];   // 不明なキーは消さない（安全側）
}
function storeMsg(t, err){
  var el = $('storeUse'); if (!el) return;
  el.innerHTML = t;
  el.style.color = err ? 'var(--bad-ink,#c00)' : '';
}
function storeUseRender(){
  var box = $('storeTbl');
  var u = storeUse();
  storeMsg(storeText() + storeTrimText() + (typeof cmpText === 'function' && cmpText() ? '<br><span class="small">' + cmpText() + '</span>' : ''));
  if (!box) return;
  /* 同じ種類のキー（khl_di_* など）はまとめて1行に */
  var groups = {};
  u.keys.forEach(function(x){
    var d = storeDescOf(x.k);
    var g = groups[d[0]] || (groups[d[0]] = { key: d[0], desc: d[1], risk: d[2], prio: d[3] || '📌 今の作業', n: 0, bytes: 0, keys: [] });
    g.n++; g.bytes += x.n; g.keys.push(x.k);
  });
  var gs = Object.keys(groups).map(function(k){ return groups[k]; });
  /* 🥇第一優先 → 📌今の作業 → ♻️また取れます の順に、同じ優先度内では大きい順 */
  var PRIO = { '🥇 第一優先': 0, '📌 今の作業': 1, '♻️ また取れます': 2 };
  gs.sort(function(a, b){
    var pa = PRIO[a.prio] != null ? PRIO[a.prio] : 1, pb = PRIO[b.prio] != null ? PRIO[b.prio] : 1;
    return pa - pb || b.bytes - a.bytes;
  });
  var h = [];
  h.push('<table class="ktbl" style="font-size:.76rem"><thead><tr><th>消す</th><th style="text-align:left">データ</th><th style="text-align:right">サイズ</th><th>件数</th><th>消したら</th></tr></thead><tbody>');
  gs.forEach(function(g){
    var mb = g.bytes / 1048576;
    var riskTxt = g.risk === 'safe' ? '<span style="color:var(--ok-ink)">♻️ また取り直せます<br>（足りなくなったら自動で削除）</span>'
                : g.prio === '🥇 第一優先' ? '<b style="color:var(--ok-ink)">🥇 第一優先<br>絶対に消しません</b>'
                : '<b style="color:var(--bad-ink,#c00)">📌 今の作業<br>消すと失われます（非推奨）</b>';
    h.push('<tr><td><input type="checkbox" class="st-del" data-key="' + esc(g.key) + '"' + (g.risk === 'safe' ? ' checked' : '') + '></td>' +
      '<td style="text-align:left"><code>' + esc(g.key) + (g.key.slice(-1) === '_' ? '*' : '') + '</code><br><span class="muted">' + esc(g.desc) + '</span></td>' +
      '<td style="text-align:right"><b>' + (mb >= 0.01 ? mb.toFixed(2) + 'MB' : Math.round(g.bytes / 1024) + 'KB') + '</b></td>' +
      '<td>' + g.n + '</td><td>' + riskTxt + '</td></tr>');
  });
  h.push('</tbody></table>');
  h.push('<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
    '<button type="button" class="btn ghost" id="btnStoreDel">🗑 ☑を削除して空きを作る</button>' +
    '<button type="button" class="btn ghost" id="btnStoreSafe">🧹 安全に消せるものだけ削除（取得し直せるキャッシュ）</button>' +
    '<span class="small muted">削除後は<b>ページを再読み込み</b>してください（メモリに残っている分を書き戻さないようにするため）。</span></div>' +
    '<div class="small muted" style="margin-top:6px">🥇 <b>学習DB（④で取り込んだ過去データ）と AI予想の学習データは第一優先</b>で残します。' +
    '保存領域が足りなくなったときは、♻️<b>また取り直せるキャッシュ（馬柱・血統・⑥分析・カレンダー・天気など）を自動で削除</b>して、' +
    '学習データの保存を優先します。<br>📊 シミュレーションの合計集計は<b>③のタブを開いている間だけのメモリ集計</b>になったので、保存領域は使いません。</div>' +
    '<div class="small" style="margin-top:6px;padding:6px 8px;border:1px dashed var(--line2);border-radius:8px">' + storeDiWhere() + '<br>' +
    (typeof cmpText === 'function' && cmpText() ? cmpText() + '（♻️また取り直せるキャッシュは <b>zlib 圧縮</b>して保存しています。実測で1レースぶん 9.8KB → 1.9KB、馬柱 42KB → 3KB）'
      : '♻️また取り直せるキャッシュは <b>zlib 圧縮</b>して保存します（この環境では圧縮ライブラリが使えないため生のままです）') + '</div>');
  box.innerHTML = h.join('');
  var bd = $('btnStoreDel'); if (bd) bd.addEventListener('click', function(){ storeDelChecked(false); });
  var bs = $('btnStoreSafe'); if (bs) bs.addEventListener('click', function(){ storeDelChecked(true); });
}
function storeDelChecked(safeOnly){
  var box = $('storeTbl'); if (!box) return;
  var want = {};
  if (safeOnly){
    STORE_DESC.forEach(function(d){ if (d[2] === 'safe') want[d[0]] = 1; });
    var u0 = storeUse();
    u0.keys.forEach(function(x){ var d = storeDescOf(x.k); if (d[2] === 'safe') want[d[0]] = 1; });
  } else {
    (box.querySelectorAll ? box.querySelectorAll('.st-del') : []).forEach(function(c){
      if (c.checked) want[c.getAttribute('data-key')] = 1;
    });
  }
  var ks = [];
  try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k) ks.push(k); } } catch(e){}
  var freed = 0, n = 0;
  ks.forEach(function(k){
    var d = storeDescOf(k);
    if (!want[d[0]]) return;
    var v = ''; try { v = localStorage.getItem(k) || ''; } catch(e){}
    freed += (k.length + v.length) * 2;
    try { localStorage.removeItem(k); n++; } catch(e){}
  });
  /* メモリ側のキャッシュも捨てる（書き戻しで復活しないように） */
  try { SIMAGG_MEM = null; } catch(e){}
  try { BF_LS_MEM = null; BF_HOLD_N = 0; BF_SAVE_OK = true; } catch(e){}
  try { HD_LS_MEM = null; } catch(e){}
  if (!n){
    storeUseRender();
    storeMsg('🧹 削除できる<b>「安全なキャッシュ」が見つかりませんでした</b>。いま入っているのは出馬表・メモ・学習データなど、消すと失われるものだけです。' + storeText(), false);
    try { if (typeof simAggRender === 'function') simAggRender(); } catch(e){}
    return;
  }
  storeUseRender();                       // 表と使用量を先に描き直してから…
  storeMsg('🧹 <b>' + n + ' 件</b>を削除して <b>' + (freed / 1048576).toFixed(2) + 'MB</b> 空けました。' + storeText() +
    '<br><b>ページを再読み込み（F5／引っ張って更新）してください。</b>', false);   // …結果のメッセージを出す（上書きされないように）
  try { if (typeof simAggRender === 'function') simAggRender(); } catch(e){}
}
/* 2026-09-11 第11弾: 「🔗 netkeiba URLから直接取込」はふだん閉じている（🔎検索がメイン）。
   取込に失敗したときだけ自動で開いて、URLを貼り直して再実行できるようにする。 */
function nkOpenManual(why){
  try {
    var d = $('urlManualFold');
    if (d && !d.open){
      d.open = true;
      nkLog(['🔗 URLから直接取り込む枠を<b>自動で開きました</b>（' + esc(why || '取得に失敗したため') + '）。' +
             'URLが入っていれば「①+② まとめて取込」をもう一度押せます。']);
    }
  } catch(e){}
}
function nkImportCard(){
  var rid = nkExtractRaceId($('urlImport').value);
  var log = [];
  if (!rid){ nkLog(['⚠ URLからレースIDを抽出できませんでした。例: https://race.netkeiba.com/race/shutuba.html?race_id=202609040211 のようなURLを貼ってください。']); return; }
  nkBusy(true);
  nkLog(['レースID ' + rid + ' を認識 → 出馬表を取得中…（初回は数秒かかります）']);
  nkFetchCardText(rid).then(function(html){
    var meta = nkParseRaceMeta(html);
    var list = nkParseShutuba(html);
    if (!list.length) throw new Error('出馬表の行を解析できませんでした。netkeiba側の表示変更の可能性があります。');
    state.raceId = rid; state.raceAt = Date.now(); saveNow();
    if (!state.horses.length){
      state.horses = list.map(function(p){
        return mkHorse({ frame:p.frame, no:p.no, name:p.name, sexAge:p.sexAge, weight:p.weight, jockey:p.jockey, nk:p.nk||'' });
      });
      rebuildHorseTable();
      log.push('✅ 出馬表 ' + list.length + '頭を入力しました');
    } else {
      log.push('出馬表 ' + list.length + '頭 を読み込み → 現在の' + state.horses.length + '頭と入れ替え…');
      applyNkHorses(list, log);
      log.push('✅ 出馬表を ' + list.length + '頭に入れ替えました（同じ馬番の調教・持ちタイム等は保持）');
    }
    if (meta.date || meta.name || meta.dist){
      applyNkRaceMeta(meta);
      log.push('📋 レース情報を自動入力: ' + esc(String(state.race.name || '')));
    }
    // 自己学習用: 開いているレースの馬データを記録
    if (typeof apEnsureLive === 'function'){ try { apEnsureLive(rid); } catch(e){} }
    log.push('👉 次に「単勝オッズを取込」または出馬表の目視確認をどうぞ');
    nkLog(log);
    nkBusy(false);
    updateGridHints();
  }).catch(function(e){
    log.push('⚠ ' + esc(e.message));
    log.push('💡 下の「URL取込の通信設定」→「🔧 中継を診断」を押すと、今の公開先で中継が動いているか・直し方が表示されます。');
    log.push('💡 よくある原因: index.html 単体だけを公開している → 中継(/api/race)が入りません。Vercel なら api/race.js、Cloudflare Pages なら functions/api/race.js を含めてフォルダごとデプロイすると直ります。');
    log.push('💡 中継なしでも動くもの: 「単勝オッズを取込」(JSONP)。出馬表はOCR・テキスト貼り付けでも入力できます。');
    nkLog(log);
    nkBusy(false);
    nkOpenManual('出馬表の取得に失敗');
  });
}

function nkImportOdds(){
  var rid = nkExtractRaceId($('urlImport').value);
  var log = [];
  if (!rid){ nkLog(['⚠ レースIDを抽出できませんでした。netkeibaのレースURLまたは race_id=◯◯ を入力してください。']); return; }
  nkBusy(true);
  nkLog(['単勝オッズを取得中…（レースID ' + rid + '）']);
  nkFetchOddsAny(rid).then(function(payload){
    state.raceId = rid; state.raceAt = Date.now(); saveNow();
    var p = nkParseOddsData(payload);
    if (!p.odds.length){
      // 空ならステータス表示
      var st = payload && payload.status;
      nkLog(['⚠ オッズがまだ取得できません（status: ' + esc(st||'不明') + '）。発走前の締切後に更新されることがあります。複勝オッズのみなど条件により空になる場合もあります。']);
      nkBusy(false); return;
    }
    var cnt = 0;
    p.odds.forEach(function(o){
      var idx = upsertByNo(o.no, { odds: String(o.odds) });
      if (idx >= 0) cnt++;
    });
    rebuildHorseTable();
    log.push('✅ 単勝オッズを ' + cnt + '頭分 反映しました');
    var fav = p.odds.slice().sort(function(a,b){ return (a.ninki||99) - (b.ninki||99); })[0];
    if (fav) log.push('現在の単勝1番人気: ' + fav.no + '番（' + fav.odds + '倍）');
    log.push('数値はリアルタイム更新分です。②AI印に反映されています。');
    nkLog(log);
    nkBusy(false);
    updateGridHints();
  }).catch(function(e){
    log.push('⚠ ' + esc(e.message));
    nkLog(log);
    nkBusy(false);
  });
}

function nkTestRelay(){
  var el = $('urlLog2');
  var custom = $('urlRelayInp').value.trim();
  if (el) el.innerHTML = '…接続テスト中';
  if (!custom){ if(el) el.innerHTML = 'カスタム中継URLが未入力です。'; return; }
  nkFetchTimeout(nkRelayBuild(custom, 'https://race.netkeiba.com/top/index.html'), 15000)
    .then(function(t){
      if (t && t.length > 500 && /netkeiba/i.test(t)){ if(el) el.innerHTML = '✅ 中継OK。このURLで出馬表の取得が可能です'; }
      else { if(el) el.innerHTML = '⚠ 応答はあるがnetkeibaの内容が返っていません。URLの指定( /fetch の有無)を確認してください'; }
      saveNow();
    })
    .catch(function(e){ if(el) el.innerHTML = '⚠ 接続失敗: ' + esc(e.message); });
}

/* ★2026-09-13 第19弾①: 「日付指定で出馬表を読み込む」とオッズが入らない不具合の修正。
   どの取込経路（🔎レース名検索 / 🔗URL直貼り / 📅日付指定・開催から選択）でも
   同じ「オッズ取得→出馬表に反映→②予想タブを再描画」を通すように、
   race_id だけを受け取る共通関数にまとめました。
   戻り値: Promise<{ok, cnt, fav, msg}>  （失敗しても reject せず msg に入れて返す） */
function nkOddsApplyById(rid){
  rid = String(rid || '');
  if (!rid) return Promise.resolve({ ok:false, cnt:0, fav:null, msg:'レースIDがありません' });
  if (typeof nkFetchOddsAny !== 'function' || typeof nkParseOddsData !== 'function'){
    return Promise.resolve({ ok:false, cnt:0, fav:null, msg:'オッズ取得機能が読み込まれていません' });
  }
  return nkFetchOddsAny(rid).then(function(payload){
    var p = nkParseOddsData(payload);
    if (!p.odds.length){
      var st = payload && payload.status;
      return { ok:false, cnt:0, fav:null,
        msg:'オッズが空でした（status: ' + (st == null ? '不明' : st) + '）。' +
            '発売前／発走後しばらくは単勝オッズが返らないことがあります。' };
    }
    var cnt = 0;
    p.odds.forEach(function(o){
      var patch = { odds: String(o.odds) };
      if (o.ninki) patch.ninki = String(o.ninki);
      var idx = upsertByNo(o.no, patch);
      if (idx >= 0) cnt++;
    });
    var fav = p.odds.slice().sort(function(a,b){ return (a.ninki||99) - (b.ninki||99); })[0] || null;
    return { ok:true, cnt:cnt, fav:fav, msg:'単勝オッズ ' + cnt + '頭分' + (fav ? '（1番人気 ' + fav.no + '番 ' + fav.odds + '倍）' : '') };
  }).catch(function(e){
    return { ok:false, cnt:0, fav:null, msg:'オッズ取得失敗: ' + ((e && e.message) || e) };
  });
}
/* ★2026-09-13 第23弾①: 「オッズがリアルタイムではない」への対応。
   ------------------------------------------------------------------
   定期ポーリング（30秒ごと等）は **しません**。netkeiba への通信を増やさないためです。
   代わりに、ユーザーが「見る・更新する」動きをしたときに必ず最新を取り直します。
     ・レースを読み込んだとき          （kaiImportByRaceId → 従来から取得済み）
     ・②AI予想タブを開いたとき          （goTab('t-kentai') → ★ここで追加）
     ・オッズのサブタブを開いたとき      （lvSwitch('odds') → 従来から取得済み）
     ・読み込み履歴から復元したとき      （kaiRestoreHist → ★ここで追加）
     ・「🔄 今すぐ最新オッズ」を押したとき（force → 間引きを無視）
   nkFetchOddsAny は cache:'no-store' なので、呼べば必ずサーバの最新が返ります。
   同じレースを短時間に何度も開いても通信が膨らまないよう、20秒は間を空けます。 */
var NK_ODDS_VIEW = { rid:'', at:0, busy:false, last:null };
var NK_ODDS_VIEW_MIN = 20 * 1000;
function nkOddsViewNote(html, isErr){
  var t = $('oddsFreshTxt'); if (t) t.innerHTML = html || '';
  var c = $('oddsFreshChip');
  if (c){
    c.textContent = NK_ODDS_VIEW.last && NK_ODDS_VIEW.last.ok
      ? 'オッズ更新 ' + new Date(NK_ODDS_VIEW.at).toLocaleTimeString('ja-JP')
      : 'オッズ未取得';
    c.style.background = NK_ODDS_VIEW.last && NK_ODDS_VIEW.last.ok ? '' : 'var(--card2)';
  }
  // 出馬表タブ側のライブ表示にも同じ時刻を出す（開いていれば見える）
  try { var ch = $('lvOddsChip'); if (ch && NK_ODDS_VIEW.last && NK_ODDS_VIEW.last.ok) ch.textContent = '更新 ' + new Date(NK_ODDS_VIEW.at).toLocaleTimeString('ja-JP'); } catch(e){}
}
function nkOddsRefreshForView(reason, opt){
  opt = opt || {};
  var rid = '';
  try { rid = String((typeof state !== 'undefined' && state && state.raceId) || ''); } catch(e){ rid = ''; }
  if (!rid) return Promise.resolve({ ok:false, skipped:'no-rid' });
  if (NK_ODDS_VIEW.busy) return Promise.resolve({ ok:false, skipped:'busy' });
  var now = Date.now();
  if (!opt.force && NK_ODDS_VIEW.rid === rid && NK_ODDS_VIEW.at && (now - NK_ODDS_VIEW.at) < NK_ODDS_VIEW_MIN){
    return Promise.resolve({ ok:false, skipped:'throttle' });
  }
  if (typeof nkOddsApplyById !== 'function') return Promise.resolve({ ok:false, skipped:'no-fn' });
  NK_ODDS_VIEW.busy = true; NK_ODDS_VIEW.rid = rid;
  /* 変わった頭数だけを数えるため、取得前のオッズを控えておく（★第23弾⑥） */
  var before = {};
  try { (state.horses || []).forEach(function(h){ before[String(h.no)] = String(h.odds == null ? '' : h.odds); }); } catch(e){}
  if (!opt.silent) nkOddsViewNote('<span class="muted">🔄 最新の単勝オッズを取得中…（' + esc(reason || '') + '）</span>');
  return nkOddsApplyById(rid).then(function(r){
    NK_ODDS_VIEW.busy = false; NK_ODDS_VIEW.last = r;
    // レースが切り替わっていたら（取得中に別のレースを読んだ）古い結果を反映しない
    var cur = ''; try { cur = String(state.raceId || ''); } catch(e){}
    if (cur !== rid){ NK_ODDS_VIEW.at = 0; return r; }
    NK_ODDS_VIEW.at = Date.now();
    if (!r || !r.ok){
      if (!opt.silent) nkOddsViewNote('⚠ ' + esc((r && r.msg) || 'オッズを取得できませんでした') +
        '（発売前・発走後しばらくは netkeiba が空を返します。出馬表の「単勝」欄に手入力しても②に反映されます）');
      return r;
    }
    /* ★2026-09-13 第23弾⑥: ここで rebuildHorseTable() を呼ぶと「全行のDOM再構築＋馬柱の自動入力＋
       上3F/持ちタイムの補完＋タイムレベル評価」まで走ってしまい、タブを開くたびに重くなります。
       オッズが変わったぶんだけセルを差し替え、**実際に値が変わったときだけ** ②を描き直します。 */
    var changed = 0;
    try {
      (state.horses || []).forEach(function(h){
        var k = String(h.no);
        if (before[k] !== String(h.odds == null ? '' : h.odds)) changed++;
      });
    } catch(e){}
    if (changed){
      try { nkOddsSyncCells(); } catch(e){}
      try { if (typeof saveNow === 'function') saveNow(); } catch(e){}
      try { if (typeof renderKentaiFull === 'function') renderKentaiFull(); } catch(e){}
      if (!opt.silent) nkOddsViewNote('✅ <b>' + esc(r.msg || '') + '</b> を取得し、<b>' + changed + ' 頭ぶんオッズが動いた</b>ので ②AI予想・軸/妙味/穴・買い目提案を描き直しました。' +
        '　<span class="muted">（' + esc(reason || '') + '／このタブを開くたびに自動で取り直します）</span>');
    } else if (!opt.silent){
      nkOddsViewNote('✅ ' + esc(r.msg || '') + ' を確認しました。<b>オッズは前回から変わっていません</b>（描き直しは不要なので行っていません）。' +
        '　<span class="muted">（' + esc(reason || '') + '）</span>');
    }
    r.changed = changed;
    return r;
  }).catch(function(e){
    NK_ODDS_VIEW.busy = false; NK_ODDS_VIEW.at = 0;
    if (!opt.silent) nkOddsViewNote('⚠ オッズ取得でエラー: ' + esc(String((e && e.message) || e)));
    return { ok:false, msg:String((e && e.message) || e) };
  });
}
/* ★2026-09-13 第23弾⑥: 出馬表の「単勝オッズ」セルだけを差し替える（行は再構築しない）。
   rebuildHorseTable() は全行のDOM再構築に加えて 馬柱の自動入力・上3F/持ちタイムの補完・
   タイムレベル評価 まで走るので、オッズ更新のたびに呼ぶと②のタブ開閉が重くなります。
   編集中のセルも壊さないよう、値が違うときだけ書き換えます。 */
function nkOddsSyncCells(){
  var tb = $('horseBody');
  if (!tb || !tb.querySelectorAll) return 0;
  var rows = tb.querySelectorAll('tr[data-uid]');
  var n = 0;
  for (var i = 0; i < rows.length; i++){
    var tr = rows[i];
    if (!tr.querySelector) continue;
    var noEl = tr.querySelector('input[data-f="no"]');
    var odEl = tr.querySelector('input[data-f="odds"]');
    if (!noEl || !odEl) continue;
    var no = String(noEl.value || '').trim();
    var h = null;
    try {
      (state.horses || []).forEach(function(x){ if (String(x.no) === no && !h) h = x; });
    } catch(e){}
    if (!h) continue;
    var val = String(h.odds == null ? '' : h.odds);
    if (String(odEl.value || '').trim() !== val){ odEl.value = val; n++; }
  }
  return n;
}
/* 出馬表を取り込んだ直後に呼ぶ（間引きを無視して必ず最新を取る） */
function nkOddsMarkFresh(rid){ NK_ODDS_VIEW.rid = String(rid || ''); NK_ODDS_VIEW.at = Date.now(); }

/* ★2026-09-13 第23弾①: ②AI予想タブの「🔄 今すぐ最新オッズ」ボタン。
   間引き（20秒）を無視して必ず取りに行きます。 */
function initOddsFresh(){
  var b = $('oddsFreshBtn');
  if (b && b.addEventListener){
    b.addEventListener('click', function(){
      if (typeof nkOddsRefreshForView === 'function') nkOddsRefreshForView('手動で更新しました', { force: true });
    });
  }
  nkOddsViewNote('このタブを開くと最新の単勝オッズを自動で取り直します（定期ポーリングはしません）。');
}

/* ★2026-09-13 第19弾①: レース日(YYYYMMDD)を state.raceDate8 に確定させる。
   これが入っていないと jlRaceD8() が「今日」を返し、
   ・前走（上3F・持ちタイム）の絞り込み日がずれる
   ・騎手の乗り替わり／休養／鉄砲の判定日がずれる
   ・履歴特徴(hfCurD8)がレース名のパース頼みになる
   という3つの不具合が起きます。取込のたびに必ず呼びます。 */
function nkSetRaceDate8(metaOrDate){
  var d8 = '';
  var raw = (metaOrDate && typeof metaOrDate === 'object') ? (metaOrDate.date || metaOrDate.date8 || '') : String(metaOrDate || '');
  try { d8 = (typeof jlD8 === 'function') ? jlD8(raw) : ''; } catch(e){}
  if (!/^\d{8}$/.test(d8)){
    // レース名に入っている日付からも拾う（applyNkRaceMeta が meta.date をレース名に埋めるため）
    try {
      if (typeof jlD8FromRaceName === 'function'){
        var d3 = jlD8FromRaceName();
        if (/^\d{8}$/.test(String(d3 || ''))) d8 = String(d3);
      }
    } catch(e){}
  }
  if (!/^\d{8}$/.test(d8)){
    try {
      if (typeof apDate8FromText === 'function'){
        var nm = (state && state.race && state.race.name) || '';
        var d2 = apDate8FromText(nm);
        if (/^\d{8}$/.test(String(d2 || ''))) d8 = String(d2);
      }
    } catch(e){}
  }
  if (/^\d{8}$/.test(d8)){ state.raceDate8 = d8; return d8; }
  return '';
}
function nkImportBoth(){
  var done = function(){ nkImportOdds(); };
  // 出馬表→オッズの順。出馬表失敗でもオッズは試す
  nkImportCardThen(done);
}
function nkImportCardThen(afterOk){
  var rid = nkExtractRaceId($('urlImport').value);
  if (!rid){ nkLog(['⚠ URLからレースIDを抽出できませんでした。netkeibaのレースURLを貼ってください。']); return; }
  nkBusy(true);
  var log = [];
  nkLog(['レースID ' + rid + ' を認識 → 出馬表を取得中…']);
  nkFetchCardText(rid).then(function(html){
    var meta = nkParseRaceMeta(html);
    var list = nkParseShutuba(html);
    if (!list.length) throw new Error('出馬表の行を解析できませんでした。');
    state.raceId = rid; state.raceAt = Date.now(); saveNow();
    if (!state.horses.length){
      state.horses = list.map(function(p){ return mkHorse({ frame:p.frame, no:p.no, name:p.name, sexAge:p.sexAge, weight:p.weight, jockey:p.jockey, nk:p.nk || '' }); });
    } else {
      log.push('出馬表 ' + list.length + '頭 を読み込み → 入れ替え…');
      applyNkHorses(list, log);
    }
    applyNkRaceMeta(meta);
    nkSetRaceDate8(meta);          // ★第19弾①: レース日を確定（前走データ・騎手成績の判定に使用）
    rebuildHorseTable();
    log.push('✅ 出馬表 ' + list.length + '頭 ＋ レース情報を取り込みました');
    log.push('👉 続けて単勝オッズを取得します…');
    nkLog(log);
    updateGridHints();
    nkBusy(false);
    if (afterOk) afterOk();
  }).catch(function(e){
    log.push('⚠ 出馬表取得失敗: ' + esc(e.message));
    nkLog(log);
    nkBusy(false);
    nkOpenManual('出馬表の取得に失敗');
    if (afterOk) afterOk(); // オッズだけでも試す
  });
}

/* ===== 中継(リレー)診断: 機能ごとに実際に使うURLを1つずつ叩いて結果を出す =====
   旧リレーをそのまま使うと「出馬表は取れるのに db.netkeiba.com のページが化けて返る」ことがあり、
   馬データ・全馬プロフィール・重賞データ分析だけが空になる。そこで機能ごとに切り分ける。 */
function nkDiagTargets(){
  var inp = $('urlImport');
  var rid0 = inp ? nkExtractRaceId(inp.value) : '';
  if (!rid0) rid0 = (state && state.raceId) || '';
  if (!/^\d{10,12}$/.test(rid0 || '')) rid0 = '202509040211';
  var now = new Date();
  var y = now.getFullYear();
  var d8 = (y * 10000 + (now.getMonth() + 1) * 100 + now.getDate());
  return [
    { name: '① 出馬表',            host: 'race.netkeiba.com',
      url: 'https://race.netkeiba.com/race/shutuba.html?race_id=' + rid0,
      sig: /Shutuba_Table|RaceName|HorseList|netkeiba/i, enc: /netkeiba/i },
    { name: '① 日付→1〜12R 一覧',  host: 'race.netkeiba.com',
      url: 'https://race.netkeiba.com/top/race_list.html?kaisai_date=' + d8,
      sig: /RaceList_Body|RaceList_Box|RaceList_DataList/i, allowEmpty: true,
      note: '開催のない日は0件でも正常です' },
    { name: '⑥ 重賞カレンダー(重賞日程)', host: 'race.netkeiba.com',
      url: 'https://race.netkeiba.com/top/schedule.html?year=' + y,
      sig: /schedule_list|重賞|RaceName|netkeiba/i, enc: /netkeiba/i },
    { name: '② トラックバイアス(結果ページ)', host: 'race.netkeiba.com',
      url: 'https://race.netkeiba.com/race/result.html?race_id=' + rid0,
      sig: /All_Result_Table|ResultTable|RaceName|netkeiba/i, enc: /netkeiba/i },
    { name: '① 馬データ/全馬プロフィール(DB馬ページ)', host: 'db.netkeiba.com',
      url: 'https://db.netkeiba.com/horse/2019105394/', sig: /db_prof_table|horse_title|競走馬|netkeiba/i },
    { name: '⑥ 重賞データ分析・過去データ(DBレースページ)', host: 'db.netkeiba.com',
      url: 'https://db.netkeiba.com/race/202509040211/', sig: /RaceData|race_table_01|netkeiba/i }
  ];
}
function nkDiagToken(base, target){
  return nkRelayBuild(base, target);
}
/* 1つのURLを生テキストで取得（文字化け判定もする） */
function nkDiagFetchOne(base, t, token){
  return new Promise(function(res){
    var url = token ? base : nkDiagToken(base, t.url);   // token: 既に組み立て済み
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 12000);
    fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store',
      headers: { 'Accept': 'text/html,application/json,*/*' } })
    .then(function(r){ clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function(raw){
      var garbled = (typeof nkLooksGarbled === 'function') && nkLooksGarbled(raw);
      var txt = (typeof nkRepairText === 'function') ? nkRepairText(raw) : raw;
      var okSig = t.sig.test(txt);
      var okEnc = t.enc ? t.enc.test(txt) : true;
      var fffd = (txt.match(/\uFFFD/g) || []).length;   // 文字コードが壊れて復元できないケースの検出
      res({ ok: !!(txt.length > 300 && okSig && okEnc), len: txt.length, garbled: garbled && okSig,
            broken: fffd > 20, fffd: fffd,
            looksPage: /netkeiba|開催|レース/i.test(txt), err: '' });
    })
    .catch(function(e){ clearTimeout(timer); res({ ok: false, len: 0, garbled: false, looksPage: false, err: (e && e.message) || String(e) }); });
  });
}
/* 診断結果を指定のメッセージ欄に出す（⑥/①の各カードの「🔧 通信を診断」ボタン用） */
function nkDiagRunInto(logId){
  var el = typeof logId === 'string' ? $(logId) : logId;
  if (el) el.innerHTML = '🔧 中継(リレー)を診断しています…（機能ごとに実際のURLを確認・数秒〜十数秒）';
  return nkDiagRelay({ silent: true }).then(function(sum){
    if (el) el.innerHTML = String(sum).split('\n').map(function(l){ return esc(l); }).join('<br>');
    return sum;
  });
}
/* cfg {silent:true, cb:function(summaryText, lines)} */
/* cfg {silent:true, cb:function(summaryText, lines)} */
function nkDiagRelay(cfg){
  cfg = cfg || {};
  var log2 = $('urlLog2');
  if (log2 && !cfg.silent) log2.innerHTML = '診断中…（機能ごとに実際のURLを確認します・数秒〜十数秒）';
  var targets = nkDiagTargets();
  var cands = [];
  if (state.urlRelay) cands.push(['カスタム中継(' + state.urlRelay + ')', state.urlRelay]);
  cands.push(['Vercel / Cloudflare Pages /api/race', '/api/race']);
  (typeof nkRelayPresets === 'function' ? nkRelayPresets() : []).forEach(function(p){
    if (!cands.some(function(c){ return c[1] === p.url; })) cands.push([p.name, p.url]);
  });
  return new Promise(function(done){
    var lines = [], anyOk = false, anyPost = false, badHost = {}, okHost = {}, usedRelay = '';
    var ci = 0;
    function nextCand(){
      if (ci >= cands.length || anyOk){ finish(); return; }
      var c = cands[ci++];
      var cOk = false, ti = 0;
      function nextTarget(){
        if (ti >= targets.length){
          // この中継のPOST対応（⑤JRA映像ナビ）を確認
          var jraUrl = 'https://www.jra.go.jp/JRADB/accessS.html';
          nkFetchTimeout(nkDiagToken(c[1], jraUrl) + '&method=POST&body=' + encodeURIComponent('cname=pw01sli00/AF'), 12000)
            .then(function(t){ if (/レース結果|pw01srl/i.test(t)){ anyPost = true; lines.push('✅ POST中継OK（⑤JRA映像ナビ）'); } })
            .catch(function(){})
            .then(function(){ nextCand(); });
          return;
        }
        var t = targets[ti++];
        nkDiagFetchOne(c[1], t).then(function(r){
          // 開催のない日は 0件(小さい応答)でも正常
          var emptyOk = !!t.allowEmpty && !r.err && r.looksPage && r.len < 4000;
          var ok = r.ok || emptyOk;
          var mark = r.ok ? (r.broken ? '⚠日本語が壊れて取得（中継の文字コード処理が古い可能性）'
                              : r.garbled ? '✅取得OK（文字コードを自動修復）' : '✅取得OK')
                   : (emptyOk ? '✅取得OK（この日は開催なし＝正常）' : '⚠取得できません');
          if (r.ok && r.broken) badHost[t.host] = true;
          if (ok){ cOk = true; okHost[t.host] = true; }
          else { badHost[t.host] = true; }
          lines.push(mark + '　' + t.name + (r.err ? '（' + r.err + '）' : (r.len ? '（' + r.len + 'byte）' : '')) +
            (r.ok && r.broken ? '　※同梱の最新リレーで再デプロイしてください（自動修復できませんでした）' : '') +
            (!ok && t.note ? '　※' + t.note : ''));
          nextTarget();
        });
      }
      nextTarget();
      var check = setInterval(function(){          // 1つの候補が終わったら次の候補へ
        if (anyOk || cOk){ clearInterval(check); if (cOk){ anyOk = true; usedRelay = c[0]; } }
      }, 300);
    }
    function finish(){
      lines.push('');
      if (!anyOk){
        lines.push('👉 中継(リレー)が1つも応答していません。');
        lines.push('　対処1: Vercel なら keiba-lab-vercel.zip（api/race.js 同梱）を、Cloudflare Pages なら keiba-lab-cloudflare-pages.zip（functions/api/race.js 同梱）をフォルダごとデプロイし直してください。index.html 単体では中継が動きません。');
        lines.push('　対処2: Cloudflare Worker（同梱 worker-relay.js）を作り、そのURLを「カスタム中継URL」に保存してください。');
        lines.push('💡 中継が無くても「単純オッズ(JSONP)」とOCR・手入力・テキスト貼り付けは動きます。');
      } else if (badHost['db.netkeiba.com'] && !okHost['db.netkeiba.com']){
        lines.push('⚠ 中継(' + (usedRelay || '') + ')は動いていますが、競走馬DB（db.netkeiba.com）だけ取得できません。');
        lines.push('　馬データ(上3F・前走)／全馬のプロフィール・戦績／重賞データ分析・過去データ／馬柱AI評価 はこのページを使うため、これらが空になります。');
        lines.push('　古い中継だと db.netkeiba.com が化けて返る・弾かれることがあります。同梱の最新版で再デプロイしてください。');
      } else {
        lines.push('👉 主要ページはすべて取得できています（使用中継: ' + (usedRelay || '') + '）。');
        lines.push('　それでも失敗する機能があれば、その画面に出た文言をそのままお知らせください。');
        if (!anyPost) lines.push('⚠ 「⑤ JRA映像」だけは POST 中継が必要です（リレーを最新版で再デプロイしてください）。');
      }
      var sum = lines.join('\n');
      if (log2 && !cfg.silent) log2.innerHTML = lines.map(function(l){ return esc(l); }).join('<br>');
      if (typeof cfg.cb === 'function') cfg.cb(sum, lines);
      done(sum);
    }
    nextCand();
  });
}
/* 中継を自動で選ぶ: 自前の中継（Vercel/Cloudflare/Deno/GAS）→ 公開プロキシ の順に試し、
   最初に成功したものを保存する。ホストを引っ越した直後にこれ1つ押せば繋がる。 */
function nkAutoPickRelay(){
  var el = $('urlLog2');
  if (el) el.innerHTML = '🔎 使える中継を探しています…（数秒〜十数秒。自前の中継 → 予備の公開プロキシの順に確認します）';
  var test = 'https://race.netkeiba.com/race/shutuba.html?race_id=202609040211';
  var cands = [];
  if (state.urlRelay) cands.push({ name:'カスタム中継', url: state.urlRelay });
  cands.push({ name:'Vercel/Cloudflare Pages (/api/race)', url:'/api/race' });
  cands = cands.concat(typeof nkRelayPresets === 'function' ? nkRelayPresets() : []);
  var lines = [], i = 0;
  function tryNext(){
    if (i >= cands.length){
      if (el) el.innerHTML = lines.join('<br>') + '<br>👉 <b>使える中継が見つかりませんでした。</b>通信設定の手順（同梱の「別ホストで運用する手順」）をご確認ください。';
      return;
    }
    var c = cands[i++];
    nkFetchTimeout(nkRelayBuild(c.url, test), 12000).then(function(t){
      var ok = t && t.length > 300 && /Shutuba_Table|RaceName|HorseList|netkeiba/i.test(t);
      if (!ok){
        lines.push('⚠ ' + c.name + ' → 応答はあるが内容が違います(' + (t ? t.length : 0) + 'byte)');
        return tryNext();
      }
      var prev = state.urlRelay || '';
      if (c.pub || !/^(\/|\.)/.test(c.url)) state.urlRelay = c.url;   // 相対パスの中継は保存不要
      saveNow();
      lines.push('✅ ' + c.name + ' で接続できました。');
      if (c.pub) lines.push('⚠ これは<b>予備の公開プロキシ</b>です（無料・アカウント不要ですが、遅い/不安定なことがあります）。自前の中継を用意できたら差し替えてください。');
      lines.push(state.urlRelay ? ('保存した中継URL: ' + state.urlRelay) : 'このまま（アプリ内蔵の中継候補）で使えます。');
      if (el) el.innerHTML = lines.join('<br>');
      var inp = $('urlRelayInp'); if (inp) inp.value = state.urlRelay || '';
      if (prev !== state.urlRelay && typeof drClearCache === 'function'){ /* キャッシュはそのままでOK */ }
    }).catch(function(e){
      lines.push('⚠ ' + c.name + ' → 接続できません（' + ((e && e.message) || e) + '）');
      tryNext();
    });
  }
  tryNext();
}
function initUrlImport(){
  var inp = $('urlRelayInp');
  if (inp) inp.value = state.urlRelay || '';
  on('btnUrlCard', 'click', nkImportCard);
  on('btnUrlOdds', 'click', nkImportOdds);
  on('btnUrlBoth', 'click', nkImportBoth);
  on('btnStoreUse', 'click', function(){ storeUseRender(); });
  on('btnStoreTrim', 'click', function(){ storeDelChecked(true); });
  try { storeUseRender(); } catch(e){}
  on('urlImport', 'keydown', function(e){ if (e.key === 'Enter') nkImportCard(); });
  on('btnRelaySave', 'click', function(){
    state.urlRelay = ($('urlRelayInp').value || '').trim();
    saveNow();
    var el = $('urlLog2'); if (el) el.innerHTML = '保存しました。「中継を診断」で確認できます。';
  });
  on('btnRelayTest', 'click', nkTestRelay);
  bindIf('btnRelayAuto', 'click', nkAutoPickRelay);
  on('btnRelayDiag', 'click', function(){ nkDiagRelay(); });
  bindIf('drDiag', 'click', function(){ nkDiagRunInto('drMsg'); });
  bindIf('gcDiag', 'click', function(){ nkDiagRunInto('gcMsg'); });
  bindIf('hdDiag', 'click', function(){ nkDiagRunInto('hdMsg'); });
  bindIf('btnNkDiag', 'click', function(){ nkDiagRunInto('nkLog'); });
}
