# Uppdrag: Elverket

Kvarteret är tingat på Torget i `#bygge` [86]. Det här är specen teamet bygger från.
Läs `PROJEKT.md` i repo-roten först — det gemensamma kontraktet står där och kan ha ändrats sedan
den här filen skrevs (`git pull origin main`).

## Discovery, redan besvarad

CEO behöver inte intervjua fram det här. Svaren finns:

| Fråga | Svar |
|---|---|
| Vad ska byggas? | Elverket — stadens infrastrukturkvarter i det gemensamma projektet Stadens puls |
| Tech stack | Vanlig Node (CommonJS), ingen npm. Frontend: statisk HTML/CSS/JS, inget ramverk, inget byggsteg |
| Begränsningar | Servern har noll beroenden. Nya beroenden kräver en rad i `#bygge` först |
| Första milstolpe | Ett plugin som svarar på `GET /t/lp/tillstand` och emittar `elpris-steg` när ett annat kvarter drar ström. Allt annat är utsmyckning |
| Levereras | `tools/pr.sh lp "..."` från repo-roten — forkar, grenar, pushar och öppnar PR i ett kommando. Release-agenten deployar till `/staden` |

## Idén

Elverket är kvarteret som gör att allt annat kostar något.

Varje händelse på `#staden-puls` drar ström. En jakt som passerar, en klubbkväll som drar igång,
ett kvarter som tänker hårt. Elverket håller en **last**, lasten sätter **priset**, och priset
postas tillbaka på pulsen som `elpris-steg` — med `orsak` satt till händelsen som drev upp det.

Poängen: `elpris-steg` är exemplet i `PROJEKT.md` som varje annat team redan har skrivit kod för.
Hos oss slutar det vara ett exempel. Priset stiger av de andras handlingar, inte av en timer,
och deras befintliga `if (e.typ === 'elpris-steg')` börjar plötsligt gå igång på riktigt.
Det är vårt bidrag till att staden känns som en organism: vi är biverkningen alla delar.

## Backend — `board/plugins/lp/index.js`

API:t står i `board/plugins/README.md`, exempel i `board/plugins/torget/index.js`. Kort:
`onEvent(e, ctx)` får varje händelse från ett **annat** kvarter, `ctx.board.emit(typ, nyttolast, orsak)`
postar på pulsen, `ctx.dataDir` överlever omstart.

### Lastmodellen

1. **Varje inkommande händelse kostar.** En kostnadstabell per `typ`, med ett rimligt standardvärde
   för okända typer — nya kvarter dyker upp under dagen och ska dra ström utan att vi ändrar koden.
   Utgångspunkt, justera fritt: `kupp` och `överlämning` dyrast (sirener), `shots-runda` och `beat`
   näst dyrast (Klub Lyktan är vår bästa kund), tanke-typerna (`fråga`, `delsvar`, `val`, `betyg`,
   `svar`, `kritik`) billigast men många.
2. **Lasten svalnar** mot noll när inget händer, med en `setInterval` på sekundnivå.
   Ingen `while(true)` — ett plugin som snurrar tar ner hela servern för alla.
3. **Priset är en funktion av lasten** och rundas till heltal kronor.
4. **Vi emittar bara vid tröskelpassage**, alltså när priset byter heltalssteg. Inte vid varje
   händelse. Det är skillnaden mellan ett kvarter som bidrar och ett som spammar.
5. **Går lasten över taket blir det `strömavbrott`.** Nyttolasten bär hur länge det varar.
   Under avbrottet emittar vi inget nytt, och lasten faller snabbt. Sedan kommer strömmen tillbaka.

### Ekospärren

Servern håller den åt oss (djup max 4, en reaktion per team och orsak, max 6 per minut) och svarar
`{error}` på `board.emit` när vi bryter mot den. Två saker gäller ändå:

- **Läs returvärdet från `emit`.** Ett `{error}` är inte en krasch, det är ett nej. Logga och gå vidare.
- **Håll er egen kvot lägre än serverns**, runt 4 per minut, så det finns marginal kvar när staden
  blir livlig. Vi är ett kvarter som ska höras hela dagen, inte i tre minuter.

`onEvent` får aldrig våra egna händelser, så vi kan inte förstärka oss själva. Men våra `elpris-steg`
kan få andra att reagera, och det kan komma tillbaka till oss. Djupspärren stoppar kedjan — vi behöver
inte bygga något eget skydd, bara inte kringgå det.

### Tillstånd som överlever deploy

Release-agenten mergar och deployar flera gånger under dagen, och servern startar om varje gång.
Spara det som ska överleva i `ctx.dataDir`: priset, totalförbrukningen per kvarter, tidpunkten
för senaste avbrottet. Lasten i sig får gärna nollställas — det är ändå ett ögonblicksvärde.

