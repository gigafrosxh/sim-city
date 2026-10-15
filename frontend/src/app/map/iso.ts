/** Isometric projection helpers. Tile (x, y) spans u ∈ [x, x+1], v ∈ [y, y+1]. */

export const TW = 64;
export const TH = 32;

export interface Camera {
  /** Screen position (CSS px) of world origin. */
  x: number;
  y: number;
  zoom: number;
}

export interface Pt {
  x: number;
  y: number;
}

export function project(u: number, v: number, z = 0): Pt {
  return { x: (u - v) * (TW / 2), y: (u + v) * (TH / 2) - z };
}

/** Converts a screen position (CSS px) into fractional tile coordinates. */
export function screenToTile(sx: number, sy: number, cam: Camera): Pt {
  const wx = (sx - cam.x) / cam.zoom;
  const wy = (sy - cam.y) / cam.zoom;
  const a = wx / (TW / 2);
  const b = wy / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function tileCenterScreen(x: number, y: number, cam: Camera): Pt {
  const p = project(x + 0.5, y + 0.5);
  return { x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y };
}

/** All tiles on a straight-ish L-shaped path from a to b (horizontal first). */
export function linePath(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  out.push({ x, y });
  // Walk along the longer axis first so short drags feel natural.
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    while (x !== b.x) out.push({ x: (x += dx), y });
    while (y !== b.y) out.push({ x, y: (y += dy) });
  } else {
    while (y !== b.y) out.push({ x, y: (y += dy) });
    while (x !== b.x) out.push({ x: (x += dx), y });
  }
  return out;
}

export function rectArea(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}
