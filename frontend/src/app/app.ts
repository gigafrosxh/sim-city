import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { GameService } from './core/game.service';
import { CityMapComponent } from './map/city-map.component';
import { HelpOverlayComponent } from './ui/help-overlay.component';
import { MapControlsComponent } from './ui/map-controls.component';
import { NewsTickerComponent } from './ui/news-ticker.component';
import { SidePanelComponent } from './ui/side-panel.component';
import { StartScreenComponent } from './ui/start-screen.component';
import { TileInspectorComponent } from './ui/tile-inspector.component';
import { ToastsComponent } from './ui/toasts.component';
import { ToolbarComponent } from './ui/toolbar.component';
import { TopBarComponent } from './ui/top-bar.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CityMapComponent,
    TopBarComponent,
    ToolbarComponent,
    SidePanelComponent,
    TileInspectorComponent,
    MapControlsComponent,
    ToastsComponent,
    StartScreenComponent,
    NewsTickerComponent,
    HelpOverlayComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly game = inject(GameService);
  readonly menuOpen = signal(false);
}
