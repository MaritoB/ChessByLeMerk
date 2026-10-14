// Protocolo compartido entre cliente y servidor.
// Contiene los tipos del lobby (señalizacion) y de los mensajes que viajan
// por el canal de datos WebRTC (peer-to-peer).

export type GameModeId =
  | 'standard'
  | 'fogOfWar'
  | 'blindVoice'
  | 'royale'
  | 'skills'
  | 'fourFFA'
  | 'fourTeams';

export type PieceColor = 'w' | 'b';

export interface RoomInfo {
  id: string;
  name: string;
  hostName: string;
  mode: GameModeId;
  isPrivate: boolean;
  hasPassword: boolean;
  status: 'waiting' | 'playing';
  playerCount: number;
  maxPlayers: number;
}

export interface CreateRoomPayload {
  name: string;
  hostName: string;
  mode: GameModeId;
  isPrivate: boolean;
  password?: string;
}

export interface JoinRoomPayload {
  roomId: string;
  playerName: string;
  password?: string;
}

export interface Ack<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface PeerInfo {
  id: string;
  name: string;
  isHost: boolean;
  /** false si el jugador se desconecto y esta dentro del periodo de gracia. */
  connected?: boolean;
}

/** Identidad estable de un jugador en una sala (para reconectar). */
export interface SessionIdentity {
  playerId: string;
  secret: string;
}

export interface RejoinPayload {
  roomId: string;
  playerId: string;
  secret: string;
}

/** Eventos de presencia de jugadores (reconexion). */
export interface PeerPresenceEvent {
  peerId: string;
  name?: string;
  isHost?: boolean;
}

// -------- Senalizacion WebRTC --------
// Tipos propios (sin depender de los tipos DOM) para poder compartirlos
// entre el cliente (navegador) y el servidor (Node).

export interface SessionDescriptionLike {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidateLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface SdpSignal {
  kind: 'offer' | 'answer';
  sdp: SessionDescriptionLike;
}

export interface IceSignal {
  kind: 'ice';
  candidate: IceCandidateLike;
}

export type RtcSignal = SdpSignal | IceSignal;

// -------- Mensajes del canal de datos (juego) --------

export interface StartMsg {
  type: 'start';
  mode: GameModeId;
  white: 'host' | 'guest';
  startFen?: string;
  timeControl?: { initial: number; increment: number };
}

export interface MoveMsg {
  type: 'move';
  from: string;
  to: string;
  promotion?: string;
  san?: string;
}

export interface ResignMsg {
  type: 'resign';
  by: PieceColor;
}

/** Un fallo (jugada ilegal) que cuesta una vida en modos con vidas. */
export interface MistakeMsg {
  type: 'mistake';
  by: PieceColor;
}

export interface RematchMsg {
  type: 'rematch';
}

export interface RestartMsg {
  type: 'restart';
  startFen?: string;
}

/** Cancela la partida (p. ej. nadie hizo la primera jugada a tiempo). */
export interface AbortMsg {
  type: 'abort';
}

export interface ChatMsg {
  type: 'chat';
  text: string;
}

export type NetMessage =
  | StartMsg
  | MoveMsg
  | ResignMsg
  | MistakeMsg
  | RematchMsg
  | RestartMsg
  | AbortMsg
  | ChatMsg;

export const MAX_PLAYERS_PER_ROOM = 4;

/** Numero maximo de jugadores segun el modo. */
export const MODE_MAX_PLAYERS: Record<GameModeId, number> = {
  standard: 2,
  fogOfWar: 2,
  blindVoice: 2,
  royale: 2,
  skills: 2,
  fourFFA: 4,
  fourTeams: 4,
};
