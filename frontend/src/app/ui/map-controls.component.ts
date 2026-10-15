import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameService } from '../core/game.service';
import { Overlay } from '../core/models';
import { MinimapComponent } from '../map/minimap.component';

@Component({
  selector: 'app-map-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MinimapComponent],
  template: `
    <div class="card glass">
      <app-minimap />
      <div class="overlays" role="group" aria-label="Kartenebenen">
        @for (o of overlays; track o.id) {
          <button [class.active]="game.overlay() === o.id" (click)="toggle(o.id)" [title]="o.label">
            {{ o.icon }}
          </button>
        }
      </div>
      @if (legend(); as l) {
        <div class="legend">{{ l }}</div>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      left: 12px;
      bottom: 14px;
      z-index: 9;
    }
    .card {
      padding: 8px;
      width: 236px;
    }
    .overlays {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .overlays button {
      flex: 1;
      height: 30px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: rgba(255, 255, 255, 0.06);
      font-size: 15px;
    }
    .overlays button:hover {
      background: rgba(255, 255, 255, 0.14);
    }
    .overlays button.active {
      border-color: var(--accent);
      background: rgba(76, 208, 125, 0.2);
    }
    .legend {
      margin-top: 6px;
      font-size: 11px;
      color: var(--muted);
    }
    @media (max-width: 900px) {
      :host {
        bottom: 110px;
      }
    }
  `,
})
export class MapControlsComponent {
  readonly game = inject(GameService);
  readonly overlays: { id: Overlay; icon: string; label: string; legend: string }[] = [
    { id: 'power', icon: '⚡', label: 'Stromnetz', legend: 'Gelb = versorgt, Rot = kein Strom' },
    { id: 'water', icon: '💧', label: 'Wassernetz', legend: 'Blau = versorgt, Rot = kein Wasser' },
    { id: 'landValue', icon: '💎', label: 'Bodenwert', legend: 'Rot = niedrig, Grün = hoch' },
    { id: 'pollution', icon: '🏭', label: 'Verschmutzung', legend: 'Je dunkler, desto schmutziger' },
    { id: 'crime', icon: '🚨', label: 'Kriminalität', legend: 'Je röter, desto unsicherer' },
  ];

  legend(): string | null {
    const o = this.overlays.find((x) => x.id === this.game.overlay());
    return o ? `${o.label}: ${o.legend}` : null;
  }

  toggle(id: Overlay): void {
    this.game.overlay.set(this.game.overlay() === id ? 'none' : id);
  }
}
