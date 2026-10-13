import type { Color, PieceSymbol } from 'chess.js';
import { pieceFolder, usePieceStyle } from './theme';

const GLYPH: Record<PieceSymbol, string> = {
  k: '\u265A',
  q: '\u265B',
  r: '\u265C',
  b: '\u265D',
  n: '\u265E',
  p: '\u265F',
};

export interface PieceViewProps {
  color: Color;
  type: PieceSymbol;
  /** Si se indica (px), fuerza el tamano (para la pieza que se arrastra). */
  size?: number;
}

/** Renderiza una pieza segun el tema activo (glifos o imagenes). */
export function PieceView({ color, type, size }: PieceViewProps) {
  const pieceStyle = usePieceStyle();
  if (pieceStyle !== 'glyph') {
    return (
      <img
        className="piece-img"
        src={`/${pieceFolder(pieceStyle)}/${color === 'w' ? 'light' : 'dark'}/${type}.png`}
        alt=""
        draggable={false}
        style={size ? { width: size * 0.86, height: size * 0.86 } : undefined}
      />
    );
  }
  return (
    <span
      className={`piece piece--${color}`}
      aria-hidden
      style={size ? { fontSize: size * 0.82 } : undefined}
    >
      {GLYPH[type]}
    </span>
  );
}
