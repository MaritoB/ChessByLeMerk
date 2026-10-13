import { useEffect, useRef, useState } from 'react';

export interface TimeControl {
  initial: number;
  increment: number;
}

export const TIME_CONTROLS: { label: string; value: TimeControl }[] = [
  { label: 'Sin reloj', value: { initial: 0, increment: 0 } },
  { label: '1+0', value: { initial: 60_000, increment: 0 } },
  { label: '3+2', value: { initial: 180_000, increment: 2_000 } },
  { label: '5+0', value: { initial: 300_000, increment: 0 } },
  { label: '10+0', value: { initial: 600_000, increment: 0 } },
];

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 20_000 && clamped > 0) {
    return (clamped / 1000).toFixed(1);
  }
  const total = Math.ceil(clamped / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface UseClocksOptions {
  sides: string[];
  active: string;
  /** Cambia con cada jugada (para disparar el cambio de reloj). */
  moveCount: number;
  timeControl: TimeControl;
  onFlag: (side: string) => void;
}

export function useClocks({ sides, active, moveCount, timeControl, onFlag }: UseClocksOptions) {
  const enabled = timeControl.initial > 0;
  const sidesKey = sides.join(',');
  const state = useRef({
    times: {} as Record<string, number>,
    active,
    last: Date.now(),
    moveCount: -1,
    flagged: false,
  });
  const [, force] = useState(0);
  const onFlagRef = useRef(onFlag);
  useEffect(() => {
    onFlagRef.current = onFlag;
  }, [onFlag]);

  // Reinicio (nueva partida / cambio de control de tiempo).
  useEffect(() => {
    const times: Record<string, number> = {};
    for (const s of sides) times[s] = timeControl.initial;
    state.current = { times, active, last: Date.now(), moveCount, flagged: false };
    force((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidesKey, timeControl.initial, timeControl.increment]);

  // Descuento al cambiar de jugada.
  useEffect(() => {
    if (!enabled) return;
    const st = state.current;
    const now = Date.now();
    if (st.moveCount !== moveCount) {
      if (moveCount < st.moveCount) {
        // Nueva partida (revancha): reinicia los tiempos.
        for (const k of Object.keys(st.times)) st.times[k] = timeControl.initial;
        st.active = active;
        st.last = now;
        st.moveCount = moveCount;
        st.flagged = false;
        return;
      }
      st.times[st.active] = Math.max(0, st.times[st.active] - (now - st.last)) + timeControl.increment;
      st.active = active;
      st.last = now;
      st.moveCount = moveCount;
      st.flagged = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveCount, active, enabled]);

  // Tic + deteccion de bandera.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      force((v) => v + 1);
      const st = state.current;
      const left = st.times[st.active] - (Date.now() - st.last);
      if (!st.flagged && left <= 0) {
        st.flagged = true;
        onFlagRef.current(st.active);
      }
    }, 250);
    return () => clearInterval(id);
  }, [enabled]);

  const remaining = (side: string): number => {
    const st = state.current;
    if (!enabled) return 0;
    const base = st.times[side] ?? timeControl.initial;
    if (side === st.active) return Math.max(0, base - (Date.now() - st.last));
    return base;
  };

  return { remaining, enabled };
}
