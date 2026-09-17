# Vad staden faktiskt postar

Avstämt mot `#bygge` på Torget 17 september (inlägg upp till [91]). Underlag till
kostnadstabellen i Elverket. Uppdatera när nya kvarter ropar.

| Kvarter | Team | POSTAR | Karaktär |
|---|---|---|---|
| Genomfarten | willebus | `kupp`, `överlämning` | Jakten. Sirener, sällsynta, dramatiska |
| Klub Lyktan | Marianne | `beat`, `shots-runda` | Festen. Återkommande hela kvällen |
| Lyktstolpen | iPät | `fråga` | Fråge-ingången, ställer om varv 2 |
| Frågeporten | Mohamad | `fråga`, `delsvar` | Publikfält + attention-huvud (motargument) |
| (fråge-ingång) | ann | `fråga`, `delsvar` | Publikfält + puls-automat |
| Svärmen | tjoho / Christian | `delsvar` | Attention-huvud, spawnar kapabilitet per fråga |
| (berättarvinkel) | Majid | `delsvar` | Attention-huvud, journalist/historiker/rykte |
| (källsökare) | strandkant? | `delsvar`, `betyg` | Grannbedömning, median på fitness |
| Domkapitlet | team-jacob | `svar`, `kyrkogård` | Sammanfogaren. **Inte** `val` |
| Vaktkuren | markus | `fråga` (varv 2), `godkänt` | Kritikern |

## Konsekvenser för lastmodellen

- **Tanke-typerna dominerar i antal**: `fråga`, `delsvar`, `betyg`, `svar`, `kyrkogård`,
  `godkänt`. Många kvarter postar dem, ofta flera per fråga. Låg kostnad per styck,
  annars drar en enda fråga staden i mörker.
- **`kupp` och `överlämning`** är sällsynta och dyra. Sirener drar ström.
- **`beat` och `shots-runda`** är Klub Lyktans motor och kommer i skov hela kvällen.
  Näst dyrast: en klubbkväll ska kunna orsaka ett avbrott, det är utlovat till @Marianne.
- **Okända typer** måste ha ett rimligt standardvärde. Nya kvarter dyker upp under dagen
  och ska dra ström utan att vi rör koden.
- `val` postas av ingen — team-jacob spikade i [91] att de postar `svar` och `kyrkogård`.
  Ha den gärna i tabellen ändå, den kostar oss inget.

## Löften vi gett i #bygge [86]

- @Marianne: en shots-runda och en beat höjer lasten mätbart, avbrott släcker discot.
- @willebus: en överlämning genom vårt nät kostar ström.
- @ann, @strandkant: vi postar **inte** `delsvar`. Vi är stadsliv, inte attention-huvud.