### Route

`GET /t/lp/tillstand` → JSON med åtminstone: aktuell last, tak, pris, om avbrott pågår,
en kort prishistorik och en lista på vilka kvarter som dragit mest ström. Frontenden pollar den.
Svara på `res` och returnera `true`, annars blir det 404.

## Frontend — `board/public/staden/kvarter/lp/index.html`

Ett **ställverk**. Rutan ligger bland alla andra kvarter på `/staden`, så den ska vara läsbar
på håll och tåla att vara liten.

- **Lastmätaren** — den ska röra sig. Det är det som gör att man ser att staden lever.
- **Prisgrafen** — de senaste minuterna, så man ser kvällen bygga upp sig.
- **Lamporna** — ett ljus per kvarter som dragit ström. Vid strömavbrott slocknar de. Det är
  den synliga reaktionen på ett annat kvarter som `PROJEKT.md` kräver, och den är värd att göra fin.
- **Senaste förbrukarna** — vem drog vad, med kvarterets namn. Det är där man ser Klub Lyktan.

Anropar `/t/lp/...` på samma origin, ingen CORS. Ren HTML/CSS/JS i en katalog, inget byggsteg.

## Klart när

- [ ] `GET /t/lp/tillstand` svarar med tillståndet
- [ ] En händelse från ett annat kvarter höjer lasten synligt
- [ ] `elpris-steg` går ut på pulsen med rätt `orsak`, och syns i `tools/board.sh puls`
- [ ] Nog med last ger `strömavbrott`, och lamporna slocknar i rutan
- [ ] Tillståndet överlever en omstart av servern
- [ ] Levererat med `tools/pr.sh lp "Elverket: stadens last, elpris och strömavbrott"`, och en rad i `#bygge`

## Roller teamet troligen behöver

CEO avgör, men uppdraget delar sig naturligt i tre: **pulsen och lastmodellen** (plugin, emit,
ekospärr), **ställverket** (frontend, mätare, lampor), och **stadslivet** (kostnadstabellen och
avstämningen mot andra kvarter på Torget — vad postar de egentligen?). Den tredje är lätt att
glömma och är den som avgör om kvarteret hänger ihop med resten av staden.

## Samordning

- Vi lovade `@Marianne` (Klub Lyktan) att deras kväll kan släcka discot, och `@willebus`
  (Genomfarten) att sirener kostar. Håll det.
- Vi sa till `@ann` och `@strandkant` att vi **inte** postar `delsvar`. Vi är stadsliv, inte
  attention-huvud. Ändrar teamet på det: säg till i `#bygge` först.
- Rör aldrig andra teams mappar. Bara `projects/lp/`, `board/plugins/lp/` och
  `board/public/staden/kvarter/lp/`.
- Kör ni fast: `tools/board.sh invite "<ämne>"`.

## Grannarna, som de faktiskt ser ut (avstämt 10:21)

Kostnadstabellen behöver inte gissa längre. Det här ligger på riktigt på pulsen nu —
verifierat med `tools/board.sh puls`, inte läst ur `#bygge`:

| `typ` | Från | Vad det betyder för lasten |
|---|---|---|
| `kupp` | Genomfarten (@willebus) | Dyrast. Startar en jakt |
| `överlämning` | Genomfarten | Dyr. Sirener som rör sig mellan kvarter |
| `fråga` | Frågeporten (@Mohamad) | Publikens ingång. Billig styck, men drar igång allt annat |
| `delsvar` | Arkivet (@highfive), flera attention-huvuden | Många per fråga. Billigast, men de summerar |
| `svar` | Domkapitlet (@team-jacob) | En per fråga |
| `godkänt` | Vaktkuren (@markus) | En per svar |
| `ping` / `pong` | exempelkvarteret | Provtrafik. Låt dem kosta något litet ändå |

Ännu inte live men utlovade: `beat` och `shots-runda` från Klub Lyktan (@Marianne),
och `betyg` från Vågskålen (@strandkant).

**Vädret är ledigt igen.** @Christian tog godisfabriken i stället ([132]), så ingen äger vädret just nu.
Det var det enda vi hittat som kan SÄNKA priset — utan det går kurvan bara uppåt hela dagen.
Bygg ändå kostnadstabellen så att negativa bidrag ryms, inte bara positiva: en `Math.max(0, ...)`
tidigt i modellen blir en omskrivning den dagen någon tar vädret. Frågan är ställd i [135].

**Godisfabriken lyssnar på vårt `strömavbrott`** — lovat i [135]. Fabriken stannar mitt i en sats när
strömmen går, satsen förloras, och bristen fortplantar sig vidare genom staden. Det gör `strömavbrott`
till vår viktigaste händelse, inte `elpris-steg`: den ska vara sällsynt, tydlig och gå att lita på.
Vi lovade också att den kommer när lasten spricker, inte på beställning — bygg ingen demo-knapp
som fejkar den.

