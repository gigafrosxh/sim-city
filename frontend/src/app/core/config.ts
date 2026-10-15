import { InjectionToken } from '@angular/core';

export type ApiMode = 'mock' | 'http';

export interface AppConfig {
  apiMode: ApiMode;
  /** Base URL for REST calls, e.g. "/api" or "http://localhost:8080/api". */
  apiBaseUrl: string;
  /** Base URL for WebSockets, e.g. "/ws" or "ws://localhost:8080/ws". */
  wsBaseUrl: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

const STORAGE_KEY = 'citysim.config';

/**
 * Resolves the runtime configuration. Priority (highest first):
 *  1. URL query parameters: ?api=http&apiUrl=...&wsUrl=...
 *  2. localStorage (written when the user switches mode in the UI)
 *  3. window.__CITY_SIM_CONFIG__ (can be injected by the server into index.html)
 *  4. defaults: mock mode, "/api" and "/ws" (proxied to localhost:8080 in dev)
 */
export function resolveConfig(): AppConfig {
  const defaults: AppConfig = { apiMode: 'mock', apiBaseUrl: '/api', wsBaseUrl: '/ws' };
  let cfg: AppConfig = { ...defaults };
  const injected = (globalThis as { __CITY_SIM_CONFIG__?: Partial<AppConfig> }).__CITY_SIM_CONFIG__;
  if (injected) cfg = { ...cfg, ...injected };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) cfg = { ...cfg, ...(JSON.parse(stored) as Partial<AppConfig>) };
  } catch {
    // Storage may be unavailable (private mode); defaults are fine.
  }
  try {
    const params = new URLSearchParams(location.search);
    const api = params.get('api');
    if (api === 'mock' || api === 'http') cfg.apiMode = api;
    const apiUrl = params.get('apiUrl');
    if (apiUrl) cfg.apiBaseUrl = apiUrl;
    const wsUrl = params.get('wsUrl');
    if (wsUrl) cfg.wsBaseUrl = wsUrl;
  } catch {
    // Non-browser environment.
  }
  return cfg;
}

export function persistConfig(cfg: Partial<AppConfig>): void {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AppConfig>;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...cfg }));
  } catch {
    // ignore
  }
}
