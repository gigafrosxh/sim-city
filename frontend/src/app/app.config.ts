import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { CityApi } from './core/api/city-api';
import { HttpCityApi } from './core/api/http-city-api';
import { MockCityApi } from './core/api/mock-city-api';
import { APP_CONFIG, resolveConfig } from './core/config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch()),
    { provide: APP_CONFIG, useFactory: resolveConfig },
    HttpCityApi,
    MockCityApi,
    {
      provide: CityApi,
      useFactory: () =>
        inject(APP_CONFIG).apiMode === 'http' ? inject(HttpCityApi) : inject(MockCityApi),
    },
  ],
};
