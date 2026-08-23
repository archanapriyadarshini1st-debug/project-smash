import * as THREE from 'three'

/**
 * Instanced debris field.
 *
 * Real fragments: each has position, velocity, rotation, angular velocity, mass
 * and a lifetime. They fall back under the planet's gravity, bounce/settle on
 * the surface, or escape entirely if the ejection was violent enough.
 *
 * One InstancedMesh, one pool, zero allocations per frame.
 */

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _v = new THREE.Vector3()

export class DebrisSystem {
  constructor({ max = 600, planetRadius = 1, mu = 1.6 }) {
    this.max = max
    this.planetRadius = planetRadius
    this.mu = mu // gravitational parameter, tuned for feel not for SI units
    this.count = 0

    // Structure-of-arrays — cache friendly and no GC churn.
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.rot = new Float32Array(max * 3)
    this.spin = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)
    this.heat = new Float32Array(max)
    this.alive = new Uint8Array(max)

    // A chipped tetrahedron reads as fractured rock far better than a cube.
    const geo = new THREE.TetrahedronGeometry(1, 0)
    geo.computeVertexNormals()
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4a4239'),
      roughness: 0.95,
      metalness: 0.02,
      flatShading: true,
      emissive: new THREE.Color('#ff5a1e'),
      emissiveIntensity: 0,
    })

    this.mesh = new THREE.InstancedMesh(geo, mat, max)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0

    // Per-instance emissive so freshly ejected molten rock glows and then cools.
    this.heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
    geo.setAttribute('aHeat', this.heatAttr)
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeat;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance = mix(vec3(0.0), vec3(2.6,0.55,0.10), vHeat*vHeat) * 3.0;'
        )
    }
  }

  /** Spawn one fragment. origin/velocity are planet-local (parent frame). */
  spawn(origin, velocity, { size = 0.01, life = 8, heat = 1 } = {}) {
    let i = -1
    for (let k = 0; k < this.max; k++) {
      if (!this.alive[k]) { i = k; break }
    }
    if (i < 0) return false // pool exhausted — drop rather than stall

    const i3 = i * 3
    this.pos[i3] = origin.x; this.pos[i3 + 1] = origin.y; this.pos[i3 + 2] = origin.z
    this.vel[i3] = velocity.x; this.vel[i3 + 1] = velocity.y; this.vel[i3 + 2] = velocity.z
    this.rot[i3] = Math.random() * 6.28; this.rot[i3 + 1] = Math.random() * 6.28; this.rot[i3 + 2] = Math.random() * 6.28
    this.spin[i3] = (Math.random() - 0.5) * 7
    this.spin[i3 + 1] = (Math.random() - 0.5) * 7
    this.spin[i3 + 2] = (Math.random() - 0.5) * 7
    this.size[i] = size * (0.45 + Math.random())
    this.life[i] = life * (0.7 + Math.random() * 0.6)
    this.maxLife[i] = this.life[i]
    this.heat[i] = heat
    this.alive[i] = 1
    this.count++
    return true
  }

  /** Eject a burst from a surface point along its normal, in a cone. */
  burst(dir, n, { speed = 0.6, size = 0.012, spread = 0.8, life = 9, heat = 1 } = {}) {
    const up = dir.clone().normalize()
    const tangent = Math.abs(up.y) < 0.9
      ? new THREE.Vector3(0, 1, 0).cross(up).normalize()
      : new THREE.Vector3(1, 0, 0).cross(up).normalize()
    const bitangent = up.clone().cross(tangent)

    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.pow(Math.random(), 0.6) * spread
      _v.copy(up)
        .addScaledVector(tangent, Math.cos(a) * r)
        .addScaledVector(bitangent, Math.sin(a) * r)
        .normalize()
      const sp = speed * (0.35 + Math.random() * 1.3)
      const origin = up.clone().multiplyScalar(this.planetRadius * 0.995)
      this.spawn(origin, _v.multiplyScalar(sp), { size, life, heat })
    }
  }

  update(delta, opts = {}) {
    const { attractor = null, pull = 0 } = opts
    const R = this.planetRadius
    let written = 0
    let living = 0

    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue
      const i3 = i * 3

      _v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2])
      const r = _v.length()

      // Real gravity: inverse-square toward the planet centre.
      const g = -this.mu / Math.max(r * r, 0.02)
      const ax = (_v.x / r) * g
      const ay = (_v.y / r) * g
      const az = (_v.z / r) * g

      this.vel[i3] += ax * delta
      this.vel[i3 + 1] += ay * delta
      this.vel[i3 + 2] += az * delta

      // Optional gravity-weapon attractor.
      if (attractor && pull) {
        const dx = attractor.x - _v.x, dy = attractor.y - _v.y, dz = attractor.z - _v.z
        const d2 = Math.max(dx * dx + dy * dy + dz * dz, 0.004)
        const f = (pull / d2) * delta
        const d = Math.sqrt(d2)
        this.vel[i3] += (dx / d) * f
        this.vel[i3 + 1] += (dy / d) * f
        this.vel[i3 + 2] += (dz / d) * f
      }

      this.pos[i3] += this.vel[i3] * delta
      this.pos[i3 + 1] += this.vel[i3 + 1] * delta
      this.pos[i3 + 2] += this.vel[i3 + 2] * delta

      // Surface contact: kill most of the energy, let it skid and settle.
      _v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2])
      const nr = _v.length()
      if (nr < R) {
        _v.normalize()
        this.pos[i3] = _v.x * R; this.pos[i3 + 1] = _v.y * R; this.pos[i3 + 2] = _v.z * R
        const vdotn = this.vel[i3] * _v.x + this.vel[i3 + 1] * _v.y + this.vel[i3 + 2] * _v.z
        const rest = 0.22
        this.vel[i3] = (this.vel[i3] - 2 * vdotn * _v.x) * rest
        this.vel[i3 + 1] = (this.vel[i3 + 1] - 2 * vdotn * _v.y) * rest
        this.vel[i3 + 2] = (this.vel[i3 + 2] - 2 * vdotn * _v.z) * rest
        this.spin[i3] *= 0.5; this.spin[i3 + 1] *= 0.5; this.spin[i3 + 2] *= 0.5
        this.life[i] = Math.min(this.life[i], 2.2) // settled rubble fades out
      }

      this.rot[i3] += this.spin[i3] * delta
      this.rot[i3 + 1] += this.spin[i3 + 1] * delta
      this.rot[i3 + 2] += this.spin[i3 + 2] * delta

      this.heat[i] = Math.max(0, this.heat[i] - delta * 0.42)
      this.life[i] -= delta
      if (this.life[i] <= 0 || nr > R * 60) {
        this.alive[i] = 0
        this.count--
        continue
      }

      const fade = Math.min(1, this.life[i] / Math.max(this.maxLife[i] * 0.25, 0.001))
      _e.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2])
      _q.setFromEuler(_e)
      _s.setScalar(this.size[i] * fade)
      _v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2])
      _m.compose(_v, _q, _s)
      this.mesh.setMatrixAt(written, _m)
      this.heatAttr.array[written] = this.heat[i]
      written++
      living++
    }

    this.mesh.count = written
    if (written > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      this.heatAttr.needsUpdate = true
    }
    return living
  }

  reset() {
    this.alive.fill(0)
    this.count = 0
    this.mesh.count = 0
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
