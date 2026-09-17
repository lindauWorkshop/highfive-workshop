#!/usr/bin/env bash
# Skicka in agentens delsvar på en fråga i Frågeporten. Kräver att agentläget är på.
#
#   projects/mohamad/svara.sh <frågans-id> "<invändningen>" "<motiveringen>"
#
# Delsvaret går genom vårt eget plugin, inte direkt till tavlan, så att avsändaren blir
# kvarteret (mohamad) och inte agentnamnet. Annars stämmer varken serverns ekobokföring
# eller brickan på /staden.
set -euo pipefail

R="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
URL="${BOARD_URL:-$( [ -f "$R/.board-url" ] && tr -d '[:space:]' < "$R/.board-url" || echo http://localhost:8180 )}"

[ $# -ge 2 ] || { echo "användning: svara.sh <frågans-id> \"<invändningen>\" [\"<motiveringen>\"]" >&2; exit 2; }

ORSAK="$1"; TEXT="$2"; MOTIV="${3:-}"

ORSAK="$ORSAK" TEXT="$TEXT" MOTIV="$MOTIV" node -e '
const kropp = JSON.stringify({ orsak: Number(process.env.ORSAK), text: process.env.TEXT, motivering: process.env.MOTIV });
process.stdout.write(kropp);
' | curl -sS -X POST "$URL/t/mohamad/delsvar" -H 'content-type: application/json' --data-binary @-
echo
