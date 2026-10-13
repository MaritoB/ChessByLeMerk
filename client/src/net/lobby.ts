import type { Socket } from 'socket.io-client';
import type {
  Ack,
  CreateRoomPayload,
  GameModeId,
  JoinRoomPayload,
  PeerInfo,
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
): Promise<{ ok: boolean; roomId?: string; error?: string }> {
  return new Promise((resolve) => {
    socket.emit('rooms:create', payload, (res: Ack<{ roomId: string }>) => {
      resolve({ ok: res.ok, roomId: res.data?.roomId, error: res.error });
    });
  });
}

export function joinRoom(
  socket: Socket,
  payload: JoinRoomPayload,
): Promise<{ ok: boolean; roomId?: string; host?: PeerInfo; mode?: GameModeId; error?: string }> {
  return new Promise((resolve) => {
    socket.emit(
      'rooms:join',
      payload,
      (res: Ack<{ roomId: string; host: PeerInfo; mode: GameModeId }>) => {
        resolve({
          ok: res.ok,
          roomId: res.data?.roomId,
          host: res.data?.host,
          mode: res.data?.mode,
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
