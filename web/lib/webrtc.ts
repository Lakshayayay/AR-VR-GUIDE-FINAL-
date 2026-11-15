// Video call between the two browsers (WebRTC). The server only passes the set-up messages along.

// Every message carries the id of the offer it belongs to, so replies to an older offer
// (for example after a quick reload) are ignored instead of breaking the new connection.
export type Signal = { id: string } & (
  | { type: "offer" | "answer"; sdp: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
);

export interface Quality {
  level: "good" | "fair" | "poor";
  rttMs: number | null;
  lossPct: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  kbps: number | null;
}

/** A connection that sends set-up messages through `send`, and holds early network hints until ready. */
export function createPeer(opts: {
  id: string;
  iceServers: RTCIceServer[];
  local: MediaStream | null;
  send: (s: Signal) => void;
  onRemote: (stream: MediaStream) => void;
  onState: (state: RTCPeerConnectionState) => void;
}) {
  const { id } = opts;
  const pc = new RTCPeerConnection({ iceServers: opts.iceServers });
  const early: RTCIceCandidateInit[] = [];
  opts.local?.getTracks().forEach((t) => pc.addTrack(t, opts.local!));
  pc.onicecandidate = (e) => e.candidate && opts.send({ id, type: "candidate", candidate: e.candidate.toJSON() });
  pc.ontrack = (e) => opts.onRemote(e.streams[0] ?? new MediaStream([e.track]));
  pc.onconnectionstatechange = () => opts.onState(pc.connectionState);

  const flush = async () => {
    for (const c of early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  };

  return {
    id,
    pc,
    async offer() {
      await pc.setLocalDescription(await pc.createOffer());
      opts.send({ id, type: "offer", sdp: pc.localDescription!.sdp });
    },
    async receive(s: Signal) {
      if (s.id !== id) return;
      if (s.type === "candidate") {
        if (pc.remoteDescription) await pc.addIceCandidate(s.candidate).catch(() => {});
        else early.push(s.candidate);
        return;
      }
      await pc.setRemoteDescription({ type: s.type, sdp: s.sdp });
      await flush();
      if (s.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        opts.send({ id, type: "answer", sdp: pc.localDescription!.sdp });
      }
    },
    close() {
      pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null;
      pc.close();
    },
  };
}

export type Peer = ReturnType<typeof createPeer>;

/** Measures the live connection every 2 seconds: delay, loss, picture size and speed. */
export function watchQuality(pc: RTCPeerConnection, onQuality: (q: Quality) => void): () => void {
  let prev = { bytes: 0, lost: 0, recv: 0, time: 0 };
  const timer = setInterval(async () => {
    if (pc.connectionState !== "connected") return;
    const m = { rtt: null as number | null, fraction: null as number | null, lost: 0, recv: 0, bytes: 0,
      fps: null as number | null, width: null as number | null, height: null as number | null };
    (await pc.getStats()).forEach((s) => {
      if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded" && s.currentRoundTripTime != null) {
        m.rtt = s.currentRoundTripTime * 1000;
      }
      if (s.kind !== "video") return;
      if (s.type === "inbound-rtp" || s.type === "outbound-rtp") {
        m.fps = s.framesPerSecond ?? m.fps;
        m.width = s.frameWidth ?? m.width;
        m.height = s.frameHeight ?? m.height;
        m.bytes += (s.type === "inbound-rtp" ? s.bytesReceived : s.bytesSent) ?? 0;
      }
      if (s.type === "inbound-rtp") {
        m.lost += s.packetsLost ?? 0;
        m.recv += s.packetsReceived ?? 0;
      }
      if (s.type === "remote-inbound-rtp" && s.fractionLost != null) m.fraction = s.fractionLost;
    });
    const now = performance.now();
    const dLost = m.lost - prev.lost;
    const dRecv = m.recv - prev.recv;
    const kbps = prev.time && m.bytes >= prev.bytes ? Math.round(((m.bytes - prev.bytes) * 8) / (now - prev.time)) : null;
    const lossPct = dLost + dRecv > 0 ? (Math.max(0, dLost) / (dLost + dRecv)) * 100 : m.fraction !== null ? m.fraction * 100 : null;
    prev = { bytes: m.bytes, lost: m.lost, recv: m.recv, time: now };
    const r = m.rtt ?? 0;
    const l = lossPct ?? 0;
    onQuality({
      level: r < 200 && l < 2 ? "good" : r < 500 && l < 8 ? "fair" : "poor",
      rttMs: m.rtt === null ? null : Math.round(m.rtt),
      lossPct: lossPct === null ? null : Math.round(lossPct * 10) / 10,
      fps: m.fps === null ? null : Math.round(m.fps),
      width: m.width,
      height: m.height,
      kbps,
    });
  }, 2000);
  return () => clearInterval(timer);
}
