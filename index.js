import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

import { resolveScale, resolveChord, resolveScaleInfo, resolveChordInfo, pcToNoteName, midiToNoteName, formatScaleName, formatChordName } from './resolver.js';
import { getScaleColor, getPolygonVertices, drawScaleBadge, startBadgeDrawing, PITCH_CLASS_COLORS } from './visual.js';
import { createPortalDock } from './portal.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBiTTX24mBjypGdel2ARBx0UUvFQEaRDf4',
  authDomain: 'scale-navigator-ensemble.firebaseapp.com',
  projectId: 'scale-navigator-ensemble',
  storageBucket: 'scale-navigator-ensemble.appspot.com',
  messagingSenderId: '156837833740',
  appId: '1:156837833740:web:ce00fcf2297f899f8b9229',
  measurementId: 'G-5G2C3541ZY',
};

const APP_NAME = 'strudel-scalenav';

// How long joinEnsemble() waits for the room's first response before returning.
const FIRST_SNAPSHOT_TIMEOUT_MS = 10000;

// Upper bound on simultaneous voices in a block() chord.
const MAX_BLOCK_VOICES = 16;

// One live handle per room. The documented usage re-runs joinEnsemble() on
// every evaluation, so a new join for the same room replaces the previous
// handle (listener, timers, badge) instead of stacking another one.
const activeHandles = new Map(); // roomId -> { teardown, presenceRef }
let unloadRegistered = false;
let stopActiveBadge = null;

function registerUnloadOnce() {
  if (unloadRegistered || typeof window === 'undefined') return;
  unloadRegistered = true;
  window.addEventListener('beforeunload', () => {
    for (const handle of activeHandles.values()) {
      try {
        deleteDoc(handle.presenceRef).catch(() => {});
      } catch {}
    }
  });
}

function getFbApp() {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  return initializeApp(FIREBASE_CONFIG, APP_NAME);
}

function getFbAuth() {
  return getAuth(getFbApp());
}

function getFbDb() {
  return getFirestore(getFbApp());
}

function getStrudelSignal() {
  // Try window first (browser), then globalThis, then strudel namespace
  if (typeof window !== 'undefined' && typeof window.signal === 'function') return window.signal;
  if (typeof globalThis.signal === 'function') return globalThis.signal;
  if (typeof globalThis.strudel?.signal === 'function') return globalThis.strudel.signal;
  return null;
}

// Combine block-chord voices with Strudel's stack(). Looked up like signal().
function strudelStack(patterns) {
  const stack =
    (typeof window !== 'undefined' && typeof window.stack === 'function' && window.stack) ||
    (typeof globalThis.stack === 'function' && globalThis.stack) ||
    (typeof globalThis.strudel?.stack === 'function' && globalThis.strudel.stack) ||
    null;
  if (!stack) {
    throw new Error(
      'strudel-scalenav: Strudel `stack()` not found, which block() needs. ' +
        'Run this inside the Strudel REPL (strudel.cc) or expose it yourself: ' +
        '`import { stack } from "@strudel/core"; globalThis.stack = stack`.',
    );
  }
  return stack(...patterns);
}

function strudelSignal(fn, segmentRate = 1) {
  const sig = getStrudelSignal();
  if (!sig) {
    throw new Error(
      'strudel-scalenav: Strudel `signal()` not found. ' +
        'Run this inside the Strudel REPL (strudel.cc) or import `{ signal }` from `@strudel/core`.',
    );
  }
  // Apply segment to make it work with note() - continuous signals don't trigger events
  return sig(fn).segment(segmentRate);
}

// Argument checks for the pattern helpers: fail at call time with a clear
// message instead of producing silence or NaN notes later.
function parseIndex(i, what) {
  const n = typeof i === 'string' && /^\s*-?\d+\s*$/.test(i) ? Number(i) : i;
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new Error(
      `strudel-scalenav: ${what} needs a whole-number index, e.g. ${what.replace('(i)', '(0)')}. ` +
        'Strudel patterns and mini-notation are not supported as the index.',
    );
  }
  return n;
}

