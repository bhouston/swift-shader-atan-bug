import { expect, inject, test } from 'vitest';
import fragment from '../shaders/atan-negative-zero.frag.glsl?raw';
import negativeXFragment from '../shaders/atan-negative-zero-negative-x.frag.glsl?raw';
import inputFragment from '../shaders/atan-inputs.frag.glsl?raw';
import { executeWebGL } from './gpu.js';

const vertex = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const tolerance = 0.0001;
// Every normal binary32 power of two, plus representative mantissas and max finite.
const positiveX = [...Array.from({ length: 254 }, (_, i) => 2 ** (i - 126)),
    1.5, Math.fround(Math.sqrt(3)), Math.fround(3.4028234663852886e38)];

function webgl(source, inputs) {
    const result = executeWebGL(vertex, source, inputs);
    if (inject('backend') === 'swiftshader') expect(result.renderer).toMatch(/swiftshader/i);
    else expect(result.renderer, 'Hardware comparison must not silently fall back to SwiftShader').not.toMatch(/swiftshader/i);
    return result;
}

test('WebGL2 runtime atan(-0, 1) returns zero', () => {
    const result = webgl(fragment);
    console.log('WebGL:', result.renderer);
    console.log('Runtime result: [atan(y, 1), atan(y / 1), negative-zero bit, 1]', result.values);
    // GLSL may interchange signed zeros; this assertion accepts either sign.
    expect(Math.abs(result.values[0])).toBeLessThan(tolerance);
});

test('WebGL2 runtime atan(-0, -1) returns pi in magnitude', () => {
    const result = webgl(negativeXFragment);
    console.log('Negative-x runtime result: [atan(y, -1), atan(+0, -1), negative-zero bit, 1]', result.values);
    expect(result.values[2], 'Runtime input must preserve negative zero').toBe(1);
    // GLSL may interchange signed zeros, so either branch-cut sign is valid.
    expect(Math.abs(Math.abs(result.values[0]) - Math.PI)).toBeLessThan(tolerance);
});

test('control: WebGL2 canonicalizing zero before negative-x atan returns pi', () => {
    const workaround = negativeXFragment.replace('atan(y, -1.0)', 'atan(y == 0.0 ? 0.0 : y, -1.0)');
    expect(workaround).not.toBe(negativeXFragment);
    expect(Math.abs(Math.abs(webgl(workaround).values[0]) - Math.PI)).toBeLessThan(tolerance);
});

test('control: constant WebGL2 negative-zero negative-x atan returns pi', () => {
    const { values } = webgl(`#version 300 es
precision highp float;
out vec4 color;
void main() {
    color = vec4(atan(-0.0, -1.0), atan(uintBitsToFloat(0x80000000u), -1.0),
                 atan(0.0, -1.0), 1.0);
}`);
    values.slice(0, 3).forEach(value =>
        expect(Math.abs(Math.abs(value) - Math.PI)).toBeLessThan(tolerance));
});

test('control: WebGL2 quotient workaround returns zero', () => {
    const workaround = fragment.replace('atan(y, 1.0)', 'atan(y / 1.0)');
    expect(workaround).not.toBe(fragment);
    expect(Math.abs(webgl(workaround).values[0])).toBeLessThan(tolerance);
});

test('control: WebGL2 canonicalizing zero before atan returns zero', () => {
    const workaround = fragment.replace('atan(y, 1.0)', 'atan(y == 0.0 ? 0.0 : y, 1.0)');
    expect(workaround).not.toBe(fragment);
    expect(Math.abs(webgl(workaround).values[0])).toBeLessThan(tolerance);
});

test('control: constant WebGL2 negative-zero atan returns zero', () => {
    const { values } = webgl(`#version 300 es
precision highp float;
out vec4 color;
void main() {
    color = vec4(atan(-0.0, 1.0), atan(uintBitsToFloat(0x80000000u), 1.0),
                 atan(-0.5, 1.5), atan(0.5, 1.5));
}`);
    [0, 0, Math.atan2(-0.5, 1.5), Math.atan2(0.5, 1.5)].forEach((value, i) =>
        expect(Math.abs(values[i] - value)).toBeLessThan(tolerance));
});

function sweep(ys, xs = positiveX) {
    const pairs = ys.flatMap(y => xs.map(x => [Math.fround(y), x]));
    const { values } = webgl(inputFragment, new Float32Array(pairs.flat()));
    let failures = 0, maxError = 0, negativeZeros = 0;
    const examples = [];
    pairs.forEach(([y, x], i) => {
        const actual = values[i * 4];
        const expected = Math.atan2(y, x);
        const difference = Math.abs(actual - expected);
        // Compare angles across the +/-pi branch cut; zero may change sign.
        const error = Math.min(difference, Math.abs(difference - 2 * Math.PI));
        negativeZeros += values[i * 4 + 2];
        maxError = Math.max(maxError, error);
        if (!Number.isFinite(error) || error >= tolerance) {
            failures++;
            if (examples.length < 4) examples.push({ y: Object.is(y, -0) ? '-0' : y, x, actual, expected });
        }
    });
    console.log('WebGL input sweep:', JSON.stringify({ xSign: xs[0] < 0 ? 'negative' : 'positive', samples: pairs.length, failures, maxError, negativeZeros, examples }));
    return { failures, samples: pairs.length };
}

test('WebGL2 runtime atan(-0, positive x) input sweep returns zero', () => {
    const result = sweep([-0]);
    expect(result.failures, `Incorrect results out of ${result.samples} negative-zero inputs`).toBe(0);
});

test('WebGL2 runtime atan(-0, negative x) input sweep returns pi in magnitude', () => {
    const result = sweep([-0], positiveX.map(x => -x));
    expect(result.failures, `Incorrect results out of ${result.samples} negative-zero inputs`).toBe(0);
});

test('control: WebGL2 positive zero and nonzero negative-x input sweep', () => {
    const result = sweep([0, -(2 ** -149), 2 ** -149, -(2 ** -126), 2 ** -126,
        -1e-10, 1e-10, -0.5, 0.5, -1, 1], positiveX.map(x => -x));
    expect(result.failures, `Incorrect results out of ${result.samples} control inputs`).toBe(0);
});

test('control: WebGL2 positive zero and nonzero input sweep', () => {
    const result = sweep([0, -(2 ** -149), 2 ** -149, -(2 ** -126), 2 ** -126,
        -1e-10, 1e-10, -0.5, 0.5, -1, 1]);
    expect(result.failures, `Incorrect results out of ${result.samples} control inputs`).toBe(0);
});
