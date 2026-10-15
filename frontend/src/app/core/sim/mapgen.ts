import { Terrain, Tile } from '../models';
import { hash2 } from './rng';

function smoothNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number): number {
  return (
    smoothNoise(x, y, 16, seed) * 0.55 +
    smoothNoise(x, y, 8, seed + 17) * 0.3 +
    smoothNoise(x, y, 4, seed + 31) * 0.15
  );
}

/** Generates terrain with lakes, a river, beaches and forests. */
export function generateTerrain(width: number, height: number, seed: number): Tile[] {
  const tiles: Tile[] = [];
  // A meandering river crossing the map diagonally.
  const riverOffset = hash2(seed, 7) * width * 0.5 + width * 0.25;
  const riverPhase = hash2(seed, 11) * Math.PI * 2;
  const hasRiver = hash2(seed, 13) > 0.25;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elevation = fbm(x, y, seed);
      const moisture = fbm(x + 999, y + 999, seed + 5);
      const riverCenter = riverOffset + Math.sin(y / 9 + riverPhase) * 5 + y * 0.15;
      const riverDist = Math.abs(x - riverCenter);
      // Keep the spawn area around the map centre buildable.
      const cx = x - width / 2;
      const cy = y - height / 2;
      const centreFalloff = Math.max(0, 1 - Math.sqrt(cx * cx + cy * cy) / (width * 0.22));

      let terrain: Terrain = 'grass';
      const lake = elevation < 0.25 - centreFalloff * 0.2;
      const river = hasRiver && riverDist < 1.6;
      if (lake || river) {
        terrain = 'water';
      } else if (elevation < 0.28 || (hasRiver && riverDist < 2.6)) {
        terrain = 'sand';
      } else if (moisture > 0.6 && centreFalloff < 0.6) {
        terrain = 'forest';
      }
      tiles.push({
        x,
        y,
        terrain,
        zone: null,
        building: null,
        powered: false,
        watered: false,
        landValue: 0,
        pollution: 0,
        crime: 0,
        traffic: 0,
      });
    }
  }
  return tiles;
}
