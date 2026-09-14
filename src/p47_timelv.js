/* =========================================================
   47 勝ちタイムのレベル（2・3歳 未勝利／1勝／2勝／3勝クラス）
   ---------------------------------------------------------
   ねらい: 条件戦を勝った馬の「勝ちタイムの水準」を、
     ①同競馬場・同馬場(芝/ダ)・同距離帯(±200m)・同じ時期(±3週)の過去の勝ち時計（＝開催場の歴代同レベル）
     ②距離別の基準時計(パータイム)
   の両方と比べて **早い🎯 / 平凡○ / 遅い⚠️** を付け、次走以降の扱いを決める材料にする。
     ・早い → 次走以降は買い（🎯）
     ・遅い → 次走以降は少し疑う（⚠️）
     ・平凡 → 特に対応なし（○）
   判定は「短評」として📒馬ノートに自動登録し、該当馬が**次走**（＝前走がその勝ちレース）で
   出馬表に載ったら、出馬表と②のAI印表の馬名の横に 🎯 / ⚠️ を自動で出す。
   次々走以降はバッジは付けず、📒馬ノートの短評（メモ）で確認できる。
   データ源は 馬柱キャッシュ（khl_hd_v1 / 🐎全馬プロフィール・⏱持ちタイム で取得）。
   ========================================================= */
var TL_LS = 'khl_timelv_v1';
var TL_SPD = 0.08;      // m/s: これ以上速ければ「早い」
var TL_PAR_F = 1.0;     // 秒: 基準時計よりこれ以上速ければ「早い」（過去比較ができないときのフォールバック）
var TL_PAR_S = 1.4;     // 秒: 基準時計よりこれ以上遅ければ「遅い」
function tlLs(){ try { return JSON.parse(localStorage.getItem(TL_LS) || '{}') || {}; } catch(e){ return {}; } }
function tlSave(o){ try { safeSetItem(TL_LS, JSON.stringify(o))   /* 🥇⏱評価・🎯/⚠️＝学習の成果 */; } catch(e){} }
function tlBlank(){ return { byNk: {}, byName: {}, set: { note: true }, ev: {} }; }
function tlStore(){
  var o = tlLs();
  if (!o.byNk) o.byNk = {};
  if (!o.byName) o.byName = {};
  if (!o.set) o.set = { note: true };
  if (!o.ev) o.ev = {};
  return o;
}
/* ---------- 日付の正規化（netkeiba は 2026/08/16、raceId は 20260816 形式） ---------- */
function tlD8(x){
  var t = String(x == null ? '' : x).trim();
  if (/^\d{8}$/.test(t)) return t;
  var m = t.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2);
  var n = t.replace(/[^0-9]/g, '');
  return n.length >= 8 ? n.slice(0, 8) : '';
}
/* ★2026-09-13 第24弾・追加修正2: 学習DBレコードから「確定している日付」を取る。
   以前は 1041行で `rec.meta.date8 || String(rid).slice(0, 8)` としていました。ところが
     race_id = 202609040311 = 2026年・09月・【4回】・3日目・11R
   なので **先頭8桁は YYYYMM＋回 であり日付ではありません**（§53-8 の表示バグと同じ誤り）。
   さらに JRA 経路の rid は `'JRA' + date8 + …` と先頭が文字なので
   slice(0,8) = 'JRA20260' → tlD8() の検証を全部落ちて '' になり、
   `if (!d8) { drop++; return; }` で **サンプルが黙って捨てられていました**。

   ここでは確定している日付を次の順で探します（上ほど確実）:
     1) rec.meta.date8 … 取込時に必ず入る（p32:540 / p32:656）。第一優先
     2) rec.date8      … レコード直下。これも取込時に必ず入る（p32:539 / p32:654）。
                         ★旧バックアップJSONからの復元（diImportFile は中身をそのまま保存）でも
                           残っていることが多く、今回の穴はほぼここで塞がります
     3) rec.meta.date  … '2026-09-12' 形式。tlD8() が YYYYMMDD に正規化
     4) rid が 12桁数字（netkeiba形式）のときだけ先頭8桁を最後の手段として使う。
        「日」は復元できませんが **年・月は正しい**ので年補正には使え、
        捨ててしまうより母数を保てます（重複排除キーの日付だけが不正確になる）
     5) それ以外（JRA形式など）は '' → 呼び出し側で drop。
        誤った日付で学習するより、サンプルを落とすほうが安全です。
   ※ 通常運用（現行版での取込）では 1) だけで決まるため、挙動は変わりません。 */
function tlRecD8(rec, rid){
  var c = [ (rec && rec.meta && rec.meta.date8) || '', (rec && rec.date8) || '', (rec && rec.meta && rec.meta.date) || '' ];
  for (var i = 0; i < c.length; i++){
    var d = tlD8(c[i]);
    if (/^\d{8}$/.test(d)) return d;
  }
  var r = String(rid || '');
  if (/^\d{12}$/.test(r)) return r.slice(0, 8);   // 4) 年・月は正しい（日は「回」なので不正確）
  return '';                                       // 5) 日付を確定できない → drop させる
}
/* =========================================================
   ★2026-09-13 第26弾⑤: 前走の「相手の強さ」＝レースレベル（相手関係ベース）
   ---------------------------------------------------------
   ご依頼: 「前走のレースで一緒に走った他馬の次走の結果を検出して
            レースレベルはどうだったかを判断してほしい」
   既存の raceLv(:403) は【時計ベース】（勝ち時計が速かったか）なので、
   **勝ち時計が同じでも相手の質が違う**というご指摘には答えられません。
   → 別関数 fieldLvOf() として【相手関係ベース】を追加し、置き換えず共存させます。

   計算:
     1) 前走レース（date8 × 場 × R）を学習DBから特定
     2) 自分以外の出走馬名を集める
     3) **前走より後（date8 > 前走date8）のレースだけ**を走査して、
        その他馬たちの出走数・3着内数を集計
     4) rate = 3着内数 / 出走数  … 高いほど「相手がその後よく走っている＝レベルの高いレース」

   ⚠ いかさま防止: 必ず前走より【後】の結果だけを使うこと（p52_histfeat と同じ思想）。
   ⚠ 全レコード走査なので重い → FIELD_MEMO でメモ化（diLsDrop と同じ要領で fieldLvDrop()）。
   ========================================================= */
var FIELD_MEMO = {};
var FIELD_MIN_RUNS = 10;        // これ未満は「データ不足」で判定しない
function fieldLvDrop(){ FIELD_MEMO = {}; }
function fieldLvOf(selfName, d8, venue, rnum){
  try {
    d8 = String(d8 == null ? '' : d8).replace(/[^0-9]/g, '').slice(0, 8);
    venue = String(venue == null ? '' : venue).trim();
    rnum = parseInt(rnum || 0, 10);
    if (d8.length !== 8 || !venue || !(rnum >= 1)) return null;
    var self = String(selfName == null ? '' : selfName).trim();
    var key = self + '|' + d8 + '|' + venue + '|' + rnum;
    if (FIELD_MEMO[key]) return FIELD_MEMO[key];
    var all = (typeof diLsAll === 'function') ? diLsAll() : {};
    var rids = Object.keys(all || {});
    /* 1) 前走レースを特定 */
    var prev = null;
    for (var i = 0; i < rids.length; i++){
      var r0 = all[rids[i]], m0 = r0 && r0.meta;
      if (!m0) continue;
      if (String(m0.date8 || '') !== d8) continue;
      if (String(m0.place || '') !== venue) continue;
      if (parseInt(m0.rnum || 0, 10) !== rnum) continue;
      prev = r0; break;
    }
    if (!prev || !prev.rows || !prev.rows.length){
      var e1 = { err: 'no race', d8: d8, venue: venue, rnum: rnum };
      FIELD_MEMO[key] = e1; return e1;
    }
    /* 2) 自分以外の出走馬 */
    var others = {};
    (prev.rows || []).forEach(function(h){
      var n = String((h && h.name) || '').trim();
      if (n && n !== self) others[n] = 1;
    });
    var names = Object.keys(others);
    if (!names.length){
      var e2 = { err: 'no field', d8: d8, venue: venue, rnum: rnum, nField: 0 };
      FIELD_MEMO[key] = e2; return e2;
    }
    /* 3) 前走より【後】のレースだけで他馬の成績を集計（いかさま防止） */
    var runs = 0, in3 = 0, wins = 0, hit = {};
    for (var j = 0; j < rids.length; j++){
      var r1 = all[rids[j]], m1 = r1 && r1.meta;
      if (!m1) continue;
      var rd = String(m1.date8 || '');
      if (rd.length !== 8) continue;
      if (!(rd > d8)) continue;                     // ★前走より後だけ
      var rows = r1.rows || [];
      for (var k = 0; k < rows.length; k++){
        var h = rows[k];
        var n2 = String((h && h.name) || '').trim();
        if (!others[n2]) continue;
        var o = parseInt((h && h.order) || 0, 10);
        if (!(o >= 1)) continue;
        runs++; hit[n2] = 1;
        if (o <= 3){ in3++; if (o === 1) wins++; }
      }
    }
    var out = {
      runs: runs, in3: in3, wins: wins,
      nField: names.length, nHit: Object.keys(hit).length,
      rate: runs > 0 ? in3 / runs : null,
      winRate: runs > 0 ? wins / runs : null,
      enough: runs >= FIELD_MIN_RUNS,
      d8: d8, venue: venue, rnum: rnum, self: self
    };
    FIELD_MEMO[key] = out;
    return out;
  } catch(e){ return null; }
}
/* レベルのラベル（A: 相手がその後よく走っている＝ハイレベル … D: 低レベル） */
function fieldLvLabel(f){
  if (!f || f.err || !f.enough || f.rate == null) return '';
  var r = f.rate;
  if (r >= 0.35) return 'A';
  if (r >= 0.25) return 'B';
  if (r >= 0.15) return 'C';
  return 'D';
}
/* 予想に掛ける倍率（既存 raceLv(時計) とは別に、乗算で組み合わせる用）
   データ不足・サンプル薄は 1.0（何もしない） */
function fieldLvMul(f, myOrder){
  var lv = fieldLvLabel(f);
  if (!lv) return 1;
  var o = parseInt(myOrder || 0, 10);
  if (!(o >= 1)) return 1;
  /* レベルの高いレース(A/B)で好走していたなら上乗せ、低いレース(C/D)での好走なら割り引く。
     着順が悪いほど「相手が強かった」ことの価値は下がるので控えめに。 */
  var base = { A: 1.14, B: 1.07, C: 0.97, D: 0.91 }[lv] || 1;
  var damp = o <= 3 ? 1 : (o <= 5 ? 0.75 : 0.5);      // 3着内 > 5着以内 > それ以外
  return 1 + (base - 1) * damp;
}
/* 根拠文（②の短評・馬柱に出す用） */
function fieldLvNote(f, myOrder){
  if (!f) return '';
  if (f.err === 'no race') return '';
  if (f.err === 'no field' || !f.enough) return '';
  var lv = fieldLvLabel(f);
  if (!lv) return '';
  var pc = (f.rate * 100).toFixed(0);
  var head = '前走の相手レベル ' + lv + '（同走' + f.nField + '頭のうち ' + f.nHit + '頭がその後出走・' +
             f.runs + '戦' + f.in3 + '連対内＝3着内率' + pc + '%）';
  if (lv === 'A' || lv === 'B')
    return head + '。相手がその後も走っているので、' + (myOrder <= 3 ? '前走好走の評価を上乗せ' : '着順ほど悪くはない可能性');
  return head + '。相手のその後の成績が低調なので、前走好走でも割り引きが必要';
}
function tlDoy(d8){
  if (!/^\d{8}$/.test(d8)) return null;
  var y = parseInt(d8.slice(0, 4), 10), mo = parseInt(d8.slice(4, 6), 10), da = parseInt(d8.slice(6, 8), 10);
  var dt = new Date(y, mo - 1, da);
  if (isNaN(dt.getTime())) return null;
  return Math.round((dt - new Date(y, 0, 0)) / 86400000);
}
function tlNearDoy(a, b, win){
  if (a == null || b == null) return true;      // 日付が読めないときは期間で絞らない
  var df = Math.abs(a - b);
  if (df > 182) df = 365 - df;                   // 年またぎ
  return df <= (win || 21);
}
/* 基準時計(パー)のクラス補正。PAR_TIME は概ね「未勝利〜1勝クラス」水準なので、
   クラス・格が上がるほど速い時計が出るぶんの差を引いておく（実データの平均差から概算）。 */
