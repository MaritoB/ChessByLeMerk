import type { Chess } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';
import { isBoardSquare, legalMoves } from './engine';

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
}

export interface ParseResult {
  ok: boolean;
  move?: MoveInput;
  ambiguous?: Move[];
  error?: string;
  /** true cuando se identifico una intencion de jugada pero era ilegal. */
  illegal?: boolean;
}

const PIECE_WORDS: Record<string, PieceSymbol> = {
  peon: 'p',
  peones: 'p',
  caballo: 'n',
  caballos: 'n',
  caballito: 'n',
  jinete: 'n',
  alfil: 'b',
  alfiles: 'b',
  torre: 'r',
  torres: 'r',
  dama: 'q',
  damas: 'q',
  reina: 'q',
  reinas: 'q',
  rey: 'k',
  reyes: 'k',
};

const NUMBER_WORDS: Record<string, string> = {
  uno: '1',
  una: '1',
  dos: '2',
  tres: '3',
  cuatro: '4',
  cinco: '5',
  seis: '6',
  siete: '7',
  ocho: '8',
};

/** Notacion de pieza para mostrar/voz. */
const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'peon',
  n: 'caballo',
  b: 'alfil',
  r: 'torre',
  q: 'dama',
  k: 'rey',
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:!?¡¿"'´`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrae las casillas (a1..h8) mencionadas, respetando el orden. */
function extractSquares(text: string): Square[] {
  let t = text;
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }
  const squares: Square[] = [];
  const re = /([a-h])\s*([1-8])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    squares.push(`${m[1]}${m[2]}` as Square);
  }
  return squares;
}

function extractPiece(text: string): PieceSymbol | undefined {
  for (const token of text.split(' ')) {
    if (PIECE_WORDS[token]) return PIECE_WORDS[token];
  }
  return undefined;
}

function detectCastle(text: string): MoveInput | undefined {
  if (!/enroq|enroc|enrosc/.test(text)) return undefined;
  const kingFrom: Square = /\b(negro|black|b)/.test(text) ? 'e8' : 'e1';
  const long = /largo|grande/.test(text);
  const to: Square = long ? ((kingFrom === 'e1' ? 'c1' : 'c8') as Square) : ((kingFrom === 'e1' ? 'g1' : 'g8') as Square);
  return { from: kingFrom, to };
}

/**
 * Convierte una frase hablada en espanol ("caballo f3", "peon de e2 a e4",
 * "enroque corto") en una jugada. Si no hay jugada legal unica, devuelve
 * informacion sobre la ambiguedad o el error.
 */
export function parseSpokenMove(chess: Chess, text: string): ParseResult {
  const normalized = normalize(text);

  // 1. Enroque explicito.
  const castle = detectCastle(normalized);
  if (castle) {
    const legal = legalMoves(chess);
    const found = legal.find((m) => m.from === castle.from && m.to === castle.to);
    if (found) return { ok: true, move: { from: found.from, to: found.to } };
    return { ok: false, error: 'No puedes enrocar ahora', illegal: true };
  }

  const piece = extractPiece(normalized);
  let squares = extractSquares(normalized);

  // 2. Coordenadas aisladas o SAN literal ("Cf3", "Nf3", "Dxf7").
  if (squares.length === 0) {
    const san = trySan(chess, text.replace(/ /g, ''));
    if (san) return { ok: true, move: san };
    return { ok: false, error: 'No he reconocido ninguna casilla' };
  }

  // 3. Si se mencionan dos casillas y la primera es origen valido, usar ambas.
  let from: Square | undefined;
  let to: Square;
  if (squares.length >= 2) {
    from = squares[0];
    to = squares[squares.length - 1];
  } else {
    to = squares[0];
  }

  const legal = legalMoves(chess);
  let candidates = legal.filter((m) => m.to === to);
  if (from) candidates = candidates.filter((m) => m.from === from);
  if (piece) candidates = candidates.filter((m) => m.piece === piece);
  if (candidates.length === 0 && squares.length === 1) {
    // Puede que el usuario haya dado origen y destino en orden invertido.
  }

  if (candidates.length === 0) {
    return { ok: false, error: `No hay jugada legal hacia ${to}`, illegal: true };
  }
  if (candidates.length > 1) {
    // Desambiguar por pieza si no se dijo.
    if (!piece) {
      return { ok: false, error: 'Jugada ambigua, di tambien la pieza', ambiguous: candidates };
    }
    return { ok: false, error: 'Jugada ambigua, di la casilla de origen', ambiguous: candidates };
  }

  const chosen = candidates[0];
  const promotion = chosen.promotion ? promotionFromText(normalized) ?? 'q' : undefined;
  return { ok: true, move: { from: chosen.from, to: chosen.to, promotion } };
}

function promotionFromText(text: string): string | undefined {
  const piece = extractPiece(text);
  if (piece && ['q', 'r', 'b', 'n'].includes(piece)) return piece;
  return undefined;
}

function trySan(chess: Chess, san: string): MoveInput | undefined {
  try {
    const move = chess.move(san);
    // Revertimos: solo queriamos validar.
    chess.undo();
    return { from: move.from, to: move.to, promotion: move.promotion };
  } catch {
    return undefined;
  }
}

/** Texto en espanol para locutar una jugada. */
export function describeMove(move: Move): string {
  const piece = PIECE_NAMES[move.piece];
  let txt = `${piece} a ${move.to}`;
  if (move.captured) txt = `${piece} captura en ${move.to}`;
  if (move.san.includes('#')) txt += ', jaque mate';
  else if (move.san.includes('+')) txt += ', jaque';
  return txt;
}

export function colorName(color: Color): string {
  return color === 'w' ? 'blancas' : 'negras';
}

export { isBoardSquare };
