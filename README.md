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
| `ens.scalePretty` | getter `string` | Pretty display: `"E♭ Diatonic"` or `"[0,2] Whole Tone"` |

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
| `ens.chordPretty` | getter `string` | Pretty display: `"A♭ m7"`, `"F♯ 13♯9"` |

### Other

| Property | Type | Description |
|---|---|---|
| `ens.bpm` | signal | Host's BPM |
| `ens.hostName` | getter | Who's hosting |
| `ens.roomName` | getter | Room display name |
| `ens.roomId` | string | Room ID you joined |
| `ens.state` | getter | Full internal state object |

### Index helpers

All index helpers support negative indices: `-1` = last, `-2` = second to last, etc.

| Method | Description |
|---|---|
| `ens.scalePitch(i)` | i-th scale note in octave 4 |
| `ens.chordPitch(i)` | i-th voicing note (original octaves from host) |
| `ens.chordClosedPitch(i)` | i-th chord note in close position (octave 4) |
| `ens.stackThird(i)` | Stack in 3rds from chord root using scale (see below) |

#### `stackThird(i)` — tertian chord building

Builds chords/extensions by stacking thirds from the chord root, using the current scale. Continues up in octaves (9th is above 7th, not wrapped back down).

| Index | Interval | Example (C major, root = C) |
|---|---|---|
| 0 | root | C4 |
| 1 | 3rd | E4 |
| 2 | 5th | G4 |
| 3 | 7th | B4 |
| 4 | 9th | D5 |
| 5 | 11th | F5 |
| 6 | 13th | A5 |
| 7 | root (2 oct) | C6 |

### Pattern helpers

| Method | Description |
|---|---|
| `ens.arp(n)` | Arpeggiate chord voicing at n notes per cycle |
| `ens.block()` | All chord notes at once (stacked) |
| `ens.leave()` | Leave the ensemble gracefully |

### Visual helpers

| Property/Method | Type | Description |
|---|---|---|
| `ens.scaleColor` | getter `string` | Current scale color (hex or rgb) |
| `ens.showBadge(options?)` | function | Display scale badge in REPL header |

Options for `showBadge`: `x` (default 280), `y` (default 35), `size` (default 22), `showText` (default true)

```js
note(ens.arp(4)).s("piano")           // 4 notes per cycle
note(ens.block()).s("piano").slow(2)  // block chord
```

### Auth functions

| Function | Description |
|---|---|
| `signInWithGoogle()` | Google popup sign-in |
| `signInWithEmail(email, password)` | Email sign-in (returning users) |
| `signUpWithEmail(email, password, displayName)` | Create new account |
| `signOut()` | Sign out |
| `getCurrentUser()` | Get current user or `null` |
| `onAuthChange(callback)` | Listen for auth state changes |
| `setDisplayName(name)` | Update your display name |

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

### Display scale badge

```js
ens.showBadge()  // Shows polygon + scale/chord names in header

n("0 2 4 6")
  .scale(ens.strudelScale)
  .sound("piano")
```

The badge automatically positions to the right of "REPL (warm)" and updates when scale/chord changes.

---

## Caveats

- **Scale → Strudel mapping.** All 7 scale classes map to Strudel equivalents: `diatonic` → `major`, `harmonic_minor` → `harmonic minor`, `harmonic_major` → `harmonic major`, `acoustic` → `lydian dominant`, `whole_tone` → `whole tone`, `octatonic` → `diminished`, `hexatonic` → `augmented`.
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
