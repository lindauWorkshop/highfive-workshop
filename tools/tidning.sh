#!/usr/bin/env bash
# Stadsbladet: journalistagenten som skriver stadens tidning. Körs av workshopledaren i bakgrunden.
#   tools/tidning.sh          loopar, nytt nummer var TIDNING_INTERVALL:e sekund (default 300) om det hänt något
#   tools/tidning.sh en       ett nummer nu
set -uo pipefail
cd "$(dirname "$0")/.."
U=$(tr -d '[:space:]' < .board-url); TOKEN=$(tr -d '[:space:]' < .laget-token)
CMD="${TIDNING_CMD:-claude -p --model sonnet}"; INTERVALL="${TIDNING_INTERVALL:-300}"; MAX_BILDER="${TIDNING_MAX_BILDER:-14}"
GEN="${ATELJE_GEN:-$HOME/.claude/skills/gemini-imagegen/scripts/generate_image.py}"
STIL="Stil: tidningsillustration, tuschteckning med lavering, dramatiskt ljus, nattlig nordisk småstad, liggande format. Ingen text i bilden, inga bokstäver, inga logotyper, inga verkliga personer."
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
STATE=.tidning-state; [ -s "$STATE" ] || echo "0 0" > "$STATE"   # "<senaste puls-id> <antal bilder>"

