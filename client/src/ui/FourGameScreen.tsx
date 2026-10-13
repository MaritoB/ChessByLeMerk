import { useEffect, useMemo, useState } from 'react';
import { SEATS, SEAT_ORDER, sameCell, sameMove, type Cell, type FMove, type PieceType, type Seat } from '../four/board';
import type { FourSnapshot } from '../four/engine';
import type { FourSession } from '../four/session';
import { Board4 } from './Board4';
import { RoomLink } from './RoomLink';
import { useClocks, formatClock } from '../game/clock';

export interface FourGameScreenProps {
  session: FourSession;
  onExit: () => void;
}

const PROMO: { value: PieceType; label: string }[] = [
  { value: 'q', label: '\u265B' },
  { value: 'r', label: '\u265C' },
  { value: 'b', label: '\u265D' },
  { value: 'n', label: '\u265E' },
];

export function FourGameScreen({ session, onExit }: FourGameScreenProps) {
  const [snap, setSnap] = useState<FourSnapshot>(() => session.engine.snapshot());
  const [selected, setSelected] = useState<Cell | null>(null);
  const [pending, setPending] = useState<{ from: Cell; to: Cell } | null>(null);
  const [, force] = useState(0);

  useEffect(() => session.engine.subscribe(setSnap), [session]);
  useEffect(() => session.subscribe(() => force((v) => v + 1)), [session]);

  const engine = session.engine;
  const turn = snap.turn;

  const clockTC =
    session.timeControl && (!session.online || (session.connected && session.phase === 'playing'))
      ? session.timeControl
      : { initial: 0, increment: 0 };
  const { remaining: clockLeft, enabled: clockOn } = useClocks({
    sides: SEAT_ORDER,
    active: turn,
    moveCount: snap.history.length,
    timeControl: clockTC,
    onFlag: (side) => session.flag?.(side),
  });
  const myTurn = session.mySeat === 'all' || session.mySeat === turn;
  const canPlay =
    !snap.result &&
    myTurn &&
    (!session.online || (session.connected && session.phase === 'playing'));

  const legalMoves = useMemo<FMove[]>(() => (canPlay ? engine.legalMoves() : []), [engine, snap, canPlay]);
  const targets = useMemo(
    () => (selected ? legalMoves.filter((m) => sameCell(m.from, selected)).map((m) => m.to) : []),
    [legalMoves, selected],
  );

  const checkCells = useMemo(() => {
    if (!snap.check) return [] as Cell[];
    for (let r = 0; r < snap.board.length; r++) {
      for (let f = 0; f < snap.board[r].length; f++) {
        const p = snap.board[r][f];
        if (p && p.type === 'k' && p.seat === snap.check) return [{ f, r }];
      }
    }
    return [] as Cell[];
  }, [snap]);

  function doMove(move: FMove) {
    const ok = session.makeMove(move);
    setSelected(null);
    setPending(null);
    return ok;
  }

  function tryMove(from: Cell, to: Cell) {
    const options = legalMoves.filter((m) => sameCell(m.from, from) && sameCell(m.to, to));
    if (options.some((m) => m.promotion)) {
      setPending({ from, to });
      return;
    }
    if (options.length) doMove(options[0]);
  }

  function handleCell(cell: Cell) {
    if (!canPlay) return;
    if (selected) {
      const hit = targets.find((t) => sameCell(t, cell));
      if (hit) {
        tryMove(selected, cell);
        return;
      }
    }
    const piece = snap.board[cell.r][cell.f];
    if (piece && piece.seat === turn) {
      setSelected(cell);
    } else {
      setSelected(null);
    }
  }

  function handleResign() {
    if (snap.result) return;
    if (window.confirm('¿Abandonar la partida?')) session.resign();
  }

  function handleLeave() {
    session.leave();
    onExit();
  }

  const resultText = (() => {
    if (!snap.result) return null;
    const { winners, reason, draw } = snap.result;
    if (draw || winners.length === 0) return `Tablas (${reason})`;
    if (session.format === 'teams') {
      const teamName = winners.includes('red') ? 'Rojos + Amarillos' : 'Azules + Verdes';
      return `Gana el equipo ${teamName}`;
    }
    if (winners.length === 1) return `Gana ${session.seatNames[winners[0]] ?? SEATS[winners[0]].label}`;
    return `Ganadores: ${winners.map((s) => session.seatNames[s] ?? SEATS[s].label).join(', ')} (${reason})`;
  })();

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar__left">
          <span className="chip chip--mode">
            {session.format === 'teams' ? '\u{1F91D}' : '\u2694\uFE0F'} Ajedrez de 4 ·{' '}
            {session.format === 'teams' ? 'Equipos' : 'Free-for-all'}
          </span>
          <span className={`chip ${!session.online || session.connected ? 'chip--ok' : 'chip--warn'}`}>
            {session.online ? (session.connected ? 'Conectado' : 'Conectando...') : 'Partida local'}
          </span>
        </div>
        <div className="topbar__right">
          <span className="chip">{session.statusText}</span>
          <button type="button" className="btn btn--ghost" onClick={handleLeave}>
            Salir
          </button>
        </div>
      </header>

      <div className="game__body">
        <div className="game__boardwrap game__boardwrap--four">
          {clockOn && (
            <div className="clocks clocks--four">
              {SEAT_ORDER.map((seat) => (
                <div
                  key={seat}
                  className={`clock ${turn === seat ? 'clock--active' : ''} ${clockLeft(seat) <= 20_000 ? 'clock--low' : ''}`}
                >
                  <span className="clock__side">
                    <span className="swatch swatch--tiny" style={{ background: SEATS[seat].color }} />
                    {session.seatNames[seat] ?? SEATS[seat].label}
                  </span>
                  <span className="clock__time">{formatClock(clockLeft(seat))}</span>
                </div>
              ))}
            </div>
          )}
          <div className="turn turn--big">
            <span className="turn__dot" style={{ background: SEATS[turn].color }} />
            {snap.result ? 'Partida terminada' : `Turno de ${SEATS[turn].label}`}
            {snap.check ? ' (jaque)' : ''}
          </div>

          <Board4
            board={snap.board}
            selected={selected}
            targets={targets}
            lastMove={snap.lastMove}
            onCell={handleCell}
            disabled={!canPlay}
            checkCells={checkCells}
          />

          {snap.result && (
            <div className="result-overlay">
              <div className="result-card">
                <h2>{resultText}</h2>
                <div className="result-actions">
                  <button type="button" className="btn btn--primary" onClick={() => session.rematch()}>
                    Revancha
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={handleLeave}>
                    Salir
                  </button>
                </div>
              </div>
            </div>
          )}

          {pending && (
            <div className="result-overlay">
              <div className="result-card">
                <h3>Coronar en</h3>
                <div className="promo-row">
                  {PROMO.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      className="btn btn--ghost promo-btn"
                      onClick={() => doMove({ from: pending.from, to: pending.to, promotion: p.value })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn--ghost" onClick={() => setPending(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {session.online && session.phase !== 'playing' && (
            <div className="result-overlay">
              <div className="result-card">
                <h3>Esperando jugadores</h3>
                <p className="muted">
                  {session.playerCount}/{session.playerTarget} jugadores
                </p>
                <ul className="players players--wait">
                  {SEAT_ORDER.map((seat) => (
                    <li key={seat}>
                      <span className="swatch" style={{ background: SEATS[seat].color }} />
                      {session.seatNames[seat] ?? '\u2014 vacio \u2014'}
                    </li>
                  ))}
                </ul>
                {session.isHost ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => session.start()}
                    disabled={!session.canStart}
                  >
                    {session.canStart ? 'Empezar partida' : 'Faltan jugadores...'}
                  </button>
                ) : (
                  <p className="muted small">Esperando a que el anfitrion empiece...</p>
                )}
                {session.roomId && <RoomLink roomId={session.roomId} />}
              </div>
            </div>
          )}
        </div>

        <aside className="game__side">
          <div className="panel">
            <div className="panel__title">Jugadores</div>
            <ul className="players">
              {SEAT_ORDER.map((seat) => {
                const alive = !snap.eliminated.includes(seat);
                const isTurn = seat === turn && !snap.result;
                const isMe = session.mySeat === seat;
                return (
                  <li key={seat} className={isTurn ? 'players__row players__row--turn' : 'players__row'}>
                    <span className="swatch" style={{ background: SEATS[seat].color }} />
                    <span className={alive ? '' : 'players__dead'}>
                      {session.seatNames[seat] ?? SEATS[seat].label}
                      {isMe ? ' (tu)' : ''}
                    </span>
                    {!alive && <span className="tag-dead">fuera</span>}
                    {isTurn && <span className="tag-turn">turno</span>}
                  </li>
                );
              })}
            </ul>
            {session.format === 'teams' && (
              <p className="muted small">Equipos: Rojo+Amarillo vs Azul+Verde</p>
            )}
          </div>

          <div className="panel">
            <div className="panel__title">Jugadas</div>
            <ol className="movelist movelist--four">
              {snap.history.map((h, i) => (
                <li key={i}>
                  <span className="swatch swatch--tiny" style={{ background: SEATS[h.seat].color }} />
                  {h.notation}
                </li>
              ))}
            </ol>
          </div>

          <div className="game__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleResign}
              disabled={Boolean(snap.result)}
            >
              Rendirse
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => session.rematch()}>
              Revancha
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
