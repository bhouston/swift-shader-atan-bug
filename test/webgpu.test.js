import { expect, test } from 'vitest';
import wgsl from '../shaders/atan-negative-zero.wgsl?raw';
import { executeWebGPU } from './gpu.js';

const tolerance = 0.0001;

test('control: WebGPU runtime WGSL atan2 returns zero', async () => {
    const result = await executeWebGPU(wgsl);
    console.log('WebGPU atan2:', JSON.stringify(result));
    expect(Math.abs(result.value)).toBeLessThan(tolerance);
});

test('control: WebGPU runtime WGSL quotient returns zero', async () => {
    const workaround = wgsl.replace('atan2(y, 1.0)', 'atan(y / 1.0)');
    expect(workaround).not.toBe(wgsl);
    const result = await executeWebGPU(workaround);
    console.log('WebGPU quotient:', JSON.stringify(result));
    expect(Math.abs(result.value)).toBeLessThan(tolerance);
});
