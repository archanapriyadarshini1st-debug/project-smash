import { Suspense, useRef, useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Planet } from './entities/Planet.jsx'
import { DebrisField } from './entities/DebrisField.jsx'
import { Starfield } from './render/Starfield.jsx'
import { WeaponSystem } from './weapons/WeaponSystem.jsx'
import { EnvironmentLayer, EnvironmentTelemetry } from './render/EnvironmentLayer.jsx'
import { EnvironmentSim } from './sim/environment.js'
import { Reticle } from './ui/Reticle.jsx'
import { HUD } from './ui/HUD.jsx'
import { TERRA } from './entities/planetPresets.js'
import { useStore } from './state/useStore.js'

function Scene() {
  const lightRef = useRef()
  const planetRef = useRef()
  const debrisRef = useRef()
  const envRef = useRef(null)
  if (!envRef.current) envRef.current = new EnvironmentSim({ planetRadius: TERRA.radius })
  const spinRef = useRef(null)
  const [, force] = useState(0)
  const budget = useStore((s) => s.budget)
  const firing = useStore((s) => s.firing)

  // The planet's spin group is the frame debris must live in, so ejecta
  // rotates with the world instead of hanging in absolute space.
  useEffect(() => {
    const id = setInterval(() => {
      if (planetRef.current?.object && spinRef.current !== planetRef.current.object) {
        spinRef.current = planetRef.current.object
        force((n) => n + 1)
      }
    }, 120)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <Starfield />
      <object3D ref={lightRef} position={[40, 12, 18]} />
      <directionalLight position={[40, 12, 18]} intensity={0.35} />
      <ambientLight intensity={0.06} />

      <Planet
        ref={planetRef}
        id={TERRA.id}
        preset={TERRA.preset}
        radius={TERRA.radius}
        rotationPeriod={TERRA.rotationPeriod}
        axialTilt={TERRA.axialTilt}
        lightRef={lightRef}
      />

      <DebrisField ref={debrisRef} planetRadius={TERRA.radius} parentRef={spinRef} />
      <WeaponSystem planetRef={planetRef} debrisRef={debrisRef} envRef={envRef} />
      <EnvironmentLayer envRef={envRef} planetRadius={TERRA.radius} parentRef={spinRef} />
      <EnvironmentTelemetry envRef={envRef} />
      <Reticle planetRadius={TERRA.radius} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.06}
        minDistance={1.05}
        maxDistance={12}
        // Left-drag carves; orbiting moves to right-drag so the two never fight.
        enableRotate={!firing}
        mouseButtons={{
          LEFT: null,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        touches={{ ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      />

      {budget.bloom && (
        <EffectComposer disableNormalPass>
          <Bloom
            intensity={0.9}
            luminanceThreshold={0.55}
            luminanceSmoothing={0.25}
            mipmapBlur
            kernelSize={budget.bloomKernel ?? 3}
          />
        </EffectComposer>
      )}
    </>
  )
}

export function App() {
  const budget = useStore((s) => s.budget)
  return (
    <>
      <Canvas
        camera={{ position: [0, 0.6, 3.2], fov: 45, near: 0.001, far: 4000 }}
        dpr={budget.dpr}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ touchAction: 'none' }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <HUD />
    </>
  )
}
