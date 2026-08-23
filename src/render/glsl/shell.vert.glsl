// Shared vertex stage for the raymarched shells (atmosphere, clouds).
// The shell geometry is only a bounding volume — all appearance comes from the
// fragment march, so this just needs to hand over the world-space entry point.

varying vec3 vWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
