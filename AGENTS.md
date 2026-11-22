# strudel-scalenav

Strudel client for Scale Navigator ensembles. Connects live-coding patterns to a shared harmonic state.

## Project Structure

```
index.js       - Main API: auth, joinEnsemble, hierarchical namespace (ens.scale.*, ens.chord.*)
resolver.js    - Scale/chord data lookup and formatting (formatScaleName, formatChordName)
scales.js      - Scale data dictionary (pitch classes, scale classes)
chords.js      - Chord data dictionary (voicings, pitch classes, chord types)
visual.js      - Canvas drawing: polygon badges, scale colors
```

## Build

```bash
npm run build  # esbuild → dist/strudel-scalenav.js
npm publish    # publishes to npm, CDN auto-updates via jsdelivr
```

## Key Concepts

### Strudel Integration

- Use `signal()` from Strudel's global scope for reactive values
- All signals need `.segment(n)` to trigger note events (continuous signals don't fire)
- `getDrawContext()` for canvas access (not `.draw()` chaining)

### API Design

**Hierarchical (primary):**
```js
ens.scale.pitch(i)
ens.scale.arp(n)
ens.scale.block()
ens.scale.thirds.pitch(i)  // from scale root

ens.chord.voicing.pitch(i)
ens.chord.voicing.arp(n)
ens.chord.voicing.block()
ens.chord.closed.pitch(i)
ens.chord.closed.arp(n)
ens.chord.closed.block()
ens.chord.thirds.pitch(i)  // from chord root
ens.chord.thirds.arp(n)
ens.chord.thirds.block(count)
```

**Flat aliases (backwards compat):** `arp()`, `block()`, `scalePitch()`, `chordPitch()`, etc.

### Scale Classes

7 scale classes yielding 57 unique scales:
- diatonic, acoustic, harmonic_minor, harmonic_major (12 each)
- octatonic (3), hexatonic (4), whole_tone (2)

### Polygon Shapes

Each scale class has a distinct shape for visual identification:
- diatonic: hexagon
- acoustic: horizontal rectangle
- whole_tone: vertical rectangle
- hexatonic: triangle (pointing left)
- octatonic: octagon
- harmonic_major: parallelogram (right side higher)
- harmonic_minor: parallelogram (left side higher)

### Colors

- Normal scales: PITCH_CLASS_COLORS (12 distinct colors by pitch class)
- Symmetric scales (whole_tone, octatonic, hexatonic): grayscale

## Testing

Test in Strudel REPL at strudel.cc:
```js
const { signInWithGoogle, joinEnsemble } = await import('https://cdn.jsdelivr.net/npm/strudel-scalenav/dist/strudel-scalenav.js')
await signInWithGoogle()
const ens = await joinEnsemble('test-room')
ens.showBadge()
note(ens.chord.voicing.arp(4)).s("piano")
```

## Firebase

Read-only client. Uses Scale Navigator's Firebase project:
- Auth: Google popup, email/password
- Firestore: rooms/{roomId} for state, rooms/{roomId}/activeUsers for presence

## Versioning

- Bump version in package.json
- Build and publish
- CDN (jsdelivr) auto-updates within minutes
