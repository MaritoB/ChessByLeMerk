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
  type ArrowMode,
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
  /** Los peones empiezan con armadura. */
  shieldPawns?: boolean;
}

export interface VarResult {
  winner: Color | 'draw';
  reason: string;
}

export interface PendingDefense {
  attackerFrom: Cell;
  target: Cell;
  attackerColor: Color;
  defenderColor: Color;
  /** true = la pieza atacada es una torre con pieza guarecida. */
  isRookBreak: boolean;
}

export interface HistoryEntry {
  color: Color;
  notation: string;
  action: Action;
  shrunkRing?: boolean;
  captured?: Piece;
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
  pendingDefense: PendingDefense | null;
  skillsLeft: Record<Color, Record<PieceType, number>>;
  moveNumber: number;
  shrinkCount: number;
  canUndo: boolean;
  /** Casillas del anillo que se borrara en el siguiente encogimiento. */
  nextRing: Cell[];
  /** Progreso hacia el proximo encogimiento (0 = recien encogido, 1 = a punto). */
  shrinkProgress: number;
}

interface UndoState {
  board: Board;
  active: boolean[][];
  turn: Color;
  arrows: Arrow[];
  skillsLeft: Record<Color, Record<PieceType, number>>;
  lastMove: { from: Cell; to: Cell } | null;
  result: VarResult | null;
  shrinkCount: number;
  enPassant: Cell | null;
  pendingDefense: PendingDefense | null;
  pendingAction: Extract<Action, { kind: 'move' }> | null;
  history: HistoryEntry[];
}

