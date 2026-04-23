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

import { resolveScale, resolveChord, pcToNoteName, midiToNoteName } from './resolver.js';

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

  const scalePC = (i) => state.scale?.pitchClasses?.[i % (state.scale?.pitchClasses?.length || 1)] ?? 0;
  const chordNote = (i) => {
    const notes = state.chord?.voicing ?? [];
    return notes.length ? notes[i % notes.length] : 60;
  };

  const api = {
    roomId,
    get state() {
      return state;
    },

    // === SCALE ===
    // Pitch class (0-11)
    scaleRoot: strudelSignal(() => state.scale?.root ?? 0),
    // Playable note (octave 4)
    scaleRootNote: strudelSignal(() => (state.scale?.root ?? 0) + 60),
    // Pitch classes array
    get scalePitchClasses() {
      return state.scale?.pitchClasses ?? [];
    },
    // Playable notes (octave 4)
    get scaleNotes() {
      return (state.scale?.pitchClasses ?? []).map(pc => pc + 60);
    },
    // For .scale() function
    strudelScale: strudelSignal(() => state.scale?.strudelScale ?? 'C:major'),
    // Metadata
    scaleName: strudelSignal(() => state.scale?.id ?? 'unknown'),
    scaleClass: strudelSignal(() => state.scale?.scaleClass ?? 'unknown'),
    scaleRootName: strudelSignal(() => state.scale?.rootName ?? 'C'),

    // === CHORD ===
    // Pitch class (0-11)
    chordRoot: strudelSignal(() => state.chord?.root ?? 0),
    // Playable note (octave 2 for bass)
    chordRootNote: strudelSignal(() => (state.chord?.root ?? 0) + 36),
    // Original voicing (MIDI notes as specified)
    get chordVoicing() {
      return state.chord?.voicing ?? [];
    },
    // Pitch classes array
    get chordPitchClasses() {
      return state.chord?.pitchClasses ?? [];
    },
    // Close position (pitch classes in octave 4)
    get chordClosed() {
      return (state.chord?.pitchClasses ?? []).map(pc => pc + 60);
    },
    // Metadata
    chordRootName: strudelSignal(() => state.chord?.rootName ?? 'C'),
    chordType: strudelSignal(() => state.chord?.chordType ?? 'unknown'),
    get chordNoteNames() {
      return state.chord?.noteNames ?? [];
    },

    // === OTHER ===
    bpm: strudelSignal(() => state.bpm),
    get hostName() {
      return state.hostName;
    },
    get roomName() {
      return state.roomName;
    },

    // === HELPERS ===
    // Get i-th scale pitch class in octave 4
    scalePitch: (i) => strudelSignal(() => scalePC(i) + 60),
    // Get i-th chord voicing note
    chordPitch: (i) => strudelSignal(() => chordNote(i)),
    // Get i-th chord pitch class in octave 4
    chordClosedPitch: (i) => strudelSignal(() => {
      const pcs = state.chord?.pitchClasses ?? [];
      const pc = pcs.length ? pcs[i % pcs.length] : 0;
      return pc + 60;
    }),

    // Clean arpeggiator: ens.arp(4) or ens.arp("0 2 1 3")
    arp(pattern = 4) {
      const sig = getStrudelSignal();
      if (!sig) throw new Error('strudel-scalenav: signal() not found');
      if (typeof pattern === 'number') {
        // arp(4) = cycle through chord notes at rate 4
        return sig((t) => {
          const notes = state.chord?.voicing ?? [];
          if (!notes.length) return 60;
          return notes[Math.floor(t * pattern) % notes.length];
        }).segment(pattern);
      } else {
        // arp("0 2 1 3") = play chord indices in that order
        const indices = pattern.split(/\s+/).map(Number);
        return sig((t) => {
          const notes = state.chord?.voicing ?? [];
          if (!notes.length) return 60;
          const idx = indices[Math.floor(t * indices.length) % indices.length];
          return notes[idx % notes.length];
        }).segment(indices.length);
      }
    },

    // Block chord: ens.block() plays all notes at once
    block() {
      const sig = getStrudelSignal();
      if (!sig) throw new Error('strudel-scalenav: signal() not found');
      const notes = state.chord?.voicing ?? [60];
      // Return stacked signals for each note
      const patterns = notes.map((_, i) => sig(() => chordNote(i)).segment(1));
      if (typeof globalThis.stack === 'function') {
        return globalThis.stack(...patterns);
      }
      return patterns[0]; // fallback
    },

    leave: async () => {
      unsubRoom();
      try {
        await deleteDoc(presenceRef);
      } catch (err) {
        console.warn('[strudel-scalenav] leave: presence cleanup failed:', err);
      }
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

export { pcToNoteName, midiToNoteName, resolveScale, resolveChord };
