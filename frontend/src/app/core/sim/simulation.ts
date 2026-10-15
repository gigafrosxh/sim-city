import {
  CATALOG,
  COM_JOBS,
  LOAN_AMOUNTS,
  LOAN_INTEREST,
  LOAN_MONTHS,
  IND_JOBS,
  RES_CAPACITY,
  ZONE_FOR_TOOL,
  ZONE_POWER_USE,
  ZONE_WATER_USE,
} from '../catalog';
import {
  Budget,
  Building,
  BuildingType,
  BuildRequest,
  BuildResult,
  CityState,
  CityStats,
  Coord,
  CreateCityRequest,
  Demand,
  EventSeverity,
  GameEvent,
  Goal,
  HistoryEntry,
  ServiceBuildingType,
  TaxRates,
  Tile,
  TickUpdate,
  ZoneType,
} from '../models';
import { generateTerrain } from './mapgen';
import { Rng } from './rng';

/**
 * Reference implementation of the City-Sim rules described in
 * docs/api-contract.md ("Simulation rules"). The mock API runs it in the
 * browser; the backend is expected to implement the same behaviour.
 */

export const START_MONEY = 40000;
export const DEFAULT_TAX = 9;
const MAX_HISTORY = 240;
const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const ROAD_ACCESS_DISTANCE = 3;

interface SimInternal {
  rngState: number;
  milestone: number;
  eventSeq: number;
  flags: Record<string, boolean>;
}

export interface SimulationSave {
  city: CityState;
  internal: SimInternal;
}

export interface StepResult {
  update: TickUpdate;
  events: GameEvent[];
}

interface Coverage {
  police: Float32Array;
  fire: Float32Array;
  school: Float32Array;
  hospital: Float32Array;
  park: Float32Array;
  /** Stadium and city hall: city-wide leisure / civic pride. */
  leisure: Float32Array;
}

const SERVICE_TYPES: ServiceBuildingType[] = [
  'power_coal',
  'power_solar',
  'power_wind',
  'stadium',
  'city_hall',
  'water_pump',
  'police',
  'fire',
  'school',
  'hospital',
  'park',
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function emptyBudget(): Budget {
  return {
    money: START_MONEY,
    taxRates: { residential: DEFAULT_TAX, commercial: DEFAULT_TAX, industrial: DEFAULT_TAX },
    lastMonthIncome: 0,
    lastMonthExpenses: 0,
    incomeBreakdown: { residential: 0, commercial: 0, industrial: 0 },
    expenseBreakdown: { roads: 0, power: 0, water: 0, services: 0, loans: 0 },
    loanBalance: 0,
    loanPayment: 0,
  };
}

interface GoalDef {
  id: string;
  title: string;
  description: string;
  reward: number;
  target: number;
  progress: (s: CityStats, count: (t: BuildingType) => number) => number;
}

/** City objectives; completing one pays out its reward once. */
export const GOAL_DEFS: GoalDef[] = [
  { id: 'roads', title: 'Erste Straßen', description: 'Baue 10 Straßenfelder.', reward: 1000, target: 10, progress: (s) => s.roadCount },
  { id: 'power', title: 'Es werde Licht', description: 'Baue ein Kraftwerk oder Windrad.', reward: 1500, target: 1, progress: (s) => (s.powerSupply > 0 ? 1 : 0) },
  { id: 'pop100', title: 'Erste Bürger', description: 'Erreiche 100 Einwohner.', reward: 2000, target: 100, progress: (s) => s.population },
  { id: 'water', title: 'Wasser marsch', description: 'Baue eine Wasserpumpe.', reward: 1500, target: 1, progress: (_, c) => c('water_pump') },
  { id: 'jobs', title: 'Arbeitsmarkt', description: 'Schaffe 300 Arbeitsplätze.', reward: 3000, target: 300, progress: (s) => s.jobs },
  { id: 'police', title: 'Sicherheit', description: 'Baue eine Polizeiwache.', reward: 1500, target: 1, progress: (_, c) => c('police') },
  { id: 'fire', title: 'Brandschutz', description: 'Baue eine Feuerwache.', reward: 1500, target: 1, progress: (_, c) => c('fire') },
  { id: 'pop500', title: 'Kleinstadt', description: 'Erreiche 500 Einwohner.', reward: 5000, target: 500, progress: (s) => s.population },
  { id: 'school', title: 'Bildung für alle', description: 'Baue eine Schule.', reward: 2000, target: 1, progress: (_, c) => c('school') },
  { id: 'parks', title: 'Grüne Stadt', description: 'Lege 5 Parks an.', reward: 2000, target: 5, progress: (_, c) => c('park') },
  { id: 'clean', title: 'Saubere Energie', description: 'Erzeuge 300 MW mit Wind oder Sonne.', reward: 4000, target: 300, progress: (_, c) => c('power_wind') * 80 + c('power_solar') * 300 },
  { id: 'pop1000', title: 'Stadtrecht', description: 'Erreiche 1.000 Einwohner.', reward: 10000, target: 1000, progress: (s) => s.population },
  { id: 'cityhall', title: 'Wahrzeichen', description: 'Baue das Rathaus.', reward: 5000, target: 1, progress: (_, c) => c('city_hall') },
  { id: 'happy', title: 'Glückliche Bürger', description: 'Halte die Zufriedenheit bei 70 % (ab 500 Einwohnern).', reward: 6000, target: 70, progress: (s) => (s.population >= 500 ? s.happiness : 0) },
  { id: 'pop5000', title: 'Großstadt', description: 'Erreiche 5.000 Einwohner.', reward: 25000, target: 5000, progress: (s) => s.population },
];

function initialGoals(): Goal[] {
  return GOAL_DEFS.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    reward: g.reward,
    target: g.target,
    progress: 0,
    completed: false,
  }));
}

