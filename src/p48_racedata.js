/* =========================================================
   p48_racedata.js — レース結果ページの「追加情報」を抽出する
   （#2026-09-12 第16弾）

   netkeiba SP結果ページ
     https://race.sp.netkeiba.com/?pid=race_result&race_id=202609040311
   の「全着順」の下にある
     ・コーナー通過順位（1〜4角の並び。記号つき）
     ・ペース（S=スロー / M=ミドル / H=ハイ）
     ・ラップタイム（200mごとの 通過タイム／ラップタイム）
   を取り出します。

   払戻金は既存の bfParsePayback() / bfPayoutMap()（p31_bloodfactor.js）が
   同じページ形式（<div class="Result_Pay_Back"> + <tr class="Tansho"> など）に
   対応しているので、ここでは呼び出して一緒に返すだけにしています。

   ★ 全部「純関数」です。HTML文字列を渡すと結果のオブジェクトを返すだけで、
     通信・保存・DOM操作は一切しません（tests/rework9.test.js で検証）。
   ========================================================= */

/* タグ・実体参照を除いてテキストだけにする */
function rdTag(x){
  return String(x == null ? '' : x)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}
/* 全角数字・全角ハイフンを半角へ */
function rdNorm(s){
  return String(s == null ? '' : s)
    .replace(/[０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[－―ー]/g, '-');
}
/* 時刻文字列 → 秒。'12.5'→12.5 / '1:11.2'→71.2 / '2:00.7'→120.7 / 不正→null */
function rdSec(s){
  var t = rdNorm(rdTag(s)).replace(/\s+/g, '');
  if (!t) return null;
  var m = t.match(/^(\d{1,2}):(\d{1,2}(?:\.\d{1,2})?)$/);
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  if (/^\d{1,3}(?:\.\d{1,2})?$/.test(t)) return parseFloat(t);
  return null;
}

/* 目的のテーブルの中身（<table>〜</table> の内側）を返す。
   key は summary="…" または class="…" の一部。入れ子テーブルも深さで追う。 */
function rdTable(html, key){
  html = String(html || '');
  var re = new RegExp('<table[^>]*(?:summary="[^"]*' + key + '[^"]*"|class="[^"]*' + key + '[^"]*")[^>]*>', 'i');
  var m = re.exec(html);
  if (!m) return '';
  var i = m.index, depth = 0, reT = /<\/?table\b[^>]*>/gi, t;
  reT.lastIndex = i;
  while ((t = reT.exec(html)) !== null){
    if (t[0].charAt(1) === '/'){ depth--; if (depth === 0) return html.slice(i + m[0].length, t.index); }
    else depth++;
  }
  return html.slice(i + m[0].length);
}

/* ---------- コーナー通過順位 ---------- */
/* <table summary="コーナー通過順位" class="… Corner_Num"> の4行を取り出す。
   → { c:['2,9,12,5(7,15)…', …], n:4, labels:['1コーナー',…] }
   ※ <span class="fwB Corner_Num01">15</span> のような1〜3着の色分けタグは
      テキストだけ残せばいいので rdTag() で落として構いません。 */
function rdParseCorners(html){
  var seg = rdTable(html, 'コーナー通過順位');
  var out = { c: [], labels: [], n: 0 };
  if (!seg) return out;
  var trs = seg.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  trs.forEach(function(tr){
    var th = (tr.match(/<th[^>]*>([\s\S]*?)<\/th>/i) || [])[1];
    var td = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/i) || [])[1];
    if (th == null || td == null) return;
    var lab = rdTag(th);
    var body = rdTag(td);
    if (!body) return;
    out.labels.push(lab);
    out.c.push(rdNorm(body).replace(/\s+/g, ''));
  });
  out.n = out.c.length;
  return out;
}
/* コーナー通過順の文字列 → 馬番ごとの位置(1始まり)。
   記号の意味（netkeiba のページ内説明より）:
     ,  = 1馬身以上2馬身未満   -  = 2馬身以上5馬身未満   =  = 5馬身以上
     () = 1馬身未満で並走（内側の馬番から）   * = 馬群内の先頭馬
   → 位置は「先頭から何番目に書かれているか」で数えます（並走は内→外の順）。 */
