/**
 * shader.glsl.ts: Fragment shader FBM/noise para el fondo animado (T027, US3).
 * Paleta derivada del mockup (DEP-001 resuelto):
 *   base    #0b0c11 → vec3(0.043, 0.047, 0.067)
 *   mid     #5b5bd6 → vec3(0.357, 0.357, 0.839)
 *   hi      #7b7bef → vec3(0.482, 0.482, 0.937)
 *
 * Uniforms:
 *   u_res   vec2   — resolución en píxeles
 *   u_time  float  — tiempo en segundos
 *   u_int   float  — intensidad actual [0,1] (interpolada por ShaderBackground)
 *   u_focus float  — 1.0 si el puntero está sobre el canvas, 0.0 si no
 *   u_warm  float  — 1.0 durante el warmup (~500 ms), luego 0.0
 *
 * Sin u_mono: bajo prefers-reduced-motion no se renderiza el shader (StaticBackground).
 */

export const VERTEX_SHADER = /* glsl */ `#version 300 es
precision mediump float;
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision mediump float;

uniform vec2  u_res;
uniform float u_time;
uniform float u_int;
uniform float u_focus;
uniform float u_warm;

out vec4 fragColor;

// ── Noise helpers ────────────────────────────────────────────────────────────

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash2(i),               f);
  float b = dot(hash2(i + vec2(1,0)),   f - vec2(1,0));
  float c = dot(hash2(i + vec2(0,1)),   f - vec2(0,1));
  float d = dot(hash2(i + vec2(1,1)),   f - vec2(1,1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
}

// Fractional Brownian Motion — 4 octavas (equilibrio calidad/rendimiento)
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    v   += amp * vnoise(p * freq);
    amp  *= 0.5;
    freq *= 2.1;
    p    += vec2(0.03, 0.07) * float(i + 1);
  }
  return v;
}

// ── Paleta (mockup DEP-001) ──────────────────────────────────────────────────
// base #0b0c11, mid #5b5bd6, hi #7b7bef
vec3 palette(float t) {
  vec3 base = vec3(0.043, 0.047, 0.067);
  vec3 mid  = vec3(0.357, 0.357, 0.839);
  vec3 hi   = vec3(0.482, 0.482, 0.937);
  float t2 = t * t;
  return mix(base, mix(mid, hi, t2), smoothstep(0.0, 1.0, t));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;

  // El tiempo se ralentiza durante el warmup para evitar el pop inicial
  float t = u_time * mix(0.3, 1.0, 1.0 - u_warm);

  // Dos capas de FBM para riqueza visual
  float n1 = fbm(uv * 2.5 + vec2(t * 0.12, t * 0.07));
  float n2 = fbm(uv * 1.8 - vec2(t * 0.08, t * 0.11) + n1 * 0.4);

  float noise = mix(n1, n2, 0.55);

  // La intensidad modula cuánto del acento se mezcla con el base
  float driven = noise * u_int;

  // Foco agrega un punto de brillo centrado en el cursor
  float focusGlow = u_focus * 0.15 * smoothstep(0.7, 0.0, length(uv - vec2(0.5)));
  driven = clamp(driven + focusGlow, 0.0, 1.0);

  vec3 color = palette(driven);
  fragColor = vec4(color, 1.0);
}
`
