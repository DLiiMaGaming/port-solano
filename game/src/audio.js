// audio.js — Synthesized audio engine for Port Solano
// Vanilla JS ES module, zero assets, all sound synthesized with WebAudio.
// Headless-safe: in Node (no window / no AudioContext) returns a stub
// with the same API and working station state.

const STATION_NAMES = ['Bajo Profundo', 'Radio Bahía', 'Marea Chill'];
const STATION_BPM = [92, 100, 76];

// MIDI note -> frequency (Hz)
function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function clamp(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}
function normStation(i) {
  const n = Math.trunc(Number(i) || 0);
  return ((n % 3) + 3) % 3;
}

export function createAudio() {
  // ---- Station / mute state (shared by stub and real paths) ----
  let station = 1; // Radio Bahía is the default station
  let isMuted = false;

  const hasWindow = typeof window !== 'undefined';
  const AC = hasWindow
    ? (window.AudioContext || window.webkitAudioContext)
    : undefined;

  // ================= STUB PATH =================
  if (!hasWindow || typeof AC !== 'function') {
    return {
      unlock() {},
      get available() { return false; },
      setMuted(m) { isMuted = !!m; },
      toggleMute() { isMuted = !isMuted; return isMuted; },
      get muted() { return isMuted; },
      setStation(i) { station = normStation(i); return STATION_NAMES[station]; },
      stationIndex() { return station; },
      stationName() { return STATION_NAMES[station]; },
      update(_dt, _env) {},
      sfx(_name, _opts) {},
      dispose() {},
    };
  }

  // ================= REAL PATH =================
  let ctx = null;
  let master = null;       // GainNode -> compressor -> destination
  let compressor = null;
  let musicBus = null;     // GainNode for sequenced radio music
  let sfxBus = null;       // GainNode for one-shots
  let noiseBuffer = null;

  // Continuous voices
  let engineOsc = null, engineSub = null, engineFilter = null, engineGain = null;
  let sirenOsc = null, sirenLfo = null, sirenLfoGain = null, sirenGain = null;
  let rainSrc = null, rainFilter = null, rainGain = null;

  // Sequencer state
  let seqTimer = null;
  let seqStep = 0;         // 0..15 within a bar
  let seqBar = 0;          // increments each bar; chord = seqBar % 4
  let nextNoteTime = 0;

  // Last environment seen via update()
  let envState = {
    inVehicle: false, engineLoad: 0, engineRpm: 0,
    siren: 0, raining: false, radioAudible: false,
  };
  let radioFadeTarget = 0;

  let activeOneShots = 0;
  const MAX_ONE_SHOTS = 24;

  // ---------- helpers ----------
  function makeNoiseBuffer() {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function pannerFor(pan) {
    if (!pan || typeof ctx.createStereoPanner !== 'function') return null;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return p;
  }

  // Connect a node chain end to a destination, inserting a panner if asked.
  function out(node, dest, pan) {
    const p = pannerFor(pan);
    if (p) { node.connect(p); p.connect(dest); }
    else node.connect(dest);
  }

  function applyMasterMute() {
    if (!master || !ctx) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(isMuted ? 0 : 0.9, t, 0.03);
  }

  // ---------- continuous voices ----------
  function startEngine() {
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineSub = ctx.createOscillator();
    engineSub.type = 'square';
    engineSub.frequency.value = 27.5;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineFilter.Q.value = 2;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    engineOsc.connect(engineFilter);
    engineSub.connect(subGain);
    subGain.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineSub.start();
  }

  function startSiren() {
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 800;
    sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 0.55; // slow wail sweep
    sirenLfoGain = ctx.createGain();
    sirenLfoGain.gain.value = 150;   // 800 ± 150 => ~650..950 Hz
    sirenLfo.connect(sirenLfoGain);
    sirenLfoGain.connect(sirenOsc.frequency);
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    sirenLfo.start();
  }

  function startRain() {
    rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer;
    rainSrc.loop = true;
    rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1200;
    rainFilter.Q.value = 0.6;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    rainSrc.start();
  }

  // ---------- music instruments (all route to musicBus) ----------
  function playKick(t, vol = 0.9) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + 0.18);
  }

  function playHat(t, vol = 0.12, dur = 0.04) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 1.5;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(t, Math.random() * 1.2); src.stop(t + dur + 0.02);
  }

  function playShaker(t, vol = 0.05) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 5500; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(t, Math.random() * 1.2); src.stop(t + 0.09);
  }

  function playSub(midi, t, dur = 0.28, vol = 0.5) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function playBassNote(midi, t, dur = 0.22, vol = 0.22) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function playPluck(midi, t, vol = 0.18) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + 0.3);
    // faint octave sparkle
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = mtof(midi) * 2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o2.connect(g2); g2.connect(musicBus);
    o2.start(t); o2.stop(t + 0.14);
  }

  function playPad(midis, t, dur, vol = 0.07) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.8, dur * 0.35));
    g.gain.setValueAtTime(vol, t + Math.max(0, dur - 0.6));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(musicBus);
    for (const m of midis) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  function playVinylTick(t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.012, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(t, Math.random() * 1.8); src.stop(t + 0.03);
  }

  // ---------- sequencer ----------
  // Chord progressions (MIDI roots / tones), one chord per bar, 4-bar loop.
  const PROG_BASS0 = [33, 33, 29, 28];            // Am Am F E (sub roots)
  const PROG_ROOT1 = [45, 41, 48, 43];            // Am F C G (bass roots)
  const MELODY1 = [                                // pluck lines per chord
    [69, 72, 76, 72],  // Am: A C E C
    [69, 65, 69, 72],  // F:  A F A C
    [67, 72, 76, 79],  // C:  G C E G
    [71, 74, 79, 74],  // G:  B D G D
  ];
  const PADS2 = [
    [48, 52, 55, 59],  // Cmaj7: C E G B
    [45, 48, 52, 55],  // Am7:   A C E G
    [41, 45, 48, 52],  // Fmaj7: F A C E
    [43, 47, 50, 53],  // G:     G B D F
  ];
  const BASS_PATTERN0 = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];

  function scheduleStep(step, bar, t) {
    const chord = bar % 4;
    if (station === 0) {
      // Bajo Profundo — 92 BPM, sub-bass heavy, sparse kick + hats
      if (step % 4 === 0) playKick(t, 0.85);
      if (step % 4 === 2) playHat(t, 0.1);
      if (BASS_PATTERN0[step]) {
        const root = PROG_BASS0[chord];
        playSub(root, t, 0.3, 0.55);
        if (step === 8) playSub(root + 12, t, 0.18, 0.2);
      }
    } else if (station === 1) {
      // Radio Bahía — 100 BPM, melodic pluck over Am–F–C–G
      if (step % 4 === 0) playKick(t, 0.6);
      if (step === 4 || step === 12) playHat(t, 0.14, 0.05);
      if (step % 2 === 0) playShaker(t, step % 4 === 0 ? 0.06 : 0.035);
      if (step === 0 || step === 8) playBassNote(PROG_ROOT1[chord], t, 0.3, 0.24);
      if (step === 10) playBassNote(PROG_ROOT1[chord] + 7, t, 0.18, 0.14);
      if (step % 2 === 0) {
        const line = MELODY1[chord];
        playPluck(line[(step / 2) % 4], t, 0.16);
      }
      if (step === 14) playPluck(MELODY1[chord][0] + 12, t, 0.1);
    } else {
      // Marea Chill — 76 BPM, pads only, no drums
      const spb = 60 / STATION_BPM[2]; // seconds per beat
      if (step === 0) playPad(PADS2[chord].map((m) => m + 12), t, spb * 4 + 0.15, 0.055);
      // sparse vinyl crackle
      if (step % 3 === 0 && Math.random() < 0.6) playVinylTick(t + Math.random() * 0.08);
    }
  }

  function sequencerTick() {
    if (!ctx) return;
    const bpm = STATION_BPM[station];
    const stepDur = 60 / bpm / 4; // 16th notes
    while (nextNoteTime < ctx.currentTime + 0.12) {
      scheduleStep(seqStep, seqBar, nextNoteTime);
      nextNoteTime += stepDur;
      seqStep += 1;
      if (seqStep >= 16) { seqStep = 0; seqBar += 1; }
    }
  }

  function startSequencer() {
    if (seqTimer !== null) return;
    seqStep = 0;
    seqBar = 0;
    nextNoteTime = ctx.currentTime + 0.06;
    seqTimer = setInterval(sequencerTick, 25);
  }

  // ---------- lifecycle ----------
  function unlock() {
    if (!ctx) {
      try {
        ctx = new AC();
      } catch (_e) {
        ctx = null;
        return;
      }
      master = ctx.createGain();
      master.gain.value = isMuted ? 0 : 0.9;
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 24;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;
      master.connect(compressor);
      compressor.connect(ctx.destination);

      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(master);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);

      noiseBuffer = makeNoiseBuffer();
      startEngine();
      startSiren();
      startRain();
      startSequencer();
    }
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  function dispose() {
    if (seqTimer !== null) { clearInterval(seqTimer); seqTimer = null; }
    if (ctx) {
      const c = ctx;
      ctx = null;
      master = compressor = musicBus = sfxBus = null;
      engineOsc = engineSub = engineFilter = engineGain = null;
      sirenOsc = sirenLfo = sirenLfoGain = sirenGain = null;
      rainSrc = rainFilter = rainGain = null;
      noiseBuffer = null;
      activeOneShots = 0;
      if (typeof c.close === 'function') {
        const p = c.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    }
  }

  // ---------- continuous update ----------
  function update(dt, env) {
    if (env && typeof env === 'object') {
      envState = {
        inVehicle: !!env.inVehicle,
        engineLoad: clamp(env.engineLoad, 0, 1),
        engineRpm: clamp(env.engineRpm, 0, 1),
        siren: clamp(env.siren, 0, 1),
        raining: !!env.raining,
        radioAudible: !!env.radioAudible,
      };
    }
    if (!ctx) return;
    const t = ctx.currentTime;
    const tc = 0.08; // smoothing time constant

    // Engine
    if (engineGain && engineOsc && engineSub && engineFilter) {
      if (envState.inVehicle) {
        const rpm = envState.engineRpm;
        const load = envState.engineLoad;
        const freq = 48 + rpm * 175 + load * 18;
        engineOsc.frequency.setTargetAtTime(freq, t, tc);
        engineSub.frequency.setTargetAtTime(freq * 0.5, t, tc);
        engineFilter.frequency.setTargetAtTime(260 + rpm * 950 + load * 350, t, tc);
        engineGain.gain.setTargetAtTime(0.045 + load * 0.075 + rpm * 0.02, t, tc);
      } else {
        engineGain.gain.setTargetAtTime(0, t, tc);
      }
    }

    // Siren
    if (sirenGain) {
      sirenGain.gain.setTargetAtTime(envState.siren * 0.15, t, 0.05);
    }

    // Rain
    if (rainGain) {
      rainGain.gain.setTargetAtTime(envState.raining ? 0.055 : 0, t, 0.4);
    }

    // Radio music audibility (fade in/out)
    if (musicBus) {
      const target = envState.radioAudible ? 0.85 : 0;
      if (target !== radioFadeTarget) {
        radioFadeTarget = target;
        musicBus.gain.setTargetAtTime(target, t, target > 0 ? 0.25 : 0.18);
      }
    }
    void dt;
  }

  // ---------- one-shot SFX ----------
  // Small builders; each returns the last node before the output gain.
  function toneOsc(type, freq) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  function playTone({ type = 'sine', f0 = 440, f1 = null, t, dur = 0.15, vol = 0.2, pan = 0, curve = 'exp' }) {
    const o = toneOsc(type, f0);
    if (f1 !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    out(g, sfxBus, pan);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  function playNoise({ t, dur = 0.15, vol = 0.3, pan = 0, type = 'lowpass', freq = 1200, q = 0.7, f1 = null, attack = 0.002 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0011, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g);
    out(g, sfxBus, pan);
    src.start(t, Math.random() * 1.4); src.stop(t + dur + 0.02);
    return src;
  }

  function playThump({ t, f0 = 120, f1 = 40, dur = 0.18, vol = 0.4, pan = 0 }) {
    return playTone({ type: 'sine', f0, f1, t, dur, vol, pan });
  }

  function shot(t, pan, vol, { blipFreq, blipDur, noiseDur, noiseFreq, thumpVol }) {
    playNoise({ t, dur: noiseDur, vol: vol * 0.9, pan, type: 'lowpass', freq: noiseFreq, f1: 300 });
    playTone({ type: 'square', f0: blipFreq, f1: blipFreq * 0.4, t, dur: blipDur, vol: vol * 0.35, pan });
    if (thumpVol > 0) playThump({ t, f0: 130, f1: 38, dur: noiseDur + 0.06, vol: vol * thumpVol, pan });
  }

  function sfx(name, opts) {
    if (!ctx || !sfxBus || !noiseBuffer) return;
    if (activeOneShots >= MAX_ONE_SHOTS) return;
    const o = opts || {};
    const pan = clamp(o.pan, -1, 1);
    const vol = o.vol === undefined ? 1 : clamp(o.vol, 0, 1);
    const rate = o.rate && Number.isFinite(o.rate) && o.rate > 0 ? o.rate : 1;
    const t = ctx.currentTime + 0.001;

    activeOneShots += 1;
    // Release the slot shortly after the longest possible one-shot.
    setTimeout(() => { activeOneShots = Math.max(0, activeOneShots - 1); }, 900);

    switch (name) {
      case 'shot-pistol':
        shot(t, pan, 0.55 * vol, { blipFreq: 900 * rate, blipDur: 0.06, noiseDur: 0.09, noiseFreq: 2800, thumpVol: 0.25 });
        break;
      case 'shot-smg':
        shot(t, pan, 0.42 * vol, { blipFreq: 1100 * rate, blipDur: 0.04, noiseDur: 0.055, noiseFreq: 3200, thumpVol: 0.12 });
        break;
      case 'shot-shotgun':
        shot(t, pan, 0.85 * vol, { blipFreq: 420 * rate, blipDur: 0.14, noiseDur: 0.28, noiseFreq: 1600, thumpVol: 0.8 });
        break;
      case 'shot-rifle':
        shot(t, pan, 0.65 * vol, { blipFreq: 1500 * rate, blipDur: 0.05, noiseDur: 0.14, noiseFreq: 4200, thumpVol: 0.35 });
        break;
      case 'punch':
        playThump({ t, f0: 150, f1: 45, dur: 0.13, vol: 0.5 * vol, pan });
        playNoise({ t, dur: 0.05, vol: 0.12 * vol, pan, type: 'bandpass', freq: 900 });
        break;
      case 'hit':
        playTone({ type: 'square', f0: 320 * rate, f1: 190, t, dur: 0.07, vol: 0.22 * vol, pan });
        break;
      case 'hurt':
        playTone({ type: 'sawtooth', f0: 260 * rate, f1: 130, t, dur: 0.16, vol: 0.25 * vol, pan });
        break;
      case 'splash':
        playNoise({ t, dur: 0.45, vol: 0.35 * vol, pan, type: 'bandpass', freq: 700, f1: 1600, attack: 0.08 });
        break;
      case 'enter':
        playTone({ type: 'sine', f0: 500, f1: 700, t, dur: 0.06, vol: 0.12 * vol, pan, curve: 'lin' });
        playThump({ t: t + 0.02, f0: 110, f1: 60, dur: 0.08, vol: 0.15 * vol, pan });
        break;
      case 'exit':
        playThump({ t, f0: 100, f1: 55, dur: 0.1, vol: 0.18 * vol, pan });
        playTone({ type: 'sine', f0: 600, f1: 420, t: t + 0.03, dur: 0.06, vol: 0.1 * vol, pan, curve: 'lin' });
        break;
      case 'door':
        playThump({ t, f0: 95, f1: 42, dur: 0.16, vol: 0.4 * vol, pan });
        playNoise({ t, dur: 0.06, vol: 0.1 * vol, pan, type: 'lowpass', freq: 600 });
        break;
      case 'buy':
        playTone({ type: 'sine', f0: mtof(76), t, dur: 0.1, vol: 0.2 * vol, pan });            // E5
        playTone({ type: 'sine', f0: mtof(83), t: t + 0.09, dur: 0.16, vol: 0.2 * vol, pan }); // B5
        break;
      case 'cash':
        playTone({ type: 'sine', f0: mtof(88), t, dur: 0.09, vol: 0.22 * vol, pan });            // E6
        playTone({ type: 'sine', f0: mtof(95), t: t + 0.07, dur: 0.18, vol: 0.22 * vol, pan });  // B6
        break;
      case 'error':
        playTone({ type: 'square', f0: 140, t, dur: 0.18, vol: 0.18 * vol, pan });
        playTone({ type: 'square', f0: 130, t: t + 0.05, dur: 0.14, vol: 0.12 * vol, pan });
        break;
      case 'busted':
        playTone({ type: 'sawtooth', f0: 392, f1: 392, t, dur: 0.14, vol: 0.25 * vol, pan });
        playTone({ type: 'sawtooth', f0: 311, f1: 311, t: t + 0.15, dur: 0.14, vol: 0.25 * vol, pan });
        playTone({ type: 'sawtooth', f0: 233, f1: 110, t: t + 0.3, dur: 0.4, vol: 0.28 * vol, pan });
        break;
      case 'downed':
        playTone({ type: 'sine', f0: 220, f1: 48, t, dur: 0.7, vol: 0.35 * vol, pan });
        playNoise({ t, dur: 0.5, vol: 0.08 * vol, pan, type: 'lowpass', freq: 500, f1: 120 });
        break;
      case 'checkpoint':
        playTone({ type: 'triangle', f0: mtof(72), t, dur: 0.09, vol: 0.2 * vol, pan });
        playTone({ type: 'triangle', f0: mtof(76), t: t + 0.08, dur: 0.09, vol: 0.2 * vol, pan });
        playTone({ type: 'triangle', f0: mtof(79), t: t + 0.16, dur: 0.18, vol: 0.22 * vol, pan });
        break;
      case 'win':
        [69, 73, 76, 81].forEach((m, i) => {
          playTone({ type: 'triangle', f0: mtof(m), t: t + i * 0.11, dur: 0.22, vol: 0.22 * vol, pan });
        });
        break;
      case 'fail':
        playTone({ type: 'triangle', f0: mtof(64), t, dur: 0.2, vol: 0.22 * vol, pan });
        playTone({ type: 'triangle', f0: mtof(59), f1: mtof(57), t: t + 0.2, dur: 0.38, vol: 0.22 * vol, pan });
        break;
      case 'pickup':
        playTone({ type: 'sine', f0: 660, f1: 1180, t, dur: 0.12, vol: 0.2 * vol, pan });
        break;
      case 'radio':
        playNoise({ t, dur: 0.08, vol: 0.18 * vol, pan, type: 'highpass', freq: 1800 });
        playTone({ type: 'sine', f0: 880, t: t + 0.085, dur: 0.05, vol: 0.08 * vol, pan });
        break;
      case 'crash': {
        const v = 0.7 * vol;
        playNoise({ t, dur: 0.32, vol: v, pan, type: 'lowpass', freq: 2400, f1: 200 });
        playThump({ t, f0: 110, f1: 30, dur: 0.35, vol: v * 0.9, pan });
        playNoise({ t: t + 0.02, dur: 0.18, vol: v * 0.3, pan, type: 'highpass', freq: 3500 });
        break;
      }
      case 'step':
        playNoise({ t, dur: 0.03, vol: 0.045 * vol, pan, type: 'lowpass', freq: 700 });
        break;
      default:
        // Unknown name: ignore silently.
        activeOneShots = Math.max(0, activeOneShots - 1);
        break;
    }
  }

  // ---------- public API ----------
  return {
    unlock,
    get available() { return !!ctx; },
    setMuted(m) { isMuted = !!m; applyMasterMute(); },
    toggleMute() { isMuted = !isMuted; applyMasterMute(); return isMuted; },
    get muted() { return isMuted; },
    setStation(i) { station = normStation(i); return STATION_NAMES[station]; },
    stationIndex() { return station; },
    stationName() { return STATION_NAMES[station]; },
    update,
    sfx,
    dispose,
  };
}
