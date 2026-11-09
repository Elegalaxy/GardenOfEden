import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the build works at a GitHub Pages sub-path such as /garden-of-eden/.
  base: './',
  plugins: [react()],
  // The simulation worker (src/ui/sim.worker.ts) is an ES module worker, bundled into dist/assets and found by a relative URL.
  worker: { format: 'es' },
  // Several tests run thousands of sim ticks; under a full parallel run (and in CI) they can pass the 5 s default.
  test: { testTimeout: 60_000 },
})
