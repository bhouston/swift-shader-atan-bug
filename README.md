# SwiftShader `atan` selects the wrong quadrant for runtime negative zero

On Chromium's **ANGLE + Vulkan SwiftShader** WebGL2 path, GLSL `atan(y, x)`
selects the wrong quadrant when **`y` is runtime negative zero**: positive
`x` returns `3.1415927410125732` instead of zero, and negative `x` returns
zero instead of ±π. Constant expressions pass.

| Runtime call | Correct result | SwiftShader result |
| --- | --- | --- |
| `atan(-0, 1)` | `±0` | **`3.1415927`** (π) |
| `atan(-0, 2^-126)` | `±0` | **`3.1415927`** (π) |
| `atan(-0, -1)` | `±π` | **`0`** |
| `atan(-0, -2^-126)` | `±π` | **`0`** |
| `atan(-2^-149, 1)`* | `-1.4e-45` (or `±0` if flushed) | **`3.1415927`** (π) |
| `atan(-2^-149, 2^-126)`* | `-1.1920929e-7` (`-2^-23`, or `±0` if flushed) | **`3.1415927`** (π) |

\* Windows x64 (Subzero JIT) only. Subzero flushes the subnormal `-2^-149` to
`-0`, which then triggers the same bug. macOS arm64 (LLVM JIT) returns the
correct result for these two rows. GLSL allows either sign of zero, and
flushing subnormals to zero is also allowed. Returning π is never correct when
`x` is positive. The native GTX 1050 returns `0` for the four positive-x calls.

The bug reproduces on both Apple M3 (macOS arm64) and AMD Ryzen 9 5950X +
NVIDIA GTX 1050 (Windows x64), so it does not depend on the hardware. Native
WebGL2 and WebGPU on both machines return the correct result.

The negative-x error was additionally verified on Apple M3 with Chromium
156 and in a direct SwiftShader Vulkan test. The expanded negative-x browser
cases have not yet been rerun on Windows.

## Affected versions

| Browser | ANGLE | SwiftShader | Tested on |
| --- | --- | --- | --- |
| Chrome for Testing **154.0.8037.57** | 2.1.28731, [`1ff8799c`](https://chromium.googlesource.com/angle/angle/+/1ff8799c596d4fc9acea28343610b1f33650a6fa) | [`5b0479bd`](https://swiftshader.googlesource.com/SwiftShader/+/5b0479bd2d15058aaa9eb490e364f920ff824a8c) | macOS arm64, Windows x64 |
| Playwright Chromium **156.0.8078.4** | [`dfeede58`](https://chromium.googlesource.com/angle/angle/+/dfeede58b6183e8964ae4b6d9612fe1d579403e3) | [`1e80438d`](https://swiftshader.googlesource.com/SwiftShader/+/1e80438d2b93ef36a7c05f8d2b81233bac0e3d16) | macOS arm64, Windows x64 |

Each release's DEPS file pins its ANGLE and SwiftShader revisions
([154](https://chromium.googlesource.com/chromium/src/+/154.0.8037.57/DEPS),
[156](https://chromium.googlesource.com/chromium/src/+/156.0.8078.4/DEPS)).
SwiftShader reports Vulkan 1.3.0 in both. Its JIT backend differs by platform:
LLVM 10.0.0 on macOS arm64 and Subzero on Windows x64. The bug reproduces with
both backends. The test suite uses Playwright's Chromium 156.

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

The companion [`atan-negative-zero-negative-x.frag.glsl`](shaders/atan-negative-zero-negative-x.frag.glsl)
uses the same runtime `y` and outputs `atan(y, -1.0)`, a positive-zero
control, and the negative-zero bit check:

```text
               atan(y, -1)   atan(+0, -1)   negative-zero bit
SwiftShader    0             3.14159250     1
Native M3      3.14159274     3.14159250     1
```

The regression accepts either sign of π for a zero first argument because
GLSL permits interchanging signed zeros. Returning zero with negative `x`
is the related quadrant error.

## Run

Requires Node.js 22+. Tests run in Chromium through
[Vitest Browser Mode](https://vitest.dev/guide/browser/) with the Playwright
provider. Each project in [`vitest.config.js`](vitest.config.js) launches its
own Chromium with its own flags.

```sh
npm ci
npx playwright install chromium
npm test                # M3 Chromium 156: 4 failures, 9 passes on the affected build
npm run test:hardware   # native M3 WebGL + native WebGPU; all 13 pass
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
sign. The sweep uses 257 magnitudes of `x`: every binary32 power of two
from `2^-126` to `2^127`, plus `1.5`, `sqrt(3)` and the largest
finite value. It tests both positive and negative `x`, paired with these `y` values:

- `y = -0` fails for all 257 positive `x` values, returning π, and all
  257 negative `x` values, returning zero. Both sweeps pass on native M3.
- On M3, the other `y` values pass on SwiftShader for both signs of `x`:
  `+0`, and ±`2^-149`, ±`2^-126`, ±`1e-10`, ±`0.5` and ±`1`. Maximum error
  is about `1.1e-7` for positive `x` and `2.9e-7` for negative `x`.
  - **Exception:** on Windows (Subzero), `y = -2^-149` also fails for all 257
    `x` values. Subzero flushes that subnormal to `-0`, which triggers the same
    bug. The previous positive-x suite reported 3 failures on Windows;
    the expanded suite has not yet been rerun there.

Angle comparisons account for the ±π branch cut, including allowed zero-sign
changes and subnormal flushing. Each negative-zero sweep also reports the
number of verified `0x80000000` input bit patterns.

## Workarounds

- For **positive `x`** only: `atan(y / x)`.
- Canonicalize the zero before the call: `atan(y == 0.0 ? 0.0 : y, x)`.

The zero-canonicalization workaround is tested for both signs of `x`.
The quotient workaround does not fix the negative-x case because it loses
the quadrant information.

## Root cause and upstream fix

SwiftShader's [`Atan2` implementation](https://swiftshader.googlesource.com/SwiftShader/+/1e80438d2b93ef36a7c05f8d2b81233bac0e3d16/src/Pipeline/ShaderCore.cpp#281)
uses a floating-point comparison, `CmpLT(y, 0.0f)`, to decide whether to
subtract π, but uses the sign bit of `y` to rotate `x`. For `-0`, the
comparison is false and the sign bit is set. The inconsistent decisions
produce π for positive `x` and zero for negative `x`.

A direct Vulkan regression test reproduces both errors without ANGLE.
Changing the first decision to test the sign bit fixes both:

```cpp
SIMD::Int S = CmpLT(As<SIMD::Int>(y), SIMD::Int(0));
```

The [upstream fix branch](https://github.com/bhouston/swiftshader/tree/fix/atan2-negative-zero)
contains separate regression-test and fix commits. On macOS arm64/LLVM,
8 signed-zero test variants fail before the fix; all 16 arctangent variants
and all 155 Vulkan unit tests pass afterward. Windows/Subzero validation
of the fix remains outstanding.

See [the contribution guide and submission drafts](SWIFTSHADER_CONTRIBUTION.md).
No upstream review or bug report has been submitted.

## License

MIT.
