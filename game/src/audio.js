// PORT SOLANO — audio.js
// Complete WebAudio sound engine for PORT SOLANO, a top-down 2D browser
// game. Every sound is synthesised with oscillators and noise buffers:
// no audio files, no samples, no imports.
//
// Design: one AudioContext created lazily by unlock() (browsers require a
// user gesture first), one master gain (muting lives there), persistent
// voices for the continuous sounds (engine hum, siren, music), and tiny
// throwaway node graphs for one-shots that disconnect themselves on
// `ended`, so the live node count stays bounded. Every public method
// no-ops safely before unlock() has run.

// Clamp into 0..1, defending against bad caller input.
function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Random detune factor in [1-amt, 1+amt]; stops repeated one-shots from
// sounding like the same sample stamped over and over.
function jitter(amt) { return 1 + (Math.random() * 2 - 1) * amt; }

// Music data — Am – F – C – G, one bar each, ~100 BPM. Each chord: a low
// bass root, a warm fifth, and chord tones for the sparse arp (A-minor
// pentatonic colour throughout).
const CHORDS = [
  { root: 55.0, fifth: 82.41, tones: [220.0, 261.63, 329.63, 440.0] }, // Am
  { root: 43.65, fifth: 65.41, tones: [174.61, 220.0, 261.63, 349.23] }, // F
  { root: 65.41, fifth: 98.0, tones: [261.63, 329.63, 392.0, 523.25] }, // C
  { root: 49.0, fifth: 73.42, tones: [196.0, 246.94, 293.66, 392.0] }, // G
];
const BASS_STEPS = new Set([0, 3, 6, 8, 11, 14]); // syncopated bass pulse
const ARP_STEPS = new Set([2, 7, 10, 15]); // deliberately sparse arp
const HAT_STEPS = new Set([2, 6, 10, 14]); // hats on off-beat eighths

export class AudioEngine {
  constructor() {
    // No AudioContext yet — unlock() creates it after a user gesture.
    this.ctx = null;
    this.master = null; // master gain -> destination
    this.musicGain = null; // music bus, kept at background level
    this.sfxGain = null; // SFX bus
    this._muted = false;
    this._unlocked = false;
    this._noiseBuf = null; // shared white-noise buffer, built in unlock()
    // Persistent engine-hum voice (built in _buildContinuousVoices):
    // sawtooth growl + square sub-oscillator one octave down.
    this._engOsc = null; this._engSub = null;
    this._engGain = null; this._engFilter = null;
    // Persistent siren voice (carrier + LFO sweeping its frequency).
    this._sirenOsc = null; this._sirenGain = null;
    this._sirenLfo = null; this._sirenLfoGain = null;
    // Music lookahead scheduler state.
    this._musicTimer = null;
    this._step = 0; // current 16th-note step, 0..63 (4 bars)
    this._nextNoteTime = 0;
    this._bpm = 100;
    this._stepDur = 60 / this._bpm / 4; // seconds per 16th note
    this._lastCrashAt = 0; // one-shot throttles (wall clock is fine)
    this._lastSkidAt = 0;
  }

  // Create the context and start the music. Safe to call repeatedly:
  // later calls only resume a suspended context (e.g. after tab switch).
  unlock() {
    if (this._unlocked && this.ctx) {
      try { if (this.ctx.state === 'suspended') this.ctx.resume(); } catch (err) { /* best-effort */ }
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // no WebAudio here: stay silent forever
      this.ctx = new AC();
    } catch (err) {
      this.ctx = null;
      return; // fail closed: all methods keep no-op'ing
    }
    const ctx = this.ctx;
    // Master chain: everything -> master -> speakers. Mute lives here.
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    // SFX bus at full level; music bus low (~0.16) so the track sits
    // under gameplay instead of fighting it.
    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = 1.0;
    this.sfxGain.connect(this.master);
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    this._buildNoiseBuffer();
    this._buildContinuousVoices();
    this._unlocked = true;
    this._startMusic();
    try { if (ctx.state === 'suspended') ctx.resume(); } catch (err) { /* ignore */ }
  }

