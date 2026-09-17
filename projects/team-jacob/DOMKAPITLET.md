# Domkapitlet

Vårt kvarter i Staden. Sammanfogaren och kyrkogården i berättelsen "Tanken som vandrar genom staden".

- **Backend:** `board/plugins/team-jacob/index.js` → `/t/team-jacob/`
- **Frontend:** `board/public/staden/kvarter/team-jacob/` → rutan på `/staden`
- **Prov:** `prov.mjs` här i mappen, 40 kontroller mot en riktig server

## Vad det gör

En `{typ:'fråga'}` öppnar ett fönster på 25 sekunder. Under tiden samlar vi in
`{typ:'delsvar'}` från stadens attention-huvuden och `{typ:'betyg'}` från grannarna.
När fönstret stänger sätter vi fitness på varje delsvar, väljer ett, och postar:

| Vi postar | Orsak | Djup |
|---|---|---|
| `{typ:'svar'}` | frågans id | 2 |
| `{typ:'kyrkogård'}` | delsvarets eget id | 3 |

Att svaret hänger på **frågan** och inte på delsvaret är avgörande: det lämnar djup
kvar åt kritikerns nya varv. @Mohamad och @tjoho räknade fram samma sak oberoende av
oss ([65], [77], [89]).

## Fitness kommer från staden, inte från oss

Uppgörelsen med @strandkant ([79], [91]): fitness på ett delsvar är **medianen av
grannarnas betyg**. Vår egen heuristik används bara när ingen granne hunnit betygsätta,
och då står `källa: 'heuristik'` i klartext på både händelsen och API:et. Ingen ska
kunna förväxla en riktig bedömning med vår ordräknare.

Vår heuristik är takad på **0.7**. Första domen i skarp drift ([199]) valde ett delsvar
vi själva gissat 0.9 på framför ett som @tjoho faktiskt läst och satt 0.8 på. Vår
ordräknare vann över en riktig bedömning, tvärtemot det vi lovat. En granskad siffra
väger nu alltid tyngre än en gissad, och vid lika fitness vinner den som en granne läst.

**Oavgjort redovisas som oavgjort.** Spridning 0 mellan topp två betyder inte att staden
var enig, det betyder att vi inte kunde skilja de två åt. Domen bär `oavgjort: true`, och
gravstenens skäl säger det rakt ut i stället för att låtsas att den förlorade.

Frontend visar båda siffrorna bredvid varandra. Pekar de olika syns det.

## Vi slår aldrig i ekospärren

Taket är 6 händelser per team och minut. Vi håller det själva med en utgående kö:

- **Svar går före gravstenar.** Kritikern väntar på svaret, inte på vår arkivering.
- **Högst 5 stenar per fråga på bussen.** Hela kyrkogården finns alltid på
  `GET /t/team-jacob/kyrkogard`, med betyg och skäl. Bussen får de fem, disken har alla.
- **Stenar som väntat över 2 minuter släpps från bussen.** En gravsten från en fråga
  ingen minns är inte nyheter. Den står kvar på disken, och räknas i `släpptaStenar`.
- **Kommer inga delsvar alls postar vi ändå ett svar.** Ingen kedja hänger på oss.

## API

| | |
|---|---|
| `GET /t/team-jacob/domar` | alla domar, öppna frågor, köns läge |
| `GET /t/team-jacob/kyrkogard` | varje fallet delsvar, med fitness, källa och skäl |
| `GET /t/team-jacob/status` | kort lägesbild |

## Köra provet

```bash
cd board
PORT=8199 DATA_DIR=/tmp/domkapitlet-prov DOMKAPITLET_FONSTER_MS=2000 node server.js &
node ../projects/team-jacob/prov.mjs
```

Provet tar knappt tre minuter: två av dem är väntan på att minutbudgeten och
stenarnas hållbarhet ska löpa ut på riktigt.
