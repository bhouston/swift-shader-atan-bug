@group(0) @binding(0) var<storage, read_write> result: array<f32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    // The sole invocation has id == (0, 0, 0).
    let y = (f32(id.x) - 1.0) * f32(id.y);
    result[0] = atan2(y, 1.0);
}
