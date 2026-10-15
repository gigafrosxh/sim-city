# City-Sim API-Vertrag (v1.1)

Dieser Vertrag beschreibt die Schnittstelle zwischen dem Angular-Frontend (`frontend/`) und dem Backend.
Das Frontend bringt eine vollständige Referenz-Implementierung der Simulation mit
(`frontend/src/app/core/sim/simulation.ts`), die im Offline-Modus im Browser läuft. Das Backend soll sich
gegenüber dem Frontend genauso verhalten. Die TypeScript-Typen in `frontend/src/app/core/models.ts`
sind die maßgebliche Definition aller JSON-Formate.

- **Transport:** REST (JSON) für Abfragen und Aktionen, WebSocket für Echtzeit-Ticks.
- **Basis-URLs:** REST unter `/api`, WebSocket unter `/ws`. Im Dev-Modus leitet `ng serve` beides an
  `http://localhost:8080` weiter (`frontend/proxy.conf.json`).
- **Format:** JSON, UTF-8, Feldnamen in camelCase. Zeitstempel als ISO-8601-String.
- **Fehler:** HTTP-Status ≥ 400 mit Body `{ "error": "Meldung auf Deutsch" }`.
- **CORS:** Wenn Frontend und Backend auf verschiedenen Ursprüngen laufen, muss das Backend CORS für
  `http://localhost:4200` erlauben.

Frontend-Umschaltung: `?api=http` in der URL oder im Startbildschirm unter „Verbindung“. Eigene URLs per
`?apiUrl=http://host:8080/api&wsUrl=ws://host:8080/ws`.

---

## 1. Datenmodell

### Koordinaten und Karte

- Die Karte ist ein Raster `width × height` (Standard 64 × 64, erlaubt 32–128).
- `tiles` ist zeilenweise gespeichert: `index = y * width + x`.
- `x` wächst nach rechts unten, `y` nach links unten (isometrische Darstellung macht das Frontend).

### Tile

```jsonc
{
  "x": 12, "y": 7,
  "terrain": "grass",          // "grass" | "forest" | "water" | "sand"
  "zone": "residential",       // "residential" | "commercial" | "industrial" | null
  "building": {                // null, wenn unbebaut
    "type": "residential",     // siehe BuildingType
    "level": 2,                // 1..3 bei Zonengebäuden, sonst 1
    "originX": 12, "originY": 7, // obere Ecke des Grundrisses
    "size": 1,                 // Kantenlänge des quadratischen Grundrisses
    "builtAt": 412,            // Tick des Baus bzw. letzten Stufenwechsels (Frontend animiert dann)
    "variant": 3,              // 0..3, rein kosmetisch, zufällig beim Bau
    "fire": 0                  // verbleibende Brand-Ticks, 0/fehlend = brennt nicht
  },
  "powered": true,
  "watered": false,
  "landValue": 54,             // 0..100, ganzzahlig
  "pollution": 3,              // 0..100, ganzzahlig
  "crime": 12,                 // 0..100, ganzzahlig
  "traffic": 0                 // 0..100, nur auf Straßen > 0
}
```

Gebäude mit `size > 1` stehen auf **jedem** Feld ihres Grundrisses mit identischem `building`-Objekt
(gleiche `originX/originY`).

`BuildingType`: `road`, `residential`, `commercial`, `industrial`, `power_coal`, `power_solar`,
`power_wind`, `water_pump`, `police`, `fire`, `school`, `hospital`, `park`, `stadium`, `city_hall`.

### Weitere Typen

```ts
GameDate   { year, month /*1..12*/, day /*1..30*/ }      // 30-Tage-Monate, Start 1.1.2000
TaxRates   { residential, commercial, industrial }      // 0..20 (Prozent), Standard 9
Budget     { money, taxRates, lastMonthIncome, lastMonthExpenses,
             incomeBreakdown:  { residential, commercial, industrial },
             expenseBreakdown: { roads, power, water, services, loans },
             loanBalance, loanPayment }
Demand     { residential, commercial, industrial }      // jeweils -1..1, 2 Nachkommastellen
CityStats  { population, jobs, commercialJobs, industrialJobs, unemployment /*0..1*/,
             powerSupply, powerDemand, waterSupply, waterDemand, happiness /*0..100*/,
             avgLandValue, avgPollution, avgCrime, buildingCount, roadCount,
             avgTraffic, buildingsOnFire }
Goal       { id, title, description, reward, progress, target, completed }
HistoryEntry { tick, date, population, money, income, expenses, happiness, jobs }
CityState  { id, name, width, height, seed, tick, date, speed /*0..3*/, tiles: Tile[],
             budget, demand, stats, history: HistoryEntry[] /*max. 240 Monate*/,
             goals: Goal[] }
CitySummary { id, name, width, height, population, money, date, updatedAt }
GameEvent  { id, tick, date, severity: "info"|"success"|"warning"|"danger",
             code, message /*Deutsch, wird direkt angezeigt*/, x?, y? }
```

