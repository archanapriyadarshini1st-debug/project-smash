#include ./noise.glsl
#include ./lighting.glsl

uniform sampler2D uDamage;
uniform float uTime;
uniform float uRadius;
uniform float uTerrainScale;
uniform float uTerrainAmp;
uniform float uSeaLevel;
uniform int uOctaves;
uniform int uType;

uniform vec3 uLightPos;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec3 uAmbient;

uniform vec3 uDeepWater;
uniform vec3 uShallowWater;
uniform vec3 uLowland;
uniform vec3 uHighland;
uniform vec3 uRock;
uniform vec3 uIce;
uniform vec3 uSand;

uniform float uPopulation;   // 0..1 — density of night-side settlement light
uniform float uAtmosphere;   // 0..1 — remaining atmosphere, thins as it is blasted
uniform float uCoreTemp;     // K — interior glow temperature
uniform float uIceLatitude;

varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vElevation;
varying vec4 vDamage;

// Same field as the vertex stage, used for analytic normals.
float elevationAt(vec3 dir) {
  if (uType == 2) return 0.0;
  vec3 p = dir * uTerrainScale;
  float continents = fbm(p * 0.55, min(uOctaves, 5), 2.1, 0.55);
  float land = smoothstep(-0.06, 0.22, continents);
  float mountains = ridged(warp(p * 1.6, 0.28), min(uOctaves, 7)) * land;
  float detail = fbm(p * 5.5, min(uOctaves, 6)) * 0.18;
  float e = continents * 0.55 + mountains * 0.6 + detail;
  if (uType == 3) {
    vec2 w = worley(p * 1.4);
    float plates = smoothstep(0.02, 0.3, w.y - w.x);
    e = mix(e * 0.4, e * 0.4 + 0.35, plates) + ridged(p * 3.0, 5) * 0.25;
  } else if (uType == 4) {
    e = e * 0.6 + billow(p * 2.2, 5) * 0.3;
  } else if (uType == 1) {
    vec2 w = worley(p * 2.2);
    float crater = smoothstep(0.0, 0.45, w.x);
    e = e * 0.5 - (1.0 - crater) * 0.3;
  }
  return max(e, uSeaLevel);
}

/**
 * Gradient normal from the elevation field.
 *
 * Displaced vertices alone give faceted lighting — the mesh can never carry
 * metre-scale relief. Sampling the analytic field in the fragment stage gives
 * per-pixel normals, so mountains stay sharp no matter how close the camera is.
 */
vec3 reliefNormal(vec3 dir, float amp) {
  // Build a tangent frame on the sphere.
  vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, dir));
  vec3 b = cross(dir, t);

  float eps = 0.0016;
  float e0 = elevationAt(normalize(dir));
  float et = elevationAt(normalize(dir + t * eps));
  float eb = elevationAt(normalize(dir + b * eps));

  // Slope in the tangent plane, scaled to the real displacement height.
  float dt = (et - e0) * amp / eps;
  float db = (eb - e0) * amp / eps;
  return normalize(dir - t * dt - b * db);
}

// Crater rim normals from the damage field, so blast craters have real relief
// and catch the light on their raised edges.
vec3 damageNormal(vec3 n, vec2 uv, float strength) {
  vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0);
  float dR = texture2D(uDamage, uv + vec2(texel.x, 0.0)).r - texture2D(uDamage, uv - vec2(texel.x, 0.0)).r;
  float dU = texture2D(uDamage, uv + vec2(0.0, texel.y)).r - texture2D(uDamage, uv - vec2(0.0, texel.y)).r;
  vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  return normalize(n + t * dR * strength + b * dU * strength);
}

