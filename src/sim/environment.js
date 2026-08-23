import * as THREE from 'three'

/**
 * Environment simulation — the planet's reaction to being hit.
 *
 * This is the *consequence* layer. Weapons write craters into the damage field;
 * this writes what the world does about it afterwards: things burn, the crust
 * vapourises into a column, the ocean rings like a struck bell, the atmosphere
 * carries a pressure wave, dust chokes the sky and the temperature runs away.
 *
 * Pure simulation. No React, no scene graph, no materials. Renderers read the
 * pooled arrays through the getters and draw whatever they like from them.
 *
 * Every pool is fixed size, every member is preallocated at construction, and
 * update() allocates nothing — the only Vector3s that exist after the
 * constructor are the module-level scratch vectors below.
 *
 * Units: angles are radians of arc on the unit sphere (so a "radius" of 0.3 is
 * a cap covering ~17deg of the globe); heights are in planet radii; time is
 * seconds; temperature is Kelvin. Timescales are deliberately compressed —
 * real planetary shock waves take hours to circle a world and stratospheric
 * dust takes years to settle. Everything here is scaled to a ~10^4 speed-up so
 * the chain reaction is legible inside one play session, but the *ratios*
 * between the systems (shock faster than tsunami faster than firefront) are
 * kept physical.
 */

// ---------------------------------------------------------------------------
// Tunables. Grouped by system, each with the reasoning for the number.
// ---------------------------------------------------------------------------

// Impact classification thresholds, in the arbitrary "energy" unit the weapon
// registry emits (a precision-laser tick is ~0.05, a meteor-strike is ~1.0+).
const E_IGNITE = 0.18   // below this the crust just glows; nothing sustains combustion
const E_PLUME = 0.30   // needs enough specific energy to actually vapourise rock
const E_TSUNAMI = 0.12   // water couples efficiently — even small hits raise a wave
const E_FISSURE = 1.10   // direct crustal fracture at the impact site

// --- Firestorm ---
// A real firestorm front advances at 1-30 m/s. Over a 6371 km radius that is
// ~5e-6 rad/s; at our 10^4 compression, ~0.05 rad/s. Scaled by intensity so a
// dying fire crawls.
const FIRE_SPREAD_RATE = 0.048
const FIRE_BURN_TAU = 7.5    // fuel exhaustion e-folding time
const FIRE_DIE_INTENSITY = 0.035  // below this there is no visible flame front
const FIRE_SPREAD_INTERVAL = 0.55   // seconds between ignition rolls for a child
const FIRE_SPREAD_P = 0.60   // base chance per roll for a gen-0 fire
const FIRE_GEN_FALLOFF = 0.42   // each generation is far less likely to jump again
const FIRE_CHILD_ENERGY = 0.62   // children inherit less fuel than the parent had
const FIRE_MAX_GEN = 4      // hard stop so a single hit cannot tile the globe
const FIRE_MOLTEN_FLOOR = 0.45   // combustion sustained by a liquid crust, and no more

// --- Ejecta plume ---
// The column is buoyant hot vapour, not a ballistic rock. Its effective
// deceleration is a small fraction of surface gravity, which is why real
// eruption columns hang for minutes. 0.085 gives a ~4-6 s rise-and-collapse.
const PLUME_G = 0.085
const PLUME_V0 = 0.155  // launch velocity coefficient; v0 ~ sqrt(specific energy)
const PLUME_WIDEN = 0.055  // umbrella spread rate while rising
const PLUME_COLLAPSE_WIDEN = 0.16   // it mushrooms out much faster once it stalls
const PLUME_COOL_TAU = 3.2    // radiative + entrainment cooling of the column

// --- Tsunami ---
// Deep-water wave speed is sqrt(g*h) ~ 200 m/s: roughly 0.6x the speed of
// sound, so the tsunami must visibly trail the shock ring. Same compression.
const TSUNAMI_SPEED = 0.21
const TSUNAMI_DISSIPATE = 0.055  // viscous/turbulent loss per second of travel
const TSUNAMI_DIE_AMP = 0.012

