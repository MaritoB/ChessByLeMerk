import type { Chess, Color } from 'chess.js';
import { boardFromChess, type BoardPiece } from './engine';

// Offsets de movimiento/ataque por tipo de pieza.
const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_DELTAS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const ORTHOGONALS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Calcula las casillas que "ve" un color (para Fog of War).
 * Un jugador ve: sus propias piezas + todas las casillas que atacan
 * (incluyendo la casilla de una pieza enemiga, que bloquea la visual).
 */
export function computeVision(chess: Chess, color: Color): boolean[] {
  const view: boolean[] = new Array(64).fill(false);
  const board = boardFromChess(chess);

  const at = (f: number, r: number): BoardPiece | null => {
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return board[r * 8 + f];
  };
  const mark = (f: number, r: number) => {
    view[r * 8 + f] = true;
  };

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || piece.color !== color) continue;

    const f = i % 8;
    const r = Math.floor(i / 8);
    view[i] = true; // las propias piezas siempre visibles

    const rays = (dirs: number[][]) => {
      for (const [df, dr] of dirs) {
        let cf = f + df;
        let cr = r + dr;
        while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
          mark(cf, cr);
          if (at(cf, cr)) break; // algo bloquea la visual
          cf += df;
          cr += dr;
        }
      }
    };

    const jumps = (deltas: number[][]) => {
      for (const [df, dr] of deltas) {
        const cf = f + df;
        const cr = r + dr;
        if (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) mark(cf, cr);
      }
    };

    switch (piece.type) {
      case 'p': {
        const dir = piece.color === 'w' ? 1 : -1;
        for (const df of [-1, 1]) {
          const cf = f + df;
          const cr = r + dir;
          if (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) mark(cf, cr);
        }
        const cr1 = r + dir;
        if (cr1 >= 0 && cr1 < 8) {
          mark(f, cr1);
          const startRank = piece.color === 'w' ? 1 : 6;
          const cr2 = r + dir * 2;
          if (r === startRank && cr2 >= 0 && cr2 < 8 && !at(f, cr1)) mark(f, cr2);
        }
        break;
      }
      case 'n':
        jumps(KNIGHT_DELTAS);
        break;
      case 'k':
        jumps(KING_DELTAS);
        break;
      case 'b':
        rays(DIAGONALS);
        break;
      case 'r':
        rays(ORTHOGONALS);
        break;
      case 'q':
        rays([...DIAGONALS, ...ORTHOGONALS]);
        break;
      default:
        break;
    }
  }

  return view;
}

/** Todas las casillas visibles (modo estandar). */
export function fullVision(): boolean[] {
  return new Array(64).fill(true);
}

/** Ninguna casilla visible (modo ciego). */
export function noVision(): boolean[] {
  return new Array(64).fill(false);
}
