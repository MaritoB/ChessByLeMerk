// Tablero 8x8 generico para variantes (Royale con encogimiento, Skills, etc.).
// Reutiliza la nomenclatura clasica a1..h8 pero permite casillas inactivas
// (que actuan como muros) y estado extra por pieza (armadura, carga...).

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  type: PieceType;
  color: Color;
  /** Armadura (peon). */
  shield?: boolean;
  /** Pieza guarecida dentro (torre). */
  cargo?: Piece;
  /** Jinete encima (peon subido a un caballo). */
  rider?: Piece;
  /** Si es un arquero a caballo (alfil montado): su modo. */
  archer?: 'tower' | 'archer';
  /** La torre tiene un alfil dentro que aun puede disparar una flecha. */
  cargoArrow?: boolean;
}

export interface Cell {
  f: number;
  r: number;
}

export type ArrowMode = 'fast' | 'guided' | 'piercing';

export interface Arrow {
  id: number;
  color: Color;
  mode: ArrowMode;
  /** Direccion (para fast/piercing): delta unitario. */
  dir?: Cell;
  /** Objetivo concreto (para guided). */
  target?: Cell;
  /** Origen (el alfil). */
  origin: Cell;
  turnsLeft: number;
}

export type Action =
  | { kind: 'move'; from: Cell; to: Cell; promotion?: PieceType }
  | { kind: 'retreat'; from: Cell; to: Cell }
  | { kind: 'arrow'; from: Cell; mode: ArrowMode; dir?: Cell; target?: Cell }
  | { kind: 'shelter'; from: Cell; target: Cell }
  | { kind: 'swap'; from: Cell; to: Cell }
  | { kind: 'convert'; from: Cell; to: Cell }
  | { kind: 'mount'; from: Cell; to: Cell; mode: 'tower' | 'archer' }
  | { kind: 'enterRook'; from: Cell; to: Cell; choice: 'queen' | 'shelter' }
  | { kind: 'ride'; from: Cell; to: Cell }
  | { kind: 'unshelter'; from: Cell; to: Cell }
  | { kind: 'pawnPush'; from: Cell }
  | { kind: 'transform'; from: Cell; to: Cell; into: PieceType }
  | { kind: 'warcry'; from: Cell }
  | { kind: 'defense'; block: boolean };

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