// --- Shock ring ---
// Overpressure wave starts supersonic and relaxes to the local speed of sound.
const SHOCK_SPEED = 0.62
const SHOCK_FADE = 0.55   // opacity units per second

// --- Global climate ---
const T_BASELINE = 288      // K, pre-bombardment mean surface temperature
const T_RELAX_TAU = 60       // radiative relaxation time at the baseline temperature
// Radiation goes as T^4, so the relaxation *rate* rises as T^3. That non-linear
// term is what gives the planet a real temperature ceiling instead of letting
// the fire->heat->fire loop run away. It is applied as an exact exponential
// step (see update) because an explicit Euler step on a rate this stiff would
// oscillate and then explode.
const T_RADIATIVE_EXP = 3
const T_FIRE_GAIN = 12       // K/s per unit of area-weighted burning intensity.
//                              Deliberately below the self-sustaining level: fires
//                              alone plateau near 1000 K, so reaching `molten`
//                              requires *ongoing* bombardment, not just old fires.
const T_PLUME_GAIN = 20       // K/s per unit of total column heat
// Hypervelocity impacts deposit their yield as heat directly at the site — this,
// not the secondary fires, is what actually melts a crust. Water absorbs most of
// its share as latent heat of vaporisation instead, and ice as heat of fusion.
const T_IMPACT_HEAT = 26
const T_IMPACT_OCEAN = 0.3
const T_IMPACT_ICE = 0.45
const T_MOLTEN = 1200     // basalt solidus is ~1250 K — past here the crust is lava
const T_FLOOR = 40       // nothing radiates below the ambient sky temperature
const DUST_GAIN = 0.02     // opacity added per unit plume-heat-second
const DUST_FALLOUT = 0.12     // extra opacity dumped when a column collapses
const DUST_SETTLE_TAU = 115      // stratospheric aerosol fallout. Must be SLOWER than the
//                              surface's radiative cooling time (~35 s at 260 K) or the
//                              sky clears before the ground gets cold and the whole
//                              nuclear-winter state becomes unreachable.
const DUST_COOLING = 165      // K of equilibrium suppression at full dust load
const SEISMIC_TAU = 5.5      // aftershock ringdown
const SEISMIC_COUPLE = 0.85     // fraction of impact energy that goes into the mantle
const OCEAN_RELAX_TAU = 38       // ice sheets have enormous thermal inertia
const OCEAN_MIN = 0        // fully boiled off
const OCEAN_MAX = 1.6      // every ice cap melted

// --- Cascade ---
// The chain reaction: enough accumulated seismic energy and the crust fails
// somewhere else entirely. The trigger level ratchets up after each event and
// then relaxes back down, so one sustained beam cannot machine-gun fissures,
// but an escalating bombardment keeps cracking new ground.
const CASCADE_ON = 2.4
const CASCADE_RATCHET = 1.35  // next event needs 35% more stored energy than this one left
const CASCADE_REARM_TAU = 8     // ...and that requirement decays back to CASCADE_ON
const CASCADE_COOLDOWN = 0.9
const CASCADE_RELEASE = 0.55  // stress relieved by the failure itself
const FISSURE_GROW_TAU = 2.6   // crack propagation decelerates as stress relieves

// ---------------------------------------------------------------------------
// Scratch — module level so update() and impact() never allocate.
// ---------------------------------------------------------------------------
const _up = new THREE.Vector3()
const _t1 = new THREE.Vector3()
const _t2 = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _axis = new THREE.Vector3()

/** Build an orthonormal tangent basis (_t1,_t2) around a unit normal. */
function basis(up) {
  _axis.set(0, 1, 0)
  if (Math.abs(up.y) > 0.9) _axis.set(1, 0, 0)
  _t1.crossVectors(_axis, up).normalize()
  _t2.crossVectors(up, _t1).normalize()
}