function tlParOff(rname){
  var n = String(rname || '');
  var g = n.match(/[(（](G[IV]+|L|OP|LISTED)[)）]/i);
  if (g){
    var t = g[1].toUpperCase();
    if (t === 'GI' || t === 'G1') return -1.7;
    if (t === 'GII' || t === 'G2') return -1.4;
    if (t === 'GIII' || t === 'G3') return -1.1;
    if (t === 'L' || t === 'LISTED') return -0.9;
    if (t === 'OP') return -0.7;
  }
  if (/新馬/.test(n)) return 1.5;
  var c = tlClassOf(n);
  if (c === '未勝利') return 0.9;
  if (c === '1勝クラス') return 0.4;
  if (c === '2勝クラス') return 0.0;
  if (c === '3勝クラス') return -0.4;
  return 0.1;                                     // 特別戦など（1勝〜2勝クラス中心）
}
/* ---------- クラス・年齢の判定 ---------- */
var TL_CLASSES = ['未勝利', '1勝クラス', '2勝クラス', '3勝クラス'];
function tlClassOf(name){
  var s = String(name || '');
  for (var i = 0; i < TL_CLASSES.length; i++){ if (s.indexOf(TL_CLASSES[i]) >= 0) return TL_CLASSES[i]; }
  if (/500万/.test(s)) return '1勝クラス';
  if (/1000万/.test(s)) return '2勝クラス';
  if (/新馬|メイドン/.test(s)) return '新馬';
  return '';
}
function tlAgeOf(name){
  var m = String(name || '').match(/([2-9])歳/);
  return m ? parseInt(m[1], 10) : 0;
}
/* 対象: 2・3歳戦の 未勝利 / 1勝 / 2勝 / 3勝クラス（年齢が取れない場合はクラス名だけで判断） */
function tlIsTarget(row){
  if (!row || parseInt(row.order, 10) !== 1) return false;
  var nm = String(row.name || '');
  var cls = tlClassOf(nm);
  if (!cls || cls === '新馬') return false;
  if (/以上/.test(nm)) return false;      // 「3歳以上1勝クラス」等は古馬も出る＝2・3歳戦ではない
  var age = tlAgeOf(nm);
  if (age && (age < 2 || age > 3)) return false;
  return true;
}
/* ---------- 馬場（netkeiba馬柱は「稍」「不」の省略表記）と良換算 ---------- */
function tlBaba(x){
  var b = (typeof bbNormBaba === 'function') ? bbNormBaba(x) : String(x == null ? '' : x).trim();
  return b || String(x == null ? '' : x).trim();
}
/* 良馬場換算の補正値（秒）。芝は雨で遅く、ダートは雨で速くなる。
   ※旧値(稍重1.4/重3.0/不良5.0)は大きすぎて、不良馬場の時計が「良なら世界記録級」に化けていた。
     実データ(287走)で検証し、一般的な目安に合わせて縮小した。surface に 'ダ' を含むかで出し分ける。 */
var TL_BABA_ADJ_TURF = { '稍重': 0.7, '重': 1.4, '不良': 2.0 };
var TL_BABA_ADJ_DIRT = { '稍重': -0.5, '重': -0.9, '不良': -0.6 };
function tlBabaAdjStatic(baba, surface){
  var b = tlBaba(baba);
  if (!b || b === '良') return 0;
  var T = String(surface || '').indexOf('ダ') >= 0 ? TL_BABA_ADJ_DIRT : TL_BABA_ADJ_TURF;
  return T[b] || 0;
}
/* 馬場換算: 🎓学習DBから学習した値があればそれを優先（無ければ上の静的テーブル） */
function tlBabaAdj(baba, surface){
  var b = tlBaba(baba);
  if (!b || b === '良') return 0;
  var L = (typeof tlLearnBabaAdj === 'function') ? tlLearnBabaAdj(b, surface) : null;
  return (L != null) ? L : tlBabaAdjStatic(b, surface);
}
/* ---------- 比較母集団: 同面・同距離帯・同じ時期の「勝ち時計」 ----------
   1着の行は自分の時計、それ以外の行は「自分の時計 − 着差(秒)」がそのレースの勝ち時計になる。
   （netkeiba 馬柱の着差列は“勝ち馬までの秒差”。例: 16着 1:39.6 / 着差5.8 → 勝ち時計 1:33.8）
   これにより未勝利クラスの出走馬（1着の行がほとんど無い）でも母集団が確保できる。
   同じレースは1件だけ（一番上の着順の行＝推定が最も正確）を数える。 */
var TL_SPD2 = 0.12;     // m/s: 他場を含む母集団のときの「速い/遅い」しきい値（コース差があるので少し緩める）
/* 基準時計(PAR_TIME)を距離で線形補間して「その距離の基準速度 m/s」を出す。
   母集団に 1400m や 1800m が混ざっても、この基準比で対象距離に換算してから平均する。 */
function tlParSpd(surface, m){
  m = parseInt(m, 10);
  if (!m) return null;
  var key = String(surface || '').indexOf('ダ') >= 0 ? 'dirt' : 'turf';
  var T = (typeof PAR_TIME !== 'undefined' && PAR_TIME[key]) ? PAR_TIME[key] : null;
  if (!T) return null;
  var ks = Object.keys(T).map(Number).sort(function(a, b){ return a - b; });
  if (!ks.length) return null;
  var sec;
  if (m <= ks[0]) sec = T[ks[0]] * m / ks[0];
  else if (m >= ks[ks.length - 1]) sec = T[ks[ks.length - 1]] * m / ks[ks.length - 1];
  else {
    sec = null;
    for (var i = 0; i < ks.length - 1; i++){
      if (m >= ks[i] && m <= ks[i + 1]){
        var t = (m - ks[i]) / (ks[i + 1] - ks[i]);
        sec = T[ks[i]] + (T[ks[i + 1]] - T[ks[i]]) * t;
        break;
      }
    }
  }
  return sec ? (m / sec) : null;
}
function tlMedian(a){
  if (!a || !a.length) return 0;
  var b = a.slice().sort(function(x, y){ return x - y; });
  var n = b.length;
  return (n % 2) ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
}
/* その距離・そのクラス（レース名）の基準時計（秒）。距離は PAR_TIME を線形補間、クラスは tlParOff。 */
function tlBaseSecStatic(surface, m, rname){
  if (tlLearnSurf(surface, rname) === '障') return null;   // 第14弾: 障害に平地のパータイムを流用しない
  m = parseInt(m, 10);
  if (!m) return null;
  var key = String(surface || '').indexOf('ダ') >= 0 ? 'dirt' : 'turf';
  var T = (typeof PAR_TIME !== 'undefined' && PAR_TIME[key]) ? PAR_TIME[key] : null;
  if (!T) return null;
  var ks = Object.keys(T).map(Number).sort(function(a, b){ return a - b; });
  if (!ks.length) return null;
  var sec;
  if (m <= ks[0]) sec = T[ks[0]] * m / ks[0];
  else if (m >= ks[ks.length - 1]) sec = T[ks[ks.length - 1]] * m / ks[ks.length - 1];
  else {
    for (var i = 0; i < ks.length - 1; i++){
      if (m >= ks[i] && m <= ks[i + 1]){
        var t = (m - ks[i]) / (ks[i + 1] - ks[i]);
        sec = T[ks[i]] + (T[ks[i + 1]] - T[ks[i]]) * t;
        break;
      }
    }
  }
  return sec != null ? (sec + tlParOff(rname) * tlClsScale(m)) : null;
}
/* 基準時計: 🎓学習DB（④の年指定一括取込）から学習した「距離×クラス×競馬場×年」があればそれを優先。
   学習データが薄いセルは上の静的テーブル（パータイム＋クラス補正）にそのままフォールバックします。
   venue / d8 は省略可（省略すると競馬場補正・年補正は掛けません）。 */
function tlBaseSec(surface, m, rname, venue, d8){
  var sf = tlLearnSurf(surface, rname);      // レース名も見て '障' を確実に拾う
  if (typeof tlLearnBase === 'function'){
    var L = tlLearnBase(sf, m, (typeof tlLearnCls === 'function') ? tlLearnCls(rname) : '', venue, d8,
                        (typeof tlLearnAge === 'function') ? tlLearnAge(rname) : '');
    if (L != null) return L;
  }
  /* 2026-09-11 第14弾: 障害は「障害だけの学習値」が無いときに芝/ダートの静的テーブルを流用しない。
     流用すると 3.10.0 相当のレースを 1.58.0 の基準で評価してしまうため。 */
  if (sf === '障') return null;
  return tlBaseSecStatic(sf, m, rname);
}
/* クラス差は距離が伸びるほど「秒」で大きくなるので、1600m基準で0.7〜1.6倍に伸縮する */
function tlClsScale(m){
  var x = (parseInt(m, 10) || 1600) / 1600;
  return Math.max(0.7, Math.min(1.6, x));
}
/* キャッシュ済みの全馬柱から「勝ち時計（良換算）」の見本を集めて、対象距離・対象面に換算する */
function tlWinSamples(o){
  var res = { n: 0, sec: 0, spd: 0, src: '', tier: -1, th: TL_SPD, list: [], ratios: [] };
  var ls;
  try { ls = (typeof hdLs === 'function') ? hdLs() : {}; } catch(e){ return res; }
  if (!o || !o.dist) return res;
  var d8_0 = tlD8(o.date), doy0 = tlDoy(d8_0);
  var sk8 = '';
  if (o.selfKey){ var pp = String(o.selfKey).split('|'); sk8 = tlD8(pp[0]) + '|' + (pp[1] || ''); }
  var best = {};
  Object.keys(ls || {}).forEach(function(nk){
    var rows = (ls[nk] && ls[nk].r) || [];
    rows.forEach(function(r){
      if (!r) return;
      var ord = parseInt(r.order, 10);
      if (!(ord >= 1)) return;                                          // 取消・除外・中止は使わない
      if (o.venue && String(r.venueName || '') !== o.venue) return;      // 競馬場（段によって絞る/絞らない）
      if (o.surface && String(r.surface || '') !== o.surface) return;    // 芝/ダ
      if (String(r.surface || '') === '障') return;                      // 障害は時計の土俵が違う
      if (tlBaba(r.baba) === '不良') return;                             // 不良は補正の誤差が大きいので母集団に使わない
      var band = o.band || 200;
      if (!r.m || Math.abs(r.m - o.dist) > band) return;                // 同距離帯
      var d8 = tlD8(r.date);
      if (!d8 || (d8_0 && d8 > d8_0)) return;                            // 対象レースより後は使わない
      if (!tlNearDoy(tlDoy(d8), doy0, o.days || 21)) return;             // 同じ時期（季節は揃える）
      var rname = String(r.name || '');
      if (sk8 && (d8 + '|' + rname) === sk8) return;                     // 評価するレース自身は除く
      var sec0 = (typeof nkToSec === 'function') ? nkToSec(r.time) : null;
      if (!sec0) return;
      var wsec;
      if (ord === 1) wsec = sec0;
      else {
        var g = parseFloat(String(r.margin || '').replace(/[^0-9.]/g, ''));
        if (!isFinite(g) || g < 0 || g > 20) return;                     // 着差が読めない行は推定に使わない
        wsec = sec0 - g;                                                 // 着差は「勝ち馬までの秒差」なので引く
      }
      wsec = wsec - tlBabaAdj(r.baba, r.surface);                         // 良馬場換算
      if (!(wsec > 5)) return;
      var base = tlBaseSec(o.surface, r.m, rname, r.venueName, d8);       // その距離・クラス・場・年の基準時計
      var rk = d8 + '|' + String(r.venueName || '') + '|' + String(r.r || '') + '|' + rname + '|' + r.m;
      var prev = best[rk];
      if (!prev || ord < prev.order) best[rk] = { sec: wsec, base: base, order: ord, m: r.m, d8: d8, venue: r.venueName, name: rname };
    });
  });
  var resids = [], secs = [];
  Object.keys(best).forEach(function(k){
    var b = best[k];
    if (b.base == null) return;                                          // 基準時計が出せない距離は使わない
    b.resid = b.base - b.sec;                                            // ＋＝そのクラスの基準より速い
    res.list.push(b); resids.push(b.resid); secs.push(b.sec);
  });
  res.n = res.list.length;
  if (!res.n) return res;
  var tgtBase = tlBaseSec(o.surface, o.dist, o.name, o.venue, o.date);
  if (tgtBase != null){
    // 距離もクラスも違う見本を「基準時計との差（秒）」に直し、その中央値を対象レースの基準に戻す
    // （平均だと新馬・少頭数などの外れ値に引っ張られるので中央値を使う）
    res.resid = tlMedian(resids);
    res.residAvg = resids.reduce(function(a, b){ return a + b; }, 0) / resids.length;
    res.sec = tgtBase - res.resid;
    res.spd = o.dist / res.sec;
    res.via = 'resid';
  } else {
    res.sec = secs.reduce(function(a, b){ return a + b; }, 0) / secs.length;
    res.spd = o.dist / res.sec;
    res.via = 'raw';
  }
  res.min = Math.min.apply(null, secs);
  res.max = Math.max.apply(null, secs);
  return res;
}
/* ①同場 → ②他場も含む → ③期間を±7週に拡大、の順で3件以上集まるところを採用する */
var TL_TIERS = [
  { own: true,  days: 21,  band: 200, src: '同場・前後3週の勝ち時計', th: TL_SPD },
  { own: true,  days: 100, band: 200, src: '同場・前後14週の勝ち時計', th: TL_SPD },
  { own: false, days: 21,  band: 200, src: '他場も含む前後3週の勝ち時計', th: TL_SPD2 },
  { own: false, days: 100, band: 300, src: '他場も含む前後14週の勝ち時計', th: TL_SPD2 }
];
function tlPastAvg(venue, surface, dist, dateStr, selfKey, rname){
  var last = { n: 0, sec: 0, spd: 0, src: '母集団なし', tier: -1, th: TL_SPD, list: [] };
  if (typeof hdLs !== 'function' || !dist) return last;
  for (var i = 0; i < TL_TIERS.length; i++){
    var T = TL_TIERS[i];
    var r = tlWinSamples({
      venue: T.own ? venue : '', surface: surface, dist: dist, date: dateStr,
      selfKey: selfKey, days: T.days, band: T.band, name: rname
    });
    r.th = T.th; r.tier = i;
    if (r.n >= 3){ r.src = T.src + ' ' + r.n + ' 件（距離・クラスは基準時計で換算）'; return r; }
    last = r;
  }
  last.src = '母集団なし'; last.tier = -1; last.th = TL_SPD;
  return last;
}
/* 1レースぶんを評価 → {lv:'fast'|'mid'|'slow', ...} */
/* ---------- レースの識別子（同じレースを別馬の馬柱から探す） ---------- */
function tlRaceKeyOf(row){
  return [tlD8(row && row.date), String((row && row.venue) || ''), String((row && row.r) || ''),
    String((row && row.m) || '')].join('|');
}
/* 勝ち馬の「2着差」。netkeiba の着差列は“勝ち馬との差（秒）”なので、
   同じレースでこの馬に負けた行（勝ち馬欄＝この馬）の最小値が 2着差になる。 */
