// YGO Duel WebSocket Relay Server
// Lightweight relay for game data — bypasses all NAT/firewall issues
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const rooms = new Map(); // roomCode → { host: ws, guest: ws }

const wss = new WebSocketServer({ port: PORT });
console.log(`YGO Relay listening on port ${PORT}`);

wss.on('connection', (ws) => {
  let role = null;  // 'host' or 'guest'
  let roomCode = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create': {
        // Host creates a room
        roomCode = msg.room;
        if (!roomCode || rooms.has(roomCode)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room code taken' }));
          return;
        }
        rooms.set(roomCode, { host: ws, guest: null });
        role = 'host';
        ws.send(JSON.stringify({ type: 'created', room: roomCode }));
        console.log(`Room ${roomCode} created`);
        break;
      }
      case 'join': {
        // Guest joins a room
        roomCode = msg.room;
        const room = rooms.get(roomCode);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (room.guest) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
          return;
        }
        room.guest = ws;
        role = 'guest';
        ws.send(JSON.stringify({ type: 'joined', room: roomCode }));
        // Notify host
        if (room.host && room.host.readyState === 1) {
          room.host.send(JSON.stringify({ type: 'guest-joined' }));
        }
        console.log(`Guest joined room ${roomCode}`);
        break;
      }
      case 'relay': {
        // Relay game data to the other player
        const room = rooms.get(roomCode);
        if (!room) return;
        const target = role === 'host' ? room.guest : room.host;
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'relay', data: msg.data }));
        }
        break;
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (role === 'host') {
      // Notify guest and clean up
      if (room.guest && room.guest.readyState === 1) {
        room.guest.send(JSON.stringify({ type: 'host-disconnected' }));
      }
      rooms.delete(roomCode);
      console.log(`Room ${roomCode} closed (host left)`);
    } else if (role === 'guest') {
      room.guest = null;
      if (room.host && room.host.readyState === 1) {
        room.host.send(JSON.stringify({ type: 'guest-disconnected' }));
      }
      console.log(`Guest left room ${roomCode}`);
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// Heartbeat: detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));
