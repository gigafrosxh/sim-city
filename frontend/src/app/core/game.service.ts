import { computed, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { CityApi } from './api/city-api';
import { CATALOG } from './catalog';
import { SoundName, SoundService } from './sound.service';
import {
  Budget,
  CatalogEntry,
  CityState,
  CityStats,
  Coord,
  CreateCityRequest,
  Demand,
  EventSeverity,
  GameDate,
  GameEvent,
  GameSpeed,
  Goal,
  HistoryEntry,
  Overlay,
  ServerMessage,
  TaxRates,
  Tile,
  TickUpdate,
  Tool,
} from './models';

export interface Toast {
  id: string;
  severity: EventSeverity;
  message: string;
  at?: Coord;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
}

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'error';

function errorMessage(err: unknown): string {
  const e = err as { error?: { error?: string }; message?: string };
  return e?.error?.error ?? e?.message ?? String(err);
}

/** Central client-side game state. All UI reads from these signals. */
@Injectable({ providedIn: 'root' })
export class GameService {
  readonly api = inject(CityApi);
  private readonly sound = inject(SoundService);
  /** Opens the keyboard help overlay. */
  readonly helpOpen = signal(false);

  readonly cityId = signal<string | null>(null);
  readonly cityName = signal('');
  readonly width = signal(0);
  readonly height = signal(0);
  readonly tick = signal(0);
  readonly date = signal<GameDate>({ year: 2000, month: 1, day: 1 });
  readonly speed = signal<GameSpeed>(1);
  readonly budget = signal<Budget | null>(null);
  readonly demand = signal<Demand>({ residential: 0, commercial: 0, industrial: 0 });
  readonly stats = signal<CityStats | null>(null);
  readonly history = signal<HistoryEntry[]>([]);
  readonly goals = signal<Goal[]>([]);
  readonly events = signal<GameEvent[]>([]);
  readonly toasts = signal<Toast[]>([]);
  readonly connection = signal<ConnectionState>('idle');
  readonly catalog = signal<CatalogEntry[]>(Object.values(CATALOG));

  readonly tool = signal<Tool>('inspect');
  readonly overlay = signal<Overlay>('none');
  readonly hovered = signal<Coord | null>(null);
  readonly selected = signal<Coord | null>(null);
  /** Day/night lighting: automatic cycle, always day or always night. */
  readonly lighting = signal<'auto' | 'day' | 'night'>('auto');
  readonly weatherEnabled = signal(true);
  readonly soundEnabled = signal(true);
  /** Requests the map to centre on a tile (consumed by the map component). */
  readonly focusRequest = signal<{ x: number; y: number; seq: number } | null>(null);

  /**
   * Tile grid, mutated in place for performance. The canvas renderer reads it
   * every frame; Angular views depend on {@link tilesVersion}.
   */
  tiles: Tile[] = [];
  readonly tilesVersion = signal(0);
  /** Floating "-§120" texts drawn by the renderer. */
  readonly floaters: Floater[] = [];

  readonly money = computed(() => this.budget()?.money ?? 0);
  readonly catalogByTool = computed(() => {
    const m = new Map<Tool, CatalogEntry>();
    for (const e of this.catalog()) m.set(e.tool, e);
    return m;
  });
  readonly selectedTile = computed(() => this.tileSnapshot(this.selected()));
  readonly hoveredTile = computed(() => this.tileSnapshot(this.hovered()));

  private stream?: Subscription;
  private lastSpeed: GameSpeed = 1;
  private toastSeq = 0;
  private taxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.api
      .getCatalog()
      .then((c) => c.length && this.catalog.set(c))
      .catch(() => {
        /* fall back to the bundled catalog */
      });
  }

  entry(tool: Tool): CatalogEntry {
    return this.catalogByTool().get(tool) ?? CATALOG[tool];
  }

  tileAt(x: number, y: number): Tile | null {
    if (x < 0 || y < 0 || x >= this.width() || y >= this.height()) return null;
    return this.tiles[y * this.width() + x] ?? null;
  }

  private tileSnapshot(c: Coord | null): Tile | null {
    this.tilesVersion();
    if (!c) return null;
    const t = this.tileAt(c.x, c.y);
    return t ? { ...t, building: t.building ? { ...t.building } : null } : null;
  }

  // ------------------------------------------------------------- lifecycle

  async createCity(req: CreateCityRequest): Promise<void> {
    const city = await this.api.createCity(req);
    this.open(city.id);
  }

  open(id: string): void {
    this.close();
    this.connection.set('connecting');
    this.cityId.set(id);
    this.stream = this.api.connect(id).subscribe({
      next: (msg) => this.handle(msg),
      error: (err: unknown) => {
        this.connection.set('error');
        this.toast('danger', `Verbindung fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`);
      },
    });
  }

  close(): void {
    this.stream?.unsubscribe();
    this.stream = undefined;
    this.cityId.set(null);
    this.connection.set('idle');
    this.tiles = [];
    this.width.set(0);
    this.height.set(0);
    this.events.set([]);
    this.history.set([]);
    this.selected.set(null);
    this.hovered.set(null);
    this.tilesVersion.update((v) => v + 1);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot':
        this.applySnapshot(msg.city);
        break;
      case 'tick':
        this.applyTick(msg.update);
        break;
      case 'event':
        this.events.update((e) => [msg.event, ...e].slice(0, 100));
        if (msg.event.code === 'GOAL_COMPLETED' || msg.event.code === 'MILESTONE_POPULATION') this.playSound('coin');
        else if (msg.event.severity === 'danger') this.playSound('alert');
        this.toast(msg.event.severity, msg.event.message, msg.event.x !== undefined ? { x: msg.event.x, y: msg.event.y! } : undefined);
        break;
      case 'speed':
        this.speed.set(msg.speed);
        break;
      case 'error':
        this.toast('danger', msg.message);
        break;
    }
  }

  private applySnapshot(city: CityState): void {
    this.connection.set('live');
    this.cityName.set(city.name);
    this.width.set(city.width);
    this.height.set(city.height);
    this.tiles = city.tiles;
    this.tick.set(city.tick);
    this.date.set(city.date);
    this.speed.set(city.speed);
    if (city.speed > 0) this.lastSpeed = city.speed;
    this.budget.set(city.budget);
    this.demand.set(city.demand);
    this.stats.set(city.stats);
    this.history.set(city.history);
    this.goals.set(city.goals ?? []);
    this.tilesVersion.update((v) => v + 1);
  }

  private applyTick(u: TickUpdate): void {
    this.applyTiles(u.changedTiles);
    this.tick.set(u.tick);
    this.date.set(u.date);
    this.budget.set(u.budget);
    this.demand.set(u.demand);
    this.stats.set(u.stats);
    if (u.goals) this.goals.set(u.goals);
    if (u.history) {
      const h = u.history;
      this.history.update((list) => [...list, h].slice(-240));
    }
  }

  private applyTiles(changed: Tile[]): void {
    if (!changed.length) return;
    const w = this.width();
    for (const t of changed) this.tiles[t.y * w + t.x] = t;
    this.tilesVersion.update((v) => v + 1);
  }

  // ------------------------------------------------------------- actions

  async build(coords: Coord[]): Promise<void> {
    const id = this.cityId();
    const tool = this.tool();
    if (!id || tool === 'inspect' || coords.length === 0) return;
    try {
      const result = await this.api.build(id, { tool, tiles: coords });
      this.applyTiles(result.changedTiles);
      this.budget.set(result.budget);
      const last = coords[coords.length - 1];
      if (result.ok && result.cost > 0) {
        this.floaters.push({
          x: last.x,
          y: last.y,
          text: `-§${result.cost.toLocaleString('de-DE')}`,
          color: '#ff6b6b',
          t0: performance.now(),
        });
      }
      if (result.ok) this.playSound(tool === 'bulldoze' ? 'bulldoze' : 'build');
      if (!result.ok && result.error) {
        this.playSound('error');
        this.toast('warning', result.error);
      }
    } catch (err) {
      this.toast('danger', `Bauen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  }

  async setSpeed(speed: GameSpeed): Promise<void> {
    const id = this.cityId();
    if (!id) return;
    if (speed > 0) this.lastSpeed = speed;
    this.speed.set(speed);
    try {
      await this.api.setSpeed(id, speed);
    } catch {
      this.toast('danger', 'Geschwindigkeit konnte nicht geändert werden.');
    }
  }

  togglePause(): void {
    void this.setSpeed(this.speed() === 0 ? this.lastSpeed : 0);
  }

  /** Updates tax rates locally at once and sends them debounced. */
  setTaxes(rates: TaxRates): void {
    const id = this.cityId();
    const b = this.budget();
    if (!id || !b) return;
    this.budget.set({ ...b, taxRates: rates });
    if (this.taxTimer) clearTimeout(this.taxTimer);
    this.taxTimer = setTimeout(async () => {
      try {
        const budget = await this.api.setTaxes(id, rates);
        this.budget.set(budget);
      } catch {
        this.toast('danger', 'Steuern konnten nicht gespeichert werden.');
      }
    }, 250);
  }

  async takeLoan(amount: number): Promise<void> {
    await this.budgetCall((id) => this.api.takeLoan(id, amount));
  }

  async repayLoan(): Promise<void> {
    await this.budgetCall((id) => this.api.repayLoan(id));
  }

  private async budgetCall(fn: (id: string) => Promise<Budget>): Promise<void> {
    const id = this.cityId();
    if (!id) return;
    try {
      this.budget.set(await fn(id));
    } catch (err) {
      this.toast('warning', errorMessage(err));
    }
  }

  /** Downloads the current city as a JSON save file. */
  async exportCity(): Promise<void> {
    const id = this.cityId();
    if (!id) return;
    const city = await this.api.getCity(id);
    const blob = new Blob([JSON.stringify(city)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${city.name.replace(/[^\w-]+/g, '_')}.citysim.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importCity(file: File): Promise<void> {
    try {
      const city = JSON.parse(await file.text()) as CityState;
      const created = await this.api.importCity(city);
      this.open(created.id);
      this.toast('success', `„${created.name}“ wurde importiert.`);
    } catch (err) {
      this.toast('danger', `Import fehlgeschlagen: ${errorMessage(err)}`);
      throw err;
    }
  }

  playSound(name: SoundName): void {
    if (this.soundEnabled()) this.sound.play(name);
  }

  /** Saves the current map view as PNG. */
  screenshot(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('app-city-map canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${this.cityName().replace(/[^\w-]+/g, '_') || 'city'}-${this.date().year}-${this.date().month}.png`;
    a.click();
    this.playSound('click');
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }

  focus(x: number, y: number): void {
    this.focusRequest.set({ x, y, seq: (this.focusRequest()?.seq ?? 0) + 1 });
  }

  toast(severity: EventSeverity, message: string, at?: Coord): void {
    const id = `t${++this.toastSeq}`;
    this.toasts.update((t) => [...t, { id, severity, message, at }].slice(-5));
    setTimeout(() => this.dismissToast(id), severity === 'danger' ? 9000 : 6000);
  }

  dismissToast(id: string): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
