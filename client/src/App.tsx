import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Square } from 'chess.js';
import type { GameModeId, RoomInfo } from '@shared/protocol';
import { connectSocket, resolveServerUrl } from './net/signaling';
import { listRooms, onRoomsUpdate } from './net/lobby';
import { readRoomParam } from './net/share';
import { OnlineGame } from './net/OnlineGame';
import { FourGame } from './net/FourGame';
import { GameController } from './game/GameController';
import type { GameSession } from './game/session';
import { FourChess } from './four/engine';
import type { FourSession, SeatNames } from './four/session';
import { VarChess } from './var/engine';
import type { VarSession } from './var/session';
import { fourFormatOf, getMode, isFourMode, isVarMode, varConfigFrom, varConfigOf, varModeIdOf, type VarMods } from './modes';
import { TIME_CONTROLS, type TimeControl } from './game/clock';
import { Lobby, type OnlineConn } from './ui/Lobby';
import { GameScreen } from './ui/GameScreen';
import { FourGameScreen } from './ui/FourGameScreen';
import { VarGameScreen } from './ui/VarGameScreen';

type View =
  | { name: 'lobby' }
  | { name: 'two'; session: GameSession }
  | { name: 'four'; session: FourSession }
  | { name: 'var'; session: VarSession };

function buildLocalSession(modeId: GameModeId, timeControl: TimeControl): GameSession {
  const mode = getMode(modeId);
  const controller = new GameController(mode);
  return {
    controller,
    mode,
    myColor: 'both',
    opponentName: 'Jugador 2 (mismo dispositivo)',
    statusText: 'Partida local',
    connected: true,
    online: false,
    timeControl,
    flag: (side) => controller.flag(side === 'w' ? 'b' : 'w', 'tiempo agotado'),
    makeMove: (from, to, promotion) =>
      controller.attempt({ from, to, promotion }, controller.snapshot().turn),
    mistake: (reason) => controller.mistake(controller.snapshot().turn, reason),
    resign: () => controller.resign(controller.snapshot().turn),
    rematch: () => controller.reset(),
    leave: () => controller.dispose(),
  };
}

function buildOnlineSession(game: OnlineGame): GameSession {
  return {
    controller: game.controller,
    mode: game.mode,
    get myColor() {
      return game.myColor ?? 'both';
    },
    get opponentName() {
      return game.state.opponentName;
    },
    get statusText() {
      const s = game.state;
      if (s.phase === 'waiting') return `Comparte el codigo ${s.roomId}. Esperando rival...`;
      if (s.phase === 'connecting') return `Conectando P2P (${s.connectionState})...`;
      if (s.phase === 'closed') return s.error ?? 'Desconectado';
      return `Sala ${s.roomId}`;
    },
    get connected() {
      return game.state.connected;
    },
    get timeControl() {
      return game.timeControl;
    },
    flag: (side) => game.flag(side),
    roomId: game.roomId,
    online: true,
    makeMove: (from, to, promotion) => game.makeMove(from, to, promotion),
    mistake: (reason) => game.mistake(reason),
    resign: () => game.resign(),
    rematch: () => game.rematch(),
    leave: () => game.leave(),
    sendChat: (text) => game.sendChat(text),
    subscribe: (listener) => game.subscribe(() => listener()),
  };
}

function buildFourLocal(modeId: GameModeId, timeControl: TimeControl): FourSession {
  const format = fourFormatOf(modeId);
  const engine = new FourChess(format);
  const seatNames: SeatNames = {
    red: 'Jugador 1',
    blue: 'Jugador 2',
    yellow: 'Jugador 3',
    green: 'Jugador 4',
  };
  return {
    engine,
    format,
    mySeat: 'all',
    seatNames,
    online: false,
    phase: 'playing',
    playerCount: 4,
    playerTarget: 4,
    connected: true,
    statusText: 'Partida local (4 jugadores)',
    isHost: true,
    canStart: false,
    timeControl,
    flag: (side) => engine.resign(side as import('./four/board').Seat),
    start: () => undefined,
    makeMove: (move) => engine.makeMove(move),
    resign: () => engine.resign(engine.currentSeat()),
    rematch: () => engine.reset(),
    leave: () => undefined,
    subscribe: () => () => undefined,
  };
}

