// Incoming-call ring made with the browser's sound engine: no sound file, works offline.
let ctx: AudioContext | null = null;

/** Browsers only allow sound after a click; call this from any click to prepare it. */
export function unlockAudio() {
  ctx ??= new AudioContext();
  void ctx.resume();
}

export function ringOnce() {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  [880, 660, 880, 660].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    const start = t + i * 0.22;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + 0.21);
  });
}