function rdCornerPos(str){
  var s = rdNorm(rdTag(str)).replace(/\s+/g, '');
  var pos = {};
  if (!s) return pos;
  var re = /\d{1,2}/g, m, i = 0;
  while ((m = re.exec(s)) !== null){
    i++;
    var no = parseInt(m[0], 10);
    if (!(no >= 1 && no <= 20)) continue;
    if (pos[no] == null) pos[no] = i;      // 最初に書かれた位置を採用
  }
  return pos;
}
/* 4角ぶんまとめて → { '15':[6,6,5,5], '8':[7,7,7,6], … }（角の数はレースにより2〜4） */
function rdCornerPosAll(corners){
  var cs = (corners && corners.c) || [];
  var list = cs.map(rdCornerPos);
  var out = {};
  list.forEach(function(one){
    for (var no in one){
      if (!Object.prototype.hasOwnProperty.call(one, no)) continue;
      (out[no] = out[no] || []).push(one[no]);
    }
  });
  return out;
}
/* 位置(1始まり)と頭数 → 脚質（p13_bias の biasPosToStyle と同じ基準） */
function rdPosStyle(pos, n){
  if (!(pos >= 1) || !(n >= 2)) return '';
  if (pos === 1) return '逃げ';
  var r = (pos - 1) / (n - 1);
  if (r <= 0.3) return '先行';
  if (r <= 0.6) return '差し';
  return '追込';
}

/* ---------- ペース ---------- */
/* <dl class="RacePace"><dt>ペース</dt><dd class="Pace_M">M</dd></dl> → 'M'
   S=スロー / M=ミドル / H=ハイ（netkeiba の表記そのまま） */
function rdParsePace(html){
  html = String(html || '');
  // SP結果ページ: <dl class="RacePace"><dt>ペース</dt><dd class="Pace_M">M</dd></dl>
  var m = html.match(/<dd[^>]*class="[^"]*Pace_([SHM])[^"]*"[^>]*>([\s\S]*?)<\/dd>/i);
  if (m) return (m[1] || rdTag(m[2])).toUpperCase().charAt(0);
  var seg = html.match(/<dl[^>]*class="[^"]*RacePace[^"]*"[\s\S]*?<\/dl>/i);
  if (seg){
    var dd = seg[0].match(/<dd[^>]*>([\s\S]*?)<\/dd>/i);
    var t = rdTag(dd ? dd[1] : '').toUpperCase();
    if (/^[SHM]/.test(t)) return t.charAt(0);
  }
  // PC結果ページ(race.netkeiba.com/race/result.html): <div class="RapPace_Title">ペース:<span>M</span></div>
  var m2 = html.match(/RapPace_Title[^>]*>\s*ペース\s*[:：]?\s*(?:<span[^>]*>)?\s*([SHM])/i);
  if (m2) return m2[1].toUpperCase();
  return '';
}
var RD_PACE_JA = { S: 'スロー', M: 'ミドル', H: 'ハイ' };
function rdPaceJa(p){ return RD_PACE_JA[String(p || '').toUpperCase().charAt(0)] || ''; }

/* ---------- ラップタイム ---------- */
/* ラップタイム表 → [{ m:200, pass:12.5, lap:12.5 }, …]（距離の昇順・空セルは除く）

   netkeiba には2種類の組み方があります。両方に対応します。
   ・SP結果ページ: <tr class="Header"> の次に <tr class="HaronTime"> が1行だけ来て、
                  1セルの中に「通過タイム<br />ラップタイム」が入る
                    <td>12.5<br />12.5</td>  /  <td>1:11.2<br />11.8</td>
   ・PC結果ページ: <tr class="Header"> の次に <tr class="HaronTime"> が2行来て、
                  1行目=通過タイム、2行目=ラップタイム
                    <td>12.5</td><td>23.2</td>…   ← 通過
                    <td>12.5</td><td>10.7</td>…   ← ラップ
   ※ 上段=通過タイム（スタートからの cumulative）、下段=ラップタイム（その200m） */
