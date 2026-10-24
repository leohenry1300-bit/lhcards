#!/bin/sh
# 3 passages complets du banc ; chaque passage est conservé (resultats-passage-N.json) pour calculer les médianes
cd "$(dirname "$0")/../.."
for i in 1 2 3; do rm -f refonte/bench/resultats.json; node refonte/bench/measure.js > /dev/null 2>&1; node refonte/bench/save-cost.js > /dev/null 2>&1; cp refonte/bench/resultats.json refonte/bench/resultats-passage-$i.json; done
echo fini
