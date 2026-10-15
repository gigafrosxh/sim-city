import { Injectable } from '@angular/core';

export type SoundName = 'build' | 'bulldoze' | 'coin' | 'alert' | 'click' | 'error';

/** Tiny WebAudio synthesiser for UI sound effects; no audio files needed. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private ctx: AudioContext | null = null;
  private lastPlayed = new Map<SoundName, number>();

  play(name: SoundName): void {
    // Avoid machine-gun repeats (e.g. several fires at once).
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? 0) < 120) return;
    this.lastPlayed.set(name, now);
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      return;
    }
    const c = this.ctx;
    const t = c.currentTime;
    switch (name) {
      case 'build':
        this.tone(c, t, 520, 0.06, 'square', 0.05);
        this.tone(c, t + 0.05, 780, 0.08, 'square', 0.04);
        break;
      case 'click':
        this.tone(c, t, 900, 0.03, 'triangle', 0.04);
        break;
      case 'bulldoze':
        this.noise(c, t, 0.25, 0.08);
        this.tone(c, t, 90, 0.25, 'sawtooth', 0.05);
        break;
      case 'coin':
        this.tone(c, t, 988, 0.08, 'square', 0.05);
        this.tone(c, t + 0.08, 1319, 0.25, 'square', 0.05);
        break;
      case 'alert':
        this.tone(c, t, 660, 0.15, 'sawtooth', 0.04);
        this.tone(c, t + 0.18, 440, 0.2, 'sawtooth', 0.04);
        break;
      case 'error':
        this.tone(c, t, 180, 0.15, 'square', 0.05);
        break;
    }
  }

  private tone(c: AudioContext, start: number, freq: number, dur: number, type: OscillatorType, vol: number): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  private noise(c: AudioContext, start: number, dur: number, vol: number): void {
    const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buffer;
    gain.gain.value = vol;
    src.connect(gain).connect(c.destination);
    src.start(start);
  }
}