function rdParseLaps(html){
  var seg = rdTable(html, 'ラップタイム');
  var out = [];
  if (!seg) return out;
  var trs = seg.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  var labels = [], group = [];

  function flush(){
    if (!labels.length || !group.length) { group = []; return; }
    var cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    var rowsCells = group.map(function(tr){
      return (tr.match(cellRe) || []);
    });
    var combined = rowsCells[0].some(function(c){ return /<br\s*\/?>/i.test(c); });
    if (combined){
      // SP形式: 1行のセル内が「通過<br />ラップ」
      rowsCells[0].forEach(function(c, i){
        var m = labels[i];
        if (!m) return;
        var parts = c.split(/<br\s*\/?>/i);
        var pass = rdSec(parts[0]);
        var lap = rdSec(parts.length > 1 ? parts[1] : parts[0]);
        if (pass == null && lap == null) return;
        out.push({ m: m, pass: pass, lap: lap });
      });
    } else {
      // PC形式: 1行目=通過 / 2行目=ラップ（1行しか無ければラップとして扱う）
      var passRow = rowsCells.length >= 2 ? rowsCells[0] : null;
      var lapRow = rowsCells.length >= 2 ? rowsCells[1] : rowsCells[0];
      lapRow.forEach(function(c, i){
        var m = labels[i];
        if (!m) return;
        var lap = rdSec(c);
        var pass = passRow ? rdSec(passRow[i]) : null;
        if (lap == null && pass == null) return;
        out.push({ m: m, pass: pass, lap: lap });
      });
    }
    group = [];
  }

  trs.forEach(function(tr){
    if (/<th[\s>]/i.test(tr)){
      flush();
      labels = (tr.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || []).map(function(c){
        var m = rdTag(c).match(/(\d{3,4})\s*m/i);
        return m ? parseInt(m[1], 10) : 0;
      });
      return;
    }
    if (labels.length) group.push(tr);
  });
  flush();

  out.sort(function(a, b){ return a.m - b.m; });
  // 同じ距離が二重に出た場合は最初を採用
  var seen = {}, ded = [];
  out.forEach(function(x){ if (!seen[x.m]){ seen[x.m] = 1; ded.push(x); } });
  return ded;
}
/* ラップから上りNハロン（秒）。dist=総距離(m)、f=ハロン数（既定3F） */
function rdAgari(laps, dist, f){
  f = f || 3;
  var L = (laps || []).filter(function(x){ return x.lap != null; });
  if (!L.length) return null;
  var d = parseInt(dist, 10) || (L[L.length - 1].m || 0);
  var from = d - f * 200;
  var sum = 0, n = 0;
  L.forEach(function(x){ if (x.m > from && x.m <= d){ sum += x.lap; n++; } });
  return n ? Math.round(sum * 10) / 10 : null;
}
/* ラップからペースを推定（netkeiba の「ペース」が取れなかったときの保険）。
   前半3F(600m通過) と 上がり3F の差で見ます。
     前3F - 後3F >= +1.5 → S（前半が遅く後半速い＝スロー）
                   <= -1.5 → H（前半が速く後半遅い＝ハイ）
     それ以外 → M
   ※ netkeiba 公式の判定と完全には一致しないことがあります（近似）。 */
function rdPaceFromLaps(laps, dist){
  var L = (laps || []).filter(function(x){ return x.lap != null; });
  if (L.length < 4) return '';
  var d = parseInt(dist, 10) || L[L.length - 1].m;
  if (!(d >= 800)) return '';
  var first3 = 0, n1 = 0, last3 = 0, n2 = 0;
  L.forEach(function(x){
    if (x.m <= 600){ first3 += x.lap; n1++; }
    if (x.m > d - 600 && x.m <= d){ last3 += x.lap; n2++; }
  });
  if (n1 < 3 || n2 < 3) return '';
  var diff = first3 - last3;
  if (diff >= 1.5) return 'S';
  if (diff <= -1.5) return 'H';
  return 'M';
}
/* 前半／後半のバランス（展開学習・表示用）
   → { first3, last3, diff, mid:[{m,lap}…] }  取れなければ null */
