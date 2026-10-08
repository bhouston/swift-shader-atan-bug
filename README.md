# SwiftShader `atan` returns π for runtime negative zero

Reproduced with Chrome for Testing **154.0.8037.57** (macOS arm64), containing:

- **ANGLE 2.1.28731**, commit [`1ff8799c596d4fc9acea28343610b1f33650a6fa`](https://chromium.googlesource.com/angle/angle/+/1ff8799c596d4fc9acea28343610b1f33650a6fa).
- **Vulkan SwiftShader**, commit [`5b0479bd2d15058aaa9eb490e364f920ff824a8c`](https://swiftshader.googlesource.com/SwiftShader/+/5b0479bd2d15058aaa9eb490e364f920ff824a8c), reporting Vulkan API **1.3.0**.

The revisions are pinned in [this Chrome release's DEPS](https://chromium.googlesource.com/chromium/src/+/154.0.8037.57/DEPS).
The ANGLE version also appears in the installed Chrome binary. Vulkan `1.3.0`
is the reported API version.

On Chromium's **ANGLE + Vulkan SwiftShader** WebGL2 path, GLSL
`atan(y, x)` returns `3.1415927410125732` instead of zero when **`y` is
runtime negative zero and `x` is positive**. Constant expressions pass.

The failure reproduces on an **Apple M3**. Native Apple M3 WebGL2 and native
WebGPU controls pass.

## Minimal shader

[The checked-in fragment shader](shaders/atan-negative-zero.frag.glsl) draws one
pixel into a 1 x 1 float framebuffer:

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

The multiplication evaluates to `-0.0`. The third output channel verifies its
IEEE 754 bit pattern is `0x80000000`. The result is:

```text
                         atan(y, 1)   atan(y / 1)   negative-zero bit   alpha
SwiftShader              3.14159274   0             1                   1
Native Apple M3 WebGL2   0            0             1                   1
```

Replacing the runtime expression with literal `-0.0` or
`uintBitsToFloat(0x80000000u)` produces the correct result on SwiftShader.

The [GLSL ES 3.00 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
(section 8.1) defines two-argument arctangent using the input signs to select the
quadrant. Section 4.5.1 permits interchanging positive and negative zeros.
Either sign of zero is acceptable here; returning π with a positive second
argument is the observed error. Neither input pair is `(0, 0)`.

## Install and run

Requires Node.js 22+ and a supported Chromium host. The browser is pinned by
Puppeteer; install it explicitly if package install scripts were blocked.

```sh
npm ci
npm exec puppeteer browsers install chrome
npm test                  # affected SwiftShader: 2 failures, 6 passes
npm run test:controls     # all 6 controls pass on this M3
npm run test:webgl        # minimal shader, sweep, and WebGL controls
npm run test:webgpu       # 2 native WGSL controls
npm run test:hardware     # all 8 tests pass on native Apple M3
```

Assertions always expect the correct result, so `npm test` deliberately exits
with failure on an affected backend and should pass after a fix. GPU comparisons
use an absolute tolerance of `0.0001` radians.

`npm test` forces SwiftShader using `--use-angle=swiftshader` and
`--enable-unsafe-swiftshader`, and checks the actual renderer. `test:hardware`
uses the default native WebGL backend and rejects SwiftShader fallback; inspect
the printed renderer because other software backends are not rejected.
WebGPU uses a separate native browser with
`--enable-unsafe-webgpu --ignore-gpu-blocklist` and reports its adapter.
It fails clearly if no adapter is available.

The browsers visit only a temporary localhost server and close afterward.
WebGL reads completed results using synchronous `readPixels`; WebGPU awaits
`mapAsync` on the copied result buffer.

## Input range tested

The [input shader](shaders/atan-inputs.frag.glsl) reads runtime `(y, x)` pairs
from an `RG32F` texture, with one pair per output pixel. Inputs travel from Node
to the browser as integer bit patterns: ordinary JSON number serialization would
change `-0` to `+0` and accidentally hide the bug.

The sweep tests 257 positive `x` values:

- Every binary32 power of two from `2^-126` through `2^127` (254 values).
- `1.5`, binary32 `sqrt(3)`, and the largest finite binary32 value
  (`3.4028234663852886e38`).

For each `x`, it tests `y = -0` separately from 11 controls: `+0` and both signs
of `2^-149` (the smallest subnormal), `2^-126` (the smallest normal), `1e-10`,
`0.5`, and `1`. Inputs are rounded to binary32 before computing the CPU
`Math.atan2` reference.

| M3 backend | Runtime `-0`, positive `x` | Positive zero and nonzero controls |
| --- | --- | --- |
| SwiftShader | **257 / 257 fail**, returning π; 257 negative-zero bits verified | 2,827 / 2,827 pass; maximum absolute error `1.073250981420415e-7` |
| Native Apple Metal WebGL2 | 257 / 257 pass; 257 negative-zero bits verified | 2,827 / 2,827 pass; maximum absolute error `1.1920928955078068e-7` |

The failure occurs only for **runtime negative zero** among these samples.
The sweep covers the listed values; negative or zero second arguments, NaNs,
infinities, and subnormal second arguments remain untested by this sweep.

## Workarounds and controls

For **positive `x`**, `atan(y / x)` avoids the observed failure. It is not a
general substitute for `atan(y, x)`: other quadrants need correction, and extreme
ratios can overflow or underflow.

Canonicalizing the first argument's zero also passes this regression:

```glsl
atan(y == 0.0 ? 0.0 : y, x)
```

That workaround is tested for positive `x`. Constant-expression controls and native
[WGSL `atan2` / quotient controls](shaders/atan-negative-zero.wgsl) also pass.
The native WGSL comparison uses a different compiler, driver, and shader stage;
it does not test SwiftShader's WebGPU path or verify preservation of negative
zero in that computation.

## Environment and attribution

Tested October 8, 2026: Apple M3 (10 GPU cores), macOS `27.0.1` (`26A434`),
Node.js `26.3.0`, Puppeteer `25.12.0`, Vitest `5.0.3`,
Chrome for Testing `154.0.8037.57` (arm64).

```text
SwiftShader WebGL:
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)

Native WebGL:
ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)

Native WebGPU:
vendor: apple, architecture: metal-3, isFallbackAdapter: false
```

These results isolate the observed failure to the ANGLE/SwiftShader backend
path. They do not establish whether ANGLE translation, SPIR-V optimization,
SwiftShader, or another component is responsible. No upstream issue has been filed.

## License

MIT.
