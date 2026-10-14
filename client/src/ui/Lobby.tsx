import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameModeId, RoomInfo } from '@shared/protocol';
import { MODE_LIST, fourFormatOf, isFourMode, isVarMode, varConfigFrom, varConfigOf, varModeIdOf, type VarMods } from '../modes';
import { OnlineGame } from '../net/OnlineGame';
import { FourGame } from '../net/FourGame';
import { VarGame } from '../net/VarGame';
import { createRoom, joinRoom, rejoinRoom } from '../net/lobby';
import { clearSession, loadSession, saveSession, type StoredSession } from '../net/identity';
import { setPieceStyle, usePieceStyle } from './theme';
import { TIME_CONTROLS, type TimeControl } from '../game/clock';
import type { VarConfig } from '../var/session';

export type OnlineConn =
  | { kind: 'two'; game: OnlineGame }
  | { kind: 'four'; game: FourGame }
  | { kind: 'var'; game: VarGame };

export interface LobbyProps {
  socket: Socket | null;
  connected: boolean;
  playerName: string;
  setPlayerName: (name: string) => void;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  rooms: RoomInfo[];
  onStartLocal: (modeId: GameModeId, mods?: VarMods) => void;
  onStartSandbox: (modeId: GameModeId) => void;
  onEnterOnline: (conn: OnlineConn) => void;
  initialRoom?: string | null;
  timeControlIndex: number;
  onTimeControlIndex: (index: number) => void;
  timeControl: TimeControl;
}

