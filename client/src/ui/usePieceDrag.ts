import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

export interface DragInfo {
  from: string;
  node: ReactNode;
  x: number;
  y: number;
  size: number;
}

export interface UsePieceDragOptions {
  disabled?: boolean;
  onSelect?: (square: string) => void;
  onDrop?: (from: string, to: string) => void;
}

/**
 * Arrastre de piezas estilo lichess: se captura el puntero en la casilla
 * de origen y se suelta sobre la casilla destino (detectada con elementFromPoint).
 */
export function usePieceDrag({ disabled, onSelect, onDrop }: UsePieceDragOptions) {
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const suppressClick = useRef(false);
  const state = useRef<{
    from: string;
    node: ReactNode;
    startX: number;
    startY: number;
    size: number;
    active: boolean;
  } | null>(null);

  const begin = useCallback(
    (event: ReactPointerEvent, from: string, node: ReactNode) => {
      if (disabled) return;
      const rect = boardRef.current?.getBoundingClientRect();
      const size = rect ? rect.width / 8 : 64;
      suppressClick.current = false;
      state.current = {
        from,
        node,
        startX: event.clientX,
        startY: event.clientY,
        size,
        active: false,
      };
      onSelect?.(from);
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
    },
    [disabled, onSelect],
  );

  const move = useCallback((event: ReactPointerEvent) => {
    const s = state.current;
    if (!s) return;
    if (!s.active) {
      if (Math.hypot(event.clientX - s.startX, event.clientY - s.startY) < 5) return;
      s.active = true;
    }
    setDrag({ from: s.from, node: s.node, x: event.clientX, y: event.clientY, size: s.size });
  }, []);

  const end = useCallback(
    (event: ReactPointerEvent) => {
      const s = state.current;
      state.current = null;
      setDrag(null);
      if (!s) return;
      if (!s.active) return;
      suppressClick.current = true;
      const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const to = el?.closest('[data-square]')?.getAttribute('data-square');
      if (to && to !== s.from) onDrop?.(s.from, to);
    },
    [onDrop],
  );

  const consumeSuppressClick = useCallback(() => {
    const value = suppressClick.current;
    suppressClick.current = false;
    return value;
  }, []);

  /** Aborta el arrastre actual (p. ej. al abrir el menu de skills con long-press). */
  const cancel = useCallback(() => {
    state.current = null;
    setDrag(null);
    suppressClick.current = true;
  }, []);

  return { drag, boardRef, begin, move, end, cancel, consumeSuppressClick };
}
