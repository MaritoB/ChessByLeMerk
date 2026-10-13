import type { Color } from 'chess.js';
import type { GameController, MoveResult } from './GameController';
import type { GameMode } from '../modes/types';
import type { TimeControl } from './clock';

/** Abstrae una partida local (mismo dispositivo) u online (P2P). */
export interface GameSession {
  controller: GameController;
  mode: GameMode;
  myColor: Color | 'both';
  opponentName: string;
  statusText: string;
  connected: boolean;
  online: boolean;
  makeMove(from: string, to: string, promotion?: string): MoveResult;
  mistake(reason: string): MoveResult;
  resign(): void;
  rematch(): void;
  leave(): void;
  sendChat?(text: string): void;
  subscribe?(listener: () => void): () => void;
  roomId?: string;
  timeControl?: TimeControl;
  flag?(side: string): void;
  /** Modo sandbox: se pueden mover libremente las piezas de cualquier color. */
  sandbox?: boolean;
}
