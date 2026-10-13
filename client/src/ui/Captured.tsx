import type { Color, PieceSymbol } from 'chess.js';
import { PieceView } from './Piece';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function pieceValue(type: string): number {
  return VALUE[type] ?? 0;
}

export function MiniPiece({ color, type }: { color: Color; type: PieceSymbol }) {
  return (
    <span className="mini" title={type}>
      <PieceView color={color} type={type} />
    </span>
  );
}

export interface CapturedProps {
  /** Piezas que capturaron las blancas (son de color negro). */
  capturedByWhite: PieceSymbol[];
  /** Piezas que capturaron las negras (son de color blanco). */
  capturedByBlack: PieceSymbol[];
  whiteLabel?: string;
  blackLabel?: string;
}

/** Panel tipo lichess: piezas capturadas por cada bando y ventaja de material. */
export function Captured({
  capturedByWhite,
  capturedByBlack,
  whiteLabel = 'Blancas',
  blackLabel = 'Negras',
}: CapturedProps) {
  const whiteScore = capturedByWhite.reduce((sum, t) => sum + pieceValue(t), 0);
  const blackScore = capturedByBlack.reduce((sum, t) => sum + pieceValue(t), 0);
  const diff = whiteScore - blackScore;

  return (
    <div className="captured">
      <div className="cap-row">
        <span className="cap-side">{whiteLabel}</span>
        <span className="cap-list">
          {capturedByWhite.map((type, i) => (
            <MiniPiece key={i} color="b" type={type} />
          ))}
        </span>
        {diff > 0 && <span className="cap-diff">+{diff}</span>}
      </div>
      <div className="cap-row">
        <span className="cap-side">{blackLabel}</span>
        <span className="cap-list">
          {capturedByBlack.map((type, i) => (
            <MiniPiece key={i} color="w" type={type} />
          ))}
        </span>
        {diff < 0 && <span className="cap-diff">+{-diff}</span>}
      </div>
    </div>
  );
}
