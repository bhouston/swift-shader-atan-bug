import { expect, inject, test } from 'vitest';
import wgsl from '../shaders/atan-negative-zero.wgsl?raw';
import { executeWebGPU } from './gpu.js';

const tolerance = 0.0001;

async function webgpu(source) {
    const result = await executeWebGPU(source);
    const identity = Object.values(result.adapter).join(' ');
    if (inject('backend') === 'swiftshader') expect(identity).toMatch(/swiftshader/i);
    else expect(identity, 'Hardware comparison must not silently fall back to SwiftShader').not.toMatch(/swiftshader/i);
    console.log('WebGPU:', JSON.stringify(result));
    return result;
}

for (const x of [1, 2 ** -126, -1, -(2 ** -126)]) {
    const call = `atan2(y, ${x})`;
    const source = wgsl.replace('atan2(y, 1.0)', call);
    const expected = x > 0 ? 0 : Math.PI;

    test(`WebGPU runtime WGSL atan2(-0, ${x}) returns ${x > 0 ? 'zero' : 'pi in magnitude'}`, async () => {
        const result = await webgpu(source);
        // Accept either zero sign and either sign of the pi branch cut.
        expect(Math.abs(Math.abs(result.value) - expected)).toBeLessThan(tolerance);
    });

    test(`control: WebGPU canonicalizing zero before atan2 with x=${x}`, async () => {
        const workaround = source.replace(call, `atan2(select(y, 0.0, y == 0.0), ${x})`);
        expect(workaround).not.toBe(source);
        const result = await webgpu(workaround);
        expect(Math.abs(Math.abs(result.value) - expected)).toBeLessThan(tolerance);
    });
}

test('control: WebGPU runtime input preserves negative-zero bits', async () => {
    const source = wgsl.replace('atan2(y, 1.0)', 'select(0.0, 1.0, bitcast<u32>(y) == 0x80000000u)');
    const result = await webgpu(source);
    expect(result.value).toBe(1);
});

test('control: WebGPU runtime WGSL quotient returns zero', async () => {
    const workaround = wgsl.replace('atan2(y, 1.0)', 'atan(y / 1.0)');
    expect(workaround).not.toBe(wgsl);
    const result = await webgpu(workaround);
    console.log('WebGPU quotient:', JSON.stringify(result));
    expect(Math.abs(result.value)).toBeLessThan(tolerance);
});
