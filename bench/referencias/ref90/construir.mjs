// construir.mjs: showreel de 90 s de video-with-ai. Escribe escena.html (solo HTML y CSS) y plan_cortes.json.
//   node construir.mjs
import { writeFileSync } from "node:fs";
import { aCuadro, azar, esc, escribirPlan, grilla, lectura, letras, resorte, s, ventana } from "./utilidades.mjs";

// ---------------------------------------------------------------- guion sobre la grilla (corporativa, 128 bpm)
const BPM = 128;
const g = (compas, tiempo = 0) => grilla(BPM, compas, tiempo);
const T = {
  bajada: g(0, 1),
  problema: g(3),
  reloj: g(5),
  prueba: g(7),
  decision: g(11),
  video: g(11),
  musicaW: g(11, 1),
  nativos: g(11, 2),
  linea2: g(11, 3),
  P1: g(15),
  bloques: [g(15), g(15, 1), g(15, 2), g(15, 3), g(16), g(16, 1)],
  conexiones: g(16, 2),
  asienta: g(17),
  enciende: g(19, 3),
  render: g(20),
  pila: g(21),
  contadores: g(24),
  musica: g(27),
  marcas: [g(28), g(29), g(29, 2)],
  swell: g(30),
  P2: g(31),
  pulso: g(33),
  mezcla: g(35),
  derechos: g(38),
  agente: g(41),
  logo: g(45),
};
const DURACION = 90;
const LOGO_QUIETO = g(46); // el logo y su línea quedan quietos desde aquí (3,75 s)

const PALETA = { ground: "#090E50", main: "#E72887", ink: "#FFFFFF", accent: "#FAD4E7" }; // CENIA oscura
const suave = resorte({ zeta: 0.85, frecuencia: 1.8 });
const firme = resorte({ zeta: 0.8, frecuencia: 2.2 });
const golpe = resorte({ zeta: 0.55, frecuencia: 2.4 }); // solo en los dos principales

// ---------------------------------------------------------------- regla de lectura (se comprueba al construir)
const avisos = [];
const lecturas = [];
function leer(nombre, texto, t0, nPal, stagger, salida, entrada = 0.6) {
  const fin = t0 + (nPal - 1) * stagger + entrada;
  const disp = salida - fin, q = lectura(texto);
  lecturas.push(`${nombre}: quieto ${disp.toFixed(2)} s (pide ${q} s)`);
  if (disp < q) avisos.push(`LECTURA ${nombre}: ${disp.toFixed(2)} s < ${q} s`);
}

// palabras con máscara; separa solo por espacio normal (el espacio duro mantiene "90 s" junto)
function pal(texto, { inicio = 0, marca = [] } = {}) {
  return texto.split(" ").map((w, k) =>
    `<span class="mask"><span class="wd${marca.includes(k) ? " m" : ""}" style="--i:${inicio + k}">${esc(w)}</span></span>`).join(" ");
}
const NB = " ";

// ---------------------------------------------------------------- piezas generadas
const titulo = letras("video-with-ai");
const logo = letras("CENIA");

// piezas del inicio: vuelven al final y se arman en la regla del logo
const PIEZAS = [
  { x: 150, y: 150, w: 220, c: "var(--main)", p: 1.0, r: -8 },
  { x: 1560, y: 190, w: 160, c: "var(--accent)", p: 0.6, r: 6 },
  { x: 240, y: 880, w: 150, c: "var(--accent)", p: 0.8, r: 4 },
  { x: 1500, y: 860, w: 240, c: "var(--main)", p: 1.2, r: -5 },
  { x: 90, y: 540, w: 110, c: "var(--main)", p: 0.5, r: 10 },
  { x: 1700, y: 560, w: 130, c: "var(--accent)", p: 0.9, r: -10 },
];
const piezas1 = PIEZAS.map((q, k) =>
  `<i class="pieza" style="left:${q.x}px;top:${q.y}px;width:${q.w}px;background:${q.c};--dx:${(-40 * q.p).toFixed(0)}px;--dy:${(-18 * q.p).toFixed(0)}px;--r:${q.r}deg"></i>`).join("");
const SEG_W = 90, SEG_GAP = 12, SEG_X0 = 960 - (6 * SEG_W + 5 * SEG_GAP) / 2, SEG_Y = 640;
const segs11 = PIEZAS.map((q, k) => {
  const fx = SEG_X0 + k * (SEG_W + SEG_GAP), dx = q.x + q.w / 2 - (fx + SEG_W / 2), dy = q.y - SEG_Y;
  return `<i class="seg" style="left:${fx}px;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--sx:${(q.w / SEG_W).toFixed(2)};--r:${q.r * 3}deg;` +
    `--t:${s(T.logo + 0.2 + k * 0.09)}"></i>`;
}).join("");

// reloj del problema (dos vueltas = dos horas)
const ticks = Array.from({ length: 12 }, (_, k) => {
  const a = (k / 12) * Math.PI * 2, r1 = 205, r2 = k % 3 ? 192 : 180;
  return `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * r2).toFixed(1)}" y2="${(-Math.cos(a) * r2).toFixed(1)}"/>`;
}).join("");
const L1 = 2 * Math.PI * 160, L2 = 2 * Math.PI * 130;
const contenido2 = `
  <p class="kicker k2">EL PROBLEMA</p>
  <h2 class="t2">${pal(`Un video de 90${NB}s con agentes`)}<br>${pal("tomaba de 1 a 2 horas", { inicio: 6, marca: [2, 3, 4, 5] })}</h2>
  <div class="reloj"><div class="pulsa">
    <svg viewBox="-220 -220 440 440" width="440" height="440">
      <circle r="160" class="aro"/><circle r="130" class="aro"/>
      <g class="ticks">${ticks}</g>
      <g transform="rotate(-90)">
        <circle r="160" class="arco a1" style="stroke-dasharray:${L1.toFixed(1)};stroke-dashoffset:${L1.toFixed(1)}"/>
        <circle r="130" class="arco a2" style="stroke-dasharray:${L2.toFixed(1)};stroke-dashoffset:${L2.toFixed(1)}"/>
      </g>
    </svg>
    <div class="aguja"></div><div class="eje"></div>
  </div></div>`;

// prueba: dos pantallas con el mismo HTML
const mini = `<div class="mini"><b>video-with-ai</b><i class="mregla"></i><i class="mlinea"></i><i class="mlinea corta"></i><i class="scan"></i></div>`;

// pipeline 3D
const NOMBRES = ["HTML y CSS", "render", "cortes", "música", "mezcla", "jueces"];
const ANCHOS = [300, 210, 210, 210, 210, 210];
const GAP = 84, BX0 = 75, BY = 470, BH = 140;
const BX = []; { let x = BX0; for (const w of ANCHOS) { BX.push(x); x += w + GAP; } }
const BC = BX.map((x, k) => x + ANCHOS[k] / 2);
const bloques = NOMBRES.map((n, k) =>
  `<div class="sombra" style="left:${BX[k]}px;width:${ANCHOS[k]}px;--t:${s(T.bloques[k])}"></div>` +
  `<i class="onda${k === 0 ? " grande" : ""}" style="left:${BC[k] - 100}px;--t:${s(T.bloques[k])}"></i>` +
  `<div class="bloque${k === 0 ? " primero" : ""}${k === 1 ? " r" : ""}" style="left:${BX[k]}px;width:${ANCHOS[k]}px;--t:${s(T.bloques[k] - (k === 0 ? 0.25 : 0.53))}"><span>${esc(n)}</span></div>`).join("");
