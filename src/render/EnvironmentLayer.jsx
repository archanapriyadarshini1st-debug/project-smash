import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { useStore } from '../state/useStore.js'

// ---------------------------------------------------------------------------
// Module-scope scratch. Nothing in this file allocates inside useFrame.
// ---------------------------------------------------------------------------
const _v = new Vector3()
const _u = new Vector3()
const _w = new Vector3()
const _side = new Vector3()
const _q = new Vector3()
const _quat = new Quaternion()
const _mat = new Matrix4()
const _colA = new Color()
const _colB = new Color()
const _col = new Color()

const UP_Z = new Vector3(0, 0, 1)
const UP_Y = new Vector3(0, 1, 0)
const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

// Fire palette: deep red at low intensity -> white-yellow at high.
const FIRE_COLD = new Color('#ff2200')
const FIRE_HOT = new Color('#fff0b0')
// Plume palette: orange -> white by heat, or pale blue-white for steam.
const PLUME_COOL = new Color('#ff6a18')
const PLUME_HOT = new Color('#fff6dc')
const PLUME_STEAM = new Color('#cfe8ff')
const FISSURE_COLOR = new Color('#ff5a12')

const HIDDEN_SCALE = 1e-6
const RING_SEGMENTS = 96

/**
 * Writes one closed great-circle-at-angular-radius loop into a LineSegments
 * position array as `segments` discrete segments (2 vertices each).
 *
 * A point at parametric angle `a` on the cone of half-angle `angRadius`
 * around `dir` is:
 *   (dir*cos(angRadius) + (u*cos(a) + v*sin(a))*sin(angRadius)) * radius
 *
 * `u`/`v` come from a stable orthonormal basis: cross `dir` with whichever
 * world axis is least aligned with it, then cross again.
 *
 * @returns the new write offset (offset + segments*6 floats).
 */
export function writeGreatCircle(positionsArray, offset, dir, angRadius, radius, segments) {
  _v.copy(dir)
  if (_v.lengthSq() < 1e-12) _v.copy(AXIS_Y)
  else _v.normalize()

  // Least-aligned world axis -> stable basis, no gimbal degeneracy.
  const ax = Math.abs(_v.x)
  const ay = Math.abs(_v.y)
  const az = Math.abs(_v.z)
  const axis = ax < ay ? (ax < az ? AXIS_X : AXIS_Z) : ay < az ? AXIS_Y : AXIS_Z

  _u.crossVectors(_v, axis).normalize()
  _w.crossVectors(_v, _u).normalize()

  const cosR = Math.cos(angRadius) * radius
  const sinR = Math.sin(angRadius) * radius
  const step = (Math.PI * 2) / segments

  let o = offset
  // Previous point, carried between iterations so each segment shares a vertex.
  let px = _v.x * cosR + _u.x * sinR
  let py = _v.y * cosR + _u.y * sinR
  let pz = _v.z * cosR + _u.z * sinR

  for (let i = 1; i <= segments; i++) {
    const a = i * step
    const ca = Math.cos(a) * sinR
    const sa = Math.sin(a) * sinR
    const nx = _v.x * cosR + _u.x * ca + _w.x * sa
    const ny = _v.y * cosR + _u.y * ca + _w.y * sa
    const nz = _v.z * cosR + _u.z * ca + _w.z * sa

    positionsArray[o++] = px
    positionsArray[o++] = py
    positionsArray[o++] = pz
    positionsArray[o++] = nx
    positionsArray[o++] = ny
    positionsArray[o++] = nz

    px = nx
    py = ny
    pz = nz
  }
  return o
}

function hideInstance(mesh, i) {
  _mat.makeScale(HIDDEN_SCALE, HIDDEN_SCALE, HIDDEN_SCALE)
  mesh.setMatrixAt(i, _mat)
}

