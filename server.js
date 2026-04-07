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

function getRoomMembers(room) {
  return Array.from(room.members).map(m => ({ name: m.userName || 'Guest', color: m.userColor || '#a599ff' }));
}

function getPublicRooms() {
  return Object.entries(rooms)
    .filter(([, r]) => r.isPublic)
    .map(([id, r]) => ({
      roomId: id,
      name: r.name || 'Watch Party',
      site: r.site || 'unknown',
      count: r.members.size,
      createdAt: r.createdAt
    }))
    .sort((a, b) => b.count - a.count);
}

function getSiteFromUrl(url) {
  if (!url) return 'unknown';
  if (url.includes('netflix'))    return 'netflix';
  if (url.includes('youtube'))    return 'youtube';
  if (url.includes('disneyplus')) return 'disney';
  if (url.includes('max.com'))    return 'max';
  if (url.includes('hulu'))       return 'hulu';
  if (url.includes('primevideo')) return 'prime';
  if (url.includes('paramount'))  return 'paramount';
  if (url.includes('peacock'))    return 'peacock';
  return 'other';
}

wss.on('connection', (ws) => {
  ws.roomId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.action) {

      case 'create': {
        const roomId = generateRoomId();
        ws.userName = msg.name || 'Host';
        ws.userColor = msg.color || '#a599ff';
        rooms[roomId] = {
          host: ws,
          members: new Set([ws]),
          state: { time: 0, playing: false, url: msg.url || null },
          name: msg.partyName || 'Watch Party',
          site: getSiteFromUrl(msg.url),
          isPublic: msg.isPublic || false,
          createdAt: Date.now()
        };
        ws.roomId = roomId;
        ws.isHost = true;
        ws.send(JSON.stringify({ action: 'created', roomId }));
        console.log(`Room created: ${roomId} public:${msg.isPublic}`);
        break;
      }

      case 'join': {
        const room = rooms[msg.roomId];
        if (!room) { ws.send(JSON.stringify({ action: 'error', message: 'Room not found' })); return; }
        ws.userName = msg.name || 'Guest';
        ws.userColor = msg.color || '#7c6dfa';
        room.members.add(ws);
        ws.roomId = msg.roomId;
        ws.isHost = false;
        ws.send(JSON.stringify({ action: 'joined', roomId: msg.roomId, state: room.state, members: getRoomMembers(room) }));
        broadcast(room, { action: 'userJoined', count: room.members.size, members: getRoomMembers(room), name: ws.userName }, ws);
        console.log(`${ws.userName} joined ${msg.roomId}`);
        break;
      }

      case 'getLobby': {
        const query = (msg.query || '').toLowerCase();
        const site = msg.site || 'all';
        let results = getPublicRooms();
        if (query) results = results.filter(r => r.name.toLowerCase().includes(query));
        if (site !== 'all') results = results.filter(r => r.site === site);
        ws.send(JSON.stringify({ action: 'lobbyResults', rooms: results.slice(0, 20) }));
        break;
      }

      case 'updatePublic': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.isPublic = msg.isPublic;
        room.name = msg.partyName || room.name;
        ws.send(JSON.stringify({ action: 'publicUpdated', isPublic: room.isPublic }));
        break;
      }

      case 'play': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.state = { ...room.state, time: msg.time, playing: true };
        broadcast(room, { action: 'play', time: msg.time }, ws);
        break;
      }

      case 'pause': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.state = { ...room.state, time: msg.time, playing: false };
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

      case 'updateUrl': {
        const room = rooms[ws.roomId];
        if (!room || !ws.isHost) return;
        room.state.url = msg.url;
        room.state.time = 0;
        room.state.playing = false;
        room.site = getSiteFromUrl(msg.url);
        broadcast(room, { action: 'navigate', url: msg.url }, ws);
        break;
      }

      case 'chat': {
        const room = rooms[ws.roomId];
        if (!room) return;
        broadcast(room, { action: 'chat', name: ws.userName, color: ws.userColor, text: msg.text, time: Date.now() }, ws);
        break;
      }

      case 'reaction': {
        const room = rooms[ws.roomId];
        if (!room) return;
        broadcast(room, { action: 'reaction', emoji: msg.emoji, name: ws.userName }, null);
        break;
      }

      case 'resync': {
        const room = rooms[ws.roomId];
        if (!room) return;
        ws.send(JSON.stringify({ action: room.state.playing ? 'play' : 'pause', time: room.state.time }));
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
      console.log(`Room deleted: ${ws.roomId}`);
    } else if (ws.isHost) {
      const newHost = room.members.values().next().value;
      newHost.isHost = true;
      room.host = newHost;
      newHost.send(JSON.stringify({ action: 'promoted' }));
      broadcast(room, { action: 'userLeft', count: room.members.size, members: getRoomMembers(room), name: ws.userName }, newHost);
    } else {
      broadcast(room, { action: 'userLeft', count: room.members.size, members: getRoomMembers(room), name: ws.userName });
    }
  });
});

console.log(`WatchSync server running on port ${PORT}`);
