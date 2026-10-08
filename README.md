# SwiftShader two-argument `atan` reproduction

Minimal, direct-shader reproduction of an incorrect cubemap solid-angle integral on
Chromium's **ANGLE + Vulkan SwiftShader** WebGL2 path. There is no Three.js, TSL,
shader generator, native Node graphics binding, or rendering benchmark.

The checked-in GLSL fragment shader sums the exact solid angles of a 4 x 4 grid on
one cubemap face. Its mathematically correct result is:

```text
2*pi/3 = 2.0943951023931953
```

On the tested SwiftShader path, it returns `14.258050918579102`. The test asserts
the correct value, so **`npm test` intentionally fails on the affected backend**.
It must pass if that backend is fixed; it does not assert the erroneous result.

## Install and run

Requires Node.js 22+ and a supported Chromium host. Puppeteer downloads its pinned
Chrome for Testing during installation. If your package manager blocks install
scripts or the download was skipped, run the explicit browser installer below.

```sh
npm ci
npm exec puppeteer browsers install chrome
npm test                  # expected: 1 failure, 5 passes on the affected backend
npm run test:controls     # expected: all 5 controls pass
npm run test:webgl        # just the failing integral and passing workaround
npm run test:webgpu       # both direct WGSL controls
npm run test:hardware     # repeat the complete suite using default native WebGL
```

`test:hardware` starts a separate process/browser without forcing SwiftShader.
Chromium chooses its default backend; the printed renderer identifies it and the
test rejects silent SwiftShader fallback. Other software implementations may still
be chosen, so the command is not a guarantee that a hardware adapter exists.
WebGPU controls require an available WebGPU adapter and fail clearly if one is
unavailable; they are not silently skipped. On Linux, Chrome may require the usual
system browser libraries and a supported native graphics driver. Run as a normal
user with Chromium's sandbox enabled.

`npm test` forces WebGL SwiftShader using `--use-angle=swiftshader` and
`--enable-unsafe-swiftshader`, and verifies the actual renderer contains
`SwiftShader`. The unsafe flag opts into this local software-rendering test; the
browser visits only a temporary local HTTP server. The server uses an ephemeral
port and both browsers are closed afterward. WebGPU runs in a **separate native
browser** with `--enable-unsafe-webgpu --ignore-gpu-blocklist`: it is a comparison
against the reported native adapter, not a claim that WebGPU SwiftShader passed.
Forcing WebGL SwiftShader in the same browser produced no WebGPU adapter on the
tested machine.

## Observed results

Tested October 8, 2026 on Windows, Node.js `26.10.0`, Puppeteer `25.12.0`,
Vitest `5.0.3`, Chrome for Testing `154.0.8037.57`.

| Test | Result | Status |
| --- | ---: | --- |
| CPU `Math.atan2`, identical loop | 2.0943951023931953 | Pass |
| SwiftShader WebGL2, GLSL `atan(y, x)` | 14.258050918579102 | **Fail** |
| SwiftShader WebGL2, GLSL `atan(y / x)` workaround | 2.094395160675049 | Pass |
| SwiftShader GLSL constant `atan(y, x)` values | Within 0.0001 of CPU | Pass |
| Native WebGPU, direct WGSL `atan2(y, x)` | 2.094395160675049 | Pass |
| Native WebGPU, direct WGSL `atan(y / x)` | 2.094395160675049 | Pass |
| Native WebGL2, original GLSL | 2.094363212585449 | Pass |
| Native WebGL2, quotient GLSL | 2.094363212585449 | Pass |

Reported SwiftShader renderer:

```text
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
```

Reported native WebGL renderer:

```text
ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x00001C81) Direct3D11 vs_5_0 ps_5_0, D3D11)
```

Native WebGPU reports vendor `nvidia`, architecture `pascal`, and
`isFallbackAdapter: false`; Chromium leaves device/description blank here.
The test prints browser version, arguments, renderer/adapter, and numerical outputs
on every run. The GPU assertion tolerance is `0.0001` to accommodate the small
observed native-driver approximation error; the erroneous result exceeds it by
more than twelve radians.

## Shader and test layout

- [GLSL fragment shader](shaders/solid-angle.frag.glsl): the failing 4 x 4 integral.
- [WGSL compute shader](shaders/solid-angle.wgsl): the same algorithm, written directly.
- [Tests](test/shaders.test.js): CPU reference, expected-correct integral,
  quotient workaround, constant-expression control, and native WebGPU controls.
- [Browser harness](test/browser-shaders.js): raw WebGL2 compilation/draw/readback
  into a 1 x 1 `RGBA32F` framebuffer, and raw WebGPU compute/storage-buffer readback.

WebGL uses synchronous `readPixels` and WebGPU awaits `mapAsync` after copying the
result. Assertions therefore inspect completed shader outputs, not submitted work.
Neither path times frames or measures performance. The workaround tests replace
only the checked-in arctangent expression, leaving the algorithm identical.

## Why the workaround is valid

The area function is:

```glsl
atan(x * y, sqrt(x * x + y * y + 1.0))
```

Its **second argument is always at least one**, so it never encounters an undefined
zero/zero input and needs no quadrant correction. In this particular function,
the expression is mathematically equivalent to:

```glsl
atan((x * y) / sqrt(x * x + y * y + 1.0))
```

The quotient form avoids the demonstrated failure. This is a localized workaround,
not a general replacement for two-argument arctangent: negative or zero second
arguments need the full `atan2` semantics. The
[GLSL ES specification](https://registry.khronos.org/OpenGL/specs/es/3.1/GLSL_ES_Specification_3.10.pdf)
defines the two-argument operation; the
[WGSL built-in specification](https://www.w3.org/TR/WGSL/#atan2-builtin)
defines `atan2`.

## Attribution and limits

The failure survives removal of Three.js and shader generation. Constant-expression
two-argument arctangent passes, while the nested-loop integral fails only on the
tested ANGLE/SwiftShader path. This isolates the failure to that backend path, but
**does not prove whether ANGLE translation, SPIR-V optimization, SwiftShader, or
another driver component is responsible**. The native WebGPU control uses a
different driver/compiler and shader stage, so its success is not evidence that
SwiftShader's own WGSL/Vulkan path is correct.

The name describes the observed renderer, not a completed upstream root-cause
analysis. Results depend on browser/backend versions. No upstream issue was filed.

The initial attempt used `vitest-environment-webgl-node` and
`vitest-environment-webgpu-node`. Their native hardware controls passed, but
node-webgl's bundled Windows ANGLE could not initialize SwiftShader and its Windows
implementation does not support loading a different EGL library. Those packages
are deliberately absent: Puppeteer reaches the actual failing backend directly.

## License

MIT.
