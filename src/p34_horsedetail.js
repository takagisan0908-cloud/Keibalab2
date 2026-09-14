/* =========================================================
   34 全馬のプロフィール・戦績・成績分析（netkeiba自動取得）を表で表示
   ---------------------------------------------------------
   「netkeiba URL取込」で読み込んだ出馬表(馬ID付き)の全出走馬を対象に、
   - 馬プロフィールページ db.netkeiba.com/horse/{id}/
       → 生年月日・調教師・馬主・生産者・産地・獲得賞金・通算成績・主な勝鞍
   - 戦績ページ db.netkeiba.com/horse/result/{id}/
       → 全レースの戦績表（日付・開催・R・レース名・距離・馬場・着順・
          単勝・人気・騎手・斤量・タイム・着差・通過・上り・馬体重）
   を取得し、成績分析(全体/芝ダ/距離/馬場/場別の着別・単回収率)と合わせて
   ①タブの出馬表の下に「そのまま表」として表示します。
   取得結果はこの端末(localStorage)にキャッシュします。
   ========================================================= */
var HD_LS = 'khl_hd_v1';
var HD_FRESH_MS = 2 * 60 * 60 * 1000;   // 2時間以内はキャッシュ再利用
var HD_VENUES = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
function hdLs(){
  try { return JSON.parse(cmpUnpack(localStorage.getItem(HD_LS)) || '{}') || {}; }
  catch(e){ return {}; }
}
function hdSave(o){ try { localStorage.setItem(HD_LS, cmpPack(JSON.stringify(o))); } catch(e){} }
function hdTxt(s){
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function(m, n){ try { return String.fromCharCode(parseInt(n, 10)); } catch(e){ return ''; } })
    .replace(/\s+/g, ' ').trim();
}
function hdCl(s){ return String(s == null ? '' : s).replace(/[\s\u3000]/g, ''); }
function hdGet(url){
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  if (typeof kaiFetchAny === 'function') return kaiFetchAny(url);
  if (typeof nkFetchTimeout === 'function') return nkFetchTimeout(url, 20000);
  return Promise.reject(new Error('中継(リレー)が未設定です'));
}
function hdNum(x){ var v = parseFloat(String(x == null ? '' : x).replace(/[^0-9.]/g, '')); return isNaN(v) ? 0 : v; }

/* ---------- プロフィールパース ---------- */
function hdParseProfile(html){
  var prof = {};
  if (!html) return prof;
  var m = html.match(/<table[^>]*summary="[^"]*プロフィール"[^>]*>([\s\S]*?)<\/table>/i);
  var seg = m ? m[1] : '';
  if (!seg){
    var tm = html.match(/<table[^>]*class="db_prof_table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (tm) seg = tm[1];
  }
  if (!seg) return prof;
  var trs = seg.split(/<tr[^>]*>/i);
  trs.forEach(function(tr){
    var thM = tr.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    var tdM = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!thM || !tdM) return;
    var key = hdCl(hdTxt(thM[1]));
    var val = hdTxt(tdM[1]);
    if (key && val) prof[key] = val;
  });
  return prof;
}
/* ラベル部分一致でプロフィール値を取得 */
function hdP(prof, keys){
  for (var i = 0; i < keys.length; i++){
    var target = hdCl(keys[i]);
    for (var k in prof){
      if (k.indexOf(target) >= 0 || target.indexOf(k) >= 0) return prof[k];
    }
  }
  return '';
}

