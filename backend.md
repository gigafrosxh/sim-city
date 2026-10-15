# City-Sim Backend: Anforderungen

Dieses Dokument beschreibt, was das Backend liefern muss, damit das Angular-Frontend (`frontend/`)
im Server-Modus vollständig funktioniert. Die genauen JSON-Formate stehen in
[`docs/api-contract.md`](docs/api-contract.md). Die Referenz-Implementierung der Spielregeln liegt in
`frontend/src/app/core/sim/simulation.ts`, der Bau-Katalog in `frontend/src/app/core/catalog.ts`, alle
Typen in `frontend/src/app/core/models.ts`. Bei Widersprüchen gilt: `models.ts` für Formate,
`simulation.ts` für Regeln.

Die Technologie ist frei wählbar. Das Backend liegt im Ordner `backend/` im Repo-Root.

---

## 1. Rahmenbedingungen

| Punkt | Anforderung |
|---|---|
| Port | `8080` (der Dev-Proxy des Frontends leitet `/api` und `/ws` dorthin) |
| REST-Basis | `/api` |
| WebSocket-Basis | `/ws` |
| Format | JSON, UTF-8, camelCase, Zeitstempel als ISO-8601 |
| Fehler | HTTP ≥ 400 mit Body `{ "error": "Deutsche Meldung" }`; das Frontend zeigt `error` direkt an |
| CORS | `http://localhost:4200` erlauben (Methoden GET, POST, PUT, DELETE) |
| Sprache | Alle Texte für Spieler (`error`, `GameEvent.message`) auf Deutsch |
| Start | Ein Befehl startet den Server (z. B. `npm start`, `./gradlew bootRun`, `go run .`), dokumentiert in `backend/README.md` |

Testen gegen das Frontend: `cd frontend && npm install && npm start`, dann
`http://localhost:4200/?api=http` öffnen.

---

## 2. Endpunkte (Pflicht)

| # | Methode | Pfad | Body | Antwort |
|---|---|---|---|---|
| E1 | GET | `/api/catalog` | – | `CatalogEntry[]` (Inhalt wie `catalog.ts`) |
| E2 | GET | `/api/cities` | – | `CitySummary[]`, zuletzt geändert zuerst |
| E3 | POST | `/api/cities` | `{ name, width, height, seed? }` | `201` + `CityState` |
| E4 | GET | `/api/cities/{id}` | – | `CityState`; `404` wenn unbekannt |
| E5 | DELETE | `/api/cities/{id}` | – | `204` |
| E6 | POST | `/api/cities/{id}/build` | `{ tool, tiles: [{x,y}] }` | `BuildResult` |
| E7 | PUT | `/api/cities/{id}/taxes` | `{ residential, commercial, industrial }` (je 0..20) | `Budget` |
| E8 | PUT | `/api/cities/{id}/speed` | `{ speed: 0..3 }` | `204` + WS-Nachricht `speed` |
| E9 | POST | `/api/cities/{id}/loans` | `{ amount: 10000 \| 25000 \| 50000 }` | `Budget`; `409` wenn schon ein Kredit läuft |
| E10 | POST | `/api/cities/{id}/loans/repay` | `{}` | `Budget`; `409` ohne Kredit oder bei zu wenig Geld |
| E11 | POST | `/api/cities/import` | `CityState` (vom Frontend exportierte Datei) | `201` + `CityState` mit **neuer** `id`; `400` bei ungültigen Daten |
| W1 | WS | `/ws/cities/{id}` | – | siehe Abschnitt 3 |

Validierung: `width`/`height` 32..128, `name` 1..40 Zeichen, Koordinaten außerhalb der Karte werden
ignoriert, unbekanntes `tool` → `400`.

---

## 3. WebSocket `/ws/cities/{id}`

1. Direkt nach dem Verbinden: `{ "type": "snapshot", "city": CityState }`.
2. Nach jedem Simulationsschritt: `{ "type": "tick", "update": TickUpdate }` mit **nur den geänderten
   Tiles** (komplette Tile-Objekte), aktuellem `budget`, `demand`, `stats`, am Monatsende `history` und
   `goals`, wenn sich ein Ziel geändert hat.
3. Spielereignisse: `{ "type": "event", "event": GameEvent }`, auch für Ereignisse, die durch REST-Aktionen
   entstehen (z. B. `BUILDING_COMPLETED` nach E6, `LOAN_TAKEN` nach E9).
4. Nach E8: `{ "type": "speed", "speed": n }`.
5. Fehler: `{ "type": "error", "message": "…" }`.

Das Frontend verbindet sich bei Abbruch selbst neu und erwartet dann wieder einen `snapshot`.
Mehrere Clients pro Stadt müssen dieselben Nachrichten bekommen.

**Takt:** 1 Tick = 1 Spieltag. Geschwindigkeit 0 = Pause, 1 = 900 ms, 2 = 350 ms, 3 = 110 ms.
Die Simulation läuft nur, solange mindestens ein Client verbunden ist.

---

## 4. Simulation

