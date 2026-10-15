/**
 * Shared data model for City-Sim.
 *
 * These types mirror docs/api-contract.md exactly. The backend serialises the
 * same shapes as JSON, so any change here must be reflected in the contract.
 */

export type Terrain = 'grass' | 'forest' | 'water' | 'sand';

export type ZoneType = 'residential' | 'commercial' | 'industrial';

export type ServiceBuildingType =
  | 'power_coal'
  | 'power_solar'
  | 'power_wind'
  | 'water_pump'
  | 'police'
  | 'fire'
  | 'school'
  | 'hospital'
  | 'park'
  | 'stadium'
  | 'city_hall';

export type BuildingType = 'road' | ZoneType | ServiceBuildingType;

export type Tool =
  | 'inspect'
  | 'road'
  | 'zone_residential'
  | 'zone_commercial'
  | 'zone_industrial'
  | 'dezone'
  | 'bulldoze'
  | ServiceBuildingType;

export type Overlay = 'none' | 'power' | 'water' | 'landValue' | 'pollution' | 'crime' | 'traffic';

export type GameSpeed = 0 | 1 | 2 | 3;

export interface Coord {
  x: number;
  y: number;
}

export interface Building {
  type: BuildingType;
  /** 1..3 for zone buildings, always 1 for roads and service buildings. */
  level: number;
  /** Top corner (smallest x and y) of the footprint. */
  originX: number;
  originY: number;
  /** Edge length of the square footprint in tiles. */
  size: number;
  /** Tick at which the building was (re)built or last levelled up. */
  builtAt: number;
  /** 0..3, purely cosmetic so neighbouring buildings look different. */
  variant: number;
  /** Remaining ticks of an active fire; 0 or absent = not burning. */
  fire?: number;
}

export interface Tile {
  x: number;
  y: number;
  terrain: Terrain;
  zone: ZoneType | null;
  building: Building | null;
  powered: boolean;
  watered: boolean;
  /** 0..100 */
  landValue: number;
  /** 0..100 */
  pollution: number;
  /** 0..100 */
  crime: number;
  /** 0..100, only meaningful on road tiles. */
  traffic: number;
}

export interface GameDate {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..30 (simulation uses 30-day months) */
  day: number;
}

export interface TaxRates {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface Budget {
  money: number;
  taxRates: TaxRates;
  lastMonthIncome: number;
  lastMonthExpenses: number;
  incomeBreakdown: { residential: number; commercial: number; industrial: number };
  expenseBreakdown: { roads: number; power: number; water: number; services: number; loans: number };
  /** Outstanding loan balance including interest. */
  loanBalance: number;
  /** Monthly repayment while a loan is outstanding. */
  loanPayment: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  reward: number;
  progress: number;
  target: number;
  completed: boolean;
}

/** Each value is in the range -1..1 */
export interface Demand {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface CityStats {
  population: number;
  jobs: number;
  commercialJobs: number;
  industrialJobs: number;
  unemployment: number;
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;
  /** 0..100 */
  happiness: number;
  avgLandValue: number;
  avgPollution: number;
  avgCrime: number;
  buildingCount: number;
  roadCount: number;
  avgTraffic: number;
  buildingsOnFire: number;
}

export interface HistoryEntry {
  tick: number;
  date: GameDate;
  population: number;
  money: number;
  income: number;
  expenses: number;
  happiness: number;
  jobs: number;
}

export interface CitySummary {
  id: string;
  name: string;
  width: number;
  height: number;
  population: number;
  money: number;
  date: GameDate;
  updatedAt: string;
}

export interface CityState {
  id: string;
  name: string;
  width: number;
  height: number;
  seed: number;
  tick: number;
  date: GameDate;
  speed: GameSpeed;
  /** Row-major: index = y * width + x */
  tiles: Tile[];
  budget: Budget;
  demand: Demand;
  stats: CityStats;
  history: HistoryEntry[];
  goals: Goal[];
}

export interface CreateCityRequest {
  name: string;
  width: number;
  height: number;
  seed?: number;
}

export interface BuildRequest {
  tool: Exclude<Tool, 'inspect'>;
  tiles: Coord[];
}

export interface BuildResult {
  ok: boolean;
  cost: number;
  placed: number;
  error?: string;
  changedTiles: Tile[];
  budget: Budget;
}

export type EventSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface GameEvent {
  id: string;
  tick: number;
  date: GameDate;
  severity: EventSeverity;
  code: string;
  message: string;
  x?: number;
  y?: number;
}

export interface TickUpdate {
  tick: number;
  date: GameDate;
  changedTiles: Tile[];
  budget: Budget;
  demand: Demand;
  stats: CityStats;
  history?: HistoryEntry;
  /** Present when any goal changed during this tick. */
  goals?: Goal[];
}

export type ServerMessage =
  | { type: 'snapshot'; city: CityState }
  | { type: 'tick'; update: TickUpdate }
  | { type: 'event'; event: GameEvent }
  | { type: 'speed'; speed: GameSpeed }
  | { type: 'error'; message: string };

export type CatalogCategory = 'tools' | 'roads' | 'zones' | 'utilities' | 'services' | 'recreation';

export interface CatalogEntry {
  tool: Tool;
  name: string;
  description: string;
  icon: string;
  category: CatalogCategory;
  /** Cost per tile for roads/zones/bulldoze, per building otherwise. */
  cost: number;
  /** Monthly upkeep per building (or per road tile). */
  upkeep: number;
  size: number;
  powerSupply?: number;
  waterSupply?: number;
  powerUse?: number;
  waterUse?: number;
  /** Service coverage radius in tiles. */
  radius?: number;
  hotkey?: string;
  /** Population needed before this tool can be used. */
  unlockPopulation?: number;
  /** Only one building of this type per city. */
  unique?: boolean;
}

export interface LoanRequest {
  amount: number;
}