function emptyStats(): CityStats {
  return {
    population: 0,
    jobs: 0,
    commercialJobs: 0,
    industrialJobs: 0,
    unemployment: 0,
    powerSupply: 0,
    powerDemand: 0,
    waterSupply: 0,
    waterDemand: 0,
    happiness: 50,
    avgLandValue: 0,
    avgPollution: 0,
    avgCrime: 0,
    buildingCount: 0,
    roadCount: 0,
    avgTraffic: 0,
    buildingsOnFire: 0,
  };
}

export class CitySimulation {
  readonly city: CityState;
  private readonly rng: Rng;
  private readonly internal: SimInternal;
  private readonly changed = new Set<number>();
  private readonly n: number;
  private roadDist: Uint8Array;
  private readonly waterBonus: Float32Array;
  private coverage: Coverage;
  private roadsDirty = true;
  private fieldsDirty = true;
  private pendingEvents: GameEvent[] = [];
  private typeCounts = new Map<BuildingType, number>();
  private goalsChanged = false;

  static create(id: string, req: CreateCityRequest): CitySimulation {
    const seed = req.seed ?? Math.floor(Math.random() * 1e9);
    const city: CityState = {
      id,
      name: req.name,
      width: req.width,
      height: req.height,
      seed,
      tick: 0,
      date: { year: 2000, month: 1, day: 1 },
      speed: 1,
      tiles: generateTerrain(req.width, req.height, seed),
      budget: emptyBudget(),
      demand: { residential: 0.5, commercial: 0.3, industrial: 0.5 },
      stats: emptyStats(),
      history: [],
      goals: initialGoals(),
    };
    const sim = new CitySimulation({
      city,
      internal: { rngState: seed, milestone: 0, eventSeq: 0, flags: {} },
    });
    sim.recomputeAll();
    sim.changed.clear();
    sim.pendingEvents = [];
    return sim;
  }

  constructor(save: SimulationSave) {
    this.city = save.city;
    this.internal = save.internal;
    // Upgrade saves from older versions.
    this.city.goals ??= initialGoals();
    this.city.budget = { ...emptyBudget(), ...this.city.budget };
    this.city.budget.expenseBreakdown = { ...emptyBudget().expenseBreakdown, ...this.city.budget.expenseBreakdown };
    this.city.stats = { ...emptyStats(), ...this.city.stats };
    for (const t of this.city.tiles) t.traffic ??= 0;
    for (const t of this.city.tiles) {
      const b = t.building;
      if (b && b.originX === t.x && b.originY === t.y) this.typeCounts.set(b.type, (this.typeCounts.get(b.type) ?? 0) + 1);
    }
    this.rng = new Rng(save.internal.rngState);
    this.n = this.city.width * this.city.height;
    this.roadDist = new Uint8Array(this.n);
    this.waterBonus = this.computeWaterBonus();
    this.coverage = this.emptyCoverage();
  }

  save(): SimulationSave {
    this.internal.rngState = this.rng.seed;
    return { city: this.city, internal: this.internal };
  }

  // ---------------------------------------------------------------- helpers

  private idx(x: number, y: number): number {
    return y * this.city.width + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.city.width && y < this.city.height;
  }

  private tileAt(x: number, y: number): Tile | null {
    return this.inBounds(x, y) ? this.city.tiles[this.idx(x, y)] : null;
  }

  private mark(t: Tile): void {
    this.changed.add(this.idx(t.x, t.y));
  }

  private emptyCoverage(): Coverage {
    return {
      police: new Float32Array(this.n),
      fire: new Float32Array(this.n),
      school: new Float32Array(this.n),
      hospital: new Float32Array(this.n),
      park: new Float32Array(this.n),
      leisure: new Float32Array(this.n),
    };
  }

  private emit(severity: EventSeverity, code: string, message: string, at?: Coord): void {
    this.pendingEvents.push({
      id: `${this.city.id}-${this.city.tick}-${++this.internal.eventSeq}`,
      tick: this.city.tick,
      date: { ...this.city.date },
      severity,
      code,
      message,
      x: at?.x,
      y: at?.y,
    });
  }

  drainEvents(): GameEvent[] {
    const e = this.pendingEvents;
    this.pendingEvents = [];
    return e;
  }

  // ---------------------------------------------------------------- actions

  setTaxes(rates: TaxRates): Budget {
    const t = this.city.budget.taxRates;
    t.residential = clamp(Math.round(rates.residential), 0, 20);
    t.commercial = clamp(Math.round(rates.commercial), 0, 20);
    t.industrial = clamp(Math.round(rates.industrial), 0, 20);
    this.city.demand = this.computeDemand(this.city.stats);
    return this.city.budget;
  }

  takeLoan(amount: number): Budget {
    const b = this.city.budget;
    if (!LOAN_AMOUNTS.includes(amount)) throw new Error('Ungültiger Kreditbetrag');
    if (b.loanBalance > 0) throw new Error('Es läuft bereits ein Kredit');
    b.money += amount;
    b.loanBalance = Math.round(amount * (1 + LOAN_INTEREST));
    b.loanPayment = Math.ceil(b.loanBalance / LOAN_MONTHS);
    this.emit('info', 'LOAN_TAKEN', `Kredit über ${amount.toLocaleString('de-DE')} § aufgenommen.`);
    return b;
  }

