import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore } from '../state/useStore'
import { weaponFor } from '../weapons/registry'

/**
 * Reticle — world-space targeting mark.
 *
 * Screen-space crosshairs lie about where a shot lands on a sphere: the cursor
 * is 2D, the target is curved. So the reticle is real geometry sitting on the
 * surface, tilted to the local normal. Its radius is the weapon's actual
 * angular footprint, which makes the difference between the precision laser and
 * the cataclysm beam legible before you fire rather than after.
 *
 * Additive with depthTest off so it stays readable over molten craters and
 * against the bright limb.
 */

const UP_Z = new THREE.Vector3(0, 0, 1)
const _n = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** aim may arrive as a Vector3, {normal|dir|point}, an array or a plain xyz. */
function readNormal(aim, out) {
  if (!aim) return null
  if (aim.isVector3) out.copy(aim)
  else if (Array.isArray(aim)) out.set(aim[0], aim[1], aim[2])
  else if (aim.normal) out.copy(aim.normal)
  else if (aim.dir) out.copy(aim.dir)
  else if (aim.point) out.copy(aim.point)
  else if (typeof aim.x === 'number') out.set(aim.x, aim.y, aim.z)
  else return null
  if (!Number.isFinite(out.x) || out.lengthSq() < 1e-12) return null
  return out.normalize()
}

export function Reticle({ planetRadius = 1, altitude = 1.006 }) {
  const aim = useStore((s) => s.aim)
  const activeWeapon = useStore((s) => s.activeWeapon)
  const firing = useStore((s) => s.firing)

  const group = useRef()
  const ticks = useRef()
  const pulse = useRef(1)

  const weapon = weaponFor(activeWeapon)
  const ringRadius = Math.max(weapon.radius * planetRadius * 2.2, planetRadius * 0.012)

  // Unit-scale geometry; the group scale carries the real radius so the pulse
  // is a single transform write per frame and nothing is rebuilt on resize.
  const geo = useMemo(() => {
    const ring = new THREE.RingGeometry(0.9, 1.0, 96, 1)
    const dot = new THREE.CircleGeometry(0.075, 20)
    const tick = new THREE.PlaneGeometry(0.055, 0.36)
    return { ring, dot, tick }
  }, [])

  const mat = useMemo(() => {
    const base = (c, opacity) =>
      new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    return {
      ring: base(weapon.color, 0.62),
      dot: base(weapon.coreColor ?? weapon.color, 0.95),
      tick: base(weapon.color, 0.85),
    }
  }, [weapon])

  const tickTransforms = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2
        return {
          position: [Math.cos(a) * 1.28, Math.sin(a) * 1.28, 0],
          rotation: [0, 0, a - Math.PI / 2],
        }
      }),
    []
  )

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return

    const n = readNormal(aim, _n)
    if (!n) return

    g.position.copy(n).multiplyScalar(planetRadius * altitude)
    _q.setFromUnitVectors(UP_Z, n)
    g.quaternion.copy(_q)

    // Breathing idle, tightening while the trigger is down.
    const t = state.clock.elapsedTime
    const target = firing ? 0.9 : 1
    pulse.current += (target - pulse.current) * Math.min(1, delta * 12)
    const breathe = 1 + Math.sin(t * 3.1) * (firing ? 0.012 : 0.03)
    g.scale.setScalar(ringRadius * pulse.current * breathe)

    if (ticks.current) ticks.current.rotation.z = t * 0.16
  })

  if (!aim) return null

  return (
    <group ref={group} renderOrder={999}>
      <mesh geometry={geo.ring} material={mat.ring} renderOrder={999} />
      <mesh geometry={geo.dot} material={mat.dot} renderOrder={1000} />
      <group ref={ticks}>
        {tickTransforms.map((tr, i) => (
          <mesh
            key={i}
            geometry={geo.tick}
            material={mat.tick}
            position={tr.position}
            rotation={tr.rotation}
            renderOrder={1000}
          />
        ))}
      </group>
    </group>
  )
}

export default Reticle
