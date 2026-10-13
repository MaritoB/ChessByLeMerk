import {
  BASE_BACK_TYPES,
  SEATS,
  SEAT_ORDER,
  SIZE,
  isPlayable,
  isTeammate,
  sameMove,
  squareName,
  type Cell,
  type FMove,
  type GameFormat,
  type Piece,
  type PieceType,
  type Seat,
} from './board';

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
const DIAGONALS: Cell[] = [
  { f: 1, r: 1 },
  { f: 1, r: -1 },
  { f: -1, r: 1 },
  { f: -1, r: -1 },
];
const ORTHOGONALS: Cell[] = [
  { f: 1, r: 0 },
  { f: -1, r: 0 },
  { f: 0, r: 1 },
  { f: 0, r: -1 },
];

type Board = (Piece | null)[][];

export interface AppliedMove {
  seat: Seat;
  move: FMove;
  captured?: Piece;
  promotion?: PieceType;
  notation: string;
}

export interface FourResult {
  winners: Seat[];
  reason: string;
  draw: boolean;
}

export interface FourSnapshot {
  board: Board;
  turn: Seat;
  order: Seat[];
  eliminated: Seat[];
  format: GameFormat;
  result: FourResult | null;
  history: AppliedMove[];
  lastMove: FMove | null;
  check: Seat | null;
  moveNumber: number;
}

type Listener = (snapshot: FourSnapshot) => void;

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array<Piece | null>(SIZE).fill(null));
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

export class FourChess {
  board: Board;
  order: Seat[];
  turnIndex = 0;
  eliminated = new Set<Seat>();
  format: GameFormat;
  result: FourResult | null = null;
  history: AppliedMove[] = [];
  lastMove: FMove | null = null;
  private listeners = new Set<Listener>();

  constructor(format: GameFormat) {
    this.format = format;
    this.order = [...SEAT_ORDER];
    this.board = emptyBoard();
    this.setup();
  }

  private setup(): void {
    for (const seat of SEAT_ORDER) {
      const meta = SEATS[seat];
      meta.backRank.forEach((cell, i) => {
        this.board[cell.r][cell.f] = { type: BASE_BACK_TYPES[i], seat };
      });
      for (const cell of meta.startPawns) {
        this.board[cell.r][cell.f] = { type: 'p', seat };
      }
    }
  }

  reset(): void {
    this.board = emptyBoard();
    this.eliminated = new Set();
    this.result = null;
    this.history = [];
    this.lastMove = null;
    this.turnIndex = 0;
    this.setup();
    this.emit();
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

  snapshot(): FourSnapshot {
    return {
      board: cloneBoard(this.board),
      turn: this.currentSeat(),
      order: [...this.order],
      eliminated: [...this.eliminated],
      format: this.format,
      result: this.result,
      history: [...this.history],
      lastMove: this.lastMove ? { from: { ...this.lastMove.from }, to: { ...this.lastMove.to } } : null,
      check: this.isChecked(this.currentSeat()) ? this.currentSeat() : null,
      moveNumber: this.history.length + 1,
    };
  }

  pieceAt(cell: Cell): Piece | null {
    if (!isPlayable(cell.f, cell.r)) return null;
    return this.board[cell.r][cell.f];
  }

  currentSeat(): Seat {
    return this.order[this.turnIndex];
  }

  private isEnemy(a: Seat, b: Seat): boolean {
    return a !== b && !isTeammate(this.format, a, b);
  }

  // ---- Generacion de movimientos ----

  private pushTarget(out: FMove[], from: Cell, f: number, r: number, seat: Seat): boolean {
    if (!isPlayable(f, r)) return false;
    const target = this.board[r][f];
    if (target && target.seat === seat) return false;
    if (target && isTeammate(this.format, seat, target.seat)) return false;
    out.push({ from: { ...from }, to: { f, r } });
    return !target;
  }

  private addPawnStep(out: FMove[], from: Cell, to: Cell, seat: Seat): void {
    if (SEATS[seat].isPromotion(to.f, to.r)) {
      for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) {
        out.push({ from: { ...from }, to: { ...to }, promotion: promo });
      }
    } else {
      out.push({ from: { ...from }, to: { ...to } });
    }
  }

