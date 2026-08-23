#!/usr/bin/env bash
# Supervisor: keeps Claude Code grinding through the COSMIC FORGE build,
# auto-resuming after transient gateway failures (the reseller drops a
# connection every so often and returns HTTP 200 with an empty body).
export PATH=$HOME/.npm-global/bin:$PATH
cd ~/cosmic-forge || exit 1

MAX_ROUNDS=${MAX_ROUNDS:-14}

read -r -d '' RESUME <<'EOP'
Continue the COSMIC FORGE build. Read CLAUDE.md and PROMPT.md if you need the spec again.

Work in this order, running `npm run build` after each step and fixing every error before moving on:
STEP 7  surface targeting   - raycast the planet, world-space 3D reticle, impact radius preview, touch + mouse
STEP 8  real 3D laser       - actual beam geometry emitter->impact, shader-driven volume/glow, light contribution
STEP 9  real surface damage - wire beams into DamageField.stamp / stampArc so terrain is genuinely excavated
STEP 10 crater/deformation  - verify displacement + interior breach read correctly at close range
STEP 11 debris              - wire DebrisSystem into impacts, mount the InstancedMesh in the planet's spin frame
STEP 12 population response - telemetry: integrity, population, craters, debris count, atmosphere
STEP 13 remaining weapons   - projectiles (kinetic slug, meteor, plasma lance) + gravity well, all from registry.js
STEP 14 HUD + reset         - minimal glass HUD, world-space markers for spatial info, weapon switcher, reset

FINAL PASS - code review of the two modules that were written outside your session:
  - src/weapons/registry.js
  - src/sim/debris.js
Review them critically as if reviewing a PR. Keep what is good, but genuinely improve them:
tighten the physics, fix anything that will not scale, improve the ejecta//fracture feel, make the
weapon parameters produce visibly distinct results, add anything missing for mobile budgets.
Say what you changed and why.

Do not ask questions. Do not stop at a plan. If a previous attempt errored mid-way, pick up from
wherever the code actually is. Keep going until the vertical slice builds clean and runs.
EOP

for i in $(seq 1 $MAX_ROUNDS); do
  echo "════════ ROUND $i/$MAX_ROUNDS ════════"
  claude --continue -p "$RESUME" \
    --model claude-opus-5 \
    --permission-mode bypassPermissions \
    --verbose --output-format stream-json 2>&1 \
  | tee -a ~/cosmic-forge/.build-log2.jsonl \
  | python3 -u -c "
import sys,json
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try: d=json.loads(line)
    except: print(line[:200]); continue
    t=d.get('type')
    if t=='assistant':
        for c in d['message'].get('content',[]):
            if c['type']=='text' and c['text'].strip(): print('💬',c['text'].strip()[:400])
            elif c['type']=='tool_use':
                i=c['input']; desc=i.get('file_path') or i.get('command') or i.get('description') or ''
                print('🔧',c['name'],str(desc)[:150])
    elif t=='result':
        print('=== ROUND END ===',d.get('subtype'),'turns:',d.get('num_turns'))
        print((d.get('result') or '')[:1200])
"
  # Did the build survive this round?
  if npm run build --silent >/tmp/cf_build.log 2>&1; then
    echo "✅ build passes after round $i"
  else
    echo "❌ build failing after round $i"; tail -5 /tmp/cf_build.log
  fi
  sleep 5
done
echo "════════ SUPERVISOR FINISHED ════════"
