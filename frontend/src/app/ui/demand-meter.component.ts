import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameService } from '../core/game.service';

@Component({
  selector: 'app-demand-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="title">Nachfrage</div>
    <div class="bars">
      @for (b of bars(); track b.key) {
        <div class="bar" [title]="b.title">
          <div class="track">
            <div class="mid"></div>
            @if (b.value >= 0) {
              <div class="fill up" [style.height.%]="b.value * 50" [style.background]="b.color"></div>
            } @else {
              <div class="fill down" [style.height.%]="-b.value * 50"></div>
            }
          </div>
          <div class="key" [style.color]="b.color">{{ b.key }}</div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .bars {
      display: flex;
      gap: 14px;
      justify-content: center;
    }
    .bar {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .track {
      position: relative;
      width: 18px;
      height: 84px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.06);
      overflow: hidden;
    }
    .mid {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      background: rgba(255, 255, 255, 0.25);
    }
    .fill {
      position: absolute;
      left: 2px;
      right: 2px;
      border-radius: 4px;
      transition: height 0.6s ease;
    }
    .fill.up {
      bottom: 50%;
    }
    .fill.down {
      top: 50%;
      background: var(--danger);
    }
    .key {
      font-weight: 800;
      font-size: 13px;
    }
  `,
})
export class DemandMeterComponent {
  private readonly game = inject(GameService);
  readonly bars = computed(() => {
    const d = this.game.demand();
    const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
    return [
      { key: 'W', color: '#4cd07d', value: d.residential, title: `Wohnen ${pct(d.residential)}` },
      { key: 'G', color: '#4aa8ff', value: d.commercial, title: `Gewerbe ${pct(d.commercial)}` },
      { key: 'I', color: '#ffc145', value: d.industrial, title: `Industrie ${pct(d.industrial)}` },
    ];
  });
}
