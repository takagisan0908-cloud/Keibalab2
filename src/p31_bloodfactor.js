/* =========================================================
   31 重賞オカルト血統ファクター（過去10年・自動検出）＋結果DB共通パーサ
   ---------------------------------------------------------
   - 対象: 現在読み込まれている重賞(G1〜G3)レース
   - 過去の同名レース(過去全成績表)から過去10年分の
     1〜3着(複勝圏)・1着(単勝)の馬を取得し、db.netkeibaの
     5代血統に「内包される祖先名」を自動マイニング
   - 「この祖先を持つ馬が何年に単勝/複勝圏を取ったか」を
     年別に集計し、ファクターとして表示
   - 主経路は ⑥重賞データ分析の集計結果(DR_LAST)からの抽出（同じ母集団）
   - オカルトレベル(非統計)なので、反映は「ONトグル＋全体スイッチ」で
     ON にしたものだけ AI印計算に僅かに加点
   - 深さは netkeiba の5代血統表まで（Marguerite等の極端に
     深い牝系名は掲載外のため検出不可。これは仕様として明記）
   ========================================================= */
var BF_LS = 'khl_bf_v1';
/* ===== 深掘り(10代)設定 ===== */
var BF_PED_V = 3;        // 血統キャッシュの形式(3=世代+系統つき)。古いものは取り直す
var BF_DEEP_GEN = 10;    // 目標世代(5代目の祖先の5代血統表 = 10代目まで)
var BF_SAVE_OK = true;   // 2026-09-11 第11弾: 端末の保存領域に書けたか（false＝表示はするが保存できていない）
var BF_DEEP_BUDGET = 1200;  // 1回の分析で新規取得する祖先ページの上限(暴走防止)
var BF_DEEP_MAXLITE = 700;  // 保持する祖先キャッシュ件数の上限(1件2.5KB≒1.8MB。超えたら古いものから間引き)
var BF_DEEP_MEM = {};    // 実行中のメモリキャッシュ(馬ID → 10代セット)
var BF_DEEP_STAT = { req: 0, hit: 0, miss: 0 };
var BF_SAVE_T = null;    // 保存デバウンス
var BF_G1 = 'G1', BF_G2 = 'G2', BF_G3 = 'G3';
/* 深掘り中(bfHold)は同じメモリ上オブジェクトを返す。
   → 4並列で祖先ページを取得しても「読んで書いて保存」で互いに消さない。 */
var BF_LS_MEM = null;
var BF_HOLD_N = 0;
function bfLsBlank(){ return { ped:{}, race:{}, set:{ on:{}, apply:false }, last:{} }; }
function bfLsNorm(o){
  if (!o || typeof o !== 'object') return bfLsBlank();
  if (!o.ped) o.ped = {}; if (!o.race) o.race = {}; if (!o.set) o.set = { on:{}, apply:false };
  if (!o.set.on) o.set.on = {}; if (o.set.apply == null) o.set.apply = false;
  if (!o.last) o.last = {}; return o;
}
function bfLs(){
  if (BF_LS_MEM) return BF_LS_MEM;
  try { return bfLsNorm(JSON.parse(cmpUnpack(localStorage.getItem(BF_LS)) || '{}')); }
  catch(e){ return bfLsBlank(); }
}
function bfHold(){
  BF_HOLD_N++;
  if (!BF_LS_MEM) BF_LS_MEM = bfLs();
}
function bfRelease(){
  BF_HOLD_N = BF_HOLD_N > 0 ? BF_HOLD_N - 1 : 0;
  if (!BF_HOLD_N && BF_LS_MEM){
    var o = BF_LS_MEM; BF_LS_MEM = null;
    try { if (BF_SAVE_T){ clearTimeout(BF_SAVE_T); BF_SAVE_T = null; } } catch(e){}
    bfSave(o);
  }
}

function bfSave(o){
  try { localStorage.setItem(BF_LS, cmpPack(JSON.stringify(o))); BF_SAVE_OK = true; return true; }
  catch(e){
    // 容量超過: 古い「祖先(深掘り用)」キャッシュから間引いて再試行
    for (var t = 0; t < 8; t++){
      if (!bfEvictLite(o, 80)) break;
      try { localStorage.setItem(BF_LS, cmpPack(JSON.stringify(o))); BF_SAVE_OK = true; return true; } catch(e2){}
    }
    /* 2026-09-11 第11弾: 保存に失敗したら黙って捨てない。
       BF_LS_MEM を保持して「このセッション中は表示・操作できるように」し、🔎検出結果に⚠️を出す。 */
    BF_SAVE_OK = false;
    try { if (!BF_LS_MEM) BF_LS_MEM = o; } catch(e3){}
    return false;
  }
}
/* 祖先(lite)キャッシュを古い順に n 件削除。削除したら true */
function bfEvictLite(o, n){
  try {
    var ped = (o && o.ped) || {};
    var ks = Object.keys(ped).filter(function(k){ return ped[k] && ped[k].lite; });
    if (!ks.length) return 0;
    ks.sort(function(a, b){ return String(ped[a].at || '').localeCompare(String(ped[b].at || '')); });
    var cut = Math.min(n || 80, ks.length);
    for (var i = 0; i < cut; i++) delete ped[ks[i]];
    return cut;
  } catch(e){ return 0; }
}
/* 深掘り中は保存をまとめ打ち(2MB級のJSONを毎回書くと重いので 2.5秒デバウンス) */
function bfSaveSoon(o){
  try {
    if (BF_SAVE_T) return;
    BF_SAVE_T = setTimeout(function(){ BF_SAVE_T = null; bfSave(o || bfLs()); }, 2500);
  } catch(e){ bfSave(o || bfLs()); }
}
function bfSaveFlush(){
  try {
    if (BF_SAVE_T){ clearTimeout(BF_SAVE_T); BF_SAVE_T = null; }
    bfSave(bfLs());          // hold 中なら BF_LS_MEM そのものが保存される
  } catch(e){}
}
function bfPruneDeep(o){
  try {
    var ped = (o && o.ped) || {};
    var ks = Object.keys(ped).filter(function(k){ return ped[k] && ped[k].lite; });
    if (ks.length <= BF_DEEP_MAXLITE) return;
    bfEvictLite(o, ks.length - BF_DEEP_MAXLITE);
  } catch(e){}
}

/* ---------- 共通: 取得 ---------- */
/* 深掘りは「本体3並列 × 祖先4並列」で最大12接続になってしまうので、
   ネットワーク実接続はここで全体4本までに絞る（中継のレート制限対策）。 */
var BF_GATE_MAX = 4, BF_GATE_N = 0, BF_GATE_Q = [];
function bfGatePump(){
  while (BF_GATE_N < BF_GATE_MAX && BF_GATE_Q.length){
    var job = BF_GATE_Q.shift();
    BF_GATE_N++;
    try { job(); } catch(e){ BF_GATE_N--; }
  }
}
function bfGate(fn){
  return new Promise(function(res, rej){
    BF_GATE_Q.push(function(){
      Promise.resolve().then(fn).then(function(v){ BF_GATE_N--; bfGatePump(); res(v); },
                                      function(e){ BF_GATE_N--; bfGatePump(); rej(e); });
    });
    bfGatePump();
  });
}
function bfGet(url){
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  return new Promise(function(res, rej){
    var cands = (typeof nkRelayCandidates === 'function') ? nkRelayCandidates() : [];
    var i = 0;
    function nxt(){
      if (i >= cands.length){ rej(new Error('中継なし')); return; }
      var b = cands[i++];
      var full = nkRelayBuild(b, url);
      (typeof nkFetchTimeout === 'function' ? nkFetchTimeout(full, 30000) : Promise.reject(new Error('no fetch')))
        .then(function(t){ if (!t || t.length < 400) nxt(); else res(t); })
        .catch(function(){ nxt(); });
    }
    nxt();
  });
}
function bfStrip(s){
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function(m, n){ try { return String.fromCharCode(parseInt(n, 10)); } catch(e){ return ''; } })
    .replace(/\s+/g, ' ').trim();
}
/* 祖先名の表示用: 国名かっこ等を除去（そのままの綴り） */
function bfDispName(s){
  var t = bfStrip(s);
  t = t.replace(/[\s]*[（(](?:米|英|加|愛|仏|独|伊|西|露|豪|蘭|香|NZ|USA|IRE|GB|FR|GER|AUS|ARG|BRZ|UAE)[)）]\s*$/, '');
  return t.replace(/\s+/g, ' ').trim();
}
/* 祖先名の正規化: 照合・キー用（小文字） */
function bfNormName(s){
  return bfDispName(s).toLowerCase();
}

/* ---------- 共通: db.netkeiba のレース結果(全着順)パーサ ----------
   取得行: order枠/no/馬名(＋競走馬ID)/性齢/斤量/騎手/タイム/着差/
   通過(コーナー通過順)/上り(後3F)/単勝/人気/馬体重(増減)/調教師 */
