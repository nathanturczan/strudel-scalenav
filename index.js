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

function strudelSignal(fn) {
  const g = globalThis;
  if (typeof g.signal === 'function') return g.signal(fn);
  if (typeof g.strudel?.signal === 'function') return g.strudel.signal(fn);
  throw new Error(
    'strudel-scalenav: Strudel `signal()` not found in global scope. ' +
      'Run this inside the Strudel REPL (strudel.cc) or import `{ signal }` from `@strudel/core` before importing this package.',
  );
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

  const unsubRoom = onSnapshot(
    roomRef,
    (snap) => {
      if (!snap.exists()) {
        state.connected = false;
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
    },
  );

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

    scaleRoot: strudelSignal(() => state.scale?.root ?? 0),
    scaleName: strudelSignal(() => state.scale?.id ?? 'unknown'),
    strudelScale: strudelSignal(() => state.scale?.strudelScale ?? 'C:major'),
    scaleClass: strudelSignal(() => state.scale?.scaleClass ?? 'unknown'),
    scaleRootName: strudelSignal(() => state.scale?.rootName ?? 'C'),

    chordRoot: strudelSignal(() => state.chord?.root ?? 0),
    chordRootName: strudelSignal(() => state.chord?.rootName ?? 'C'),
    chordType: strudelSignal(() => state.chord?.chordType ?? 'unknown'),
    bpm: strudelSignal(() => state.bpm),

    get pitchClasses() {
      return state.scale?.pitchClasses ?? [];
    },
    get chordNotes() {
      return state.chord?.voicing ?? [];
    },
    get chordNoteNames() {
      return state.chord?.noteNames ?? [];
    },
    get chordPitchClasses() {
      return state.chord?.pitchClasses ?? [];
    },
    get hostName() {
      return state.hostName;
    },
    get roomName() {
      return state.roomName;
    },

    scalePitch: (i) => strudelSignal(() => scalePC(i)),
    chordPitch: (i) => strudelSignal(() => chordNote(i)),

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
