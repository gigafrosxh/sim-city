import { ChangeDetectionStrategy, Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { APP_CONFIG, ApiMode, persistConfig } from '../core/config';
import { GameService } from '../core/game.service';
import { GameDatePipe, MoneyPipe, NumPipe } from '../core/format';
import { CitySummary } from '../core/models';

const NAMES = ['Neustadt', 'Sonnenberg', 'Havenburg', 'Lindenau', 'Rheinhafen', 'Waldheim', 'Seefeld', 'Altmark'];

@Component({
  selector: 'app-start-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MoneyPipe, NumPipe, GameDatePipe],
  template: `
    <div class="backdrop">
      <div class="dialog glass">
        <header>
          <div class="logo">🏙️</div>
          <div>
            <h1>City-Sim</h1>
            <p>Plane, baue und verwalte deine eigene Stadt.</p>
          </div>
          @if (canClose()) {
            <button class="close" (click)="closed.emit()" title="Zurück zum Spiel">✕</button>
          }
        </header>

        <div class="cols">
          <section>
            <h2>Neue Stadt gründen</h2>
            <label>
              Name
              <input [(ngModel)]="name" maxlength="40" />
            </label>
            <label>
              Kartengröße
              <div class="sizes">
                @for (s of sizes; track s.value) {
                  <button type="button" [class.active]="size() === s.value" (click)="size.set(s.value)">
                    <b>{{ s.label }}</b>
                    <small>{{ s.value }}×{{ s.value }}</small>
                  </button>
                }
              </div>
            </label>
            <label>
              Seed (optional)
              <input [(ngModel)]="seed" placeholder="zufällig" inputmode="numeric" />
            </label>
            <button class="primary" (click)="create()" [disabled]="busy()">
              {{ busy() ? 'Wird erstellt…' : 'Stadt gründen' }}
            </button>
          </section>

          <section>
            <h2>Gespeicherte Städte</h2>
            @if (loadError()) {
              <div class="error">{{ loadError() }}</div>
            }
            @if (cities().length === 0 && !loadError()) {
              <div class="empty">Noch keine Städte vorhanden.</div>
            }
            <ul class="cities">
              @for (c of cities(); track c.id) {
                <li>
                  <button class="city" (click)="open(c)">
                    <b>{{ c.name }}</b>
                    <small>{{ c.population | num }} Einwohner · {{ c.money | money }} · {{ c.date | gameDate }}</small>
                  </button>
                  <button class="del" (click)="remove(c)" title="Löschen">🗑</button>
                </li>
              }
            </ul>
          </section>
        </div>

        <details class="conn">
          <summary>Verbindung: {{ game.api.label }}</summary>
          <div class="conn-body">
            <div class="modes">
              <label><input type="radio" name="mode" value="mock" [(ngModel)]="mode" /> Offline (Simulation im Browser)</label>
              <label><input type="radio" name="mode" value="http" [(ngModel)]="mode" /> Server (Backend-API)</label>
            </div>
            @if (mode === 'http') {
              <label>REST-Basis-URL <input [(ngModel)]="apiUrl" /></label>
              <label>WebSocket-Basis-URL <input [(ngModel)]="wsUrl" /></label>
            }
            <button (click)="applyConnection()">Übernehmen & neu laden</button>
          </div>
        </details>

        <footer>
          <span><kbd>R</kbd> Straße</span>
          <span><kbd>1</kbd>–<kbd>3</kbd> Zonen</span>
          <span><kbd>P</kbd> Kraftwerk</span>
          <span><kbd>B</kbd> Abriss</span>
          <span><kbd>WASD</kbd> Kamera</span>
          <span><kbd>Mausrad</kbd> Zoom</span>
          <span><kbd>Leertaste</kbd> Pause</span>
        </footer>
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: absolute;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: radial-gradient(circle at 30% 20%, rgba(76, 208, 125, 0.15), transparent 50%),
        radial-gradient(circle at 80% 80%, rgba(74, 168, 255, 0.18), transparent 50%), rgba(6, 12, 20, 0.6);
      backdrop-filter: blur(3px);
    }
    .dialog {
      width: min(860px, 100%);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      padding: 22px 24px;
    }
    header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 18px;
    }
    .logo {
      font-size: 46px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      background: linear-gradient(90deg, #9ff5c4, #7cc4ff);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    header p {
      margin: 2px 0 0;
      color: var(--muted);
    }
    .close {
      margin-left: auto;
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
      width: 34px;
      height: 34px;
      border-radius: 10px;
    }
    .cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 22px;
    }
    @media (max-width: 720px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
    h2 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 0 0 10px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 12px;
    }
    input:not([type='radio']) {
      padding: 9px 11px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.25);
      color: var(--text);
      font-size: 14px;
    }
    .sizes {
      display: flex;
      gap: 6px;
    }
    .sizes button {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
    }
    .sizes button small {
      color: var(--muted);
      font-size: 10px;
    }
    .sizes button.active {
      border-color: var(--accent);
      background: rgba(76, 208, 125, 0.15);
    }
    .primary {
      width: 100%;
      padding: 12px;
      border-radius: 12px;
      border: none;
      font-weight: 700;
      font-size: 15px;
      color: #06221a;
      background: linear-gradient(90deg, #4cd07d, #3fbfb0);
      box-shadow: 0 6px 20px rgba(76, 208, 125, 0.3);
    }
    .primary:disabled {
      opacity: 0.6;
    }
    .cities {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 300px;
      overflow-y: auto;
    }
    .cities li {
      display: flex;
      gap: 6px;
    }
    .city {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
      text-align: left;
    }
    .city:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .city small {
      color: var(--muted);
      font-size: 11px;
    }
    .del {
      width: 40px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 80, 80, 0.08);
    }
    .empty,
    .error {
      font-size: 13px;
      color: var(--muted);
      padding: 12px 0;
    }
    .error {
      color: var(--danger);
    }
    .conn {
      margin-top: 18px;
      font-size: 13px;
    }
    .conn summary {
      cursor: pointer;
      color: var(--muted);
    }
    .conn-body {
      padding-top: 10px;
    }
    .modes {
      display: flex;
      gap: 16px;
      margin-bottom: 10px;
    }
    .modes label {
      flex-direction: row;
      align-items: center;
      color: var(--text);
    }
    .conn-body > button {
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
    }
    footer {
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 11px;
      color: var(--muted);
    }
    kbd {
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid var(--border);
      font-family: inherit;
    }
  `,
})
export class StartScreenComponent implements OnInit {
  readonly game = inject(GameService);
  private readonly config = inject(APP_CONFIG);
  readonly canClose = input(false);
  readonly closed = output<void>();

  readonly cities = signal<CitySummary[]>([]);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly size = signal(64);
  readonly sizes = [
    { value: 48, label: 'Klein' },
    { value: 64, label: 'Mittel' },
    { value: 96, label: 'Groß' },
  ];
  name = NAMES[Math.floor(Math.random() * NAMES.length)];
  seed = '';
  mode: ApiMode = this.config.apiMode;
  apiUrl = this.config.apiBaseUrl;
  wsUrl = this.config.wsBaseUrl;

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.cities.set(await this.game.api.listCities());
      this.loadError.set(null);
    } catch {
      this.loadError.set('Städte konnten nicht geladen werden. Ist der Server erreichbar?');
    }
  }

  async create(): Promise<void> {
    this.busy.set(true);
    try {
      const seedNum = this.seed.trim() ? Number(this.seed.replace(/\D/g, '')) || undefined : undefined;
      await this.game.createCity({ name: this.name.trim() || 'Neustadt', width: this.size(), height: this.size(), seed: seedNum });
      this.closed.emit();
    } catch (e) {
      this.game.toast('danger', `Stadt konnte nicht erstellt werden: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.busy.set(false);
    }
  }

  open(c: CitySummary): void {
    this.game.open(c.id);
    this.closed.emit();
  }

  async remove(c: CitySummary): Promise<void> {
    if (!confirm(`„${c.name}“ wirklich löschen?`)) return;
    if (this.game.cityId() === c.id) this.game.close();
    await this.game.api.deleteCity(c.id);
    await this.refresh();
  }

  applyConnection(): void {
    persistConfig({ apiMode: this.mode, apiBaseUrl: this.apiUrl, wsBaseUrl: this.wsUrl });
    const url = new URL(location.href);
    url.searchParams.delete('api');
    location.href = url.toString();
  }
}
