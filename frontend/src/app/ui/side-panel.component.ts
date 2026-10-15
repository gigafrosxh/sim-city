import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameService } from '../core/game.service';
import { GameDatePipe, MoneyPipe, MONTHS, NumPipe } from '../core/format';
import { TaxRates } from '../core/models';
import { DemandMeterComponent } from './demand-meter.component';
import { ChartSeries, LineChartComponent } from './line-chart.component';

type Tab = 'overview' | 'finance' | 'utilities' | 'stats' | 'events';

@Component({
  selector: 'app-side-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe, NumPipe, GameDatePipe, DemandMeterComponent, LineChartComponent],
  template: `
    <div class="panel glass" [class.collapsed]="collapsed()">
      <nav class="tabs">
        @for (t of tabs; track t.id) {
          <button [class.active]="tab() === t.id && !collapsed()" (click)="openTab(t.id)" [title]="t.label">
            <span>{{ t.icon }}</span>
            <small>{{ t.label }}</small>
            @if (t.id === 'events' && warnings() > 0) {
              <b class="badge">{{ warnings() }}</b>
            }
          </button>
        }
        <button class="collapse" (click)="collapsed.set(!collapsed())" [title]="collapsed() ? 'Ausklappen' : 'Einklappen'">
          {{ collapsed() ? '◀' : '▶' }}
        </button>
      </nav>

      @if (!collapsed()) {
        <div class="body">
          @switch (tab()) {
            @case ('overview') {
              @if (game.stats(); as s) {
                <div class="kpis">
                  <div class="kpi"><span>Einwohner</span><b>{{ s.population | num }}</b></div>
                  <div class="kpi"><span>Arbeitsplätze</span><b>{{ s.jobs | num }}</b></div>
                  <div class="kpi"><span>Arbeitslosigkeit</span><b [class.bad]="s.unemployment > 0.1">{{ s.unemployment * 100 | num }}%</b></div>
                  <div class="kpi"><span>Zufriedenheit</span><b [class.bad]="s.happiness < 40" [class.good]="s.happiness >= 65">{{ s.happiness }}%</b></div>
                  <div class="kpi"><span>Gebäude</span><b>{{ s.buildingCount | num }}</b></div>
                  <div class="kpi"><span>Straßen</span><b>{{ s.roadCount | num }}</b></div>
                </div>
                <div class="split">
                  <app-demand-meter />
                  <div class="meters">
                    <div class="meter">
                      <div class="m-head"><span>Bodenwert</span><span>{{ s.avgLandValue }}</span></div>
                      <div class="m-track"><div class="m-fill lv" [style.width.%]="s.avgLandValue"></div></div>
                    </div>
                    <div class="meter">
                      <div class="m-head"><span>Verschmutzung</span><span>{{ s.avgPollution }}</span></div>
                      <div class="m-track"><div class="m-fill pol" [style.width.%]="s.avgPollution"></div></div>
                    </div>
                    <div class="meter">
                      <div class="m-head"><span>Kriminalität</span><span>{{ s.avgCrime }}</span></div>
                      <div class="m-track"><div class="m-fill crime" [style.width.%]="s.avgCrime"></div></div>
                    </div>
                    <div class="meter">
                      <div class="m-head"><span>Zufriedenheit</span><span>{{ s.happiness }}</span></div>
                      <div class="m-track"><div class="m-fill happy" [style.width.%]="s.happiness"></div></div>
                    </div>
                  </div>
                </div>
                <div class="hint">{{ advice() }}</div>
              }
            }
            @case ('finance') {
              @if (game.budget(); as b) {
                <div class="money-row">
                  <div>
                    <span class="lbl">Stadtkasse</span>
                    <div class="big" [class.bad]="b.money < 0">{{ b.money | money }}</div>
                  </div>
                  <div class="right">
                    <span class="lbl">Letzter Monat</span>
                    <div [class.good]="b.lastMonthIncome - b.lastMonthExpenses >= 0" [class.bad]="b.lastMonthIncome - b.lastMonthExpenses < 0">
                      {{ b.lastMonthIncome - b.lastMonthExpenses >= 0 ? '+' : '' }}{{ b.lastMonthIncome - b.lastMonthExpenses | num }}
                    </div>
                  </div>
                </div>

                <h4>Steuern</h4>
                @for (t of taxRows; track t.key) {
                  <label class="tax">
                    <span class="tax-name" [style.color]="t.color">{{ t.label }}</span>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      [value]="b.taxRates[t.key]"
                      (input)="setTax(t.key, $any($event.target).valueAsNumber)"
                    />
                    <span class="tax-val">{{ b.taxRates[t.key] }}%</span>
                  </label>
                }
                <div class="small muted">Hohe Steuern bringen Geld, senken aber Nachfrage und Zufriedenheit.</div>

                <h4>Einnahmen</h4>
                @for (r of incomeRows(); track r.label) {
                  <div class="row"><span>{{ r.label }}</span><span class="good">{{ r.value | money }}</span></div>
                }
                <h4>Ausgaben</h4>
                @for (r of expenseRows(); track r.label) {
                  <div class="row"><span>{{ r.label }}</span><span class="bad">{{ r.value | money }}</span></div>
                }
                <div class="chart">
                  <app-line-chart title="Einnahmen & Ausgaben" [series]="financeSeries()" />
                </div>
              }
            }
            @case ('utilities') {
              @if (game.stats(); as s) {
                <div class="util">
                  <div class="util-head">
                    <span>⚡ Strom</span>
                    <span [class.bad]="s.powerDemand > s.powerSupply">{{ s.powerDemand | num }} / {{ s.powerSupply | num }} MW</span>
                  </div>
                  <div class="m-track tall">
                    <div class="m-fill power" [class.over]="s.powerDemand > s.powerSupply" [style.width.%]="usage(s.powerDemand, s.powerSupply)"></div>
                  </div>
                  <div class="small muted">
                    @if (s.powerSupply === 0) {
                      Kein Kraftwerk vorhanden. Zonen wachsen nur mit Strom.
                    } @else if (s.powerDemand > s.powerSupply) {
                      Zu wenig Leistung! Nicht alle Gebäude werden versorgt.
                    } @else {
                      Auslastung {{ usage(s.powerDemand, s.powerSupply) | num }}%.
                    }
                  </div>
                </div>
                <div class="util">
                  <div class="util-head">
                    <span>💧 Wasser</span>
                    <span [class.bad]="s.waterDemand > s.waterSupply">{{ s.waterDemand | num }} / {{ s.waterSupply | num }} m³</span>
                  </div>
                  <div class="m-track tall">
                    <div class="m-fill water" [class.over]="s.waterDemand > s.waterSupply" [style.width.%]="usage(s.waterDemand, s.waterSupply)"></div>
                  </div>
                  <div class="small muted">
                    @if (s.waterSupply === 0) {
                      Keine Wasserpumpe. Ab Stufe 2 brauchen Gebäude Wasser.
                    } @else if (s.waterDemand > s.waterSupply) {
                      Zu wenig Wasser! Baue weitere Pumpen, am besten am Ufer.
                    } @else {
                      Auslastung {{ usage(s.waterDemand, s.waterSupply) | num }}%.
                    }
                  </div>
                </div>
                <div class="small muted">
                  Strom und Wasser fließen über Straßen, Zonen und Gebäude. Nutze die Ebenen unten links, um die Versorgung zu prüfen.
                </div>
              }
            }
            @case ('stats') {
              <div class="chart"><app-line-chart title="Bevölkerung & Jobs" [series]="popSeries()" /></div>
              <div class="chart"><app-line-chart title="Stadtkasse" [series]="moneySeries()" /></div>
              <div class="chart"><app-line-chart title="Zufriedenheit" [series]="happySeries()" /></div>
              <div class="small muted">{{ game.history().length }} Monate erfasst.</div>
            }
            @case ('events') {
              @if (game.events().length === 0) {
                <div class="small muted">Noch keine Meldungen.</div>
              }
              <ul class="events">
                @for (e of game.events(); track e.id) {
                  <li [class]="e.severity" (click)="focusEvent(e.x, e.y)" [class.clickable]="e.x !== undefined">
                    <div class="e-date">{{ e.date | gameDate }}</div>
                    <div>{{ e.message }}</div>
                  </li>
                }
              </ul>
            }
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      top: 76px;
      right: 12px;
      z-index: 9;
      max-height: calc(100vh - 180px);
      display: flex;
    }
    .panel {
      width: 330px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel.collapsed {
      width: auto;
    }
    .tabs {
      display: flex;
      gap: 2px;
      padding: 6px;
      border-bottom: 1px solid var(--border);
    }
    .collapsed .tabs {
      flex-direction: column;
      border-bottom: none;
    }
    .tabs button {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 6px 2px;
      border-radius: 10px;
      border: none;
      background: transparent;
      color: var(--muted);
      font-size: 16px;
    }
    .tabs button small {
      font-size: 9px;
    }
    .collapsed .tabs button small {
      display: none;
    }
    .tabs button:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
    }
    .tabs button.active {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text);
    }
    .tabs .collapse {
      flex: 0 0 26px;
      font-size: 11px;
    }
    .badge {
      position: absolute;
      top: 2px;
      right: 6px;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      background: var(--danger);
      color: white;
      font-size: 10px;
      line-height: 16px;
    }
    .body {
      padding: 12px 14px 14px;
      overflow-y: auto;
    }
    .kpis {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
      margin-bottom: 12px;
    }
    .kpi {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      padding: 7px 8px;
      display: flex;
      flex-direction: column;
    }
    .kpi span {
      font-size: 10px;
      color: var(--muted);
    }
    .kpi b {
      font-size: 15px;
      font-variant-numeric: tabular-nums;
    }
    .split {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .meters {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .m-head {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 3px;
    }
    .m-track {
      height: 7px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      overflow: hidden;
    }
    .m-track.tall {
      height: 12px;
      margin: 6px 0;
    }
    .m-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.6s ease;
    }
    .lv {
      background: linear-gradient(90deg, #e2a03f, #4cd07d);
    }
    .pol {
      background: linear-gradient(90deg, #a68a5b, #6b4f2a);
    }
    .crime {
      background: linear-gradient(90deg, #ff9a9a, #e53935);
    }
    .happy {
      background: linear-gradient(90deg, #ffd24c, #4cd07d);
    }
    .power {
      background: linear-gradient(90deg, #ffe066, #ffb300);
    }
    .water {
      background: linear-gradient(90deg, #6fd3ff, #1e88e5);
    }
    .m-fill.over {
      background: var(--danger);
    }
    .hint {
      margin-top: 14px;
      padding: 9px 10px;
      border-radius: 10px;
      background: rgba(74, 168, 255, 0.12);
      border: 1px solid rgba(74, 168, 255, 0.3);
      font-size: 12px;
    }
    h4 {
      margin: 14px 0 6px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .money-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .money-row .right {
      text-align: right;
    }
    .lbl {
      font-size: 10px;
      color: var(--muted);
    }
    .big {
      font-size: 22px;
      font-weight: 700;
      color: #9ff5c4;
    }
    .tax {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .tax-name {
      width: 74px;
      font-size: 12px;
      font-weight: 600;
    }
    .tax input {
      flex: 1;
      accent-color: var(--accent);
    }
    .tax-val {
      width: 34px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 3px 0;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
    }
    .chart {
      margin-top: 14px;
    }
    .util {
      margin-bottom: 16px;
    }
    .util-head {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
    }
    .small {
      font-size: 11px;
    }
    .muted {
      color: var(--muted);
    }
    .good {
      color: #7ef0ad;
    }
    .bad {
      color: var(--danger) !important;
    }
    .events {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .events li {
      font-size: 12px;
      padding: 7px 9px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      border-left: 3px solid var(--muted);
    }
    .events li.clickable {
      cursor: pointer;
    }
    .events li.success {
      border-color: var(--accent);
    }
    .events li.warning {
      border-color: #ffc145;
    }
    .events li.danger {
      border-color: var(--danger);
    }
    .events li.info {
      border-color: #4aa8ff;
    }
    .e-date {
      font-size: 10px;
      color: var(--muted);
    }
    @media (max-width: 900px) {
      :host {
        top: 120px;
      }
      .panel {
        width: 290px;
      }
    }
  `,
})
export class SidePanelComponent {
  readonly game = inject(GameService);
  readonly tab = signal<Tab>('overview');
  /** Starts collapsed on small screens so the map stays visible. */
  readonly collapsed = signal(typeof window !== 'undefined' && window.innerWidth < 900);

