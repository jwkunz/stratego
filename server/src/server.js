// HTTP (static client) + WebSocket (game protocol) on a single port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PUBLIC_DIR = path.resolve(here, '../public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  // the client is one self-contained HTML file with inline script/style
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
};

/**
 * @param {object} [opts]
 * @param {string} [opts.publicDir]  directory with the built client
 * @param {object} [opts.lobby]      Lobby options (graceMs, waitingMs, idleMs)
 * @param {(...a:any[])=>void} [opts.log]
 */
export function createGameServer({ publicDir = DEFAULT_PUBLIC_DIR, lobby: lobbyOpts = {}, log = () => {} } = {}) {
  const lobby = new Lobby({ ...lobbyOpts, log });

  const server = http.createServer((req, res) => {
    const headers = { ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, games: lobby.rooms.size, players: lobby.sessions.size }));
    }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400, headers); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(publicDir, '.' + rel);
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) { // path traversal
      res.writeHead(403, headers);
      return res.end();
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        const missingClient = !fs.existsSync(path.join(publicDir, 'index.html'));
        res.writeHead(missingClient ? 503 : 404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(missingClient ? 'The client has not been built yet. Run "npm run build" in the server folder.\n' : 'Not found\n');
      }
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });

  // Only accept WebSocket connections made by pages served from this very server (blocks other web pages
  // from driving the game server from a player's browser).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    let ok = new URL(req.url, 'http://localhost').pathname === '/ws';
    if (ok && origin) {
      try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
    }
    if (!ok) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      lobby.connect(ws);
    });
  });

  // drop connections that stopped answering (phone went to sleep, wifi lost, ...)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20_000);
  heartbeat.unref();

  return {
    server,
    lobby,
    listen: (port, host) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(heartbeat);
      lobby.close();
      for (const ws of wss.clients) ws.terminate();
      server.close(() => resolve());
    }),
  };
}