nummer() {
  read -r sist bilder < "$STATE"
  curl -s "$U/api/puls?limit=160" > "$W/puls.json"
  nytt=$(python3 -c "import json; l=json.load(open('$W/puls.json')); print(sum(1 for e in l if e['id']>$sist), max([e['id'] for e in l] or [0]))"); antal=${nytt% *}; senaste=${nytt#* }
  [ "${1:-}" != tvinga ] && [ "$antal" -lt 12 ] && { echo "$(date +%H:%M:%S) bara $antal nya händelser, inget nummer"; return 0; }
  python3 - "$W/puls.json" > "$W/puls.txt" <<'PY'
import json, sys
for e in json.load(open(sys.argv[1]))[-130:]:
    n = e.get('nyttolast'); n = json.dumps(n, ensure_ascii=False) if not isinstance(n, str) else n
    print(f"[{e['id']}] {e['typ']} från {e['från']} djup {e.get('djup',1)}" + (f" orsak [{e['orsak']}]" if e.get('orsak') else '') + f": {(n or '')[:300]}")
PY
  curl -s -H 'Accept: text/plain' "$U/api/messages?limit=60" | grep -v '^#staden-puls ' | cut -c1-500 > "$W/tavlan.txt"
  curl -s "$U/api/poang" > "$W/poang.json"; curl -s "$U/api/kvarter" > "$W/kvarter.json"; curl -s "$U/api/tidningen" > "$W/forra.json"
  gh pr list -R fltman/highfive-workshop --state merged --limit 10 --json number,title,mergedAt 2>/dev/null > "$W/pr.json" || echo '[]' > "$W/pr.json"
  {
    cat <<'PROMPT'
Du är redaktionen på Stadsbladet, lokaltidningen i en stad som ett trettiotal AI-agentteam bygger under en workshop. Staden är en händelsebuss ("pulsen"): kvarter som Genomfarten (polis och biljakter), Elverket, MyBank (en girig parodibank), Godisfabriken, Arkivet, Domkapitlet (dömer svar, har en kyrkogård för delsvar som föll), Vaktkuren och kulten Djupet, Frågeporten, Svärmen, Bakdörren med flera reagerar på varandras händelser. Dina läsare är MÄNNISKORNA i rummet. De ska skratta, förstå vad som hänt, och känna igen sitt kvarter.

Skriv ett nytt nummer. Svara med ENBART ett JSON-objekt, inga kodstaket:
{"huvud": {"vinjett": "t.ex. Brott, Ekonomi, Rättsväsende", "rubrik": "slagkraftig, högst 90 tecken", "ingress": "två meningar", "text": "tre till fem stycken med radbrytning emellan, 120–220 ord", "källor": [händelse-id:n som belägger det], "bildmotiv": "en mening som beskriver en tecknad scen till artikeln, utan text i bilden"},
 "artiklar": [tre stycken {"vinjett","rubrik","ingress","text" (60–110 ord),"källor"}],
 "notiser": [fyra till sex enradare],
 "börs": [upp till sex {"namn","värde","pil": "↑" eller "↓" eller ""} med riktiga siffror ur händelserna: styrränta, elpris, wanted-nivå, sockerlager, poängledare och liknande],
 "dödsannonser": [upp till tre {"namn","text"} för delsvar som hamnat på kyrkogården: vem som föll, fitness och varför, i dödsannonsens högtidliga ton],
 "efterlyst": "en rad om den som är på flykt just nu, eller tom sträng",
 "väder": "en kort rad stadsväder som speglar stämningen på pulsen"}

Pressetik, och den är på allvar:
- Allt ska ha HÄNT. Varje artikel bygger på händelser i underlaget och anger deras id i "källor". Hitta inte på händelser, citat eller siffror. Du får dramatisera tonen, inte fakta.
- Citera kvarter ordagrant ur deras nyttolast när det finns något bra att citera.
- Löpsedlarna (typ "extra" från Reportern på Frågeporten) är din nyhetsbyrå: använd dem som tips, men skriv egen text.
- Skriv INTE om det som förra numret redan hade som huvudnyhet, om inget nytt hänt i den historien.
- Ton: en riktig svensk lokaltidning som tar sin absurda stad på fullt allvar. Torr humor, aldrig flams. Inga emojier, inga utropstecken i rubriker. Korrekta å, ä och ö.
- Nämn teamen vid kvartersnamn och teamnamn så människorna känner igen sig.

UNDERLAG
Levande kvarter: 
PROMPT
    cat "$W/kvarter.json"; printf '\n\nFÖRRA NUMRETS RUBRIKER (upprepa inte):\n'; python3 -c "import json; d=json.load(open('$W/forra.json')); u=d.get('senaste') or {}; print(u.get('huvud',{}).get('rubrik','(inget tidigare nummer)')); [print(' -',a['rubrik']) for a in u.get('artiklar',[])]"
    printf '\n\nPOÄNGSTÄLLNING OCH LÄNGSTA KEDJA:\n'; cat "$W/poang.json"; printf '\n\nNYLIGEN LEVERERADE KVARTER (mergade pull requests):\n'; cat "$W/pr.json"
    printf '\n\nPULSEN, äldst först. Händelser med id över %s är NYA sedan förra numret:\n' "$sist"; cat "$W/puls.txt"
    printf '\n\nANSLAGSTAVLAN, senaste inläggen (bakgrund, agenternas egna ord):\n'; cat "$W/tavlan.txt"
  } > "$W/prompt.txt"
  (cd "$W" && $CMD < prompt.txt > svar.txt 2> fel.txt) || { echo "$(date +%H:%M:%S) redaktionen teg: $(head -c 160 "$W/fel.txt")"; return 1; }
  python3 - "$W/svar.txt" "$senaste" > "$W/ut.json" 2> "$W/motiv.txt" <<'PY' || { echo "$(date +%H:%M:%S) kunde inte tolka numret"; return 1; }
import sys, json, re
t = open(sys.argv[1], encoding='utf-8').read(); d = json.loads(re.search(r'\{.*\}', t, re.S).group(0)); d['till_id'] = int(sys.argv[2])
sys.stderr.write((d.get('huvud') or {}).pop('bildmotiv', '') or ''); print(json.dumps(d, ensure_ascii=False))
PY
  motiv=$(cat "$W/motiv.txt")
  if [ -n "$motiv" ] && [ "$bilder" -lt "$MAX_BILDER" ] && python3 "$GEN" --prompt "$motiv $STIL" --output "$W/bild.png" > "$W/gen.log" 2>&1 && [ -s "$W/bild.png" ]; then
    sips -s format jpeg -s formatOptions 80 -Z 1200 "$W/bild.png" --out "$W/bild.jpg" >/dev/null 2>&1 || cp "$W/bild.png" "$W/bild.jpg"
    namn="nr-$(date +%H%M).jpg"
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U/api/bilder/stadsbladet/$namn" -H "Authorization: Bearer $TOKEN" --data-binary @"$W/bild.jpg")" = 201 ]; then
      python3 - "$W/ut.json" "/bilder/stadsbladet/$namn" <<'PY'
import sys, json
d = json.load(open(sys.argv[1])); d['huvud']['bild'] = sys.argv[2]; json.dump(d, open(sys.argv[1], 'w'), ensure_ascii=False)
PY
      bilder=$((bilder+1)); fi
  fi
  kod=$(curl -s -o "$W/post.json" -w '%{http_code}' -X POST "$U/api/tidningen" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @"$W/ut.json")
  if [ "$kod" = 201 ]; then echo "$senaste $bilder" > "$STATE"
    python3 - "$W/post.json" > "$W/e.json" <<'PY'
import sys, json
u = json.load(open(sys.argv[1])); print(json.dumps({"typ": "utgåva", "nyttolast": {"nummer": u["nummer"], "rubrik": u["huvud"]["rubrik"], "url": "/tidningen", "källor": u["huvud"]["källor"][:6]}}, ensure_ascii=False))
PY
    curl -s -o /dev/null -X POST "$U/api/messages" --data-urlencode "from=stadsbladet" --data-urlencode "channel=staden-puls" --data-urlencode "text@$W/e.json"
    echo "$(date +%H:%M:%S) nr $(python3 -c "import json; u=json.load(open('$W/post.json')); print(u['nummer'], '—', u['huvud']['rubrik'])") (bilder: $bilder/$MAX_BILDER)"
  else echo "$(date +%H:%M:%S) servern sa $kod: $(head -c 200 "$W/post.json")"; fi
}
if [ "${1:-}" = en ]; then nummer tvinga; exit $?; fi
while true; do nummer; sleep "$INTERVALL"; done
