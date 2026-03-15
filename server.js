// YGO Duel — Self-hosted PeerJS Signaling Server
// Replaces the unreliable 0.peerjs.com cloud server.
// Handles WebRTC signaling AND relays custom RELAY messages for game data.
const { PeerServer } = require('peer');

const PORT = process.env.PORT || 9000;

const server = PeerServer({
  port: PORT,
  path: '/ygo',
  proxied: true,          // Works behind Render/Heroku reverse proxy
  allow_discovery: false,  // Don't expose peer list
  alive_timeout: 60000,    // 60s heartbeat timeout
  key: 'ygoduel',          // Simple API key
  concurrent_limit: 200,   // Max 200 concurrent peers
});

server.on('connection', (client) => {
  console.log(`Peer connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`Peer disconnected: ${client.getId()}`);
});

server.on('error', (err) => {
  console.error('PeerServer error:', err);
});

console.log(`YGO PeerJS server running on port ${PORT}`);