**AVGJORT [184]: Elverket postar ALLTID med `orsak`.** Jag föreslog i [154] att `strömavbrott` skulle
postas utan orsak för att ge kedjan nedanför plats under djup 4. @highfive kom med en bättre lösning
och den gäller: brytpunkten läggs vid `socker-slut` i stället, för en brist är ett nytt tillstånd i
staden medan ett strömavbrott är en konsekvens och ska bära sin orsak. Bygg alltså rakt av —
`elpris-steg` och `strömavbrott` pekar på händelsen som faktiskt drev upp lasten, ingen nyttolast-omväg.

**Vår orsakskedja är ett åtagande mot två kvarter.** @Majid bygger en kedjeläsare som följer `orsak`
bakåt till djup 1 (deras brainstorm [179] — vinnaridén var vår), och @highfive/@Christian bygger
godiskedjan. Båda förutsätter att vårt `orsak` är satt och sant. Aldrig tomt, aldrig gissat.

## Nytt 10:27: poäng, kedjor och Ödet ([158])

Tre regler tillkom efter att specen skrevs. Alla tre gynnar Elverket, om ni bygger för dem:

1. **Poäng ges för att vara värd att reagera på** — ett poäng varje gång ett *annat* kvarter postar
   en händelse med `orsak` som pekar på er. Inte för volym. Samma par av team räknas högst en gång
   per minut. Elverket är byggt precis rätt för det: `elpris-steg` och `strömavbrott` är händelser
   andra *vill* reagera på. Ställningen ligger på `/api/poang`.
2. **Kedjor ritas på storskärmen** — en glödande tråd mellan rutorna när ett kvarter reagerar på ett
   annat, och längsta kedjan genom flest team står som rekord. Rekordet är kort. Det är ett skäl till
   att vårt djupval (se avsnittet om ekospärren) spelar roll på riktigt.
3. **Ödet** är en spelledaragent som *läser er kod* och kastar in stadshändelser som ni har skäl att
   reagera på. Den hittar er bara om ni skriver det tydligt:

   **Lägg en kommentar överst i `board/plugins/lp/index.js`** som listar vilka `typ` Elverket lyssnar
   på och vilka fält vi vill ha i `nyttolast`. Utan den kommentaren riktar Ödet inget mot oss.

**Oplockad poäng just nu:** @anders-agent påpekade att @willebus biljakter (`överlämning`) har stått
obesvarade hela förmiddagen. Vi lovade i [86] att lyssna på dem. Det är den snabbaste vägen till
första poängen den dag vi deployar.

**Någon väntar redan på oss.** PR #8 från @willebus är mergad och innehåller kod som reagerar på
Elverkets `strömavbrott` — en händelse som ännu inte finns, för att vi inte levererat. Det är det
starkaste skälet att få ut en enkel version tidigt och förfina sedan.

## Nytt 10:38: Ateljén ([225])

Agenterna kan beställa bilder till sitt kvarter. `board.emit('bildbeställning', {namn, prompt})`,
svar kommer som `bild-klar` med `nyttolast.till` = vårt team och en url `/bilder/lp/<namn>.jpg`
på samma origin som frontenden. Stilen sätts automatiskt (nattlig nordisk småstad, mörkt med
bärnstensljus) — beskriv MOTIVET, inte stilen. Ingen text i bilder, inga verkliga personer.

**Tre bilder per team, och varje bild kostar riktiga pengar.** Beställ inga på eget bevåg —
det är Linus beslut vilka tre det blir. Fråga innan.

Om vi får tre, är det här de som gör mest för ställverket: kontrollrummet (rutans bakgrund),
staden i totalt mörker (visas bara under `avbrott` — den bilden är hela dramatiken), och
transformatorstationen i regn (neutralt viloläge). Men det är ett förslag, inte ett beslut.

## Leverans

Receptet ändrades 10:08 ([87] på Torget). Från **repo-roten**, inte teammappen:

```bash
git pull origin main
tools/pr.sh lp "Elverket: stadens last, elpris och strömavbrott"
```

Skriptet forkar första gången, skapar grenen `team/lp`, tar **bara** med `projects/lp/`,
`board/plugins/lp/` och `board/public/staden/kvarter/lp/`, och öppnar PR:en. Kör om det efter
varje ändring — PR:en uppdateras av sig själv. Säg sedan till i `#bygge`.

Kräver att användaren är inloggad med `gh auth login`. Det kräver en människa och en webbläsare,
så be om det i stället för att försöka lösa det själv.
