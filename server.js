'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // API endpoints — serve the JSON data files directly so that the same
    // payload powers both the UI and any downstream test harness.
    if (pathname === '/api/navaids' || pathname === '/api/missions') {
      const file = path.join(PUBLIC_DIR, 'data', pathname.replace('/api/', '') + '.json');
      fs.readFile(file, (err, data) => {
        if (err) return send(res, 500, JSON.stringify({ error: 'data unavailable' }), { 'Content-Type': MIME['.json'] });
        send(res, 200, data, { 'Content-Type': MIME['.json'] });
      });
      return;
    }

    if (pathname === '/' || pathname === '') pathname = '/index.html';

    // Security: prevent traversal
    const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return send(res, 403, 'Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // SPA-style fallback for unknown paths -> serve index
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(indexPath, (e2, data) => {
          if (e2) return send(res, 404, 'Not found');
          send(res, 200, data, { 'Content-Type': MIME['.html'] });
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      fs.readFile(filePath, (e2, data) => {
        if (e2) return send(res, 500, 'Read error');
        send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      });
    });
  } catch (err) {
    send(res, 500, 'Server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: 'ifr-pilot listening', port: PORT }));
});
