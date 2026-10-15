import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DRAG_AREA_TOOLS, DRAG_LINE_TOOLS, ZONE_FOR_TOOL } from '../core/catalog';
import { GameService } from '../core/game.service';
import { Coord, ServiceBuildingType, Tool } from '../core/models';
import { Camera, linePath, project, rectArea, screenToTile } from './iso';
import { IsoRenderer, Preview } from './iso-renderer';
import { ViewportService } from './viewport.service';

const SERVICE_TOOLS: Tool[] = [
  'power_coal',
  'power_solar',
  'water_pump',
  'police',
  'fire',
  'school',
  'hospital',
  'park',
];

interface PanState {
  sx: number;
  sy: number;
  camX: number;
  camY: number;
  moved: boolean;
  button: number;
}

@Component({
  selector: 'app-city-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      #canvas
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      (pointerleave)="onPointerLeave()"
      (wheel)="onWheel($event)"
      (contextmenu)="$event.preventDefault()"
      [class.panning]="panning()"
      [class.building]="game.tool() !== 'inspect'"
    ></canvas>
    @if (costLabel(); as label) {
      <div class="cost" [class.bad]="label.bad" [style.left.px]="label.x" [style.top.px]="label.y">
        {{ label.text }}
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
      overflow: hidden;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      cursor: grab;
    }
    canvas.building {
      cursor: crosshair;
    }
    canvas.panning {
      cursor: grabbing;
    }
    .cost {
      position: absolute;
      transform: translate(14px, 14px);
      pointer-events: none;
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #e8fff1;
      background: rgba(16, 40, 30, 0.85);
      border: 1px solid rgba(110, 230, 160, 0.5);
      white-space: nowrap;
    }
    .cost.bad {
      color: #ffe3e3;
      background: rgba(60, 16, 16, 0.85);
      border-color: rgba(255, 120, 120, 0.6);
    }
  `,
})
export class CityMapComponent {
  readonly game = inject(GameService);
  private readonly viewport = inject(ViewportService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  readonly panning = signal(false);
  private readonly dragStart = signal<Coord | null>(null);
  private readonly dragEnd = signal<Coord | null>(null);
  private readonly pointer = signal<{ x: number; y: number } | null>(null);

  private renderer?: IsoRenderer;
  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  private pan: PanState | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private readonly keys = new Set<string>();
  private centeredFor = '';

  /** Tiles affected by the current tool at the cursor / drag. */
  readonly preview = computed<Preview | null>(() => {
    const tool = this.game.tool();
    this.game.tilesVersion();
    if (tool === 'inspect') return null;
    const hover = this.game.hovered();
    const start = this.dragStart();
    const end = this.dragEnd() ?? hover;
    if (!end) return null;
    let cells: Coord[];
    if (SERVICE_TOOLS.includes(tool)) {
      const entry = this.game.entry(tool);
      const o = { x: end.x - Math.floor((entry.size - 1) / 2), y: end.y - Math.floor((entry.size - 1) / 2) };
      cells = rectArea(o, { x: o.x + entry.size - 1, y: o.y + entry.size - 1 });
      const valid = cells.every((c) => {
        const t = this.game.tileAt(c.x, c.y);
        return !!t && t.terrain !== 'water' && !t.building;
      });
      return {
        cells,
        valid: cells.map(() => valid),
        ghost: { type: tool as ServiceBuildingType, x: o.x, y: o.y, size: entry.size, valid, radius: entry.radius },
      };
    }
    if (start && DRAG_LINE_TOOLS.includes(tool)) cells = linePath(start, end);
    else if (start && DRAG_AREA_TOOLS.includes(tool)) cells = rectArea(start, end);
    else cells = [end];
    cells = cells.filter((c) => this.game.tileAt(c.x, c.y));
    return { cells, valid: cells.map((c) => this.isValid(tool, c)) };
  });

  readonly cost = computed(() => {
    const p = this.preview();
    const tool = this.game.tool();
    if (!p || tool === 'inspect') return 0;
    const entry = this.game.entry(tool);
    if (p.ghost) return p.ghost.valid ? entry.cost : 0;
    let cost = 0;
    const seen = new Set<string>();
    p.cells.forEach((c, k) => {
      if (!p.valid[k]) return;
      const t = this.game.tileAt(c.x, c.y)!;
      if (tool === 'bulldoze') {
        const b = t.building;
        if (b) {
          const key = `${b.originX},${b.originY}`;
          if (!seen.has(key)) {
            seen.add(key);
            cost += entry.cost * b.size * b.size * Math.max(1, b.level);
          }
        } else cost += entry.cost;
      } else if (tool === 'road' && t.building?.type === 'road') {
        // Already a road: free.
      } else {
        cost += entry.cost + (t.terrain === 'forest' && tool !== 'dezone' ? 5 : 0);
      }
    });
    return cost;
  });

  readonly costLabel = computed(() => {
    const ptr = this.pointer();
    const p = this.preview();
    const tool = this.game.tool();
    if (!ptr || !p || tool === 'inspect') return null;
    const cost = this.cost();
    const name = this.game.entry(tool).name;
    const anyValid = p.valid.some(Boolean);
    if (!anyValid) return { x: ptr.x, y: ptr.y, text: `${name}: hier nicht möglich`, bad: true };
    const bad = cost > this.game.money();
    const count = p.ghost ? '' : ` · ${p.valid.filter(Boolean).length} Felder`;
    return {
      x: ptr.x,
      y: ptr.y,
      text: `${name}${count} · §${cost.toLocaleString('de-DE')}${bad ? ' (zu teuer)' : ''}`,
      bad,
    };
  });

  constructor() {
    afterNextRender(() => this.init());

    effect(() => {
      const req = this.game.focusRequest();
      if (!req) return;
      untracked(() => this.centerOn(req.x + 0.5, req.y + 0.5));
    });

    effect(() => {
      // Centre on the map once per city.
      const id = this.game.cityId();
      const w = this.game.width();
      if (id && w && this.centeredFor !== id && this.viewW) {
        this.centeredFor = id;
        untracked(() => {
          this.cam.zoom = 1;
          this.centerOn(this.game.width() / 2, this.game.height() / 2);
          this.renderer?.reset();
        });
      }
    });
  }

  private init(): void {
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    this.renderer = new IsoRenderer(ctx);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.viewW = rect.width;
      this.viewH = rect.height;
      canvas.width = Math.round(rect.width * this.dpr);
      canvas.height = Math.round(rect.height * this.dpr);
      if (this.game.cityId() && this.centeredFor !== this.game.cityId()) {
        this.centeredFor = this.game.cityId()!;
        this.centerOn(this.game.width() / 2, this.game.height() / 2);
      }
      this.publishViewport();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        // W/A/S/D are reserved for panning only when no modifier is held.
        if (!e.ctrlKey && !e.metaKey) this.keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
      if (k === '+' || k === '=') this.zoomAt(this.viewW / 2, this.viewH / 2, 1.2);
      if (k === '-') this.zoomAt(this.viewW / 2, this.viewH / 2, 1 / 1.2);
      if (k === 'escape') {
        this.dragStart.set(null);
        this.dragEnd.set(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const onBlur = () => this.keys.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.applyKeyPan(dt);
      this.draw(now);
    };
    raf = requestAnimationFrame(frame);

    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private draw(now: number): void {
    if (!this.renderer) return;
    const g = this.game;
    const speed = g.speed();
    this.renderer.render(
      {
        tiles: g.tiles,
        width: g.width(),
        height: g.height(),
        overlay: g.overlay(),
        night: g.lighting() === 'auto' ? this.nightFactor(now) : g.lighting() === 'night' ? 1 : 0,
        pace: speed === 0 ? 0 : 0.6 + speed * 0.5,
        showGrid: g.tool() !== 'inspect',
        hover: g.hovered(),
        selected: g.selected(),
        preview: this.preview(),
        floaters: g.floaters,
        population: g.stats()?.population ?? 0,
      },
      this.cam,
      this.viewW,
      this.viewH,
      this.dpr,
      now,
    );
  }

  /** Cosmetic day/night cycle: 4 real minutes per day. */
  private nightFactor(now: number): number {
    const phase = (now / 1000 / 240) % 1;
    const v = (-Math.cos(phase * Math.PI * 2) - 0.25) / 0.75;
    return Math.max(0, Math.min(1, v));
  }

  // ----------------------------------------------------------------- camera

  private centerOn(u: number, v: number): void {
    const p = project(u, v);
    this.cam.x = this.viewW / 2 - p.x * this.cam.zoom;
    this.cam.y = this.viewH / 2 - p.y * this.cam.zoom;
    this.publishViewport();
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const z = Math.max(0.3, Math.min(3, this.cam.zoom * factor));
    const k = z / this.cam.zoom;
    this.cam.x = sx - (sx - this.cam.x) * k;
    this.cam.y = sy - (sy - this.cam.y) * k;
    this.cam.zoom = z;
    this.publishViewport();
  }

  private applyKeyPan(dt: number): void {
    if (!this.keys.size) return;
    const speed = 700 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= speed;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= speed;
    if (dx || dy) {
      this.cam.x += dx;
      this.cam.y += dy;
      this.publishViewport();
    }
  }

  private publishViewport(): void {
    const corners = [
      screenToTile(0, 0, this.cam),
      screenToTile(this.viewW, 0, this.cam),
      screenToTile(this.viewW, this.viewH, this.cam),
      screenToTile(0, this.viewH, this.cam),
    ];
    this.viewport.corners.set(corners);
  }

  // ----------------------------------------------------------------- input

  private tileAtEvent(e: PointerEvent | WheelEvent): Coord | null {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const p = screenToTile(e.clientX - rect.left, e.clientY - rect.top, this.cam);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return this.game.tileAt(x, y) ? { x, y } : null;
  }

  onPointerDown(e: PointerEvent): void {
    const canvas = this.canvasRef().nativeElement;
    canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.zoom };
      this.pan = null;
      this.dragStart.set(null);
      this.dragEnd.set(null);
      return;
    }
    const tool = this.game.tool();
    if (e.button === 1 || e.button === 2 || (e.button === 0 && tool === 'inspect')) {
      this.pan = { sx: e.clientX, sy: e.clientY, camX: this.cam.x, camY: this.cam.y, moved: false, button: e.button };
      return;
    }
    if (e.button === 0) {
      const t = this.tileAtEvent(e);
      if (!t) return;
      this.dragStart.set(t);
      this.dragEnd.set(t);
    }
  }

  onPointerMove(e: PointerEvent): void {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    this.pointer.set({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = this.pinch.zoom * (dist / this.pinch.dist);
      this.zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, target / this.cam.zoom);
      return;
    }
    if (this.pan) {
      const dx = e.clientX - this.pan.sx;
      const dy = e.clientY - this.pan.sy;
      if (!this.pan.moved && Math.hypot(dx, dy) > 4) {
        this.pan.moved = true;
        this.panning.set(true);
      }
      if (this.pan.moved) {
        this.cam.x = this.pan.camX + dx;
        this.cam.y = this.pan.camY + dy;
        this.publishViewport();
      }
    }
    const t = this.tileAtEvent(e);
    const h = this.game.hovered();
    if (t?.x !== h?.x || t?.y !== h?.y) this.game.hovered.set(t);
    if (this.dragStart() && t) {
      const d = this.dragEnd();
      if (d?.x !== t.x || d?.y !== t.y) this.dragEnd.set(t);
    }
  }

  onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.pan) {
      if (!this.pan.moved && this.pan.button === 0) {
        const t = this.tileAtEvent(e);
        this.game.selected.set(t);
      }
      this.pan = null;
      this.panning.set(false);
      return;
    }
    const start = this.dragStart();
    if (start) {
      const p = this.preview();
      this.dragStart.set(null);
      this.dragEnd.set(null);
      if (p) {
        const tool = this.game.tool();
        const cells = p.ghost ? [{ x: p.ghost.x, y: p.ghost.y }] : p.cells.filter((_, k) => p.valid[k]);
        if (cells.length && (p.ghost ? p.ghost.valid : true)) {
          void this.game.build(cells);
        } else if (tool !== 'inspect') {
          this.game.toast('warning', 'Hier kann nicht gebaut werden.');
        }
      }
    }
  }

  onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    this.pan = null;
    this.panning.set(false);
    this.dragStart.set(null);
    this.dragEnd.set(null);
  }

  onPointerLeave(): void {
    if (!this.dragStart() && !this.pan) {
      this.game.hovered.set(null);
      this.pointer.set(null);
    }
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
  }

  private isValid(tool: Tool, c: Coord): boolean {
    const t = this.game.tileAt(c.x, c.y);
    if (!t) return false;
    const zone = ZONE_FOR_TOOL[tool];
    switch (tool) {
      case 'road':
        return t.terrain !== 'water' && (!t.building || t.building.type === 'road');
      case 'dezone':
        return !!t.zone && !t.building;
      case 'bulldoze':
        return !!t.building || t.terrain === 'forest';
      default:
        if (zone) return t.terrain !== 'water' && !t.building && t.zone !== zone;
        return false;
    }
  }
}
