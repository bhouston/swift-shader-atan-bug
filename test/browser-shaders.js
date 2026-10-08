// Functions run inside Chromium via page.evaluate. No shader generation or graphics library.
// Optional inputBits contains interleaved binary32 (y, x) pairs, preserving signed zero.
export function executeWebGL(vertex, fragment, inputBits) {
    const canvas = document.createElement('canvas');
    const width = inputBits ? inputBits.length / 2 : 1;
    canvas.width = width;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 context unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
    const program = gl.createProgram();
    const shaders = [];
    const texture = gl.createTexture();
    const inputTexture = inputBits ? gl.createTexture() : null;
    const framebuffer = gl.createFramebuffer();
    const vao = gl.createVertexArray();
    try {
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
            const shader = gl.createShader(type);
            shaders.push(shader);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
            gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float framebuffer incomplete');
        gl.bindVertexArray(vao);
        gl.viewport(0, 0, width, 1);
        gl.useProgram(program);
        if (inputBits) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, inputTexture);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, width, 1);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, 1, gl.RG, gl.FLOAT, new Float32Array(new Uint32Array(inputBits).buffer));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.uniform1i(gl.getUniformLocation(program, 'inputValues'), 0);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixels = new Float32Array(width * 4);
        // Synchronous readback measures the shader's completed result, not submission.
        gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, pixels);
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`WebGL error 0x${error.toString(16)}`);
        return { values: Array.from(pixels), renderer, version: gl.getParameter(gl.VERSION) };
    } finally {
        gl.deleteVertexArray(vao);
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
        if (inputTexture) gl.deleteTexture(inputTexture);
        gl.deleteProgram(program);
        for (const shader of shaders) gl.deleteShader(shader);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}

export async function executeWebGPU(code) {
    if (!navigator.gpu) throw new Error('WebGPU unavailable (requires a secure localhost origin and supported adapter)');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter available');
    const info = adapter.info;
    const adapterInfo = {
        vendor: info.vendor, architecture: info.architecture,
        device: info.device, description: info.description,
        isFallbackAdapter: info.isFallbackAdapter
    };
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    const output = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
        const module = device.createShaderModule({ code });
        const compilation = await module.getCompilationInfo();
        const failures = compilation.messages.filter(message => message.type === 'error');
        if (failures.length) throw new Error(failures.map(message => message.message).join('\n'));
        const pipeline = await device.createComputePipelineAsync({
            layout: 'auto', compute: { module, entryPoint: 'main' }
        });
        const bindings = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: output } }]
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindings);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, 4);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const value = new Float32Array(readback.getMappedRange())[0];
        readback.unmap();
        if (errors.length) throw new Error(errors.join('\n'));
        return { value, adapter: adapterInfo };
    } finally {
        output.destroy();
        readback.destroy();
        device.destroy();
    }
}
