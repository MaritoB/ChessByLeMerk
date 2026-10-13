import { Chess } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';

export type { Color, Move, PieceSymbol, Square };
export { Chess };

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export interface BoardPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export function fileOf(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

export function rankOf(sq: Square): number {
  return sq.charCodeAt(1) - 49;
}

export function squareIndex(sq: Square): number {
  return rankOf(sq) * 8 + fileOf(sq);
}

export function squareFromIndex(i: number): Square {
  return `${FILES[i % 8]}${Math.floor(i / 8) + 1}` as Square;
}

export function isLightSquare(sq: Square): boolean {
  return (fileOf(sq) + rankOf(sq)) % 2 === 1;
}

export function isBoardSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value);
}

/** Devuelve 64 casillas indexadas de a1=0 a h8=63. */
export function boardFromChess(chess: Chess): (BoardPiece | null)[] {
  const out: (BoardPiece | null)[] = new Array(64).fill(null);
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) {
        out[squareIndex(cell.square)] = {
          square: cell.square,
          type: cell.type,
          color: cell.color,
        };
      }
    }
  }
  return out;
}

export function cloneChess(chess: Chess): Chess {
  return new Chess(chess.fen());
}

export function legalMoves(chess: Chess): Move[] {
  return chess.moves({ verbose: true }) as unknown as Move[];
}

export interface GameOutcome {
  over: boolean;
  winner: Color | 'draw' | null;
  reason: string;
}

export function gameStatus(chess: Chess): GameOutcome {
  if (chess.isCheckmate()) {
    return { over: true, winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'Jaque mate' };
  }
  if (chess.isStalemate()) return { over: true, winner: 'draw', reason: 'Rey ahogado' };
  if (chess.isInsufficientMaterial()) {
    return { over: true, winner: 'draw', reason: 'Material insuficiente' };
  }
  if (chess.isThreefoldRepetition()) {
    return { over: true, winner: 'draw', reason: 'Triple repeticion' };
  }
  if (chess.isDraw()) return { over: true, winner: 'draw', reason: 'Tablas' };
  return { over: false, winner: null, reason: '' };
}

export function opponentColor(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export function isMyTurn(turn: Color, viewer: Color | 'both'): boolean {
  return viewer === 'both' || turn === viewer;
}
