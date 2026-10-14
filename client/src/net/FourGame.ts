import type { Socket } from 'socket.io-client';
import type { RtcSignal } from '@shared/protocol';
import { SEAT_ORDER, type FMove, type GameFormat, type Seat } from '../four/board';
import { FourChess } from '../four/engine';
import type { FourPhase, FourSession, SeatNames } from '../four/session';
import type { TimeControl } from '../game/clock';
import { PeerSession } from './peer';
import { clearSession } from './identity';

interface PlayerLite {
  id: string;
  name: string;
  isHost: boolean;
  connected?: boolean;
}

interface NetStart {
  t: 'start';
  seats: Partial<Record<Seat, string>>;
  timeControl?: TimeControl;
}
interface NetMove {
  t: 'move';
  seat: Seat;
  move: FMove;
}
interface NetResign {
  t: 'resign';
  seat: Seat;
}
interface NetRematch {
  t: 'rematch';
}
interface NetAbort {
  t: 'abort';
}
interface NetResync {
  t: 'resync';
  seats: Partial<Record<Seat, string>>;
  moves: FMove[];
  timeControl?: TimeControl;
}
type FourNetMsg = NetStart | NetMove | NetResign | NetRematch | NetAbort | NetResync;

export interface FourGameOptions {
  socket: Socket;
  role: 'host' | 'guest';
  roomId: string;
  format: GameFormat;
  playerName: string;
  playerId: string;
  secret: string;
  hostId?: string;
  hostName?: string;
  timeControl?: TimeControl;
}

const PLAYER_TARGET = 4;

/**
 * Sala de 4 jugadores con topologia en estrella: todos los invitados se
 * conectan al anfitrion, que reenvia los mensajes al resto.
 * Soporta reconexion (identidad estable + resync del estado).
 */
export class FourGame implements FourSession {
  readonly engine: FourChess;
  readonly format: GameFormat;
  readonly online = true;

  private readonly socket: Socket;
  private readonly role: 'host' | 'guest';
  readonly roomId: string;
  private readonly myPlayerId: string;
  private readonly secret: string;
  private hostId: string | null;
  private hostName: string;

  private players: PlayerLite[] = [];
  private seats: Partial<Record<Seat, string>> = {};
  private mySeatValue: Seat | null = null;
  private phaseValue: FourPhase = 'waiting';
  private started = false;
  private left = false;
  private error: string | null = null;
  private timeControlValue: TimeControl;

  private peers = new Map<string, PeerSession>();
  private openPeers = new Set<string>();
  private pendingSignals = new Map<string, RtcSignal[]>();
  private listeners = new Set<() => void>();

  constructor(options: FourGameOptions) {
    this.socket = options.socket;
    this.role = options.role;
    this.roomId = options.roomId;
    this.format = options.format;
    this.myPlayerId = options.playerId;
    this.secret = options.secret;
    this.hostId = options.hostId ?? null;
    this.hostName = options.hostName ?? 'Anfitrion';
    this.timeControlValue = options.timeControl ?? { initial: 0, increment: 0 };
    this.engine = new FourChess(this.format);

    this.socket.on('room:players', this.onPlayers);
    this.socket.on('rtc:signal', this.onSignal);
    this.socket.on('rtc:hello', this.onHello);
    this.socket.on('room:peer-left', this.onPeerLeft);
    this.socket.on('room:peer-disconnected', this.onPeerDisconnected);
    this.socket.on('room:peer-reconnected', this.onPeerReconnected);
    this.socket.on('connect', this.onSocketConnect);

    if (this.role === 'guest' && this.hostId) {
      this.ensurePeer(this.hostId, false);
      this.socket.emit('rtc:hello', { to: this.hostId });
    }
  }

  // ---- FourSession ----

