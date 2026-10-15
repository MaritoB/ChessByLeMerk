import type { Socket } from 'socket.io-client';
import type { Color } from 'chess.js';
import type { GameModeId, NetMessage, RtcSignal, StartMsg } from '@shared/protocol';
import { getMode } from '../modes';
import type { GameMode } from '../modes/types';
import { GameController, type MoveResult } from '../game/GameController';
import type { TimeControl } from '../game/clock';
import { PeerSession } from './peer';
import { clearSession } from './identity';

export type OnlinePhase = 'connecting' | 'waiting' | 'playing' | 'closed' | 'error';

export interface ChatEntry {
  from: 'me' | 'opponent' | 'system';
  text: string;
  at: number;
}

export interface OnlineSnapshot {
  phase: OnlinePhase;
  connected: boolean;
  myColor: Color | null;
  opponentName: string;
  roomId: string;
  modeId: GameModeId;
  connectionState: string;
  error: string | null;
  chat: ChatEntry[];
}

export interface OnlineGameOptions {
  socket: Socket;
  role: 'host' | 'guest';
  roomId: string;
  modeId: GameModeId;
  playerName: string;
  opponentName: string;
  opponentId?: string;
  playerId: string;
  secret: string;
  timeControl?: { initial: number; increment: number };
}

type Listener = (snapshot: OnlineSnapshot) => void;

interface ResyncMsg {
  type: 'resync';
  moves: { from: string; to: string; promotion?: string }[];
  result?: { winner: Color | 'draw' | null; reason: string } | null;
  lives?: Record<Color, number>;
  timeControl?: TimeControl;
}

type Inbound = NetMessage | ResyncMsg;

/**
 * Orquesta una partida online: crea la conexion WebRTC, intercambia el
 * mensaje de inicio, y conecta las jugadas con el GameController.
 * Soporta reconexion (identidad estable + resync del estado).
 */
export class OnlineGame {
  readonly mode: GameMode;
  readonly roomId: string;
  readonly controller: GameController;

  private readonly socket: Socket;
  private readonly role: 'host' | 'guest';
  private readonly playerName: string;
  private readonly myPlayerId: string;
  private readonly secret: string;
  private peer: PeerSession | null = null;
  private remotePeerId: string | null = null;
  private pendingSignals: RtcSignal[] = [];
  private started = false;
  private left = false;
  private chat: ChatEntry[] = [];
  private timeControlValue: TimeControl;
  private snapshotData: OnlineSnapshot;
  private listeners = new Set<Listener>();

  constructor(options: OnlineGameOptions) {
    this.socket = options.socket;
    this.role = options.role;
    this.roomId = options.roomId;
    this.mode = getMode(options.modeId);
    this.controller = new GameController(this.mode);
    this.playerName = options.playerName;
    this.myPlayerId = options.playerId;
    this.secret = options.secret;
    this.remotePeerId = options.opponentId ?? null;
    this.timeControlValue = options.timeControl ?? { initial: 0, increment: 0 };
    this.snapshotData = {
      phase: options.role === 'guest' ? 'connecting' : 'waiting',
      connected: false,
      myColor: null,
      opponentName: options.opponentName,
      roomId: options.roomId,
      modeId: options.modeId,
      connectionState: 'new',
      error: null,
      chat: [],
    };

    this.socket.on('rtc:signal', this.onRtcSignal);
    this.socket.on('rtc:hello', this.onRtcHello);
    this.socket.on('room:peer-joined', this.onPeerJoined);
    this.socket.on('game:msg', this.onGameMsg);
    this.socket.on('room:peer-left', this.onPeerLeft);
    this.socket.on('room:peer-disconnected', this.onPeerDisconnected);
    this.socket.on('room:peer-reconnected', this.onPeerReconnected);
    this.socket.on('connect', this.onSocketConnect);

    if (options.role === 'guest' && options.opponentId) {
      this.createPeer(false);
      this.socket.emit('rtc:hello', { to: options.opponentId });
    }
  }

  get myColor(): Color | null {
    return this.snapshotData.myColor;
  }

  get state(): OnlineSnapshot {
    return this.snapshotData;
  }

  get timeControl(): TimeControl {
    return this.timeControlValue;
  }

