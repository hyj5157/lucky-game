let audioCtx = null;
let soundEnabled = true;

function getCtx() {
  if (!soundEnabled) return null;
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function setSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled);
}

export function isSoundEnabled() {
  return soundEnabled;
}

export function unlockAudio() {
  getCtx();
}

function playTone({ freq, endFreq, type = "sine", duration = 0.12, gain = 0.16, delay = 0 }) {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq && endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
  }

  vol.gain.setValueAtTime(0.001, now);
  vol.gain.linearRampToValueAtTime(gain, now + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(vol);
  vol.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playTap() {
  playTone({ freq: 620, endFreq: 880, type: "sine", duration: 0.07, gain: 0.12 });
}

export function playMove() {
  playTone({ freq: 340, endFreq: 420, type: "triangle", duration: 0.045, gain: 0.07 });
}

export function playYourTurn() {
  playTone({ freq: 523.25, type: "triangle", duration: 0.12, gain: 0.15, delay: 0 });
  playTone({ freq: 659.25, type: "triangle", duration: 0.12, gain: 0.15, delay: 0.09 });
  playTone({ freq: 783.99, type: "triangle", duration: 0.22, gain: 0.18, delay: 0.18 });
}

export function playStart() {
  const notes = [523.25, 587.33, 659.25, 783.99, 1046.5];
  notes.forEach((n, i) => {
    playTone({ freq: n, type: "triangle", duration: 0.14, gain: 0.15, delay: i * 0.07 });
  });
}

export function playGrabStart() {
  playTone({ freq: 520, endFreq: 220, type: "sine", duration: 0.26, gain: 0.14, delay: 0 });
  playTone({ freq: 280, endFreq: 380, type: "triangle", duration: 0.1, gain: 0.12, delay: 0.28 });
}

export function playGrabBounce() {
  playTone({ freq: 300, endFreq: 540, type: "sine", duration: 0.14, gain: 0.16, delay: 0 });
}

export function playWin() {
  const melody = [
    { f: 523.25, d: 0.11, t: 0 },
    { f: 659.25, d: 0.11, t: 0.09 },
    { f: 783.99, d: 0.11, t: 0.18 },
    { f: 1046.5, d: 0.34, t: 0.27 },
    { f: 783.99, d: 0.1, t: 0.44 },
    { f: 1046.5, d: 0.45, t: 0.54 },
  ];
  melody.forEach((m) => {
    playTone({ freq: m.f, type: "triangle", duration: m.d, gain: 0.2, delay: m.t });
    playTone({ freq: m.f * 2, type: "sine", duration: m.d * 0.8, gain: 0.07, delay: m.t });
  });
}

export function playLose() {
  playTone({ freq: 440, endFreq: 370, type: "triangle", duration: 0.16, gain: 0.14, delay: 0 });
  playTone({ freq: 349.23, endFreq: 261.63, type: "sine", duration: 0.28, gain: 0.14, delay: 0.16 });
}
