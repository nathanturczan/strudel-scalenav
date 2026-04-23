# strudel-scalenav

Connect your [Strudel](https://strudel.cc) live-coding patterns to [Scale Navigator](https://scalenavigator.app) ensembles. Sign in, join a live room, and receive the host's current scale, chord, and BPM as live values you can sample in your Strudel patterns — so your algorithmic music stays harmonically locked to whoever's driving the ensemble.

- **Read-only client.** Strudel users consume harmonic state; the host still drives.
- **Live.** Updates stream via Firestore `onSnapshot`, so pattern output follows the host in real time.
- **Signed in.** Google or email/password — your display name shows up in the ensemble alongside Dashboard users.
- **MIT-licensed, one-line import from the Strudel REPL.**

---

## Quick start

Paste this into [strudel.cc](https://strudel.cc):

```js
await samples('github:tidalcycles/dirt-samples')
const { signInWithGoogle, joinEnsemble } = await import('https://esm.sh/strudel-scalenav')

await signInWithGoogle()
const ens = await joinEnsemble('your-room-id')

note("0 2 4 7".add(ens.scaleRoot))
  .scale(ens.strudelScale)
  .s("piano")
  .cpm(ens.bpm.div(4))
```

Whenever the Scale Navigator host changes the scale or chord, your pattern reharmonizes on the next cycle — no re-evaluation needed.

---

## Installation

### In the Strudel REPL (the normal case)

```js
const sn = await import('https://esm.sh/strudel-scalenav')
```

### In a Vite / bundler project using `@strudel/core`

```bash
npm install strudel-scalenav firebase
```

```js
import { joinEnsemble, signInWithGoogle } from 'strudel-scalenav'
```

You must have `@strudel/core`'s `signal` available in global scope (the REPL does this for you; in a bundler project, expose it yourself: `globalThis.signal = signal`).

---

## Signing in

**Sign-in is required.** Everyone who joins an ensemble shows up to the host by name, and we use the email for occasional updates about Scale Navigator. Pick one:

```js
await signInWithGoogle()
// or
await signUpWithEmail('you@example.com', 'your-password', 'Your Display Name')
// or (for returning users)
await signInWithEmail('you@example.com', 'your-password')
```

Check if you're already signed in:

```js
const user = getCurrentUser()
if (!user) await signInWithGoogle()
```

Change your display name (this is what the host sees in the ensemble roster):

```js
await setDisplayName('DJ Strudel')
```

Sign out:

```js
await signOut()
```

---

## Joining an ensemble

You need a room ID. The host gets this when they create an ensemble in the Scale Navigator Dashboard or mobile app — it's a short string like `nathan-jam-session` or a generated ID.

```js
const ens = await joinEnsemble('nathan-jam-session')
```

Leave gracefully (removes your presence from the host's roster):

```js
await ens.leave()
```

The package also cleans up automatically on `beforeunload`, but explicit `leave()` is cleaner.

### Optional callback

Fires on every update from the host:

```js
const ens = await joinEnsemble('nathan-jam-session', {
  onUpdate: (state) => {
    console.log('host changed:', state.scale?.rootName, state.chord?.chordType)
  }
})
```

---

## The `ens` API

Everything on `ens` falls into three groups:

### Strudel signals (use inside pattern code)

These are [Strudel signals](https://strudel.cc/learn/signals/) — patterns you chain onto `note`, `n`, `scale`, `cpm`, etc. Each evaluates to the *current* host value on every cycle.

| Signal | Type | Example |
|---|---|---|
| `ens.scaleRoot` | number (0–11) pitch class of the scale's root | `note(ens.scaleRoot)` |
| `ens.scaleRootName` | string, e.g. `"C"`, `"F#"` | — |
| `ens.scaleName` | string, e.g. `"c_diatonic"` (raw Scale Navigator ID) | — |
| `ens.strudelScale` | string, e.g. `"C:major"` — pass to `.scale()` | `note("0 2 4").scale(ens.strudelScale)` |
| `ens.scaleClass` | string, e.g. `"diatonic"`, `"harmonic_minor"` | — |
| `ens.chordRoot` | number (0–11) pitch class of the chord root | `note(ens.chordRoot.add(48))` |
| `ens.chordRootName` | string | — |
| `ens.chordType` | string, e.g. `"M7"`, `"_13#9-110"` | — |
| `ens.bpm` | number | `.cpm(ens.bpm.div(4))` |

### Live JS values (read synchronously — not signals)

Use when you want the raw data in a function body, not inside a Strudel pattern.

| Property | Type | Notes |
|---|---|---|
| `ens.pitchClasses` | `number[]` | Scale degrees as pitch classes 0–11 |
| `ens.chordNotes` | `number[]` | MIDI note numbers of the current chord voicing |
| `ens.chordNoteNames` | `string[]` | Like `["G3", "Db4", "F#4", "A4", "C5"]` |
| `ens.chordPitchClasses` | `number[]` | Prime-form pitch classes |
| `ens.hostName` | `string \| null` | Who's driving |
| `ens.roomName` | `string \| null` | Human-readable room name |
| `ens.state` | `object` | Full internal state — `state.scale`, `state.chord`, `state.raw` |

### Index-to-signal helpers

Sometimes you want "the i-th scale degree" or "the i-th chord note" as a signal. These take an integer and return a Strudel signal:

```js
// Arpeggiate the current chord in a fixed pattern
stack(
  note(ens.chordPitch(0)),  // root
  note(ens.chordPitch(2)),  // middle voice
  note(ens.chordPitch(4)),  // top
)

// March up the scale
note("0 1 2 3 4 5 6".pick([0, 1, 2, 3, 4, 5, 6].map(i => ens.scalePitch(i))))
```

### Utilities (also exported at top level)

```js
import { pcToNoteName, midiToNoteName, resolveScale, resolveChord } from 'strudel-scalenav'

pcToNoteName(3)          // => "D#"
pcToNoteName(3, { flats: true })  // => "Eb"
midiToNoteName(60)       // => "C4"
resolveScale('c_diatonic')  // => { root: 0, pitchClasses: [...], strudelScale: "C:major", ... }
resolveChord('a_13#9-110')  // => { root: 9, voicing: [55, 61, 66, 69, 72], ... }
```

---

## Pattern recipes

### Stay in the host's key

```js
note("0 2 4 5 7".fast(2))
  .scale(ens.strudelScale)
  .s("piano")
```

### Play the host's chord as an arpeggio

```js
note(ens.chordPitch(0).cat(ens.chordPitch(1), ens.chordPitch(2), ens.chordPitch(3)))
  .s("piano")
  .fast(4)
```

### A bassline locked to the chord root

```js
note(ens.chordRoot.add(36)).s("bass").slow(2)
```

### Generative melody over the host's current scale

```js
n(rand.range(0, 7).segment(8))
  .scale(ens.strudelScale)
  .s("piano")
  .cpm(ens.bpm.div(4))
```

### React to chord changes in custom JS

```js
const ens = await joinEnsemble('room', {
  onUpdate: (state) => {
    if (state.chord?.chordType?.startsWith('m7')) {
      // cue a sample, swap a pattern, whatever
    }
  }
})
```

---

## Data shapes

Scale Navigator stores scales and chords as string IDs. This package resolves them to useful shapes using the same data files the Dashboard uses.

**Scale ID format:** `<root>_<class>` (e.g. `c_diatonic`, `fs_harmonic_minor`) or rootless (`octatonic_1`, `whole_tone_2`).

**Chord ID format:** `<root>_<chord_type>` (e.g. `a_M7-0`, `f_13#9-110`).

Resolved scale object:
```js
{
  id: 'c_diatonic',
  root: 0,                         // pitch class of root
  rootName: 'C',
  pitchClasses: [0, 2, 4, 5, 7, 9, 11],
  scaleClass: 'diatonic',
  strudelScale: 'C:major',         // or null if class isn't mappable
}
```

Resolved chord object:
```js
{
  id: 'a_13#9-110',
  root: 9,
  rootName: 'A',
  chordType: '_13#9-110',
  voicing: [55, 61, 66, 69, 72],         // MIDI note numbers
  noteNames: ['G3', 'Db4', 'F#4', 'A4', 'C5'],
  pitchClasses: [0, 1, 6, 7, 9],         // prime form
}
```

Scale Navigator's adjacency graph, curated chord palettes per scale, and other editorial data stay in the (private) Scale Navigator Dashboard — this package only includes what Strudel users need to interpret the host's current state.

---

## Caveats

- **Scale → Strudel mapping is partial.** `strudelScale` currently maps `diatonic`, `harmonic_minor`, `harmonic_major`, and `acoustic` to their Strudel/tonal equivalents. For `octatonic_*`, `hexatonic_*`, and `whole_tone_*` scales, `ens.strudelScale` falls back to `"C:major"`. Use `ens.pitchClasses` directly for those.
- **Read-only.** This package never writes scale or chord changes back to the room. Host controls harmony; you react.
- **Firestore free-tier reads.** Each room update counts as one document read per client. Dozens of live Strudel users per room is fine; hundreds could eat into the project's quota.
- **Auth required.** Anonymous access isn't enabled because Scale Navigator uses real identity for ensemble participation and user communication.

---

## Development

```bash
git clone https://github.com/nathanturczan/strudel-scalenav
cd strudel-scalenav
npm install
```

The package is ESM-only, no build step. `index.js`, `resolver.js`, `scales.js`, and `chords.js` ship as-is.

### Data files

`scales.js` and `chords.js` are derived from the Scale Navigator Dashboard and stripped to only the fields Strudel users need: for scales, `root` / `pitch_classes` / `scale_class`; for chords, `chord_type` / `original_voicing` / `prime_form_kinda` / `root`. The adjacency graph, curated chord palettes, spelling, and other editorial fields are intentionally omitted.

### Publishing

```bash
npm publish
```

Users immediately get it via `https://esm.sh/strudel-scalenav` with no further action needed.

---

## Related

- [Scale Navigator Dashboard](https://github.com/nathanturczan/scale-navigator-dashboard) — the host app where ensembles are created and harmony is controlled.
- [Scale Navigator Dashboard Plugin](https://github.com/nathanturczan/Dashboard-Plugin) — DAW/native integration (Max, VST) for production workflows.
- [Strudel](https://strudel.cc) — browser-based live coding environment.
- [TidalCycles](https://tidalcycles.org/) — the pattern language Strudel ports to JavaScript.

---

## License

MIT © Nathan Turczan. See [LICENSE](./LICENSE).

Scale and chord data files are adapted from Scale Navigator Dashboard under MIT.