function tlWinGap(row, hName){
  if (!row || parseInt(row.order, 10) !== 1) return null;
  var nm = tlNormName(hName);
  if (!nm) return null;
  var key = tlRaceKeyOf(row), best = null, ls = {};
  try { ls = hdLs(); } catch(e){ return null; }
  Object.keys(ls || {}).forEach(function(k){
    var rows = (ls[k] && ls[k].r) || [];
    rows.forEach(function(r){
      if (!r || !(parseInt(r.order, 10) > 1)) return;
      if (tlRaceKeyOf(r) !== key) return;
      if (tlNormName(r.winner) !== nm) return;
      var g = parseFloat(String(r.margin || '').replace(/[^0-9.\-]/g, ''));
      if (isFinite(g) && g >= 0 && g <= 20 && (best == null || g < best)) best = g;
    });
  });
  return best;
}
/* そのレースの勝ち時計（良換算・推定）: 1着＝自分の時計、それ以外＝自分の時計 − 着差
   ※netkeiba 馬柱の「着差」列は“勝ち馬までの秒差”（例: 3着 1:34.0 / 着差0.2 → 勝ち時計 1:33.8）。
     実データ16頭ぶんで全着順の一致性を確認済み（16着 1:39.6 / 着差5.8 → 1:33.8）。 */
function tlWinSecOf(secAdj, row){
  var ord = parseInt(row && row.order, 10) || 0;
  if (ord === 1) return secAdj;
  var g = parseFloat(String((row && row.margin) || '').replace(/[^0-9.]/g, ''));
  if (!isFinite(g) || g < 0) return null;
  return secAdj - g;
}
/* 判定（速度差优先 → 基準時計差） */
function tlLevel(dSpd, dPar, th){
  var T = (th || TL_SPD);
  if (dSpd != null) return (dSpd >= T) ? 'fast' : (dSpd <= -T ? 'slow' : 'mid');
  if (dPar != null) return (dPar <= -TL_PAR_F) ? 'fast' : (dPar >= TL_PAR_S ? 'slow' : 'mid');
  return '';
}
/* ---------- 1走ぶんを評価（1着以外も対象） ---------- */
function tlEvalRun(row, hName, selfKey){
  if (!row) return null;
  var sec = (typeof nkToSec === 'function') ? nkToSec(row.time) : null;
  if (!sec || !row.m) return null;
  var venue = row.venueName || '';
  var surface = String(row.surface || '');
  var baba = tlBaba(row.baba);
  var adj = tlBabaAdj(baba, surface);
  var secAdj = sec - adj;                                          // 良馬場換算
  var sk = selfKey || (tlD8(row.date) + '|' + String(row.name || ''));
  var past = tlPastAvg(venue, surface, row.m, row.date, sk, row.name);
  if (surface === '障') return null;                                     // 障害戦は評価しない
  // 母集団が足りなかったときの基準時計（🎓学習値があればそれ、無ければパータイム＋クラス補正）
  var par = tlBaseSec(surface, row.m, row.name, venue, row.date);
  var parLearned = (typeof tlLearnBase === 'function') &&
    tlLearnBase(surface, row.m, (typeof tlLearnCls === 'function') ? tlLearnCls(row.name) : '', venue, row.date,
                (typeof tlLearnAge === 'function') ? tlLearnAge(row.name) : '') != null;
  if (par == null){
    var par0 = (typeof nkParSec === 'function') ? nkParSec(surface, row.m, '良') : null;
    par = (par0 != null) ? (par0 + tlParOff(row.name)) : null;   // PAR_TIME が無い環境用の最後の保険
  }
  var dSpd = (past.n >= 3 && past.spd) ? (row.m / secAdj - past.spd) : null;
  var dPar = (par != null) ? (secAdj - par) : null;
  var th = past.th || TL_SPD;
  var lv = tlLevel(dSpd, dPar, th);
  if (!lv) return null;
  var order = parseInt(row.order, 10) || 0;
  var gap = parseFloat(String(row.margin || '').replace(/[^0-9.]/g, ''));
  gap = isFinite(gap) ? gap : null;
  var winSec = tlWinSecOf(secAdj, row);
  var dSpdW = (winSec != null && past.n >= 3 && past.spd) ? (row.m / winSec - past.spd) : null;
  var dParW = (winSec != null && par != null) ? (winSec - par) : null;
  var raceLv = (winSec != null) ? tlLevel(dSpdW, dParW, th) : '';
  var ev = {
    lv: lv, raceLv: raceLv, order: order, isWin: order === 1,
    sec: sec, secAdj: secAdj, babaAdj: adj, baba: baba, timeStr: String(row.time || ''),
    gap: (order === 1 ? 0 : gap), winSec: winSec,
    winGap: (order === 1) ? tlWinGap(row, hName) : null,          // 勝ち馬なら2着差
    dSpd: dSpd, dPar: dPar, dSpdW: dSpdW, dParW: dParW,
    pastN: past.n, pastSec: past.sec, pastSrc: past.src || '', pastTier: past.tier, th: th, par: par, parLearned: !!parLearned,
    date: String(row.date || ''), d8: tlD8(row.date), venue: venue, surface: surface,
    dist: row.m, cls: tlClassOf(row.name), age: tlAgeOf(row.name),
    rname: String(row.name || ''), rno: String(row.r || ''), head: String(row.head || ''),
    winner: String(row.winner || ''), pass: String(row.pass || ''),
    at: new Date().toISOString()
  };
  ev.babaBad = (baba === '不良');                    // 不良馬場の時計は参考値（マークは付けない）
  ev.badge = ev.babaBad ? '' : tlBadgeOf(ev);
  ev.txt = tlShortText(ev, hName);
  return ev;
}
/* 1着以外でも「追記する価値がある」走りか
   A) 自分の時計が同条件より速い（着順・馬券内は問わない）
   B) レース自体の勝ち時計が速い（レベルの高いレース）で、勝ち馬から1.0秒差以内 */
function tlNotable(ev){
  if (!ev || ev.babaBad) return false;
  if (ev.lv === 'fast') return true;
  if (ev.raceLv === 'fast' && ev.lv !== 'slow' && ev.gap != null && ev.gap <= 1.0) return true;
  return false;
}
function tlEvalRow(row, selfKey){ return tlEvalRun(row, '', selfKey); }   // 旧API（1着の評価）
/* バッジ用の総合判定（🎯＝時計が買い材料／⚠️＝時計が割り引き材料）
   1着でなくても、①自分の時計が速い ②レース自体のレベルが高く勝ち馬から僅差 なら🎯 */
function tlBadgeOf(ev){
  if (!ev) return '';
  if (ev.lv === 'fast') return 'fast';                                    // 1着じゃなくても時計が速い
  if (ev.raceLv === 'fast' && ev.lv !== 'slow' && ev.gap != null && ev.gap <= 1.0) return 'fast';   // レベルの高いレースで僅差
  if (ev.isWin && ev.lv === 'slow') return 'slow';                        // ⚠️は「勝ち時計が遅い」＝レースのレベルが低いときだけ
  return '';
}
function tlSameRun(a, b){
  return !!(a && b && a.d8 === b.d8 && a.rname === b.rname && a.dist === b.dist && a.order === b.order);
}

