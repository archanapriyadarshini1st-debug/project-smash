import { useRef, useMemo, useEffect, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { weaponFor, WEAPONS } from './registry.js'
import { createBeamMaterial } from './beamMaterial.js'
import { useStore } from '../state/useStore.js'

/**
 * WeaponSystem — delivery, impact and consequence.
 *
 * Everything here happens in real 3D space. A beam is geometry spanning an
 * emitter and an impact point. A projectile is a mesh that physically travels.
 * An impact writes into the shared damage field, which the surface shader reads
 * to displace terrain — so destruction is simulation state, never a decal.
 *
 * The hot path is ref-driven. Zustand is written at ~5 Hz for telemetry and on
 * discrete events, never per frame.
 */

const UP = new THREE.Vector3(0, 1, 0)
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _localDir = new THREE.Vector3()
const _prevLocal = new THREE.Vector3()
const _ndc = new THREE.Vector2()

export function WeaponSystem({ planetRef, debrisRef }) {
  const { camera, raycaster, gl, scene } = useThree()

  const activeWeapon = useStore((s) => s.activeWeapon)
  const setAim = useStore((s) => s.setAim)
  const setFiring = useStore((s) => s.setFiring)
  const setTelemetry = useStore((s) => s.setTelemetry)
  const pushEvent = useStore((s) => s.pushEvent)
  const resetSignal = useStore((s) => s.resetSignal)
  const budget = useStore((s) => s.budget)

  // ---- transient state, refs only ---------------------------------------
  const state = useRef({
    pointer: new THREE.Vector2(0, 0),
    hasPointer: false,
    down: false,
    hit: null,           // { point: Vector3, localDir: Vector3, normal: Vector3 }
    prevLocal: null,
    charge: 0,
    cooldown: 0,
    debrisAcc: 0,
    telemetryAcc: 0,
    aimAcc: 0,
    population: 8.1e9,
    atmosphere: 1,
    announced: { crater: false, breach: false, half: false, dead: false },
  }).current

  // ---- beam -------------------------------------------------------------
  const beam = useMemo(() => createBeamMaterial({}), [])
  const beamRef = useRef()
  const beamLightRef = useRef()

  // ---- projectiles & effects (pooled) ------------------------------------
  const projectiles = useRef([]).current
  const shockwaves = useRef([]).current
  const projGroupRef = useRef()
  const fxGroupRef = useRef()

  const projGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 8), [])
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.82, 1, 48), [])
  const wellGeo = useMemo(() => new THREE.SphereGeometry(1, 24, 16), [])

  const wellRef = useRef()
  const well = useRef({ active: false, t: 0, duration: 0, pull: 0, pos: new THREE.Vector3() }).current

  useEffect(() => () => {
    projGeo.dispose(); ringGeo.dispose(); wellGeo.dispose(); beam.material.dispose()
  }, [projGeo, ringGeo, wellGeo, beam])

  // ---- reset -------------------------------------------------------------
  useEffect(() => {
    projectiles.length = 0
    shockwaves.length = 0
    well.active = false
    state.population = 8.1e9
    state.atmosphere = 1
    state.charge = 0
    state.announced = { crater: false, breach: false, half: false, dead: false }
  }, [resetSignal, projectiles, shockwaves, well, state])

  // ---- input -------------------------------------------------------------
  useEffect(() => {
    const el = gl.domElement

    const setFromEvent = (e) => {
      const r = el.getBoundingClientRect()
      state.pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      )
      state.hasPointer = true
    }

    const onMove = (e) => setFromEvent(e)
    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return
      setFromEvent(e)
      state.down = true
      state.prevLocal = null
      setFiring(true)
    }
    const onUp = () => {
      if (!state.down) return
      state.down = false
      state.charge = 0
      state.prevLocal = null
      setFiring(false)
    }
    const onLeave = () => { state.hasPointer = false; onUp() }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [gl, setFiring, state])

  // Keyboard weapon select 1..8
  useEffect(() => {
    const ids = Object.keys(WEAPONS)
    const onKey = (e) => {
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= ids.length) useStore.getState().setWeapon(ids[n - 1])
      if (e.key === 'r' || e.key === 'R') useStore.getState().reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- impact ------------------------------------------------------------
  const applyImpact = useCallback((planet, w, localDir, scale = 1) => {
    const damage = planet.damage
    damage.stamp(localDir, w.radius * scale, {
      depth: w.depth * scale,
      heat: w.heat,
      scorch: w.scorch,
      penetration: w.penetration * scale,
      falloff: w.falloff,
      jagged: w.jagged,
    })

    const debris = debrisRef.current
    if (debris) {
      const n = Math.round((w.debrisBurst || 20) * (budget.debrisMax / 900) * scale)
      debris.burst(localDir, Math.max(4, n), {
        speed: w.debrisSpeed || 0.6,
        size: 0.008 + w.radius * 0.12,
        spread: 0.9,
        heat: 1,
      })
    }

    if (w.disturb) planet.disturb(w.disturb * scale)
    if (w.atmoStrip) state.atmosphere = planet.thinAtmosphere(w.atmoStrip * scale)
    if (w.lethality) state.population = planet.killPopulation(Math.min(0.9, w.lethality * scale))

    // Expanding shockwave ring, oriented flat on the surface.
    if (w.blast) {
      shockwaves.push({
        t: 0,
        life: 1.1,
        max: planet.radius * (0.35 + w.blast * 2.2),
        dir: localDir.clone(),
        color: w.color,
      })
    }
  }, [debrisRef, budget.debrisMax, shockwaves, state])

  const fire = useCallback((planet, w, hit) => {
    if (w.kind === 'projectile') {
      if (state.cooldown > 0) return
      state.cooldown = w.cooldown || 0.5

      // Launch from well outside the planet, offset from the camera so the
      // rod visibly crosses space rather than popping into existence.
      const origin = hit.point.clone()
        .sub(camera.position).normalize().multiplyScalar(-planet.radius * 6)
        .add(hit.point)
      projectiles.push({
        w,
        origin: origin.clone(),
        pos: origin.clone(),
        target: hit.point.clone(),
        localDir: hit.localDir.clone(),
        travelled: 0,
        total: origin.distanceTo(hit.point),
      })
    } else if (w.kind === 'field') {
      well.active = true
      well.t = 0
      well.duration = w.duration || 3
      well.pull = w.pull || 2
      well.pos.copy(hit.point)
      applyImpact(planet, w, hit.localDir, 0.6)
      pushEvent(`${w.name} opened`, 'warn')
    }
  }, [camera, projectiles, well, applyImpact, pushEvent, state])

  // ---- frame -------------------------------------------------------------
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20)
    const planet = planetRef.current
    if (!planet || !planet.mesh) return

    const w = weaponFor(activeWeapon)
    beam.uniforms.uTime.value += delta
    if (state.cooldown > 0) state.cooldown -= delta

    // ---- targeting raycast ---------------------------------------------
    let hit = null
    if (state.hasPointer) {
      _ndc.copy(state.pointer)
      raycaster.setFromCamera(_ndc, camera)
      const hits = raycaster.intersectObject(planet.mesh, false)
      if (hits.length) {
        const h = hits[0]
        _localDir.copy(h.point)
        planet.worldToLocalDir(_localDir)
        hit = {
          point: h.point.clone(),
          localDir: _localDir.clone(),
          normal: h.point.clone().sub(planet.group.position).normalize(),
        }
        state.hit = hit
      } else {
        state.hit = null
      }
    }

    // Push aim to the store at ~20Hz, only when it actually moved.
    state.aimAcc += delta
    if (state.aimAcc > 0.05) {
      state.aimAcc = 0
      const cur = state.hit
      const prev = useStore.getState().aim
      const moved = !prev !== !cur || (cur && prev && cur.point.distanceToSquared(prev.point) > 1e-6)
      if (moved) setAim(cur ? { point: cur.point, localDir: cur.localDir, normal: cur.normal } : null)
    }

    // ---- beam weapons ---------------------------------------------------
    const beamMesh = beamRef.current
    const firingBeam = state.down && state.hit && w.kind === 'beam'

    if (firingBeam) {
      if (w.charge && state.charge < w.charge) {
        state.charge += delta
      } else {
        const hitPoint = state.hit.point
        // Emitter sits behind and above the camera so the beam crosses space.
        _v1.copy(camera.position).addScaledVector(
          _v2.copy(hitPoint).sub(camera.position).normalize(), -planet.radius * 0.25
        )

        _dir.copy(hitPoint).sub(_v1)
        const len = _dir.length()
        _mid.copy(_v1).addScaledVector(_dir, 0.5)
        _q.setFromUnitVectors(UP, _dir.clone().normalize())

        beamMesh.visible = true
        beamMesh.position.copy(_mid)
        beamMesh.quaternion.copy(_q)
        beamMesh.scale.set(w.beamWidth * planet.radius * 6, len, w.beamWidth * planet.radius * 6)

        beam.uniforms.uColor.value.copy(w.color)
        beam.uniforms.uCoreColor.value.copy(w.coreColor)
        beam.uniforms.uFlicker.value = w.flicker || 16
        beam.uniforms.uIntensity.value = 1.6

        // Continuous excavation. Dragging sweeps an arc, so the player carves.
        const cur = state.hit.localDir
        const opts = {
          depth: w.depth * delta,
          heat: w.heat * delta,
          scorch: w.scorch * delta,
          penetration: w.penetration * delta,
          falloff: w.falloff,
          jagged: w.jagged,
        }
        if (state.prevLocal && state.prevLocal.angleTo(cur) > 1e-4) {
          _prevLocal.copy(state.prevLocal)
          planet.damage.stampArc(_prevLocal, cur, w.radius, opts)
        } else {
          planet.damage.stamp(cur, w.radius, opts)
        }
        state.prevLocal = cur.clone()

        // Ejecta streaming out of the cut.
        state.debrisAcc += (w.debrisRate || 0) * delta * (budget.debrisMax / 900)
        const debris = debrisRef.current
        while (state.debrisAcc >= 1 && debris) {
          state.debrisAcc -= 1
          debris.burst(cur, 1, { speed: w.debrisSpeed || 0.3, size: 0.006 + w.radius * 0.08, spread: 1.1 })
        }

        if (w.disturb) planet.disturb(w.disturb * delta)
        if (w.lethality) state.population = planet.killPopulation(Math.min(0.02, w.lethality * delta * 6))

        if (beamLightRef.current) {
          beamLightRef.current.visible = true
          beamLightRef.current.position.copy(hitPoint)
          beamLightRef.current.color.copy(w.coreColor)
          beamLightRef.current.intensity = 2 + Math.sin(beam.uniforms.uTime.value * 40) * 0.4
        }
      }
    } else {
      if (beamMesh) beamMesh.visible = false
      if (beamLightRef.current) beamLightRef.current.visible = false
    }

    // Non-beam fire on press.
    if (state.down && state.hit && w.kind !== 'beam') {
      fire(planet, w, state.hit)
      if (w.kind === 'field') state.down = false
    }

    // ---- projectiles ----------------------------------------------------
    const projGroup = projGroupRef.current
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]
      p.travelled += p.w.speed * planet.radius * delta
      const t = Math.min(1, p.travelled / p.total)
      p.pos.lerpVectors(p.origin, p.target, t)

      if (t >= 1) {
        applyImpact(planet, p.w, p.localDir, 1)
        pushEvent(`${p.w.name} impact`, 'danger')
        projectiles.splice(i, 1)
      }
    }
    // Drive the pooled projectile meshes from the sim array.
    if (projGroup) {
      for (let i = 0; i < projGroup.children.length; i++) {
        const child = projGroup.children[i]
        const p = projectiles[i]
        if (!p) { child.visible = false; continue }
        child.visible = true
        child.position.copy(p.pos)
        child.scale.setScalar(p.w.projectileSize * planet.radius * 3)
        child.material.color.copy(p.w.coreColor)
        // Point the rod along its own velocity so it reads as a travelling body.
        _v1.copy(p.target).sub(p.origin).normalize()
        child.quaternion.setFromUnitVectors(UP, _v1)
      }
    }

    // ---- gravity well ---------------------------------------------------
    const debris = debrisRef.current
    if (well.active) {
      well.t += delta
      const k = 1 - well.t / well.duration
      if (k <= 0) {
        well.active = false
        debris?.setAttractor(null, 0)
        if (wellRef.current) wellRef.current.visible = false
      } else {
        // Attractor must be in the planet's local frame, where debris lives.
        _v1.copy(well.pos)
        planet.object.worldToLocal(_v1)
        debris?.setAttractor(_v1.clone(), well.pull * k)
        if (wellRef.current) {
          wellRef.current.visible = true
          wellRef.current.position.copy(well.pos)
          const s = planet.radius * 0.09 * (0.6 + Math.sin(well.t * 6) * 0.08) * k
          wellRef.current.scale.setScalar(Math.max(0.001, s))
        }
      }
    }

    // ---- shockwaves -----------------------------------------------------
    const fx = fxGroupRef.current
    if (fx) {
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i]
        s.t += delta
        const k = s.t / s.life
        const child = fx.children[i]
        if (k >= 1) { shockwaves.splice(i, 1); continue }
        if (!child) continue
        child.visible = true
        planet.localDirToWorld(s.dir, _v1, planet.radius * 0.02)
        child.position.copy(_v1)
        _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.dir.clone().applyQuaternion(planet.object.getWorldQuaternion(new THREE.Quaternion())))
        child.quaternion.copy(_q)
        child.scale.setScalar(Math.max(0.001, s.max * k))
        child.material.opacity = (1 - k) * 0.8
        child.material.color.copy(s.color)
      }
      for (let i = shockwaves.length; i < fx.children.length; i++) fx.children[i].visible = false
    }

    // ---- telemetry ------------------------------------------------------
    state.telemetryAcc += delta
    if (state.telemetryAcc > 0.2) {
      state.telemetryAcc = 0
      const integrity = planet.damage.integrity
      setTelemetry({
        integrity,
        craters: planet.damage.craterCount,
        debris: debris?.count ?? 0,
        population: state.population,
        atmosphere: state.atmosphere,
        coreExposed: planet.damage.breached ? 1 : 0,
      })

      const a = state.announced
      if (!a.crater && planet.damage.craterCount > 0) { a.crater = true; pushEvent('Surface breached — crater formed', 'info') }
      if (!a.breach && planet.damage.breached) { a.breach = true; pushEvent('CRUST PENETRATED — mantle exposed', 'danger') }
      if (!a.half && integrity < 0.5) { a.half = true; pushEvent('Planetary integrity below 50%', 'warn') }
      if (!a.dead && integrity < 0.08) { a.dead = true; pushEvent('WORLD DESTROYED', 'danger') }
    }
  })

  const maxWaves = 6
  const maxProjectiles = 12

  return (
    <group>
      {/* Real 3D beam: unit cylinder along +Y, scaled to span emitter->impact */}
      <mesh ref={beamRef} visible={false} material={beam.material} renderOrder={5}>
        <cylinderGeometry args={[1, 1, 1, 16, 1, true]} />
      </mesh>
      <pointLight ref={beamLightRef} visible={false} distance={3} decay={2} intensity={2} />

      <group ref={projGroupRef}>
        {Array.from({ length: maxProjectiles }).map((_, i) => (
          <mesh key={i} geometry={projGeo} visible={false} renderOrder={5}>
            <meshBasicMaterial toneMapped={false} />
          </mesh>
        ))}
      </group>

      <group ref={fxGroupRef}>
        {Array.from({ length: maxWaves }).map((_, i) => (
          <mesh key={i} geometry={ringGeo} visible={false} renderOrder={6}>
            <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <mesh ref={wellRef} geometry={wellGeo} visible={false} renderOrder={4}>
        <meshBasicMaterial color="#120a26" />
      </mesh>
    </group>
  )
}

export default WeaponSystem
