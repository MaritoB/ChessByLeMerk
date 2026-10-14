import { useEffect, useMemo, useState } from 'react';
import {
  cellKey,
  sameCell,
  squareName,
  type Action,
  type Cell,
  type Color,
  type PieceType,
} from '../var/board';
import { FACTORY_TURNS, KING_QUEEN_TURNS, SPAWN_TURNS, type VarSnapshot } from '../var/engine';
import { varLabel, type VarSession } from '../var/session';
import { BoardVar } from './BoardVar';
import { RoomLink } from './RoomLink';
import { SkillHelp } from './SkillHelp';
import { Captured } from './Captured';
import { ClockBar } from './ClockBar';
import { useClocks } from '../game/clock';
import { useFirstMoveTimer } from '../game/hooks';
import { toggleAnnotation, type Annotation } from './annotations';

export interface VarGameScreenProps {
  session: VarSession;
  onExit: () => void;
}

const PROMO: { value: PieceType; label: string }[] = [
  { value: 'q', label: '\u265B' },
  { value: 'r', label: '\u265C' },
  { value: 'b', label: '\u265D' },
  { value: 'n', label: '\u265E' },
];

function destOf(action: Action): Cell | null {
  switch (action.kind) {
    case 'move':
    case 'retreat':
    case 'ride':
    case 'dismount':
    case 'shelter':
      return action.to;
    default:
      return null;
  }
}