  repayLoan(): Budget {
    const b = this.city.budget;
    if (b.loanBalance <= 0) throw new Error('Kein offener Kredit');
    if (b.money < b.loanBalance) throw new Error('Nicht genug Geld für die Tilgung');
    b.money -= b.loanBalance;
    b.loanBalance = 0;
    b.loanPayment = 0;
    this.emit('success', 'LOAN_REPAID', 'Kredit vollständig getilgt.');
    return b;
  }

  build(req: BuildRequest): BuildResult {
    const entry = CATALOG[req.tool];
    const before = new Set(this.changed);
    this.changed.clear();
    let cost = 0;
    let placed = 0;
    let error: string | undefined;
    const budget = this.city.budget;
    const afford = (c: number) => budget.money - cost >= c;

    const seen = new Set<number>();
    const coords = (req.tiles ?? []).filter((c) => {
      if (!this.inBounds(c.x, c.y)) return false;
      const i = this.idx(c.x, c.y);
      if (seen.has(i)) return false;
      seen.add(i);
      return true;
    });

    if (!entry || req.tool === ('inspect' as string)) {
      error = 'Unbekanntes Werkzeug';
    } else if (coords.length === 0) {
      error = 'Keine gültigen Felder';
    } else if ((entry.unlockPopulation ?? 0) > this.city.stats.population) {
      error = `${entry.name} wird ab ${entry.unlockPopulation!.toLocaleString('de-DE')} Einwohnern freigeschaltet`;
    } else if (entry.unique && (this.typeCounts.get(req.tool as BuildingType) ?? 0) > 0) {
      error = `${entry.name} gibt es nur einmal pro Stadt`;
    } else if (req.tool === 'road') {
      for (const c of coords) {
        const t = this.tileAt(c.x, c.y)!;
        if (t.terrain === 'water' || t.building) continue;
        const c1 = entry.cost + (t.terrain === 'forest' ? 5 : 0);
        if (!afford(c1)) {
          error = 'Nicht genug Geld';
          break;
        }
        cost += c1;
        if (t.terrain === 'forest') t.terrain = 'grass';
        t.zone = null;
        t.building = this.newBuilding('road', c.x, c.y, 1);
        this.mark(t);
        placed++;
      }
      this.roadsDirty = true;
    } else if (ZONE_FOR_TOOL[req.tool]) {
      const zone = ZONE_FOR_TOOL[req.tool]!;
      for (const c of coords) {
        const t = this.tileAt(c.x, c.y)!;
        if (t.terrain === 'water' || t.building || t.zone === zone) continue;
        const c1 = entry.cost + (t.terrain === 'forest' ? 5 : 0);
        if (!afford(c1)) {
          error = 'Nicht genug Geld';
          break;
        }
        cost += c1;
        if (t.terrain === 'forest') t.terrain = 'grass';
        t.zone = zone;
        this.mark(t);
        placed++;
      }
    } else if (req.tool === 'dezone') {
      for (const c of coords) {
        const t = this.tileAt(c.x, c.y)!;
        if (!t.zone || t.building) continue;
        t.zone = null;
        this.mark(t);
        placed++;
      }
    } else if (req.tool === 'bulldoze') {
      for (const c of coords) {
        const t = this.tileAt(c.x, c.y)!;
        if (t.building) {
          const b = t.building;
          const c1 = entry.cost * b.size * b.size * Math.max(1, b.level);
          if (!afford(c1)) {
            error = 'Nicht genug Geld';
            break;
          }
          cost += c1;
          for (let dy = 0; dy < b.size; dy++) {
            for (let dx = 0; dx < b.size; dx++) {
              const ft = this.tileAt(b.originX + dx, b.originY + dy);
              if (ft && ft.building === b) {
                ft.building = null;
                this.mark(ft);
              }
            }
          }
          if (b.type === 'road') this.roadsDirty = true;
          placed++;
        } else if (t.terrain === 'forest') {
          if (!afford(entry.cost)) {
            error = 'Nicht genug Geld';
            break;
          }
          cost += entry.cost;
          t.terrain = 'grass';
          this.mark(t);
          placed++;
        }
      }
    } else if ((SERVICE_TYPES as string[]).includes(req.tool)) {
      const type = req.tool as ServiceBuildingType;
      const size = entry.size;
      // 1x1 buildings (parks, pumps, …) can be placed on a whole dragged area.
      const origins = size === 1 && !entry.unique ? coords : [coords[0]];
      for (const o of origins) {
        let valid = true;
        for (let dy = 0; dy < size && valid; dy++) {
          for (let dx = 0; dx < size && valid; dx++) {
            const t = this.tileAt(o.x + dx, o.y + dy);
            if (!t || t.terrain === 'water' || t.building) valid = false;
          }
        }
        if (!valid) {
          error = 'Hier kann nicht gebaut werden';
          continue;
        }
        if (!afford(entry.cost)) {
          error = 'Nicht genug Geld';
          break;
        }
        cost += entry.cost;
        const b = this.newBuilding(type, o.x, o.y, size);
        for (let dy = 0; dy < size; dy++) {
          for (let dx = 0; dx < size; dx++) {
            const t = this.tileAt(o.x + dx, o.y + dy)!;
            t.building = b;
            t.zone = null;
            if (t.terrain === 'forest') t.terrain = 'grass';
            this.mark(t);
          }
        }
        placed++;
        this.typeCounts.set(type, (this.typeCounts.get(type) ?? 0) + 1);
      }
      if (placed > 0) {
        const label = placed > 1 ? `${placed}× ${entry.name} wurden errichtet.` : `${entry.name} wurde errichtet.`;
        this.emit('success', 'BUILDING_COMPLETED', label, coords[0]);
      }
    } else {
      error = 'Unbekanntes Werkzeug';
    }

    budget.money -= cost;
    if (placed > 0) {
      this.fieldsDirty = true;
      this.recomputeNetworks();
    }
    const changedTiles = [...this.changed].map((i) => this.city.tiles[i]);
    // Keep earlier pending changes for the next tick diff as well.
    for (const i of before) this.changed.add(i);
    return {
      ok: placed > 0,
      cost,
      placed,
      error: placed > 0 ? undefined : (error ?? 'Nichts zu tun'),
      changedTiles,
      budget,
    };
  }

