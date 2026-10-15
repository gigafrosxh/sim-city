import { Injectable, signal } from '@angular/core';
import { Pt } from './iso';

/** Shares the visible map area (in tile coordinates) between the map and the minimap. */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  /** Screen corners (top-left, top-right, bottom-right, bottom-left) in tile coordinates. */
  readonly corners = signal<Pt[]>([]);
}
