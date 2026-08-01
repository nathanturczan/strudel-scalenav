// Scale visualization helpers for Strudel's draw() API

// Pitch class colors (same as Dashboard/Ensemble-Jammer)
export const PITCH_CLASS_COLORS = {
  0: "#ff496d",  // C
  1: "#01cb91",  // C#/Db
  2: "#da8eff",  // D
  3: "#fbe906",  // D#/Eb
  4: "#017ae6",  // E
  5: "#ee7a3c",  // F
  6: "#08d2d1",  // F#/Gb
  7: "#ff73cb",  // G
  8: "#8eff04",  // G#/Ab
  9: "#877df9",  // A
  10: "#ffab00", // A#/Bb
  11: "#03a6d0", // B
};

function mapValue(n, inMin, inMax, outMin, outMax) {
  return outMin + ((n - inMin) * (outMax - outMin)) / (inMax - inMin);
}

/**
 * Get color for a scale based on root and scale class.
 * Normal scales use pitch class colors.
 * Symmetric scales (whole_tone, octatonic, hexatonic) use grayscale.
 */
export function getScaleColor(root, scaleClass) {
  const pc = ((root % 12) + 12) % 12;

  if (scaleClass === 'whole_tone') {
    const group = pc % 2;
    const v = Math.round(mapValue(group, 0, 1, 200, 150));
    return `rgb(${v}, ${v}, ${v})`;
  }
  if (scaleClass === 'octatonic') {
    const group = pc % 3;
    const v = Math.round(mapValue(group, 0, 2, 200, 133));
    return `rgb(${v}, ${v}, ${v})`;
  }
  if (scaleClass === 'hexatonic') {
    const group = pc % 4;
    const v = Math.round(mapValue(group, 0, 3, 200, 100));
    return `rgb(${v}, ${v}, ${v})`;
  }

  return PITCH_CLASS_COLORS[pc] || '#ffffff';
}

/**
 * Get polygon vertices for a scale class.
 * Returns array of [x, y] pairs normalized so max extent = 1.
 * Matches the shapes from Dashboard's Polygon.js.
 */
export function getPolygonVertices(scaleClass) {
  const TWO_PI = Math.PI * 2;
  let raw;

  switch (scaleClass) {
    case 'diatonic': {
      // Hexagon with angle offset (6 sides)
      raw = [];
      const angle = TWO_PI / 6;
      const offset = TWO_PI / 12;
      for (let i = 0; i < 6; i++) {
        const a = i * angle + offset;
        raw.push([Math.cos(a), Math.sin(a)]);
      }
      break;
    }

    case 'acoustic': {
      // Horizontal rectangle
      raw = [
        [1, 0.5],
        [-1, 0.5],
        [-1, -0.5],
        [1, -0.5],
      ];
      break;
    }

    case 'whole_tone': {
      // Vertical rectangle
      raw = [
        [-0.5, -1],
        [0.5, -1],
        [0.5, 1],
        [-0.5, 1],
      ];
      break;
    }

    case 'hexatonic': {
      // Triangle (pointing left)
      raw = [
        [0.65, 1],
        [0.65, -1],
        [-1, 0.01],
      ];
      break;
    }

    case 'octatonic': {
      // Octagon (8 sides)
      raw = [];
      const angle = TWO_PI / 8;
      const offset = TWO_PI / 16;
      for (let i = 0; i < 8; i++) {
        const a = i * angle + offset;
        raw.push([Math.cos(a), Math.sin(a)]);
      }
      break;
    }

    case 'harmonic_major': {
      // Right side higher than left - exact Dashboard coords
      raw = [
        [1, 0.25],
        [-1, 0.75],
        [-1, -0.25],
        [1, -1],
      ];
      break;
    }

    case 'harmonic_minor': {
      // Left side higher than right - exact Dashboard coords
      raw = [
        [1, 0.75],
        [-1, 0.25],
        [-1, -1],
        [1, -0.25],
      ];
      break;
    }

    default: {
      // Circle fallback (12-gon)
      raw = [];
      const angle = TWO_PI / 12;
      for (let i = 0; i < 12; i++) {
        const a = i * angle;
        raw.push([Math.cos(a), Math.sin(a)]);
      }
      break;
    }
  }

  // Return raw coordinates - don't normalize, Dashboard coords are intentional
  return raw;
}

