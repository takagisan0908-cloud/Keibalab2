/* =========================================================
   テキスト解析ユーティリティ（OCR・貼り付け共通）
   ========================================================= */

/* 全角→半角（OCRで全角になりがちな数字・記号を正規化） */
function zen2han(s){
  if (!s) return '';
  return String(s)
    .replace(/[！-～]/g, function(ch){ return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/　/g,' ')
    .replace(/[－―−]/g,'-')
    .replace(/～/g,'-')
    .replace(/、。/g,' ')
    .replace(/[×xX]/g,'x');
}

/* 行のトークン化：タブ or 2連続以上のスペース or 全角スペース区切りを優先 */
function tokenizeRow(line){
  var s = zen2han(line).trim();
  if (!s) return [];
  var arr;
  if (s.indexOf('\t') >= 0) arr = s.split(/\t+/);
  else if (/\s{2,}/.test(s)) arr = s.split(/\s{2,}/);
  else arr = s.split(/\s+/);
  return arr.map(function(t){ return t.trim(); }).filter(function(t){ return t !== ''; });
}

function isNumTok(t){ return /^-?\d{1,4}(?:\.\d{1,2})?$/.test(t); }
function isSexAge(t){ return /^[牡牝セ騸]\s*\d{1,2}$/.test(t.replace(/\s/g,'')); }

/* ---------- 出馬表 1行 ---------- */
function classifyCardLine(line){
  // 出馬表は桁揃えの空白を含むため、常に細かくトークン化してから再構成する
  var toks = zen2han(line).trim().split(/[\t\s]+/).filter(Boolean);
  if (toks.length < 3) return null;
  // 性齢(牡4等)を探す
  var sIdx = -1;
  for (var i=0;i<toks.length;i++){
    if (isSexAge(toks[i])) { sIdx = i; break; }
  }
  var res = { frame:'', no:'', name:'', sexAge:'', weight:'', jockey:'', line: line };
  var rest;
  if (sIdx >= 0){
    res.sexAge = toks[sIdx].replace(/\s/g,'');
    rest = toks.slice(sIdx+1);
    // 性齢の手前 = [枠? 馬番? 馬名...]。先頭連続の数値を枠・馬番とみなす
    var pre = toks.slice(0, sIdx);
    var lead = 0;
    while (lead < pre.length && isNumTok(pre[lead]) && parseInt(pre[lead],10) <= 120) lead++;
    if (lead >= 2){
      res.frame = cleanInt(pre[lead-2]);   // 直前2つを 枠・馬番 と仮定
      res.no = cleanInt(pre[lead-1]);
      res.name = pre.slice(lead).join(' ');
    } else if (lead === 1){
      res.no = cleanInt(pre[lead-1]);
      res.name = pre.slice(lead).join(' ');
    } else {
      res.name = pre.join(' ');           // 数値なし=名前のみ(スペース名の可能性)
    }
  } else {
    rest = toks;
  }
  // 斤量：性齢の直後で 45〜62 の数値 ／ 騎手：その次の非数値トークン
  if (rest.length){
    var wIdx = -1, k;
    for (k=0; k<rest.length && k<5; k++){
      if (isNumTok(rest[k]) && parseFloat(rest[k]) >= 45 && parseFloat(rest[k]) <= 62){ wIdx = k; break; }
    }
    if (wIdx >= 0){
      res.weight = String(parseFloat(rest[wIdx])).replace(/\.0$/,'');
      for (k=wIdx+1;k<rest.length;k++){
        if (!isNumTok(rest[k])) { res.jockey = rest[k]; break; }
      }
    } else {
      for (k=0;k<rest.length;k++){
        if (!isNumTok(rest[k])) { res.jockey = rest[k]; break; }
      }
    }
  }
  return res;
}
function parseRaceCardText(text){
  var rows = [], rejects = [];
  String(text).split(/\r?\n/).forEach(function(line){
    if (!line.trim()) return;
    var r = classifyCardLine(line);
    if (r && (r.name || r.no)){
      rows.push(r);
    } else {
      rejects.push(line);
    }
  });
  return { rows: rows, rejects: rejects };
}

/* ---------- 単勝オッズ ---------- */
function parseOddsText(text){
  var out = [], rejects = [];
  String(text).split(/\r?\n/).forEach(function(line){
    if (!line.trim()) return;
    var s = zen2han(line);
    var m = s.match(/^\s*(\d{1,2})\s+(?:枠?)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*$/);
    if (!m) m = s.match(/(?:^|\s)(\d{1,2})\s+(\d{1,3}(?:\.\d{1,2})?)\s*(?:人気)?\s*$/);
    if (m){
      var no = parseInt(m[1],10), od = parseFloat(m[2]);
      if (no >= 1 && no <= 18 && od >= 1.0) out.push({ no: no, odds: od, line: line });
      else rejects.push(line);
    } else {
      // 行の中に「馬番 オッズ」のペアだけを拾う(緩め)
      var pairs = s.match(/\b(\d{1,2})\s+(\d{1,3}(?:\.\d{1,2})?)\b/g);
      var found = false;
      if (pairs) pairs.forEach(function(p){
        var mm = p.match(/(\d{1,2})\s+(\d{1,3}(?:\.\d{1,2})?)/);
        var nn = parseInt(mm[1],10), oo = parseFloat(mm[2]);
        if (nn>=1 && nn<=18 && oo>=1.5){ out.push({no:nn, odds:oo, line:line}); found = true; }
      });
      if (!found) rejects.push(line);
    }
  });
  return { odds: out, rejects: rejects };
}

/* ---------- 調教タイム：区間ラップ ----------
   例1: "6F 83.5-5F 69.1-4F 54.2-3F 38.9"
   例2: "83.5-69.1-38.9"（先頭=6F等の前提）
   戻り: { per: 1Fあたり秒, laps:[[furlong,秒]], fmax, raw } */
function _psec(txt){
  // "83.2"/"83.20"/"69:1"? lapは小数中心。コロンは持込まない前提
  var m = String(txt).match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!m) return parseFloat(txt);
  var dec = m[2] ? parseInt(m[2],10) / (m[2].length >= 2 ? 100 : 10) : 0;
  return parseInt(m[1],10) + dec;
}
function _guessFurlongs(nums){
  // nums: 長い距離→短い距離の順の時計列(降順)。末尾が最短(1〜3F)とみなす
  var L = nums.length;
  var last = nums[L-1];
  var tail = last < 24 ? 1 : (last < 33 ? 2 : 3);   // 最後の値から最短距離を推定
  var out = [];
  for (var i=0;i<L;i++) out.push([tail + (L-1-i), nums[i]]);
  return out;
}
function _bestLapRun(toks){
  // toks: [{v,idx}] から、単調減少かつ差が妥当な連続列を最長探索
  var best = null, bestLen = 0;
  for (var i=0;i<toks.length;i++){
    var cur = [toks[i]];
    for (var j=i+1;j<toks.length;j++){
      var prev = cur[cur.length-1].v, next = toks[j].v;
      if (prev - next >= 0.8 && prev - next <= 35) cur.push(toks[j]);
      else break;
    }
    if (cur.length > bestLen){ bestLen = cur.length; best = cur; }
  }
  return (best && bestLen >= 3) ? best : null;
}

