let socket = null;

function connectSocket(groupId, token, callbacks) {
  if (socket) socket.disconnect();
  socket = io(COMMON.serverUrl, { transports: ['websocket'] });

  socket.on('connect', () => {
    socket.emit('admin:subscribe', { group_id: groupId, token });
    if (callbacks.onConnect) callbacks.onConnect();
  });

  socket.on('group:' + groupId + ':pc-status', (data) => {
    if (callbacks.onStatus) callbacks.onStatus(data);
  });

  socket.on('group:' + groupId + ':pc-session', (data) => {
    if (callbacks.onSession) callbacks.onSession(data);
  });

  socket.on('admin:history-update', (data) => {
    if (callbacks.onHistory) callbacks.onHistory(data);
  });

  return socket;
}

function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

function getSocket() { return socket; }
