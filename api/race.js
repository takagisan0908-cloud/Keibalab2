// Vercel Serverless Function: api/race.js
// ルートに api/race.js を置き、プロジェクトをVercelに接続すると /api/race として動きます
// 呼び出し: /api/race?url=<エンコードしたURL>
//          /api/race?url=<...>&method=POST&body=cname%3Dpw01sli00%2FAF  (JRAアクセス用POST中継)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const target = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(target)) { res.status(400).send('bad url'); return; }
  const method = String(req.query.method || 'GET').toUpperCase();
  const body = req.query.body != null ? String(req.query.body) : undefined;
  try {
    const hdrs = { 'User-Agent': UA, 'Accept': 'text/html,application/json,*/*' };
    const fopt = { redirect: 'follow', headers: hdrs };
    if (method !== 'GET'){
      fopt.method = method;
      hdrs['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      fopt.body = body || '';
    }
    const r = await fetch(target, fopt);
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = decodeBody(buf, target, r.headers.get && r.headers.get('content-type'));
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.ok ? 200 : 502).send(text);
  } catch (e) {
    res.status(502).send('fetch error: ' + String(e && e.message || e));
  }
}
