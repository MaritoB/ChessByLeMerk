import {
  ALL_DIRS,
  DIAGONAL_DIRS,
  KING_OFFSETS,
  KNIGHT_OFFSETS,
  ORTHO_DIRS,
  SIZE,
  cellKey,
  isLight,
  onBoard,
  sameCell,
  squareName,
  type Action,
  type Arrow,
  type Cell,
  type Color,
  type Piece,
  type PieceType,
} from './board';

export interface VarOptions {
  /** Encoge el tablero cada N jugadas (plies). 0 = desactivado. */
  shrinkEvery?: number;
  /** Activa las habilidades de las piezas. */
  skills?: boolean;
  /** Los peones empiezan con escudo activo (por defecto no). */
  shieldPawns?: boolean;
}

export interface VarResult {
  winner: Color | 'draw';
  reason: string;
}

export interface HistoryEntry {
  color: Color;
  notation: string;
  action: Action;
  shrunkRing?: boolean;
  captured?: Piece;
}

/** Entrenamiento/fabricacion en curso (no usa puntos; solo tarda turnos). */
export interface Training {
  color: Color;
  into: PieceType;
  turnsLeft: number;
}

export interface VarSnapshot {
  board: (Piece | null)[][];
  active: boolean[][];
  turn: Color;
  arrows: Arrow[];
  check: boolean;
  result: VarResult | null;
  history: HistoryEntry[];
  lastMove: { from: Cell; to: Cell } | null;
  moveNumber: number;
  shrinkCount: number;
  canUndo: boolean;
  /** Casillas del anillo que se borrara en el siguiente encogimiento. */
  nextRing: Cell[];
  /** Progreso hacia el proximo encogimiento (0 = recien encogido, 1 = a punto). */
  shrinkProgress: number;
  /** Fabricacion/entrenamiento actual. */
  training: { color: Color; target: Cell; into: PieceType; turnsLeft: number } | null;
  /** Tipos ya fabricados por cada bando (una pieza de cada tipo por bando). */
  transformed: Record<Color, PieceType[]>;
}

interface UndoState {
  board: Board;
  active: boolean[][];
  turn: Color;
  arrows: Arrow[];
  lastMove: { from: Cell; to: Cell } | null;
  result: VarResult | null;
  shrinkCount: number;
  enPassant: Cell | null;
  history: HistoryEntry[];
  training: InternalTraining | null;
  transformed: Record<Color, PieceType[]>;
  nextId: number;
}

type Listener = (snapshot: VarSnapshot) => void;
type Board = (Piece | null)[][];

interface InternalTraining {
  color: Color;
  kind: 'transform' | 'spawn';
  source: 'king' | 'rook';
  sourceId: number;
  sourceCell: Cell;
  target: Cell;
  targetId?: number;
  into: PieceType;
  turnsLeft: number;
}

/** Turnos que tarda cada fabricacion (sin usar puntos). */
export const KING_QUEEN_TURNS = 4;
export const SPAWN_TURNS = 2;
export const FACTORY_TURNS: Record<'n' | 'b' | 'r', number> = { n: 2, b: 2, r: 3 };
export const LONGSHOT_TURNS = 1;

const START_FEN_ROWS: string[] = [
  'rnbqkbnr',
  'pppppppp',
  '........',
  '........',
  '........',
  '........',
  'PPPPPPPP',
  'RNBQKBNR',
];

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array<Piece | null>(SIZE).fill(null));
}

function clonePiece(p: Piece): Piece {
  return {
    id: p.id,
    type: p.type,
    color: p.color,
    shield: p.shield,
    cargo: p.cargo ? clonePiece(p.cargo) : undefined,
    rider: p.rider ? clonePiece(p.rider) : undefined,
  };
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((p) => (p ? clonePiece(p) : null)));
}

function fullActive(): boolean[][] {
  return Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(true));
}

function pieceTypeOf(ch: string): PieceType {
  return ch.toLowerCase() as PieceType;
}

export class VarChess {
  board: Board;
  active: boolean[][];
  turn: Color;
  arrows: Arrow[] = [];
  result: VarResult | null = null;
  history: HistoryEntry[] = [];
  lastMove: { from: Cell; to: Cell } | null = null;
  shrinkCount = 0;

  private opts: Required<VarOptions>;
  private arrowSeq = 1;
  private nextId = 1;
  private training: InternalTraining | null = null;
  private transformed: Record<Color, PieceType[]> = { w: [], b: [] };
  private undoStack: UndoState[] = [];
  private listeners = new Set<Listener>();

  constructor(options: VarOptions = {}) {
    this.opts = {
      shrinkEvery: options.shrinkEvery ?? 0,
      skills: options.skills ?? false,
      shieldPawns: options.shieldPawns ?? false,
    };
    this.board = emptyBoard();
    this.active = fullActive();
    this.turn = 'w';
    this.setup();
  }

  private mk(type: PieceType, color: Color, extra: Partial<Piece> = {}): Piece {
    return { id: this.nextId++, type, color, ...extra };
  }

  private setup(): void {
    for (let r = 0; r < SIZE; r++) {
      const row = START_FEN_ROWS[SIZE - 1 - r];
      for (let f = 0; f < SIZE; f++) {
        const ch = row[f];
        if (ch === '.') continue;
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = pieceTypeOf(ch);
        const piece = this.mk(type, color);
        if (type === 'p' && this.opts.shieldPawns) piece.shield = true;
        this.board[r][f] = piece;
      }
    }
  }

  reset(): void {
    this.board = emptyBoard();
    this.active = fullActive();
    this.turn = 'w';
    this.arrows = [];
    this.result = null;
    this.history = [];
    this.lastMove = null;
    this._enPassant = null;
    this.shrinkCount = 0;
    this.arrowSeq = 1;
    this.nextId = 1;
    this.training = null;
    this.transformed = { w: [], b: [] };
    this.undoStack = [];
    this.setup();
    this.emit();
  }