/* ---------- 出走馬1頭: 前走（必ず）＋直近の対象クラスV＋直近3走の好時計 ---------- */
function tlRaceDateStr(){
  var d8 = '';
  try {
    if (typeof jvCurrent === 'function'){
      var c = jvCurrent();
      d8 = tlD8((c && c.date8) || '');
      if (d8) return d8;
    }
  } catch(e){}
  try { d8 = tlD8((state.race && state.race.date) || ''); } catch(e){}
  if (d8) return d8;
  var n = new Date();                 // 開催日が分からないときは「今日」より前の戦績だけを使う
  return '' + n.getFullYear() + ('0' + (n.getMonth() + 1)).slice(-2) + ('0' + n.getDate()).slice(-2);
}
function tlHorseRows(h){
  var ls = {};
  try { ls = (typeof hdLs === 'function') ? hdLs() : {}; } catch(e){ ls = {}; }
  var rec = (h && h.nk) ? ls[h.nk] : null;
  if (!rec || !rec.r || !rec.r.length) return null;
  var today = tlRaceDateStr();
  var rows = rec.r.filter(function(r){ return r && tlD8(r.date); }).slice();
  rows.sort(function(a, b){ return tlD8(b.date).localeCompare(tlD8(a.date)); });   // 新しい順
  if (today) rows = rows.filter(function(r){ return tlD8(r.date) < today; });      // 今回より前だけ
  return rows;
}
function tlScanHorse(h){
  var rows = tlHorseRows(h);
  if (!rows) return { st: 'nodata' };
  if (!rows.length) return { st: 'norun' };
  var prev = rows[0], evs = [];
  var evPrev = null;
  try { evPrev = tlEvalRun(prev, h && h.name); } catch(e){ evPrev = null; }
  if (evPrev){
    evPrev.isPrev = true; evPrev.tag = '前走';
    evs.push(evPrev);
  }
  // 直近の「2・3歳 未勝利〜3勝クラス」の勝ち鞍（前走とは別の走りなら追加）
  for (var i = 0; i < rows.length; i++){
    if (!tlIsTarget(rows[i])) continue;
    var evW = null;
    try { evW = tlEvalRun(rows[i], h && h.name); } catch(e){ evW = null; }
    if (evW){
      if (tlSameRun(evW, evPrev)){ if (evPrev) evPrev.tag = '前走＝対象クラスのV'; }
      else { evW.isPrev = false; evW.tag = '直近の対象クラスV'; evs.push(evW); }
    }
    break;
  }
  // 直近3走のうち「1着じゃなくても評価できる走り」
  for (var j = 0; j < Math.min(3, rows.length) && evs.length < 3; j++){
    var e3 = null;
    try { e3 = tlEvalRun(rows[j], h && h.name); } catch(e){ e3 = null; }
    if (!e3 || !tlNotable(e3)) continue;
    var dup = false;
    evs.forEach(function(x){ if (tlSameRun(x, e3)) dup = true; });
    if (dup) continue;
    e3.isPrev = false; e3.tag = '直近3走の好時計'; evs.push(e3);
  }
  var out = {
    st: evs.length ? 'eval' : 'noeval',
    prev: { date: prev.date, name: prev.name, order: prev.order, cls: tlClassOf(prev.name) }
  };
  if (!evs.length) return out;
  evs = evs.slice(0, 3);
  evs.forEach(function(ev){ ev.no = h.no || ''; ev.name = h.name || ''; ev.nk = h.nk || ''; });
  out.evs = evs;
  out.ev = evs[0];                                     // 先頭＝前走（前走だけ評価できない場合は直近V）
  out.ev.prevOrder = prev.order; out.ev.prevName = prev.name; out.ev.prevDate = prev.date;
  // 1着の走り（バッジの旧仕様との互換）
  for (var k = 0; k < evs.length; k++){ if (evs[k].isWin){ out.winEv = evs[k]; break; } }
  return out;
}
/* ---------- 短評の文章 ---------- */
function tlCondText(ev){
  return (ev.date || '') + ' ' + (ev.venue || '') + ' ' + (ev.surface || '') + (ev.dist || '') + 'm' +
    (ev.baba ? '・' + ev.baba : '') + (ev.cls ? '・' + ev.cls : '') + (ev.age ? '（' + ev.age + '歳戦）' : '');
}
function tlCmpText(ev){
  var adjTxt = ev.babaAdj ? '（' + ev.baba + '→良換算 ' + ev.timeStr + '→' + ev.secAdj.toFixed(1) + '秒）' : '';
  if (ev.dSpd != null){
    var dt = ev.pastSec - ev.secAdj;                      // 秒差（＋＝自分のほうが速い）
    return (ev.pastSrc || '同条件の過去') + 'の平均 ' + ev.pastSec.toFixed(1) + '秒より ' +
      (dt > 0 ? dt.toFixed(1) + '秒速い' : (dt < 0 ? Math.abs(dt).toFixed(1) + '秒遅い' : '同タイム')) +
      '（速度 ' + (ev.dSpd > 0 ? '+' : '') + ev.dSpd.toFixed(2) + ' m/s、しきい値±' + (ev.th || TL_SPD).toFixed(2) + '）' + adjTxt;
  }
  if (ev.dPar != null){
    return '基準時計(パー・良)より ' + (ev.dPar > 0 ? '+' : '') + ev.dPar.toFixed(1) + ' 秒' +
      (ev.dPar < 0 ? '（速い）' : (ev.dPar > 0 ? '（遅い）' : '')) + adjTxt +
      ' ※比較できる過去の勝ち時計が3件未満のため、クラス補正した基準時計で判定（参考）';
  }
  return '比較データなし' + adjTxt;
}
function tlShortText(ev, hName){
  var ord = ev.order || 0;
  var head;
  if (ev.isWin){
    head = ev.lv === 'fast' ? '🎯 勝ちタイムが同条件の過去より速い'
      : ev.lv === 'slow' ? '⚠️ 勝ちタイムが同条件の過去より遅い'
      : '○ 勝ちタイムは同条件の過去とほぼ同じ水準';
  } else if (ev.lv === 'fast'){
    head = '🎯 ' + ord + '着でも時計は同条件の過去より速い';
  } else if (ev.badge === 'fast'){
    head = '🎯 ' + ord + '着・自分の時計は同条件並みだが、勝ち時計が速いレベルの高いレースで' +
      (ev.gap != null ? '勝ち馬から' + ev.gap.toFixed(1) + '秒差' : '僅差');
  } else if (ev.lv === 'slow'){
    head = '△ ' + ord + '着・時計も同条件の過去より遅い';
  } else {
    head = '○ ' + ord + '着・時計は同条件の過去とほぼ同じ水準';
  }
  if (ev.babaBad) head += '（※不良馬場の時計なので参考値）';
  var s = head + '／' + (ev.rname || '') + '（' + tlCondText(ev) + '）' +
    (ev.isWin ? '勝ちタイム ' : (ord + '着タイム ')) + (ev.timeStr || '') + '。' + tlCmpText(ev) + '。';
  // 着差
  if (ev.isWin){
    s += (ev.winGap != null)
      ? '2着差 ' + ev.winGap.toFixed(1) + '秒（' + (ev.winner ? '2着 ' + String(ev.winner).replace(/[()]/g, '') : '同レース他馬の馬柱から算出') + '）。'
      : '（2着差は同レースを走った他馬の馬柱が無いため不明）。';
  } else if (ev.gap != null){
    s += '勝ち馬' + (ev.winner ? ' ' + ev.winner : '') + 'とは ' + ev.gap.toFixed(1) + '秒差' +
      (ev.order > 3 ? '（馬券内ではありません）' : '') + '。';
  }
  // レース自体のレベル（1着以外でも「勝ち時計」は推定できる）
  if (!ev.isWin && ev.raceLv){
    var wd = (ev.pastSec && ev.winSec != null) ? (ev.pastSec - ev.winSec) : null;
    var wcmp = (wd != null) ? (wd > 0.5 ? '（同条件より' + wd.toFixed(1) + '秒速い）' : (wd < -0.5 ? '（同条件より' + Math.abs(wd).toFixed(1) + '秒遅い）' : '')) : '';
    var wTxt = (ev.winSec != null ? 'このレースの勝ち時計は ' + ev.winSec.toFixed(1) + '秒（良換算・推定）' + wcmp + 'で、' : 'このレースの勝ち時計では、');
    s += wTxt + (ev.raceLv === 'fast' ? 'レース自体のレベルが高い。'
      : ev.raceLv === 'slow' ? 'レース全体のレベルは高くない。' : '特に突出はしていない。');
  }
  // 結論
  if (ev.badge === 'fast') s += ev.isWin ? '時計面は上。次走以降も素直に買い。' : '着順ほど悪くない。次走以降は買い材料。';
  else if (ev.lv === 'slow') s += ev.isWin ? '時計面は物足りない。次走以降は少し疑って扱う。' : '時計も足りない。次走以降は割り引き。';
  else s += '時計面での加点・減点はなし（普通）。';
  return s;
}
/* ---------- ストア ---------- */
function tlPut(h, res, store){
  var o = store || tlStore();
  var key = (h && h.nk) ? String(h.nk) : ('nm:' + tlNormName(h && h.name));
  if (res && res.st === 'eval'){
    var ev = res.ev;
    /* 先頭（代表＝前走）は ev 自身。2件目以降だけ more に入れて保存する
       （ev.evs = [ev,...] にすると自己参照で JSON.stringify が失敗し、保存が丸ごと飛ぶ） */
    ev.more = (res.evs || []).slice(1);
    o.byNk[key] = ev;
    if (h && h.name) o.byName[tlNormName(h.name)] = ev;
    var k2 = tlD8(ev.date) + '|' + ev.rname + '|' + ev.dist;
    if (!o.ev[k2]){ o.ev[k2] = { noted: false }; }
    ev._key = k2;
  } else {
    delete o.byNk[key];
  }
  if (!store) tlSave(o);
  return o;
}
function tlNormName(s){ return String(s || '').replace(/[\s\u3000]/g, ''); }
function tlGet(h){
  var o = tlLs();
  var ev = null;
  if (h && h.nk && o.byNk && o.byNk[String(h.nk)]) ev = o.byNk[String(h.nk)];
  if (!ev && h && h.name && o.byName) ev = o.byName[tlNormName(h.name)] || null;
  if (!ev) return null;
  return ev;
}
/* 出馬表・AI印表に出すバッジ（前走の時計で判定。1着じゃなくても出す） */
function tlBadgeHTML(h){
  var ev = tlGet(h);
  if (!ev || !ev.isPrev) return '';
  var tip = esc(ev.txt || '');
  if (ev.badge === 'fast') return '<span class="tlchip fast" title="' + tip + '">🎯</span>';
  if (ev.badge === 'slow') return '<span class="tlchip slow" title="' + tip + '">⚠️</span>';
  return '';
}
/* ---------- 短評の自動登録（📒馬ノート） ---------- */
function tlNoteOnce(h, ev, store){
  if (!ev || !ev.badge) return '';                    // マークが付かない走り（平凡）は登録しない（ノイズ防止）
                                                       // ※自分の時計が平凡でも「レースのレベルが高い＋僅差」なら🎯なので lv では判定しない
  var o = store || tlStore();                          // 呼び出し側のストアを渡されたらそれを使う（保存は1回にまとめる）
  var key = tlD8(ev.date) + '|' + ev.rname + '|' + ev.dist;
  var rec = o.ev[key] || (o.ev[key] = { noted: false, names: [] });
  var nm = tlNormName(h && h.name);
  if (rec.names && rec.names.indexOf(nm) >= 0) return '';
  if (typeof hbNewNote !== 'function') return '';
  try {
    hbNewNote({ name: h.name, nk: h.nk || '', no: h.no || '' }, 'short', ev.txt,
      { label: (ev.rname || '') + '（' + (ev.date || '') + (ev.isWin ? '・1着' : '・' + ev.order + '着') + '）', date: ev.date || '' });
    rec.names = (rec.names || []).concat([nm]);
    if (!store) tlSave(o);
    return 'noted';
  } catch(e){ return ''; }
}
/* ---------- 全出走馬をスキャン ---------- */
function tlScanAll(auto){
  var hs = [];
  try { hs = (state.horses || []).filter(function(h){ return h && (h.nk || h.name); }); } catch(e){}
  var out = { rows: [], n: 0, nodata: 0, noeval: 0, fast: 0, slow: 0, mid: 0, noted: 0, extra: 0, wins: 0 };
  if (!hs.length) return out;
  var o = tlStore();
  hs.forEach(function(h){
    var res;
    try { res = tlScanHorse(h); } catch(e){ res = { st: 'err' }; }
    if (!res) res = { st: 'nodata' };
    if (res.st === 'nodata' || res.st === 'norun') out.nodata++;
    if (res.st === 'eval'){
      out.n++;
      var evs = res.evs || [];
      // 馬ごとの代表判定＝前走（前走が評価できない場合は直近の対象クラスV）
      var b = res.ev.badge || 'mid';
      out[b === 'fast' ? 'fast' : (b === 'slow' ? 'slow' : 'mid')]++;
      if (res.winEv) out.wins++;
      out.extra += Math.max(0, evs.length - 1);
      if (!auto && o.set.note !== false){
        evs.forEach(function(ev){
          if (!ev.badge) return;                          // 平凡（マークなし）は登録しない
          if (ev.isWin || tlNotable(ev)){ if (tlNoteOnce(h, ev, o)) out.noted++; }
        });
      }
    } else if (res.st === 'noeval') out.noeval++;
    tlPut(h, res, o);
    out.rows.push({ h: h, res: res });
  });
  tlSave(o);                       // 保存は1回だけ（18頭ぶんを毎回書くと重い）
  return out;
}
/* ---------- 脚質の安定度（馬柱の4角通過順から） ----------
   過去6走の「4角通過順 → 脚質(逃げ/先行/差し/追込)」を復元し、
   バラつき v = 1 - (最多脚質の割合) を返す。v=0 なら毎回同じ脚質、v が大きいほど不安定。 */
