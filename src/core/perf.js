/**
 * Frame monitor + degradation ladder.
 *
 * Rule from the brief: when frames get expensive, spend from the visual budget in
 * this order — resolution, then expensive effects, then particle density, then
 * shadows, then distant simulation detail. Gameplay simulation is never the first
 * thing cut, and never cut entirely.
 */

export const LADDER = [
  { key: 'resolution', label: 'Render scale' },
  { key: 'effects', label: 'Post effects' },
  { key: 'particles', label: 'Particle density' },
  { key: 'shadows', label: 'Shadow detail' },
  { key: 'distantSim', label: 'Distant simulation' },
]

const RESOLUTION_STEPS = [1.0, 0.88, 0.76, 0.64, 0.55]

export class PerfMonitor {
  constructor({ targetFps = 60, sampleSize = 90 } = {}) {
    this.targetFps = targetFps
    this.sampleSize = sampleSize
    this.samples = []
    this.fps = targetFps
    this.level = 0 // 0 = full quality; each step climbs the ladder
    this.resStep = 0
    this.cooldown = 1.5
    this.stableFor = 0
    this.listeners = new Set()
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn(this.state)
  }

  get state() {
    return {
      level: this.level,
      fps: this.fps,
      renderScale: RESOLUTION_STEPS[Math.min(this.resStep, RESOLUTION_STEPS.length - 1)],
      effects: this.level < 2,
      particleScale: this.level >= 3 ? 0.45 : this.level >= 2 ? 0.7 : 1,
      shadows: this.level < 4,
      distantSim: this.level < 5 ? 1 : 0.5,
    }
  }

  /** Call once per frame with delta seconds. */
  tick(delta) {
    if (delta <= 0 || delta > 0.5) return
    const inst = 1 / delta
    this.samples.push(inst)
    if (this.samples.length > this.sampleSize) this.samples.shift()
    // Median is robust against single-frame spikes (GC, shader compile).
    const sorted = [...this.samples].sort((a, b) => a - b)
    this.fps = sorted[Math.floor(sorted.length / 2)]

    this.cooldown -= delta
    if (this.cooldown > 0 || this.samples.length < this.sampleSize * 0.6) return

    const low = this.targetFps * 0.78
    const high = this.targetFps * 0.95

    if (this.fps < low) {
      this.degrade()
    } else if (this.fps > high) {
      this.stableFor += delta
      if (this.stableFor > 6) this.recover()
    } else {
      this.stableFor = 0
    }
  }

  degrade() {
    // Resolution has several sub-steps before we start dropping features.
    if (this.level === 0 && this.resStep < RESOLUTION_STEPS.length - 1) {
      this.resStep += 1
      if (this.resStep >= 2) this.level = 1
    } else if (this.level < LADDER.length) {
      this.level += 1
    } else {
      return
    }
    this.cooldown = 2.5
    this.stableFor = 0
    this.emit()
  }

  recover() {
    if (this.level === 0 && this.resStep === 0) {
      this.stableFor = 0
      return
    }
    if (this.level > 1) this.level -= 1
    else if (this.resStep > 0) {
      this.resStep -= 1
      if (this.resStep < 2) this.level = 0
    } else this.level = 0
    this.cooldown = 4
    this.stableFor = 0
    this.emit()
  }
}
