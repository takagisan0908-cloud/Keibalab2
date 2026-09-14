/* =========================================================
   ローカル/ライブ用 中継つきサーバー（依存パッケージ不要）
   - 静的配信: keiba-lab フォルダの中身 (index.html 等)
   - 中継API  : /api/race ?url=<netkeibaのページURL>   (Vercel/Cloudflare と同じ形)
   -            /api/odds ?race_id=123456789012
   node server-local.js  を実行 → http://localhost:8788
   ※ このサーバーがあると「netkeiba URLからの出馬表・前レース
      自動取込」「トラックバイアス自動取込」がすべて動きます。
   ========================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8788;
const ROOT = __dirname;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIME = {
  '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.webp':'image/webp','.md':'text/plain; charset=utf-8',
  '.zip':'application/zip'
};
function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','*');
}
function send(res, code, body, type){
  res.writeHead(code, { 'Content-Type': type || 'text/html; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(body);
}
function decodeBody(buf, url, ctype){
  let enc = '';
  if (/jra\.go\.jp/.test(url)) enc = 'shift_jis';
  else if (/jiro8\.sakura\.ne\.jp/.test(url)) enc = 'shift_jis';
  else if (/db\.netkeiba\.com/.test(url) && !/ajax_|output=json|api_|\.json/i.test(url)) enc = 'euc-jp';
  if (!enc){
    const c = String(ctype || '').match(/charset\s*=\s*["']?([\w-]+)/i);
    if (c) enc = c[1];
  }
  if (!enc) enc = 'utf-8';
  try { return new TextDecoder(enc).decode(buf); }
  catch(e){ return new TextDecoder('utf-8').decode(buf); }
}
async function relay(target, opts){
  opts = opts || {};
  const hdrs = { 'User-Agent': UA, 'Accept':'text/html,application/json,*/*' };
  const fopt = { redirect:'follow', headers: hdrs };
  if (opts.method && opts.method !== 'GET'){
    fopt.method = opts.method;
    hdrs['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    fopt.body = opts.body || '';
  }
  const r = await fetch(target, fopt);
  const buf = new Uint8Array(await r.arrayBuffer());
  const text = decodeBody(buf, target, r.headers.get && r.headers.get('content-type'));
  return { status: r.ok ? 200 : 502, body: text,
    ctype: ((r.headers.get('content-type') || 'text/html').split(';')[0] + '; charset=utf-8') };
}
function relayTarget(u){
  const t = (u.searchParams.get('url') || '').trim();
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS'){ send(res, 204, ''); return; }
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  // 中継API（アプリが最初に試す関数パス2種のどちらも対応）
  const isRaceFn = p === '/api/race';
  const isOddsFn = p === '/api/odds';

  if (isRaceFn){
    const t = relayTarget(u);
    if (!t){ send(res, 200, 'race relay ok. add ?url=<encoded>&method=POST&body=...'); return; }
    const method = (u.searchParams.get('method') || 'GET').toUpperCase();
    const body = u.searchParams.get('body') != null ? u.searchParams.get('body') : undefined;
    try {
      const out = await relay(t, { method: method, body: body });
      send(res, out.status, out.body, out.ctype);
    } catch(e){ send(res, 502, 'relay error: ' + String(e && e.message || e)); }
    return;
  }
  if (isOddsFn){
    const rid = (u.searchParams.get('race_id') || '').trim();
    if (!/^\d{10,12}$/.test(rid)){ send(res, 400, 'bad race_id'); return; }
    const api = 'https://race.netkeiba.com/api/api_get_jra_odds.html' +
      '?pid=api_get_jra_odds&input=UTF-8&output=json&race_id=' + rid +
      '&type=1&action=init&sort=odds&compress=0';
    try {
      const out = await relay(api);
      send(res, out.status, out.body, 'application/json; charset=utf-8');
    } catch(e){ send(res, 502, 'odds relay error'); }
    return;
  }

  // 静的配信
  let fp = path.normalize(path.join(ROOT, decodeURIComponent(p)));
  if (!fp.startsWith(ROOT)) { send(res, 403, 'forbidden'); return; }
  try {
    const st = fs.statSync(fp);
    if (st.isDirectory()) fp = path.join(fp, 'index.html');
  } catch(e){ send(res, 404, 'not found: ' + p); return; }
  const ext = path.extname(fp).toLowerCase();
  try {
    send(res, 200, fs.readFileSync(fp), MIME[ext] || 'application/octet-stream');
  } catch(e){ send(res, 404, 'not found'); }
}).listen(PORT, '0.0.0.0', () => {
  console.log('keiba-lab server (static + relay) on http://0.0.0.0:' + PORT);
});