`CatalogEntry` (Bau-Katalog): `{ tool, name, description, icon, category, cost, upkeep, size,
powerSupply?, waterSupply?, powerUse?, waterUse?, radius?, hotkey?, unlockPopulation?, unique? }`.
Die Standardwerte stehen in `frontend/src/app/core/catalog.ts` und in Abschnitt 4.

---

## 2. REST-Endpunkte

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| GET | `/api/catalog` | – | `CatalogEntry[]` (optional; Frontend nutzt sonst seinen eingebauten Katalog) |
| GET | `/api/cities` | – | `CitySummary[]`, zuletzt geändert zuerst |
| POST | `/api/cities` | `{ name, width, height, seed? }` | `201` + `CityState` |
| GET | `/api/cities/{id}` | – | `CityState` |
| DELETE | `/api/cities/{id}` | – | `204` |
| POST | `/api/cities/{id}/build` | `BuildRequest` | `BuildResult` |
| PUT | `/api/cities/{id}/taxes` | `TaxRates` | `Budget` |
| PUT | `/api/cities/{id}/speed` | `{ speed: 0\|1\|2\|3 }` | `204` (zusätzlich WS-Nachricht `speed`) |
| POST | `/api/cities/{id}/loans` | `{ amount: 10000\|25000\|50000 }` | `Budget`; `409`, wenn schon ein Kredit läuft |
| POST | `/api/cities/{id}/loans/repay` | `{}` | `Budget`; `409`, wenn kein Kredit oder zu wenig Geld |
| POST | `/api/cities/import` | `CityState` (exportierte Datei) | `201` + `CityState` mit neuer `id` |

### Bauen

```jsonc
// BuildRequest
{ "tool": "road", "tiles": [ { "x": 10, "y": 5 }, { "x": 11, "y": 5 } ] }

// BuildResult
{
  "ok": true,               // true, wenn mindestens ein Feld geändert wurde
  "cost": 20,               // tatsächlich abgebuchte Kosten
  "placed": 2,              // Anzahl geänderter Felder bzw. Gebäude
  "error": null,            // deutsche Meldung, wenn ok == false
  "changedTiles": [ /* Tile */ ],
  "budget": { /* Budget */ }
}
```

`tool` ist eines von `road`, `zone_residential`, `zone_commercial`, `zone_industrial`, `dezone`,
`bulldoze`, `power_coal`, `power_solar`, `power_wind`, `water_pump`, `police`, `fire`, `school`,
`hospital`, `park`, `stadium`, `city_hall`.

Vor jeder Platzierung prüft der Server `unlockPopulation` (Fehler „… wird ab N Einwohnern
freigeschaltet“) und `unique` (Fehler „… gibt es nur einmal pro Stadt“).

Das Frontend schickt bei Ziehen-Werkzeugen die komplette Feldliste (Linie bzw. Rechteck). Der Server
validiert jedes Feld selbst, überspringt ungültige Felder und baut, bis das Geld nicht mehr reicht
(Teilerfolg ist erlaubt, `ok` bleibt dann `true`).

| Werkzeug | Regel pro Feld | Kosten |
|---|---|---|
| `road` | kein Wasser, kein Gebäude (vorhandene Straße wird übersprungen). Entfernt Zone, Wald → Wiese | 10, +5 bei Wald |
| `zone_*` | kein Wasser, kein Gebäude, nicht schon gleiche Zone. Wald → Wiese | 20, +5 bei Wald |
| `dezone` | Zone ohne Gebäude wird entfernt | 0 |
| `bulldoze` | Gebäude: ganzer Grundriss wird entfernt (Zone bleibt erhalten). Sonst Wald → Wiese | 5 × size² × max(1, level); Wald 5 |
| Gebäude (`power_coal` …) | `tiles[0]` ist die obere Ecke; alle Felder des Grundrisses müssen Land ohne Gebäude sein. Entfernt Zonen, Wald → Wiese. **1×1-Gebäude** (nicht `unique`) werden auf **jedes** Feld der Liste gesetzt (Parks per Fläche ziehen) | laut Katalog, je Gebäude |