/** Offset `up` by `ang` radians along the surface in a random azimuth -> out. */
function offsetOnSphere(up, ang, out) {
  basis(up)
  const a = Math.random() * Math.PI * 2
  const s = Math.sin(ang)
  out.copy(up).multiplyScalar(Math.cos(ang))
    .addScaledVector(_t1, Math.cos(a) * s)
    .addScaledVector(_t2, Math.sin(a) * s)
    .normalize()
}

/** Uniform point on the sphere (z-slice method — cos(theta) is uniform). */
function randomOnSphere(out) {
  const z = Math.random() * 2 - 1
  const phi = Math.random() * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  out.set(r * Math.cos(phi), z, r * Math.sin(phi))
  return out
}

export class EnvironmentSim {
  constructor({ planetRadius = 1, maxFires = 64, maxPlumes = 32 } = {}) {
    this.planetRadius = planetRadius
    this.maxFires = maxFires
    this.maxPlumes = maxPlumes
    // Waves are cheap to draw and short lived; fissures are permanent scars so
    // the pool is small and reused oldest-first.
    this.maxTsunamis = Math.max(8, maxPlumes >> 1)
    this.maxRings = Math.max(12, maxPlumes)
    this.maxFissures = 24

    this._fires = new Array(maxFires)
    for (let i = 0; i < maxFires; i++) {
      this._fires[i] = {
        alive: false, dir: new THREE.Vector3(0, 1, 0),
        radius: 0, maxRadius: 0, intensity: 0, age: 0,
        gen: 0, spreadTimer: 0, seed: 0,
      }
    }

    this._plumes = new Array(maxPlumes)
    for (let i = 0; i < maxPlumes; i++) {
      this._plumes[i] = {
        alive: false, dir: new THREE.Vector3(0, 1, 0),
        height: 0, vel: 0, peak: 0, width: 0, heat: 0, age: 0,
        collapsing: false, steam: false, seed: 0,
      }
    }

    this._tsunamis = new Array(this.maxTsunamis)
    for (let i = 0; i < this.maxTsunamis; i++) {
      this._tsunamis[i] = {
        alive: false, dir: new THREE.Vector3(0, 1, 0),
        radius: 0, radius0: 0, amp: 0, amp0: 0, age: 0, seed: 0,
      }
    }

    this._rings = new Array(this.maxRings)
    for (let i = 0; i < this.maxRings; i++) {
      this._rings[i] = {
        alive: false, dir: new THREE.Vector3(0, 1, 0),
        radius: 0, opacity: 0, strength: 0, speed: SHOCK_SPEED, age: 0,
      }
    }

    this._fissures = new Array(this.maxFissures)
    for (let i = 0; i < this.maxFissures; i++) {
      this._fissures[i] = {
        alive: false, dir: new THREE.Vector3(0, 1, 0),
        tangent: new THREE.Vector3(1, 0, 0),
        length: 0, maxLength: 0, width: 0, maxWidth: 0,
        growth: 0, glow: 0, age: 0, seed: 0,
      }
    }

    // Round-robin cursors so successive spawns spread across the pool instead
    // of always hammering index 0.
    this._cFire = 0; this._cPlume = 0; this._cTsu = 0; this._cRing = 0; this._cFis = 0

    this.reset()
  }

  // -------------------------------------------------------------------------
  // Pool allocation. Never grows, never allocates; falls back to evicting the
  // weakest member so a fresh, loud event always wins over a dying one.
  // -------------------------------------------------------------------------

