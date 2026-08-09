// Portal dock (strudel-scalenav#5): embed the deployed Enter portal in a
// collapsible strip over the REPL. The HUD *is* the portal — one portal
// codebase, embedded everywhere — so every portal fix (accidentals,
// direction union, form strip) reaches Strudel the moment enter deploys,
// with no npm publish needed for UI changes.
//
// The dock is a fixed-position overlay: it never reflows the editor — the
// livecoder's code stays the primary surface. The iframe is display-only,
// so Web MIDI and pattern playback are unaffected.
//
// This package's whole UI surface here: dock container, expand/collapse,
// remember state. Everything inside the iframe belongs to the portal
// (lalork-website#118 adds the chrome-less ?view=strip layout portal-side).

const PORTAL_ORIGIN = 'https://enter.lalaptoporchestra.com';
const DOCK_ID = 'scalenav-portal-dock';
const STATE_KEY = 'strudel-scalenav:portal-dock-state';

// bar = thin header only · strip = compact HUD · tall = full portal view
const SIZES = { strip: '190px', tall: '70vh' };

function loadState() {
  try {
    const s = localStorage.getItem(STATE_KEY);
    if (s === 'bar' || s === 'strip' || s === 'tall') return s;
  } catch {}
  return 'strip';
}

function saveState(state) {
  try {
    localStorage.setItem(STATE_KEY, state);
  } catch {}
}

function makeButton(label, title) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.title = title;
  Object.assign(btn.style, {
    background: 'none',
    border: '1px solid #444',
    borderRadius: '3px',
    color: '#ccc',
    font: '11px monospace',
    lineHeight: '1',
    padding: '2px 7px',
    cursor: 'pointer',
  });
  return btn;
}

/**
 * Create (or reuse) the portal dock for a room.
 * @param {string} roomId - Ensemble room id (from joinEnsemble)
 * @param {object} options - { origin } override for the portal origin
 * @returns {object|null} control: { expand, collapse, toggle, hide, remove, element }
 */
export function createPortalDock(roomId, options = {}) {
  if (typeof document === 'undefined') {
    console.warn('[strudel-scalenav] showPortal needs a browser DOM');
    return null;
  }

  const origin = options.origin || PORTAL_ORIGIN;
  // Room in the path (the portal's real route); ?view=strip is the
  // portal-side compact layout (lalork-website#118) — harmlessly ignored
  // until it ships, then it starts working here with no package update.
  const src = `${origin}/${encodeURIComponent(roomId)}?view=strip`;

  // Idempotent: one dock per page. Re-calling retargets + reveals it.
  const existing = document.getElementById(DOCK_ID);
  if (existing && existing.__scalenavControl) {
    const frame = existing.querySelector('iframe');
    if (frame && frame.src !== src) {
      frame.src = src;
      frame.title = `LALORK portal \u2014 ${roomId}`;
    }
    const label = existing.querySelector('span');
    if (label) label.textContent = `LALORK PORTAL \u2014 ${roomId}`;
    existing.style.display = 'flex';
    return existing.__scalenavControl;
  }

  let state = loadState();

  const dock = document.createElement('div');
  dock.id = DOCK_ID;
  Object.assign(dock.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a0a',
    borderTop: '1px solid #333',
  });

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '3px 10px',
    font: 'bold 11px monospace',
    color: '#888',
    letterSpacing: '0.08em',
    userSelect: 'none',
  });

  const label = document.createElement('span');
  label.textContent = `LALORK PORTAL \u2014 ${roomId}`;
  Object.assign(label.style, { flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

  const sizeBtn = makeButton('\u2922', 'Toggle full portal view');
  const collapseBtn = makeButton('\u25BE', 'Collapse to a thin bar');
  const closeBtn = makeButton('\u2715', 'Hide the portal (ens.showPortal() brings it back)');

  bar.append(label, sizeBtn, collapseBtn, closeBtn);

  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = `LALORK portal \u2014 ${roomId}`;
  Object.assign(frame.style, {
    flex: '1 1 auto',
    width: '100%',
    border: 'none',
    background: '#0a0a0a',
  });

  dock.append(bar, frame);

  function apply() {
    if (state === 'bar') {
      frame.style.display = 'none';
      dock.style.height = 'auto';
      collapseBtn.textContent = '\u25B4';
      collapseBtn.title = 'Restore the portal strip';
    } else {
      frame.style.display = 'block';
      dock.style.height = SIZES[state];
      collapseBtn.textContent = '\u25BE';
      collapseBtn.title = 'Collapse to a thin bar';
    }
    saveState(state);
  }

  let lastOpenSize = state === 'tall' ? 'tall' : 'strip';
  collapseBtn.onclick = () => {
    state = state === 'bar' ? lastOpenSize : 'bar';
    apply();
  };
  sizeBtn.onclick = () => {
    state = state === 'tall' ? 'strip' : 'tall';
    lastOpenSize = state;
    apply();
  };
  closeBtn.onclick = () => {
    dock.style.display = 'none';
  };

  apply();
  document.body.appendChild(dock);

  const control = {
    element: dock,
    expand() {
      state = 'tall';
      lastOpenSize = 'tall';
      apply();
      dock.style.display = 'flex';
    },
    collapse() {
      state = 'bar';
      apply();
    },
    toggle() {
      state = state === 'bar' ? lastOpenSize : 'bar';
      apply();
    },
    hide() {
      dock.style.display = 'none';
    },
    remove() {
      dock.remove();
    },
  };
  dock.__scalenavControl = control;
  return control;
}
