const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function broadcast(room, message, excludeWs = null) {
  room.members.forEach(member => {
    if (member !== excludeWs && member.readyState === WebSocket.OPEN) {
      member.send(JSON.stringify(message));
    }
  });
}

wss.on('connection', (ws) => {
  ws.roomId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.action) {
      case 'create': {
        const roomId = generateRoomId();
        rooms[roomId] = { host: ws, members: new Set([ws]), state: { time: 0, playing: false } };
        ws.roomId = roomId;
        ws.isHost = true;
        ws.send(JSON.stringify({ action: 'created', roomId }));
        break;
      }
      case 'join': {
        const room = rooms[msg.roomId];
        if (!room) { ws.send(JSON.stringify({ action: 'error', message: 'Room not found' })); return; }
        room.members.add(ws);
        ws.roomId = msg.roomId;
        ws.isHost = false;
        ws.send(JSON.stringify({ action: 'joined', roomId: msg.roomId, state: room.state }));
        broadcast(room, { action: 'userJoined', count: room.members.size }, ws);
        break;
      }
      case 'play': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.state = { time: msg.time, playing: true };
        broadcast(room, { action: 'play', time: msg.time }, ws);
        break;
      }
      case 'pause': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.state = { time: msg.time, playing: false };
        broadcast(room, { action: 'pause', time: msg.time }, ws);
        break;
      }
      case 'seek': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.state.time = msg.time;
        broadcast(room, { action: 'seek', time: msg.time }, ws);
        break;
      }
      case 'chat': {
        const room = rooms[ws.roomId];
        if (!room) return;
        broadcast(room, { action: 'chat', name: msg.name || 'Guest', text: msg.text, time: Date.now() }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms[ws.roomId];
    if (!room) return;
    room.members.delete(ws);
    if (room.members.size === 0) {
      delete rooms[ws.roomId];
    } else if (ws.isHost) {
      const newHost = room.members.values().next().value;
      newHost.isHost = true;
      room.host = newHost;
      newHost.send(JSON.stringify({ action: 'promoted', message: 'You are now the host' }));
      broadcast(room, { action: 'hostChanged' }, newHost);
    } else {
      broadcast(room, { action: 'userLeft', count: room.members.size });
    }
  });
});

console.log(`WatchSync server running on port ${PORT}`);
