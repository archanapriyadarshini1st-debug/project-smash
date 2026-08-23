import { create } from 'zustand'
import { detectTier, budgetFor, isTouchDevice, prefersReducedMotion } from '../core/quality.js'

const initialTier = detectTier()

/**
 * Global game state.
 *
 * Deliberately excludes anything that changes every frame — planet positions,
 * damage texels, debris transforms all live in mutable sim objects and are read
 * by ref. Putting them here would re-render React 60x/sec.
 */
export const useStore = create((set, get) => ({
  // ---- device / quality -------------------------------------------------
  tier: initialTier,
  budget: budgetFor(initialTier),
  autoQuality: true,
  touch: isTouchDevice(),
  reducedMotion: prefersReducedMotion(),
  perfState: null,
  setTier: (tier) => set({ tier, budget: budgetFor(tier), autoQuality: false }),
  setAutoQuality: (v) => set({ autoQuality: v }),
  setPerfState: (perfState) => set({ perfState }),

  // ---- scale / stage ----------------------------------------------------
  // orbit -> system -> galaxy. Transitions are camera-driven, never teleports.
  scale: 'orbit',
  transitioning: false,
  setScale: (scale) => set({ scale }),
  setTransitioning: (transitioning) => set({ transitioning }),

  // ---- selection & focus ----------------------------------------------
  focusId: 'terra',
  selectedId: null,
  setFocus: (focusId) => set({ focusId }),
  setSelected: (selectedId) => set({ selectedId }),

  // ---- weapons ---------------------------------------------------------
  activeWeapon: 'precision-laser',
  firing: false,
  charge: 0,
  setWeapon: (activeWeapon) => set({ activeWeapon, firing: false, charge: 0 }),
  setFiring: (firing) => set({ firing }),

  // ---- targeting -------------------------------------------------------
  // World-space aim result, written by the raycast each pointer move.
  aim: null,
  setAim: (aim) => set({ aim }),

  // ---- planet telemetry (updated at a few Hz, not per-frame) ----------
  telemetry: {
    integrity: 1,
    population: 8.1e9,
    surfaceTemp: 288,
    craters: 0,
    debris: 0,
    atmosphere: 1,
    coreExposed: 0,
  },
  setTelemetry: (patch) => set((s) => ({ telemetry: { ...s.telemetry, ...patch } })),

  // ---- UI --------------------------------------------------------------
  hudVisible: true,
  panel: null, // 'weapons' | 'quality' | 'creator' | null
  cinematic: false,
  toggleHud: () => set((s) => ({ hudVisible: !s.hudVisible })),
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
  setCinematic: (cinematic) => set({ cinematic }),

  // ---- events ----------------------------------------------------------
  // Small rolling log surfaced in the HUD. Consequences should be legible.
  events: [],
  pushEvent: (text, kind = 'info') =>
    set((s) => ({
      events: [{ id: s.events.length ? s.events[0].id + 1 : 1, text, kind, t: 0 }, ...s.events].slice(0, 6),
    })),

  resetSignal: 0,
  reset: () =>
    set((s) => ({
      resetSignal: s.resetSignal + 1,
      telemetry: {
        integrity: 1,
        population: 8.1e9,
        surfaceTemp: 288,
        craters: 0,
        debris: 0,
        atmosphere: 1,
        coreExposed: 0,
      },
      events: [],
      firing: false,
      selectedId: null,
    })),
}))

export const selectBudget = (s) => s.budget
export const selectTelemetry = (s) => s.telemetry