  setMuted(m) {
    this._muted = !!m;
    if (this.ctx && this.master) {
      // Short ramp avoids a click when toggling mid-sound.
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this._muted ? 0 : 0.9, t, 0.02);
    }
  }

  toggleMute() { this.setMuted(!this._muted); return this._muted; }
  isMuted() { return this._muted; }

  // One second of white noise, shared by every noise voice.
  _buildNoiseBuffer() {
    const ctx = this.ctx;
    this._noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Engine hum + siren: created and started once; afterwards only their
  // frequency/gain parameters move (driven by update()).
  _buildContinuousVoices() {
    const ctx = this.ctx;
    // Engine: sawtooth growl + square sub through a lowpass that opens
    // with speed, so the car sounds like it is working harder.
    this._engGain = ctx.createGain();
    this._engGain.gain.value = 0;
    this._engFilter = ctx.createBiquadFilter();
    this._engFilter.type = 'lowpass'; this._engFilter.frequency.value = 420;
    this._engFilter.Q.value = 2;
    this._engFilter.connect(this._engGain);
    this._engGain.connect(this.sfxGain);
    this._engOsc = ctx.createOscillator();
    this._engOsc.type = 'sawtooth';
    this._engOsc.frequency.value = 55;
    this._engOsc.connect(this._engFilter);
    this._engOsc.start();
    this._engSub = ctx.createOscillator();
    this._engSub.type = 'square';
    this._engSub.frequency.value = 27.5;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5; // sub sits under the saw, never over it
    this._engSub.connect(subGain);
    subGain.connect(this._engFilter);
    this._engSub.start();
    // Siren: triangle carrier, LFO sweeping 650–1450 Hz (centre 1050,
    // depth 400) — the classic wail, one full sweep ≈ 4.5 s.
    this._sirenGain = ctx.createGain();
    this._sirenGain.gain.value = 0;
    this._sirenGain.connect(this.sfxGain);
    this._sirenOsc = ctx.createOscillator();
    this._sirenOsc.type = 'triangle';
    this._sirenOsc.frequency.value = 1050;
    this._sirenOsc.connect(this._sirenGain);
    this._sirenOsc.start();
    this._sirenLfo = ctx.createOscillator();
    this._sirenLfo.type = 'sine'; this._sirenLfo.frequency.value = 0.22;
    this._sirenLfoGain = ctx.createGain();
    this._sirenLfoGain.gain.value = 400;
    this._sirenLfo.connect(this._sirenLfoGain);
    this._sirenLfoGain.connect(this._sirenOsc.frequency);
    this._sirenLfo.start();
  }

  // Called every frame. opts.engine: 0..1 speed fraction, or null on
  // foot (hum off). opts.siren: police near. opts.sirenDist: 0..1
  // proximity of the nearest police car (1 = right on top of you).
  update(dt, opts) {
    if (!this.ctx || !this._unlocked) return;
    const o = opts || {};
    const t = this.ctx.currentTime;
    const tc = 0.06; // setTargetAtTime constant: glides over frame jitter
    // Engine hum: idle ~55 Hz, top ~180 Hz; gain swells with speed.
    if (o.engine === null || o.engine === undefined) {
      this._engGain.gain.setTargetAtTime(0, t, tc);
    } else {
      const e = clamp01(o.engine);
      const freq = 55 + e * 125;
      this._engOsc.frequency.setTargetAtTime(freq, t, tc);
      this._engSub.frequency.setTargetAtTime(freq / 2, t, tc);
      this._engFilter.frequency.setTargetAtTime(420 + e * 1400, t, tc);
      this._engGain.gain.setTargetAtTime(0.045 + e * 0.075, t, tc);
    }
    // Siren: gain follows proximity, only while police are near.
    const sirenLevel = o.siren ? clamp01(o.sirenDist) * 0.14 : 0;
    this._sirenGain.gain.setTargetAtTime(sirenLevel, t, 0.09);
  }

  // Short oscillator blip with an exponential decay envelope. The nodes
  // clean themselves up when the note ends.
  _blip({ type = 'sine', from = 440, to = null, dur = 0.1, vol = 0.2, at = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (err) { /* gone */ } };
  }

  // Burst of the shared noise buffer through a filter (optionally swept).
  _noiseBurst({ dur = 0.1, vol = 0.3, type = 'bandpass', freq = 1200, q = 0.8, at = 0, sweepTo = null }) {
    if (!this.ctx || !this._noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = jitter(0.08);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter); filter.connect(gain); gain.connect(this.sfxGain);
    src.start(t0, Math.random() * 0.5); // random offset into the buffer
    src.stop(t0 + dur + 0.02);
    src.onended = () => { try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch (err) { /* gone */ } };
  }

  // One clean melody note (jingles, pickups, heals).
  _note(freq, at, dur, vol = 0.18, type = 'triangle') { this._blip({ type, from: freq, dur, vol, at }); }

  // Gunfire. All kinds are a filtered noise crack layered with a square
  // blip body; they differ in size and weight. Slight random pitch each
  // shot. kind: 'pistol' | 'smg' | 'shotgun'.
  shot(kind) {
    if (!this.ctx) return;
    const pitch = jitter(0.12);
    if (kind === 'shotgun') { // big, long, low boom + deep body thump
      this._noiseBurst({ dur: 0.32, vol: 0.55, type: 'lowpass', freq: 900 * pitch, q: 0.4 });
      this._blip({ type: 'square', from: 160 * pitch, to: 45, dur: 0.22, vol: 0.32 });
    } else if (kind === 'smg') { // short, thin, fast crack
      this._noiseBurst({ dur: 0.06, vol: 0.3, type: 'bandpass', freq: 2100 * pitch, q: 0.7 });
      this._blip({ type: 'square', from: 720 * pitch, to: 240, dur: 0.05, vol: 0.14 });
    } else { // pistol (default): solid mid-weight crack
      this._noiseBurst({ dur: 0.12, vol: 0.42, type: 'bandpass', freq: 1500 * pitch, q: 0.6 });
      this._blip({ type: 'square', from: 480 * pitch, to: 130, dur: 0.09, vol: 0.22 });
    }
  }

  // Fist landing: sine dropping 160 -> 50 Hz in 0.08 s, plus a breath of
  // low noise for the impact transient.
  punch() {
    if (!this.ctx) return;
    this._blip({ type: 'sine', from: 160 * jitter(0.06), to: 50, dur: 0.08, vol: 0.4 }); this._noiseBurst({ dur: 0.04, vol: 0.1, type: 'lowpass', freq: 700 });
  }

  // Something got hit (not by a fist): a short, dull knock.
  hit() {
    if (!this.ctx) return;
    this._blip({ type: 'triangle', from: 220 * jitter(0.08), to: 90, dur: 0.07, vol: 0.3 }); this._noiseBurst({ dur: 0.05, vol: 0.16, type: 'bandpass', freq: 500, q: 1 });
  }

  // Crash scaled by intensity 0..1: metallic crunch collapsing downward
  // over a low boom. Throttled to one per 90 ms so a pile-up cannot
  // stack hundreds of nodes.
  crash(intensity) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this._lastCrashAt < 90) return;
    this._lastCrashAt = now;
    const k = clamp01(intensity);
    if (k <= 0.01) return;
    this._noiseBurst({ dur: 0.18 + k * 0.3, vol: 0.2 + k * 0.45, type: 'bandpass', freq: 2600, q: 0.5, sweepTo: 300 });
    this._blip({ type: 'sine', from: 120, to: 32, dur: 0.25 + k * 0.25, vol: 0.25 + k * 0.4 });
  }

  // Handbrake drift swish, throttled to one per 150 ms.
  skid() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this._lastSkidAt < 150) return;
    this._lastSkidAt = now;
    this._noiseBurst({ dur: 0.16, vol: 0.12, type: 'bandpass', freq: 900 * jitter(0.15), q: 2.5, sweepTo: 1600 });
  }

  // Car horn: two detuned square waves (~370 + ~440 Hz) for 0.25 s,
  // lowpassed so it honks rather than beeps.
  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 1800;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.015);
    gain.gain.setValueAtTime(0.16, t0 + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    filter.connect(gain); gain.connect(this.sfxGain);
    const oscs = [370, 440].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(filter); o.start(t0); o.stop(t0 + 0.27);
      return o;
    });
    oscs[1].onended = () => { try { oscs.forEach((o) => o.disconnect()); filter.disconnect(); gain.disconnect(); } catch (err) { /* gone */ } };
  }

  // Car door: a low thunk followed by a small metallic latch click.
  door() {
    if (!this.ctx) return;
    this._blip({ type: 'sine', from: 110, to: 45, dur: 0.09, vol: 0.35 }); this._noiseBurst({ dur: 0.05, vol: 0.18, type: 'lowpass', freq: 600 });
    this._blip({ type: 'square', from: 1800, to: 900, dur: 0.03, vol: 0.08, at: 0.07 });
  }

  // Coin pickup: two quick sine notes, 990 Hz then 1320 Hz.
  pickup() {
    if (!this.ctx) return;
    this._note(990, 0, 0.07, 0.2, 'sine'); this._note(1320, 0.07, 0.12, 0.2, 'sine');
  }

  // Cash: a slightly longer register-ish bright arpeggio blip.
  cash() {
    if (!this.ctx) return;
    [1318.5, 1568.0, 2093.0].forEach((f, i) => this._note(f, i * 0.055, 0.1, 0.16, 'sine')); // E6 G6 C7
    this._noiseBurst({ dur: 0.05, vol: 0.05, type: 'highpass', freq: 5000, at: 0 }); // till sparkle
  }

  // Heal: a soft, warm two-note rise — no sharp edges anywhere.
  heal() {
    if (!this.ctx) return;
    this._note(523.25, 0, 0.16, 0.16, 'sine'); this._note(783.99, 0.12, 0.24, 0.16, 'sine'); // C5 -> G5
  }

  // Mission jingle. Win: short happy 5-note melody. Fail: low descending
  // 3-note line. Notes are scheduled ahead, not chained by timers.
  jingle(win) {
    if (!this.ctx) return;
    if (win) {
      [523.25, 659.25, 783.99, 1046.5, 783.99].forEach((f, i) => this._note(f, i * 0.11, 0.16, 0.2, 'triangle')); // C E G C' G
    } else {
      [329.63, 261.63, 196.0].forEach((f, i) => this._note(f, i * 0.16, 0.22, 0.18, 'triangle')); // E C G, deflating
    }
  }

  // Tiny UI tick at 1200 Hz.
  uiClick() { if (this.ctx) this._blip({ type: 'sine', from: 1200, dur: 0.03, vol: 0.12 }); }

  // Music lookahead scheduler: a 100 ms interval scheduling every step
  // due in the next 200 ms. The interval only does bookkeeping; note
  // times are sample-accurate AudioContext times.
  _startMusic() {
    if (this._musicTimer !== null) return;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.06;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 100);
  }

  _scheduleMusic() {
    if (!this.ctx) return;
    while (this._nextNoteTime < this.ctx.currentTime + 0.2) {
      this._playStep(this._step, this._nextNoteTime);
      this._nextNoteTime += this._stepDur;
      this._step = (this._step + 1) % 64; // 4 bars of 16 steps, then loop
    }
  }

  // Render one 16th-note step of the loop at ctx-time `t`.
  _playStep(step, t) {
    const bar = Math.floor(step / 16); // 0..3 -> Am, F, C, G
    const inBar = step % 16;
    const chord = CHORDS[bar];
    const at = Math.max(0, t - this.ctx.currentTime);
    // Bassline: root on the pattern steps, fifth as the late-bar answer.
    if (BASS_STEPS.has(inBar)) {
      this._musicBlip({ from: inBar >= 11 ? chord.fifth : chord.root * 2, dur: 0.22, vol: 0.5, at, type: 'triangle' });
    }
    // Sparse arp: walk the chord tones with a slow deterministic pattern.
    if (ARP_STEPS.has(inBar)) {
      const idx = (bar + Math.floor(step / 8)) % chord.tones.length;
      this._musicBlip({ from: chord.tones[idx], dur: 0.18, vol: 0.16, at, type: 'sine' });
    }
    if (HAT_STEPS.has(inBar)) this._musicHat(at); // barely-there hat tick
  }

  // One music-bus note: same throwaway-node discipline as the SFX blips,
  // routed to the quiet music gain and timed by the scheduler.
  _musicBlip({ from, dur, vol, at, type }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = from;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(this.musicGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (err) { /* gone */ } };
  }

  // One hat tick: 40 ms of highpassed noise at scheduler offset `at`.
  _musicHat(at) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
    src.connect(filter); filter.connect(gain); gain.connect(this.musicGain);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + 0.06);
    src.onended = () => { try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch (err) { /* gone */ } };
  }
}
