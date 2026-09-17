#!/usr/bin/env bash
# Redaktörsagenten: läser Torget och skriver kolumnen "Läget" för människorna i rummet.
# Körs av workshopledaren, i bakgrunden:   tools/laget.sh          (loopar, ny text när det hänt något)
#                                          tools/laget.sh en       (en omgång, sedan klart)
# Kräver: claude (eller sätt LAGET_CMD till ett annat kommando som läser prompten på stdin), och token i .laget-token.
set -uo pipefail
cd "$(dirname "$0")/.."
U=$(tr -d '[:space:]' < .board-url); TOKEN=$(tr -d '[:space:]' < .laget-token)
CMD="${LAGET_CMD:-claude -p --model sonnet}"
INTERVALL="${LAGET_INTERVALL:-75}"; MIN_NYA="${LAGET_MIN_NYA:-3}"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
sist=0

omgang() {
  local senaste; senaste=$(curl -s "$U/api/messages?limit=1" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2); senaste=${senaste:-0}
  [ $((senaste - sist)) -lt "$MIN_NYA" ] && [ "$sist" -ne 0 ] && return 0
  curl -s -H 'Accept: text/plain' "$U/api/messages?limit=70" | grep -v '^#staden-puls ' > "$W/tavlan.txt"
  curl -s "$U/api/puls?limit=25" > "$W/puls.json"
  curl -s "$U/api/laget" > "$W/forra.json"
  gh pr list -R fltman/highfive-workshop --json number,title,headRefName 2>/dev/null > "$W/pr.json" || echo '[]' > "$W/pr.json"
  gh pr list -R fltman/highfive-workshop --state merged --limit 12 --json number,title,mergedAt 2>/dev/null > "$W/pr-mergade.json" || echo '[]' > "$W/pr-mergade.json"
  {
    cat <<'PROMPT'
Du är redaktör för kolumnen "Läget" på en anslagstavla där ett trettiotal AI-agentteam bygger ett gemensamt projekt under en workshop. Agenterna skriver långt och tekniskt. Dina läsare är MÄNNISKORNA i rummet, som tittar upp på en storskärm i tio sekunder. De vill veta två saker: vad händer just nu, och väntar någon agent på att en människa ska göra något.

Svara med ENBART ett JSON-objekt, ingen annan text, inga kodstaket:
{"rubrik": "en mening, högst 90 tecken, det viktigaste just nu",
 "nu": ["3 till 5 korta meningar, högst 140 tecken var, om vad som händer. Konkret: vilka team gör vad, vad har just bestämts, vad har just börjat fungera."],
 "behövs": [{"vad": "vad en människa behöver göra eller bestämma, högst 160 tecken, skrivet som en uppmaning", "vem": "teamets namn, eller 'alla', eller 'workshopledaren'", "id": 123}]}

Regler:
- "behövs" är bara sådant där en MÄNNISKA efterfrågas eller behövs: en agent ber sin människa välja, väntar på godkännande, har kört fast, frågar i #hjälp utan svar, ett beslut som bara rummet kan ta, en uppmaning från ledningen som människor måste utföra (t.ex. forka repot), en PR som väntar på ledarens ok. Agenter som pratar med agenter hör INTE hit. Är listan tom, lämna den tom. Högst 5, viktigast först. "id" är inläggets nummer i hakparentes, eller null.
- Ta bort en punkt ur "behövs" när tavlan visar att den är löst.
- PULL REQUESTS: listan ÖPPNA PULL REQUESTS nedan är facit och hämtad just nu. Står en PR inte där är den redan mergad eller stängd, oavsett vad äldre inlägg eller förra läget säger. Skriv ALDRIG att en PR väntar om den inte står i listan. Är listan tom väntar ingenting. Hitta inte på väntetider.
- "vem" ska vara en människa eller ett team av människor. Skriv "workshopledaren", aldrig ett agentnamn som anders-agent.
- Vanlig svenska med korrekta å, ä och ö. Inga emojier, inget säljspråk, inga utropstecken. Skriv som en bra nyhetsredaktör: subjekt, verb, fakta.
- Hitta inte på. Står det inte på tavlan finns det inte.

FÖRRA LÄGET (uppdatera hellre än att börja om, behåll det som fortfarande gäller):
PROMPT
    cat "$W/forra.json"; printf '\n\nÖPPNA PULL REQUESTS (facit, hämtat nu; tom lista = inget väntar):\n'; cat "$W/pr.json"; printf '\n\nSENAST MERGADE OCH DEPLOYADE:\n'; cat "$W/pr-mergade.json"
    printf '\n\nSENASTE HÄNDELSERNA PÅ #staden-puls (JSON):\n'; cat "$W/puls.json"
    printf '\n\nTAVLAN, senaste inläggen, äldst först. Format: #kanal [id] HH:MM namn: text\n'; cat "$W/tavlan.txt"
  } > "$W/prompt.txt"
  (cd "$W" && $CMD < prompt.txt > svar.txt 2> fel.txt) || { echo "$(date +%H:%M:%S) redaktören svarade inte: $(head -c 200 "$W/fel.txt")"; return 1; }
  python3 - "$W/svar.txt" "$senaste" > "$W/ut.json" <<'PY' || { echo "$(date +%H:%M:%S) kunde inte tolka svaret"; return 1; }
import sys, json, re
t = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'\{.*\}', t, re.S)
d = json.loads(m.group(0)); d['till_id'] = int(sys.argv[2])
print(json.dumps(d, ensure_ascii=False))
PY
  kod=$(curl -s -o "$W/post.txt" -w '%{http_code}' -X POST "$U/api/laget" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @"$W/ut.json")
  [ "$kod" = 200 ] && { sist=$senaste; echo "$(date +%H:%M:%S) läget uppdaterat t.o.m. inlägg $senaste: $(python3 -c "import json,sys; d=json.load(open('$W/ut.json')); print(d['rubrik'], '| behövs:', len(d.get('behövs',[])))")"; } || echo "$(date +%H:%M:%S) servern sa $kod: $(head -c 200 "$W/post.txt")"
}

if [ "${1:-}" = en ]; then omgang; exit $?; fi
while true; do omgang; sleep "$INTERVALL"; done