  flag(side: string): void {
    const color = this.snapshotData.myColor;
    if (color && side === color) this.resign();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshotData);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.snapshotData);
  }

  private patch(partial: Partial<OnlineSnapshot>): void {
    this.snapshotData = { ...this.snapshotData, ...partial };
    this.emit();
  }

  private createPeer(initiator: boolean): void {
    if (this.peer) return;
    let peer!: PeerSession;
    peer = new PeerSession(
      initiator,
      {
        onOpen: () => {
          if (this.peer === peer) this.onDataChannelOpen();
        },
        onMessage: (msg) => {
          if (this.peer === peer) this.onMessage(msg);
        },
        onClose: () => {
          if (this.peer === peer) this.onPeerClose();
        },
        onStateChange: (state) => {
          if (this.peer === peer) this.patch({ connectionState: state });
        },
      },
      (data) => {
        if (this.peer === peer) this.sendSignal(data);
      },
    );
    this.peer = peer;
    const buffered = this.pendingSignals;
    this.pendingSignals = [];
    for (const signal of buffered) void peer.handleSignal(signal);
    if (initiator) void peer.createOffer();
  }

  private closePeer(): void {
    this.peer?.close();
    this.peer = null;
    this.pendingSignals = [];
  }

  private sendSignal(data: RtcSignal): void {
    if (!this.remotePeerId) {
      this.pendingSignals.push(data);
      return;
    }
    this.socket.emit('rtc:signal', { to: this.remotePeerId, data });
  }

  private onRtcSignal = (payload: { from: string; data: RtcSignal }): void => {
    this.remotePeerId = payload.from;
    if (!this.peer) {
      if (this.role === 'guest') this.createPeer(false);
      else {
        this.pendingSignals.push(payload.data);
        return;
      }
    }
    void this.peer?.handleSignal(payload.data);
  };

  private onPeerJoined = (payload: { peer: { id: string; name: string } }): void => {
    if (this.role !== 'host' || !payload?.peer?.id) return;
    this.remotePeerId = payload.peer.id;
    this.patch({ opponentName: payload.peer.name, phase: 'connecting' });
    this.createPeer(true);
    if (!this.started) {
      const white: 'host' | 'guest' = Math.random() < 0.5 ? 'host' : 'guest';
      this.sendGame({ type: 'start', mode: this.mode.id, white, timeControl: this.timeControlValue });
      this.beginGame(white);
    } else {
      this.sendResync();
    }
  };

  private onGameMsg = (payload: { from: string; data: Inbound }): void => {
    if (!payload?.data) return;
    if (payload.from) this.remotePeerId = payload.from;
    this.onMessage(payload.data);
  };

  /** Envia por el canal P2P si esta abierto; si no, por el relay del servidor. */
  private sendGame(msg: Inbound): void {
    if (this.peer?.isOpen) {
      this.peer.send(msg);
      return;
    }
    if (this.remotePeerId) this.socket.emit('game:msg', { to: this.remotePeerId, data: msg });
  }

  private onRtcHello = (payload: { from: string }): void => {
    this.remotePeerId = payload.from;
    this.createPeer(true);
  };

  private onPeerLeft = (): void => {
    this.closePeer();
    this.patch({ phase: 'closed', connected: false, error: 'El rival se ha desconectado' });
  };

  private onPeerDisconnected = (): void => {
    if (!this.started) return;
    this.patch({ connected: false, phase: 'connecting', error: 'Rival desconectado, esperando...' });
  };

  private onPeerReconnected = (): void => {
    this.resetAndReconnect();
    this.patch({ error: null, phase: this.started ? 'connecting' : this.snapshotData.phase });
  };

  private onSocketConnect = (): void => {
    if (this.left || this.snapshotData.phase === 'closed') return;
    this.rejoin();
  };

  /** Reintenta entrar en la sala tras una reconexion del socket. */
  private rejoin(): void {
    this.socket.emit(
      'rooms:rejoin',
      { roomId: this.roomId, playerId: this.myPlayerId, secret: this.secret },
      (res: { ok: boolean; data?: { host: { id: string }; players: { id: string }[] }; error?: string }) => {
        if (!res.ok) {
          this.patch({ phase: 'error', error: res.error ?? 'No se pudo reconectar' });
          return;
        }
        if (this.role === 'guest' && res.data?.host) {
          this.remotePeerId = res.data.host.id;
        } else if (this.role === 'host' && res.data?.players) {
          const other = res.data.players.find((p) => p.id !== this.myPlayerId);
          if (other) this.remotePeerId = other.id;
        }
        this.resetAndReconnect();
        this.patch({ error: null, phase: this.started ? 'connecting' : this.snapshotData.phase });
      },
    );
  }

  /** Cierra la conexion actual y vuelve a negociar (reconexion). */
  private resetAndReconnect(): void {
    this.closePeer();
    if (this.role === 'host') {
      this.createPeer(true);
    } else {
      this.createPeer(false);
      if (this.remotePeerId) this.socket.emit('rtc:hello', { to: this.remotePeerId });
    }
  }

  private onPeerClose = (): void => {
    if (this.snapshotData.phase === 'closed' || this.left) return;
    this.patch({ connected: false, connectionState: 'disconnected' });
  };

  private onDataChannelOpen = (): void => {
    // La partida arranca por socket (room:peer-joined). Si el canal P2P abre con
    // la partida en curso, mandamos un resync.
    if (this.role === 'host' && this.started) this.sendResync();
    if (this.started) this.patch({ connected: true, phase: 'playing', connectionState: 'connected' });
  };

  private sendResync(): void {
    const snap = this.controller.snapshot();
    const resync: ResyncMsg = {
      type: 'resync',
      moves: snap.history.map((h) => ({ from: h.from, to: h.to, promotion: h.promotion })),
      result: snap.result,
      lives: snap.lives,
      timeControl: this.timeControlValue,
    };
    this.sendGame(resync);
  }

  private beginGame(whiteRole: 'host' | 'guest'): void {
    if (this.started) return;
    this.started = true;
    const myColor: Color = this.role === whiteRole ? 'w' : 'b';
    this.patch({ phase: 'playing', myColor, connected: this.socket.connected });
    this.pushChat('system', 'Partida iniciada. Juegas con las ' + (myColor === 'w' ? 'blancas' : 'negras'));
  }

  private onMessage(msg: Inbound): void {
    switch (msg.type) {
      case 'start':
        if (msg.timeControl) this.timeControlValue = msg.timeControl;
        this.beginGame(msg.white);
        break;
      case 'resync':
        if (msg.timeControl) this.timeControlValue = msg.timeControl;
        this.controller.sync({ moves: msg.moves, result: msg.result, lives: msg.lives });
        this.started = true;
        this.patch({ connected: true, phase: 'playing' });
        break;
      case 'move':
        this.controller.applyRemote({ from: msg.from, to: msg.to, promotion: msg.promotion });
        break;
      case 'resign':
        this.controller.resign(msg.by);
        break;
      case 'abort':
        this.controller.cancel();
        break;
      case 'mistake':
        this.controller.applyRemoteMistake(msg.by);
        break;
      case 'rematch':
        this.controller.reset();
        this.pushChat('system', 'El rival propone revancha');
        break;
      case 'chat':
        this.pushChat('opponent', msg.text);
        break;
      default:
        break;
    }
  }

  makeMove(from: string, to: string, promotion?: string): MoveResult {
    const color = this.snapshotData.myColor;
    if (!color) return { ok: false, error: 'La partida no ha empezado' };
    const result = this.controller.attempt({ from, to, promotion }, color);
    if (result.ok && result.move) {
      this.sendGame({
        type: 'move',
        from: result.move.from,
        to: result.move.to,
        promotion: result.move.promotion,
        san: result.san,
      });
    }
    return result;
  }

  /** Registra un fallo local y lo comunica al rival (vidas sincronizadas). */
  mistake(reason: string): MoveResult {
    const color = this.snapshotData.myColor;
    if (!color) return { ok: false, error: 'La partida no ha empezado' };
    const result = this.controller.mistake(color, reason);
    if (result.penalty) {
      this.sendGame({ type: 'mistake', by: color });
    }
    return result;
  }

  resign(): void {
    const color = this.snapshotData.myColor;
    if (!color) return;
    this.controller.resign(color);
    this.sendGame({ type: 'resign', by: color });
  }

  abort(): void {
    this.controller.cancel();
    this.sendGame({ type: 'abort' });
  }

  rematch(): void {
    this.controller.reset();
    this.sendGame({ type: 'rematch' });
  }

  sendChat(text: string): void {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    this.sendGame({ type: 'chat', text: clean });
    this.pushChat('me', clean);
  }

  private pushChat(from: ChatEntry['from'], text: string): void {
    this.chat = [...this.chat, { from, text, at: Date.now() }];
    this.patch({ chat: this.chat });
  }

  leave(): void {
    this.left = true;
    clearSession(this.roomId);
    this.socket.emit('rooms:leave');
    this.socket.off('rtc:signal', this.onRtcSignal);
    this.socket.off('rtc:hello', this.onRtcHello);
    this.socket.off('room:peer-joined', this.onPeerJoined);
    this.socket.off('game:msg', this.onGameMsg);
    this.socket.off('room:peer-left', this.onPeerLeft);
    this.socket.off('room:peer-disconnected', this.onPeerDisconnected);
    this.socket.off('room:peer-reconnected', this.onPeerReconnected);
    this.socket.off('connect', this.onSocketConnect);
    this.closePeer();
    this.controller.dispose();
    this.patch({ phase: 'closed' });
  }
}
