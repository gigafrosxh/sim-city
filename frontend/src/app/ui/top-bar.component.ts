import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal } from '@angular/core';
import { GameService } from '../core/game.service';
import { GameDatePipe, MoneyPipe, NumPipe } from '../core/format';
import { GameSpeed } from '../core/models';

@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, NumPipe, GameDatePipe],
  template: `
    <div class="brand">
      <span class="logo">🏙️</span>
      <div>
        <div class="title">{{ game.cityName() }}</div>
        <div class="sub">City-Sim · {{ game.api.label }}</div>
      </div>
    </div>

    <div class="center glass">
      <div class="date">
        <span class="label">Datum</span>
        <span class="value">{{ game.date() | gameDate }}</span>
      </div>
      <div class="speeds" role="group" aria-label="Spielgeschwindigkeit">
        @for (s of speeds; track s.value) {
          <button
            class="speed"
            [class.active]="game.speed() === s.value"
            (click)="game.setSpeed(s.value)"
            [title]="s.title"
          >
            {{ s.icon }}
          </button>
        }
      </div>
    </div>

    <div class="stats">
      <div class="stat glass" [class.neg]="game.money() < 0" title="Stadtkasse">
        <span class="label">Kasse</span>
        <span class="value money">
          {{ game.money() | money }}
          @if (delta(); as d) {
            <span class="delta" [class.up]="d > 0">{{ d > 0 ? '+' : '' }}{{ d | num }}</span>
          }
        </span>
      </div>
      <div class="stat glass" title="Einwohner">
        <span class="label">Einwohner</span>
        <span class="value">👥 {{ game.stats()?.population ?? 0 | num }}</span>
      </div>
      <div class="stat glass" title="Zufriedenheit">
        <span class="label">Stimmung</span>
        <span class="value">{{ mood() }} {{ game.stats()?.happiness ?? 50 }}%</span>
      </div>
      <button class="icon-btn glass" (click)="cycleLighting()" [title]="lightingTitle()">
        {{ lightingIcon() }}
      </button>
      <button class="icon-btn glass" (click)="menu.emit()" title="Städte & Einstellungen">☰</button>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      top: 12px;
      left: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      pointer-events: none;
      z-index: 10;
    }
    :host > * {
      pointer-events: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px 6px 8px;
      border-radius: 14px;
      background: var(--panel);
      border: 1px solid var(--border);
      backdrop-filter: blur(12px);
      min-width: 0;
    }
    .logo {
      font-size: 26px;
    }
    .title {
      font-weight: 700;
      font-size: 15px;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sub {
      font-size: 11px;
      color: var(--muted);
    }
    .center {
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 6px 8px 6px 16px;
    }
    .date {
      display: flex;
      flex-direction: column;
      min-width: 130px;
    }
    .label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .value {
      font-weight: 600;
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    .speeds {
      display: flex;
      gap: 4px;
    }
    .speed {
      width: 36px;
      height: 32px;
      border-radius: 9px;
      border: 1px solid transparent;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      font-size: 13px;
    }
    .speed:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    .speed.active {
      background: var(--accent);
      color: #06221a;
      font-weight: 700;
    }
    .stats {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stat {
      display: flex;
      flex-direction: column;
      padding: 6px 12px;
      min-width: 92px;
    }
    .stat.neg .money {
      color: var(--danger);
    }
    .money {
      position: relative;
      color: #9ff5c4;
    }
    .delta {
      position: absolute;
      right: -6px;
      top: -16px;
      font-size: 11px;
      color: var(--danger);
      animation: rise 1.6s ease-out forwards;
    }
    .delta.up {
      color: var(--accent);
    }
    @keyframes rise {
      from {
        opacity: 1;
        transform: translateY(6px);
      }
      to {
        opacity: 0;
        transform: translateY(-8px);
      }
    }
    .icon-btn {
      width: 42px;
      height: 42px;
      font-size: 18px;
      color: var(--text);
    }
    @media (max-width: 900px) {
      :host {
        flex-wrap: wrap;
      }
      .brand {
        display: none;
      }
      .center {
        margin: 0;
      }
      .stat:nth-child(3) {
        display: none;
      }
    }
  `,
})
export class TopBarComponent {
  readonly game = inject(GameService);
  readonly menu = output<void>();

  readonly speeds: { value: GameSpeed; icon: string; title: string }[] = [
    { value: 0, icon: '⏸', title: 'Pause (Leertaste)' },
    { value: 1, icon: '▶', title: 'Normal' },
    { value: 2, icon: '▶▶', title: 'Schnell' },
    { value: 3, icon: '⏩', title: 'Sehr schnell' },
  ];

  readonly mood = computed(() => {
    const h = this.game.stats()?.happiness ?? 50;
    return h >= 70 ? '😄' : h >= 50 ? '🙂' : h >= 30 ? '😐' : '😠';
  });

  readonly lightingIcon = computed(() => ({ auto: '🌗', day: '☀️', night: '🌙' })[this.game.lighting()]);
  readonly lightingTitle = computed(
    () => ({ auto: 'Licht: Tag/Nacht-Zyklus', day: 'Licht: immer Tag', night: 'Licht: immer Nacht' })[this.game.lighting()],
  );

  cycleLighting(): void {
    const next = { auto: 'day', day: 'night', night: 'auto' } as const;
    this.game.lighting.set(next[this.game.lighting()]);
  }

  /** Shows the monthly balance briefly when the money changes at month end. */
  readonly delta = signal<number | null>(null);
  private lastEntryTick: number | null = null;

  constructor() {
    effect(() => {
      const h = this.game.history();
      const e = h[h.length - 1];
      const tick = e?.tick ?? -1;
      if (this.lastEntryTick !== null && e && tick > this.lastEntryTick) {
        this.delta.set(e.income - e.expenses);
        setTimeout(() => this.delta.set(null), 1600);
      }
      this.lastEntryTick = tick;
    });
  }
}