  private newBuilding(type: BuildingType, x: number, y: number, size: number): Building {
    return {
      type,
      level: 1,
      originX: x,
      originY: y,
      size,
      builtAt: this.city.tick,
      variant: this.rng.int(4),
    };
  }

  // ---------------------------------------------------------------- tick

  step(): StepResult {
    const c = this.city;
    c.tick++;
    const d = c.date;
    d.day++;
    let monthEnded = false;
    if (d.day > 30) {
      d.day = 1;
      d.month++;
      monthEnded = true;
      if (d.month > 12) {
        d.month = 1;
        d.year++;
      }
    }

    this.recomputeNetworks();
    if (this.fieldsDirty || c.tick % 4 === 0) this.computeFields();
    this.growZones();
    this.updateFires();
    c.stats = this.computeStats();
    c.demand = this.computeDemand(c.stats);
    this.checkConditions();
    this.checkGoals();

    let history: HistoryEntry | undefined;
    if (monthEnded) history = this.endOfMonth();

    const changedTiles = [...this.changed].map((i) => c.tiles[i]);
    this.changed.clear();
    const goals = this.goalsChanged ? c.goals : undefined;
    this.goalsChanged = false;
    return {
      update: {
        tick: c.tick,
        date: { ...c.date },
        changedTiles,
        budget: c.budget,
        demand: c.demand,
        stats: c.stats,
        history,
        goals,
      },
      events: this.drainEvents(),
    };
  }

  private recomputeAll(): void {
    this.recomputeNetworks();
    this.computeFields();
    this.city.stats = this.computeStats();
    this.city.demand = this.computeDemand(this.city.stats);
  }

  // ---------------------------------------------------------------- goals & fires

  private checkGoals(): void {
    const s = this.city.stats;
    const count = (t: BuildingType) => this.typeCounts.get(t) ?? 0;
    for (const def of GOAL_DEFS) {
      const g = this.city.goals.find((x) => x.id === def.id);
      if (!g || g.completed) continue;
      const progress = Math.min(def.target, Math.round(def.progress(s, count)));
      if (progress !== g.progress) {
        g.progress = progress;
        this.goalsChanged = true;
      }
      if (progress >= def.target) {
        g.completed = true;
        this.city.budget.money += def.reward;
        this.goalsChanged = true;
        this.emit('success', 'GOAL_COMPLETED', `Ziel erreicht: ${def.title} (+${def.reward.toLocaleString('de-DE')} §)`);
      }
    }
  }

