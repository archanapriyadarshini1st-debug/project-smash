import * as THREE from 'three'
import planetVert from './glsl/planet.vert.glsl'
import planetFrag from './glsl/planet.frag.glsl'
import shellVert from './glsl/shell.vert.glsl'
import atmoFrag from './glsl/atmosphere.frag.glsl'
import cloudFrag from './glsl/clouds.frag.glsl'

/**
 * Material factories. Each returns a ShaderMaterial plus the uniform object so
 * callers can mutate uniforms per frame without touching React state.
 */

export function createSurfaceMaterial({ preset, radius, damageTexture, budget }) {
  const col = preset.colors
  const uniforms = {
    uDamage: { value: damageTexture },
    uTime: { value: 0 },
    uModel: { value: new THREE.Matrix4() },
    uRadius: { value: radius },
    uTerrainScale: { value: preset.terrainScale },
    uTerrainAmp: { value: preset.terrainAmp },
    uSeaLevel: { value: preset.seaLevel },
    uExcavationDepth: { value: 0.09 },
    uOctaves: { value: budget.displacement ? (budget.reliefSteps > 8 ? 8 : 6) : 5 },
    uType: { value: preset.type },

    uLightPos: { value: new THREE.Vector3(50, 0, 0) },
    uLightColor: { value: new THREE.Color('#fff4e6') },
    uLightIntensity: { value: 3.4 },
    uAmbient: { value: new THREE.Color('#0a1020').multiplyScalar(0.5) },

    uDeepWater: { value: col.deepWater.clone() },
    uShallowWater: { value: col.shallowWater.clone() },
    uLowland: { value: col.lowland.clone() },
    uHighland: { value: col.highland.clone() },
    uRock: { value: col.rock.clone() },
    uIce: { value: col.ice.clone() },
    uSand: { value: col.sand.clone() },

    uPopulation: { value: preset.population },
    uAtmosphere: { value: 1 },
    uCoreTemp: { value: preset.coreTemp },
    uIceLatitude: { value: preset.iceLatitude },
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: planetVert,
    fragmentShader: planetFrag,
    uniforms,
  })
  return { material, uniforms }
}

export function createAtmosphereMaterial({ preset, radius, budget }) {
  const a = preset.atmosphere
  const uniforms = {
    uLightPos: { value: new THREE.Vector3(50, 0, 0) },
    uLightColor: { value: new THREE.Color('#fff4e6') },
    uLightIntensity: { value: 3.4 },
    uPlanetRadius: { value: radius },
    uAtmoRadius: { value: radius * (1 + a.height) },
    uDensity: { value: a.density },
    uRayleigh: { value: a.rayleigh.clone() },
    uMieColor: { value: a.mieColor.clone() },
    uMieStrength: { value: a.mieStrength },
    uTime: { value: 0 },
    uModel: { value: new THREE.Matrix4() },
    uDisturbance: { value: 0 },
    uSteps: { value: budget.reliefSteps > 10 ? 24 : budget.reliefSteps > 5 ? 16 : 10 },
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: shellVert,
    fragmentShader: atmoFrag,
    uniforms,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  return { material, uniforms }
}

export function createCloudMaterial({ preset, radius, damageTexture, budget }) {
  const cl = preset.clouds
  if (!cl) return null
  const uniforms = {
    uLightPos: { value: new THREE.Vector3(50, 0, 0) },
    uLightColor: { value: new THREE.Color('#fff4e6') },
    uLightIntensity: { value: 3.4 },
    uPlanetRadius: { value: radius },
    uInner: { value: radius * cl.inner },
    uOuter: { value: radius * cl.outer },
    uTime: { value: 0 },
    uModel: { value: new THREE.Matrix4() },
    uCoverage: { value: cl.coverage },
    uDensity: { value: cl.density },
    uRotation: { value: 0 },
    uDisturbance: { value: 0 },
    uTint: { value: cl.tint.clone() },
    uSteps: { value: budget.cloudLayers >= 3 ? 24 : budget.cloudLayers === 2 ? 16 : 10 },
    uLightSteps: { value: budget.cloudLayers >= 3 ? 5 : budget.cloudLayers === 2 ? 3 : 2 },
    uDamage: { value: damageTexture },
  }

  const material = new THREE.ShaderMaterial({
    vertexShader: shellVert,
    fragmentShader: cloudFrag,
    uniforms,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  })
  return { material, uniforms, config: cl }
}

/** Keep the three shells in sync with the star that lights them. */
export function syncLighting(uniformSets, lightPos, lightColor, intensity) {
  for (const u of uniformSets) {
    if (!u) continue
    u.uLightPos?.value.copy(lightPos)
    if (u.uLightColor && lightColor) u.uLightColor.value.copy(lightColor)
    if (u.uLightIntensity && intensity !== undefined) u.uLightIntensity.value = intensity
  }
}