  get mySeat(): Seat | 'all' {
    return this.mySeatValue ?? 'all';
  }
  get seatNames(): SeatNames {
    const names: SeatNames = {};
    for (const seat of SEAT_ORDER) {
      const id = this.seats[seat];
      const player = id ? this.players.find((p) => p.id === id) : undefined;
      if (player) names[seat] = player.name;
    }
    return names;
  }
  get phase(): FourPhase {
    return this.phaseValue;
  }
  get playerCount(): number {
    return this.players.length;
  }
  get playerTarget(): number {
    return PLAYER_TARGET;
  }
  get connected(): boolean {
    if (!this.started) return false;
    if (this.role === 'guest') return this.hostId ? this.openPeers.has(this.hostId) : false;
    return this.players.length > 1 && this.openPeers.size >= this.players.length - 1;
  }
  get statusText(): string {
    if (this.phaseValue === 'closed') return this.error ?? 'Desconectado';
    if (this.phaseValue === 'waiting') return `Codigo ${this.roomId} · ${this.players.length}/${PLAYER_TARGET}`;
    if (this.phaseValue === 'connecting') return 'Conectando jugadores...';
    return `Sala ${this.roomId}`;
  }
  get isHost(): boolean {
    return this.role === 'host';
  }
  get timeControl(): TimeControl {
    return this.timeControlValue;
  }
  flag(side: string): void {
    if (this.mySeatValue && side === this.mySeatValue) this.resign();
  }
  get canStart(): boolean {
    return (
      this.role === 'host' &&
      !this.started &&
      this.players.length === PLAYER_TARGET &&
      this.openPeers.size >= PLAYER_TARGET - 1
    );
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

  // ---- Arranque ----

  start(): void {
    if (this.role !== 'host' || this.started) return;
    const ordered = this.players.slice(0, PLAYER_TARGET);
    if (ordered.length < PLAYER_TARGET) return;
    const seats: Partial<Record<Seat, string>> = {};
    ordered.forEach((p, i) => {
      seats[SEAT_ORDER[i]] = p.id;
    });
    this.seats = seats;
    this.mySeatValue = this.seatForId(this.myPlayerId);
    this.started = true;
    this.phaseValue = 'playing';
    const msg: NetStart = { t: 'start', seats, timeControl: this.timeControlValue };
    this.broadcast(msg);
    this.emit();
  }

  private onPlayers = (list: PlayerLite[]): void => {
    this.players = list;
    if (!this.started) {
      const provisional: Partial<Record<Seat, string>> = {};
      list.slice(0, PLAYER_TARGET).forEach((p, i) => {
        provisional[SEAT_ORDER[i]] = p.id;
      });
      this.seats = provisional;
    }
    if (this.phaseValue === 'waiting' && this.role === 'guest' && list.length > 1) {
      this.phaseValue = 'connecting';
    }
    this.emit();
  };

  // ---- Señalizacion / conexiones ----

  private ensurePeer(peerId: string, initiator: boolean): void {
    if (this.peers.has(peerId)) return;
    let peer!: PeerSession;
    const current = () => this.peers.get(peerId) === peer;
    peer = new PeerSession(
      initiator,
      {
        onOpen: () => {
          if (!current()) return;
          this.openPeers.add(peerId);
          if (this.role === 'host' && this.started) this.sendResync(peer);
          this.emit();
        },
        onMessage: (msg: FourNetMsg) => {
          if (current()) this.handleNet(peerId, msg);
        },
        onClose: () => {
          if (!current()) return;
          this.openPeers.delete(peerId);
          this.emit();
        },
        onStateChange: () => {
          if (current()) this.emit();
        },
      },
      (data) => {
        if (current()) this.socket.emit('rtc:signal', { to: peerId, data });
      },
    );
    this.peers.set(peerId, peer);
    const buffered = this.pendingSignals.get(peerId);
    if (buffered) {
      this.pendingSignals.delete(peerId);
      for (const signal of buffered) void peer.handleSignal(signal);
    }
    if (initiator) void peer.createOffer();
  }

  private resetPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) peer.close();
    this.peers.delete(peerId);
    this.openPeers.delete(peerId);
    this.pendingSignals.delete(peerId);
  }

  private resetAllPeers(): void {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.openPeers.clear();
    this.pendingSignals.clear();
  }

  private onSignal = (payload: { from: string; data: RtcSignal }): void => {
    const peer = this.peers.get(payload.from);
    if (peer) {
      void peer.handleSignal(payload.data);
      return;
    }
    if (this.role === 'guest' && payload.from === this.hostId) {
      this.ensurePeer(payload.from, false);
      void this.peers.get(payload.from)?.handleSignal(payload.data);
      return;
    }
    const list = this.pendingSignals.get(payload.from) ?? [];
    list.push(payload.data);
    this.pendingSignals.set(payload.from, list);
  };

  private onHello = (payload: { from: string }): void => {
    if (this.role === 'host') this.ensurePeer(payload.from, true);
  };

  private onPeerLeft = (payload: { peerId: string }): void => {
    this.resetPeer(payload.peerId);
    if (this.started) {
      const seat = this.seatForId(payload.peerId);
      if (seat && !this.engine.eliminated.has(seat) && !this.engine.result) {
        this.engine.resign(seat);
      }
    }
    if (this.role === 'guest' && payload.peerId === this.hostId && this.phaseValue !== 'closed') {
      this.error = 'El anfitrion abandono la sala';
      this.phaseValue = 'closed';
    }
    this.emit();
  };

  private onPeerDisconnected = (payload: { peerId: string }): void => {
    this.openPeers.delete(payload.peerId);
    this.emit();
  };

  private onPeerReconnected = (payload: { peerId: string }): void => {
    this.resetPeer(payload.peerId);
    if (this.role === 'host') {
      this.ensurePeer(payload.peerId, true);
    } else if (payload.peerId === this.hostId) {
      this.ensurePeer(payload.peerId, false);
      this.socket.emit('rtc:hello', { to: payload.peerId });
    }
    this.emit();
  };

  private onSocketConnect = (): void => {
    if (this.left || this.phaseValue === 'closed') return;
    this.rejoin();
  };

  private rejoin(): void {
    this.socket.emit(
      'rooms:rejoin',
      { roomId: this.roomId, playerId: this.myPlayerId, secret: this.secret },
      (res: { ok: boolean; data?: { host: { id: string }; players: PlayerLite[] }; error?: string }) => {
        if (!res.ok) {
          this.error = res.error ?? 'No se pudo reconectar';
          this.phaseValue = 'closed';
          this.emit();
          return;
        }
        if (res.data?.host) this.hostId = res.data.host.id;
        if (res.data?.players) this.players = res.data.players;
        this.resetAllPeers();
        if (this.role === 'host') {
          for (const p of this.players) {
            if (p.id !== this.myPlayerId) this.ensurePeer(p.id, true);
          }
        } else if (this.hostId) {
          this.ensurePeer(this.hostId, false);
          this.socket.emit('rtc:hello', { to: this.hostId });
        }
        if (!this.started) this.phaseValue = this.players.length > 1 ? 'connecting' : 'waiting';
        else this.phaseValue = 'connecting';
        this.error = null;
        this.emit();
      },
    );
  }

  private seatForId(id: string): Seat | null {
    for (const seat of SEAT_ORDER) {
      if (this.seats[seat] === id) return seat;
    }
    return null;
  }

  // ---- Mensajes ----

  private broadcast(msg: FourNetMsg): void {
    for (const peer of this.peers.values()) peer.send(msg);
  }

  private sendResync(peer: PeerSession): void {
    const moves = this.engine.history.map((h) => h.move);
    peer.send({ t: 'resync', seats: this.seats, moves, timeControl: this.timeControlValue } satisfies NetResync);
  }

  private handleNet(fromPeerId: string, msg: FourNetMsg): void {
    if (this.role === 'host' && msg.t !== 'resync') {
      for (const [id, peer] of this.peers) {
        if (id !== fromPeerId) peer.send(msg);
      }
    }
    this.process(msg);
  }

  private process(msg: FourNetMsg): void {
    switch (msg.t) {
      case 'start':
        this.seats = msg.seats;
        if (msg.timeControl) this.timeControlValue = msg.timeControl;
        this.mySeatValue = this.seatForId(this.myPlayerId);
        this.started = true;
        this.phaseValue = 'playing';
        break;
      case 'resync':
        this.seats = msg.seats;
        if (msg.timeControl) this.timeControlValue = msg.timeControl;
        this.engine.reset();
        for (const move of msg.moves) this.engine.makeMove(move);
        this.mySeatValue = this.seatForId(this.myPlayerId);
        this.started = true;
        this.phaseValue = 'playing';
        break;
      case 'move':
        if (!this.engine.result && msg.seat === this.engine.currentSeat()) {
          this.engine.makeMove(msg.move);
        }
        break;
      case 'resign':
        if (!this.engine.result) this.engine.resign(msg.seat);
        break;
      case 'abort':
        this.engine.cancel();
        break;
      case 'rematch':
        this.engine.reset();
        break;
      default:
        break;
    }
    this.emit();
  }

  // ---- Acciones ----

  makeMove(move: FMove): boolean {
    if (!this.started || !this.mySeatValue) return false;
    if (this.engine.currentSeat() !== this.mySeatValue) return false;
    const ok = this.engine.makeMove(move);
    if (ok) this.broadcast({ t: 'move', seat: this.mySeatValue, move });
    return ok;
  }

  resign(): void {
    if (!this.mySeatValue) return;
    this.engine.resign(this.mySeatValue);
    this.broadcast({ t: 'resign', seat: this.mySeatValue });
  }

  abort(): void {
    this.engine.cancel();
    this.broadcast({ t: 'abort' });
  }

  rematch(): void {
    this.engine.reset();
    this.broadcast({ t: 'rematch' });
  }

  leave(): void {
    this.left = true;
    clearSession(this.roomId);
    this.socket.emit('rooms:leave');
    this.socket.off('room:players', this.onPlayers);
    this.socket.off('rtc:signal', this.onSignal);
    this.socket.off('rtc:hello', this.onHello);
    this.socket.off('room:peer-left', this.onPeerLeft);
    this.socket.off('room:peer-disconnected', this.onPeerDisconnected);
    this.socket.off('room:peer-reconnected', this.onPeerReconnected);
    this.socket.off('connect', this.onSocketConnect);
    this.resetAllPeers();
    this.phaseValue = 'closed';
    this.emit();
  }
}