function tlStyleOf(pass, head){
  var ps = String(pass || '').split(/[-\s\u3000]+/).filter(function(x){ return /^\d+$/.test(x); });
  if (!ps.length) return '';
  var p4 = parseInt(ps[ps.length - 1], 10);
  if (!p4) return '';
  var n = parseInt(head, 10) || 0;
  var r = n >= 4 ? (p4 / n) : (p4 / 12);
  if (p4 === 1) return '逃げ';
  if (r <= 0.28) return '先行';
  if (r <= 0.62) return '差し';
  return '追込';
}
/* 4角の位置を 0(先頭)〜1(最後方) に正規化 */
function tlPosQ(pass, head){
  var ps = String(pass || '').split(/[-\s\u3000]+/).filter(function(x){ return /^\d+$/.test(x); });
  if (!ps.length) return null;
  var p4 = parseInt(ps[ps.length - 1], 10);
  if (!p4) return null;
  var n = parseInt(head, 10) || 0;
  return n >= 4 ? (p4 - 1) / (n - 1) : (p4 - 1) / 11;
}
function tlSd(a){
  if (!a || a.length < 2) return 0;
  var m = a.reduce(function(x, y){ return x + y; }, 0) / a.length;
  return Math.sqrt(a.reduce(function(t, x){ return t + (x - m) * (x - m); }, 0) / a.length);
}
function tlStyleHist(h){
  if (!h || !h.nk || typeof hdLs !== 'function') return null;
  var ls;
  try { ls = hdLs(); } catch(e){ return null; }
  var rec = ls[h.nk];
  if (!rec || !rec.r) return null;
  var today = tlRaceDateStr();
  var rows = rec.r.filter(function(r){
    return r && tlD8(r.date) && (!today || tlD8(r.date) < today) && parseInt(r.order, 10) > 0;
  });
  rows.sort(function(a, b){ return tlD8(b.date).localeCompare(tlD8(a.date)); });
  rows = rows.slice(0, 6);
  var styles = [], cnt = {}, qs = [];
  rows.forEach(function(r){
    var st = tlStyleOf(r.pass, r.head);
    if (!st) return;
    styles.push(st); cnt[st] = (cnt[st] || 0) + 1;
    var q = tlPosQ(r.pass, r.head);
    if (q != null) qs.push(q);
  });
  if (styles.length < 3) return null;
  var mx = 0, dom = '';
  Object.keys(cnt).forEach(function(k){ if (cnt[k] > mx){ mx = cnt[k]; dom = k; } });
  var sd = tlSd(qs);                       // 4角位置のバラつき（0=毎回同じ位置, 0.5=毎回まったく違う位置）
  return { n: styles.length, styles: styles, cnt: cnt, dom: dom, domR: mx / styles.length, q: qs, sd: sd, v: sd };
}
/* 「脚質が安定しない」の判定（4角位置のバラつき sd が 0.22 以上＝頭数の2割以上ブレる） */
function tlStyleUnstable(sv){
  return !!(sv && sv.n >= 3 && sv.sd >= 0.22);
}
/* ---------- 表示 ---------- */
var TL_LV = { fast: { icon: '🎯', txt: '速い', cls: 'fast' }, mid: { icon: '○', txt: '普通', cls: 'mid' }, slow: { icon: '⚠️', txt: '遅い', cls: 'slow' } };
function tlLvChip(lv){
  var m = TL_LV[lv] || null;
  if (!m) return '<span class="muted">-</span>';
  return '<span class="tlchip ' + m.cls + '" title="同条件の過去との比較">' + m.icon + ' ' + m.txt + '</span>';
}
/* 出馬表・AI印に付くのと同じマーク（🎯/⚠️/なし） */
function tlBadgeChip(ev){
  if (ev.badge === 'fast') return '<span class="tlchip fast" title="前走の時計が買い材料">🎯</span>';
  if (ev.badge === 'slow') return '<span class="tlchip slow" title="勝ち時計が遅い＝レースのレベルが低い">⚠️</span>';
  return '<span class="muted" title="マークなし">—</span>';
}
function tlOrdTxt(ev){
  var o = ev.order ? (ev.order + '着') : '-';
  var hd = parseInt(ev.head, 10);
  return hd ? (o + '<span class="muted">/' + hd + '頭</span>') : o;
}
function tlTimeTxt(ev){
  var t = esc(ev.timeStr || '-');
  if (ev.babaAdj) return t + '<br><span class="muted">良換算 ' + ev.secAdj.toFixed(1) + '秒（' + esc(ev.baba) + ' + ' + ev.babaAdj.toFixed(1) + '）</span>';
  return t + '<br><span class="muted">' + ev.secAdj.toFixed(1) + '秒</span>';
}
function tlHowFastTxt(ev){
  if (ev.dSpd != null){
    var dt = ev.pastSec - ev.secAdj;
    return '過去 ' + ev.pastN + ' 件の勝ち時計の平均より ' +
      (dt > 0 ? '<b>' + dt.toFixed(1) + '秒速い</b>' : (dt < 0 ? '<b>' + Math.abs(dt).toFixed(1) + '秒遅い</b>' : '同タイム')) +
      '<span class="muted">（' + ev.pastSec.toFixed(1) + '秒 / ' + (ev.dSpd > 0 ? '+' : '') + ev.dSpd.toFixed(2) + ' m/s・しきい値±' + (ev.th || TL_SPD).toFixed(2) + '）</span><br>' +
      '<span class="muted">' + esc(ev.pastSrc || '') + '</span>';
  }
  if (ev.dPar != null){
    return (ev.parLearned ? '🎓学習した基準時計' : '基準時計') + 'より ' + (ev.dPar > 0 ? '+' : '') + ev.dPar.toFixed(1) +
      ' 秒<span class="muted">（同条件の過去が3走未満・' + (ev.parLearned ? '🎓学習値' : '静的テーブル') + '）</span>';
  }
  return '<span class="muted">比較データなし</span>';
}
function tlRaceLvTxt(ev){
  if (ev.isWin) return '<span class="muted">＝自分の勝ち時計</span> ' + tlLvChip(ev.raceLv || ev.lv);
  if (ev.winSec == null) return '<span class="muted">不明</span>';
  return '勝ち時計 ' + ev.winSec.toFixed(1) + '秒 ' + tlLvChip(ev.raceLv);
}
function tlGapTxt(ev){
  if (ev.isWin){
    return (ev.winGap != null)
      ? '<b>2着差 ' + ev.winGap.toFixed(1) + '秒</b>' + (ev.winner ? '<br><span class="muted">2着 ' + esc(String(ev.winner).replace(/[()]/g, '')) + '</span>' : '')
      : '<span class="muted">2着差は不明<br>（同レース他馬の馬柱なし）</span>';
  }
  if (ev.gap == null) return '<span class="muted">-</span>';
  return '勝ち馬から ' + ev.gap.toFixed(1) + '秒差' + (ev.order > 3 ? '<br><span class="muted">（馬券内ではない）</span>' : '');
}
function tlRender(){
  var box = $('tlBox'); if (!box) return;
  var o = tlStore();
  var hs = [];
  try { hs = (state.horses || []); } catch(e){}
  var h = [];
  if (typeof tlLearnUseHTML === 'function'){ try { var _lu = tlLearnUseHTML(); if (_lu) h.push(_lu); } catch(e){} }
  h.push('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">');
  h.push('<button type="button" class="btn primary" id="tlScan" title="馬柱キャッシュから出走馬の直近の走りを評価します。前走は必ず評価し、1着でなくても「時計が速い」「レース自体のレベルが高い」走りは追記します。早い/遅いは📒馬ノートにも自動登録されます。">🔍 出走馬の前走タイムを評価</button>');
  h.push('<label style="display:inline-flex;gap:4px;align-items:center;font-size:.82rem" title="速い/遅いと判定した走りの短評を📒馬ノートへ自動で追加します（普通は追加しません）">' +
    '<input type="checkbox" id="tlNote"' + (o.set.note === false ? '' : ' checked') + '> 短評を📒馬ノートへ自動登録</label>');
  h.push('<button type="button" class="btn ghost" id="tlClear" title="勝ちタイム評価の保存を消します（📒馬ノートに登録済みの短評は残ります）">🗑 評価を消去</button>');
  h.push('<span class="small muted" id="tlMsg"></span>');
  h.push('</div>');
  if (!hs.length){
    h.push('<div class="small muted">出走馬がありません。①で出馬表を読み込むと、直近の走りを自動で評価します。</div>');
    box.innerHTML = h.join(''); return;
  }
  // 保存済みの評価だけで表を作る（スキャンはボタン/取込時）
  var groups = [], noeval = 0, nodata = 0, nRows = 0, nFast = 0, nSlow = 0, nMid = 0, nWin = 0;
  hs.forEach(function(hh){
    var ev = tlGet(hh);
    if (!ev){ noeval++; if (!hh.nk) nodata++; return; }
    var evs = [ev].concat(ev.more || []);
    groups.push({ h: hh, ev: ev, evs: evs });
    if (ev.badge === 'fast') nFast++; else if (ev.badge === 'slow') nSlow++; else nMid++;
  });
  if (!groups.length){
    h.push('<div class="small muted">まだ評価がありません。上の「🔍 出走馬の前走タイムを評価」を押してください' +
      '（馬柱データが必要です。未取得の馬は ①の各馬の「🐎 馬情報」または「🐎 全馬プロフィール」で取得できます）。</div>');
    box.innerHTML = h.join(''); return;
  }
  var tlW = function(b){ return b === 'fast' ? 0 : (b === 'slow' ? 1 : 2); };   // fast=0 は falsy なので || を使わない
  groups.sort(function(a, b){
    return (tlW(a.ev.badge) - tlW(b.ev.badge)) || tlD8(b.ev.date).localeCompare(tlD8(a.ev.date));
  });
  var trs = [];
  groups.forEach(function(g){
    g.evs.forEach(function(ev, i){
      if (ev.isWin) nWin++;
      nRows++;
      var tr = [];
      tr.push('<tr>');
      if (i === 0){
        tr.push('<td>' + esc(g.h.no || '') + '</td>');
        tr.push('<td>' + esc(g.h.name || '') + '</td>');
      } else {
        tr.push('<td></td><td></td>');
      }
      tr.push('<td>' + tlBadgeChip(ev) + '</td>');
      tr.push('<td><span class="tltag' + (ev.isPrev ? ' prev' : '') + '">' + esc(ev.tag || (ev.isWin ? '直近の対象クラスV' : '前走')) + '</span><br>' +
        '<b>' + esc(ev.rname || '') + '</b> <span class="muted">' + esc(ev.date || '') + '</span><br>' +
        '<span class="muted">' + esc(tlCondText(ev)) + '</span></td>');
      tr.push('<td>' + tlOrdTxt(ev) + '</td>');
      tr.push('<td>' + tlTimeTxt(ev) + '</td>');
      tr.push('<td>' + tlLvChip(ev.lv) + ' ' + tlHowFastTxt(ev) + '</td>');
      tr.push('<td>' + tlRaceLvTxt(ev) + '</td>');
      tr.push('<td>' + tlGapTxt(ev) + '</td>');
      tr.push('<td class="small" style="text-align:left">' + esc(ev.txt || '') + '</td>');
      tr.push('</tr>');
      trs.push(tr.join(''));
    });
  });
  /* 2026-09-12 第15弾: 馬の一覧は縦長になるので折り込み。
     折り込んだままでも「🎯/⚠️が何頭・どの馬か」が分かるように summary へ要約を出します。 */
  var fNames = [], sNames = [];
  groups.forEach(function(g){
    var nm = (g.h.no || '') + ' ' + (g.h.name || '');
    if (g.ev.badge === 'fast') fNames.push(nm);
    else if (g.ev.badge === 'slow') sNames.push(nm);
  });
  function namesTxt(arr, lim){
    if (!arr.length) return 'なし';
    var t = arr.slice(0, lim).map(function(x){ return esc(x); }).join('・');
    return t + (arr.length > lim ? ' ほか' + (arr.length - lim) + '頭' : '');
  }
  var sumTxt = '出走馬 ' + hs.length + ' 頭のうち <b>' + groups.length + ' 頭</b>を評価' +
    '（🎯 時計が速い <b>' + nFast + '</b> 頭／⚠️ 勝ち時計が遅い <b>' + nSlow + '</b> 頭／マークなし <b>' + nMid + '</b> 頭）' +
    '・表示した走り <b>' + nRows + '</b>（うち1着 ' + nWin + '）' +
    (nodata ? '・馬柱未取得 ' + nodata + ' 頭' : '') + (noeval ? '・評価不能 ' + noeval + ' 頭' : '');
  h.push('<details style="border:1px solid var(--line2);border-radius:10px;background:var(--card2);margin-bottom:4px">' +
    '<summary class="small" style="cursor:pointer;padding:6px 10px;line-height:1.7">' +
    '<b style="color:var(--ok-ink)">🐎 評価した馬の一覧を開く／閉じる</b>　<span class="muted">' + sumTxt + '</span><br>' +
    '<span class="muted">🎯 時計が速い: <b>' + namesTxt(fNames, 5) + '</b>　／　⚠️ 勝ち時計が遅い: <b>' + namesTxt(sNames, 5) + '</b></span>' +
    '</summary><div style="padding:2px 10px 8px">');
  h.push('<div class="small muted" style="margin-bottom:4px">' + sumTxt + '</div>');
  h.push('<div style="overflow-x:auto"><table class="ktbl sctbl"><thead><tr>' +
    '<th>馬番</th><th>馬名</th><th>出馬表マーク</th><th>対象の走り</th><th>着順</th><th>タイム（良換算）</th>' +
    '<th>どれほど速かったか</th><th>レースの勝ち時計レベル</th><th>着差</th><th>短評</th>' +
    '</tr></thead><tbody>' + trs.join('') + '</tbody></table></div>');
  h.push('</div></details>');   // 馬の一覧の折り込みを閉じる
  h.push('<details style="border:1px dashed var(--line2);border-radius:10px;background:var(--card);margin-top:4px">' +
    '<summary class="small" style="cursor:pointer;padding:5px 10px;font-weight:700;color:var(--ok-ink)">📖 判定のしかた（🎯/⚠️の付け方・比較のしかた・馬場換算）の説明を開く／閉じる</summary>' +
    '<div class="small muted" style="margin:6px 10px 8px;line-height:1.7">' +
    '<b>※並びは「前走」のマーク順（🎯→⚠️→なし）。</b>1頭につき最大3行（前走／直近の対象クラスV／直近3走の好時計）を出します。<br>' +
    '<b>【1着じゃなくても追記する条件】</b>①自分の時計が同条件の過去の勝ち時計より速い（<b>馬券内かどうかは問いません</b>）' +
    '②勝ち時計が速い＝レース自体のレベルが高く、勝ち馬から1.0秒差以内。このどちらかなら同じ馬の行に<b>追記</b>します。<br>' +
    '<b>【⚠️について】</b>⚠️は「1着の勝ち時計が遅い」＝そのレースのレベルが低かったときだけ付けます' +
    '（負け馬の時計が勝ち馬より遅いのは着差のぶんなので、それだけでは⚠️にしません）。<br>' +
    '<b>【比較のしかた】</b>母集団はキャッシュ済み馬柱の「勝ち時計」です。1着の行は自分の時計、' +
    'それ以外の行は<b>自分の時計 − 着差(秒)</b>でそのレースの勝ち時計を復元するので、' +
    '1着が少ない未勝利クラスの出走馬でも母集団を確保できます。' +
    '探す順番は ①同場・±3週 → ②同場・±14週 → ③他場も含む±3週 → ④他場も含む±14週 で、3件以上集まったところを使います' +
    '（距離は同距離帯＝±200m、④だけ±300m。季節がずれると時計も変わるので「同じ時期」を優先します）。' +
    '<b>距離（1200〜2400mなど）とクラス（新馬/未勝利/1勝/2勝/3勝/OP/L/G3・G2・G1）は基準時計で換算</b>し、代表値には<b>中央値</b>を使います（外れ値に強くするため）。' +
    '<b>馬場は良に換算</b>（芝: 稍重+0.7 / 重+1.4 / 不良+2.0秒、ダートは雨で速くなるので 稍重-0.5 / 重-0.9 / 不良-0.6秒）。' +
    '判定は<b>速度差</b>で、同場の母集団なら±0.08m/s（芝1600mで約0.4秒）、他場を含む場合は±0.12m/s。' +
    '3件も集まらないときはクラス補正した基準時計との差で判定します（参考値）。<br>' +
    '<b>【不良馬場】</b>不良馬場の時計は換算の誤差が大きいので参考表示にし、🎯/⚠️は付けません（母集団にも使いません）。' +
    '<b>【障害戦】</b>は時計の土俵が違うため評価しません。<br>' +
    '<b>【着差】</b>1着以外は「勝ち馬からの差」をその馬の着差列から、1着の<b>2着差</b>は同じレースを走った他馬の馬柱（着差列）から復元します。' +
    '同じレースの他馬が未取得だと「不明」と出ます（①の「🐎 全馬プロフィール」で取得すると埋まります）。<br>' +
    'トラックバイアスカードが当日開催ぶんしか出ないのに対し、こちらは過去開催の時計から「その馬がどれほど速い時計を持っているか」を見る補助です。</div></details>');
  box.innerHTML = h.join('');
  var b = $('tlScan');
  if (b){ b.onclick = function(){ b.disabled = true; b.textContent = '評価中…'; setTimeout(tlRunScan, 20); }; }
  var cb = $('tlNote');
  if (cb) cb.onchange = function(){ try { var oo = tlStore(); oo.set.note = cb.checked; tlSave(oo); } catch(e){} };
  var c = $('tlClear');
  if (c) c.onclick = function(){
    try {
      var o2 = tlStore(); o2.byNk = {}; o2.byName = {}; tlSave(o2);
    } catch(e){}
    tlRender(); tlMsg('評価を消去しました（📒馬ノートの短評は残っています）');
  };
}
function tlRunScan(){
  var r;
  try { r = tlScanAll(false); } catch(e){ tlMsg('評価に失敗しました: ' + (e && e.message ? e.message : e), true); return; }
  tlMsg('評価 ' + r.n + ' 頭（🎯 ' + (r.fast || 0) + '／⚠️ ' + (r.slow || 0) + '／○ ' + (r.mid || 0) + '）' +
    '・1着の走り ' + (r.wins || 0) + '／追記した走り ' + (r.extra || 0) +
    (r.noted ? '・短評を ' + r.noted + ' 件登録' : '') +
    (r.nodata ? '・馬柱未取得 ' + r.nodata + ' 頭' : '') + (r.noeval ? '・評価不能 ' + r.noeval + ' 頭' : ''),
    r.n ? null : '馬柱キャッシュが空です。①の「🐎 全馬プロフィール」で取得してから実行してください。');
  tlRender();
}
function tlMsg(m, err){
  var e = $('tlMsg'); if (e) e.innerHTML = m ? '<span' + (err ? ' style="color:var(--err-ink)"' : '') + '>' + m + '</span>' : '';
}
/* =========================================================
   🎓 タイム換算の学習
   （④「年指定で過去データを自動取込（学習DB用・JRA全レース）」と連携）
   ---------------------------------------------------------
   学習DB（JRA全レースの勝ち時計）と馬柱キャッシュ（着差から復元した勝ち時計）から、
   「距離 × クラス × 年齢 × 競馬場 × 年 × 馬場」の**基準時計そのもの**を学習します。
   結果は khl_tllearn_v1 に保存し、tlBaseSec() と tlBabaAdj() が学習値を優先して使います。
   学習データが無ければ従来の静的テーブル（PAR_TIME＋クラス補正）のままなので、動きは変わりません。

   ■ モデルのかたち（2段）
     基準時計 = 距離レベル(面|距離)
              + クラス補正(面|クラス) + 年齢補正(面|2歳/3歳/3歳以上/4歳以上)
              + 競馬場補正(面|場) + 年補正(年) + 距離×クラスの個別補正(件数が十分ある組合せだけ)
     → 主効果（距離・クラス・年齢・場・年）はどの組み合わせでも埋まるので、
       「ダート3400mのG1」のような珍しい条件でも基準時計が出せます（＝馬柱の母集団と基準がズレない）。
       件数がある組み合わせだけは、さらに個別補正を足して精度を上げます。

   ■ 学習のしかた（メディアンポリッシュ＝中央値を順番に抜いていく）
     1. 「面|距離」のセルごとに勝ち時計の**中央値**を抜く（＝距離レベル）
     2. 残りを「面|クラス」→「面|年齢」→「面|競馬場」→「年」の順に抜く（＝それぞれの補正）
     3. 良以外で走ったサンプルに残った残りの中央値＝使った馬場補正の誤差 → **馬場補正を学習**
     4. 学習した馬場補正でもう一度良換算し直して 1〜3 を繰り返す（2回で収束）
     5. 最後に「面|距離|クラス」の組み合わせで残りを抜く（＝個別補正）
     平均でなく中央値を使うのは、新馬戦・少頭数・極端な馬場などの外れ値に引っ張られないため。
     件数が足りないグループ（n < しきい値）は**補正をかけずに捨てる**ので、
     珍しい条件の外れ値が競馬場補正や年補正を壊しません（旧版で ダ|東京 +77.9秒 が出た不具合の対策）。

   ■ いつ学習するか
     ・年指定の一括取込が終わったとき（自動・結果を表示）
     ・日付指定/バックアップ復元の取込が終わったとき（6秒デバウンスで自動）
     ・「🎓 学習し直す」ボタン（手動）
   学習すると②⏱カードの判定基準がその場で切り替わり、出走馬がいれば自動で評価し直します。
   ========================================================= */
