import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type {
  Ack,
  CreateRoomPayload,
  GameModeId,
  JoinRoomPayload,
  PeerInfo,
  RoomInfo,
  RtcSignal,
} from '../../shared/protocol';
import { MODE_MAX_PLAYERS } from '../../shared/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

interface Player {
  id: string;
  name: string;
  isHost: boolean;
}

interface Room {
  id: string;
  name: string;
  hostName: string;
  mode: GameModeId;
  isPrivate: boolean;
  password?: string;
  status: 'waiting' | 'playing';
  createdAt: number;
  maxPlayers: number;
  players: Map<string, Player>;
}

const rooms = new Map<string, Room>();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function toInfo(room: Room): RoomInfo {
  return {
    id: room.id,
    name: room.name,
    hostName: room.hostName,
    mode: room.mode,
    isPrivate: room.isPrivate,
    hasPassword: Boolean(room.password),
    status: room.status,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
  };
}

function playersList(room: Room): PeerInfo[] {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, isHost: p.isHost }));
}

function listPublic(): RoomInfo[] {
  return [...rooms.values()]
    .filter((r) => !r.isPrivate)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toInfo);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// Sirve el build del cliente si existe (despliegue "todo en uno").
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('Lobby server de Chess by LeMerk. Cliente no compilado todavia.');
  });
}

io.on('connection', (socket) => {
  socket.emit('rooms:update', listPublic());

  socket.on('rooms:list', (ack: (res: Ack<RoomInfo[]>) => void) => {
    ack({ ok: true, data: listPublic() });
  });

  socket.on(
    'rooms:create',
    (payload: CreateRoomPayload, ack: (res: Ack<{ roomId: string }>) => void) => {
      const id = makeCode();
      const hostName = (payload.hostName || 'Anfitrion').slice(0, 24);
      const room: Room = {
        id,
        name: (payload.name || `Sala de ${hostName}`).slice(0, 40),
        hostName,
        mode: payload.mode,
        isPrivate: Boolean(payload.isPrivate),
        password: payload.password?.trim() || undefined,
        status: 'waiting',
        createdAt: Date.now(),
        maxPlayers: MODE_MAX_PLAYERS[payload.mode] ?? 2,
        players: new Map(),
      };
      room.players.set(socket.id, { id: socket.id, name: hostName, isHost: true });
      socket.join(`room:${id}`);
      socket.data.roomId = id;
      rooms.set(id, room);
      io.to(`room:${id}`).emit('room:players', playersList(room));
      io.emit('rooms:update', listPublic());
      ack({ ok: true, data: { roomId: id } });
    },
  );

  socket.on(
    'rooms:join',
    (payload: JoinRoomPayload, ack: (res: Ack<{ roomId: string; host: PeerInfo; mode: GameModeId }>) => void) => {
      const id = (payload.roomId || '').trim().toUpperCase();
      const room = rooms.get(id);
      if (!room) return ack({ ok: false, error: 'Sala no encontrada' });
      if (room.password && room.password !== (payload.password ?? '')) {
        return ack({ ok: false, error: 'Contrasena incorrecta' });
      }
      if (room.players.size >= room.maxPlayers) {
        return ack({ ok: false, error: 'Sala llena' });
      }
      const name = (payload.playerName || 'Invitado').slice(0, 24);
      const player: Player = { id: socket.id, name, isHost: false };
      room.players.set(socket.id, player);
      socket.join(`room:${id}`);
      socket.data.roomId = id;
      room.status = 'playing';

      const host = [...room.players.values()].find((p) => p.isHost)!;
      const hostInfo: PeerInfo = { id: host.id, name: host.name, isHost: true };

      socket.emit('room:joined', { roomId: id, me: player, host: hostInfo, mode: room.mode });
      io.to(host.id).emit('room:peer-joined', { peer: player });
      io.to(`room:${id}`).emit('room:players', playersList(room));
      io.emit('rooms:update', listPublic());
      ack({ ok: true, data: { roomId: id, host: hostInfo, mode: room.mode } });
    },
  );

  socket.on('rtc:signal', (msg: { to: string; data: RtcSignal }) => {
    if (!msg?.to) return;
    io.to(msg.to).emit('rtc:signal', { from: socket.id, data: msg.data });
  });

  // El invitado avisa de que esta listo para recibir la oferta.
  socket.on('rtc:hello', (msg: { to: string }) => {
    if (!msg?.to) return;
    io.to(msg.to).emit('rtc:hello', { from: socket.id });
  });

  socket.on('rooms:leave', () => leaveRoom());

  socket.on('disconnect', () => leaveRoom());

  function leaveRoom() {
    const id: string | undefined = socket.data.roomId;
    socket.data.roomId = undefined;
    if (!id) return;
    const room = rooms.get(id);
    if (!room) return;
    room.players.delete(socket.id);
    socket.leave(`room:${id}`);
    socket.to(`room:${id}`).emit('room:peer-left', { peerId: socket.id });
    if (room.players.size === 0) {
      rooms.delete(id);
    } else {
      room.status = 'waiting';
    }
    io.emit('rooms:update', listPublic());
  }
});

server.listen(PORT, () => {
  console.log(`[chess] Lobby/signaling server escuchando en http://0.0.0.0:${PORT}`);
});
