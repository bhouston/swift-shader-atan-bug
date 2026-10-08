@group(0) @binding(0) var<storage, read_write> result: array<f32>;

fn area(x: f32, y: f32) -> f32 {
    return atan2(x * y, sqrt(x * x + y * y + 1.0));
}

@compute @workgroup_size(1)
fn main() {
    var sum = 0.0;
    for (var i = 0; i < 4; i++) {
        for (var j = 0; j < 4; j++) {
            let x = f32(i) * 0.5 - 1.0;
            let y = 1.0 - f32(j) * 0.5;
            sum += abs(area(x, y) - area(x, y - 0.5)
                     - area(x + 0.5, y) + area(x + 0.5, y - 0.5));
        }
    }
    result[0] = sum;
}