var TL_LEARN_LS = 'khl_tllearn_v1';
var TL_LEARN_MIN = 8;          // 距離×クラスの個別補正: この件数以上あれば上乗せ
var TL_LEARN_MIND = 10;        // 距離レベル・クラス補正
var TL_LEARN_MINV = 15;        // 競馬場・年・年齢の補正
var TL_LEARN_MINB = 10;        // 馬場補正
var TL_LEARN_MIN_TOTAL = 60;   // これよりサンプルが少ないと学習しない（ノイズのほうが多い）
var TL_LEARN_CLS = ['新馬', '未勝利', '1勝クラス', '2勝クラス', '3勝クラス', '特別', 'OP', 'L', 'G3', 'G2', 'G1'];
var TL_LEARN_AGES = ['2歳', '3歳', '3歳以上', '4歳以上'];
var TL_JRA_VENUES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
var tlLearnMem = null, tlLearnTimer = null;

/* ---------- 保存/読込 ---------- */
function tlLearnLoad(){
  if (tlLearnMem) return tlLearnMem;
  try {
    var o = JSON.parse(localStorage.getItem(TL_LEARN_LS) || 'null');
    tlLearnMem = (o && o.dist) ? o : null;
  } catch(e){ tlLearnMem = null; }
  return tlLearnMem;
}
function tlLearnSave(m){
  try { var _ok = safeSetItem(TL_LEARN_LS, JSON.stringify(m)); tlLearnMem = m; return _ok;   /* 🥇学習した基準時計＝第一優先 */ }
  catch(e){ tlLearnMem = m; return false; }
}
function tlLearnClear(){
  try { localStorage.removeItem(TL_LEARN_LS); } catch(e){}
  tlLearnMem = null;
}
function tlLearnReady(m){ return !!(m && m.dist && m.nS >= TL_LEARN_MIN_TOTAL); }
function tlLearnHas(){ return tlLearnReady(tlLearnLoad()); }

/* ---------- 分類（学習時も評価時も同じ関数を使う＝ズレない） ---------- */
function tlLearnCls(name, grade){
  var n = String(name || '');
  var g = String(grade || '').replace(/\s+/g, '').toUpperCase();
  var t = g || String((n.match(/[(（]\s*(G\s*(?:III|II|I|3|2|1)|Jpn\s*[123]|L|OP|LISTED)\s*[)）]/i) || [])[1] || '').replace(/\s+/g, '').toUpperCase();
  if (/^JPN1$/.test(t) || /^G(I|1)$/.test(t)) return 'G1';
  if (/^JPN2$/.test(t) || /^G(II|2)$/.test(t)) return 'G2';
  if (/^JPN3$/.test(t) || /^G(III|3)$/.test(t)) return 'G3';
  if (t === 'L' || t === 'LISTED') return 'L';
  if (t === 'OP' || /オープン/.test(n)) return 'OP';
  if (/新馬|メイドン/.test(n)) return '新馬';
  var c = tlClassOf(n);
  if (c) return c;
  return '特別';
}
function tlLearnSurf(x, name){
  var s = String(x || ''), n = String(name || '');
  /* 2026-09-11 第14弾: 障害は平地とまったく時計の土俵が違うので、取り違えると平地の基準時計を大きく汚します。
     レース名が最も確実なので先にそれで判定し、surface の表記（'障害'/'障'）でも拾います。
     → 芝2860m のように「障害でしか存在しない距離」でも、障害と分かれば '障' に入り、
        平地（芝/ダート）の学習・距離補間・評価には一切使われません。 */
  if (/障害/.test(n)) return '障';
  if (s.indexOf('障') >= 0) return '障';
  if (s.indexOf('ダ') >= 0) return 'ダ';
  if (/^\s*$/.test(s) && /障害/.test(n)) return '障';
  return '芝';
}
/* 障害でしか使われない距離（平地の学習に紛れ込んでいないかの検査・表示用） */
var TL_SHO_DIST = { 2750:1, 2850:1, 2860:1, 2880:1, 2900:1, 2970:1, 3050:1, 3100:1, 3170:1, 3250:1, 3290:1, 3330:1, 3350:1, 3380:1, 3390:1, 3800:1, 4100:1, 4250:1, 4400:1 };
/* 距離帯（重賞は長距離ほど時計の差が大きいので、クラス補正を距離帯ごとにも持つ） */
function tlLearnBand(m){
  m = parseInt(m, 10) || 0;
  return m <= 1400 ? '短' : (m <= 2000 ? '中' : '長');
}
/* 年齢区分（レース名から）。2歳戦は明らかに時計がかかるのでクラスとは別に補正します */
function tlLearnAge(name){
  var n = String(name || '');
  if (/2歳/.test(n)) return '2歳';
  if (/3歳以上/.test(n)) return '3歳以上';
  if (/4歳以上/.test(n)) return '4歳以上';
  if (/3歳/.test(n)) return '3歳';
  return '';
}

/* ---------- サンプル集め: 学習DB（年指定の一括取込）＋馬柱キャッシュ ---------- */
function tlLearnSamples(){
  var out = [], seen = {}, nDb = 0, nHd = 0, bad = 0, drop = 0, nSho = 0, shoMis = 0;
  function push(o){
    if (!o) return;
    var sf = tlLearnSurf(o.surface, o.name);
    var m = parseInt(o.m, 10);
    /* 2026-09-11 第14弾: 障害は「平地と混ぜない」だけで、障害同士の比較には使います。
       キーは '障|距離' になるので芝・ダートの学習には一切混ざりません。距離と時計の許容範囲だけ障害用に広げます。 */
    if (sf === '障'){
      nSho++;
      if (!(m >= 2000 && m <= 4500)) { drop++; return; }
    } else {
      if (!(m >= 800 && m <= 4000)) { drop++; return; }
      /* 芝2860m など「障害でしか存在しない距離」が平地として入ってきたら学習に使わない */
      if (TL_SHO_DIST[m]) { shoMis++; drop++; return; }
    }
    var sec = parseFloat(o.sec);
    if (!(sec > 20 && sec < (sf === '障' ? 600 : 500))) { drop++; return; }
    var d8 = tlD8(o.d8);
    if (!d8) { drop++; return; }
    var ven = String(o.venue || '');
    if (TL_JRA_VENUES.indexOf(ven) < 0) { drop++; return; }     // 地方・海外は時計の土俵が違う
    var cls = o.cls || tlLearnCls(o.name, o.grade);
    // 同じレース（同日・同場・同名・同距離・同勝ち時計）は1件に集約
    var k = d8 + '|' + ven + '|' + sf + '|' + m + '|' + cls + '|' + Math.round(sec * 10);
    if (seen[k]) return;
    seen[k] = 1;
    out.push({ d8: d8, year: d8.slice(0, 4), venue: ven, surface: sf, m: m, cls: cls,
               age: tlLearnAge(o.name), baba: tlBaba(o.baba) || '', sec: sec, name: o.name || '', src: o.src || '' });
  }
  /* 1) 学習DB: ④で年指定取込したJRA全レース（1着のタイムをそのまま使う） */
  try {
    var db = (typeof diLs === 'function') ? diLs() : null;
    var races = (db && db.races) || {};
    Object.keys(races).forEach(function(rid){
      var rec = races[rid];
      if (!rec || !rec.meta) return;
      var rows = rec.rows || [];
      if (!rows.length) return;
      var w = null;
      for (var i = 0; i < rows.length; i++){ if (parseInt(rows[i].order, 10) === 1){ w = rows[i]; break; } }
      if (!w) w = rows[0];
      var sec = (typeof nkToSec === 'function') ? nkToSec(w.time) : null;
      if (!sec){ bad++; return; }
      push({ d8: tlRecD8(rec, rid), venue: rec.meta.place, surface: rec.meta.surface,
             m: rec.meta.m, baba: rec.meta.baba, name: rec.meta.name, grade: rec.meta.grade, sec: sec, src: 'db' });
      nDb++;
    });
  } catch(e){}
  /* 2) 馬柱キャッシュ: 1着以外の行も「自分の時計 − 着差」で勝ち時計を復元して使う */
  try {
    var ls = (typeof hdLs === 'function') ? hdLs() : {};
    var best = {};
    Object.keys(ls).forEach(function(nk){
      var rows = (ls[nk] && ls[nk].r) || [];
      rows.forEach(function(r){
        if (!r) return;
        var ord = parseInt(r.order, 10);
        if (!(ord >= 1)) return;
        var sec0 = (typeof nkToSec === 'function') ? nkToSec(r.time) : null;
        if (!sec0) return;
        var wsec;
        if (ord === 1) wsec = sec0;
        else {
          var gp = parseFloat(String(r.margin || '').replace(/[^0-9.]/g, ''));
          if (!isFinite(gp) || gp < 0 || gp > 20) return;
          wsec = sec0 - gp;                                      // 着差は「勝ち馬までの秒差」なので引く
        }
        var d8 = tlD8(r.date);
        var rk = d8 + '|' + (r.venueName || '') + '|' + String(r.r || '') + '|' + (r.name || '') + '|' + r.m;
        var prev = best[rk];
        if (!prev || ord < prev.order) best[rk] = { order: ord, sec: wsec, d8: d8, venue: r.venueName, surface: r.surface, m: r.m, baba: r.baba, name: r.name };
      });
    });
    Object.keys(best).forEach(function(k){
      var b = best[k];
      push({ d8: b.d8, venue: b.venue, surface: b.surface, m: b.m, baba: b.baba, name: b.name, sec: b.sec, src: 'hd' });
      nHd++;
    });
  } catch(e){}
  return { list: out, nDb: nDb, nHd: nHd, bad: bad, drop: drop, nSho: nSho, shoMis: shoMis };
}

/* ---------- メディアンポリッシュ: グループごとの中央値を抜いて store に積む ----------
   minN に満たないグループは補正せず、そのサンプルに x.thin を立てて後の工程から外します
   （外すと、珍しい条件の外れ値が競馬場補正や年補正を壊しません） */
