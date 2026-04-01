const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { JWT_SECRET } = require('../config/constants');
const { _historyCache, _pendingProcs } = require('./socketCache');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(str) {
  return typeof str === 'string' && UUID_REGEX.test(str);
}

module.exports = (io) => {
  io.on('connection', (socket) => {

    socket.on('pc:heartbeat', ({ pc_name, group_id, timestamp }) => {
      if (typeof pc_name !== 'string' || pc_name.length > 100) return;
      if (!isValidUUID(group_id)) return;
      console.log(`[♥] Heartbeat from ${pc_name}`);
    });

    socket.on('pc:status', ({ pc_name, group_id, is_online }) => {
      if (typeof pc_name !== 'string' || pc_name.length > 100) return;
      if (!isValidUUID(group_id)) return;
      if (typeof is_online !== 'boolean') return;
      console.log(`[STATUS] ${pc_name} is ${is_online ? 'online' : 'offline'}`);
      io.to(`group:${group_id}`).emit(`group:${group_id}:pc-status`, {
          pc_id: pc_name,
          is_online
      });
    });

    socket.on('command:refresh-apps', ({ pc_id }) => {
      if (!isValidUUID(pc_id)) return;
      io.to(`pc:${pc_id}`).emit('command:refresh-apps', {});
      console.log(`[APP REFRESH] Requested for PC ${pc_id}`);
    });

    socket.on('pc:auth', async ({ pc_name, group_id, password }, callback) => {
      if (typeof pc_name !== 'string' || pc_name.length > 100 || !pc_name.trim())
        return callback({ success: false, error: 'Invalid PC name' });
      if (!isValidUUID(group_id))
        return callback({ success: false, error: 'Invalid group ID' });
      if (typeof password !== 'string' || password.length > 128)
        return callback({ success: false, error: 'Invalid password' });

      const pc = await db.get('pcs', p => p.name === pc_name && p.group_id === group_id);
      if (!pc || !bcrypt.compareSync(password, pc.password))
        return callback({ success: false, error: 'Invalid PC credentials' });
      socket.join(`pc:${pc.id}`);
      socket.pcId = pc.id;
      socket.groupId = group_id;
      await db.update('pcs', p => p.id === pc.id, { is_online: 1 });
      io.to(`group:${group_id}`).emit(`group:${group_id}:pc-status`, { pc_id: pc.id, is_online: true });
      console.log(`[+] PC "${pc_name}" connected`);
      const now = Math.floor(Date.now()/1000);
      const swStart = (pc.stopwatch_start && pc.stopwatch_start < now) ? pc.stopwatch_start : 0;
      const remAuth = pc.session_end > now ? pc.session_end - now : 0;
      callback({ success: true, pc_id: pc.id, session_end: pc.session_end, stopwatch_start: swStart, remaining_seconds: remAuth });
    });

    socket.on('pc:apps', async ({ apps }) => {
      if (!socket.pcId) return;
      if (!Array.isArray(apps) || apps.length > 500) return;
      await db.delete('installed_apps', a => a.pc_id === socket.pcId);
      for (const a of apps) {
        if (typeof a.name !== 'string' || a.name.length > 200) continue;
        if (typeof a.path !== 'string' || a.path.length > 1000) continue;
        await db.insert('installed_apps', { id: uuidv4(), pc_id: socket.pcId, name: a.name, path: a.path });
      }
    });

    socket.on('admin:subscribe', ({ group_id, token }) => {
      try {
        if (!isValidUUID(group_id)) return;
        jwt.verify(token, JWT_SECRET);
        socket.join(`group:${group_id}`);
        console.log(`[+] Admin subscribed to group:${group_id}`);
      } catch {}
    });

    socket.on('admin:history-update', async ({ group_id, pc_id, history }) => {
      if (!isValidUUID(group_id) || !isValidUUID(pc_id)) return;
      if (!Array.isArray(history) || history.length > 50) return;
      _historyCache[pc_id] = history;
      io.to(`group:${group_id}`).emit('admin:history-update', {
        group_id,
        pc_id,
        history
      });
    });

    socket.on('admin:request-history', async ({ group_id, pc_id }) => {
      if (!isValidUUID(group_id) || !isValidUUID(pc_id)) return;
      if (_historyCache[pc_id]) {
        io.to(`group:${group_id}`).emit('admin:history-update', { group_id, pc_id, history: _historyCache[pc_id] });
      } else {
        const pc = await db.get('pcs', p => p.id === pc_id);
        if (pc) {
          _historyCache[pc_id] = pc.time_history || [];
          io.to(`group:${group_id}`).emit('admin:history-update', { group_id, pc_id, history: pc.time_history || [] });
        }
      }
    });

    socket.on('pc:processes', ({ processes }) => {
      if (!socket.pcId) return;
      if (!Array.isArray(processes)) return;
      if (_pendingProcs[socket.pcId]) {
        _pendingProcs[socket.pcId](processes);
      }
    });

    socket.on('disconnect', async () => {
      if (socket.pcId) {
        await db.update('pcs', p => p.id === socket.pcId, { is_online: 0 });
        if (socket.groupId) {
          io.to(`group:${socket.groupId}`).emit(`group:${socket.groupId}:pc-status`, { pc_id: socket.pcId, is_online: false });
        }
      }
    });
  });
};