void main() {
  vec3 dir = normalize(vLocalNormal);
  vec4 dmg = vDamage;

  float elev = vElevation;
  float amp = uRadius * uTerrainAmp;

  vec3 N = uType == 2 ? dir : reliefNormal(dir, amp);
  N = damageNormal(N, vUv, 26.0 * dmg.r);
  // Transform local -> world for lighting (uniform scale assumed).
  vec3 Nw = normalize(mat3(modelMatrix) * N);

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uLightPos - vWorldPos);
  float NdotL = dot(Nw, L);

  // ---- material selection ------------------------------------------------
  float height = (elev - uSeaLevel) / max(1.0 - uSeaLevel, 0.001);
  float isWater = uType == 0 ? smoothstep(0.004, 0.0, elev - uSeaLevel) : 0.0;

  vec3 albedo;
  float roughness;
  float metallic = 0.0;

  if (uType == 2) {
    // Gas giant: banded, wind-sheared atmosphere. All structure, no surface.
    vec3 p = dir * uTerrainScale;
    float bands = dir.y * 5.0;
    vec3 flow = warp(vec3(p.x * 0.5, bands, p.z * 0.5) + vec3(uTime * 0.012, 0.0, 0.0), 0.55);
    float turb = fbm(flow, uOctaves);
    float band = sin(bands * 2.2 + turb * 2.4);
    albedo = mix(uLowland, uHighland, smoothstep(-0.5, 0.6, band));
    albedo = mix(albedo, uSand, smoothstep(0.35, 0.9, turb) * 0.6);
    // Great storm — a long-lived vortex, warped into an oval.
    float storm = 1.0 - smoothstep(0.0, 0.28, length(vec2((dir.x - 0.55) * 1.6, dir.y + 0.22)));
    albedo = mix(albedo, uRock, storm * 0.8);
    roughness = 0.95;
  } else if (uType == 3) {
    // Lava world: dark basalt crust split by glowing fissures.
    vec3 p = dir * uTerrainScale;
    float veins = ridged(warp(p * 2.4, 0.4), uOctaves);
    float crust = smoothstep(0.55, 0.9, veins);
    albedo = mix(uRock * 0.25, uLowland, crust);
    roughness = mix(0.85, 0.45, crust);
  } else {
    // Rock / terrestrial: layered by altitude and slope.
    float slope = 1.0 - clamp(dot(N, dir), 0.0, 1.0);
    vec3 land = mix(uLowland, uHighland, smoothstep(0.05, 0.55, height));
    land = mix(land, uSand, smoothstep(0.02, 0.0, height) * 0.7);
    land = mix(land, uRock, smoothstep(0.12, 0.45, slope * 6.0));

    // Polar and high-altitude ice. Latitude plus altitude, with a noisy edge so
    // the ice line isn't a clean circle.
    float lat = abs(dir.y);
    float iceNoise = fbm(dir * 6.0, 4) * 0.12;
    float ice = smoothstep(uIceLatitude - 0.12, uIceLatitude + 0.08, lat + iceNoise);
    ice = max(ice, smoothstep(0.62, 0.85, height));
    land = mix(land, uIce, ice * (uType == 4 ? 1.0 : 0.9));

    albedo = mix(land, uDeepWater, isWater);
    roughness = mix(mix(0.82, 0.94, smoothstep(0.0, 0.4, height)), 0.06, isWater);
    roughness = mix(roughness, 0.35, ice * 0.5);
  }

  // Fine-grain surface imperfection — the difference between rock and plastic.
  float grain = fbm(dir * uTerrainScale * 22.0, 4);
  roughness = clamp(roughness + grain * 0.07, 0.03, 1.0);
  albedo *= 0.94 + grain * 0.12;

  // ---- water shading -----------------------------------------------------
  if (isWater > 0.01) {
    // Shallow water over the continental shelf reads brighter and greener.
    float shelf = smoothstep(-0.05, 0.0, elev - uSeaLevel);
    albedo = mix(uDeepWater, uShallowWater, shelf);

    // Wave normals: two scrolling octaves, cheap but directional.
    vec3 wp = dir * 90.0;
    float w1 = fbm(wp + vec3(uTime * 0.06, 0.0, 0.0), 3);
    float w2 = fbm(wp * 2.3 - vec3(0.0, uTime * 0.05, 0.0), 3);
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, dir));
    vec3 b = cross(dir, t);
    Nw = normalize(mat3(modelMatrix) * normalize(dir + t * w1 * 0.06 + b * w2 * 0.06));
    NdotL = dot(Nw, L);
  }

  // ---- damage response ---------------------------------------------------
  // Excavated ground is fresh, unweathered rock: brighter, rougher, no water.
  vec3 freshRock = uRock * 0.55;
  albedo = mix(albedo, freshRock, smoothstep(0.02, 0.5, dmg.r));
  // Scorch is permanent — ash and fused glass.
  albedo = mix(albedo, vec3(0.035, 0.03, 0.028), dmg.b * 0.9);
  roughness = mix(roughness, 0.65, dmg.b * 0.6);

  // ---- lighting ----------------------------------------------------------
  vec3 color = shadeDirect(Nw, V, L, uLightColor, uLightIntensity, albedo, roughness, metallic);

  // Soft terminator: atmospheric bounce keeps the night edge from going hard black.
  float wrap = wrapDiffuse(NdotL, 0.22 * uAtmosphere + 0.05);
  color += albedo * uLightColor * uLightIntensity * wrap * 0.09;
  color += albedo * uAmbient;

  // Sun glint on water — the specular lobe that sells an ocean.
  if (isWater > 0.01) {
    vec3 H = normalize(V + L);
    float glint = pow(max(dot(Nw, H), 0.0), 900.0) * 3.2;
    color += uLightColor * glint * max(NdotL, 0.0) * isWater;
  }

  // ---- emissive: molten rock and exposed interior ------------------------
  float heat = dmg.g;
  if (heat > 0.001) {
    // Cooling rock slides down the blackbody curve: white -> orange -> dull red.
    vec3 glow = blackbody(mix(900.0, 3000.0, heat));
    color += glow * pow(heat, 1.7) * 4.5;
  }

  float breach = dmg.a;
  if (breach > 0.001) {
    // Looking into the planet: crust -> mantle -> core, hotter with depth.
    float depth = clamp(breach * 1.15, 0.0, 1.0);
    vec3 mantle = blackbody(mix(1600.0, uCoreTemp, depth));
    float pulse = 0.86 + 0.14 * sin(uTime * 1.7 + dir.x * 8.0);
    color = mix(color, mantle * (2.2 + depth * 7.0) * pulse, smoothstep(0.1, 0.75, breach));
  }

  // ---- night side: settlement light --------------------------------------
  if (uType == 0 && uPopulation > 0.001) {
    float night = smoothstep(0.06, -0.22, NdotL);
    if (night > 0.001) {
      vec3 p = dir * uTerrainScale;
      // Cities cluster: cellular sites, biased to habitable low coastal land.
      vec2 w = worley(p * 7.0);
      float cluster = smoothstep(0.42, 0.02, w.x);
      float habitable = (1.0 - isWater) * smoothstep(0.0, 0.12, height) * smoothstep(0.55, 0.2, abs(dir.y));
      float grid = smoothstep(0.5, 0.85, fbm(p * 26.0, 4) * 0.5 + 0.5);
      float lights = cluster * habitable * grid * uPopulation;
      // Destroyed regions go dark and stay dark.
      lights *= (1.0 - smoothstep(0.05, 0.35, dmg.b)) * (1.0 - smoothstep(0.02, 0.3, dmg.r));
      color += vec3(1.0, 0.82, 0.52) * lights * night * 1.5;
    }
  }

  // Lava emission on lava worlds, modulated by the fissure pattern.
  if (uType == 3) {
    vec3 p = dir * uTerrainScale;
    float veins = ridged(warp(p * 2.4, 0.4), uOctaves);
    float molten = smoothstep(0.42, 0.72, 1.0 - veins);
    float flow = 0.75 + 0.25 * sin(uTime * 0.8 + veins * 22.0);
    color += blackbody(1800.0) * molten * flow * 3.0;
  }

  // Rim darkening from atmospheric absorption at grazing angles.
  float rim = 1.0 - pow(max(dot(Nw, V), 0.0), 0.55);
  color *= 1.0 - rim * 0.18 * uAtmosphere;

  gl_FragColor = vec4(color, 1.0);
}
