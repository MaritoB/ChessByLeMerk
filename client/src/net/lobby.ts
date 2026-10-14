import type { Socket } from 'socket.io-client';
import type {
  Ack,
  CreateRoomPayload,
  GameModeId,
  JoinRoomPayload,
  PeerInfo,
  RejoinPayload,
  RoomInfo,
} from '@shared/protocol';

export function listRooms(socket: Socket): Promise<RoomInfo[]> {
  return new Promise((resolve) => {
    socket.emit('rooms:list', (res: Ack<RoomInfo[]>) => {
      resolve(res.ok && res.data ? res.data : []);
    });
  });
}

export function createRoom(
  socket: Socket,
  payload: CreateRoomPayload,
): Promise<{ ok: boolean; roomId?: string; playerId?: string; secret?: string; error?: string }> {
  return new Promise((resolve) => {
    socket.emit(
      'rooms:create',
      payload,
      (res: Ack<{ roomId: string; playerId: string; secret: string }>) => {
        resolve({
          ok: res.ok,
          roomId: res.data?.roomId,
          playerId: res.data?.playerId,
          secret: res.data?.secret,
          error: res.error,
        });
      },
    );
  });
}

export function joinRoom(
  socket: Socket,
  payload: JoinRoomPayload,
): Promise<{
  ok: boolean;
  roomId?: string;
  playerId?: string;
  secret?: string;
  host?: PeerInfo;
  mode?: GameModeId;
  error?: string;
}> {
  return new Promise((resolve) => {
    socket.emit(
      'rooms:join',
      payload,
      (res: Ack<{ roomId: string; host: PeerInfo; mode: GameModeId; playerId: string; secret: string }>) => {
        resolve({
          ok: res.ok,
          roomId: res.data?.roomId,
          playerId: res.data?.playerId,
          secret: res.data?.secret,
          host: res.data?.host,
          mode: res.data?.mode,
          error: res.error,
        });
      },
    );
  });
}

export function rejoinRoom(
  socket: Socket,
  payload: RejoinPayload,
): Promise<{ ok: boolean; host?: PeerInfo; mode?: GameModeId; players?: PeerInfo[]; error?: string }> {
  return new Promise((resolve) => {
    socket.emit(
      'rooms:rejoin',
      payload,
      (res: Ack<{ roomId: string; host: PeerInfo; mode: GameModeId; players: PeerInfo[] }>) => {
        resolve({
          ok: res.ok,
          host: res.data?.host,
          mode: res.data?.mode,
          players: res.data?.players,
          error: res.error,
        });
      },
    );
  });
}

export function onRoomsUpdate(socket: Socket, cb: (rooms: RoomInfo[]) => void): () => void {
  socket.on('rooms:update', cb);
  return () => socket.off('rooms:update', cb);
}
