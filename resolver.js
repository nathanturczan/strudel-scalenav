import ScaleData from './scales.js';
import ChordData from './chords.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Pitch tokens that can be scale/chord roots
const PITCH_TOKENS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'as', 'bs', 'cs', 'ds', 'es', 'fs', 'gs']);

// Limited transposition modes (symmetric scales) - show pitch classes instead of root
const LIMITED_TRANSPOSITION_MODES = ['whole_tone', 'octatonic', 'hexatonic'];

// Map raw root tokens to pretty display (prefers flats for black keys except F#)
const ROOT_TOKEN_MAP = {
  'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F', 'g': 'G',
  'as': 'B♭', 'bs': 'C', 'cs': 'D♭', 'ds': 'E♭', 'es': 'F', 'fs': 'F♯', 'gs': 'A♭',
};

function mapRootToken(token) {
  return ROOT_TOKEN_MAP[token] || (token ? token.charAt(0).toUpperCase() + token.slice(1) : '');
}

function toUnicodeAccidentals(str) {
  if (!str) return str;
  return str.replace(/#/g, '♯').replace(/b/g, '♭');
}

function titleCaseWords(s) {
  if (!s) return '';
  return s
    .split('_')
    .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ');
}

// Format scale name for display: "c_diatonic" → "C Diatonic"
// Limited transposition scales show pitch classes: "c_whole_tone" → "[0,6] Whole Tone"
export function formatScaleName(scaleId) {
  if (!scaleId || typeof scaleId !== 'string') return '';

  const scaleData = ScaleData[scaleId];
  const parts = scaleId.split('_');
  const maybeRoot = parts[0];
  const hasRootToken = PITCH_TOKENS.has(maybeRoot);
  const classTokens = hasRootToken ? parts.slice(1) : parts;

  // Get scale class label
  const scaleClass = scaleData?.scale_class || classTokens.join('_');
  const classLabel = titleCaseWords(scaleClass);

  // Limited transposition scales: show first two pitch classes instead of root
  if (scaleData && LIMITED_TRANSPOSITION_MODES.includes(scaleData.scale_class)) {
    const pc = scaleData.pitch_classes;
    if (pc && pc.length >= 2) {
      return `[${pc[0]},${pc[1]}] ${classLabel}`;
    }
  }

  // Normal scales: Root + Class
  if (hasRootToken) {
    const root = mapRootToken(maybeRoot);
    return `${root} ${classLabel}`;
  }

  return classLabel;
}

// Format chord name for display: "gs_m7-42" → "A♭ m7"
export function formatChordName(chordId) {
  if (!chordId || typeof chordId !== 'string') return '';

  // Strip trailing voicing ID: "gs_m7-42" → "gs_m7"
  const dashIdx = chordId.lastIndexOf('-');
  const head = dashIdx > -1 ? chordId.slice(0, dashIdx) : chordId;

  // Split root and suffix: "gs_m7" → ["gs", "m7"]
  const [rootRaw, ...rest] = head.split('_');
  const suffix = rest.join('_');

  // Map root and convert accidentals
  const root = mapRootToken(rootRaw || '');
  const unicodeSuffix = toUnicodeAccidentals(suffix);

  return `${root}${unicodeSuffix ? ' ' + unicodeSuffix : ''}`;
}

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
  const prettyName = formatScaleName(scaleId);

  return {
    id: scaleId,
    root: raw.root,
    rootName,
    pitchClasses: raw.pitch_classes,
    scaleClass: raw.scale_class,
    strudelScale,
    prettyName,
  };
}

export function resolveChord(chordId) {
  if (!chordId || typeof chordId !== 'string') return null;
  const raw = ChordData[chordId];
  if (!raw) return null;

  const voicing = raw.original_voicing ?? [];
  const noteNames = voicing.map(midiToNoteName);
  const prettyName = formatChordName(chordId);

  return {
    id: chordId,
    root: raw.root,
    rootName: pcToNoteName(raw.root),
    chordType: raw.chord_type,
    voicing,
    noteNames,
    pitchClasses: raw.prime_form_kinda ?? [],
    prettyName,
  };
}
