import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { CATALOG } from '../catalog';
import {
  Budget,
  BuildRequest,
  BuildResult,
  CatalogEntry,
  CityState,
  CitySummary,
  CreateCityRequest,
  GameSpeed,
  ServerMessage,
  TaxRates,
  Tile,
} from '../models';
import { CitySimulation, SimulationSave } from '../sim/simulation';
import { CityApi } from './city-api';

/** Real-time interval per speed level, in milliseconds per tick (= one game day). */
export const TICK_INTERVAL: Record<GameSpeed, number> = { 0: 0, 1: 900, 2: 350, 3: 110 };

const INDEX_KEY = 'citysim.mock.index';
const SAVE_PREFIX = 'citysim.mock.city.';
const SAVE_EVERY_TICKS = 30;

interface RunningCity {
  sim: CitySimulation;
  subject: Subject<ServerMessage>;
  timer: ReturnType<typeof setInterval> | null;
  subscribers: number;
}

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-browser implementation of {@link CityApi}. Runs the reference
 * simulation on a timer and persists cities to localStorage, so the game is
 * fully playable without a backend.
 */
@Injectable()
export class MockCityApi extends CityApi {
  readonly label = 'Offline (lokale Simulation)';
  private readonly running = new Map<string, RunningCity>();

  async getCatalog(): Promise<CatalogEntry[]> {
    return Object.values(CATALOG).map(clone);
  }

  async listCities(): Promise<CitySummary[]> {
    return this.readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createCity(req: CreateCityRequest): Promise<CityState> {
    const id = `city-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const sim = CitySimulation.create(id, req);
    this.running.set(id, { sim, subject: new Subject(), timer: null, subscribers: 0 });
    this.persist(sim);
    return clone(sim.city);
  }

  async getCity(id: string): Promise<CityState> {
    return clone(this.load(id).sim.city);
  }

  async deleteCity(id: string): Promise<void> {
    const rc = this.running.get(id);
    if (rc?.timer) clearInterval(rc.timer);
    this.running.delete(id);
    try {
      localStorage.removeItem(SAVE_PREFIX + id);
    } catch {
      // ignore
    }
    this.writeIndex(this.readIndex().filter((c) => c.id !== id));
  }

  async build(cityId: string, req: BuildRequest): Promise<BuildResult> {
    const rc = this.load(cityId);
    const result = rc.sim.build(req);
    for (const event of rc.sim.drainEvents()) rc.subject.next({ type: 'event', event });
    if (result.ok) this.persist(rc.sim);
    return clone(result);
  }

  async setTaxes(cityId: string, taxRates: TaxRates): Promise<Budget> {
    const rc = this.load(cityId);
    const budget = rc.sim.setTaxes(taxRates);
    this.persist(rc.sim);
    return clone(budget);
  }

  async setSpeed(cityId: string, speed: GameSpeed): Promise<void> {
    const rc = this.load(cityId);
    rc.sim.city.speed = speed;
    this.restartTimer(rc);
    rc.subject.next({ type: 'speed', speed });
  }

  connect(cityId: string): Observable<ServerMessage> {
    return new Observable<ServerMessage>((observer) => {
      let rc: RunningCity;
      try {
        rc = this.load(cityId);
      } catch (e) {
        observer.error(e);
        return;
      }
      const sub = rc.subject.subscribe(observer);
      rc.subscribers++;
      observer.next({ type: 'snapshot', city: clone(rc.sim.city) });
      this.restartTimer(rc);
      return () => {
        sub.unsubscribe();
        rc.subscribers--;
        if (rc.subscribers <= 0) {
          if (rc.timer) clearInterval(rc.timer);
          rc.timer = null;
          this.persist(rc.sim);
        }
      };
    });
  }

  // ------------------------------------------------------------------ internals

  private restartTimer(rc: RunningCity): void {
    if (rc.timer) clearInterval(rc.timer);
    rc.timer = null;
    const interval = TICK_INTERVAL[rc.sim.city.speed];
    if (!interval || rc.subscribers <= 0) return;
    rc.timer = setInterval(() => this.tick(rc), interval);
  }

  private tick(rc: RunningCity): void {
    const { update, events } = rc.sim.step();
    // Simulate the JSON boundary of a real server.
    const changedTiles: Tile[] = update.changedTiles.map(clone);
    rc.subject.next({
      type: 'tick',
      update: {
        ...update,
        changedTiles,
        budget: clone(update.budget),
        stats: clone(update.stats),
        demand: clone(update.demand),
        history: update.history ? clone(update.history) : undefined,
      },
    });
    for (const event of events) rc.subject.next({ type: 'event', event });
    if (update.tick % SAVE_EVERY_TICKS === 0) this.persist(rc.sim);
  }

  private load(id: string): RunningCity {
    let rc = this.running.get(id);
    if (rc) return rc;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_PREFIX + id);
    } catch {
      // ignore
    }
    if (!raw) throw new Error(`Stadt ${id} nicht gefunden`);
    const save = JSON.parse(raw) as SimulationSave;
    rc = { sim: new CitySimulation(save), subject: new Subject(), timer: null, subscribers: 0 };
    this.running.set(id, rc);
    return rc;
  }

  private persist(sim: CitySimulation): void {
    const city = sim.city;
    try {
      localStorage.setItem(SAVE_PREFIX + city.id, JSON.stringify(sim.save()));
      const summary: CitySummary = {
        id: city.id,
        name: city.name,
        width: city.width,
        height: city.height,
        population: city.stats.population,
        money: city.budget.money,
        date: { ...city.date },
        updatedAt: new Date().toISOString(),
      };
      this.writeIndex([summary, ...this.readIndex().filter((c) => c.id !== city.id)]);
    } catch {
      // Quota exceeded or storage disabled: the game keeps running in memory.
    }
  }

  private readIndex(): CitySummary[] {
    try {
      return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as CitySummary[];
    } catch {
      return [];
    }
  }

  private writeIndex(list: CitySummary[]): void {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }
}
