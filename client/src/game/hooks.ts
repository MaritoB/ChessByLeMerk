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