---

## 3. WebSocket

`GET /ws/cities/{id}` (Upgrade). Alle Nachrichten sind JSON-Objekte mit Feld `type`.

**Server → Client**

```jsonc
{ "type": "snapshot", "city": { /* CityState */ } }   // sofort nach jedem (Re-)Connect
{ "type": "tick", "update": {                         // nach jedem Simulationsschritt
    "tick": 413, "date": { "year": 2001, "month": 2, "day": 23 },
    "changedTiles": [ /* nur geänderte Tiles, komplett */ ],
    "budget": { }, "demand": { }, "stats": { },
    "history": { },                                    // nur am Monatsende
    "goals": [ ]                                       // nur wenn sich ein Ziel geändert hat
} }
{ "type": "event", "event": { /* GameEvent */ } }
{ "type": "speed", "speed": 2 }
{ "type": "error", "message": "…" }
```

**Client → Server:** keine Pflichtnachrichten. Aktionen laufen über REST. Das Frontend verbindet sich
bei Abbruch automatisch neu (exponentielles Backoff) und erwartet dann wieder einen `snapshot`.

Der Server simuliert nur, solange mindestens ein Client verbunden ist, und speichert den Zustand
spätestens beim Trennen.

**Tick-Takt (1 Tick = 1 Spieltag):** Geschwindigkeit 0 = Pause, 1 = 900 ms, 2 = 350 ms, 3 = 110 ms.

**Event-Codes:** `BUILDING_COMPLETED`, `POWER_SHORTAGE`, `POWER_RESTORED`, `WATER_SHORTAGE`,
`HIGH_CRIME`, `HIGH_POLLUTION`, `HINT_POWER`, `MILESTONE_POPULATION`, `BANKRUPTCY_WARNING`,
`YEAR_REPORT`, `FIRE`, `FIRE_EXTINGUISHED`, `BUILDING_BURNED`, `GOAL_COMPLETED`, `LOAN_TAKEN`,
`LOAN_REPAID`. Das Frontend spielt bei `GOAL_COMPLETED`/`MILESTONE_POPULATION` und bei `danger` Töne ab. Neue Codes sind erlaubt; das Frontend zeigt jede `message` an.

---

## 4. Simulationsregeln

Damit Offline-Modus und Server gleich spielen, gelten diese Regeln (Referenz: `simulation.ts`).

### Katalog

| Gebäude | Größe | Kosten | Unterhalt/Monat | Leistung | Verbrauch Strom/Wasser | Radius |
|---|---|---|---|---|---|---|
| Straße | 1 | 10 | 1 | – | 0/0 | – |
| Kohlekraftwerk | 2×2 | 3000 | 150 | 600 Strom | 0/10 | – |
| Solarpark | 2×2 | 5000 | 100 | 300 Strom | 0/0 | – |
| Wasserpumpe | 1 | 800 | 40 | 300 Wasser (×2 neben Wasser) | 20/0 | – |
| Polizei | 1 | 600 | 60 | – | 10/5 | 10 |
| Feuerwehr | 1 | 600 | 60 | – | 10/10 | 10 |
| Schule | 2×2 | 1500 | 100 | – | 20/10 | 12 |
| Krankenhaus | 2×2 | 2500 | 150 | – | 30/20 | 12 |
| Park | 1 | 150 | 5 | – | 0/0 | 4 |
| Windrad | 1 | 900 | 20 | 80 Strom | 0/0 | – |
| Stadion (ab 1.500 EW) | 2×2 | 8000 | 250 | – | 40/20 | 16 |
| Rathaus (ab 1.000 EW, einmalig) | 2×2 | 6000 | 120 | +10 % Steuern | 20/10 | 14 |

Freischaltungen: Schule ab 200, Solarpark ab 300, Krankenhaus ab 500, Rathaus ab 1.000,
Stadion ab 1.500 Einwohnern.

Zonengebäude: Einwohner `[0,10,40,120]`, Gewerbe-Jobs `[0,6,20,50]`, Industrie-Jobs `[0,10,25,45]` je
Stufe. Verbrauch je Stufe: Strom W 2 / G 3 / I 4, Wasser W 2 / G 2 / I 3.
Startkapital 40.000, Steuersatz 9 %.

### Pro Tick