function buildVarLocal(modeId: GameModeId, timeControl: TimeControl, mods?: VarMods): VarSession {
  const config = mods ? varConfigFrom(varModeIdOf(modeId), mods) : varConfigOf(varModeIdOf(modeId));
  const engine = new VarChess({
    shrinkEvery: config.shrinkEvery,
    skills: config.skills,
    shieldPawns: config.shieldPawns,
  });
  return {
    engine,
    config,
    myColor: 'all',
    whiteName: 'Jugador 1 (blancas)',
    blackName: 'Jugador 2 (negras)',
    online: false,
    connected: true,
    statusText: 'Practica solo (sin rival)',
    timeControl,
    flag: (side) => engine.resign(side as import('./var/board').Color),
    undo: () => engine.undo(),
    makeAction: (action) => engine.applyAction(action),
    resign: () => engine.resign(engine.turn),
    rematch: () => engine.reset(),
    leave: () => undefined,
    subscribe: () => () => undefined,
  };
}

function buildSandboxSession(modeId: GameModeId): GameSession {
  const mode = getMode(modeId);
  const controller = new GameController(mode);
  controller.enterSandbox();
  return {
    controller,
    mode,
    myColor: 'both',
    opponentName: 'Sandbox',
    statusText: 'Sandbox: mueve cualquier pieza libremente',
    connected: true,
    online: false,
    sandbox: true,
    makeMove: (from, to, promotion) => ({ ok: controller.editMove(from as Square, to as Square, promotion) }),
    mistake: () => ({ ok: false }),
    resign: () => undefined,
    rematch: () => controller.reset(),
    leave: () => controller.dispose(),
  };
}

export function App() {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('cbl.name') ?? '');
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem('cbl.server') ?? resolveServerUrl(),
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [view, setView] = useState<View>({ name: 'lobby' });
  const [tcIndex, setTcIndex] = useState(0);
  const timeControl = TIME_CONTROLS[tcIndex].value;

  useEffect(() => {
    const s = connectSocket(serverUrl);
    const onConnect = () => {
      setConnected(true);
      void listRooms(s).then(setRooms);
    };
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    const offRooms = onRoomsUpdate(s, setRooms);
    setSocket(s);
    return () => {
      offRooms();
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [serverUrl]);

  useEffect(() => {
    localStorage.setItem('cbl.name', playerName);
  }, [playerName]);

  useEffect(() => {
    localStorage.setItem('cbl.server', serverUrl);
  }, [serverUrl]);

  function handleStartLocal(modeId: GameModeId, mods?: VarMods) {
    if (isFourMode(modeId)) {
      setView({ name: 'four', session: buildFourLocal(modeId, timeControl) });
    } else if (isVarMode(modeId)) {
      setView({ name: 'var', session: buildVarLocal(modeId, timeControl, mods) });
    } else {
      setView({ name: 'two', session: buildLocalSession(modeId, timeControl) });
    }
  }

  function handleStartSandbox(modeId: GameModeId) {
    setView({ name: 'two', session: buildSandboxSession(modeId) });
  }

  function handleEnterOnline(conn: OnlineConn) {
    if (conn.kind === 'four') {
      setView({ name: 'four', session: conn.game });
    } else if (conn.kind === 'var') {
      setView({ name: 'var', session: conn.game });
    } else {
      setView({ name: 'two', session: buildOnlineSession(conn.game) });
    }
  }

  if (view.name === 'two') {
    return <GameScreen session={view.session} onExit={() => setView({ name: 'lobby' })} />;
  }
  if (view.name === 'four') {
    return <FourGameScreen session={view.session} onExit={() => setView({ name: 'lobby' })} />;
  }
  if (view.name === 'var') {
    return <VarGameScreen session={view.session} onExit={() => setView({ name: 'lobby' })} />;
  }

  return (
    <Lobby
      socket={socket}
      connected={connected}
      playerName={playerName}
      setPlayerName={setPlayerName}
      serverUrl={serverUrl}
      setServerUrl={setServerUrl}
      rooms={rooms}
      onStartLocal={handleStartLocal}
      onStartSandbox={handleStartSandbox}
      onEnterOnline={handleEnterOnline}
      initialRoom={readRoomParam()}
      timeControlIndex={tcIndex}
      onTimeControlIndex={setTcIndex}
      timeControl={timeControl}
    />
  );
}