Das Backend ist die maßgebliche Simulation im Server-Modus und muss sich wie
`frontend/src/app/core/sim/simulation.ts` verhalten. Die Regeln sind in `docs/api-contract.md`,
Abschnitt 4, zusammengefasst. Am einfachsten ist ein direkter Port dieser Datei. Bei einem Node/TypeScript-Backend
kann sie per Import wiederverwendet werden.

Pflichtbestandteile:

| # | Feature | Kurzbeschreibung |
|---|---|---|
| S1 | Karte | Terrain-Generator mit Seed (Wiese, Wald, Wasser, Sand); Startzentrum bebaubar |
| S2 | Bauen | Regeln je Werkzeug inkl. Teilerfolg, Kosten, Wald-Zuschlag, Abriss ganzer Grundrisse |
| S3 | Flächen-Bau | 1×1-Gebäude (z. B. Parks) auf alle Felder der Liste, Mehrfeld-Gebäude nur auf `tiles[0]` |
| S4 | Freischaltungen | `unlockPopulation` aus dem Katalog prüfen; `unique` (Rathaus) nur einmal pro Stadt |
| S5 | Strom & Wasser | Netzverteilung per BFS über Straßen/Zonen/Gebäude, Kapazität der Erzeuger, Pumpe am Wasser ×2 |
| S6 | Felder | Bodenwert, Verschmutzung, Kriminalität, Dienst-Abdeckung (Polizei, Feuerwehr, Schule, Krankenhaus, Park, Stadion/Rathaus) |
| S7 | Verkehr | `traffic` je Straße aus umliegenden Gebäuden; wirkt auf Verschmutzung und Bodenwert |
| S8 | Wachstum | Zonen wachsen/schrumpfen nach Nachfrage, Straßenzugang (≤ 3), Strom, Wasser (ab Stufe 2), Bodenwert (Stufe 3) |
| S9 | Nachfrage | RCI-Nachfrage aus Jobs, Einwohnern, Steuern, Zufriedenheit |
| S10 | Brände | Zufällige Brände ab Tick 360, Ausbreitung, Löschen durch Feuerwehr-Abdeckung, sonst Abbrennen |
| S11 | Finanzen | Monatliche Steuern (Rathaus +10 %), Unterhalt, Kreditrate, `history`-Eintrag |
| S12 | Kredite | 10 % Zinsen, 24 Monatsraten, nur ein Kredit gleichzeitig, vorzeitige Tilgung |
| S13 | Ziele | 15 Ziele aus `GOAL_DEFS`, Belohnung einmalig auf die Kasse, Event `GOAL_COMPLETED` |
| S14 | Ereignisse | Event-Codes laut Vertrag (Strom-/Wasserknappheit, Kriminalität, Smog, Meilensteine, Brände, Jahresbericht …) |
| S15 | Statistik | `CityStats` inkl. `avgTraffic`, `buildingsOnFire`; Durchschnitte nur über bebaute/zonierte Felder |

Zufall: ein Seed-basierter PRNG pro Stadt, damit Spielstände reproduzierbar bleiben (Referenz: mulberry32 in
`frontend/src/app/core/sim/rng.ts`).

---

## 5. Persistenz

- Städte überleben einen Server-Neustart (Datei, SQLite oder andere DB).
- Speichern spätestens alle 30 Ticks, nach jeder Bauaktion und wenn der letzte Client trennt.
- Gespeichert werden `CityState` plus interner Zustand (PRNG-Zustand, erreichte Meilensteine,
  Warn-Flags, Event-Zähler).
- `CitySummary.updatedAt` = Zeitpunkt der letzten Speicherung.
- Import (E11) akzeptiert ältere Dateien: fehlende Felder (`goals`, `traffic`, `loanBalance` …) mit
  Standardwerten auffüllen.

---

## 6. Qualität und Abnahme

Das Backend gilt als fertig, wenn:

1. Alle Endpunkte E1–E11 und W1 laut Vertrag antworten.
2. Im Frontend mit `?api=http` folgender Ablauf ohne Konsolenfehler funktioniert: Stadt anlegen,
   Straßen ziehen, Kraftwerk und Pumpe bauen, Zonen ausweisen, bei Geschwindigkeit 3 wächst die
   Stadt binnen eines Spieljahres auf mehrere hundert Einwohner.
3. Steuern, Kredit aufnehmen/tilgen, Export → Import und Löschen im Frontend funktionieren.
4. Ein Server-Neustart verliert keine Stadt.
5. Automatisierte Tests decken mindestens ab: Bauen (Kosten, ungültige Felder, Freischaltung),
   Stromverteilung, Wachstum über viele Ticks, Monatsabrechnung inkl. Kredit, Zielbelohnung.
   Die Testfälle in `frontend/src/app/core/sim/simulation.spec.ts` sind eine gute Vorlage.

---

## 7. Optional (nice to have)

- `GET /api/health` → `{ "status": "ok" }`.
- Mehrere Spieler pro Stadt mit Anzeige der verbundenen Clients.
- Rate-Limit für Bauaktionen.
- Docker-Datei für Frontend + Backend zusammen.
