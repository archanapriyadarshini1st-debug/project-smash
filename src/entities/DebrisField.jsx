import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal, useFrame } from '@react-three/fiber'
import { DebrisSystem } from '../sim/debris'
import { useStore } from '../state/useStore'

/**
 * DebrisField
 *
 * Owns one DebrisSystem and drives its integrator from the render loop.
 *
 * The instanced mesh is portalled into `parentRef` (the planet's spin group)
 * because debris positions produced by the sim are planet-local: parenting to
 * the spin group means ejecta rides the planet's rotation for free, and a
 * settled fragment stays on the crater it fell into instead of sliding across
 * the surface as the planet turns.
 *
 * WeaponSystem talks to this through the ref — spawn()/burst() straight into
 * the pool, no React state in the hot path.
 */
export const DebrisField = forwardRef(function DebrisField(
  { planetRadius = 1, parentRef, mu = 1.6, attractor = null, pull = 0 },
  ref
) {
  const debrisMax = useStore((s) => s.budget?.debrisMax ?? 600)
  const resetSignal = useStore((s) => s.resetSignal)

  // Rebuilt only when the quality manager changes the pool size.
  const system = useMemo(
    () => new DebrisSystem({ max: debrisMax, planetRadius, mu }),
    [debrisMax, planetRadius, mu]
  )

  useEffect(() => () => system.dispose(), [system])

  // Live attractor state so the gravity weapon can steer debris without
  // forcing a re-render every frame.
  const field = useRef({ attractor, pull })
  field.current.attractor = attractor
  field.current.pull = pull

  // parentRef.current is only populated after the planet mounts, so resolve
  // the portal host in an effect and render nothing on the first pass.
  const [host, setHost] = useState(null)
  useEffect(() => {
    setHost(parentRef?.current ?? null)
  }, [parentRef])

  useEffect(() => {
    system.reset()
  }, [system, resetSignal])

  useImperativeHandle(
    ref,
    () => ({
      get system() { return system },
      get mesh() { return system.mesh },
      get count() { return system.count },
      spawn: (origin, velocity, opts) => system.spawn(origin, velocity, opts),
      burst: (dir, n, opts) => system.burst(dir, n, opts),
      reset: () => system.reset(),
      /** Gravity weapons call this each frame while the well is open. */
      setAttractor: (v, p = 0) => {
        field.current.attractor = v
        field.current.pull = p
      },
    }),
    [system]
  )

  useFrame((_, delta) => {
    // A tab-switch or a GC hitch must not teleport every fragment.
    const dt = Math.min(delta, 1 / 20)
    system.update(dt, field.current)
  })

  if (!host) return null
  return createPortal(<primitive object={system.mesh} />, host)
})

export default DebrisField