type Listener = (snapshot: VarSnapshot) => void;
type Board = (Piece | null)[][];

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
    type: p.type,
    color: p.color,
    shield: p.shield,
    archer: p.archer,
    cargoArrow: p.cargoArrow,
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
  pendingDefense: PendingDefense | null = null;
  skillsLeft: Record<Color, Record<PieceType, number>>;
  shrinkCount = 0;

  private readonly opts: Required<VarOptions>;
  private arrowSeq = 1;
  /** RNG determinista (misma secuencia en ambos clientes). */
  private rng = 0x2f6e2b1;
  private undoStack: UndoState[] = [];
  private listeners = new Set<Listener>();

  private rand(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 0x100000000;
  }

  constructor(options: VarOptions = {}) {
    this.opts = {
      shrinkEvery: options.shrinkEvery ?? 0,
      skills: options.skills ?? false,
      shieldPawns: options.shieldPawns ?? false,
    };
    this.board = emptyBoard();
    this.active = fullActive();
    this.turn = 'w';
    this.skillsLeft = { w: this.emptySkills(), b: this.emptySkills() };
    this.setup();
  }

  private emptySkills(): Record<PieceType, number> {
    return { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  }

  /** Cada peon tiene su propio punto de skill (la armadura). */
  private pawnsWithSkill(color: Color): number {
    let n = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (p && p.type === 'p' && p.color === color && p.shield) n += 1;
      }
    }
    return n;
  }

  private setup(): void {
    for (let r = 0; r < SIZE; r++) {
      const row = START_FEN_ROWS[SIZE - 1 - r];
      for (let f = 0; f < SIZE; f++) {
        const ch = row[f];
        if (ch === '.') continue;
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = pieceTypeOf(ch);
        const piece: Piece = { type, color };
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
    this.pendingDefense = null;
    this.shrinkCount = 0;
    this.rng = 0x2f6e2b1;
    this.undoStack = [];
    this.skillsLeft = { w: this.emptySkills(), b: this.emptySkills() };
    this.setup();
    this.emit();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  private pushUndo(): void {
    this.undoStack.push({
      board: cloneBoard(this.board),
      active: this.active.map((row) => [...row]),
      turn: this.turn,
      arrows: this.arrows.map((a) => ({
        ...a,
        dir: a.dir ? { ...a.dir } : undefined,
        target: a.target ? { ...a.target } : undefined,
        origin: { ...a.origin },
      })),
      skillsLeft: { w: { ...this.skillsLeft.w }, b: { ...this.skillsLeft.b } },
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      result: this.result,
      shrinkCount: this.shrinkCount,
      enPassant: this._enPassant,
      pendingDefense: this.pendingDefense,
      pendingAction: this.pendingAction,
      history: [...this.history],
    });
  }

  /** Vuelve atras una accion (la ultima, incluida la decision de escudo). */
  undo(): boolean {
    const state = this.undoStack.pop();
    if (!state) return false;
    this.board = state.board;
    this.active = state.active;
    this.turn = state.turn;
    this.arrows = state.arrows;
    this.skillsLeft = state.skillsLeft;
    this.lastMove = state.lastMove;
    this.result = state.result;
    this.shrinkCount = state.shrinkCount;
    this._enPassant = state.enPassant;
    this.pendingDefense = state.pendingDefense;
    this.pendingAction = state.pendingAction;
    this.history = state.history;
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
      arrows: this.arrows.map((a) => ({ ...a, dir: a.dir ? { ...a.dir } : undefined, target: a.target ? { ...a.target } : undefined, origin: { ...a.origin } })),
      check: this.inCheck(this.turn),
      result: this.result,
      history: [...this.history],
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      pendingDefense: this.pendingDefense,
      skillsLeft: {
        w: { ...this.skillsLeft.w, p: this.pawnsWithSkill('w') },
        b: { ...this.skillsLeft.b, p: this.pawnsWithSkill('b') },
      },
      moveNumber: this.history.length + 1,
      shrinkCount: this.shrinkCount,
      canUndo: this.undoStack.length > 0,
      nextRing: this.computeNextRing(),
      shrinkProgress:
        this.opts.shrinkEvery > 0 ? (this.history.length % this.opts.shrinkEvery) / this.opts.shrinkEvery : 0,
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

  private enemy(a: Color, b: Color): boolean {
    return a !== b;
  }

  private forward(color: Color): number {
    return color === 'w' ? 1 : -1;
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
    if (p.rider && this.attacksForPiece(board, from, { type: p.rider.type, color: p.rider.color }, target)) {
      return true;
    }
    return false;
  }

  private attacksForPiece(board: Board, from: Cell, p: Piece, target: Cell): boolean {
    const df = target.f - from.f;
    const dr = target.r - from.r;
    const knightHit = (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
    switch (p.type) {
      case 'p': {
        const dir = this.forward(p.color);
        return dr === dir && Math.abs(df) === 1;
      }
      case 'n': {
        if (knightHit) return true;
        if (p.archer === 'tower') {
          if ((df === 0 || dr === 0) && this.clearPath(board, from, target)) return true;
        } else if (p.archer === 'archer') {
          if (Math.abs(df) === Math.abs(dr) && df !== 0 && this.clearPath(board, from, target)) return true;
        }
        return false;
      }
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

  /** ¿La pieza `type` en `from` podria llegar a `to` (destino ocupado por el aliado)? */
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
        return (Math.abs(df) === Math.abs(dr) || df === 0 || dr === 0) && (df !== 0 || dr !== 0) && this.clearPath(this.board, from, to);
      default:
        return false;
    }
  }

  inCheck(color: Color): boolean {
    const king = this.findKing(this.board, color);
    if (!king) return false;
    return this.attacked(this.board, king, color === 'w' ? 'b' : 'w');
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
    // Enroque corto (h) y largo (a)
    const rookH = this.pieceAt({ f: 7, r: rank });
    if (rookH && rookH.type === 'r' && rookH.color === color && this.isActive({ f: 7, r: rank })) {
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
    if (rookA && rookA.type === 'r' && rookA.color === color && this.isActive({ f: 0, r: rank })) {
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

  private pseudoMoves(color: Color): Action[] {
    const list: Action[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (!p || p.color !== color) continue;
        const from: Cell = { f, r };
        // Una torre que guarece puede moverse llevando la carga; su carga ataca sin moverse.
        if (p.type === 'r' && p.cargo) {
          this.ray(list, from, ORTHO_DIRS, color);
          for (const cap of this.cargoCaptures(from, p.cargo)) {
            list.push({ kind: 'move', from: { ...from }, to: cap });
          }
          continue;
        }
        switch (p.type) {
          case 'p':
            this.pawnMoves(list, from, p);
            break;
          case 'n':
            for (const d of KNIGHT_OFFSETS) {
              const to = { f: f + d.f, r: r + d.r };
              if (this.isActive(to) && (!this.pieceAt(to) || this.pieceAt(to)!.color !== color)) {
                list.push({ kind: 'move', from: { ...from }, to });
              }
            }
            if (p.archer === 'tower') {
              this.ray(list, from, ORTHO_DIRS, color);
            } else if (p.archer === 'archer') {
              for (const dir of DIAGONAL_DIRS) {
                let f2 = f + dir.f;
                let r2 = r + dir.r;
                while (onBoard(f2, r2) && this.active[r2][f2]) {
                  const t = this.board[r2][f2];
                  if (t) {
                    if (t.color !== color) list.push({ kind: 'move', from: { ...from }, to: { f: f2, r: r2 } });
                    break;
                  }
                  f2 += dir.f;
                  r2 += dir.r;
                }
              }
            }
            break;
          case 'b':
            this.ray(list, from, DIAGONAL_DIRS, color);
            break;
          case 'r':
            this.ray(list, from, ORTHO_DIRS, color);
            break;
          case 'q':
            this.ray(list, from, ALL_DIRS, color);
            break;
          case 'k':
            for (const d of KING_OFFSETS) {
              const to = { f: f + d.f, r: r + d.r };
              if (this.isActive(to) && (!this.pieceAt(to) || this.pieceAt(to)!.color !== color)) {
                list.push({ kind: 'move', from: { ...from }, to });
              }
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

  private cargoCaptures(from: Cell, cargo: Piece): Cell[] {
    const out: Cell[] = [];
    const fake: Piece = { type: cargo.type, color: cargo.color };
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const t = this.board[r][f];
        if (!t || t.color === cargo.color) continue;
        const target: Cell = { f, r };
        if (this.pieceAttacks(this.board, from, fake, target)) out.push(target);
      }
    }
    return out;
  }

  private leavesKingSafe(color: Color, mutate: (b: Board) => void): boolean {
    const clone = cloneBoard(this.board);
    mutate(clone);
    const king = this.findKing(clone, color);
    if (!king) return false;
    return !this.attacked(clone, king, this.other(color));
  }

  /** Aplica una jugada normal o una captura de la pieza guarecida. */
  private applySimOn(board: Board, action: Extract<Action, { kind: 'move' }>): void {
    const mover = board[action.from.r][action.from.f];
    const target = board[action.to.r][action.to.f];
    if (mover && mover.type === 'r' && mover.cargo && target) {
      const rookReach =
        (action.to.f === action.from.f || action.to.r === action.from.r) &&
        this.clearPath(board, action.from, action.to);
      if (!rookReach) {
        // La carga captura sin que la torre se mueva.
        board[action.to.r][action.to.f] = null;
        return;
      }
    }
    this.applyMoveOn(board, action);
  }

  /** Coloca un jinete desmontado en una casilla adyacente libre (al azar). */
  private dismountRider(around: Cell, rider: Piece, dir?: Cell): void {
    const free = (c: Cell) => this.isActive(c) && !this.pieceAt(c);
    const drop = (c: Cell) => {
      this.board[c.r][c.f] = { type: rider.type, color: rider.color, shield: rider.shield };
    };
    // Preferencia: continuar la direccion del ataque.
    if (dir && (dir.f !== 0 || dir.r !== 0)) {
      const pref: Cell = { f: around.f + dir.f, r: around.r + dir.r };
      if (free(pref)) {
        drop(pref);
        return;
      }
    }
    const candidates: Cell[] = [];
    for (const d of KING_OFFSETS) {
      const t: Cell = { f: around.f + d.f, r: around.r + d.r };
      if (free(t)) candidates.push(t);
    }
    if (candidates.length === 0) return;
    drop(candidates[Math.floor(this.rand() * candidates.length)]);
  }

  /** Empuje de peones doblados: avanzan todos los peones del color en una columna. */
  private pawnPushOn(board: Board, color: Color, file: number): void {
    const dir = this.forward(color);
    const pawns: Cell[] = [];
    for (let r = 0; r < SIZE; r++) {
      const p = board[r][file];
      if (p && p.type === 'p' && p.color === color) pawns.push({ f: file, r });
    }
    // Procesar de delante hacia atras para no chocar.
    pawns.sort((a, b) => (dir > 0 ? b.r - a.r : a.r - b.r));
    for (const c of pawns) {
      const to: Cell = { f: file, r: c.r + dir };
      if (!this.isActive(to)) continue;
      const occ = board[to.r][to.f];
      if (occ && occ.color === color) continue;
      if (occ) board[to.r][to.f] = null;
      const pawn = board[c.r][c.f]!;
      board[c.r][c.f] = null;
      const promoted = to.r === (color === 'w' ? 7 : 0);
      board[to.r][to.f] = promoted
        ? { type: 'q', color: pawn.color }
        : { type: 'p', color: pawn.color, shield: pawn.shield };
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
    // En passant
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
    // Enroque
    if (p.type === 'k' && Math.abs(action.to.f - action.from.f) === 2) {
      const rank = action.from.r;
      if (action.to.f === 6) {
        const rook = board[rank][7];
        board[rank][7] = null;
        board[rank][5] = rook;
      } else if (action.to.f === 2) {
        const rook = board[rank][0];
        board[rank][0] = null;
        board[rank][3] = rook;
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

  private spend(color: Color, type: PieceType): void {
    this.skillsLeft[color][type] = Math.max(0, this.skillsLeft[color][type] - 1);
  }

  private addArrows(out: Action[], from: Cell, color: Color): void {
    for (const dir of DIAGONAL_DIRS) {
      out.push({ kind: 'arrow', from: { ...from }, mode: 'fast', dir: { ...dir } });
    }
    for (const dir of DIAGONAL_DIRS) {
      let f2 = from.f + dir.f;
      let r2 = from.r + dir.r;
      while (onBoard(f2, r2)) {
        const t = this.board[r2][f2];
        if (!t || t.color !== color) {
          out.push({ kind: 'arrow', from: { ...from }, mode: 'guided', target: { f: f2, r: r2 } });
        }
        f2 += dir.f;
        r2 += dir.r;
      }
    }
    for (const dir of DIAGONAL_DIRS) {
      out.push({ kind: 'arrow', from: { ...from }, mode: 'piercing', dir: { ...dir } });
    }
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
            if (!p.shield) break;
            const to = { f, r: r - this.forward(color) };
            if (this.isActive(to) && !this.pieceAt(to) && this.leavesKingSafe(color, (b) => {
              const piece = b[r][f]!;
              b[r][f] = null;
              b[to.r][to.f] = { type: 'p', color: piece.color };
            })) {
              out.push({ kind: 'retreat', from, to });
            }
            if (this.pawnsOnFile(color, f) >= 2) {
              const safePush = this.leavesKingSafe(color, (b) => this.pawnPushOn(b, color, f));
              if (safePush) out.push({ kind: 'pawnPush', from });
            }
            break;
          }
          case 'b': {
            if (this.skillsLeft[color].b <= 0) break;
            this.addArrows(out, from, color);
            const safe = this.leavesKingSafe(color, (b) => {
              b[r][f] = null;
            });
            if (!safe) break;
            for (const d of KING_OFFSETS) {
              const t = { f: f + d.f, r: r + d.r };
              if (!this.isActive(t)) continue;
              const other = this.pieceAt(t);
              if (other && other.color === color && other.type === 'n' && !other.archer) {
                out.push({ kind: 'mount', from, to: t, mode: 'tower' });
                out.push({ kind: 'mount', from, to: t, mode: 'archer' });
              }
              if (other && other.color === color && other.type === 'r' && !other.cargo) {
                out.push({ kind: 'enterRook', from, to: t, choice: 'queen' });
                out.push({ kind: 'enterRook', from, to: t, choice: 'shelter' });
              }
            }
            break;
          }
          case 'r': {
            if (p.cargo) {
              if (p.cargo.type === 'b' && p.cargoArrow) this.addArrows(out, from, color);
              // Una reina guarecida transforma un peon adyacente:
              //  - caballo: siempre
              //  - alfil: si el peon no tenia punto de skill
              //  - torre: si el peon conservaba su punto de skill
              if (p.cargo.type === 'q') {
                const kingNear = KING_OFFSETS.some((d) => {
                  const kp = this.pieceAt({ f: f + d.f, r: r + d.r });
                  return Boolean(kp && kp.color === color && kp.type === 'k');
                });
                for (const d of KING_OFFSETS) {
                  const t = { f: f + d.f, r: r + d.r };
                  if (!this.isActive(t)) continue;
                  const other = this.pieceAt(t);
                  if (!other || other.color !== color || other.type !== 'p') continue;
                  if (this.leavesKingSafe(color, (b) => { b[t.r][t.f] = { type: 'n', color }; })) {
                    out.push({ kind: 'transform', from, to: t, into: 'n' });
                  }
                  if (!other.shield) {
                    if (this.leavesKingSafe(color, (b) => { b[t.r][t.f] = { type: 'b', color }; })) {
                      out.push({ kind: 'transform', from, to: t, into: 'b' });
                    }
                  } else if (this.leavesKingSafe(color, (b) => { b[t.r][t.f] = { type: 'r', color }; })) {
                    out.push({ kind: 'transform', from, to: t, into: 'r' });
                  }
                  // Con el rey adyacente, el peon se transforma en reina (gasta el punto del rey).
                  if (
                    kingNear &&
                    this.skillsLeft[color].k > 0 &&
                    this.leavesKingSafe(color, (b) => { b[t.r][t.f] = { type: 'q', color }; })
                  ) {
                    out.push({ kind: 'transform', from, to: t, into: 'q' });
                  }
                }
              }
              // Un peon guarecido con escudo puede desguarecerse: avanza o come en diagonal.
              if (p.cargo.type === 'p' && p.cargo.shield) {
                const dir = this.forward(color);
                const fwd: Cell = { f, r: r + dir };
                if (
                  this.isActive(fwd) &&
                  !this.pieceAt(fwd) &&
                  this.leavesKingSafe(color, (b) => { b[fwd.r][fwd.f] = { type: 'p', color, shield: true }; })
                ) {
                  out.push({ kind: 'unshelter', from, to: fwd });
                }
                for (const df of [-1, 1]) {
                  const t: Cell = { f: f + df, r: r + dir };
                  if (!this.isActive(t)) continue;
                  const target = this.pieceAt(t);
                  if (
                    target &&
                    this.enemy(target.color, color) &&
                    this.leavesKingSafe(color, (b) => { b[t.r][t.f] = { type: 'p', color, shield: true }; })
                  ) {
                    out.push({ kind: 'unshelter', from, to: t });
                  }
                }
              }
              break;
            }
            if (this.skillsLeft[color].r <= 0) break;
            for (let rr = 0; rr < SIZE; rr++) {
              for (let ff = 0; ff < SIZE; ff++) {
                if (ff === f && rr === r) continue;
                const other = this.board[rr][ff];
                if (!other || other.color !== color) continue;
                if (other.type === 'k' || other.type === 'p') continue;
                if (!this.reaches(other.type, { f: ff, r: rr }, from)) continue;
                if (this.leavesKingSafe(color, (b) => {
                  b[rr][ff] = null;
                })) {
                  out.push({ kind: 'shelter', from, target: { f: ff, r: rr } });
                }
              }
            }
            break;
          }
          case 'k': {
            if (this.skillsLeft[color].k <= 0) break;
            const queen = this.findQueen(color);
            if (queen) out.push({ kind: 'swap', from, to: queen });
            out.push({ kind: 'warcry', from });
            break;
          }
          case 'q': {
            if (this.skillsLeft[color].q <= 0) break;
            for (const target of this.convertTargets(from, color)) {
              out.push({ kind: 'convert', from, to: target });
            }
            break;
          }
          default:
            break;
        }
      }
    }

    // Combinar con caballos: cualquier pieza aliada adyacente (salvo el rey),
    // en ambas direcciones (la pieza sube al caballo o el caballo sube a la pieza).
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const knight = this.board[r][f];
        if (!knight || knight.color !== color || knight.type !== 'n') continue;
        if (knight.archer || knight.rider) continue;
        const kc: Cell = { f, r };
        for (const d of KING_OFFSETS) {
          const t: Cell = { f: f + d.f, r: r + d.r };
          if (!this.isActive(t)) continue;
          const other = this.pieceAt(t);
          if (!other || other.color !== color || other.type === 'k' || other.rider) continue;
          if (this.leavesKingSafe(color, (b) => { b[t.r][t.f] = null; })) {
            out.push({ kind: 'ride', from: t, to: kc });
          }
          if (this.leavesKingSafe(color, (b) => { b[kc.r][kc.f] = null; })) {
            out.push({ kind: 'ride', from: kc, to: t });
          }
        }
      }
    }
    return out;
  }

  private findQueen(color: Color): Cell | null {
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (p && p.type === 'q' && p.color === color) return { f, r };
      }
    }
    return null;
  }

  private convertTargets(from: Cell, color: Color): Cell[] {
    const out: Cell[] = [];
    for (const dir of ALL_DIRS) {
      let f = from.f + dir.f;
      let r = from.r + dir.r;
      while (onBoard(f, r) && this.active[r][f]) {
        const p = this.board[r][f];
        if (p) {
          if (p.color !== color && p.type !== 'q') out.push({ f, r });
          break;
        }
        f += dir.f;
        r += dir.r;
      }
    }
    return out;
  }

  applyAction(action: Action): boolean {
    if (this.result) return false;
    if (this.pendingDefense) {
      if (action.kind === 'defense') return this.resolveDefense(action.block);
      return false;
    }
    if (action.kind === 'defense') return false;

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
        this.board[action.to.r][action.to.f] = { type: piece.type, color: piece.color };
        this.record(color, `retrocede ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'arrow': {
        const arrow: Arrow = {
          id: this.arrowSeq++,
          color,
          mode: action.mode,
          dir: action.dir,
          target: action.target,
          origin: { ...action.from },
          turnsLeft: action.mode === 'fast' ? 1 : action.mode === 'guided' ? 2 : 3,
        };
        this.arrows.push(arrow);
        const shooter = this.board[action.from.r][action.from.f];
        if (shooter && shooter.type === 'r' && shooter.cargo?.type === 'b') {
          shooter.cargoArrow = false;
        } else {
          this.spend(color, 'b');
        }
        this.record(color, `flecha ${action.mode}`, action);
        this.finishTurn();
        return;
      }
      case 'mount': {
        const knight = this.board[action.to.r][action.to.f]!;
        this.board[action.from.r][action.from.f] = null;
        knight.archer = action.mode;
        this.spend(color, 'b');
        this.record(color, `alfil monta en caballo (${action.mode})`, action);
        this.finishTurn();
        return;
      }
      case 'enterRook': {
        const rook = this.board[action.to.r][action.to.f]!;
        this.board[action.from.r][action.from.f] = null;
        if (action.choice === 'queen') {
          this.board[action.to.r][action.to.f] = { type: 'q', color };
          this.record(color, `alfil+torre = reina`, action);
        } else {
          rook.cargo = { type: 'b', color };
          rook.cargoArrow = true;
          this.record(color, `alfil se guarece en la torre`, action);
        }
        this.spend(color, 'b');
        this.finishTurn();
        return;
      }
      case 'ride': {
        const a = this.board[action.from.r][action.from.f];
        const b = this.board[action.to.r][action.to.f];
        if (!a || !b || a === b) return;
        const knight = a.type === 'n' ? a : b;
        const other = a.type === 'n' ? b : a;
        const mount = clonePiece(knight);
        mount.rider = { type: other.type, color: other.color, shield: other.shield };
        this.board[action.from.r][action.from.f] = null;
        this.board[action.to.r][action.to.f] = mount;
        this.record(color, `${other.type} se combina con el caballo`, action);
        this.finishTurn();
        return;
      }
      case 'pawnPush': {
        const ram = this.board[action.from.r][action.from.f];
        if (ram) ram.shield = false;
        this.pawnPushOn(this.board, color, action.from.f);
        this.record(color, `empujon de peones doblados`, action);
        this.finishTurn();
        return;
      }
      case 'shelter': {
        const rook = this.board[action.from.r][action.from.f]!;
        const cargo = this.board[action.target.r][action.target.f]!;
        this.board[action.target.r][action.target.f] = null;
        rook.cargo = { type: cargo.type, color: cargo.color, shield: cargo.shield };
        this.spend(color, 'r');
        this.record(color, `guarece en ${squareName(action.from)}`, action);
        this.finishTurn();
        return;
      }
      case 'unshelter': {
        const rook = this.board[action.from.r][action.from.f];
        if (!rook || !rook.cargo) return;
        const cargo = rook.cargo;
        rook.cargo = undefined;
        rook.cargoArrow = undefined;
        this.board[action.to.r][action.to.f] = { type: 'p', color, shield: cargo.shield };
        this.record(color, `desguarece el peon en ${squareName(action.to)}`, action);
        this.finishTurn();
        return;
      }
      case 'swap': {
        const king = this.board[action.from.r][action.from.f]!;
        const queen = this.board[action.to.r][action.to.f]!;
        this.board[action.from.r][action.from.f] = queen;
        this.board[action.to.r][action.to.f] = king;
        this.spend(color, 'k');
        this.record(color, `permuta rey/reina`, action);
        this.finishTurn();
        return;
      }
      case 'convert': {
        const target = this.board[action.to.r][action.to.f];
        if (!target) return;
        const converted: Piece = { type: target.type, color };
        this.board[action.to.r][action.to.f] = converted;
        this.spend(color, 'q');
        if (this.inCheck(this.other(color))) {
          this.board[action.to.r][action.to.f] = null;
          this.record(color, `convierte y muere en ${squareName(action.to)}`, action);
        } else {
          this.record(color, `convierte ${squareName(action.to)}`, action);
        }
        this.finishTurn();
        return;
      }
      case 'transform': {
        const pawn = this.board[action.to.r][action.to.f];
        if (!pawn || pawn.type !== 'p') return;
        this.board[action.to.r][action.to.f] = { type: action.into, color };
        // La dama guarecida NO gasta su punto al transformar en n/b/r; en reina lo paga el rey.
        if (action.into === 'q') this.spend(color, 'k');
        this.record(color, `transforma ${squareName(action.to)} en ${action.into}`, action);
        this.finishTurn();
        return;
      }
      case 'warcry': {
        const caps: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
        for (const d of KING_OFFSETS) {
          const t = { f: action.from.f + d.f, r: action.from.r + d.r };
          if (!this.isActive(t)) continue;
          const unit = this.pieceAt(t);
          if (unit && unit.color === color) {
            this.skillsLeft[color][unit.type] = Math.min(caps[unit.type], this.skillsLeft[color][unit.type] + 1);
          }
        }
        this.spend(color, 'k');
        this.record(color, 'grito de guerra', action);
        this.finishTurn();
        return;
      }
      default:
        return;
    }
  }

  private performMove(action: Extract<Action, { kind: 'move' }>, color: Color): void {
    const mover = this.board[action.from.r][action.from.f];
    const target = this.board[action.to.r][action.to.f];
    const isCargo = Boolean(mover && mover.type === 'r' && mover.cargo);
    const special = target && (target.shield || (target.type === 'r' && target.cargo));
    if (this.opts.skills && special) {
      this.pendingDefense = {
        attackerFrom: { ...action.from },
        target: { ...action.to },
        attackerColor: color,
        defenderColor: this.other(color),
        isRookBreak: Boolean(target.type === 'r' && target.cargo),
      };
      this.pendingAction = action;
      this.emit();
      return;
    }
    const rider = target?.rider ? clonePiece(target.rider) : undefined;
    this.applySimOn(this.board, action);
    // El jinete solo desmonta si es un peon con escudo; el resto muere con el caballo.
    if (rider && rider.type === 'p' && rider.shield) {
      const dir = { f: Math.sign(action.to.f - action.from.f), r: Math.sign(action.to.r - action.from.r) };
      this.dismountRider(action.to, rider, dir);
    }
    this._enPassant = isCargo ? null : this.enPassantAfter(action);
    this.record(color, this.moveNotation(action), action, target ?? undefined);
    this.finishTurn();
  }

  private pendingAction: Extract<Action, { kind: 'move' }> | null = null;

  private resolveDefense(block: boolean): boolean {
    const pending = this.pendingDefense;
    const action = this.pendingAction;
    if (!pending || !action) return false;
    const targetPiece = this.board[pending.target.r][pending.target.f];
    if (block) {
      if (pending.isRookBreak) {
        // El atacante vuelve; la torre se rompe y la pieza guarecida queda en su lugar.
        const cargo = targetPiece?.cargo;
        this.board[pending.target.r][pending.target.f] = cargo ? clonePiece(cargo) : null;
      } else if (targetPiece) {
        targetPiece.shield = false;
        const left = this.skillsLeft[pending.defenderColor];
        if (left) left.p = Math.max(0, left.p - 1);
      }
    } else {
      const mover = this.board[pending.attackerFrom.r][pending.attackerFrom.f];
      if (mover && mover.type === 'r' && mover.cargo) {
        // La pieza guarecida captura sin moverse.
        this.board[pending.target.r][pending.target.f] = null;
      } else {
        this.applyMoveOn(this.board, action);
        this._enPassant = this.enPassantAfter(action);
      }
    }
    this.pendingDefense = null;
    this.pendingAction = null;
    this.record(
      pending.attackerColor,
      block ? 'bloqueo' : this.moveNotation(action),
      action,
      block ? undefined : targetPiece ?? undefined,
    );
    this.finishTurn();
    return true;
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
    const before = this.board[action.from.r]?.[action.from.f];
    void before;
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
    // Disparar flechas del jugador al que le toca.
    const due = this.arrows.filter((a) => a.color === this.turn);
    for (const arrow of due) {
      arrow.turnsLeft -= 1;
      if (arrow.turnsLeft <= 0) this.fireArrow(arrow);
    }
    this.arrows = this.arrows.filter((a) => a.turnsLeft > 0);
  }

  private fireArrow(arrow: Arrow): void {
    const kills: Cell[] = [];
    if (arrow.mode === 'fast' && arrow.dir) {
      let f = arrow.origin.f + arrow.dir.f;
      let r = arrow.origin.r + arrow.dir.r;
      while (onBoard(f, r) && this.active[r][f]) {
        const p = this.board[r][f];
        if (p) {
          if (p.color !== arrow.color) kills.push({ f, r });
          break;
        }
        f += arrow.dir.f;
        r += arrow.dir.r;
      }
    } else if (arrow.mode === 'guided' && arrow.target) {
      const p = this.board[arrow.target.r][arrow.target.f];
      if (p && p.color !== arrow.color) kills.push({ ...arrow.target });
    } else if (arrow.mode === 'piercing' && arrow.dir) {
      let f = arrow.origin.f + arrow.dir.f;
      let r = arrow.origin.r + arrow.dir.r;
      while (onBoard(f, r) && this.active[r][f]) {
        if (this.board[r][f]) kills.push({ f, r });
        f += arrow.dir.f;
        r += arrow.dir.r;
      }
    }
    for (const cell of kills) {
      const p = this.board[cell.r][cell.f];
      if (p && p.type === 'k') {
        this.result = { winner: arrow.color, reason: 'flecha al rey' };
      }
      this.board[cell.r][cell.f] = null;
    }
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
    // Recalcular castling/reyes eliminados.
    for (const cell of removed) {
      const p = this.board[cell.r][cell.f];
      if (p && p.type === 'k') {
        this.result = { winner: this.other(p.color), reason: 'el tablero engulló al rey' };
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
  if (a.kind === 'arrow' && b.kind === 'arrow') {
    return a.mode === b.mode && sameCell(a.from, b.from) && eqCell(a.dir, b.dir) && eqCell(a.target, b.target);
  }
  if (a.kind === 'shelter' && b.kind === 'shelter') {
    return sameCell(a.from, b.from) && sameCell(a.target, b.target);
  }
  if (a.kind === 'mount' && b.kind === 'mount') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.mode === b.mode;
  }
  if (a.kind === 'enterRook' && b.kind === 'enterRook') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.choice === b.choice;
  }
  if (a.kind === 'ride' && b.kind === 'ride') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'pawnPush' && b.kind === 'pawnPush') {
    return sameCell(a.from, b.from);
  }
  if (a.kind === 'unshelter' && b.kind === 'unshelter') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to);
  }
  if (a.kind === 'warcry' && b.kind === 'warcry') {
    return sameCell(a.from, b.from);
  }
  if (a.kind === 'transform' && b.kind === 'transform') {
    return sameCell(a.from, b.from) && sameCell(a.to, b.to) && a.into === b.into;
  }
  if ((a.kind === 'swap' || a.kind === 'convert' || a.kind === 'retreat') && a.kind === b.kind) {
    return sameCell((a as { from: Cell }).from, (b as { from: Cell }).from) && sameCell((a as { to: Cell }).to, (b as { to: Cell }).to);
  }
  if (a.kind === 'defense' && b.kind === 'defense') return a.block === b.block;
  return false;
}

function eqCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (!a || !b) return a === b;
  return sameCell(a, b);
}

export { cellKey, isLight };
