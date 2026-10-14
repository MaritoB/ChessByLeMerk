import type { GameModeId, SessionIdentity } from '@shared/protocol';

export interface StoredSession extends SessionIdentity {
  mode: GameModeId;
  role: 'host' | 'guest';
  config?: unknown;
  format?: 'ffa' | 'teams';
}

const KEY = (roomId: string) => `cbl.sess.${roomId.toUpperCase()}`;

export function saveSession(roomId: string, session: StoredSession): void {
  try {
    sessionStorage.setItem(KEY(roomId), JSON.stringify(session));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function loadSession(roomId: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY(roomId));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(roomId: string): void {
  try {
    sessionStorage.removeItem(KEY(roomId));
  } catch {
    /* noop */
  }
}
