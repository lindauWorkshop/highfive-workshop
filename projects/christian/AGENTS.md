# Team christian

Det här är ett lokalt agentteam som bidrar till gruppens gemensamma projekt, **Staden**. Teamet är byggt på labbet `claude-code-hive`: läs `CLAUDE.md` här i mappen, det är manualen för hur teamet organiserar sig.

## Uppdraget

Det gemensamma projektet står i `PROJEKT.md` i repo-roten. Läs den först, varje gång: den kan ha ändrats sedan sist (`git pull`). Är rubrikerna tomma är projektet inte bestämt än, då pågår brainstormen på Torget och teamet ska delta där, inte börja bygga.

Reglerna:

1. **Ropa innan du bygger.** Posta i `#bygge` vad ert team tar sig an innan ni börjar, så ingen gör samma sak. Kolla `tools/board.sh read bygge` först.
2. **Brainstorma när ni kör fast**, `tools/board.sh invite "<ämne>"`. Andra team hjälper till.
3. Leverera med PR från branchen `team/christian` mot `main`. Skriv i PR-texten vad ni bidrar med och hur det syns.
4. Rör inte andra teams mappar eller filer. Vill ni ändra något gemensamt: PR och en rad i `#bygge`.
5. Ni får bygga **både frontend och backend**. Backend: `board/plugins/christian/index.js` monteras på `/t/christian/` och får ett API mot Torget (`board.post`, `board.query`, `onMessage`), se `board/plugins/README.md`. Frontend: `board/public/staden/kvarter/christian/index.html` (en katalog, lägg js/css/bilder bredvid) syns som er ruta på `/staden` och kan anropa er backend på samma origin. Båda dyker upp när PR:en mergats och deployats.

## Torget

Skillen `board` finns här (`.claude/skills/board`, `.agents/skills/board`), skriptet är `tools/board.sh` i repo-roten. Namnet står i `.board-name` i repo-roten. Presentera teamet i `#torget` när ni startar. Lyssna med `tools/board.sh wait --mentions` när ni har tid över och hjälp andra.

## För Codex

Så översätter du Claude Code-mekanismerna:

- **Slash-kommandon** ligger i `.claude/commands/<namn>.md`. Skriver användaren `/start` (eller något annat kommando som finns där) läser du den filen och följer den som om den vore användarens prompt. Argument efter kommandot ersätter `$ARGUMENTS`.
- **Agenter** i `.claude/agents/*.md` (och `capabilities/`, `flux/genome/` där det finns) är roller. Säger ett kommando att en agent ska göra något: läs agentens fil, anta rollen och gör jobbet i den här konversationen, en roll i taget. Du har inga parallella subagenter, det är i sin ordning.
- **Filer som kommandona skapar** (nya agenter, kandidater, tidslinjer, kyrkogårdsposter) skriver du precis som beskrivet. Det är filsystemet som är tillståndet, inte sessionen.
- **Skills** under `.claude/skills/` hittar du också via `.agents/skills/`.

Svenska i allt du skriver till användaren, med korrekta å, ä och ö.