export function VarGameScreen({ session, onExit }: VarGameScreenProps) {
  const [snap, setSnap] = useState<VarSnapshot>(() => session.engine.snapshot());
  const [selected, setSelected] = useState<Cell | null>(null);
  const [promo, setPromo] = useState<Action[] | null>(null);
  const [pendingMode, setPendingMode] = useState<{ kind: 'longshot'; from: Cell } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [menuCell, setMenuCell] = useState<Cell | null>(null);
  const [, force] = useState(0);

  useEffect(() => session.engine.subscribe(setSnap), [session]);
  useEffect(() => session.subscribe(() => force((v) => v + 1)), [session]);

  const engine = session.engine;
  const myTurn = session.myColor === 'all' || session.myColor === snap.turn;
  const canPlay = !snap.result && myTurn && (!session.online || session.connected);

  const moves = useMemo(() => (canPlay ? engine.legalMoves() : []), [engine, snap, canPlay]);
  const skills = useMemo(() => (canPlay ? engine.skillActions() : []), [engine, snap, canPlay]);

  const viewerColor: Color = session.myColor === 'all' ? snap.turn : session.myColor;
  const fogOn = session.config.fog;
  const visible = useMemo(
    () => (fogOn ? engine.vision(viewerColor) : null),
    [engine, snap, fogOn, viewerColor],
  );

  const actionsFromSelected = useMemo(() => {
    if (!selected) return [] as Action[];
    return [...moves, ...skills].filter(
      (a) => 'from' in a && sameCell((a as { from: Cell }).from, selected),
    );
  }, [moves, skills, selected]);

  const longshotActions = useMemo(
    () => actionsFromSelected.filter((a): a is Extract<Action, { kind: 'longshot' }> => a.kind === 'longshot'),
    [actionsFromSelected],
  );
  const transformActions = useMemo(
    () => actionsFromSelected.filter((a): a is Extract<Action, { kind: 'transform' }> => a.kind === 'transform'),
    [actionsFromSelected],
  );
  const has = (kind: Action['kind']) => actionsFromSelected.some((a) => a.kind === kind);

  const targets = useMemo(() => {
    const out: Cell[] = [];
    if (pendingMode) {
      for (const a of actionsFromSelected) {
        if (a.kind === 'longshot' && !out.some((c) => sameCell(c, a.to))) out.push(a.to);
      }
      return out;
    }
    for (const a of actionsFromSelected) {
      if (a.kind === 'longshot') continue;
      const d = destOf(a);
      if (d && !out.some((c) => sameCell(c, d))) out.push(d);
    }
    return out;
  }, [actionsFromSelected, pendingMode]);

  const checkCell = useMemo(() => {
    if (!snap.check) return null;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = snap.board[r][f];
        if (p && p.type === 'k' && p.color === snap.turn) return { f, r };
      }
    }
    return null;
  }, [snap]);

  const { capturedByWhite, capturedByBlack } = useMemo(() => {
    const byWhite: PieceType[] = [];
    const byBlack: PieceType[] = [];
    for (const h of snap.history) {
      if (h.captured) (h.color === 'w' ? byWhite : byBlack).push(h.captured.type);
    }
    return { capturedByWhite: byWhite, capturedByBlack: byBlack };
  }, [snap.history]);

  function submit(action: Action): boolean {
    const ok = session.makeAction(action);
    if (ok) {
      setSelected(null);
      setPromo(null);
      setPendingMode(null);
      setAnnotations([]);
      setMenuCell(null);
    }
    return ok;
  }

  /** Muestra el menu de skills de una pieza (click derecho / pulsacion larga). */
  function openSkillMenu(cell: Cell): boolean {
    if (!canPlay) return false;
    const p = snap.board[cell.r][cell.f];
    if (!p || p.color !== snap.turn) return false;
    setSelected(cell);
    setPendingMode(null);
    setMenuCell(cell);
    return true;
  }

  function applyCandidates(candidates: Action[]): boolean {
    if (candidates.some((a) => (a.kind === 'move' || a.kind === 'dismount') && a.promotion)) {
      setPromo(candidates);
      return false;
    }
    return submit(candidates[0]);
  }

  function handleCell(cell: Cell) {
    if (annotations.length) setAnnotations([]);
    setMenuCell(null);
    if (!canPlay) return;
    if (pendingMode && selected) {
      const casts = actionsFromSelected.filter((a) => a.kind === 'longshot' && sameCell(a.to, cell));
      if (casts.length) {
        submit(casts[0]);
        return;
      }
      setPendingMode(null);
    }
    if (selected) {
      const candidates = actionsFromSelected.filter((a) => {
        if (a.kind === 'longshot') return false;
        const d = destOf(a);
        return d ? sameCell(d, cell) : false;
      });
      if (candidates.length) {
        applyCandidates(candidates);
        return;
      }
    }
    const p = snap.board[cell.r][cell.f];
    if (p) {
      // Pulsar la misma pieza ya seleccionada NO la deselecciona.
      if (selected && sameCell(selected, cell)) return;
      setSelected(p.color === snap.turn ? cell : null);
      setPendingMode(null);
      return;
    }
    setSelected(null);
    setPendingMode(null);
  }

  function dropMove(from: Cell, to: Cell) {
    if (!canPlay) return;
    const all = [...engine.legalMoves(), ...engine.skillActions()];
    const candidates = all.filter((a) => {
      if (!('from' in a)) return false;
      if (a.kind === 'longshot') return false;
      if (!sameCell((a as { from: Cell }).from, from)) return false;
      const d = destOf(a);
      return d ? sameCell(d, to) : false;
    });
    if (candidates.length) {
      applyCandidates(candidates);
      return;
    }
    const p = snap.board[to.r][to.f];
    setSelected(p && p.color === snap.turn ? to : null);
    setPendingMode(null);
  }

  function handleResign() {
    if (snap.result) return;
    if (window.confirm('¿Abandonar la partida?')) session.resign();
  }

  const turnColor = snap.turn;

  const shrinkEvery = session.config.shrinkEvery;
  const showDanger = shrinkEvery > 0 && !snap.result;
  const dangerKeys = showDanger ? snap.nextRing.map((c) => `${c.f},${c.r}`) : [];
  const dangerLevel = showDanger ? Math.min(3, Math.max(0, Math.floor(snap.shrinkProgress * 4))) : 0;
  const pliesToShrink = showDanger ? shrinkEvery - Math.round(snap.shrinkProgress * shrinkEvery) : 0;

  const trainingCell =
    snap.training && snap.training.target.f >= 0 ? cellKey(snap.training.target) : null;

  const clockTC =
    session.timeControl && (!session.online || session.connected)
      ? session.timeControl
      : { initial: 0, increment: 0 };
  const { remaining: clockLeft, enabled: clockOn } = useClocks({
    sides: ['w', 'b'],
    active: snap.turn,
    moveCount: snap.history.length,
    timeControl: clockTC,
    onFlag: (side) => session.flag?.(side),
  });
  const firstMove = useFirstMoveTimer(
    session.online && session.connected,
    snap.history.length,
    20000,
    () => session.abort?.(),
  );

  const resultText = (() => {
    if (!snap.result) return null;
    if (/cancelada/i.test(snap.result.reason)) return 'Partida cancelada';
    if (snap.result.winner === 'draw') return `Tablas (${snap.result.reason})`;
    const won =
      session.myColor === 'all' ? snap.result.winner : snap.result.winner === session.myColor;
    const side = snap.result.winner === 'w' ? 'blancas' : 'negras';
    return `${session.online && session.myColor !== 'all' ? (won ? 'Ganaste' : 'Perdiste') : 'Ganan'} (${side}, ${snap.result.reason})`;
  })();

  const pieceName: Record<string, string> = { q: 'dama', r: 'torre', b: 'alfil', n: 'caballo' };

  function renderSkillControls() {
    if (!selected) return null;
    const sel = snap.board[selected.r][selected.f];
    if (!sel) return null;
    const spawnActions = actionsFromSelected.filter(
      (a): a is Extract<Action, { kind: 'spawn' }> => a.kind === 'spawn',
    );
    return (
      <div className="skills">
        <SkillHelp piece={sel.type} shieldActive={Boolean(sel.shield)} />
        {has('shield') && (
          <button type="button" className="btn btn--outline" onClick={() => submit(actionsFromSelected.find((a) => a.kind === 'shield')!)}>
            Activar escudo (fijo; quien lo ataca muere)
          </button>
        )}
        {has('unshield') && (
          <button type="button" className="btn btn--outline" onClick={() => submit(actionsFromSelected.find((a) => a.kind === 'unshield')!)}>
            Quitar escudo (puede volver a moverse)
          </button>
        )}
        {longshotActions.length > 0 && (
          <button
            type="button"
            className={pendingMode?.kind === 'longshot' ? 'btn btn--primary' : 'btn btn--outline'}
            onClick={() =>
              setPendingMode(pendingMode?.kind === 'longshot' ? null : { kind: 'longshot', from: selected })
            }
          >
            Longshot (1 turno; guarecido = instantáneo)
          </button>
        )}
        {pendingMode?.kind === 'longshot' && (
          <div className="muted small">Toca una casilla en diagonal para el longshot.</div>
        )}
        {has('retreat') && (
          <div className="muted small">Retroceder: toca la casilla de atras.</div>
        )}
        {has('pawnPush') && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => submit(actionsFromSelected.find((a) => a.kind === 'pawnPush')!)}
          >
            Ariete (gratis): avanzan todos los peones doblados de la columna
          </button>
        )}
        {spawnActions.length > 0 && (
          <div>
            <div className="muted small">
              Fábrica (reina guarecida): crea un peón nuevo en una casilla adyacente ({SPAWN_TURNS}{' '}
              turnos; la torre debe quedarse quieta).
            </div>
            <div className="skill-row" style={{ flexWrap: 'wrap' }}>
              {spawnActions.map((a, i) => (
                <button key={i} type="button" className="btn btn--outline" onClick={() => submit(a)}>
                  Peón en {squareName(a.to)} ({SPAWN_TURNS}t)
                </button>
              ))}
            </div>
          </div>
        )}
        {transformActions.length > 0 && (
          <div>
            <div className="muted small">
              Transformar un peón adyacente en otra pieza (tarda turnos; una pieza de cada tipo por
              bando). El rey solo puede hacer reinas; la reina guarecida, caballo/alfil/torre.
            </div>
            <div className="skill-row" style={{ flexWrap: 'wrap' }}>
              {transformActions.map((a, i) => (
                <button key={i} type="button" className="btn btn--outline" onClick={() => submit(a)}>
                  {squareName(a.to)} {'\u2192'} {pieceName[a.into] ?? a.into} (
                  {a.into === 'q' ? KING_QUEEN_TURNS : FACTORY_TURNS[a.into as 'n' | 'b' | 'r']}t)
                </button>
              ))}
            </div>
          </div>
        )}
        {snap.training && snap.training.color === turnColor && (
          <div className="muted small">
            Entrenando {pieceName[snap.training.into] ?? snap.training.into}: faltan {snap.training.turnsLeft}{' '}
            turno{snap.training.turnsLeft === 1 ? '' : 's'}.
          </div>
        )}
        {has('unshelter') && (
          <div>
            <div className="muted small">Desguarecer (suelta la pieza guarecida a una casilla adyacente):</div>
            <div className="skill-row" style={{ flexWrap: 'wrap' }}>
              {actionsFromSelected
                .filter((a): a is Extract<Action, { kind: 'unshelter' }> => a.kind === 'unshelter')
                .map((a, i) => (
                  <button key={i} type="button" className="btn btn--outline" onClick={() => submit(a)}>
                    Suelta en {squareName(a.to)}
                  </button>
                ))}
            </div>
          </div>
        )}
        {has('ride') && <div className="muted small">Montar: toca el caballo aliado adyacente.</div>}
        {has('dismount') && <div className="muted small">Desmontar: toca una casilla libre adyacente.</div>}
        {has('shelter') && (
          <div className="muted small">Guarecer: toca tu torre (o arrastra la pieza sobre ella).</div>
        )}
      </div>
    );
  }

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar__left">
          <span className="chip chip--mode">{'\u2728'} {varLabel(session.config)}</span>
          {session.config.shrinkEvery > 0 && (
            <span className="chip">Encoge cada {session.config.shrinkEvery} jugadas</span>
          )}
          <span className={`chip ${!session.online || session.connected ? 'chip--ok' : 'chip--warn'}`}>
            {session.online ? (session.connected ? 'Conectado' : 'Conectando...') : 'Partida local'}
          </span>
        </div>
        <div className="topbar__right">
          <span className="chip">{session.statusText}</span>
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            Salir
          </button>
        </div>
      </header>

      <div className="game__body">
        <div className="game__boardwrap">
          {firstMove.show && !snap.result && (
            <div className="first-move-banner">
              Primera jugada: {Math.ceil(firstMove.remaining / 1000)}s (si no, se cancela)
            </div>
          )}
          {clockOn && (
            <ClockBar
              white={clockLeft('w')}
              black={clockLeft('b')}
              active={snap.turn}
              whiteLabel={session.whiteName}
              blackLabel={session.blackName}
            />
          )}
          <div className="turn turn--big">
            <span className={`turn__dot turn__dot--${turnColor}`} />
            {snap.result ? 'Partida terminada' : `Turno de las ${turnColor === 'w' ? 'blancas' : 'negras'}`}
            {snap.check && !snap.result ? ' (jaque)' : ''}
          </div>

          <BoardVar
            snapshot={snap}
            myColor={session.myColor}
            selected={selected}
            targets={targets}
            onCell={handleCell}
            disabled={!canPlay}
            checkCell={checkCell}
            isDraggable={(c) => canPlay && !pendingMode && snap.board[c.r][c.f]?.color === snap.turn}
            onDragStart={(c) => {
              setSelected(c);
              setPendingMode(null);
            }}
            onDropMove={dropMove}
            onSkillMenu={openSkillMenu}
            annotations={annotations}
            onAnnotate={(a) => setAnnotations((prev) => toggleAnnotation(prev, a))}
            dangerKeys={dangerKeys}
            dangerLevel={dangerLevel}
            trainingCell={trainingCell}
            visible={visible}
            fog={fogOn}
          />

          {snap.result && (
            <div className="result-overlay">
              <div className="result-card">
                <h2>{resultText}</h2>
                <div className="result-actions">
                  <button type="button" className="btn btn--primary" onClick={() => session.rematch()}>
                    Revancha
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={onExit}>
                    Salir
                  </button>
                </div>
              </div>
            </div>
          )}

          {promo && (
            <div className="result-overlay">
              <div className="result-card">
                <h3>Coronar en</h3>
                <div className="promo-row">
                  {PROMO.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      className="btn btn--ghost promo-btn"
                      onClick={() => {
                        const chosen = promo.find(
                          (a) => (a.kind === 'move' || a.kind === 'dismount') && a.promotion === p.value,
                        );
                        if (chosen) submit(chosen);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn--ghost" onClick={() => setPromo(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {session.config.skills && menuCell && selected && (
            <div className="skill-popover">
              <div className="skill-popover__head">
                <span className="panel__title">Opciones de skill</span>
                <button type="button" className="btn btn--ghost btn--tiny" onClick={() => setMenuCell(null)}>
                  Cerrar
                </button>
              </div>
              {renderSkillControls()}
            </div>
          )}
        </div>

        <aside className="game__side">
          <div className="panel">
            <div className="panel__title">Jugadores</div>
            <div className="var-players">
              <div className={turnColor === 'w' && !snap.result ? 'var-players__row var-players__row--turn' : 'var-players__row'}>
                <span className="turn__dot turn__dot--w" /> {session.whiteName}
              </div>
              <div className={turnColor === 'b' && !snap.result ? 'var-players__row var-players__row--turn' : 'var-players__row'}>
                <span className="turn__dot turn__dot--b" /> {session.blackName}
              </div>
            </div>
          </div>

          {session.online && session.roomId && (
            <div className="panel">
              <div className="panel__title">Invitar</div>
              <RoomLink roomId={session.roomId} />
            </div>
          )}

          <div className="panel">
            <div className="panel__title">Capturas</div>
            <Captured
              capturedByWhite={capturedByWhite as unknown as import('chess.js').PieceSymbol[]}
              capturedByBlack={capturedByBlack as unknown as import('chess.js').PieceSymbol[]}
              whiteLabel={session.whiteName}
              blackLabel={session.blackName}
            />
          </div>

          {session.config.skills && (
            <div className="panel">
              <div className="panel__title">Habilidades</div>
              {selected ? (
                renderSkillControls()
              ) : (
                <div className="muted small">Selecciona una pieza para ver sus habilidades.</div>
              )}
              {(snap.transformed.w.length > 0 || snap.transformed.b.length > 0) && (
                <div className="muted small">
                  Fabricadas — blancas: {snap.transformed.w.join(', ') || '—'} · negras:{' '}
                  {snap.transformed.b.join(', ') || '—'}
                </div>
              )}
            </div>
          )}

          <div className="panel">
            <div className="panel__title">Jugadas</div>
            <ol className="movelist">
              {snap.history.map((h, i) => (
                <li key={i}>
                  {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}
                  {h.notation}
                  {h.shrunkRing ? ' (encoge)' : ''}
                </li>
              ))}
              {snap.shrinkCount > 0 && snap.history.length > 0 && (
                <li className="muted small">Anillos eliminados: {snap.shrinkCount}</li>
              )}
            </ol>
          </div>

          {showDanger && (
            <div className="panel">
              <div className="panel__title">Encogimiento</div>
              <div className="muted small">
                El anillo exterior se borra en {pliesToShrink} jugada{pliesToShrink === 1 ? '' : 's'}.
              </div>
              <div className="danger-legend">
                <span className="dl dl-0" />
                <span className="dl dl-1" />
                <span className="dl dl-2" />
                <span className="dl dl-3" />
                <span className="dl dl-4" />
                <span className="muted small">seguro → ultimo aviso · negro: ya borrada</span>
              </div>
            </div>
          )}

          <div className="game__actions">
            {!session.online && snap.canUndo && !snap.result && (
              <button type="button" className="btn btn--outline" onClick={() => session.undo?.()}>
                Deshacer
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={handleResign} disabled={Boolean(snap.result)}>
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
