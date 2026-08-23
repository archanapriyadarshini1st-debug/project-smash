import * as THREE from 'three'

/**
 * Beam material.
 *
 * Built for a unit cylinder whose axis runs along +Y, so a beam is drawn by
 * scaling that cylinder: X/Z = beam width, Y = distance to the impact point.
 *
 * The volumetric read comes from the view-space normal rather than from uv.x:
 * on a cylinder, |dot(N, V)| is 1 down the middle of the silhouette and 0 at
 * its edges, which is exactly the radial coordinate we want and it stays
 * correct at every camera angle and every scale. From that one value we get
 *   - a blown-out white core,
 *   - a saturated sheath fading to nothing at the rim,
 *   - a fresnel lip so the silhouette glows instead of ending flat.
 * Energy ripples travel along uv.y; uFlicker drives per-frame instability.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;

  void main() {
    vUv = uv;
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = viewPos.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3  uColor;
  uniform vec3  uCoreColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFlicker;
  uniform float uRippleSpeed;

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  // Value noise in 1D — cheap, and enough for beam instability.
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }

  void main() {
    vec3 V = normalize(-vViewPos);
    vec3 N = normalize(vViewNormal);
    float facing = abs(dot(N, V));

    // 0 at the centre of the silhouette, 1 at its rim.
    float r = clamp(1.0 - facing, 0.0, 1.0);

    // Core: a narrow, extremely hot spine.
    float core = pow(1.0 - r, 7.0);
    // Sheath: the saturated body of the beam.
    float sheath = pow(1.0 - r, 1.6);
    // Fresnel lip: glow riding the silhouette edge so it never reads as a tube.
    float fres = pow(r, 2.4);

    // Travelling energy ripples along the length of the beam.
    float t = uTime * uRippleSpeed;
    float ripple =
        0.55 * sin(vUv.y * 46.0 - t * 9.0)
      + 0.30 * sin(vUv.y * 121.0 - t * 17.0 + 1.7)
      + 0.15 * sin(vUv.y * 9.0 - t * 3.0);
    ripple = 0.82 + 0.18 * ripple;

    // Instability: fast noise plus a faint per-segment shimmer.
    float flick = mix(1.0, vnoise(uTime * uFlicker) * 0.55 + 0.72, 0.85);
    flick *= 0.92 + 0.08 * vnoise(vUv.y * 30.0 + uTime * uFlicker * 0.5);

    // Muzzle end is denser, the far end frays slightly.
    float along = mix(1.06, 0.86, smoothstep(0.0, 1.0, vUv.y));

    float energy = (sheath * 0.85 + fres * 0.9) * ripple * along;

    vec3 col = uColor * energy;
    col += uCoreColor * core * 2.6 * ripple;
    col += uCoreColor * fres * 0.35;

    float alpha = clamp((energy * 0.9 + core * 1.4), 0.0, 1.0);
    alpha *= smoothstep(0.0, 0.035, 1.0 - r);      // hard rim cutoff, no seam
    alpha *= flick * uIntensity;

    if (alpha < 0.004) discard;

    gl_FragColor = vec4(col * flick * uIntensity, alpha);
  }
`

export function createBeamMaterial({
  color = new THREE.Color('#6fd7ff'),
  coreColor = new THREE.Color('#eafcff'),
  intensity = 1,
  flicker = 18,
  rippleSpeed = 1,
} = {}) {
  const uniforms = {
    uColor: { value: new THREE.Color().copy(color) },
    uCoreColor: { value: new THREE.Color().copy(coreColor) },
    uTime: { value: 0 },
    uIntensity: { value: intensity },
    uFlicker: { value: flicker },
    uRippleSpeed: { value: rippleSpeed },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  })

  return { material, uniforms }
}
