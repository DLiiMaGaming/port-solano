// PORT SOLANO — audio.js
// Complete WebAudio sound engine for PORT SOLANO, a top-down 2D browser
// game. Every sound is synthesised with oscillators and noise buffers:
// no audio files, no samples, no imports. The music is a 3-station
// synth radio (Bajo Profundo / Radio Bahía / Marea Chill): each station
// is its own generated loop, switchable at any time via the radio API.
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

// Music data — a 3-station synth radio. Every station is a 64-step loop
// (4 bars of 16 steps) with its own tempo, chords and step patterns, so
// the lookahead scheduler below just reads whichever station is tuned
// in. Each chord: a low bass root, a warm fifth, and chord tones for the
// sparse arp / pad. Step sets are positions within a bar (0..15); the
// bass plays the root, answered by the fifth on steps >= 11.
const STATIONS = [
  {
    // Bajo Profundo — bass-heavy and dark: slow minor-key churn, a dense
    // sub-octave bassline, a whisper of arp, almost no hats.
    name: 'Bajo Profundo',
    bpm: 92,
    chords: [
      { root: 55.0, fifth: 82.41, tones: [220.0, 261.63, 329.63, 440.0] }, // Am
      { root: 55.0, fifth: 82.41, tones: [220.0, 261.63, 329.63, 440.0] }, // Am
      { root: 43.65, fifth: 65.41, tones: [174.61, 220.0, 261.63, 349.23] }, // F
      { root: 41.2, fifth: 61.74, tones: [164.81, 246.94, 329.63, 415.3] }, // E
    ],
    bassSteps: new Set([0, 2, 3, 6, 8, 10, 11, 14]), // dense, root-heavy pulse
    bassType: 'sine', bassVol: 0.55, bassDur: 0.3, bassRootMul: 1, // sub octave
    arpSteps: new Set([5, 12]), // sparse and dark
    arpType: 'sine', arpVol: 0.11, arpDur: 0.25,
    hatSteps: new Set([14]), hatVol: 0.05, // one faint tick per bar
    pad: false, padType: 'triangle', padVol: 0,
  },
  {
    // Radio Bahía — the original v1 loop, unchanged in character:
    // Am – F – C – G at 100 BPM, syncopated bass, sparse arp, off-beat
    // hats. This is the default station at boot (see DEFAULT_STATION).
    name: 'Radio Bahía',
    bpm: 100,
    chords: [
      { root: 55.0, fifth: 82.41, tones: [220.0, 261.63, 329.63, 440.0] }, // Am
      { root: 43.65, fifth: 65.41, tones: [174.61, 220.0, 261.63, 349.23] }, // F
      { root: 65.41, fifth: 98.0, tones: [261.63, 329.63, 392.0, 523.25] }, // C
      { root: 49.0, fifth: 73.42, tones: [196.0, 246.94, 293.66, 392.0] }, // G
    ],
    bassSteps: new Set([0, 3, 6, 8, 11, 14]), // syncopated bass pulse
    bassType: 'triangle', bassVol: 0.5, bassDur: 0.22, bassRootMul: 2,
    arpSteps: new Set([2, 7, 10, 15]), // deliberately sparse arp
    arpType: 'sine', arpVol: 0.16, arpDur: 0.18,
    hatSteps: new Set([2, 6, 10, 14]), hatVol: 0.12, // hats on off-beat eighths
    pad: false, padType: 'triangle', padVol: 0,
  },
  {
    // Marea Chill — slow and warm: major-7 chords, a long soft pad at
    // every bar start, barely-there bass, no hats at all.
    name: 'Marea Chill',
    bpm: 76,
    chords: [
      { root: 65.41, fifth: 98.0, tones: [261.63, 329.63, 392.0, 493.88] }, // Cmaj7
      { root: 55.0, fifth: 82.41, tones: [220.0, 261.63, 329.63, 392.0] }, // Am7
      { root: 43.65, fifth: 65.41, tones: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
      { root: 49.0, fifth: 73.42, tones: [196.0, 246.94, 293.66, 392.0] }, // G
    ],
    bassSteps: new Set([0, 8]), // two soft anchors per bar
    bassType: 'sine', bassVol: 0.32, bassDur: 0.6, bassRootMul: 2,
    arpSteps: new Set([6, 14]), // gentle, far apart
    arpType: 'sine', arpVol: 0.07, arpDur: 0.4,
    hatSteps: new Set(), hatVol: 0, // no hats
    pad: true, padType: 'triangle', padVol: 0.05,
  },
];
const DEFAULT_STATION = 1; // Radio Bahía: preserves the v1 sound at boot

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
    // Persistent rain voice (looping noise -> lowpass -> gain parked at
    // 0, raised by update() when opts.rain says it is raining).
    this._rainSrc = null; this._rainFilter = null; this._rainGain = null;
    // Music lookahead scheduler state.
    this._musicTimer = null;
    this._step = 0; // current 16th-note step, 0..63 (4 bars)
    this._nextNoteTime = 0;
    this._station = DEFAULT_STATION; // index into STATIONS
    this._bpm = STATIONS[this._station].bpm;
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

  // --- Radio ---------------------------------------------------------
  // Station switching is pure state plus a scheduler reset, so it is
  // safe before unlock(): the chosen station simply takes effect when
  // the music starts (or on its next downbeat, if already playing).

  stationIndex() { return this._station; }
  stationName() { return STATIONS[this._station].name; }

  // Tune to station i, wrapping modulo the station count. Switching
  // recomputes the step duration from the new station's BPM and resets
  // the scheduler to step 0, so the new loop starts cleanly on its
  // downbeat instead of landing mid-bar.
  setStation(i) {
    if (typeof i !== 'number' || Number.isNaN(i)) return;
    const n = STATIONS.length;
    const idx = ((Math.trunc(i) % n) + n) % n; // wraps negatives too
    if (idx === this._station) return; // already tuned: no-op
    this._station = idx;
    this._bpm = STATIONS[idx].bpm;
    this._stepDur = 60 / this._bpm / 4;
    this._step = 0;
    if (this.ctx) this._nextNoteTime = this.ctx.currentTime + 0.06;
  }

  nextStation() { this.setStation(this._station + 1); return this.stationName(); }
  prevStation() { this.setStation(this._station - 1); return this.stationName(); }

  // One second of white noise, shared by every noise voice.
  _buildNoiseBuffer() {
    const ctx = this.ctx;
    this._noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // Engine hum + siren + rain: created and started once; afterwards
  // only their frequency/gain parameters move (driven by update()).
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
    // Rain: the shared noise buffer looped through a lowpass (~900 Hz)
    // into a gain parked at 0. update() raises the gain with opts.rain;
    // the voice itself never changes shape, so no per-frame allocation.
    this._rainFilter = ctx.createBiquadFilter();
    this._rainFilter.type = 'lowpass'; this._rainFilter.frequency.value = 900;
    this._rainGain = ctx.createGain();
    this._rainGain.gain.value = 0;
    this._rainSrc = ctx.createBufferSource();
    this._rainSrc.buffer = this._noiseBuf;
    this._rainSrc.loop = true;
    this._rainSrc.connect(this._rainFilter);
    this._rainFilter.connect(this._rainGain);
    this._rainGain.connect(this.sfxGain);
    this._rainSrc.start();
  }

  // Called every frame. opts.engine: 0..1 speed fraction, or null on
  // foot (hum off). opts.siren: police near. opts.sirenDist: 0..1
  // proximity of the nearest police car (1 = right on top of you).
  // opts.rain: 0..1 rainfall amount (0 or absent = dry).
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
    // Rain: steady filtered noise under everything, loudness follows
    // the rainfall amount.
    if (this._rainGain) {
      this._rainGain.gain.setTargetAtTime(clamp01(o.rain) * 0.055, t, tc);
    }
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

  // Render one 16th-note step of the tuned station's loop at ctx-time
  // `t`. All patterns, waveforms and levels come from the station, so
  // this one player renders every station.
  _playStep(step, t) {
    const st = STATIONS[this._station];
    const bar = Math.floor(step / 16); // 0..3 -> the station's chord bars
    const inBar = step % 16;
    const chord = st.chords[bar];
    const at = Math.max(0, t - this.ctx.currentTime);
    // Bassline: root on the pattern steps, fifth as the late-bar answer.
    if (st.bassSteps.has(inBar)) {
      this._musicBlip({ from: inBar >= 11 ? chord.fifth : chord.root * st.bassRootMul, dur: st.bassDur, vol: st.bassVol, at, type: st.bassType });
    }
    // Sparse arp: walk the chord tones with a slow deterministic pattern.
    if (st.arpSteps.has(inBar)) {
      const idx = (bar + Math.floor(step / 8)) % chord.tones.length;
      this._musicBlip({ from: chord.tones[idx], dur: st.arpDur, vol: st.arpVol, at, type: st.arpType });
    }
    // Pad (chill stations): at each bar start, lay the chord's first and
    // third tones down as one long, soft swell under the whole bar.
    if (st.pad && inBar === 0) {
      const padDur = this._stepDur * 16 * 0.95; // just under a full bar
      this._musicBlip({ from: chord.tones[0], dur: padDur, vol: st.padVol, at, type: st.padType });
      this._musicBlip({ from: chord.tones[2], dur: padDur, vol: st.padVol, at, type: st.padType });
    }
    if (st.hatSteps.has(inBar)) this._musicHat(at, st.hatVol); // barely-there hat tick
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

  // One hat tick: 40 ms of highpassed noise at scheduler offset `at`,
  // at the station's hat level (0.12 for Radio Bahía, fainter elsewhere).
  _musicHat(at, vol = 0.12) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
    src.connect(filter); filter.connect(gain); gain.connect(this.musicGain);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + 0.06);
    src.onended = () => { try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch (err) { /* gone */ } };
  }
}
