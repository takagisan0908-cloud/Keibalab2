/* =========================================================
   25 馬ノート・データベース（各馬の専用ページを永続保存）
   ---------------------------------------------------------
   - レース後「短評ページ」を貼り付けると、馬名を手がかりに対象馬を
     自動判定し、その馬に「短評」として登録できる。
   - 「有利不利」メモ・自由メモも馬ごとに登録でき、ずっと保存。
   - 保存した馬が、のちのレース（次走・以降）の出馬表に現れると、
     ②AI印・①入力表に「📒メモあり」マークを付け、クリックで閲覧できる。
   - 馬の同一性は netkeiba 競走馬ID(h.nk) を最優先に、なければ馬名で判定。
   ========================================================= */
var HB_LS = 'khl_horsebook_v1';

function hbLoad(){
  try {
    var o = JSON.parse(localStorage.getItem(HB_LS) || 'null');
    if (o && Array.isArray(o.horses)) return o;
  } catch(e){}
  return { horses: [] };
}
function hbCommit(db){
  try {
    if ((db.horses || []).length > 600) db.horses = db.horses.slice(db.horses.length - 600);
    safeSetItem(HB_LS, JSON.stringify(db));
  } catch(e){
    try {
      var el = $('hbInfo');
      if (el) el.textContent = '⚠ 保存容量を超えたため馬ノートを保存できませんでした（古いメモを削除してください）';
    } catch(e2){}
  }
}
function hbLog(msg, tone){
  var el = $('hbInfo'); if (!el) return;
  el.innerHTML = msg;
  el.style.color = (tone === 'err') ? '#c33' : '';
}