// arp() takes notes-per-cycle (a positive whole number) or a string of note
// indices such as "0 2 -1 1", where any non-numeric token (e.g. "~") is a rest.
function parseArpPattern(pattern) {
  if (typeof pattern === 'string') {
    const tokens = pattern.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) throw new Error('strudel-scalenav: arp("") needs at least one index, e.g. arp("0 2 1").');
    const indices = tokens.map((tok) => {
      if (!/^-?\d+(\.\d+)?$/.test(tok)) return null; // rest
      const idx = Number(tok);
      if (!Number.isInteger(idx)) {
        throw new Error(`strudel-scalenav: arp("${pattern}") indices must be whole numbers (got ${tok}).`);
      }
      return idx;
    });
    return { indices };
  }
  if (typeof pattern === 'number' && Number.isInteger(pattern) && pattern > 0) return { n: pattern };
  throw new Error(
    'strudel-scalenav: arp() takes a positive whole number of notes per cycle, e.g. arp(4), or a string of ' +
      'indices, e.g. arp("0 2 -1 1"). Strudel patterns are not supported as the argument.',
  );
}

const isNote = (v) => v !== undefined;

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(getFbAuth(), provider);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(getFbAuth(), email, password);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function signUpWithEmail(email, password, displayName) {
  const result = await createUserWithEmailAndPassword(getFbAuth(), email, password);
  if (displayName) {
    await updateProfile(result.user, { displayName });
  }
  await ensureUserDoc(result.user, { userName: displayName });
  return result.user;
}

// Invisible guest identity: no popup, no account, works in incognito/Brave.
export async function signInAsGuest() {
  const result = await signInAnonymously(getFbAuth());
  return result.user;
}

