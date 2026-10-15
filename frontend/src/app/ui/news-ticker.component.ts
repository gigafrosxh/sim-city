import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { GameService } from '../core/game.service';
import { formatNumber } from '../core/format';

/** Rotating "local newspaper" headlines generated from the city's state. */
@Component({
  selector: 'app-news-ticker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (headline(); as h) {
      <div class="ticker glass">
        <span class="tag">📰 {{ paper() }}</span>
        @for (text of [h]; track index()) {
          <span class="text">{{ text }}</span>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      bottom: 92px;
      left: calc(50% + 124px);
      transform: translateX(-50%);
      z-index: 8;
      pointer-events: none;
      max-width: min(640px, calc(100vw - 520px));
    }
    .ticker {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 12px;
      font-size: 12px;
      border-radius: 999px;
      overflow: hidden;
      white-space: nowrap;
    }
    .tag {
      font-weight: 700;
      color: #ffc145;
    }
    .text {
      overflow: hidden;
      text-overflow: ellipsis;
      animation: fade 0.5s ease-out;
    }
    @keyframes fade {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    @media (max-width: 1100px) {
      :host {
        display: none;
      }
    }
  `,
})
export class NewsTickerComponent {
  private readonly game = inject(GameService);
  readonly index = signal(0);
  readonly paper = computed(() => `${this.game.cityName()}er Bote`);

  private readonly headlines = computed(() => {
    const s = this.game.stats();
    const d = this.game.demand();
    const b = this.game.budget();
    if (!s || !b) return [];
    const out: string[] = [];
    const recent = this.game.events()[0];
    if (recent) out.push(recent.message);
    if (s.population === 0) out.push('Bürgermeister plant neue Stadt – Investoren warten auf erste Straßen.');
    else out.push(`${formatNumber(s.population)} Menschen nennen die Stadt inzwischen ihr Zuhause.`);
    if (d.residential > 0.4) out.push('Wohnungsnot! Familien suchen dringend neue Häuser.');
    if (d.commercial > 0.4) out.push('Einzelhändler fordern mehr Gewerbeflächen.');
    if (d.industrial > 0.4) out.push('Unternehmen wollen Fabriken bauen – fehlt es an Industriegebieten?');
    if (d.residential < -0.3) out.push('Leerstand: Immer mehr Wohnungen bleiben unvermietet.');
    if (s.unemployment > 0.15) out.push(`Arbeitslosigkeit bei ${Math.round(s.unemployment * 100)} % – Bürger fordern Jobs.`);
    if (s.powerDemand > s.powerSupply) out.push('Stromausfälle sorgen für Ärger in der Bevölkerung.');
    if (s.avgTraffic > 50) out.push('Pendler stehen im Stau – Verkehrsplaner gefragt.');
    if (s.avgPollution > 25) out.push('Smogwarnung: Ärzte raten zu Aufenthalten im Park.');
    if (s.avgCrime > 20) out.push('Einbruchsserie verunsichert Anwohner.');
    if (s.buildingsOnFire > 0) out.push('Großeinsatz: Feuerwehr kämpft gegen Flammen.');
    if (b.money < 0) out.push('Haushaltskrise im Rathaus – Opposition fordert Sparkurs.');
    else if (b.lastMonthIncome > b.lastMonthExpenses) out.push('Stadtkasse im Plus: Kämmerer zeigt sich zufrieden.');
    if (s.happiness >= 70) out.push('Umfrage: Bürger lieben ihre Stadt!');
    else if (s.happiness < 40) out.push('Umfrage: Die Stimmung in der Stadt ist auf dem Tiefpunkt.');
    if (b.loanBalance > 0) out.push('Kreditrate belastet den Haushalt.');
    return out;
  });

  readonly headline = computed(() => {
    const list = this.headlines();
    return list.length ? list[this.index() % list.length] : null;
  });

  constructor() {
    const timer = setInterval(() => this.index.update((i) => i + 1), 8000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
