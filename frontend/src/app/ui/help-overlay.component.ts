import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameService } from '../core/game.service';

@Component({
  selector: 'app-help-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="game.helpOpen.set(false)">
      <div class="dialog glass" (click)="$event.stopPropagation()">
        <div class="head">
          <h2>Hilfe & Tastenkürzel</h2>
          <button (click)="game.helpOpen.set(false)">✕</button>
        </div>
        <div class="cols">
          <section>
            <h3>Werkzeuge</h3>
            @for (k of tools; track k[0]) {
              <div class="row"><kbd>{{ k[0] }}</kbd><span>{{ k[1] }}</span></div>
            }
          </section>
          <section>
            <h3>Steuerung</h3>
            @for (k of controls; track k[0]) {
              <div class="row"><kbd>{{ k[0] }}</kbd><span>{{ k[1] }}</span></div>
            }
          </section>
        </div>
        <h3>So wächst deine Stadt</h3>
        <ol>
          <li>Baue Straßen. Sie erschließen Zonen und leiten Strom und Wasser.</li>
          <li>Setze ein Kraftwerk oder Windrad direkt an das Straßennetz.</li>
          <li>Weise Wohn-, Gewerbe- und Industriezonen höchstens 3 Felder neben Straßen aus.</li>
          <li>Ab Stufe 2 brauchen Gebäude Wasser: baue Pumpen, am besten am Ufer.</li>
          <li>Polizei, Feuerwehr, Schulen, Parks und Krankenhäuser steigern Bodenwert und Zufriedenheit.</li>
          <li>Größere Gebäude werden mit wachsender Einwohnerzahl freigeschaltet. Ziele bringen Geld.</li>
        </ol>
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: absolute;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(6, 12, 20, 0.55);
      padding: 16px;
    }
    .dialog {
      width: min(680px, 100%);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      padding: 18px 22px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .head button {
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
      width: 32px;
      height: 32px;
      border-radius: 8px;
    }
    h2 {
      margin: 0;
      font-size: 20px;
    }
    h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 16px 0 8px;
    }
    .cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 600px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
    .row {
      display: flex;
      gap: 10px;
      align-items: center;
      font-size: 13px;
      margin-bottom: 5px;
    }
    kbd {
      min-width: 78px;
      text-align: center;
      padding: 2px 6px;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid var(--border);
      font-family: inherit;
      font-size: 11px;
    }
    ol {
      margin: 0;
      padding-left: 18px;
      font-size: 13px;
      line-height: 1.6;
    }
  `,
})
export class HelpOverlayComponent {
  readonly game = inject(GameService);
  readonly tools = [
    ['Q', 'Inspizieren'],
    ['B', 'Abreißen'],
    ['R', 'Straße'],
    ['1 / 2 / 3', 'Wohn- / Gewerbe- / Industriezone'],
    ['4', 'Zone entfernen'],
    ['P', 'Kohlekraftwerk'],
    ['O', 'Windrad'],
    ['U', 'Wasserpumpe'],
    ['G', 'Park (Fläche ziehen)'],
    ['Esc', 'Werkzeug abwählen'],
  ];
  readonly controls = [
    ['WASD / Pfeile', 'Karte verschieben'],
    ['Rechte Maus', 'Karte ziehen'],
    ['Mausrad / + -', 'Zoomen'],
    ['Leertaste', 'Pause'],
    ['F', 'Vollbild'],
    ['K', 'Screenshot'],
    ['H / ?', 'Diese Hilfe'],
  ];
}
