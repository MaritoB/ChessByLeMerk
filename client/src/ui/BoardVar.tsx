import { useRef, useState, type ReactElement } from 'react';
import {
  FILES,
  SIZE,
  cellKey,
  isLight,
  sameCell,
  type Arrow,
  type Cell,
  type Color,
  type Piece,
  type PieceType,
} from '../var/board';
import type { VarSnapshot } from '../var/engine';
import { PieceView } from './Piece';
import { usePieceDrag } from './usePieceDrag';
import type { Annotation } from './annotations';

export interface BoardVarProps {
  snapshot: VarSnapshot;
  myColor: Color | 'all';
  selected: Cell | null;
  targets: Cell[];
  onCell: (cell: Cell) => void;
  disabled?: boolean;
  checkCell: Cell | null;
  isDraggable?: (cell: Cell) => boolean;
  onDragStart?: (cell: Cell) => void;
  onDropMove?: (from: Cell, to: Cell) => void;
  annotations?: Annotation[];
  onAnnotate?: (annotation: Annotation) => void;
  /** Click derecho / pulsacion larga sobre una pieza: muestra sus skills. */
  onSkillMenu?: (cell: Cell) => boolean;
  skillsLeft?: Record<Color, Record<PieceType, number>>;
  skillsOn?: boolean;
  /** Casillas del anillo que se va a borrar (Royale). */
  dangerKeys?: string[];
  /** Nivel de peligro 0..4 (verde..negro). */
  dangerLevel?: number;
}

const ARROW_COLOR = 'rgba(21, 120, 27, 0.85)';

function centerVar(key: string, flipped: boolean): { x: number; y: number } {
  const [f, r] = key.split(',').map(Number);
  const col = flipped ? SIZE - 1 - f : f;
  const row = flipped ? r : SIZE - 1 - r;
  return { x: col + 0.5, y: row + 0.5 };
}

const GLYPH: Record<string, string> = {
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F',
};

const ARROW_GLYPH: Record<string, string> = {
  '0,1': '\u2191',
  '0,-1': '\u2193',
  '1,0': '\u2192',
  '-1,0': '\u2190',
  '1,1': '\u2197',
  '1,-1': '\u2198',
  '-1,1': '\u2196',
  '-1,-1': '\u2199',
};

function arrowSquares(arrows: Arrow[]): Map<string, { kind: 'origin' | 'target' | 'path'; glyph?: string }> {
  const map = new Map<string, { kind: 'origin' | 'target' | 'path'; glyph?: string }>();
  for (const arrow of arrows) {
    map.set(cellKey(arrow.origin), { kind: 'origin' });
    if ((arrow.mode === 'fast' || arrow.mode === 'piercing') && arrow.dir) {
      const glyph = ARROW_GLYPH[`${arrow.dir.f},${arrow.dir.r}`];
      let f = arrow.origin.f + arrow.dir.f;
      let r = arrow.origin.r + arrow.dir.r;
      while (f >= 0 && f < SIZE && r >= 0 && r < SIZE) {
        const k = cellKey({ f, r });
        const existing = map.get(k);
        if (!existing || existing.kind === 'path') map.set(k, { kind: 'path', glyph });
        f += arrow.dir.f;
        r += arrow.dir.r;
      }
    } else if (arrow.mode === 'guided' && arrow.target) {
      map.set(cellKey(arrow.target), { kind: 'target', glyph: '\u2295' });
    }
  }
  return map;
}

function PieceNode({ piece, skillReady }: { piece: Piece; skillReady?: boolean }) {
  return (
    <span className="pwrap">
      <PieceView color={piece.color} type={piece.type} />
      {skillReady && <span className="pv__skill" title="habilidad disponible" />}
      {piece.shield && <img className="pv-badge pv-badge--tl" src="/skills/badges/shield.png" alt="armadura" />}
      {piece.archer && (
        <span className="pv-mini pv-mini--br" title="alfil montado">
          <PieceView color={piece.color} type="b" />
        </span>
      )}
      {piece.cargo && (
        <span className="pv-mini pv-mini--br" title="guarecida">
          <PieceView color={piece.cargo.color} type={piece.cargo.type} />
        </span>
      )}
      {piece.rider && (
        <span className="pv-mini pv-mini--bl" title="montada">
          <PieceView color={piece.rider.color} type={piece.rider.type} />
        </span>
      )}
      {piece.cargoArrow && <span className="pv__arrowok" title="dispara desde dentro">{'\u2192'}</span>}
    </span>
  );
}

