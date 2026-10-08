import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Each project is a separate Chromium launch with its own flags.
// channel 'chromium' uses full headless Chromium; the default headless shell has no WebGPU adapter.
const chromium = (name, include, args, provide = {}) => ({
  browser: 'chromium', name, include, provide,
  provider: playwright({ launchOptions: { args, channel: 'chromium' } })
});

export default defineConfig({
  test: {
    reporters: ['verbose'],
    testTimeout: 30000,
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright(),
      instances: [
        chromium('swiftshader', ['test/webgl.test.js'],
          ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], { backend: 'swiftshader' }),
        chromium('hardware', ['test/webgl.test.js'], ['--ignore-gpu-blocklist'], { backend: 'hardware' }),
        chromium('webgpu', ['test/webgpu.test.js'], ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'])
      ]
    }
  }
});
