import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { GameService } from '../core/game.service';
import { drawMinimap } from './iso-renderer';
import { ViewportService } from './viewport.service';

const SIZE = 220;

@Component({
  selector: 'app-minimap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas [width]="size" [height]="size / 2" (pointerdown)="onClick($event)" (pointermove)="onDrag($event)"></canvas>`,
  styles: `
    :host {
      display: block;
    }
    canvas {
      display: block;
      width: 220px;
      height: 110px;
      cursor: pointer;
    }
  `,
})
export class MinimapComponent {
  private readonly game = inject(GameService);
  private readonly viewport = inject(ViewportService);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  readonly size = SIZE;
  private base?: HTMLCanvasElement;
  private dirty = true;
  private lastDraw = 0;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      this.game.tilesVersion();
      this.game.overlay();
      this.dirty = true;
    });
    effect(() => {
      this.viewport.corners();
      this.composite();
    });
    afterNextRender(() => {
      this.base = document.createElement('canvas');
      this.base.width = SIZE;
      this.base.height = SIZE / 2;
      const timer = setInterval(() => {
        if (this.dirty && performance.now() - this.lastDraw > 400) this.composite();
      }, 250);
      this.destroyRef.onDestroy(() => clearInterval(timer));
      this.composite();
    });
  }

  private composite(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.base) return;
    const w = this.game.width();
    const h = this.game.height();
    if (this.dirty) {
      const bctx = this.base.getContext('2d')!;
      drawMinimap(bctx, this.game.tiles, w, h, SIZE, this.game.overlay());
      this.dirty = false;
      this.lastDraw = performance.now();
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, SIZE, SIZE / 2);
    ctx.drawImage(this.base, 0, 0);
    const corners = this.viewport.corners();
    if (!w || corners.length !== 4) return;
    const scale = SIZE / (w + h);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach((c, k) => {
      const mx = scale * (c.x - c.y) + scale * h;
      const my = (scale / 2) * (c.x + c.y);
      if (k === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.closePath();
    ctx.stroke();
  }

  onClick(e: PointerEvent): void {
    this.focusAt(e);
  }

  onDrag(e: PointerEvent): void {
    if (e.buttons & 1) this.focusAt(e);
  }

  private focusAt(e: PointerEvent): void {
    const w = this.game.width();
    const h = this.game.height();
    if (!w) return;
    const el = this.canvasRef()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * SIZE;
    const my = ((e.clientY - rect.top) / rect.height) * (SIZE / 2);
    const scale = SIZE / (w + h);
    const a = (mx - scale * h) / scale;
    const b = (my * 2) / scale;
    const u = (a + b) / 2;
    const v = (b - a) / 2;
    this.game.focus(Math.max(0, Math.min(w - 1, Math.floor(u))), Math.max(0, Math.min(h - 1, Math.floor(v))));
  }
}
