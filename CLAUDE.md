# COSMIC FORGE — build environment

## Stack (already installed, do NOT reinstall or scaffold over it)
- Vite 7 + React 19 + `@vitejs/plugin-react` + `vite-plugin-glsl`
- three 0.185, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `postprocessing`
- `zustand` for state, `leva` available for debug panels
- Entry point expected: `index.html` -> `src/main.jsx`
- Plain JS/JSX (no TypeScript setup here). `.glsl` / `.vert` / `.frag` imports work via vite-plugin-glsl.

## Hard environment rules
- `vite.config.js` MUST keep `server.host: '0.0.0.0'`, `port: 5173`, `strictPort: true`, `allowedHosts: true`
  and the `hmr: { clientPort: 443, protocol: 'wss' }` block. The preview is proxied over HTTPS from an
  external host; changing these breaks the live preview. Do not touch them.
- NO network at runtime. Do not load textures, HDRIs, fonts, models or any asset from a CDN or external URL.
  **Every visual must be procedural / shader-generated / generated at runtime into a DataTexture or CanvasTexture.**
  This is a feature, not a limitation — procedural planets look better and scale infinitely.
- `npm install` works if you genuinely need a package, but prefer zero new deps.
- Verify by running `npm run build` (must succeed with zero errors) and by starting the dev server briefly.
  Never leave a blocking foreground process running — use `npm run build` for verification, or start the
  dev server with `nohup ... &` and curl `http://localhost:5173` to confirm it serves.

## Skills available (use them)
`cosmic-taste` (design bar + reference library), `genjutsu-threejs-r3f`, `genjutsu-ui-ux-pro-max`,
`genjutsu-motion-principles`, `genjutsu-mobile-principles`, `genjutsu-canvas-generative`,
`genjutsu-gsap`, `genjutsu-framer-motion`, `genjutsu-css-native`, `genjutsu-design-audit`,
plus `brainstorming`, `writing-plans`, `executing-plans`, `systematic-debugging`,
`verification-before-completion`. Read the relevant SKILL.md files before writing code.

## Architecture expectations
```
src/
  main.jsx
  App.jsx
  core/          engine: quality manager, perf monitor, scale manager, event bus, object pools
  sim/           physics: n-body integrator, damage field, debris system, collision
  render/        shaders + materials: planet, atmosphere, clouds, star, galaxy
  entities/      Planet, Star, Moon, Asteroid, Debris, Satellite
  weapons/       modular weapon registry (laser / kinetic / gravity / cosmic / orbital)
  camera/        orbit rig, scale transitions, cinematic director
  ui/            HUD (minimal, glass, world-space where spatial)
  state/         zustand stores
```
Every module must be independently readable. No 2000-line God components.

## Definition of done for each step
IMPLEMENT -> `npm run build` passes -> dev server serves -> visually reasoned about -> optimized -> next step.
A feature is not done until it builds and runs.
