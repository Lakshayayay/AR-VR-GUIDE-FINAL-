// Sounds made with the browser's sound engine: no sound files, works offline.
let ctx: AudioContext | null = null;

/** Browsers only allow sound after a click; call this from any click to prepare it. */
export function unlockAudio() {
  ctx ??= new AudioContext();
  void ctx.resume();
}

function tones(freqs: number[], gap: number, length: number, volume: number) {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  freqs.forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    const start = t + i * gap;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + length + 0.01);
  });
}

export const ringOnce = () => tones([880, 660, 880, 660], 0.22, 0.2, 0.18);

/** Short cues for hands-free drawing, for a technician who cannot see the screen. */
export function cue(kind: "start" | "end" | "undo" | "clear" | "erase-ready" | "warning") {
  const sounds = { start: [1320], end: [660], undo: [990, 990], clear: [990, 990, 990], "erase-ready": [880, 1320], warning: [440, 440] };
  tones(sounds[kind], 0.12, 0.06, 0.25);
}
