#version 300 es
precision highp float;
out vec4 color;

void main() {
    // In a 1 x 1 framebuffer, gl_FragCoord.xy is (0.5, 0.5).
    // Runtime multiplication produces IEEE 754 negative zero (0x80000000).
    float y = (gl_FragCoord.x - 1.0) * (gl_FragCoord.y - 0.5);
    color = vec4(atan(y, 1.0), atan(y / 1.0),
                 float(floatBitsToUint(y) == 0x80000000u), 1.0);
}
