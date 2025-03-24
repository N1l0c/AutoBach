// AutoBachScrollingSingleStaff.tsx
// Patches:
// 1) Convert arrays to typed tuples, e.g. const RANGE_VOICE_0: [number, number] = [36, 60]
// 2) Define function midiToNoteName if missing.
//    => function midiToNoteName(midi: number): string {
//         return Tone.Frequency(midi, "midi").toNote();
//       }

import { useState, useRef, useEffect } from "react";
import * as Tone from "tone";
import {
  Renderer,
  Stave,
  Voice,
  StaveNote,
  Formatter,
} from "vexflow";

// ======== Types ========
type Note = { midi: number };

// One measure with 3 voices
// measure.voices[0] = line1 (quarter notes)
// measure.voices[1] = line2 (quarter notes)
// measure.voices[2] = line3 (8th notes)

type Measure = {
  voices: Note[][];
};

// ======== Utility to get note name for debugging ========
function midiToNoteName(midi: number): string {
  return Tone.Frequency(midi, "midi").toNote();
}

// ======== Constants ========
// For snapping to C major
const C_MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

// BPM, each measure = 4 beats => at 120 BPM, each measure is 2 seconds
const TEMPO_BPM = 120;
const SEC_PER_BEAT = 60 / TEMPO_BPM; // 0.5s
const MEASURE_LENGTH_SEC = 4 * SEC_PER_BEAT; // = 2s at 120 BPM

// We'll define standard ranges for each voice as tuples
const RANGE_VOICE_0: [number, number] = [36, 60]; // lower register (C2 - C4)
const RANGE_VOICE_1: [number, number] = [48, 72]; // mid register (C3 - C5)
const RANGE_VOICE_2: [number, number] = [60, 84]; // higher register (C4 - C6)

// ======== Utility functions ========

function snapToCmajor(midi: number) {
  const rootMidi = 60;
  let diff = midi - rootMidi;
  const baseOct = Math.floor(diff / 12);
  let semitone = diff % 12;
  if (semitone < 0) semitone += 12;

  let best = C_MAJOR_SCALE[0];
  let minDist = 999;
  for (const s of C_MAJOR_SCALE) {
    const d = Math.abs(s - semitone);
    if (d < minDist) {
      minDist = d;
      best = s;
    }
  }
  return rootMidi + baseOct * 12 + best;
}

function clamp(value: number, [minVal, maxVal]: [number, number]) {
  return Math.max(minVal, Math.min(maxVal, value));
}

function midiToFreq(midi: number) {
  return Tone.Frequency(midi, "midi").toFrequency();
}

function midiToVexKey(midi: number) {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const semitone = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return noteNames[semitone] + "/" + octave;
}

// ======== Generators for 3 voices ========
// Voice 0 & 1 => 4 quarter notes each
// Voice 2 => 8 eighth notes in a higher register

function generateVoiceQuarter(prevMidi?: number, range?: [number, number]) {
  const line: Note[] = [];
  let current = prevMidi ?? 60; // default

  for (let i = 0; i < 4; i++) {
    const step = Math.random() < 0.5 ? 2 : -2;
    let nextMidi = current + step;
    nextMidi = clamp(nextMidi, range || [36, 72]);
    nextMidi = snapToCmajor(nextMidi);
    line.push({ midi: nextMidi });
    current = nextMidi;
  }
  return line;
}

function generateVoiceMelody(prevMidi?: number, range?: [number, number]) {
  // 8 eighth notes
  const line: Note[] = [];
  let current = prevMidi ?? 72; // higher default

  for (let i = 0; i < 8; i++) {
    const step = Math.random() < 0.5 ? 1 : -1;
    let nextMidi = current + step;
    nextMidi = clamp(nextMidi, range || [60, 84]);
    nextMidi = snapToCmajor(nextMidi);
    line.push({ midi: nextMidi });
    current = nextMidi;
  }
  return line;
}

// Build 1 measure => 3 voices
function generateMeasure(prev?: Measure): Measure {
  let prev0: number | undefined;
  let prev1: number | undefined;
  let prev2: number | undefined;

  if (prev) {
    // last note of each voice
    prev0 = prev.voices[0][prev.voices[0].length - 1].midi;
    prev1 = prev.voices[1][prev.voices[1].length - 1].midi;
    prev2 = prev.voices[2][prev.voices[2].length - 1].midi;
  }

  const line0 = generateVoiceQuarter(prev0, RANGE_VOICE_0);
  const line1 = generateVoiceQuarter(prev1, RANGE_VOICE_1);
  const line2 = generateVoiceMelody(prev2, RANGE_VOICE_2);

  return { voices: [line0, line1, line2] };
}

// ======== Scheduling playback ========

function scheduleMeasure(
  measure: Measure,
  startTime: number,
  synth: Tone.PolySynth
) {
  // Voice0 => 4 Q notes => each note is 1 beat
  // Voice1 => same
  // Voice2 => 8 E notes => each note is 0.5 beat
  measure.voices.forEach((voiceNotes, voiceIndex) => {
    let beatsPerNote = 1; // quarter by default
    if (voiceIndex === 2) {
      beatsPerNote = 0.5; // melody => eighth notes
    }
    voiceNotes.forEach((note, noteIndex) => {
      const noteStart = startTime + noteIndex * beatsPerNote * SEC_PER_BEAT;
      synth.triggerAttackRelease(midiToFreq(note.midi), "8n", noteStart);
    });
  });
}

// ======== Rendering single staff with multiple voices per measure ========