  readonly tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'overview', icon: '📊', label: 'Übersicht' },
    { id: 'finance', icon: '💰', label: 'Finanzen' },
    { id: 'utilities', icon: '⚡', label: 'Versorgung' },
    { id: 'stats', icon: '📈', label: 'Statistik' },
    { id: 'events', icon: '🔔', label: 'Meldungen' },
  ];

  readonly taxRows: { key: keyof TaxRates; label: string; color: string }[] = [
    { key: 'residential', label: 'Wohnen', color: '#4cd07d' },
    { key: 'commercial', label: 'Gewerbe', color: '#4aa8ff' },
    { key: 'industrial', label: 'Industrie', color: '#ffc145' },
  ];

  readonly warnings = computed(
    () => this.game.events().slice(0, 10).filter((e) => e.severity === 'warning' || e.severity === 'danger').length,
  );

  readonly incomeRows = computed(() => {
    const b = this.game.budget();
    if (!b) return [];
    return [
      { label: 'Wohnsteuer', value: b.incomeBreakdown.residential },
      { label: 'Gewerbesteuer', value: b.incomeBreakdown.commercial },
      { label: 'Industriesteuer', value: b.incomeBreakdown.industrial },
    ];
  });

  readonly expenseRows = computed(() => {
    const b = this.game.budget();
    if (!b) return [];
    return [
      { label: 'Straßen', value: b.expenseBreakdown.roads },
      { label: 'Kraftwerke', value: b.expenseBreakdown.power },
      { label: 'Wasser', value: b.expenseBreakdown.water },
      { label: 'Öffentliche Dienste', value: b.expenseBreakdown.services },
    ];
  });

  private readonly recent = computed(() => this.game.history().slice(-60));

  readonly financeSeries = computed<ChartSeries[]>(() => [
    { label: 'Einnahmen', color: '#4cd07d', values: this.recent().map((h) => h.income) },
    { label: 'Ausgaben', color: '#ff6b6b', values: this.recent().map((h) => h.expenses) },
  ]);
  readonly popSeries = computed<ChartSeries[]>(() => [
    { label: 'Einwohner', color: '#4cd07d', values: this.recent().map((h) => h.population) },
    { label: 'Jobs', color: '#4aa8ff', values: this.recent().map((h) => h.jobs) },
  ]);
  readonly moneySeries = computed<ChartSeries[]>(() => [
    { label: 'Kasse', color: '#ffc145', values: this.recent().map((h) => h.money) },
  ]);
  readonly happySeries = computed<ChartSeries[]>(() => [
    { label: 'Zufriedenheit', color: '#c084fc', values: this.recent().map((h) => h.happiness) },
  ]);

  readonly advice = computed(() => {
    const s = this.game.stats();
    const d = this.game.demand();
    if (!s) return '';
    if (s.roadCount === 0) return '💡 Baue zuerst Straßen (Taste R) – sie erschließen Zonen und leiten Versorgung.';
    if (s.powerSupply === 0) return '💡 Ohne Strom wächst nichts. Baue ein Kraftwerk (Taste P) an deine Straßen.';
    if (s.population === 0 && !this.game.tiles.some((t) => t.zone)) return '💡 Weise Wohn-, Gewerbe- und Industriezonen entlang der Straßen aus (Tasten 1–3).';
    if (s.powerDemand > s.powerSupply) return '⚠️ Der Strom reicht nicht. Baue ein weiteres Kraftwerk.';
    if (s.waterSupply === 0 && s.population > 150) return '💡 Mit Wasserpumpen können Gebäude auf Stufe 2 und 3 wachsen.';
    if (s.waterDemand > s.waterSupply) return '⚠️ Das Wasser reicht nicht. Baue weitere Pumpen.';
    if (s.avgCrime > 20) return '🚓 Die Kriminalität steigt – eine Polizeiwache hilft.';
    if (s.avgPollution > 25) return '🌳 Viel Smog. Parks und Solarstrom verbessern die Luft.';
    const max = Math.max(d.residential, d.commercial, d.industrial);
    if (max > 0.3) {
      const which = max === d.residential ? 'Wohnzonen' : max === d.commercial ? 'Gewerbezonen' : 'Industriezonen';
      return `📈 Hohe Nachfrage nach ${which}. Weise mehr Flächen aus.`;
    }
    if (s.happiness < 45) return '🙁 Die Bürger sind unzufrieden. Schulen, Krankenhäuser und Parks helfen.';
    return '✨ Deine Stadt läuft gut. Weiter so!';
  });

  readonly monthName = (m: number) => MONTHS[m - 1];

  openTab(t: Tab): void {
    this.tab.set(t);
    this.collapsed.set(false);
  }

  setTax(key: keyof TaxRates, value: number): void {
    const b = this.game.budget();
    if (!b) return;
    this.game.setTaxes({ ...b.taxRates, [key]: value });
  }

  usage(demand: number, supply: number): number {
    if (supply <= 0) return demand > 0 ? 100 : 0;
    return Math.min(100, (demand / supply) * 100);
  }

  focusEvent(x?: number, y?: number): void {
    if (x === undefined || y === undefined) return;
    this.game.focus(x, y);
    this.game.selected.set({ x, y });
  }
}
