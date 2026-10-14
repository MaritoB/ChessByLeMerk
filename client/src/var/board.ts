// Tablero 8x8 generico para variantes (Royale con encogimiento, Skills, etc.).
// Reutiliza la nomenclatura clasica a1..h8 pero permite casillas inactivas
// (que actuan como muros) y estado extra por pieza (escudo, carga...).

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  /** Identidad estable (no cambia al mover/clonar). */
  id: number;
  type: PieceType;
  color: Color;
  /** Peon: escudo activo (fijo en su casilla e imbatible). */
  shield?: boolean;
  /** Peon: ya gasto su unico punto de habilidad. */
  skillUsed?: boolean;
  /** Pieza guarecida dentro de una torre. */
  cargo?: Piece;
  /** Pieza montada encima de un caballo (jinete). */
  rider?: Piece;
}

export interface Cell {
  f: number;
  r: number;
}

/** Disparo cargado de un alfil (longshot): acierta una sola casilla. */
export interface Arrow {
  id: number;
  color: Color;
  /** id de la pieza que dispara (alfil). */
  shooterId: number;
  /** Casilla original del disparador (debe quedarse quieto). */
  anchor: Cell;
  /** Casilla actual del disparador. */
  origin: Cell;
  target: Cell;
  turnsLeft: number;
}

export type Action =
  | { kind: 'move'; from: Cell; to: Cell; promotion?: PieceType }
  | { kind: 'retreat'; from: Cell; to: Cell }
  | { kind: 'longshot'; from: Cell; to: Cell }
  | { kind: 'shelter'; from: Cell; to: Cell }
  | { kind: 'unshelter'; from: Cell; to: Cell }
  | { kind: 'spawn'; from: Cell; to: Cell }
  | { kind: 'ride'; from: Cell; to: Cell }
  | { kind: 'dismount'; from: Cell; to: Cell; promotion?: PieceType }
  | { kind: 'pawnPush'; from: Cell }
  | { kind: 'transform'; from: Cell; to: Cell; into: PieceType }
  | { kind: 'shield'; from: Cell }
  | { kind: 'unshield'; from: Cell };

export const SIZE = 8;
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

const KNIGHT_DELTAS: Cell[] = [
  { f: 1, r: 2 },
  { f: 2, r: 1 },
  { f: 2, r: -1 },
  { f: 1, r: -2 },
  { f: -1, r: -2 },
  { f: -2, r: -1 },
  { f: -2, r: 1 },
  { f: -1, r: 2 },
];
const KING_DELTAS: Cell[] = [
  { f: 1, r: 0 },
  { f: 1, r: 1 },
  { f: 0, r: 1 },
  { f: -1, r: 1 },
  { f: -1, r: 0 },
  { f: -1, r: -1 },
  { f: 0, r: -1 },
  { f: 1, r: -1 },
];
export const DIAGONAL_DIRS: Cell[] = [
  { f: 1, r: 1 },
  { f: 1, r: -1 },
  { f: -1, r: 1 },
  { f: -1, r: -1 },
];
export const ORTHO_DIRS: Cell[] = [
  { f: 1, r: 0 },
  { f: -1, r: 0 },
  { f: 0, r: 1 },
  { f: 0, r: -1 },
];
export const ALL_DIRS: Cell[] = [...DIAGONAL_DIRS, ...ORTHO_DIRS];
export const KNIGHT_OFFSETS = KNIGHT_DELTAS;
export const KING_OFFSETS = KING_DELTAS;

export function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < SIZE && r >= 0 && r < SIZE;
}

export function squareName(cell: Cell): string {
  return `${FILES[cell.f]}${cell.r + 1}`;
}

export function cellFromName(name: string): Cell {
  return { f: name.charCodeAt(0) - 97, r: name.charCodeAt(1) - 49 };
}

export function isLight(cell: Cell): boolean {
  return (cell.f + cell.r) % 2 === 1;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.f === b.f && a.r === b.r;
}

export function cellKey(cell: Cell): string {
  return `${cell.f},${cell.r}`;
}