let flechas = "";
for (let k = 0; k < 5; k++) {
  const x1 = BX[k] + ANCHOS[k] + 12, x2 = BX[k + 1] - 12, y = BY + BH / 2;
  const len = (x2 - x1) + 2 * Math.hypot(14, 12);
  flechas += `<path d="M${x1} ${y} L${x2} ${y} M${x2 - 14} ${y - 12} L${x2} ${y} L${x2 - 14} ${y + 12}" ` +
    `style="stroke-dasharray:${len.toFixed(1)};stroke-dashoffset:${len.toFixed(1)};animation:trazo 0.3s ease-out ${s(T.conexiones + k * 0.1)} forwards"/>`;
}
const paquetes = [0, 1, 2, 3].map((k) => `<i class="paquete" style="--t:${s(T.asienta + 0.3 + k * 0.6)}"></i>`).join("");
const cam = (ax, cx, sc, ty = 0) => `rotateX(${ax}deg) translate3d(${(sc * (960 - cx)).toFixed(1)}px, ${ty}px, 0) scale(${sc})`;
const D5 = T.render - T.P1;
const pc = (t) => (((t - T.P1) / D5) * 100).toFixed(3) + "%";
const camKeys = [
  [T.P1, cam(56, BC[0], 1.3, 40), "ease-in-out"],
  [T.bloques[1], cam(54, BC[1], 1.28, 40), "ease-in-out"],
  [T.bloques[2], cam(52, BC[2], 1.26, 40), "ease-in-out"],
  [T.bloques[3], cam(50, BC[3], 1.24, 40), "ease-in-out"],
  [T.bloques[4], cam(48, BC[4], 1.22, 40), "ease-in-out"],
  [T.bloques[5], cam(46, BC[5], 1.2, 40), "cubic-bezier(0.65, 0, 0.35, 1)"],
  [T.asienta, cam(20, 960, 0.9, 0), "linear"],
  [T.render - 0.45, cam(20, 960, 0.93, 0), "cubic-bezier(0.55, 0, 1, 0.45)"],
  [T.render, cam(0, BC[1], 13, 0), "linear"],
].map(([t, tr, e]) => `${pc(t)} { transform: ${tr}; animation-timing-function: ${e}; }`).join("\n  ");

// render: tres MP4 idénticos
const patron = (() => {
  const r = azar(42); let h = "";
  for (let i = 0; i < 48; i++) { const v = r(); h += `<i style="background:${v < 0.3 ? "var(--main)" : v < 0.6 ? "var(--accent)" : "rgba(255,255,255,0.16)"}"></i>`; }
  return h;
})();
const tarjetas = [0, 1, 2].map((k) => `<div class="mp4 k${k}"><i class="pliegue"></i><b>MP4</b><div class="bytes">${patron}</div></div>`).join("");

// música: pista, cabezal, marcas y forma de onda
const PX0 = 360, PW = 1200, PY = 640;
const xEn = (t) => PX0 + (PW * (t - T.musica)) / (T.P2 - T.musica);
const marcas = T.marcas.map((tm) => {
  const x = xEn(tm);
  return `<i class="marca" style="left:${(x - 2).toFixed(1)}px;--t:${s(tm)}"></i><i class="pico" style="left:${(x - 8).toFixed(1)}px;--t:${s(tm)}"></i>`;
}).join("");
const rOnda = azar(11);
let barras = "";
for (let i = 0; i < 60; i++) {
  const h = 40 + Math.round(rOnda() * 120 * (0.55 + 0.45 * Math.sin((i / 59) * Math.PI)));
  barras += `<i class="barra" style="left:${PX0 + i * 20 + 4}px;top:${800 - h / 2}px;height:${h}px;--i:${i}"></i>`;
}

// impacto: chispas
const rnd = azar(7);
let chispas = "";
for (let k = 0; k < 70; k++) {
  const a = rnd() * Math.PI * 2, d = 320 + rnd() * 800, tam = 4 + rnd() * 9, col = rnd() < 0.7 ? "#FFFFFF" : PALETA.accent;
  chispas += `<i class="p" style="--x:${(Math.cos(a) * d).toFixed(1)}px;--y:${(Math.sin(a) * d).toFixed(1)}px;--d:${(0.7 + rnd() * 0.6).toFixed(2)}s;` +
    `width:${tam.toFixed(1)}px;height:${tam.toFixed(1)}px;background:${col}"></i>`;
}

// derechos: sello con forma de onda
const ondaSello = [40, 90, 140, 70, 170, 110, 60, 130, 50].map((h, k) => `<rect x="${-112 + k * 28}" y="${-h / 2}" width="16" height="${h}" rx="8"/>`).join("");

// agente: dial de 60 minutos que llega a 28
const RD = 200, LD = 2 * Math.PI * RD;
const ticksDial = Array.from({ length: 60 }, (_, k) => {
  const a = (k / 60) * Math.PI * 2, r1 = 228, r2 = k % 5 ? 220 : 210;
  return `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * r2).toFixed(1)}" y2="${(-Math.cos(a) * r2).toFixed(1)}"/>`;
}).join("");

// ---------------------------------------------------------------- comprobación de lectura (entrada → próxima salida)
leer("bajada", "Videos de proyecto hechos con código", T.bajada + 0.05, 6, 0.07, T.problema - 0.3);
leer("problema", "Un video de 90 s con agentes tomaba de 1 a 2 horas", T.problema + 0.1, 12, 0.05, T.prueba - 0.3);
leer("prueba", "Probamos HyperFrames y un render nativo con el mismo HTML: SSIM 0,994", T.prueba + 0.15, 10, 0.035, T.decision - 0.35);
leer("decisión", "Video y música nativos, sin framework de video", T.linea2, 4, 0.06, T.P1 - 0.2);
leer("pipeline (tarjeta)", "HTML y CSS render cortes música mezcla jueces", T.asienta, 1, 0, T.enciende);
leer("render", "El MP4 sale idéntico byte a byte en cada render", T.render + 0.15, 9, 0.05, T.contadores - 0.3);
leer("contadores", "20 s con 825 animaciones se renderizan en 76 s", T.contadores + 0.1, 1, 0, T.musica, 0.7);
leer("música", "La música se compone a la medida: cada corte tiene su golpe", T.musica + 0.1, 12, 0.05, T.P2);
leer("impacto", "El impacto cae a 0 ms del corte principal", T.P2 + 0.35, 3, 0.06, T.mezcla - 0.35);
leer("mezcla", "Mezcla a −14 LUFS, con pico bajo −1 dBTP", T.mezcla - 0.12, 8, 0.05, T.derechos - 0.3);
leer("derechos", "Derechos del audio 100 % propios", T.derechos + 0.15, 5, 0.06, T.agente);
leer("agente", "Un agente nuevo hizo un video de 30 s en 28 minutos", T.agente + 0.15, 10, 0.05, T.logo - 0.3);

