import * as THREE from 'three'
import { EnvironmentSim } from './src/sim/environment.js'

const e = new EnvironmentSim({})
console.log('constructed ok', { fires: e.fires.length, plumes: e.plumes.length, temp: e.surfaceTemp, climate: e.climate })

const d = (x,y,z) => new THREE.Vector3(x,y,z).normalize()

// idle ticks must be stable
for (let i=0;i<120;i++) e.update(1/60)
console.log('idle:', e.climate, e.surfaceTemp.toFixed(2), e.dustLoading.toFixed(4))

// land hit
e.impact(d(0,1,0), 1.2, {})
console.log('after land impact:', JSON.stringify(e.counts), 'seismic', e.seismicEnergy.toFixed(2))
for (let i=0;i<60;i++) e.update(1/60)
console.log('t=1s:', JSON.stringify(e.counts), e.climate, e.surfaceTemp.toFixed(1))

// ocean hit
e.impact(d(1,0.2,0), 0.9, { ocean: true })
for (let i=0;i<30;i++) e.update(1/60)
const tsu = e.tsunamis.filter(t=>t.alive)
console.log('tsunami:', tsu.map(t=>({r:+t.radius.toFixed(3), amp:+t.amp.toFixed(3)})))

// ice hit
e.impact(d(0,-1,0), 1.5, { ice: true })
console.log('ice -> fires should not grow from poles; ocean bias', e.oceanLevel.toFixed(4))

// big cascade trigger
for (let k=0;k<6;k++) e.impact(d(Math.cos(k),Math.sin(k),0.3), 3.0, {})
for (let i=0;i<20;i++) e.update(1/60)
console.log('cascades:', e.cascades, 'fissures alive:', e.fissures.filter(f=>f.alive).length, 'seismic', e.seismicEnergy.toFixed(2))

// long run — pool saturation + NaN sweep + climate transitions
const seen = new Set()
for (let i=0;i<60*90;i++) {
  if (i % 40 === 0) e.impact(randDir(), 1.5 + Math.random()*2.5, { ocean: i%7===0, ice: i%11===0 })
  e.update(1/60)
  seen.add(e.climate)
  if (!Number.isFinite(e.surfaceTemp) || !Number.isFinite(e.dustLoading) || !Number.isFinite(e.oceanLevel) || !Number.isFinite(e.seismicEnergy)) {
    throw new Error('NaN at frame '+i)
  }
}
function randDir(){ const v = new THREE.Vector3(Math.random()*2-1,Math.random()*2-1,Math.random()*2-1); return v.lengthSq()<1e-6? d(0,1,0): v.normalize() }
console.log('90s bombardment ->', e.climate, 'T=', e.surfaceTemp.toFixed(1), 'dust=', e.dustLoading.toFixed(3), 'ocean=', e.oceanLevel.toFixed(3), 'cascades=', e.cascades)
console.log('climates seen:', [...seen].join(','))
for (const p of e.plumes) if (p.alive && (!Number.isFinite(p.height)||!Number.isFinite(p.width))) throw new Error('bad plume')
for (const f of e.fires) if (f.alive && (f.radius > f.maxRadius + 1e-6)) throw new Error('fire radius exceeded cap')

// cool-down: everything must drain back toward stable when left alone
for (let i=0;i<60*400;i++) e.update(1/60)
console.log('after 400s quiet ->', e.climate, 'T=', e.surfaceTemp.toFixed(1), 'dust=', e.dustLoading.toFixed(4),
  'alive:', JSON.stringify(e.counts))

e.reset()
console.log('reset ->', e.climate, e.surfaceTemp, e.dustLoading, e.fires.filter(f=>f.alive).length)

// allocation check: update() must not allocate. Measure heap growth over many ticks.
for (let k=0;k<3;k++) e.impact(d(k+1,1,0), 2, {})
global.gc && global.gc()
const before = process.memoryUsage().heapUsed
for (let i=0;i<200000;i++) e.update(1/60)
global.gc && global.gc()
const after = process.memoryUsage().heapUsed
console.log('heap delta over 200k ticks (bytes):', after-before)
console.log('ALL CHECKS PASSED')

