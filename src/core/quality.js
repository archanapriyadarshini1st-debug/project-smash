/**
 * Quality manager.
 *
 * Detects device class once at boot, then exposes a tier and a budget table.
 * Every renderer/sim module reads its counts from the budget, never hardcodes.
 * Principle: same game everywhere, intelligently scaled resolution/LOD/effects.
 */

export const TIERS = ['mobile-eco', 'mobile', 'mobile-high', 'desktop', 'desktop-high', 'ultra']

const BUDGETS = {
  'mobile-eco': {
    dpr: [0.6, 1.0],
    planetSegments: 96,
    damageRes: 256,
    cloudLayers: 1,
    debrisMax: 120,
    particleMax: 400,
    starfield: 3500,
    galaxyStars: 14000,
    beltRocks: 90,
    bloom: true,
    bloomKernel: 2,
    shadows: false,
    postAberration: false,
    godrays: false,
    displacement: false,
    reliefSteps: 0,
    simHz: 30,
    anisotropy: 1,
  },
  mobile: {
    dpr: [0.75, 1.3],
    planetSegments: 128,
    damageRes: 512,
    cloudLayers: 1,
    debrisMax: 260,
    particleMax: 900,
    starfield: 6000,
    galaxyStars: 30000,
    beltRocks: 160,
    bloom: true,
    bloomKernel: 3,
    shadows: false,
    postAberration: false,
    godrays: false,
    displacement: true,
    reliefSteps: 0,
    simHz: 45,
    anisotropy: 2,
  },
  'mobile-high': {
    dpr: [0.9, 1.7],
    planetSegments: 160,
    damageRes: 768,
    cloudLayers: 2,
    debrisMax: 420,
    particleMax: 1500,
    starfield: 9000,
    galaxyStars: 55000,
    beltRocks: 240,
    bloom: true,
    bloomKernel: 3,
    shadows: false,
    postAberration: true,
    godrays: false,
    displacement: true,
    reliefSteps: 6,
    simHz: 60,
    anisotropy: 4,
  },
  desktop: {
    dpr: [1, 1.75],
    planetSegments: 224,
    damageRes: 1024,
    cloudLayers: 2,
    debrisMax: 900,
    particleMax: 3200,
    starfield: 14000,
    galaxyStars: 110000,
    beltRocks: 420,
    bloom: true,
    bloomKernel: 4,
    shadows: true,
    postAberration: true,
    godrays: true,
    displacement: true,
    reliefSteps: 10,
    simHz: 60,
    anisotropy: 8,
  },
  'desktop-high': {
    dpr: [1, 2],
    planetSegments: 288,
    damageRes: 1536,
    cloudLayers: 3,
    debrisMax: 1600,
    particleMax: 6000,
    starfield: 20000,
    galaxyStars: 180000,
    beltRocks: 700,
    bloom: true,
    bloomKernel: 4,
    shadows: true,
    postAberration: true,
    godrays: true,
    displacement: true,
    reliefSteps: 14,
    simHz: 60,
    anisotropy: 8,
  },
  ultra: {
    dpr: [1, 2],
    planetSegments: 384,
    damageRes: 2048,
    cloudLayers: 3,
    debrisMax: 2600,
    particleMax: 9000,
    starfield: 28000,
    galaxyStars: 260000,
    beltRocks: 1100,
    bloom: true,
    bloomKernel: 5,
    shadows: true,
    postAberration: true,
    godrays: true,
    displacement: true,
    reliefSteps: 20,
    simHz: 60,
    anisotropy: 16,
  },
}

export function budgetFor(tier) {
  return BUDGETS[tier] ?? BUDGETS.desktop
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
}

function gpuInfo() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return { renderer: '', maxTexture: 2048, webgl2: false }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
    const lose = gl.getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return { renderer, maxTexture, webgl2 }
  } catch {
    return { renderer: '', maxTexture: 2048, webgl2: false }
  }
}

/** Score-based detection. Conservative: unknown hardware lands mid-tier, never ultra. */
export function detectTier() {
  if (typeof window === 'undefined') return 'desktop'

  const { renderer, maxTexture, webgl2 } = gpuInfo()
  const gpu = renderer.toLowerCase()
  const touch = isTouchDevice()
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = navigator.deviceMemory ?? 4
  const px = window.screen.width * window.screen.height * (window.devicePixelRatio || 1)

  let score = 0

  if (webgl2) score += 2
  if (maxTexture >= 8192) score += 1
  if (maxTexture >= 16384) score += 1

  if (cores >= 8) score += 2
  else if (cores >= 6) score += 1
  else if (cores <= 3) score -= 1

  if (mem >= 8) score += 1
  if (mem <= 2) score -= 2

  // Discrete desktop GPUs.
  if (/rtx|radeon rx|geforce gtx 1[06-9]|geforce rtx|arc a\d/.test(gpu)) score += 4
  else if (/geforce|quadro|radeon/.test(gpu)) score += 2
  // Apple silicon is strong on both desktop and tablet.
  else if (/apple m[1-9]/.test(gpu)) score += 4
  else if (/apple gpu|apple a\d{2}/.test(gpu)) score += 2
  // Known-weak mobile parts.
  if (/mali-[gt]\d?\d(\s|$)|adreno \([1-5]\d\d\)|powervr/.test(gpu)) score -= 3
  if (/intel/.test(gpu) && !/arc/.test(gpu)) score -= 1

  // Very high pixel counts cost fill rate regardless of GPU.
  if (px > 8_000_000) score -= 1

  if (touch) {
    if (score >= 7) return 'mobile-high'
    if (score >= 3) return 'mobile'
    return 'mobile-eco'
  }
  if (score >= 9) return 'ultra'
  if (score >= 6) return 'desktop-high'
  if (score >= 2) return 'desktop'
  return 'mobile-high' // weak desktop: use the scaled path, keep all gameplay
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
