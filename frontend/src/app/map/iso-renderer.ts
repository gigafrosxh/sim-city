import { Floater } from '../core/game.service';
import { BuildingType, Coord, Overlay, ServiceBuildingType, Tile, ZoneType } from '../core/models';
import { hash2 } from '../core/sim/rng';
import { Camera, project, Pt, TH, TW } from './iso';

export interface Preview {
  cells: Coord[];
  valid: boolean[];
  /** Ghost building for service tools. */
  ghost?: { type: ServiceBuildingType; x: number; y: number; size: number; valid: boolean; radius?: number };
  label?: string;
}

export interface RenderState {
  tiles: Tile[];
  width: number;
  height: number;
  overlay: Overlay;
  /** 0 = day, 1 = deep night */
  night: number;
  /** Simulation speed multiplier for cars (0 = paused). */
  pace: number;
  showGrid: boolean;
  hover: Coord | null;
  selected: Coord | null;
  preview: Preview | null;
  floaters: Floater[];
  population: number;
  season: Season;
  weather: Weather;
}

interface Car {
  from: number;
  to: number;
  prev: number;
  t: number;
  speed: number;
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

const TYPE_CODE: Record<BuildingType, number> = {
  road: 1,
  residential: 2,
  commercial: 3,
  industrial: 4,
  power_coal: 5,
  power_solar: 6,
  water_pump: 7,
  police: 8,
  fire: 9,
  school: 10,
  hospital: 11,
  park: 12,
  power_wind: 13,
  stadium: 14,
  city_hall: 15,
};

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'rain' | 'snow';

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

export const ZONE_COLORS: Record<ZoneType, string> = {
  residential: '#4cd07d',
  commercial: '#4aa8ff',
  industrial: '#ffc145',
};

const SNOW = ['#e9eef3', '#e3e9ef', '#eef2f6', '#dde5ec', '#e6ecf1', '#f0f4f7', '#dbe3ea', '#e8edf2'];
const AUTUMN_GRASS = ['#8a9a46', '#919f4a', '#859443', '#97a44d', '#8b9844', '#9ca64f', '#82913f', '#94a24b'];
const AUTUMN_LEAVES = ['#d9822b', '#c8552d', '#e0a43a', '#b8762c'];
const GRASS = ['#5f9a46', '#62a049', '#5a9543', '#67a44c', '#5c9844', '#6aa64f', '#58923f', '#64a24b'];
const SAND = ['#d8c48f', '#dcc995', '#d3be88'];
const CAR_COLORS = ['#e74c3c', '#f1c40f', '#ecf0f1', '#3498db', '#2c3e50', '#e67e22', '#95a5a6', '#9b59b6'];

const HOUSE_WALLS = ['#efe3c8', '#e8d5b5', '#f4f1ea', '#dfe7ee'];
const HOUSE_ROOFS = ['#b5523b', '#7a4b3a', '#3f5d7a', '#8a3b3b'];
const APT_WALLS = ['#c9826b', '#d9b48f', '#b9b8cc', '#e0c9a6'];
const TOWER_WALLS = ['#d8d4cc', '#9fb3c8', '#c7b9a5', '#b0c4b1'];
const SHOP_WALLS = ['#f0e6d6', '#e9d8c4', '#dcdcdc', '#efe0cf'];
const AWNINGS = ['#e74c3c', '#3498db', '#27ae60', '#f39c12'];
const GLASS = ['#5b8db8', '#6fa3c7', '#7d9db5', '#4f7ea8'];
const SKY_GLASS = ['#3e6e9e', '#2f5f8a', '#4a7aa0', '#36658f'];

const shadeCache = new Map<string, string>();
/** Lightens (amt > 0) or darkens (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  const key = hex + amt;
  let c = shadeCache.get(key);
  if (c) return c;
  let r: number;
  let g: number;
  let b: number;
  if (hex.startsWith('#')) {
    const n = parseInt(hex.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    // Also accept "rgb(r,g,b)" so shades can be chained.
    [r, g, b] = (hex.match(/\d+/g) ?? ['0', '0', '0']).map(Number);
  }
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  c = `rgb(${r | 0},${g | 0},${b | 0})`;
  shadeCache.set(key, c);
  return c;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Canvas 2D isometric renderer. Everything is drawn procedurally, so no image
 * assets are needed. Holds purely cosmetic state (cars, smoke, animations).
 */
export class IsoRenderer {
  private sig = new Int32Array(0);
  private animStart = new Float64Array(0);
  private order = new Int32Array(0);
  private orderW = 0;
  private orderH = 0;
  private initialized = false;
  private cars: Car[] = [];
  private carBuckets = new Map<number, Car[]>();
  private particles: Particle[] = [];
  private lights: number[][] = [];
  private lastTime = 0;
  /** Height multiplier for the building currently drawn (grow animation). */
  private hs = 1;
  private now = 0;
  private night = 0;
  private roadCount = 0;
  private roadTiles: number[] = [];
  private season: Season = 'summer';
  private weatherDrops: { x: number; y: number; v: number }[] = [];

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  reset(): void {
    this.initialized = false;
    this.cars = [];
    this.particles = [];
  }

  render(s: RenderState, cam: Camera, viewW: number, viewH: number, dpr: number, now: number): void {
    const ctx = this.ctx;
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    this.now = now;
    this.night = s.night;
    this.season = s.season;
    this.ensureBuffers(s);

    // Background.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, viewH);
    bg.addColorStop(0, '#16263a');
    bg.addColorStop(1, '#0c1522');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, viewW, viewH);
    if (!s.tiles.length) return;

    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.x, dpr * cam.y);
    const wx0 = -cam.x / cam.zoom - TW;
    const wy0 = -cam.y / cam.zoom - TH * 2;
    const wx1 = wx0 + viewW / cam.zoom + TW * 2;
    const wy1 = wy0 + viewH / cam.zoom + TH * 2;
    const tallMargin = 190;

    const visible: number[] = [];
    const w = s.width;
    this.roadTiles = [];
    for (let k = 0; k < this.order.length; k++) {
      const i = this.order[k];
      const x = i % w;
      const y = (i - x) / w;
      if (s.tiles[i].building?.type === 'road') this.roadTiles.push(i);
      const sx = (x - y) * (TW / 2);
      const sy = (x + y) * (TH / 2);
      if (sx < wx0 || sx > wx1 || sy < wy0 || sy > wy1 + tallMargin) continue;
      visible.push(i);
    }
    this.roadCount = this.roadTiles.length;
    this.trackAnimations(s, now);

    // Pass 1: map edge + ground.
    for (const i of visible) {
      const t = s.tiles[i];
      if (t.x === w - 1 || t.y === s.height - 1) this.drawEdge(t, s);
      this.drawGround(t, s);
    }
    if (s.overlay !== 'none') for (const i of visible) this.drawOverlay(s.tiles[i], s.overlay);
    if (s.showGrid) this.drawGrid(visible, s);
    if (s.preview) this.drawPreviewCells(s.preview);