  /** Reconfigura el motor (p. ej. al adoptar la config del anfitrion online). */
  configure(options: VarOptions): void {
    this.opts = {
      shrinkEvery: options.shrinkEvery ?? 0,
      skills: options.skills ?? false,
      shieldPawns: options.shieldPawns ?? false,
    };
    this.reset();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  private pushUndo(): void {
    this.undoStack.push({
      board: cloneBoard(this.board),
      active: this.active.map((row) => [...row]),
      turn: this.turn,
      arrows: this.arrows.map((a) => ({ ...a, anchor: { ...a.anchor }, origin: { ...a.origin }, target: { ...a.target } })),
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      result: this.result,
      shrinkCount: this.shrinkCount,
      enPassant: this._enPassant,
      history: [...this.history],
      training: this.training ? { ...this.training, sourceCell: { ...this.training.sourceCell }, target: { ...this.training.target } } : null,
      transformed: { w: [...this.transformed.w], b: [...this.transformed.b] },
      nextId: this.nextId,
    });
  }

  undo(): boolean {
    const state = this.undoStack.pop();
    if (!state) return false;
    this.board = state.board;
    this.active = state.active;
    this.turn = state.turn;
    this.arrows = state.arrows;
    this.lastMove = state.lastMove;
    this.result = state.result;
    this.shrinkCount = state.shrinkCount;
    this._enPassant = state.enPassant;
    this.history = state.history;
    this.training = state.training;
    this.transformed = state.transformed;
    this.nextId = state.nextId;
    this.emit();
    return true;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  snapshot(): VarSnapshot {
    return {
      board: cloneBoard(this.board),
      active: this.active.map((row) => [...row]),
      turn: this.turn,
      arrows: this.arrows.map((a) => ({
        ...a,
        anchor: { ...a.anchor },
        origin: { ...a.origin },
        target: { ...a.target },
      })),
      check: this.inCheck(this.turn),
      result: this.result,
      history: [...this.history],
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      moveNumber: this.history.length + 1,
      shrinkCount: this.shrinkCount,
      canUndo: this.undoStack.length > 0,
      nextRing: this.computeNextRing(),
      shrinkProgress:
        this.opts.shrinkEvery > 0 ? (this.history.length % this.opts.shrinkEvery) / this.opts.shrinkEvery : 0,
      training: this.training
        ? {
            color: this.training.color,
            into: this.training.into,
            turnsLeft: this.training.turnsLeft,
            target:
              this.training.kind === 'spawn'
                ? { ...this.training.target }
                : this.findTopById(this.training.targetId ?? -1) ?? { ...this.training.target },
          }
        : null,
      transformed: { w: [...this.transformed.w], b: [...this.transformed.b] },
    };
  }

  private computeNextRing(): Cell[] {
    if (this.opts.shrinkEvery <= 0 || this.shrinkCount > 2) return [];
    const k = this.shrinkCount;
    const out: Cell[] = [];
    for (let i = 0; i < SIZE; i++) {
      for (const cell of [
        { f: i, r: k },
        { f: i, r: SIZE - 1 - k },
        { f: k, r: i },
        { f: SIZE - 1 - k, r: i },
      ]) {
        if (this.isActive(cell) && !out.some((c) => c.f === cell.f && c.r === cell.r)) out.push(cell);
      }
    }
    return out;
  }

  // ---- Utilidades ----

  isActive(cell: Cell): boolean {
    return onBoard(cell.f, cell.r) && this.active[cell.r][cell.f];
  }

  pieceAt(cell: Cell): Piece | null {
    if (!onBoard(cell.f, cell.r)) return null;
    return this.board[cell.r][cell.f];
  }

  private findTopById(id: number): Cell | null {
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (p && p.id === id) return { f, r };
      }
    }
    return null;
  }

  private enemy(a: Color, b: Color): boolean {
    return a !== b;
  }

  private forward(color: Color): number {
    return color === 'w' ? 1 : -1;
  }

  private adjacent(a: Cell, b: Cell): boolean {
    return Math.abs(a.f - b.f) <= 1 && Math.abs(a.r - b.r) <= 1 && !sameCell(a, b);
  }

