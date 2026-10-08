import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { beforeAll, afterAll, expect, test } from 'vitest';
import puppeteer from 'puppeteer';
import { executeWebGL, executeWebGPU } from './browser-shaders.js';

const fragment = readFileSync(new URL('../shaders/solid-angle.frag.glsl', import.meta.url), 'utf8');
const wgsl = readFileSync(new URL('../shaders/solid-angle.wgsl', import.meta.url), 'utf8');
const vertex = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const expected = 2 * Math.PI / 3;
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

test('control: CPU Math.atan2 solid angle equals 2*pi/3', () => {
    const area = (x, y) => Math.atan2(x * y, Math.sqrt(x * x + y * y + 1));
    let sum = 0;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const x = i * 0.5 - 1, y = 1 - j * 0.5;
            sum += Math.abs(area(x, y) - area(x, y - 0.5) - area(x + 0.5, y) + area(x + 0.5, y - 0.5));
        }
    }
    console.log('CPU total:', sum);
    expect(Math.abs(sum - expected)).toBeLessThan(1e-12);
});

test('WebGL2 GLSL two-argument atan solid angle equals 2*pi/3', async () => {
    const actual = (await webgl(fragment))[0];
    expect(Math.abs(actual - expected)).toBeLessThan(0.0001);
});

test('control: WebGL2 GLSL quotient workaround equals 2*pi/3', async () => {
    const workaround = fragment.replace(
        'atan(x * y, sqrt(x * x + y * y + 1.0))',
        'atan((x * y) / sqrt(x * x + y * y + 1.0))'
    );
    expect(workaround).not.toBe(fragment);
    const actual = (await webgl(workaround))[0];
    expect(Math.abs(actual - expected)).toBeLessThan(0.0001);
});

test('control: constant GLSL two-argument atan values are correct', async () => {
    const actual = await webgl(`#version 300 es
precision highp float;
out vec4 color;
void main() {
    color = vec4(atan(-1.0, sqrt(3.0)), atan(1.0, sqrt(3.0)),
                 atan(-0.5, sqrt(2.25)), atan(0.5, sqrt(2.25)));
}`);
    const values = [-Math.PI / 6, Math.PI / 6, Math.atan2(-0.5, 1.5), Math.atan2(0.5, 1.5)];
    values.forEach((value, i) => expect(Math.abs(actual[i] - value)).toBeLessThan(0.0001));
});

test('control: WebGPU direct WGSL atan2 solid angle equals 2*pi/3', async () => {
    const result = await nativePage.evaluate(executeWebGPU, wgsl);
    console.log('WebGPU atan2:', JSON.stringify(result));
    expect(Math.abs(result.value - expected)).toBeLessThan(0.0001);
});

test('control: WebGPU direct WGSL quotient workaround equals 2*pi/3', async () => {
    const workaround = wgsl.replace(
        'atan2(x * y, sqrt(x * x + y * y + 1.0))',
        'atan((x * y) / sqrt(x * x + y * y + 1.0))'
    );
    expect(workaround).not.toBe(wgsl);
    const result = await nativePage.evaluate(executeWebGPU, workaround);
    console.log('WebGPU quotient:', JSON.stringify(result));
    expect(Math.abs(result.value - expected)).toBeLessThan(0.0001);
});