function tlAbsorb(list, store, keyFn, minN, asDelta, markThin){
  var grp = {};
  list.forEach(function(x){
    if (x.thin) return;
    var k = keyFn(x);
    if (!k) return;
    (grp[k] = grp[k] || []).push(x);
  });
  Object.keys(grp).forEach(function(k){
    var a = grp[k];
    if (a.length < minN){
      if (markThin) a.forEach(function(x){ x.thin = 1; });
      return;
    }
    var md = tlMedian(a.map(function(x){ return x.r; }));
    if (!isFinite(md)) return;
    var prev = store[k] || { s: 0, o: 0, n: 0 };
    store[k] = asDelta ? { o: +(prev.o + md).toFixed(3), n: a.length }
                       : { s: +(prev.s + md).toFixed(2), n: a.length };
    a.forEach(function(x){ x.r -= md; });
  });
  return store;
}
function tlLearnAdjUse(x, babaTbl){
  if (!x.baba || x.baba === '良') return 0;
  var k = x.surface + '|' + x.baba;
  if (babaTbl && babaTbl[k] && babaTbl[k].n >= TL_LEARN_MINB) return babaTbl[k].o;
  return tlBabaAdjStatic(x.baba, x.surface);
}
/* ---------- 学習本体 ---------- */
function tlLearnBuild(){
  var S = tlLearnSamples();
  var list = S.list || [];
  if (list.length < TL_LEARN_MIN_TOTAL) return { err: 'サンプル不足', nS: list.length, nDb: S.nDb, nHd: S.nHd,
    drop: S.drop || 0, bad: S.bad || 0, nSho: S.nSho || 0, shoMis: S.shoMis || 0 };   // 第14弾: 学習できないときも障害の件数は出す
  var model = {
    v: 2, at: new Date().toISOString(), nS: list.length, nDb: S.nDb, nHd: S.nHd, drop: S.drop, bad: S.bad,
    nSho: S.nSho || 0, shoMis: S.shoMis || 0,
    dist: {}, cls: {}, cls2: {}, age: {}, ven: {}, yr: {}, baba: {}, cell: {}, nbaba: 0
  };
  var it;
  for (it = 0; it < 2; it++){
    list.forEach(function(x){ x.t = x.sec - tlLearnAdjUse(x, model.baba); x.r = x.t; x.thin = 0; });
    model.dist = {}; model.cls = {}; model.cls2 = {}; model.age = {}; model.ven = {}; model.yr = {};
    tlAbsorb(list, model.dist, function(x){ return x.surface + '|' + x.m; }, TL_LEARN_MIND, false, true);
    tlAbsorb(list, model.cls, function(x){ return x.surface + '|' + x.cls; }, TL_LEARN_MIND, true, false);
    tlAbsorb(list, model.cls2, function(x){ return x.surface + '|' + tlLearnBand(x.m) + '|' + x.cls; }, TL_LEARN_MIND, true, false);
    tlAbsorb(list, model.age, function(x){ return x.age ? (x.surface + '|' + x.age) : ''; }, TL_LEARN_MINV, true, false);
    tlAbsorb(list, model.ven, function(x){ return x.surface + '|' + x.venue; }, TL_LEARN_MINV, true, false);
    tlAbsorb(list, model.yr, function(x){ return x.year; }, TL_LEARN_MINV, true, false);
    /* 馬場補正: 良以外に残った残りの中央値＝いま使った補正の誤差 → 学習値 = 使った値 + 誤差 */
    var bg = {};
    list.forEach(function(x){
      if (x.thin || !x.baba || x.baba === '良') return;
      var k = x.surface + '|' + x.baba;
      (bg[k] = bg[k] || []).push(x.r);
    });
    var nb = {};
    Object.keys(bg).forEach(function(k){
      var a = bg[k];
      if (a.length < TL_LEARN_MINB) return;
      var md = tlMedian(a);
      if (!isFinite(md)) return;
      var p = k.split('|');
      var used = tlLearnAdjUse({ surface: p[0], baba: p[1] }, model.baba);
      nb[k] = { o: +(used + md).toFixed(3), n: a.length };
    });
    model.baba = nb;
    model.nbaba = Object.keys(nb).length;
  }
  /* 距離×クラスの個別補正（主効果で取りきれない交互作用。件数がある組合せだけ） */
  list.forEach(function(x){ x.r0 = x.r; });
  model.cell = {};
  tlAbsorb(list, model.cell, function(x){ return x.surface + '|' + x.m + '|' + x.cls; }, TL_LEARN_MIN, true, false);
  /* 学習の当てはまり（残りのバラつき）と、静的テーブルとの差 */
  var used = list.filter(function(x){ return !x.thin; });
  var ab = used.map(function(x){ return Math.abs(x.r); });
  model.fitMae = ab.length ? +(ab.reduce(function(a, b){ return a + b; }, 0) / ab.length).toFixed(2) : 0;
  model.nThin = list.length - used.length;
  model.dists = { '芝': [], 'ダ': [], '障': [] };   /* 第14弾: 障害も別枠で表に出す */
  Object.keys(model.dist).forEach(function(k){
    var p = k.split('|');
    if (model.dists[p[0]]) model.dists[p[0]].push(+p[1]);
  });
  Object.keys(model.dists).forEach(function(sf){ model.dists[sf].sort(function(a, b){ return a - b; }); });
  model.years = Object.keys(model.yr).sort();
  var diffs = [];
  /* 第14弾: 距離の一覧は 芝・ダート・障害の3区分（障害は 2750〜4400m のような長い距離だけが入ります） */
  Object.keys(model.dist).forEach(function(kd){
    var sf = kd.split('|')[0], d = +kd.split('|')[1];
    TL_LEARN_CLS.forEach(function(c){
      var st = tlBaseSecStatic(sf, d, c);
      if (st == null) return;
      var L = tlLearnBaseOf(model, sf, d, c, '', '', '');
      if (L == null) return;
      diffs.push({ k: sf + '|' + d + '|' + c, learn: +L.toFixed(2), stat: +st.toFixed(2), d: +(L - st).toFixed(2) });
    });
  });
  diffs.sort(function(a, b){ return Math.abs(b.d) - Math.abs(a.d); });
  model.diffTop = diffs.slice(0, 8);
  model.diffAvg = diffs.length ? +(diffs.reduce(function(a, x){ return a + x.d; }, 0) / diffs.length).toFixed(2) : 0;
  model.cells = Object.keys(model.cell).length;
  return model;
}

/* ---------- モデルから基準時計を組み立てる（内部） ---------- */
function tlLearnBaseOf(M, surface, m, cls, venue, d8, age){
  if (!tlLearnReady(M)) return null;
  var S = tlLearnSurf(surface);
  /* 第14弾: 障害も「障害だけの学習値」で評価する（'障|距離' のセルだけを見るので平地とは混ざらない）。
     学習値が無い場合は呼び出し元(tlBaseSec)が null にして、芝/ダートの基準時計を流用しません。 */
  m = parseInt(m, 10);
  if (!m) return null;
  cls = cls || '特別';
  /* 1) 距離レベル（無ければ前後の距離から線形補間／両端は傾きで外挿・400m超は使わない） */
  var ds = [];
  Object.keys(M.dist).forEach(function(k){
    var p = k.split('|');
    if (p[0] !== S) return;
    if ((M.dist[k].n || 0) < TL_LEARN_MIND) return;
    ds.push({ m: +p[1], s: M.dist[k].s });
  });
  if (!ds.length) return null;
  ds.sort(function(a, b){ return a.m - b.m; });
  var lo = null, hi = null, sec;
  ds.forEach(function(x){ if (x.m <= m) lo = x; if (x.m >= m && hi == null) hi = x; });
  if (lo && hi && lo.m !== hi.m) sec = lo.s + (hi.s - lo.s) * (m - lo.m) / (hi.m - lo.m);
  else if (lo && hi) sec = lo.s;
  else {
    var e = lo || hi;
    if (Math.abs(e.m - m) > 400) return null;
    var slope = ds.length >= 2 ? (ds[ds.length - 1].s - ds[0].s) / (ds[ds.length - 1].m - ds[0].m) : (e.s / e.m);
    sec = e.s + slope * (m - e.m);
  }
  if (!(sec > 10)) return null;
  /* 2) 主効果の補正 */
  function addO(tbl, k, minN){
    if (!tbl || !k) return;
    var e = tbl[k];
    if (e && e.n >= minN) sec += e.o;
  }
  addO(M.cls, S + '|' + cls, TL_LEARN_MIND);
  addO(M.cls2, S + '|' + tlLearnBand(m) + '|' + cls, TL_LEARN_MIND);   // 距離帯ごとのクラス差（重賞は長距離ほど差が大きい）
  addO(M.age, age ? (S + '|' + age) : '', TL_LEARN_MINV);
  addO(M.ven, venue ? (S + '|' + venue) : '', TL_LEARN_MINV);
  var y = String(tlD8(d8) || '').slice(0, 4);
  if (y && M.yr){
    if (M.yr[y] && M.yr[y].n >= TL_LEARN_MINV) sec += M.yr[y].o;
    else {
      var bestY = null;
      Object.keys(M.yr).forEach(function(k){
        var dd = Math.abs(parseInt(k, 10) - parseInt(y, 10));
        if (dd > 2 || dd === 0 || !(M.yr[k].n >= TL_LEARN_MINV)) return;
        if (!bestY || dd < bestY.d) bestY = { d: dd, o: M.yr[k].o };
      });
      if (bestY) sec += bestY.o;
    }
  }
  /* 3) 距離×クラスの個別補正 */
  addO(M.cell, S + '|' + m + '|' + cls, TL_LEARN_MIN);
  return sec;
}
/* ---------- 学習値の参照（基準時計） ---------- */
function tlLearnBase(surface, m, cls, venue, d8, age){
  return tlLearnBaseOf(tlLearnLoad(), surface, m, cls, venue, d8, age);
}
/* ---------- 学習値の参照（馬場補正） ---------- */
function tlLearnBabaAdj(baba, surface){
  var b = tlBaba(baba);
  if (!b || b === '良') return 0;
  var M = tlLearnLoad();
  if (!tlLearnReady(M) || !M.baba) return null;
  var e = M.baba[tlLearnSurf(surface) + '|' + b];
  return (e && e.n >= TL_LEARN_MINB) ? e.o : null;
}

/* ---------- 実行（学習して保存して表示） ---------- */
function tlLearnRun(auto, quiet){
  var t0 = Date.now();
  var m = tlLearnBuild();
  if (m && m.err){
    if (!auto) tlLearnMsg('🎓 学習できませんでした: ' + m.err + '（集まった勝ち時計 ' + (m.nS || 0) + ' 件／学習DB ' + (m.nDb || 0) + ' レース＋馬柱 ' + (m.nHd || 0) + ' レース）。④で年を指定して過去データを取り込むと学習できます。', true);
    tlLearnRender();
    return null;
  }
  if (!m) return null;
  var saved = tlLearnSave(m);
  m.ms = Date.now() - t0;
  var msg = '🎓 タイム換算を学習しました: 勝ち時計 ' + m.nS + ' 件（学習DB ' + m.nDb + ' レース＋馬柱 ' + m.nHd + ' レース）から ' +
    '距離 ' + Object.keys(m.dist).length + '・クラス ' + Object.keys(m.cls).length + '・距離帯×クラス ' + Object.keys(m.cls2).length +
    '・年齢 ' + Object.keys(m.age).length + '・競馬場 ' + Object.keys(m.ven).length + '・年 ' + Object.keys(m.yr).length + '・馬場 ' + m.nbaba +
    '・距離×クラスの個別補正 ' + m.cells + '（当てはまり MAE ' + m.fitMae + '秒／' + m.ms + 'ms）' +
    (saved ? '' : '　⚠ 保存領域が足りず保存できませんでした');
  if (!quiet) tlLearnMsg(msg, !saved);
  /* 判定基準が切り替わったので、出走馬がいれば評価し直す（出馬表の🎯/⚠️も更新） */
  try {
    var hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : [];
    if (hs && hs.length){
      var r = tlScanAll(!!auto);
      if (typeof tlRender === 'function') tlRender();
      if (typeof rebuildHorseTable === 'function') rebuildHorseTable();
      if (!quiet) tlLearnMsg(msg + '　→ ⏱の評価も新しい基準でやり直しました（' + r.n + ' 頭／🎯 ' + r.fast + '／⚠️ ' + r.slow + '）', !saved);
    }
  } catch(e){}
  tlLearnRender();
  return m;
}
/* 取込が終わるたびに呼ぶ（連続取込中はまとめて1回だけ学習するようにデバウンス） */
function tlLearnSchedule(delay){
  try { if (tlLearnTimer) clearTimeout(tlLearnTimer); } catch(e){}
  tlLearnTimer = setTimeout(function(){
    tlLearnTimer = null;
    try { tlLearnRun(true, true); } catch(e){}
  }, delay || 6000);
}
function tlLearnMsg(m, err){
  var e = $('tlLearnMsg');
  if (e) e.innerHTML = m ? '<span' + (err ? ' style="color:var(--err-ink)"' : '') + '>' + esc(m) + '</span>' : '';
}

/* ---------- 表示 ---------- */
function tlLearnWhen(m){
  var a = String((m && m.at) || '');
  if (!a) return '';
  var d = new Date(a);
  if (isNaN(d.getTime())) return a.slice(0, 10);
  return d.getFullYear() + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) +
    ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
/* ⏱カードの上部に出す「いま使っている基準」の1行 */
function tlLearnUseHTML(){
  var m = tlLearnLoad();
  if (!tlLearnReady(m)) return '';
  return '<div class="small" style="margin:0 0 6px;padding:4px 8px;border:1px solid var(--line2);border-radius:8px;background:var(--card2)">' +
    '🎓 <b>学習した基準時計を使用しています</b>（勝ち時計 ' + m.nS + ' 件＝学習DB ' + m.nDb + ' レース＋馬柱 ' + m.nHd +
    ' レース／距離・クラス・年齢・競馬場・年・馬場を学習値で換算・学習 ' + tlLearnWhen(m) + '）' +
    '　<span class="muted">④で年を取り込むと自動で学習し直します。学習データが無い条件は従来の基準時計（パータイム＋クラス補正）を使います。</span></div>';
}
/* 2026-09-11 第14弾: 時計の絶対値は「トータルの秒」ではなく競馬新聞と同じ「分.秒」で出す
   例: 70.1 → 1.10.1 ／ 9.5 → 0.09.5 ではなく 9.5（1分未満は秒だけ）／ 150.4 → 2.30.4
   ※「+1.2秒」のような“差”は秒のままにします（差分を分表記にすると分かりにくいため）。 */
