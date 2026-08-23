import { useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { presetFor } from './planetPresets.js'
import { DamageField } from '../sim/damageField.js'
import {
  createSurfaceMaterial,
  createAtmosphereMaterial,
  createCloudMaterial,
  syncLighting,
} from '../render/planetMaterials.js'
import { useStore } from '../state/useStore.js'

/**
 * A planet: displaced surface mesh + atmospheric shell + cloud shell, sharing
 * one damage field. Exposes an imperative handle so weapons can raycast against
 * it and write damage without going through React state.
 */
export const Planet = forwardRef(function Planet(
  { id, preset: presetKey = 'terrestrial', radius = 1, position = [0, 0, 0], rotationPeriod = 240, axialTilt = 0.41, lightRef, onReady },
  ref
) {
  const preset = useMemo(() => presetFor(presetKey), [presetKey])
  const budget = useStore((s) => s.budget)
  const resetSignal = useStore((s) => s.resetSignal)
  const { invalidate } = useThree()

  const groupRef = useRef()
  const surfaceRef = useRef()
  const spinRef = useRef()
  const atmoRef = useRef()
  const cloudRef = useRef()

  // Damage field is the shared simulation substrate — one per planet, sized by tier.
  const damage = useMemo(() => new DamageField(budget.damageRes), [budget.damageRes])

  const surface = useMemo(
    () => createSurfaceMaterial({ preset, radius, damageTexture: damage.texture, budget }),
    [preset, radius, damage, budget]
  )
  const atmo = useMemo(() => createAtmosphereMaterial({ preset, radius, budget }), [preset, radius, budget])
  const clouds = useMemo(
    () => createCloudMaterial({ preset, radius, damageTexture: damage.texture, budget }),
    [preset, radius, damage, budget]
  )

  const geometry = useMemo(() => {
    const seg = budget.planetSegments
    // Sphere UVs are equirectangular, which matches the damage field layout.
    return new THREE.SphereGeometry(radius, seg, seg / 2)
  }, [radius, budget.planetSegments])

  const atmoGeometry = useMemo(
    () => new THREE.SphereGeometry(radius * (1 + preset.atmosphere.height) * 1.02, 64, 32),
    [radius, preset.atmosphere.height]
  )
  const cloudGeometry = useMemo(
    () => (clouds ? new THREE.SphereGeometry(clouds.config.outer * radius * 1.01, 64, 32) : null),
    [clouds, radius]
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      atmoGeometry.dispose()
      cloudGeometry?.dispose()
      surface.material.dispose()
      atmo.material.dispose()
      clouds?.material.dispose()
      damage.dispose()
    }
  }, [geometry, atmoGeometry, cloudGeometry, surface, atmo, clouds, damage])

  useEffect(() => {
    damage.reset()
    if (clouds) clouds.uniforms.uDisturbance.value = 0
    atmo.uniforms.uDisturbance.value = 0
    surface.uniforms.uAtmosphere.value = 1
    surface.uniforms.uPopulation.value = preset.population
    invalidate()
  }, [resetSignal, damage, clouds, atmo, surface, preset.population, invalidate])

  const api = useMemo(
    () => ({
      id,
      radius,
      preset,
      damage,
      get object() {
        return spinRef.current
      },
      get group() {
        return groupRef.current
      },
      get mesh() {
        return surfaceRef.current
      },
      uniforms: { surface: surface.uniforms, atmo: atmo.uniforms, clouds: clouds?.uniforms },
      /** World point -> planet-local unit direction, undoing spin and tilt. */
      worldToLocalDir(worldPoint, out = new THREE.Vector3()) {
        out.copy(worldPoint)
        spinRef.current.worldToLocal(out)
        return out.normalize()
      },
      /** Planet-local direction -> current world position on the surface. */
      localDirToWorld(dir, out = new THREE.Vector3(), altitude = 0) {
        const d = damage.sample(dir)
        const r = radius * (1 - d.depth * surface.uniforms.uExcavationDepth.value) + altitude
        out.copy(dir).multiplyScalar(r)
        return spinRef.current.localToWorld(out)
      },
      /** Raise atmospheric disturbance — dust loading after an impact. */
      disturb(amount) {
        const next = Math.min(1, atmo.uniforms.uDisturbance.value + amount)
        atmo.uniforms.uDisturbance.value = next
        if (clouds) clouds.uniforms.uDisturbance.value = next
      },
      /** Strip atmosphere — large events blow it off. */
      thinAtmosphere(amount) {
        const u = surface.uniforms.uAtmosphere
        u.value = Math.max(0, u.value - amount)
        atmo.uniforms.uDensity.value = preset.atmosphere.density * u.value
        if (clouds) clouds.uniforms.uCoverage.value = preset.clouds.coverage * Math.max(0.15, u.value)
        return u.value
      },
      killPopulation(fraction) {
        const u = surface.uniforms.uPopulation
        u.value = Math.max(0, u.value * (1 - fraction))
        return u.value
      },
    }),
    [id, radius, preset, damage, surface, atmo, clouds]
  )

  useImperativeHandle(ref, () => api, [api])

  useEffect(() => {
    onReady?.(api)
  }, [api, onReady])

  const _lightWorld = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime

    // Axial rotation. Real spin, so the terminator sweeps and damage rotates with it.
    if (spinRef.current && rotationPeriod > 0) {
      spinRef.current.rotation.y += (delta * Math.PI * 2) / rotationPeriod
    }

    // Fragment stage has no modelMatrix — feed each mesh's world matrix in.
    if (surfaceRef.current) surface.uniforms.uModel.value.copy(surfaceRef.current.matrixWorld)
    if (atmoRef.current) atmo.uniforms.uModel.value.copy(atmoRef.current.matrixWorld)
    if (cloudRef.current && clouds) clouds.uniforms.uModel.value.copy(cloudRef.current.matrixWorld)

    surface.uniforms.uTime.value = t
    atmo.uniforms.uTime.value = t
    if (clouds) {
      clouds.uniforms.uTime.value = t
      // Clouds drift relative to the surface — they are not painted on.
      clouds.uniforms.uRotation.value = t * clouds.config.speed
    }

    // Light position follows the actual star object.
    if (lightRef?.current) {
      lightRef.current.getWorldPosition(_lightWorld)
      syncLighting([surface.uniforms, atmo.uniforms, clouds?.uniforms], _lightWorld)
    }

    // Heat radiates away and dust settles out of the atmosphere over time.
    damage.cool(delta)
    damage.flush()
    if (atmo.uniforms.uDisturbance.value > 0) {
      const decay = Math.max(0, atmo.uniforms.uDisturbance.value - delta * 0.035)
      atmo.uniforms.uDisturbance.value = decay
      if (clouds) clouds.uniforms.uDisturbance.value = decay
    }
  })

  return (
    <group ref={groupRef} position={position}>
      <group rotation={[0, 0, axialTilt]}>
        <group ref={spinRef}>
          <mesh ref={surfaceRef} geometry={geometry} material={surface.material} name={`planet:${id}`} />
          {clouds && <mesh ref={cloudRef} geometry={cloudGeometry} material={clouds.material} renderOrder={2} />}
        </group>
      </group>
      <mesh ref={atmoRef} geometry={atmoGeometry} material={atmo.material} renderOrder={3} />
    </group>
  )
})
