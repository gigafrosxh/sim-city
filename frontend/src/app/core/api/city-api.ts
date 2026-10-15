import { Observable } from 'rxjs';
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
} from '../models';

/**
 * Transport-agnostic access to a City-Sim backend.
 *
 * Two implementations exist:
 *  - {@link HttpCityApi}: talks to the real backend (REST + WebSocket) as
 *    specified in docs/api-contract.md.
 *  - {@link MockCityApi}: runs the simulation in the browser so the game is
 *    fully playable without a server.
 */
export abstract class CityApi {
  /** Human readable name of the transport, shown in the UI. */
  abstract readonly label: string;

  abstract getCatalog(): Promise<CatalogEntry[]>;
  abstract listCities(): Promise<CitySummary[]>;
  abstract createCity(req: CreateCityRequest): Promise<CityState>;
  abstract getCity(id: string): Promise<CityState>;
  abstract deleteCity(id: string): Promise<void>;
  abstract build(cityId: string, req: BuildRequest): Promise<BuildResult>;
  abstract setTaxes(cityId: string, taxRates: TaxRates): Promise<Budget>;
  abstract setSpeed(cityId: string, speed: GameSpeed): Promise<void>;

  /**
   * Live stream for a city. Emits a `snapshot` first, then `tick`, `event`
   * and `speed` messages. Unsubscribing closes the connection.
   */
  abstract connect(cityId: string): Observable<ServerMessage>;
}