/* ---------- 馬名の正規化（照合用） ---------- */
function hbNorm(n){
  var s = String(n == null ? '' : n);
  // 括弧の中身は除去(例: 「馬名(キズナ)」→「馬名」)
  s = s.replace(/[（(][^()（）]*[)）]/g, '');
  // 全角の記号類(CJK記号・全角英数記号)とASCII記号を除去
  s = s.replace(/[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/g, '')
       .replace(/[\s.,、,：:;<>"'“”‘’・･\-‐‑—―–\/／]/g, '');
  return s.toUpperCase();
}

/* ---------- テキスト化(タグ除去・実体参照の最小復元) ---------- */
function hbText(h){
  var s = String(h == null ? '' : h);
  try { if (typeof nkDecode === 'function') s = nkDecode(s); } catch(e){}
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0*39;/g,"'")
       .replace(/&#x([0-9a-fA-F]+);/g, function(a, h){ try { return String.fromCodePoint(parseInt(h,16)); } catch(e){ return ''; } })
       .replace(/&#(\d+);/g, function(a, d){ try { return String.fromCodePoint(parseInt(d,10)); } catch(e){ return ''; } });
  return s.replace(/[ \t\u3000]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/* netkeibaニュース取得(既存の中継機構を再利用) */
function hbFetchHtml(url){
  if (typeof histFetchHtml === 'function') return histFetchHtml(url);
  if (typeof stFetchHtml === 'function') return stFetchHtml(url);
  return Promise.reject(new Error('netkeiba取得の中継が使えません。「URL取込」の通信設定をご確認ください'));
}
/* ---------- DB検索：レースの馬(h) → 登録エントリ ---------- */
function hbFindEntryFor(h, db){
  var nk = (h && h.nk) ? String(h.nk) : '';
  var nm = hbNorm(h && h.name);
  var byNk = null, byName = null;
  (db.horses || []).forEach(function(e){
    if (nk && e.nk && String(e.nk) === nk && !byNk) byNk = e;
    if (nm && !byName){
      var m = (e.names || []).some(function(x){ return hbNorm(x) === nm; });
      if (m) byName = e;
    }
  });
  return byNk || byName || null;
}
function hbFind(h){ return hbFindEntryFor(h, hbLoad()); }

function hbEntry(h, db){
  if (!db) db = hbLoad();
  var e = hbFindEntryFor(h, db);
  if (!e){
    e = {
      id: 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      nk: (h && h.nk) || '', names: [], notes: [], memo: '',
      updatedAt: new Date().toISOString()
    };
    db.horses.push(e);
  }
  var addNk = (h && h.nk) ? String(h.nk) : '';
  if (addNk && String(e.nk || '') !== addNk){
    // 後から競走馬IDが判明したら補強（同一馬としてIDを記憶）
    e.nk = addNk;
  }
  var addNm = (h && h.name) ? String(h.name).trim() : '';
  if (addNm){
    var has = (e.names || []).some(function(x){ return hbNorm(x) === hbNorm(addNm); });
    if (!has) e.names.push(addNm);
  }
  e.updatedAt = new Date().toISOString();
  return e;
}

/* ---------- ノート種別メタ ---------- */
function hbKindMeta(k){
  return {
    short: ['📝 短評',   '#0e5e39', '#e7f3ea'],
    adv:   ['⚖️ 有利不利', '#a05a13', '#fdf1e3'],
    memo:  ['📌 メモ',   '#245c8a', '#eaf1fa']
  }[k] || ['📌 メモ', '#555', '#f0f0f0'];
}

/* レース文脈（現在のレース情報を利用） */
function hbRaceCtx(){
  var rm = {};
  try { if (typeof readRaceMeta === 'function') rm = readRaceMeta() || {}; } catch(e){}
  var rs = {};
  try { rs = (typeof state !== 'undefined' && state) ? (state.race || {}) : {}; } catch(e){}
  var name  = rm.name  || rs.name  || '';
  var place = rm.place || rs.place || '';
  var dist  = rm.dist  || rs.dist  || '';
  var grade = rm.grade || rs.grade || '';
  return {
    date: todayStr(), name: name, place: place, dist: dist, grade: grade,
    label: [name, place, (dist ? dist + 'm' : ''), grade].filter(Boolean).join(' ')
  };
}

/* ---------- 登録系 ---------- */
function hbNewNote(h, kind, text, ctx){
  var t = String(text == null ? '' : text).trim();
  if (!t) return null;
  if (kind !== 'short' && kind !== 'adv' && kind !== 'memo') kind = 'short';
  var db = hbLoad();
  var e = hbEntry(h, db);
  var now = new Date();
  e.notes.push({
    id: 'n' + now.getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    kind: kind, text: t,
    date: (ctx && ctx.date) || todayStr(),
    race: (ctx && ctx.label) || '',
    ts: now.toISOString()
  });
  e.updatedAt = now.toISOString();
  hbCommit(db);
  return e;
}
function hbDelNote(eid, nid){
  var db = hbLoad();
  var e = null;
  db.horses.forEach(function(x){ if (x.id === eid) e = x; });
  if (!e) return false;
  e.notes = (e.notes || []).filter(function(n){ return n.id !== nid; });
  e.updatedAt = new Date().toISOString();
  hbCommit(db);
  return true;
}
function hbSetMemo(eid, text){
  var db = hbLoad();
  var e = null;
  db.horses.forEach(function(x){ if (x.id === eid) e = x; });
  if (!e) return;
  e.memo = String(text == null ? '' : text);
  e.updatedAt = new Date().toISOString();
  hbCommit(db);
}
function hbDelEntry(eid){
  var db = hbLoad();
  db.horses = (db.horses || []).filter(function(x){ return x.id !== eid; });
  hbCommit(db);
}
function hbEntryById(eid){
  var e = null;
  hbLoad().horses.forEach(function(x){ if (x.id === eid) e = x; });
  return e;
}

/* ---------- マーカー ---------- */
function hbBadgeHTML(h){
  if (typeof hbFind !== 'function') return '';
  var e = hbFind(h);
  if (!e) return '';
  var n = (e.notes || []).length;
  var m = e.memo ? 1 : 0;
  var tot = n + m;
  if (!tot) return '';
  return '<button type="button" class="hbchip" data-hb="' + esc(e.id) + '" title="' +
    esc(((e.names && e.names[0]) || '') + ' の馬ノート（短評・有利不利 ' + n + '件）を表示') + '">📒 ' + tot + '</button>';
}

/* ---------- 短評ページ貼り付けの解析 ---------- */
function hbCandidateList(){
  var list = [], seen = {};
  function push(name, src, uid, eid){
    var k = hbNorm(name);
    if (!k || seen[k]) return;
    seen[k] = 1;
    list.push({ name: name, src: src, uid: uid, eid: eid });
  }
  var hs = [];
  try { hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : []; } catch(e){}
  hs.forEach(function(h){
    if (h && h.name) push(h.name, 'cur', h.uid, null);
  });
  hbLoad().horses.forEach(function(e){
    (e.names || []).forEach(function(nm){ push(nm, 'db', null, e.id); });
  });
  // 長い馬名を先に照合（部分一致の誤爆を防ぐ）
  list.sort(function(a, b){ return hbNorm(b.name).length - hbNorm(a.name).length; });
  return list;
}
function hbPickByNameLine(line, cands){
  var nl = hbNorm(line);
  var best = null;
  for (var i = 0; i < cands.length; i++){
    var ck = hbNorm(cands[i].name);
    if (!ck) continue;
    if (nl.indexOf(ck) >= 0){ best = cands[i]; break; }
  }
  return best;
}
function hbParsePaste(text){
  var cands = hbCandidateList();
  var out = [];
  // 行または文単位に分解して馬名を探す
  var chunks = [];
  String(text).split(/\r?\n/).forEach(function(line){
    var l = String(line).trim();
    if (!l) return;
    if (l.length > 70 && hbPickByNameLine(l, cands) == null){
      // 改行なしで複数の短評がつながっている場合は「。」で再分割して試す
      var sentences = l.split(/。/);
      if (sentences.length > 1){
        sentences.forEach(function(s){
          var ss = String(s).trim();
          if (ss) chunks.push(ss + '。');
        });
        return;
      }
    }
    chunks.push(l);
  });
  chunks.forEach(function(c){
    if (c.length < 3) return;
    // 見出し・余計な行はスキップ（対象馬が見つからなければ保留扱いにせず空マッチにする）
    if (/^(第|レース結果|着順|払戻|単勝|複勝|枠連|馬連|ワイド|馬単|三連|3連|回顧|予想|結果|オッズ|人気|開催|天候|馬場|コース)/.test(c) && c.length < 30 && hbPickByNameLine(c, cands) == null) return;
    out.push({ text: c, hit: hbPickByNameLine(c, cands), chosen: hbPickByNameLine(c, cands) });
  });
  return out;
}
/* 貼り付けで選べる候補の<option>（選択肢） */
function hbSelectOptions(curName){
  var curN = hbNorm(curName);
  var html = '<option value="">（対象外 / 選ばない）</option>';
  var cur = [], db = [];
  var _hs0 = (typeof state !== 'undefined' && state && state.horses) ? state.horses : [];
  _hs0.forEach(function(h){
    if (h && h.name) cur.push(h);
  });
  function opt(name, value, isSel){
    var sel = isSel ? ' selected' : '';
    html += '<option value="' + esc(value) + '"' + sel + '>' + esc(name) + '</option>';
  }
  if (cur.length){
    html += '<optgroup label="今回の出走馬">';
    cur.forEach(function(h){
      var vk = (h.uid != null) ? 'u' + h.uid : ('n' + hbNorm(h.name));
      opt((h.no ? h.no + ' ' : '') + h.name, vk, curN && hbNorm(h.name) === curN);
    });
    html += '</optgroup>';
  }
  var seenN = {};
  cur.forEach(function(h){ seenN[hbNorm(h.name)] = 1; });
  hbLoad().horses.forEach(function(e){
    (e.names || []).forEach(function(nm){
      if (!seenN[hbNorm(nm)]){ seenN[hbNorm(nm)] = 1; db.push(nm); }
    });
  });
  if (db.length){
    html += '<optgroup label="過去に登録した馬（今回の出走外）">';
    db.forEach(function(nm){ opt(nm, 'e' + hbFindByName(nm)); });
    html += '</optgroup>';
  }
  /* ★第22弾: 記事からレース名を自動検出して参照した「今回の出走外」の馬。
     出馬表キャッシュ・学習DB・netkeiba から引けた馬と、
     どこにも居なくて記事の馬名＋競走馬IDだけで新規登録する馬がここに出ます。 */
  if (typeof arXrefList === 'function'){
    var xs = arXrefList() || [];
    if (xs.length){
      html += '<optgroup label="📰 記事から参照した馬（今回の出走外）">';
      xs.forEach(function(x, i){
        var where = (typeof arSrcLabel === 'function') ? arSrcLabel(x.src) : '';
        var race = x.raceLabel || (x.raceName ? x.raceName : '');
        var lbl = x.name + (x.no ? '（' + x.no + '番）' : '') +
                  (race ? ' ／ ' + race : '') + (where ? ' ・' + where : '');
        var isSel = !!(curN && hbNorm(x.name) === curN);
        if (isSel && !seenN[hbNorm(x.name)]) opt(lbl, 'x' + i, true);
        else opt(lbl, 'x' + i, false);
        seenN[hbNorm(x.name)] = 1;
      });
      html += '</optgroup>';
    }
  }
  return html;
}
function hbFindByName(nm){
  var e = null;
  hbLoad().horses.forEach(function(x){
    if (e) return;
    if ((x.names || []).some(function(n){ return hbNorm(n) === hbNorm(nm); })) e = x.id;
  });
  return e || '';
}
function hbHorseFromVal(val){
  if (!val) return null;
  var cur = [];
  try { cur = (typeof state !== 'undefined' && state && state.horses) ? state.horses : []; } catch(e){}
  if (val.charAt(0) === 'u'){
    var uid = parseInt(val.slice(1), 10);
    for (var i = 0; i < cur.length; i++){
      if (cur[i].uid === uid) return { h: cur[i], src: 'cur' };
    }
    // uidが無い（手組みデータ等）場合: 同名で探す
    return null;
  }
  if (val.charAt(0) === 'n'){
    var nm = val.slice(1);
    for (var j = 0; j < cur.length; j++){
      if (hbNorm(cur[j].name) === nm) return { h: cur[j], src: 'cur' };
    }
    return null;
  }
  if (val.charAt(0) === 'e'){
    var e = hbEntryById(val.slice(1));
    if (e) return { h: { nk: e.nk, name: (e.names && e.names[0]) || '' }, src: 'db', entry: e };
  }
  /* ★第22弾: 'x<n>' ＝ 記事から参照した「今回の出走外」の馬（p62_articleref.js）。
     出馬表キャッシュ・学習DB・netkeiba取得・記事からの新規 のいずれか。
     返す h は { name, nk } だけですが、hbNewNote() → hbEntry() が
     競走馬ID(nk)を鍵に馬ノートを作るので、次回以降も同一馬として扱えます。 */
  if (val.charAt(0) === 'x' && typeof arXrefGet === 'function'){
    var x = arXrefGet(val.slice(1));
    if (x) return { h: { nk: x.nk || '', name: x.name || '' }, src: x.src || 'ref', xref: x };
  }
  return null;
}

/* ---------- 表示（タブ④） ---------- */
/* 一覧の折り込み（ページが縦に伸びないよう、20頭ずつ表示＋枠内スクロール） */
var HB_STEP = 20;
var hbShownCount = HB_STEP;
function hbShownReset(){ hbShownCount = HB_STEP; }
function hbMoreRowHTML(total, shown, q){
  if (total <= shown){
    if (total > HB_STEP) return '<span class="small muted">全 ' + total + '頭を表示中（枠内スクロールで見られます）</span>';
    return total ? '<span class="small muted">' + total + '頭を表示中' : '';
  }
  return '<span class="small muted">' + total + '頭中 ' + shown + '頭を表示中（枠内スクロール）</span> ' +
    '<button type="button" class="btn" id="btnHbMore" data-hbmore="step">▼ さらに' + HB_STEP + '頭を表示（残り' + (total - shown) + '頭）</button> ' +
    '<button type="button" class="btn ghost" id="btnHbMoreAll" data-hbmore="all">全' + total + '頭を表示</button>';
}
function hbSummary(){
  var db = hbLoad();
  var nShort = 0, nAdv = 0, nMemo = 0, withNote = 0;
  db.horses.forEach(function(e){
    var sn = 0;
    (e.notes || []).forEach(function(x){ sn++; if (x.kind === 'short') nShort++; else if (x.kind === 'adv') nAdv++; else nMemo++; });
    if (sn || (e.memo || '').trim()) withNote++;
  });
  return '登録馬 ' + db.horses.length + '頭 ／ メモあり ' + withNote + '頭 ／ 短評 ' + nShort + '件 ／ 有利不利 ' + nAdv + '件 ／ その他メモ ' + nMemo + '件';
}

function hbNoteItemHTML(n){
  var km = hbKindMeta(n.kind);
  return '<div class="hbnote" style="border-color:' + km[1] + '">' +
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
    '<span class="hbk" style="background:' + km[2] + ';color:' + km[1] + ';border:1px solid ' + km[1] + '">' + km[0] + '</span>' +
    '<span class="small muted">' + esc(n.date || '') + '</span>' +
    (n.race ? '<span class="small muted">' + esc(n.race) + '</span>' : '') +
    '<span class="sp"></span>' +
    '<button type="button" class="hbmini" data-hbdelnote="' + esc(n.id) + '" data-hbe="' + esc(n.id) + '" title="このメモを削除">✕</button>' +
    '</div>' +
    '<div style="white-space:pre-wrap;margin-top:3px">' + esc(n.text) + '</div></div>';
}

function hbHorseCardHTML(e, open){
  var km0 = hbKindMeta('short');
  var name = (e.names && e.names[0]) || '（馬名不明）';
  var nShort = 0, nAdv = 0, nMemo = 0;
  (e.notes || []).forEach(function(n){ if (n.kind === 'short') nShort++; else if (n.kind === 'adv') nAdv++; else nMemo++; });
  var tot = nShort + nAdv + nMemo + ((e.memo && e.memo.trim()) ? 1 : 0);
  var nkLink = e.nk
    ? ' <a href="https://db.netkeiba.com/horse/' + esc(e.nk) + '/" target="_blank" rel="noopener" style="color:var(--ok-ink);font-size:.8rem">netkeiba馬ページ ↗</a>'
    : ' <span class="small muted">（競走馬IDなし）</span>';
  var notes = (e.notes || []).slice().sort(function(a, b){ return (b.ts || '').localeCompare(a.ts || ''); });
  var body = notes.map(hbNoteItemHTML).join('');
  if (!body) body = '<div class="small muted">まだメモがありません。「＋短評」「＋有利不利」や下の自由メモから登録できます。</div>';
  return '<details class="hbhorse" id="hbcard-' + esc(e.id) + '" data-hbe="' + esc(e.id) + '"' + (open ? ' open' : '') + '>' +
    '<summary>' +
    '<span style="font-weight:800;color:var(--ok-ink)">🐎 ' + esc(name) + '</span>' +
    '<span class="hbcounts"> 短評' + nShort + ' ／ 有利不利' + nAdv + ' ／ メモ' + nMemo + (tot > 0 ? '（計' + tot + '）' : '') + '</span>' + nkLink +
    '</summary>' +
    '<div style="margin-top:8px">' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
    '<button type="button" class="btn" data-hbadd="short" data-hbe="' + esc(e.id) + '">＋ 短評を登録</button>' +
    '<button type="button" class="btn" data-hbadd="adv" data-hbe="' + esc(e.id) + '">＋ 有利不利を登録</button>' +
    '<span class="sp"></span>' +
    '<button type="button" class="btn ghost" data-hbdelentry="' + esc(e.id) + '">この馬を削除</button>' +
    '</div>' + body +
    '<div style="margin-top:10px;border-top:1px dashed var(--line2);padding-top:8px">' +
    '<div class="small" style="font-weight:700;margin-bottom:2px">📓 自由メモ（この馬の備忘・次走への注記など）</div>' +
    '<textarea class="hbmemo" data-hbememo="' + esc(e.id) + '" rows="3" style="width:100%" placeholder="例: 阪神適性あり。2000m以上がベスト。休み明けは凡走しがち。">' + esc(e.memo || '') + '</textarea>' +
    '<div style="text-align:right;margin-top:4px"><button type="button" class="btn primary" data-hbmemosave="' + esc(e.id) + '">自由メモを保存</button></div>' +
    '</div></div></details>';
}

function hbCurrentRaceStrip(){
  // 今回の出馬表のうち登録メモがある馬のチップ
  var hs = (state.horses || []).filter(function(h){
    if (!h.name) return false;
    var e = hbFind(h);
    return e && ((e.notes || []).length || (e.memo || '').trim());
  });
  if (!hs.length) return '<div class="small muted">今回の出走馬には保存済みの馬ノートがありません。上の「短評貼り付け」や馬ページの「＋短評／＋有利不利」で登録すると、ここに出ます。</div>';
  return '<div class="small" style="margin-bottom:4px">📒 <b>今回の出走馬に保存済みの馬ノート</b>（クリックで閲覧）</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px">' +
    hs.map(function(h){
      var e = hbFind(h);
      var n = (e.notes || []).length + ((e.memo && e.memo.trim()) ? 1 : 0);
      return '<button type="button" class="hbchip" data-hb="' + esc(e.id) + '" title="ノートを表示">' +
        esc((h.no ? h.no + ' ' : '') + h.name) + ' 📒' + n + '</button>';
    }).join('') + '</div>';
}

function hbRefresh(){
  var wrap = $('hbList'); if (!wrap) return;
  var db = hbLoad();
  var sum = $('hbSum'); if (sum) sum.textContent = hbSummary();
  var strip = $('hbNowStrip'); if (strip) strip.innerHTML = hbCurrentRaceStrip();
  var q = ($('hbSearch') && $('hbSearch').value.trim()) || '';
  var qn = hbNorm(q);
  var list = db.horses.slice().sort(function(a, b){ return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  if (qn){
    list = list.filter(function(e){
      if (String(e.nk || '').indexOf(q) >= 0) return true;
      return (e.names || []).some(function(n){ return hbNorm(n).indexOf(qn) >= 0; }) ||
        (e.memo || '').indexOf(q) >= 0 ||
        (e.notes || []).some(function(x){ return x.text.indexOf(q) >= 0; });
    });
  }
  var focus = hbFocusId;
  var total = list.length;
  if (focus){   // 開きたい馬が表示範囲より後ろなら、そこまで広げる
    var fi = -1;
    list.forEach(function(e, i){ if (e.id === focus) fi = i; });
    if (fi >= 0 && fi >= hbShownCount) hbShownCount = fi + 1;
  }
  var shown = list.slice(0, hbShownCount);
  var moreRow = $('hbMoreRow');
  if (moreRow) moreRow.innerHTML = hbMoreRowHTML(total, shown.length, q);
  wrap.innerHTML = shown.length
    ? shown.map(function(e){ return hbHorseCardHTML(e, e.id === focus); }).join('')
    : (db.horses.length
        ? '<div class="muted">検索に一致する馬がいません。</div>'
        : '<div class="muted">まだ馬が登録されていません。上の「短評ページを貼り付け」か、現在の出走馬チップ（下）から登録を始められます。</div>');
  hbFocusId = null;
  if (focus){
    var el = document.getElementById('hbcard-' + focus);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ---------- 貼り付け割当UI(貼り付け&ニュース共通) ---------- */
var hbAssignRows = [];
var hbAssignCtx  = null;   // ニュース由来なら記事情報・日付を保持(保存時の付記用)

/* 行のHTML: 対象馬セレクト + ヘッダ(任意) + テキスト */
function hbRenderAssignRows(intro){
  var rows = hbAssignRows;
  var aw = $('hbAssignWrap'); if (aw) aw.classList.remove('hid');
  var box = $('hbAssignRows'); if (!box) return;
  var valN = rows.filter(function(r){ return r.val; }).length;
  var head = (intro == null
    ? '<div class="small muted" style="margin-bottom:6px">' + rows.length + '件のコメント（馬名から ' + valN + '件を自動割当）。<b>選択肢で対象馬を確認・修正</b>して「選択した馬に登録」してください。対象外は（対象外）にしてください。</div>'
    : intro);
  /* ★第22弾: レースが変わるところに見出しを挟む（1記事に複数レースある場合） */
  var prevRace = null;
  box.innerHTML = head + rows.map(function(r, i){
    var sep = '';
    if (r.raceLabel && r.raceLabel !== prevRace){
      prevRace = r.raceLabel;
      sep = '<div style="font-weight:800;font-size:.84rem;margin:10px 0 2px;border-left:3px solid var(--accent);padding-left:6px">🏁 ' +
        esc(r.raceLabel) + '</div>';
    }
    var selHtml = hbSelectOptions(r.hit && r.hit.name ? r.hit.name : (r.name || ''));
    return sep + '<div class="hbassign" style="border:1px solid var(--line2);border-radius:8px;padding:6px 8px;margin:4px 0;background:var(--card)">' +
      (r.label ? '<div class="small muted" style="margin:0 0 3px;font-weight:700">' + esc(r.label) + '</div>' : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<select data-hbsel="' + i + '" style="min-width:150px;max-width:230px">' + selHtml + '</select>' +
      (r.hit ? '<span class="small muted">▼ 馬名から自動割当</span>'
        : (r.src === 'new' ? '<span class="small muted">🆕 該当データなし → 記事の馬名・競走馬IDで新規登録します</span>'
        : (r.src && r.val ? '<span class="small muted">▼ ' + esc((typeof arSrcLabel === 'function' ? arSrcLabel(r.src) : r.src)) + 'から自動割当</span>'
        : (r.val ? '<span class="small muted">▼ 自動割当済み</span>' : '<span class="small muted">対象馬が見つかりません（選択してください）</span>')))) +
      '</div>' +
      '<textarea data-hbtxt="' + i + '" rows="3" style="width:100%;margin-top:4px">' + esc(r.text) + '</textarea>' +
      '</div>';
  }).join('');
  // 自動割当値がある行はその値で確定(ユーザー変更も可能)
  rows.forEach(function(r, i){
    if (!r.val) return;
    var sel = box.querySelector('[data-hbsel="' + i + '"]');
    if (sel){
      try { sel.value = r.val; } catch(e){ /* 選択肢に無い場合のみ */ }
    }
  });
  var k1 = $('hbKindShort'); if (k1) k1.checked = true;
  var aw2 = $('hbAssignWrap');
  if (aw2) aw2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* テキスト貼り付けから起動 */
function hbStartAssign(text){
  var rows = hbParsePaste(text);
  if (!rows.length){ hbLog('⚠ 貼り付けた内容から短文を検出できませんでした。各行に馬のコメントを入れてください。', 'err'); return; }
  hbAssignCtx = null;
  hbAssignRows = rows;
  var ctx = hbRaceCtx();
  var ri = $('hbRaceInfo'); if (ri) ri.textContent = ctx.label ? ('登録先レース情報: ' + ctx.label) : '（レース情報が未入力。短評の付記には使われません）';
  hbRenderAssignRows(null);
}

/* =========================================================
   netkeibaニュースからの自動取得（レース後コメント）
   ※ SP(mobile)ページは馬名リンクが無く解析できないことがあるため、
     可能ならPC版(news.netkeiba.com)に正規化して取得する。
   ========================================================= */
/* 全角数字→半角(本文に「１着」等があるため) */
function hbWide(s){
  return String(s == null ? '' : s).replace(/[０-９]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}
/* 現在のレース名 */
function hbCurRaceName(){
  try { var rm = readRaceMeta(); if (rm && rm.name) return String(rm.name).trim(); } catch(e){}
  try { if (state && state.race && state.race.name) return String(state.race.name).trim(); } catch(e){}
  return '';
}
/* SP記事URL → PC版URL(可能なら)。PCの方が馬名が馬ページリンクになっている */
function hbToPc(url){
  var u = String(url || '');
  u = u.replace(/^https?:\/\/news\.sp\.netkeiba\.com\//i, 'https://news.netkeiba.com/');
  u = u.replace(/^https?:\/\/news\.netkeiba\.com\//i, 'https://news.netkeiba.com/');
  return u;
}
/* 順番に取得し、最初に成功したものを返す */
function hbFetchFirst(urls){
  var i = 0, lastErr = null;
  return new Promise(function(res, rej){
    (function next(){
      if (i >= urls.length){ rej(lastErr || new Error('すべてのURLで取得に失敗しました')); return; }
      var u = urls[i++];
      hbFetchHtml(u).then(function(html){
        if (!html || html.length < 300){ lastErr = new Error('空応答: ' + u); next(); return; }
        res({ url: u, html: html });
      }).catch(function(e){ lastErr = e; next(); });
    })();
  });
}
/* レース後コメント記事 → 各馬エントリ(馬名リンク無し/SPにも対応) */
function hbParseCommentArticle(html){
  var raw = String(html || '');
  var seg = hbWide(raw);
  var idxHead = seg.indexOf('レース後のコメント');
  if (idxHead >= 0){
    var ends = ['みんなのコメント','関連情報','新着ニュース','アクセスランキング','ラジオNIKKEI','このニュースに注目','コメントを投稿'];
    var end = seg.length;
    for (var e = 0; e < ends.length; e++){
      var pp = seg.indexOf(ends[e], idxHead);
      if (pp >= 0 && pp < end) end = pp;
    }
    seg = seg.slice(idxHead, end);
  } else {
    // 見出しが見つからない場合: 結果サマリらしき部分(「勝利した」等)の後〜関連情報までを対象に
    var start = seg.indexOf('レース後');
    if (start >= 0) seg = seg.slice(start);
  }
  var entries = [];
  var posOrder = [];
  var reO = /(\d{1,2})\s*着/g, mm;
  while ((mm = reO.exec(seg))) posOrder.push({ at: mm.index, order: parseInt(mm[1], 10) });
  if (!posOrder.length) return entries;
  for (var pi = 0; pi < posOrder.length; pi++){
    var at = posOrder[pi].at, order = posOrder[pi].order;
    var from = at, to = (pi + 1 < posOrder.length) ? posOrder[pi + 1].at : seg.length;
    var block = seg.slice(from, to);
    if (block.length < 4) continue;
    var ent = hbExtractCommentBlock(block, order);
    if (ent) entries.push(ent);
  }
  return entries;
}
/* 1ブロック分(「N着…コメント」)から馬情報を抽出。リンク有無どちらでもOK */
function hbExtractCommentBlock(block, order){
  var nk = '', name = '', jockey = '';
  var hm = block.match(/<a[^>]*href=["'][^"']*\/horse\/([a-zA-Z0-9]+)\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (hm){ nk = hm[1]; name = hbText(hm[2]); }
  var jm = block.match(/<a[^>]*href=["'][^"']*\/jockey\/([a-zA-Z0-9]+)\/?[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (jm) jockey = hbText(jm[2]);
  var plain = hbText(block);
  if (!name){
    // 馬名リンクが無い場合のテキストフォールバック: 「N着　馬名(騎手)…」
    var m2 = /^\s*(\d+)\s*着[\s　]+([^\s　（(]+)/.exec(plain);
    if (m2) name = m2[2];
    if (name && jockey === ''){
      var ji = plain.indexOf(name, 0);
      if (ji >= 0){
        var rest2 = plain.slice(ji + name.length);
        var paren = rest2.match(/^[\s　]*[（(]([^）)]+)[)）]/);
        if (paren) jockey = paren[1].trim();
      }
    }
  }
  if (!name || name.length < 2) return null;
  if (/^(に|は|が|を|の|で|も|より|など|と|や|へ|から)$/.test(name)) return null;
  if (!name) return null;
  // コメント本文: 「N着 馬名(騎手)」の直後から
  var text = plain;
  var cutAt = 0;
  var pOrd = plain.indexOf(order + '着');
  if (pOrd >= 0){
    cutAt = pOrd + String(order).length + 1;
    var nPos = plain.indexOf(name, cutAt);
    if (nPos >= 0 && nPos <= cutAt + 80) cutAt = nPos + name.length;
    var jPos = jockey ? plain.indexOf(jockey, cutAt) : -1;
    if (jPos >= 0 && jPos <= cutAt + 80) cutAt = jPos + jockey.length;
    var parenClose = plain.indexOf(')', cutAt);
    if (jockey && parenClose >= 0 && parenClose <= cutAt + 80) cutAt = parenClose + 1;
    var parenClose2 = plain.indexOf('）', cutAt);
    if (jockey && parenClose2 >= 0 && parenClose2 <= cutAt + 80) cutAt = parenClose2 + 1;
    text = plain.slice(cutAt);
  }
  text = text.replace(/^[\s　:：、,，.。()（）「」\-—–-]+/, '').replace(/[\s　]+$/, '');
  // SP版などで末尾に記事外のフッター文字列が混ざる場合に備えて既知フレーズで切り詰める
  /* ★第22弾: 記事末尾の「配信元クレジット」が最後の馬の短評にくっつくので除去対象に追加
     （実物記事で「…休み明けという感じでした」 ラジオNIKKEI」となっていた） */
  var cutters = ['注目しますか', '関連ニュース', 'アクセスランキング', 'このニュースに注目',
    'コメントを投稿', 'みんなのコメント', '関連情報', '最新ニュースをアプリで読む',
    'おすすめ記事', 'ブックマーク', 'シェアする', 'ツイート', '続きを読む',
    'ラジオNIKKEI', 'ラジオ日本', 'スポニチ', 'デイリースポーツ', 'サンスポ', '報知',
    '東京スポーツ', '東スポ', '共同通信', '時事通信', 'netkeiba', 'いま読まれています'];
  for (var ct = 0; ct < cutters.length; ct++){
    var ci = text.indexOf(cutters[ct]);
    if (ci > 0) text = text.slice(0, ci);
  }
  text = text.replace(/[\s　]+$/, '');
  if (text.length < 3) return null;
  return { order: order, name: name, nk: nk, jockey: jockey, text: text };
}
/* 対象馬の割当値文字列(u<uid> / n<normname> / e<dbid> / '') */
function hbResolveTargetVal(name, nk){
  var nm = hbNorm(name);
  var hs = [];
  try { hs = (typeof state !== 'undefined' && state && state.horses) ? state.horses : []; } catch(e){}
  for (var i = 0; i < hs.length; i++){
    var h = hs[i]; if (!h || !h.name) continue;
    if (nk && h.nk && String(h.nk) === String(nk)) return (h.uid != null) ? ('u' + h.uid) : ('n' + nm);
  }
  for (var j = 0; j < hs.length; j++){
    var g = hs[j]; if (!g || !g.name) continue;
    if (hbNorm(g.name) === nm) return (g.uid != null) ? ('u' + g.uid) : ('n' + nm);
  }
  var db = hbLoad();
  for (var k = 0; k < db.horses.length; k++){
    var e = db.horses[k];
    if (nk && e.nk && String(e.nk) === String(nk)) return 'e' + e.id;
  }
  var byName = hbFindByName(name);
  if (byName) return 'e' + byName;
  return '';
}
function hbNewsToRows(entries){
  /* ★第22弾: 横断検索（出馬表キャッシュ・学習DB・馬ノート）とレース名つき行を作る
     arEntriesToRows を優先。無い場合は従来の「今の出馬表だけ」照合にフォールバック。 */
  if (typeof arEntriesToRows === 'function'){
    var st = hbPreviewState || {};
    return arEntriesToRows(entries, st.date || '');
  }
  return entries.map(function(en){
    var val = hbResolveTargetVal(en.name, en.nk);
    var label = en.order + '着　' + en.name + (en.jockey ? '（' + en.jockey + '）' : '');
    var text = (en.order ? en.order + '着 ' : '') + (en.jockey ? en.jockey + '：' : '') + en.text;
    return { text: text, val: val, label: label, hit: null };
  });
}
/* ★第22弾: ローカルで見つからなかったレースだけ netkeiba から出馬表を取りに行く
   （☑「見つからないレースはnetkeibaから出馬表を取得」でON/OFF） */
function hbArNetOn(){
  var cb = $('arNetChk');
  if (cb && typeof cb.checked === 'boolean') return cb.checked;
  try { return localStorage.getItem('khl_ar_net') !== '0'; } catch(e){ return true; }
}
function hbResolveMissingRaces(){
  var st = hbPreviewState;
  if (!st || !st.groups || typeof arNeedOnline !== 'function') return Promise.resolve(null);
  if (!hbArNetOn()) return Promise.resolve(null);
  var need = [];
  try { need = arNeedOnline(st.groups, { cap: 6 }); } catch(e){ need = []; }
  if (!need || !need.length) return Promise.resolve(null);
  hbLog('🌐 ローカルデータに1頭も居なかったレースが ' + need.length + ' 件あります（' +
    need.map(function(r){ return esc(arRaceLabel(r) || '名称不明'); }).join('／') +
    '）。netkeiba から出馬表を取りに行って照合し直します…');
  return arResolveOnline(need, { year: st.year || new Date().getFullYear() }).then(function(res){
    /* 取り直したので記事を書き割って再照合・再描画する */
    try {
      var p2 = arParseArticle(st.html);
      st.entries = p2.entries; st.races = p2.races; st.groups = p2.groups;
      if (p2.dateText) st.date = p2.dateText;
    } catch(e){}
    hbRenderNewsPreview();
    var rows = hbNewsToRows(st.entries);
    var found = rows.filter(function(x){ return x.val && x.src !== 'new'; }).length;
    var news = rows.filter(function(x){ return x.src === 'new'; }).length;
    hbLog('🌐 ' + (res && res.done ? res.done + ' レースぶん取得' : '取得できませんでした') +
      '　→　' + st.entries.length + '頭中 <b>' + found + '頭</b>を自動割当' +
      (news ? '（' + news + '頭は該当データなし → 記事の馬名・競走馬IDで新規登録できます）' : '') +
      '。　' + arIndexStat(), '');
    return res;
  }).catch(function(e){
    hbLog('⚠ netkeiba からの出馬表取得に失敗: ' + esc(String((e && e.message) || e)) +
      '　ローカルデータで見つかったぶんだけで割り当てます。', 'err');
    return null;
  });
}
function hbNewsLabel(title){
  var m = String(title || '').match(/【([^】]*)】/);
  if (m){
    var tok = m[1].replace(/レース後コメント/g, '').trim();
    if (tok) return tok + '（netkeiba レース後コメント）';
  }
  return String(title || '').slice(0, 40);
}

/* ---------- プレビュー状態 ---------- */
var hbPreviewState = null;

/* 記事URLを直接貼り付けて本文プレビューへ（候補一覧は使わない方式） */
function hbOpenNewsArticle(){
  var inp = $('hbNewsUrl');
  var raw = (inp ? String(inp.value) : '').trim();
  if (!raw){
    hbLog('上の欄に「レース後コメント」が載っている記事ページのURLを貼り付けてください。<br>' +
      '<span class="small">例: https://news.sp.netkeiba.com/?pid=news_view&no=341993</span>', 'err');
    try { if (inp) inp.focus(); } catch(e){}
    return;
  }
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  var prev = $('hbNewsPreview'); if (prev) prev.classList.add('hid');
  hbLog('📄 記事を取得中…（' + esc(raw) + '）　PC版優先で取得します（馬名が馬ページへのリンクになり解析しやすいため）');
  // SP版URLはPC版へ置換。PCが取れない環境の保険として元URL(SP)も並べる
  var pc = hbToPc(raw);
  var urls = [pc];
  if (raw !== pc) urls.push(raw);
  return hbFetchFirst(urls).then(function(r){
    var html = r.html;
    var title = hbPageTitle(html);
    var dateTxt = todayStr();
    var dm = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (dm) dateTxt = dm[1] + '年' + parseInt(dm[2], 10) + '月' + parseInt(dm[3], 10) + '日';
    /* ★第22弾: レース名を自動検出して、各馬コメントをレースごとに振り分けます。
       p62_articleref.js が無い旧構成でも動くように、従来関数へフォールバックします。 */
    var parsed = null;
    if (typeof arParseArticle === 'function'){
      try { parsed = arParseArticle(html); } catch(e){ parsed = null; }
    }
    var entries, races, groups;
    if (parsed){
      entries = parsed.entries; races = parsed.races; groups = parsed.groups;
      if (parsed.dateText) dateTxt = parsed.dateText;
      if (parsed.title) title = parsed.title;
    } else {
      entries = hbParseCommentArticle(html); races = []; groups = [];
    }
    if (typeof arXrefReset === 'function') arXrefReset();
    hbPreviewState = { no: '', title: title, url: r.url, html: html, entries: entries,
                       races: races, groups: groups, date: dateTxt, year: (dm ? parseInt(dm[1], 10) : new Date().getFullYear()) };
    hbRenderNewsPreview();
    if (!entries.length){
      hbLog('⚠ この記事から「N着＋馬コメント」の形式を検出できませんでした。下のプレビューで記事本文をご確認ください。' +
        '別レイアウトの場合は上の「短評ページを貼り付け」をご利用ください。', 'err');
      return;
    }
    var rows0 = hbNewsToRows(entries);
    var found0 = rows0.filter(function(x){ return x.val && x.src !== 'new'; }).length;
    hbLog('💡 ' + entries.length + '頭分の馬コメントを抽出（自動割当 ' + found0 + '頭）。' +
      (races && races.length ? '　🏁 検出したレース: ' + races.map(function(x){ return arRaceLabel(x); }).join('／') : '') +
      '　プレビューで内容を確認してから「この内容を割当表へ入れる」を押してください。', '');
    /* ★第22弾: ローカル（今の出馬表・出馬表キャッシュ・学習DB・馬ノート）に
       1頭も居なかったレースだけ、netkeiba から出馬表を取りに行って再照合します。 */
    return hbResolveMissingRaces();
  }).catch(function(e){
    hbLog('⚠ 記事取得に失敗: ' + esc(String((e && e.message) || e)) +
      '<br><span class="small">（ローカルで開いている場合は取得できません。Vercel なら api/race.js、Cloudflare Pages なら functions/api/race.js を同梱して公開するか、「URL取込の通信設定」で中継を設定してください）</span>', 'err');
  });
}
/* 記事HTMLから <title> の記事名部分を取得 */
function hbPageTitle(html){
  var m = String(html || '').match(/<title>([\s\S]*?)<\/title>/i);
  var t = m ? hbText(m[1]).replace(/[\s\r\n]+/g, ' ').trim() : '';
  t = String(t || '').split(/[｜|]/)[0].trim();   // 「… | netkeiba」等のサイト名部分を除去
  if (!t) t = '取得した記事';
  return t.slice(0, 80);
}
/* プレビュー描画 */
function hbRenderNewsPreview(){
  var st = hbPreviewState; if (!st) return;
  var box = $('hbNewsPreview'); if (!box) return;
  box.classList.remove('hid');
  var head = $('hbNewsPrevHead');
  /* ★第22弾: 検出したレース名と検索範囲の内訳を見出しに出す */
  var raceLine = '';
  if (typeof arRacesSummary === 'function' && st.races && st.races.length){
    raceLine = '<div class="small" style="margin-top:3px">' + arRacesSummary(st.races) + '</div>';
  }
  var statLine = '';
  try { if (typeof arIndexStat === 'function') statLine = '<div class="small muted" style="margin-top:2px">' + arIndexStat() + '　から該当馬を参照します。</div>'; } catch(e){}
  if (head) head.innerHTML = '<b>『' + esc(st.title || '取得した記事') + '』</b>　<span class="small muted">(' + esc(st.date) + ')</span>' +
    '<div class="small muted" style="margin-top:2px;word-break:break-all">取得元: <a href="' + esc(st.url || '') + '" target="_blank" rel="noreferrer">' + esc(st.url || '') + '</a></div>' +
    raceLine + statLine;
  var body = $('hbNewsPrevBody'); if (!body) return;
  if (st.entries.length){
    var grouped = (st.groups && st.groups.length && typeof arGroupsHTML === 'function');
    var rowsHtml;
    if (grouped){
      /* レースごとの見出しで区切って表示（1記事に複数レースあっても混ざらない） */
      rowsHtml = arGroupsHTML(st.groups);
    } else {
      rowsHtml = st.entries.map(function(en){
        var val = hbResolveTargetVal(en.name, en.nk);
        var tgt = val ? '<span style="color:var(--ok-ink);font-weight:700">✓ 割当: ' + esc((function(){ var o = hbHorseFromVal(val); return o ? (o.h && o.h.name) || '' : ''; })()) + '</span>' : '<span style="color:var(--warn-ink)">（該当する登録馬なし）</span>';
        return '<div style="border:1px solid var(--line);border-radius:8px;padding:6px 9px;margin:4px 0;background:var(--card)">' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:.82rem">' +
          '<b>' + en.order + '着</b>　<b>' + esc(en.name) + '</b>' +
          (en.jockey ? '<span class="small muted">(' + esc(en.jockey) + ')</span>' : '') + '　' + tgt + '</div>' +
          '<div style="margin-top:3px;font-size:.84rem;white-space:pre-wrap">' + esc(en.text) + '</div></div>';
      }).join('');
    }
    var nNew = 0;
    try { nNew = hbNewsToRows(st.entries).filter(function(x){ return x.src === 'new'; }).length; } catch(e){}
    body.innerHTML = '<div class="small muted" style="margin:2px 0 6px">記事に記載された馬コメントを抽出したものです。' + st.entries.length + '件' +
      (st.groups && st.groups.length > 1 ? '・<b>' + st.groups.length + 'レースぶん</b>' : '') +
      (nNew ? '（うち ' + nNew + '頭は該当データなし → 🆕記事の馬名・競走馬IDで新規登録できます）' : '') +
      '。おかしな行があれば下の割当表で修正できます。</div>' + rowsHtml;
  } else {
    var plainText = hbText(st.html);
    body.innerHTML = '<div class="warnbox">この記事から「N着＋馬コメント」の形式を自動抽出できませんでした。下に記事のテキストを抜き出してあるので、「本当にコメントがあるか」を確認し、あれば「短評ページを貼り付け」欄にコピーして取り込むか、抽出し直してください。</div>' +
      '<div style="max-height:240px;overflow:auto;border:1px dashed var(--line2);border-radius:8px;padding:8px;background:var(--card);font-size:.78rem;white-space:pre-wrap">' + esc(plainText.slice(0, 4000)) + (plainText.length > 4000 ? '…' : '') + '</div>';
  }
  var btn = $('hbNewsPrevUse');
  var cntEl = $('hbNewsPrevCnt');
  if (btn) btn.style.display = st.entries.length ? '' : 'none';
  if (cntEl) cntEl.textContent = st.entries.length ? st.entries.length + '件のコメントを割当表へ入れます' : '';
}
/* プレビューの内容を割当表(hbAssignRows)へ入れる */
function hbUsePreview(){
  var st = hbPreviewState;
  if (!st || !st.entries || !st.entries.length){ hbLog('先にプレビューできる記事を選んでください。', 'err'); return; }
  var rows = hbNewsToRows(st.entries);
  var found = rows.filter(function(r){ return r.val && r.src !== 'new'; }).length;
  var nNew = rows.filter(function(r){ return r.src === 'new'; }).length;
  hbAssignRows = rows;
  /* 行ごと（＝レースごと）に ctx を持っているので、これはフォールバック */
  hbAssignCtx = { date: st.date, label: hbNewsLabel(st.title), fromNews: true };
  var raceTxt = (st.races && st.races.length && typeof arRaceLabel === 'function')
    ? st.races.map(function(r){ return arRaceLabel(r); }).join('／') : '';
  var raceHint = hbCurRaceName()
    ? '（現在のレース名: ' + esc(hbCurRaceName()) + ' と<b>違っていても登録できます</b>）' : '';
  var intro = '<div class="small muted" style="margin-bottom:6px">「' + esc(st.title) + '」から ' + st.entries.length + '頭分を割当表へ投入（' +
    found + '頭を自動割当' + (nNew ? '・' + nNew + '頭は🆕新規登録' : '') + '）。' +
    (raceTxt ? '<br>🏁 検出したレース: <b>' + esc(raceTxt) + '</b>　' : '') +
    '<b>下で対象馬・文言を確認し、「選択した馬に登録」</b>を押してください。</div>';
  var ri = $('hbRaceInfo');
  if (ri) ri.innerHTML = '取得記事: ' + esc(st.title) + (raceTxt ? '　🏁 ' + esc(raceTxt) : '') + raceHint;
  hbRenderAssignRows(intro);
  hbLog('💡 割当表に入れました。種類は「📝短評」がおすすめです（必要なら行を選び直し、最後に「選択した馬に登録」）。', '');
}
function hbCancelAssign(){
  hbAssignRows = [];
  hbAssignCtx = null;
  var aw = $('hbAssignWrap'); if (aw) aw.classList.add('hid');
  var box = $('hbAssignRows'); if (box) box.innerHTML = '';
}
function hbSaveAssign(){
  var rows = hbAssignRows;
  if (!rows || !rows.length){ hbLog('割当対象がありません。', 'err'); return; }
  var kind = ($('hbKindAdv') && $('hbKindAdv').checked) ? 'adv' : (($('hbKindMemo') && $('hbKindMemo').checked) ? 'memo' : 'short');
  var ctx = hbAssignCtx || hbRaceCtx();
  var saved = 0, skipped = 0, nNew = 0;
  rows.forEach(function(r, i){
    var sel = document.querySelector('[data-hbsel="' + i + '"]');
    if (!sel) return;
    var val = sel.value;
    if (!val){ skipped++; return; }
    var tBox = document.querySelector('[data-hbtxt="' + i + '"]');
    var text = tBox ? tBox.value : r.text;
    var t = String(text || '').trim();
    if (!t){ skipped++; return; }
    var obj = hbHorseFromVal(val);
    if (!obj || !obj.h || !obj.h.name){ skipped++; return; }
    /* ★第22弾: 記事から検出した「その馬が出ていたレース名」を行ごとに付記する。
       1つの記事に複数レースが載っていても、それぞれのレース名が短評に残ります。 */
    var rctx = ctx;
    if (r.ctx && (r.ctx.label || r.ctx.date)){
      rctx = { date: r.ctx.date || ctx.date || todayStr(),
               label: r.ctx.label || ctx.label || '',
               fromNews: true };
    }
    if (r.src === 'new' || val.charAt(0) === 'x') nNew++;
    hbNewNote(obj.h, kind, t, rctx);
    saved++;
  });
  if (saved > 0){
    hbLog('💾 対象馬 ' + saved + '件に「' + hbKindMeta(kind)[0] + '」を登録しました（スキップ ' + skipped + '件' +
      (nNew ? '・うち ' + nNew + '件は今回の出走外/新規の馬' : '') +
      '）。次回その馬が出走するとマークが付きます。');
  } else {
    hbLog('対象馬が1件も選ばれていません。', 'err');
  }
  hbCancelAssign();
  hbRefresh();
  hbAfterChange();
}

/* ---------- モーダル（馬ノートの閲覧 / 追加） ---------- */
function hbViewModal(eid){
  if (typeof showModal !== 'function') return;
  var e = hbEntryById(eid);
  if (!e) return;
  var name = (e.names && e.names[0]) || '（馬名不明）';
  var nkLink = e.nk ? ' <a href="https://db.netkeiba.com/horse/' + esc(e.nk) + '/" target="_blank" rel="noopener" style="color:var(--ok-ink)">netkeiba馬ページ ↗</a>' : '';
  var notes = (e.notes || []).slice().sort(function(a, b){ return (b.ts || '').localeCompare(a.ts || ''); });
  var html = '<h2>🐎 ' + esc(name) + ' <span class="chip">馬ノート</span></h2>' +
    '<div class="small muted">' + hbSummaryOfEntry(e) + nkLink + '</div>' +
    '<div style="margin:8px 0;display:flex;gap:6px;flex-wrap:wrap">' +
    '<button type="button" class="btn primary" data-hbmadd="short" data-hbe="' + esc(e.id) + '">＋ 短評を登録</button>' +
    '<button type="button" class="btn primary" data-hbmadd="adv" data-hbe="' + esc(e.id) + '">＋ 有利不利を登録</button>' +
    '<span class="sp"></span>' +
    '<button type="button" class="btn" data-hbpage="' + esc(e.id) + '">詳細ページへ（④）</button>' +
    '</div>' +
    (notes.length ? notes.map(hbNoteItemHTML).join('') : '<div class="small muted">メモはまだありません。</div>') +
    (e.memo && e.memo.trim() ? '<div style="margin-top:8px;border-top:1px dashed var(--line2);padding-top:6px"><b>📓 自由メモ</b><div style="white-space:pre-wrap;margin-top:2px">' + esc(e.memo) + '</div></div>' : '') +
    '<div style="text-align:right;margin-top:12px"><button type="button" class="btn ghost" data-mcl>閉じる</button></div>';
  showModal(html, function(root){
    var cl = root.querySelector('[data-mcl]');
    if (cl) cl.addEventListener('click', closeModal);
    var page = root.querySelector('[data-hbpage]');
    if (page) page.addEventListener('click', function(){ hbFocusId = page.getAttribute('data-hbpage'); closeModal(); if (typeof goTab === 'function') goTab('t-horse'); });
    ['short', 'adv'].forEach(function(kind){
      var b = root.querySelector('[data-hbmadd="' + kind + '"]');
      if (b) b.addEventListener('click', function(){
        closeModal();
        hbOpenAddModal(b.getAttribute('data-hbe'), kind);
      });
    });
  });
}
function hbSummaryOfEntry(e){
  var nS = 0, nA = 0, nM = 0;
  (e.notes || []).forEach(function(x){ if (x.kind === 'short') nS++; else if (x.kind === 'adv') nA++; else nM++; });
  var r = [];
  if (nS) r.push('短評 ' + nS);
  if (nA) r.push('有利不利 ' + nA);
  if (nM) r.push('メモ ' + nM);
  if (!r.length) r.push('メモ 0');
  if ((e.memo || '').trim()) r.push('自由メモあり');
  return r.join(' ／ ');
}
function hbOpenAddModal(eid, kind){
  if (typeof showModal !== 'function') return;
  var e = hbEntryById(eid);
  var name = (e && e.names && e.names[0]) || '';
  var km = hbKindMeta(kind);
  var ctx = hbRaceCtx();
  var html = '<h2>' + km[0] + 'の登録</h2>' +
    '<p>対象馬: <b>' + esc(name) + '</b>　<span class="small muted">' + esc(ctx.label || '') + '</span></p>' +
    '<select id="hbAddKind" style="margin-bottom:6px">' +
    '<option value="short"' + (kind === 'short' ? ' selected' : '') + '>📝 短評</option>' +
    '<option value="adv"' + (kind === 'adv' ? ' selected' : '') + '>⚖️ 有利不利</option>' +
    '<option value="memo"' + (kind === 'memo' ? ' selected' : '') + '>📌 メモ</option>' +
    '</select>' +
    '<textarea id="hbAddTxt" rows="5" style="width:100%" placeholder="' + (kind === 'adv'
      ? '例: この日は4角で外を回され不利。次走以降も出遅れ・大外枠なら割引が必要。'
      : '例: スタートを決めて好位追走。直線も渋太く伸びて地力の高さを示した。') + '"></textarea>' +
    '<div style="text-align:right;margin-top:8px;display:flex;gap:6px;justify-content:flex-end">' +
    '<button type="button" class="btn ghost" data-mno>キャンセル</button>' +
    '<button type="button" class="btn primary" data-hbaddok>登録</button></div>';
  showModal(html, function(root){
    var no = root.querySelector('[data-mno]');
    if (no) no.addEventListener('click', closeModal);
    var ok = root.querySelector('[data-hbaddok]');
    ok.addEventListener('click', function(){
      var k = (document.getElementById('hbAddKind') && document.getElementById('hbAddKind').value) || 'short';
      var tx = document.getElementById('hbAddTxt');
      var t = tx ? tx.value : '';
      var e2 = hbEntryById(eid);
      if (!e2){ closeModal(); return; }
      hbNewNote({ nk: e2.nk, name: (e2.names && e2.names[0]) || '' }, k, t, hbRaceCtx());
      closeModal();
      hbRefresh();
      hbAfterChange();
    });
  });
}

/* メモ保存後の他タブ更新 */
function hbAfterChange(){
  if (typeof _curTab !== 'undefined' && _curTab === 't-kentai' && typeof renderKentaiFull === 'function') renderKentaiFull();
  if (typeof _curTab !== 'undefined' && _curTab === 't-input' && typeof hbSyncInputBadges === 'function') hbSyncInputBadges();
}

/* 出馬表の馬ノート一覧（②の上部へ出すチップ列） */
function hbKentaiNoteHTML(){
  if (!state || !state.horses || !state.horses.length) return '';
  var hits = (state.horses || []).filter(function(h){ return h && h.name && hbFind(h); });
  if (!hits.length) return '';
  var chips = hits.map(function(h){
    var e = hbFind(h);
    var n = (e.notes || []).length + ((e.memo && e.memo.trim()) ? 1 : 0);
    return '<button type="button" class="hbchip" data-hb="' + esc(e.id) + '" title="馬ノートを表示">' +
      esc((h.no ? h.no + ' ' : '') + h.name) + ' 📒' + n + '</button>';
  }).join('');
  return '<div style="background:var(--card2);border:1px solid var(--line2);border-radius:10px;padding:6px 10px;margin-top:6px;font-size:.82rem">' +
    '📒 <b>保存済みの馬ノートがある馬:</b> ' + chips + '（クリックで閲覧・追加）</div>';
}

/* ①入力グリッドの馬名セルへ、保存済み馬ノートの📒マークを同期付与（入力内容には触れない） */
function hbSyncInputBadges(){
  try {
    var tb = document.getElementById('horseBody');
    if (!tb || !state || !state.horses) return;
    var rows = (typeof tb.querySelectorAll === 'function') ? tb.querySelectorAll('tr[data-uid]') : [];
    if (!rows || !rows.length) return;
    for (var r = 0; r < rows.length; r++){
      var tr = rows[r];
      var uid = parseInt(tr.getAttribute('data-uid'), 10);
      var h = null;
      for (var i = 0; i < state.horses.length; i++){
        if (state.horses[i].uid === uid){ h = state.horses[i]; break; }
      }
      var inp = (typeof tr.querySelector === 'function') ? tr.querySelector('input[data-f="name"]') : null;
      if (!h || !inp) continue;
      var cell = inp.parentNode;                       // 馬名セル内のflex span
      if (!cell) continue;
      var old = (typeof cell.querySelector === 'function') ? cell.querySelector('[data-hb]') : null;
      if (old && old.parentNode === cell) cell.removeChild(old);
      if (typeof hbBadgeHTML === 'function'){
        var chipHtml = hbBadgeHTML(h);
        if (chipHtml){
          var tmp = document.createElement('span');
          tmp.innerHTML = chipHtml;
          var chip = tmp.firstChild;
          if (chip && typeof cell.appendChild === 'function') cell.appendChild(chip);
        }
      }
    }
  } catch(e){ /* DOM差し込みの失敗は無視(入力は保持される) */ }
}


/* ---------- バックアップ（出力 / 復元） ---------- */
function hbBackup(){
  if (typeof showModal !== 'function') return;
  var txt = JSON.stringify(hbLoad());
  showModal('<h2>馬ノートDBのバックアップ</h2>' +
    '<p class="small muted">下のテキストをコピーして保存しておくと、別の端末やブラウザで「復元」できます。</p>' +
    '<textarea rows="8" style="width:100%" onclick="this.select()">' + esc(txt) + '</textarea>' +
    '<div style="text-align:right;margin-top:8px"><button type="button" class="btn ghost" data-mcl>閉じる</button></div>',
    function(root){ root.querySelector('[data-mcl]').addEventListener('click', closeModal); });
}
function hbRestore(){
  if (typeof showModal !== 'function') return;
  showModal('<h2>馬ノートDBを復元</h2>' +
    '<p class="small muted">バックアップしたJSONを貼り付けて「復元」を押すと、現在の内容に置き換わります。</p>' +
    '<textarea id="hbRestoreTxt" rows="8" style="width:100%" placeholder=\'{ "horses": [...] }\'></textarea>' +
    '<div style="text-align:right;margin-top:8px;display:flex;gap:6px;justify-content:flex-end">' +
    '<button type="button" class="btn ghost" data-mno>キャンセル</button>' +
    '<button type="button" class="btn primary" data-hbrest>復元</button></div>',
    function(root){
      root.querySelector('[data-mno]').addEventListener('click', closeModal);
      root.querySelector('[data-hbrest]').addEventListener('click', function(){
        var raw = document.getElementById('hbRestoreTxt');
        try {
          var o = JSON.parse(raw.value);
          if (!o || !Array.isArray(o.horses)) throw new Error('形式が不正です');
          safeSetItem(HB_LS, JSON.stringify(o));
          closeModal();
          hbLog('♻ 復元しました（' + o.horses.length + '頭）。');
          hbRefresh();
          hbAfterChange();
        } catch(e){
          raw.style.borderColor = '#c33';
          raw.value = 'エラー: ' + String(e.message || e);
        }
      });
    });
}

/* ---------- イベント ---------- */
function initHorseBook(){
  if (typeof on !== 'function') return;
  on('btnHbParse', 'click', function(){
    var ta = $('hbPaste');
    var t = ta ? ta.value : '';
    if (!t.trim()){ hbLog('先に短評ページの内容を上の欄に貼り付けてください。', 'err'); return; }
    hbStartAssign(t);
  });
  on('btnHbSaveAssign', 'click', hbSaveAssign);
  on('btnHbCancelAssign', 'click', hbCancelAssign);
  on('btnHbNewsOpen', 'click', hbOpenNewsArticle);
  /* ★第22弾: 「🌐 見つからないレースはnetkeibaから出馬表を取りに行く」のON/OFFを記憶 */
  (function(){
    var cb = $('arNetChk');
    if (!cb) return;
    try { cb.checked = localStorage.getItem('khl_ar_net') !== '0'; } catch(e){}
    cb.addEventListener('change', function(){
      try { localStorage.setItem('khl_ar_net', cb.checked ? '1' : '0'); } catch(e){}
      if (typeof arIdxReset === 'function') arIdxReset();
      hbLog(cb.checked
        ? '🌐 ローカルで見つからないレースは netkeiba から出馬表を取得して照合します。'
        : '🌐 netkeiba からの出馬表取得をOFFにしました。今の出馬表・出馬表キャッシュ・学習DB・馬ノートの範囲だけで照合します。', '');
    });
  })();
  on('btnHbNewsUse', 'click', hbUsePreview);
  on('btnHbNewsClosePrev', 'click', function(){ var b=$('hbNewsPreview'); if (b) b.classList.add('hid'); });
  // 「📋 貼り付け」: クリップボードのURLを記事URL欄へ
  on('btnHbUrlPaste', 'click', function(){
    var inp = $('hbNewsUrl'); if (!inp) return;
    var put = function(txt){ inp.value = String(txt || '').trim(); };
    if (navigator && navigator.clipboard && navigator.clipboard.readText){
      navigator.clipboard.readText().then(function(t){ put(t); hbLog('記事URL欄へ貼り付けました（' + (t||'').length + '文字）'); })
        .catch(function(){ hbLog('⚠ クリップボードを読めませんでした。欄を選択して Ctrl+V / ⌘V で貼り付けてください。', 'err'); });
    } else { hbLog('⚠ この環境では自動読み取り不可。欄を選択して Ctrl+V / ⌘V で貼り付けてください。', 'err'); }
  });
  // 「🗑 入力リンクを消す」: URL欄を空に（抽出プレビューも閉じる）
  on('btnHbUrlClear', 'click', function(){
    var inp = $('hbNewsUrl'); if (inp) inp.value = '';
    var pv = $('hbNewsPreview'); if (pv) pv.classList.add('hid');
    hbLog('記事URL欄を空にしました。');
  });
  on('btnHbBackup', 'click', hbBackup);
  on('btnHbRestore', 'click', hbRestore);
  var sr = $('hbSearch');
  if (sr) sr.addEventListener('input', function(){ hbShownReset(); hbRefresh(); });
  // 「さらに表示」ボタン（件数が増えてもページが伸びないように段階表示）
  var mr = $('hbMoreRow');
  if (mr) mr.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('[data-hbmore]') : null;
    if (!b) return;
    if (b.getAttribute('data-hbmore') === 'all') hbShownCount = 1e6;
    else hbShownCount += HB_STEP;
    hbRefresh();
  });
  // リスト内クリックの委譲
  var list = $('hbList');
  if (list) list.addEventListener('click', function(e){
    var t = e.target;
    var addB = t.closest && t.closest('[data-hbadd]');
    if (addB){ hbOpenAddModal(addB.getAttribute('data-hbe'), addB.getAttribute('data-hbadd')); return; }
    var delN = t.closest && t.closest('[data-hbdelnote]');
    if (delN){
      var eid = delN.parentNode && delN.parentNode.getAttribute('data-hbe');
      var nid = delN.getAttribute('data-hbdelnote');
      var horseCard = delN.closest('[data-hbe]');
      eid = (horseCard && horseCard.getAttribute('data-hbe')) || eid;
      if (nid && typeof showConfirm === 'function'){
        showConfirm('このメモを削除しますか？', function(){ hbDelNote(eid, nid); hbRefresh(); });
      } else if (nid){
        hbDelNote(eid, nid); hbRefresh();
      }
      return;
    }
    var delE = t.closest && t.closest('[data-hbdelentry]');
    if (delE){
      var e2 = delE.getAttribute('data-hbdelentry');
      if (typeof showConfirm === 'function'){
        showConfirm('この馬のノート（短評・有利不利・自由メモ）をすべて削除しますか？', function(){ hbDelEntry(e2); hbRefresh(); hbAfterChange(); });
      } else { hbDelEntry(e2); hbRefresh(); hbAfterChange(); }
      return;
    }
    var ms = t.closest && t.closest('[data-hbmemosave]');
    if (ms){
      var eid3 = ms.getAttribute('data-hbmemosave');
      var tx = t.closest('.hbhorse') ? t.closest('.hbhorse').querySelector('[data-hbememo]') : null;
      var v = tx ? tx.value : '';
      hbSetMemo(eid3, v);
      hbRefresh();
      return;
    }
  });
  // 馬ノート表示マーク(②・①の各所)
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('[data-hb]');
    if (b){
      hbViewModal(b.getAttribute('data-hb'));
      e.preventDefault && e.preventDefault();
      return;
    }
    var madd = e.target && e.target.closest && e.target.closest('[data-hbmadd]');
    if (madd){
      hbOpenAddModal(madd.getAttribute('data-hbe'), madd.getAttribute('data-hbmadd'));
      return;
    }
  });
}
var hbFocusId = null;
