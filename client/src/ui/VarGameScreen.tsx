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
import type { VarSnapshot } from '../var/engine';
import type { VarSession } from '../var/session';
import { BoardVar } from './BoardVar';
import { RoomLink } from './RoomLink';
import { SkillHelp } from './SkillHelp';
import { Captured } from './Captured';
import { ClockBar } from './ClockBar';
import { useClocks } from '../game/clock';
import { toggleAnnotation, type Annotation } from './annotations';

export interface VarGameScreenProps {
  session: VarSession;
  onExit: () => void;
}

const ARROW_DIRS: { df: number; dr: number; glyph: string; label: string }[] = [
  { df: -1, dr: 1, glyph: '\u2196', label: 'arriba-izq' },
  { df: 1, dr: 1, glyph: '\u2197', label: 'arriba-der' },
  { df: -1, dr: -1, glyph: '\u2199', label: 'abajo-izq' },
  { df: 1, dr: -1, glyph: '\u2198', label: 'abajo-der' },
];

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
    case 'swap':
    case 'convert':
    case 'ride':
    case 'unshelter':
    case 'transform':
      return action.to;
    case 'shelter':
      return action.target;
    case 'arrow':
      return action.mode === 'guided' ? action.target ?? null : null;
    default:
      return null;
  }
}

