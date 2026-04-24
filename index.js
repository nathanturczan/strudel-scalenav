import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

import { resolveScale, resolveChord, pcToNoteName, midiToNoteName, formatScaleName, formatChordName } from './resolver.js';
import { getScaleColor, getPolygonVertices, drawScaleBadge, startBadgeDrawing, PITCH_CLASS_COLORS } from './visual.js';

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
  await updateDoc(doc(getFbDb(), 'users', user.uid), { userName: name });
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

  const user = getCurrentUser();
  if (!user) {
    throw new Error(
      'strudel-scalenav: not signed in. Call signInWithGoogle(), signInWithEmail(), or signUpWithEmail() first.',
    );
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

  const unsubRoom = onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) {
        state.connected = false;
        firstSnapshotResolve(); // resolve even if room doesn't exist
        return;
      }
      const data = snap.data();
      state.raw = data;
      state.scale = resolveScale(data.scaleData);
      state.chord = resolveChord(data.chordData);
      state.bpm = typeof data.bpm === 'number' ? data.bpm : state.bpm;
      state.hostName = data.hostName ?? null;
      state.roomName = data.roomName ?? null;
      state.connected = true;
      firstSnapshotResolve(); // resolve on first data
      if (options.onUpdate) {
        try {
          options.onUpdate(state);
        } catch (err) {
          console.warn('[strudel-scalenav] onUpdate callback threw:', err);
        }
      }
    },
    (err) => {
      console.warn('[strudel-scalenav] room snapshot error:', err);
      firstSnapshotResolve(); // resolve on error too
    },
  );

  // Wait for first snapshot before returning
  await firstSnapshot;

  await setDoc(
    presenceRef,
    {
      userName: user.displayName || user.email?.split('@')[0] || 'strudel user',
      email: user.email ?? null,
      clientType: 'strudel',
      joinedAt: serverTimestamp(),
    },
    { merge: true },
  );

  // Wrap index to handle negatives: -1 = last, -2 = second to last, etc.
  const wrapIndex = (i, len) => ((i % len) + len) % len;

  const scalePC = (i) => {
    const pcs = state.scale?.pitchClasses ?? [];
    return pcs.length ? pcs[wrapIndex(i, pcs.length)] : 0;
  };
  const chordNote = (i) => {
    const notes = state.chord?.voicing ?? [];
    return notes.length ? notes[wrapIndex(i, notes.length)] : 60;
  };

  // === INTERNAL HELPERS ===
  // Helper to compute stacked third pitch from chord root
  const getChordThirdPitch = (i) => {
    const scalePCs = state.scale?.pitchClasses ?? [];
    const chordRoot = state.chord?.root ?? 0;
    if (!scalePCs.length) return 60;
    let rootIndex = scalePCs.indexOf(chordRoot);
    if (rootIndex === -1) rootIndex = 0;
    const targetIndex = rootIndex + (i * 2);
    const octaveOffset = Math.floor(targetIndex / scalePCs.length);
    const wrappedIndex = ((targetIndex % scalePCs.length) + scalePCs.length) % scalePCs.length;
    return scalePCs[wrappedIndex] + 60 + (octaveOffset * 12);
  };

  // Helper to compute stacked third pitch from scale root (index 0)
  const getScaleThirdPitch = (i) => {
    const scalePCs = state.scale?.pitchClasses ?? [];
    if (!scalePCs.length) return 60;
    const targetIndex = i * 2;
    const octaveOffset = Math.floor(targetIndex / scalePCs.length);
    const wrappedIndex = ((targetIndex % scalePCs.length) + scalePCs.length) % scalePCs.length;
    return scalePCs[wrappedIndex] + 60 + (octaveOffset * 12);
  };

  // Generic arp helper
  const makeArp = (getNotes, pattern = 4) => {
    const sig = getStrudelSignal();
    if (!sig) throw new Error('strudel-scalenav: signal() not found');
    if (typeof pattern === 'number') {
      return sig((t) => {
        const notes = getNotes();
        if (!notes.length) return 60;
        return notes[Math.floor(t * pattern) % notes.length];
      }).segment(pattern);
    } else {
      const indices = pattern.split(/\s+/).map(Number);
      return sig((t) => {
        const notes = getNotes();
        if (!notes.length) return 60;
        const idx = indices[Math.floor(t * indices.length) % indices.length];
        return notes[idx % notes.length];
      }).segment(indices.length);
    }
  };

  // Generic block helper
  const makeBlock = (getNotes) => {
    const sig = getStrudelSignal();
    if (!sig) throw new Error('strudel-scalenav: signal() not found');
    const notes = getNotes();
    const patterns = notes.map((n) => sig(() => n).segment(1));
    if (typeof globalThis.stack === 'function') {
      return globalThis.stack(...patterns);
    }
    return patterns[0];
  };

  // === HIERARCHICAL NAMESPACE OBJECTS ===

  // ens.scale.*
  const scaleNamespace = {
    // ens.scale.pitch(i) - i-th scale note in octave 4
    pitch: (i) => strudelSignal(() => scalePC(i) + 60),

    // ens.scale.arp(n) - arpeggiate scale notes
    arp: (pattern = 4) => makeArp(() => (state.scale?.pitchClasses ?? []).map(pc => pc + 60), pattern),

    // ens.scale.block() - all scale notes as block chord
    block: () => makeBlock(() => (state.scale?.pitchClasses ?? []).map(pc => pc + 60)),

    // ens.scale.thirds.*
    thirds: {
      // ens.scale.thirds.pitch(i) - stacked thirds from scale root
      pitch: (i) => strudelSignal(() => getScaleThirdPitch(i)),

      // ens.scale.thirds.arp(n) - arpeggiate thirds from scale root
      arp: (pattern = 4) => {
        const sig = getStrudelSignal();
        if (!sig) throw new Error('strudel-scalenav: signal() not found');
        if (typeof pattern === 'number') {
          return sig((t) => getScaleThirdPitch(Math.floor(t * pattern) % pattern)).segment(pattern);
        } else {
          const indices = pattern.split(/\s+/).map(Number);
          return sig((t) => {
            const idx = indices[Math.floor(t * indices.length) % indices.length];
            return getScaleThirdPitch(idx);
          }).segment(indices.length);
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
        if (typeof globalThis.stack === 'function') {
          return globalThis.stack(...patterns);
        }
        return patterns[0];
      },
    },
  };

  // ens.chord.voicing.*
  const voicingNamespace = {
    // ens.chord.voicing.pitch(i) - i-th voicing note (original octaves)
    pitch: (i) => strudelSignal(() => chordNote(i)),

    // ens.chord.voicing.arp(n) - arpeggiate voicing
    arp: (pattern = 4) => makeArp(() => state.chord?.voicing ?? [], pattern),

    // ens.chord.voicing.block() - all voicing notes as block chord
    block: () => makeBlock(() => state.chord?.voicing ?? [60]),
  };

  // ens.chord.closed.*
  const closedNamespace = {
    // ens.chord.closed.pitch(i) - i-th chord note in close position (octave 4)
    pitch: (i) => strudelSignal(() => {
      const pcs = state.chord?.pitchClasses ?? [];
      const pc = pcs.length ? pcs[wrapIndex(i, pcs.length)] : 0;
      return pc + 60;
    }),

    // ens.chord.closed.arp(n) - arpeggiate closed position
    arp: (pattern = 4) => makeArp(() => (state.chord?.pitchClasses ?? []).map(pc => pc + 60), pattern),

    // ens.chord.closed.block() - all closed position notes as block chord
    block: () => makeBlock(() => (state.chord?.pitchClasses ?? [0]).map(pc => pc + 60)),
  };

  // ens.chord.thirds.*
  const chordThirdsNamespace = {
    // ens.chord.thirds.pitch(i) - stacked thirds from chord root
    pitch: (i) => strudelSignal(() => getChordThirdPitch(i)),

    // ens.chord.thirds.arp(n) - arpeggiate thirds from chord root
    arp: (pattern = 4) => {
      const sig = getStrudelSignal();
      if (!sig) throw new Error('strudel-scalenav: signal() not found');
      if (typeof pattern === 'number') {
        return sig((t) => getChordThirdPitch(Math.floor(t * pattern) % pattern)).segment(pattern);
      } else {
        const indices = pattern.split(/\s+/).map(Number);
        return sig((t) => {
          const idx = indices[Math.floor(t * indices.length) % indices.length];
          return getChordThirdPitch(idx);
        }).segment(indices.length);
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
      if (typeof globalThis.stack === 'function') {
        return globalThis.stack(...patterns);
      }
      return patterns[0];
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
      return (state.scale?.pitchClasses ?? []).map(pc => pc + 60);
    },
    strudelScale: strudelSignal(() => state.scale?.strudelScale ?? 'C:major'),
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
      return (state.chord?.pitchClasses ?? []).map(pc => pc + 60);
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

    leave: async () => {
      unsubRoom();
      try {
        await deleteDoc(presenceRef);
      } catch (err) {
        console.warn('[strudel-scalenav] leave: presence cleanup failed:', err);
      }
    },

    // Show the scale badge in Strudel REPL header area
    // Just call ens.showBadge() - it handles everything
    showBadge(options = {}) {
      return startBadgeDrawing({ state }, options);
    },

    // Get current scale color
    get scaleColor() {
      const s = state.scale;
      return s ? getScaleColor(s.root, s.scaleClass) : '#ffffff';
    },
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(
      'beforeunload',
      () => {
        try {
          deleteDoc(presenceRef);
        } catch {}
      },
      { once: true },
    );
  }

  return api;
}

export { pcToNoteName, midiToNoteName, resolveScale, resolveChord, formatScaleName, formatChordName };
export { getScaleColor, getPolygonVertices, drawScaleBadge, PITCH_CLASS_COLORS };
