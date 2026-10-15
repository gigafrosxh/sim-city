# City-Sim Frontend

Angular-20-Frontend (Standalone-Komponenten, Signals, zoneless) für City-Sim, ein SimCity-ähnliches
Städtebauspiel. Die Stadtkarte wird isometrisch auf einem Canvas gezeichnet, komplett prozedural
(keine Bilddateien): animierte Gebäude, Autos, Rauch, Wasser und ein Tag/Nacht-Zyklus.

## Starten

```bash
npm install
npm start          # http://localhost:4200
npm test -- --watch=false   # Unit-Tests (Headless Chrome, CHROME_BIN setzen falls nötig)
npm run build      # Produktions-Build nach dist/
```

## Offline- und Server-Modus

Das Frontend spricht über die abstrakte Klasse `CityApi` (`src/app/core/api/city-api.ts`):

- **Offline (Standard):** `MockCityApi` führt die Referenz-Simulation (`src/app/core/sim/`) im Browser
  aus und speichert Städte im `localStorage`. Das Spiel ist so ohne Backend voll spielbar.
- **Server:** `HttpCityApi` nutzt REST + WebSocket laut [`docs/api-contract.md`](../docs/api-contract.md).
  Aktivieren über `?api=http` oder im Startbildschirm unter „Verbindung“. `ng serve` leitet `/api` und
  `/ws` an `http://localhost:8080` weiter (`proxy.conf.json`).

## Bedienung

| Eingabe | Aktion |
|---|---|
| Linke Maustaste ziehen | Straßen (Linie), Zonen/Abriss (Rechteck) bauen; mit Inspektor Karte verschieben |
| Rechte/mittlere Maustaste ziehen, WASD, Pfeiltasten | Karte verschieben |
| Mausrad, `+`/`-`, Zwei-Finger-Geste | Zoomen |
| `Q` Inspektor, `B` Abriss, `R` Straße, `1`–`3` Zonen, `4` Zone entfernen, `P` Kraftwerk, `U` Pumpe, `G` Park | Werkzeuge |
| Leertaste | Pause umschalten |
| Esc | Werkzeug abwählen |

## Struktur

```
src/app/
  core/        Modelle, Katalog, Spielzustand (GameService), API-Schicht, Simulation
  map/         Isometrie-Mathematik, Canvas-Renderer, Karten- und Minimap-Komponente
  ui/          Topbar, Werkzeugleiste, Seitenpanel (Übersicht, Finanzen, Versorgung,
               Statistik, Meldungen), Feld-Inspektor, Ebenen, Toasts, Startbildschirm
```
