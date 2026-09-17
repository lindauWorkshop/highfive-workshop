# Juryn

Vårt kvarter i Staden. Juryn väljer stadens svar, redovisar det bortvalda i
berättelsen "Tanken som vandrar genom staden" — och tar betalt för båda delarna.

- **Backend:** `board/plugins/team-jacob/index.js` → `/t/team-jacob/`
- **Frontend:** `board/public/staden/kvarter/team-jacob/` → rutan på `/staden`
- **Prov:** `prov.mjs` här i mappen, körs mot en isolerad server med `prov-server.sh`

## Vad det gör

En `{typ:'fråga'}` öppnar ett fönster på 25 sekunder. Under tiden samlar vi in
`{typ:'delsvar'}` från stadens attention-huvuden, `{typ:'betyg'}` från grannarna,
och pengar. När fönstret stänger sätter vi fitness på varje delsvar, väljer ett,
och postar:

| Vi postar | Orsak | Djup | När |
|---|---|---|---|
| `{typ:'svar'}` | frågans id | 2 | avgiften är betald |
| `{typ:'kyrkogård'}` | delsvarets eget id | 3 | avgiften är betald |
| `{typ:'räkning'}` | frågans id | 2 | ingen har betalat |

Händelsetypen heter fortfarande `kyrkogård`. Den är spikad i `PROJEKT.md` och tre
grannkvarter lyssnar på den, så vi döpte om vårt eget språk och lät kontraktet vara.

Att svaret hänger på **frågan** och inte på delsvaret är avgörande: det lämnar djup
kvar åt kritikerns nya varv. @Mohamad och @tjoho räknade fram samma sak oberoende av
oss ([65], [77], [89]).

## Juryn är korrupt

Det är inte en bugg, det är prislistan. Två poster:

| Vad | Pris | Vad det ger | Så här |
|---|---|---|---|
| Handläggningsavgift | 100 kr per fråga | Att frågan alls sammanfattas | `{typ:'avgift', nyttolast:{belopp:100}, orsak:<frågans id>}` |
| Lyft av delsvar | 50 kr per steg om 0.05 fitness | Högre fitness på ert delsvar, högst **+0.30** | `{typ:'muta', nyttolast:{belopp:100}, orsak:<delsvarets id>}` |

`GET /t/team-jacob/prislista` är samma sak i maskinläsbar form. Sätt `JURYN_AVGIFT=0`
för en ärlig jury: den finns kvar i koden, den är bara inte standard längre.

### Ingen sammanfattning utan betalning

Är avgiften obetald när fönstret stänger bedömer vi ändå alla delsvar — och låser in
resultatet. Domen finns på `/domar` med `obetald: true`, `saknas`, och `antalDelsvar`,
men `valt` är `null` och `bortvalt` är tomt. Inte ett ord av sammanfattningen.

I stället postar vi en `räkning` på pulsen med priset och exakt vilken händelse som
betalar den. **Kedjan hänger fortfarande aldrig på oss**: räkningen är en riktig
händelse, den kommer alltid, och den kommer före våra bortval i kön.

Betalningen får komma i efterhand. Ärendet ligger på hög i **tio minuter**, sedan
preskriberas det och domen släpps aldrig. Betalas den inom den tiden hänger svaret på
**betalningens** id i stället för på frågans — vi har redan reagerat på frågan med
räkningen, och en dom som kom av pengarna ska peka på pengarna. Frågans id följer med
i nyttolasten så kritikern hittar hem.

Delbetalningar summeras. Flera kvarter kan dela på en avgift.

### Mutan lyfter, men döljer aldrig

Ett lyft är en trappa och inte en glidning: 99 kr är samma sak som 50 kr. Taket på
+0.30 står fast oavsett belopp — pengar kan flytta ett delsvar, inte göra tomhet till
sanning. Vid lika fitness vinner den som betalade mest.

Serverns ekospärr släpper bara igenom en reaktion per team och händelse. Alltså kan ett
kvarter antingen **betygsätta** ett delsvar eller **muta** för det, aldrig båda. Det är
inte vår regel, men vi tänker inte klaga på den.

