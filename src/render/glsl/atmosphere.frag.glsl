#include ./noise.glsl
#include ./lighting.glsl

/**
 * Atmospheric shell.
 *
 * Rendered on a back-face sphere slightly larger than the planet. For each
 * pixel we march the view ray through the shell, accumulating Rayleigh and Mie
 * scattering against optical depth toward the star. That is what produces the
 * horizon glow, the blue limb, the reddened sunset band at the terminator and
 * genuine depth — rather than a fresnel ring pretending to be air.
 */

uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform float uDensity;
uniform vec3 uRayleigh;      // per-channel scattering coefficients
uniform vec3 uMieColor;
uniform float uMieStrength;
uniform float uTime;
uniform float uDisturbance;  // 0..1 rises after impacts: dust loading, haze
uniform int uSteps;

uniform mat4 uModel;   // three injects uModel into the vertex stage only
varying vec3 vWorldPos;

void main() {
  vec3 planetCentre = (uModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 ro = cameraPosition - planetCentre;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  vec2 atmoHit = raySphere(ro, rd, uAtmoRadius);
  if (atmoHit.x > atmoHit.y) discard;

  vec2 planetHit = raySphere(ro, rd, uPlanetRadius);

  float near = max(atmoHit.x, 0.0);
  float far = atmoHit.y;
  // Stop the march at the ground if the ray hits the planet.
  if (planetHit.x <= planetHit.y && planetHit.x > 0.0) far = min(far, planetHit.x);
  if (far <= near) discard;

  vec3 lightDir = normalize(uLightPos - planetCentre);
  float cosTheta = dot(rd, lightDir);
  float phaseR = phaseRayleigh(cosTheta);
  float phaseM = phaseHG(cosTheta, 0.76);

  float shellThickness = uAtmoRadius - uPlanetRadius;
  int steps = uSteps;
  float segLen = (far - near) / float(steps);

  vec3 accumR = vec3(0.0);
  vec3 accumM = vec3(0.0);
  float opticalDepth = 0.0;

  for (int i = 0; i < 32; i++) {
    if (i >= steps) break;
    float t = near + (float(i) + 0.5) * segLen;
    vec3 pos = ro + rd * t;
    float h = (length(pos) - uPlanetRadius) / shellThickness;
    if (h < 0.0 || h > 1.0) continue;

    // Exponential falloff — air thins with altitude.
    float density = exp(-h * 3.4) * uDensity;

    // Dust loading after major impacts: thicker, hazier, higher-altitude murk.
    if (uDisturbance > 0.001) {
      float dust = fbm(pos * 0.18 + vec3(uTime * 0.05), 4) * 0.5 + 0.5;
      density *= 1.0 + uDisturbance * (1.2 + dust * 2.0) * exp(-h * 1.4);
    }

    // Optical depth from this sample toward the star: how much light survives
    // the journey in. Approximated by the shell chord rather than a second march.
    vec2 toLight = raySphere(pos, lightDir, uAtmoRadius);
    float sunRay = max(toLight.y, 0.0);
    vec2 blocked = raySphere(pos, lightDir, uPlanetRadius);
    // Fragment is in the planet's shadow — no direct light reaches it.
    float shadow = (blocked.x <= blocked.y && blocked.y > 0.0) ? 0.0 : 1.0;
    // Soften the shadow edge so the terminator glow is gradual.
    float grazing = smoothstep(-0.12, 0.16, dot(normalize(pos), lightDir));
    shadow = max(shadow * grazing, grazing * 0.35);

    float sunDepth = exp(-h * 2.0) * sunRay * uDensity * 0.06;
    float transmit = exp(-(sunDepth + opticalDepth * 0.8));

    accumR += density * segLen * transmit * shadow;
    accumM += density * segLen * transmit * shadow * uMieStrength;
    opticalDepth += density * segLen * 0.04;
  }

  vec3 scattered =
      accumR * uRayleigh * phaseR * 18.0
    + accumM * uMieColor * phaseM * 2.6;

  scattered *= uLightColor * uLightIntensity;

  // Alpha from total scattering — thick limb, transparent overhead.
  float alpha = clamp(length(scattered) * 1.25, 0.0, 1.0);
  alpha *= smoothstep(0.0, 0.08, uDensity);

  gl_FragColor = vec4(scattered, alpha);
}
