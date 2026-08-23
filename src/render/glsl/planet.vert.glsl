#include ./noise.glsl

uniform sampler2D uDamage;
uniform float uTime;
uniform float uRadius;
uniform float uTerrainScale;
uniform float uTerrainAmp;
uniform float uSeaLevel;
uniform float uExcavationDepth;
uniform int uOctaves;
uniform int uType; // 0 terrestrial, 1 rocky, 2 gas, 3 lava, 4 ice

varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vElevation;
varying vec4 vDamage;

// Elevation field. Shared with the fragment stage's normal reconstruction so the
// lit relief and the displaced geometry agree exactly.
float elevationAt(vec3 dir) {
  if (uType == 2) return 0.0; // gas giants have no solid surface to displace

  vec3 p = dir * uTerrainScale;

  // Continents: low-frequency mask decides land vs ocean basin.
  float continents = fbm(p * 0.55, min(uOctaves, 5), 2.1, 0.55);

  // Mountain belts follow ridged noise, but only rise where there is land.
  float land = smoothstep(-0.06, 0.22, continents);
  float mountains = ridged(warp(p * 1.6, 0.28), min(uOctaves, 7)) * land;

  // Erosion detail — breaks up the silhouette at close range.
  float detail = fbm(p * 5.5, min(uOctaves, 6)) * 0.18;

  float e = continents * 0.55 + mountains * 0.6 + detail;

  if (uType == 3) {
    // Lava world: fractured plates rather than continents.
    vec2 w = worley(p * 1.4);
    float plates = smoothstep(0.02, 0.3, w.y - w.x);
    e = mix(e * 0.4, e * 0.4 + 0.35, plates) + ridged(p * 3.0, 5) * 0.25;
  } else if (uType == 4) {
    e = e * 0.6 + billow(p * 2.2, 5) * 0.3;
  } else if (uType == 1) {
    // Rocky/airless: craters dominate the topography.
    vec2 w = worley(p * 2.2);
    float crater = smoothstep(0.0, 0.45, w.x);
    e = e * 0.5 - (1.0 - crater) * 0.3;
  }

  // Ocean basins are flat — water fills to a level, it does not follow rock.
  e = max(e, uSeaLevel);
  return e;
}

void main() {
  vUv = uv;
  vec3 dir = normalize(position);
  vLocalNormal = dir;

  vec4 dmg = texture2D(uDamage, uv);
  vDamage = dmg;

  float elev = elevationAt(dir);
  vElevation = elev;

  // Damage physically removes material: excavation pulls the surface inward.
  // Breach digs deeper still, opening the crust so the interior shows through.
  float carve = dmg.r * uExcavationDepth + dmg.a * uExcavationDepth * 0.9;

  float displaced = uRadius * (1.0 + elev * uTerrainAmp - carve);

  vec3 pos = dir * displaced;
  vLocalPos = pos;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