  _take(pool, cursorKey, weakness) {
    const n = pool.length
    let c = this[cursorKey]
    for (let k = 0; k < n; k++) {
      const i = (c + k) % n
      if (!pool[i].alive) {
        this[cursorKey] = (i + 1) % n
        return pool[i]
      }
    }
    // Pool saturated — evict the least significant entry.
    let worst = 0, worstScore = Infinity
    for (let i = 0; i < n; i++) {
      const s = weakness(pool[i])
      if (s < worstScore) { worstScore = s; worst = i }
    }
    this[cursorKey] = (worst + 1) % n
    return pool[worst]
  }

  _wFire(f) { return f.intensity }
  _wPlume(p) { return p.heat * (p.collapsing ? 0.5 : 1) }
  _wTsu(t) { return t.amp }
  _wRing(r) { return r.opacity }
  _wFis(f) { return -f.age } // evict the oldest scar

  // -------------------------------------------------------------------------
  // Spawners
  // -------------------------------------------------------------------------

  igniteFire(dir, energy, gen = 0) {
    const f = this._take(this._fires, '_cFire', this._wFire)
    f.alive = true
    f.dir.copy(dir).normalize()
    f.age = 0
    f.gen = gen
    // Intensity saturates: you cannot burn a square metre harder than it burns.
    f.intensity = Math.min(1.6, 0.45 + energy * 0.55)
    f.radius = 0.006 + energy * 0.010
    // Burn area scales sub-linearly with yield — the fuel available is finite.
    f.maxRadius = Math.min(0.42, 0.05 + Math.pow(energy, 0.55) * 0.22) * (gen ? 0.6 : 1)
    f.spreadTimer = FIRE_SPREAD_INTERVAL * (0.5 + Math.random())
    f.seed = Math.random() * 1000
    return f
  }

  spawnPlume(dir, energy, { steam = false } = {}) {
    const p = this._take(this._plumes, '_cPlume', this._wPlume)
    p.alive = true
    p.dir.copy(dir).normalize()
    // Ejecta launch speed goes as sqrt of specific energy (v = sqrt(2E/m)).
    p.vel = PLUME_V0 * Math.sqrt(energy) * (steam ? 1.25 : 1) // steam is lighter, flies higher
    p.height = 0.001
    p.peak = 0.001
    p.width = 0.012 + energy * 0.012
    p.heat = steam ? 0.45 : Math.min(1.5, 0.55 + energy * 0.5)
    p.age = 0
    p.collapsing = false
    p.steam = steam
    p.seed = Math.random() * 1000
    return p
  }

  spawnTsunami(dir, energy) {
    const t = this._take(this._tsunamis, '_cTsu', this._wTsu)
    t.alive = true
    t.dir.copy(dir).normalize()
    // Start the wave at the rim of the transient water cavity, not at zero —
    // a point source would give an infinite amplitude in the 1/sqrt spreading.
    t.radius0 = 0.02 + Math.pow(energy, 0.4) * 0.03
    t.radius = t.radius0
    t.amp0 = Math.min(1.4, Math.pow(energy, 0.6) * 0.9)
    t.amp = t.amp0
    t.age = 0
    t.seed = Math.random() * 1000
    return t
  }

  spawnRing(dir, energy) {
    const r = this._take(this._rings, '_cRing', this._wRing)
    r.alive = true
    r.dir.copy(dir).normalize()
    r.radius = 0.01
    r.strength = Math.min(1.5, 0.3 + energy * 0.8)
    r.opacity = Math.min(1, 0.35 + energy * 0.6)
    // Strong blasts start supersonic; weak ones travel at ambient sound speed.
    r.speed = SHOCK_SPEED * (1 + Math.min(0.8, energy * 0.35))
    r.age = 0
    return r
  }