function bfParseDbResult(html){
  var out = { meta:{ name:'', date:'', date8:'', place:'', rnum:'', grade:'' }, rows:[], n:0 };
  if (!html) return out;
  var title = bfStrip((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  var sp = title.split('｜');
  out.meta.name = bfStrip(sp[0] || '').replace(/\s*(競馬データベース.*)$/, '');
  var dm = bfStrip(sp[1] || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dm){
    out.meta.date = dm[1] + '年' + (+dm[2]) + '月' + (+dm[3]) + '日';
    out.meta.date8 = dm[1] + ('0' + dm[2]).slice(-2) + ('0' + dm[3]).slice(-2);
  }
  // 開催場・レース番号・面/距離はページ全体から拾う
  // （DB結果ページは「4回阪神2日目」「11R」「芝右1200m」等が下方の smalltxt / racedata にある）
  var whole = bfStrip(html);
  var vm = whole.match(/(\d{1,2})回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉|大井|川崎|船橋|浦和|盛岡|水沢|門別|帯広|金沢|笠松|名古屋|園田|姫路|高知|佐賀|福山)/);
  if (vm) out.meta.place = vm[2];
  if (!out.meta.place && out.meta.date8){
    // 「4回阪神2日目」形式がない場合の保険: race_id の場コード(4-5桁目)
    var rmm = String(html).match(/race_id=(\d{12})/) || String(html).match(/db\.netkeiba\.com\/race\/(\d{12})/);
  }
  var rm = String(html).match(/<dt>\s*(\d{1,2})R\s*<\/dt>/) ||
           String(html).match(/class="active"[^>]*>(\d{1,2})R</) ||
           whole.match(/(\d{1,2})R\s*[／\/]|(?:^|\s)(\d{1,2})R(?:\s|$)/);
  if (rm) out.meta.rnum = rm[1] || rm[2];
  var sdm = whole.match(/(芝|ダート|ダ|障(?:害)?)\s*(?:右|左|直|内|外)?\s*(\d{3,4})\s*m/);
  if (sdm){
    out.meta.surface = /障/.test(sdm[1]) ? '障' : (/ダ/.test(sdm[1]) ? 'ダ' : '芝');
    out.meta.m = parseInt(sdm[2], 10) || 0;
    out.meta.dist = out.meta.surface + out.meta.m + 'm';
  }
  // 天候・馬場状態（🎓タイム換算の学習で使う）。例: 「天候 : 曇 / ダート : 良 / 発走 : 10:05」
  var wm = whole.match(/天候\s*[:：]\s*(晴|曇|雨|小雨|雪|小雪|霧)/);
  if (wm) out.meta.tenko = wm[1];
  var bmm = whole.match(/(?:芝|ダート|障害)\s*[:：]\s*(良|稍重|重|不良)/);
  if (bmm) out.meta.baba = bmm[1];
  var gm = title.match(/\((G[123])\)|^\s*(G[123])\s/);
  if (gm) out.meta.grade = gm[1] || gm[2];
  if (!out.meta.grade){
    var g2 = out.meta.name.match(/\((G|Jpn)(I{1,3}|[123])\)/i);
    if (g2){
      var lv = g2[2].toUpperCase();
      var num = (lv === 'I') ? 1 : (lv === 'II') ? 2 : (lv === 'III') ? 3 : parseInt(lv, 10);
      out.meta.grade = /JPN/i.test(g2[1]) ? ('Jpn' + num) : ('G' + num);
    }
  }

  // 全角/半角空白・改行を取り除いてラベル同士を比較する（ヘッダは <br/> 入りが多い）
  var seg = '';
  var tm = html.match(/<table[^>]*summary="全着順"[^>]*>([\s\S]*?)<\/table>/);
  if (tm) seg = tm[1];
  if (!seg){
    var tm2 = html.match(/<table[^>]*summary="レース結果"[^>]*>([\s\S]*?)<\/table>/);
    if (tm2) seg = tm2[1];
  }
  if (!seg){
    // 汎用: ヘッダ行(着順ラベル)を持つ最初のテーブル
    var tbs = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
    for (var k = 0; k < tbs.length; k++){
      var hdrs = (tbs[k].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || []);
      for (var q = 0; q < hdrs.length; q++){
        if (bfCl(bfStrip(hdrs[q])) === '着順'){
          seg = tbs[k].replace(/^<table[^>]*>/i, '').replace(/<\/table>$/i, '');
          break;
        }
      }
      if (seg) break;
    }
  }
  if (!seg) return out;
  function bfCl(s){ return String(s == null ? '' : s).replace(/[\s\u3000]/g, ''); }
  var trs = seg.split(/<tr[^>]*>/i);
  var labelIdx = null;
  var rows = [];
  trs.forEach(function(tr){
    if (!/<t[dh]/i.test(tr)) return;
    var hasTh = /<th[^>]*>/i.test(tr);
    var hasTd = /<td[ >]/i.test(tr) || /<td>/i.test(tr);
    var isHeader = hasTh && !hasTd;
    var tds = tr.split(/<t[dh][^>]*>/i).slice(1).map(function(x){ return x.replace(/<\/t[dh]>/i, ''); });
    if (isHeader){
      var want = ['着順','枠','馬番','馬名','性齢','斤量','騎手','タイム','着差','通過','上り','後3F','単勝','人気','馬体重','調教師'];
      labelIdx = {};
      tds.forEach(function(x, i){
        var n = bfCl(bfStrip(x));
        if (!n) return;
        for (var w = 0; w < want.length; w++){
          if (labelIdx[want[w]] == null && n.indexOf(want[w]) >= 0) labelIdx[want[w]] = i;
        }
      });
      return;
    }
    if (!labelIdx || labelIdx['馬名'] == null) return;
    var cells = tds.map(bfStrip);
    function c(name){
      var ix = (name === '枠番' && labelIdx['枠'] != null) ? labelIdx['枠'] : labelIdx[name];
      return (ix != null && cells[ix] != null) ? cells[ix] : '';
    }
    var order = parseInt(c('着順'), 10);
    var name = c('馬名');
    if (isNaN(order) || !name) return;   // データ行のみ（取消等は着順なし）
    var idM = (tds[labelIdx['馬名']] || '').match(/\/horse\/([0-9a-z]{8,})\//);
    rows.push({
      order: order, frame: c('枠番'), no: c('馬番'), name: name, id: idM ? idM[1] : '',
      sexAge: c('性齢'), weight: c('斤量'), jockey: c('騎手'), time: c('タイム'),
      margin: c('着差'), passing: c('通過'), last3: c('上り') || c('後3F'),
      odds: c('単勝'), pop: c('人気'), weightChg: c('馬体重'), trainer: c('調教師')
    });
  });
  rows.sort(function(a, b){ return a.order - b.order; });
  out.rows = rows;
  out.n = rows.length;
  // 払戻金(単勝/複勝/枠連/ワイド/馬連/馬単/3連複/3連単)。結果確定後のページにのみ載る
  //   out.payouts = 的中1件ごとの生リスト / out.payout = 券種ごとの {nos,pays} 正規化マップ
  try { out.payouts = bfParsePayback(html); } catch(e){ out.payouts = null; }
  out.payout = bfPayoutMap(out.payouts);
  return out;
}

/* =========================================================
   結果ページの「払戻金」を全券種(単勝/複勝/枠連/ワイド/馬連/馬単/3連複/3連単)で抽出。
   race.netkeiba.com/race/result.html と db.netkeiba.com/race/{rid}/ の両形式に対応:
     - race.netkeiba形式: <tr class="Tansho">…<td class="Result">..</td><td class="Payout">..</td></tr>
     - db形式:            <tbody class="Tansho"><tr>…<td class="Result">..</td><td class="Payout">..</td></tr></tbody>
   戻り値: 配列(1要素=1つの「的中した組み合わせ」)
     { t:'tan'|'fuku'|'wakuren'|'umaren'|'wide'|'umatan'|'sanfuku'|'santan',
       nos:[馬番…], yen:払戻額(円・100円単位) }
   払戻セクションが無い/解析不能なら null を返す。
   ========================================================= */
var BF_PAY_CLS = { Tansho:'tan', Fukusho:'fuku', Wakuren:'wakuren', Umaren:'umaren',
                   Wide:'wide', Umatan:'umatan', Fuku3:'sanfuku', Tan3:'santan' };
function bfPayYens(cell){
  var ys = [], re = /(\d[\d,]*)\s*円/g, mm;
  while ((mm = re.exec(cell || '')) !== null) ys.push(parseInt(mm[1].replace(/,/g, ''), 10));
  return ys;
}
/* Resultセル内の「1つの的中組み合わせ」を、並んでいる数だけグループ化して返す。
   ・<li>付きの<ul>が複数 = 複数の的中組み合わせ(ワイド等) → ul 単位
   ・非空の<span>が並ぶ = 複数の単番(複勝等) → span 単位
   ・それ以外(テキストのみ "2-4" / "4→2" 等) → 全数字を1グループに */
function bfPayGroups(cell){
  cell = String(cell || '');
  var uls = cell.match(/<ul[^>]*>[\s\S]*?<\/ul>/g);
  if (uls && uls.length){
    return uls.map(function(u){
      var d = [], r = /(\d{1,2})/g, m;
      while ((m = r.exec(u)) !== null) d.push(parseInt(m[1], 10));
      return d;
    });
  }
  var sps = cell.match(/<span[^>]*>([\s\S]*?)<\/span>/g);
  var groups = [];
  if (sps && sps.length){
    sps.forEach(function(sp){
      var t = sp.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (/\d/.test(t)){
        var d = [], r = /(\d{1,2})/g, m;
        while ((m = r.exec(t)) !== null) d.push(parseInt(m[1], 10));
        groups.push(d);
      }
    });
    if (groups.length) return groups;
  }
  var ns = [], r2 = /(\d{1,2})/g, m2, txt = cell.replace(/<[^>]*>/g, '');
  while ((m2 = r2.exec(txt)) !== null) ns.push(parseInt(m2[1], 10));
  return ns.length ? [ns] : [];
}
function bfParsePayback(html){
  html = String(html || '');
  if (html.indexOf('払戻') < 0) return null;
  var seg = html;
  var secM = html.match(/<section class="Race_Payback">[\s\S]*?<\/section>/);
  if (!secM) secM = html.match(/<div class="Result_Pay_Back[^>]*">[\s\S]*?(?:<\/div>\s*<\/div>|<\/table>|<\/section>|<!-- \/\.Result_Pay_Back -->)/);
  if (secM) seg = secM[0];
  var out = [];
  // 開始タグ(tbody|tr)と対応する終了タグを後方参照 \1 で揃える
  var contRe = /<((?:tbody|tr))\s+class="(Tansho|Fukusho|Wakuren|Umaren|Wide|Umatan|Fuku3|Tan3)"[^>]*>([\s\S]*?)<\/\1>/g;
  var cm;
  function pushOne(trHTML, kind){
    var resM = /<td[^>]*class="Result"[^>]*>([\s\S]*?)<\/td>/i.exec(trHTML);
    var payM = /<td[^>]*class="Payout"[^>]*>([\s\S]*?)<\/td>/i.exec(trHTML);
    if (!resM || !payM) return;
    var groups = bfPayGroups(resM[1]);
    var yens = bfPayYens(payM[1]);
    if (groups.length && groups.length === yens.length){
      for (var q = 0; q < groups.length; q++) out.push({ t: kind, nos: groups[q], yen: yens[q] });
    } else if (groups.length === 1 && yens.length === 1){
      out.push({ t: kind, nos: groups[0], yen: yens[0] });
    }
  }
  while ((cm = contRe.exec(seg)) !== null){
    var tag = cm[1], kind = BF_PAY_CLS[cm[2]];
    if (!kind) continue;
    var inner = cm[3];
    if (tag === 'tbody'){
      // tbody内の各行(tr) = 1つの的中組み合わせ
      var trs = inner.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
      if (trs && trs.length) trs.forEach(function(tr){ pushOne(tr, kind); });
    } else {
      // <tr class="..">形式: その tr 内に1券種分の的中(複数の場合は ul/span で並ぶ)
      pushOne(inner, kind);
    }
  }
  return out.length ? out : null;
}
/* bfParsePayback の生リスト → 券種キー別の { nos:[組み合わせ文字列], pays:[払戻円] } へ正規化。
   win=Tansho(単勝) place=Fukusho(複勝) wakuren/umaren/wide/umatan/sanfuku/santan に対応。
   既存の rec.result.payout.win / .place({nos,pays}) 形式と互換のまま、単勝以外も同形式で保持する。 */
var BF_PAY_KEY = { tan:'win', fuku:'place', wakuren:'wakuren', umaren:'umaren', wide:'wide', umatan:'umatan', sanfuku:'sanfuku', santan:'santan' };
function bfPayoutMap(payouts){
  var m = { win:null, place:null, wakuren:null, umaren:null, wide:null, umatan:null, sanfuku:null, santan:null };
  if (!payouts || !payouts.length) return m;
  var acc = {};
  payouts.forEach(function(it){
    if (!it || !it.t) return;
    var k = BF_PAY_KEY[it.t];
    if (!k) return;
    var grp = acc[k] = acc[k] || { nos: [], pays: [] };
    var sep = (it.t === 'umatan' || it.t === 'santan') ? '→' : '-';
    grp.nos.push(String((it.nos || []).join(sep)));
    grp.pays.push(it.yen || 0);
  });
  for (var key in m){ if (acc[key]) m[key] = acc[key]; }
  return m;
}

/* ---------- 共通: 5代血統表 → 祖先名セット（世代つき） ----------
   netkeiba の 5代血統表は「父系16行」＋「母系16行」の2ブロックで、本馬は表に含まれない。
   各ブロックは rowspan が 16,8,8,4,4,4,4,2,… の完全2分木（深さ優先順にセルが並ぶ）なので、
   セル順＋rowspan から「何代目の祖先か」を復元できる。ブロックの根 = 父 / 母 = 1代目。
   → g5（5代目の祖先ID・最大32件）を控えておけば、その馬たちの5代血統表を辿るだけで
     6〜10代目まで名前が手に入る（bfPedDeep）。 */
function bfParsePed(html){
  var o = { names: {}, disp: {}, males: {}, females: {}, gen: {}, ln: {}, g5: [], g5l: {}, count: 0, v: BF_PED_V };
  if (!html) return o;
  var m = html.match(/<table[^>]*summary="5代血統表"[^>]*>([\s\S]*?)<\/table>/);
  if (!m) return o;
  var seg = m[1];
  var cellRe = /<td[^>]*class="(b_ml|b_fml)"[^>]*>([\s\S]*?)<\/td>/gi, cm;
  var cells = [];
  while ((cm = cellRe.exec(seg)) !== null){
    var rsm = cm[0].match(/rowspan="(\d+)"/);
    cells.push({ sex: cm[1], body: cm[2], rs: (rsm ? (parseInt(rsm[1], 10) || 1) : 1) });
  }
  var stack = [], p = 0, blk = 0;   // p = ブロック内の行カーソル（rowspan=1 の葉が1行消費）
  cells.forEach(function(c){
    while (stack.length && stack[stack.length - 1].end <= p) stack.pop();
    if (!stack.length && p > 0){ p = 0; blk++; }             // 新ブロック（母系）の開始
    var par = stack.length ? stack[stack.length - 1] : null;
    var gen = (par ? par.gen : 0) + 1;
    // 経路: 先頭の子=父(s)・2番目の子=母(d)。ブロックの根は 父(s) / 母(d)
    var path = par ? (par.path + (par.kids === 0 ? 's' : 'd')) : (blk === 0 ? 's' : 'd');
    if (par) par.kids++;
    stack.push({ gen: gen, end: p + c.rs, path: path, kids: 0 });
    if (c.rs === 1) p++;
    var body = c.body;
    var am = body.match(/href="https:\/\/db\.netkeiba\.com\/horse\/([0-9a-z]{8,})\/"[^>]*>\s*([^<]+?)\s*<\/a>/i);
    if (!am) am = body.match(/href="https:\/\/db\.netkeiba\.com\/horse\/([0-9a-z]{8,})\/">([\s\S]*?)<\/a>/i);
    if (!am) return;
    var id = am[1];
    var nm = bfNormName(am[2]);
    if (!nm) return;
    var dp = bfDispName(am[2]);
    o.count++;
    var code = path.length >= 2 ? path.slice(0, 2) : path;   // 表示用の系統は最初の2手で足りる
    if (o.names[nm] == null){ o.names[nm] = id; o.disp[nm] = dp; o.gen[nm] = gen; o.ln[nm] = code; }
    else {
      if (gen < (o.gen[nm] || 99)) o.gen[nm] = gen;
      o.ln[nm] = bfMergeCodes(o.ln[nm], code);
    }
    if (gen === 5 && id){
      if (o.g5.indexOf(id) < 0) o.g5.push(id);
      if (o.g5l[id] == null) o.g5l[id] = code;
      else o.g5l[id] = bfMergeCodes(o.g5l[id], code);
    }
    if (c.sex === 'b_ml') o.males[nm] = id; else o.females[nm] = id;
  });
  return o;
}

/* 系統コード('ss'=父父 'sd'=父母 'ds'=母父 'dd'=母母)の集合を '|' 区切りで合并 */
function bfMergeCodes(a, b){
  if (!a) return b || '';
  if (!b) return a;
  var arr = String(a).split('|');
  String(b).split('|').forEach(function(c){ if (c && arr.indexOf(c) < 0 && arr.length < 4) arr.push(c); });
  return arr.join('|');
}
/* 系統コードの数（少ないほど「どの筋か」が特定できている。無情報は9扱いで最後） */
function bfCodeN(code){
  if (!code) return 9;
  return String(code).split('|').filter(function(c){ return !!c; }).length || 9;
}
/* 系統コード → 表示用のことば（母系 / 母父系 / 父系 / 父母系 …） */
var BF_LINE_MAP = { s:'父', d:'母', ss:'父父系', sd:'父母系', ds:'母父系', dd:'母母系' };
function bfLineLabel(code){
  if (!code) return '';
  var set = {};
  String(code).split('|').forEach(function(c){ if (c) set[c] = 1; });
  var ks = Object.keys(set);
  if (!ks.length) return '';
  if (ks.length === 1) return BF_LINE_MAP[ks[0]] || '';
  var allS = ks.every(function(c){ return c.charAt(0) === 's'; });
  var allD = ks.every(function(c){ return c.charAt(0) === 'd'; });
  if (allD) return (ks.indexOf('ds') >= 0 && ks.indexOf('dd') >= 0) ? '母系' : (BF_LINE_MAP[ks[0]] || '母系');
  if (allS) return (ks.indexOf('ss') >= 0 && ks.indexOf('sd') >= 0) ? '父系' : (BF_LINE_MAP[ks[0]] || '父系');
  return '父母両系';
}

/* ---------- 過去シリーズ（同じレース名の過去開催ridを発見） ---------- */
var BF_VENUES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
function bfVenueByCode(c){
  return { '01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉' }[c] || '';
}
function bfBaseName2(s){
  // 空白・( G1 )・第N回 等を取り除いて「比較用レース名」にする
  var t = bfStrip(s);
  t = t.replace(/^第\s*[0-9０-９]+\s*回/, '');
  t = t.replace(/[（(]\s*G[123ⅠⅡⅢ]\s*[)）]/g, '');
  t = t.replace(/[（(].*?[)）]/g, '');
  return t.replace(/[\s\u3000]/g, '');
}
/* 開催カレンダー1ヶ月分 → 日付ごとの開催場一覧（キャッシュ） */
function bfCal(y, m){
  var ls = bfLs();
  var key = y + 'M' + m;
  if (ls.cal && ls.cal[key]) return Promise.resolve(ls.cal[key]);
  return bfGet('https://race.netkeiba.com/top/calendar.html?year=' + y + '&month=' + m).then(function(html){
    var out = {};   // 'YYYYMMDD' → [場名…]
    var re = /<a[^>]*href="[^"]*race_list\.html\?kaisai_date=(\d{8})"[^>]*>([\s\S]*?)<\/a>/gi, m2;
    while ((m2 = re.exec(html)) !== null){
      var d8 = m2[1];
      var js = m2[2].match(/class="JyoName">\s*([^<]+?)\s*</gi) || [];
      var vs = [];
      js.forEach(function(x){
        var v = x.replace(/^class="JyoName">/i, '').replace(/[<>].*$/, '').replace(/\s+/g, '');
        if (v && BF_VENUES.indexOf(v) >= 0 && vs.indexOf(v) < 0) vs.push(v);
      });
      out[d8] = vs;
    }
    if (!ls.cal) ls.cal = {};
    ls.cal[key] = out;
    bfSave(ls);
    return out;
  });
}
/* ある開催日の全レース（local用・p32のdiParseDateList相当） */
function bfDateRaces(d8){
  var ls = bfLs();
  if (ls.day && ls.day[d8]) return Promise.resolve(ls.day[d8]);
  return bfGet('https://race.netkeiba.com/top/race_list_sub.html?kaisai_date=' + d8).then(function(html){
    var out = [], seen = {};
    var re = /<li[^>]*class="[^"]*RaceList_DataItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, lm;
    while ((lm = re.exec(html || '')) !== null){
      var body = lm[1];
      var idM = body.match(/race_id=(\d{12})/);
      if (!idM) continue;
      var rid = idM[1];
      if (seen[rid]) continue;
      seen[rid] = 1;
      var name = '';
      var nms = body.match(/ItemTitle">([\s\S]*?)<\/span>/gi) || [];
      for (var q = nms.length - 1; q >= 0; q--){
        var t = bfStrip(nms[q].replace(/^ItemTitle">/i, ''));
        if (t){ name = t; break; }
      }
      out.push({ rid: rid, name: name, code: rid.substring(4, 6) });
    }
    if (!ls.day) ls.day = {};
    ls.day[d8] = out;
    bfSave(ls);
    return out;
  });
}
/* 現在のレースの「素のレース名(皐月賞など)」「場」「開催年」を結果/出馬表ページから取得 */
function bfCurrentInfo(){
  var rid = state && state.raceId;
  if (!rid) return Promise.reject(new Error('現在のレースIDがありません（①のURL取込で重賞を読み込んでください）'));
  var tryFetch = function(urls){
    if (!urls.length) return Promise.reject(new Error('レースページを取得できませんでした'));
    return bfGet(urls[0]).then(function(html){ return html; }).catch(function(){ return tryFetch(urls.slice(1)); });
  };
  return tryFetch([
    'https://race.netkeiba.com/race/result.html?race_id=' + rid,
    'https://race.netkeiba.com/race/shutuba.html?race_id=' + rid
  ]).then(function(html){
    var name = '', venue = '';
    var hm = html.match(/<h1[^>]*class="RaceName"[^>]*>([\s\S]*?)<\/h1>/i);
    if (hm) name = bfStrip(hm[1]);
    if (!name){
      var tm = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (tm) name = bfStrip(tm[1]).split('｜')[0].split('|')[0];
    }
    var head = bfStrip(html.slice(0, 9000));
    var vmm = head.match(/(\d{1,2})回(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)/);
    if (vmm) venue = vmm[2];
    if (!venue){
      for (var i = 0; i < BF_VENUES.length; i++){
        if (head.indexOf(BF_VENUES[i] + ' ') >= 0 || head.indexOf(BF_VENUES[i] + '\n') >= 0 ||
            new RegExp(BF_VENUES[i] + '(競馬場|\\d{1,2}R|\\d{1,2})').test(head)){ venue = BF_VENUES[i]; break; }
      }
    }
    var code = rid.substring(4, 6);
    if (!venue && code) venue = bfVenueByCode(code) || '';
    var y = 0, mo = 0;
    var dm = head.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (dm){ y = parseInt(dm[1], 10); mo = parseInt(dm[2], 10); }
    if (!y || !mo){
      var d2 = new Date();
      y = d2.getFullYear(); mo = d2.getMonth() + 1;
    }
    if (!name) return Promise.reject(new Error('レース名を取得できませんでした'));
    return { rid: rid, name: name, venue: venue, year: y, month: mo };
  });
}
/* 同じレース名の過去開催ridを年別に探索（キャッシュ済みなら即返却） */
function bfSeekSeries(inf, progress){
  progress = progress || function(){};
  var ls = bfLs();
  var cacheKey = bfBaseName2(inf.name) + '@' + (inf.venue || '*');
  if (ls.seek && ls.seek[cacheKey] && ls.seek[cacheKey].rows && ls.seek[cacheKey].rows.length){
    return Promise.resolve(ls.seek[cacheKey].rows);
  }
  var y0 = inf.year;
  function windowMonths(year){
    var out = [];
    for (var d = -1; d <= 1; d++){
      var mm = inf.month + d;
      var yy = year;
      if (mm < 1){ mm = 12; yy = year - 1; }
      if (mm > 12){ mm = 1; yy = year + 1; }
      out.push({ y: yy, m: mm });
    }
    return out;
  }
  var targets = [];
  for (var t = y0; t >= y0 - 10; t--) targets.push(t);
  var seq = Promise.resolve();
  var found = [];
  targets.forEach(function(year){
    seq = seq.then(function(){
      var monthSeq = Promise.resolve();
      var ridFound = null;
      windowMonths(year).forEach(function(mm0){
        monthSeq = monthSeq.then(function(){
          if (ridFound) return;
          return bfCal(mm0.y, mm0.m).then(function(cal){
            var dates = Object.keys(cal).filter(function(d8){
              if (!inf.venue) return true;
              var vs = cal[d8] || [];
              return vs.indexOf(inf.venue) >= 0;
            });
            var dSeq = Promise.resolve();
            dates.forEach(function(d8){
              dSeq = dSeq.then(function(){
                if (ridFound) return;
                progress('同名レースを探索中: ' + year + '年 ' + d8.slice(0, 4) + '/' + (+d8.slice(4, 6)) + '/' + (+d8.slice(6, 8)) + ' …');
                return bfDateRaces(d8).then(function(items){
                  var base = bfBaseName2(inf.name);
                  for (var i = 0; i < items.length; i++){
                    var it = items[i];
                    if (!it.name) continue;
                    if (bfBaseName2(it.name) === base){
                      if (!inf.venue || !it.code || bfVenueByCode(it.code) === inf.venue){
                        ridFound = it.rid;
                        break;
                      }
                    }
                  }
                  return null;
                }).catch(function(){});
              });
            });
            return dSeq;
          }).catch(function(){});
        });
      });
      return monthSeq.then(function(){ if (ridFound) found.push({ year: year, rid: ridFound }); });
    });
  });
  return seq.then(function(){
    found.sort(function(a, b){ return a.year - b.year; });
    if (!ls.seek) ls.seek = {};
    ls.seek[cacheKey] = { rows: found, at: new Date().toISOString() };
    bfSave(ls);
    return found;
  });
}
function bfSeriesRows(progress){
  return bfCurrentInfo().then(function(inf){
    return bfSeekSeries(inf, progress).then(function(rows){
      if (!rows.length) throw new Error('過去の同じレース名をnetkeiba開催カレンダーから見つけられませんでした。通信環境か開催時期を確認して再実行してください（キャッシュは🗑で消せます）');
      return rows;
    });
  });
}
/* db のレースページ(1回)から3着以内を抽出してキャッシュ */
function bfYearTop(rid){
  var ls = bfLs();
  if (ls.race[rid] && ls.race[rid].top) return Promise.resolve(ls.race[rid]);
  return bfGet('https://db.netkeiba.com/race/' + rid + '/').then(function(html){
    var pr = bfParseDbResult(html);
    var top = pr.rows.filter(function(r){ return r.order >= 1 && r.order <= 3 && r.name && r.id; });
    var rec = { rid: rid, meta: pr.meta, top: top, n: pr.n, at: new Date().toISOString() };
    ls.race[rid] = rec; bfSave(ls);
    return rec;
  });
}
/* 1頭分の5代血統（キャッシュ）
   opt.needGen : 世代情報(gen/g5)が無い古いキャッシュは取り直す
   opt.lite    : 祖先用（males/females/g5 を落として省サイズ・保存はまとめ打ち） */
function bfPed(id, opt){
  opt = opt || {};
  var ls = bfLs();
  var rec = ls.ped[id];
  // lite(祖先用)で保存済みの馬を「本体」として使うときは完全版に取り直す
  var usable = rec && (opt.lite ? (rec.names || rec.g) : rec.names);
  if (usable && ((rec.v === BF_PED_V) || !opt.needGen)) return Promise.resolve(rec);
  return bfGate(function(){ return bfGet('https://db.netkeiba.com/horse/ped/' + id + '/'); }).then(function(html){
    var p = bfParsePed(html);
    if (!p.count) throw new Error('血統表を解析できませんでした(' + id + ')');
    var r2;
    if (opt.lite){
      // 祖先は「名前→世代」だけで十分（表示名 disp は残す）
      r2 = { g: p.gen, disp: p.disp || {}, count: p.count, v: BF_PED_V, lite: 1, at: new Date().toISOString() };
    } else {
      r2 = { names: p.names, disp: p.disp || {}, males: p.males, females: p.females,
             gen: p.gen || {}, ln: p.ln || {}, g5: p.g5 || [], g5l: p.g5l || {},
             count: p.count, v: BF_PED_V, at: new Date().toISOString() };
    }
    var ls2 = bfLs();
    ls2.ped[id] = r2;
    bfPruneDeep(ls2);
    if (opt.lite) bfSaveSoon(ls2); else bfSave(ls2);
    return r2;
  }, function(err){
    // 取り直し(古いキャッシュの世代補完)が失敗したら、手持ちのキャッシュで妥協する
    if (rec && (rec.names || rec.g)) return rec;
    throw err;
  });
}

/* ===== 深掘り: 5代目の祖先を辿って 6〜10代目まで名前を集める ===== */
function bfDeepOn(){
  try { var c = $('bfDeepCb'); if (c && typeof c.checked === 'boolean') return !!c.checked; } catch(e){}
  try { var ls = bfLs(); return !(ls.set && ls.set.deep === false); } catch(e2){ return true; }
}
function bfAncGenMap(rec){
  if (!rec) return null;
  return rec.g || rec.gen || null;
}
/* キャッシュ(ls.ped)だけから 10代セットを同期的に作る。未取得の祖先は無視(=浅くなるだけ) */
function bfBuildDeep(base){
  if (!base || !base.names) return null;
  var ls = bfLs();
  var names = {}, gen = {}, n5 = {}, ln = {}, k;
  for (k in base.names){
    names[k] = base.names[k];
    gen[k] = (base.gen && base.gen[k]) || 5;
    n5[k] = 1;
    if (base.ln && base.ln[k]) ln[k] = base.ln[k];
  }
  var deep = 0;
  (base.g5 || []).forEach(function(aid){
    var gm = bfAncGenMap(ls.ped[aid]);
    if (!gm) return;
    deep++;
    // 6代目以降の系統は「その5代目祖先へ至る経路」で決まる（例: 母父系経由なら全部 母父系）
    var code = (base.g5l && base.g5l[aid]) || '';
    for (var nm in gm){
      var g2 = 5 + (gm[nm] || 5);
      if (g2 > BF_DEEP_GEN) continue;
      if (names[nm] == null) names[nm] = 1;
      if (gen[nm] == null || g2 < gen[nm]) gen[nm] = g2;
      if (code) ln[nm] = ln[nm] ? bfMergeCodes(ln[nm], code) : code;
    }
  });
  return { names: names, gen: gen, n5: n5, ln: ln, disp: base.disp || {}, count: base.count, deep: deep };
}
/* 同期版（表示・照合用。取得はしない） */
function bfDeepSet(nk){
  if (!nk) return null;
  try {
    if (!bfDeepOn()){ var b0 = bfLs().ped[nk]; return (b0 && b0.names) ? b0 : null; }
    if (BF_DEEP_MEM[nk]) return BF_DEEP_MEM[nk];
    var base = bfLs().ped[nk];
    if (!base || !base.names) return null;
    var out = bfBuildDeep(base);
    if (out) BF_DEEP_MEM[nk] = out;
    return out;
  } catch(e){ return null; }
}
/* 非同期版（分析用。未取得の5代目祖先を取りに行く） */
function bfPedDeep(id, opt){
  opt = opt || {};
  var progress = opt.progress || function(){};
  var deep = (opt.deep == null) ? bfDeepOn() : !!opt.deep;
  if (!deep){
    return bfPed(id, { needGen: false }).then(function(rec){
      return { names: rec.names, gen: rec.gen || {}, n5: rec.names, disp: rec.disp || {}, count: rec.count, deep: 0 };
    });
  }
  if (BF_DEEP_MEM[id]) return Promise.resolve(BF_DEEP_MEM[id]);
  bfHold();
  return bfPedDeepBody(id, opt, progress).then(function(r){
    bfRelease(); return r;
  }, function(e){ bfRelease(); throw e; });
}
function bfPedDeepBody(id, opt, progress){
  return bfPed(id, { needGen: true }).then(function(base){
    if (!base || !base.names) return base;
    var g5 = (base.g5 || []).slice(0, 32);
    if (!g5.length) return bfBuildDeep(base) || base;   // 5代目が分からない=浅いまま集計
    var ls = bfLs();
    var missing = g5.filter(function(a){ return !bfAncGenMap(ls.ped[a]); });
    BF_DEEP_STAT.hit += (g5.length - missing.length);
    if (!missing.length){
      var cached = bfBuildDeep(base);
      if (cached) BF_DEEP_MEM[id] = cached;
      return cached || base;
    }
    var room = Math.max(0, BF_DEEP_BUDGET - BF_DEEP_STAT.req);
    if (!room){
      progress('⚠ 深掘り予算(' + BF_DEEP_BUDGET + '件)に達したため、この馬は取得済み世代までで集計します');
      var part = bfBuildDeep(base);
      if (part) BF_DEEP_MEM[id] = part;
      return part || base;
    }
    var queue = missing.slice(0, room);
    var done = 0;
    var work = function(aid){
      BF_DEEP_STAT.req++;
      return bfPed(aid, { lite: true }).then(function(){
        done++;
        if (done % 4 === 0 || done === queue.length){
          progress('🧬 10代血統を掘り込み中: ' + (BF_DEEP_STAT.hit + done) + '頭分／新規取得 ' + BF_DEEP_STAT.req + '件…');
        }
      }).catch(function(){ BF_DEEP_STAT.miss++; });
    };
    var runner = (typeof drPool === 'function')
      ? drPool(queue, work, 4)
      : queue.reduce(function(acc, aid){ return acc.then(function(){ return work(aid); }); }, Promise.resolve());
    return runner.then(function(){
      bfSaveFlush();
      var out = bfBuildDeep(base);
      if (out) BF_DEEP_MEM[id] = out;
      return out || base;
    });
  });
}
/* 深掘りの統計（進捗表示用） */
function bfDeepStatText(){
  return '新規取得 ' + BF_DEEP_STAT.req + '件・キャッシュ ' + BF_DEEP_STAT.hit + '件' +
    (BF_DEEP_STAT.miss ? '・失敗 ' + BF_DEEP_STAT.miss + '件' : '');
}

/* ---------- 分析 ---------- */
function bfHasAnc(ped, nm){ return !!(ped && ped.names && ped.names[nm]); }
function bfHasAll(ped, nms){
  if (!ped || !nms || !nms.length) return false;
  for (var i = 0; i < nms.length; i++) if (!ped.names[nms[i]]) return false;
  return true;
}
/* 今年判定(レース開催日がまだ先=結果が無い年は除外する必要があるが、
   対象シリーズのrid一覧から取得できる年だけを集計する) */
function bfYearsBuild(rows){
  var years = [];
  var cur = new Date().getFullYear();
  var seq = Promise.resolve();
  rows.forEach(function(r){
    var y = parseInt(r.year, 10);
    if (!y || isNaN(y)) return;
    if (cur - y > 11) return;      // 直近10年+今年分まで
    seq = seq.then(function(){ return bfYearTop(r.rid).catch(function(){ return null; }); })
      .then(function(rec){
        if (rec && rec.top && rec.top.length) years.push({ year: y, rid: r.rid, meta: rec.meta, top: rec.top });
      });
  });
  return seq.then(function(){ years.sort(function(a,b){ return a.year - b.year; }); return years; });
}
/* 集計用: 年ごと・着別(1着/複勝圏)に「祖先名セットの持ち主リスト」を作る */
function bfAncData(years, progress){
  // years: [{year, top:[{order,name,id}]}] → {yearTop:[{year,winnerPed?,boardPeds:[ped…]}]}
  var seq = Promise.resolve();
  var entries = [];
  years.forEach(function(yr){
    seq = seq.then(function(){
      var win = null, board = [];
      var q = Promise.resolve();
      yr.top.forEach(function(h){
        q = q.then(function(){ return bfPedDeep(h.id, { progress: progress }).catch(function(){ return null; }); })
          .then(function(ped){
            if (ped){ board.push(ped); if (h.order === 1) win = ped; }
          });
      });
      return q.then(function(){
        if (win || board.length) entries.push({ year: yr.year, win: win, board: board });
      });
    });
  });
  return seq.then(function(){ return entries; });
}
/* ===== 6〜10代目の「共通点」だけを3〜4点に絞って出す =====
   entries: [{year, win:ped, board:[ped…], fav:[ped…], field:[ped…]}]
   → { win:{total, items:[{name,n,total,gen,line,bgN,bgTotal,bgRate,lift}]}, board:{…}, bg:{…} }
   ・5代までは下の表（bfMine/bfRender）に出るので、ここでは 6代目以降だけを対象にする
   ・全頭が持つ基礎血統(100%)は差別化できないので、他に候補があれば除く
   ★2026-09-13 第19弾④: 「人気馬なら誰でも持っている要素」が上位に来る問題への対応。
     1〜3番人気（fav）と 出走馬全体（field）を【背景】として出現率を測り、
     勝ち馬／3着内での出現率との比（リフト）が高い順に並べ替えるようにしました。
     リフト ≒ 1.0 以下のものは「人気馬と差がついていない＝ファクターになっていない」ので、
     他に候補がある限り表示しません。 */
var BF_BG_FAV = 3;                 // 対照群＝1〜3番人気
function bfDeepCommon(entries){
  var wins = [], boards = [], favs = [], fields = [];
  (entries || []).forEach(function(en){
    if (en.win) wins.push(en.win);
    (en.board || []).forEach(function(p){ boards.push(p); });
    (en.fav || []).forEach(function(p){ favs.push(p); });
    var f = (en.field && en.field.length) ? en.field : (en.board || []);
    f.forEach(function(p){ fields.push(p); });
  });
  function collect(list){
    var cnt = {}, gen = {}, ln = {}, hits = {};   // hits = どの年のどの馬が持っていたか
    list.forEach(function(ped){
      if (!ped || !ped.names) return;
      var seen = {};
      Object.keys(ped.names).forEach(function(nm){
        var g = (ped.gen && ped.gen[nm]) || 5;
        if (g < 6 || g > BF_DEEP_GEN) return;      // 6代目以降だけ
        if (seen[nm]) return;
        seen[nm] = 1;
        cnt[nm] = (cnt[nm] || 0) + 1;
        if (gen[nm] == null || g < gen[nm]) gen[nm] = g;
        var c = (ped.ln && ped.ln[nm]) || '';
        if (c) ln[nm] = ln[nm] ? bfMergeCodes(ln[nm], c) : c;
        if (ped.nm || ped.yr) (hits[nm] = hits[nm] || []).push({ yr: ped.yr || 0, nm: ped.nm || '', o: ped.od || '' });
      });
    });
    return { cnt: cnt, gen: gen, ln: ln, hits: hits, total: list.length };
  }
  var stW = collect(wins), stB = collect(boards), stF = collect(favs), stA = collect(fields);
  /* 背景（対照群）は「1〜3番人気」を最優先にします。これが取れているときだけ
     「人気馬と差がついているか」を厳しく判定できます（#2026-09-13 第19弾④）。
     人気順(pop)が入っていない古いデータでは出走馬全体を背景にし、
     判定は従来どおり（9割以上が持つ基礎血統だけ除外）にします。 */
  var bgIsFav = (stF.total >= 3);
  var bg = bgIsFav ? stF : stA;
  var bgLabel = bgIsFav ? ('1〜' + BF_BG_FAV + '番人気') : '出走馬';
  function rate(cnt, tot){ return tot > 0 ? (cnt + 0.5) / (tot + 1) : 0; }
  function pick(st, ratio, minHit, max){
    var total = st.total || 0;
    if (!total) return [];
    var need = Math.max(minHit, Math.ceil(total * ratio));
    var bgTotal = bg.total || 0;
    var ks = Object.keys(st.cnt).filter(function(nm){ return st.cnt[nm] >= need; }).map(function(nm){
      var bgc = (bg.cnt && bg.cnt[nm]) || 0;
      var rt = rate(st.cnt[nm], total), rb = rate(bgc, bgTotal);
      return { nm: nm, n: st.cnt[nm], bg: bgc, bgTotal: bgTotal, bgRate: rb,
               lift: (rb > 0 ? rt / rb : (rt > 0 ? 9.99 : 1)) };
    });
    var use;
    if (bgIsFav){
      /* 背景（1〜3番人気）の8割以上が持つものは「人気馬と差がつかない＝ファクターになっていない」ので
         ★無条件で除外します（#2026-09-13 第19弾④）。
         旧実装は「他に3件以上候補があれば除く」だったため、候補が少ないときは
         人気馬も持っているだけの有名祖先がそのまま残ってしまいました。
         除外した件数は dropped として返し、画面に「人気馬と差がつく要素はありません」と正直に出します。
         ※判定は smoothing 前の生比率でします（+0.5/+1 の補正を入れると 8/10 が 0.77 になり
           ちょうど8割のものがすり抜けてしまうため）。 */
      use = ks.filter(function(x){ return !(x.bgTotal >= 4 && x.bg >= 1 && (x.bg / x.bgTotal) >= 0.8); });
    } else {
      // 人気順が取れていないデータ: 従来どおり「対象の9割以上が持つ基礎血統」だけ、他に候補があれば除く
      var nonAll = ks.filter(function(x){ return (x.n / total) < 0.9; });
      use = (nonAll.length >= 3) ? nonAll : ks;
    }
    var dropped = ks.length - use.length;
    use.sort(function(a, b){
      var d = b.lift - a.lift;                                // 1) 人気馬比のリフトが高い順
      if (Math.abs(d) > 0.05) return d;
      d = b.n - a.n;                                          // 2) 該当頭数が多い順
      if (d) return d;
      d = bfCodeN(st.ln[a.nm]) - bfCodeN(st.ln[b.nm]);        // 3) 系統が特定できる順（父母両系より母父系）
      if (d) return d;
      d = (st.gen[a.nm] || 99) - (st.gen[b.nm] || 99);        // 4) 浅い世代（情報として近い）順
      if (d) return d;
      return a.nm < b.nm ? -1 : 1;
    });
    var items = use.slice(0, max).map(function(x){
      var nm = x.nm;
      var hs = ((st.hits && st.hits[nm]) || []).slice().sort(function(a, b){
        return (b.yr || 0) - (a.yr || 0) || String(a.o || '9').localeCompare(String(b.o || '9'));
      });
      return { name: nm, n: x.n, total: total, gen: st.gen[nm],
               line: bfLineLabel(st.ln[nm]), all: (x.n / total) >= 0.9,
               bgN: x.bg, bgTotal: x.bgTotal, bgRate: x.bgRate, lift: x.lift,
               bgLabel: bgLabel, bgIsFav: bgIsFav,
               hits: hs.slice(0, 40) };
    });
    items.dropped = dropped;
    items.cand = ks.length;
    return items;
  }
  var wI = pick(stW, 0.3, 2, 4), bI = pick(stB, 0.25, 3, 4);
  return {
    win: { total: stW.total, items: wI },
    board: { total: stB.total, items: bI },
    bg: { label: bgLabel, total: bg.total, favTotal: stF.total, fieldTotal: stA.total },
    dropped: (wI.dropped || 0) + (bI.dropped || 0),
    deep: bfDeepOn(), at: new Date().toISOString()
  };
}
/* 単一祖先ファクターと2祖先ペアの候補づくり */
function bfMine(entries){
  // entries: [{year, win(ped|null), board:[ped]}]
  var singleCnt = {}, pairCnt = {}, genOf = {};
  var winNames = {}, boardNames = {};   // name -> 出現年set(単勝/複勝圏)
  var pairWin = {}, pairBoard = {};     // 'a|b' -> yearSet(win/board)
  var allWinners = [];
  entries.forEach(function(en){
    var yr = en.year;
    if (en.win) allWinners.push(en.win);
    (en.board).forEach(function(ped){
      var nms = ped.n5 ? Object.keys(ped.n5) : Object.keys(ped.names);   // 表は5代まで
      var n5 = nms;                                       // 6代目以降は bfDeepCommon 側で集計
      for (var i = 0; i < nms.length; i++){
        var n = nms[i];
        singleCnt[n] = (singleCnt[n] || 0) + 1;
        boardNames[n] = boardNames[n] || {}; boardNames[n][yr] = 1;
        var gv = (ped.gen && ped.gen[n]) || 5;
        if (genOf[n] == null || gv < genOf[n]) genOf[n] = gv;
      }
      for (var a = 0; a < n5.length; a++){
        for (var b = a + 1; b < n5.length; b++){
          var key = n5[a] < n5[b] ? n5[a] + '\u0001' + n5[b] : n5[b] + '\u0001' + n5[a];
          pairCnt[key] = (pairCnt[key] || 0) + 1;
          pairBoard[key] = pairBoard[key] || {}; pairBoard[key][yr] = 1;
        }
      }
    });
    if (en.win){
      var wn = en.win.n5 ? Object.keys(en.win.n5) : Object.keys(en.win.names);   // 表は5代まで
      var wn5 = wn;
      for (var j = 0; j < wn.length; j++){
        winNames[wn[j]] = winNames[wn[j]] || {}; winNames[wn[j]][yr] = 1;
        var gw = (en.win.gen && en.win.gen[wn[j]]) || 5;
        if (genOf[wn[j]] == null || gw < genOf[wn[j]]) genOf[wn[j]] = gw;
      }
      for (var c = 0; c < wn5.length; c++){
        for (var d = c + 1; d < wn5.length; d++){
          var k2 = wn5[c] < wn5[d] ? wn5[c] + '\u0001' + wn5[d] : wn5[d] + '\u0001' + wn5[c];
          pairWin[k2] = pairWin[k2] || {}; pairWin[k2][yr] = 1;
        }
      }
    }
  });
  function streak(yearSet){
    var ys = Object.keys(yearSet || {}).map(Number).sort(function(a,b){ return a - b; });
    if (!ys.length) return '';
    var max = 1, curRun = 1, end = ys[0];
    for (var i = 1; i < ys.length; i++){
      if (ys[i] === ys[i-1] + 1){ curRun++; if (curRun > max){ max = curRun; end = ys[i]; } }
      else curRun = 1;
    }
    return max >= 2 ? (end - max + 1) + '〜' + end + '年・' + max + '年連続' : '';
  }
  function mk(key, names, type){
    var wY = winNames[key] || {}, bY = boardNames[key] || {};
    var g = 0;
    if (type === 'S') g = genOf[key] || 0;
    else (names || []).forEach(function(n){ var q = genOf[n] || 0; if (q > g) g = q; });
    var factor = {
      key: type + '\u0001' + key, type: type, names: names, gen: g,
      wN: Object.keys(wY).length, bN: Object.keys(bY).length,
      wYears: Object.keys(wY).map(Number).sort(function(a,b){ return a-b; }),
      bYears: Object.keys(bY).map(Number).sort(function(a,b){ return a-b; }),
      streak: streak(wY), bStreak: streak(bY)
    };
    return factor;
  }
  var factors = [];
  Object.keys(singleCnt).forEach(function(n){
    if (boardNames[n] && Object.keys(boardNames[n]).length >= 3) factors.push(mk(n, [n], 'S'));
  });
  Object.keys(pairCnt).forEach(function(k){
    var nm = k.split('\u0001');
    if (pairBoard[k] && Object.keys(pairBoard[k]).length >= 2) factors.push(mk(k, nm, 'P'));
  });
  factors.sort(function(a, b){
    return (b.wN - a.wN) || (b.bN - a.bN) || (a.wYears[0]||0) - (b.wYears[0]||0);
  });
  // 表示数の上限（ノイズ対策・オカルトなので上位のみ）
  var S = factors.filter(function(f){ return f.type === 'S'; }).slice(0, 24);
  var P = factors.filter(function(f){ return f.type === 'P'; }).slice(0, 28);
  return S.concat(P);
}
function bfRaceName(){
  try { if (typeof drTargetName === 'function'){ var n = drTargetName(); if (n) return n; } } catch(e){}
  try { return (state.race && (state.race.name || '')) || ''; } catch(e){ return ''; }
}
/* 🧬ブロックの「対象レース」表示（⑥カレンダーの選択に連動） */
function bfRenderTarget(){
  var box = $('bfTarget'); if (!box) return;
  var nm = '', rid = '', from = '';
  try { nm = bfRaceName(); } catch(e){}
  try { var p = (typeof drPickRid === 'function') ? drPickRid() : null; if (p){ rid = p.rid; from = p.from; } } catch(e){}
  var last = '';
  try { last = ((bfLs().last || {}).name) || ''; } catch(e){}
  if (!nm && !last){ box.innerHTML = ''; return; }
  box.innerHTML = '<div class="small" style="margin:2px 0 6px">🎯 対象レース: <b>' + esc(nm || last || '未選択') + '</b>' +
    (rid ? ' <span class="muted">(race_id=' + esc(rid) + ')</span>' : '') +
    (from ? ' <span class="chip">' + esc(from) + '</span>' : '') +
    (last && nm && last !== nm ? ' <span class="muted">／抽出済み: ' + esc(last) + '（下のボタンで抽出し直すと切り替わります）</span>' : '') +
    ' <span class="muted">← 上の📅カレンダーでレースを選ぶと切り替わります</span></div>';
}
function bfGrade(){
  try {
    var g = '';
    try { if (typeof drTargetGrade === 'function') g = drTargetGrade(); } catch(e0){}
    if (!g) g = (state.race && state.race.grade) || '';
    if (g === BF_G1 || g === BF_G2 || g === BF_G3) return g;
    var nm = bfRaceName();
    var m = nm.match(/\((G[123])\)/);
    if (m) return m[1];
    return '';
  } catch(e){ return ''; }
}
/* =========================================================
   ===== 分析用データ(⑥重賞データ分析)からの抽出 =====
   「📥 この重賞の過去10年を分析」や重賞カレンダーで集計した
   ⑥の分析結果(DR_LAST)のサンプル（＝実際に照合済みの過去レースの
   1〜3着馬）をそのまま使い、その馬たちの5代血統から
   「馬券に絡んだ祖先」を自動検出する。
   別途レース探索（開催カレンダー総なめ）を行わないため失敗しにくく、
   ⑥の集計と母集団が必ず一致する。
   ========================================================= */
function bfDrSamples(){
  var res = null;
  try { res = (typeof DR_LAST !== 'undefined' && DR_LAST) ? DR_LAST : null; } catch(e){ res = null; }
  if (!res || !res.samples || !res.samples.length) return null;
  /* ★2026-09-13 第24弾⑤: DR_LAST が「今選ばれているレース」の結果なのかを照合する。
     以前は無条件で DR_LAST を返していたため、⑦重賞カレンダーで別のレースを選んだあとも
     前に分析したレース（多くの場合は①で出馬表を開いていたレース）の血統が使われ続けていました。
     drPickRid() は ①の出馬表読込時刻(state.raceAt) と カレンダー選択時刻(sel.at) を比べて
     「今どちらが選ばれているか」を1箇所で決める共通関数なので、これを唯一の正とします。 */
  var pick = null;
  try { pick = (typeof drPickRid === 'function') ? drPickRid() : null; } catch(e){}
  if (pick && pick.rid && /^\d{12}$/.test(String(pick.rid))){
    var have = String(res.rid || '');
    if (have && have !== String(pick.rid)){
      try { BF_LASTRID_MISS = have + '≠' + pick.rid; } catch(e){}
      return null;   // 別レースの分析結果 → 使わず取り直す
    }
  }
  try { BF_LASTRID_MISS = ''; } catch(e){}
  return res;
}
/* 照合が外れた理由（デバッグ・表示用） */
var BF_LASTRID_MISS = '';
/* 集計用に「年・馬名・着順」を血統データにくっ付ける（キャッシュ本体は汚さない浅いコピー） */
function bfPedMeta(ped, s, y){
  if (!ped) return ped;
  var o = {};
  for (var k in ped){ if (Object.prototype.hasOwnProperty.call(ped, k)) o[k] = ped[k]; }
  o.nm = (s && s.name) || ''; o.yr = y || 0; o.od = (s && s.o) || '';
  return o;
}
/* ★2026-09-13 第19弾④: 6〜10代目の「共通点」が人気馬の要素ばかりになる問題への対応。
   以前は 1〜3着馬の血統しか集めていなかったため、比較対象（背景頻度）が無く、
   「どの馬にも入っている有名祖先」＝結果的に人気馬も持っている要素 が上位に来ていました。
   ここでは【対照群】として 1〜3番人気 の血統も一緒に取り、
   さらに キャッシュに既にあれば他の出走馬（field）も背景として使います。 */
function bfFavPop(s, k){
  var p = parseInt(s && s.pop, 10);
  if (!(p >= 1)) return false;
  return p <= (k || 3);
}
function bfEntriesFromDr(res, progress){
  progress = progress || function(){};
  var all = (res.samples || []).filter(function(s){ return s && s.id && parseInt(s.o, 10) >= 1; });
  var samples = all.filter(function(s){ return parseInt(s.o, 10) <= 3; });   // 1〜3着（従来どおり）
  var favs = all.filter(function(s){ return bfFavPop(s, 3); });               // 1〜3番人気（対照群）
  var ids = [];
  samples.concat(favs).forEach(function(s){ if (ids.indexOf(s.id) < 0) ids.push(s.id); });
  var byId = {};
  var done = 0;
  var deep = bfDeepOn();
  BF_DEEP_STAT = { req: 0, hit: 0, miss: 0 };
  var run = function(id){
    return bfPedDeep(id, { progress: progress, deep: deep }).catch(function(){ return null; });
  };
  var runner = (typeof drPool === 'function')
    ? drPool(ids, function(id){ return run(id).then(function(p){ byId[id] = p; done++; progress((deep ? '🧬 血統(10代)を集計中 ' : '血統(5代)を取得中 ') + done + '/' + ids.length + '頭…'); }); }, 3)
    : ids.reduce(function(acc, id){ return acc.then(function(){ return run(id).then(function(p){ byId[id] = p; }); }); }, Promise.resolve());
  return runner.then(function(){
    var byYear = {};
    function entOf(s){
      var y = parseInt(s.yr, 10) || parseInt(String(s.rid || '').slice(0, 4), 10);
      if (!y) return null;
      return byYear[y] = byYear[y] || { year: y, win: null, board: [], fav: [], field: [], rid: s.rid };
    }
    function pedOf(s){
      // まず今回取得したもの、無ければ端末のキャッシュ（bfDeepSet＝同期版・取得はしない）
      var p = byId[s.id];
      if (!p){ try { p = bfDeepSet(s.id); } catch(e){ p = null; } }
      if (!p || !p.names) return null;
      return bfPedMeta(p, s, parseInt(s.yr, 10) || parseInt(String(s.rid || '').slice(0, 4), 10));
    }
    samples.forEach(function(s){
      var ped = pedOf(s); if (!ped) return;
      var en = entOf(s); if (!en) return;
      en.board.push(ped);
      if (parseInt(s.o, 10) === 1) en.win = ped;
    });
    favs.forEach(function(s){
      var ped = pedOf(s); if (!ped) return;
      var en = entOf(s); if (!en) return;
      if (!en.fav.some(function(x){ return x === ped; })) en.fav.push(ped);
    });
    // 出走馬全体（血統がキャッシュにある分だけ・追加通信なし）＝もう一段広い背景
    all.forEach(function(s){
      var ped = pedOf(s); if (!ped) return;
      var en = entOf(s); if (!en) return;
      if (!en.field.some(function(x){ return x === ped; })) en.field.push(ped);
    });
    var entries = Object.keys(byYear).map(function(k){
      var e = byYear[k];
      if (!e.field.length) e.field = e.board.concat(e.fav);   // 旧データ互換
      return e;
    });
    entries.sort(function(a, b){ return a.year - b.year; });
    return entries;
  });
}
/* ⑥の分析データから血統オカルトファクターを抽出して保存・表示 */
/* 2026-09-11 第11弾: ⑥の分析データ(samples)を確保する。
   無ければ【自動で⑥の分析を実行】してから返す（ページを読み直すと DR_LAST が消えるため、
   これが無いと「🧬 血統を抽出」が毎回『⑥の分析データがありません』で止まっていた）。 */
function bfEnsureDrSamples(progress){
  progress = progress || function(){};
  var r0 = bfDrSamples();
  if (r0) return Promise.resolve(r0);
  if (typeof drRunAll !== 'function') return Promise.reject(new Error('⑥重賞データ分析の仕組みが読み込まれていません。'));
  var hasRace = false, pick = null, nmOnly = '', sel = {};
  try { hasRace = !!((state && state.race && state.race.name) || (state && state.raceId)); } catch(e){}
  try { pick = (typeof drPickRid === 'function') ? drPickRid() : null; } catch(e){}
  try { nmOnly = (typeof drTargetName === 'function') ? (drTargetName() || '') : ''; } catch(e){}
  try { sel = (state && state.gradeSel) || {}; } catch(e){}
  progress('🧬 ⑥の分析データがまだ無いので、<b>自動で「📥 過去10年の分析」を実行します</b>…（初回は1〜3分／2回目以降はキャッシュで高速）');
  /* ★2026-09-13 第24弾⑤: 判定の優先順位を「hasRace ＞ pick」から「pick ＞ hasRace」に直しました。
     drRunAll() は state.race.name（＝①で開いている出馬表のレース）を見て分析するため、
     ⑦カレンダーで別レースを選んでいる最中に hasRace を先に見ると
     「カレンダーの選択を無視して①のレースの血統を分析する」ことになります（今回のご指摘の症状）。
     drPickRid() は ①とカレンダーのどちらが最新かを時刻で解決済みなので、その from を尊重します。
       ・from='①データ入力' … drRunAll()（state.race.name が正しい対象）
       ・それ以外 … drAnalyzeRid(pick.rid)（race_id で対象を固定して分析） */
  var pickFrom = (pick && pick.from) || '';
  var pickRid = (pick && pick.rid) ? String(pick.rid) : '';
  var useRid = !!(pickRid && /^\d{12}$/.test(pickRid) && pickFrom !== '①データ入力' && typeof drAnalyzeRid === 'function');
  var p;
  if (useRid){
    try { progress('🎯 対象レース: <b>' + esc(drTargetName ? (drTargetName() || '') : '') + '</b>（race_id ' + esc(pickRid) + '・' + esc(pickFrom) + 'で選択中）の過去10年を分析します'); } catch(e){}
    p = drAnalyzeRid(pickRid, {}, progress);
  }
  else if (hasRace) p = drRunAll(progress);
  else if (nmOnly && typeof drAnalyzeByName === 'function') p = drAnalyzeByName(nmOnly, sel.venue || '', sel.date || '', '', progress);
  else return Promise.reject(new Error('分析するレースが決まっていません。①で出馬表を取り込むか、📅重賞カレンダーでレース名をクリックしてから、もう一度押してください。'));
  return p.then(function(res){
    try {
      if (res && typeof res === 'object'){
        /* rid が返ってこない実装もあるので、選んでいた race_id を必ず入れておく
           （これが入っていないと (A) の照合が「不明」扱いになり、毎回やり直しになります） */
        if (pick && pick.rid && (!res.rid || String(res.rid) !== String(pick.rid)) && useRid) res.rid = String(pick.rid);
        else if (!res.rid && pick && pick.rid) res.rid = String(pick.rid);
        if (typeof DR_LAST !== 'undefined') DR_LAST = res;
      }
    } catch(e){}
    var r = bfDrSamples();
    if (!r) throw new Error('⑥の分析は実行できましたが、1〜3着のデータが集まりませんでした（過去開催が見つからなかった可能性があります）。');
    var n3 = (r.samples || []).filter(function(x){ return x && parseInt(x.o, 10) >= 1 && parseInt(x.o, 10) <= 3; }).length;
    progress('✅ ⑥の分析を自動実行しました（' + (r.name || '') + '・1〜3着 ' + n3 + ' 頭）。血統の抽出に進みます…');
    return r;
  });
}
function bfAnalyzeFromDr(progress){
  progress = progress || function(){};
  return bfEnsureDrSamples(progress).then(function(res){ return bfAnalyzeFromDrRes(res, progress); });
}

/* ★2026-09-13 第20弾: 「🧬 血統を抽出して今回の出走馬を検出」ボタンの中身を関数化。
   ⑥の過去10年分析が終わった直後に p59_automacro から自動で呼べるようにしました。
   quiet=true のときは失敗しても大きな案内を出さず、理由だけを返します（自動実行用）。 */
var BF_EXTRACT_BUSY = false;
function bfRunExtract(quiet){
  if (BF_EXTRACT_BUSY) return Promise.resolve({ skip:true, reason:'すでに実行中です' });
  BF_EXTRACT_BUSY = true;
  var bd = $('bfDrBtn');
  if (bd) bd.disabled = true;
  bfStatus('⑥の分析データから血統ファクターを抽出し、今日の出走馬の該当を検出します…');
  return bfAnalyzeFromDr(function(msg){ bfStatus(msg, false); })
    .then(function(r){
      bfStatus('✅ 抽出→出走馬の血統取得→該当検出 まで完了しました（☑を入れるとAI印に加点されます）。');
      BF_EXTRACT_BUSY = false;
      if (bd) bd.disabled = false;
      return r;
    })
    .catch(function(e){
      /* 2026-09-11 第11弾: ⑥の分析は自動実行するようになったので、ここまで来るのは
         「自動実行したのにデータを取れなかった」ケース。理由を消さずに出し、次に何をすればいいかを書く。 */
      var why = String((e && e.message) || e || '');
      BF_EXTRACT_BUSY = false;
      if (bd) bd.disabled = false;
      if (quiet){ bfStatus('🧬 血統の自動抽出はできませんでした: ' + why, true); return Promise.resolve({ skip:true, reason: why }); }
      bfStatus(why, true);
      return bfEnsureToday(function(m){ bfStatus(m, false); }).then(function(n){
        BF_DEEP_MEM = {};
        bfRender(); bfRenderDeep(); bfRenderDeepHit(); bfRenderToday(); bfRenderSummary();
        bfStatus('⚠️ ⑥の過去10年分析を<b>自動で実行しようとしましたが、集計データを取れませんでした</b>。' +
          '<br>理由: ' + esc(why) +
          '<br>出走馬 ' + n + ' 頭の血統だけ取得しました。🔎検出結果を出すには ' +
          '<b>①で出馬表を取り込む（または📅重賞カレンダーでレースを選ぶ）→ ⑥「📥 この重賞の過去10年を分析」を成功させる</b>' +
          '→ もう一度このボタン、の順に押してください（⑥が成功していればこのボタン1本で全部進みます）。', true);
        return { skip:true, reason: why };
      }).catch(function(){ return { skip:true, reason: why }; });
    });
}
function bfAnalyzeFromDrRes(res, progress){
  var ns = (res.samples || []).filter(function(s){ return s && s.id && parseInt(s.o, 10) >= 1 && parseInt(s.o, 10) <= 3; }).length;
  progress('⑥の分析データ（' + (res.name || '') + '・過去' + (res.racesUsed ? res.racesUsed.length : res.yearsUsed || 0) + '回／1〜3着 ' + ns + '頭）を読み込み中…');
  return bfEntriesFromDr(res, progress).then(function(entries){
    if (!entries.length) throw new Error('分析データから血統を取得できませんでした（netkeibaの血統ページ取得に失敗した可能性があります）');
    progress('祖先名の共通点をマイニング中…');
    var factors = bfMine(entries);
    var deepCommon = bfDeepCommon(entries);
    var nDeep = (deepCommon.win.items.length + deepCommon.board.items.length);
    var ls = bfLs();
    ls.last = {
      rid: res.rid || (state && state.raceId) || '', grade: bfGrade(), name: res.name || bfRaceName(),
      at: new Date().toISOString(), src: 'dr',
      years: entries.map(function(e){ return { year: e.year, rid: e.rid || '' }; }),
      factors: factors, deepCommon: deepCommon
    };
    var on2 = {};
    Object.keys(ls.set.on || {}).forEach(function(k){
      var f = ls.set.on[k];
      if (f && factors.some(function(x){ return x.key === k; })) on2[k] = f;
    });
    ls.set.on = on2;
    bfSave(ls);
    bfRender(); bfRenderDeep(); bfRenderToday(); bfRenderDeepHit(); bfRenderSummary();
    var msg = '✅ 抽出完了: ' + entries.length + '年分・5代ファクター ' + factors.length + ' 件' +
      (bfDeepOn() ? '・10代の共通点 ' + nDeep + ' 点（' + bfDeepStatText() + '）' : '（5代まで）');
    var ths = bfTodayHorses();
    if (!ths.length){ progress(msg + '。出走馬が読み込まれていないため該当検出はスキップしました。'); return factors; }
    progress(msg + ' → 🐎 今回の出走馬 ' + ths.length + ' 頭の血統' + (bfDeepOn() ? '（10代）' : '（5代）') + 'を取得して該当を検出します…');
    return bfEnsureToday(function(m){ progress(m); }).then(function(){
      BF_DEEP_MEM = {};                       // 取得後の最新状態で照合し直す
      bfRenderDeepHit(); bfRenderToday(); bfRenderSummary();
      var sc = bfDeepHitScan();
      progress(msg + '／🐎 出走馬 ' + (sc ? sc.have : 0) + ' 頭を照合 → 該当 ' + (sc ? sc.hitN : 0) + ' 頭' +
        (sc && sc.rows.length ? '（1番目: ' + ((sc.rows[0].h.no || '') + '番 ' + (sc.rows[0].h.name || '')) + '）' : ''));
      return factors;
    }).catch(function(e){
      bfRenderDeepHit(); bfRenderSummary();
      progress(msg + '（出走馬の照合で失敗: ' + ((e && e.message) || e) + '）');
      return factors;
    });
  });
}

/* 今日の出走馬の血統（未取得なら取得） */
function bfTodayHorses(){
  var hs = (state.horses || []).filter(function(h){ return h.nk; });
  return hs;
}
function bfEnsureToday(progress){
  progress = progress || function(){};
  var hs = bfTodayHorses();
  if (!hs.length) return Promise.resolve(0);
  bfHold();
  var done = 0;
  var seq = Promise.resolve();
  hs.forEach(function(h, ix){
    seq = seq.then(function(){
      var ls0 = bfLs();
      var rec = ls0.ped[h.nk];
      if (rec && rec.names && !bfDeepOn()) return;                 // 5代まででよい→取得済み
      if (rec && rec.names && rec.v === BF_PED_V){
        // 10代まで揃っているか（5代目の祖先が全部キャッシュにあるか）を見る
        var miss = (rec.g5 || []).filter(function(a){ return !bfAncGenMap(ls0.ped[a]); });
        if (!miss.length && (rec.g5 || []).length) return;
      }
      progress('今日の出走馬の血統を取得中' + (bfDeepOn() ? '(10代)' : '(5代)') + ' ' + (ix + 1) + '/' + hs.length + ': ' + (h.name || h.nk) + '…');
      return bfPedDeep(h.nk, { progress: progress }).then(function(){ done++; }).catch(function(){});
    });
  });
  return seq.then(function(){ bfRelease(); return done; }, function(e){ bfRelease(); throw e; });
}
/* AI印に反映する加算ベクタ（ONにしたファクターの該当馬に加点） */
function bfActiveVector(hs){
  try {
    var ls = bfLs();
    var set = ls.set || { on: {}, apply: false };
    if (!set.apply) return null;
    var keys = Object.keys(set.on || {}).filter(function(k){ return set.on[k]; });
    if (!keys.length) return null;
    if (!ls.last || !ls.last.rid || ls.last.rid !== (state.raceId || '')) return null;
    var facts = (ls.last.factors || []).filter(function(f){ return keys.indexOf(f.key) >= 0; });
    if (!facts.length) return null;
    var peds = {};
    (bfTodayHorses()).forEach(function(h){ var p = bfDeepSet(h.nk); if (p) peds[h.nk] = p; });
    return hs.map(function(h){
      if (!h || !h.nk || !peds[h.nk]) return 0;
      var ped = peds[h.nk];
      for (var i = 0; i < facts.length; i++){
        var ok = true;
        var names = facts[i].names;
        for (var j = 0; j < names.length; j++){ if (!ped.names[names[j]]){ ok = false; break; } }
        if (ok) return 1;
      }
      return 0;
    });
  } catch(e){ return null; }
}
/* ②に出す説明文（該当馬名を列挙） */
function bfAppliedNote(){
  var ls = bfLs();
  var set = ls.set || {};
  if (!set.apply) return '';
  var keys = Object.keys(set.on || {}).filter(function(k){ return set.on[k]; });
  var facts = (ls.last && ls.last.factors || []).filter(function(f){ return keys.indexOf(f.key) >= 0; });
  if (!facts.length) return '';
  var hit = [];
  (state.horses || []).forEach(function(h){
    if (!h || !h.nk) return;
    var ped = bfDeepSet(h.nk);
    if (!ped) return;
    for (var i = 0; i < facts.length; i++){
      var names = facts[i].names, ok = true;
      for (var j = 0; j < names.length; j++){ if (!ped.names[names[j]]){ ok = false; break; } }
      if (ok){ hit.push((h.no || '?') + '番' + (h.name || '')); break; }
    }
  });
  if (!hit.length) return '';
  var lbl = facts.slice(0, 3).map(function(f){ return f.type === 'S' ? f.names[0] : f.names.join('×'); }).join(' ／ ');
  return '🧬 血統ファクター反映（⑥でON）: ' + lbl + ' に該当 ' + hit.join('・');
}

/* ---------- 表示（⑥タブ内） ---------- */
function bfDispFor(nm){
  try {
    var ls = bfLs();
    for (var k in ls.ped){ if (ls.ped[k].disp && ls.ped[k].disp[nm]) return ls.ped[k].disp[nm]; }
    if (ls.ped) for (var k2 in ls.ped){ if (ls.ped[k2].names && ls.ped[k2].names[nm]) return nm; }
  } catch(e){}
  return nm;
}
/* ===== 今回の出走馬 × 10代共通点 の該当検出 =====
   6〜10代目の共通点（勝ち馬/3着内 それぞれ3〜4点）に、出走馬の10代血統が
   いくつ当てはまるかを数えて「該当が多い順」に並べる。通信はしない（キャッシュから）。 */
function bfDeepHitScan(){
  var ls = bfLs();
  var dc = (ls.last && ls.last.deepCommon) || null;
  if (!dc || !dc.deep) return null;
  var wItems = (dc.win && dc.win.items) || [], bItems = (dc.board && dc.board.items) || [];
  var hs = bfTodayHorses();
  var out = { rows: [], wN: wItems.length, bN: bItems.length, have: 0, total: hs.length,
              hitN: 0, deepReady: 0, dc: dc, wU: [], bU: [], univ: [] };
  if (!wItems.length && !bItems.length) return out;
  var fieldCnt = {};                                  // 項目ごとに「今日の出走馬のうち何頭が持つか」
  hs.forEach(function(h){
    var ped = bfDeepSet(h.nk);
    if (!ped) return;
    out.have++;
    var w = [], b = [], seen = {};
    function bump(it){ if (!seen[it.name]){ seen[it.name] = 1; fieldCnt[it.name] = (fieldCnt[it.name] || 0) + 1; } }
    wItems.forEach(function(it){ if (ped.names[it.name]){ w.push(it); bump(it); } });
    bItems.forEach(function(it){ if (ped.names[it.name]){ b.push(it); bump(it); } });
    if (bfDeepOn() && (ped.deep || 0) > 0) out.deepReady++;
    if (w.length + b.length > 0) out.hitN++;
    out.rows.push({ h: h, w: w, b: b, n: w.length + b.length, deep: ped.deep || 0,
                    full: !bfDeepOn() || (ped.deep || 0) > 0 });
  });
  // 今日の出走馬の9割以上が持つ項目は「差がつかない」ので判定から外す（表示は残す）
  var lim = Math.max(2, Math.ceil(out.have * 0.9));
  function isDiff(it){ return (fieldCnt[it.name] || 0) < lim; }
  out.wU = wItems.filter(isDiff);
  out.bU = bItems.filter(isDiff);
  out.univ = wItems.concat(bItems).filter(function(it){ return !isDiff(it); });
  out.fieldCnt = fieldCnt;
  var den = out.wU.length + out.bU.length;
  out.den = den;
  out.rows.forEach(function(r){
    r.wu = r.w.filter(function(it){ return out.wU.indexOf(it) >= 0; });
    r.bu = r.b.filter(function(it){ return out.bU.indexOf(it) >= 0; });
    r.den = den;
    r.rate = den ? (r.wu.length + r.bu.length) / den
                 : (r.n / Math.max(1, wItems.length + bItems.length));   // 全て全員持ちなら素の該当率
  });
  function oddsOf(r){ var v = parseFloat(r.h && r.h.odds); return (isFinite(v) && v > 0) ? v : 9999; }
  out.rows.sort(function(x, y){
    return (y.rate - x.rate) || (y.w.length - x.w.length) || (y.b.length - x.b.length) ||
      (oddsOf(x) - oddsOf(y)) || (String(x.h.no) < String(y.h.no) ? -1 : 1);
  });
  return out;
}
/* 該当の強さ（“今日の出馬表で差がつく共通点”の該当率で判定） */
function bfHitRank(r, wN){
  var p = (r && r.rate != null) ? r.rate : 0;
  if (p >= 0.9) return { cls: 'bfh3', txt: '強' };
  if (p >= 0.6) return { cls: 'bfh2', txt: '中' };
  if (p > 0) return { cls: 'bfh1', txt: '弱' };
  return { cls: '', txt: '−' };
}
function bfHitItemsHtml(r, sc){
  var byName = {}, order = [];
  function add(it, tag){
    if (!byName[it.name]){ byName[it.name] = { it: it, tags: [tag] }; order.push(it.name); }
    else if (byName[it.name].tags.indexOf(tag) < 0) byName[it.name].tags.push(tag);
  }
  (r.w || []).forEach(function(it){ add(it, '勝ち馬'); });
  (r.b || []).forEach(function(it){ add(it, '3着内'); });
  if (!order.length) return '<span class="muted">該当なし</span>';
  var diffNames = {};
  (sc ? (sc.wU || []).concat(sc.bU || []) : []).forEach(function(it){ diffNames[it.name] = 1; });
  function isDiff(k){ return !sc || !!diffNames[k]; }
  // 差がつく項目を先頭に
  order.sort(function(a, b){
    var d = (isDiff(a) ? 0 : 1) - (isDiff(b) ? 0 : 1);
    return d || (byName[a].it.gen - byName[b].it.gen);
  });
  return order.map(function(k){
    var o = byName[k], diff = isDiff(k);
    var fc = (sc && sc.fieldCnt && sc.fieldCnt[k]) || 0;
    return '<span class="bfhitnm' + (o.tags.indexOf('勝ち馬') >= 0 ? ' w' : '') + (diff ? '' : ' all') + '"' +
      (diff ? '' : ' title="今日の出走馬の9割以上が持つため判定からは除外"') + '>' +
      (o.it.line ? esc(o.it.line) + 'に ' : '') + '<b>' + esc(bfDispFor(k)) + '</b>' +
      '<i>' + o.it.gen + '代目・' + o.tags.join('・') + (diff ? '・' + fc + '/' + sc.have + '頭' : '・全員') + '</i></span>';
  }).join(' ');
}
/* ===== 🔎 検出結果（抽出開始ボタンの直下・2026-09-11 第11弾） =====
   抽出が終わったら「何が分かったか」を必ずここに【文＋表】で出す（従来は内訳が下の4ブロックに散っていて
   「何も出ていない」ように見えた）。
     文  : 対象レース・何年分・ファクター数・共通点数・出走馬の該当数
     表1 : 6〜10代の共通点（勝ち馬／3着内・何代目・過去10年の該当・今日の出走馬で何頭が持つか）
     表2 : 今回の出走馬の該当（多い順・全頭）
     表3 : 5代までの血統ファクター（☑で②のAI印に加点） */
function bfRenderSummary(){
  var box = $('bfSummary'); if (!box) return;
  var ls = bfLs();
  var last = ls.last || {};
  var factors = (last.factors || []).slice();
  var dc = last.deepCommon || null;
  var deep = !!(dc && dc.deep);
  var wI = deep ? ((dc.win && dc.win.items) || []) : [];
  var bI = deep ? ((dc.board && dc.board.items) || []) : [];
  if (!factors.length && !wI.length && !bI.length){
    box.innerHTML = '<div class="small" style="border:1px dashed var(--line2);border-radius:10px;padding:8px 10px;background:var(--card)">' +
      '🔎 <b>検出結果</b>: まだありません。上の<b>「🧬 血統を抽出して今回の出走馬を検出」</b>を押してください。' +
      '⑥の分析データがまだ無いときは<b>自動で⑥の分析（過去10年）を実行してから</b>抽出します' +
      '（初回は1〜3分／2回目以降はキャッシュで即時）。結果は<b>この枠に文と表</b>で出ます。</div>';
    return;
  }
  var sc = null; try { sc = bfDeepHitScan(); } catch(e){}
  var h = [];
  h.push('<div style="border:1px solid var(--line2);border-radius:10px;padding:8px 10px;background:var(--card2)">');
  h.push('<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">' +
    '<span style="font-weight:800;font-size:.95rem">🔎 検出結果</span>' +
    '<span class="chip">' + esc(last.name || last.rid || 'このレース') + (last.grade ? ' ' + esc(String(last.grade)) : '') + '</span>' +
    (last.at ? '<span class="small muted">抽出 ' + esc(String(last.at).slice(0, 16).replace('T', ' ')) + '</span>' : '') +
    (BF_SAVE_OK === false ? '<span class="chip warn" title="端末の保存領域がいっぱいで保存できませんでした。表示はされていますが、読み直すと消えます。「🗑 キャッシュ消去」で空けてください">⚠️ 保存不可</span>' : '') +
    '</div>');
  var sent = [];
  sent.push('過去 <b>' + ((last.years || []).length) + '年分</b>の1〜3着を解析');
  sent.push('5代ファクター <b>' + factors.length + '件</b>');
  if (deep) sent.push('6〜' + BF_DEEP_GEN + '代の共通点 <b>' + (wI.length + bI.length) + '点</b>（勝ち馬 ' + wI.length + '／3着内 ' + bI.length + '）');
  if (sc) sent.push('今日の出走馬 <b>' + sc.total + '頭</b>のうち血統取得成功 <b>' + sc.have + '頭</b>' + (sc.hitN ? '・共通点に該当 <b>' + sc.hitN + '頭</b>' : ''));
  h.push('<div class="small" style="margin-bottom:2px">' + sent.join('　｜　') + '</div>');
  if (deep && typeof bfDeepSentHtml === 'function'){
    try { h.push('<div class="small" style="margin-bottom:6px">' + bfDeepSentHtml(dc, wI, bI) + '</div>'); } catch(e){}
  }
  /* --- 表1: 6〜10代の共通点 --- */
  if (wI.length || bI.length){
    var lim = (sc && sc.have) ? Math.max(2, Math.ceil(sc.have * 0.9)) : 999;
    h.push('<div class="small" style="font-weight:700;margin:8px 0 2px">🧬 表1: 勝ち馬・3着内の共通点（6〜' + BF_DEEP_GEN + '代目）</div>');
    h.push('<div class="tblwrap" style="max-height:280px"><table class="lr-tbl"><thead><tr>' +
      '<th>区分</th><th style="text-align:left">共通点</th><th>何代目</th><th>過去10年の該当</th><th>今日の出走馬</th></tr></thead><tbody>');
    [['勝ち馬', wI], ['3着内', bI]].forEach(function(pr){
      (pr[1] || []).forEach(function(it){
        var cnt = (sc && sc.fieldCnt && sc.fieldCnt[it.name] != null) ? sc.fieldCnt[it.name] : null;
        h.push('<tr><td>' + pr[0] + '</td>' +
          '<td style="text-align:left">' + (it.line ? esc(String(it.line)) + 'に ' : '') + '<b>' + esc(bfDispFor(it.name)) + '</b> を内包</td>' +
          '<td>' + esc(String(it.gen || '')) + '代目</td>' +
          '<td><b>' + it.n + '</b>/' + it.total + '頭' + (it.all ? '<span class="muted">（全頭）</span>' : '') + '</td>' +
          '<td>' + (cnt != null ? ('<b>' + cnt + '</b>頭' + (cnt >= lim ? '<span class="muted">（差がつかない）</span>' : '')) : '<span class="muted">−</span>') + '</td></tr>');
      });
    });
    h.push('</tbody></table></div>');
  }
  /* --- 表2: 今回の出走馬の該当 --- */
  if (sc && sc.have){
    var rows = sc.rows.slice().sort(function(a, b){ return (b.rate || 0) - (a.rate || 0) || b.n - a.n; });
    h.push('<div class="small" style="font-weight:700;margin:8px 0 2px">🐎 表2: 今回の出走馬の該当（多い順・' + rows.length + '頭）</div>');
    h.push('<div class="tblwrap" style="max-height:360px"><table class="lr-tbl bfhittbl"><thead><tr>' +
      '<th style="min-width:34px">馬番</th><th style="text-align:left">馬名</th><th>単勝</th>' +
      '<th>勝ち馬<br>共通点</th><th>3着内<br>共通点</th><th>差がつく<br>項目</th><th>判定</th>' +
      '<th style="text-align:left">内包している深い血統（6代目以降）</th></tr></thead><tbody>');
    rows.forEach(function(r){
      var rk = bfHitRank(r, sc.wN);
      var od = (r.h.odds !== '' && r.h.odds != null) ? r.h.odds : '−';
      h.push('<tr class="' + (r.n ? 'bfhrow' : 'bfhrow0') + '">' +
        '<td>' + esc(r.h.no || '?') + '</td>' +
        '<td style="text-align:left">' + esc(r.h.name || '') + (r.full ? '' : '<span class="bfwarn" title="10代まで取得できていません（5代まで）">!</span>') + '</td>' +
        '<td>' + esc(String(od)) + '</td>' +
        '<td>' + (sc.wN ? '<b>' + r.w.length + '</b>/' + sc.wN : '<span class="muted">−</span>') + '</td>' +
        '<td>' + (sc.bN ? '<b>' + r.b.length + '</b>/' + sc.bN : '<span class="muted">−</span>') + '</td>' +
        '<td>' + (sc.den ? '<b>' + (r.wu.length + r.bu.length) + '</b>/' + sc.den : '<span class="muted">−</span>') + '</td>' +
        '<td>' + (rk && rk.cls ? '<span class="bfhg ' + rk.cls + '">' + rk.txt + '</span>' : '<span class="muted">−</span>') + '</td>' +
        '<td style="text-align:left">' + bfHitItemsHtml(r, sc) + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<div class="small muted" style="margin-top:4px">※ <b>判定</b>は「今日の出馬表で差がつく共通点」の該当率（強=90%以上／中=60%以上／弱=1点以上）。' +
      '出走馬の9割以上が持つ項目は差がつかないので判定から除きます。「!」は10代まで辿れていない馬。</div>');
  } else if (sc){
    h.push('<div class="small muted" style="margin:8px 0">🐎 表2: 出走馬（' + sc.total + '頭）の血統がまだありません。' +
      '「🧬 血統を抽出して今回の出走馬を検出」を押すと取得して該当を出します。</div>');
  } else {
    h.push('<div class="small muted" style="margin:8px 0">🐎 表2: 6〜10代の共通点がまだ無いので該当検出はできません。' +
      '「🧬 10代まで掘る」をONにして抽出してください（初回は数分・以後キャッシュで即時）。</div>');
  }
  /* --- 表3: 5代までの血統ファクター（☑で②のAI印に反映） --- */
  if (factors.length){
    var apply = !!(ls.set && ls.set.apply);
    var onCount = Object.keys((ls.set && ls.set.on) || {}).filter(function(k){ return ls.set.on[k]; }).length;
    h.push('<div class="small" style="font-weight:700;margin:8px 0 2px">🧬 表3: 5代までの血統ファクター（' + factors.length + '件' +
      (onCount ? '・反映ON ' + onCount + '件' : '') + '）' +
      (apply ? '' : ' <span class="chip warn">全体スイッチOFF＝☑は操作できません</span>') + '</div>');
    h.push('<div class="tblwrap" style="max-height:320px"><table class="lr-tbl"><thead><tr>' +
      '<th style="text-align:left">ファクター（5代に内包する祖先・右の数字は何代目か）</th><th>単勝(1着)を取った年</th>' +
      '<th>3着内に入った年</th><th>連続</th><th>②に反映</th></tr></thead><tbody>');
    factors.forEach(function(f){
      var on = !!(ls.set && ls.set.on && ls.set.on[f.key]);
      var dis = apply ? '' : ' disabled';
      h.push('<tr><td style="text-align:left">' + (f.type === 'P' ? '🤝 組: ' : '🧬 ') + esc(bfFactorLabel(f)) + bfGenBadge(f) +
        (f.type === 'P' ? '<br><span class="small muted">' + f.names.length + '祖先の両方を持つ馬</span>' : '') + '</td>' +
        '<td>' + esc(bfYearsTxt(f.wYears)) + '</td><td>' + esc(bfYearsTxt(f.bYears)) + '</td>' +
        '<td>' + esc(f.streak || '−') + (f.streak ? '<br><span class="small muted">複勝圏: ' + esc(f.bStreak || '−') + '</span>' : '') + '</td>' +
        '<td><input type="checkbox" data-bfkey="' + esc(f.key) + '"' + (on ? ' checked' : '') + dis + '></td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<div class="small muted" style="margin-top:4px">※ 非統計・参考（オカルト）です。全件・内訳は下の「🔍 内訳・全件」を開いてください。</div>');
  }
  h.push('</div>');
  box.innerHTML = h.join('');
}

function bfRenderDeepHit(){
  var box = $('bfDeepHit'); if (!box) return;
  var sc = bfDeepHitScan();
  if (!sc){ box.innerHTML = ''; return; }
  if (!sc.wN && !sc.bN){
    box.innerHTML = '<div class="small muted">🐎 今回の出走馬の該当検出: 10代の共通点が見つからなかったため照合できません。</div>';
    return;
  }
  if (!sc.have){
    box.innerHTML = '<div class="small muted">🐎 <b>今回の出走馬の該当検出</b>: 出走馬（' + sc.total + '頭）の血統がまだありません。' +
      '「🧬 血統を抽出して今回の出走馬を検出」を押すと、10代まで辿って該当馬を出します。</div>';
    return;
  }
  var h = [];
  h.push('<div class="bfhit">');
  h.push('<div class="bfdh">🐎 今回の出走馬の該当検出（10代共通点 ' + (sc.wN + sc.bN) + '点で照合）' +
    '<span class="chip">血統取得 ' + sc.have + '/' + sc.total + '頭</span>' +
    (sc.den ? '<span class="chip">差がつく項目 ' + sc.den + '点</span>' : '<span class="chip warn">全頭が持つ項目だけ＝差がつきません</span>') +
    (sc.hitN ? '<span class="chip">該当 ' + sc.hitN + '頭</span>' : '') + '</div>');
  h.push('<table class="lr-tbl bfhittbl"><thead><tr>' +
    '<th style="min-width:34px">馬番</th><th style="text-align:left">馬名</th><th>単勝</th>' +
    '<th>勝ち馬<br>共通点</th><th>3着内<br>共通点</th><th>差がつく<br>項目</th><th>判定</th>' +
    '<th style="text-align:left">内包している深い血統（6代目以降）</th></tr></thead><tbody>');
  sc.rows.forEach(function(r){
    var rk = bfHitRank(r, sc.wN);
    var od = (r.h.odds !== '' && r.h.odds != null) ? r.h.odds : '−';
    h.push('<tr class="' + (r.n ? 'bfhrow' : 'bfhrow0') + '">' +
      '<td>' + esc(r.h.no || '?') + '</td>' +
      '<td style="text-align:left">' + esc(r.h.name || '') + (r.full ? '' : '<span class="bfwarn" title="10代まで取得できていません（5代まで）">!</span>') + '</td>' +
      '<td>' + esc(String(od)) + '</td>' +
      '<td>' + (sc.wN ? '<b>' + r.w.length + '</b>/' + sc.wN : '<span class="muted">−</span>') + '</td>' +
      '<td>' + (sc.bN ? '<b>' + r.b.length + '</b>/' + sc.bN : '<span class="muted">−</span>') + '</td>' +
      '<td>' + (sc.den ? '<b>' + (r.wu.length + r.bu.length) + '</b>/' + sc.den : '<span class="muted">−</span>') + '</td>' +
      '<td>' + (rk.cls ? '<span class="bfhg ' + rk.cls + '">' + rk.txt + '</span>' : '<span class="muted">−</span>') + '</td>' +
      '<td style="text-align:left">' + bfHitItemsHtml(r, sc) + '</td></tr>');
  });
  h.push('</tbody></table>');
  var rest = sc.total - sc.have;
  h.push('<div class="small muted" style="margin-top:4px">※ <b>判定</b>は「<b>今日の出馬表で差がつく共通点</b>」の該当率です' +
    '（強=90%以上／中=60%以上／弱=1点以上）。今日の出走馬の<b>9割以上が持つ項目</b>' +
    (sc.univ.length ? '（' + sc.univ.map(function(it){ return bfDispFor(it.name); })
        .filter(function(v, i, a){ return a.indexOf(v) === i; }).slice(0, 4).map(esc).join('・') + '）' : '') +
    'は全員が持っていて差がつかないため、判定からは除いて薄いチップ（全員）で表示します。' +
    'チップの「N/M頭」はその項目を持つ今日の出走馬数です。' +
    '上の共通点と同じく6代目以降だけが対象で、5代までは下の表の☑（AI印への加点）で使います。' +
    (rest > 0 ? ' 未取得 ' + rest + '頭は「🧬 血統を抽出して今回の出走馬を検出」をもう一度押すと追加取得します。' : '') +
    (sc.deepReady < sc.have && bfDeepOn() ? ' 「!」は10代まで辿れていない馬（該当数が実際より少なく出ます）。' : '') + '</div>');
  h.push('</div>');
  box.innerHTML = h.join('');
}
/* 6〜10代目の共通点ブロック（📊カード内 #bfDeepOut） */
function bfDeepItemHtml(it){
  var disp = bfDispFor(it.name);
  var line = it.line ? (it.line + 'に ') : '';
  /* ★2026-09-13 第19弾④: 「人気馬も持っている要素」なのか「人気馬と差がつく要素」なのかを
     その場で分かるように、背景（1〜3番人気）の出現率とリフトを並べて出します。 */
  var bgTxt = '';
  if (it.bgTotal > 0){
    var bp = Math.round((it.bgRate || 0) * 100);
    var tp = it.total > 0 ? Math.round((it.n / it.total) * 100) : 0;
    var lf = (it.lift || 0);
    var lb = it.bgLabel || '人気馬';
    var cls = lf >= 1.6 ? 'good' : (lf >= 1.15 ? '' : 'bad');
    bgTxt = '<span class="bfddl ' + cls + '" title="対象（勝ち馬/3着内）での出現率 ' + tp + '% に対し、' +
      esc(lb) + 'での出現率は ' + bp + '%。リフト ' + lf.toFixed(2) + '倍' +
      (it.bgIsFav ? '' : '（このデータには人気順が入っていないため背景は出走馬全体です）') + '">' +
      esc(lb) + ' ' + (it.bgN || 0) + '/' + it.bgTotal + '頭・' + lf.toFixed(1) + '倍</span>';
  }
  return '<div class="bfdli">・' + line + '<b>' + esc(disp) + '</b> を内包' +
    '<span class="bfdln">' + it.n + '/' + it.total + '頭に該当・' + it.gen + '代目' +
    (it.all ? '・全頭' : '') + '</span>' + bgTxt + '</div>';
}
/* 10代共通点の「内部データ」を文章にする（一番効いている項目を1行で） */
function bfDeepSentHtml(dc, wItems, bItems){
  function one(it, label){
    if (!it) return '';
    /* ★2026-09-13 第19弾④: 人気馬との差（リフト）を文章にも入れる。
       リフトが1.0前後なら「人気馬と差がついていない＝ファクターとして弱い」と正直に出す。 */
    var bg = '';
    if (it.bgTotal > 0 && it.lift > 0){
      var lf = it.lift;
      var lb2 = it.bgLabel || '1〜3番人気';
      bg = '（' + esc(lb2) + 'では ' + (it.bgN || 0) + '/' + it.bgTotal + '頭・リフト <b>' + lf.toFixed(2) + '倍</b>' +
        (it.bgIsFav
          ? (lf >= 1.6 ? '＝差がつく' : lf >= 1.15 ? '＝やや差がつく' : '＝人気馬とほぼ同じで差がない')
          : '＝背景に人気順が無い参考値') + '）';
    }
    return label + '<b>' + it.total + '</b>頭のうち<b>' + it.n + '頭</b>が「' +
      (it.line ? it.line + 'に ' : '') + esc(bfDispFor(it.name)) + '（' + it.gen + '代目）」を内包' + bg;
  }
  var s = [];
  if (wItems.length) s.push(one(wItems[0], '勝ち馬'));
  if (bItems.length) s.push(one(bItems[0], '3着内'));
  if (!s.length) return '';
  var sc = null;
  try { sc = bfDeepHitScan(); } catch(e){}
  var tail = '';
  if (sc && sc.have && sc.den){
    var un = (sc.univ || []).map(function(x){ return bfDispFor(x.name); })
      .filter(function(v, i, arr){ return arr.indexOf(v) === i; });
    tail = '。今日の出走馬 <b>' + sc.have + '</b>頭で照合すると、差がつく項目は <b>' + sc.den + '点</b>' +
      (un.length ? '（' + un.slice(0, 3).map(esc).join('・') + ' はほぼ全頭が持つので判定から除外）' : '') +
      'で、該当が多いのは <b>' + esc((sc.rows[0].h.no || '') + '番 ' + (sc.rows[0].h.name || '')) + '</b>';
  } else if (sc && sc.have){
    tail = '。今日の出走馬 ' + sc.have + '頭では全頭が持つ項目だけで差がつきません';
  }
  return '<div class="bfsent">📝 ' + s.join('。') + tail + '。</div>';
}
/* 10代共通点の内訳表（項目・系統・代・勝ち馬/3着内/今日の出走馬の該当・該当した馬） */
function bfDeepTblHtml(dc){
  var wItems = (dc.win && dc.win.items) || [], bItems = (dc.board && dc.board.items) || [];
  var byName = {}, order = [];
  function add(it, side){
    var k = it.name;
    if (!byName[k]){ byName[k] = { name: k, gen: it.gen, line: it.line }; order.push(k); }
    var o = byName[k];
    o[side] = it;
    if (it.bgTotal > 0 && (!o.bgIt || (it.bgN || 0) > (o.bgIt.bgN || 0))){
      o.bgIt = { n: it.bgN || 0, all: false };
      o.bgRef = it;
    }
    if (it.gen && (!o.gen || it.gen < o.gen)) o.gen = it.gen;
    if (!o.line && it.line) o.line = it.line;
    if (side === 'b' && it.hits && it.hits.length) o.hits = it.hits;      // 3着内(1〜3着)を優先
    if (!o.hits && it.hits && it.hits.length) o.hits = it.hits;
  }
  wItems.forEach(function(it){ add(it, 'w'); });
  bItems.forEach(function(it){ add(it, 'b'); });
  if (!order.length) return '';
  var sc = null;
  try { sc = bfDeepHitScan(); } catch(e){}
  function cntCell(it, total){
    if (!it) return '<span class="muted">−</span>';
    return '<b>' + it.n + '</b>/' + total + '頭' + (it.all ? '<br><span class="bfhitnm all">ほぼ全頭</span>' : '');
  }
  function liftCell(it){
    if (!it || !(it.lift > 0)) return '<span class="muted">−</span>';
    var lf = it.lift, cls = lf >= 1.6 ? 'good' : (lf >= 1.15 ? '' : 'bad');
    var tp = it.total > 0 ? Math.round((it.n / it.total) * 100) : 0;
    var bp = Math.round((it.bgRate || 0) * 100);
    return '<span class="bfddl ' + cls + '" title="対象 ' + tp + '% ÷ 背景(' +
      esc(it.bgLabel || '人気馬') + ') ' + bp + '%' + (it.bgIsFav ? '' : ' ※このデータに人気順なし') + '">' +
      lf.toFixed(2) + '倍</span>';
  }
  function fieldCell(k){
    if (!sc || !sc.have) return '<span class="muted">未取得</span>';
    var fc = (sc.fieldCnt && sc.fieldCnt[k]) || 0;
    var univ = (sc.univ || []).some(function(x){ return x.name === k; });
    return '<b>' + fc + '</b>/' + sc.have + '頭<br><span class="bfhitnm' + (univ ? ' all' : '') + '">' +
      (univ ? '全員' : '差がつく') + '</span>';
  }
  function hitsCell(list){
    if (!list || !list.length) return '<span class="muted">（このボタンをもう一度押すと馬名まで出ます）</span>';
    function one(x){ return (x.yr ? x.yr + '年' : '') + (x.o ? x.o + '着 ' : '') + (x.nm || ''); }
    var head = list.slice(0, 3).map(one).join('、');
    if (list.length <= 3) return esc(head);
    return esc(head) + '<details class="bfmore"><summary>ほか' + (list.length - 3) + '頭</summary>' +
      esc(list.slice(3).map(one).join('、')) + '</details>';
  }
  var h = ['<div class="bfdtbl"><div class="bfdh2">📋 共通点の内訳（6〜10代目・内部データの全項目）</div>',
    '<table class="lr-tbl bfhittbl"><thead><tr>' +
    '<th style="text-align:left">内包している祖先</th><th>系統</th><th>代</th>' +
    '<th>勝ち馬<br>' + ((dc.win && dc.win.total) || 0) + '頭中</th>' +
    '<th>3着内<br>' + ((dc.board && dc.board.total) || 0) + '頭中</th>' +
    '<th>' + esc((dc.bg && dc.bg.label) || '1〜3番人気') + '<br>' + ((dc.bg && dc.bg.total) || 0) + '頭中</th>' +
    '<th>人気馬比<br>リフト</th>' +
    '<th>今日の<br>出走馬</th><th style="text-align:left">該当した馬（年・着順）</th>' +
    '</tr></thead><tbody>'];
  order.forEach(function(k){
    var o = byName[k];
    h.push('<tr><td style="text-align:left"><b>' + esc(bfDispFor(k)) + '</b></td>' +
      '<td>' + esc(o.line || '−') + '</td><td>' + (o.gen || '−') + '代目</td>' +
      '<td>' + cntCell(o.w, (dc.win && dc.win.total) || 0) + '</td>' +
      '<td>' + cntCell(o.b, (dc.board && dc.board.total) || 0) + '</td>' +
      '<td>' + cntCell(o.bgIt, (dc.bg && dc.bg.total) || 0) + '</td>' +
      '<td>' + liftCell(o.bgRef) + '</td>' +
      '<td>' + fieldCell(k) + '</td>' +
      '<td style="text-align:left">' + hitsCell(o.hits) + '</td></tr>');
  });
  h.push('</tbody></table>');
  h.push('<div class="small muted" style="margin-top:3px">※ <b>人気馬比リフト</b>＝「勝ち馬/3着内での出現率 ÷ ' + esc((dc.bg && dc.bg.label) || '1〜3番人気') + 'での出現率」。' +
    '<b>1.6倍以上</b>なら人気馬と差がついている＝ファクターとして使える目安、<b>1.0倍前後</b>は人気馬も同样に持っているので差がついていません（#2026-09-13 第19弾④）。<br>' +
    '※ 「今日の出走馬」の<b>差がつく</b>＝下の🐎該当検出の判定に使う項目、' +
    '<b>全員</b>＝出走馬の9割以上が持つので判定から除外。<b>ほぼ全頭</b>＝過去の対象馬の9割以上が持つ基礎血統。</div>');
  h.push('</div>');
  return h.join('');
}
function bfRenderDeep(){
  var box = $('bfDeepOut'); if (!box) return;
  var ls = bfLs();
  var dc = (ls.last && ls.last.deepCommon) || null;
  var name = (ls.last && (ls.last.name || ls.last.rid)) || '';
  if (!dc || !dc.deep){
    box.innerHTML = '<div class="small muted">🧬 <b>10代血統の共通点</b>: まだありません。' +
      '上の「📥 この重賞の過去10年を分析」（または重賞カレンダー）を実行してから、' +
      '<b>「🧬 血統を抽出して今回の出走馬を検出」</b>を押してください（これ1本で出走馬の検出まで進みます）。' +
      '6代目以降の共通点を<b>3〜4点だけ</b>ここに、5代までは下の表に出します' +
      '（10代まで掘る初回は数分・以後キャッシュで即時）。</div>';
    return;
  }
  var wItems = (dc.win && dc.win.items) || [], bItems = (dc.board && dc.board.items) || [];
  if (!wItems.length && !bItems.length){
    /* ★2026-09-13 第19弾④: 「人気馬も持っているだけの要素」を除外した結果が0件なら、
       それを正直に出す（無理に要素を作らない）。 */
    var dr = dc.dropped || 0;
    box.innerHTML = '<div class="small muted">🧬 10代血統の共通点: ' +
      (dr ? '<b>6〜' + BF_DEEP_GEN + '代目に「人気馬と差がつく共通点」は見つかりませんでした</b>' +
            '（候補 ' + dr + ' 件はすべて <b>' + esc((dc.bg && dc.bg.label) || '1〜3番人気') + 'の8割以上が持つ要素</b>＝' +
            '人気馬なら誰でも持っているので、ファクターとして使えません）。'
          : '<b>6代目以降に明確な共通点は見つかりませんでした</b>') +
      (name ? '（対象: ' + esc(name) + '）' : '') + '。5代までは下の表をご覧ください。</div>';
    return;
  }
  var h = [];
  h.push('<div class="bfdeep">');
  h.push('<div class="bfdh">🧬 10代血統の共通点（6代目以降・' + esc(name || 'この重賞') + '）' +
    '<span class="chip">非統計・参考</span></div>');
  if (wItems.length){
    h.push('<div class="bfdg">勝ち馬の共通点（過去' + (dc.win.total) + '年・' + dc.win.total + '頭中）' +
      '<span class="bfdn">' + wItems[0].n + '/' + wItems[0].total + '頭に該当</span></div>');
    wItems.forEach(function(it){ h.push(bfDeepItemHtml(it)); });
  }
  if (bItems.length){
    h.push('<div class="bfdg">3着内の共通点（' + dc.board.total + '頭中）' +
      '<span class="bfdn">' + bItems[0].n + '/' + bItems[0].total + '頭に該当</span></div>');
    bItems.forEach(function(it){ h.push(bfDeepItemHtml(it)); });
  }
  h.push(bfDeepSentHtml(dc, wItems, bItems));
  h.push(bfDeepTblHtml(dc));
  h.push('<div class="small muted" style="margin-top:4px">※ 6代目以降（10代まで）から<b>「人気馬比のリフトが高い順」</b>に3〜4点だけ抜粋しています' +
    '（#2026-09-13 第19弾④：以前は「該当頭数が多い順」だったため、人気馬なら誰でも持っている有名祖先ばかりが上位に来ていました）。' +
    '背景＝' + esc((dc.bg && dc.bg.label) || '1〜3番人気') + ' ' + ((dc.bg && dc.bg.total) || 0) + '頭。' +
    '背景の8割以上が持つ基礎血統（Hyperion 等）は差別化できないため、他に候補があれば除外しています。5代までは下の表に表示します。</div>');
  h.push('</div>');
  box.innerHTML = h.join('');
}
/* 世代バッジ（表の列は増やさず、名前の右に小さく出すだけ） */
function bfGenBadge(f){
  var g = parseInt(f && f.gen, 10) || 0;
  if (!g) return '';
  return ' <span class="bfg' + (g > 5 ? ' d' : '') + '" title="' + g + '代目の祖先">' + g + '代</span>';
}
function bfFactorLabel(f){
  if (f.type === 'S') return bfDispFor(f.names[0]);
  return f.names.map(bfDispFor).join(' × ');
}
function bfYearsTxt(arr){
  if (!arr || !arr.length) return '−';
  var last = arr[arr.length - 1];
  return (arr.length === 1 ? String(last) : (arr[0] + '〜' + last)) + '年(' + arr.length + '年)';
}
function bfRender(){
  var box = $('bfList'); if (!box) return;
  var ls = bfLs();
  var last = ls.last || {};
  var factors = (last.factors || []).slice();
  var h = [];
  if (!factors.length){
    box.innerHTML = '<div class="small muted">まだ分析結果がありません。⑥の「📥 この重賞の過去10年を分析」を実行してから、上の「🧬 血統を抽出して今回の出走馬を検出」を押してください。</div>';
  } else {
    var apply = !!(ls.set && ls.set.apply);
    h.push('<div class="small" style="font-weight:bold;margin:2px 0 6px">分析: ' + esc(last.name || last.rid || '') + '（過去 ' + (last.years || []).length + '年分）' +
      ' <span class="muted">' + (last.at ? ' ' + String(last.at).slice(0, 10) : '') + '</span></div>');
    h.push('<table class="lr-tbl"><thead><tr><th style="text-align:left">ファクター（血統表5代に内包する祖先・名の右は何代目か）</th><th>単勝(1着)を取った年</th><th>複勝圏(3着内)の年</th><th>単勝の連続</th><th>印に反映</th></tr></thead><tbody>');
    factors.forEach(function(f){
      var on = !!(ls.set && ls.set.on && ls.set.on[f.key]);
      var dis = apply ? '' : ' disabled';
      var nm = bfFactorLabel(f);
      h.push('<tr><td style="text-align:left">' + (f.type === 'P' ? '🤝 組: ' : '🧬 ') + esc(nm) + bfGenBadge(f) +
        (f.type === 'P' ? '<br><span class="small muted">' + f.names.length + '祖先の両方を持つ馬</span>' : '') + '</td>' +
        '<td>' + esc(bfYearsTxt(f.wYears)) + '</td><td>' + esc(bfYearsTxt(f.bYears)) + '</td>' +
        '<td>' + esc(f.streak || '−') + (f.streak ? '<br><span class="small muted">複勝圏: ' + esc(f.bStreak || '−') + '</span>' : '') + '</td>' +
        '<td><input type="checkbox" data-bfkey="' + esc(f.key) + '"' + (on ? ' checked' : '') + (dis ? dis : '') + '></td></tr>');
    });
    h.push('</tbody></table>');
    var onCount = Object.keys(ls.set.on || {}).filter(function(k){ return ls.set.on[k]; }).length;
    h.push('<div class="small" style="margin-top:6px">☑ 単勝の年 = そのファクターを持つ馬が優勝した開催年。複勝圏 = 3着以内に入った開催年。<br>' +
      '※ この表は<b>5代まで</b>（従来通り）。<b>6〜' + BF_DEEP_GEN + '代目</b>の深い血統は全部は出さず、' +
      '上の「🧬 10代血統の共通点」に<b>3〜4点だけ</b>まとめます。11代目以降や表外の超深い牝系名（Marguerite 等）は検出できません。' +
      (onCount ? ' ／ 反映中ファクター: ' + onCount + '件' : '') + '</div>');
  }
  box.innerHTML = h.join('');
}
function bfRenderToday(){
  var box = $('bfToday'); if (!box) return;
  var ls = bfLs();
  var facts = ((ls.last && ls.last.factors) || []).filter(function(f){ return ls.set.on && ls.set.on[f.key]; });
  var h = [];
  if (!facts.length){
    box.innerHTML = '<div class="small muted">該当する「反映ON」ファクターがありません。上の表でファクターの☑を入れてください。</div>';
    return;
  }
  h.push('<div class="small" style="font-weight:bold">今日の出走馬の該当チェック（反映ONファクター）</div>');
  (state.horses || []).forEach(function(hh){
    if (!hh || !hh.nk || !ls.ped[hh.nk]) return;
    var ped = bfDeepSet(hh.nk) || ls.ped[hh.nk];
    var hit = facts.filter(function(f){
      for (var j = 0; j < f.names.length; j++) if (!ped.names[f.names[j]]) return false;
      return true;
    });
    if (!hit.length) return;
    h.push('<div class="small" style="margin:2px 0">・' + esc((hh.no||'?') + '番 ' + (hh.name||'')) + ' → ' +
      hit.map(function(f){ return esc(bfFactorLabel(f)); }).join(' ／ ') + '</div>');
  });
  box.innerHTML = h.join('');
}
function bfStatus(msg, isErr){
  var el = $('bfMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  el.style.color = isErr ? '#b3261e' : '';
}
function bfLogPush(msg){ /* 簡易ログ用 */ }
function bfMasterToggle(){
  var cb = $('bfApplyCb');
  var ls = bfLs();
  if (!ls.set) ls.set = { on: {}, apply: false };
  ls.set.apply = !!(cb && cb.checked);
  bfSave(ls);
  bfRender();
  // ②の再計算（反映スイッチを即時反映）
  try { if (typeof renderKentaiFull === 'function') renderKentaiFull(); } catch(e){}
}
function bfKeyToggle(key, on){
  var ls = bfLs();
  if (!ls.set) ls.set = { on: {}, apply: false };
  var f = ((ls.last && ls.last.factors) || []).filter(function(x){ return x.key === key; })[0];
  if (!f) return;
  if (on){ ls.set.on[key] = { names: f.names, type: f.type, at: new Date().toISOString() }; }
  else { delete ls.set.on[key]; }
  bfSave(ls);
  bfRender(); bfRenderToday(); bfRenderSummary();
  try { if (typeof renderKentaiFull === 'function') renderKentaiFull(); } catch(e){}
}
function bfBindToggle(){
  ['bfList', 'bfSummary'].forEach(function(id){
    var box = $(id);
    if (box) box.addEventListener('change', function(e){
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-bfkey')) bfKeyToggle(t.getAttribute('data-bfkey'), t.checked);
    });
  });
}
function initBf(){
  bfBindToggle();
  var dc = $('bfDeepCb');
  if (dc){
    try { dc.checked = bfDeepOn(); } catch(e){}
    dc.addEventListener('change', function(){
      var ls = bfLs();
      if (!ls.set) ls.set = { on: {}, apply: false };
      ls.set.deep = !!dc.checked;
      BF_DEEP_MEM = {};
      bfSave(ls);
      bfStatus(dc.checked
        ? '🧬 深掘りON: 次回から血統を10代まで辿ります（初回は数分かかります）'
        : '深掘りOFF: 5代まで（高速）で集計します', false);
      bfRender(); bfRenderDeep(); bfRenderDeepHit(); bfRenderToday(); bfRenderSummary();
    });
  }
  var bd = $('bfDrBtn');
  if (bd) bd.addEventListener('click', function(){ bfRunExtract(false); });
  var c = $('bfApplyCb');
  if (c) c.addEventListener('change', bfMasterToggle);
  var x = $('bfReset');
  if (x) x.addEventListener('click', function(){
    var ls = bfLs();
    ls.set = { on: {}, apply: false };
    if (c) c.checked = false;
    bfSave(ls);
    bfRender(); bfRenderDeep(); bfRenderDeepHit(); bfRenderToday(); bfRenderSummary();
    try { if (typeof renderKentaiFull === 'function') renderKentaiFull(); } catch(e){}
  });
  var aa = $('bfDelCache');
  if (aa) aa.addEventListener('click', function(){
    try {
      var ls = bfLs();
      ls.ped = {}; ls.race = {}; ls.last = {}; BF_DEEP_MEM = {}; BF_DEEP_STAT = { req: 0, hit: 0, miss: 0 };
      ls.cal = {}; ls.day = {}; ls.seek = {};   // 開催カレンダー・探索キャッシュも消去
      bfSave(ls);
      bfRender(); bfRenderDeep(); bfRenderDeepHit(); bfRenderToday(); bfRenderSummary();
      bfStatus('血統・開催探索キャッシュを消去しました。');
    } catch(e){}
  });
  bfRenderTarget();
  bfRender();
  bfRenderDeep();
  bfRenderDeepHit();
  bfRenderToday();
  bfRenderSummary();
}
