// 로컬 실행용 서버 (Vercel 없이 테스트): node dev-server.js → http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const preview = require('./api/preview.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/preview') { req.query = Object.fromEntries(u.searchParams); return preview(req, res); }
  let p = path.join(__dirname, decodeURIComponent(u.pathname));
  if (!p.startsWith(__dirname)) { res.statusCode = 403; return res.end(); }
  // .env 같은 숨김 파일과 개발용 파일은 브라우저에 보여 주지 않는다 (API 키 노출 방지)
  const rel = path.relative(__dirname, p);
  if (rel.split(path.sep).some((seg) => seg.startsWith('.')) || /^(docs|api)(\/|$)|^dev-server\.js$/.test(rel)) {
    res.statusCode = 404; return res.end('Not found');
  }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
