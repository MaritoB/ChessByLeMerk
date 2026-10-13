import type { Color, Move, PieceSymbol, Square } from 'chess.js';
import { Chess } from '../chess/engine';
import { gameStatus, legalMoves, opponentColor } from '../chess/engine';
import type { GameMode } from '../modes/types';

export interface PenaltyInfo {
  color: Color;
  livesLeft: number;
  gameOver: boolean;
}

export interface MoveResult {
  ok: boolean;
  san?: string;
  error?: string;
  penalty?: PenaltyInfo;
  ambiguous?: Move[];
  move?: { from: string; to: string; promotion?: string };
}

export interface GameSnapshot {
  fen: string;
  turn: Color;
  history: Move[];
  lastMove: Move | null;
  check: boolean;
  finished: boolean;
  result: { winner: Color | 'draw' | null; reason: string } | null;
  lives: Record<Color, number>;
  reveal: { color: Color; until: number } | null;
  modeId: string;
  moveNumber: number;
}

type Listener = (snapshot: GameSnapshot) => void;

export class GameController {
  private chess: Chess;
  private readonly mode: GameMode;
  private lives: Record<Color, number>;
  private reveal: { color: Color; until: number } | null = null;
  private result: { winner: Color | 'draw' | null; reason: string } | null = null;
  private listeners = new Set<Listener>();
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** Modo sandbox/edicion: se pueden mover piezas libremente. */
  editing = false;
  private editTurn: Color = 'w';

  constructor(mode: GameMode, startFen?: string) {
    this.mode = mode;
    this.chess = new Chess(startFen);
    const l = mode.lives;
    this.lives = { w: l, b: l };
  }

  get gameMode(): GameMode {
    return this.mode;
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

  snapshot(): GameSnapshot {
    const history = this.chess.history({ verbose: true }) as unknown as Move[];
    return {
      fen: this.chess.fen(),
      turn: this.editing ? this.editTurn : this.chess.turn(),
      history,
      lastMove: history.length ? history[history.length - 1] : null,
      check: this.chess.inCheck(),
      finished: this.result !== null,
      result: this.result,
      lives: { ...this.lives },
      reveal: this.reveal,
      modeId: this.mode.id,
      moveNumber: Math.floor(history.length / 2) + 1,
    };
  }

  /** Instancia de chess.js de solo lectura para consultas (vision, jugadas...). */
  view(): Chess {
    return new Chess(this.chess.fen());
  }

  enterSandbox(): void {
    this.editing = true;
    this.editTurn = 'w';
    this.emit();
  }

  private fenWithTurn(turn: Color): string {
    const parts = this.chess.fen().split(' ');
    return `${parts[0]} ${turn} - - 0 1`;
  }

  /** Movimiento libre de cualquier pieza (sandbox/edicion). */
  editMove(from: Square, to: Square, promotion?: string): boolean {
    if (from === to) return false;
    const piece = this.chess.get(from);
    if (!piece) return false;
    this.chess.remove(from);
    this.chess.remove(to);
    let type: PieceSymbol = piece.type;
    if (piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      type = (promotion as PieceSymbol) || 'q';
    }
    this.chess.put({ type, color: piece.color }, to);
    this.chess.load(this.fenWithTurn(this.editTurn));
    this.emit();
    return true;
  }

  attempt(move: { from: string; to: string; promotion?: string }, by: Color): MoveResult {
    if (this.result) return { ok: false, error: 'La partida ha terminado' };
    if (this.chess.turn() !== by) return { ok: false, error: 'No es tu turno' };

    const legal = legalMoves(this.chess);
    const matching = legal.filter(
      (m) => m.from === move.from && m.to === move.to,
    );

    if (matching.length === 0) {
      return this.registerIllegal(by, 'Jugada ilegal');
    }

    const chosen = matching[0];
    const promotion = chosen.promotion ? move.promotion ?? 'q' : undefined;
    const applied = this.chess.move({
      from: chosen.from,
      to: chosen.to,
      promotion,
    }) as unknown as Move;

    this.afterMove();
    this.emit();
    return { ok: true, san: applied.san, move: { from: chosen.from, to: chosen.to, promotion } };
  }

  /** Aplica una jugada recibida del rival (ya validada por el). */
  applyRemote(move: { from: string; to: string; promotion?: string }): boolean {
    if (this.result) return false;
    try {
      const applied = this.chess.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      }) as unknown as Move;
      void applied;
      this.afterMove();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  /** Aplica un fallo recibido del rival (mantiene las vidas sincronizadas). */
  applyRemoteMistake(by: Color): void {
    if (this.result) return;
    if (!Number.isFinite(this.mode.lives)) return;
    this.lives[by] = Math.max(0, this.lives[by] - 1);
    if (this.lives[by] <= 0) {
      this.result = { winner: opponentColor(by), reason: 'Sin vidas' };
    }
    this.emit();
  }

  private afterMove(): void {
    const status = gameStatus(this.chess);
    if (status.over) {
      this.result = { winner: status.winner, reason: status.reason };
    }
  }

  /** Registra un fallo explicito (p. ej. una jugada dictada que es ilegal). */
  mistake(by: Color, reason: string): MoveResult {
    if (this.result) return { ok: false, error: 'La partida ha terminado' };
    return this.registerIllegal(by, reason);
  }

  private registerIllegal(by: Color, error: string): MoveResult {
    if (this.mode.penaltyOnIllegal && Number.isFinite(this.mode.lives)) {
      this.lives[by] = Math.max(0, this.lives[by] - 1);
      if (this.lives[by] <= 0) {
        this.result = { winner: opponentColor(by), reason: 'Sin vidas' };
      }
      this.startReveal(by);
      this.emit();
      return {
        ok: false,
        error,
        penalty: { color: by, livesLeft: this.lives[by], gameOver: this.result !== null },
      };
    }
    return { ok: false, error };
  }

  private startReveal(color: Color): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    const until = Date.now() + this.mode.penaltyRevealMs;
    this.reveal = { color, until };
    this.revealTimer = setTimeout(() => {
      this.reveal = null;
      this.revealTimer = null;
      this.emit();
    }, this.mode.penaltyRevealMs);
  }

  resign(by: Color): void {
    if (this.result) return;
    this.result = { winner: opponentColor(by), reason: 'Abandono' };
    this.emit();
  }

  flag(winner: Color, reason: string): void {
    if (this.result) return;
    this.result = { winner, reason };
    this.emit();
  }

  reset(startFen?: string): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
    this.reveal = null;
    this.result = null;
    this.chess = new Chess(startFen);
    this.lives = { w: this.mode.lives, b: this.mode.lives };
    this.emit();
  }

  dispose(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.listeners.clear();
  }
}