function rdLapShape(laps, dist){
  var L = (laps || []).filter(function(x){ return x.lap != null; });
  if (!L.length) return null;
  var d = parseInt(dist, 10) || L[L.length - 1].m;
  var f3 = 0, nf = 0, l3 = 0, nl = 0;
  L.forEach(function(x){
    if (x.m <= 600){ f3 += x.lap; nf++; }
    if (x.m > d - 600 && x.m <= d){ l3 += x.lap; nl++; }
  });
  return {
    dist: d,
    first3: nf >= 3 ? Math.round(f3 * 10) / 10 : null,
    last3: nl >= 3 ? Math.round(l3 * 10) / 10 : null,
    diff: (nf >= 3 && nl >= 3) ? Math.round((f3 - l3) * 10) / 10 : null,
    laps: L.map(function(x){ return { m: x.m, pass: x.pass, lap: x.lap }; })
  };
}

/* ---------- 払戻金（8券種） ----------
   既存の bfParsePayback()（p31）が SP/DB 両形式に対応していますが、
   PC結果ページ race.netkeiba.com/race/result.html では
   セクションの切り出しに失敗して null になることがあります。
   → その場合の保険として、行（<tr class="Tansho"> など）を直接探す自前パーサを持っています。
   返り値は bfParsePayback と同じ生リスト [{ t:'tan', nos:[15], yen:710 }, …] です。 */
var RD_PAY_CLS = { Tansho:'tan', Fukusho:'fuku', Wakuren:'wakuren', Umaren:'umaren',
                   Wide:'wide', Umatan:'umatan', Fuku3:'sanfuku', Tan3:'santan' };
function rdPayYens(cell){
  var ys = [], re = /(\d[\d,]*)\s*円/g, m;
  while ((m = re.exec(cell || '')) !== null) ys.push(parseInt(m[1].replace(/,/g, ''), 10));
  return ys;
}
/* Resultセル内の数字を「1つの的中組み合わせ」単位にまとめる（<ul> が複数＝ワイド等） */
function rdPayGroups(cell){
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
      var t = rdTag(sp);
      if (/\d/.test(t)){
        var d = [], r = /(\d{1,2})/g, m;
        while ((m = r.exec(t)) !== null) d.push(parseInt(m[1], 10));
        groups.push(d);
      }
    });
    if (groups.length) return groups;
  }
  var ns = [], r2 = /(\d{1,2})/g, m2, txt = rdTag(cell);
  while ((m2 = r2.exec(txt)) !== null) ns.push(parseInt(m2[1], 10));
  return ns.length ? [ns] : [];
}
function rdParsePayout(html){
  html = String(html || '');
  var out = [];
  // 単勝の行から3連単の行までを範囲として切り出す（セクションの class 名に依存しない）
  var iFirst = html.search(/<(?:tr|tbody)\s+class="Tansho"/i);
  if (iFirst < 0) return null;
  var iLast = html.search(/<(?:tr|tbody)\s+class="Tan3"/i);
  var seg = html.slice(iFirst, iLast > iFirst ? iLast + 4000 : iFirst + 20000);
  var contRe = /<((?:tbody|tr))\s+class="(Tansho|Fukusho|Wakuren|Umaren|Wide|Umatan|Fuku3|Tan3)"[^>]*>([\s\S]*?)<\/\1>/g;
  var cm;
  function pushOne(trHTML, kind){
    var resM = /<td[^>]*class="Result"[^>]*>([\s\S]*?)<\/td>/i.exec(trHTML);
    var payM = /<td[^>]*class="Payout"[^>]*>([\s\S]*?)<\/td>/i.exec(trHTML);
    if (!resM || !payM) return;
    var groups = rdPayGroups(resM[1]);
    var yens = rdPayYens(payM[1]);
    if (groups.length && groups.length === yens.length){
      for (var q = 0; q < groups.length; q++) out.push({ t: kind, nos: groups[q], yen: yens[q] });
    } else if (groups.length === 1 && yens.length === 1){
      out.push({ t: kind, nos: groups[0], yen: yens[0] });
    }
  }
  while ((cm = contRe.exec(seg)) !== null){
    var tag = cm[1], kind = RD_PAY_CLS[cm[2]];
    if (!kind) continue;
    if (tag === 'tbody'){
      var trs = cm[3].match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
      if (trs && trs.length) trs.forEach(function(tr){ pushOne(tr, kind); });
    } else {
      pushOne(cm[3], kind);
    }
  }
  return out.length ? out : null;
}
/* 生リスト → { win, place, wakuren, umaren, wide, umatan, sanfuku, santan } の {nos,pays} 正規化。
   bfPayoutMap()（p31）と同じ形にします。 */
