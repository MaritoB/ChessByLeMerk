import type { ReactElement } from 'react';
import {
  FILES,
  SEATS,
  SIZE,
  isLightSquare,
  isPlayable,
  sameCell,
  type Cell,
  type FMove,
  type Piece,
  type PieceType,
  type Seat,
} from '../four/board';

export interface Board4Props {
  board: (Piece | null)[][];
  selected: Cell | null;
  targets: Cell[];
  lastMove: FMove | null;
  onCell: (cell: Cell) => void;
  disabled?: boolean;
  checkCells?: Cell[];
}

const GLYPH: Record<PieceType, string> = {
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F',
};

function inList(list: Cell[], cell: Cell): boolean {
  return list.some((c) => sameCell(c, cell));
}

export function Board4({
  board,
  selected,
  targets,
  lastMove,
  onCell,
  disabled,
  checkCells = [],
}: Board4Props) {
  const cells: ReactElement[] = [];
  for (let r = SIZE - 1; r >= 0; r--) {
    for (let f = 0; f < SIZE; f++) {
      const key = `${f}-${r}`;
      if (!isPlayable(f, r)) {
        cells.push(<div key={key} className="b4__gap" />);
        continue;
      }
      const cell: Cell = { f, r };
      const piece = board[r][f];
      const dark = !isLightSquare(cell);
      const isSelected = selected && sameCell(selected, cell);
      const isTarget = inList(targets, cell);
      const isLast =
        lastMove && (sameCell(lastMove.from, cell) || sameCell(lastMove.to, cell));
      const isCheck = inList(checkCells, cell);
      const classes = [
        'sq4',
        dark ? 'sq4--dark' : 'sq4--light',
        isSelected ? 'sq4--selected' : '',
        isLast ? 'sq4--last' : '',
        isCheck ? 'sq4--check' : '',
      ]
        .filter(Boolean)
        .join(' ');

      cells.push(
        <button
          key={key}
          type="button"
          className={classes}
          onClick={() => onCell(cell)}
          disabled={disabled}
          aria-label={`${FILES[f]}${r + 1}`}
        >
          {r === 0 && f >= 3 && f <= 10 && <span className="coord4 coord4--file">{FILES[f]}</span>}
          {f === 0 && r >= 3 && r <= 10 && <span className="coord4 coord4--rank">{r + 1}</span>}
          {piece && (
            <span className="p4" style={{ color: SEATS[piece.seat].color }}>
              {GLYPH[piece.type]}
            </span>
          )}
          {isTarget && !piece && <span className="dot4" />}
          {isTarget && piece && <span className="ring4" style={{ borderColor: SEATS[piece.seat].color }} />}
        </button>,
      );
    }
  }
  return <div className={`b4 ${disabled ? 'b4--disabled' : ''}`}>{cells}</div>;
}