const html = `<!doctype html>
<html lang="es" data-duracion="${DURACION}">
<head>
<meta charset="utf-8">
<title>video-with-ai · showreel 90 s</title>
<!-- Generado por construir.mjs: no editar a mano. -->
<style>
@font-face { font-family: "Quicksand"; src: url("./fuentes/quicksand-latin-wght-normal.woff2") format("woff2"); font-weight: 300 700; font-display: block; }
@property --n { syntax: "<integer>"; inherits: false; initial-value: 0; }
@counter-style tres { system: extends decimal; pad: 3 "0"; }
:root {
  --ground: ${PALETA.ground}; --main: ${PALETA.main}; --ink: ${PALETA.ink}; --accent: ${PALETA.accent};
  --suave: ${suave.easing}; --firme: ${firme.easing}; --golpe: ${golpe.easing};
  --sale-rapido: cubic-bezier(0.55, 0, 1, 0.45); --entra-rapido: cubic-bezier(0.16, 1, 0.3, 1);
  --bloque: #1A2180;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--ground); }
#raiz { position: relative; width: 1920px; height: 1080px; overflow: hidden; font-family: Quicksand, sans-serif; color: var(--ink); background: var(--ground); }
.escena { position: absolute; inset: 0; visibility: hidden;
  animation: mostrar 1ms steps(1, jump-start) var(--entra) both, ocultar 1ms steps(1, jump-start) var(--sale) forwards; }
@keyframes mostrar { from { visibility: hidden; } to { visibility: visible; } }
@keyframes ocultar { from { visibility: visible; } to { visibility: hidden; } }
.centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ch, .wd { display: inline-block; }
.mask { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: 0.1em; margin-bottom: -0.1em; }
.wd.m { color: var(--main); }
.kicker { position: absolute; font-size: 30px; font-weight: 700; letter-spacing: 0.22em; color: var(--main); }
.camara { position: absolute; inset: 0; }
.num { display: inline-block; text-align: right; counter-reset: n var(--n); }
.num::after { content: counter(n); }
@keyframes subir { from { transform: translateY(110%); } to { transform: none; } }
@keyframes bajar { from { transform: translateY(-110%); } to { transform: none; } }
@keyframes empuje { from { transform: scale(1); } to { transform: scale(1.03); } }
@keyframes fuga { from { transform: scale(1.03); opacity: 1; } to { transform: scale(2.4); opacity: 0; } }
@keyframes aparecer { from { opacity: 0; } to { opacity: 1; } }
@keyframes destello { from { opacity: 0.6; } to { opacity: 0; } }
@keyframes trazo { to { stroke-dashoffset: 0; } }
.destello { position: absolute; inset: 0; background: var(--ink); opacity: 0; pointer-events: none; }

/* fondo continuo: cuadrícula de puntos que deriva durante todo el video */
#fondo { position: absolute; left: -200px; top: -200px; width: 2400px; height: 1500px;
  background-image: radial-gradient(circle, rgba(250, 212, 231, 0.12) 2px, transparent 2.6px); background-size: 48px 48px;
  animation: deriva ${DURACION}s linear 0s both; }
@keyframes deriva { from { transform: translate(0, 0); } to { transform: translate(-144px, -96px); } }

/* ---------- 1 · apertura ---------- */
#s1 .pieza { position: absolute; height: 22px; border-radius: 11px; opacity: 0.9;
  animation: flotar ${s(T.problema + 0.4)} ease-in-out 0s both; }
@keyframes flotar { from { transform: rotate(var(--r)); } to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); } }
#s1 .camara { animation: empuje ${s(T.problema)} ease-in-out 0s both; }
#s1 .titulo { font-size: 160px; font-weight: 700; letter-spacing: -0.03em; white-space: pre; }
#s1 .titulo .ch { animation: letra 0.5s var(--suave) calc(-0.3s + var(--i) * 0.04s) both; }
@keyframes letra { from { transform: translateY(80px) scale(1.6); opacity: 0; } to { transform: none; opacity: 1; } }
#s1 .regla { width: 0; height: 10px; border-radius: 5px; background: var(--main); margin: 36px 0 30px; animation: regla 0.6s var(--entra-rapido) ${s(T.bajada - 0.1)} both; }
@keyframes regla { from { width: 0; } to { width: 560px; } }
#s1 .bajada { font-size: 52px; font-weight: 500; color: var(--accent); }
#s1 .bajada .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.bajada + 0.05)} + var(--i) * 0.07s) both; }

/* cortina (apertura → problema y agente → logo) */
.cortina { position: absolute; inset: 0; background: var(--main); clip-path: inset(0 100% 0 0); }
#cortina1 { animation: cortina 0.6s linear ${s(T.problema - 0.3)} both; }
#cortina2 { animation: cortina 0.6s linear ${s(T.logo - 0.3)} both; }
@keyframes cortina { 0% { clip-path: inset(0 100% 0 0); animation-timing-function: var(--sale-rapido); }
  50% { clip-path: inset(0 0 0 0); animation-timing-function: var(--entra-rapido); } 100% { clip-path: inset(0 0 0 100%); } }

/* ---------- 2 · problema (sale con whip pan y estela) ---------- */
#s2 .lienzo { position: absolute; inset: 0; }
#s2 .k2 { left: 160px; top: 300px; animation: aparecer 0.4s linear ${s(T.problema + 0.05)} both; }
#s2 .t2 { position: absolute; left: 160px; top: 360px; font-size: 76px; font-weight: 700; line-height: 1.18; letter-spacing: -0.01em; }
#s2 .t2 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.problema + 0.1)} + var(--i) * 0.05s) both; }
#s2 .reloj { position: absolute; left: 1340px; top: 320px; width: 440px; height: 440px; }
#s2 .pulsa { position: absolute; inset: 0; animation: llegar-reloj ${s(suave.duracion)} var(--suave) ${s(T.problema)} both, pulso 0.4s ease-out ${s(T.reloj)} forwards; }
@keyframes llegar-reloj { from { transform: translateY(120px) scale(0.7); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pulso { 0% { transform: scale(1); opacity: 1; } 35% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
#s2 svg { position: absolute; inset: 0; overflow: visible; }
#s2 .aro { fill: none; stroke: rgba(255, 255, 255, 0.12); stroke-width: 14; }
#s2 .ticks line { stroke: var(--accent); stroke-width: 6; stroke-linecap: round; }
#s2 .arco { fill: none; stroke-width: 14; stroke-linecap: round; }
#s2 .a1 { stroke: var(--accent); animation: trazo ${s(T.reloj - T.problema - 0.3)} ease-in-out ${s(T.problema + 0.3)} forwards; }
#s2 .a2 { stroke: var(--main); animation: trazo ${s(T.prueba - 0.5 - T.reloj)} ease-in-out ${s(T.reloj)} forwards; }
#s2 .aguja { position: absolute; left: 216px; top: 70px; width: 8px; height: 150px; border-radius: 4px; background: var(--ink); transform-origin: 50% 100%;
  animation: girar ${s(T.prueba - 0.5 - T.problema - 0.3)} cubic-bezier(0.45, 0, 0.55, 1) ${s(T.problema + 0.3)} both; }
@keyframes girar { from { transform: rotate(0deg); } to { transform: rotate(720deg); } }
#s2 .eje { position: absolute; left: 204px; top: 204px; width: 32px; height: 32px; border-radius: 50%; background: var(--main); }
#s2 .camara { animation: empuje ${s(T.prueba - T.problema)} ease-in-out ${s(T.problema)} both, whip-sale 0.3s var(--sale-rapido) ${s(T.prueba - 0.3)} forwards; }
#s2 .estela { position: absolute; inset: 0; opacity: 0; }
#s2 .e1 { animation: whip-sale 0.3s var(--sale-rapido) ${s(T.prueba - 0.3 + 0.034)} forwards, estela-op 0.33s linear ${s(T.prueba - 0.3)} forwards; }
#s2 .e2 { animation: whip-sale 0.3s var(--sale-rapido) ${s(T.prueba - 0.3 + 0.067)} forwards, estela-op2 0.37s linear ${s(T.prueba - 0.3)} forwards; }
@keyframes whip-sale { from { transform: scale(1.03) translateX(0); } to { transform: scale(1.03) translateX(-2600px); } }
@keyframes estela-op { 0% { opacity: 0; } 15% { opacity: 0.35; } 100% { opacity: 0; } }
@keyframes estela-op2 { 0% { opacity: 0; } 15% { opacity: 0.18; } 100% { opacity: 0; } }

/* ---------- 3 · prueba: pantalla dividida ---------- */
#s3 .camara { animation: whip-entra 0.45s var(--entra-rapido) ${s(T.prueba - 0.12)} both; }
@keyframes whip-entra { from { transform: translateX(2600px); } to { transform: none; } }
#s3 .empuja { position: absolute; inset: 0; animation: empuje ${s(T.decision - T.prueba)} ease-in-out ${s(T.prueba)} both; }
#s3 .panel { position: absolute; top: 110px; width: 600px; }
#s3 .izq { left: 250px; } #s3 .der { left: 1070px; }
#s3 .pantalla { width: 600px; height: 338px; border-radius: 24px; border: 4px solid rgba(250, 212, 231, 0.55); background: #10166A; overflow: hidden; position: relative; }
#s3 .rotulo { margin-top: 18px; text-align: center; font-size: 40px; font-weight: 700; color: var(--accent); }
#s3 .mini { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
#s3 .mini b { font-size: 64px; font-weight: 700; letter-spacing: -0.03em; }
#s3 .mregla { width: 220px; height: 6px; border-radius: 3px; background: var(--main); margin: 16px 0 18px; }
#s3 .mlinea { width: 300px; height: 12px; border-radius: 6px; background: rgba(250, 212, 231, 0.5); margin-bottom: 10px; }
#s3 .mlinea.corta { width: 200px; }
#s3 .scan { position: absolute; left: 0; top: 0; width: 6px; height: 100%; background: var(--accent); box-shadow: 0 0 24px var(--accent); opacity: 0;
  animation: escanear 1.4s ease-in-out ${s(T.prueba + 1.4)} 3 both; }
@keyframes escanear { 0% { transform: translateX(-10px); opacity: 0; } 10% { opacity: 0.9; } 90% { opacity: 0.9; } 100% { transform: translateX(600px); opacity: 0; } }
#s3 .igual { position: absolute; left: 910px; top: 245px; width: 100px; height: 70px; }
#s3 .igual i { position: absolute; left: 0; width: 100px; height: 16px; border-radius: 8px; background: var(--main); transform-origin: 0 50%;
  animation: barra-igual 0.35s var(--entra-rapido) ${s(T.prueba + 0.35)} both; }
#s3 .igual i:last-child { top: 50px; animation-delay: ${s(T.prueba + 0.45)}; }
@keyframes barra-igual { from { transform: scaleX(0); } to { transform: none; } }
#s3 .t3 { position: absolute; left: 0; right: 0; top: 600px; text-align: center; font-size: 52px; font-weight: 600; }
#s3 .t3 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.prueba + 0.15)} + var(--i) * 0.035s) both; }
#s3 .ssim { position: absolute; left: 0; right: 0; top: 690px; text-align: center; font-size: 160px; font-weight: 700; color: var(--main); letter-spacing: -0.02em; }
#s3 .ssim .wd { animation: subir 0.6s var(--entra-rapido) ${s(T.prueba + 0.25)} both; }
#s3 .cnt { counter-reset: n var(--n); animation: c994 0.7s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.prueba + 0.3)} both; }
#s3 .cnt::after { content: counter(n, tres); }
@keyframes c994 { from { --n: 0; } to { --n: 994; } }

/* máscara circular: crece desde el signo igual */
#mascara { position: absolute; left: 860px; top: 180px; width: 200px; height: 200px; border-radius: 50%; background: var(--accent);
  transform: scale(0); animation: crecer 0.35s var(--sale-rapido) ${s(T.decision - 0.35)} both, ocultar 1ms steps(1, jump-start) ${s(T.decision)} forwards; }
@keyframes crecer { from { transform: scale(0); } to { transform: scale(13); } }

/* ---------- 4 · decisión: tipografía cinética ---------- */
#s4 { background: var(--accent); color: var(--ground); }
#s4 .camara { animation: empuje ${s(T.P1 - 0.2 - T.decision)} ease-in-out ${s(T.decision)} both, inhalar 0.2s var(--sale-rapido) ${s(T.P1 - 0.2)} forwards; }
@keyframes inhalar { from { transform: scale(1.03); } to { transform: scale(0.97); } }
#s4 p { position: absolute; left: 0; right: 0; text-align: center; font-weight: 700; }
#s4 .l1 { top: 220px; font-size: 120px; letter-spacing: -0.02em; animation: dejar-pasar ${s(firme.duracion)} var(--firme) ${s(T.nativos - 0.05)} both; }
@keyframes dejar-pasar { from { transform: translateY(150px); } to { transform: none; } }
#s4 .w1 { animation: subir 0.5s var(--entra-rapido) ${s(T.video)} both; }
#s4 .w2 { animation: subir 0.5s var(--entra-rapido) ${s(T.musicaW)} both; }
#s4 .l2 { top: 380px; font-size: 240px; letter-spacing: -0.04em; color: var(--main); line-height: 1.1; }
#s4 .w3 { display: inline-block; animation: grande ${s(suave.duracion)} var(--suave) ${s(T.nativos)} both; }
@keyframes grande { from { transform: scale(2.2) translateY(-10%); opacity: 0; } to { transform: none; opacity: 1; } }
#s4 .l3 { top: 720px; font-size: 80px; font-weight: 600; }
#s4 .l3 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.linea2)} + var(--i) * 0.06s) both; }

/* ---------- 5 · pipeline: arquitectura que se arma (PRINCIPAL 1) ---------- */
#s5 { background: var(--ground); }
#s5 .vista { position: absolute; inset: 0; perspective: 1800px; perspective-origin: 50% 50%; overflow: hidden; }
#s5 .mundo { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-style: preserve-3d; transform-origin: 50% 50%;
  animation: cam5 ${s(D5)} linear ${s(T.P1)} both; }
@keyframes cam5 {
  ${camKeys}
}
#s5 .piso, #s5 .piso2 { position: absolute; left: -1500px; top: -1500px; width: 4920px; height: 4080px; }
#s5 .piso { background-image: linear-gradient(rgba(250, 212, 231, 0.11) 2px, transparent 2px), linear-gradient(90deg, rgba(250, 212, 231, 0.11) 2px, transparent 2px);
  background-size: 96px 96px; background-position: 27px 54px; }
#s5 .piso2 { background-image: linear-gradient(rgba(231, 40, 135, 0.55) 3px, transparent 3px), linear-gradient(90deg, rgba(231, 40, 135, 0.55) 3px, transparent 3px);
  background-size: 96px 96px; background-position: 27px 54px; opacity: 0; animation: encender-piso 0.9s ease-out ${s(T.asienta)} forwards; }
@keyframes encender-piso { from { opacity: 1; } to { opacity: 0.35; } }
#s5 .sombra { position: absolute; top: ${BY}px; height: ${BH}px; border-radius: 24px; background: rgba(0, 0, 0, 0.45); transform: translateZ(1px);
  animation: sombra ${s(suave.duracion)} var(--suave) var(--t) both; }
@keyframes sombra { from { transform: translateZ(1px) scale(0.4); opacity: 0; } to { transform: translateZ(1px); opacity: 1; } }
#s5 .onda { position: absolute; top: ${BY + BH / 2 - 100}px; width: 200px; height: 200px; border-radius: 50%; border: 5px solid var(--accent); opacity: 0;
  animation: onda 0.8s cubic-bezier(0.2, 0.7, 0.3, 1) var(--t) forwards; }
#s5 .onda.grande { border-color: var(--main); border-width: 8px; animation-name: onda-grande; animation-duration: 1.1s; }
@keyframes onda { from { transform: translateZ(2px) scale(0.6); opacity: 0.9; } to { transform: translateZ(2px) scale(2.6); opacity: 0; } }
@keyframes onda-grande { from { transform: translateZ(2px) scale(0.6); opacity: 1; } to { transform: translateZ(2px) scale(7); opacity: 0; } }
#s5 .bloque { position: absolute; top: ${BY}px; height: ${BH}px; border-radius: 24px; background: var(--bloque); border: 4px solid var(--accent);
  display: flex; align-items: center; justify-content: center; font-size: 42px; font-weight: 700; color: var(--ink); white-space: nowrap;
  animation: caer ${s(suave.duracion)} var(--suave) var(--t) both, aparecer 0.08s linear var(--t) both; }
#s5 .bloque.primero { animation: caer ${s(golpe.duracion)} var(--golpe) var(--t) both, aparecer 0.08s linear var(--t) both; }
#s5 .bloque.r { animation: caer ${s(suave.duracion)} var(--suave) var(--t) both, aparecer 0.08s linear var(--t) both,
  encender 1ms steps(1, jump-start) ${s(T.enciende)} both; }
#s5 .bloque.r span { animation: apagar 0.2s linear ${s(T.render - 0.45)} forwards; }
@keyframes caer { from { transform: translateZ(520px); } to { transform: translateZ(28px); } }
@keyframes encender { from { background-color: var(--bloque); border-color: var(--accent); } to { background-color: var(--main); border-color: var(--main); } }
@keyframes apagar { from { opacity: 1; } to { opacity: 0; } }
#s5 .conex { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform: translateZ(28px); overflow: visible; }
#s5 .conex path { fill: none; stroke: var(--accent); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
#s5 .paquete { position: absolute; left: 0; top: ${BY + BH / 2 - 9}px; width: 18px; height: 18px; border-radius: 50%; background: var(--main);
  box-shadow: 0 0 18px var(--main); opacity: 0; animation: viaje 2.4s linear var(--t) 3 both; }
@keyframes viaje { 0% { transform: translate3d(${BC[0] - 9}px, 0, 14px); opacity: 0; } 8% { opacity: 1; } 92% { opacity: 1; }
  100% { transform: translate3d(${BC[5] - 9}px, 0, 14px); opacity: 0; } }
#s5 .k5 { left: 0; right: 0; top: 170px; text-align: center; font-size: 34px; }
#s5 .k5 .wd { animation: subir 0.5s var(--entra-rapido) ${s(T.asienta)} both; }
#s5 .destello { animation: destello 0.5s ease-out ${s(T.P1)} forwards; }

/* ---------- 6a · render: tres MP4 idénticos ---------- */
#s6a .t6 { position: absolute; left: 160px; top: 380px; font-size: 76px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
#s6a .t6 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.render + 0.15)} + var(--i) * 0.05s) both; }
#s6a .camara { animation: empuje ${s(T.contadores - T.render)} ease-in-out ${s(T.render)} both; transform-origin: 30% 50%; }
#s6a .mp4 { position: absolute; left: 1360px; top: 330px; width: 320px; height: 420px; border-radius: 28px; background: #141B72; border: 4px solid var(--accent);
  display: flex; flex-direction: column; align-items: center; padding-top: 42px; }
#s6a .mp4 b { font-size: 72px; font-weight: 700; letter-spacing: 0.02em; }
#s6a .pliegue { position: absolute; right: -4px; top: -4px; width: 64px; height: 64px; background: var(--ground); border-bottom-left-radius: 18px;
  border-left: 4px solid var(--accent); border-bottom: 4px solid var(--accent); }
#s6a .bytes { margin-top: 34px; display: grid; grid-template-columns: repeat(8, 26px); gap: 6px; }
#s6a .bytes i { width: 26px; height: 26px; border-radius: 6px; }
#s6a .k0 { --x0: -900px; --y0: -500px; --r0: -40deg; --fx: -64px; --fy: -26px; --fr: -7deg; --t: ${s(T.render + 0.05)}; }
#s6a .k1 { --x0: 0px; --y0: 800px; --r0: 25deg; --fx: 0px; --fy: 0px; --fr: 2deg; --t: ${s(T.render + 0.17)}; }
#s6a .k2 { --x0: 900px; --y0: -300px; --r0: 50deg; --fx: 64px; --fy: 26px; --fr: 8deg; --t: ${s(T.render + 0.29)}; }
#s6a .mp4 { animation: volar ${s(suave.duracion)} var(--suave) var(--t) both, apilar ${s(firme.duracion)} var(--firme) ${s(T.pila)} forwards; }
@keyframes volar { from { transform: translate(var(--x0), var(--y0)) rotate(var(--r0)); } to { transform: translate(var(--fx), var(--fy)) rotate(var(--fr)); } }
@keyframes apilar { from { transform: translate(var(--fx), var(--fy)) rotate(var(--fr)); } to { transform: none; } }
#s6a .check { position: absolute; left: 1630px; top: 290px; width: 96px; height: 96px; border-radius: 50%; background: var(--main);
  animation: brotar ${s(golpe.duracion)} var(--suave) ${s(T.pila + 0.12)} both; }
#s6a .check svg { position: absolute; inset: 0; }
#s6a .check path { fill: none; stroke: var(--ink); stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; }
@keyframes brotar { from { transform: scale(0); } to { transform: none; } }

/* barrido de progreso (render → contadores) */
#barrido { position: absolute; inset: 0; clip-path: inset(0 100% 0 0);
  background: repeating-linear-gradient(-45deg, var(--main) 0 60px, #D21E79 60px 120px);
  animation: cortina 0.6s linear ${s(T.contadores - 0.3)} both; }

/* ---------- 6b · contadores ---------- */
#s6b p { position: absolute; left: 0; right: 0; text-align: center; font-size: 104px; font-weight: 700; letter-spacing: -0.02em; }
#s6b .l1 { top: 280px; } #s6b .l2 { top: 420px; }
#s6b .wd { animation: subir 0.6s var(--entra-rapido) ${s(T.contadores + 0.05)} both; }
#s6b .l2 .wd { animation-delay: ${s(T.contadores + 0.12)}; }
#s6b .num { color: var(--main); }
#s6b .n20 { width: 1.2em; animation: c20 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.contadores + 0.1)} both; }
#s6b .n825 { width: 1.85em; animation: c825 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.contadores + 0.1)} both; }
#s6b .n76 { width: 1.2em; animation: c76 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.contadores + 0.1)} both; }
@keyframes c20 { from { --n: 0; } to { --n: 20; } }
@keyframes c825 { from { --n: 0; } to { --n: 825; } }
@keyframes c76 { from { --n: 0; } to { --n: 76; } }
.pista { position: absolute; left: ${PX0}px; top: ${PY}px; width: ${PW}px; height: 16px; border-radius: 8px; background: rgba(250, 212, 231, 0.18); overflow: hidden; }
.pista .relleno { position: absolute; inset: 0; background: var(--main); transform-origin: 0 50%; }
#s6b .relleno { animation: llenar 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.contadores + 0.1)} both; }
@keyframes llenar { from { transform: scaleX(0); } to { transform: none; } }

/* ---------- 7 · música (match cut: la barra pasa a ser la pista de cortes) ---------- */
#s7 .t7 { position: absolute; left: 0; right: 0; top: 190px; text-align: center; font-size: 70px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
#s7 .t7 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.musica + 0.1)} + var(--i) * 0.05s) both; }
#s7 .relleno { animation: atenuar 0.5s ease-out ${s(T.musica)} both; }
@keyframes atenuar { from { opacity: 1; } to { opacity: 0.35; } }
#s7 .cabezal { position: absolute; left: ${PX0 - 3}px; top: 600px; width: 6px; height: 320px; border-radius: 3px; background: var(--ink);
  animation: recorrer ${s(T.P2 - T.musica)} linear ${s(T.musica)} both; }
@keyframes recorrer { from { transform: translateX(0); } to { transform: translateX(${PW}px); } }
#s7 .marca { position: absolute; top: 600px; width: 4px; height: 320px; background: var(--main); transform-origin: 50% 0;
  animation: caer-marca ${s(firme.duracion)} var(--firme) var(--t) both; }
@keyframes caer-marca { from { transform: scaleY(0); } to { transform: none; } }
#s7 .pico { position: absolute; top: 690px; width: 16px; height: 220px; border-radius: 8px; background: var(--main); box-shadow: 0 0 24px var(--main);
  animation: pico ${s(golpe.duracion)} var(--golpe) var(--t) both; }
@keyframes pico { from { transform: scaleY(0); } to { transform: none; } }
#s7 .barra { position: absolute; width: 12px; border-radius: 6px; background: rgba(250, 212, 231, 0.55);
  animation: crecer-barra 0.45s var(--entra-rapido) calc(${s(T.musica + 0.1)} + var(--i) * 0.012s) both, hinchar ${s(T.P2 - T.swell)} cubic-bezier(0.5, 0, 0.9, 0.6) ${s(T.swell)} forwards; }
@keyframes crecer-barra { from { transform: scaleY(0); } to { transform: none; } }
@keyframes hinchar { from { transform: scaleY(1); opacity: 1; } to { transform: scaleY(1.7); opacity: 1; } }

/* ---------- 8 · impacto (PRINCIPAL 2) ---------- */
#s8 .camara { animation: empuje ${s(T.mezcla - T.P2)} ease-in-out ${s(T.P2)} both, fuga 0.35s var(--sale-rapido) ${s(T.mezcla - 0.35)} forwards; }
#s8 .cero { font-size: 300px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; margin: 10px 0 20px; animation: impacto ${s(golpe.duracion)} var(--golpe) ${s(T.P2 - 0.25)} both; }
@keyframes impacto { from { transform: scale(1.9); opacity: 0; } to { transform: none; opacity: 1; } }
#s8 .l8 { font-size: 66px; font-weight: 600; }
#s8 .l8a .wd { animation: bajar 0.6s var(--entra-rapido) calc(${s(T.P2 + 0.3)} + var(--i) * 0.06s) both; }
#s8 .l8b .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.P2 + 0.35)} + (var(--i) - 4) * 0.06s) both; }
#s8 .anillo { position: absolute; left: 760px; top: 340px; width: 400px; height: 400px; border-radius: 50%; border: 10px solid var(--main); opacity: 0; }
#s8 .an1 { animation: anillo 1.1s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.P2)} forwards; }
#s8 .an2 { border-color: var(--accent); border-width: 6px; animation: anillo-fuera 1.2s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.pulso)} forwards; }
@keyframes anillo-fuera { from { transform: scale(2.4); opacity: 0.9; } to { transform: scale(4.6); opacity: 0; } }
@keyframes anillo { from { transform: scale(0.3); opacity: 1; } to { transform: scale(4); opacity: 0; } }
#s8 .chispas { position: absolute; left: 960px; top: 540px; }
#s8 .p { position: absolute; border-radius: 50%; opacity: 0; animation: chispa var(--d) cubic-bezier(0.22, 0.61, 0.36, 1) ${s(T.P2)} both; }
@keyframes chispa { from { transform: translate(0, 0) scale(0.2); opacity: 1; } to { transform: translate(var(--x), var(--y)) scale(1); opacity: 0; } }
#s8 .destello { animation: destello 0.5s ease-out ${s(T.P2)} forwards; }

/* ---------- 9a · mezcla: medidores ---------- */
#s9a .t9 { position: absolute; left: 160px; top: 390px; font-size: 84px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
#s9a .t9 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.mezcla - 0.12)} + var(--i) * 0.05s) both; }
#s9a .medidor { position: absolute; top: 220px; width: 100px; }
#s9a .m1 { left: 1300px; } #s9a .m2 { left: 1540px; }
#s9a .tubo { position: relative; width: 100px; height: 580px; border-radius: 18px; background: rgba(255, 255, 255, 0.07); border: 3px solid rgba(250, 212, 231, 0.3); overflow: visible; }
#s9a .nivel { position: absolute; left: 8px; right: 8px; bottom: 8px; border-radius: 10px; transform-origin: 50% 100%;
  animation: subir-nivel ${s(suave.duracion)} var(--suave) ${s(T.mezcla - 0.1)} both, vibrar 0.47s ease-in-out ${s(T.mezcla + 0.9)} 8 alternate forwards; }
#s9a .m1 .nivel { height: ${(0.65 * 564 - 8).toFixed(0)}px; background: var(--accent); }
#s9a .m2 .nivel { height: ${(0.9 * 564 - 8).toFixed(0)}px; background: var(--main); animation-delay: ${s(T.mezcla - 0.05)}, ${s(T.mezcla + 0.95)}; }
@keyframes subir-nivel { from { transform: scaleY(0); } to { transform: none; } }
@keyframes vibrar { from { transform: scaleY(1); } to { transform: scaleY(0.97); } }
#s9a .meta { position: absolute; left: -14px; width: 128px; height: 6px; border-radius: 3px; background: var(--ink); }
#s9a .m1 .meta { bottom: ${(0.65 * 564 - 3).toFixed(0)}px; } #s9a .m2 .meta { bottom: ${(0.975 * 564 - 3).toFixed(0)}px; }
#s9a .meta span { position: absolute; left: 138px; top: -26px; font-size: 40px; font-weight: 700; color: var(--ink); white-space: nowrap; }
#s9a .meta { animation: aparecer 0.3s linear ${s(T.mezcla - 0.1)} both; }
#s9a .destello { animation: destello9 0.35s ease-out ${s(T.mezcla)} forwards; }
@keyframes destello9 { from { opacity: 0.25; } to { opacity: 0; } }
#s9a .medidor p { margin-top: 18px; text-align: center; font-size: 36px; font-weight: 700; color: var(--accent); }

/* ola (mezcla → derechos): una banda con borde de onda cruza de abajo arriba */
#ola { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: var(--accent); transform: translateY(120%);
  animation: ola 0.6s linear ${s(T.derechos - 0.3)} both; }
#ola svg { position: absolute; left: 0; width: 1920px; height: 90px; }
#ola .arriba { top: -89px; } #ola .abajo { bottom: -89px; transform: scaleY(-1); }
#ola path { fill: var(--accent); }
@keyframes ola { 0% { transform: translateY(120%); animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1); } 100% { transform: translateY(-120%); } }

/* ---------- 9b · derechos: sello ---------- */
#s9b .sello { position: absolute; left: 360px; top: 340px; width: 400px; height: 400px; border-radius: 50%; border: 12px solid var(--main);
  animation: sellar 0.7s cubic-bezier(0.3, 0, 0.2, 1) ${s(T.derechos)} both; }
@keyframes sellar { 0% { transform: scale(1.6) rotate(-20deg); opacity: 0; } 55% { transform: scale(1.06, 0.92) rotate(-8deg); opacity: 1; }
  80% { transform: scale(0.98, 1.02) rotate(-6deg); opacity: 1; } 100% { transform: rotate(-6deg); opacity: 1; } }
#s9b .sello svg { position: absolute; left: 0; top: 0; width: 376px; height: 376px; }
#s9b .sello rect { fill: var(--accent); }
#s9b .anillo-int { position: absolute; inset: 22px; border-radius: 50%; border: 4px dashed rgba(250, 212, 231, 0.5);
  animation: rotar ${s(T.agente - T.derechos)} linear ${s(T.derechos)} both; }
@keyframes rotar { from { transform: rotate(0deg); } to { transform: rotate(40deg); } }
#s9b .t9b { position: absolute; left: 900px; top: 400px; font-size: 92px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
#s9b .t9b .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.derechos + 0.15)} + var(--i) * 0.06s) both; }

/* ---------- 10 · agente: dial de 28 minutos (match cut desde el sello) ---------- */
#s10 .dial { position: absolute; left: 340px; top: 320px; width: 440px; height: 440px; }
#s10 svg { position: absolute; inset: 0; overflow: visible; }
#s10 .pista-dial { fill: none; stroke: rgba(255, 255, 255, 0.12); stroke-width: 12; }
#s10 .arco { fill: none; stroke: var(--main); stroke-width: 12; stroke-linecap: round; stroke-dasharray: ${LD.toFixed(1)}; stroke-dashoffset: ${LD.toFixed(1)};
  animation: arco28 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.agente + 0.1)} both; }
@keyframes arco28 { from { stroke-dashoffset: ${LD.toFixed(1)}; } to { stroke-dashoffset: ${(LD * (1 - 28 / 60)).toFixed(1)}; } }
#s10 .ticks line { stroke: rgba(250, 212, 231, 0.6); stroke-width: 4; stroke-linecap: round; }
#s10 .giro { position: absolute; inset: 0; animation: rotar ${s(T.logo - T.agente)} linear ${s(T.agente)} both; }
#s10 .aguja { position: absolute; left: 216px; top: 34px; width: 8px; height: 62px; border-radius: 4px; background: var(--ink); transform-origin: 4px 186px;
  animation: aguja28 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.agente + 0.1)} both; }
@keyframes aguja28 { from { transform: rotate(0deg); } to { transform: rotate(168deg); } }
#s10 .lectura { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-top: 10px; }
#s10 .lectura .num { font-size: 120px; font-weight: 700; line-height: 1; width: 1.25em; text-align: center; animation: c28 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) ${s(T.agente + 0.1)} both; }
#s10 .lectura small { font-size: 40px; font-weight: 600; color: var(--accent); }
@keyframes c28 { from { --n: 0; } to { --n: 28; } }
#s10 .t10 { position: absolute; left: 900px; top: 330px; font-size: 80px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
#s10 .t10 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.agente + 0.15)} + var(--i) * 0.05s) both; }

/* ---------- 11 · logo: las piezas del inicio vuelven y se arman ---------- */
#s11 .logo { position: absolute; left: 0; right: 0; top: 340px; text-align: center; font-size: 220px; font-weight: 700; letter-spacing: 0.04em; line-height: 1.1; }
#s11 .logo .ch { animation: asentar ${s(suave.duracion)} var(--suave) calc(${s(T.logo - 0.15)} + var(--i) * 0.07s) both; }
@keyframes asentar { from { transform: translateY(70px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
#s11 .seg { position: absolute; top: ${SEG_Y}px; width: ${SEG_W}px; height: 12px; border-radius: 6px; background: var(--main);
  animation: armar ${s(suave.duracion)} var(--suave) var(--t) both; }
@keyframes armar { from { transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scaleX(var(--sx)); } to { transform: none; } }
#s11 .meta11 { position: absolute; left: 0; right: 0; top: 690px; text-align: center; font-size: 48px; font-weight: 600; color: var(--accent); }
#s11 .meta11 .wd { animation: subir 0.6s var(--entra-rapido) ${s(LOGO_QUIETO - 0.6)} both; }
</style>
</head>
<body>
<div id="raiz">
  <div id="fondo"></div>

  <section class="escena" id="s1" style="${ventana(0, T.problema)}">
    ${piezas1}
    <div class="camara"><div class="centro">
      <h1 class="titulo">${titulo.html}</h1>
      <div class="regla"></div>
      <p class="bajada">${pal("Videos de proyecto hechos con código")}</p>
    </div></div>
  </section>

  <section class="escena" id="s2" style="${ventana(T.problema, T.prueba)}">
    <div class="estela e2" aria-hidden="true"><div class="lienzo">${contenido2}</div></div>
    <div class="estela e1" aria-hidden="true"><div class="lienzo">${contenido2}</div></div>
    <div class="camara"><div class="lienzo">${contenido2}</div></div>
  </section>

  <section class="escena" id="s3" style="${ventana(T.prueba, T.decision)}">
    <div class="camara"><div class="empuja">
      <div class="panel izq"><div class="pantalla">${mini}</div><p class="rotulo">HyperFrames</p></div>
      <div class="igual"><i></i><i></i></div>
      <div class="panel der"><div class="pantalla">${mini}</div><p class="rotulo">Render nativo</p></div>
      <p class="t3">${pal("Probamos HyperFrames y un render nativo con el mismo HTML:")}</p>
      <p class="ssim"><span class="mask"><span class="wd">SSIM${NB}0,<span class="cnt"></span></span></span></p>
    </div></div>
  </section>

  <section class="escena" id="s4" style="${ventana(T.decision, T.P1)}">
    <div class="camara">
      <p class="l1"><span class="mask"><span class="wd w1">Video</span></span> <span class="mask"><span class="wd w2">y${NB}música</span></span></p>
      <p class="l2"><span class="w3">nativos,</span></p>
      <p class="l3">${pal("sin framework de video")}</p>
    </div>
  </section>

  <section class="escena" id="s5" style="${ventana(T.P1, T.render)}">
    <div class="vista"><div class="mundo">
      <div class="piso"></div><div class="piso2"></div>
      ${bloques}
      <svg class="conex" viewBox="0 0 1920 1080" width="1920" height="1080">${flechas}</svg>
      ${paquetes}
    </div></div>
    <p class="kicker k5"><span class="mask"><span class="wd">PIPELINE</span></span></p>
    <div class="destello"></div>
  </section>

  <section class="escena" id="s6a" style="${ventana(T.render, T.contadores)}">
    <div class="camara">
      <h2 class="t6">${pal("El MP4 sale idéntico", { marca: [3] })}<br>${pal("byte a byte en cada render", { inicio: 4 })}</h2>
      ${tarjetas}
      <div class="check"><svg viewBox="0 0 96 96" width="96" height="96"><path d="M28 50 L42 64 L70 34"/></svg></div>
    </div>
  </section>

  <section class="escena" id="s6b" style="${ventana(T.contadores, T.musica)}">
    <p class="l1"><span class="mask"><span class="wd"><b class="num n20"></b>${NB}s con <b class="num n825"></b> animaciones</span></span></p>
    <p class="l2"><span class="mask"><span class="wd">se renderizan en <b class="num n76"></b>${NB}s</span></span></p>
    <div class="pista"><div class="relleno"></div></div>
  </section>

  <section class="escena" id="s7" style="${ventana(T.musica, T.P2)}">
    <h2 class="t7">${pal("La música se compone a la medida:")}<br>${pal("cada corte tiene su golpe", { inicio: 6, marca: [4] })}</h2>
    ${barras}
    <div class="pista"><div class="relleno"></div></div>
    ${marcas}
    <div class="cabezal"></div>
  </section>

  <section class="escena" id="s8" style="${ventana(T.P2, T.mezcla)}">
    <div class="camara">
      <i class="anillo an1"></i><i class="anillo an2"></i>
      <div class="chispas">${chispas}</div>
      <div class="centro">
        <p class="l8 l8a">${pal("El impacto cae a")}</p>
        <div class="cero">0${NB}ms</div>
        <p class="l8 l8b">${pal("del corte principal", { inicio: 4 })}</p>
      </div>
    </div>
    <div class="destello"></div>
  </section>

  <section class="escena" id="s9a" style="${ventana(T.mezcla, T.derechos)}">
    <h2 class="t9">${pal(`Mezcla a −14${NB}LUFS,`, { marca: [2] })}<br>${pal(`con pico bajo −1${NB}dBTP`, { inicio: 3, marca: [3] })}</h2>
    <div class="medidor m1"><div class="tubo"><div class="nivel"></div><div class="meta"><span>−14</span></div></div><p>LUFS</p></div>
    <div class="medidor m2"><div class="tubo"><div class="nivel"></div><div class="meta"><span>−1</span></div></div><p>dBTP</p></div>
    <div class="destello"></div>
  </section>

  <section class="escena" id="s9b" style="${ventana(T.derechos, T.agente)}">
    <div class="sello"><div class="anillo-int"></div><svg viewBox="-188 -188 376 376">${ondaSello}</svg></div>
    <h2 class="t9b">${pal("Derechos del audio")}<br>${pal(`100${NB}% propios`, { inicio: 3, marca: [0] })}</h2>
  </section>

  <section class="escena" id="s10" style="${ventana(T.agente, T.logo)}">
    <div class="dial">
      <div class="giro"><svg viewBox="-220 -220 440 440" width="440" height="440"><g class="ticks">${ticksDial}</g></svg></div>
      <svg viewBox="-220 -220 440 440" width="440" height="440"><circle r="${RD}" class="pista-dial"/><g transform="rotate(-90)"><circle r="${RD}" class="arco"/></g></svg>
      <div class="aguja"></div>
      <div class="lectura"><b class="num"></b><small>min</small></div>
    </div>
    <h2 class="t10">${pal("Un agente nuevo hizo")}<br>${pal(`un video de 30${NB}s`, { inicio: 4, marca: [3] })}<br>${pal("en 28 minutos", { inicio: 8, marca: [1, 2] })}</h2>
  </section>

  <section class="escena" id="s11" style="${ventana(T.logo, DURACION + 1)}">
    <div class="logo">${logo.html}</div>
    ${segs11}
    <p class="meta11"><span class="mask"><span class="wd">video-with-ai</span></span></p>
  </section>

  <div id="cortina1" class="cortina"></div>
  <div id="mascara"></div>
  <div id="barrido"></div>
  <div id="ola"><svg class="arriba" viewBox="0 0 1920 90" preserveAspectRatio="none"><path d="M0 90 L0 50 Q120 0 240 50 T480 50 T720 50 T960 50 T1200 50 T1440 50 T1680 50 T1920 50 L1920 90 Z"/></svg>
    <svg class="abajo" viewBox="0 0 1920 90" preserveAspectRatio="none"><path d="M0 90 L0 50 Q120 0 240 50 T480 50 T720 50 T960 50 T1200 50 T1440 50 T1680 50 T1920 50 L1920 90 Z"/></svg></div>
  <div id="cortina2" class="cortina"></div>
</div>
</body>
</html>
`;
writeFileSync("escena.html", html);

