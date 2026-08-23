import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../state/useStore.js'

const vert = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aTwinkle;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    // Slow, per-star scintillation. Real stars twinkle from atmosphere, but a
    // faint variation keeps the sky from looking like static noise.
    vAlpha = 0.65 + 0.35 * sin(uTime * 0.6 + aTwinkle * 6.283);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uPixelRatio;
  }
`

const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // Airy-ish falloff: tight core, soft halo. Reads as a point source rather
    // than a sprite disc.
    float core = exp(-d * d * 42.0);
    float halo = exp(-d * 7.0) * 0.35;
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`

/**
 * Deep-space background. A single instanced point cloud on a huge shell, with a
 * procedural colour distribution weighted toward the real stellar population
 * (many dim red dwarfs, few bright blue giants) plus a faint galactic band.
 */
export function Starfield({ radius = 900 }) {
  const budget = useStore((s) => s.budget)
  const matRef = useRef()

  const geometry = useMemo(() => {
    const count = budget.starfield
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const twinkle = new Float32Array(count)

    const color = new THREE.Color()
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere.
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      let x = s * Math.cos(theta)
      let y = u
      let z = s * Math.sin(theta)

      // Concentrate a third of the stars into a galactic plane band.
      if (i % 3 === 0) {
        y *= 0.16
        const len = Math.hypot(x, y, z)
        x /= len
        y /= len
        z /= len
      }

      const r = radius * (0.9 + Math.random() * 0.2)
      pos[i * 3] = x * r
      pos[i * 3 + 1] = y * r
      pos[i * 3 + 2] = z * r

      // Temperature distribution skewed cool — most stars are dim and red.
      const roll = Math.random()
      const temp = roll > 0.97 ? 12000 + Math.random() * 16000 : roll > 0.86 ? 6500 + Math.random() * 3500 : 3200 + Math.random() * 2600
      // Cheap blackbody approximation in JS to match the GLSL one.
      const t = temp / 100
      const rr = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332)
      const gg = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755)
      const bb = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
      color.setRGB(
        THREE.MathUtils.clamp(rr / 255, 0, 1),
        THREE.MathUtils.clamp(gg / 255, 0, 1),
        THREE.MathUtils.clamp(bb / 255, 0, 1)
      )
      col[i * 3] = color.r
      col[i * 3 + 1] = color.g
      col[i * 3 + 2] = color.b

      // Brightness follows a power law: a handful of standouts, many faint.
      const mag = Math.pow(Math.random(), 3.2)
      size[i] = 0.7 + mag * 5.2
      twinkle[i] = Math.random()
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1))
    return g
  }, [budget.starfield, radius])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    }),
    []
  )

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}
