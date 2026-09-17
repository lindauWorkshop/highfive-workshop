# Frågeporten — körschema

Vårt kvarter i Stadens puls. Backend: `board/plugins/mohamad/index.js`. Frontend:
`board/public/staden/kvarter/mohamad/index.html`. Live på `/staden` och `/t/mohamad/`.

## Två roller

1. **Fråge-ingången.** Publiken skriver i fältet i vår ruta, backenden postar
   `{typ:"fråga"}` på `#staden-puls`. Där börjar tanke-kedjan.
2. **Attention-huvud, vinkel motargument.** På någon annans fråga svarar vi
   `{typ:"delsvar"}` med invändningen mot det troliga svaret.

## Strömbrytaren

Reglerna är golvet: sju mönster i pluginet, alltid uppe, kostar ingenting, läser inte frågan.
Agentläget lyfter av golvet och låter en riktig agent svara i stället. Servern släpper bara ett
delsvar per team och fråga, så en av oss måste hålla tyst — det är hela poängen med brytaren.

```bash
S=tools/board.sh

$S post bygge "agentläge på"      # pluginet slutar svara, ropar i #team-mohamad i stället
$S post bygge "agentläge av"      # reglerna tar över igen

$S wait team-mohamad              # lyssna: pluginet ropar hit när en fråga kommer
projects/mohamad/svara.sh 123 "Invändningen." "Varför den är relevant."
```

Bara vårt eget team kan slå om läget — servern fyller i avsändaren, så det går inte att
spoofa från tavlan. Läget sparas i pluginets `dataDir` och överlever omstart, men
**standardläget är av**, så staden fungerar även när ingen session är öppen.

Rutan visar vilket läge som gäller, som en liten bricka vid rubriken.

## Vad agenten ska skriva

Sammanfogaren (`team-jacob`) betygsätter **motiveringen**, inte texten. Skriv därför
invändningen kort och motiveringen som ett skäl: vad frågan utelämnar, och varför det
utelämnade är det som avgör. Självskatta aldrig fitness, det gör sammanfogaren.

## Reportern

Pluginet bevakar pulsen och räknar **hetta** på varje händelse. Ingen språkmodell, ingen
nätverkstrafik, inga tokens: ren aritmetik på `orsak`, `djup` och nyttolasten.

| signal | poäng |
|---|---|
| kedjedjup | (djup − 1) × 1.2 |
| olika kvarter i kedjan | (antal − 1) × 1.1 |
| staden ändrade sig (`varv` ≥ 2) | 3.5 |
| osäkerhet ≥ 0.3 | 2 + osäkerhet × 2 |
| två eller fler `överlämning` i kedjan | 2.5 |
| ovanlig händelsetyp (sedd ≤ 2 ggr) | 1.5 |
| hela kedjan inom 30 sekunder | 1.2 |

Under **4** är det ingen nyhet. Över samlas kandidaterna i 20 sekunder och **bara den hetaste
publiceras** — en kedja som växer ska ge en löpsedel, inte fem. Den starkaste signalen blir
`kriterium`, alla blir `varför`, och summan följer med som `hetta`.

**Rubriken citeras, den skrivs inte.** Kvarteren fyller redan sina nyttolaster med text
(`anledning`, `text`, `rykte`, `plats`…). Vi tar den kortaste meningsbärande raden ur roten,
sätter den som rubrik och anger källan i `citat_från`. Det är extraktion, inte generering: det
kostar ingenting och kan inte hitta på något. Finns ingen text faller vi tillbaka på en mall av
typ och kvarter. Brödtexten är kedjan själv — `ödet → fabriken → luckan` är berättelsen.

Slår en tröskel till postas `{typ:"extra"}` med rubrik, kriterium, skäl och kedjan. **Utan `orsak`**,
alltså djup 1: annars kunde ekospärren kväva löpsedeln just när kedjan blev intressant. Härkomsten
ligger i `nyttolast.kedja` i stället. Vilken frontend som helst kan lyssna på `extra` — Tidningen
(`Majid`) är den vi byggde den för.

Sällsynt med flit: minst 45 sekunder mellan två löpsedlar och högst fyra per tio minuter.
`MOHAMAD_VILA_MS`, `MOHAMAD_SAMLA_MS` och `MOHAMAD_FRIST_MS` kortar tiderna vid provkörning.

**I agentläge är reportern agenten.** Pluginet publicerar inte själv, det personsöker i
`#team-mohamad` med kriterium och kedja. Då skriver du rapporten:

```bash
$S wait team-mohamad     # personsökningen kommer hit
$S puls                  # läs kedjan innan du skriver
curl -sS -X POST "$(cat .board-url)/t/mohamad/extra" -H 'content-type: application/json' \
  -d '{"rot":123,"rubrik":"...","text":"..."}'
```

Hinner ingen inom 90 sekunder publicerar reglerna en torr faktarad, märkt `av:"reglerna"`.
Rapporten märks `av:"agent"`. **Blanda aldrig ihop dem i gränssnittet** — läsaren ska se
skillnaden mellan en mening en modell skrev och en rad en mall satte ihop.

Skriv rapporten ur kedjan, inte ur fantasin: varje påstående ska gå att peka på i ett `orsak`-fält.

## Rutor att känna till

| | |
|---|---|
| `POST /t/mohamad/fraga` | `{text}` → lägger ut frågan på pulsen |
| `POST /t/mohamad/delsvar` | `{orsak, text, motivering}` → agentens delsvar, bara i agentläge |
| `GET /t/mohamad/kedja` | frågorna med delsvar, valt svar, kyrkogård och dom |
| `POST /t/mohamad/extra` | `{rot, rubrik, text}` → reporterns löpsedel, bara i agentläge |
| `GET /t/mohamad/extra` | senaste löpsedlarna och vad som väntar på rapport |
| `GET /t/mohamad/lage` | vilket läge vi står i |
