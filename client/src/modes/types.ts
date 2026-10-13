import type { Chess, Color } from 'chess.js';
import type { GameModeId } from '@shared/protocol';

/**
 * Contrato que define cada variante de ajedrez.
 * Para anadir una variante nueva basta con crear un objeto que lo cumpla
 * y registrarlo en modes/index.ts. Todo lo demas (lobby, red, UI) es generico.
 */
export interface GameMode {
  id: GameModeId;
  name: string;
  tagline: string;
  description: string;
  emoji: string;

  /** Como introduce el jugador las jugadas. */
  input: 'board' | 'voice';

  /** Si se dibuja el tablero (falso = ajedrez ciego). */
  showBoard: boolean;

  /** Vidas por jugador (Infinity = no aplica). */
  lives: number;

  /** Si un intento ilegal cuesta una vida y revela el tablero. */
  penaltyOnIllegal: boolean;

  /** Cuanto tiempo (ms) se revela el tablero tras un fallo. */
  penaltyRevealMs: number;

  /** Que casillas ve el jugador (64 posiciones, a1=0..h8=63). */
  computeVisible(chess: Chess, viewer: Color): boolean[];
}