export function VarGameScreen({ session, onExit }: VarGameScreenProps) {
  const [snap, setSnap] = useState<VarSnapshot>(() => session.engine.snapshot());
  const [selected, setSelected] = useState<Cell | null>(null);
  const [promo, setPromo] = useState<Action[] | null>(null);
  const [pendingSkill, setPendingSkill] = useState<
    { kind: 'mount'; mode: 'tower' | 'archer' } | { kind: 'enterRook'; choice: 'queen' | 'shelter' } | null
  >(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [menuCell, setMenuCell] = useState<Cell | null>(null);
  const [, force] = useState(0);

  useEffect(() => session.engine.subscribe(setSnap), [session]);
  useEffect(() => session.subscribe(() => force((v) => v + 1)), [session]);

  const engine = session.engine;
  const myTurn = session.myColor === 'all' || session.myColor === snap.turn;
  const pending = snap.pendingDefense;
  const iAmDefender =
    session.myColor === 'all' || (pending ? pending.defenderColor === session.myColor : false);
  const canPlay = !snap.result && myTurn && !pending && (!session.online || session.connected);

  const moves = useMemo(() => (canPlay ? engine.legalMoves() : []), [engine, snap, canPlay]);
  const skills = useMemo(() => (canPlay ? engine.skillActions() : []), [engine, snap, canPlay]);

  const actionsFromSelected = useMemo(() => {
    if (!selected) return [] as Action[];
    return [...moves, ...skills].filter(
      (a) => 'from' in a && sameCell((a as { from: Cell }).from, selected),
    );
  }, [moves, skills, selected]);

  const targets = useMemo(() => {
    const out: Cell[] = [];
    if (pendingSkill) {
      for (const a of actionsFromSelected) {
        if (pendingSkill.kind === 'mount' && a.kind === 'mount' && a.mode === pendingSkill.mode) {
          if (!out.some((c) => sameCell(c, a.to))) out.push(a.to);
        }
        if (pendingSkill.kind === 'enterRook' && a.kind === 'enterRook' && a.choice === pendingSkill.choice) {
          if (!out.some((c) => sameCell(c, a.to))) out.push(a.to);
        }
      }
      return out;
    }
    for (const a of actionsFromSelected) {
      const d = destOf(a);
      if (d && !out.some((c) => sameCell(c, d))) out.push(d);
    }
    return out;
  }, [actionsFromSelected, pendingSkill]);

  const mountActions = useMemo(
    () => actionsFromSelected.filter((a): a is Extract<Action, { kind: 'mount' }> => a.kind === 'mount'),
    [actionsFromSelected],
  );
  const enterActions = useMemo(
    () => actionsFromSelected.filter((a): a is Extract<Action, { kind: 'enterRook' }> => a.kind === 'enterRook'),
    [actionsFromSelected],
  );

  const arrowDirs = useMemo(
    () =>
      actionsFromSelected
        .filter((a): a is Extract<Action, { kind: 'arrow' }> => a.kind === 'arrow' && a.mode !== 'guided' && Boolean(a.dir))
        .map((a) => ({ action: a, dir: a.dir! })),
    [actionsFromSelected],
  );

  const swapAction = useMemo(
    () => actionsFromSelected.find((a) => a.kind === 'swap') ?? null,
    [actionsFromSelected],
  );

  const transformActions = useMemo(
    () => actionsFromSelected.filter((a): a is Extract<Action, { kind: 'transform' }> => a.kind === 'transform'),
    [actionsFromSelected],
  );

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
      setPendingSkill(null);
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
    setPendingSkill(null);
    setMenuCell(cell);
    return true;
  }

  function applyCandidates(candidates: Action[]): boolean {
    if (candidates.some((a) => a.kind === 'move' && a.promotion)) {
      setPromo(candidates);
      return false;
    }
    return submit(candidates[0]);
  }

  function handleCell(cell: Cell) {
    if (annotations.length) setAnnotations([]);
    setMenuCell(null);
    if (!canPlay) return;
    if (selected) {
      const candidates = actionsFromSelected.filter((a) => {
        if (pendingSkill) {
          if (pendingSkill.kind === 'mount') {
            return a.kind === 'mount' && a.mode === pendingSkill.mode && sameCell(a.to, cell);
          }
          return a.kind === 'enterRook' && a.choice === pendingSkill.choice && sameCell(a.to, cell);
        }
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
      setPendingSkill(null);
      return;
    }
    setSelected(null);
    setPendingSkill(null);
  }

  function dropMove(from: Cell, to: Cell) {
    if (!canPlay) return;
    const all = [...engine.legalMoves(), ...engine.skillActions()];
    const candidates = all.filter((a) => {
      if (!('from' in a)) return false;
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
    setPendingSkill(null);
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

  const resultText = (() => {
    if (!snap.result) return null;
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
    const usesLeft = sel.type === 'p' ? (sel.shield ? 1 : 0) : snap.skillsLeft[turnColor][sel.type];
    return (
      <div className="skills">
        <SkillHelp piece={sel.type} usesLeft={usesLeft} />
        {arrowDirs.length > 0 && (
          <>
            <div className="muted small">
              Flecha del alfil ({arrowDirs[0].action.kind === 'arrow' ? arrowDirs[0].action.mode : ''}):
            </div>
            <div className="skill-row">
              {ARROW_DIRS.map((d) => {
                const found = arrowDirs.find(
                  (ad) => ad.dir.f === d.df && ad.dir.r === d.dr,
                );
                return (
                  <button
                    key={d.label}
                    type="button"
                    className="btn btn--ghost skill-dir"
                    disabled={!found}
                    onClick={() => found && submit(found.action)}
                  >
                    {d.glyph}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {arrowDirs.some((ad) => ad.action.kind === 'arrow' && ad.action.mode === 'guided') && (
          <div className="muted small">
            Flecha guiada: toca una casilla en diagonal (puede pasar por encima).
          </div>
        )}
        {swapAction && (
          <button type="button" className="btn btn--outline" onClick={() => submit(swapAction)}>
            Permutar con la reina
          </button>
        )}
        {actionsFromSelected.some((a) => a.kind === 'warcry') && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              const a = actionsFromSelected.find((x) => x.kind === 'warcry');
              if (a) submit(a);
            }}
          >
            Grito de guerra (renueva skill a los aliados adyacentes)
          </button>
        )}
        {transformActions.length > 0 && (
          <div>
            <div className="muted small">
              Reina guarecida en torre: transforma un peón adyacente (caballo; alfil si el peón no
              tenía punto; torre si lo tenía):
            </div>
            <div className="skill-row" style={{ flexWrap: 'wrap' }}>
              {transformActions.map((a, i) => (
                <button key={i} type="button" className="btn btn--outline" onClick={() => submit(a)}>
                  {squareName(a.to)} {'\u2192'} {pieceName[a.into] ?? a.into}
                </button>
              ))}
            </div>
          </div>
        )}
        {mountActions.length > 0 && (
          <div>
            <div className="muted small">Montar en caballo (arquero):</div>
            <div className="skill-row">
              <button
                type="button"
                className={pendingSkill?.kind === 'mount' && pendingSkill.mode === 'tower' ? 'btn btn--primary' : 'btn btn--outline'}
                onClick={() => setPendingSkill({ kind: 'mount', mode: 'tower' })}
              >
                Mueve caballo+torre
              </button>
              <button
                type="button"
                className={pendingSkill?.kind === 'mount' && pendingSkill.mode === 'archer' ? 'btn btn--primary' : 'btn btn--outline'}
                onClick={() => setPendingSkill({ kind: 'mount', mode: 'archer' })}
              >
                Mueve caballo, captura alfil
              </button>
            </div>
          </div>
        )}
        {enterActions.length > 0 && (
          <div>
            <div className="muted small">Entrar en torre:</div>
            <div className="skill-row">
              <button
                type="button"
                className={pendingSkill?.kind === 'enterRook' && pendingSkill.choice === 'queen' ? 'btn btn--primary' : 'btn btn--outline'}
                onClick={() => setPendingSkill({ kind: 'enterRook', choice: 'queen' })}
              >
                Convertirse en reina
              </button>
              <button
                type="button"
                className={pendingSkill?.kind === 'enterRook' && pendingSkill.choice === 'shelter' ? 'btn btn--primary' : 'btn btn--outline'}
                onClick={() => setPendingSkill({ kind: 'enterRook', choice: 'shelter' })}
              >
                Guarecerse (dispara dentro)
              </button>
            </div>
          </div>
        )}
        {pendingSkill && (
          <div className="muted small">
            Toca {pendingSkill.kind === 'mount' ? 'el caballo' : 'la torre'} objetivo.
          </div>
        )}
        {actionsFromSelected.some((a) => a.kind === 'convert') && (
          <div className="muted small">Conversion: toca una pieza enemiga marcada.</div>
        )}
        {actionsFromSelected.some((a) => a.kind === 'shelter') && (
          <div className="muted small">Guarecer: toca una pieza aliada adyacente.</div>
        )}
        {actionsFromSelected.some((a) => a.kind === 'retreat') && (
          <div className="muted small">Retroceder: toca la casilla trasera (pierde armadura).</div>
        )}
        {actionsFromSelected.some((a) => a.kind === 'ride') && (
          <div className="muted small">Montar: toca el caballo aliado adyacente (pierdes armadura).</div>
        )}
        {actionsFromSelected.some((a) => a.kind === 'pawnPush') && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              const a = actionsFromSelected.find((x) => x.kind === 'pawnPush');
              if (a) submit(a);
            }}
          >
            Empujón: avanzan todos los peones de la columna (mata lo que haya delante)
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar__left">
          <span className="chip chip--mode">
            {session.config.modeId === 'royale'
              ? '\u{1F451} Royale'
              : '\u2728 Ajedrez con Skills'}
          </span>
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
            isDraggable={(c) =>
              canPlay &&
              !pendingSkill &&
              !snap.board[c.r][c.f]?.cargo &&
              snap.board[c.r][c.f]?.color === snap.turn
            }
            onDragStart={(c) => {
              setSelected(c);
              setPendingSkill(null);
            }}
            onDropMove={dropMove}
            onSkillMenu={openSkillMenu}
            annotations={annotations}
            onAnnotate={(a) => setAnnotations((prev) => toggleAnnotation(prev, a))}
            dangerKeys={dangerKeys}
            dangerLevel={dangerLevel}
          />

          {pending && (
            <div className="decision">
              {iAmDefender ? (
                <>
                  <span>
                    {pending.isRookBreak
                      ? 'Atacan tu torre con una pieza dentro. ¿Quieres bloquear?'
                      : 'Atacan a tu peón. Usar armadura (la pieza atacante vuelve) o dejarlo morir.'}
                  </span>
                  <div className="decision__actions">
                    <button type="button" className="btn btn--primary" onClick={() => submit({ kind: 'defense', block: true })}>
                      Bloquear
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => submit({ kind: 'defense', block: false })}>
                      No bloquear
                    </button>
                  </div>
                </>
              ) : (
                <span>Esperando la decision del rival...</span>
              )}
            </div>
          )}

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
                        const chosen = promo.find((a) => a.kind === 'move' && a.promotion === p.value);
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
              <div className="skill-counts">
                {turnColor === 'w' ? 'Blancas' : 'Negras'}:{' '}
                {(['p', 'n', 'b', 'r', 'q', 'k'] as PieceType[])
                  .map((t) => `${pieceName[t] ?? t} ${snap.skillsLeft[turnColor][t]}`)
                  .join(' · ')}
              </div>
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

void cellKey;
void squareName;