export function BoardVar({
  snapshot,
  myColor,
  selected,
  targets,
  onCell,
  disabled,
  checkCell,
  isDraggable,
  onDragStart,
  onDropMove,
  annotations = [],
  onAnnotate,
  onSkillMenu,
  skillsLeft,
  skillsOn,
  dangerKeys,
  dangerLevel,
}: BoardVarProps) {
  const flipped = myColor === 'b';
  const arrowMap = arrowSquares(snapshot.arrows);
  const dangerSet = new Set(dangerKeys ?? []);
  const targetKeys = new Set(targets.map(cellKey));
  const last = snapshot.lastMove;
  const annFrom = useRef<string | null>(null);
  const [preview, setPreview] = useState<{ from: string; to: string } | null>(null);

  function squareAtPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest('[data-square]')?.getAttribute('data-square') ?? null;
  }
  function annDown(event: React.PointerEvent, key2: string) {
    if (disabled || !onAnnotate) return;
    event.preventDefault();
    annFrom.current = key2;
    setPreview({ from: key2, to: key2 });
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  }
  function annMoveHandler(event: React.PointerEvent) {
    if (!annFrom.current) return;
    const to = squareAtPoint(event.clientX, event.clientY) ?? annFrom.current;
    setPreview({ from: annFrom.current, to });
  }
  function annUpHandler(event: React.PointerEvent) {
    const from = annFrom.current;
    annFrom.current = null;
    setPreview(null);
    if (!from || !onAnnotate) return;
    const to = squareAtPoint(event.clientX, event.clientY) ?? from;
    if (to === from) onAnnotate({ kind: 'circle', square: from });
    else onAnnotate({ kind: 'arrow', from, to });
  }

  const { drag, boardRef, begin, move, end, cancel, consumeSuppressClick } = usePieceDrag({
    disabled,
    onSelect: (key) => {
      const [f, r] = key.split(',').map(Number);
      onDragStart?.({ f, r });
    },
    onDrop: (fromKey, toKey) => {
      const [ff, fr] = fromKey.split(',').map(Number);
      const [tf, tr] = toKey.split(',').map(Number);
      onDropMove?.({ f: ff, r: fr }, { f: tf, r: tr });
    },
  });

  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const clearLongPress = () => {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };
  const longPressMove = (event: React.PointerEvent) => {
    const lp = longPress.current;
    if (lp && Math.hypot(event.clientX - lp.x, event.clientY - lp.y) > 8) clearLongPress();
  };

  const cells: ReactElement[] = [];
  const rows: number[] = [];
  const cols: number[] = [];
  if (!flipped) {
    for (let r = SIZE - 1; r >= 0; r--) rows.push(r);
    for (let f = 0; f < SIZE; f++) cols.push(f);
  } else {
    for (let r = 0; r < SIZE; r++) rows.push(r);
    for (let f = SIZE - 1; f >= 0; f--) cols.push(f);
  }

  for (const r of rows) {
    for (const f of cols) {
      const domKey = `${f}-${r}`;
      if (!snapshot.active[r][f]) {
        cells.push(<div key={domKey} className="bv__void" />);
        continue;
      }
      const cell: Cell = { f, r };
      const piece = snapshot.board[r][f];
      const dark = !isLight(cell);
      const isSelected = selected && sameCell(selected, cell);
      const isTarget = targetKeys.has(cellKey(cell));
      const isLast = Boolean(last && (sameCell(last.from, cell) || sameCell(last.to, cell)));
      const isCheck = Boolean(checkCell && sameCell(checkCell, cell));
      const arrow = arrowMap.get(cellKey(cell));
      const dataKey = `${f},${r}`;
      const isDraggingFrom = drag?.from === dataKey;
      const classes = [
        'sqv',
        dark ? 'sqv--dark' : 'sqv--light',
        isSelected ? 'sqv--selected' : '',
        isLast ? 'sqv--last' : '',
        isCheck ? 'sqv--check' : '',
        dangerSet.has(dataKey) ? `sqv--danger sqv--danger-${dangerLevel ?? 0}` : '',
        arrow ? `sqv--arrow-${arrow.kind}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const pieceNode = piece ? (
        <PieceNode
          piece={piece}
          skillReady={Boolean(skillsOn && skillsLeft && skillsLeft[piece.color] && skillsLeft[piece.color][piece.type] > 0)}
        />
      ) : null;
      const draggable = Boolean(pieceNode) && (isDraggable ? isDraggable(cell) : false);

      cells.push(
        <button
          key={domKey}
          type="button"
          data-square={dataKey}
          className={classes}
          onClick={() => {
            if (consumeSuppressClick()) return;
            onCell(cell);
          }}
          onPointerDown={(event) => {
            if (event.button === 2) {
              if (onSkillMenu && onSkillMenu(cell)) return;
              annDown(event, dataKey);
              return;
            }
            if (onSkillMenu && piece && piece.color === snapshot.turn && event.pointerType !== 'mouse') {
              clearLongPress();
              const lp = { x: event.clientX, y: event.clientY, timer: 0 };
              lp.timer = window.setTimeout(() => {
                longPress.current = null;
                cancel();
                onSkillMenu(cell);
              }, 450);
              longPress.current = lp;
            }
            if (draggable && pieceNode) begin(event, dataKey, pieceNode);
          }}
          onPointerMove={(event) => {
            longPressMove(event);
            if (annFrom.current) annMoveHandler(event);
            else move(event);
          }}
          onPointerUp={(event) => {
            clearLongPress();
            if (annFrom.current) annUpHandler(event);
            else end(event);
          }}
          onPointerCancel={(event) => {
            clearLongPress();
            if (annFrom.current) {
              annFrom.current = null;
              setPreview(null);
            } else {
              end(event);
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
          disabled={disabled}
          aria-label={`${FILES[f]}${r + 1}`}
        >
          {arrow && arrow.glyph && <span className="arrow-mark">{arrow.glyph}</span>}
          {pieceNode && !isDraggingFrom && pieceNode}
          {isTarget && !piece && <span className="dotv" />}
          {isTarget && piece && <span className="ringv" />}
        </button>,
      );
    }
  }

  const annList: Annotation[] = [...annotations];
  if (preview && preview.from !== preview.to) annList.push({ kind: 'arrow', from: preview.from, to: preview.to });

  return (
    <div ref={boardRef} className={`bv ${disabled ? 'bv--disabled' : ''}`}>
      {cells}
      <svg className="annot" viewBox="0 0 8 8" preserveAspectRatio="none">
        <defs>
          <marker id="annot-head-v" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR} />
          </marker>
        </defs>
        {annList.map((a, i) => {
          if (a.kind === 'circle') {
            const c = centerVar(a.square, flipped);
            return <circle key={i} cx={c.x} cy={c.y} r={0.42} fill="none" stroke={ARROW_COLOR} strokeWidth={0.1} />;
          }
          const p1 = centerVar(a.from, flipped);
          const p2 = centerVar(a.to, flipped);
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;
          const shrink = 0.34;
          return (
            <line
              key={i}
              x1={p1.x + (dx / len) * shrink}
              y1={p1.y + (dy / len) * shrink}
              x2={p2.x - (dx / len) * shrink}
              y2={p2.y - (dy / len) * shrink}
              stroke={ARROW_COLOR}
              strokeWidth={0.14}
              markerEnd="url(#annot-head-v)"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      {drag && (
        <div
          className="drag-piece"
          style={{ left: drag.x, top: drag.y, width: drag.size, height: drag.size, fontSize: drag.size }}
        >
          {drag.node}
        </div>
      )}
    </div>
  );
}
