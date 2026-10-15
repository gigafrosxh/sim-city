import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CATALOG, COM_JOBS, IND_JOBS, RES_CAPACITY } from '../core/catalog';
import { GameService } from '../core/game.service';
import { Terrain, ZoneType } from '../core/models';

const TERRAIN: Record<Terrain, string> = { grass: 'Wiese', forest: 'Wald', water: 'Wasser', sand: 'Sand' };
const ZONE: Record<ZoneType, string> = { residential: 'Wohnzone', commercial: 'Gewerbezone', industrial: 'Industriezone' };
const LEVEL_NAMES: Record<ZoneType, string[]> = {
  residential: ['', 'Einfamilienhaus', 'Mehrfamilienhaus', 'Wohnhochhaus'],
  commercial: ['', 'Laden', 'Bürogebäude', 'Wolkenkratzer'],
  industrial: ['', 'Lagerhalle', 'Fabrik', 'Industriekomplex'],
};

@Component({
  selector: 'app-tile-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as i) {
      <div class="card glass">
        <div class="head">
          <span class="icon">{{ i.icon }}</span>
          <div class="names">
            <b>{{ i.title }}</b>
            <small>{{ i.subtitle }} · Feld {{ i.x }}, {{ i.y }}</small>
          </div>
          <button class="close" (click)="game.selected.set(null)" title="Schließen">✕</button>
        </div>
        @if (i.detail) {
          <div class="detail">{{ i.detail }}</div>
        }
        @if (i.burning) {
          <div class="burning">🔥 Dieses Gebäude brennt!</div>
        }
        @if (i.isRoad) {
          <div class="detail">Verkehrsaufkommen: {{ i.traffic }} %</div>
        }
        <div class="flags">
          @if (i.utility) {
            <span [class.ok]="i.powered" [class.no]="!i.powered">⚡ {{ i.powered ? 'Strom' : 'Kein Strom' }}</span>
            <span [class.ok]="i.watered" [class.no]="!i.watered">💧 {{ i.watered ? 'Wasser' : 'Kein Wasser' }}</span>
          }
        </div>
        <div class="bars">
          <div><span>Bodenwert</span><div class="track"><div class="fill lv" [style.width.%]="i.landValue"></div></div><b>{{ i.landValue }}</b></div>
          <div><span>Verschmutzung</span><div class="track"><div class="fill pol" [style.width.%]="i.pollution"></div></div><b>{{ i.pollution }}</b></div>
          <div><span>Kriminalität</span><div class="track"><div class="fill crime" [style.width.%]="i.crime"></div></div><b>{{ i.crime }}</b></div>
        </div>
        @if (i.removable) {
          <button class="action" (click)="game.tool.set('bulldoze')">🚜 Abriss-Werkzeug wählen</button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 12px;
      bottom: 196px;
      z-index: 9;
    }
    .card {
      width: 248px;
      padding: 10px 12px 12px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .icon {
      font-size: 26px;
    }
    .names {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .names small {
      font-size: 11px;
      color: var(--muted);
    }
    .close {
      border: none;
      background: transparent;
      color: var(--muted);
      font-size: 14px;
    }
    .detail {
      margin-top: 8px;
      font-size: 12px;
    }
    .burning {
      margin-top: 6px;
      color: #ffb07a;
      font-weight: 600;
      font-size: 12px;
    }
    .flags {
      display: flex;
      gap: 6px;
      margin: 8px 0;
    }
    .flags span {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.07);
    }
    .flags .ok {
      color: #9ff5c4;
    }
    .flags .no {
      color: #ffb4b4;
      background: rgba(255, 80, 80, 0.12);
    }
    .bars {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .bars > div {
      display: grid;
      grid-template-columns: 86px 1fr 26px;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }
    .bars span {
      color: var(--muted);
    }
    .bars b {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .track {
      height: 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.08);
      overflow: hidden;
    }
    .fill {
      height: 100%;
    }
    .lv {
      background: #4cd07d;
    }
    .pol {
      background: #a68a5b;
    }
    .crime {
      background: #e53935;
    }
    .action {
      margin-top: 10px;
      width: 100%;
      padding: 6px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      font-size: 12px;
    }
  `,
})
export class TileInspectorComponent {
  readonly game = inject(GameService);

  readonly info = computed(() => {
    const t = this.game.selectedTile();
    if (!t) return null;
    const b = t.building;
    let icon = t.terrain === 'water' ? '🌊' : t.terrain === 'forest' ? '🌲' : t.terrain === 'sand' ? '🏖️' : '🌿';
    let title = TERRAIN[t.terrain];
    let subtitle = t.zone ? ZONE[t.zone] : 'Unbebaut';
    let detail = '';
    if (b) {
      if (b.type === 'residential' || b.type === 'commercial' || b.type === 'industrial') {
        icon = b.type === 'residential' ? '🏠' : b.type === 'commercial' ? '🏬' : '🏭';
        title = LEVEL_NAMES[b.type][b.level];
        subtitle = `${ZONE[b.type]} · Stufe ${b.level}`;
        detail =
          b.type === 'residential'
            ? `${RES_CAPACITY[b.level]} Einwohner`
            : `${(b.type === 'commercial' ? COM_JOBS : IND_JOBS)[b.level]} Arbeitsplätze`;
      } else {
        const e = CATALOG[b.type];
        icon = e.icon;
        title = e.name;
        subtitle = b.type === 'road' ? 'Verkehr' : `${b.size}×${b.size} Gebäude`;
        detail = e.description;
        if (e.upkeep) detail += ` Unterhalt: § ${e.upkeep}/Monat.`;
      }
    } else if (t.zone) {
      detail = 'Wartet auf Bebauung. Braucht Straßenanschluss (max. 3 Felder) und Strom.';
    }
    return {
      ...t,
      icon,
      title,
      subtitle,
      detail,
      utility: !!b || !!t.zone,
      removable: !!b || t.terrain === 'forest',
      burning: !!b?.fire,
      isRoad: b?.type === 'road',
    };
  });
}