var RD_PAY_KEY = { tan:'win', fuku:'place', wakuren:'wakuren', umaren:'umaren',
                   wide:'wide', umatan:'umatan', sanfuku:'sanfuku', santan:'santan' };
function rdPayoutMap(payouts){
  if (typeof bfPayoutMap === 'function'){ try { return bfPayoutMap(payouts); } catch(e){} }
  var m = { win:null, place:null, wakuren:null, umaren:null, wide:null, umatan:null, sanfuku:null, santan:null };
  var acc = {};
  (payouts || []).forEach(function(it){
    var k = RD_PAY_KEY[it && it.t];
    if (!k) return;
    var grp = acc[k] = acc[k] || { nos: [], pays: [] };
    var sep = (it.t === 'umatan' || it.t === 'santan') ? '→' : '-';
    grp.nos.push(String((it.nos || []).join(sep)));
    grp.pays.push(it.yen || 0);
  });
  for (var key in m){ if (acc[key]) m[key] = acc[key]; }
  return m;
}

/* ---------- まとめて抽出 ---------- */
/* 結果ページHTML → { ok, corners, cornerPos, pace, paceSrc, laps, shape, payout, payouts, rows }
   ・paceSrc: 'nk'=netkeiba の表示 / 'lap'=ラップから推定 / ''=不明
   ・rows: 全着順（着順・枠・馬番・馬名・騎手・斤量・タイム・上り・着差・オッズ・人気・馬体重・厩舎）
   ・payout/payouts: 既存パーサ(p31)があればそれで、無ければ null */
function rdParseExtra(html, opt){
  opt = opt || {};
  var out = { ok: false, corners: { c: [], labels: [], n: 0 }, cornerPos: {}, pace: '', paceSrc: '',
              laps: [], shape: null, payout: null, payouts: null, rows: [] };
  html = String(html || '');
  if (!html) return out;
  out.corners = rdParseCorners(html);
  out.cornerPos = rdCornerPosAll(out.corners);
  out.laps = rdParseLaps(html);
  out.pace = rdParsePace(html);
  out.paceSrc = out.pace ? 'nk' : '';
  var dist = opt.dist || (out.laps.length ? out.laps[out.laps.length - 1].m : 0);
  if (!out.pace && out.laps.length){
    var p2 = rdPaceFromLaps(out.laps, dist);
    if (p2){ out.pace = p2; out.paceSrc = 'lap'; }
  }
  out.shape = rdLapShape(out.laps, dist);
  out.rows = rdParseResultRows(html);
  try {
    if (typeof bfParsePayback === 'function') out.payouts = bfParsePayback(html);
  } catch(e){}
  if (!out.payouts || !out.payouts.length) out.payouts = rdParsePayout(html);   // PC結果ページ用の保険
  out.payout = rdPayoutMap(out.payouts);
  out.ok = !!(out.corners.n || out.laps.length || out.rows.length || out.payout);
  return out;
}

/* 全着順テーブル（SP結果ページ <table summary="全着順" id="All_Result_Table">）を行に分解。
   1行 = <td>着順</td><td>枠</td><td>馬番</td><td>馬情報</td><td>タイム</td><td>オッズ</td>
   馬情報セルに 馬名リンク／性齢／馬体重(増減)／騎手 斤量／厩舎 が入っています。 */