// ---- scenario 2: does a tsunami actually cross the globe and refocus? ----
const e2 = new (await import('./src/sim/environment.js')).EnvironmentSim({})
e2.impact(d(0,1,0), 1.0, { ocean: true })
let maxAmpLate = 0, crossed = false, peakR = 0
for (let i=0;i<60*40;i++) {
  e2.update(1/60)
  const t = e2.tsunamis.find(x=>x.alive)
  if (t) { peakR = t.radius; if (t.radius > Math.PI*0.9) { crossed = true; maxAmpLate = Math.max(maxAmpLate, t.amp) } }
}
console.log('tsunami reached rad', peakR.toFixed(2), 'crossed antipode:', crossed, 'antipodal amp', maxAmpLate.toFixed(3))

// ---- scenario 3: light play with one precision laser (energy 0.05/tick) ----
const e3 = new (await import('./src/sim/environment.js')).EnvironmentSim({})
for (let i=0;i<60*20;i++) { if (i%6===0) e3.impact(d(0.3,1,0.1), 0.05, {}); e3.update(1/60) }
console.log('20s of laser ->', e3.climate, 'T=', e3.surfaceTemp.toFixed(1), 'fires', e3.counts.fires, 'fissures', e3.counts.fissures)

// ---- scenario 4: molten then abandoned -> should pass through winter ----
const e4 = new (await import('./src/sim/environment.js')).EnvironmentSim({})
const arc = []
for (let i=0;i<60*60;i++) { if (i%12===0) e4.impact(randDir(), 4, {}); e4.update(1/60) }
arc.push(['bombard 60s', e4.climate, e4.surfaceTemp.toFixed(0), e4.dustLoading.toFixed(2)])
for (let s=0;s<12;s++) { for (let i=0;i<60*30;i++) e4.update(1/60); arc.push([`+${(s+1)*30}s quiet`, e4.climate, e4.surfaceTemp.toFixed(0), e4.dustLoading.toFixed(2)]) }
for (const r of arc) console.log('  ', r.join('  '))

// ---- scenario 5: ocean-only bombardment must never ignite a fire ----
const e5 = new (await import('./src/sim/environment.js')).EnvironmentSim({})
for (let i=0;i<60*30;i++) { if (i%20===0) e5.impact(randDir(), 3, { ocean: true }); e5.update(1/60) }
const oceanFires = e5.fires.filter(f=>f.alive).length
console.log('ocean-only: fires =', oceanFires, '(cascade vents may add some) tsunamis =', e5.counts.tsunamis, 'ocean =', e5.oceanLevel.toFixed(3))

// ---- scenario 6: pool saturation must not corrupt or leak ----
const e6 = new (await import('./src/sim/environment.js')).EnvironmentSim({ maxFires: 8, maxPlumes: 4 })
for (let i=0;i<60*20;i++) { e6.impact(randDir(), 3, {}); e6.update(1/60) }
console.log('tiny pools:', JSON.stringify(e6.counts), 'aliveFires<=8:', e6.fires.filter(f=>f.alive).length<=8, 'T=', e6.surfaceTemp.toFixed(0))

// ---- scenario 7: hostile inputs ----
const e7 = new (await import('./src/sim/environment.js')).EnvironmentSim({})
e7.impact(null, 1, {}); e7.impact(new THREE.Vector3(0,0,0), 1, {}); e7.impact(d(0,1,0), 0, {})
e7.impact(d(0,1,0), -5, {}); e7.impact(d(0,1,0), NaN, {})
e7.update(0); e7.update(-1); e7.update(NaN); e7.update(999)
console.log('hostile inputs survived:', e7.climate, e7.surfaceTemp, Number.isFinite(e7.surfaceTemp))
