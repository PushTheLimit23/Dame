// Dame – Server
// Liefert die Webseite aus und synchronisiert die Partien per WebSocket.
// Der Server ist die "Wahrheit": Er prüft jeden Zug mit denselben Regeln wie der Browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const R = require('./public/rules.js');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');

// ---------- Spielhistorie (Datei im Volume, überlebt Updates) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const HIST_FILE = path.join(DATA_DIR, 'history.json');
let history = [];
try { history = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); } catch { history = []; }
function saveHistory() {
  if (history.length > 5000) history = history.slice(-5000);
  const tmp = HIST_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(history));
  fs.renameSync(tmp, HIST_FILE);
}

// ---------- Webseite ausliefern ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unbekannte Pfade -> Startseite (z. B. alte Links)
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        res.writeHead(e2 ? 404 : 200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(e2 ? 'Not found' : html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- Räume / Partien ----------
const rooms = new Map();

function newRoom(id) {
  const room = { id, players: [], score: {}, gameNo: 0, seq: 0, status: 'waiting', board: R.initialBoard(),
    turn: 'w', winner: null, reason: null, lastMove: null, moveNo: 0, quiet: 0, rematch: new Set(), lastActive: Date.now() };
  rooms.set(id, room);
  return room;
}

function startGame(room) {
  room.gameNo++;
  room.status = 'playing';
  room.board = R.initialBoard();
  room.turn = 'w';
  room.winner = null;
  room.reason = null;
  room.lastMove = null;
  room.moveNo = 0;
  room.quiet = 0;
  room.rematch = new Set();
}

function finishGame(room, winner, reason) {
  room.status = 'over';
  room.winner = winner; // 'w' | 'b' | 'draw'
  room.reason = reason;
  const byColor = (c) => room.players.find((p) => p.color === c);
  if (winner !== 'draw') {
    const p = byColor(winner);
    if (p) room.score[p.clientId] = (room.score[p.clientId] || 0) + 1;
  }
  const w = byColor('w'), b = byColor('b');
  history.push({ date: new Date().toISOString(), room: room.id, white: w ? w.name : '?', black: b ? b.name : '?',
    ids: { w: w ? w.clientId : null, b: b ? b.clientId : null }, winner, reason, moves: room.moveNo });
  try { saveHistory(); } catch (e) { console.error('Historie konnte nicht gespeichert werden:', e.message); }
}

function stateFor(room, me) {
  return {
    type: 'state', room: room.id, status: room.status, board: room.board, turn: room.turn,
    you: me ? me.color : null,
    players: room.players.map((p) => ({ name: p.name, color: p.color, connected: p.connected, wins: room.score[p.clientId] || 0 })),
    lastMove: room.lastMove, winner: room.winner, reason: room.reason, gameNo: room.gameNo, moveNo: room.moveNo,
    quiet: room.quiet, drawLimit: R.DRAW_LIMIT,
    rematch: [...room.rematch].map((cid) => (room.players.find((p) => p.clientId === cid) || {}).color).filter(Boolean),
  };
}

function broadcast(room) {
  for (const p of room.players) if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(stateFor(room, p)));
}

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
const cleanName = (n) => String(n || '').replace(/[<>]/g, '').trim().slice(0, 20) || 'Gast';

function handle(ws, msg) {
  if (msg.type === 'join') {
    const id = String(msg.room || '').toLowerCase();
    const cid = String(msg.clientId || '').slice(0, 64);
    if (!/^[a-z0-9]{4,16}$/.test(id) || cid.length < 8) return send(ws, { type: 'error', msg: 'Ungültiger Spiel-Link.' });
    const room = rooms.get(id) || newRoom(id);
    let me = room.players.find((p) => p.clientId === cid);
    if (me) {
      if (me.ws && me.ws !== ws && me.ws.readyState === 1) me.ws.close(4000, 'Neu verbunden');
      me.ws = ws; me.connected = true; me.name = cleanName(msg.name);
    } else if (room.players.length < 2) {
      const color = room.players.length === 0 ? 'w' : R.other(room.players[0].color);
      me = { clientId: cid, name: cleanName(msg.name), color, ws, connected: true };
      room.players.push(me);
      if (room.players.length === 2 && room.status === 'waiting') startGame(room);
    } else {
      return send(ws, { type: 'full' });
    }
    ws.room = room; ws.player = me;
    room.lastActive = Date.now();
    return broadcast(room);
  }

  if (msg.type === 'history') {
    const cid = String(msg.clientId || '');
    const games = history.filter((g) => g.ids.w === cid || g.ids.b === cid).slice(-25).reverse()
      .map((g) => ({ date: g.date, white: g.white, black: g.black, winner: g.winner, reason: g.reason, moves: g.moves,
        mine: g.ids.w === cid ? 'w' : 'b' }));
    return send(ws, { type: 'history', games });
  }

  const room = ws.room, me = ws.player;
  if (!room || !me) return;
  room.lastActive = Date.now();

  if (msg.type === 'move') {
    if (room.status !== 'playing' || room.turn !== me.color || !Array.isArray(msg.path)) return;
    const move = R.findMove(room.board, me.color, msg.path.map(Number));
    if (!move) return send(ws, { type: 'error', msg: 'Ungültiger Zug.' });
    const wasKing = R.isKing(room.board[move.path[0]]);
    room.board = R.applyMove(room.board, move);
    room.lastMove = { path: move.path, captures: move.captures, color: me.color, seq: ++room.seq };
    room.moveNo++;
    room.quiet = !move.captures.length && wasKing ? room.quiet + 1 : 0;
    room.turn = R.other(me.color);
    if (R.legalMoves(room.board, room.turn).length === 0) {
      const none = R.countPieces(room.board, room.turn) === 0;
      finishGame(room, me.color, none ? 'Alle Steine geschlagen' : 'Keine Zugmöglichkeit mehr');
    } else if (room.quiet >= R.DRAW_LIMIT) {
      finishGame(room, 'draw', '15 Damezüge je Seite ohne Schlagen');
    }
    return broadcast(room);
  }

  if (msg.type === 'resign') {
    if (room.status !== 'playing') return;
    finishGame(room, R.other(me.color), `${me.name} hat aufgegeben`);
    return broadcast(room);
  }

  if (msg.type === 'rematch') {
    if (room.status !== 'over') return;
    room.rematch.add(me.clientId);
    if (room.players.length === 2 && room.players.every((p) => room.rematch.has(p.clientId))) {
      for (const p of room.players) p.color = R.other(p.color); // Farben tauschen
      startGame(room);
    }
    return broadcast(room);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    try { handle(ws, msg); } catch (e) { console.error('Fehler:', e); }
  });
  ws.on('close', () => {
    const room = ws.room, me = ws.player;
    if (room && me && me.ws === ws) { me.connected = false; me.ws = null; broadcast(room); }
  });
});

// Tote Verbindungen erkennen + verlassene Räume nach 12 h aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  const cutoff = Date.now() - 12 * 3600 * 1000;
  for (const [id, room] of rooms)
    if (room.lastActive < cutoff && room.players.every((p) => !p.connected)) rooms.delete(id);
}, 30000);

server.listen(PORT, () => console.log(`Dame läuft auf Port ${PORT}`));
