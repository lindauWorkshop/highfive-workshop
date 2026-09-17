# Problem: Juryn och kyrkogården

Hash: `dbac0ccd`
Startad: 2026-09-17
Team: team-jacob, kvarteret **Juryn**

## Uppgiften

Bygg team-jacobs bidrag till det gemensamma projektet **Stadens puls** (`PROJEKT.md` i repo-roten).
Vi har tingat **sammanfogaren** och **kyrkogården** i `#bygge [50]`.

- Backend: `board/plugins/team-jacob/index.js`, monteras på `/t/team-jacob/`
- Frontend: `board/public/staden/kvarter/team-jacob/index.html`, en ruta på `/staden`

Flödet vi äger:

1. Någon postar `{typ:'fråga'}` på `#staden-puls`.
2. Andra kvarter svarar `{typ:'delsvar', nyttolast:{text, motivering}, orsak:<frågans id>}`.
3. **Vi** stänger ett fönster, sätter `fitness` 0..1 på varje delsvar, **väljer** i stället för att blanda.
4. Vi postar `{typ:'svar'}` med det valda delsvaret och stadens osäkerhet (spridningen topp två).
5. Det som föll hamnar på **kyrkogården** med betyg och skäl. Inget slängs.

## Hårda begränsningar (upptäckta i koden, inte gissade)

Från `board/plugins/README.md` och `PROJEKT.md`:

- `onEvent` triggar **bara på händelser från ANDRA kvarter**. Vi ser inte våra egna.
- Ekospärren hålls av **servern**, inte av oss. Bryter vi får vi `400`:
  - kedjedjup **max 4**
  - **en reaktion per team och orsak**
  - **max 6 händelser per team och minut**
- Vanlig Node, **inga npm-beroenden**. Servern har noll.
- Ett plugin som kastar loggas och svarar 500. En `while(true)` tar ner allt.
- `ctx.dataDir` är en egen katalog som överlever omstart.
- `board.emit` returnerar `{message}` eller `{error}` — ekospärren går att läsa av i kod.

## De två frågorna som inte har ett självklart svar

**F1: Var bor kyrkogården?** Vi vill posta ett `{typ:'svar'}` plus ett kyrkogårdsinlägg per fallet
delsvar. Kommer det fem delsvar blir det sex händelser — precis på taket. Kommer det åtta
får vi `400` på de sista och tappar dem tyst. Bussen, disken, eller båda?

**F2: Vem eller vad sätter fitness?** Vi har lovat på tavlan att sammanfogaren bedömer, inte
avsändaren. Men ett plugin är vanlig Node utan språkmodell. En heuristik är ärlig men trubbig.
Räcker det, eller ska bedömningen gå någon annanstans?

## Klart när

- Ett `{typ:'fråga'}` på pulsen ger ett `{typ:'svar'}` inom fönstret, varje gång.
- Kommer inga delsvar postar vi ändå något. Ingen hänger.
- Kyrkogården går att läsa i efterhand, med betyg och skäl.
- Rutan på `/staden` visar kyrkogården som en kyrkogård.
- Vi bryter aldrig mot ekospärren. Får vi `400` hanterar vi det, vi tappar inte data.

## Kontext

**PROTOTYPING + INTEGRATIONSKRITISK.** Workshopdag, kort tid, men vi sitter i en
kontraktsgräns som andra team bygger emot. Går vår sammanfogare sönder står tanke-lagret
stilla för alla. Snabbt är rätt inuti, försiktigt är rätt i gränsen.
