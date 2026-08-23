import * as THREE from 'three'

/**
 * Planet archetypes. Every value here is a shader/sim parameter — the visual
 * identity of a world is entirely procedural, driven by these numbers.
 *
 * type: 0 terrestrial, 1 rocky, 2 gas giant, 3 lava, 4 ice
 */

const c = (hex) => new THREE.Color(hex)

export const PLANET_TYPES = {
  terrestrial: {
    type: 0,
    label: 'Terrestrial',
    terrainScale: 2.1,
    terrainAmp: 0.028,
    seaLevel: 0.02,
    iceLatitude: 0.74,
    population: 1,
    coreTemp: 5800,
    crustHardness: 1,
    colors: {
      deepWater: c('#050f26'),
      shallowWater: c('#0e4a63'),
      lowland: c('#2f4426'),
      highland: c('#6b6046'),
      rock: c('#7d7264'),
      ice: c('#e8f0f6'),
      sand: c('#a89268'),
    },
    atmosphere: {
      height: 0.055,
      density: 1.0,
      rayleigh: new THREE.Vector3(0.19, 0.44, 1.0),
      mieColor: c('#e8ecf0'),
      mieStrength: 0.22,
    },
    clouds: { inner: 1.004, outer: 1.035, coverage: 0.52, density: 1.0, tint: c('#f2f6fb'), speed: 0.014 },
  },

  rocky: {
    type: 1,
    label: 'Rocky',
    terrainScale: 2.6,
    terrainAmp: 0.034,
    seaLevel: -1,
    iceLatitude: 0.95,
    population: 0,
    coreTemp: 3200,
    crustHardness: 1.35,
    colors: {
      deepWater: c('#000000'),
      shallowWater: c('#000000'),
      lowland: c('#54493f'),
      highland: c('#7a6d5e'),
      rock: c('#8d8377'),
      ice: c('#cfd6dc'),
      sand: c('#6e6154'),
    },
    atmosphere: { height: 0.012, density: 0.08, rayleigh: new THREE.Vector3(0.5, 0.4, 0.35), mieColor: c('#cbb79c'), mieStrength: 0.5 },
    clouds: null,
  },

  gas: {
    type: 2,
    label: 'Gas Giant',
    terrainScale: 1.5,
    terrainAmp: 0,
    seaLevel: -1,
    iceLatitude: 2,
    population: 0,
    coreTemp: 12000,
    crustHardness: 0.4,
    colors: {
      deepWater: c('#000000'),
      shallowWater: c('#000000'),
      lowland: c('#b08a5e'),
      highland: c('#e6d3b3'),
      rock: c('#a85b3c'),
      ice: c('#f0e6d6'),
      sand: c('#c9a074'),
    },
    atmosphere: { height: 0.06, density: 1.6, rayleigh: new THREE.Vector3(0.5, 0.42, 0.3), mieColor: c('#f0dcc0'), mieStrength: 0.4 },
    clouds: { inner: 1.0, outer: 1.05, coverage: 0.78, density: 1.5, tint: c('#f6e8d2'), speed: 0.03 },
  },

  lava: {
    type: 3,
    label: 'Molten',
    terrainScale: 2.4,
    terrainAmp: 0.03,
    seaLevel: -1,
    iceLatitude: 2,
    population: 0,
    coreTemp: 6400,
    crustHardness: 0.7,
    colors: {
      deepWater: c('#000000'),
      shallowWater: c('#000000'),
      lowland: c('#c2410c'),
      highland: c('#7c2d12'),
      rock: c('#2a1c16'),
      ice: c('#000000'),
      sand: c('#4a2317'),
    },
    atmosphere: { height: 0.035, density: 0.55, rayleigh: new THREE.Vector3(1.0, 0.4, 0.18), mieColor: c('#ff8a4c'), mieStrength: 0.7 },
    clouds: { inner: 1.006, outer: 1.03, coverage: 0.34, density: 0.9, tint: c('#4a3a34'), speed: 0.02 },
  },

  ice: {
    type: 4,
    label: 'Ice World',
    terrainScale: 2.2,
    terrainAmp: 0.022,
    seaLevel: -1,
    iceLatitude: 0.05,
    population: 0,
    coreTemp: 2200,
    crustHardness: 1.1,
    colors: {
      deepWater: c('#0a2a3d'),
      shallowWater: c('#1d5c78'),
      lowland: c('#b9ccd8'),
      highland: c('#d7e5ee'),
      rock: c('#8fa3b0'),
      ice: c('#f2f9ff'),
      sand: c('#a8bcc9'),
    },
    atmosphere: { height: 0.03, density: 0.4, rayleigh: new THREE.Vector3(0.35, 0.6, 1.0), mieColor: c('#dff0ff'), mieStrength: 0.3 },
    clouds: { inner: 1.004, outer: 1.026, coverage: 0.4, density: 0.8, tint: c('#eaf6ff'), speed: 0.01 },
  },
}

export function presetFor(key) {
  return PLANET_TYPES[key] ?? PLANET_TYPES.terrestrial
}

/** The hero world of the orbit stage. */
export const TERRA = {
  id: 'terra',
  name: 'Terra Nova',
  preset: 'terrestrial',
  radius: 1,
  mass: 1,
  rotationPeriod: 240, // seconds per rotation — slow enough to inspect
  axialTilt: 0.41,
  population: 8.1e9,
}
