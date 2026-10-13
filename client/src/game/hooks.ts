import { useEffect, useRef, useState } from 'react';
import type { GameController, GameSnapshot } from './GameController';

export function useControllerState(controller: GameController): GameSnapshot {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => controller.snapshot());
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  return snapshot;
}

export function useInterval(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

export function useTimeout(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delayMs === null) return;
    const id = setTimeout(() => saved.current(), delayMs);
    return () => clearTimeout(id);
  }, [delayMs]);
}

/**
 * Da `ms` ms para la primera jugada. Se reinicia en cada jugada mientras
 * queden menos de 2 (la primera de cada bando). Si expira, llama a onExpire.
 */
export function useFirstMoveTimer(active: boolean, moveCount: number, ms: number, onExpire: () => void) {
  const cb = useRef(onExpire);
  useEffect(() => {
    cb.current = onExpire;
  }, [onExpire]);
  const [remaining, setRemaining] = useState(ms);
  const deadline = useRef(0);
  const fired = useRef(false);

  useEffect(() => {
    if (!active || moveCount >= 2) return;
    deadline.current = Date.now() + ms;
    fired.current = false;
    setRemaining(ms);
    const id = setInterval(() => {
      const left = deadline.current - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0 && !fired.current) {
        fired.current = true;
        cb.current();
      }
    }, 250);
    return () => clearInterval(id);
  }, [active, moveCount, ms]);

  return { show: active && moveCount < 2, remaining };
}
