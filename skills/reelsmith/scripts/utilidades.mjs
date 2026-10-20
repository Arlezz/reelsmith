// utilidades.mjs: piezas para el script de construcción (construir.mjs) que escribe la escena HTML.
// El HTML final no lleva JavaScript: todo lo que CSS no puede hacer solo (partir un texto en letras, sortear 100
// partículas, calcular un resorte, cuadrar los tiempos con la grilla) se resuelve aquí, una vez, al construir.
import { writeFileSync } from "node:fs";

export const FPS = 30;

/** Segundos redondeados al cuadro más cercano (a 30 fps): un corte que cae entre cuadros se ve un cuadro tarde. */
export const aCuadro = (t, fps = FPS) => Math.round(t * fps) / fps;

/** Instante de un tiempo de la grilla musical, ya redondeado al cuadro: compás 0, tiempo 0 = 0 s. */
export const grilla = (bpm, compas, tiempo = 0, fps = FPS) => aCuadro(((compas * 4 + tiempo) * 60) / bpm, fps);

/**
 * Segundos para CSS, medio milisegundo antes y truncados a 4 decimales: s(7.5) → "7.4995s", s(281 / 30) → "9.3661s".
 * Así el delay queda siempre un poco antes del cuadro del corte. Con el delay justo en el cuadro (7.5s en el cuadro
 * 225), Chromium oculta la escena que sale pero todavía no muestra la que entra: un cuadro vacío. Con el delay
 * redondeado hacia arriba ("9.3667s" para 9,36666… s), el corte sale un cuadro tarde. 0,5 ms no se ve en ningún
 * movimiento.
 */
export const s = (t) => `${Math.floor((t - 0.0005) * 1e4 + 1e-7) / 1e4}s`;

/** Generador pseudoaleatorio con semilla (mulberry32): el mismo sorteo en cada construcción. */
export function azar(semilla) {
  let x = semilla >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const esc = (txt) => String(txt).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto → un <span class="ch" style="--i:n"> por carácter (para escalonar con calc(var(--i) * 0.04s)). */
export function letras(texto, { clase = "ch", inicio = 0 } = {}) {
  let i = inicio;
  const html = [...texto].map((c) => `<span class="${clase}" style="--i:${i++}">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("");
  return { html, n: i - inicio };
}

/** Texto → palabras con máscara: <span class="mask"><span class="wd" style="--i:n">palabra</span></span>. */
export function palabras(texto, { inicio = 0 } = {}) {
  return texto.split(/\s+/).map((w, k) => `<span class="mask"><span class="wd" style="--i:${inicio + k}">${esc(w)}</span></span>`).join(" ");
}

/**
 * Resorte en forma cerrada como easing CSS linear(): respuesta al escalón
 *   s(t) = 1 − e^(−ζωt) · (cos(ωd·t) + (ζω/ωd)·sin(ωd·t)),  ωd = ω·√(1−ζ²),  ω = 2π·frecuencia.
 * ζ 0,75-0,9 = sobrepaso mínimo (el de la dirección); ζ 0,5 = rebote visible (solo para un golpe puntual).
 * Devuelve { easing, duracion } con la duración en que el resorte queda a menos del 0,1 % del destino.
 */
export function resorte({ zeta = 0.8, frecuencia = 1.6, puntos = 48 } = {}) {
  const w = 2 * Math.PI * frecuencia;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  const f = (t) => 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
  let dur = 0.05;
  for (let t = 0.05; t < 10; t += 0.01) {
    const quieto = [0, 0.05, 0.1, 0.15, 0.2].every((d) => Math.abs(1 - f(t + d)) < 0.001);
    if (quieto) { dur = t; break; }
  }
  const pts = [];
  for (let k = 0; k <= puntos; k++) {
    const t = (k / puntos) * dur;
    pts.push(k === 0 ? "0" : k === puntos ? "1" : `${f(t).toFixed(4)} ${((k / puntos) * 100).toFixed(2)}%`);
  }
  return { easing: `linear(${pts.join(", ")})`, duracion: Number(dur.toFixed(3)) };
}

/**
 * Ventana de una escena: visible desde `entra` hasta `sale` (segundos). Va en el atributo style de la escena y usa
 * las animaciones `mostrar` y `ocultar` de la plantilla (steps(1, jump-start): visible justo en el cuadro del corte).
 */
export const ventana = (entra, sale) => `--entra:${s(entra)};--sale:${s(sale)}`;

/**
 * Escribe plan_cortes.json, el insumo de medir_cortes.py y componer.py, desde los mismos datos que el HTML.
 * cortes: [{ t, nombre, peso }]  peso 1,0 = corte principal · 0,6 = cambio de sección · 0,3-0,4 = cambio menor.
 * final: cuándo se asienta el logo o la frase final.
 */
export function escribirPlan(ruta, cortes, final, extra = {}) {
  const r4 = (t) => Number(aCuadro(t).toFixed(4));
  const plan = { cortes: cortes.map((c) => ({ t: r4(c.t), nombre: c.nombre, peso: c.peso })), final_s: r4(final), ...extra };
  writeFileSync(ruta, JSON.stringify(plan, null, 1));
  return plan;
}

/** Palabras de un texto (para la regla de lectura). Una cifra con su unidad cuenta como una ("20 s", "−14 LUFS"). */
export const nPalabras = (txt) => String(txt)
  .replace(/([−-]?\d[\d.,]*)[\s\u00a0]+(%|s|ms|min|h|dB|dBTP|LUFS|bpm|Hz|kHz|MB|GB|KB|px|x|×)(?=$|[\s.,;:)])/g, "$1$2")
  .trim().split(/\s+/).filter(Boolean).length;

/** Regla de lectura: un texto explicativo queda quieto max(3, 1,5 + 0,35 × palabras) s después de entrar. */
export const lectura = (txt) => Math.round(Math.max(3, 1.5 + 0.35 * nPalabras(txt)) * 100) / 100;
