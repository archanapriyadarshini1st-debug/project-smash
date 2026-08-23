// Physically-inspired shading terms shared by planet, moon, asteroid and debris
// materials. Not a full PBR pipeline — a tuned subset that holds up at close
// range under a single strong star light plus faint ambient bounce.

const float PI = 3.141592653589793;

float distributionGGX(float NdotH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

float geometrySmith(float NdotV, float NdotL, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  float gv = NdotV / (NdotV * (1.0 - k) + k);
  float gl = NdotL / (NdotL * (1.0 - k) + k);
  return gv * gl;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

/**
 * Direct lighting for one light.
 * albedo/roughness/metallic per-fragment so a single planet surface can move
 * from wet ocean to dry rock to ice without switching materials.
 */
vec3 shadeDirect(
  vec3 N, vec3 V, vec3 L, vec3 lightColor, float lightIntensity,
  vec3 albedo, float roughness, float metallic
) {
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 1e-4);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  float D = distributionGGX(NdotH, roughness);
  float G = geometrySmith(NdotV, NdotL, roughness);
  vec3 F = fresnelSchlick(VdotH, F0);

  vec3 spec = (D * G * F) / max(4.0 * NdotV * NdotL, 1e-4);
  vec3 kD = (1.0 - F) * (1.0 - metallic);
  vec3 diff = albedo / PI;

  return (diff * kD + spec) * lightColor * lightIntensity * NdotL;
}

// Cheap wrapped diffuse — fakes subsurface/atmospheric bounce so the terminator
// isn't a hard black line. Real planets have a soft, reddened day/night edge.
float wrapDiffuse(float NdotL, float wrap) {
  return clamp((NdotL + wrap) / (1.0 + wrap), 0.0, 1.0);
}

// Henyey-Greenstein phase function: forward-scattering for atmosphere and dust.
float phaseHG(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

// Rayleigh phase — blue-sky scattering angular distribution.
float phaseRayleigh(float cosTheta) {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

// Analytic ray/sphere intersection. Returns (near, far); near > far means miss.
vec2 raySphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1.0, -1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

// ACES-inspired filmic tonemap. Keeps hot cores (stars, plasma, impact flashes)
// from clipping to flat white the way Reinhard does.
vec3 tonemapACES(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Blackbody-ish colour from temperature in Kelvin. Drives star colour and the
// glow of freshly exposed planetary interior.
vec3 blackbody(float tempK) {
  float t = clamp(tempK, 1000.0, 40000.0) / 100.0;
  float r, g, b;
  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
  }
  if (t >= 66.0) b = 255.0;
  else if (t <= 19.0) b = 0.0;
  else b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
  return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
}