    // Pass 2: objects in painter's order.
    this.updateCars(s, dt);
    this.lights = [];
    const objAlpha = s.overlay === 'none' ? 1 : 0.55;
    ctx.globalAlpha = objAlpha;
    for (const i of visible) {
      const cars = this.carBuckets.get(i);
      if (cars) for (const c of cars) this.drawCar(c, s);
      const t = s.tiles[i];
      const b = t.building;
      if (b && b.type !== 'road') {
        // Multi-tile buildings are drawn once, at their front-most tile.
        if (t.x === b.originX + b.size - 1 && t.y === b.originY + b.size - 1) {
          const oi = b.originY * w + b.originX;
          const t0 = this.animStart[oi];
          const p = t0 ? Math.min(1, (now - t0) / 650) : 1;
          this.hs = p >= 1 ? 1 : Math.max(0.05, easeOutBack(p));
          this.drawBuilding(b.type, b.originX, b.originY, b.size, b.level, b.variant, s.tiles[oi]);
          this.hs = 1;
        }
      } else if (t.terrain === 'forest') {
        this.drawForest(t);
      }
    }
    ctx.globalAlpha = 1;

    if (s.preview?.ghost) this.drawGhost(s.preview);

    // Pass 3: effects.
    this.updateParticles(dt);
    this.drawParticles();
    this.drawFires(visible, s);
    this.drawWarnings(visible, s);
    if (s.night > 0.02) this.drawNight(s, cam, viewW, viewH, dpr);
    this.drawWeather(s, viewW, viewH, dpr, dt);
    this.drawCursor(s);
    this.drawFloaters(s, now);
  }

  // ----------------------------------------------------------------- setup

  private ensureBuffers(s: RenderState): void {
    const n = s.width * s.height;
    if (this.orderW !== s.width || this.orderH !== s.height) {
      this.orderW = s.width;
      this.orderH = s.height;
      const order: number[] = [];
      for (let sum = 0; sum <= s.width + s.height - 2; sum++) {
        for (let x = Math.max(0, sum - s.height + 1); x <= Math.min(s.width - 1, sum); x++) {
          order.push((sum - x) * s.width + x);
        }
      }
      this.order = Int32Array.from(order);
      this.sig = new Int32Array(n);
      this.animStart = new Float64Array(n);
      this.initialized = false;
      this.cars = [];
    }
  }

  private trackAnimations(s: RenderState, now: number): void {
    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      const b = t.building;
      let sig = 0;
      if (b && b.originX === t.x && b.originY === t.y && b.type !== 'road') {
        sig = TYPE_CODE[b.type] * 8 + b.level;
      }
      if (sig !== this.sig[i]) {
        if (this.initialized && sig > this.sig[i]) {
          this.animStart[i] = now;
          if (b) this.dust(b.originX + b.size / 2, b.originY + b.size / 2, b.size);
        }
        this.sig[i] = sig;
      }
    }
    this.initialized = true;
  }

  // ----------------------------------------------------------------- primitives

  private diamond(u: number, v: number, su: number, sv: number, z = 0): void {
    const ctx = this.ctx;
    const a = project(u, v, z);
    const b = project(u + su, v, z);
    const c = project(u + su, v + sv, z);
    const d = project(u, v + sv, z);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  private poly(pts: Pt[], fill: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /**
   * Draws an isometric box. Returns the base points of the two visible faces
   * so callers can decorate them (windows, doors).
   */
  private box(u: number, v: number, su: number, sv: number, h: number, color: string, z = 0, topColor?: string) {
    h *= this.hs;
    z *= this.hs;
    const A = project(u, v, z);
    const B = project(u + su, v, z);
    const C = project(u + su, v + sv, z);
    const D = project(u, v + sv, z);
    const up = (p: Pt) => ({ x: p.x, y: p.y - h });
    this.poly([D, C, up(C), up(D)], shade(color, -0.08));
    this.poly([C, B, up(B), up(C)], shade(color, -0.3));
    this.poly([up(A), up(B), up(C), up(D)], topColor ?? shade(color, 0.18));
    return { left: [D, C] as [Pt, Pt], right: [C, B] as [Pt, Pt], h, top: [up(A), up(B), up(C), up(D)] };
  }

  /** Horizontal window bands on a face. Lit bands are remembered for the night pass. */
  private windowBands(face: [Pt, Pt], h: number, rows: number, color: string, seed: number, inset = 0.12): void {
    if (h < 8 || rows <= 0) return;
    const ctx = this.ctx;
    const [p0, p1] = face;
    const ax = p0.x + (p1.x - p0.x) * inset;
    const ay = p0.y + (p1.y - p0.y) * inset;
    const bx = p1.x - (p1.x - p0.x) * inset;
    const by = p1.y - (p1.y - p0.y) * inset;
    const step = (h - 4) / rows;
    const bandH = Math.max(1.5, step * 0.45);
    ctx.fillStyle = color;
    for (let r = 0; r < rows; r++) {
      const z = 3 + r * step + step * 0.3;
      ctx.beginPath();
      ctx.moveTo(ax, ay - z);
      ctx.lineTo(bx, by - z);
      ctx.lineTo(bx, by - z - bandH);
      ctx.lineTo(ax, ay - z - bandH);
      ctx.closePath();
      ctx.fill();
      if (this.night > 0.05 && hash2(seed, r) > 0.35) {
        // Split the lit band into a couple of window segments.
        const segs = 3;
        for (let k = 0; k < segs; k++) {
          if (hash2(seed + k, r * 7) < 0.4) continue;
          const f0 = k / segs + 0.04;
          const f1 = (k + 1) / segs - 0.04;
          this.lights.push([
            ax + (bx - ax) * f0, ay + (by - ay) * f0 - z,
            ax + (bx - ax) * f1, ay + (by - ay) * f1 - z,
            ax + (bx - ax) * f1, ay + (by - ay) * f1 - z - bandH,
            ax + (bx - ax) * f0, ay + (by - ay) * f0 - z - bandH,
          ]);
        }
      }
    }
  }

  private cylinder(u: number, v: number, r: number, h: number, color: string, z = 0): Pt {
    const ctx = this.ctx;
    h *= this.hs;
    z *= this.hs;
    const c = project(u, v, z);
    const rx = r * TW * 0.72;
    const ry = rx / 2;
    const grad = ctx.createLinearGradient(c.x - rx, 0, c.x + rx, 0);
    grad.addColorStop(0, shade(color, 0.05));
    grad.addColorStop(0.45, shade(color, -0.05));
    grad.addColorStop(1, shade(color, -0.35));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(c.x - rx, c.y - h);
    ctx.ellipse(c.x, c.y - h, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(color, 0.2);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    return { x: c.x, y: c.y - h };
  }

  private tree(u: number, v: number, scale: number, color: string): void {
    const ctx = this.ctx;
    if (this.season === 'autumn') color = AUTUMN_LEAVES[Math.floor(hash2(Math.round(u * 10), Math.round(v * 10)) * 4)];
    else if (this.season === 'winter') color = '#9fb09a';
    const p = project(u, v);
    const s = scale * this.hs;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(p.x + 2 * s, p.y, 7 * s, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5b3d24';
    ctx.fillRect(p.x - 1.2 * s, p.y - 7 * s, 2.4 * s, 7 * s);
    ctx.fillStyle = shade(color, -0.15);
    ctx.beginPath();
    ctx.arc(p.x + 1.5 * s, p.y - 11 * s, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x - 0.5 * s, p.y - 13 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(color, 0.2);
    ctx.beginPath();
    ctx.arc(p.x - 2 * s, p.y - 15 * s, 2.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  private pine(u: number, v: number, scale: number): void {
    const ctx = this.ctx;
    const p = project(u, v);
    const s = scale;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(p.x + 2 * s, p.y, 6 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a321d';
    ctx.fillRect(p.x - 1 * s, p.y - 5 * s, 2 * s, 5 * s);
    const layers = [
      { y: 4, w: 7, h: 10, c: '#2f6b33' },
      { y: 10, w: 5.5, h: 9, c: '#367a3a' },
      { y: 15, w: 4, h: 8, c: '#3f8a42' },
    ];
    for (const l of layers) {
      ctx.fillStyle = this.season === 'winter' ? shade(l.c, 0.25) : l.c;
      ctx.beginPath();
      ctx.moveTo(p.x - l.w * s, p.y - l.y * s);
      ctx.lineTo(p.x + l.w * s, p.y - l.y * s);
      ctx.lineTo(p.x, p.y - (l.y + l.h) * s);
      ctx.closePath();
      ctx.fill();
      if (this.season === 'winter') {
        // Snow cap on each pine layer.
        ctx.fillStyle = '#f4f8fb';
        ctx.beginPath();
        ctx.moveTo(p.x - l.w * 0.45 * s, p.y - (l.y + l.h * 0.55) * s);
        ctx.lineTo(p.x + l.w * 0.45 * s, p.y - (l.y + l.h * 0.55) * s);
        ctx.lineTo(p.x, p.y - (l.y + l.h) * s);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - l.y * s);
      ctx.lineTo(p.x + l.w * s, p.y - l.y * s);
      ctx.lineTo(p.x, p.y - (l.y + l.h) * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ----------------------------------------------------------------- ground

  private drawEdge(t: Tile, s: RenderState): void {
    const depth = 18;
    const water = t.terrain === 'water';
    const top = water ? '#2a5f8f' : '#7a5a3a';
    if (t.y === s.height - 1) {
      const D = project(t.x, t.y + 1);
      const C = project(t.x + 1, t.y + 1);
      this.poly([D, C, { x: C.x, y: C.y + depth }, { x: D.x, y: D.y + depth }], shade(top, -0.1));
    }
    if (t.x === s.width - 1) {
      const C = project(t.x + 1, t.y + 1);
      const B = project(t.x + 1, t.y);
      this.poly([C, B, { x: B.x, y: B.y + depth }, { x: C.x, y: C.y + depth }], shade(top, -0.35));
    }
  }

  private groundColor(t: Tile): string {
    const h = hash2(t.x, t.y);
    const b = t.building;
    if (b) {
      switch (b.type) {
        case 'road':
          return '#4b4f56';
        case 'residential':
          return b.level >= 2 ? '#9ea39a' : '#78ad5a';
        case 'commercial':
          return '#a3a6a8';
        case 'industrial':
          return '#8f8a80';
        case 'park':
          return this.season === 'winter' ? '#dfe7ec' : '#6cbf55';
        case 'stadium':
          return '#9aa39a';
        case 'power_solar':
          return '#8a9a6e';
        default:
          return '#a9aba6';
      }
    }
    switch (t.terrain) {
      case 'water':
        return '#2e74b5';
      case 'sand':
        return SAND[Math.floor(h * SAND.length)];
      case 'forest':
        return this.season === 'winter' ? '#d5dde4' : this.season === 'autumn' ? '#7d8a3c' : '#4f8a3c';
      default:
        if (this.season === 'winter') return SNOW[Math.floor(h * SNOW.length)];
        if (this.season === 'autumn') return AUTUMN_GRASS[Math.floor(h * AUTUMN_GRASS.length)];
        return GRASS[Math.floor(h * GRASS.length)];
    }
  }

  private drawGround(t: Tile, s: RenderState): void {
    const ctx = this.ctx;
    this.diamond(t.x, t.y, 1, 1);
    ctx.fillStyle = this.groundColor(t);
    ctx.fill();
    // Hairline to hide anti-aliasing seams between tiles.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    if (t.terrain === 'water') {
      const phase = this.now / 900 + t.x * 0.8 + t.y * 0.5;
      const a = 0.12 + 0.1 * Math.sin(phase);
      ctx.strokeStyle = `rgba(200,230,255,${a})`;
      ctx.lineWidth = 1.2;
      const p = project(t.x + 0.3, t.y + 0.55);
      const q = project(t.x + 0.7, t.y + 0.45);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + Math.sin(phase) * 1.5);
      ctx.lineTo(q.x, q.y + Math.sin(phase) * 1.5);
      ctx.stroke();
      // Shoreline foam.
      const shore = this.isLandAt(s, t.x - 1, t.y) || this.isLandAt(s, t.x, t.y - 1);
      if (shore) {
        ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.06 * Math.sin(phase * 1.3)})`;
        this.diamond(t.x, t.y, 1, 1);
        ctx.fill();
      }
      return;
    }

    const b = t.building;
    if (b?.type === 'road') {
      this.drawRoad(t, s);
    } else if (t.zone && !b) {
      const col = ZONE_COLORS[t.zone];
      this.diamond(t.x + 0.1, t.y + 0.1, 0.8, 0.8);
      ctx.fillStyle = col + '40';
      ctx.fill();
      ctx.strokeStyle = col + 'cc';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (t.zone && b) {
      // Small coloured kerb so zones stay recognisable once built.
      this.diamond(t.x + 0.04, t.y + 0.04, 0.92, 0.92);
      ctx.strokeStyle = ZONE_COLORS[t.zone] + '55';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private isLandAt(s: RenderState, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return false;
    return s.tiles[y * s.width + x].terrain !== 'water';
  }

  private isRoad(s: RenderState, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return false;
    return s.tiles[y * s.width + x].building?.type === 'road';
  }

  private drawRoad(t: Tile, s: RenderState): void {
    const ctx = this.ctx;
    const n = [
      this.isRoad(s, t.x - 1, t.y),
      this.isRoad(s, t.x + 1, t.y),
      this.isRoad(s, t.x, t.y - 1),
      this.isRoad(s, t.x, t.y + 1),
    ];
    // Sidewalk edges on sides without a connecting road.
    ctx.strokeStyle = '#8d9096';
    ctx.lineWidth = 2;
    const edge = (a: Pt, b: Pt) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    const A = project(t.x + 0.02, t.y + 0.02);
    const B = project(t.x + 0.98, t.y + 0.02);
    const C = project(t.x + 0.98, t.y + 0.98);
    const D = project(t.x + 0.02, t.y + 0.98);
    if (!n[0]) edge(A, D);
    if (!n[1]) edge(B, C);
    if (!n[2]) edge(A, B);
    if (!n[3]) edge(D, C);

    const c = project(t.x + 0.5, t.y + 0.5);
    const mids = [
      project(t.x, t.y + 0.5),
      project(t.x + 1, t.y + 0.5),
      project(t.x + 0.5, t.y),
      project(t.x + 0.5, t.y + 1),
    ];
    const count = n.filter(Boolean).length;
    ctx.strokeStyle = count > 2 ? 'rgba(255,255,255,0.55)' : '#f2c94c';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      if (!n[k]) continue;
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(mids[k].x, mids[k].y);
    }
    if (count === 0) {
      ctx.moveTo(mids[0].x, mids[0].y);
      ctx.lineTo(mids[1].x, mids[1].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (count > 2) {
      // Zebra crossing hint at intersections.
      this.diamond(t.x + 0.3, t.y + 0.3, 0.4, 0.4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
    }
  }

  private drawGrid(visible: number[], s: RenderState): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const i of visible) {
      const t = s.tiles[i];
      const a = project(t.x, t.y);
      const b = project(t.x + 1, t.y);
      const d = project(t.x, t.y + 1);
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  private drawOverlay(t: Tile, overlay: Overlay): void {
    const ctx = this.ctx;
    let color: string | null = null;
    const relevant = !!t.building || !!t.zone;
    switch (overlay) {
      case 'power':
        if (relevant) color = t.powered ? 'rgba(255,214,0,0.5)' : 'rgba(235,60,60,0.55)';
        break;
      case 'water':
        if (relevant) color = t.watered ? 'rgba(40,170,255,0.55)' : 'rgba(235,60,60,0.55)';
        break;
      case 'landValue':
        if (t.terrain !== 'water') color = `hsla(${t.landValue * 1.25},85%,50%,0.55)`;
        break;
      case 'pollution':
        if (t.pollution > 2) color = `hsla(${40 - t.pollution * 0.4},80%,35%,${0.15 + (t.pollution / 100) * 0.7})`;
        break;
      case 'crime':
        if (t.crime > 2) color = `hsla(0,85%,50%,${0.15 + (t.crime / 100) * 0.7})`;
        break;
      case 'traffic':
        if (t.building?.type === 'road') color = `hsla(${120 - t.traffic * 1.2},85%,50%,0.7)`;
        break;
    }
    if (!color) return;
    this.diamond(t.x, t.y, 1, 1);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawPreviewCells(p: Preview): void {
    const ctx = this.ctx;
    for (let k = 0; k < p.cells.length; k++) {
      const c = p.cells[k];
      this.diamond(c.x, c.y, 1, 1);
      ctx.fillStyle = p.valid[k] ? 'rgba(80,220,140,0.45)' : 'rgba(255,80,80,0.45)';
      ctx.fill();
      ctx.strokeStyle = p.valid[k] ? 'rgba(160,255,200,0.9)' : 'rgba(255,150,150,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawGhost(p: Preview): void {
    const g = p.ghost!;
    const ctx = this.ctx;
    if (g.radius) {
      const c = project(g.x + g.size / 2, g.y + g.size / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, g.radius * TW * 0.707, g.radius * TH * 0.707, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = g.valid ? 0.75 : 0.4;
    this.drawBuilding(g.type, g.x, g.y, g.size, 1, 0, null);
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------------- objects

  private drawForest(t: Tile): void {
    const h = hash2(t.x, t.y, 3);
    const n = 2 + Math.floor(h * 3);
    for (let k = 0; k < n; k++) {
      const ox = 0.2 + hash2(t.x * 7 + k, t.y, 5) * 0.6;
      const oy = 0.2 + hash2(t.x, t.y * 7 + k, 9) * 0.6;
      const sc = 0.65 + hash2(k, t.x + t.y, 1) * 0.35;
      if (hash2(t.x + k, t.y - k, 2) > 0.45) this.pine(t.x + ox, t.y + oy, sc);
      else this.tree(t.x + ox, t.y + oy, sc * 0.9, '#3f8f3a');
    }
  }

  drawBuilding(type: BuildingType, x: number, y: number, size: number, level: number, variant: number, tile: Tile | null): void {
    const seed = x * 131 + y * 17;
    switch (type) {
      case 'residential':
        this.drawResidential(x, y, level, variant, seed);
        break;
      case 'commercial':
        this.drawCommercial(x, y, level, variant, seed);
        break;
      case 'industrial':
        this.drawIndustrial(x, y, level, variant, seed);
        break;
      case 'power_coal':
        this.drawCoal(x, y, seed);
        break;
      case 'power_solar':
        this.drawSolar(x, y);
        break;
      case 'water_pump':
        this.drawPump(x, y);
        break;
      case 'police':
        this.drawPolice(x, y, seed);
        break;
      case 'fire':
        this.drawFire(x, y, seed);
        break;
      case 'school':
        this.drawSchool(x, y, seed);
        break;
      case 'hospital':
        this.drawHospital(x, y, seed);
        break;
      case 'park':
        this.drawPark(x, y, variant);
        break;
      case 'power_wind':
        this.drawWind(x, y, seed);
        break;
      case 'stadium':
        this.drawStadium(x, y);
        break;
      case 'city_hall':
        this.drawCityHall(x, y, seed);
        break;
      default:
        void size;
        void tile;
    }
  }

  private gableRoof(u: number, v: number, su: number, sv: number, wallH: number, roofH: number, color: string): void {
    const h = wallH * this.hs;
    const rh = roofH * this.hs;
    const A = project(u, v, h);
    const B = project(u + su, v, h);
    const C = project(u + su, v + sv, h);
    const D = project(u, v + sv, h);
    const R0 = project(u, v + sv / 2, h + rh);
    const R1 = project(u + su, v + sv / 2, h + rh);
    this.poly([A, B, R1, R0], shade(color, -0.25));
    this.poly([B, C, R1], shade(color, -0.45));
    this.poly([D, C, R1, R0], color);
  }

  private drawResidential(x: number, y: number, level: number, v: number, seed: number): void {
    if (level <= 1) {
      this.tree(x + 0.82, y + 0.2, 0.55, '#4f9d45');
      const wall = HOUSE_WALLS[v];
      const f = this.box(x + 0.22, y + 0.25, 0.55, 0.5, 11, wall);
      this.gableRoof(x + 0.18, y + 0.21, 0.63, 0.58, 11, 9, this.season === 'winter' ? '#eef3f7' : HOUSE_ROOFS[v]);
      // Door and window.
      const ctx = this.ctx;
      const [p0, p1] = f.left;
      ctx.fillStyle = '#6b4a2f';
      const dx = p0.x + (p1.x - p0.x) * 0.3;
      const dy = p0.y + (p1.y - p0.y) * 0.3;
      ctx.fillRect(dx, dy - 7 * this.hs, 3, 7 * this.hs);
      ctx.fillStyle = this.night > 0.4 ? '#ffd27a' : '#8fb4d8';
      const wx = p0.x + (p1.x - p0.x) * 0.65;
      const wy = p0.y + (p1.y - p0.y) * 0.65;
      ctx.fillRect(wx - 2, wy - 8 * this.hs, 4, 3 * this.hs);
    } else if (level === 2) {
      const wall = APT_WALLS[v];
      const f = this.box(x + 0.12, y + 0.12, 0.76, 0.76, 30, wall);
      this.windowBands(f.left, f.h, 4, '#3b4a5c', seed);
      this.windowBands(f.right, f.h, 4, '#2c3846', seed + 1);
      this.box(x + 0.5, y + 0.3, 0.2, 0.2, 5, shade(wall, -0.2), 30);
    } else {
      const wall = TOWER_WALLS[v];
      const h = 58 + v * 9;
      const f = this.box(x + 0.1, y + 0.1, 0.8, 0.8, h, wall);
      this.windowBands(f.left, f.h, Math.floor(h / 8), '#34465a', seed);
      this.windowBands(f.right, f.h, Math.floor(h / 8), '#273544', seed + 1);
      this.box(x + 0.25, y + 0.25, 0.5, 0.5, 4, shade(wall, -0.15), h);
    }
  }

  private drawCommercial(x: number, y: number, level: number, v: number, seed: number): void {
    if (level <= 1) {
      const wall = SHOP_WALLS[v];
      const f = this.box(x + 0.15, y + 0.15, 0.7, 0.7, 13, wall);
      const ctx = this.ctx;
      // Shop window.
      const [p0, p1] = f.left;
      ctx.fillStyle = this.night > 0.4 ? '#ffe39a' : '#7fb2d9';
      ctx.beginPath();
      ctx.moveTo(p0.x + (p1.x - p0.x) * 0.15, p0.y + (p1.y - p0.y) * 0.15 - 2);
      ctx.lineTo(p0.x + (p1.x - p0.x) * 0.85, p0.y + (p1.y - p0.y) * 0.85 - 2);
      ctx.lineTo(p0.x + (p1.x - p0.x) * 0.85, p0.y + (p1.y - p0.y) * 0.85 - 7 * this.hs);
      ctx.lineTo(p0.x + (p1.x - p0.x) * 0.15, p0.y + (p1.y - p0.y) * 0.15 - 7 * this.hs);
      ctx.fill();
      // Awning.
      const aw = AWNINGS[v];
      const z1 = 9 * this.hs;
      const z2 = 11 * this.hs;
      this.poly(
        [
          { x: p0.x - 2, y: p0.y - z1 + 2 },
          { x: p1.x - 2, y: p1.y - z1 + 2 },
          { x: p1.x, y: p1.y - z2 },
          { x: p0.x, y: p0.y - z2 },
        ],
        aw,
      );
      // Sign on the roof.
      this.box(x + 0.35, y + 0.4, 0.3, 0.06, 5, aw, 13);
    } else if (level === 2) {
      const glass = GLASS[v];
      const f = this.box(x + 0.12, y + 0.12, 0.76, 0.76, 38, glass, 0, shade(glass, 0.35));
      this.windowBands(f.left, f.h, 6, 'rgba(255,255,255,0.25)', seed);
      this.windowBands(f.right, f.h, 6, 'rgba(255,255,255,0.12)', seed + 1);
    } else {
      const glass = SKY_GLASS[v];
      const h1 = 72 + v * 8;
      const f = this.box(x + 0.08, y + 0.08, 0.84, 0.84, h1, glass, 0, shade(glass, 0.3));
      this.windowBands(f.left, f.h, Math.floor(h1 / 7), 'rgba(255,255,255,0.22)', seed);
      this.windowBands(f.right, f.h, Math.floor(h1 / 7), 'rgba(255,255,255,0.1)', seed + 1);
      const f2 = this.box(x + 0.22, y + 0.22, 0.56, 0.56, 26, shade(glass, 0.08), h1, shade(glass, 0.35));
      this.windowBands(f2.left, f2.h, 3, 'rgba(255,255,255,0.22)', seed + 2);
      // Antenna with a blinking light.
      const top = project(x + 0.5, y + 0.5, (h1 + 26) * this.hs);
      const ctx = this.ctx;
      ctx.strokeStyle = '#cfd6dd';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(top.x, top.y - 16 * this.hs);
      ctx.stroke();
      if (Math.floor(this.now / 700 + seed) % 2 === 0) {
        ctx.fillStyle = '#ff4040';
        ctx.beginPath();
        ctx.arc(top.x, top.y - 16 * this.hs, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private chimney(u: number, v: number, h: number, z = 0): void {
    this.box(u, v, 0.12, 0.12, h, '#7b6d63', z);
    this.box(u, v, 0.12, 0.12, 4, '#d9534f', z + h - 6);
    if (this.hs >= 1) {
      const top = project(u + 0.06, v + 0.06, z + h);
      this.emitSmoke(top.x, top.y, 0.035, '#c8c8c8');
    }
  }

  private drawIndustrial(x: number, y: number, level: number, v: number, seed: number): void {
    const ctx = this.ctx;
    if (level <= 1) {
      const wall = ['#a39e93', '#9c968b', '#ab9f8c', '#9aa0a3'][v];
      const f = this.box(x + 0.1, y + 0.12, 0.8, 0.76, 12, wall);
      // Corrugated roof lines.
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < 5; k++) {
        const a = project(x + 0.1 + (0.8 * k) / 5, y + 0.12, 12 * this.hs);
        const b = project(x + 0.1 + (0.8 * k) / 5, y + 0.88, 12 * this.hs);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      // Loading door.
      const [p0, p1] = f.left;
      ctx.fillStyle = '#5c5850';
      ctx.fillRect(p0.x + (p1.x - p0.x) * 0.4, p0.y + (p1.y - p0.y) * 0.4 - 8 * this.hs, 7, 8 * this.hs);
    } else if (level === 2) {
      const wall = ['#8d7f70', '#86796b', '#937e6a', '#7d8288'][v];
      const f = this.box(x + 0.1, y + 0.1, 0.8, 0.8, 19, wall);
      this.windowBands(f.left, f.h, 2, '#4a443e', seed);
      this.chimney(x + 0.68, y + 0.18, 40);
    } else {
      const wall = ['#7f746a', '#77706a', '#86786a', '#6f767c'][v];
      const f = this.box(x + 0.05, y + 0.3, 0.9, 0.65, 24, wall);
      this.windowBands(f.left, f.h, 3, '#3f3a35', seed);
      this.cylinder(x + 0.3, y + 0.18, 0.13, 18, '#b5b5ad');
      this.chimney(x + 0.6, y + 0.1, 50);
      this.chimney(x + 0.8, y + 0.12, 44);
    }
  }

  private drawCoal(x: number, y: number, seed: number): void {
    const f = this.box(x + 0.1, y + 0.9, 1.2, 1.0, 26, '#8a8f99');
    this.windowBands(f.left, f.h, 2, '#4d525a', seed);
    this.cylinder(x + 1.55, y + 0.55, 0.36, 46, '#cfcfc9');
    const top = project(x + 1.55, y + 0.55, 46 * this.hs);
    if (this.hs >= 1) this.emitSmoke(top.x, top.y, 0.25, '#e6e6e6', 9);
    // Striped chimney.
    for (let k = 0; k < 6; k++) {
      this.box(x + 0.35, y + 0.35, 0.16, 0.16, 11, k % 2 ? '#ecf0f1' : '#e74c3c', k * 11);
    }
    const ctop = project(x + 0.43, y + 0.43, 66 * this.hs);
    if (this.hs >= 1) this.emitSmoke(ctop.x, ctop.y, 0.18, '#9a9a9a', 6);
    // Coal heap.
    const ctx = this.ctx;
    const heap = project(x + 1.6, y + 1.55);
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.ellipse(heap.x, heap.y - 3, 16, 7, 0, Math.PI, 0);
    ctx.fill();
  }

  private drawSolar(x: number, y: number): void {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const f = this.box(x + 0.12 + a * 0.6, y + 0.12 + b * 0.6, 0.48, 0.42, 3, '#1f3b73', 2, '#2c5aa8');
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(180,210,255,0.5)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo((f.top[0].x + f.top[3].x) / 2, (f.top[0].y + f.top[3].y) / 2);
        ctx.lineTo((f.top[1].x + f.top[2].x) / 2, (f.top[1].y + f.top[2].y) / 2);
        ctx.stroke();
      }
    }
  }

  private drawPump(x: number, y: number): void {
    this.box(x + 0.1, y + 0.1, 0.8, 0.8, 5, '#9aa3ab');
    this.cylinder(x + 0.45, y + 0.45, 0.28, 24, '#5aa7d8', 5);
    this.box(x + 0.72, y + 0.62, 0.14, 0.14, 12, '#7f8c95', 5);
  }

  private drawPolice(x: number, y: number, seed: number): void {
    const f = this.box(x + 0.12, y + 0.12, 0.76, 0.76, 18, '#2f4f8f');
    this.windowBands(f.left, f.h, 2, '#dfe8f5', seed);
    this.windowBands(f.right, f.h, 2, '#b8c6dd', seed);
    const blink = Math.floor(this.now / 300) % 2 === 0;
    this.box(x + 0.4, y + 0.42, 0.1, 0.08, 3, blink ? '#ff3b3b' : '#3b6bff', 18);
    this.box(x + 0.5, y + 0.42, 0.1, 0.08, 3, blink ? '#3b6bff' : '#ff3b3b', 18);
  }

  private drawFire(x: number, y: number, seed: number): void {
    const f = this.box(x + 0.1, y + 0.15, 0.8, 0.75, 16, '#c0392b');
    const ctx = this.ctx;
    const [p0, p1] = f.left;
    ctx.fillStyle = '#ecf0f1';
    for (let k = 0; k < 2; k++) {
      const a = 0.15 + k * 0.42;
      const px = p0.x + (p1.x - p0.x) * a;
      const py = p0.y + (p1.y - p0.y) * a;
      const qx = p0.x + (p1.x - p0.x) * (a + 0.3);
      const qy = p0.y + (p1.y - p0.y) * (a + 0.3);
      this.poly([{ x: px, y: py }, { x: qx, y: qy }, { x: qx, y: qy - 9 * this.hs }, { x: px, y: py - 9 * this.hs }], '#d7dde0');
    }
    this.box(x + 0.68, y + 0.2, 0.18, 0.18, 30, '#a93226');
    void seed;
  }

  private drawSchool(x: number, y: number, seed: number): void {
    const ctx = this.ctx;
    // Playground.
    this.diamond(x + 1.05, y + 1.05, 0.8, 0.8);
    ctx.fillStyle = '#c96f4a';
    ctx.fill();
    const f1 = this.box(x + 0.1, y + 0.1, 1.8, 0.8, 20, '#d98c5f');
    this.windowBands(f1.left, f1.h, 2, '#f6e7c8', seed);
    this.windowBands(f1.right, f1.h, 2, '#e6d3ae', seed);
    const f2 = this.box(x + 0.1, y + 0.9, 0.8, 1.0, 20, '#d98c5f');
    this.windowBands(f2.left, f2.h, 2, '#f6e7c8', seed + 3);
    this.windowBands(f2.right, f2.h, 2, '#e6d3ae', seed + 3);
    // Flag.
    const base = project(x + 1.6, y + 1.6);
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, base.y - 34 * this.hs);
    ctx.stroke();
    const wave = Math.sin(this.now / 250) * 2;
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - 34 * this.hs);
    ctx.lineTo(base.x + 12, base.y - 31 * this.hs + wave);
    ctx.lineTo(base.x, base.y - 27 * this.hs);
    ctx.fill();
  }

  private drawHospital(x: number, y: number, seed: number): void {
    const f = this.box(x + 0.15, y + 0.15, 1.7, 1.7, 30, '#eef0f2');
    this.windowBands(f.left, f.h, 4, '#7fb2d9', seed);
    this.windowBands(f.right, f.h, 4, '#6a9dc4', seed + 1);
    const f2 = this.box(x + 0.5, y + 0.5, 1.0, 1.0, 14, '#f7f8f9', 30);
    this.windowBands(f2.left, f2.h, 1, '#7fb2d9', seed + 2);
    // Red cross on the roof.
    this.box(x + 0.92, y + 0.7, 0.16, 0.6, 1, '#e74c3c', 44);
    this.box(x + 0.7, y + 0.92, 0.6, 0.16, 1, '#e74c3c', 44);
  }

  private drawPark(x: number, y: number, v: number): void {
    const ctx = this.ctx;
    // Path.
    ctx.strokeStyle = '#d8c79a';
    ctx.lineWidth = 2.5;
    const a = project(x, y + 0.5);
    const b = project(x + 1, y + 0.5);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(project(x + 0.5, y + 0.2).x, project(x + 0.5, y + 0.2).y, b.x, b.y);
    ctx.stroke();
    if (v % 2 === 0) {
      const p = project(x + 0.65, y + 0.7);
      ctx.fillStyle = '#4aa3df';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 9, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      this.tree(x + 0.7, y + 0.75, 0.75, '#66bb55');
    }
    this.tree(x + 0.25, y + 0.25, 0.8, '#58b04a');
    this.tree(x + 0.75, y + 0.2, 0.6, '#7ac35f');
    this.tree(x + 0.25, y + 0.8, 0.65, '#4f9d45');
  }

  private drawWind(x: number, y: number, seed: number): void {
    const ctx = this.ctx;
    this.box(x + 0.35, y + 0.35, 0.3, 0.3, 3, '#b8bcc0');
    const base = project(x + 0.5, y + 0.5, 3);
    const h = 58 * this.hs;
    ctx.strokeStyle = '#eef1f4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, base.y - h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(base.x + 1, base.y);
    ctx.lineTo(base.x + 1, base.y - h);
    ctx.stroke();
    const hub = { x: base.x, y: base.y - h };
    const angle = this.now / 400 + seed;
    ctx.strokeStyle = '#f7f9fb';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = angle + (k * Math.PI * 2) / 3;
      ctx.moveTo(hub.x, hub.y);
      // Rotor plane faces the viewer at an angle, so squash horizontally.
      ctx.lineTo(hub.x + Math.cos(a) * 22 * this.hs * 0.6, hub.y + Math.sin(a) * 22 * this.hs);
    }
    ctx.stroke();
    ctx.fillStyle = '#d0d5da';
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawStadium(x: number, y: number): void {
    const ctx = this.ctx;
    const c = project(x + 1, y + 1);
    const rx = TW * 0.85;
    const ry = TH * 0.85;
    const h = 16 * this.hs;
    // Outer wall.
    ctx.fillStyle = '#c9ccd1';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(c.x - rx, c.y - h);
    ctx.ellipse(c.x, c.y - h, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI;
      ctx.fillRect(c.x + Math.cos(a) * rx * 0.98 - 1, c.y + Math.sin(a) * ry - h + 3, 2, h - 5);
    }
    // Stands and pitch.
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3e9b48';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - h + 2, rx * 0.7, ry * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - h + 2, rx * 0.18, ry * 0.18, 0, 0, Math.PI * 2);
    ctx.moveTo(c.x - rx * 0.35, c.y - h + 2 - ry * 0.35);
    ctx.lineTo(c.x + rx * 0.35, c.y - h + 2 + ry * 0.35);
    ctx.stroke();
    // Floodlights.
    for (const [du, dv] of [[0.1, 0.1], [1.9, 0.1], [0.1, 1.9], [1.9, 1.9]]) {
      const p = project(x + du, y + dv);
      ctx.strokeStyle = '#8d939a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - 34 * this.hs);
      ctx.stroke();
      ctx.fillStyle = this.night > 0.3 ? '#fff6c8' : '#dfe3e6';
      ctx.fillRect(p.x - 4, p.y - 38 * this.hs, 8, 4);
      if (this.night > 0.3) this.lights.push([p.x - 5, p.y - 39 * this.hs, p.x + 5, p.y - 39 * this.hs, p.x + 5, p.y - 33 * this.hs, p.x - 5, p.y - 33 * this.hs]);
    }
  }

  private drawCityHall(x: number, y: number, seed: number): void {
    const ctx = this.ctx;
    this.box(x + 0.1, y + 0.1, 1.8, 1.8, 4, '#cfc8b8');
    const f = this.box(x + 0.25, y + 0.25, 1.5, 1.5, 26, '#efe9dc', 4);
    this.windowBands(f.right, f.h, 2, '#8b7d62', seed);
    // Columns on the front-left facade.
    const [p0, p1] = f.left;
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 6; k++) {
      const a = 0.08 + k * 0.17;
      const px = p0.x + (p1.x - p0.x) * a;
      const py = p0.y + (p1.y - p0.y) * a - 4 * this.hs;
      ctx.fillRect(px - 1.5, py - 22 * this.hs, 3, 22 * this.hs);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y - 4 * this.hs);
    ctx.lineTo(p1.x, p1.y - 4 * this.hs);
    ctx.lineTo(p1.x, p1.y - 24 * this.hs);
    ctx.lineTo(p0.x, p0.y - 24 * this.hs);
    ctx.closePath();
    ctx.globalAlpha *= 0.4;
    ctx.fill();
    ctx.globalAlpha /= 0.4;
    // Drum and dome.
    const top = this.cylinder(x + 1, y + 1, 0.32, 12, '#f3eee3', 30);
    ctx.fillStyle = '#5f9ea0';
    ctx.beginPath();
    ctx.ellipse(top.x, top.y, 0.32 * TW * 0.72, 0.32 * TW * 0.72 * 0.9, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y - 0.32 * TW * 0.65);
    ctx.lineTo(top.x, top.y - 0.32 * TW * 0.65 - 10 * this.hs);
    ctx.stroke();
    // Flag.
    const wave = Math.sin(this.now / 260) * 2;
    ctx.fillStyle = '#e74c3c';
    const fx = top.x;
    const fy = top.y - 0.32 * TW * 0.65 - 10 * this.hs;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + 10, fy + 2 + wave);
    ctx.lineTo(fx, fy + 6);
    ctx.fill();
  }

  // ----------------------------------------------------------------- fires & weather

  private drawFires(visible: number[], s: RenderState): void {
    const ctx = this.ctx;
    for (const i of visible) {
      const t = s.tiles[i];
      const b = t.building;
      if (!b?.fire || b.originX !== t.x || b.originY !== t.y) continue;
      const height = b.type === 'residential' || b.type === 'commercial' || b.type === 'industrial' ? 10 + b.level * 16 : 22;
      const base = project(b.originX + b.size / 2, b.originY + b.size / 2, height * 0.6);
      const glow = ctx.createRadialGradient(base.x, base.y, 2, base.x, base.y, 30 * b.size);
      glow.addColorStop(0, 'rgba(255,170,60,0.55)');
      glow.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(base.x, base.y, 30 * b.size, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 6; k++) {
        const ph = this.now / 120 + k * 1.7 + t.x;
        const fx = base.x + Math.sin(ph * 0.7 + k) * 8 * b.size;
        const fh = 10 + Math.abs(Math.sin(ph)) * 12;
        ctx.fillStyle = k % 2 ? '#ffb02e' : '#ff5a1f';
        ctx.beginPath();
        ctx.moveTo(fx - 4, base.y);
        ctx.quadraticCurveTo(fx - 3, base.y - fh * 0.6, fx, base.y - fh);
        ctx.quadraticCurveTo(fx + 3, base.y - fh * 0.6, fx + 4, base.y);
        ctx.closePath();
        ctx.fill();
      }
      this.emitSmoke(base.x, base.y - 18, 0.3, '#3d3d3d', 6);
    }
  }

  private drawWeather(s: RenderState, viewW: number, viewH: number, dpr: number, dt: number): void {
    const want = s.weather === 'clear' ? 0 : s.weather === 'rain' ? 260 : 180;
    const drops = this.weatherDrops;
    while (drops.length < want) drops.push({ x: Math.random() * viewW, y: Math.random() * viewH, v: 0.6 + Math.random() * 0.6 });
    if (drops.length > want) drops.length = want;
    if (!drops.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.weather === 'rain') {
      ctx.fillStyle = 'rgba(40,60,90,0.12)';
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.strokeStyle = 'rgba(190,210,240,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops) {
        d.y += 900 * d.v * dt;
        d.x -= 180 * d.v * dt;
        if (d.y > viewH) {
          d.y = -10;
          d.x = Math.random() * (viewW + 100);
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + 3, d.y - 14 * d.v);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const d of drops) {
        d.y += 70 * d.v * dt;
        d.x += Math.sin(this.now / 900 + d.v * 10) * 20 * dt;
        if (d.y > viewH) {
          d.y = -5;
          d.x = Math.random() * viewW;
        }
        ctx.moveTo(d.x + 1.8 * d.v, d.y);
        ctx.arc(d.x, d.y, 1.8 * d.v, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // ----------------------------------------------------------------- cars

  private updateCars(s: RenderState, dt: number): void {
    const w = s.width;
    const target = Math.min(260, Math.floor(this.roadCount * 0.2 + s.population / 45), Math.floor(this.roadCount * 0.9));
    // Remove cars whose road disappeared.
    this.cars = this.cars.filter((c) => s.tiles[c.from]?.building?.type === 'road' && s.tiles[c.to]?.building?.type === 'road');
    if (this.cars.length > target) this.cars.length = target;
    let spawnBudget = 4;
    while (this.cars.length < target && spawnBudget-- > 0 && this.roadTiles.length) {
      const from = this.roadTiles[Math.floor(Math.random() * this.roadTiles.length)];
      const to = this.nextRoad(s, from, -1);
      if (to < 0) continue;
      this.cars.push({
        from,
        to,
        prev: -1,
        t: Math.random(),
        speed: 0.9 + Math.random() * 0.8,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      });
    }
    this.carBuckets.clear();
    for (const c of this.cars) {
      c.t += dt * c.speed * s.pace;
      while (c.t >= 1) {
        c.t -= 1;
        const next = this.nextRoad(s, c.to, c.from);
        c.prev = c.from;
        c.from = c.to;
        c.to = next < 0 ? c.prev : next;
      }
      const fx = c.from % w;
      const fy = (c.from - fx) / w;
      const tx = c.to % w;
      const ty = (c.to - tx) / w;
      // Bucket by the tile further back in depth order so buildings in front occlude.
      const key = fx + fy >= tx + ty ? c.from : c.to;
      let list = this.carBuckets.get(key);
      if (!list) this.carBuckets.set(key, (list = []));
      list.push(c);
    }
  }

  private nextRoad(s: RenderState, i: number, avoid: number): number {
    const w = s.width;
    const x = i % w;
    const y = (i - x) / w;
    const opts: number[] = [];
    if (this.isRoad(s, x - 1, y)) opts.push(i - 1);
    if (this.isRoad(s, x + 1, y)) opts.push(i + 1);
    if (this.isRoad(s, x, y - 1)) opts.push(i - w);
    if (this.isRoad(s, x, y + 1)) opts.push(i + w);
    const forward = opts.filter((o) => o !== avoid);
    const pool = forward.length ? forward : opts;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
  }

  private drawCar(c: Car, s: RenderState): void {
    const w = s.width;
    const fx = c.from % w;
    const fy = (c.from - fx) / w;
    const tx = c.to % w;
    const ty = (c.to - tx) / w;
    const dx = tx - fx;
    const dy = ty - fy;
    // Right-hand traffic: offset perpendicular to the direction of travel.
    const u = fx + 0.5 + dx * c.t - dy * 0.17;
    const v = fy + 0.5 + dy * c.t + dx * 0.17;
    const alongX = dx !== 0;
    const lu = alongX ? 0.26 : 0.13;
    const lv = alongX ? 0.13 : 0.26;
    this.box(u - lu / 2, v - lv / 2, lu, lv, 4, c.color);
    this.box(u - lu / 4, v - lv / 4, lu / 2, lv / 2, 2.5, shade(c.color, -0.2), 4, '#9ec5e8');
    if (this.night > 0.3) {
      const head = project(u + dx * 0.16, v + dy * 0.16, 2);
      this.lights.push([head.x - 1.5, head.y - 1.5, head.x + 1.5, head.y - 1.5, head.x + 1.5, head.y + 1.5, head.x - 1.5, head.y + 1.5]);
    }
  }

  // ----------------------------------------------------------------- particles

  private emitSmoke(x: number, y: number, rate: number, color: string, size = 4): void {
    if (Math.random() > rate * 2) return;
    if (this.particles.length > 600) return;
    this.particles.push({
      x: x + (Math.random() - 0.5) * 3,
      y,
      vx: 6 + Math.random() * 6,
      vy: -14 - Math.random() * 8,
      r: size * (0.6 + Math.random() * 0.5),
      life: 0,
      max: 3 + Math.random() * 2,
      color,
    });
  }

  private dust(u: number, v: number, size: number): void {
    const p = project(u, v);
    for (let k = 0; k < 6 * size; k++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: p.x + Math.cos(a) * 10 * size,
        y: p.y + Math.sin(a) * 5 * size,
        vx: Math.cos(a) * 12,
        vy: -6 - Math.random() * 6,
        r: 3 + Math.random() * 3,
        life: 0,
        max: 0.9 + Math.random() * 0.5,
        color: '#c9b48f',
      });
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += dt * 4;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = Math.max(0, 1 - p.life / p.max) * 0.55;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------------- overlays

  private drawWarnings(visible: number[], s: RenderState): void {
    if (Math.floor(this.now / 600) % 2 === 1) return;
    const ctx = this.ctx;
    for (const i of visible) {
      const t = s.tiles[i];
      const b = t.building;
      if (!b || b.type === 'road' || b.type === 'park' || t.powered) continue;
      if (b.originX !== t.x || b.originY !== t.y) continue;
      const height = b.type === 'residential' || b.type === 'commercial' || b.type === 'industrial' ? 14 + b.level * 18 : 34;
      const p = project(t.x + b.size / 2, t.y + b.size / 2, height + 10);
      ctx.fillStyle = '#ffd400';
      ctx.strokeStyle = '#7a5b00';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3a2c00';
      ctx.beginPath();
      ctx.moveTo(p.x + 1, p.y - 4.5);
      ctx.lineTo(p.x - 2.5, p.y + 0.8);
      ctx.lineTo(p.x, p.y + 0.8);
      ctx.lineTo(p.x - 1, p.y + 4.5);
      ctx.lineTo(p.x + 2.5, p.y - 0.8);
      ctx.lineTo(p.x, p.y - 0.8);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawNight(s: RenderState, cam: Camera, viewW: number, viewH: number, dpr: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgba(10,16,48,${0.5 * s.night})`;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
    ctx.globalAlpha = Math.min(1, s.night * 1.4);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    for (const q of this.lights) {
      ctx.moveTo(q[0], q[1]);
      ctx.lineTo(q[2], q[3]);
      ctx.lineTo(q[4], q[5]);
      ctx.lineTo(q[6], q[7]);
      ctx.closePath();
    }
    ctx.fill();
    // Street lamps.
    ctx.fillStyle = 'rgba(255,200,120,0.18)';
    ctx.beginPath();
    for (const i of this.roadTiles) {
      const x = i % s.width;
      const y = (i - x) / s.width;
      if (hash2(x, y, 4) < 0.55) continue;
      const p = project(x + 0.5, y + 0.5);
      ctx.moveTo(p.x + 14, p.y);
      ctx.ellipse(p.x, p.y, 14, 7, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    void cam;
  }

  private drawCursor(s: RenderState): void {
    const ctx = this.ctx;
    if (s.selected) {
      this.diamond(s.selected.x, s.selected.y, 1, 1);
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (s.hover && !s.preview) {
      this.diamond(s.hover.x, s.hover.y, 1, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawFloaters(s: RenderState, now: number): void {
    const ctx = this.ctx;
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let k = s.floaters.length - 1; k >= 0; k--) {
      const f = s.floaters[k];
      const age = (now - f.t0) / 1400;
      if (age >= 1) {
        s.floaters.splice(k, 1);
        continue;
      }
      const p = project(f.x + 0.5, f.y + 0.5, 20 + age * 40);
      ctx.globalAlpha = 1 - age;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, p.x, p.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Draws a top-down (rotated to match the iso view) minimap. */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  tiles: Tile[],
  w: number,
  h: number,
  size: number,
  overlay: Overlay,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size / 2);
  if (!tiles.length) return;
  const scale = size / (w + h);
  // Map tile (x, y) to minimap like the iso projection.
  ctx.setTransform(scale, scale / 2, -scale, scale / 2, (h * size) / (w + h), 0);
  for (const t of tiles) {
    let c: string;
    const b = t.building;
    if (overlay === 'power' && (b || t.zone)) c = t.powered ? '#ffd400' : '#e53935';
    else if (overlay === 'water' && (b || t.zone)) c = t.watered ? '#29a8ff' : '#e53935';
    else if (b?.type === 'road') c = '#3a3d42';
    else if (b?.type === 'residential') c = '#3fbf6f';
    else if (b?.type === 'commercial') c = '#3d8fe0';
    else if (b?.type === 'industrial') c = '#e0a930';
    else if (b) c = '#d0d0d0';
    else if (t.zone) c = ZONE_COLORS[t.zone] + '88';
    else if (t.terrain === 'water') c = '#2e74b5';
    else if (t.terrain === 'forest') c = '#356f2c';
    else if (t.terrain === 'sand') c = '#cdb983';
    else c = '#5e9a46';
    ctx.fillStyle = c;
    ctx.fillRect(t.x, t.y, 1.05, 1.05);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
