// YGO Duel — Custom PeerJS-Compatible Signaling Server
// Implements the PeerJS protocol AND forwards custom RELAY messages.
// The official PeerJS server only forwards OFFER/ANSWER/CANDIDATE,
// dropping our game-data RELAY messages. This server forwards ALL
// messages with a `dst` field.

const http = require('http');
const { WebSocketServer } = require('ws');
const url = require('url');

const PORT = process.env.PORT || 9000;
const KEY = 'ygoduel';

// Map of peerId → WebSocket
const peers = new Map();

// ─── HTTP server (health checks + CORS) ───────────────────

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      peers: peers.size,
      uptime: Math.floor(process.uptime())
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('YGO Duel Signaling Server');
  }
});

// ─── WebSocket server ─────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '';

  // PeerJS client connects to: /ygo/peerjs?key=ygoduel&id=PEER_ID&token=TOKEN
  if (!pathname.endsWith('/peerjs') || parsed.query.key !== KEY) {
    ws.close(4000, 'Invalid path or key');
    return;
  }

  const peerId = parsed.query.id;
  if (!peerId) {
    ws.close(4001, 'Missing peer ID');
    return;
  }

  // If peer ID is already connected, close the old socket (reconnect scenario)
  if (peers.has(peerId)) {
    const old = peers.get(peerId);
    try { old.close(); } catch (e) {}
  }

  peers.set(peerId, ws);
  ws.peerId = peerId;
  ws.isAlive = true;

  // PeerJS protocol: send OPEN to confirm registration
  ws.send(JSON.stringify({ type: 'OPEN' }));

  console.log(`+ ${peerId} (${peers.size} peers)`);

  // ─── Message handling ─────────────────────────────────

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Heartbeat — just acknowledge, don't forward
    if (msg.type === 'HEARTBEAT') {
      return;
    }

    // Forward ANY message with a `dst` field to the destination peer.
    // This handles:
    //   - OFFER, ANSWER, CANDIDATE (WebRTC signaling)
    //   - RELAY (our custom game data relay)
    //   - Any other message type
    if (msg.dst) {
      const dstWs = peers.get(msg.dst);
      if (dstWs && dstWs.readyState === 1) {
        // Stamp `src` so the receiver knows who sent it
        msg.src = peerId;
        dstWs.send(JSON.stringify(msg));
      }
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    // Only delete if this socket is still the registered one
    if (peers.get(peerId) === ws) {
      peers.delete(peerId);
      console.log(`- ${peerId} (${peers.size} peers)`);
    }
  });

  ws.on('error', (err) => {
    console.error(`! ${peerId}: ${err.message}`);
  });
});

// ─── Heartbeat — detect dead connections ──────────────────

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ─── Start ────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`YGO signaling server on port ${PORT}`);
});
