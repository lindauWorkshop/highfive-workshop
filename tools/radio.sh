#!/usr/bin/env bash
# Radio Torget: lokalradioprataren. Läser pulsen, Stadsbladet och lyssnarnas hälsningar, skriver ett manus,
# låter ElevenLabs läsa det och sänder. Musiken ligger redan på servern (tools/radio-musik.sh).
#   tools/radio.sh          loopar, en sändning var RADIO_INTERVALL:e sekund (default 300)
#   tools/radio.sh en       en sändning nu
# PENGAR: ElevenLabs-kontot har övertrassering påslagen. Skriptet läser kontots RIKTIGA räknare fore varje sändning och
# vägrar generera om det återstår RADIO_GOLV krediter eller mindre (default 9000). Ett manus är högst RADIO_MAX_TECKEN tecken.
set -uo pipefail
cd "$(dirname "$0")/.."
U=$(tr -d '[:space:]' < .board-url); TOKEN=$(tr -d '[:space:]' < .laget-token)
ENVFIL="${RADIO_ENV:-$HOME/Projekt/interactive-radiostation/.env}"
XI=$(grep -E "^ELEVENLABS_API_KEY=" "$ENVFIL" | head -1 | cut -d= -f2- | tr -d "\"' \r"); [ -n "$XI" ] || { echo "ingen ElevenLabs-nyckel i $ENVFIL"; exit 1; }
ROST="${RADIO_ROST:-6MuG7W2I4HAxP8rwUO6Z}"; ROSTNAMN="${RADIO_ROSTNAMN:-Bengt}"; MODELL="${RADIO_MODELL:-eleven_v3}"
GOLV="${RADIO_GOLV:-9000}"; MAXT="${RADIO_MAX_TECKEN:-520}"; INTERVALL="${RADIO_INTERVALL:-300}"
BUDGET="${RADIO_BUDGET:-22000}"   # egen bokföring: så här många tecken får radion läsa totalt. Kontots räknare släpar flera minuter, så vi litar inte bara på den.
BOK=.radio-tecken; [ -s "$BOK" ] || echo 0 > "$BOK"
CMD="${RADIO_CMD:-claude -p --model sonnet}"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT; STATE=.radio-state; [ -s "$STATE" ] || echo 0 > "$STATE"
kvar() { curl -s -H "xi-api-key: $XI" https://api.elevenlabs.io/v1/user/subscription | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['character_limit']-d['character_count'])" 2>/dev/null || echo 0; }

sand() {
  last=$(cat "$BOK"); if [ "$last" -ge "$BUDGET" ]; then echo "$(date +%H:%M:%S) STOPP: radion har läst $last tecken, budgeten är $BUDGET. Bara musik nu."; return 2; fi
  fore=$(kvar); if [ "$fore" -le "$GOLV" ]; then echo "$(date +%H:%M:%S) STOPP: $fore krediter kvar, golvet är $GOLV. Radion spelar bara musik nu."; return 2; fi
  sist=$(cat "$STATE"); curl -s "$U/api/puls?limit=120" > "$W/puls.json"; curl -s "$U/api/radio" > "$W/radio.json"; curl -s "$U/api/tidningen" > "$W/tidning.json"; curl -s "$U/api/poang" > "$W/poang.json"
  python3 - "$W" "$sist" > "$W/underlag.txt" <<'PY'
import json, sys, time
W, sist = sys.argv[1], int(sys.argv[2])
puls = json.load(open(f'{W}/puls.json')); radio = json.load(open(f'{W}/radio.json')); tid = json.load(open(f'{W}/tidning.json')); po = json.load(open(f'{W}/poang.json'))
print('KLOCKAN:', time.strftime('%H:%M'))
print('\nOLÄSTA MEDDELANDEN FRÅN LYSSNARE (läs upp dem, nämn namnet; hoppa över det som är olämpligt att läsa i radio):')
ol = [h for h in radio['hälsningar'] if not h['läst']][-5:]
for h in ol: print(f"  id {h['id']} [{h['sort']}] från {h['namn']}: {h['text']}")
if not ol: print('  (inga just nu, påminn gärna om att man kan hälsa och önska på radions sida)')
print('\nMUSIKEN DU KAN SPELA (fil | titel):'); [print(f"  {m['fil']} | {m['titel']}") for m in radio['musik'] if m['sort'] == 'låt']
print('\nDINA SENASTE SÄNDNINGAR (upprepa inte samma nyheter):'); [print('  -', s['titel']) for s in radio['segment'] if s['typ'] == 'prat'][:4]
u = tid.get('senaste') or {}
if u: print('\nSTADSBLADETS SENASTE NUMMER:', u['huvud']['rubrik'], '—', u['huvud']['ingress']); [print('  notis:', n) for n in u.get('notiser', [])[:4]]
print('\nPOÄNG:', ', '.join(f"{t['team']} {t['poäng']}" for t in po['topp'][:5] if t['poäng']))
print(f'\nPULSEN (händelser med id över {sist} är nya sedan din förra sändning):')
for e in puls[-60:]:
    n = e.get('nyttolast'); n = json.dumps(n, ensure_ascii=False) if not isinstance(n, str) else n
    print(f"  [{e['id']}] {e['typ']} från {e['från']}: {(n or '')[:200]}")
PY
  {
    cat <<PROMPT
Du är $ROSTNAMN, radiopratare på Radio Torget, lokalradion i en liten svensk stad som byggs av AI-agentteam under en workshop. Kvarteren i staden (Genomfarten med polis och biljakter, Elverket, den giriga banken MyBank, Godisfabriken, Arkivet, Domkapitlet med sin kyrkogård, Vaktkuren och kulten Djupet, Frågeporten, Svärmen, Bakdörren, Ateljén, Stadsbladet) reagerar på varandras händelser. Du sänder live till människorna i rummet.

Skriv manuset till nästa inslag. Svara med ENBART ett JSON-objekt:
{"titel": "kort rubrik för inslaget, högst 60 tecken", "manus": "det du säger i etern", "lästa": [id på de lyssnarmeddelanden du läste upp], "spela": "filnamn på låten du påannonserar, exakt ur musiklistan, eller tom sträng"}

Regler för manuset:
- HÖGST $MAXT tecken, räknat med mellanslag. Det är en hård gräns, varje tecken kostar pengar. Sikta på 400 till $MAXT.
- Det ska LÅTA som lokalradio: varm, lite för entusiastisk över småsaker, torr humor. Hälsa lyssnarna, säg vad klockan är ibland, avsluta med att påannonsera nästa låt vid titel.
- Innehåll i den här ordningen: det viktigaste som hänt i staden sedan sist (en eller två nyheter, verkliga, ur pulsen eller Stadsbladet), sedan lyssnarnas hälsningar, önskningar och berättelser om det finns några, sedan låten. Önskar någon en viss låt som finns i listan: spela den. Önskar de något som inte finns: säg det vänligt och välj något som passar.
- Hitta inte på händelser. Du får överdriva tonen, inte fakta.
- Skriv för ÖRAT: korta meningar, inga hakparenteser med id-nummer, inga förkortningar, skriv ut siffror som ord. Kvartersnamn på svenska. Inga emojier.
- Du får använda högst två av de här regianvisningarna, på engelska inom hakparentes, mitt i texten: [laughs] [sighs] [excited] [whispers] [chuckles]. De räknas in i teckengränsen.

PROMPT
    cat "$W/underlag.txt"
  } > "$W/prompt.txt"
  (cd "$W" && $CMD < prompt.txt > svar.txt 2> fel.txt) || { echo "$(date +%H:%M:%S) prataren teg: $(head -c 160 "$W/fel.txt")"; return 1; }
  python3 - "$W/svar.txt" "$MAXT" "$ROSTNAMN" > "$W/seg.json" <<'PY' || { echo "$(date +%H:%M:%S) kunde inte tolka manuset"; return 1; }
import sys, json, re
t = open(sys.argv[1], encoding='utf-8').read(); d = json.loads(re.search(r'\{.*\}', t, re.S).group(0)); mx = int(sys.argv[2])
m = re.sub(r'\s+', ' ', d.get('manus', '')).strip()
if len(m) > mx:                      # hård gräns: klipp vid sista hela meningen som ryms
    k = m[:mx]; p = max(k.rfind('. '), k.rfind('! '), k.rfind('? ')); m = k[:p + 1] if p > mx * 0.6 else k
d['manus'] = m; d['röst'] = sys.argv[3]; print(json.dumps(d, ensure_ascii=False))
PY
  python3 -c "import json; d=json.load(open('$W/seg.json')); json.dump({'text': d['manus'], 'model_id': '$MODELL'}, open('$W/tts.json','w'), ensure_ascii=False); print(len(d['manus']))" > "$W/antal.txt"
  kod=$(curl -s -o "$W/prat.mp3" -w '%{http_code}' -X POST "https://api.elevenlabs.io/v1/text-to-speech/$ROST?output_format=mp3_44100_128" -H "xi-api-key: $XI" -H 'content-type: application/json' --data-binary @"$W/tts.json")
  [ "$kod" = 200 ] && [ -s "$W/prat.mp3" ] || { echo "$(date +%H:%M:%S) ElevenLabs sa $kod: $(head -c 200 "$W/prat.mp3")"; return 1; }
  fil="prat-$(date +%H%M%S).mp3"; sek=$(afinfo "$W/prat.mp3" 2>/dev/null | awk '/estimated duration/{print int($3)}'); sek=${sek:-0}
  [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U/api/ljud/$fil" -H "Authorization: Bearer $TOKEN" --data-binary @"$W/prat.mp3")" = 201 ] || { echo "uppladdningen misslyckades"; return 1; }
  python3 - "$W/seg.json" "$fil" "$sek" > "$W/post.json" <<'PY'
import sys, json
d = json.load(open(sys.argv[1])); print(json.dumps({"segment": {"typ": "prat", "titel": d.get("titel", "Radio Torget"), "text": d["manus"], "fil": sys.argv[2], "sek": int(sys.argv[3]), "röst": d["röst"]}, "lästa": [int(x) for x in d.get("lästa", []) if str(x).isdigit()]}, ensure_ascii=False))
PY
  curl -s -o /dev/null -X POST "$U/api/radio" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @"$W/post.json"
  spela=$(python3 -c "import json; print(json.load(open('$W/seg.json')).get('spela',''))")
  if [ -n "$spela" ]; then printf '{"segment":{"typ":"musik","titel":"%s","fil":"%s"}}' "$spela" "$spela" > "$W/m.json"; curl -s -o /dev/null -X POST "$U/api/radio" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @"$W/m.json"; fi
  python3 -c "import json; d=json.load(open('$W/seg.json')); print(json.dumps({'typ':'sändning','nyttolast':{'titel':d.get('titel',''),'url':'/radio','text':d['manus'][:240]}}, ensure_ascii=False))" > "$W/e.json"
  curl -s -o /dev/null -X POST "$U/api/messages" --data-urlencode "from=radion" --data-urlencode "channel=staden-puls" --data-urlencode "text@$W/e.json"
  python3 -c "import json; l=json.load(open('$W/puls.json')); print(max([e['id'] for e in l] or [0]))" > "$STATE"
  echo $(( $(cat "$BOK") + $(cat "$W/antal.txt") )) > "$BOK"
  echo "$(date +%H:%M:%S) i etern: $(python3 -c "import json; print(json.load(open('$W/seg.json')).get('titel',''))") · $(cat "$W/antal.txt") tecken, ${sek}s · läst totalt $(cat "$BOK")/$BUDGET tecken · kontot visade $fore kvar före (släpar, golv $GOLV) · nästa låt: ${spela:-slumpad}"
}
if [ "${1:-}" = en ]; then sand; exit $?; fi
while true; do sand; [ $? -eq 2 ] && exit 0; sleep "$INTERVALL"; done