export function Lobby({
  socket,
  connected,
  playerName,
  setPlayerName,
  serverUrl,
  setServerUrl,
  rooms,
  onStartLocal,
  onStartSandbox,
  onEnterOnline,
  initialRoom,
  timeControlIndex,
  onTimeControlIndex,
  timeControl,
}: LobbyProps) {
  const [selectedMode, setSelectedMode] = useState<GameModeId>('standard');
  const [mods, setMods] = useState<VarMods>({ skills: true, shrink: false, fog: false });
  const [roomName, setRoomName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState(initialRoom ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const pieceStyle = usePieceStyle();
  const autoJoined = useRef(false);

  useEffect(() => {
    if (!initialRoom || autoJoined.current || !socket || !connected) return;
    autoJoined.current = true;
    const stored = loadSession(initialRoom);
    if (stored) {
      void handleRejoin(initialRoom, stored);
      return;
    }
    const info = rooms.find((r) => r.id === initialRoom);
    void handleJoin(initialRoom, info?.hasPassword ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoom, socket, connected, rooms]);

  const name = playerName.trim() || 'Jugador';

  useEffect(() => {
    if (selectedMode === 'skills') setMods({ skills: true, shrink: false, fog: false });
    else if (selectedMode === 'royale') setMods({ skills: false, shrink: true, fog: false });
  }, [selectedMode]);

  function buildConn(opts: {
    mode: GameModeId;
    role: 'host' | 'guest';
    roomId: string;
    playerId: string;
    secret: string;
    config?: VarConfig;
    format?: 'ffa' | 'teams';
    opponentId?: string;
    opponentName?: string;
  }): OnlineConn | null {
    if (!socket) return null;
    const isHost = opts.role === 'host';
    if (isFourMode(opts.mode)) {
      return {
        kind: 'four',
        game: new FourGame({
          socket,
          role: opts.role,
          roomId: opts.roomId,
          format: opts.format ?? fourFormatOf(opts.mode),
          playerName: name,
          playerId: opts.playerId,
          secret: opts.secret,
          hostId: opts.opponentId,
          hostName: opts.opponentName,
          timeControl: isHost ? timeControl : undefined,
        }),
      };
    }
    if (isVarMode(opts.mode)) {
      return {
        kind: 'var',
        game: new VarGame({
          socket,
          role: opts.role,
          roomId: opts.roomId,
          config: opts.config ?? varConfigOf(varModeIdOf(opts.mode)),
          playerName: name,
          playerId: opts.playerId,
          secret: opts.secret,
          opponentId: opts.opponentId,
          opponentName: opts.opponentName,
          timeControl: isHost ? timeControl : undefined,
        }),
      };
    }
    return {
      kind: 'two',
      game: new OnlineGame({
        socket,
        role: opts.role,
        roomId: opts.roomId,
        modeId: opts.mode,
        playerName: name,
        playerId: opts.playerId,
        secret: opts.secret,
        opponentName: opts.opponentName ?? 'Esperando rival...',
        opponentId: opts.opponentId,
        timeControl: isHost ? timeControl : undefined,
      }),
    };
  }

  async function handleCreate() {
    if (!socket) return;
    setBusy(true);
    setError(null);
    const config = isVarMode(selectedMode) ? varConfigFrom(varModeIdOf(selectedMode), mods) : undefined;
    const res = await createRoom(socket, {
      name: roomName.trim() || `Sala de ${name}`,
      hostName: name,
      mode: selectedMode,
      isPrivate,
      password: password.trim() || undefined,
    });
    setBusy(false);
    if (res.ok && res.roomId && res.playerId && res.secret) {
      saveSession(res.roomId, {
        mode: selectedMode,
        role: 'host',
        playerId: res.playerId,
        secret: res.secret,
        config,
        format: isFourMode(selectedMode) ? fourFormatOf(selectedMode) : undefined,
      });
      const conn = buildConn({
        mode: selectedMode,
        role: 'host',
        roomId: res.roomId,
        playerId: res.playerId,
        secret: res.secret,
        config,
      });
      if (conn) onEnterOnline(conn);
    } else {
      setError(res.error ?? 'No se pudo crear la sala');
    }
  }

  async function handleJoin(roomId: string, hasPassword: boolean) {
    if (!socket) return;
    let pw: string | undefined;
    if (hasPassword) {
      pw = window.prompt('Contrasena de la sala') ?? '';
    }
    setBusy(true);
    setError(null);
    const res = await joinRoom(socket, { roomId, playerName: name, password: pw });
    setBusy(false);
    if (res.ok && res.roomId && res.host && res.playerId && res.secret) {
      const modeId = res.mode ?? 'standard';
      saveSession(res.roomId, {
        mode: modeId,
        role: 'guest',
        playerId: res.playerId,
        secret: res.secret,
        format: isFourMode(modeId) ? fourFormatOf(modeId) : undefined,
      });
      const conn = buildConn({
        mode: modeId,
        role: 'guest',
        roomId: res.roomId,
        playerId: res.playerId,
        secret: res.secret,
        opponentId: res.host.id,
        opponentName: res.host.name,
      });
      if (conn) onEnterOnline(conn);
    } else {
      setError(res.error ?? 'No se pudo entrar en la sala');
    }
  }

  /** Reconecta a una sala tras recargar la pagina (identidad guardada). */
  async function handleRejoin(roomId: string, stored: StoredSession) {
    if (!socket) return;
    setBusy(true);
    setError(null);
    const res = await rejoinRoom(socket, {
      roomId,
      playerId: stored.playerId,
      secret: stored.secret,
    });
    setBusy(false);
    if (res.ok) {
      const modeId = res.mode ?? stored.mode;
      const conn = buildConn({
        mode: modeId,
        role: stored.role,
        roomId,
        playerId: stored.playerId,
        secret: stored.secret,
        config: stored.config as VarConfig | undefined,
        format: stored.format,
        opponentId: stored.role === 'guest' ? res.host?.id : undefined,
        opponentName: stored.role === 'guest' ? res.host?.name : undefined,
      });
      if (conn) onEnterOnline(conn);
    } else {
      clearSession(roomId);
      const info = rooms.find((r) => r.id === roomId);
      void handleJoin(roomId, info?.hasPassword ?? false);
    }
  }

  return (
    <div className="lobby">
      <header className="lobby__header">
        <h1>
          Chess <span className="accent">by LeMerk</span>
        </h1>
        <p className="muted">Ajedrez peer-to-peer con variantes. PC, movil, tablet y navegador.</p>
      </header>

      <div className="lobby__grid">
        <section className="card">
          <h2>1. Tu nombre</h2>
          <input
            className="input"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Como te llamas?"
            maxLength={24}
          />
          <div className="row row--between">
            <span className="muted small">Estilo de piezas</span>
            <div className="skill-row">
              <button
                type="button"
                className={pieceStyle === 'sheet2' ? 'btn btn--primary btn--tiny' : 'btn btn--ghost btn--tiny'}
                onClick={() => setPieceStyle('sheet2')}
              >
                Hoja 2
              </button>
              <button
                type="button"
                className={pieceStyle === 'sheet1' ? 'btn btn--primary btn--tiny' : 'btn btn--ghost btn--tiny'}
                onClick={() => setPieceStyle('sheet1')}
              >
                Hoja 1
              </button>
              <button
                type="button"
                className={pieceStyle === 'glyph' ? 'btn btn--primary btn--tiny' : 'btn btn--ghost btn--tiny'}
                onClick={() => setPieceStyle('glyph')}
              >
                Glifos
              </button>
            </div>
          </div>

          <h2>2. Elige variante</h2>
          <div className="modes">
            {MODE_LIST.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`modecard ${selectedMode === mode.id ? 'modecard--active' : ''}`}
                onClick={() => setSelectedMode(mode.id)}
              >
                {mode.id === 'skills' ? (
                  <img className="modecard__art" src="/skills/cover.png" alt="" draggable={false} />
                ) : (
                  <span className="modecard__emoji">{mode.emoji}</span>
                )}
                <span className="modecard__name">{mode.name}</span>
                <span className="modecard__tag">{mode.tagline}</span>
              </button>
            ))}
          </div>
          <p className="muted small">
            {MODE_LIST.find((m) => m.id === selectedMode)?.description}
          </p>

          {isVarMode(selectedMode) && (
            <div className="mods">
              <span className="muted small">Combinar modificadores (2 jugadores):</span>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={mods.skills}
                    onChange={(e) => setMods((m) => ({ ...m, skills: e.target.checked }))}
                  />
                  Skills
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={mods.shrink}
                    onChange={(e) => setMods((m) => ({ ...m, shrink: e.target.checked }))}
                  />
                  Encogimiento (Royale)
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={mods.fog}
                    onChange={(e) => setMods((m) => ({ ...m, fog: e.target.checked }))}
                  />
                  Niebla (Fog)
                </label>
              </div>
              <p className="muted small">
                Podés combinar Skills, Royale (tablero que encoge) y Niebla en la misma partida.
              </p>
            </div>
          )}

          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => onStartLocal(selectedMode, mods)}>
              {isVarMode(selectedMode) || isFourMode(selectedMode)
                ? '\u25B6 Practicar solo (sin rival)'
                : 'Partida local (mismo dispositivo)'}
            </button>
            {!isFourMode(selectedMode) && !isVarMode(selectedMode) && (
              <button type="button" className="btn btn--ghost" onClick={() => onStartSandbox(selectedMode)}>
                Sandbox (mueve libre)
              </button>
            )}
          </div>
          <p className="muted small">
            Practica sin conexion ni rival. En local juegas los dos bandos por turnos; en Sandbox puedes
            mover cualquier pieza para probar.
          </p>
        </section>

        <section className="card">
          <h2>3. Jugar online</h2>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => onStartLocal(selectedMode, mods)}
          >
            {'\u25B6 Practicar solo sin rival'} ({MODE_LIST.find((m) => m.id === selectedMode)?.name})
          </button>
          <p className="muted small">
            Sin esperar a que entre nadie: juegas los dos bandos en el mismo dispositivo.
          </p>
          <div className="serverstatus">
            <span className={`dot-status ${connected ? 'dot-status--on' : 'dot-status--off'}`} />
            {connected ? 'Conectado al lobby' : 'Conectando al lobby...'}
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? 'Ocultar servidor' : 'Servidor'}
            </button>
          </div>
          {showAdvanced && (
            <input
              className="input"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.20:3001"
            />
          )}

          <input
            className="input"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Nombre de la sala (opcional)"
            maxLength={40}
          />
          <div className="row row--between">
            <label className="check">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              Sala privada
            </label>
            <input
              className="input input--small"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contrasena (opcional)"
              maxLength={24}
            />
          </div>
          <div className="row row--between">
            <span className="muted small">Tiempo</span>
            <select
              className="input input--small"
              value={timeControlIndex}
              onChange={(e) => onTimeControlIndex(Number(e.target.value))}
            >
              {TIME_CONTROLS.map((tc, i) => (
                <option key={tc.label} value={i}>
                  {tc.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleCreate}
            disabled={!connected || busy}
          >
            Crear sala
          </button>

          <div className="divider" />

          <div className="row">
            <input
              className="input"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Codigo de sala (ej. K2FN9)"
              maxLength={6}
            />
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => handleJoin(joinCode.trim(), false)}
              disabled={!connected || busy || joinCode.trim().length < 3}
            >
              Entrar
            </button>
          </div>

          {error && <div className="feedback feedback--error">{error}</div>}
        </section>

        <section className="card card--wide">
          <h2>Salas abiertas</h2>
          {rooms.length === 0 ? (
            <p className="muted">No hay salas publicas. Crea una y comparte el codigo con tu amigo.</p>
          ) : (
            <ul className="roomlist">
              {rooms.map((room) => (
                <li key={room.id} className="roomrow">
                  <div className="roomrow__info">
                    <strong>{room.name}</strong>
                    <span className="muted small">
                      {MODE_LIST.find((m) => m.id === room.mode)?.name ?? room.mode} · anfitrion{' '}
                      {room.hostName} · {room.playerCount}/{room.maxPlayers}
                    </span>
                  </div>
                  <div className="roomrow__actions">
                    <span className="code">{room.id}</span>
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      onClick={() => handleJoin(room.id, room.hasPassword)}
                      disabled={!connected || busy || room.playerCount >= room.maxPlayers}
                    >
                      {room.playerCount >= room.maxPlayers ? 'Llena' : 'Unirse'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="lobby__footer muted small">
        Conexion directa entre jugadores (WebRTC). El servidor solo intercambia el handshake.
      </footer>
    </div>
  );
}
