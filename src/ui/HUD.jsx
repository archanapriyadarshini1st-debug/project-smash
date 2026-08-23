import { useEffect } from 'react'
import { useStore } from '../state/useStore.js'
import { WEAPON_LIST } from '../weapons/registry.js'
import { TIERS } from '../core/quality.js'

/**
 * HUD — glass, thin, out of the way.
 *
 * Spatial information lives in the 3D scene (reticle, beams, markers). This
 * layer carries only what genuinely reads better as flat text: telemetry
 * numbers, the weapon list, and controls.
 */

const glass = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 10,
  color: 'rgba(255,255,255,0.75)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  letterSpacing: '0.04em',
}

const ACCENT = '#6fd7ff'

function fmtPop(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K'
  return Math.max(0, Math.round(n)).toString()
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, fontSize: 11, lineHeight: '20px' }}>
      <span style={{ opacity: 0.5 }}>{label}</span>
      <span style={{ color: accent || 'rgba(255,255,255,0.92)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function Bar({ value }) {
  const pct = Math.max(0, Math.min(1, value))
  const hue = pct > 0.5 ? ACCENT : pct > 0.2 ? '#ffcc66' : '#ff5470'
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', margin: '6px 0 10px' }}>
      <div style={{ width: `${pct * 100}%`, height: '100%', background: hue, transition: 'width 200ms linear' }} />
    </div>
  )
}

export function HUD() {
  const activeWeapon = useStore((s) => s.activeWeapon)
  const setWeapon = useStore((s) => s.setWeapon)
  const telemetry = useStore((s) => s.telemetry)
  const events = useStore((s) => s.events)
  const reset = useStore((s) => s.reset)
  const tier = useStore((s) => s.tier)
  const setTier = useStore((s) => s.setTier)
  const hudVisible = useStore((s) => s.hudVisible)
  const toggleHud = useStore((s) => s.toggleHud)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'h' || e.key === 'H') toggleHud() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleHud])

  if (!hudVisible) return null

  const byCat = WEAPON_LIST.reduce((acc, w) => {
    (acc[w.category] ||= []).push(w)
    return acc
  }, {})

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {/* ---- weapons ---- */}
      <div style={{ ...glass, position: 'absolute', left: 16, top: 16, padding: '12px 12px 8px', width: 208, pointerEvents: 'auto' }}>
        <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 10 }}>ARMAMENT</div>
        {Object.entries(byCat).map(([cat, list]) => (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, opacity: 0.3, marginBottom: 4 }}>{cat}</div>
            {list.map((w) => {
              const active = w.id === activeWeapon
              const idx = WEAPON_LIST.indexOf(w) + 1
              return (
                <button
                  key={w.id}
                  onClick={() => setWeapon(w.id)}
                  title={w.desc}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    minHeight: 30, padding: '0 8px', marginBottom: 2,
                    background: active ? 'rgba(111,215,255,0.12)' : 'transparent',
                    border: active ? '1px solid rgba(111,215,255,0.35)' : '1px solid transparent',
                    borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                    color: active ? ACCENT : 'rgba(255,255,255,0.62)',
                    fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.03em',
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                    background: `#${w.color.getHexString()}`,
                    boxShadow: active ? `0 0 8px #${w.color.getHexString()}` : 'none',
                  }} />
                  <span style={{ flex: 1 }}>{w.name}</span>
                  <span style={{ opacity: 0.3, fontSize: 9 }}>{idx}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ---- telemetry ---- */}
      <div style={{ ...glass, position: 'absolute', right: 16, top: 16, padding: '12px 14px', width: 210, pointerEvents: 'auto' }}>
        <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 8 }}>PLANETARY TELEMETRY</div>
        <Stat label="INTEGRITY" value={`${(telemetry.integrity * 100).toFixed(1)}%`} accent={telemetry.integrity < 0.3 ? '#ff5470' : ACCENT} />
        <Bar value={telemetry.integrity} />
        <Stat label="POPULATION" value={fmtPop(telemetry.population)} />
        <Stat label="CRATERS" value={telemetry.craters} />
        <Stat label="DEBRIS" value={telemetry.debris} />
        <Stat label="ATMOSPHERE" value={`${(telemetry.atmosphere * 100).toFixed(0)}%`} />
        {telemetry.coreExposed > 0 && (
          <div style={{ marginTop: 8, fontSize: 10, color: '#ff5470', letterSpacing: '0.08em' }}>◆ MANTLE EXPOSED</div>
        )}
      </div>

      {/* ---- event log ---- */}
      <div style={{ position: 'absolute', right: 16, top: 250, width: 210, pointerEvents: 'none' }}>
        {events.map((e) => (
          <div key={e.id} style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 10, marginBottom: 4,
            padding: '4px 8px', borderRadius: 5,
            background: 'rgba(0,0,0,0.28)',
            borderLeft: `2px solid ${e.kind === 'danger' ? '#ff5470' : e.kind === 'warn' ? '#ffcc66' : ACCENT}`,
            color: 'rgba(255,255,255,0.7)',
          }}>{e.text}</div>
        ))}
      </div>

      {/* ---- controls ---- */}
      <div style={{ ...glass, position: 'absolute', left: 16, bottom: 16, padding: 8, display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'auto' }}>
        <button onClick={reset} style={{
          minHeight: 32, minWidth: 68, padding: '0 12px', borderRadius: 6, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.8)', fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.06em',
        }}>RESET</button>
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={{
          minHeight: 32, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
          background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.8)', fontFamily: 'inherit', fontSize: 11,
        }}>
          {TIERS.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
      </div>

      {/* ---- hint ---- */}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'rgba(255,255,255,0.28)',
        letterSpacing: '0.1em', pointerEvents: 'none', textAlign: 'center',
      }}>
        DRAG ON THE SURFACE TO CARVE · RIGHT-DRAG TO ORBIT · 1-8 WEAPONS · R RESET · H HUD
      </div>
    </div>
  )
}

export default HUD