/**
 * Draw a scale badge on a canvas context.
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} size - Radius of the shape
 * @param {number} root - Scale root (0-11)
 * @param {string} scaleClass - Scale class name
 * @param {object} options - Optional: { fill: true, stroke: true, strokeWidth: 2 }
 */
export function drawScaleBadge(ctx, x, y, size, root, scaleClass, options = {}) {
  const { fill = true, stroke = false, strokeWidth = 2 } = options;

  const color = getScaleColor(root, scaleClass);
  const vertices = getPolygonVertices(scaleClass);

  ctx.beginPath();
  vertices.forEach(([vx, vy], i) => {
    const px = x + vx * size;
    const py = y + vy * size;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.closePath();

  if (fill) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

/**
 * Start drawing the scale badge in Strudel REPL.
 * Automatically positions to the right of the header and updates on scale/chord changes.
 * @param {object} stateGetter - The ens object from joinEnsemble()
 * @param {object} options - { x, y, size, showText, interval }
 */
export function startBadgeDrawing(stateGetter, options = {}) {
  const {
    x = 480,           // X position (default: right of "REPL (warm)")
    y = 38,            // Y center position
    size = 26,         // Polygon radius (20% larger)
    showText = true,   // Show scale/chord names
    interval = 200,    // Update interval ms
  } = options;

  // Get Strudel's canvas context
  const getCtx = typeof getDrawContext === 'function'
    ? getDrawContext
    : (typeof globalThis.getDrawContext === 'function' ? globalThis.getDrawContext : null);

  if (!getCtx) {
    console.warn('[strudel-scalenav] getDrawContext not found - badge drawing unavailable');
    return null;
  }

  const ctx = getCtx();
  let lastKey = null;

  // Room label: rehearsal rooms are amber, everything else is "live" green.
  const roomId = stateGetter.roomId || '';
  const isRehearsal = roomId.startsWith('rehearse-');
  const roomLabel = isRehearsal ? 'REHEARSAL' : 'LIVE';
  const roomColor = isRehearsal ? '#ffab00' : '#2ecc71';

  function draw() {
    const st = stateGetter.state || {};
    const scale = st.scale;
    const currentScale = scale?.prettyName || '';
    const currentChord = st.chord?.prettyName || '';
    const connected = st.connected !== false;

    // Only redraw if changed
    const key = `${connected}|${currentScale}|${currentChord}`;
    if (key === lastKey) return;
    lastKey = key;

    // Reset transform to identity (Strudel visualizers may modify it)
    ctx.resetTransform();

    // Cover previous content with background color (avoids flicker from clearRect)
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(x - 50, 0, 500, 80);

    // Room label (top line)
    if (roomId) {
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = roomColor;
      ctx.fillText(`\u25CF ${roomLabel} \u2014 ${roomId}`, x + 70, y - 26);
    }

    // Not connected yet (room missing or connection lost)
    if (!connected || !scale) {
      ctx.font = '15px monospace';
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText(`waiting for room "${roomId}"\u2026`, x + 70, y + 2);
      return;
    }

    // Draw polygon
    const color = getScaleColor(scale.root, scale.scaleClass);
    const vertices = getPolygonVertices(scale.scaleClass);
    const cx = x + 25, cy = y;

    ctx.fillStyle = color;
    ctx.beginPath();
    vertices.forEach(([vx, vy], i) => {
      const px = cx + vx * size;
      const py = cy + vy * size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();

    // Draw text labels
    if (showText) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 19px monospace';
      ctx.fillText(currentScale, x + 70, y - 4);

      ctx.font = '17px monospace';
      ctx.fillStyle = '#aaaaaa';
      ctx.fillText(currentChord, x + 70, y + 18);
    }
  }

  // Initial draw + interval
  draw();
  const intervalId = setInterval(draw, interval);

  // Return cleanup function
  return () => clearInterval(intervalId);
}
