import type { RtcSignal } from '@shared/protocol';

export type PeerCallbackMap = {
  onOpen: () => void;
  onMessage: (msg: any) => void;
  onClose: () => void;
  onStateChange: (state: RTCPeerConnectionState) => void;
};

const ICE_SERVERS: RTCIceServer[] = (() => {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const env = import.meta.env;
  if (env.VITE_TURN_URL) {
    servers.push({
      urls: env.VITE_TURN_URL,
      username: env.VITE_TURN_USER,
      credential: env.VITE_TURN_CRED,
    });
  } else {
    // TURN publico de respaldo (OpenRelay/Metered) para conectar tras NAT estricto.
    // Si configuras VITE_TURN_* en client/.env, estos se omiten.
    const user = 'openrelayproject';
    const cred = 'openrelayproject';
    servers.push(
      { urls: 'turn:openrelay.metered.ca:80', username: user, credential: cred },
      { urls: 'turn:openrelay.metered.ca:443', username: user, credential: cred },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: user, credential: cred },
    );
  }
  return servers;
})();

/**
 * Envuelve una RTCPeerConnection + DataChannel.
 * El anfitrion es el "initiator" y crea el canal; el invitado lo recibe.
 */
export class PeerSession {
  readonly pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private readonly cb: PeerCallbackMap;
  private readonly sendSignal: (data: RtcSignal) => void;

  constructor(
    initiator: boolean,
    cb: PeerCallbackMap,
    sendSignal: (data: RtcSignal) => void,
  ) {
    this.cb = cb;
    this.sendSignal = sendSignal;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ kind: 'ice', candidate: event.candidate.toJSON() });
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onStateChange(this.pc.connectionState);
      // 'disconnected' suele ser transitorio (se recupera); solo 'failed'/'closed' son fatales.
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.cb.onClose();
      }
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel('chess', { ordered: true });
      this.bindDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.bindDataChannel(this.dc);
      };
    }
  }

  private bindDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => this.cb.onOpen();
    dc.onclose = () => this.cb.onClose();
    dc.onmessage = (event) => {
      try {
        this.cb.onMessage(JSON.parse(event.data));
      } catch {
        /* mensaje no valido, se ignora */
      }
    };
  }

  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ kind: 'offer', sdp: offer });
  }

  async handleSignal(signal: RtcSignal): Promise<void> {
    if (this.closed) return;
    try {
      if (signal.kind === 'offer') {
        await this.pc.setRemoteDescription(signal.sdp);
        await this.flushIce();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignal({ kind: 'answer', sdp: answer });
      } else if (signal.kind === 'answer') {
        await this.pc.setRemoteDescription(signal.sdp);
        await this.flushIce();
      } else if (signal.kind === 'ice') {
        if (this.pc.remoteDescription?.type) {
          await this.pc.addIceCandidate(signal.candidate);
        } else {
          this.pendingIce.push(signal.candidate);
        }
      }
    } catch (err) {
      console.warn('[peer] error de senalizacion', err);
    }
  }

  private async flushIce(): Promise<void> {
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        /* candidato tardio, se ignora */
      }
    }
  }

  send(msg: unknown): boolean {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  get isOpen(): boolean {
    return this.dc?.readyState === 'open';
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  get iceState(): RTCIceConnectionState {
    return this.pc.iceConnectionState;
  }

  close(): void {
    this.closed = true;
    try {
      this.dc?.close();
    } catch {
      /* noop */
    }
    try {
      this.pc.close();
    } catch {
      /* noop */
    }
  }
}
