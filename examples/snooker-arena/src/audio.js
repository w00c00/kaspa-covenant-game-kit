class GameAudio {
  constructor() {
    this.context = null;
    this.lastCollisionAt = 0;
    this.muted = false;
  }

  setMuted(muted) { this.muted = Boolean(muted); }

  unlock() {
    if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  tone({ frequency = 180, duration = 0.08, gain = 0.12, type = "sine", endFrequency = frequency }) {
    if (this.muted) return;
    const context = this.unlock();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    volume.gain.setValueAtTime(gain, now);
    volume.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  strike(power = 35) {
    this.tone({ frequency: 155 + power * 0.9, endFrequency: 75, duration: 0.075, gain: 0.07 + power / 900, type: "triangle" });
  }

  collision(impulse = 1) {
    const now = performance.now();
    if (now - this.lastCollisionAt < 28 || impulse < 0.35) return;
    this.lastCollisionAt = now;
    this.tone({ frequency: 520 + Math.min(500, impulse * 34), endFrequency: 260, duration: 0.035, gain: Math.min(0.12, 0.025 + impulse / 160), type: "sine" });
  }

  pocket() {
    this.tone({ frequency: 125, endFrequency: 42, duration: 0.2, gain: 0.17, type: "triangle" });
  }

  foul() {
    this.tone({ frequency: 220, endFrequency: 110, duration: 0.22, gain: 0.09, type: "sawtooth" });
  }

  ready() {
    this.tone({ frequency: 440, endFrequency: 660, duration: 0.13, gain: 0.07, type: "sine" });
  }
}

export const gameAudio = new GameAudio();
