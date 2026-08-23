import * as THREE from 'three'

/**
 * Planetary damage field.
 *
 * An equirectangular RGBA float-ish texture wrapping the planet. This is the
 * shared truth between simulation and shader — the surface shader displaces and
 * recolours from it, and the physics/telemetry read from it. Nothing here is
 * cosmetic; a texel written is terrain actually removed.
 *
 *   R = excavation depth   0..1  (how much crust is gone -> real displacement)
 *   G = heat               0..1  (glowing molten rock, cools over time)
 *   B = scorch / ash       0..1  (permanent albedo darkening, does not cool)
 *   A = breach             0..1  (crust fully penetrated -> interior visible)
 *
 * Writes are done on the CPU into a Uint8Array and pushed with partial texture
 * updates, so a hit costs one small subimage upload rather than a full reupload.
 */
export class DamageField {
  constructor(resolution = 1024) {
    this.width = resolution
    this.height = resolution / 2
    this.data = new Uint8Array(this.width * this.height * 4)
    this.texture = new THREE.DataTexture(
      this.data,
      this.width,
      this.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    )
    this.texture.wrapS = THREE.RepeatWrapping // seam continuity in longitude
    this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true

    this.totalExcavated = 0 // running sum, drives integrity
    this.craterCount = 0
    this.breached = false
    this._dirty = null // bounding box of pending upload
    this._coolTimer = 0
  }

  /** Direction (unit vector, planet-local) -> equirect pixel coords. */
  dirToPixel(dir) {
    const u = 0.5 + Math.atan2(dir.z, dir.x) / (2 * Math.PI)
    const v = 0.5 - Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / Math.PI
    return { x: u * this.width, y: v * this.height }
  }

  markDirty(x0, y0, x1, y1) {
    if (!this._dirty) this._dirty = { x0, y0, x1, y1 }
    else {
      this._dirty.x0 = Math.min(this._dirty.x0, x0)
      this._dirty.y0 = Math.min(this._dirty.y0, y0)
      this._dirty.x1 = Math.max(this._dirty.x1, x1)
      this._dirty.y1 = Math.max(this._dirty.y1, y1)
    }
  }

  /**
   * Apply one damage stamp centred on a surface direction.
   *
   * @param dir     THREE.Vector3, planet-local unit vector
   * @param radius  angular radius in radians
   * @param opts    { depth, heat, scorch, penetration, hardness, falloff }
   * @returns       excavated volume proxy (used for integrity + debris mass)
   */
  stamp(dir, radius, opts = {}) {
    const {
      depth = 0.5,
      heat = 0.8,
      scorch = 0.6,
      penetration = 0,
      falloff = 2.0,
      jagged = 0.35,
    } = opts

    const centre = this.dirToPixel(dir)
    // Latitude compression: near the poles a fixed angular radius covers many
    // more texels in longitude. Without this, polar craters render as smears.
    const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
    const cosLat = Math.max(Math.cos(lat), 0.08)
    const rY = (radius / Math.PI) * this.height
    const rX = rY / cosLat

    const x0 = Math.floor(centre.x - rX) - 1
    const x1 = Math.ceil(centre.x + rX) + 1
    const y0 = Math.max(0, Math.floor(centre.y - rY) - 1)
    const y1 = Math.min(this.height - 1, Math.ceil(centre.y + rY) + 1)

    let excavated = 0
    const seed = Math.random() * 100

    for (let y = y0; y <= y1; y++) {
      const dy = (y - centre.y) / rY
      for (let xr = x0; xr <= x1; xr++) {
        const dx = (xr - centre.x) / rX
        let d = Math.sqrt(dx * dx + dy * dy)
        if (d > 1) continue

        // Break up the circle so craters read as blasted rock, not stencils.
        const ang = Math.atan2(dy, dx)
        const wob =
          Math.sin(ang * 5 + seed) * 0.55 + Math.sin(ang * 11 + seed * 2.3) * 0.3 + Math.sin(ang * 23 + seed * 0.7) * 0.15
        d *= 1 + wob * jagged
        if (d > 1) continue

        const x = ((xr % this.width) + this.width) % this.width // longitude wrap
        const i = (y * this.width + x) * 4

        const g = Math.pow(1 - Math.min(d, 1), falloff)

        const newDepth = Math.min(255, this.data[i] + depth * g * 255)
        excavated += (newDepth - this.data[i]) / 255
        this.data[i] = newDepth
        // Heat peaks at the rim-inward zone, not dead centre — centre is vapourised.
        const heatProfile = g * (0.65 + 0.35 * Math.sin(Math.min(d, 1) * Math.PI))
        this.data[i + 1] = Math.min(255, this.data[i + 1] + heat * heatProfile * 255)
        this.data[i + 2] = Math.min(255, this.data[i + 2] + scorch * g * 255)
        if (penetration > 0) {
          const pen = Math.pow(Math.max(0, 1 - d * 1.35), 2.2) * penetration
          this.data[i + 3] = Math.min(255, this.data[i + 3] + pen * 255)
          if (this.data[i + 3] > 200) this.breached = true
        }
      }
    }

    this.markDirty(x0, y0, x1, y1)
    this.totalExcavated += excavated
    if (radius > 0.02) this.craterCount++
    return excavated
  }