/* ---------- 戦績パース（db.netkeiba.com/horse/result/{id}/） ---------- */
function hdParseRecords(html){
  var out = [];
  if (!html) return out;
  var tables = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
  var seg = '';
  for (var t = 0; t < tables.length; t++){
    if (!/<th[^>]*>/i.test(tables[t])) continue;
    var headCells = (tables[t].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || []).map(function(x){ return hdCl(hdTxt(x)); });
    if (headCells.indexOf('日付') >= 0 && headCells.indexOf('着順') >= 0 && headCells.indexOf('レース名') >= 0){
      seg = tables[t].replace(/^<table[^>]*>/i, '').replace(/<\/table>$/i, '');
      break;
    }
  }
  if (!seg) return out;
  var trs = seg.split(/<tr[^>]*>/i);
  var want = { '日付':'date', 開催:'venue', 天気:'weather', R:'r', 'レース名':'name', 頭数:'head',
    枠番:'frame', 馬番:'no', オッズ:'odds', 人気:'pop', 着順:'orderRaw', 騎手:'jockey', 斤量:'weight',
    距離:'dist', 馬場:'baba', タイム:'time', 着差:'margin', 通過:'pass', ペース:'pace', 上り:'last3',
    馬体重:'wchg', '勝ち馬':'winner', 賞金:'prize' };
  var idx = {};
  var headerTr = -1;
  // ヘッダ行を探す（<th> に 日付・着順・レース名 が揃う最初の行）
  for (var hri = 0; hri < trs.length; hri++){
    var tr0 = trs[hri];
    if (!/<th[^>]*>/i.test(tr0)) continue;
    var hc0 = (tr0.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || []).map(function(x){ return hdCl(hdTxt(x)); });
    if (hc0.indexOf('日付') >= 0 && hc0.indexOf('着順') >= 0 && hc0.indexOf('レース名') >= 0){
      hc0.forEach(function(l, i){ for (var k in want){ if (idx[k] == null && l.indexOf(k) >= 0) idx[k] = i; } });
      headerTr = hri;
      break;
    }
  }
  if (headerTr < 0) return out;
  trs.forEach(function(tr, ri){
    if (ri <= headerTr) return;
    if (!/<td[ >]/i.test(tr) && !/<td>/i.test(tr)) return;
    var tds = tr.split(/<td[^>]*>/i).slice(1).map(function(x){ return hdTxt(x.split('</td>')[0]); });
    if (!tds.length) return;
    var v = function(key){
      if (idx[key] == null || tds[idx[key]] == null) return '';
      return tds[idx[key]];
    };
    var orderRaw = v('着順');
    var o = parseInt(orderRaw, 10);
    var row = {
      date: v('日付'), venue: v('開催'), weather: v('天気'), r: v('R'),
      name: v('レース名'), head: v('頭数'),
      frame: v('枠番'), no: v('馬番'), odds: v('オッズ'), pop: v('人気'),
      orderRaw: orderRaw,
      order: (!isNaN(o) && o > 0 && o <= 99) ? o : 0,
      status: (!isNaN(o) || !orderRaw) ? '' : ({ '中':'競走中止', '除':'除外', '取':'取消', '失':'失格', '没':'発走除外' }[orderRaw] || orderRaw),
      jockey: v('騎手'), weight: v('斤量'), dist: v('距離'), baba: v('馬場'),
      time: v('タイム'), margin: v('着差'), pass: v('通過'), pace: v('ペース'),
      last3: v('上り'), wchg: v('馬体重'), winner: v('勝ち馬'), prize: v('賞金')
    };
    // 距離・面
    var dm = row.dist.match(/(芝|ダ|障)/);
    row.surface = dm ? (dm[1] === 'ダ' ? 'ダ' : dm[1]) : '';
    var mm = row.dist.match(/[芝ダ障](\d{3,4})/);
    row.m = mm ? parseInt(mm[1], 10) : 0;
    // 開催から競馬場名（例: 1阪神2）。開催の場名を最優先し、レース名はフォールバック
    var vn = '';
    for (var q = 0; q < HD_VENUES.length; q++){
      if ((row.venue || '').indexOf(HD_VENUES[q]) >= 0){ vn = HD_VENUES[q]; break; }
    }
    if (!vn){
      for (var q2 = 0; q2 < HD_VENUES.length; q2++){
        if ((row.name || '').indexOf(HD_VENUES[q2]) >= 0){ vn = HD_VENUES[q2]; break; }
      }
    }
    row.venueName = vn;
    out.push(row);
  });
  // 日付昇順にソート（新しいものを末尾に）
  function dkey(x){ var m2 = String(x.date || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m2 ? (m2[1] + ('0' + m2[2]).slice(-2) + ('0' + m2[3]).slice(-2)) : ('99999999' + x.date); }
  out.sort(function(a, b){ return dkey(a) < dkey(b) ? -1 : (dkey(a) > dkey(b) ? 1 : 0); });
  return out;
}

/* ---------- 出遅れ(スタート出遅れ)の検出と集計 ----------
   「出馬表のデータ取得」時に取り込まれる各馬の過去レース(位置取り/通過)から、
   出遅れだったレースを数えて AI(展開エンジン)が使う「出遅れ率」を計算する。
   - m (明示): 位置取りに「(出遅れ)」「出遅れ」等の表記があるレース
               (netkeiba のスマホ用馬モーダル等の表記。例: 17-16-7-14(出遅れ))
   - i (推定): 表記が無い場合でも、1コーナー通過が最後方付近なのに
               直後のコーナー(2〜3角)で大きく順位を挽回したレースを「出遅れの可能性」として数える
   ※ 後方待機のまま終盤だけ伸びた差し・追込(本来の脚質)や、ずっと後方の馬は数えない */
function hdCornerNums(pass){
  if (!pass) return [];
  // 通過順位の数字列(例: 17-16-7-14 / 6-6-4-6 / (出遅れ)等の注記を含む場合も数字のみ抽出)
  var nums = [];
  String(pass).replace(/\d{1,2}/g, function(m){ nums.push(parseInt(m, 10)); });
  return nums;
}
/* 出遅れ率の判定対象になるレースか(集計の分母)。 */
function hdSlowJudgeable(r){
  if (!r) return false;
  if (!(parseInt(r.order, 10) >= 1)) return false;                                  // 競走中止・取消等は対象外
  if (/障/.test(String(r.dist || ''))) return false;                                // 障害は対象外
  var head = parseInt(String(r.head == null ? '' : r.head).replace(/[^0-9]/g, ''), 10) || 0;
  if (head < 6 || head > 30) return false;
  var nums = hdCornerNums(r.pass);
  if (nums.length < 2) return false;
  if (nums[0] < 1 || nums[0] > head) return false;                                  // 1コーナー順位が判読できること
  return true;
}
/* 1レースの判定。判定対象外は null / 明示出遅れなら 'm' / 推定なら 'i' を返す。
   推定は「netkeiba式」に近づけた判定を使う:
   - 1コーナーを最下位〜ブービー(出遅れの典型)で通過
   - しかも「直後(2〜3コーナー)に大きく順位を回復している」＝ゲートで置いて行かれて
     後から取り戻した走り。後方待機のまま終盤だけ伸びた差し・追込(本来の脚質)は数えない。 */
function hdRaceSlowKey(r){
  if (!hdSlowJudgeable(r)) return null;
  var pass = String(r.pass || '');
  // 明示表記「17-16-7-14(出遅れ)」等
  if (/(出遅れ|出遅)/.test(pass)) return 'm';
  var head = parseInt(String(r.head == null ? '' : r.head).replace(/[^0-9]/g, ''), 10) || 0;
  var nums = hdCornerNums(pass);
  var pos1 = nums[0], pos2 = nums[1];
  if (!(pos1 >= head - 1)) return null;          // 1コーナー最後方付近でなければ対象外
  if (pos1 === head && pos2 <= pos1 - 3) return 'i';   // 最下位→2角で3頭以上挽回
  if (pos1 >= head - 1 && pos2 <= pos1 - 3 && pos2 <= head - 4) return 'i'; // ブービー→2角で挽回
  // 2角で挽回が無くても、3角で大きく挽回している(タテ長コース/1角を使わない形)場合も推定
  if (nums.length >= 3){
    var pos3 = nums[2];
    if (pos1 === head && pos3 <= pos1 - 4) return 'i';
    if (pos3 <= pos1 - 4 && pos3 <= head - 5) return 'i';
  }
  return null;
}
/* 全戦績から出遅れを集計
   戻り値: { total:判定対象レース数(分母), m:明示回数, i:推定回数,
             all:出遅れ率%(m+i) , ex:明示のみ%(参考) } */
function hdSlowStat(rows){
  var o = { total: 0, m: 0, i: 0, all: 0, ex: 0 };
  (rows || []).forEach(function(r){
    if (!hdSlowJudgeable(r)) return;
    o.total++;
    var k = hdRaceSlowKey(r);
    if (k === 'm') o.m++;
    else if (k === 'i') o.i++;
  });
  if (o.total){
    o.all = Math.round((o.m + o.i) / o.total * 100);
    o.ex = Math.round(o.m / o.total * 100);
  }
  return o;
}
/* 集計結果の1行テキスト(表示用) */
function hdSlowText(st){
  if (!st || !st.total) return '';
  var parts = [];
  if (st.m) parts.push('明示 ' + st.m + '回');
  if (st.i) parts.push('推定 ' + st.i + '回');
  var head = '出遅れ: ' + (parts.length ? parts.join('・') : 'なし') + ' / ' + st.total + '走（出遅れ率' + st.all + '%' + ((st.m && st.i) ? '、明示のみ' + st.ex + '%' : '') + '）';
  return head;
}

/* ---------- 成績分析 ---------- */

/* ---------- 成績分析 ---------- */
function hdAgg(rows){
  var ag = { n: 0, w: 0, t2: 0, top3: 0, dnf: 0, sumOddsW: 0, sumPop: 0, popN: 0 };
  rows.forEach(function(r){
    ag.n++;
    if (r.order >= 1){
      if (r.order === 1) ag.w++;
      if (r.order <= 2) ag.t2++;
      if (r.order <= 3) ag.top3++;
      if (r.order === 1){ ag.sumOddsW += hdNum(r.odds); }
    } else {
      ag.dnf++;
    }
    if (r.pop !== '' && /^\d+$/.test(String(r.pop).trim())){ ag.sumPop += parseInt(r.pop, 10); ag.popN++; }
  });
  return ag;
}
function hdRoiS(ag){ return ag.n ? (100 * ag.sumOddsW / ag.n) : 0; }
function hdPct(a, b){ return b > 0 ? (a / b * 100).toFixed(0) : '−'; }
function hdBand(m){
  if (!m) return '';
  if (m <= 1400) return '短距離(〜1400)';
  if (m >= 1600 && m <= 1800) return 'マイル(1600〜1800)';
  if (m >= 1900 && m <= 2400) return '中距離(1900〜2400)';
  if (m >= 2500) return '長距離(2500〜)';
  return '';
}
function hdAn(races){
  var groups = [];
  function push(label, rows){
    if (!rows || !rows.length) return;
    var ag = hdAgg(rows);
    groups.push({ label: label, ag: ag, races: rows });
  }
  push('全体', races);
  ['芝', 'ダ', '障'].forEach(function(sf){
    var sub = races.filter(function(r){ return r.surface === sf; });
    push(sf, sub);
  });
  var bandRows = {};
  races.forEach(function(r){
    var b = hdBand(r.m);
    if (b) (bandRows[b] = bandRows[b] || []).push(r);
  });
  Object.keys(bandRows).forEach(function(b){ push(b, bandRows[b]); });
  var babaRows = {};
  races.forEach(function(r){
    var bb = String(r.baba || '').trim();
    if (!bb) return;
    var key = (typeof bbNormBaba === 'function' ? bbNormBaba(bb) : bb) || 'その他';   // 「稍」「不」も正式名に揃える
    (babaRows[key] = babaRows[key] || []).push(r);
  });
  ['良', '稍重', '重', '不良', 'その他'].forEach(function(b){ if (babaRows[b] && babaRows[b].length) push(b, babaRows[b]); });
  var venueRows = {};
  races.forEach(function(r){ if (r.venueName) (venueRows[r.venueName] = venueRows[r.venueName] || []).push(r); });
  Object.keys(venueRows).sort(function(a, b){ return venueRows[b].length - venueRows[a].length; }).slice(0, 4).forEach(function(v){ push(v + '開催', venueRows[v]); });
  // グループ表示順: 全体→面→距離→馬場→場
  var order = ['全体', '芝', 'ダ', '障'];
  groups.sort(function(a, b){
    var ia = order.indexOf(a.label), ib = order.indexOf(b.label);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.label < b.label ? -1 : 1;
  });
  return groups;
}

/* ---------- 取得 ---------- */
function hdCacheKey(id){ return String(id).trim(); }
function hdLoadHorse(id, force){
  var ls = hdLs();
  var key = hdCacheKey(id);
  var cur = ls[key];
  var fresh = cur && cur.p && cur.r && (!force) && (Date.now() - (cur.at || 0)) < HD_FRESH_MS;
  if (fresh) return Promise.resolve(cur);
  return hdGet('https://db.netkeiba.com/horse/' + id + '/').then(function(html){
    if (!html || html.length < 500) throw new Error('プロフィールを取得できません(' + id + ')');
    var prof = hdParseProfile(html);
    return hdGet('https://db.netkeiba.com/horse/result/' + id + '/').then(function(html2){
      var races = hdParseRecords(html2);
      var rec = { id: id, p: prof, r: races, at: Date.now() };
      ls[key] = rec;
      hdSave(ls);
      return rec;
    });
  });
}
function hdRaceHorses(){
  var out = [];
  (state && state.horses || []).forEach(function(h, i){
    if (!h) return;
    out.push({ i: i, no: h.no || '', name: h.name || '', nk: h.nk || '', sexAge: h.sexAge || '' });
  });
  return out;
}
function hdMsgSet(msg, isErr){
  var el = $('hdMsg'); if (!el) return;
  el.innerHTML = (isErr ? '⚠ ' : '') + esc(msg);
  el.style.color = isErr ? '#b3261e' : '';
}
function hdBusy(b){
  var a = $('hdBtn'), c = $('hdReload');
  if (a) a.disabled = b;
  if (c) c.disabled = b;
}
/* ★2026-09-13 第20弾: 自動マクロ(p59)から連鎖で呼べるように Promise を返すようにしました。
   （ボタンから呼んだときの挙動は変わりません） */
function hdLoadAll(force){
  var horses = hdRaceHorses().filter(function(h){ return h.nk; });
  var el = $('hdOut');
  if (!horses.length){
    hdMsgSet('この出馬表にはnetkeibaの馬IDが付いていません。「netkeiba URLから直接取込」で出馬表を読み込んでから実行してください（スクショOCR・手入力の馬はIDが無く対象外です）。', true);
    return Promise.resolve({ ok:0, total:0, skip:true });
  }
  hdBusy(true);
  hdMsgSet('0 / ' + horses.length + ' 頭を取得中…（netkeiba馬ページ。初回は1頭あたり約1〜2秒）');
  var done = 0;
  var seq = Promise.resolve();
  var errors = [];
  horses.forEach(function(h){
    seq = seq.then(function(){
      return hdLoadHorse(h.nk, force).then(function(rec){
        done++;
        hdMsgSet(done + ' / ' + horses.length + ' 頭 取得しました（' + h.name + ' など）…');
      }).catch(function(e){
        errors.push(h.name || h.nk);
        done++;
      });
    });
  });
  return seq.then(function(){
    hdBusy(false);
    if (errors.length) hdMsgSet('✅ 完了（' + (done - errors.length) + '/' + horses.length + '頭取得）。取得できなかった馬: ' + errors.join('・'), false);
    else hdMsgSet('✅ ' + done + '頭すべて取得しました。下に表示します。', false);
    hdRender();
    return { ok: done - errors.length, total: horses.length, errors: errors };
  });
}
function hdRender(){
  var box = $('hdOut'); if (!box) return;
  var horses = hdRaceHorses();
  var ls = hdLs();
  var html = [];
  var got = 0;
  horses.forEach(function(h){
    var key = hdCacheKey(h.nk);
    var rec = h.nk && ls[key];
    if (!rec){ return; }
    got++;
    var prof = rec.p || {};
    var races = rec.r || [];
    var birth = hdP(prof, ['生年月日']);
    var trainer = hdP(prof, ['調教師']);
    var owner = hdP(prof, ['馬主']);
    var breeder = hdP(prof, ['生産者']);
    var origin = hdP(prof, ['産地']);
    var earnC = hdP(prof, ['獲得賞金(中央)']) || hdP(prof, ['獲得賞金 (中央)']) || hdP(prof, ['獲得賞金中央']);
    var earnL = hdP(prof, ['獲得賞金(地方)']) || hdP(prof, ['獲得賞金 (地方)']) || hdP(prof, ['獲得賞金地方']);
    var recordTxt = hdP(prof, ['通算成績']);
    var winsTxt = hdP(prof, ['主な勝鞍']);
    var groups = hdAn(races);
    var hh = [];
    // 縦に伸びないよう、馬ごとに折り込みカード（details）で表示する（#2026-09-10）
    hh.push('<details class="card fold hdhorse" style="margin:0 0 8px">');
    hh.push('<summary class="foldhead">' +
      '<span class="fmark"></span>' +
      '<b style="font-size:1rem">' + esc(String(h.no)) + '番 ' + esc(h.name) + '</b>' +
      (h.sexAge ? '<span class="small" style="font-weight:400">' + esc(h.sexAge) + '</span>' : '') +
      (recordTxt ? '<span class="chip" style="background:var(--card2);color:var(--info-ink)">' + esc(recordTxt) + '</span>' : '') +
      (trainer ? '<span class="small muted" style="font-weight:400">' + esc(trainer) + '</span>' : '') +
      '<span class="foldhint"></span>' +
      '</summary>');
    hh.push('<div class="foldbody">');
    var profParts = [];
    if (birth) profParts.push('生年月日 ' + esc(birth));
    if (owner) profParts.push('馬主 ' + esc(owner));
    if (breeder) profParts.push('生産者 ' + esc(breeder));
    if (origin) profParts.push('産地 ' + esc(origin));
    if (earnC) profParts.push('獲得賞金(中央) ' + esc(earnC));
    if (winsTxt) profParts.push('主な勝鞍 ' + esc(String(winsTxt).slice(0, 60)));
    if (profParts.length) hh.push('<div class="small muted" style="margin:2px 0 6px">' + profParts.join(' ／ ') + '</div>');
    // 直近5走
    var recent = races.slice(-5).reverse();
    if (recent.length){
      hh.push('<div class="small" style="margin-bottom:4px"><b>直近5走:</b> ' + recent.map(function(r){
        var o = r.order ? (r.order + '着') : (r.status || '−');
        var dn = String(r.date || '').slice(5, 10).replace('/', '/');
        return esc((dn || '') + ' ' + (r.venueName || r.venue || '') + ' ' + String(r.name || '').slice(0, 14) + '(' + o + ')');
      }).join(' → ') + '</div>');
    }
    // 分析テーブル
    var tbl = ['<div class="tblwrap"><table class="lr-tbl" style="min-width:520px"><thead><tr>' +
      '<th style="text-align:left">区分</th><th>出走</th><th>1着</th><th>2着</th><th>3着</th>' +
      '<th>1着率</th><th>複勝率</th><th>単回収率</th><th>平均人気</th></tr></thead><tbody>'];
    groups.forEach(function(g){
      var ag = g.ag;
      var avgPop = ag.popN ? (ag.sumPop / ag.popN).toFixed(1) : '−';
      tbl.push('<tr><td style="text-align:left">' + esc(g.label) + '</td><td>' + ag.n + '</td><td>' + ag.w + '</td><td>' + ag.t2 + '</td><td>' + ag.top3 + '</td>' +
        '<td>' + hdPct(ag.w, ag.n) + '%</td><td>' + hdPct(ag.top3, ag.n) + '%</td>' +
        '<td>' + (ag.sumOddsW ? hdRoiS(ag).toFixed(0) + '%' : '−') + '</td><td>' + avgPop + '</td></tr>');
    });
    tbl.push('</tbody></table></div>');
    // 戦績詳細
    var det = [];
    if (races.length){
      var rowsTxt = races.slice(0).reverse().map(function(r){
        var orderTxt = r.order ? ('<b>' + r.order + '</b>着') : (r.status ? esc(r.status) : '−');
        var oddsTxt = (r.odds !== '' && r.odds !== '0') ? r.odds : '−';
        var passTxt = (r.pass === '0' || !r.pass) ? '' : r.pass;
        return '<tr><td>' + esc(r.date) + '</td><td>' + esc((r.venueName || '') + ' ' + r.r + 'R') + '</td>' +
          '<td style="text-align:left">' + esc(r.name) + '</td>' +
          '<td>' + esc(r.dist) + '</td><td>' + esc(r.baba) + '</td><td>' + orderTxt + '</td>' +
          '<td>' + esc(r.head || '') + '</td><td>' + esc(oddsTxt) + '</td><td>' + esc(r.pop || '') + '</td>' +
          '<td>' + esc(r.jockey) + '</td><td>' + esc(r.weight || '') + '</td>' +
          '<td>' + esc(r.time || '') + '</td><td>' + esc(r.margin || '') + '</td>' +
          '<td>' + esc(passTxt) + '</td><td>' + esc(r.last3 || '') + '</td><td>' + esc(r.wchg || '') + '</td></tr>';
      }).join('');
      det.push('<details style="margin-top:6px"><summary class="small" style="cursor:pointer"><b>戦績詳細（全' + races.length + '戦）を表で見る</b></summary>' +
        '<div class="tblwrap" style="max-height:240px;overflow:auto;margin-top:6px"><table class="lr-tbl" style="min-width:900px"><thead><tr>' +
        '<th>日付</th><th>開催</th><th style="text-align:left">レース名</th><th>距離</th><th>馬場</th><th>着順</th><th>頭数</th><th>単勝</th><th>人気</th>' +
        '<th>騎手</th><th>斤量</th><th>タイム</th><th>着差</th><th>通過</th><th>上り</th><th>馬体重</th></tr></thead><tbody>' +
        rowsTxt + '</tbody></table></div></details>');
    } else {
      det.push('<div class="small muted" style="margin-top:4px">戦績を取得できませんでした（新馬・地方転入直後など）。</div>');
    }
    hh.push(tbl.join(''));
    hh.push(det.join(''));
    hh.push('</div>');   // .foldbody
    hh.push('</details>');
    html.push(hh.join(''));
  });
  if (got >= 2){
    html.unshift('<div class="small muted" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">' +
      '<span>' + got + '頭ぶんを折りたたんで表示しています（馬名をクリックで開きます）。</span>' +
      '<button type="button" class="btn ghost" id="hdOpenAll" style="font-size:.78rem;padding:3px 10px">全馬を開く</button>' +
      '<button type="button" class="btn ghost" id="hdCloseAll" style="font-size:.78rem;padding:3px 10px">全馬を折りたたむ</button>' +
      '</div>');
  }
  var noHorses = horses.filter(function(h){ return !h.nk; });
  var withNk = horses.filter(function(h){ return h.nk; }).length;
  if (withNk && got < withNk){
    html.push('<div class="small muted" style="margin-top:6px">※ 未取得の馬が ' + (withNk - got) + ' 頭あります（上の「📥 全馬データを取得・表示」を押すと取得されます）。</div>');
  }
  if (noHorses.length){
    html.push('<div class="small muted" style="margin-top:6px">※ ID未付与の馬 ' + noHorses.length + '頭は対象外です（netkeiba URL取込で読み込むと全頭対象になります）。</div>');
  }
  if (!html.length){
    if (!state || !state.horses || !state.horses.length){
      box.innerHTML = '<div class="small muted">まだ出馬表がありません。上の「📅 日付を選んで出馬表を取込」か、このタブの「netkeiba URLから直接取込」でレースを読み込むと、ここに全馬のプロフィール・戦績・成績分析の表を出せます。</div>';
    } else {
      box.innerHTML = '<div class="small muted">まだ取得済みの馬がありません。上の「📥 出馬表の全馬データを取得・表示」を押してください。</div>';
    }
    return;
  }
  box.innerHTML = html.join('');
}
function hdRefreshHint(){
  var el = $('hdHint'); if (!el) return;
  if (!state || !state.horses || !state.horses.length){ el.innerHTML = ''; return; }
  var nk = state.horses.filter(function(h){ return h && h.nk; }).length;
  el.innerHTML = nk ? (nk + ' / ' + state.horses.length + '頭にnetkeiba馬IDあり → ボタンで取得できます') : 'netkeiba URL取込で読むと全頭のIDが付きます';
}
function initHd(){
  on('hdBtn', 'click', function(){ hdLoadAll(false); });
  // 折り込みの一括操作（馬ごとのカードを all open / all close）
  document.addEventListener('click', function(e){
    var id = e.target && e.target.id;
    if (id !== 'hdOpenAll' && id !== 'hdCloseAll') return;
    e.preventDefault();
    var box = $('hdOut'); if (!box) return;
    var open = (id === 'hdOpenAll');
    var list = box.querySelectorAll ? box.querySelectorAll('details.hdhorse') : [];
    for (var i = 0; i < list.length; i++){
      if (open) list[i].open = true;
      else list[i].open = false;
    }
  });
  on('hdReload', 'click', function(){
    var horses = hdRaceHorses().filter(function(h){ return h.nk; });
    var ls = hdLs();
    horses.forEach(function(h){ delete ls[hdCacheKey(h.nk)]; });
    hdSave(ls);
    hdLoadAll(true);
  });
  hdRefreshHint();
  hdRender();
}
