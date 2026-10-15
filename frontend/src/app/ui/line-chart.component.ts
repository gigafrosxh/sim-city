import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatCompact } from '../core/format';

export interface ChartSeries {
  label: string;
  color: string;
  values: number[];
}

const W = 300;
const H = 110;
const PAD_L = 54;
const PAD_B = 4;

@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="title">{{ title() }}</span>
      <span class="legend">
        @for (s of series(); track s.label) {
          <span><i [style.background]="s.color"></i>{{ s.label }}</span>
        }
      </span>
    </div>
    @if (paths().length) {
      <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none">
        @for (g of grid(); track g.y) {
          <line [attr.x1]="padL" [attr.x2]="w" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" />
          <text [attr.x]="padL - 4" [attr.y]="g.y + 3" class="axis">{{ g.label }}</text>
        }
        @if (zeroY() !== null) {
          <line [attr.x1]="padL" [attr.x2]="w" [attr.y1]="zeroY()" [attr.y2]="zeroY()" class="zero" />
        }
        @for (p of paths(); track p.color) {
          <path [attr.d]="p.area" [attr.fill]="p.color" opacity="0.12" />
          <path [attr.d]="p.line" [attr.stroke]="p.color" fill="none" stroke-width="2" vector-effect="non-scaling-stroke" />
        }
      </svg>
    } @else {
      <div class="empty">Noch keine Daten – die Statistik wird monatlich erfasst.</div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 4px;
      gap: 8px;
    }
    .title {
      font-size: 12px;
      font-weight: 600;
    }
    .legend {
      display: flex;
      gap: 8px;
      font-size: 10px;
      color: var(--muted);
    }
    .legend i {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      margin-right: 4px;
    }
    svg {
      width: 100%;
      height: 110px;
      display: block;
    }
    .grid {
      stroke: rgba(255, 255, 255, 0.07);
    }
    .zero {
      stroke: rgba(255, 120, 120, 0.4);
      stroke-dasharray: 3 3;
    }
    .axis {
      fill: var(--muted);
      font-size: 9px;
      text-anchor: end;
    }
    .empty {
      font-size: 11px;
      color: var(--muted);
      padding: 18px 0;
      text-align: center;
    }
  `,
})
export class LineChartComponent {
  readonly title = input('');
  readonly series = input<ChartSeries[]>([]);
  readonly w = W;
  readonly h = H;
  readonly padL = PAD_L;

  private readonly range = computed(() => {
    const all = this.series().flatMap((s) => s.values);
    if (!all.length) return { min: 0, max: 1 };
    let min = Math.min(0, ...all);
    let max = Math.max(...all);
    if (max === min) max = min + 1;
    const pad = (max - min) * 0.08;
    max += pad;
    if (min < 0) min -= pad;
    return { min, max };
  });

  private y(v: number): number {
    const { min, max } = this.range();
    return H - PAD_B - ((v - min) / (max - min)) * (H - PAD_B - 6);
  }

  readonly grid = computed(() => {
    const { min, max } = this.range();
    return [0, 0.5, 1].map((f) => {
      const v = min + (max - min) * f;
      return { y: this.y(v), label: formatCompact(v) };
    });
  });

  readonly zeroY = computed(() => (this.range().min < 0 ? this.y(0) : null));

  readonly paths = computed(() => {
    const series = this.series().filter((s) => s.values.length > 1);
    return series.map((s) => {
      const n = s.values.length;
      const pts = s.values.map((v, i) => `${PAD_L + (i / (n - 1)) * (W - PAD_L)},${this.y(v).toFixed(1)}`);
      const line = `M${pts.join(' L')}`;
      const base = this.y(Math.max(0, this.range().min));
      const area = `${line} L${W},${base} L${PAD_L},${base} Z`;
      return { color: s.color, line, area };
    });
  });
}