  /** Continuous beam: stamp along a great-circle arc between two directions. */
  stampArc(dirA, dirB, radius, opts = {}, steps = 0) {
    const angle = dirA.angleTo(dirB)
    const n = steps || Math.max(1, Math.ceil(angle / (radius * 0.45)))
    const tmp = new THREE.Vector3()
    let total = 0
    for (let i = 0; i <= n; i++) {
      tmp.copy(dirA).lerp(dirB, i / n).normalize()
      total += this.stamp(tmp, radius, opts)
    }
    return total
  }

  /** Sample current damage at a direction — used by physics/debris/collision. */
  sample(dir) {
    const p = this.dirToPixel(dir)
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(p.x)))
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(p.y)))
    const i = (y * this.width + x) * 4
    return {
      depth: this.data[i] / 255,
      heat: this.data[i + 1] / 255,
      scorch: this.data[i + 2] / 255,
      breach: this.data[i + 3] / 255,
    }
  }

  /**
   * Cooling pass. Molten rock radiates heat away and solidifies, leaving scorch
   * behind. Run at a few Hz on a strided subset — full-texture work every frame
   * would cost more than the whole render.
   */
  cool(delta) {
    this._coolTimer += delta
    if (this._coolTimer < 0.1) return
    const dt = this._coolTimer
    this._coolTimer = 0
    const k = Math.exp(-dt * 0.22)
    let touched = false
    for (let i = 1; i < this.data.length; i += 4) {
      const h = this.data[i]
      if (h > 2) {
        this.data[i] = h * k
        touched = true
      } else if (h > 0) {
        this.data[i] = 0
        touched = true
      }
    }
    if (touched) this.markDirty(0, 0, this.width - 1, this.height - 1)
  }

  /**
   * Push pending CPU writes to the GPU. Called once per frame.
   * The dirty flag is what matters here: on an idle frame we skip the reupload
   * entirely instead of re-sending the whole field 60 times a second.
   */
  flush() {
    if (!this._dirty) return
    this.texture.needsUpdate = true
    this._dirty = null
  }

  /** Planetary integrity 0..1 — how much of the world is still intact. */
  get integrity() {
    const capacity = this.width * this.height * 0.06
    return Math.max(0, 1 - this.totalExcavated / capacity)
  }

  reset() {
    this.data.fill(0)
    this.totalExcavated = 0
    this.craterCount = 0
    this.breached = false
    this.texture.needsUpdate = true
    this._dirty = null
  }

  dispose() {
    this.texture.dispose()
  }
}
