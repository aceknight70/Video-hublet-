// Web Audio API Procedural Music Generator for Built-in Loops
// Generates standard loopable WAV Blobs entirely in code without any external audio files.

export interface BuiltinTrack {
  id: string;
  title: string;
  duration: number;
  blob: Blob;
  url: string;
}

let cachedTracks: BuiltinTrack[] | null = null;

/**
 * Generate 2 built-in instrumental loops: "Soft Ambient Pad" and "Upbeat Acoustic Rhythm"
 */
export async function getBuiltinTracks(): Promise<BuiltinTrack[]> {
  if (cachedTracks && cachedTracks.length > 0) {
    return cachedTracks;
  }

  const [padBlob, rhythmBlob] = await Promise.all([
    generateSoftAmbientPad(),
    generateUpbeatRhythm()
  ]);

  cachedTracks = [
    {
      id: 'builtin_pad',
      title: 'Soft Ambient Pad (Built-in)',
      duration: 8,
      blob: padBlob,
      url: URL.createObjectURL(padBlob)
    },
    {
      id: 'builtin_rhythm',
      title: 'Upbeat Light Rhythm (Built-in)',
      duration: 8,
      blob: rhythmBlob,
      url: URL.createObjectURL(rhythmBlob)
    }
  ];

  return cachedTracks;
}

/**
 * Generates an 8-second ambient synth pad loop (Cmaj7 -> Fmaj7)
 */
async function generateSoftAmbientPad(): Promise<Blob> {
  const sampleRate = 44100;
  const duration = 8.0; // 8 seconds loop
  const length = sampleRate * duration;
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  // Chords: 0-4s Cmaj7 (C3, E3, G3, B3), 4-8s Fmaj7 (F3, A3, C4, E4)
  const chords = [
    { time: 0, dur: 4.1, notes: [130.81, 164.81, 196.00, 246.94] },
    { time: 4.0, dur: 4.1, notes: [174.61, 220.00, 261.63, 329.63] }
  ];

  // Master filter for warmth
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(650, 0);
  filter.frequency.linearRampToValueAtTime(1100, 4);
  filter.frequency.linearRampToValueAtTime(650, 8);
  filter.connect(ctx.destination);

  chords.forEach(({ time, dur, notes }) => {
    notes.forEach((freq, noteIdx) => {
      // 2 detuned oscillators for rich lush chorus
      [-4, 4].forEach(detune => {
        const osc = ctx.createOscillator();
        osc.type = noteIdx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        osc.detune.setValueAtTime(detune, time);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.08, time + 0.8);
        gain.gain.setValueAtTime(0.08, time + dur - 0.9);
        gain.gain.linearRampToValueAtTime(0.001, time + dur);

        osc.connect(gain);
        gain.connect(filter);

        osc.start(time);
        osc.stop(time + dur);
      });
    });
  });

  const renderedBuffer = await ctx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

/**
 * Generates an 8-second upbeat light rhythm loop with acoustic pulses
 */
async function generateUpbeatRhythm(): Promise<Blob> {
  const sampleRate = 44100;
  const duration = 8.0;
  const length = sampleRate * duration;
  const ctx = new OfflineAudioContext(2, length, sampleRate);

  const tempo = 120; // 120 BPM = 0.5s per beat, 16 beats = 8s
  const beatTime = 60 / tempo;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.5, 0);
  masterGain.connect(ctx.destination);

  // 16 beats loop
  for (let beat = 0; beat < 16; beat++) {
    const t = beat * beatTime;

    // Soft Kick on beats 0, 4, 8, 12 and occasional upbeat
    if (beat % 4 === 0 || beat === 10) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.12);
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.16);
    }

    // Soft Snare/Clap brush on beats 2, 6, 10, 14
    if (beat % 4 === 2) {
      const noiseLength = 0.08;
      const noiseBuffer = ctx.createBuffer(1, sampleRate * noiseLength, sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseBuffer.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1800;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.18, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + noiseLength);

      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      whiteNoise.start(t);
      whiteNoise.stop(t + noiseLength);
    }

    // Gentle Electric Piano / Pluck syncopation
    const chordNotes = beat < 8 ? [261.63, 329.63, 392.00] : [220.00, 261.63, 329.63];
    if (beat % 2 === 0 || beat === 3 || beat === 7 || beat === 11 || beat === 15) {
      chordNotes.forEach(freq => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t);
        osc.stop(t + 0.36);
      });
    }
  }

  const renderedBuffer = await ctx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

/**
 * Converts an AudioBuffer to a valid 16-bit PCM stereo WAV Blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  const channels: Float32Array[] = [];
  let sampleRate = buffer.sampleRate;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    out.setUint16(pos, data, true);
    pos += 2;
  }
  function setUint32(data: number) {
    out.setUint32(pos, data, true);
    pos += 4;
  }

  // RIFF identifier
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);  // file length - 8
  setUint32(0x45564157); // "WAVE"

  // fmt sub-chunk
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16);         // SubChunk1Size (16 for PCM)
  setUint16(1);          // Linear PCM
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan); // byte rate
  setUint16(numOfChan * 2);              // block align
  setUint16(16);                         // bits per sample

  // data sub-chunk
  setUint32(0x61746164); // "data" chunk
  setUint32(length - pos - 4);

  // Write interleaved PCM samples
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      out.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([out.buffer], { type: 'audio/wav' });
}
