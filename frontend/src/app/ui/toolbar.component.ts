import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal } from '@angular/core';
import { GameService } from '../core/game.service';
import { MoneyPipe } from '../core/format';
import { CatalogCategory, CatalogEntry, Tool } from '../core/models';

interface Group {
  category: CatalogCategory;
  label: string;
  entries: CatalogEntry[];
}

const GROUP_LABELS: Record<CatalogCategory, string> = {
  tools: 'Werkzeuge',
  roads: 'Verkehr',
  zones: 'Zonen',
  utilities: 'Versorgung',
  services: 'Dienste',
  recreation: 'Freizeit',
};

@Component({
  selector: 'app-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe],
  template: `
    <div class="dock glass">
      @for (g of groups(); track g.category) {
        <div class="group">
          <div class="group-label">{{ g.label }}</div>
          <div class="buttons">
            @for (e of g.entries; track e.tool) {
              <button
                class="tool"
                [class.active]="game.tool() === e.tool"
                [class.zone-r]="e.tool === 'zone_residential'"
                [class.zone-c]="e.tool === 'zone_commercial'"
                [class.zone-i]="e.tool === 'zone_industrial'"
                [class.too-expensive]="e.cost > game.money()"
                (click)="select(e.tool)"
                (mouseenter)="hover.set(e)"
                (mouseleave)="hover.set(null)"
                [attr.aria-label]="e.name"
              >
                <span class="icon">{{ e.icon }}</span>
                @if (e.size > 1) {
                  <span class="size">{{ e.size }}×{{ e.size }}</span>
                }
                @if (e.hotkey) {
                  <span class="key">{{ e.hotkey }}</span>
                }
              </button>
            }
          </div>
        </div>
      }
    </div>
    @if (hover(); as e) {
      <div class="tip glass">
        <div class="tip-head">
          <span>{{ e.icon }} {{ e.name }}</span>
          @if (e.cost > 0) {
            <span class="cost">{{ e.cost | money }}{{ perTile(e) ? ' / Feld' : '' }}</span>
          }
        </div>
        <div class="desc">{{ e.description }}</div>
        <div class="facts">
          @if (e.upkeep) {
            <span>Unterhalt {{ e.upkeep | money }}/Monat</span>
          }
          @if (e.powerSupply) {
            <span>⚡ {{ e.powerSupply }} MW</span>
          }
          @if (e.waterSupply) {
            <span>💧 {{ e.waterSupply }} m³</span>
          }
          @if (e.radius) {
            <span>Radius {{ e.radius }}</span>
          }
          @if (e.hotkey) {
            <span>Taste {{ e.hotkey }}</span>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      max-width: calc(100vw - 24px);
    }
    .dock {
      display: flex;
      gap: 6px;
      padding: 8px 10px 10px;
      overflow-x: auto;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 0 6px;
      border-right: 1px solid var(--border);
    }
    .group:last-child {
      border-right: none;
    }
    .group-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      text-align: center;
    }
    .buttons {
      display: flex;
      gap: 4px;
    }
    .tool {
      position: relative;
      width: 46px;
      height: 46px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: rgba(255, 255, 255, 0.06);
      transition:
        transform 0.12s ease,
        background 0.12s ease;
    }
    .tool:hover {
      background: rgba(255, 255, 255, 0.14);
      transform: translateY(-3px);
    }
    .tool.active {
      background: rgba(76, 208, 125, 0.22);
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(76, 208, 125, 0.18);
    }
    .tool.zone-r {
      box-shadow: inset 0 -3px 0 #4cd07d;
    }
    .tool.zone-c {
      box-shadow: inset 0 -3px 0 #4aa8ff;
    }
    .tool.zone-i {
      box-shadow: inset 0 -3px 0 #ffc145;
    }
    .tool.too-expensive {
      opacity: 0.45;
    }
    .icon {
      font-size: 22px;
      line-height: 1;
    }
    .size,
    .key {
      position: absolute;
      font-size: 9px;
      font-weight: 700;
      color: var(--muted);
    }
    .size {
      left: 4px;
      bottom: 2px;
    }
    .key {
      right: 4px;
      top: 2px;
    }
    .tip {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 50%;
      transform: translateX(-50%);
      width: 300px;
      padding: 10px 12px;
      pointer-events: none;
    }
    .tip-head {
      display: flex;
      justify-content: space-between;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .cost {
      color: #9ff5c4;
    }
    .desc {
      font-size: 12px;
      color: var(--muted);
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .facts span {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
    }
  `,
})
export class ToolbarComponent {
  readonly game = inject(GameService);
  readonly hover = signal<CatalogEntry | null>(null);

  readonly groups = computed<Group[]>(() => {
    const order: CatalogCategory[] = ['tools', 'roads', 'zones', 'utilities', 'services', 'recreation'];
    return order.map((category) => ({
      category,
      label: GROUP_LABELS[category],
      entries: this.game.catalog().filter((e) => e.category === category),
    }));
  });

  perTile(e: CatalogEntry): boolean {
    return e.category === 'roads' || e.category === 'zones' || e.tool === 'bulldoze';
  }

  select(tool: Tool): void {
    this.game.tool.set(this.game.tool() === tool && tool !== 'inspect' ? 'inspect' : tool);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.game.togglePause();
      return;
    }
    if (e.key === 'Escape') {
      this.game.tool.set('inspect');
      this.game.selected.set(null);
      return;
    }
    const key = e.key.toUpperCase();
    const entry = this.game.catalog().find((c) => c.hotkey === key);
    if (entry) this.game.tool.set(entry.tool);
  }
}
