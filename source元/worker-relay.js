// Cloudflare Worker（カスタム中継URL用・GitHub Pages等の静的ホスト向け）
//
// 使い方:
//  1) dash.cloudflare.com → Workers & Pages → Create → Worker → Edit code を開く
//  2) 下のコードを全部貼り付けて「Deploy」(名前は何でも可)
//  3) 発行された https://<あなたの名前>.<サブドメイン>.workers.dev に
//     /fetch を足した「 https://<名前>.workers.dev/fetch 」を
//     アプリの「カスタム中継URL」欄に保存 → 接続テストで確認
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*'
};
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

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  const u = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // /fetch または ルート直下 のどちらでも中継として扱う
  const target = (u.searchParams.get('url') || '').trim();
  if (!target) return new Response('relay ok. add ?url=<encoded url>&method=POST&body=...', { status: 200, headers: CORS });
  if (!/^https?:\/\//i.test(target)) return new Response('bad url', { status: 400, headers: CORS });
  const method = (u.searchParams.get('method') || 'GET').toUpperCase();
  const body = u.searchParams.get('body') != null ? u.searchParams.get('body') : undefined;
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
    const ctype = (r.headers.get('content-type') || 'text/html; charset=utf-8').split(';')[0] + '; charset=utf-8';
    return new Response(text, {
      status: r.ok ? 200 : 502,
      headers: Object.assign({}, CORS, { 'Content-Type': ctype, 'Cache-Control': 'no-store' })
    });
  } catch (e) {
    return new Response('fetch error: ' + String(e && e.message || e), { status: 502, headers: CORS });
  }
}