  spawnFissure(dir, energy) {
    const f = this._take(this._fissures, '_cFis', this._wFis)
    f.alive = true
    f.dir.copy(dir).normalize()
    // Crack runs along an arbitrary great circle through the nucleation point.
    basis(f.dir)
    const a = Math.random() * Math.PI * 2
    f.tangent.copy(_t1).multiplyScalar(Math.cos(a)).addScaledVector(_t2, Math.sin(a)).normalize()
    f.length = 0.01
    f.maxLength = Math.min(1.5, 0.15 + Math.pow(energy, 0.5) * 0.55)
    f.width = 0.002
    f.maxWidth = f.maxLength * 0.06 // rifts are ~20:1 long-to-wide
    f.growth = 1
    f.glow = 1 // exposed mantle, cools to black
    f.age = 0
    f.seed = Math.random() * 1000
    return f
  }

  // -------------------------------------------------------------------------
  // Impact entry point
  // -------------------------------------------------------------------------

  /**
   * Register a hit.
   * @param {THREE.Vector3} localDir  surface normal at the impact, planet-local
   * @param {number} energy           arbitrary yield unit (see thresholds above)
   * @param {{ocean?:boolean, ice?:boolean}} opts surface type at that point
   */
  impact(localDir, energy = 1, opts = {}) {
    if (!localDir || !(energy > 0)) return
    const ocean = !!opts.ocean
    const ice = !!opts.ice
    _dir.copy(localDir)
    const len = _dir.length()
    if (len < 1e-6) return
    _dir.multiplyScalar(1 / len)

    // Every impact couples into the mantle and into the air, regardless of
    // what it landed on.
    this._seismic += energy * SEISMIC_COUPLE
    this.spawnRing(_dir, energy)

    if (ocean) {
      // Water is incompressible and a superb energy coupler: no fire, a big
      // wave, and a flash-boiled steam column instead of a rock one.
      this._temp += energy * T_IMPACT_HEAT * T_IMPACT_OCEAN
      if (energy >= E_TSUNAMI) this.spawnTsunami(_dir, energy)
      if (energy >= E_PLUME * 0.6) this.spawnPlume(_dir, energy * 0.8, { steam: true })
      this._oceanBias += energy * 0.004 // vaporised water returns as rain
    } else if (ice) {
      // Nothing to burn on an ice sheet; it sublimates instead. The meltwater
      // is a real sea-level contribution.
      this._temp += energy * T_IMPACT_HEAT * T_IMPACT_ICE
      if (energy >= E_PLUME * 0.5) this.spawnPlume(_dir, energy, { steam: true })
      this._oceanBias += energy * 0.02
      this._dust += energy * 0.01 // fine ice crystals are excellent scatterers
    } else {
      this._temp += energy * T_IMPACT_HEAT
      if (energy >= E_IGNITE) this.igniteFire(_dir, energy, 0)
      if (energy >= E_PLUME) this.spawnPlume(_dir, energy, { steam: false })
      if (energy >= E_FISSURE) this.spawnFissure(_dir, energy * 0.8)
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  update(delta) {
    // Clamp: a tab-out delta would teleport every wave past the antipode and
    // blow the explicit temperature integrator apart.
    const dt = Math.min(Math.max(delta || 0, 0), 0.05)
    if (dt <= 0) return

    this.time += dt

    let fireTotal = 0
    let plumeHeat = 0
    let nFires = 0, nPlumes = 0, nTsunamis = 0, nRings = 0, nFissures = 0

    // --- Firestorms -------------------------------------------------------
    for (let i = 0; i < this.maxFires; i++) {
      const f = this._fires[i]
      if (!f.alive) continue
      f.age += dt

      // Front advances while there is flame to push it; stalls at the fuel cap.
      if (f.radius < f.maxRadius) {
        f.radius = Math.min(f.maxRadius, f.radius + FIRE_SPREAD_RATE * f.intensity * dt)
      }
      // Exponential fuel burn-off.
      f.intensity -= (f.intensity / FIRE_BURN_TAU) * dt
      // On a crust hot enough to be liquid there is nothing left to extinguish:
      // combustion is topped back up, but only to a low ceiling, so fires can
      // never be the sole thing keeping the planet molten. Once bombardment
      // stops the temperature falls below the solidus and they all die out.
      if (this._temp > T_MOLTEN && f.intensity < FIRE_MOLTEN_FLOOR) {
        f.intensity += 0.08 * dt
      }

      // Spread to a neighbouring cell.
      f.spreadTimer -= dt
      if (f.spreadTimer <= 0) {
        f.spreadTimer = FIRE_SPREAD_INTERVAL * (0.6 + Math.random() * 0.8)
        if (f.gen < FIRE_MAX_GEN && f.intensity > 0.25) {
          const p = FIRE_SPREAD_P * f.intensity * Math.pow(FIRE_GEN_FALLOFF, f.gen)
          if (Math.random() < p) {
            // Child ignites just outside the parent's burnt-out perimeter.
            offsetOnSphere(f.dir, f.radius * (1.05 + Math.random() * 0.6), _up)
            this.igniteFire(_up, f.intensity * FIRE_CHILD_ENERGY, f.gen + 1)
          }
        }
      }

      if (f.intensity <= FIRE_DIE_INTENSITY) { f.alive = false; continue }
      // Heat release scales with burning *area*, and the area of a spherical cap
      // of angular radius r goes as r^2 for small r — not as r.
      fireTotal += f.intensity * f.radius * f.radius * 8
      nFires++
    }

    // --- Ejecta plumes ----------------------------------------------------
    for (let i = 0; i < this.maxPlumes; i++) {
      const p = this._plumes[i]
      if (!p.alive) continue
      p.age += dt

      p.vel -= PLUME_G * dt
      p.height += p.vel * dt
      if (p.height > p.peak) p.peak = p.height
      if (!p.collapsing && p.vel <= 0) p.collapsing = true

      // Umbrella: slow lateral entrainment on the way up, fast gravity-current
      // spreading once the column stalls and falls back on itself.
      p.width += (p.collapsing ? PLUME_COLLAPSE_WIDEN : PLUME_WIDEN) * dt
      p.heat -= (p.heat / PLUME_COOL_TAU) * dt

      if (p.height <= 0 || p.heat < 0.02) {
        p.alive = false
        // Collapse dumps its remaining load into the stratosphere.
        this._dust += p.peak * (p.steam ? 0.25 : 1.0) * DUST_FALLOUT
        continue
      }
      plumeHeat += p.heat * (p.steam ? 0.4 : 1) // steam radiates away, ash retains
      // Airborne injection while the column is standing.
      this._dust += DUST_GAIN * p.heat * (p.steam ? 0.3 : 1) * dt
      nPlumes++
    }

    // --- Tsunamis ---------------------------------------------------------
    for (let i = 0; i < this.maxTsunamis; i++) {
      const t = this._tsunamis[i]
      if (!t.alive) continue
      t.age += dt
      t.radius += TSUNAMI_SPEED * dt

      // Geometric spreading. The wavefront is a circle of circumference
      // 2*pi*R*|sin(theta)|; energy per unit crest length goes as 1/|sin(theta)|
      // and amplitude as its square root. For small theta, sin(theta) ~ theta,
      // so this is exactly the 1/sqrt(radius) falloff — but the sin form also
      // reproduces the real behaviour of a wave on a globe: it re-converges and
      // spikes again at the antipode, then again back at the epicentre.
      // Capped at 1: refocusing can at most restore the crest energy density it
      // launched with, never exceed it (real dispersion smears the focus).
      const s0 = Math.sin(Math.min(t.radius0, Math.PI * 0.5))
      const sN = Math.abs(Math.sin(t.radius))
      const spread = Math.sqrt(s0 / Math.max(sN, s0))
      // Plus genuine dissipation, which the antipodal focus cannot undo.
      const loss = Math.exp(-TSUNAMI_DISSIPATE * t.age)
      t.amp = t.amp0 * spread * loss

      // Dies after one full circuit of the globe, or when it is no longer a wave.
      if (t.radius >= Math.PI * 2 || t.amp < TSUNAMI_DIE_AMP) { t.alive = false; continue }
      nTsunamis++
    }

    // --- Shock rings ------------------------------------------------------
    for (let i = 0; i < this.maxRings; i++) {
      const r = this._rings[i]
      if (!r.alive) continue
      r.age += dt
      r.radius += r.speed * dt
      r.opacity -= SHOCK_FADE * dt
      if (r.opacity <= 0 || r.radius >= Math.PI) { r.alive = false; r.opacity = 0; continue }
      nRings++
    }

    // --- Fissures ---------------------------------------------------------
    for (let i = 0; i < this.maxFissures; i++) {
      const f = this._fissures[i]
      if (!f.alive) continue
      f.age += dt
      if (f.growth > 0.001) {
        // Crack tip decelerates as the stored elastic stress is relieved.
        const step = f.growth * dt
        f.length += (f.maxLength - f.length) * step
        f.width += (f.maxWidth - f.width) * step * 0.6
        f.growth -= (f.growth / FISSURE_GROW_TAU) * dt
      }
      // Exposed mantle cools toward the ambient surface, so a rift on a molten
      // world stays lit while one on a frozen world goes dark.
      const glowFloor = Math.min(0.85, Math.max(0, (this._temp - 600) / 900))
      if (f.glow > glowFloor) f.glow -= 0.055 * dt
      else f.glow = glowFloor
      nFissures++
    }

    // --- Global state -----------------------------------------------------

    // Dust settles out of the stratosphere.
    this._dust -= (this._dust / DUST_SETTLE_TAU) * dt
    if (this._dust < 0) this._dust = 0
    if (this._dust > 1) this._dust = 1

    // Seismic ringdown.
    this._seismic -= (this._seismic / SEISMIC_TAU) * dt
    if (this._seismic < 1e-4) this._seismic = 0

    // Temperature: heating from combustion and hot ejecta, relaxing toward an
    // equilibrium that dust itself drags down. That coupling is the whole
    // nuclear-winter mechanism — burn the world hard enough and the soot you
    // lofted freezes it afterwards.
    const tEq = T_BASELINE - DUST_COOLING * this._dust
    this._temp += (T_FIRE_GAIN * fireTotal + T_PLUME_GAIN * plumeHeat) * dt
    // Stefan-Boltzmann: emitted power goes as T^4, so the relaxation rate goes
    // as T^3. Integrated exactly over the step (T -> Teq + dT*exp(-k*dt)) rather
    // than as an Euler step, because k reaches ~10^2/s on a molten planet and an
    // explicit step would overshoot past absolute zero and diverge.
    const k = (1 + Math.pow(this._temp / T_BASELINE, T_RADIATIVE_EXP)) / T_RELAX_TAU
    this._temp = tEq + (this._temp - tEq) * Math.exp(-k * dt)
    if (this._temp < T_FLOOR) this._temp = T_FLOOR

    // Sea level. Warming melts the caps, cooling locks them up again — but past
    // the boiling point the whole hydrosphere starts leaving for orbit, so a
    // molten world ends up with no ocean at all rather than a very deep one.
    this._oceanBias -= (this._oceanBias / 90) * dt
    const melt = Math.max(-0.45, Math.min(0.35, (this._temp - 273) / 340))
    const boil = -Math.min(1.4, Math.max(0, (this._temp - 373) / 200))
    let oceanTarget = 1 + melt + boil + this._oceanBias
    if (oceanTarget < OCEAN_MIN) oceanTarget = OCEAN_MIN
    else if (oceanTarget > OCEAN_MAX) oceanTarget = OCEAN_MAX
    this._ocean += ((oceanTarget - this._ocean) / OCEAN_RELAX_TAU) * dt

    // --- Cascade ----------------------------------------------------------
    // Past the threshold the crust fails somewhere it was never hit. The
    // threshold ratchets up on each failure and relaxes back, which keeps a
    // sustained beam from stuttering out fissures every tick while still letting
    // an escalating bombardment keep cracking fresh ground.
    this._cascadeCool -= dt
    this._cascadeLevel -= ((this._cascadeLevel - CASCADE_ON) / CASCADE_REARM_TAU) * dt
    if (this._seismic > this._cascadeLevel && this._cascadeCool <= 0) {
      this._cascadeCool = CASCADE_COOLDOWN
      this.cascades++
      // Bigger quakes crack more places at once.
      const n = 1 + Math.min(3, Math.floor(this._seismic / CASCADE_ON))
      for (let k2 = 0; k2 < n; k2++) {
        randomOnSphere(_up)
        const e = this._seismic * (0.25 + Math.random() * 0.5)
        this.spawnFissure(_up, e)
        // A rift is a vent: it throws its own plume and lights its own fires.
        // Unless the world has no dry land left to burn — a fissure under an
        // ocean vents steam, it does not start a firestorm.
        const dry = this._ocean < 1.25
        if (Math.random() < 0.55) this.spawnPlume(_up, e * 0.6, { steam: !dry })
        if (dry && Math.random() < 0.4) this.igniteFire(_up, e * 0.4, 1)
        this.spawnRing(_up, e * 0.3)
      }
      // Releasing stress relieves some of the load that triggered it.
      this._seismic *= CASCADE_RELEASE
      this._cascadeLevel = Math.max(CASCADE_ON, this._seismic * CASCADE_RATCHET)
    }

    // --- Derived climate --------------------------------------------------
    // Order matters, and temperature outranks dust: a soot-black sky over an
    // 800 K surface is a scorched world, not a winter. A winter needs the
    // surface to have actually gone cold.
    if (this._temp >= T_MOLTEN) this._climate = 'molten'
    else if (this._temp <= 245 || (this._dust >= 0.5 && this._temp < T_BASELINE)) {
      this._climate = 'nuclear-winter'
    } else if (
      this._dust >= 0.12 || this._temp >= 320 || this._seismic >= 1.2 || nFires > 3
    ) this._climate = 'disrupted'
    else this._climate = 'stable'

    this.counts.fires = nFires
    this.counts.plumes = nPlumes
    this.counts.tsunamis = nTsunamis
    this.counts.rings = nRings
    this.counts.fissures = nFissures
    this.counts.fireTotal = fireTotal
  }

  reset() {
    for (let i = 0; i < this._fires.length; i++) this._fires[i].alive = false
    for (let i = 0; i < this._plumes.length; i++) this._plumes[i].alive = false
    for (let i = 0; i < this._tsunamis.length; i++) this._tsunamis[i].alive = false
    for (let i = 0; i < this._rings.length; i++) this._rings[i].alive = false
    for (let i = 0; i < this._fissures.length; i++) this._fissures[i].alive = false

    this.time = 0
    this._dust = 0
    this._temp = T_BASELINE
    this._ocean = 1
    this._oceanBias = 0
    this._seismic = 0
    this._climate = 'stable'
    this._cascadeLevel = CASCADE_ON
    this._cascadeCool = 0
    this.cascades = 0
    this.counts = { fires: 0, plumes: 0, tsunamis: 0, rings: 0, fissures: 0, fireTotal: 0 }
  }

  // -------------------------------------------------------------------------
  // Read-only views. The arrays are the live pools — consumers must respect
  // the `alive` flag and must not mutate.
  // -------------------------------------------------------------------------

  get fires() { return this._fires }
  get plumes() { return this._plumes }
  get tsunamis() { return this._tsunamis }
  get rings() { return this._rings }
  get fissures() { return this._fissures }

  get dustLoading() { return this._dust }
  get surfaceTemp() { return this._temp }
  get oceanLevel() { return this._ocean }
  get seismicEnergy() { return this._seismic }
  get climate() { return this._climate }
}

export default EnvironmentSim