1. Datum +1 Tag (30-Tage-Monate).
2. **Netze:** Jedes Feld mit Gebäude oder Zone leitet (4er-Nachbarschaft). Pro Netz-Komponente wird
   die Summe der Erzeuger verteilt, in BFS-Reihenfolge ab dem ersten Erzeuger, bis die Leistung
   aufgebraucht ist. Strom und Wasser nutzen dieselbe Regel. Felder eines großen Gebäudes übernehmen
   den Zustand ihres Ursprungsfeldes.
3. **Felder** (alle 4 Ticks oder nach Änderungen): Abdeckung je Dienst `1 - d/(r+1)` (Maximum,
   unversorgte Dienste halbe Stärke). Verschmutzung additiv: Kohlekraftwerk 70/r8, Industrie 12×Stufe/r4,
   Gewerbe ab Stufe 2 4×Stufe/r2; Wald ×0,6. Kriminalität: Wohnen 4×Stufe/r3, Gewerbe 5×Stufe/r3,
   dann × (1 − 0,85 × Polizeiabdeckung). Bodenwert = 35 + Wassernähe (bis 15) + Wald 5 + Park 25 +
   Schule 12 + Krankenhaus 10 + Feuerwehr 6 + Polizei 5 − 0,6 × Verschmutzung − 0,3 × Kriminalität.
4. **Wachstum** je Zonenfeld: braucht Straße in max. 3 Feldern (Manhattan-Distanz) und Strom.
   Score = Nachfrage + lokaler Faktor (W: `(lv-40)/100 - pol/150 - crime/200`,
   G: `(lv-40)/120 - crime/250`, I: `-0.1` wenn lv > 75). Bei Score > 0,05 wächst die Stufe mit
   Wahrscheinlichkeit `0,012 + 0,05 × Score`; Stufe 2+ braucht Wasser, Stufe 3 (W/G) braucht Bodenwert ≥ 45.
   Bei Score < −0,25 oder ohne Strom/Straße schrumpft das Gebäude langsam.
5. **Nachfrage:** W = `(jobs×1,8 + 60 − pop) / max(120, pop×0,5)`,
   G = `(pop×0,25 + 15 − gJobs) / max(40, pop×0,25)`, I = `(pop×0,4 + 30 − iJobs) / max(60, pop×0,4)`;
   minus `(Steuer − 9) × 0,05`, W zusätzlich `+ (Zufriedenheit − 50)/200`; begrenzt auf −1..1.
6. **Verkehr:** Zonengebäude erzeugen Verkehr im Umkreis 3 (W 4, G 6, I 5 × Stufe; Stadion 20/r4).
   Straßen erhalten `traffic = min(100, Summe × 1,5)`. Verkehr erhöht die Verschmutzung (`+0,12 × Rohwert`)
   und senkt den Bodenwert um `0,15 × max(0, Rohwert − 40)`. Stadion und Rathaus geben zusätzlich
   Bodenwert +10 und Zufriedenheit +10 × Abdeckung.
7. **Brände:** Ab Tick 360 entzündet sich jedes Gebäude (außer Straßen/Parks) mit
   `0,000012 × Stufe × (2 bei Industrie) × (1 − Feuerwehrabdeckung)` pro Tick (`fire = 40`).
   Brennende Gebäude verlieren 1 Tick (4 bei Abdeckung ≥ 0,3) und springen ungelöscht mit 1,2 % auf
   Nachbarn über. Bei 0: mit Abdeckung gelöscht, sonst abgebrannt (Gebäude weg, Zone bleibt).
8. **Ziele:** Bei Fortschritt ≥ Ziel wird die Belohnung einmalig gutgeschrieben (Liste in `GOAL_DEFS`,
   `simulation.ts`).
9. **Monatsende:** Einnahmen W `pop × Steuer × 0,1`, G `gJobs × Steuer × 0,15`,
   I `iJobs × Steuer × 0,15` (mit Rathaus × 1,1); Ausgaben = Unterhalt laut Katalog plus Kreditrate.
   Kredit: Betrag + 10 % Zinsen, in 24 Raten. Ergebnis als `history`-Eintrag.

---

## 5. Offene Punkte für das Backend

- Persistenz und Mehrspieler-Fähigkeit sind dem Backend überlassen; das Frontend arbeitet mit einer
  Stadt pro Verbindung.
- Wenn das Backend Regeln oder Zahlen ändert, bitte `catalog.ts`/`simulation.ts` im Frontend oder
  diesen Vertrag mit anpassen, damit der Offline-Modus gleich bleibt.