function tlClockTxt(sec, digits){
  var v = Number(sec);
  if (!isFinite(v)) return '-';
  var d = (digits == null ? 1 : digits);
  var min = Math.floor(Math.abs(v) / 60);
  var rest = Math.abs(v) - min * 60;
  if (rest >= 60){ min += 1; rest -= 60; }              // 9.96 → 10.0 のような繰り上がり
  var rs = rest.toFixed(d);
  if (parseFloat(rs) >= 60){ min += 1; rs = (parseFloat(rs) - 60).toFixed(d); }
  if (min > 0 && parseFloat(rs) < 10) rs = '0' + rs;     // 1分9.5秒 → 1.09.5
  var out = min > 0 ? (min + '.' + rs) : rs;
  return (v < 0 ? '-' : '') + out;
}
function tlLearnChips(tbl, minN, fmt){
  var ks = Object.keys(tbl || {}).filter(function(k){ return tbl[k].n >= minN; });
  ks.sort(function(a, b){ return tbl[a].o - tbl[b].o; });
  return ks.map(function(k){
    return '<span class="chip" style="font-size:.7rem">' + fmt(k, tbl[k]) + '</span>';
  }).join(' ');
}
function tlLearnRender(){
  var chip = $('tlLearnChip'), stat = $('tlLearnStat'), tbl = $('tlLearnTbl');
  var m = tlLearnLoad();
  if (chip) chip.textContent = tlLearnReady(m) ? ('学習済み ' + m.nS + ' 件') : '未学習';
  if (!stat || !tbl) return;
  if (!tlLearnReady(m)){
    stat.innerHTML = '<span class="muted">まだ学習していません。いまは<b>基準時計の静的テーブル（パータイム＋クラス補正）</b>で判定しています。' +
      '④で年を指定して過去データを取り込むと、その年のJRA全レースの勝ち時計から基準を学習して自動で切り替わります。</span>';
    tbl.innerHTML = '';
    return;
  }
  stat.innerHTML = '学習: <b>' + tlLearnWhen(m) + '</b>　勝ち時計 <b>' + m.nS + '</b> 件（学習DB ' + m.nDb + ' レース／馬柱 ' + m.nHd + ' レース・使わなかった ' + (m.drop || 0) + ' 件）' +
    '　→ 距離 ' + Object.keys(m.dist).length + '・クラス ' + Object.keys(m.cls).length + '・距離帯×クラス ' + Object.keys(m.cls2 || {}).length +
    '・年齢 ' + Object.keys(m.age).length + '・競馬場 ' + Object.keys(m.ven).length + '・年 ' + Object.keys(m.yr).length + '・馬場 ' + m.nbaba + '・個別補正 ' + m.cells +
    '<br><span class="small">🚧 <b>障害 ' + (m.nSho || 0) + ' レースは別枠</b>で学習しています（平地＝芝・ダートの基準時計には一切混ぜません。障害の評価も障害の学習値だけで行い、' +
    '障害の学習値が取れないときは<b>芝/ダートのパータイムを流用せず「評価対象外」</b>にします）' +
    (m.shoMis ? '　・<b>芝2860m のように障害でしか存在しない距離が平地側に混ざっていた ' + m.shoMis + ' 件は除外</b>しました' : '') + '</span>' +
    '<br><span class="muted">当てはまり: 平均絶対誤差 <b>' + m.fitMae + '秒</b>（1レースの勝ち時計をこの誤差で言い当てられる）。' +
    '静的テーブルとの平均差 ' + (m.diffAvg > 0 ? '+' : '') + m.diffAvg + ' 秒。件数が足りないグループは補正しません（n&lt;' + TL_LEARN_MIN + '）。</span>';
  var h = [];
  ['芝', 'ダ', '障'].forEach(function(sf){
    var ds = (m.dists && m.dists[sf]) || [];
    if (!ds.length) return;
    var cls = TL_LEARN_CLS.filter(function(c){ return (m.cls[sf + '|' + c] || { n: 0 }).n >= TL_LEARN_MIND; });
    h.push('<div style="font-weight:700;margin:8px 0 2px">' + (sf === '芝' ? '🌱 芝' : (sf === 'ダ' ? '🟤 ダート' : '🚧 障害（平地とは別枠で学習・比較も障害のみ）')) +
      '　学習した基準時計（良馬場・3歳以上相当・競馬場/年の補正なし・<b>分.秒</b>）</div>');
    h.push('<div style="overflow-x:auto"><table class="ktbl" style="font-size:.72rem;white-space:nowrap">');
    h.push('<tr><th>距離</th>' + (cls.length ? cls.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') : '<th>基準</th>') + '</tr>');
    ds.forEach(function(d){
      var dl = m.dist[sf + '|' + d];
      var tds = (cls.length ? cls : ['']).map(function(c){
        var L = tlLearnBaseOf(m, sf, d, c || '特別', '', '', '');
        var st = c ? tlBaseSecStatic(sf, d, c) : null;
        if (L == null) return '<td class="muted">-</td>';
        var dd = (st != null) ? (L - st) : null;
        var ce = c ? m.cell[sf + '|' + d + '|' + c] : null;
        return '<td title="n=' + (dl ? dl.n : 0) + (ce ? '／個別補正 ' + (ce.o > 0 ? '+' : '') + ce.o.toFixed(2) + '秒(n=' + ce.n + ')' : '') +
          (dd != null ? '／静的テーブル比 ' + (dd > 0 ? '+' : '') + dd.toFixed(1) + '秒' : '') + '"><b>' + tlClockTxt(L) + '</b>' +
          (dd != null && Math.abs(dd) >= 0.5 ? ' <span class="muted" style="font-size:.9em">(' + (dd > 0 ? '+' : '') + dd.toFixed(1) + ')</span>' : '') + '</td>';
      });
      h.push('<tr><th>' + d + 'm</th>' + tds.join('') + '</tr>');
    });
    h.push('</table></div>');
  });
  function sec2(v){ return (v > 0 ? '+' : '') + v.toFixed(2) + '秒'; }
  /* 2026-09-12 第15弾: 「補正」と「距離帯ごとのクラス差の上乗せ」の説明・一覧は
     縦に長いので、まとめて折り込み（既定は閉じた状態）にしました。
     学習した基準時計の表そのものは折り込まずに出したままです。 */
  h.push('<details style="margin-top:8px;border:1px dashed var(--line2);border-radius:8px;background:var(--card2)">' +
    '<summary class="small" style="cursor:pointer;padding:5px 9px;font-weight:700;color:var(--ok-ink)">' +
    '🔧 学習した<b>補正</b>の内訳と距離帯の<b>上乗せ</b>を開く／閉じる' +
    '（クラス補正／距離帯ごとのクラス差の上乗せ／年齢・競馬場・年・馬場の補正）' +
    '　<span class="muted" style="font-weight:500">※基準時計＝距離の基準 ＋ これらの補正の合計です</span></summary>' +
    '<div style="padding:2px 9px 8px">');
  h.push('<div class="small muted" style="margin:2px 0 4px">各補正は「秒」で表した<b>基準時計への上乗せ／差し引き</b>です。' +
    '＋＝その条件では時計がかかる（基準が遅くなる）／−＝速い。件数がしきい値（n≥' + TL_LEARN_MIN + '）に満たないグループは補正していません。</div>');
  h.push('<div style="font-weight:700;margin:8px 0 2px">クラス補正（未勝利を0とした各クラスの差）</div><div class="small">');
  ['芝', 'ダ', '障'].forEach(function(sf){
    var ks = TL_LEARN_CLS.filter(function(c){ return (m.cls[sf + '|' + c] || { n: 0 }).n >= TL_LEARN_MIND; });
    if (!ks.length) return;
    h.push('<div style="margin:2px 0">' + (sf === '芝' ? '🌱 芝' : (sf === 'ダ' ? '🟤 ダート' : '🚧 障害')) + ': ' + ks.map(function(c){
      var e = m.cls[sf + '|' + c];
      return '<span class="chip" style="font-size:.7rem">' + esc(c) + ' ' + sec2(e.o) + ' <span class="muted">n=' + e.n + '</span></span>';
    }).join(' ') + '</div>');
  });
  h.push('</div>');
  var c2k = Object.keys(m.cls2 || {}).filter(function(k){ return m.cls2[k].n >= TL_LEARN_MIND && Math.abs(m.cls2[k].o) >= 0.2; });
  if (c2k.length){
    h.push('<div style="font-weight:700;margin:6px 0 2px">距離帯ごとのクラス差の上乗せ（短=〜1400m／中=1500〜2000m／長=2100m〜、差が0.2秒以上だけ表示）</div><div class="small">' +
      tlLearnChips(m.cls2, TL_LEARN_MIND, function(k, v){
        var p = k.split('|');
        return (Math.abs(v.o) < 0.2) ? '' : ((p[0] === '芝' ? '🌱' : '🟤') + ' ' + p[1] + '距離 ' + esc(p[2]) + ' ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>');
      }) + '</div>');
  }
  h.push('<div style="font-weight:700;margin:8px 0 2px">年齢区分の補正（＋＝時計がかかる／−＝速い）</div><div class="small">' +
    tlLearnChips(m.age, TL_LEARN_MINV, function(k, v){ var p = k.split('|'); return (p[0] === '芝' ? '🌱' : '🟤') + ' ' + esc(p[1]) + ' ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>'; }) + '</div>');
  h.push('<div style="font-weight:700;margin:8px 0 2px">競馬場補正（＋＝時計がかかる／−＝速い）</div><div class="small">' +
    tlLearnChips(m.ven, TL_LEARN_MINV, function(k, v){ var p = k.split('|'); return (p[0] === '芝' ? '🌱' : '🟤') + ' ' + esc(p[1]) + ' ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>'; }) + '</div>');
  h.push('<div style="font-weight:700;margin:8px 0 2px">年補正（コース改修や時計の出方の年差）</div><div class="small">' +
    tlLearnChips(m.yr, TL_LEARN_MINV, function(k, v){ return k + '年 ' + sec2(v.o) + ' <span class="muted">n=' + v.n + '</span>'; }) + '</div>');
  /* 馬場補正（学習値 vs 静的値） */
  var bk = Object.keys(m.baba);
  if (bk.length){
    h.push('<div style="font-weight:700;margin:8px 0 2px">馬場補正（良換算するために引く秒数）</div>');
    h.push('<table class="ktbl" style="font-size:.74rem"><tr><th>面</th><th>馬場</th><th>学習値</th><th>静的テーブル</th><th>差</th><th>件数</th></tr>');
    bk.sort().forEach(function(k){
      var p = k.split('|'), e = m.baba[k];
      var st = tlBabaAdjStatic(p[1], p[0]);
      h.push('<tr><td>' + (p[0] === '芝' ? '芝' : 'ダート') + '</td><td>' + esc(p[1]) + '</td><td><b>' + sec2(e.o) + '</b></td>' +
        '<td class="muted">' + sec2(st) + '</td><td>' + sec2(e.o - st) + '</td><td class="muted">' + e.n + '</td></tr>');
    });
    h.push('</table>');
  }
  h.push('</div></details>');   // 補正・上乗せの折り込みを閉じる
  if ((m.diffTop || []).length){
    h.push('<details style="margin-top:6px"><summary class="small">静的テーブルとの差が大きい条件 上位' + m.diffTop.length + '件（＝学習の効果が出るところ）</summary>' +
      '<table class="ktbl" style="font-size:.72rem;margin-top:4px"><tr><th>面</th><th>距離</th><th>クラス</th><th>学習値</th><th>静的</th><th>差</th></tr>');
    m.diffTop.forEach(function(d){
      var p = d.k.split('|');
      h.push('<tr><td>' + p[0] + '</td><td>' + p[1] + 'm</td><td>' + esc(p[2]) + '</td><td><b>' + tlClockTxt(d.learn) + '</b></td>' +
        '<td class="muted">' + tlClockTxt(d.stat) + '</td><td style="color:' + (d.d > 0 ? 'var(--err-ink)' : 'var(--acc)') + '">' + sec2(d.d) + '</td></tr>');
    });
    h.push('</table></details>');
  }
  tbl.innerHTML = h.join('');
}

/* ---------- 初期化 ---------- */
function initTl(){
  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'tlScan'){ e.preventDefault(); tlRunScan(); }
    if (t.id === 'tlLearnBtn'){ e.preventDefault(); tlLearnRun(false); }
    if (t.id === 'tlLearnClear'){
      e.preventDefault();
      tlLearnClear(); tlLearnRender(); tlLearnMsg('🎓 学習した基準時計を消しました（静的テーブル＝パータイム＋クラス補正に戻ります）。', false);
      try { tlRender(); if (typeof rebuildHorseTable === 'function') rebuildHorseTable(); } catch(e2){}
    }
    if (t.id === 'tlClear'){
      e.preventDefault();
      var fn = function(){ tlSave(tlBlank()); tlRender(); tlMsg('評価を消去しました。'); try { if (typeof rebuildHorseTable === 'function') rebuildHorseTable(); } catch(e2){} };
      if (typeof showConfirm === 'function') showConfirm('勝ちタイムの評価（🎯/⚠️バッジ）を消去しますか？\n📒馬ノートに登録済みの短評は残ります。', fn); else fn();
    }
  });
  document.addEventListener('change', function(e){
    var t = e.target;
    if (t && t.id === 'tlNote'){
      var o = tlStore(); o.set.note = !!t.checked; tlSave(o);
      tlMsg(t.checked ? '短評の自動登録をONにしました（次回「評価」を押したときから）' : '短評の自動登録をOFFにしました');
    }
  });
  tlLearnRender();
  tlRender();
}
