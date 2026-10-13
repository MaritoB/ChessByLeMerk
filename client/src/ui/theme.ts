import { useEffect, useState } from 'react';

export type PieceStyle = 'glyph' | 'sheet1' | 'sheet2';

let style: PieceStyle = 'sheet2';
try {
  const saved = localStorage.getItem('cbl.pieceStyle');
  if (saved === 'glyph' || saved === 'sheet1' || saved === 'sheet2') style = saved;
  else if (saved === 'image') style = 'sheet1';
} catch {
  /* noop */
}

const listeners = new Set<() => void>();

export function getPieceStyle(): PieceStyle {
  return style;
}

export function setPieceStyle(next: PieceStyle): void {
  style = next;
  try {
    localStorage.setItem('cbl.pieceStyle', next);
  } catch {
    /* noop */
  }
  for (const listener of listeners) listener();
}

export function pieceFolder(pieceStyle: PieceStyle): string {
  return pieceStyle === 'sheet2' ? 'pieces2' : 'pieces';
}

export function usePieceStyle(): PieceStyle {
  const [current, setCurrent] = useState(style);
  useEffect(() => {
    const listener = () => setCurrent(style);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return current;
}
