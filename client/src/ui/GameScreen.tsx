import { useEffect, useMemo, useState } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { boardFromChess, legalMoves, squareFromIndex, squareIndex } from '../chess/engine';
import { describeMove, normalize, parseSpokenMove } from '../chess/notation';
import type { GameSession } from '../game/session';
import { useControllerState, useInterval } from '../game/hooks';
import { Board, type CellView } from './Board';
import { VoiceInput } from './VoiceInput';
import { RoomLink } from './RoomLink';
import { Captured } from './Captured';
import { ClockBar } from './ClockBar';
import { useClocks } from '../game/clock';
import { toggleAnnotation, type Annotation } from './annotations';
import { speak } from './useSpeech';

export interface GameScreenProps {
  session: GameSession;
  onExit: () => void;
}

interface Feedback {
  text: string;
  kind: 'info' | 'error' | 'ok';
}

const PROMOTION_PIECES: { value: 'q' | 'r' | 'b' | 'n'; label: string }[] = [
  { value: 'q', label: '\u265B Dama' },
  { value: 'r', label: '\u265C Torre' },
  { value: 'b', label: '\u265D Alfil' },
  { value: 'n', label: '\u265E Caballo' },
];

export function GameScreen({ session, onExit }: GameScreenProps) {
  const snapshot = useControllerState(session.controller);
  const [selected, setSelected] = useState<Square | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [announce, setAnnounce] = useState(false);
  const [tick, setTick] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!session.subscribe) return;
    return session.subscribe(() => forceRender((v) => v + 1));
  }, [session]);


  const revealActive =
    snapshot.reveal !== null && Date.now() < snapshot.reveal.until && tick >= 0;

  useInterval(
    () => {
      setTick((t) => t + 1);
      if (snapshot.reveal && Date.now() >= snapshot.reveal.until) {
        setFeedback(null);
      }
    },
    snapshot.reveal ? 500 : null,
  );

  const viewerColor: Color = session.myColor === 'both' ? snapshot.turn : session.myColor;
  const flipped = session.myColor === 'b';
  const sandbox = Boolean(session.sandbox);
  const canPlay = sandbox
    ? true
    : !snapshot.finished &&
      (session.myColor === 'both' || snapshot.turn === session.myColor) &&
      (!session.online || session.connected);

  const chess = useMemo(() => session.controller.view(), [snapshot.fen]);
  const { capturedByWhite, capturedByBlack } = useMemo(() => {
    const byWhite: PieceSymbol[] = [];
    const byBlack: PieceSymbol[] = [];
    for (const mv of snapshot.history) {
      if (mv.captured) (mv.color === 'w' ? byWhite : byBlack).push(mv.captured);
    }
    return { capturedByWhite: byWhite, capturedByBlack: byBlack };
  }, [snapshot.history]);
  const board = useMemo(() => boardFromChess(chess), [chess]);
  const visible = useMemo(
    () => session.mode.computeVisible(chess, viewerColor),
    [chess, viewerColor, session.mode],
  );

  const cells: CellView[] = useMemo(
    () =>
      board.map((piece, i) => {
        const vis = revealActive ? true : visible[i];
        return {
          square: squareFromIndex(i),
          piece: vis ? piece : null,
          hidden: !vis && !revealActive,
        };
      }),
    [board, visible, revealActive],
  );

  const allLegalMoves = useMemo(() => legalMoves(chess), [chess]);
  const targets = useMemo(() => {
    if (!selected) return [] as Square[];
    return allLegalMoves.filter((m) => m.from === selected).map((m) => m.to as Square);
  }, [allLegalMoves, selected]);

  const checkSquare = useMemo(() => {
    if (!snapshot.check) return null;
    const king = board.find((p) => p && p.type === 'k' && p.color === snapshot.turn);
    return (king?.square ?? null) as Square | null;
  }, [board, snapshot.check, snapshot.turn]);

  const boardShown = session.mode.showBoard || revealActive;

  const clockTC =
    session.timeControl && (!session.online || session.connected)
      ? session.timeControl
      : { initial: 0, increment: 0 };
  const { remaining, enabled: clockOn } = useClocks({
    sides: ['w', 'b'],
    active: snapshot.turn,
    moveCount: snapshot.history.length,
    timeControl: clockTC,
    onFlag: (side) => session.flag?.(side),
  });

  function performMove(from: string, to: string, promotion?: string) {
    const result = session.makeMove(from, to, promotion);
    if (result.ok) {
      setSelected(null);
      setPendingPromotion(null);
      setFeedback(null);
      setAnnotations([]);
      if (announce) {
        const last = session.controller.snapshot().lastMove;
        if (last) speak(describeMove(last));
      }
    } else if (result.error) {
      setFeedback({ text: result.error, kind: 'error' });
    }
    return result.ok;
  }

  function tryMove(from: Square, to: Square) {
    const needsPromotion = allLegalMoves.some((m) => m.from === from && m.to === to && m.promotion);
    if (needsPromotion) {
      setPendingPromotion({ from, to });
      return;
    }
    const ok = performMove(from, to);
    if (!ok && session.mode.penaltyOnIllegal && session.controller.snapshot().reveal) {
      setFeedback({ text: 'Fallo! Pierdes una vida, mira el tablero.', kind: 'error' });
    }
  }

  function handleSquareClick(square: Square) {
    if (annotations.length) setAnnotations([]);
    if (sandbox) {
      if (selected && selected !== square) {
        session.makeMove(selected, square);
        setSelected(null);
        return;
      }
      const p = board[squareIndex(square)];
      setSelected(p ? square : null);
      return;
    }
    if (session.mode.input === 'voice') return;
    if (!canPlay) return;
    if (selected && targets.includes(square)) {
      tryMove(selected, square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    const piece = board[squareIndex(square)];
    if (piece) {
      setSelected(piece.color === viewerColor ? square : null);
      return;
    }
    // Casilla vacia que no es destino: se mantiene la seleccion.
  }

  function handleVoiceSubmit(text: string) {
    if (!canPlay) return;
    const parsed = parseSpokenMove(chess, text);
    if (parsed.ok && parsed.move) {
      performMove(parsed.move.from, parsed.move.to, parsed.move.promotion);
      setFeedback({ text: `Entendido: ${normalize(text)}`, kind: 'ok' });
      return;
    }
    if (parsed.ambiguous) {
      const options = parsed.ambiguous.map((m) => m.san).join(', ');
      setFeedback({ text: `${parsed.error}: ${options}`, kind: 'error' });
      return;
    }
    if (parsed.illegal) {
      const result = session.mistake(parsed.error ?? 'Jugada ilegal');
      const lives = result.penalty?.livesLeft;
      setFeedback({
        text: `${parsed.error}.${lives !== undefined ? ` Vidas: ${lives}.` : ''} Mira el tablero.`,
        kind: 'error',
      });
      return;
    }
    setFeedback({ text: parsed.error ?? 'No he entendido la jugada', kind: 'error' });
  }

  function handleResign() {
    if (snapshot.finished) return;
    if (window.confirm('¿Seguro que quieres abandonar?')) session.resign();
  }

  function handleLeave() {
    session.leave();
    onExit();
  }

  const whiteLives = snapshot.lives.w;
  const blackLives = snapshot.lives.b;
  const showLives = Number.isFinite(session.mode.lives);

  const resultText = (() => {
    if (!snapshot.result) return null;
    const { winner, reason } = snapshot.result;
    if (winner === 'draw') return `Tablas (${reason})`;
    const won =
      session.myColor === 'both' ? winner : winner === session.myColor;
    const label = won ? 'Ganan' : 'Pierden';
    return `${label} las ${winner === 'w' ? 'blancas' : 'negras'} (${reason})`;
  })();

  return (
    <div className="game">
      <header className="topbar">
        <div className="topbar__left">
          <span className="chip chip--mode">
            {session.mode.emoji} {session.mode.name}
          </span>
          <span className={`chip ${session.connected || !session.online ? 'chip--ok' : 'chip--warn'}`}>
            {session.online ? (session.connected ? 'P2P conectado' : 'Conectando...') : 'Partida local'}
          </span>
        </div>
        <div className="topbar__right">
          <span className="chip">{session.opponentName}</span>
          <button type="button" className="btn btn--ghost" onClick={handleLeave}>
            Salir
          </button>
        </div>
      </header>

      <div className="game__body">
        <div className="game__boardwrap">
          {clockOn && (
            <ClockBar
              white={remaining('w')}
              black={remaining('b')}
              active={snapshot.turn}
              whiteLabel={session.myColor === 'b' ? 'Negras' : 'Blancas'}
              blackLabel={session.myColor === 'b' ? 'Blancas' : 'Negras'}
            />
          )}
          {showLives && (
            <div className="lives">
              <span className={viewerColor === 'w' ? 'lives--me' : ''}>
                Blancas: {'\u2665'.repeat(Math.max(0, Math.min(5, whiteLives)))}
                {whiteLives <= 0 ? ' (sin vidas)' : ` x${whiteLives}`}
              </span>
              <span className={viewerColor === 'b' ? 'lives--me' : ''}>
                Negras: {'\u2665'.repeat(Math.max(0, Math.min(5, blackLives)))}
                {blackLives <= 0 ? ' (sin vidas)' : ` x${blackLives}`}
              </span>
            </div>
          )}

          {boardShown ? (
            <Board
              cells={cells}
              flipped={flipped}
              selected={selected}
              targets={session.mode.input === 'board' ? targets : []}
              lastMove={snapshot.lastMove}
              checkSquare={checkSquare}
              onSquareClick={handleSquareClick}
              disabled={!canPlay || (!sandbox && session.mode.input === 'voice')}
              fog={session.mode.id !== 'standard'}
              isDraggable={(sq) =>
                sandbox
                  ? Boolean(board[squareIndex(sq)])
                  : session.mode.input === 'board' && canPlay && board[squareIndex(sq)]?.color === viewerColor
              }
              onDragStart={(sq) => setSelected(sq)}
              onDropMove={(from, to) => tryMove(from, to)}
              annotations={annotations}
              onAnnotate={(a) => setAnnotations((prev) => toggleAnnotation(prev, a))}
            />
          ) : (
            <div className="blindpad">
              <div className="blindpad__icon">{'\u{1F648}'}</div>
              <p>Tablero oculto. Dicta tu jugada o escribela abajo.</p>
              <p className="blindpad__fen">FEN: {snapshot.fen}</p>
            </div>
          )}

          {revealActive && (
            <div className="reveal-banner">
              Tablero revelado durante unos segundos por un fallo
            </div>
          )}

          {resultText && (
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

          {pendingPromotion && (
            <div className="result-overlay">
              <div className="result-card">
                <h3>Elige pieza</h3>
                <div className="promo-row">
                  {PROMOTION_PIECES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => performMove(pendingPromotion.from, pendingPromotion.to, p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setPendingPromotion(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="game__side">
          <div className="panel">
            <div className="turn">
              <span className={`turn__dot turn__dot--${snapshot.turn}`} />
              {snapshot.finished
                ? 'Partida terminada'
                : `Turno de las ${snapshot.turn === 'w' ? 'blancas' : 'negras'}`}
              {snapshot.check && !snapshot.finished ? ' (jaque)' : ''}
            </div>
            <div className="muted small">
              {session.online ? session.statusText : 'Mismo dispositivo (dos jugadores)'}
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
              capturedByWhite={capturedByWhite}
              capturedByBlack={capturedByBlack}
              whiteLabel={flipped ? 'Negras' : 'Blancas'}
              blackLabel={flipped ? 'Blancas' : 'Negras'}
            />
          </div>

          {session.mode.input === 'voice' && (
            <div className="panel">
              <VoiceInput
                disabled={!canPlay}
                feedback={
                  feedback
                    ? feedback
                    : { text: 'Di la pieza y la casilla. Ej: "caballo f3".', kind: 'info' }
                }
                announce={announce}
                onToggleAnnounce={() => setAnnounce((a) => !a)}
                onSubmit={handleVoiceSubmit}
              />
            </div>
          )}

          {session.mode.input === 'board' && feedback && (
            <div className="panel">
              <div className={`feedback feedback--${feedback.kind}`}>{feedback.text}</div>
            </div>
          )}

          <div className="panel">
            <div className="panel__title">Jugadas</div>
            <ol className="movelist">
              {snapshot.history.map((move, i) => (
                <li key={i}>
                  {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}
                  {move.san}
                </li>
              ))}
            </ol>
          </div>

          <div className="game__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleResign}
              disabled={snapshot.finished}
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
