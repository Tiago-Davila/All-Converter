/**
 * shader.glsl.ts: fragment shader del fondo animado, portado 1:1 del mockup
 * versionado (DEP-001, "Aurora"): FBM con domain-warping y paleta cosenoidal.
 *
 * Uniforms:
 *   u_res   vec2   — resolución en píxeles
 *   u_time  float  — tiempo en segundos
 *   u_int   float  — intensidad actual [0,1] (interpolada por ShaderBackground)
 *   u_focus vec2   — posición del cursor en UV [0,1] (el brillo lo sigue, FR-003)
 */

export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision mediump float;
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform vec2  u_res;
uniform float u_time;
uniform float u_int;
uniform vec2  u_focus;

out vec4 fragColor;

// ── Noise (mockup "Aurora") ──────────────────────────────────────────────────

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// Paleta cosenoidal del mockup: violetas/cálidos sobre base #0b0c11.
vec3 pal(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.66) + t) + vec3(0.9, 0.55, 0.25));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv;
  p.x *= u_res.x / u_res.y;

  float t = u_time * 0.045;

  // Domain warping en dos pasos (q → r → f)
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p + 1.4 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(p + 1.4 * q + vec2(8.3, 2.8) - 0.126 * t)
  );
  float f = fbm(p + 1.2 * r);

  vec3 col = pal(f * 0.85 + length(r) * 0.3 + t * 0.6);
  vec3 base = vec3(0.035, 0.04, 0.06); // #0b0c11 aprox

  float glow = smoothstep(0.18, 0.95, f);
  col = base + col * glow * (0.45 + 0.85 * u_int);

  // El punto de brillo sigue al cursor (FR-003)
  float d = distance(uv, u_focus);
  col += pal(f + 0.3) * 0.18 * u_int * smoothstep(0.55, 0.0, d);

  // Viñeta para garantizar legibilidad del contenido superpuesto (FR-007)
  col *= 1.0 - 0.4 * smoothstep(0.35, 1.15, distance(uv, vec2(0.5, 0.45)));

  fragColor = vec4(col, 1.0);
}
`