export function EnvironmentLayer({ envRef, planetRadius = 1, parentRef }) {
  const debrisMax = useStore((s) => s.budget.debrisMax)
  const cap = debrisMax >= 600 ? 1 : debrisMax >= 300 ? 0.6 : 0.35

  // Portal host: the planet spin group. Resolve in an effect so we re-render
  // once the ref is populated.
  const [host, setHost] = useState(null)
  useEffect(() => {
    setHost(parentRef?.current ?? null)
  }, [parentRef, parentRef?.current])

  const fireRef = useRef(null)
  const plumeRef = useRef(null)
  const fissureRef = useRef(null)
  const tsunamiRef = useRef(null)
  const shockRef = useRef(null)

  // Pool sizes are read once from the sim's fixed-size arrays and scaled by
  // quality. If the sim isn't up yet we fall back to sane defaults.
  const sizes = useMemo(() => {
    const env = envRef?.current
    const len = (arr, fallback) => (arr && arr.length ? arr.length : fallback)
    const scale = (n) => Math.max(1, Math.floor(n * cap))
    return {
      fires: scale(len(env?.fires, 24)),
      plumes: scale(len(env?.plumes, 32)),
      fissures: scale(len(env?.fissures, 24)),
      tsunamis: scale(len(env?.tsunamis, 12)),
      rings: scale(len(env?.rings, 12)),
    }
  }, [envRef, cap])

  // --- geometries / materials, created once -------------------------------
  const fireGeom = useMemo(() => new PlaneGeometry(1, 1), [])
  const fissureGeom = useMemo(() => new PlaneGeometry(1, 1), [])
  const plumeGeom = useMemo(() => {
    // Cone points +Y; translate so the base sits at the local origin's -Y half,
    // i.e. keep it centred (spec positions the centre at radius + h*0.5).
    return new ConeGeometry(1, 1, 8, 1, true)
  }, [])

  const fireMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  )
  const plumeMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  )
  const fissureMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  )

  // --- line geometries for the two great-circle systems -------------------
  const tsunamiLine = useMemo(() => {
    const g = new BufferGeometry()
    const arr = new Float32Array(sizes.tsunamis * RING_SEGMENTS * 2 * 3)
    g.setAttribute('position', new BufferAttribute(arr, 3))
    g.setDrawRange(0, 0)
    return { geometry: g, array: arr }
  }, [sizes.tsunamis])

  const shockLine = useMemo(() => {
    const g = new BufferGeometry()
    const arr = new Float32Array(sizes.rings * RING_SEGMENTS * 2 * 3)
    g.setAttribute('position', new BufferAttribute(arr, 3))
    g.setDrawRange(0, 0)
    return { geometry: g, array: arr }
  }, [sizes.rings])

  const tsunamiMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color('#9ff3ff'),
        transparent: true,
        opacity: 0.75,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  )
  const shockMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color('#ffffff'),
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  )

  useEffect(
    () => () => {
      fireGeom.dispose()
      fissureGeom.dispose()
      plumeGeom.dispose()
      fireMat.dispose()
      plumeMat.dispose()
      fissureMat.dispose()
      tsunamiMat.dispose()
      shockMat.dispose()
    },
    [fireGeom, fissureGeom, plumeGeom, fireMat, plumeMat, fissureMat, tsunamiMat, shockMat]
  )

  useEffect(
    () => () => tsunamiLine.geometry.dispose(),
    [tsunamiLine]
  )
  useEffect(() => () => shockLine.geometry.dispose(), [shockLine])

  useFrame((state) => {
    const env = envRef?.current
    if (!env) return
    const t = state.clock.elapsedTime

    // ---------------- 1. FIRESTORMS -------------------------------------
    const fireMesh = fireRef.current
    if (fireMesh) {
      const fires = env.fires
      const max = sizes.fires
      let n = 0
      if (fires) {
        for (let i = 0; i < fires.length && n < max; i++) {
          const f = fires[i]
          if (!f || !f.alive) continue

          const intensity = Math.max(0, Math.min(1, f.intensity ?? 1))
          const flicker = Math.sin(t * 9 + (f.seed ?? i) * 13)
          const s = f.radius * planetRadius * 2 * (1 + flicker * 0.12)

          _v.copy(f.dir)
          if (_v.lengthSq() < 1e-12) _v.copy(AXIS_Y)
          else _v.normalize()

          _quat.setFromUnitVectors(UP_Z, _v)
          _q.copy(_v).multiplyScalar(planetRadius * 1.002)
          _mat.compose(_q, _quat, _side.set(s, s, 1))
          fireMesh.setMatrixAt(n, _mat)

          _col
            .copy(_colA.copy(FIRE_COLD))
            .lerp(_colB.copy(FIRE_HOT), intensity)
            .multiplyScalar(0.65 + intensity * 0.35 + flicker * 0.1)
          fireMesh.setColorAt(n, _col)
          n++
        }
      }
      for (let i = n; i < max; i++) hideInstance(fireMesh, i)
      fireMesh.count = max
      fireMesh.instanceMatrix.needsUpdate = true
      if (fireMesh.instanceColor) fireMesh.instanceColor.needsUpdate = true
      fireMesh.visible = n > 0
    }

    // ---------------- 2. EJECTA PLUMES ----------------------------------
    const plumeMesh = plumeRef.current
    if (plumeMesh) {
      const plumes = env.plumes
      const max = sizes.plumes
      let n = 0
      if (plumes) {
        for (let i = 0; i < plumes.length && n < max; i++) {
          const p = plumes[i]
          if (!p || !p.alive) continue

          _v.copy(p.dir)
          if (_v.lengthSq() < 1e-12) _v.copy(AXIS_Y)
          else _v.normalize()

          const h = Math.max(1e-4, p.height * planetRadius)
          const wdt = Math.max(1e-4, p.width)

          _quat.setFromUnitVectors(UP_Y, _v)
          // Cone is centred on its own origin, so lift by half its height to
          // seat the base on the surface.
          _q.copy(_v).multiplyScalar(planetRadius + p.height * planetRadius * 0.5)
          _mat.compose(_q, _quat, _side.set(wdt, h, wdt))
          plumeMesh.setMatrixAt(n, _mat)

          const heat = Math.max(0, Math.min(1, p.heat ?? 0.5))
          if (p.steam) {
            _col.copy(PLUME_STEAM).multiplyScalar(0.5 + heat * 0.4)
          } else {
            _col
              .copy(_colA.copy(PLUME_COOL))
              .lerp(_colB.copy(PLUME_HOT), heat)
              .multiplyScalar(0.55 + heat * 0.55)
          }
          if (p.collapsing) _col.multiplyScalar(0.6)
          plumeMesh.setColorAt(n, _col)
          n++
        }
      }
      for (let i = n; i < max; i++) hideInstance(plumeMesh, i)
      plumeMesh.count = max
      plumeMesh.instanceMatrix.needsUpdate = true
      if (plumeMesh.instanceColor) plumeMesh.instanceColor.needsUpdate = true
      plumeMesh.visible = n > 0
    }

    // ---------------- 5. FISSURES ---------------------------------------
    const fisMesh = fissureRef.current
    if (fisMesh) {
      const fissures = env.fissures
      const max = sizes.fissures
      let n = 0
      if (fissures) {
        for (let i = 0; i < fissures.length && n < max; i++) {
          const f = fissures[i]
          if (!f || !f.alive) continue

          _v.copy(f.dir)
          if (_v.lengthSq() < 1e-12) _v.copy(AXIS_Y)
          else _v.normalize()

          // Tangent, re-orthogonalised against the normal so the basis stays
          // rigid even if the sim drifts.
          _u.copy(f.tangent)
          _u.addScaledVector(_v, -_u.dot(_v))
          if (_u.lengthSq() < 1e-12) {
            const ax = Math.abs(_v.x)
            const ay = Math.abs(_v.y)
            const az = Math.abs(_v.z)
            const axis = ax < ay ? (ax < az ? AXIS_X : AXIS_Z) : ay < az ? AXIS_Y : AXIS_Z
            _u.crossVectors(_v, axis)
          }
          _u.normalize()
          _w.crossVectors(_v, _u).normalize() // dir x tangent -> in-plane binormal

          _mat.makeBasis(_u, _w, _v)
          _quat.setFromRotationMatrix(_mat)
          _q.copy(_v).multiplyScalar(planetRadius * 1.001)
          _mat.compose(
            _q,
            _quat,
            _side.set(
              Math.max(1e-4, f.length * planetRadius),
              Math.max(1e-4, f.width * planetRadius),
              1
            )
          )
          fisMesh.setMatrixAt(n, _mat)

          const glow = Math.max(0, f.glow ?? 1)
          _col.copy(FISSURE_COLOR).multiplyScalar(glow)
          fisMesh.setColorAt(n, _col)
          n++
        }
      }
      for (let i = n; i < max; i++) hideInstance(fisMesh, i)
      fisMesh.count = max
      fisMesh.instanceMatrix.needsUpdate = true
      if (fisMesh.instanceColor) fisMesh.instanceColor.needsUpdate = true
      fisMesh.visible = n > 0
    }

    // ---------------- 3. TSUNAMIS ---------------------------------------
    const tsu = tsunamiRef.current
    if (tsu) {
      const arr = tsunamiLine.array
      const items = env.tsunamis
      let offset = 0
      let n = 0
      let opacityAcc = 0
      if (items) {
        for (let i = 0; i < items.length && n < sizes.tsunamis; i++) {
          const w = items[i]
          if (!w || !w.alive) continue
          const amp0 = w.amp0 || 1
          const o = Math.max(0, Math.min(1, w.amp / amp0))
          offset = writeGreatCircle(
            arr,
            offset,
            w.dir,
            w.radius,
            planetRadius * 1.004,
            RING_SEGMENTS
          )
          opacityAcc += o
          n++
        }
      }
      tsunamiLine.geometry.setDrawRange(0, (offset / 3) | 0)
      tsunamiLine.geometry.attributes.position.needsUpdate = true
      tsunamiMat.opacity = n > 0 ? 0.25 + 0.6 * (opacityAcc / n) : 0
      tsu.visible = n > 0
    }

    // ---------------- 4. SHOCK RINGS ------------------------------------
    const shock = shockRef.current
    if (shock) {
      const arr = shockLine.array
      const items = env.rings
      let offset = 0
      let n = 0
      let opacityAcc = 0
      if (items) {
        for (let i = 0; i < items.length && n < sizes.rings; i++) {
          const r = items[i]
          if (!r || !r.alive) continue
          offset = writeGreatCircle(
            arr,
            offset,
            r.dir,
            r.radius,
            planetRadius * 1.006,
            RING_SEGMENTS
          )
          opacityAcc += Math.max(0, Math.min(1, r.opacity ?? 1))
          n++
        }
      }
      shockLine.geometry.setDrawRange(0, (offset / 3) | 0)
      shockLine.geometry.attributes.position.needsUpdate = true
      shockMat.opacity = n > 0 ? 0.35 * (opacityAcc / n) : 0
      shock.visible = n > 0
    }
  })

  if (!host) return null

  return createPortal(
    <group name="environment-layer">
      <instancedMesh
        ref={fireRef}
        args={[fireGeom, fireMat, sizes.fires]}
        frustumCulled={false}
        renderOrder={6}
      />
      <instancedMesh
        ref={plumeRef}
        args={[plumeGeom, plumeMat, sizes.plumes]}
        frustumCulled={false}
        renderOrder={7}
      />
      <instancedMesh
        ref={fissureRef}
        args={[fissureGeom, fissureMat, sizes.fissures]}
        frustumCulled={false}
        renderOrder={5}
      />
      <lineSegments
        ref={tsunamiRef}
        args={[tsunamiLine.geometry, tsunamiMat]}
        frustumCulled={false}
        renderOrder={8}
      />
      <lineSegments
        ref={shockRef}
        args={[shockLine.geometry, shockMat]}
        frustumCulled={false}
        renderOrder={8}
      />
    </group>,
    host
  )
}

export function EnvironmentTelemetry({ envRef }) {
  const setTelemetry = useStore((s) => s.setTelemetry)
  const acc = useRef(0)

  useFrame((_state, delta) => {
    acc.current += delta
    if (acc.current < 0.2) return
    acc.current = 0
    const env = envRef?.current
    if (!env) return
    setTelemetry({
      surfaceTemp: env.surfaceTemp,
      climate: env.climate,
      dust: env.dustLoading,
      seismic: env.seismicEnergy,
    })
  })

  return null
}
