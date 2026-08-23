#include ./noise.glsl
#include ./lighting.glsl

/**
 * Cloud layer — raymarched through a thin shell, not a texture glued to a sphere.
 *
 * Coverage comes from domain-warped FBM so bands shear into cyclonic structure.
 * Lighting uses a short march toward the star for self-shadowing, which is what
 * gives cloud tops brightness and undersides weight.
 */

uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uPlanetRadius;
uniform float uInner;
uniform float uOuter;
uniform float uTime;
uniform float uCoverage;    // 0..1 — how much of the sky is clouded
uniform float uDensity;
uniform float uRotation;
uniform float uDisturbance; // impact-driven turbulence
uniform vec3 uTint;
uniform int uSteps;
uniform int uLightSteps;
uniform sampler2D uDamage;

varying vec3 vWorldPos;

mat3 rotY(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

// Cloud density at a world-space offset from the planet centre.
float cloudDensity(vec3 p, float h) {
  vec3 sp = rotY(uRotation) * normalize(p);

  // Latitude banding: trade winds and jet streams.
  float bandLat = sp.y;
  vec3 q = sp * 2.6;
  q.y *= 2.2;
  // Shear the sampling position along longitude by latitude — differential rotation.
  q = rotY(bandLat * 1.8 + uTime * 0.02) * q;

  vec3 w = warp(q + vec3(uTime * 0.014, 0.0, uTime * 0.008), 0.42 + uDisturbance * 0.5);
  float base = fbm(w, 6, 2.1, 0.52) * 0.5 + 0.5;

  // Erode the base shape with billowed detail for puffed edges.
  float detail = billow(w * 4.3 + vec3(uTime * 0.03), 4);
  float shape = base - detail * 0.22;

  // Bands: alternating high/low coverage by latitude.
  float bands = 0.5 + 0.5 * sin(bandLat * 9.0 + fbm(sp * 2.0, 3) * 3.0);
  float cover = uCoverage * mix(0.72, 1.18, bands);

  float d = smoothstep(1.0 - cover, 1.0 - cover + 0.34, shape);

  // Vertical profile — thin at both boundaries, thickest mid-shell.
  d *= smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.62, h);

  // Storms rise where the atmosphere has been disturbed.
  if (uDisturbance > 0.001) {
    float storm = fbm(w * 1.5 - vec3(uTime * 0.06), 4) * 0.5 + 0.5;
    d *= 1.0 + uDisturbance * storm * 1.6;
  }
  return clamp(d, 0.0, 1.0) * uDensity;
}

void main() {
  vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 ro = cameraPosition - centre;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  vec2 outer = raySphere(ro, rd, uOuter);
  if (outer.x > outer.y) discard;
  vec2 inner = raySphere(ro, rd, uInner);
  vec2 ground = raySphere(ro, rd, uPlanetRadius);

  float near = max(outer.x, 0.0);
  float far = outer.y;
  // Entering the shell from outside: march only the front slab, down to the
  // inner boundary, so we don't accumulate the far side through the planet.
  if (inner.x <= inner.y && inner.x > 0.0) far = min(far, inner.x);
  if (ground.x <= ground.y && ground.x > 0.0) far = min(far, ground.x);
  if (far <= near) discard;

  vec3 lightDir = normalize(uLightPos - centre);
  float shell = uOuter - uInner;
  int steps = uSteps;
  float segLen = (far - near) / float(steps);

  vec3 scattered = vec3(0.0);
  float transmittance = 1.0;

  // Dither the start offset to break up banding without more samples.
  float jitter = hash13(vec3(gl_FragCoord.xy, 1.0)) * segLen;

  for (int i = 0; i < 28; i++) {
    if (i >= steps || transmittance < 0.02) break;
    float t = near + jitter + (float(i) + 0.5) * segLen;
    vec3 pos = ro + rd * t;
    float r = length(pos);
    float h = (r - uInner) / shell;
    if (h < 0.0 || h > 1.0) continue;

    float d = cloudDensity(pos, h);
    if (d < 0.005) continue;

    // Self-shadowing: short march toward the star.
    float lightAccum = 0.0;
    float lstep = shell / float(max(uLightSteps, 1)) * 1.4;
    for (int j = 0; j < 6; j++) {
      if (j >= uLightSteps) break;
      vec3 lp = pos + lightDir * (float(j) + 0.5) * lstep;
      float lh = (length(lp) - uInner) / shell;
      if (lh < 0.0 || lh > 1.0) continue;
      lightAccum += cloudDensity(lp, lh) * lstep;
    }
    float sunTransmit = exp(-lightAccum * 2.4);

    // Planet shadow — the night side has no lit clouds.
    vec2 blocked = raySphere(pos, lightDir, uPlanetRadius);
    float lit = (blocked.x <= blocked.y && blocked.y > 0.0) ? 0.0 : 1.0;
    lit = max(lit, 0.0) * smoothstep(-0.15, 0.2, dot(normalize(pos), lightDir));

    float cosTheta = dot(rd, lightDir);
    // Two-lobe phase: forward scattering for silver lining, back for ambient fill.
    float phase = mix(phaseHG(cosTheta, 0.72), phaseHG(cosTheta, -0.28), 0.35);

    float extinction = d * segLen * 1.7;
    float sampleTransmit = exp(-extinction);

    vec3 lightEnergy = uLightColor * uLightIntensity * sunTransmit * lit * phase * 9.0;
    // Faint ambient so cloud undersides aren't pure black.
    lightEnergy += uLightColor * uLightIntensity * 0.05 * lit;

    scattered += lightEnergy * uTint * (1.0 - sampleTransmit) * transmittance;
    transmittance *= sampleTransmit;
  }

  float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
  if (alpha < 0.004) discard;

  gl_FragColor = vec4(scattered, alpha);
}
