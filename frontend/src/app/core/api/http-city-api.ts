import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, retry, timer } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
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
import { APP_CONFIG } from '../config';
import { CityApi } from './city-api';

/** Talks to the City-Sim backend as specified in docs/api-contract.md. */
@Injectable()
export class HttpCityApi extends CityApi {
  readonly label = 'Server';
  private readonly http = inject(HttpClient);
  private readonly config = inject(APP_CONFIG);

  private url(path: string): string {
    return `${this.config.apiBaseUrl.replace(/\/$/, '')}${path}`;
  }

  getCatalog(): Promise<CatalogEntry[]> {
    return firstValueFrom(this.http.get<CatalogEntry[]>(this.url('/catalog')));
  }

  listCities(): Promise<CitySummary[]> {
    return firstValueFrom(this.http.get<CitySummary[]>(this.url('/cities')));
  }

  createCity(req: CreateCityRequest): Promise<CityState> {
    return firstValueFrom(this.http.post<CityState>(this.url('/cities'), req));
  }

  getCity(id: string): Promise<CityState> {
    return firstValueFrom(this.http.get<CityState>(this.url(`/cities/${encodeURIComponent(id)}`)));
  }

  async deleteCity(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(this.url(`/cities/${encodeURIComponent(id)}`)));
  }

  build(cityId: string, req: BuildRequest): Promise<BuildResult> {
    return firstValueFrom(
      this.http.post<BuildResult>(this.url(`/cities/${encodeURIComponent(cityId)}/build`), req),
    );
  }

  setTaxes(cityId: string, taxRates: TaxRates): Promise<Budget> {
    return firstValueFrom(
      this.http.put<Budget>(this.url(`/cities/${encodeURIComponent(cityId)}/taxes`), taxRates),
    );
  }

  async setSpeed(cityId: string, speed: GameSpeed): Promise<void> {
    await firstValueFrom(
      this.http.put(this.url(`/cities/${encodeURIComponent(cityId)}/speed`), { speed }),
    );
  }

  takeLoan(cityId: string, amount: number): Promise<Budget> {
    return firstValueFrom(
      this.http.post<Budget>(this.url(`/cities/${encodeURIComponent(cityId)}/loans`), { amount }),
    );
  }

  repayLoan(cityId: string): Promise<Budget> {
    return firstValueFrom(
      this.http.post<Budget>(this.url(`/cities/${encodeURIComponent(cityId)}/loans/repay`), {}),
    );
  }

  importCity(city: CityState): Promise<CityState> {
    return firstValueFrom(this.http.post<CityState>(this.url('/cities/import'), city));
  }

  connect(cityId: string): Observable<ServerMessage> {
    return webSocket<ServerMessage>({
      url: this.wsUrl(`/cities/${encodeURIComponent(cityId)}`),
    }).pipe(
      // The server re-sends a snapshot on every (re)connect, so state stays consistent.
      retry({ delay: (_err, attempt) => timer(Math.min(10000, 500 * 2 ** attempt)) }),
    );
  }

  private wsUrl(path: string): string {
    const base = this.config.wsBaseUrl.replace(/\/$/, '');
    if (/^wss?:\/\//.test(base)) return base + path;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${base}${path}`;
  }
}