// Auth state restores asynchronously after page load; wait for the first
// onAuthStateChanged event so a persisted session isn't mistaken for "signed out".
function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(getFbAuth(), (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function signOut() {
  return fbSignOut(getFbAuth());
}

export function getCurrentUser() {
  return getFbAuth().currentUser;
}

export function onAuthChange(cb) {
  return onAuthStateChanged(getFbAuth(), cb);
}

export async function setDisplayName(name) {
  const user = getCurrentUser();
  if (!user) throw new Error('strudel-scalenav: not signed in');
  if (!name || typeof name !== 'string') throw new Error('strudel-scalenav: setDisplayName requires a non-empty string');
  await updateProfile(user, { displayName: name });
  try {
    await setDoc(doc(getFbDb(), 'users', user.uid), { userName: name }, { merge: true });
  } catch (err) {
    console.warn('[strudel-scalenav] setDisplayName: user doc update skipped:', err?.code || err);
  }
}

async function ensureUserDoc(user, extra = {}) {
  const ref = doc(getFbDb(), 'users', user.uid);
  const initial = {
    email: user.email ?? null,
    userName: extra.userName ?? user.displayName ?? (user.email ? user.email.split('@')[0] : 'strudel user'),
    photoURL: user.photoURL ?? null,
    source: 'strudel-scalenav',
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, initial, { merge: true });
}

export async function joinEnsemble(roomId, options = {}) {
  if (!roomId || typeof roomId !== 'string') {
    throw new Error('strudel-scalenav: joinEnsemble(roomId) requires a non-empty string roomId');
  }

  // Reuse a persisted session if one exists; otherwise silently join as a guest.
  let user = getCurrentUser() ?? (await waitForAuthReady());
  if (!user) {
    try {
      user = await signInAsGuest();
    } catch (err) {
      throw new Error(
        `strudel-scalenav: could not connect (${err?.code || err?.message || err}). ` +
          'Check your internet connection and try again.',
      );
    }
  }

  const db = getFbDb();
  const roomRef = doc(db, 'rooms', roomId);
  const presenceRef = doc(db, 'rooms', roomId, 'activeUsers', user.uid);

  const state = {
    scale: null,
    chord: null,
    bpm: 120,
    hostName: null,
    roomName: null,
    raw: null,
    connected: false,
  };

  let firstSnapshotResolve;
  const firstSnapshot = new Promise((resolve) => {
    firstSnapshotResolve = resolve;
  });

  // Downbeat hold (lalork#17): rooms whose conductor broadcasts harmony
  // ahead of the musical downbeat publish anticipationMs on the room doc
  // (rehearse stamps 2000 on la-laptop-orchestra). Every receiver holds an
  // incoming change that long after arrival, so the chord lands on the
  // downbeat together across the whole ensemble (enter, Ensemble Jammer,
  // the Ableton bridge, and Strudel). Rooms without the field apply
  // instantly, exactly as before.
  const readAnticipationMs = (data) => {
    const v = data?.anticipationMs;
    return typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(v, 10000) : 0;
  };
  const holdTimers = new Set();
  const clearHoldTimers = () => {
    for (const t of holdTimers) clearTimeout(t);
    holdTimers.clear();
  };
  let appliedFirst = false;
  // Held harmony changes are numbered so an older one can never land after a
  // newer one has been applied.
  let harmonySeq = 0;
  let appliedSeq = 0;
  let lastHarmonyKey = null;
  const harmonyKeyOf = (data) =>
    JSON.stringify([
      data.scaleData ?? null,
      data.chordData ?? null,
      data.scaleInfo?.root,
      data.scaleInfo?.pitchClasses,
      data.chordInfo?.root,
      data.chordInfo?.pitchClasses,
      data.chordInfo?.voicing,
    ]);
  // A held change belongs to the connection it arrived on: drop it when the
  // room goes away, and treat the next snapshot as the room's current state.
  const dropHeldChanges = () => {
    clearHoldTimers();
    appliedFirst = false;
    lastHarmonyKey = null;
  };

  // An inline scaleInfo/chordInfo is only trusted when it describes the id
  // currently on the room document (a stale one may sit beside a newer id).
  const infoMatches = (info, id) => !!info && (info.id === undefined || info.id === id);
  let lastStrudelScale = null;
  const warned = new Set();
  const warnOnce = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(message);
  };

  // Replace any earlier handle for this room (see activeHandles).
  activeHandles.get(roomId)?.teardown();

  let stopBadge = null;
  let left = false;
  const handle = {
    presenceRef,
    teardown: () => {
      unsubRoom();
      clearHoldTimers(); // a held change must not land after leaving
      if (stopBadge) {
        stopBadge();
        if (stopActiveBadge === stopBadge) stopActiveBadge = null;
        stopBadge = null;
      }
      if (activeHandles.get(roomId) === handle) activeHandles.delete(roomId);
    },
  };

  let warnedMissing = false;
  const unsubRoom = onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) {
        state.connected = false;
        dropHeldChanges();
        if (!warnedMissing) {
          warnedMissing = true;
          console.warn(
            `[strudel-scalenav] Room "${roomId}" not found. Check the spelling, ` +
              'or ask your host for the exact room name. Still listening in case it appears...',
          );
        }
        firstSnapshotResolve(); // resolve even if room doesn't exist
        return;
      }
      if (warnedMissing) {
        warnedMissing = false;
        console.log(`[strudel-scalenav] Room "${roomId}" is now live. Connected.`);
      }
      const data = snap.data();
      const applyHarmony = () => {
        // Bundled tables first; then the self-contained scaleInfo/chordInfo
        // the host writes for custom harmony. When neither resolves, keep the
        // last known harmony instead of dropping to a default.
        const scale =
          resolveScale(data.scaleData) ??
          (infoMatches(data.scaleInfo, data.scaleData) ? resolveScaleInfo(data.scaleInfo) : null);
        if (scale) {
          state.scale = scale;
          if (scale.strudelScale) {
            lastStrudelScale = scale.strudelScale;
          } else {
            warnOnce(
              `noname:${scale.id}`,
              `[strudel-scalenav] Scale "${scale.prettyName}" has no Strudel scale name, so ens.strudelScale keeps its ` +
                'previous value. Use the ens.scale.* helpers to play it.',
            );
          }
        } else if (data.scaleData) {
          warnOnce(
            `scale:${data.scaleData}`,
            `[strudel-scalenav] Unknown scale "${data.scaleData}". Keeping the previous scale.`,
          );
        }
        const chord =
          resolveChord(data.chordData) ??
          (infoMatches(data.chordInfo, data.chordData) ? resolveChordInfo(data.chordInfo) : null);
        if (chord) {
          state.chord = chord;
        } else if (data.chordData) {
          warnOnce(
            `chord:${data.chordData}`,
            `[strudel-scalenav] Unknown chord "${data.chordData}". Keeping the previous chord.`,
          );
        }
      };
      const notify = () => {
        if (options.onUpdate) {
          try {
            options.onUpdate(state);
          } catch (err) {
            console.warn('[strudel-scalenav] onUpdate callback threw:', err);
          }
        }
      };
      // Only harmony is held for the downbeat; everything else applies now.
      state.raw = data;
      state.bpm = typeof data.bpm === 'number' ? data.bpm : state.bpm;
      state.hostName = data.hostName ?? null;
      state.roomName = data.roomName ?? null;
      state.connected = true;

      const harmonyKey = harmonyKeyOf(data);
      const harmonyChanged = harmonyKey !== lastHarmonyKey;
      lastHarmonyKey = harmonyKey;
      // The FIRST snapshot is the room's current state (a player joining
      // mid-piece), not an early broadcast — apply it instantly. Later
      // snapshots ARE early broadcasts: hold them for the downbeat.
      const holdMs = appliedFirst && harmonyChanged ? readAnticipationMs(data) : 0;
      appliedFirst = true;
      if (harmonyChanged) {
        const seq = ++harmonySeq;
        if (holdMs > 0) {
          const t = setTimeout(() => {
            holdTimers.delete(t);
            if (seq < appliedSeq) return; // a newer change already landed
            appliedSeq = seq;
            applyHarmony();
            notify();
          }, holdMs);
          holdTimers.add(t);
        } else {
          appliedSeq = seq;
          applyHarmony();
        }
      }
      notify();
      firstSnapshotResolve(); // resolve on first data (never wait out a hold)
    },
    (err) => {
      state.connected = false;
      dropHeldChanges();
      console.warn(
        `[strudel-scalenav] Lost connection to room "${roomId}" (${err?.code || err}). ` +
          'Your pattern keeps playing with the last known harmony. This connection is closed: ' +
          'run joinEnsemble() again to reconnect.',
      );
      firstSnapshotResolve(); // resolve on error too
    },
  );

  activeHandles.set(roomId, handle);
  registerUnloadOnce();

  // Wait for first snapshot before returning, but not forever: with no network
  // neither listener callback fires, and the rest of the user's code would
  // never run.
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : FIRST_SNAPSHOT_TIMEOUT_MS;
  let timeoutId;
  const timedOut = await Promise.race([
    firstSnapshot.then(() => false),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  clearTimeout(timeoutId);
  if (timedOut) {
    console.warn(
      `[strudel-scalenav] No response from room "${roomId}" after ${Math.round(timeoutMs / 1000)}s. ` +
        'Check your internet connection. Still listening: harmony will follow once the room responds.',
    );
  }

  const registerPresence = async () => {
    try {
      await setDoc(
        presenceRef,
        {
          userName: user.displayName || (user.isAnonymous ? 'strudel guest' : 'strudel user'),
          clientType: 'strudel',
          joinedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      // Presence is a name tag, not a requirement — never block the music on it.
      console.warn('[strudel-scalenav] could not register presence (non-fatal):', err?.code || err);
    }
  };
  if (timedOut) {
    registerPresence(); // the write also waits for the network; do not wait with it
  } else {
    await registerPresence();
  }

  // Wrap index to handle negatives: -1 = last, -2 = second to last, etc.
  const wrapIndex = (i, len) => ((i % len) + len) % len;

  // Pitch classes are stored in ascending numeric order (C upward). Return them
  // as MIDI notes ascending from the root in octave 4 instead, carrying notes
  // that wrap below the root up an octave. When the root is not among the
  // notes (rootless voicings), start from the first note above it.
  const notesFromRoot = (pcs, root) => {
    if (!pcs.length) return [];
    let start = pcs.findIndex((pc) => pc >= root);
    if (start === -1) start = 0;
    const first = pcs[start];
    return pcs.map((_, k) => {
      const pc = pcs[(start + k) % pcs.length];
      return pc + 60 + (pc < first ? 12 : 0);
    });
  };
  const scaleNotesFromRoot = () => notesFromRoot(state.scale?.pitchClasses ?? [], state.scale?.root ?? 0);
  const chordNotesFromRoot = () => notesFromRoot(state.chord?.pitchClasses ?? [], state.chord?.root ?? 0);

  const scaleNote = (i) => {
    const notes = scaleNotesFromRoot();
    return notes.length ? notes[wrapIndex(i, notes.length)] : 60;
  };
  const chordNote = (i) => {
    const notes = state.chord?.voicing ?? [];
    return notes.length ? notes[wrapIndex(i, notes.length)] : 60;
  };

  // === INTERNAL HELPERS ===
  // Helper to compute stacked third pitch from chord root
  const getChordThirdPitch = (i) => {
    let scalePCs = state.scale?.pitchClasses ?? [];
    const chordRoot = state.chord?.root ?? 0;
    if (!scalePCs.length) return 60;
    let rootIndex = scalePCs.indexOf(chordRoot);
    if (rootIndex === -1) {
      // Chord root outside the scale: start on the chord root itself and
      // continue through the scale tones above it.
      warnOnce(
        `thirds:${state.scale?.id}|${state.chord?.id}`,
        `[strudel-scalenav] Chord root ${state.chord?.rootName ?? chordRoot} is not in the current scale; ` +
          'chord.thirds starts on the chord root and continues through the scale above it.',
      );
      scalePCs = [...scalePCs, chordRoot].sort((a, b) => a - b);
      rootIndex = scalePCs.indexOf(chordRoot);
    }
    const targetIndex = rootIndex + (i * 2);
    const octaveOffset = Math.floor(targetIndex / scalePCs.length);
    const wrappedIndex = ((targetIndex % scalePCs.length) + scalePCs.length) % scalePCs.length;
    return scalePCs[wrappedIndex] + 60 + (octaveOffset * 12);
  };

  // Helper to compute stacked third pitch from scale root (index 0)
  const getScaleThirdPitch = (i) => {
    const notes = scaleNotesFromRoot();
    if (!notes.length) return 60;
    const targetIndex = i * 2;
    const octaveOffset = Math.floor(targetIndex / notes.length);
    const wrappedIndex = ((targetIndex % notes.length) + notes.length) % notes.length;
    return notes[wrappedIndex] + (octaveOffset * 12);
  };

  // Generic arp helper
  const makeArp = (getNotes, pattern = 4) => {
    const sig = getStrudelSignal();
    if (!sig) throw new Error('strudel-scalenav: signal() not found');
    const { indices, n } = parseArpPattern(pattern);
    if (indices) {
      return sig((t) => {
        const notes = getNotes();
        if (!notes.length) return 60;
        const idx = indices[Math.floor(t * indices.length) % indices.length];
        return idx === null ? undefined : notes[wrapIndex(idx, notes.length)];
      })
        .segment(indices.length)
        .filterValues(isNote);
    } else {
      return sig((t) => {
        const notes = getNotes();
        if (!notes.length) return 60;
        return notes[Math.floor(t * n) % notes.length];
      }).segment(n);
    }
  };

  // Generic block helper
  const makeBlock = (getNotes) => {
    const sig = getStrudelSignal();
    if (!sig) throw new Error('strudel-scalenav: signal() not found');
    // Each voice reads the live notes on every query, so the block follows
    // harmony changes. The voice count can change with the chord, so build a
    // fixed number of voices and let the unused ones rest.
    const patterns = [];
    for (let k = 0; k < MAX_BLOCK_VOICES; k++) {
      patterns.push(
        sig(() => getNotes()[k])
          .segment(1)
          .filterValues((v) => v !== undefined),
      );
    }
    return strudelStack(patterns);
  };

  // === HIERARCHICAL NAMESPACE OBJECTS ===

  // ens.scale.*
  const scaleNamespace = {
    // ens.scale.pitch(i) - i-th scale note counting up from the root (root in octave 4)
    pitch: (i) => {
      const idx = parseIndex(i, 'scale.pitch(i)');
      return strudelSignal(() => scaleNote(idx));
    },

    // ens.scale.arp(n) - arpeggiate scale notes
    arp: (pattern = 4) => makeArp(scaleNotesFromRoot, pattern),

    // ens.scale.block() - all scale notes as block chord
    block: () => makeBlock(scaleNotesFromRoot),

    // ens.scale.thirds.*
    thirds: {
      // ens.scale.thirds.pitch(i) - stacked thirds from scale root
      pitch: (i) => {
        const idx = parseIndex(i, 'scale.thirds.pitch(i)');
        return strudelSignal(() => getScaleThirdPitch(idx));
      },

      // ens.scale.thirds.arp(n) - arpeggiate thirds from scale root
      arp: (pattern = 4) => {
        const sig = getStrudelSignal();
        if (!sig) throw new Error('strudel-scalenav: signal() not found');
        const { indices, n } = parseArpPattern(pattern);
        if (indices) {
          return sig((t) => {
            const idx = indices[Math.floor(t * indices.length) % indices.length];
            return idx === null ? undefined : getScaleThirdPitch(idx);
          })
            .segment(indices.length)
            .filterValues(isNote);
        } else {
          return sig((t) => getScaleThirdPitch(Math.floor(t * n) % n)).segment(n);
        }
      },

      // ens.scale.thirds.block(count) - block chord of stacked thirds from scale root
      block: (count = 4) => {
        const sig = getStrudelSignal();
        if (!sig) throw new Error('strudel-scalenav: signal() not found');
        const patterns = [];
        for (let i = 0; i < count; i++) {
          const idx = i;
          patterns.push(sig(() => getScaleThirdPitch(idx)).segment(1));
        }
        return strudelStack(patterns);
      },
    },
  };

  // ens.chord.voicing.*
  const voicingNamespace = {
    // ens.chord.voicing.pitch(i) - i-th voicing note (original octaves)
    pitch: (i) => {
      const idx = parseIndex(i, 'chord.voicing.pitch(i)');
      return strudelSignal(() => chordNote(idx));
    },

    // ens.chord.voicing.arp(n) - arpeggiate voicing
    arp: (pattern = 4) => makeArp(() => state.chord?.voicing ?? [], pattern),

    // ens.chord.voicing.block() - all voicing notes as block chord
    block: () => makeBlock(() => state.chord?.voicing ?? [60]),
  };

  // ens.chord.closed.*
  const closedNamespace = {
    // ens.chord.closed.pitch(i) - i-th chord note in close position, up from the root (octave 4)
    pitch: (i) => {
      const idx = parseIndex(i, 'chord.closed.pitch(i)');
      return strudelSignal(() => {
        const notes = chordNotesFromRoot();
        return notes.length ? notes[wrapIndex(idx, notes.length)] : 60;
      });
    },

    // ens.chord.closed.arp(n) - arpeggiate closed position
    arp: (pattern = 4) => makeArp(chordNotesFromRoot, pattern),

    // ens.chord.closed.block() - all closed position notes as block chord
    block: () => makeBlock(() => (state.chord ? chordNotesFromRoot() : [60])),
  };

  // ens.chord.thirds.*
  const chordThirdsNamespace = {
    // ens.chord.thirds.pitch(i) - stacked thirds from chord root
    pitch: (i) => {
      const idx = parseIndex(i, 'chord.thirds.pitch(i)');
      return strudelSignal(() => getChordThirdPitch(idx));
    },

    // ens.chord.thirds.arp(n) - arpeggiate thirds from chord root
    arp: (pattern = 4) => {
      const sig = getStrudelSignal();
      if (!sig) throw new Error('strudel-scalenav: signal() not found');
      const { indices, n } = parseArpPattern(pattern);
      if (indices) {
        return sig((t) => {
          const idx = indices[Math.floor(t * indices.length) % indices.length];
          return idx === null ? undefined : getChordThirdPitch(idx);
        })
          .segment(indices.length)
          .filterValues(isNote);
      } else {
        return sig((t) => getChordThirdPitch(Math.floor(t * n) % n)).segment(n);
      }
    },

    // ens.chord.thirds.block(count) - block chord of stacked thirds
    block: (count = 4) => {
      const sig = getStrudelSignal();
      if (!sig) throw new Error('strudel-scalenav: signal() not found');
      const patterns = [];
      for (let i = 0; i < count; i++) {
        const idx = i;
        patterns.push(sig(() => getChordThirdPitch(idx)).segment(1));
      }
      return strudelStack(patterns);
    },
  };

  // ens.chord.*
  const chordNamespace = {
    voicing: voicingNamespace,
    closed: closedNamespace,
    thirds: chordThirdsNamespace,
  };

  const api = {
    roomId,
    get state() {
      return state;
    },

    // === HIERARCHICAL API (PRIMARY) ===
    scale: scaleNamespace,
    chord: chordNamespace,

    // === SCALE DATA (flat, for convenience) ===
    scaleRoot: strudelSignal(() => state.scale?.root ?? 0),
    scaleRootNote: strudelSignal(() => (state.scale?.root ?? 0) + 60),
    get scalePitchClasses() {
      return state.scale?.pitchClasses ?? [];
    },
    get scaleNotes() {
      return scaleNotesFromRoot();
    },
    strudelScale: strudelSignal(() => state.scale?.strudelScale ?? lastStrudelScale ?? 'C:major'),
    scaleName: strudelSignal(() => state.scale?.id ?? 'unknown'),
    scaleClass: strudelSignal(() => state.scale?.scaleClass ?? 'unknown'),
    scaleRootName: strudelSignal(() => state.scale?.rootName ?? 'C'),
    get scalePretty() {
      return state.scale?.prettyName ?? '';
    },

    // === CHORD DATA (flat, for convenience) ===
    chordRoot: strudelSignal(() => state.chord?.root ?? 0),
    chordRootNote: strudelSignal(() => (state.chord?.root ?? 0) + 36),
    get chordVoicing() {
      return state.chord?.voicing ?? [];
    },
    get chordPitchClasses() {
      return state.chord?.pitchClasses ?? [];
    },
    get chordClosed() {
      return chordNotesFromRoot();
    },
    chordRootName: strudelSignal(() => state.chord?.rootName ?? 'C'),
    chordType: strudelSignal(() => state.chord?.chordType ?? 'unknown'),
    get chordNoteNames() {
      return state.chord?.noteNames ?? [];
    },
    get chordPretty() {
      return state.chord?.prettyName ?? '';
    },

    // === OTHER ===
    bpm: strudelSignal(() => state.bpm),
    get hostName() {
      return state.hostName;
    },
    get roomName() {
      return state.roomName;
    },

    // === FLAT ALIASES (backwards compatibility) ===
    // These mirror the hierarchical API for users who prefer flat access

    // Scale pitch helpers
    scalePitch: (i) => scaleNamespace.pitch(i),

    // Chord voicing pitch helpers
    chordVoicingPitch: (i) => voicingNamespace.pitch(i),
    voicingPitch: (i) => voicingNamespace.pitch(i),
    chordPitch: (i) => voicingNamespace.pitch(i),

    // Chord closed pitch helpers
    chordClosedPitch: (i) => closedNamespace.pitch(i),
    closedPitch: (i) => closedNamespace.pitch(i),

    // Stacked thirds (from chord root)
    stackThird: (i) => chordThirdsNamespace.pitch(i),

    // Arps (flat)
    arpScale: (pattern = 4) => scaleNamespace.arp(pattern),
    arp: (pattern = 4) => voicingNamespace.arp(pattern),
    arpVoicing: (pattern = 4) => voicingNamespace.arp(pattern),
    arpClosed: (pattern = 4) => closedNamespace.arp(pattern),
    arpThirds: (pattern = 4) => chordThirdsNamespace.arp(pattern),

    // Blocks (flat)
    blockVoicing: () => voicingNamespace.block(),
    block: () => voicingNamespace.block(),
    blockClosed: () => closedNamespace.block(),
    blockThirds: (count = 4) => chordThirdsNamespace.block(count),

    // Optional name tag: shows up in the room's connected-players list
    setName: async (name) => {
      if (!name || typeof name !== 'string') {
        throw new Error('strudel-scalenav: setName requires a non-empty string, e.g. ens.setName("Tyler")');
      }
      if (left) {
        throw new Error('strudel-scalenav: setName called after leave(). Join the room again first.');
      }
      try {
        await updateProfile(user, { displayName: name });
      } catch (err) {
        console.warn(
          '[strudel-scalenav] setName: could not save the name to your profile, so it will not be ' +
            'remembered on the next join:',
          err?.code || err,
        );
      }
      await setDoc(presenceRef, { userName: name }, { merge: true });
    },

    leave: async () => {
      // A handle that was already replaced by a newer join for this room must
      // not remove the presence entry the newer one is using.
      const current = activeHandles.get(roomId) === handle;
      left = true;
      handle.teardown();
      if (!current) return;
      try {
        await deleteDoc(presenceRef);
      } catch (err) {
        console.warn('[strudel-scalenav] leave: presence cleanup failed:', err);
      }
    },

    // Show the scale badge in Strudel REPL header area
    // Just call ens.showBadge() - it handles everything
    // Only one badge runs at a time: calling it again replaces the previous one.
    // Returns a function that stops the badge (null if drawing is unavailable).
    showBadge(options = {}) {
      if (stopActiveBadge) stopActiveBadge();
      stopBadge = startBadgeDrawing({ state, roomId }, options);
      stopActiveBadge = stopBadge;
      return stopBadge;
    },

    // Embed the deployed Enter portal as a collapsible strip over the REPL
    // (strudel-scalenav#5). The HUD is the portal: harmony, direction union,
    // and form strip all render from one portal codebase — UI fixes reach
    // Strudel the moment enter deploys, no package update needed.
    showPortal(options = {}) {
      return createPortalDock(roomId, options);
    },

    // Get current scale color
    get scaleColor() {
      const s = state.scale;
      return s ? getScaleColor(s.root, s.scaleClass) : '#ffffff';
    },
  };

  return api;
}

export { pcToNoteName, midiToNoteName, resolveScale, resolveChord, resolveScaleInfo, resolveChordInfo, formatScaleName, formatChordName };
export { getScaleColor, getPolygonVertices, drawScaleBadge, PITCH_CLASS_COLORS };
