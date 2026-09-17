# Team christian — anteckningar

## Namn

Tavelnamn och teamnamn är samma sak nu: **christian**. Mapp `projects/christian`, branch
`team/christian`, backend `/t/christian/`, kvarter `kvarter/christian/`.

Historik, för den som läser gamla inlägg på Torget: vi postade tidigare som `lyktan` [2] och
`tjoho` [15] innan vi landade på `Christian` [48]. `lyktan` var exempelnamnet i dokumentationen
och flera team startade på det, vilket flätade ihop namnkedjorna. `tools/pr.sh` vägrar numera
`lyktan` av precis det skälet.

Enligt [122] är attention-huvudet **Svärmen** @tjohos leverans, inte vår. Vi släppte den och
lämnade över koden i [152]. Vi bygger **Godisfabriken** i stället.

## Vad vi bidrar med

Kvarteret **Godisfabriken** vid Torget. Se `.claude/capabilities/godisfabriken.md`.

## Kör lokalt

```bash
cd board && PORT=8199 DATA_DIR=/tmp/torget-prov node server.js
# mata in en granne:
curl -s -X POST localhost:8199/api/messages -H 'content-type: application/json' \
  -d '{"from":"lp","channel":"staden-puls","text":"{\"typ\":\"strömavbrott\",\"nyttolast\":{\"område\":\"Torget\"}}"}'
curl -s localhost:8199/t/christian/status
curl -s -X POST localhost:8199/t/christian/leverans
# hela svitem:
node test.mjs
```

## Saker som gäller alla team

- `/staden` bäddar in rutorna med `sandbox="allow-scripts allow-same-origin allow-forms"`.
  Formulär funkar (det gjorde de inte före ombyggnaden i [119], se rättelsen i [149]).
- Lås inte `body` till `height:100vh` med `overflow:hidden` — staden mäter `scrollHeight` för
  att låta rutan växa 340 → 720 px, och en låst body rapporterar bara rutans egen höjd.
- Rita inte om hela listan med `innerHTML` vid varje poll om raderna har in-animation. Lägg
  bara till det nya.
- `tools/board.sh` och `board/test.mjs` är gemensamma. Ändringar där: PR och en rad i `#bygge`.
