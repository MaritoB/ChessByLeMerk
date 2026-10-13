import type { FourChess } from './engine';
import type { FMove, GameFormat, Seat } from './board';
import type { TimeControl } from '../game/clock';

export type SeatNames = Partial<Record<Seat, string>>;

export type FourPhase = 'playing' | 'waiting' | 'connecting' | 'closed';

/** Abstrae una partida de 4 jugadores local u online. */
export interface FourSession {
  engine: FourChess;
  format: GameFormat;
  mySeat: Seat | 'all';
  seatNames: SeatNames;
  online: boolean;
  phase: FourPhase;
  playerCount: number;
  playerTarget: number;
  connected: boolean;
  statusText: string;
  isHost: boolean;
  canStart: boolean;
  start(): void;
  makeMove(move: FMove): boolean;
  resign(): void;
  rematch(): void;
  leave(): void;
  subscribe(listener: () => void): () => void;
  roomId?: string;
  timeControl?: TimeControl;
  flag?(side: string): void;
  abort?(): void;
}