const plan = escribirPlan("plan_cortes.json", [
  { t: T.bajada, nombre: "regla y bajada", peso: 0.3 },
  { t: T.problema, nombre: "cortina: apertura → problema", peso: 0.4 }, // menor: la intro sin bombo llega hasta el whip (menos graves bajo 50 Hz)
  { t: T.reloj, nombre: "reloj: primera vuelta", peso: 0.3 },
  { t: T.prueba, nombre: "whip pan: problema → prueba", peso: 0.6 },
  { t: T.decision, nombre: "máscara: prueba → decisión", peso: 0.6 },
  { t: T.nativos, nombre: "«nativos» aterriza", peso: 0.4 },
  { t: T.linea2, nombre: "segunda línea", peso: 0.3 },
  { t: T.P1, nombre: "PRINCIPAL 1: decisión → pipeline", peso: 1.0 },
  ...T.bloques.slice(1).map((t, k) => ({ t, nombre: `bloque ${NOMBRES[k + 1]}`, peso: 0.3 })),
  { t: T.asienta, nombre: "cámara se asienta: pipeline completo", peso: 0.6 },
  { t: T.enciende, nombre: "se enciende el bloque render", peso: 0.3 },
  { t: T.render, nombre: "zoom-through: pipeline → render", peso: 0.6 },
  { t: T.pila, nombre: "los MP4 se apilan", peso: 0.3 },
  { t: T.contadores, nombre: "barrido: render → contadores", peso: 0.6 },
  { t: T.musica, nombre: "match cut: barra → pista de cortes", peso: 0.6 },
  ...T.marcas.map((t, k) => ({ t, nombre: `marca de corte ${k + 1}`, peso: 0.3 })),
  { t: T.P2, nombre: "PRINCIPAL 2: impacto a 0 ms", peso: 1.0 },
  { t: T.pulso, nombre: "segundo pulso del anillo", peso: 0.3 },
  { t: T.mezcla, nombre: "fuga: impacto → mezcla", peso: 0.6 },
  { t: T.derechos, nombre: "ola: mezcla → derechos", peso: 0.6 },
  { t: T.agente, nombre: "match cut: sello → dial", peso: 0.6 },
  { t: T.logo, nombre: "cortina: agente → logo", peso: 0.6 },
], LOGO_QUIETO, { bpm_guion: BPM, duracion_s: DURACION });
console.log(lecturas.join("\n"));
console.log(avisos.length ? avisos.join("\n") : "lectura: todos los textos cumplen");
console.log(`escena.html (${(html.length / 1024).toFixed(0)} KB) y plan_cortes.json (${plan.cortes.length} cortes, final ${plan.final_s} s)`);
