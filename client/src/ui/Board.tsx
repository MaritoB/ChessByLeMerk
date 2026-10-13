import { useRef, useState, type ReactElement } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { fileOf, isLightSquare, rankOf, squareFromIndex } from '../chess/engine';
import { PieceView } from './Piece';
import { usePieceDrag } from './usePieceDrag';
import type { Annotation } from './annotations';

export interface CellView {
  square: Square;
  piece: { type: PieceSymbol; color: Color } | null;
  hidden: boolean;
}

export interface BoardProps {
  cells: CellView[];
  flipped: boolean;
  selected: Square | null;
  targets: Square[];
  lastMove: { from: string; to: string } | null;
  checkSquare: Square | null;
  onSquareClick: (square: Square) => void;
  disabled?: boolean;
  showCoords?: boolean;
  fog?: boolean;
  isDraggable?: (square: Square) => boolean;
  onDragStart?: (square: Square) => void;
  onDropMove?: (from: Square, to: Square) => void;
  annotations?: Annotation[];
  onAnnotate?: (annotation: Annotation) => void;
}

const ARROW_COLOR = 'rgba(21, 120, 27, 0.85)';

function displayOrder(flipped: boolean): number[] {
  const order: number[] = [];
  if (!flipped) {
    for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) order.push(r * 8 + f);
  } else {
    for (let r = 0; r < 8; r++) for (let f = 7; f >= 0; f--) order.push(r * 8 + f);
  }
  return order;
}

function center(square: string, flipped: boolean): { x: number; y: number } {
  const f = square.charCodeAt(0) - 97;
  const r = square.charCodeAt(1) - 49;
  const col = flipped ? 7 - f : f;
  const row = flipped ? r : 7 - r;
  return { x: col + 0.5, y: row + 0.5 };
}

export function Board({
  cells,
  flipped,
  selected,
  targets,
  lastMove,
  checkSquare,
  onSquareClick,
  disabled,
  showCoords = true,
  fog = false,
  isDraggable,
  onDragStart,
  onDropMove,
  annotations = [],
  onAnnotate,
}: BoardProps) {
  const order = displayOrder(flipped);
  const targetSet = new Set(targets);
  const annFrom = useRef<string | null>(null);
  const [preview, setPreview] = useState<{ from: string; to: string } | null>(null);

  const { drag, boardRef, begin, move, end, consumeSuppressClick } = usePieceDrag({
    disabled,
    onSelect: (sq) => onDragStart?.(sq as Square),
    onDrop: (from, to) => onDropMove?.(from as Square, to as Square),
  });

  function squareAtPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest('[data-square]')?.getAttribute('data-square') ?? null;
  }

  function annDown(event: React.PointerEvent, square: string) {
    if (disabled || !onAnnotate) return;
    event.preventDefault();
    annFrom.current = square;
    setPreview({ from: square, to: square });
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

  const squares: ReactElement[] = order.map((index) => {
    const cell = cells[index];
    const square = cell?.square ?? squareFromIndex(index);
    const dark = !isLightSquare(square);
    const isSelected = selected === square;
    const isTarget = targetSet.has(square);
    const isLast = Boolean(lastMove && (lastMove.from === square || lastMove.to === square));
    const isCheck = checkSquare === square;
    const isDraggingFrom = drag?.from === square;
    const classes = [
      'sq',
      dark ? 'sq--dark' : 'sq--light',
      isSelected ? 'sq--selected' : '',
      isTarget ? 'sq--target' : '',
      isLast ? 'sq--last' : '',
      isCheck ? 'sq--check' : '',
      cell?.hidden ? 'sq--hidden' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const pieceNode = cell?.piece ? (
      <PieceView color={cell.piece.color} type={cell.piece.type} />
    ) : null;
    const draggable = Boolean(pieceNode) && (isDraggable ? isDraggable(square) : false);

    return (
      <button
        key={square}
        type="button"
        data-square={square}
        className={classes}
        onClick={() => {
          if (consumeSuppressClick()) return;
          onSquareClick(square);
        }}
        onPointerDown={(event) => {
          if (event.button === 2) {
            annDown(event, square);
            return;
          }
          if (draggable && pieceNode) begin(event, square, pieceNode);
        }}
        onPointerMove={(event) => {
          if (annFrom.current) annMoveHandler(event);
          else move(event);
        }}
        onPointerUp={(event) => {
          if (annFrom.current) annUpHandler(event);
          else end(event);
        }}
        onPointerCancel={(event) => {
          if (annFrom.current) {
            annFrom.current = null;
            setPreview(null);
          } else {
            end(event);
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        disabled={disabled}
        aria-label={square}
      >
        {showCoords && fileOf(square) === (flipped ? 7 : 0) && (
          <span className="coord coord--rank">{rankOf(square) + 1}</span>
        )}
        {showCoords && rankOf(square) === (flipped ? 7 : 0) && (
          <span className="coord coord--file">{square[0]}</span>
        )}
        {pieceNode && !isDraggingFrom && pieceNode}
        {isTarget && !cell?.piece && <span className="dot" />}
        {isTarget && cell?.piece && <span className="capture-ring" />}
      </button>
    );
  });

  const annList: Annotation[] = [...annotations];
  if (preview && preview.from !== preview.to) annList.push({ kind: 'arrow', from: preview.from, to: preview.to });

  return (
    <div ref={boardRef} className={`board ${disabled ? 'board--disabled' : ''} ${fog ? 'board--fog' : ''}`}>
      {squares}
      <svg className="annot" viewBox="0 0 8 8" preserveAspectRatio="none">
        <defs>
          <marker id="annot-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR} />
          </marker>
        </defs>
        {annList.map((a, i) => {
          if (a.kind === 'circle') {
            const c = center(a.square, flipped);
            return <circle key={i} cx={c.x} cy={c.y} r={0.42} fill="none" stroke={ARROW_COLOR} strokeWidth={0.1} />;
          }
          const p1 = center(a.from, flipped);
          const p2 = center(a.to, flipped);
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;
          const shrink = 0.34;
          const x1 = p1.x + (dx / len) * shrink;
          const y1 = p1.y + (dy / len) * shrink;
          const x2 = p2.x - (dx / len) * shrink;
          const y2 = p2.y - (dy / len) * shrink;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={ARROW_COLOR}
              strokeWidth={0.14}
              markerEnd="url(#annot-head)"
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
