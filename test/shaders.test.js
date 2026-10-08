import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { beforeAll, afterAll, expect, test } from 'vitest';
import puppeteer from 'puppeteer';
import { executeWebGL, executeWebGPU } from './browser-shaders.js';

const fragment = readFileSync(new URL('../shaders/atan-negative-zero.frag.glsl', import.meta.url), 'utf8');
const wgsl = readFileSync(new URL('../shaders/atan-negative-zero.wgsl', import.meta.url), 'utf8');
const vertex = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const inputFragment = readFileSync(new URL('../shaders/atan-inputs.frag.glsl', import.meta.url), 'utf8');
const tolerance = 0.0001;
// Every normal binary32 power of two, plus representative mantissas and max finite.
const positiveX = [...Array.from({ length: 254 }, (_, i) => 2 ** (i - 126)),
    1.5, Math.fround(Math.sqrt(3)), Math.fround(3.4028234663852886e38)];
let server, browser, page, nativeBrowser, nativePage;

beforeAll(async () => {
    server = createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>Direct shader test</title>');
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const args = ['--enable-unsafe-webgpu'];
    if (process.env.SHADER_BACKEND !== 'hardware') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
    browser = await puppeteer.launch({ headless: true, args });
    console.log('Browser:', await browser.version());
    console.log('Arguments:', JSON.stringify(args));
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    nativeBrowser = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
    nativePage = await nativeBrowser.newPage();
    await nativePage.goto(`http://127.0.0.1:${server.address().port}/`);
});

afterAll(async () => {
    if (browser) await browser.close();
    if (nativeBrowser) await nativeBrowser.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

async function webgl(source) {
    const result = await page.evaluate(executeWebGL, vertex, source);
    console.log('WebGL:', JSON.stringify(result));
    if (process.env.SHADER_BACKEND !== 'hardware') expect(result.renderer).toMatch(/swiftshader/i);
    else expect(result.renderer, 'Hardware comparison must not silently fall back to SwiftShader').not.toMatch(/swiftshader/i);
    return result.values;
}

test('WebGL2 runtime atan(-0, 1) returns zero', async () => {
    const actual = await webgl(fragment);
    console.log('Runtime result: [atan(y, 1), atan(y / 1), negative-zero bit, 1]', actual);
    // GLSL may interchange signed zeros; this assertion accepts either sign.
    expect(Math.abs(actual[0])).toBeLessThan(tolerance);
});

test('control: WebGL2 quotient workaround returns zero', async () => {
    const workaround = fragment.replace('atan(y, 1.0)', 'atan(y / 1.0)');
    expect(workaround).not.toBe(fragment);
    expect(Math.abs((await webgl(workaround))[0])).toBeLessThan(tolerance);
});

test('control: WebGL2 canonicalizing zero before atan returns zero', async () => {
    const workaround = fragment.replace('atan(y, 1.0)', 'atan(y == 0.0 ? 0.0 : y, 1.0)');
    expect(workaround).not.toBe(fragment);
    expect(Math.abs((await webgl(workaround))[0])).toBeLessThan(tolerance);
});

test('control: constant WebGL2 negative-zero atan returns zero', async () => {
    const actual = await webgl(`#version 300 es
precision highp float;
out vec4 color;
void main() {
    color = vec4(atan(-0.0, 1.0), atan(uintBitsToFloat(0x80000000u), 1.0),
                 atan(-0.5, 1.5), atan(0.5, 1.5));
}`);
    [0, 0, Math.atan2(-0.5, 1.5), Math.atan2(0.5, 1.5)].forEach((value, i) =>
        expect(Math.abs(actual[i] - value)).toBeLessThan(tolerance));
});

async function sweep(ys) {
    const pairs = ys.flatMap(y => positiveX.map(x => [Math.fround(y), x]));
    // page.evaluate serializes numbers and would turn -0 into +0. Send raw bits.
    const bits = Array.from(new Uint32Array(new Float32Array(pairs.flat()).buffer));
    const result = await page.evaluate(executeWebGL, vertex, inputFragment, bits);
    if (process.env.SHADER_BACKEND !== 'hardware') expect(result.renderer).toMatch(/swiftshader/i);
    else expect(result.renderer).not.toMatch(/swiftshader/i);
    let failures = 0, maxError = 0, negativeZeros = 0;
    const examples = [];
    pairs.forEach(([y, x], i) => {
        const actual = result.values[i * 4];
        const expected = Math.atan2(y, x);
        const error = Math.abs(actual - expected);
        negativeZeros += result.values[i * 4 + 2];
        maxError = Math.max(maxError, error);
        if (!Number.isFinite(error) || error >= tolerance) {
            failures++;
            if (examples.length < 4) examples.push({ y: Object.is(y, -0) ? '-0' : y, x, actual, expected });
        }
    });
    console.log('WebGL input sweep:', JSON.stringify({ renderer: result.renderer,
        samples: pairs.length, failures, maxError, negativeZeros, examples }));
    return { failures, samples: pairs.length };
}

test('WebGL2 runtime atan(-0, positive x) input sweep returns zero', async () => {
    const result = await sweep([-0]);
    expect(result.failures, `Incorrect results out of ${result.samples} negative-zero inputs`).toBe(0);
});

test('control: WebGL2 positive zero and nonzero input sweep', async () => {
    const result = await sweep([0, -(2 ** -149), 2 ** -149, -(2 ** -126), 2 ** -126,
        -1e-10, 1e-10, -0.5, 0.5, -1, 1]);
    expect(result.failures, `Incorrect results out of ${result.samples} control inputs`).toBe(0);
});

test('control: WebGPU runtime WGSL atan2 returns zero', async () => {
    const result = await nativePage.evaluate(executeWebGPU, wgsl);
    console.log('WebGPU atan2:', JSON.stringify(result));
    expect(Math.abs(result.value)).toBeLessThan(tolerance);
});

test('control: WebGPU runtime WGSL quotient returns zero', async () => {
    const workaround = wgsl.replace('atan2(y, 1.0)', 'atan(y / 1.0)');
    expect(workaround).not.toBe(wgsl);
    const result = await nativePage.evaluate(executeWebGPU, workaround);
    console.log('WebGPU quotient:', JSON.stringify(result));
    expect(Math.abs(result.value)).toBeLessThan(tolerance);
});
