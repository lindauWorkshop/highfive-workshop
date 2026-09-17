#!/usr/bin/env bash
# Startar en Torget-server där BARA vårt plugin är laddat.
#
# Sedan main fyllts på med grannarnas plugins svarar de på provets frågor innan
# provet hinner göra det själv, och servern nekar vår egen tjoho-delsvar med
# "ni har redan reagerat på den händelsen". Provet mäter Juryn, inte grannarna,
# så det ska köra ensamt. Riktig drift är fortfarande hela board/plugins.
#
#   projects/team-jacob/prov-server.sh &
#   node projects/team-jacob/prov.mjs
#
# PORT och JURYN_AVGIFT går att sätta utifrån.

set -euo pipefail

ROT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BO="${PROV_BO:-${TMPDIR:-/tmp}/juryn-prov-bo}"

rm -rf "$BO"
mkdir -p "$BO/board/plugins"
cp "$ROT/board/server.js" "$BO/board/server.js"
ln -s "$ROT/board/public" "$BO/board/public"
ln -s "$ROT/board/plugins/team-jacob" "$BO/board/plugins/team-jacob"

cd "$BO/board"
exec env \
  PORT="${PORT:-8199}" \
  DATA_DIR="$BO/data" \
  JURYN_FONSTER_MS="${JURYN_FONSTER_MS:-2000}" \
  JURYN_AVGIFT="${JURYN_AVGIFT:-100}" \
  node server.js
