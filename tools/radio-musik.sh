#!/usr/bin/env bash
# Laddar upp Radio Torgets musikbibliotek till servern. Körs en gång (eller när listan ändras).
# Musiken är workshopledarens egna Suno-spår från Owl Creek Radio. Ingen generering, ingen kostnad.
set -uo pipefail
cd "$(dirname "$0")/.."
U=$(tr -d '[:space:]' < .board-url); TOKEN=$(tr -d '[:space:]' < .laget-token)
SRC="${RADIO_MUSIK_DIR:-$HOME/Projekt/interactive-radiostation/suno}"
# sort|filnamn i källmappen|titel i etern
LISTA='bädd|Bulletin Bed.mp3|Bulletin Bed
bädd|Fog Report (bed).mp3|Fog Report
bädd|After the Lights (bed).mp3|After the Lights
låt|Roadhouse, 3 A.M..mp3|Roadhouse, 3 A.M.
låt|Black Lake.mp3|Black Lake
låt|Cedar & Rain.mp3|Cedar & Rain
låt|Lantern Road (1).mp3|Lantern Road
låt|Tremolo Heart.mp3|Tremolo Heart
låt|Cherry Pie at Three (1).mp3|Cherry Pie at Three
låt|Don'"'"'t Drive Home Yet (1).mp3|Don'"'"'t Drive Home Yet
låt|If You'"'"'re Still Awake.mp3|If You'"'"'re Still Awake
låt|The Last Waltz in Glassfall.mp3|The Last Waltz in Glassfall
låt|Smoke in the Booth.mp3|Smoke in the Booth
låt|Sawmill Lullaby.mp3|Sawmill Lullaby
låt|Dust on the Needle (1).mp3|Dust on the Needle'
echo '[]' > /tmp/radio-musik.json
while IFS='|' read -r sort fil titel; do
  f="$SRC/$fil"; [ -f "$f" ] || { echo "saknas: $fil"; continue; }
  slug=$(printf %s "$titel" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//').mp3
  sek=$(afinfo "$f" 2>/dev/null | awk '/estimated duration/{print int($3)}'); sek=${sek:-0}
  kod=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U/api/ljud/$slug" -H "Authorization: Bearer $TOKEN" --data-binary @"$f")
  echo "[$kod] $sort  $titel  (${sek}s)  → $slug"
  [ "$kod" = 201 ] && python3 - "$slug" "$titel" "$sort" "$sek" <<'PY'
import sys, json
l = json.load(open('/tmp/radio-musik.json')); l.append({"fil": sys.argv[1], "titel": sys.argv[2], "sort": sys.argv[3], "sek": int(sys.argv[4])}); json.dump(l, open('/tmp/radio-musik.json', 'w'), ensure_ascii=False)
PY
done <<< "$LISTA"
if [ -f "${RADIO_JINGEL:-}" ]; then kod=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U/api/ljud/radio-torget-jingel.mp3" -H "Authorization: Bearer $TOKEN" --data-binary @"$RADIO_JINGEL"); echo "[$kod] jingel"
  python3 -c "import json; l=json.load(open('/tmp/radio-musik.json')); l.append({'fil':'radio-torget-jingel.mp3','titel':'Radio Torget','sort':'jingel','sek':12}); json.dump(l, open('/tmp/radio-musik.json','w'), ensure_ascii=False)"; fi
python3 -c "import json; print(json.dumps({'musik': json.load(open('/tmp/radio-musik.json'))}, ensure_ascii=False))" > /tmp/radio-musik-post.json
curl -s -X POST "$U/api/radio" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @/tmp/radio-musik-post.json | head -c 120; echo
