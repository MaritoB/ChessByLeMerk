import { io, type Socket } from 'socket.io-client';

/** Resuelve la URL del servidor de senalizacion segun el entorno. */
export function resolveServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('server');
  if (override) return override.replace(/\/$/, '');

  const host = window.location.hostname;
  const port = window.location.port;

  // En desarrollo (Vite) el servidor corre en el puerto 3001.
  if (import.meta.env.DEV || port === '5173' || port === '4173') {
    return `${window.location.protocol}//${host}:3001`;
  }
  // En produccion el propio servidor sirve el cliente: mismo origen.
  return window.location.origin;
}

export function connectSocket(serverUrl = resolveServerUrl()): Socket {
  return io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
}
