import ScaleData from './scales.js';
import ChordData from './chords.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const SCALE_CLASS_TO_STRUDEL = {
  diatonic: 'major',
  harmonic_minor: 'harmonic minor',
  harmonic_major: 'harmonic major',
  acoustic: 'lydian dominant',
  whole_tone: 'whole tone',
  octatonic: 'diminished',
  hexatonic: 'augmented',
};

export function pcToNoteName(pc, { flats = false } = {}) {
  if (typeof pc !== 'number') return null;
  const n = ((pc % 12) + 12) % 12;
  return (flats ? NOTE_NAMES_FLAT : NOTE_NAMES)[n];
}

export function midiToNoteName(midi) {
  if (typeof midi !== 'number') return null;
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

export function resolveScale(scaleId) {
  if (!scaleId || typeof scaleId !== 'string') return null;
  const raw = ScaleData[scaleId];
  if (!raw) return null;

  const strudelClass = SCALE_CLASS_TO_STRUDEL[raw.scale_class] ?? null;
  const rootName = pcToNoteName(raw.root);
  const strudelScale = strudelClass && rootName ? `${rootName}:${strudelClass}` : null;

  return {
    id: scaleId,
    root: raw.root,
    rootName,
    pitchClasses: raw.pitch_classes,
    scaleClass: raw.scale_class,
    strudelScale,
  };
}

export function resolveChord(chordId) {
  if (!chordId || typeof chordId !== 'string') return null;
  const raw = ChordData[chordId];
  if (!raw) return null;

  const voicing = raw.original_voicing ?? [];
  const noteNames = voicing.map(midiToNoteName);

  return {
    id: chordId,
    root: raw.root,
    rootName: pcToNoteName(raw.root),
    chordType: raw.chord_type,
    voicing,
    noteNames,
    pitchClasses: raw.prime_form_kinda ?? [],
  };
}