/* 調教ラップ文字列を評価。対応例:
   "6F 83.5-5F 69.1-3F 38.9" / "83.5-69.1-38.9" / "83.5 69.1 38.9" / 全角・余計な文字混じり */
function evaluateLapStr(str){
  var s = zen2han(str||'').trim();
  var out = { per:null, laps: [], raw:s, guess:false, cut:-1 };
  if (!s) return out;
  var seq = [], firstStart = -1, kind = '';
  // 1) F付き（もっとも確実）
  var reF = /(\d{1,2})\s*F\s*(\d{1,3}(?:[.:]\d{1,2})?)/gi, m, fs=-1;
  while ((m = reF.exec(s))){
    if (fs < 0) fs = m.index;
    var fu = parseInt(m[1],10), sec = _psec(String(m[2]).replace(':','.'));
    if (fu >= 1 && fu <= 9 && sec > 5) seq.push([fu, sec]);
  }
  if (seq.length >= 2 && fs >= 0){ kind='F'; firstStart = fs; }
  // 2) 「- / ~ ／ →」区切りの数字チェーン
  if (!seq.length){
    var reC = /(\d{1,3}(?:\.\d{1,2})?)\s*[-~〜→／/]\s*(\d{1,3}(?:\.\d{1,2})?)(?:\s*[-~〜→／/]\s*(\d{1,3}(?:\.\d{1,2})?))+/g, mm;
    while ((mm = reC.exec(s))){
      var ns = [];
      var rm = /(\d{1,3}(?:\.\d{1,2})?)/g, m2;
      while ((m2 = rm.exec(mm[0]))) ns.push(_psec(m2[1]));
      if (ns.length >= 3){ seq = _guessFurlongs(ns); kind='chain'; firstStart = mm.index; break; }
    }
  }
  // 3) スペース区切りだけ（OCRでFやハイフンが消えた場合）
  if (!seq.length){
    var toks = [];
    var reN = /(\d{1,4}(?:\.\d{1,2})?)/g, m3;
    while ((m3 = reN.exec(s))){
      var v = parseFloat(m3[0]);
      if (v >= 8 && v <= 220 && !/^\d{1,2}:\d/.test(m3[0])) toks.push({ v: v, idx: m3.index });
    }
    var run = _bestLapRun(toks);
    if (run){ seq = _guessFurlongs(run.map(function(t){ return t.v; })); kind='spaced'; firstStart = run[0].idx; }
  }
  if (!seq.length) return out;
  seq.sort(function(a,b){ return b[0]-a[0]; });
  out.laps = seq;
  out.per = Math.round((seq[0][1] / seq[0][0]) * 10) / 10;
  out.guess = kind !== 'F';
  out.cut = firstStart;
  return out;
}

