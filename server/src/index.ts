import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type {
  Ack,
  CreateRoomPayload,
  GameModeId,
  JoinRoomPayload,
  PeerInfo,
  RejoinPayload,
  RoomInfo,
  RtcSignal,
  SessionIdentity,
} from '../../shared/protocol';
import { MODE_MAX_PLAYERS } from '../../shared/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

/** Tiempo que se reserva el asiento de un jugador desconectado. */
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 60_000);

interface Player {
  /** Identidad estable (no cambia al reconectar). */
  id: string;
  name: string;
  isHost: boolean;
  /** Socket actual del jugador. */
  socketId: string;
  /** Token secreto para permitir la reconexion. */
  secret: string;
  disconnected: boolean;
  timer?: ReturnType<typeof setTimeout>;
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

function peerInfo(p: Player): PeerInfo {
  return { id: p.id, name: p.name, isHost: p.isHost, connected: !p.disconnected };
}

function playersList(room: Room): PeerInfo[] {
  return [...room.players.values()].map(peerInfo);
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
    (payload: CreateRoomPayload, ack: (res: Ack<{ roomId: string } & SessionIdentity>) => void) => {
      const id = makeCode();
      const hostName = (payload.hostName || 'Anfitrion').slice(0, 24);
      const playerId = randomUUID();
      const secret = randomUUID();
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
      room.players.set(playerId, {
        id: playerId,
        name: hostName,
        isHost: true,
        socketId: socket.id,
        secret,
        disconnected: false,
      });
      socket.join(`room:${id}`);
      socket.data.roomId = id;
      socket.data.playerId = playerId;
      rooms.set(id, room);
      io.to(`room:${id}`).emit('room:players', playersList(room));
      io.emit('rooms:update', listPublic());
      ack({ ok: true, data: { roomId: id, playerId, secret } });
    },
  );

  socket.on(
    'rooms:join',
    (
      payload: JoinRoomPayload,
      ack: (res: Ack<{ roomId: string; host: PeerInfo; mode: GameModeId } & SessionIdentity>) => void,
    ) => {
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
      const playerId = randomUUID();
      const secret = randomUUID();
      const player: Player = {
        id: playerId,
        name,
        isHost: false,
        socketId: socket.id,
        secret,
        disconnected: false,
      };
      room.players.set(playerId, player);
      socket.join(`room:${id}`);
      socket.data.roomId = id;
      socket.data.playerId = playerId;
      room.status = room.players.size >= room.maxPlayers ? 'playing' : 'waiting';

      const host = [...room.players.values()].find((p) => p.isHost)!;
      const hostInfo = peerInfo(host);

      socket.emit('room:joined', { roomId: id, me: peerInfo(player), host: hostInfo, mode: room.mode });
      io.to(host.socketId).emit('room:peer-joined', { peer: peerInfo(player) });
      io.to(`room:${id}`).emit('room:players', playersList(room));
      io.emit('rooms:update', listPublic());
      ack({ ok: true, data: { roomId: id, host: hostInfo, mode: room.mode, playerId, secret } });
    },
  );

  // El invitado avisa de que esta listo para recibir la oferta.
  socket.on('rtc:hello', (msg: { to: string }) => {
    relayToPlayer(msg?.to, 'rtc:hello', {});
  });

  socket.on('rtc:signal', (msg: { to: string; data: RtcSignal }) => {
    relayToPlayer(msg?.to, 'rtc:signal', { data: msg?.data });
  });

  socket.on('rooms:rejoin', (payload: RejoinPayload, ack: (res: Ack<{ roomId: string; host: PeerInfo; mode: GameModeId; players: PeerInfo[] }>) => void) => {
    const id = (payload?.roomId || '').trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) return ack({ ok: false, error: 'La sala ya no existe' });
    const player = room.players.get(payload?.playerId);
    if (!player || player.secret !== payload?.secret) {
      return ack({ ok: false, error: 'No se pudo reconectar a la sala' });
    }
    if (player.timer) {
      clearTimeout(player.timer);
      player.timer = undefined;
    }
    player.socketId = socket.id;
    player.disconnected = false;
    socket.join(`room:${id}`);
    socket.data.roomId = id;
    socket.data.playerId = player.id;

    const host = [...room.players.values()].find((p) => p.isHost)!;
    socket.to(`room:${id}`).emit('room:peer-reconnected', {
      peerId: player.id,
      name: player.name,
      isHost: player.isHost,
    });
    io.to(`room:${id}`).emit('room:players', playersList(room));
    io.emit('rooms:update', listPublic());
    ack({
      ok: true,
      data: { roomId: id, host: peerInfo(host), mode: room.mode, players: playersList(room) },
    });
  });

  socket.on('rooms:leave', () => removePlayer(true));

  socket.on('disconnect', () => removePlayer(false));

  /** Reenvia un mensaje de senalizacion al socket actual del jugador destino. */
  function relayToPlayer(targetPlayerId: string, event: string, extra: object) {
    if (!targetPlayerId) return;
    const roomId: string | undefined = socket.data.roomId;
    const fromId: string | undefined = socket.data.playerId;
    if (!roomId || !fromId) return;
    const room = rooms.get(roomId);
    const target = room?.players.get(targetPlayerId);
    if (!target || target.disconnected) return;
    io.to(target.socketId).emit(event, { from: fromId, ...extra });
  }

  /**
   * Saca al jugador de la sala. Con `immediate` (salida explicita) se elimina
   * al instante; si no, se respeta el periodo de gracia para reconectar.
   */
  function removePlayer(immediate: boolean) {
    const id: string | undefined = socket.data.roomId;
    const playerId: string | undefined = socket.data.playerId;
    socket.data.roomId = undefined;
    socket.data.playerId = undefined;
    if (!id || !playerId) return;
    const room = rooms.get(id);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player || player.socketId !== socket.id) return; // socket viejo, ignorar
    socket.leave(`room:${id}`);

    if (!immediate) {
      player.disconnected = true;
      socket.to(`room:${id}`).emit('room:peer-disconnected', { peerId: player.id, name: player.name });
      io.emit('rooms:update', listPublic());
      player.timer = setTimeout(() => dropPlayer(id, playerId), RECONNECT_GRACE_MS);
      return;
    }
    dropPlayer(id, playerId);
  }

  function dropPlayer(roomId: string, playerId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.get(playerId);
    if (player?.timer) clearTimeout(player.timer);
    room.players.delete(playerId);
    io.to(`room:${roomId}`).emit('room:peer-left', { peerId: playerId });
    if (room.players.size === 0) {
      rooms.delete(roomId);
    } else {
      room.status = room.players.size >= room.maxPlayers ? 'playing' : 'waiting';
      io.to(`room:${roomId}`).emit('room:players', playersList(room));
    }
    io.emit('rooms:update', listPublic());
  }
});

server.listen(PORT, () => {
  console.log(`[chess] Lobby/signaling server escuchando en http://0.0.0.0:${PORT}`);
});
