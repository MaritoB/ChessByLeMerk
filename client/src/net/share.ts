import { resolveServerUrl } from './signaling';

/** Construye el enlace para unirse a una sala (incluye el servidor). */
export function buildRoomLink(roomId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', roomId.toUpperCase());
  url.searchParams.set('server', resolveServerUrl());
  return url.toString();
}

export function readRoomParam(): string | null {
  const value = new URLSearchParams(window.location.search).get('room');
  return value ? value.toUpperCase() : null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
