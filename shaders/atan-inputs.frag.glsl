#version 300 es
precision highp float;
uniform highp sampler2D inputValues;
out vec4 color;

void main() {
    vec2 inputPair = texelFetch(inputValues, ivec2(int(gl_FragCoord.x), 0), 0).rg;
    float y = inputPair.x;
    float x = inputPair.y;
    color = vec4(atan(y, x), atan(y / x),
                 float(floatBitsToUint(y) == 0x80000000u), x);
}
