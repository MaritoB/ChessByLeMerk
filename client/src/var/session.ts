import type { Action, Color } from './board';
import type { VarChess } from './engine';
import type { TimeControl } from '../game/clock';

export interface VarConfig {
  modeId: 'royale' | 'skills';
  shrinkEvery: number;
  skills: boolean;
  shieldPawns: boolean;
}

/** Abstrae una partida local u online de una variante 8x8 (Royale, Skills). */
export interface VarSession {
  engine: VarChess;
  config: VarConfig;
  myColor: Color | 'all';
  whiteName: string;
  blackName: string;
  online: boolean;
  connected: boolean;
  statusText: string;
  makeAction(action: Action): boolean;
  resign(): void;
  rematch(): void;
  leave(): void;
  subscribe(listener: () => void): () => void;
  roomId?: string;
  timeControl?: TimeControl;
  flag?(side: string): void;
  undo?(): boolean;
}