function rdParseResultRows(html){
  var seg = rdTable(html, '全着順');
  var out = [];
  if (!seg) return out;
  var trs = seg.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  trs.forEach(function(tr){
    if (/<th[\s>]/i.test(tr)) return;
    var cells = tr.split(/<td[^>]*>/i).slice(1).map(function(x){ return x.split('</td>')[0]; });
    if (cells.length < 5) return;
    var rankTxt = rdTag(cells[0]).replace(/[^0-9]/g, '');
    var rank = parseInt(rankTxt, 10);
    var status = '';
    if (isNaN(rank) || rank < 1){
      var raw = rdTag(cells[0]);
      status = raw || '除外';
      rank = 0;
    }
    var frame = '';
    var fm = (cells[1] || '').match(/Waku(\d)/);
    if (fm) frame = fm[1];
    if (!frame) frame = rdTag(cells[1]).replace(/[^0-9]/g, '');
    var no = rdTag(cells[2]).replace(/[^0-9]/g, '');
    var info = cells[3] || '';
    var nameA = info.match(/<a[^>]*href="[^"]*\/horse\/(\d{8,12})\/?"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i);
    var name = nameA ? rdTag(nameA[2] || nameA[3]) : '';
    var nk = nameA ? nameA[1] : '';
    var left = (info.match(/<span class="Detail_Left">([\s\S]*?)<\/span>/i) || [])[1] || '';
    var right = (info.match(/<span class="Detail_Right">([\s\S]*?)<\/span>/i) || [])[1] || '';
    var leftTxt = rdTag(left).split(' ');
    var sexAge = (rdTag(left).match(/[牡牝セ][1-9]\d?/) || [''])[0];
    var wm = rdTag(left).match(/(\d{3})\s*kg\s*\(([^)]*)\)/);
    var weightKg = wm ? parseInt(wm[1], 10) : 0;
    var wchg = wm ? wm[2] : '';
    var rTxt = rdTag(right);
    var jp = rTxt.split(/ (栗東|美浦)/);
    var jw = (jp[0] || '').trim();
    var jm = jw.match(/^(.*?)\s+(\d{2}(?:\.\d)?)$/);
    var jockey = jm ? jm[1].replace(/\s+/g, '') : jw.replace(/\s+/g, '');
    var kg = jm ? jm[2] : '';
    var trainer = (jp[1] ? jp[1] + (jp[2] || '') : '').replace(/\s+/g, '');
    var tcell = cells[4] || '';
    var tm = tcell.match(/<dt[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || tcell.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
    var time = tm ? rdTag(tm[1]) : '';
    var dds = tcell.match(/<dd[^>]*>([\s\S]*?)<\/dd>/gi) || [];
    var margin = dds[0] ? rdTag(dds[0]) : '';
    var last3 = dds[1] ? rdTag(dds[1]).replace(/[()]/g, '') : '';
    var ocell = cells[5] || '';
    var om = rdTag(ocell).match(/([\d.]+)\s*倍/);
    var pm = rdTag(ocell).match(/(\d+)\s*人気/);
    out.push({
      rank: rank, status: status, frame: frame, no: no, name: name, nk: nk,
      sexAge: sexAge, weightKg: weightKg, wchg: wchg,
      jockey: jockey, kg: kg, trainer: trainer,
      time: time, margin: margin, last3: last3,
      odds: om ? parseFloat(om[1]) : null, pop: pm ? parseInt(pm[1], 10) : 0,
      timeSec: rdSec(time), agariSec: rdSec(last3)
    });
  });
  return out;
}

/* 追加情報を保存用のかたちにコンパクトにまとめる（学習DB・トラックバイアス共通）。
   容量を抑えるため、ラップは [距離, ラップ] の配列、コーナー位置は馬番→位置配列にします。 */
function rdCompact(extra, nHead){
  if (!extra) return null;
  var o = {
    v: 1,
    pace: extra.pace || '',
    paceSrc: extra.paceSrc || '',
    corners: (extra.corners && extra.corners.c) ? extra.corners.c.slice() : [],
    pos: {},
    laps: (extra.laps || []).map(function(x){ return [x.m, x.lap, x.pass]; }),
    shape: extra.shape ? { f3: extra.shape.first3, l3: extra.shape.last3, d: extra.shape.diff } : null,
    payout: extra.payout || null
  };
  var cp = extra.cornerPos || {};
  for (var no in cp){
    if (!Object.prototype.hasOwnProperty.call(cp, no)) continue;
    o.pos[no] = cp[no];
  }
  // 馬番ごとのコーナー位置 → 4角位置から脚質も付けておく（表示・学習の両方で使う）
  o.sty = {};
  var n = parseInt(nHead, 10) || Object.keys(o.pos).length;
  for (var no2 in o.pos){
    if (!Object.prototype.hasOwnProperty.call(o.pos, no2)) continue;
    var arr = o.pos[no2];
    var p4 = arr.length ? arr[arr.length - 1] : 0;
    o.sty[no2] = { p4: p4, tag: rdPosStyle(p4, n) };
  }
  return o;
}
