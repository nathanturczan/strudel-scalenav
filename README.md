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
const { signInWithGoogle, joinEnsemble, getCurrentUser } = await import('https://cdn.jsdelivr.net/npm/strudel-scalenav/dist/strudel-scalenav.js')
if (!getCurrentUser()) await signInWithGoogle()
const ens = await joinEnsemble('your-room-id')

n("0 2 4 <[6,8] [7,9]>")
  .scale(ens.strudelScale)
  .sound("piano")
```

Whenever the Scale Navigator host changes the scale or chord, your pattern reharmonizes on the next cycle — no re-evaluation needed.

---

## Installation

### In the Strudel REPL (the normal case)

```js
const sn = await import('https://cdn.jsdelivr.net/npm/strudel-scalenav/dist/strudel-scalenav.js')
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

**Sign-in is required.** Everyone who joins an ensemble shows up to the host by name. Pick one:

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

---

## Joining an ensemble

You need a room ID. The host gets this when they create an ensemble in the Scale Navigator Dashboard or mobile app.

```js
const ens = await joinEnsemble('nathan-jam-session')
```

Leave gracefully:

```js
await ens.leave()
```

---

## The `ens` API

### Scale data

| Property | Type | Description |
|---|---|---|
| `ens.scaleRoot` | signal (0–11) | Pitch class of scale root |
| `ens.scaleRootNote` | signal (MIDI) | Scale root in octave 4 (playable) |
| `ens.scalePitchClasses` | getter `number[]` | Pitch classes 0–11 |
| `ens.scaleNotes` | getter `number[]` | Scale notes in octave 4 (playable) |
| `ens.strudelScale` | signal `string` | For `.scale()`, e.g. `"C:major"` |
| `ens.scaleName` | signal `string` | Raw ID, e.g. `"c_diatonic"` |
| `ens.scaleClass` | signal `string` | e.g. `"diatonic"`, `"harmonic_minor"` |
| `ens.scaleRootName` | signal `string` | e.g. `"C"`, `"F#"` |

### Chord data

| Property | Type | Description |
|---|---|---|
| `ens.chordRoot` | signal (0–11) | Pitch class of chord root |
| `ens.chordRootNote` | signal (MIDI) | Chord root in octave 2 (bass) |
| `ens.chordVoicing` | getter `number[]` | Original voicing (MIDI notes) |
| `ens.chordPitchClasses` | getter `number[]` | Pitch classes 0–11 |
| `ens.chordClosed` | getter `number[]` | Close position in octave 4 (playable) |
| `ens.chordRootName` | signal `string` | e.g. `"A"`, `"Db"` |
| `ens.chordType` | signal `string` | e.g. `"M7"`, `"_13#9-110"` |
| `ens.chordNoteNames` | getter `string[]` | e.g. `["G3", "Db4", "F#4"]` |

### Other

| Property | Type | Description |
|---|---|---|
| `ens.bpm` | signal | Host's BPM |
| `ens.hostName` | getter | Who's hosting |
| `ens.roomName` | getter | Room display name |
| `ens.state` | getter | Full internal state object |

### Index helpers

```js
ens.scalePitch(i)       // i-th scale note (octave 4)
ens.chordPitch(i)       // i-th voicing note (original octaves)
ens.chordClosedPitch(i) // i-th chord note (close position, octave 4)
```

### Pattern helpers

```js
// Arpeggiate chord voicing
note(ens.arp(4)).s("piano")           // 4 notes per cycle
note(ens.arp("0 2 1 3")).s("piano")   // custom index pattern

// Block chord (all notes at once)
note(ens.block()).s("piano").slow(2)
```

---

## Pattern recipes

### Play in the host's scale

```js
n("0 2 4 <[6,8] [7,9]>")
  .scale(ens.strudelScale)
  .sound("piano")
```

### Arpeggiate the chord voicing

```js
note(ens.arp(4)).sound("piano")
```

### Chord with bass note

```js
stack(
  note(ens.chordRootNote).slow(2),  // bass
  note(ens.arp(4))                   // arpeggio
).sound("piano")
```

### Block chords

```js
note(ens.block())
  .struct("x ~ x ~ x x ~ x")
  .sound("piano")
```

### Generative melody

```js
n(irand(8).segment(8))
  .scale(ens.strudelScale)
  .sound("piano")
```

### Sync to host's BPM

```js
note(ens.arp(4))
  .sound("piano")
  .cpm(ens.bpm.div(4))
```

---

## Caveats

- **Scale → Strudel mapping is partial.** `strudelScale` maps `diatonic`, `harmonic_minor`, `harmonic_major`, and `acoustic` to Strudel equivalents. For `octatonic_*`, `hexatonic_*`, and `whole_tone_*` scales, it falls back to `"C:major"`. Use `ens.scalePitchClasses` directly for those.
- **Read-only.** This package never writes changes back to the room.
- **Auth required.** Anonymous access isn't enabled.

---

## Development

```bash
git clone https://github.com/nathanturczan/strudel-scalenav
cd strudel-scalenav
npm install
npm run build
```

### Publishing

```bash
npm run build
npm publish
```

---

## Related

- [Scale Navigator Dashboard](https://github.com/nathanturczan/scale-navigator-dashboard) — the host app
- [Strudel](https://strudel.cc) — browser-based live coding
- [TidalCycles](https://tidalcycles.org/) — the pattern language Strudel ports to JS

---

## License

MIT © Nathan Turczan. See [LICENSE](./LICENSE).
