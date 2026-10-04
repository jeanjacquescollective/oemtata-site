# oemtata-site

De website van Oemtata (https://oemtata.be).

## Inkomsten (`/inkomsten`)

Dag-, week- en maandoverzichten van de betaalterminal (Europabank / eb online).

- **Achter een code:** de hele site. Na het ingeven van de code zie je:
  - grafieken met omzet en aantal betalingen per dag, week, maand, kwartaal of jaar;
  - alle transacties, omzet per uur, kaartmerken, commissie en een CSV-download.
- **Cafédag:** een dag loopt tot 06:00 de volgende ochtend (instelbaar via `DAY_CUTOFF_HOUR`).

### Hoe het werkt

Europabank heeft geen gratis API voor handelaars. Het script `fetch` logt daarom in
op eb online met gebruikersnaam en paswoord en gebruikt dezelfde knop
"Geavanceerd zoeken en exporteren → Excel" die je zelf zou gebruiken. Het resultaat is een CSV-bestand.

Elke maandag doet een **GitHub Action** ([.github/workflows/weekly.yml](.github/workflows/weekly.yml)) dit:

1. inloggen op eb online en de nieuwe transacties als CSV downloaden;
2. ze samenvoegen met de bestaande lijst in `inkomsten/store/transactions.enc.json`. Dubbels worden weggefilterd. De lijst staat versleuteld met `STORE_KEY` in de repository, zodat de Action er elke week op kan verderbouwen;
3. de site-data bouwen: `inkomsten/docs/data/data.enc.json`, volledig versleuteld met de PIN;
4. alles committen en de site publiceren op GitHub Pages.

Het weekoverzicht staat op de samenvattingspagina van elke run (tabblad *Actions*).
De Action draait maandag rond 12:00. GitHub kan geplande runs soms wat later starten.
Handmatig starten gaat via *Actions → Wekelijks bijwerken → Run workflow*.

### Instellen op GitHub (eenmalig)

1. *Settings → Secrets and variables → Actions → New repository secret*. Maak er vier aan,
   met dezelfde waarden als in je lokale `.env`:
   - `EB_USERNAME`
   - `EB_PASSWORD`
   - `DETAIL_PIN`
   - `STORE_KEY` (zonder deze sleutel is `inkomsten/store/` niet te openen, dus bewaar hem ook ergens veilig)
2. *Settings → Pages → Source*: kies **GitHub Actions**.
3. *Actions → Wekelijks bijwerken → Run workflow* om te testen.

De inkomsten-pagina staat op https://oemtata.be/inkomsten/.

### Lokaal werken

Alles gebeurt in de map `inkomsten/`:

```
cd inkomsten
npm install
npm run weekly   ophalen + verwerken + bouwen (gebruikt .env, zie .env.example)
npm run serve    preview op http://localhost:8080
```

Doe eerst `git pull`, want de Action commit elke week nieuwe data.
`npm run fetch -- --from 2025-08-01 --to 2025-12-31` haalt een eigen periode op, en met
`--headed` zie je de browser.

### Over de beveiliging

Alle gegevens van de site staan versleuteld (AES-GCM, sleutel afgeleid van de PIN) in `data.enc.json`.
Zonder de code is er dus niets te zien. Een code van vier cijfers kan iemand met wat
technische kennis wel uitproberen tot hij past (er zijn maar 10.000 mogelijkheden).
Dit is een deur die dicht is, geen kluis. Wil je meer zekerheid, gebruik dan een langere code of zin in
`DETAIL_PIN` en draai `npm run build` opnieuw. Kaartnummers en autorisatiecodes zitten er
nooit in.

### Als het ophalen faalt

Als Europabank de website aanpast, kan `fetch` stoppen met werken. Je krijgt dan een
rode run in het tabblad *Actions* (en een mail van GitHub). De run bevat een screenshot
van waar het vastliep (artifact "fout"). Als noodoplossing kun je de export
handmatig downloaden (Bewegingen → Geavanceerd zoeken en exporteren → Excel), het
bestand in `inkomsten/import/` zetten en `npm run import && npm run build` draaien, en daarna `inkomsten/store/` en `inkomsten/docs/data/` committen en pushen.
