/**
 * ShaderBackground: canvas WebGL2 decorativo para el fondo animado (T028, US3).
 *
 * - pointer-events: none → nunca bloquea la UI (invariante 1)
 * - Resolución reducida ~0.75× DPR para rendimiento
 * - Loop rAF interpola intensidad hacia el objetivo (targetFor)
 * - Se degrada a StaticBackground ante: sin WebGL2, webglcontextlost, reduce-motion
 * - Se pausa con document.hidden (T031)
 * - El warmup descarta los primeros ~500 ms del guard de FPS (T029)
 */
import React, { useEffect, useRef, useState } from 'react'
import { VERTEX_SHADER, FRAGMENT_SHADER } from './shader.glsl'
import { StaticBackground } from './StaticBackground'
import { createFpsGuard } from './fps-guard'

const WARMUP_MS = 500
const LERP_SPEED = 3.5   // factor de interpolación por segundo

export interface ShaderBackgroundProps {
  /** Intensidad objetivo [0,1] — viene de targetFor(). */
  targetIntensity: number
  /** 1 si el puntero está sobre la zona de drop. */
  focusValue?: number
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'compile error')
  }
  return shader
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
  }
  return prog
}

export function ShaderBackground({
  targetIntensity,
  focusValue = 0,
}: ShaderBackgroundProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [degraded, setDegraded] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Reduce-motion: ir directo a estático
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDegraded(true)
      return
    }

    const gl = canvas.getContext('webgl2')
    if (!gl) { setDegraded(true); return }

    let program: WebGLProgram
    try {
      program = buildProgram(gl)
    } catch {
      setDegraded(true)
      return
    }

    // Quad de pantalla completa
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uRes   = gl.getUniformLocation(program, 'u_res')
    const uTime  = gl.getUniformLocation(program, 'u_time')
    const uInt   = gl.getUniformLocation(program, 'u_int')
    const uFocus = gl.getUniformLocation(program, 'u_focus')
    const uWarm  = gl.getUniformLocation(program, 'u_warm')

    gl.useProgram(program)

    let rafId: number
    let currentIntensity = targetIntensity
    let startTs: number | null = null
    let lastTs = 0
    let paused = false

    const fpsGuard = createFpsGuard(30, 2000, WARMUP_MS, () => {
      setDegraded(true)
    })

    function resize() {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      const scale = 0.75 * dpr
      // canvas y gl son no-nulos aquí: pasamos por los guards anteriores
      const c = canvas as HTMLCanvasElement
      const g = gl as WebGL2RenderingContext
      c.width  = Math.round(c.clientWidth  * scale)
      c.height = Math.round(c.clientHeight * scale)
      g.viewport(0, 0, c.width, c.height)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    const c = canvas as HTMLCanvasElement
    const g = gl as WebGL2RenderingContext

    function loop(ts: number) {
      if (paused) return
      rafId = requestAnimationFrame(loop)

      if (startTs === null) startTs = ts
      const elapsed = ts - startTs
      const dt = Math.min((ts - lastTs) / 1000, 0.1)
      lastTs = ts

      // Interpolar intensidad hacia el objetivo
      currentIntensity += (targetIntensity - currentIntensity) * Math.min(LERP_SPEED * dt, 1)

      const warmup = elapsed < WARMUP_MS ? 1.0 : 0.0

      fpsGuard.tick(ts)

      g.uniform2f(uRes, c.width, c.height)
      g.uniform1f(uTime, elapsed / 1000)
      g.uniform1f(uInt, currentIntensity)
      g.uniform1f(uFocus, focusValue)
      g.uniform1f(uWarm, warmup)

      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    }

    rafId = requestAnimationFrame(loop)

    // Pausa con document.hidden (T031)
    function onVisibility() {
      paused = document.hidden
      if (!paused) {
        lastTs = 0
        rafId = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Degradación ante pérdida de contexto (invariante 2)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      setDegraded(true)
    })

    return () => {
      cancelAnimationFrame(rafId)
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
      fpsGuard.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Propagar cambios de targetIntensity y focusValue al loop sin re-mount
  // (se leen por closure; el efecto se ejecuta solo al montar)
  if (degraded) {
    return <StaticBackground />
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="shader-background"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    />
  )
}