  private findKing(board: Board, color: Color): Cell | null {
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === color) return { f, r };
      }
    }
    return null;
  }

  /** Un peon con escudo activo no puede ser capturado (el atacante muere). */
  private isCapturable(p: Piece | null): boolean {
    return !(p && p.type === 'p' && p.shield);
  }

  private attacked(board: Board, target: Cell, by: Color): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = board[r][f];
        if (!p || p.color !== by) continue;
        if (this.pieceAttacks(board, { f, r }, p, target)) return true;
      }
    }
    return false;
  }

  private pieceAttacks(board: Board, from: Cell, p: Piece, target: Cell): boolean {
    if (this.attacksForPiece(board, from, p, target)) return true;
    if (p.rider && this.attacksForPiece(board, from, { ...p.rider }, target)) {
      return true;
    }
    return false;
  }

  private attacksForPiece(board: Board, from: Cell, p: Piece, target: Cell): boolean {
    const df = target.f - from.f;
    const dr = target.r - from.r;
    switch (p.type) {
      case 'p': {
        const dir = this.forward(p.color);
        return dr === dir && Math.abs(df) === 1;
      }
      case 'n':
        return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
      case 'k':
        return Math.abs(df) <= 1 && Math.abs(dr) <= 1 && (df !== 0 || dr !== 0);
      case 'b':
        if (Math.abs(df) !== Math.abs(dr) || df === 0) return false;
        return this.clearPath(board, from, target);
      case 'r':
        if (df !== 0 && dr !== 0) return false;
        return this.clearPath(board, from, target);
      case 'q':
        if (!(Math.abs(df) === Math.abs(dr) || df === 0 || dr === 0)) return false;
        return this.clearPath(board, from, target);
      default:
        return false;
    }
  }

  private clearPath(board: Board, from: Cell, to: Cell): boolean {
    const sf = Math.sign(to.f - from.f);
    const sr = Math.sign(to.r - from.r);
    let f = from.f + sf;
    let r = from.r + sr;
    while (f !== to.f || r !== to.r) {
      if (!this.isActive({ f, r })) return false;
      if (board[r][f]) return false;
      f += sf;
      r += sr;
    }
    return true;
  }

  private reaches(type: PieceType, from: Cell, to: Cell): boolean {
    const df = to.f - from.f;
    const dr = to.r - from.r;
    switch (type) {
      case 'n':
        return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
      case 'k':
        return Math.abs(df) <= 1 && Math.abs(dr) <= 1 && (df !== 0 || dr !== 0);
      case 'b':
        return Math.abs(df) === Math.abs(dr) && df !== 0 && this.clearPath(this.board, from, to);
      case 'r':
        return (df === 0 || dr === 0) && (df !== 0 || dr !== 0) && this.clearPath(this.board, from, to);
      case 'q':
        return (
          (Math.abs(df) === Math.abs(dr) || df === 0 || dr === 0) &&
          (df !== 0 || dr !== 0) &&
          this.clearPath(this.board, from, to)
        );
      default:
        return false;
    }
  }

  inCheck(color: Color): boolean {
    const king = this.findKing(this.board, color);
    if (!king) return false;
    return this.attacked(this.board, king, color === 'w' ? 'b' : 'w');
  }

  /** Casillas visibles para `color` (niebla de guerra). Indice = r*8+f. */
  vision(color: Color): boolean[] {
    const view = new Array<boolean>(SIZE * SIZE).fill(false);
    const mark = (f: number, r: number) => {
      if (onBoard(f, r)) view[r * SIZE + f] = true;
    };
    const pieces: { from: Cell; p: Piece }[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (!p || p.color !== color) continue;
        mark(f, r);
        pieces.push({ from: { f, r }, p });
      }
    }
    for (const { from, p } of pieces) {
      if (p.type === 'p') {
        const dir = this.forward(color);
        mark(from.f, from.r + dir);
        mark(from.f, from.r + dir * 2);
      }
      for (let r = 0; r < SIZE; r++) {
        for (let f = 0; f < SIZE; f++) {
          if (!this.active[r][f]) continue;
          if (this.pieceAttacks(this.board, from, p, { f, r })) mark(f, r);
        }
      }
    }
    return view;
  }

  // ---- Generacion de movimientos normales ----

  private addMoveTo(list: Action[], board: Board, from: Cell, to: Cell, color: Color): boolean {
    if (!this.isActive(to)) return false;
    const target = board[to.r][to.f];
    if (target && target.color === color) return false;
    list.push({ kind: 'move', from: { ...from }, to: { ...to } });
    return !target;
  }

  private ray(list: Action[], from: Cell, dirs: Cell[], color: Color): void {
    for (const dir of dirs) {
      let f = from.f + dir.f;
      let r = from.r + dir.r;
      while (onBoard(f, r) && this.active[r][f]) {
        const target = this.board[r][f];
        if (target && target.color === color) break;
        list.push({ kind: 'move', from: { ...from }, to: { f, r } });
        if (target) break;
        f += dir.f;
        r += dir.r;
      }
    }
  }

  private pawnMoves(list: Action[], from: Cell, p: Piece): void {
    if (p.shield) return; // peon con escudo: fijo en su lugar
    const dir = this.forward(p.color);
    const startRank = p.color === 'w' ? 1 : 6;
    const promoRank = p.color === 'w' ? 7 : 0;
    const one: Cell = { f: from.f, r: from.r + dir };
    if (this.isActive(one) && !this.pieceAt(one)) {
      this.pushPawn(list, from, one, one.r === promoRank);
      const two: Cell = { f: from.f, r: from.r + dir * 2 };
      if (from.r === startRank && this.isActive(two) && !this.pieceAt(two)) {
        list.push({ kind: 'move', from: { ...from }, to: two });
      }
    }
    for (const df of [-1, 1]) {
      const t: Cell = { f: from.f + df, r: from.r + dir };
      if (!this.isActive(t)) continue;
      const target = this.pieceAt(t);
      if (target && this.enemy(target.color, p.color)) {
        this.pushPawn(list, from, t, t.r === promoRank);
      } else if (!target && this.enPassantTarget && sameCell(t, this.enPassantTarget)) {
        list.push({ kind: 'move', from: { ...from }, to: t });
      }
    }
  }

  private pushPawn(list: Action[], from: Cell, to: Cell, promotion: boolean): void {
    if (promotion) {
      for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) {
        list.push({ kind: 'move', from: { ...from }, to: { ...to }, promotion: promo });
      }
    } else {
      list.push({ kind: 'move', from: { ...from }, to: { ...to } });
    }
  }

  /** Movimientos que aporta la pieza montada (jinete) a la casilla del caballo. */
  private pushRiderMoves(list: Action[], from: Cell, rider: Piece, color: Color): void {
    const ray = (dirs: Cell[]) => {
      for (const dir of dirs) {
        let f = from.f + dir.f;
        let r = from.r + dir.r;
        while (onBoard(f, r) && this.active[r][f]) {
          const t = this.board[r][f];
          if (t && t.color === color) break;
          list.push({ kind: 'move', from: { ...from }, to: { f, r } });
          if (t) break;
          f += dir.f;
          r += dir.r;
        }
      }
    };
    const jumps = (deltas: Cell[]) => {
      for (const d of deltas) {
        const f = from.f + d.f;
        const r = from.r + d.r;
        if (!this.isActive({ f, r })) continue;
        const t = this.board[r][f];
        if (t && t.color === color) continue;
        list.push({ kind: 'move', from: { ...from }, to: { f, r } });
      }
    };
    switch (rider.type) {
      case 'p': {
        const dir = this.forward(color);
        const one: Cell = { f: from.f, r: from.r + dir };
        if (this.isActive(one) && !this.pieceAt(one)) {
          list.push({ kind: 'move', from: { ...from }, to: one });
        }
        for (const df of [-1, 1]) {
          const t: Cell = { f: from.f + df, r: from.r + dir };
          if (!this.isActive(t)) continue;
          const target = this.pieceAt(t);
          if (target && this.enemy(target.color, color)) {
            list.push({ kind: 'move', from: { ...from }, to: t });
          }
        }
        break;
      }
      case 'n':
        jumps(KNIGHT_OFFSETS);
        break;
      case 'k':
        jumps(KING_OFFSETS);
        break;
      case 'b':
        ray(DIAGONAL_DIRS);
        break;
      case 'r':
        ray(ORTHO_DIRS);
        break;
      case 'q':
        ray(ALL_DIRS);
        break;
      default:
        break;
    }
  }

  private castlingMoves(list: Action[], color: Color): void {
    const rank = color === 'w' ? 0 : 7;
    const king = this.pieceAt({ f: 4, r: rank });
    if (!king || king.type !== 'k' || king.color !== color) return;
    if (this.inCheck(color)) return;
    const rookH = this.pieceAt({ f: 7, r: rank });
    if (rookH && rookH.type === 'r' && rookH.color === color && !rookH.cargo && this.isActive({ f: 7, r: rank })) {
      if (
        this.isActive({ f: 5, r: rank }) &&
        this.isActive({ f: 6, r: rank }) &&
        !this.pieceAt({ f: 5, r: rank }) &&
        !this.pieceAt({ f: 6, r: rank }) &&
        !this.attacked(this.board, { f: 5, r: rank }, this.other(color)) &&
        !this.attacked(this.board, { f: 6, r: rank }, this.other(color))
      ) {
        list.push({ kind: 'move', from: { f: 4, r: rank }, to: { f: 6, r: rank } });
      }
    }
    const rookA = this.pieceAt({ f: 0, r: rank });
    if (rookA && rookA.type === 'r' && rookA.color === color && !rookA.cargo && this.isActive({ f: 0, r: rank })) {
      if (
        this.isActive({ f: 1, r: rank }) &&
        this.isActive({ f: 2, r: rank }) &&
        this.isActive({ f: 3, r: rank }) &&
        !this.pieceAt({ f: 1, r: rank }) &&
        !this.pieceAt({ f: 2, r: rank }) &&
        !this.pieceAt({ f: 3, r: rank }) &&
        !this.attacked(this.board, { f: 3, r: rank }, this.other(color)) &&
        !this.attacked(this.board, { f: 2, r: rank }, this.other(color))
      ) {
        list.push({ kind: 'move', from: { f: 4, r: rank }, to: { f: 2, r: rank } });
      }
    }
  }

  private other(color: Color): Color {
    return color === 'w' ? 'b' : 'w';
  }

  /** Movimiento de rebote: salta por encima de un caballo aliado y sigue mas alla. */
  private bounceMoves(list: Action[], from: Cell, color: Color): void {
    for (const d of KNIGHT_OFFSETS) {
      const b: Cell = { f: from.f + d.f, r: from.r + d.r };
      if (!this.isActive(b)) continue;
      const ally = this.board[b.r][b.f];
      if (!ally || ally.color !== color || ally.type !== 'n') continue;
      for (const d2 of KNIGHT_OFFSETS) {
        const c: Cell = { f: b.f + d2.f, r: b.r + d2.r };
        if (sameCell(c, from)) continue;
        this.addMoveTo(list, this.board, from, c, color);
      }
    }
  }

  private pseudoMoves(color: Color): Action[] {
    const list: Action[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (!p || p.color !== color) continue;
        const from: Cell = { f, r };
        switch (p.type) {
          case 'p':
            this.pawnMoves(list, from, p);
            break;
          case 'n':
            for (const d of KNIGHT_OFFSETS) {
              const to = { f: f + d.f, r: r + d.r };
              this.addMoveTo(list, this.board, from, to, color);
            }
            this.bounceMoves(list, from, color);
            break;
          case 'b':
            this.ray(list, from, DIAGONAL_DIRS, color);
            break;
          case 'r':
            // Una torre con una reina guarecida no se mueve (es la fabrica).
            if (!(p.cargo && p.cargo.type === 'q')) {
              this.ray(list, from, ORTHO_DIRS, color);
            }
            break;
          case 'q':
            this.ray(list, from, ALL_DIRS, color);
            break;
          case 'k':
            for (const d of KING_OFFSETS) {
              const to = { f: f + d.f, r: r + d.r };
              this.addMoveTo(list, this.board, from, to, color);
            }
            break;
          default:
            break;
        }
        if (p.rider) {
          this.pushRiderMoves(list, from, p.rider, color);
        }
      }
    }
    this.castlingMoves(list, color);
    return list;
  }

  private leavesKingSafe(color: Color, mutate: (b: Board) => void): boolean {
    const clone = cloneBoard(this.board);
    mutate(clone);
    const king = this.findKing(clone, color);
    if (!king) return false;
    return !this.attacked(clone, king, this.other(color));
  }

  private applySimOn(board: Board, action: Extract<Action, { kind: 'move' }>): void {
    this.applyMoveOn(board, action);
  }

  /** Empuje de peones doblados: avanzan todos los peones del color en una columna. */
  private pawnPushOn(board: Board, color: Color, file: number): void {
    const dir = this.forward(color);
    const pawns: Cell[] = [];
    for (let r = 0; r < SIZE; r++) {
      const p = board[r][file];
      if (p && p.type === 'p' && p.color === color && !p.shield) pawns.push({ f: file, r });
    }
    pawns.sort((a, b) => (dir > 0 ? b.r - a.r : a.r - b.r));
    for (const c of pawns) {
      const to: Cell = { f: file, r: c.r + dir };
      if (!this.isActive(to)) continue;
      const occ = board[to.r][to.f];
      if (occ && occ.color === color) continue;
      if (occ) board[to.r][to.f] = null;
      board[c.r][c.f] = null;
      const promoted = to.r === (color === 'w' ? 7 : 0);
      board[to.r][to.f] = promoted ? this.mk('q', color) : this.mk('p', color);
    }
  }

  private pawnsOnFile(color: Color, file: number): number {
    let n = 0;
    for (let r = 0; r < SIZE; r++) {
      const p = this.board[r][file];
      if (p && p.type === 'p' && p.color === color) n++;
    }
    return n;
  }

  private applyMoveOn(board: Board, action: Extract<Action, { kind: 'move' }>): void {
    const p = board[action.from.r][action.from.f];
    if (!p) return;
    const target = board[action.to.r][action.to.f];
    // Atacar un escudo: el escudo se rompe y el atacante muere (el peon queda).
    if (target && target.type === 'p' && target.shield) {
      board[action.from.r][action.from.f] = null;
      target.shield = false;
      return;
    }
    if (
      p.type === 'p' &&
      action.from.f !== action.to.f &&
      !board[action.to.r][action.to.f] &&
      action.to.r === action.from.r + this.forward(p.color)
    ) {
      board[action.from.r][action.to.f] = null;
    }
    board[action.from.r][action.from.f] = null;
    const moving: Piece = clonePiece(p);
    if (p.type === 'p' && (action.to.r === 7 || action.to.r === 0)) {
      moving.type = action.promotion ?? 'q';
      moving.shield = undefined;
    }
    board[action.to.r][action.to.f] = moving;
    if (p.type === 'k' && Math.abs(action.to.f - action.from.f) === 2) {
      const rank = action.from.r;
      if (action.to.f === 6) {
        board[rank][5] = board[rank][7];
        board[rank][7] = null;
      } else if (action.to.f === 2) {
        board[rank][3] = board[rank][0];
        board[rank][0] = null;
      }
    }
  }

  private legalMovesForColor(color: Color): Action[] {
    return this.pseudoMoves(color).filter((a) => {
      if (a.kind !== 'move') return true;
      return this.leavesKingSafe(color, (b) => this.applySimOn(b, a));
    });
  }

  get enPassantTarget(): Cell | null {
    return this._enPassant;
  }
  private _enPassant: Cell | null = null;

  // ---- Acciones publicas ----

  legalMoves(): Action[] {
    return this.legalMovesForColor(this.turn);
  }

  skillActions(): Action[] {
    if (!this.opts.skills) return [];
    return this.computeSkillActions(this.turn);
  }

  private pushLongshots(out: Action[], from: Cell, color: Color): void {
    const shooter = this.board[from.r][from.f];
    if (!shooter) return;
    if (this.arrows.some((a) => a.shooterId === shooter.id)) return; // ya esta cargando
    for (const dir of DIAGONAL_DIRS) {
      let f = from.f + dir.f;
      let r = from.r + dir.r;
      while (onBoard(f, r)) {
        const t = this.board[r][f];
        if (!t || (t.color !== color && this.isCapturable(t))) {
          out.push({ kind: 'longshot', from: { ...from }, to: { f, r } });
        }
        f += dir.f;
        r += dir.r;
      }
    }
  }

  private kingNear(color: Color, cell: Cell): boolean {
    return KING_OFFSETS.some((d) => {
      const kp = this.pieceAt({ f: cell.f + d.f, r: cell.r + d.r });
      return Boolean(kp && kp.color === color && kp.type === 'k');
    });
  }

  private transformUsed(color: Color, into: PieceType): boolean {
    return this.transformed[color].includes(into);
  }

  private computeSkillActions(color: Color): Action[] {
    const out: Action[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (!p || p.color !== color) continue;
        const from: Cell = { f, r };
        switch (p.type) {
          case 'p': {
            if (p.shield) {
              out.push({ kind: 'unshield', from });
              break;
            }
            // Ariete: empujon de peones doblados (gratis).
            if (this.pawnsOnFile(color, f) >= 2) {
              if (this.leavesKingSafe(color, (b) => this.pawnPushOn(b, color, f))) {
                out.push({ kind: 'pawnPush', from });
              }
            }
            // Escudo (no puede activarlo si se esta transformando en reina por el rey).
            const transforming = this.training?.source === 'king' && this.training.targetId === p.id;
            if (!transforming) out.push({ kind: 'shield', from });
            // Retroceder una casilla.
            const to = { f, r: r - this.forward(color) };
            if (
              this.isActive(to) &&
              !this.pieceAt(to) &&
              this.leavesKingSafe(color, (b) => {
                b[r][f] = null;
                b[to.r][to.f] = { ...p, id: p.id };
              })
            ) {
              out.push({ kind: 'retreat', from, to });
            }
            break;
          }
          case 'b': {
            this.pushLongshots(out, from, color);
            break;
          }
          case 'r': {
            if (p.cargo?.type === 'b') {
              // Alfil guarecido: longshot instantaneo.
              this.pushLongshots(out, from, color);
            }
            if (p.cargo?.type === 'q' && !this.training) {
              // Fabrica de la reina (la torre se queda quieta mientras fabrica).
              for (const d of KING_OFFSETS) {
                const t = { f: f + d.f, r: r + d.r };
                if (!this.isActive(t)) continue;
                if (!this.pieceAt(t)) out.push({ kind: 'spawn', from, to: t });
                const pawn = this.pieceAt(t);
                if (pawn && pawn.color === color && pawn.type === 'p') {
                  for (const into of ['n', 'b', 'r'] as PieceType[]) {
                    if (this.transformUsed(color, into)) continue;
                    out.push({ kind: 'transform', from, to: t, into });
                  }
                }
              }
            }
            if (p.cargo) {
              // Desguarecer: la torre suelta la pieza a una casilla libre adyacente.
              for (const d of KING_OFFSETS) {
                const t = { f: f + d.f, r: r + d.r };
                if (!this.isActive(t) || this.pieceAt(t)) continue;
                if (
                  this.leavesKingSafe(color, (b) => {
                    const rook = b[r][f]!;
                    const cargo = rook.cargo!;
                    rook.cargo = undefined;
                    b[t.r][t.f] = { ...cargo };
                  })
                ) {
                  out.push({ kind: 'unshelter', from, to: t });
                }
              }
            }
            if (!p.cargo) {
              // Guarecer cualquier pieza aliada a la que la torre pueda llegar moviendose.
              for (let rr = 0; rr < SIZE; rr++) {
                for (let ff = 0; ff < SIZE; ff++) {
                  const other = this.board[rr][ff];
                  if (!other || other.color !== color) continue;
                  if (other.type === 'k' || other.type === 'p') continue;
                  const c: Cell = { f: ff, r: rr };
                  if (!this.reaches(other.type, c, from)) continue;
                  if (this.leavesKingSafe(color, (b) => { b[rr][ff] = null; })) {
                    out.push({ kind: 'shelter', from: c, to: from });
                  }
                }
              }
            }
            break;
          }
          case 'k': {
            if (!this.training) {
              for (const d of KING_OFFSETS) {
                const t = { f: f + d.f, r: r + d.r };
                if (!this.isActive(t)) continue;
                const pawn = this.pieceAt(t);
                if (pawn && pawn.color === color && pawn.type === 'p') {
                  out.push({ kind: 'transform', from, to: t, into: 'q' });
                }
              }
            }
            break;
          }
          default:
            break;
        }
      }
    }

    // Caballos: montura unica (jinete), desmontar y rebote ya en movimientos.
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const knight = this.board[r][f];
        if (!knight || knight.color !== color || knight.type !== 'n') continue;
        const kc: Cell = { f, r };
        if (knight.rider) {
          const rider = knight.rider;
          const promoRank = rider.color === 'w' ? 7 : 0;
          for (const d of KING_OFFSETS) {
            const t = { f: f + d.f, r: r + d.r };
            if (!this.isActive(t) || this.pieceAt(t)) continue;
            const safe = this.leavesKingSafe(color, (b) => {
              const k = b[kc.r][kc.f]!;
              const r2 = k.rider!;
              k.rider = undefined;
              b[t.r][t.f] = { ...r2 };
            });
            if (!safe) continue;
            if (rider.type === 'p' && t.r === promoRank) {
              for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) {
                out.push({ kind: 'dismount', from: kc, to: t, promotion: promo });
              }
            } else {
              out.push({ kind: 'dismount', from: kc, to: t });
            }
          }
          continue;
        }
        for (let rr = 0; rr < SIZE; rr++) {
          for (let ff = 0; ff < SIZE; ff++) {
            if (ff === f && rr === r) continue;
            const other = this.board[rr][ff];
            if (!other || other.color !== color || other.type === 'k') continue;
            if (other.rider || other.cargo) continue;
            const c: Cell = { f: ff, r: rr };
            const adjacent = Math.abs(ff - f) <= 1 && Math.abs(rr - r) <= 1;
            const jump = this.reaches('n', kc, c);
            if (!adjacent && !jump) continue;
            if (adjacent && this.leavesKingSafe(color, (b) => { b[rr][ff] = null; })) {
              out.push({ kind: 'ride', from: c, to: kc });
            }
            if (this.leavesKingSafe(color, (b) => { b[kc.r][kc.f] = null; })) {
              out.push({ kind: 'ride', from: kc, to: c });
            }
          }
        }
      }
    }
    return out;
  }

  applyAction(action: Action): boolean {
    if (this.result) return false;

    if (action.kind === 'move') {
      const legal = this.legalMoves().some(
        (m) => m.kind === 'move' && sameCell(m.from, action.from) && sameCell(m.to, action.to) && m.promotion === action.promotion,
      );
      if (!legal) return false;
    } else {
      const legal = this.skillActions().some((m) => sameAction(m, action));
      if (!legal) return false;
    }

    this.pushUndo();
    this.perform(action);
    return true;
  }

  private perform(action: Action): void {
    const color = this.turn;
    switch (action.kind) {
      case 'move':
        this.performMove(action, color);
        return;
      case 'retreat': {
        const piece = this.board[action.from.r][action.from.f]!;
        this.board[action.from.r][action.from.f] = null;
        this.board[action.to.r][action.to.f] = this.mk('p', piece.color, { id: piece.id });
        this.record(color, `retrocede ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'longshot': {
        const shooter = this.board[action.from.r][action.from.f]!;
        const sheltered = shooter.type === 'r' && shooter.cargo?.type === 'b';
        if (sheltered) {
          // Instantaneo: el alfil guarecido dispara ya mismo.
          this.fireAt(action.to, color);
          this.record(color, `longshot instantaneo a ${squareName(action.to)}`, action);
        } else {
          this.arrows.push({
            id: this.arrowSeq++,
            color,
            shooterId: shooter.id,
            anchor: { ...action.from },
            origin: { ...action.from },
            target: { ...action.to },
            turnsLeft: LONGSHOT_TURNS,
          });
          this.record(color, `carga longshot a ${squareName(action.to)}`, action);
        }
        this.finishTurn();
        return;
      }
      case 'shield': {
        const piece = this.board[action.from.r][action.from.f];
        if (!piece) return;
        piece.shield = true;
        this.record(color, `activa escudo en ${squareName(action.from)}`, action);
        this.finishTurn();
        return;
      }
      case 'unshield': {
        const piece = this.board[action.from.r][action.from.f];
        if (!piece) return;
        piece.shield = false;
        this.record(color, `baja escudo en ${squareName(action.from)}`, action);
        this.finishTurn();
        return;
      }
      case 'shelter': {
        const piece = this.board[action.from.r][action.from.f]!;
        const rook = this.board[action.to.r][action.to.f]!;
        rook.cargo = clonePiece(piece);
        this.board[action.from.r][action.from.f] = null;
        this.record(color, `se guarece en ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'unshelter': {
        const rook = this.board[action.from.r][action.from.f];
        if (!rook || !rook.cargo) return;
        const cargo = rook.cargo;
        rook.cargo = undefined;
        this.board[action.to.r][action.to.f] = clonePiece(cargo);
        this.record(color, `desguarece en ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'spawn': {
        const rook = this.board[action.from.r][action.from.f]!;
        this.training = {
          color,
          kind: 'spawn',
          source: 'rook',
          sourceId: rook.id,
          sourceCell: { ...action.from },
          target: { ...action.to },
          into: 'p',
          turnsLeft: SPAWN_TURNS,
        };
        this.record(color, `fabrica un peon en ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'ride': {
        const a = this.board[action.from.r][action.from.f];
        const b = this.board[action.to.r][action.to.f];
        if (!a || !b || a === b) return;
        const knight = a.type === 'n' ? a : b;
        const other = a.type === 'n' ? b : a;
        if (knight.rider) return;
        const mount = clonePiece(knight);
        mount.rider = clonePiece(other);
        this.board[action.from.r][action.from.f] = null;
        this.board[action.to.r][action.to.f] = mount;
        this.record(color, `${other.type} se combina con el caballo`, action);
        this.finishTurn();
        return;
      }
      case 'dismount': {
        const knight = this.board[action.from.r][action.from.f];
        if (!knight || !knight.rider) return;
        const rider = knight.rider;
        knight.rider = undefined;
        const placed = clonePiece(rider);
        const promoRank = rider.color === 'w' ? 7 : 0;
        if (rider.type === 'p' && action.to.r === promoRank) {
          placed.type = action.promotion ?? 'q';
        }
        this.board[action.to.r][action.to.f] = placed;
        this.record(color, `desmonta en ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'pawnPush': {
        this.pawnPushOn(this.board, color, action.from.f);
        this.record(color, `empujon (ariete) de peones doblados`, action);
        this.finishTurn();
        return;
      }
      case 'transform': {
        const source = this.board[action.from.r][action.from.f];
        const pawn = this.board[action.to.r][action.to.f];
        if (!source || !pawn || pawn.type !== 'p') return;
        const isKing = source.type === 'k';
        const turnsLeft = action.into === 'q' ? KING_QUEEN_TURNS : FACTORY_TURNS[action.into as 'n' | 'b' | 'r'];
        this.training = {
          color,
          kind: 'transform',
          source: isKing ? 'king' : 'rook',
          sourceId: source.id,
          sourceCell: { ...action.from },
          target: { ...action.to },
          targetId: pawn.id,
          into: action.into,
          turnsLeft,
        };
        this.record(color, `entrena ${action.into} en ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      default:
        return;
    }
  }

  private performMove(action: Extract<Action, { kind: 'move' }>, color: Color): void {
    const target = this.board[action.to.r][action.to.f];
    const shieldAttack = Boolean(target && target.type === 'p' && target.shield);
    this.applySimOn(this.board, action);
    if (shieldAttack) {
      this.record(color, `rompe el escudo en ${squareName(action.to)}`, action);
      this.finishTurn();
      return;
    }
    // Capturar una torre con pieza guarecida: mueren las dos.
    if (target?.rider && target.rider.type === 'p') {
      this.dropRider(action.to, action.from, target.rider);
    }
    this._enPassant = this.enPassantAfter(action);
    this.record(color, this.moveNotation(action), action, target ?? undefined);
    this.finishTurn();
  }

  /** Un peon jinete cuyo caballo es capturado cae a la casilla en la direccion del ataque. */
  private dropRider(knight: Cell, attacker: Cell, rider: Piece): void {
    const dir = { f: Math.sign(knight.f - attacker.f), r: Math.sign(knight.r - attacker.r) };
    const free = (c: Cell) => this.isActive(c) && !this.pieceAt(c);
    const pref: Cell = { f: knight.f + dir.f, r: knight.r + dir.r };
    if (free(pref)) {
      this.board[pref.r][pref.f] = clonePiece(rider);
      return;
    }
    for (const d of KING_OFFSETS) {
      const c: Cell = { f: knight.f + d.f, r: knight.r + d.r };
      if (free(c)) {
        this.board[c.r][c.f] = clonePiece(rider);
        return;
      }
    }
  }

  private enPassantAfter(action: Extract<Action, { kind: 'move' }>): Cell | null {
    const p = this.board[action.to.r][action.to.f];
    if (p && p.type === 'p' && Math.abs(action.to.r - action.from.r) === 2) {
      return { f: action.from.f, r: (action.from.r + action.to.r) / 2 };
    }
    return null;
  }

  private moveNotation(action: Extract<Action, { kind: 'move' }>): string {
    const p = this.board[action.to.r][action.to.f];
    const letter = p && p.type !== 'p' ? p.type.toUpperCase() : '';
    return `${letter}${squareName(action.to)}`;
  }

  private record(color: Color, notation: string, action: Action, captured?: Piece): void {
    this.lastMove = action.kind === 'move' ? { from: { ...action.from }, to: { ...action.to } } : null;
    this.history.push({ color, notation, action, captured });
  }

  private finishTurn(): void {
    if (this.opts.shrinkEvery > 0 && this.history.length % this.opts.shrinkEvery === 0) {
      this.shrinkRing();
    }
    this.turn = this.other(this.turn);
    this.processTurnStart();
    this.evaluate();
    this.emit();
  }

  private processTurnStart(): void {
    this.validateArrows();
    this.progressTraining();

    const due = this.arrows.filter((a) => a.color === this.turn);
    for (const arrow of due) {
      arrow.turnsLeft -= 1;
      if (arrow.turnsLeft <= 0) this.fireArrow(arrow);
    }
    this.arrows = this.arrows.filter((a) => a.turnsLeft > 0);
  }

  private validateArrows(): void {
    this.arrows = this.arrows.filter((a) => {
      const cell = this.findTopById(a.shooterId);
      if (!cell || !sameCell(cell, a.anchor)) return false;
      const p = this.board[cell.r][cell.f];
      return Boolean(p && p.type === 'b' && p.color === a.color);
    });
  }

  private progressTraining(): void {
    const t = this.training;
    if (!t) return;
    const srcCell = this.findTopById(t.sourceId);
    let ok = Boolean(srcCell);
    if (ok && srcCell) {
      const src = this.board[srcCell.r][srcCell.f]!;
      if (t.source === 'rook') {
        ok = src.type === 'r' && src.cargo?.type === 'q' && sameCell(srcCell, t.sourceCell);
      } else {
        ok = src.type === 'k' && src.color === t.color;
      }
    }
    if (ok && t.kind === 'transform') {
      const pawnCell = t.targetId != null ? this.findTopById(t.targetId) : null;
      const pawn = pawnCell ? this.board[pawnCell.r][pawnCell.f] : null;
      ok = Boolean(pawn && pawn.type === 'p' && pawn.color === t.color);
      if (ok && pawnCell) {
        ok = t.source === 'king' ? this.kingNear(t.color, pawnCell) : this.adjacent(t.sourceCell, pawnCell);
      }
    } else if (ok && t.kind === 'spawn') {
      ok = this.isActive(t.target) && !this.pieceAt(t.target);
    }
    if (!ok) {
      this.training = null;
      return;
    }
    if (t.color !== this.turn) return;
    t.turnsLeft -= 1;
    if (t.turnsLeft <= 0) {
      if (t.kind === 'transform') {
        const pawnCell = t.targetId != null ? this.findTopById(t.targetId) : null;
        if (pawnCell) {
          this.board[pawnCell.r][pawnCell.f] = this.mk(t.into, t.color);
          if (t.into !== 'q') this.transformed[t.color].push(t.into);
        }
      } else {
        this.board[t.target.r][t.target.f] = this.mk('p', t.color);
      }
      this.training = null;
    }
  }

  private fireAt(target: Cell, color: Color): void {
    const p = this.board[target.r][target.f];
    if (!p) return;
    if (p.color === color) return;
    if (!this.isCapturable(p)) return;
    if (p.type === 'k') this.result = { winner: color, reason: 'longshot al rey' };
    this.board[target.r][target.f] = null;
  }

  private fireArrow(arrow: Arrow): void {
    this.fireAt(arrow.target, arrow.color);
  }

  private shrinkRing(): void {
    const k = this.shrinkCount;
    if (k > 2) return;
    const removed: Cell[] = [];
    for (let i = 0; i < SIZE; i++) {
      for (const cell of [
        { f: i, r: k },
        { f: i, r: SIZE - 1 - k },
        { f: k, r: i },
        { f: SIZE - 1 - k, r: i },
      ]) {
        if (this.active[cell.r][cell.f]) {
          this.active[cell.r][cell.f] = false;
          if (this.board[cell.r][cell.f]) removed.push(cell);
        }
      }
    }
    for (const cell of removed) {
      const p = this.board[cell.r][cell.f];
      if (p && p.type === 'k') {
        this.result = { winner: this.other(p.color), reason: 'el tablero engullo al rey' };
      }
      this.board[cell.r][cell.f] = null;
    }
    this.shrinkCount += 1;
    if (this.history.length > 0) this.history[this.history.length - 1].shrunkRing = true;
  }

  private evaluate(): void {
    if (this.result) return;
    const hasWhiteKing = Boolean(this.findKing(this.board, 'w'));
    const hasBlackKing = Boolean(this.findKing(this.board, 'b'));
    if (!hasWhiteKing && !hasBlackKing) {
      this.result = { winner: 'draw', reason: 'sin reyes' };
      return;
    }
    if (!hasWhiteKing) {
      this.result = { winner: 'b', reason: 'rey blanco capturado' };
      return;
    }
    if (!hasBlackKing) {
      this.result = { winner: 'w', reason: 'rey negro capturado' };
      return;
    }
    const moves = this.legalMoves();
    const skills = this.skillActions();
    if (moves.length === 0 && skills.length === 0) {
      if (this.inCheck(this.turn)) {
        this.result = { winner: this.other(this.turn), reason: 'jaque mate' };
      } else {
        this.result = { winner: 'draw', reason: 'rey ahogado' };
      }
    }
  }

  resign(color: Color): void {
    if (this.result) return;
    this.result = { winner: this.other(color), reason: 'abandono' };
    this.emit();
  }

  cancel(reason = 'Partida cancelada'): void {
    if (this.result) return;
    this.result = { winner: 'draw', reason };
    this.emit();
  }
}

function sameAction(a: Action, b: Action): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'move' && b.kind === 'move') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.promotion === b.promotion;
  }
  if (a.kind === 'shelter' && b.kind === 'shelter') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'unshelter' && b.kind === 'unshelter') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'spawn' && b.kind === 'spawn') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'longshot' && b.kind === 'longshot') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'ride' && b.kind === 'ride') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'dismount' && b.kind === 'dismount') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.promotion === b.promotion;
  }
  if (a.kind === 'pawnPush' && b.kind === 'pawnPush') {
    return sameCell(a.from, b.from);
  }
  if (a.kind === 'shield' && b.kind === 'shield') {
    return sameCell(a.from, b.from);
  }
  if (a.kind === 'unshield' && b.kind === 'unshield') {
    return sameCell(a.from, b.from);
  }
  if (a.kind === 'transform' && b.kind === 'transform') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.into === b.into;
  }
  if (a.kind === 'retreat' && b.kind === 'retreat') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  return false;
}

export { cellKey, isLight };
