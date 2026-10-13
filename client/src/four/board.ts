// Geometria y definiciones del ajedrez de 4 jugadores (estilo chess.com).
//
// Tablero: rejilla de 14x14 a la que se le quitan las cuatro esquinas de 3x3,
// resultando una cruz de 160 casillas. El centro de 8x8 es jugable y cada
// jugador tiene un brazo de 8x3.

export type Seat = 'red' | 'blue' | 'yellow' | 'green';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type GameFormat = 'ffa' | 'teams';

export interface Piece {
  type: PieceType;
  seat: Seat;
}

export interface Cell {
  f: number;
  r: number;
}

export interface FMove {
  from: Cell;
  to: Cell;
  promotion?: PieceType;
}

export const SIZE = 14;
export const FILES = 'abcdefghijklmn'.split('');

export const SEAT_ORDER: Seat[] = ['red', 'blue', 'yellow', 'green'];

export const BASE_BACK_TYPES: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export interface SeatMeta {
  seat: Seat;
  label: string;
  color: string;
  /** Direccion de avance de los peones. */
  forward: Cell;
  /** Direcciones de captura de los peones. */
  captures: Cell[];
  /** Casillas iniciales de los peones. */
  startPawns: Cell[];
  /** Casilla inicial de cada pieza de la fila trasera (mismo orden que BASE_BACK_TYPES). */
  backRank: Cell[];
  /** Compañero de equipo (asientos opuestos). */
  partner: Seat;
  /** Comprobacion de fila de coronacion. */
  isPromotion: (f: number, r: number) => boolean;
  /** Comprobacion de fila de peon sin mover (para el avance doble). */
  isPawnStart: (f: number, r: number) => boolean;
}

/** Rota una coordenada del asiento "red" (abajo) al asiento indicado. */
function rotate(seat: Seat, f: number, r: number): Cell {
  switch (seat) {
    case 'red':
      return { f, r };
    case 'yellow':
      return { f: 13 - f, r: 13 - r };
    case 'blue':
      return { f: r, r: 13 - f };
    case 'green':
      return { f: 13 - r, r: f };
  }
}

function buildSeat(seat: Seat): SeatMeta {
  const backRank: Cell[] = [];
  const startPawns: Cell[] = [];
  for (let i = 0; i < 8; i++) backRank.push(rotate(seat, 3 + i, 0));
  for (let i = 0; i < 8; i++) startPawns.push(rotate(seat, 3 + i, 1));

  const forwardMap: Record<Seat, Cell> = {
    red: { f: 0, r: 1 },
    yellow: { f: 0, r: -1 },
    blue: { f: 1, r: 0 },
    green: { f: -1, r: 0 },
  };
  const captureMap: Record<Seat, Cell[]> = {
    red: [
      { f: -1, r: 1 },
      { f: 1, r: 1 },
    ],
    yellow: [
      { f: -1, r: -1 },
      { f: 1, r: -1 },
    ],
    blue: [
      { f: 1, r: -1 },
      { f: 1, r: 1 },
    ],
    green: [
      { f: -1, r: -1 },
      { f: -1, r: 1 },
    ],
  };
  const partnerMap: Record<Seat, Seat> = {
    red: 'yellow',
    yellow: 'red',
    blue: 'green',
    green: 'blue',
  };
  const labelMap: Record<Seat, string> = {
    red: 'Rojo',
    blue: 'Azul',
    yellow: 'Amarillo',
    green: 'Verde',
  };
  const colorMap: Record<Seat, string> = {
    red: '#e2564b',
    blue: '#4f7fe0',
    yellow: '#e6c14a',
    green: '#55b86a',
  };

  const isPromotion = (f: number, r: number): boolean => {
    switch (seat) {
      case 'red':
        return r === 7;
      case 'yellow':
        return r === 6;
      case 'blue':
        return f === 7;
      case 'green':
        return f === 6;
    }
  };
  const isPawnStart = (f: number, r: number): boolean => {
    switch (seat) {
      case 'red':
        return r === 1;
      case 'yellow':
        return r === 12;
      case 'blue':
        return f === 1;
      case 'green':
        return f === 12;
    }
  };

  return {
    seat,
    label: labelMap[seat],
    color: colorMap[seat],
    forward: forwardMap[seat],
    captures: captureMap[seat],
    startPawns,
    backRank,
    partner: partnerMap[seat],
    isPromotion,
    isPawnStart,
  };
}

export const SEATS: Record<Seat, SeatMeta> = {
  red: buildSeat('red'),
  blue: buildSeat('blue'),
  yellow: buildSeat('yellow'),
  green: buildSeat('green'),
};

export function isPlayable(f: number, r: number): boolean {
  if (f < 0 || f >= SIZE || r < 0 || r >= SIZE) return false;
  return !((f < 3 || f > 10) && (r < 3 || r > 10));
}

export function squareName(cell: Cell): string {
  return `${FILES[cell.f]}${cell.r + 1}`;
}

export function isLightSquare(cell: Cell): boolean {
  return (cell.f + cell.r) % 2 === 1;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.f === b.f && a.r === b.r;
}

export function sameMove(a: FMove, b: FMove): boolean {
  return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.promotion === b.promotion;
}

export function isTeammate(format: GameFormat, a: Seat, b: Seat): boolean {
  return format === 'teams' && SEATS[a].partner === b;
}
