import type { Socket } from 'socket.io-client';
import type { Color } from 'chess.js';
import type { GameModeId, NetMessage, RtcSignal, StartMsg } from '@shared/protocol';
import { getMode } from '../modes';
import type { GameMode } from '../modes/types';
import { GameController, type MoveResult } from '../game/GameController';
import type { TimeControl } from '../game/clock';
import { PeerSession } from './peer';

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
  timeControl?: { initial: number; increment: number };
}

type Listener = (snapshot: OnlineSnapshot) => void;

/**
 * Orquesta una partida online: crea la conexion WebRTC, intercambia el
 * mensaje de inicio, y conecta las jugadas con el GameController.
 */
export class OnlineGame {
  readonly mode: GameMode;
  readonly roomId: string;
  readonly controller: GameController;

  private readonly socket: Socket;
  private readonly role: 'host' | 'guest';
  private readonly playerName: string;
  private peer: PeerSession | null = null;
  private remotePeerId: string | null = null;
  private pendingSignals: RtcSignal[] = [];
  private started = false;
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
    this.socket.on('room:peer-left', this.onPeerLeft);

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
    this.peer = new PeerSession(
      initiator,
      {
        onOpen: () => this.onDataChannelOpen(),
        onMessage: (msg) => this.onMessage(msg),
        onClose: () => this.onPeerClose(),
        onStateChange: (state) => this.patch({ connectionState: state }),
      },
      (data) => this.sendSignal(data),
    );
    const buffered = this.pendingSignals;
    this.pendingSignals = [];
    for (const signal of buffered) void this.peer.handleSignal(signal);
    if (initiator) void this.peer.createOffer();
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
      this.pendingSignals.push(payload.data);
      return;
    }
    void this.peer.handleSignal(payload.data);
  };

  private onPeerJoined = (payload: { peer: { id: string; name: string } }): void => {
    this.remotePeerId = payload.peer.id;
    this.patch({ opponentName: payload.peer.name, phase: 'connecting' });
  };

  private onRtcHello = (payload: { from: string }): void => {
    this.remotePeerId = payload.from;
    this.createPeer(true);
  };

  private onPeerLeft = (): void => {
    this.peer?.close();
    this.peer = null;
    this.patch({ phase: 'closed', connected: false, error: 'El rival se ha desconectado' });
  };

  private onPeerClose = (): void => {
    if (this.snapshotData.phase === 'closed') return;
    this.patch({ connected: false, phase: 'closed', error: 'Conexion P2P cerrada' });
  };

  private onDataChannelOpen = (): void => {
    if (this.role === 'host' && !this.started) {
      const white: 'host' | 'guest' = Math.random() < 0.5 ? 'host' : 'guest';
      const start: StartMsg = { type: 'start', mode: this.mode.id, white, timeControl: this.timeControlValue };
      this.peer?.send(start);
      this.beginGame(white);
    }
    this.patch({ connected: true });
  };

  private beginGame(whiteRole: 'host' | 'guest'): void {
    if (this.started) return;
    this.started = true;
    const myColor: Color = this.role === whiteRole ? 'w' : 'b';
    this.patch({ phase: 'playing', myColor });
    this.pushChat('system', 'Partida iniciada. Juegas con las ' + (myColor === 'w' ? 'blancas' : 'negras'));
  }

  private onMessage(msg: NetMessage): void {
    switch (msg.type) {
      case 'start':
        if (msg.timeControl) this.timeControlValue = msg.timeControl;
        this.beginGame(msg.white);
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
      this.peer?.send({
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
      this.peer?.send({ type: 'mistake', by: color });
    }
    return result;
  }

  resign(): void {
    const color = this.snapshotData.myColor;
    if (!color) return;
    this.controller.resign(color);
    this.peer?.send({ type: 'resign', by: color });
  }

  abort(): void {
    this.controller.cancel();
    this.peer?.send({ type: 'abort' });
  }

  rematch(): void {
    this.controller.reset();
    this.peer?.send({ type: 'rematch' });
  }

  sendChat(text: string): void {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    this.peer?.send({ type: 'chat', text: clean });
    this.pushChat('me', clean);
  }

  private pushChat(from: ChatEntry['from'], text: string): void {
    this.chat = [...this.chat, { from, text, at: Date.now() }];
    this.patch({ chat: this.chat });
  }

  leave(): void {
    this.socket.emit('rooms:leave');
    this.socket.off('rtc:signal', this.onRtcSignal);
    this.socket.off('rtc:hello', this.onRtcHello);
    this.socket.off('room:peer-joined', this.onPeerJoined);
    this.socket.off('room:peer-left', this.onPeerLeft);
    this.peer?.close();
    this.peer = null;
    this.controller.dispose();
    this.patch({ phase: 'closed' });
  }
}
