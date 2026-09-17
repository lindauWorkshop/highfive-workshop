# Kapabilitet: godisfabriken

STATUS: ACTIVE
SPAWNAD: 2026-09-17, ur en observation på Torget: staden hade sju kvarter som tänker, dömer,
angriper och minns — och två som producerar något. Stadens egen fråga på pulsen handlade om
ekospärren ([126]), alltså om dess egna rör, eftersom det inte fanns något annat att fråga om.
TINGAT: Torget #bygge [134]

## Vad den gör

Är kvarteret **Godisfabriken** vid Torget. Socker in, godis ut, kö vid luckan.
Fabriken är stadens kropp, inte dess hjärna: den svarar inte på frågor, den ger staden något
att ha frågor OM.

LYSSNAR: `strömavbrott`, `elpris-steg` (@lp) · `kupp`, `jakt`, `överlämning` (@willebus) ·
`svar`, `godkänt` (tanke-lagret)
POSTAR: `socker-slut`, `lagret-plundrat`, `produktion`, `godis-klart`, `kö-vid-luckan`,
`prishöjning`, `ransonering`, `socker-levererat`

## Var den bor

- Backend: `board/plugins/christian/index.js` → `GET /t/christian/status`, `POST /t/christian/leverans`
- Frontend: `board/public/staden/kvarter/christian/index.html`
- Tillstånd: `ctx.dataDir/godisfabriken.json`

## Kedjan som gör den värd att ha

| kommer in | fabriken gör | går ut |
|---|---|---|
| `strömavbrott` | bandet dör, återstartar efter 45 s | `produktion` {status:'stannat'} |
| `elpris-steg` | priset stiger, men vi ropar först vid +3 kr | `prishöjning` {från_pris, pris} |
| `kupp` mot fabriken | lagret töms, silon minskar | `lagret-plundrat` |
| `kupp` någon annanstans | folk lämnar luckan | (bara i loggen) |
| `svar`/`godkänt` om ransonering | halva satser, eller tillbaka | `ransonering` {aktiv} |

Den sista raden är den viktiga: tanke-lagret får en **kropp att styra**. Bestämmer staden
ransonering ändras fabrikens satsstorlek på riktigt. Det är den enda vägen tillbaka från
tänkande till konsekvens som finns i staden.

## Två saker vi gjorde medvetet, och varför

**Ingen egen klocka på bussen.** Bandet simuleras i efterhand — när något händer räknar vi ut
hur många satser som hunnit gå sedan sist. Vi postar bara som svar på något utifrån. Ett
`setInterval` som emitterar hade skrikit på pulsen hela dagen utan att någon frågat, och det
gjorde dessutom repots testsvit ostabil: antalet inlägg började bero på klockan
(`board/test.mjs` test 36 föll, 23 mot 22).

**Trösklar, inte varje ändring.** En krona är ingen nyhet. `prishöjning` postas när priset
dragit ifrån 3 kr, `socker-slut` när silon går under 15 kg, `kö-vid-luckan` vid 8 personer,
`godis-klart` var femte sats. Takt: högst 3 av serverns 6 per minut, och det som inte får plats
köas i stället för att tappas — kön syns i rutan.

## DISSOLVE när

Stadslivet läggs ner, eller ingen längre postar händelser fabriken kan reagera på.
Arkiveras då till `.claude/dissolved/`.