/* 持ちタイム文字列 "2:00.5" や "1:59.9" → 秒 */
function decVal(ds){ return parseInt(ds,10) / (String(ds).length >= 2 ? 100 : 10); }
function evaluateTimeStr(str){
  var s = zen2han(str||'').trim();
  if (!s) return null;
  var m = s.match(/(\d{1,2}):(\d{1,2})[.:](\d{1,2})/);
  if (m) return parseInt(m[1],10)*60 + parseInt(m[2],10) + decVal(m[3]);
  m = s.match(/(\d{1,2}):(\d{1,2})/);
  if (m && parseInt(m[2],10) < 60) return parseInt(m[1],10)*60 + parseInt(m[2],10);
  // 秒のみ "124.2"（1桁小数は10分の1秒）
  m = s.match(/^(\d{2,3})\.(\d{1,2})$/);
  if (m){
    var v = parseInt(m[1],10) + decVal(m[2]);
    if (v > 60) return v;
  }
  return null;
}

/* 時計候補(m:m 形式 or 秒)を先頭順で列挙 */
function _timeCandidates(s){
  var out = [];
  var reT = /(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?/g, m;
  while ((m = reT.exec(s))){
    var sec = parseInt(m[1],10)*60 + parseInt(m[2],10) + (m[3] ? decVal(m[3]) : 0);
    out.push({ idx: m.index, sec: sec, colon: true });
  }
  var reS = /(?:^|\D)(\d{2,3})\.(\d{1,2})(?:\D|$)/g, mm;
  while ((mm = reS.exec(s))){
    var sv = parseInt(mm[1],10) + decVal(mm[2]);
    out.push({ idx: mm.index, sec: sv, colon: false });
  }
  out.sort(function(a,b){ return a.idx - b.idx; });
  return out;
}

function _namePrefix(s, cut){
  if (cut == null || cut < 0) return '';
  var head = s.slice(0, cut);
  var toks = head.replace(/[|｜]/g,' ').split(/\s+/).filter(Boolean);
  // 純粋な数字(馬番等)や記号だけのトークンを除外
  toks = toks.filter(function(t){
    return !/^\d{1,4}(?:\.\d{1,2})?$/.test(t) && !/^[^\u3040-\u9fff\u30a0-\u30ffa-zA-Z]+$/.test(t);
  });
  return toks.join(' ');
}

function parseNamedTimeText(text){
  var items = [];
  String(text).split(/\r?\n/).forEach(function(line){
    if (!line.trim()) return;
    var s = zen2han(line).trim();
    var ev = evaluateLapStr(s);
    if (ev.laps.length){
      items.push({ ok:true, kind:'lap', name:_namePrefix(s, ev.cut), line:line, ev:ev, timeSec:null });
      return;
    }
    var cands = _timeCandidates(s).filter(function(c){ return c.sec >= 40 && c.sec <= 420; });
    if (!cands.length){ items.push({ok:false, line:line}); return; }
    // コロン時刻(1:59.9等)がある行は秒表記(斤量57.0等の誤検知)より優先
    var colons = cands.filter(function(c){ return c.colon; });
    var c0 = (colons.length ? colons : cands)[0];
    items.push({ ok:true, kind:'time', name:_namePrefix(s, c0.idx), line:line, ev:null, timeSec:c0.sec, timeStrGuess: '' });
  });
  return items;
}

/* ---------- レーベンシュタイン(名前突合) ---------- */
function lev(a,b){
  a = String(a||''); b = String(b||'');
  if (a === b) return 0;
  var m=a.length, n=b.length;
  if(!m) return n; if(!n) return m;
  var d=[]; for(var i=0;i<=m;i++) d[i]=[i];
  for(var j=0;j<=n;j++) d[0][j]=j;
  for(i=1;i<=m;i++) for(j=1;j<=n;j++){
    var c = a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
  }
  return d[m][n];
}
function suggestNameIdx(ocr, names){
  if (!ocr) return -1;
  var best=-1, bd=999;
  for (var i=0;i<names.length;i++){
    var nm = names[i];
    if (!nm) continue;
    var d = lev(ocr, nm);
    var len = Math.min(ocr.length, nm.length);
    var ok = (ocr===nm) || (d===0) ||
      (len >= 3 && (nm.indexOf(ocr)>=0 || ocr.indexOf(nm)>=0) && d<=1) ||
      (d <= Math.max(1, Math.floor(len/3)));
    if (ok && d < bd){ bd=d; best=i; }
  }
  return best;
}

/* ---------- 汎用テキスト読込入口(貼り付け用) ---------- */
function applyTextByType(type, text){
  if (type === 'card')    return parseRaceCardText(text);
  if (type === 'odds')    return parseOddsText(text);
  if (type === 'yobi')    return parseNamedTimeText(text);
  if (type === 'time')    return parseNamedTimeText(text);
  return null;
}