function renderMeasuresScrolling(
  container: HTMLDivElement,
  measures: Measure[],
  measureWidth = 220
) {
  container.innerHTML = "";
  // We'll allow up to measures.length * measureWidth
  const totalWidth = measureWidth * measures.length + 50;
  const svgHeight = 250;

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(totalWidth, svgHeight);

  const ctx = renderer.getContext();
  ctx.setFont("Arial", 10).setBackgroundFillStyle("#fff");

  // Create a <g> so we can shift it left
  const scrollG = ctx.openGroup(); // <g>
  let scrollX = 0;
  if (measures.length > 4) {
    scrollX = (measures.length - 4) * measureWidth;
  }
  (scrollG as SVGGElement).setAttribute("transform", `translate(${-scrollX}, 0)`);

  measures.forEach((measure, i) => {
    const x = i * measureWidth + 10; // offset
    const staveY = 50;
    const stave = new Stave(x, staveY, measureWidth - 10);
    stave.addClef("treble").setContext(ctx).draw();

    // 3 voices
    // voice0 => 4 quarter => 4/4
    const vexNotes0 = measure.voices[0].map((note) => {
      return new StaveNote({
        clef: "treble",
        keys: [midiToVexKey(note.midi)],
        duration: "q",
      });
    });
    const v0 = new Voice({ numBeats: 4, beatValue: 4 });
    v0.addTickables(vexNotes0);

    // voice1 => 4 quarter => 4/4
    const vexNotes1 = measure.voices[1].map((note) => {
      return new StaveNote({
        clef: "treble",
        keys: [midiToVexKey(note.midi)],
        duration: "q",
      });
    });
    const v1 = new Voice({ numBeats: 4, beatValue: 4 });
    v1.addTickables(vexNotes1);

    // voice2 => 8 eighth => total 4 beats
    const vexNotes2 = measure.voices[2].map((note) => {
      return new StaveNote({
        clef: "treble",
        keys: [midiToVexKey(note.midi)],
        duration: "8",
      });
    });
    const v2 = new Voice({ numBeats: 4, beatValue: 4 });
    v2.addTickables(vexNotes2);

    new Formatter()
      .joinVoices([v0, v1, v2])
      .format([v0, v1, v2], measureWidth - 20);

    v0.draw(ctx, stave);
    v1.draw(ctx, stave);
    v2.draw(ctx, stave);
  });

  ctx.closeGroup(); // </g>
}

// ======== The React Component ========

export default function AutoBachScrollingSingleStaff() {
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [playing, setPlaying] = useState(false);

  const notationRef = useRef<HTMLDivElement>(null);
  const synthRef = useRef(new Tone.PolySynth().toDestination());
  const nextTimeRef = useRef(Tone.now());
  const intervalIdRef = useRef<number | null>(null);

  // Re-render staves whenever measures changes
  useEffect(() => {
    if (!notationRef.current) return;
    renderMeasuresScrolling(notationRef.current, measures);
  }, [measures]);

  function handleStart() {
    if (playing) return; // don't start twice
    setPlaying(true);

    Tone.start().then(() => {
      if (measures.length === 0) {
        const first = generateMeasure(undefined);
        const second = generateMeasure(first);
        setMeasures([first, second]);

        scheduleMeasure(first, nextTimeRef.current, synthRef.current);
        nextTimeRef.current += MEASURE_LENGTH_SEC;
        scheduleMeasure(second, nextTimeRef.current, synthRef.current);
        nextTimeRef.current += MEASURE_LENGTH_SEC;
      }

      intervalIdRef.current = window.setInterval(() => {
        setMeasures((prev) => {
          const last = prev[prev.length - 1];
          const newM = generateMeasure(last);

          scheduleMeasure(newM, nextTimeRef.current, synthRef.current);
          nextTimeRef.current += MEASURE_LENGTH_SEC;

          return [...prev, newM];
        });
      }, MEASURE_LENGTH_SEC * 1000);
    });
  }

  function handleStop() {
    if (!playing) return;
    setPlaying(false);

    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }

    nextTimeRef.current = Tone.now();
    synthRef.current.releaseAll();
  }

  return (
    <div style={{ background: "#333", color: "#fff", minHeight: "100vh", padding: "1rem" }}>
      <h1>AutoBach – Single Staff, 3 Voices, Indefinite Scrolling (Patched)</h1>
      <p>
        Two quarter-note lines + one 8th-note melody, appended measure-by-measure.
        The last 4 measures remain visible, older measures scroll off left.
      </p>
      <div style={{ marginBottom: "1rem" }}>
        <button onClick={handleStart}>Start</button>{" "}
        <button onClick={handleStop}>Stop</button>
      </div>

      <div
        ref={notationRef}
        style={{ background: "#fff", padding: "1rem", color: "#000", minHeight: "250px" }}
      />

      <div style={{ marginTop: "1rem" }}>
        <h2>Measures: {measures.length}</h2>
        {measures.slice(-4).map((m, idx) => (
          <div key={idx}>
            <b>Measure {measures.length - 4 + idx}:</b>
            <br />
            Voice0 (q): {m.voices[0].map((n) => midiToNoteName(n.midi)).join(" ")}
            <br />
            Voice1 (q): {m.voices[1].map((n) => midiToNoteName(n.midi)).join(" ")}
            <br />
            Voice2 (8th): {m.voices[2].map((n) => midiToNoteName(n.midi)).join(" ")}
          </div>
        ))}
      </div>
    </div>
  );
}
