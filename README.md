# SwiftShader `atan` returns π for runtime negative zero

On Chromium's **ANGLE + Vulkan SwiftShader** WebGL2 path, GLSL `atan(y, x)`
returns `3.1415927410125732` instead of zero when **`y` is runtime negative zero
and `x` is positive**. Constant expressions pass.

The bug reproduces on both Apple M3 (macOS arm64) and AMD Ryzen 9 5950X +
NVIDIA GTX 1050 (Windows x64), so it does not depend on the hardware. Native
WebGL2 and WebGPU on both machines return the correct result.

## Affected versions

| Component | Version |
| --- | --- |
| Chrome for Testing | **154.0.8037.57** (macOS arm64, Windows x64) |
| ANGLE | 2.1.28731, [`1ff8799c`](https://chromium.googlesource.com/angle/angle/+/1ff8799c596d4fc9acea28343610b1f33650a6fa) |
| SwiftShader | [`5b0479bd`](https://swiftshader.googlesource.com/SwiftShader/+/5b0479bd2d15058aaa9eb490e364f920ff824a8c), Vulkan 1.3.0 |
| SwiftShader JIT | LLVM 10.0.0 (macOS arm64), Subzero (Windows x64) |

[This release's DEPS file](https://chromium.googlesource.com/chromium/src/+/154.0.8037.57/DEPS)
pins these revisions. Both platforms use the same Chrome, ANGLE and SwiftShader
revisions. Only SwiftShader's JIT backend differs, and it fails on both.

## Minimal shader

[`shaders/atan-negative-zero.frag.glsl`](shaders/atan-negative-zero.frag.glsl)
draws one pixel into a 1 x 1 float framebuffer:

```glsl
#version 300 es
precision highp float;
out vec4 color;

void main() {
    // At this pixel, gl_FragCoord.xy == vec2(0.5).
    float y = (gl_FragCoord.x - 1.0) * (gl_FragCoord.y - 0.5);
    color = vec4(atan(y, 1.0), atan(y / 1.0),
                 float(floatBitsToUint(y) == 0x80000000u), 1.0);
}
```

`y` evaluates to `-0.0`, and the third channel confirms the bit pattern
`0x80000000`. The table shows each `atan` result and that bit check:

```text
               atan(y, 1)   atan(y / 1)   negative-zero bit
SwiftShader    3.14159274   0             1
Native GPU     0            0             1
```

Using a literal `-0.0` or `uintBitsToFloat(0x80000000u)` instead returns the
correct result.

[GLSL ES 3.00](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
§8.1 uses the signs of the inputs to choose the quadrant. §4.5.1 allows positive
and negative zero to be interchanged. Either sign of zero is therefore valid
here, but π is not when `x` is positive.

## Run

Requires Node.js 22+. Tests run in Chromium through
[Vitest Browser Mode](https://vitest.dev/guide/browser/) with the Playwright
provider. Each project in [`vitest.config.js`](vitest.config.js) launches its
own Chromium with its own flags.

```sh
npm ci
npx playwright install chromium
npm test                # SwiftShader WebGL + native WebGPU; fails on affected builds
npm run test:hardware   # native WebGL + native WebGPU; all 8 pass
npm run test:controls   # controls only
```

The tests always assert the correct result, so `npm test` fails until the bug
is fixed. The `swiftshader` project uses
`--use-angle=swiftshader --enable-unsafe-swiftshader` and checks that the
renderer is SwiftShader. The `hardware` project fails if the browser falls back
to SwiftShader.

## Input sweep

[`shaders/atan-inputs.frag.glsl`](shaders/atan-inputs.frag.glsl) reads `(y, x)`
pairs from an `RG32F` texture, uploaded as a `Float32Array` so `-0` keeps its
sign. The sweep uses 257 positive `x` values: every binary32 power of two
from `2^-126` to `2^127`, plus `1.5`, `sqrt(3)` and the largest
finite value. Each `x` is paired with these `y` values:

- `y = -0` fails for all 257 `x` values on SwiftShader, returning π. It passes
  on native GPUs.
- The other `y` values pass on SwiftShader: `+0`, and ±`2^-149`, ±`2^-126`,
  ±`1e-10`, ±`0.5` and ±`1`. Maximum error is about `1.2e-7`.
  - **Exception:** on Windows (Subzero), `y = -2^-149` also fails for all 257
    `x` values. Subzero flushes that subnormal to `-0`, which triggers the same
    bug. As a result, `npm test` reports 3 failures on Windows and 2 on macOS.

## Workarounds

- For **positive `x`** only: `atan(y / x)`.
- Canonicalize the zero before the call: `atan(y == 0.0 ? 0.0 : y, x)`.

These results narrow the failure to the ANGLE/SwiftShader path. They do not
show which part is responsible: ANGLE's translation, the SPIR-V optimizer, or
SwiftShader itself. No upstream issue has been filed yet.

## License

MIT.