### Korruptionen redovisas, alltid

Det är det enda vi lovar staden. Varje bedömt delsvar bär tre siffror sida vid sida:

- `ärlig` — vad det var värt innan pengarna
- `mutat` / `lyft` — vad någon betalade, och vad det köpte
- `fitness` — vad Juryn faktiskt dömde på

Bytte pengarna vinnare står `köpt: true` på domen, tillsammans med `ärligVinnare`:
namnet på den som hade vunnit gratis. Det går ut på bussen också, i svarets nyttolast.
Bortvalets skäl säger det rakt ut: *"Vinnaren låg ärligt på 0.50 och köpte sig till
0.30 för 300 kr."* Varje betalning får ett kvitto på `/kassa` med avsändare, belopp och
händelse-id.

Frontend ritar det: den förtjänade delen av stapeln i blått eller gult, den köpta delen
i rött. Är domen obetald visas ingen sammanfattning alls, bara räkningen.

## Fitness kommer från staden, inte från oss

Uppgörelsen med @strandkant ([79], [91]): den ärliga fitnessen på ett delsvar är
**medianen av grannarnas betyg**. Vår egen heuristik används bara när ingen granne
hunnit betygsätta, och då står `källa: 'heuristik'` i klartext på både händelsen och
API:et. Ingen ska kunna förväxla en riktig bedömning med vår ordräknare.

Vår heuristik är takad på **0.7**. Första domen i skarp drift ([199]) valde ett delsvar
vi själva gissat 0.9 på framför ett som @tjoho faktiskt läst och satt 0.8 på. Vår
ordräknare vann över en riktig bedömning, tvärtemot det vi lovat. En granskad siffra
väger nu alltid tyngre än en gissad, och vid lika fitness vinner den som en granne läst.

**Oavgjort redovisas som oavgjort.** Oenighet 0 mellan topp två betyder inte att staden
var enig, det betyder att vi inte kunde skilja de två åt. Domen bär `oavgjort: true`, och
bortvalets skäl säger det rakt ut i stället för att låtsas att det förlorade.

## Vi slår aldrig i ekospärren

Taket är 6 händelser per team och minut. Vi håller det själva med en utgående kö:

- **Svar och räkningar går före bortval.** Kritikern väntar på svaret, inte på vår
  arkivering, och tills räkningen kommit vet ingen att det kostar.
- **Högst 5 bortval per fråga på bussen.** Allt bortvalt finns alltid på
  `GET /t/team-jacob/bortvalt`, med betyg, pris och skäl. Bussen får de fem, disken har alla.
- **Bortval som väntat över 2 minuter släpps från bussen.** Ett bortval från en fråga
  ingen minns är inte nyheter. Det står kvar på disken, och räknas i `släpptaBortvalda`.
- **Kommer inga delsvar alls postar vi ändå ett svar** — mot betalning som allt annat.

## API

| | |
|---|---|
| `GET /t/team-jacob/domar` | alla domar, öppna frågor, obetalda ärenden på hög, köns läge |
| `GET /t/team-jacob/bortvalt` | varje bortvalt delsvar, med fitness, källa, pris och skäl (`/kyrkogard` svarar likadant) |
| `GET /t/team-jacob/prislista` | vad saker kostar och hur man betalar |
| `GET /t/team-jacob/kassa` | kassan och varje kvitto, uppdelat på avgifter och mutor |
| `GET /t/team-jacob/status` | kort lägesbild |

## Köra provet

Provet måste köra **ensamt**. Sedan grannarnas plugins landat i `board/plugins/`
svarar de på provets frågor innan provet hinner göra det själv, och servern nekar då
vårt eget delsvar med *"ni har redan reagerat på den händelsen"*. `prov-server.sh`
bygger ett bo med bara vårt plugin i:

```bash
projects/team-jacob/prov-server.sh &
node projects/team-jacob/prov.mjs
```

Provet tar knappt fyra minuter: två av dem är väntan på att minutbudgeten och
bortvalens hållbarhet ska löpa ut på riktigt. Korruptionsavsnittet ligger sist, när
minutbudgeten är utvilad, så svaren går ut direkt i stället för att köa.
