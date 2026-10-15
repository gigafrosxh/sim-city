import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameService, Toast } from '../core/game.service';

const ICONS = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '⛔' };

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (t of game.toasts(); track t.id) {
      <div class="toast glass" [class]="t.severity" (click)="open(t)">
        <span>{{ icons[t.severity] }}</span>
        <span class="msg">{{ t.message }}</span>
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: 76px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      z-index: 20;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 14px;
      font-size: 13px;
      max-width: 420px;
      animation: slide 0.25s ease-out;
      border-left: 3px solid var(--muted);
    }
    .toast.success {
      border-left-color: var(--accent);
    }
    .toast.warning {
      border-left-color: #ffc145;
    }
    .toast.danger {
      border-left-color: var(--danger);
    }
    .toast.info {
      border-left-color: #4aa8ff;
    }
    @keyframes slide {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
  `,
})
export class ToastsComponent {
  readonly game = inject(GameService);
  readonly icons = ICONS;

  open(t: Toast): void {
    if (t.at) {
      this.game.focus(t.at.x, t.at.y);
      this.game.selected.set(t.at);
    }
    this.game.dismissToast(t.id);
  }
}
