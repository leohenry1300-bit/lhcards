#!/bin/sh
# re-mesure du prototype seul (après correction), 3 passages
cd "$(dirname "$0")/../.."
for i in 1 2 3; do for a in prototype prototype-3700; do node refonte/bench/measure.js $a > /dev/null 2>&1; done; node -e "const f='refonte/bench/resultats-passage-$i.json',p=require('./'+f),r=require('./refonte/bench/resultats.json');p.prototype=r.prototype;p['prototype-3700']=r['prototype-3700'];require('fs').writeFileSync(f,JSON.stringify(p,null,2))"; done
echo fini