  private markBuilding(b: Building): void {
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const t = this.tileAt(b.originX + dx, b.originY + dy);
        if (t && t.building === b) this.mark(t);
      }
    }
  }

  /**
   * Fires: buildings outside fire-station coverage occasionally ignite, can
   * spread to neighbours and burn down unless a fire station covers them.
   */
  private updateFires(): void {
    const tiles = this.city.tiles;
    const fireCov = this.coverage.fire;
    for (let i = 0; i < this.n; i++) {
      const t = tiles[i];
      const b = t.building;
      if (!b || b.type === 'road' || b.type === 'park' || !this.isOrigin(t)) continue;
      const covered = fireCov[i];
      if (b.fire && b.fire > 0) {
        b.fire -= covered >= 0.3 ? 4 : 1;
        // Spread to a random neighbour while burning unchecked.
        if (covered < 0.3 && this.rng.next() < 0.012) {
          const dir = this.rng.int(4);
          const nx = b.originX + [-1, b.size, 0, 0][dir];
          const ny = b.originY + [0, 0, -1, b.size][dir];
          const nb = this.tileAt(nx, ny)?.building;
          if (nb && nb.type !== 'road' && nb.type !== 'park' && !nb.fire) {
            nb.fire = 40;
            this.markBuilding(nb);
          }
        }
        if (b.fire <= 0) {
          b.fire = 0;
          if (covered >= 0.3) {
            this.emit('success', 'FIRE_EXTINGUISHED', 'Die Feuerwehr hat einen Brand gelöscht.', { x: t.x, y: t.y });
          } else {
            this.destroy(b);
            this.emit('danger', 'BUILDING_BURNED', 'Ein Gebäude ist abgebrannt. Baue Feuerwachen!', { x: t.x, y: t.y });
            continue;
          }
        }
        this.markBuilding(b);
        continue;
      }
      // Ignition chance: industry burns more easily, coverage protects.
      const risk = (b.type === 'industrial' ? 2 : 1) * 0.000012 * (1 - covered) * Math.max(1, b.level);
      // First game year is fire-free so new players can get going.
      if (this.city.tick > 360 && this.rng.next() < risk) {
        b.fire = 40;
        this.markBuilding(b);
        this.emit('danger', 'FIRE', `Feuer! Ein Gebäude brennt bei ${t.x}/${t.y}.`, { x: t.x, y: t.y });
      }
    }
  }

  private destroy(b: Building): void {
    for (let dy = 0; dy < b.size; dy++) {
      for (let dx = 0; dx < b.size; dx++) {
        const ft = this.tileAt(b.originX + dx, b.originY + dy);
        if (ft && ft.building === b) {
          ft.building = null;
          this.mark(ft);
        }
      }
    }
    this.fieldsDirty = true;
  }

  // ---------------------------------------------------------------- networks

  private recomputeNetworks(): void {
    if (this.roadsDirty) {
      this.computeRoadAccess();
      this.roadsDirty = false;
    }
    const power = this.distribute(
      (t) => {
        const ty = t.building?.type;
        return ty === 'power_coal' || ty === 'power_solar' || ty === 'power_wind' ? (CATALOG[ty].powerSupply ?? 0) : 0;
      },
      (t) => this.powerUse(t),
    );
    const water = this.distribute(
      (t) => {
        if (t.building?.type !== 'water_pump') return 0;
        const base = CATALOG.water_pump.waterSupply ?? 0;
        return this.nearWater(t.x, t.y) ? base * 2 : base;
      },
      (t) => this.waterUse(t),
    );
    const tiles = this.city.tiles;
    for (let i = 0; i < this.n; i++) {
      const t = tiles[i];
      const p = power.result[i] === 1;
      const w = water.result[i] === 1;
      if (t.powered !== p || t.watered !== w) {
        t.powered = p;
        t.watered = w;
        this.changed.add(i);
      }
    }
    this.city.stats.powerSupply = power.supply;
    this.city.stats.powerDemand = power.demand;
    this.city.stats.waterSupply = water.supply;
    this.city.stats.waterDemand = water.demand;
  }

  private isOrigin(t: Tile): boolean {
    return !!t.building && t.building.originX === t.x && t.building.originY === t.y;
  }

  private powerUse(t: Tile): number {
    const b = t.building;
    if (!b || !this.isOrigin(t)) return 0;
    if (b.type === 'residential' || b.type === 'commercial' || b.type === 'industrial') {
      return ZONE_POWER_USE[b.type] * b.level;
    }
    return b.type === 'road' ? 0 : (CATALOG[b.type].powerUse ?? 0);
  }

  private waterUse(t: Tile): number {
    const b = t.building;
    if (!b || !this.isOrigin(t)) return 0;
    if (b.type === 'residential' || b.type === 'commercial' || b.type === 'industrial') {
      return ZONE_WATER_USE[b.type] * b.level;
    }
    return b.type === 'road' ? 0 : (CATALOG[b.type].waterUse ?? 0);
  }

  private nearWater(x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.tileAt(x + dx, y + dy)?.terrain === 'water') return true;
      }
    }
    return false;
  }

  /**
   * Utility distribution: every tile with a building or a zone conducts.
   * Each connected component is filled in BFS order from its sources until
   * the component's supply is exhausted.
   */
  private distribute(supplyOf: (t: Tile) => number, useOf: (t: Tile) => number) {
    const tiles = this.city.tiles;
    const w = this.city.width;
    const h = this.city.height;
    const visited = new Uint8Array(this.n);
    const result = new Uint8Array(this.n);
    let totalSupply = 0;
    let totalDemand = 0;
    for (let i = 0; i < this.n; i++) totalDemand += useOf(tiles[i]);

    const conducts = (t: Tile) => !!t.building || !!t.zone;
    const queue = new Int32Array(this.n);
    for (let s = 0; s < this.n; s++) {
      const st = tiles[s];
      if (visited[s] || !st.building || !this.isOrigin(st) || supplyOf(st) <= 0) continue;
      // Collect the component.
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      visited[s] = 1;
      let supply = 0;
      while (head < tail) {
        const i = queue[head++];
        const t = tiles[i];
        if (this.isOrigin(t)) supply += supplyOf(t);
        const x = i % w;
        const y = (i - x) / w;
        const nb = [
          x > 0 ? i - 1 : -1,
          x < w - 1 ? i + 1 : -1,
          y > 0 ? i - w : -1,
          y < h - 1 ? i + w : -1,
        ];
        for (const j of nb) {
          if (j >= 0 && !visited[j] && conducts(tiles[j])) {
            visited[j] = 1;
            queue[tail++] = j;
          }
        }
      }
      totalSupply += supply;
      let used = 0;
      for (let k = 0; k < tail; k++) {
        const i = queue[k];
        const t = tiles[i];
        const u = useOf(t);
        if (used + u <= supply) {
          used += u;
          result[i] = 1;
        }
      }
      // Footprint tiles of a building share their origin's state.
      for (let k = 0; k < tail; k++) {
        const t = tiles[queue[k]];
        const b = t.building;
        if (b && b.size > 1 && !this.isOrigin(t)) {
          result[queue[k]] = result[this.idx(b.originX, b.originY)];
        }
      }
    }
    return { result, supply: totalSupply, demand: totalDemand };
  }

  private computeRoadAccess(): void {
    const w = this.city.width;
    const h = this.city.height;
    const dist = new Uint8Array(this.n).fill(255);
    const queue = new Int32Array(this.n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.city.tiles[i].building?.type === 'road') {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      if (dist[i] >= ROAD_ACCESS_DISTANCE) continue;
      const x = i % w;
      const y = (i - x) / w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && dist[j] === 255) {
          dist[j] = dist[i] + 1;
          queue[tail++] = j;
        }
      }
    }
    this.roadDist = dist;
  }

  private computeWaterBonus(): Float32Array {
    const bonus = new Float32Array(this.n);
    for (const t of this.city.tiles) {
      if (t.terrain === 'water') continue;
      let best = 99;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (this.tileAt(t.x + dx, t.y + dy)?.terrain === 'water') {
            best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
          }
        }
      }
      if (best <= 3) bonus[this.idx(t.x, t.y)] = 15 * (1 - (best - 1) / 3);
    }
    return bonus;
  }

  // ---------------------------------------------------------------- fields

  private spread(arr: Float32Array, cx: number, cy: number, r: number, strength: number, mode: 'add' | 'max'): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.city.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.city.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const v = strength * (1 - d / (r + 1));
        const i = this.idx(x, y);
        if (mode === 'add') arr[i] += v;
        else if (v > arr[i]) arr[i] = v;
      }
    }
  }

  private computeFields(): void {
    this.fieldsDirty = false;
    const cov = this.emptyCoverage();
    const pollution = new Float32Array(this.n);
    const crimeRaw = new Float32Array(this.n);
    const trafficRaw = new Float32Array(this.n);
    for (const t of this.city.tiles) {
      const b = t.building;
      if (!b || !this.isOrigin(t)) continue;
      const cx = b.originX + (b.size - 1) / 2;
      const cy = b.originY + (b.size - 1) / 2;
      switch (b.type) {
        case 'police':
        case 'fire':
        case 'school':
        case 'hospital':
        case 'park':
          // Unpowered services (parks excepted) only work at half strength.
          this.spread(cov[b.type], cx, cy, CATALOG[b.type].radius ?? 5, t.powered || b.type === 'park' ? 1 : 0.5, 'max');
          break;
        case 'stadium':
        case 'city_hall':
          this.spread(cov.leisure, cx, cy, CATALOG[b.type].radius ?? 10, t.powered ? 1 : 0.5, 'max');
          if (b.type === 'stadium') this.spread(trafficRaw, cx, cy, 4, 20, 'add');
          break;
        case 'power_coal':
          this.spread(pollution, cx, cy, 8, 70, 'add');
          break;
        case 'industrial':
          this.spread(pollution, cx, cy, 4, 12 * b.level, 'add');
          this.spread(trafficRaw, cx, cy, 3, 5 * b.level, 'add');
          break;
        case 'commercial':
          if (b.level >= 2) this.spread(pollution, cx, cy, 2, 4 * b.level, 'add');
          this.spread(crimeRaw, cx, cy, 3, 5 * b.level, 'add');
          this.spread(trafficRaw, cx, cy, 3, 6 * b.level, 'add');
          break;
        case 'residential':
          this.spread(crimeRaw, cx, cy, 3, 4 * b.level, 'add');
          this.spread(trafficRaw, cx, cy, 3, 4 * b.level, 'add');
          break;
      }
    }
    this.coverage = cov;
    const tiles = this.city.tiles;
    for (let i = 0; i < this.n; i++) {
      const t = tiles[i];
      const isRoad = t.building?.type === 'road';
      const traffic = isRoad ? Math.round(clamp(trafficRaw[i] * 1.5, 0, 100)) : 0;
      // Congestion adds exhaust fumes around busy roads.
      const pol = Math.round(clamp((pollution[i] + trafficRaw[i] * 0.12) * (t.terrain === 'forest' ? 0.6 : 1), 0, 100));
      const crime = Math.round(clamp(crimeRaw[i] * (1 - 0.85 * cov.police[i]), 0, 100));
      let lv = 0;
      if (t.terrain !== 'water') {
        lv =
          35 +
          this.waterBonus[i] +
          (t.terrain === 'forest' ? 5 : 0) +
          cov.park[i] * 25 +
          cov.school[i] * 12 +
          cov.hospital[i] * 10 +
          cov.fire[i] * 6 +
          cov.police[i] * 5 +
          cov.leisure[i] * 10 -
          pol * 0.6 -
          crime * 0.3 -
          Math.max(0, trafficRaw[i] - 40) * 0.15;
        lv = Math.round(clamp(lv, 0, 100));
      }
      if (t.pollution !== pol || t.crime !== crime || t.landValue !== lv || t.traffic !== traffic) {
        t.traffic = traffic;
        t.pollution = pol;
        t.crime = crime;
        t.landValue = lv;
        this.changed.add(i);
      }
    }
  }

  // ---------------------------------------------------------------- growth

  private growZones(): void {
    const demand = this.city.demand;
    for (let i = 0; i < this.n; i++) {
      const t = this.city.tiles[i];
      if (!t.zone) continue;
      const b = t.building;
      if (b && b.type !== t.zone) continue;
      const level = b?.level ?? 0;
      const r = this.rng.next();

      if (this.roadDist[i] > ROAD_ACCESS_DISTANCE || !t.powered) {
        if (level > 0 && r < 0.006) this.decline(t);
        continue;
      }
      let local = 0;
      if (t.zone === 'residential') local = (t.landValue - 40) / 100 - t.pollution / 150 - t.crime / 200;
      else if (t.zone === 'commercial') local = (t.landValue - 40) / 120 - t.crime / 250;
      else local = t.landValue > 75 ? -0.1 : 0;
      const score = demand[t.zone] + local;

      if (score > 0.05 && level < 3) {
        if (level >= 1 && !t.watered) continue;
        if (level === 2 && t.zone !== 'industrial' && t.landValue < 45) continue;
        if (r < 0.012 + 0.05 * score) this.grow(t, t.zone);
      } else if (score < -0.25 && level > 0 && r < 0.01) {
        this.decline(t);
      }
    }
  }

  private grow(t: Tile, zone: ZoneType): void {
    if (!t.building) {
      t.building = this.newBuilding(zone, t.x, t.y, 1);
    } else {
      t.building.level++;
      t.building.builtAt = this.city.tick;
    }
    this.fieldsDirty = true;
    this.mark(t);
  }

  private decline(t: Tile): void {
    if (!t.building) return;
    t.building.level--;
    t.building.builtAt = this.city.tick;
    if (t.building.level <= 0) t.building = null;
    this.fieldsDirty = true;
    this.mark(t);
  }

  // ---------------------------------------------------------------- stats

  private computeStats(): CityStats {
    const s = this.city.stats;
    let population = 0;
    let com = 0;
    let ind = 0;
    let buildings = 0;
    let roads = 0;
    let lvSum = 0;
    let polSum = 0;
    let crimeSum = 0;
    let land = 0;
    let happySum = 0;
    let happyWeight = 0;
    let trafficSum = 0;
    let onFire = 0;
    const counts = new Map<BuildingType, number>();
    for (let i = 0; i < this.n; i++) {
      const t = this.city.tiles[i];
      // Averages only cover the developed part of the city (zones and buildings).
      if (t.terrain !== 'water' && (t.zone || (t.building && t.building.type !== 'road'))) {
        land++;
        lvSum += t.landValue;
        polSum += t.pollution;
        crimeSum += t.crime;
      }
      const b = t.building;
      if (!b) continue;
      if (b.type === 'road') {
        roads++;
        trafficSum += t.traffic;
        continue;
      }
      if (!this.isOrigin(t)) continue;
      buildings++;
      counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
      if (b.fire) onFire++;
      if (b.type === 'residential') {
        const cap = RES_CAPACITY[b.level];
        population += cap;
        const happy =
          58 +
          (t.landValue - 40) * 0.5 -
          t.pollution * 0.4 -
          t.crime * 0.3 +
          (t.powered ? 0 : -25) +
          (t.watered ? 4 : -8) +
          this.coverage.hospital[i] * 10 +
          this.coverage.school[i] * 6 +
          this.coverage.park[i] * 6 +
          this.coverage.leisure[i] * 10 -
          (b.fire ? 30 : 0);
        happySum += happy * cap;
        happyWeight += cap;
      } else if (b.type === 'commercial') com += COM_JOBS[b.level];
      else if (b.type === 'industrial') ind += IND_JOBS[b.level];
    }
    this.typeCounts = counts;
    const jobs = com + ind;
    const workforce = population * 0.55;
    const unemployment = workforce > 0 ? clamp((workforce - jobs) / workforce, 0, 1) : 0;
    const tax = this.city.budget.taxRates;
    const avgTax = (tax.residential + tax.commercial + tax.industrial) / 3;
    let happiness = happyWeight > 0 ? happySum / happyWeight : 50;
    happiness -= (avgTax - DEFAULT_TAX) * 2.5 + unemployment * 30;
    return {
      population,
      jobs,
      commercialJobs: com,
      industrialJobs: ind,
      unemployment: Math.round(unemployment * 100) / 100,
      powerSupply: s.powerSupply,
      powerDemand: s.powerDemand,
      waterSupply: s.waterSupply,
      waterDemand: s.waterDemand,
      happiness: Math.round(clamp(happiness, 0, 100)),
      avgLandValue: land ? Math.round(lvSum / land) : 0,
      avgPollution: land ? Math.round(polSum / land) : 0,
      avgCrime: land ? Math.round(crimeSum / land) : 0,
      buildingCount: buildings,
      roadCount: roads,
      avgTraffic: roads ? Math.round(trafficSum / roads) : 0,
      buildingsOnFire: onFire,
    };
  }

  private computeDemand(s: CityStats): Demand {
    const tax = this.city.budget.taxRates;
    const pop = s.population;
    let res = (s.jobs * 1.8 + 60 - pop) / Math.max(120, pop * 0.5);
    let com = (pop * 0.25 + 15 - s.commercialJobs) / Math.max(40, pop * 0.25);
    let ind = (pop * 0.4 + 30 - s.industrialJobs) / Math.max(60, pop * 0.4);
    res += (s.happiness - 50) / 200 - (tax.residential - DEFAULT_TAX) * 0.05;
    com -= (tax.commercial - DEFAULT_TAX) * 0.05;
    ind -= (tax.industrial - DEFAULT_TAX) * 0.05;
    const r2 = (v: number) => Math.round(clamp(v, -1, 1) * 100) / 100;
    return { residential: r2(res), commercial: r2(com), industrial: r2(ind) };
  }

  private checkConditions(): void {
    const s = this.city.stats;
    const f = this.internal.flags;
    const toggle = (key: string, active: boolean, on: () => void, off?: () => void) => {
      if (active && !f[key]) {
        f[key] = true;
        on();
      } else if (!active && f[key]) {
        f[key] = false;
        off?.();
      }
    };
    toggle(
      'power',
      s.powerDemand > s.powerSupply && s.powerDemand > 0,
      () => this.emit('warning', 'POWER_SHORTAGE', 'Stromknappheit! Baue ein weiteres Kraftwerk.'),
      () => this.emit('success', 'POWER_RESTORED', 'Die Stromversorgung ist wieder gesichert.'),
    );
    toggle(
      'water',
      s.waterDemand > s.waterSupply && s.waterDemand > 0 && s.waterSupply > 0,
      () => this.emit('warning', 'WATER_SHORTAGE', 'Wasserknappheit! Baue weitere Wasserpumpen.'),
    );
    toggle('crime', s.avgCrime > 25, () =>
      this.emit('warning', 'HIGH_CRIME', 'Die Kriminalität steigt. Baue Polizeiwachen.'),
    );
    toggle('pollution', s.avgPollution > 30, () =>
      this.emit('warning', 'HIGH_POLLUTION', 'Die Luftverschmutzung ist hoch. Setze auf saubere Energie und Parks.'),
    );
    if (this.city.tick % 90 === 0 && s.powerSupply === 0) {
      const hasZones = this.city.tiles.some((t) => t.zone);
      if (hasZones) {
        this.emit('info', 'HINT_POWER', 'Tipp: Zonen wachsen erst mit Strom. Baue ein Kraftwerk und verbinde es per Straße.');
      }
    }
    while (
      this.internal.milestone < MILESTONES.length &&
      s.population >= MILESTONES[this.internal.milestone]
    ) {
      const m = MILESTONES[this.internal.milestone++];
      this.emit('success', 'MILESTONE_POPULATION', `Meilenstein: ${m.toLocaleString('de-DE')} Einwohner!`);
    }
  }

  private endOfMonth(): HistoryEntry {
    const c = this.city;
    const s = c.stats;
    const b = c.budget;
    const tax = b.taxRates;
    // The city hall raises all tax income by 10 %.
    const bonus = (this.typeCounts.get('city_hall') ?? 0) > 0 ? 1.1 : 1;
    const incomeBreakdown = {
      residential: Math.round(s.population * tax.residential * 0.1 * bonus),
      commercial: Math.round(s.commercialJobs * tax.commercial * 0.15 * bonus),
      industrial: Math.round(s.industrialJobs * tax.industrial * 0.15 * bonus),
    };
    const expenseBreakdown = { roads: s.roadCount * CATALOG.road.upkeep, power: 0, water: 0, services: 0, loans: 0 };
    if (b.loanBalance > 0) {
      const pay = Math.min(b.loanPayment, b.loanBalance);
      expenseBreakdown.loans = pay;
      b.loanBalance -= pay;
      if (b.loanBalance <= 0) {
        b.loanBalance = 0;
        b.loanPayment = 0;
        this.emit('success', 'LOAN_REPAID', 'Kredit vollständig getilgt.');
      }
    }
    for (const t of c.tiles) {
      const bd = t.building;
      if (!bd || bd.type === 'road' || !this.isOrigin(t)) continue;
      if (bd.type === 'residential' || bd.type === 'commercial' || bd.type === 'industrial') continue;
      const upkeep = CATALOG[bd.type].upkeep;
      if (bd.type === 'power_coal' || bd.type === 'power_solar' || bd.type === 'power_wind') expenseBreakdown.power += upkeep;
      else if (bd.type === 'water_pump') expenseBreakdown.water += upkeep;
      else expenseBreakdown.services += upkeep;
    }
    const income = incomeBreakdown.residential + incomeBreakdown.commercial + incomeBreakdown.industrial;
    const expenses =
      expenseBreakdown.roads +
      expenseBreakdown.power +
      expenseBreakdown.water +
      expenseBreakdown.services +
      expenseBreakdown.loans;
    b.money += income - expenses;
    b.lastMonthIncome = income;
    b.lastMonthExpenses = expenses;
    b.incomeBreakdown = incomeBreakdown;
    b.expenseBreakdown = expenseBreakdown;

    if (b.money < 0) {
      this.emit('danger', 'BANKRUPTCY_WARNING', 'Die Stadtkasse ist im Minus! Erhöhe Steuern oder spare Kosten.');
    }
    if (c.date.month === 1) {
      const delta = income - expenses;
      this.emit(
        'info',
        'YEAR_REPORT',
        `Jahr ${c.date.year - 1} abgeschlossen: ${s.population.toLocaleString('de-DE')} Einwohner, Monatsbilanz ${delta >= 0 ? '+' : ''}${delta.toLocaleString('de-DE')} §.`,
      );
    }
    const entry: HistoryEntry = {
      tick: c.tick,
      date: { ...c.date },
      population: s.population,
      money: b.money,
      income,
      expenses,
      happiness: s.happiness,
      jobs: s.jobs,
    };
    c.history.push(entry);
    if (c.history.length > MAX_HISTORY) c.history.splice(0, c.history.length - MAX_HISTORY);
    return entry;
  }
}