  pseudoMovesFrom(cell: Cell): FMove[] {
    const piece = this.pieceAt(cell);
    if (!piece) return [];
    const seat = piece.seat;
    const out: FMove[] = [];
    const from = { ...cell };

    const rays = (dirs: Cell[]) => {
      for (const dir of dirs) {
        let f = cell.f + dir.f;
        let r = cell.r + dir.r;
        while (this.pushTarget(out, from, f, r, seat)) {
          f += dir.f;
          r += dir.r;
        }
      }
    };

    switch (piece.type) {
      case 'p': {
        const fw = SEATS[seat].forward;
        const one = { f: cell.f + fw.f, r: cell.r + fw.r };
        if (isPlayable(one.f, one.r) && !this.board[one.r][one.f]) {
          this.addPawnStep(out, from, one, seat);
          const two = { f: cell.f + fw.f * 2, r: cell.r + fw.r * 2 };
          if (
            SEATS[seat].isPawnStart(cell.f, cell.r) &&
            isPlayable(two.f, two.r) &&
            !this.board[two.r][two.f]
          ) {
            out.push({ from: { ...from }, to: two });
          }
        }
        for (const cap of SEATS[seat].captures) {
          const t = { f: cell.f + cap.f, r: cell.r + cap.r };
          if (!isPlayable(t.f, t.r)) continue;
          const target = this.board[t.r][t.f];
          if (target && this.isEnemy(seat, target.seat)) {
            this.addPawnStep(out, from, t, seat);
          }
        }
        break;
      }
      case 'n':
        for (const d of KNIGHT_DELTAS) {
          const f = cell.f + d.f;
          const r = cell.r + d.r;
          if (!isPlayable(f, r)) continue;
          const t = this.board[r][f];
          if (t && t.seat === seat) continue;
          if (t && isTeammate(this.format, seat, t.seat)) continue;
          out.push({ from: { ...from }, to: { f, r } });
        }
        break;
      case 'k':
        for (const d of KING_DELTAS) {
          const f = cell.f + d.f;
          const r = cell.r + d.r;
          if (!isPlayable(f, r)) continue;
          const t = this.board[r][f];
          if (t && t.seat === seat) continue;
          if (t && isTeammate(this.format, seat, t.seat)) continue;
          out.push({ from: { ...from }, to: { f, r } });
        }
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
    return out;
  }

  /** Casillas atacadas por la pieza (ignora el jaque propio). */
  private attackedSquares(cell: Cell, piece: Piece): Cell[] {
    const out: Cell[] = [];
    const add = (f: number, r: number) => {
      if (isPlayable(f, r)) out.push({ f, r });
    };
    switch (piece.type) {
      case 'p':
        for (const cap of SEATS[piece.seat].captures) add(cell.f + cap.f, cell.r + cap.r);
        break;
      case 'n':
        for (const d of KNIGHT_DELTAS) add(cell.f + d.f, cell.r + d.r);
        break;
      case 'k':
        for (const d of KING_DELTAS) add(cell.f + d.f, cell.r + d.r);
        break;
      case 'b':
      case 'r':
      case 'q': {
        const dirs =
          piece.type === 'b' ? DIAGONALS : piece.type === 'r' ? ORTHOGONALS : [...DIAGONALS, ...ORTHOGONALS];
        for (const dir of dirs) {
          let f = cell.f + dir.f;
          let r = cell.r + dir.r;
          while (isPlayable(f, r)) {
            out.push({ f, r });
            if (this.board[r][f]) break;
            f += dir.f;
            r += dir.r;
          }
        }
        break;
      }
      default:
        break;
    }
    return out;
  }

  /** ¿El rey del asiento indicado esta atacado en el tablero dado? */
  private checkedOn(board: Board, seat: Seat): boolean {
    let king: Cell | null = null;
    for (let r = 0; r < SIZE && !king; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.seat === seat) {
          king = { f, r };
          break;
        }
      }
    }
    if (!king) return false;
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = board[r][f];
        if (!p || !this.isEnemy(seat, p.seat)) continue;
        for (const sq of this.attackedSquares({ f, r }, p)) {
          if (sq.f === king.f && sq.r === king.r) return true;
        }
      }
    }
    return false;
  }

  isChecked(seat: Seat): boolean {
    return this.checkedOn(this.board, seat);
  }

  private applyOn(board: Board, move: FMove): { captured?: Piece; promotion?: PieceType } {
    const piece = board[move.from.r][move.from.f];
    if (!piece) return {};
    const captured = board[move.to.r][move.to.f] ?? undefined;
    board[move.from.r][move.from.f] = null;
    let type = piece.type;
    let promotion: PieceType | undefined;
    if (piece.type === 'p' && SEATS[piece.seat].isPromotion(move.to.f, move.to.r)) {
      type = move.promotion ?? 'q';
      promotion = type;
    }
    board[move.to.r][move.to.f] = { type, seat: piece.seat };
    return { captured, promotion };
  }

  private wouldBeInCheck(seat: Seat, move: FMove): boolean {
    const clone = cloneBoard(this.board);
    this.applyOn(clone, move);
    return this.checkedOn(clone, seat);
  }

  legalMovesFor(seat: Seat): FMove[] {
    const result: FMove[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const piece = this.board[r][f];
        if (!piece || piece.seat !== seat) continue;
        for (const move of this.pseudoMovesFrom({ f, r })) {
          if (!this.wouldBeInCheck(seat, move)) result.push(move);
        }
      }
    }
    return result;
  }

  legalMoves(): FMove[] {
    return this.legalMovesFor(this.currentSeat());
  }

  private notation(piece: Piece, move: FMove, captured?: Piece, promotion?: PieceType): string {
    const letter = piece.type === 'p' ? '' : piece.type.toUpperCase();
    const capture = captured ? 'x' : '-';
    const promo = promotion ? `=${promotion.toUpperCase()}` : '';
    return `${letter}${squareName(move.from)}${capture}${squareName(move.to)}${promo}`;
  }

  makeMove(move: FMove): boolean {
    if (this.result) return false;
    const seat = this.currentSeat();
    const legal = this.legalMovesFor(seat);
    const match = legal.find((m) => sameMove(m, move));
    if (!match) return false;

    const piece = this.board[match.from.r][match.from.f]!;
    const { captured, promotion } = this.applyOn(this.board, match);
    this.history.push({
      seat,
      move: {
        from: { ...match.from },
        to: { ...match.to },
        promotion: match.promotion,
      },
      captured,
      promotion,
      notation: this.notation(piece, match, captured, promotion),
    });
    this.lastMove = { from: { ...match.from }, to: { ...match.to } };

    this.nextTurn();
    this.checkGameEnd();
    this.emit();
    return true;
  }

  private eliminate(seat: Seat): void {
    if (this.eliminated.has(seat)) return;
    this.eliminated.add(seat);
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        if (this.board[r][f]?.seat === seat) this.board[r][f] = null;
      }
    }
  }

  private nextTurn(): void {
    for (let i = 0; i < this.order.length; i++) {
      this.turnIndex = (this.turnIndex + 1) % this.order.length;
      const seat = this.currentSeat();
      if (this.eliminated.has(seat)) continue;
      if (this.legalMovesFor(seat).length === 0) {
        this.eliminate(seat);
        continue;
      }
      return;
    }
  }

  private checkGameEnd(): void {
    const alive = this.order.filter((s) => !this.eliminated.has(s));

    if (this.format === 'teams') {
      const teamA = alive.filter((s) => s === 'red' || s === 'yellow');
      const teamB = alive.filter((s) => s === 'blue' || s === 'green');
      if (teamA.length === 0 || teamB.length === 0) {
        const winners = teamA.length > 0 ? teamA : teamB;
        this.result = { winners, reason: 'Equipo rival eliminado', draw: false };
      }
      return;
    }

    if (alive.length === 1) {
      this.result = { winners: alive, reason: 'Ultimo rey en pie', draw: false };
      return;
    }
    if (alive.length === 0) {
      this.result = { winners: [], reason: 'Todos eliminados', draw: true };
      return;
    }
    if (alive.length === 2 && this.onlyKings(alive)) {
      this.result = { winners: [], reason: 'Solo quedan reyes', draw: true };
    }
  }

  private onlyKings(seats: Seat[]): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let f = 0; f < SIZE; f++) {
        const p = this.board[r][f];
        if (p && seats.includes(p.seat) && p.type !== 'k') return false;
      }
    }
    return true;
  }

  resign(seat: Seat): void {
    if (this.result) return;
    this.eliminate(seat);
    if (!this.eliminated.has(this.currentSeat())) {
      // el turno no cambia salvo que fuera su turno
    } else {
      this.nextTurn();
    }
    this.checkGameEnd();
    if (!this.result && this.eliminated.has(this.currentSeat())) this.nextTurn();
    this.emit();
  }

  cancel(reason = 'Partida cancelada'): void {
    if (this.result) return;
    this.result = { winners: [], reason, draw: true };
    this.emit();
  }

  ensureTurnValid(): void {
    if (!this.result && this.eliminated.has(this.currentSeat())) this.nextTurn();
  }
}
