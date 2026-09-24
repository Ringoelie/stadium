// Procedural crowd ambience (WebAudio): filtered noise bed + chant pulses + goal roar.
export class CrowdAudio {
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 700; lp.Q.value = 0.6;
    this.gain = ctx.createGain(); this.gain.gain.value = 0.25;
    // "chant" pulses at ~1.9 Hz like the barras
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1.9;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(this.gain.gain);
    src.connect(lp).connect(this.gain).connect(ctx.destination);
    src.start(); lfo.start();
  }
  roar() {
    if (!this.ctx) return;
    const g = this.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1.0, t + 0.4); g.linearRampToValueAtTime(0.25, t + 5);
  }
}
