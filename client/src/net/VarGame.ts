import type { Socket } from 'socket.io-client';
import type { RtcSignal } from '@shared/protocol';
import type { Action, Color } from '../var/board';
import { VarChess } from '../var/engine';
import type { VarConfig, VarSession } from '../var/session';
import type { TimeControl } from '../game/clock';
import { PeerSession } from './peer';

interface VarStartMsg {
  t: 'start';
  white: 'host' | 'guest';
  config: VarConfig;
  timeControl?: TimeControl;
}
interface VarActionMsg {
  t: 'action';
  action: Action;
}
interface VarResignMsg {
  t: 'resign';
  color: Color;
}
interface VarRematchMsg {
  t: 'rematch';
}
interface VarAbortMsg {
  t: 'abort';
}
type VarNetMsg = VarStartMsg | VarActionMsg | VarResignMsg | VarRematchMsg | VarAbortMsg;

export interface VarGameOptions {
  socket: Socket;
  role: 'host' | 'guest';
  roomId: string;
  config: VarConfig;
  playerName: string;
  opponentId?: string;
  opponentName?: string;
  timeControl?: TimeControl;
}

/** Partida online de 2 jugadores para variantes 8x8 (Royale, Skills). */
export class VarGame implements VarSession {
  readonly engine: VarChess;
  readonly config: VarConfig;
  readonly online = true;

  private readonly socket: Socket;
  private readonly role: 'host' | 'guest';
  readonly roomId: string;
  private remotePeerId: string | null;
  private opponentName: string;
  private peer: PeerSession | null = null;
  private pendingSignals: RtcSignal[] = [];
  private started = false;
  private myColorValue: Color | null = null;
  private listeners = new Set<() => void>();
  private timeControlValue: TimeControl;

  constructor(options: VarGameOptions) {
    this.socket = options.socket;
    this.role = options.role;
    this.roomId = options.roomId;
    this.config = options.config;
    this.remotePeerId = options.opponentId ?? null;
    this.opponentName = options.opponentName ?? 'Rival';
    this.timeControlValue = options.timeControl ?? { initial: 0, increment: 0 };
    this.engine = new VarChess({
      shrinkEvery: options.config.shrinkEvery,
      skills: options.config.skills,
      shieldPawns: options.config.shieldPawns,
    });

    this.socket.on('rtc:signal', this.onSignal);
    this.socket.on('rtc:hello', this.onHello);
    this.socket.on('room:peer-left', this.onPeerLeft);

    if (options.role === 'guest' && options.opponentId) {
      this.createPeer(false);
      this.socket.emit('rtc:hello', { to: options.opponentId });
    }
  }

  get myColor(): Color | 'all' {
    return this.myColorValue ?? 'all';
  }
  get whiteName(): string {
    return this.role === 'host' ? 'Tu (blancas)' : this.opponentName;
  }
  get blackName(): string {
    return this.role === 'host' ? this.opponentName : 'Tu (negras)';
  }
  get connected(): boolean {
    return this.started && Boolean(this.peer?.isOpen);
  }
  get statusText(): string {
    if (this.myColorValue === null) return 'Esperando inicio...';
    return `Sala ${this.roomId}`;
  }
  get timeControl(): TimeControl {
    return this.timeControlValue;
  }
  flag(side: string): void {
    if (this.myColorValue && side === this.myColorValue) this.resign();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- conexion ----

  private createPeer(initiator: boolean): void {
    if (this.peer) return;
    this.peer = new PeerSession(
      initiator,
      {
        onOpen: () => this.onOpen(),
        onMessage: (msg: VarNetMsg) => this.onMessage(msg),
        onClose: () => this.emit(),
        onStateChange: () => this.emit(),
      },
      (data) => {
        if (this.remotePeerId) this.socket.emit('rtc:signal', { to: this.remotePeerId, data });
        else this.pendingSignals.push(data);
      },
    );
    const buffered = this.pendingSignals;
    this.pendingSignals = [];
    for (const s of buffered) void this.peer.handleSignal(s);
    if (initiator) void this.peer.createOffer();
  }

  private onOpen(): void {
    if (this.role === 'host' && !this.started) {
      const white: 'host' | 'guest' = Math.random() < 0.5 ? 'host' : 'guest';
      this.begin(white);
      this.peer?.send({ t: 'start', white, config: this.config, timeControl: this.timeControlValue });
    }
    this.emit();
  }

  private onSignal = (payload: { from: string; data: RtcSignal }): void => {
    this.remotePeerId = payload.from;
    if (!this.peer) {
      this.pendingSignals.push(payload.data);
      return;
    }
    void this.peer.handleSignal(payload.data);
  };

  private onHello = (payload: { from: string }): void => {
    if (this.role === 'host') {
      this.remotePeerId = payload.from;
      this.createPeer(true);
    }
  };

  private onPeerLeft = (): void => {
    if (this.started && this.myColorValue && !this.engine.result) {
      this.engine.resign(this.myColorValue === 'w' ? 'b' : 'w');
    }
    this.emit();
  };

  private begin(white: 'host' | 'guest'): void {
    if (this.started) return;
    this.started = true;
    this.myColorValue = this.role === white ? 'w' : 'b';
    this.emit();
  }

  /** Adopta la config enviada por el anfitrion (para partidas combinadas). */
  private applyConfig(config: VarConfig): void {
    Object.assign(this.config, config);
    this.engine.configure({
      shrinkEvery: config.shrinkEvery,
      skills: config.skills,
      shieldPawns: config.shieldPawns,
    });
    this.emit();
  }

  private onMessage(msg: VarNetMsg): void {
    switch (msg.t) {
      case 'start':
        if (msg.timeControl) this.timeControlValue = msg.timeControl;
        if (msg.config) this.applyConfig(msg.config);
        this.begin(msg.white);
        break;
      case 'action':
        this.engine.applyAction(msg.action);
        break;
      case 'resign':
        this.engine.resign(msg.color);
        break;
      case 'rematch':
        this.engine.reset();
        this.emit();
        break;
      case 'abort':
        this.engine.cancel();
        this.emit();
        break;
      default:
        break;
    }
  }

  makeAction(action: Action): boolean {
    if (!this.myColorValue) return false;
    if (this.engine.turn !== this.myColorValue) return false;
    const ok = this.engine.applyAction(action);
    if (ok) this.peer?.send({ t: 'action', action });
    return ok;
  }

  resign(): void {
    if (!this.myColorValue) return;
    this.engine.resign(this.myColorValue);
    this.peer?.send({ t: 'resign', color: this.myColorValue });
  }

  abort(): void {
    this.engine.cancel();
    this.peer?.send({ t: 'abort' });
  }

  rematch(): void {
    this.engine.reset();
    this.peer?.send({ t: 'rematch' });
  }

  leave(): void {
    this.socket.emit('rooms:leave');
    this.socket.off('rtc:signal', this.onSignal);
    this.socket.off('rtc:hello', this.onHello);
    this.socket.off('room:peer-left', this.onPeerLeft);
    this.peer?.close();
    this.peer = null;
  }
}
