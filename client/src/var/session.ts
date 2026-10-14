import type { Action, Color } from './board';
import type { VarChess } from './engine';
import type { TimeControl } from '../game/clock';

export interface VarConfig {
  modeId: 'royale' | 'skills';
  shrinkEvery: number;
  skills: boolean;
  /** Niebla de guerra: solo ves tus piezas y lo que atacan. */
  fog: boolean;
  shieldPawns: boolean;
}

/** Etiqueta legible segun los modificadores activos. */
export function varLabel(config: VarConfig): string {
  const parts: string[] = [];
  if (config.skills) parts.push('Skills');
  if (config.shrinkEvery > 0) parts.push('Royale');
  if (config.fog) parts.push('Niebla');
  return parts.length ? parts.join(' + ') : 'Variante 8x8';
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
  abort?(): void;
}
