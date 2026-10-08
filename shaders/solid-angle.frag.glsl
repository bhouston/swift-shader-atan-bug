#version 300 es
precision highp float;
out vec4 color;

float area(float x, float y) {
    return atan(x * y, sqrt(x * x + y * y + 1.0));
}

void main() {
    float sum = 0.0;
    for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4; j++) {
            float x = float(i) * 0.5 - 1.0;
            float y = 1.0 - float(j) * 0.5;
            sum += abs(area(x, y) - area(x, y - 0.5)
                     - area(x + 0.5, y) + area(x + 0.5, y - 0.5));
        }
    }
    color = vec4(sum, 0.0, 0.0, 1.0);
}
