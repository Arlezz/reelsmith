// escenas.mjs: arma el video desde un guion declarativo (guion.json) con un catálogo de escenas probadas.
// El agente escribe el guion (unas líneas por escena); este script escribe el HTML, el plan de cortes, el storyboard
// y el manifiesto de escenas que usan la vista rápida y la caché del render.
//
// Uso: node escenas.mjs guion.json [--salida carpeta]
// Escribe: escena.html, plan_cortes.json, escenas.json (segmentos y claves de caché), storyboard.md, y copia fuentes/.
//
// Tiempos: todo cae en la grilla del bpm del guion (medios compases) y en cuadros exactos de 30 fps. La duración de cada
// escena sale de la regla de lectura de sus textos; un corte principal cae en inicio de compás.
// Caché: cada escena se escribe con tiempos relativos a su inicio (--t0), así su clave no cambia si otra escena cambia
// de duración; solo cambia si cambia ella, la base (paleta, fuente) o una transición que toca su tramo.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FPS, azar, esc, letras, lectura, nPalabras, resorte } from "./utilidades.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const VERSION_CATALOGO = "2";
const PALETAS = {
  "cenia-oscura": { ground: "#090E50", main: "#E72887", ink: "#FFFFFF", accent: "#FAD4E7" },
  "cenia-clara": { ground: "#FFFFFF", main: "#090E50", ink: "#090E50", accent: "#E72887" },
  "gris-calido": { ground: "#EEECE8", main: "#111111", ink: "#111111", accent: "#E72887" },
  "petroleo": { ground: "#0C3B4A", main: "#F2B33D", ink: "#F3F6F8", accent: "#7FD1C7" },
  "papel-tecnico": { ground: "#F6F4EF", main: "#1F6F78", ink: "#1B1D24", accent: "#E0A43A" },
  "grafito-lima": { ground: "#1B1E23", main: "#B8E04A", ink: "#F2F3F5", accent: "#6EC1FF" },
};
const FUENTES = { Quicksand: "quicksand-latin-wght-normal.woff2", Inter: "inter-latin-wght-normal.woff2" };
const TIPOS = ["portada", "texto", "dato", "lista", "pasos", "montaje", "impacto", "cierre", "libre"];
const ENTRADAS = ["corte", "cortina", "mascara", "fuga", "destello"];
const C_ENTRA = "cubic-bezier(0.16, 1, 0.3, 1)", C_SALE = "cubic-bezier(0.55, 0, 1, 0.45)", C_SUAVE_IN = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const SUAVE = resorte({ zeta: 0.85, frecuencia: 1.8 });
const GOLPE = resorte({ zeta: 0.55, frecuencia: 2.4 });

// tiempo relativo al inicio de la escena (o de la transición): calc(var(--t0) + Xs)
const r = (x) => `calc(var(--t0) ${x < 0 ? "-" : "+"} ${Math.abs(Number(x.toFixed(4)))}s)`;
const d = (x) => `${Number(x.toFixed(4))}s`;
// luminancia (0 a 255, BT.709) de un color #rrggbb; sin color válido, gris medio
const lumaHex = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return 128;
  const n = parseInt(m[1], 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const hash = (...partes) => createHash("sha256").update(partes.join("\u0000")).digest("hex").slice(0, 20);
const tamTitular = (t) => (t.length <= 28 ? 104 : t.length <= 52 ? 88 : t.length <= 80 ? 76 : 64);
const palabrasMask = (texto) => texto.split(/\s+/).filter(Boolean)
  .map((w, k) => `<span class="mask"><span class="wd" style="--i:${k}">${esc(w)}</span></span>`).join(" ");

// ---------------------------------------------------------------- base común (paleta, fuente, keyframes)
function base(p, fuente) {
  return `@font-face { font-family: "${fuente}"; src: url("./fuentes/${FUENTES[fuente]}") format("woff2"); font-weight: 300 700; font-display: block; }
@property --n { syntax: "<integer>"; inherits: false; initial-value: 0; }
:root { --ground: ${p.ground}; --main: ${p.main}; --ink: ${p.ink}; --accent: ${p.accent}; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--ground); }
#raiz { position: relative; width: 1920px; height: 1080px; overflow: hidden; font-family: "${fuente}", sans-serif; color: var(--ink); background: var(--ground); }
.escena, .capa { position: absolute; inset: 0; visibility: hidden;
  animation: mostrar 1ms steps(1, jump-start) var(--entra) both, ocultar 1ms steps(1, jump-start) var(--sale) forwards; }
.camara { position: absolute; inset: 0; }
.centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 140px; }
.flujo { position: absolute; left: 160px; top: 150px; width: 1600px; display: flex; flex-direction: column; align-items: flex-start; gap: 30px; }
.ch, .wd { display: inline-block; }
.mask { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: 0.1em; margin-bottom: -0.1em; }
.kicker { font-size: 30px; font-weight: 700; letter-spacing: 0.22em; color: var(--main); text-transform: uppercase; }
.titular { font-weight: 700; letter-spacing: -0.02em; line-height: 1.12; }
.bajada { font-size: 44px; font-weight: 500; line-height: 1.3; color: var(--accent); }
.fuente-dato { position: absolute; left: 160px; bottom: 110px; font-size: 26px; font-weight: 600; letter-spacing: 0.06em; color: var(--accent);
  border: 3px solid var(--accent); border-radius: 999px; padding: 10px 26px; }
@keyframes mostrar { from { visibility: hidden; } to { visibility: visible; } }
@keyframes ocultar { from { visibility: visible; } to { visibility: hidden; } }
@keyframes subir { from { transform: translateY(110%); } to { transform: none; } }
@keyframes entrar-izq { from { transform: translateX(-40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes aparecer { from { opacity: 0; } to { opacity: 1; } }
@keyframes letra { from { transform: translateY(80px) scale(1.6); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes asentar { from { transform: translateY(70px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes aterrizar { from { transform: translateY(60px) scale(0.8); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes impacto { from { transform: scale(1.9); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes golpe-palabra { from { transform: translateY(40%) scaleX(1.5); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes regla { from { width: 0; } to { width: 520px; } }
@keyframes empuje { from { transform: scale(1); } to { transform: scale(1.04); } }
@keyframes fuga { from { transform: scale(1.04); opacity: 1; } to { transform: scale(2.4); opacity: 0; } }
@keyframes chispa { from { transform: translate(0, 0) scale(0.2); opacity: 1; } to { transform: translate(var(--x), var(--y)) scale(1); opacity: 0; } }
@keyframes dibujar { from { stroke-dashoffset: var(--largo); } to { stroke-dashoffset: 0; } }
@keyframes viajar { from { transform: translateX(0); opacity: 1; } 90% { opacity: 1; } to { transform: translateX(var(--dx)); opacity: 0; } }
@keyframes crecer { from { transform: scale(0); } to { transform: scale(12); } }
@keyframes destello { from { opacity: 0.6; } to { opacity: 0; } }
@keyframes cortina { 0% { clip-path: inset(0 100% 0 0); animation-timing-function: ${C_SALE}; }
  50% { clip-path: inset(0 0 0 0); animation-timing-function: ${C_ENTRA}; } 100% { clip-path: inset(0 0 0 100%); } }`;
}

// ---------------------------------------------------------------- catálogo: cada tipo devuelve html, css, golpes
// Todas las animaciones van relativas a --t0 (inicio de la escena). "pre" = el primer elemento entra 0,15 s antes del
// corte (con la escena aún oculta): en el cuadro del corte ya se ve algo y el corte se mide en su cuadro.
const PRE = -0.15;

function camara(id, durS, fugaAlSalir) {
  return `#${id} > .camara { transform-origin: 40% 45%; animation: empuje ${d(durS)} ease-in-out ${r(0)} both${fugaAlSalir
    ? `, fuga 0.35s ${C_SALE} ${r(durS - 0.35)} forwards` : ""}; }`;
}

const CATALOGO = {
  portada(e, id) {
    const t = letras(e.titulo);
    const tam = e.titulo.length <= 14 ? 150 : e.titulo.length <= 24 ? 120 : 92;
    return {
      lectura: [e.titulo, e.bajada].filter(Boolean).join(" "), extra: 0.9,
      html: `<div class="centro"><h1 class="titulo">${t.html}</h1><div class="regla"></div>${e.bajada ? `<p class="bajada">${palabrasMask(e.bajada)}</p>` : ""}</div>`,
      css: `#${id} .titulo { font-size: ${tam}px; font-weight: 700; letter-spacing: -0.03em; white-space: pre; }
#${id} .titulo .ch { animation: letra 0.5s ${SUAVE.easing} calc(${r(-0.3)} + var(--i) * 0.04s) both; }
#${id} .regla { width: 0; height: 10px; border-radius: 5px; background: var(--main); margin: 36px 0 30px; animation: regla 0.6s ${C_ENTRA} ${r(0.5)} both; }
#${id} .bajada .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(0.75)} + var(--i) * 0.08s) both; }`,
      golpes: [],
    };
  },
  texto(e, id) {
    const tam = tamTitular(e.titulo);
    const nT = nPalabras(e.titulo);
    return {
      lectura: [e.titulo, e.bajada].filter(Boolean).join(" "), extra: 1.0,
      html: `<div class="flujo">${e.kicker ? `<p class="kicker">${esc(e.kicker)}</p>` : ""}<h2 class="titular" style="font-size:${tam}px">${palabrasMask(e.titulo)}</h2>${
        e.bajada ? `<p class="bajada">${palabrasMask(e.bajada)}</p>` : ""}</div>${e.fuente ? `<p class="fuente-dato">${esc(e.fuente)}</p>` : ""}`,
      css: `#${id} .kicker { animation: entrar-izq 0.5s ${C_ENTRA} ${r(PRE)} both; }
#${id} .titular .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(PRE + 0.1)} + var(--i) * 0.07s) both; }
#${id} .bajada .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(0.35 + nT * 0.07)} + var(--i) * 0.06s) both; }
#${id} .fuente-dato { animation: aparecer 0.4s linear ${r(0.9)} both; }`,
      golpes: [],
    };
  },
  dato(e, id, ctx) {
    const v = e.valor;
    // la cifra termina de contar en una semicorchea de la grilla: ahí va su golpe
    const llega = ctx.grilla(1.3);
    const entero = typeof v === "number" && Number.isInteger(v);
    const numHtml = entero
      ? `<span class="num"></span>`
      : `<span class="num-fijo">${esc(String(v).replace(".", ","))}</span>`;
    return {
      lectura: [String(v), e.texto].filter(Boolean).join(" "), extra: 1.6,
      html: `<div class="flujo">${e.kicker ? `<p class="kicker">${esc(e.kicker)}</p>` : ""}<div class="cifra">${e.prefijo ? `<span class="pre">${esc(e.prefijo)}</span>` : ""}${numHtml}${
        e.unidad ? `<span class="uni">${esc(e.unidad)}</span>` : ""}</div>${e.texto ? `<p class="titular" style="font-size:${tamTitular(e.texto) - 16}px">${palabrasMask(e.texto)}</p>` : ""}</div>${
        e.fuente ? `<p class="fuente-dato">${esc(e.fuente)}</p>` : ""}`,
      css: `#${id} .kicker { animation: entrar-izq 0.5s ${C_ENTRA} ${r(PRE)} both; }
#${id} .cifra { font-size: 230px; font-weight: 700; line-height: 1; letter-spacing: -0.04em; color: var(--main); display: flex; align-items: baseline; gap: 18px;
  animation: aterrizar ${d(SUAVE.duracion)} ${SUAVE.easing} ${r(PRE)} both; }
#${id} .pre, #${id} .uni { font-size: 96px; color: var(--accent); }
#${id} .num { counter-reset: n var(--n); animation: cuenta-${id} ${d(llega - 0.1)} ${C_SUAVE_IN} ${r(0.1)} both; }
@keyframes cuenta-${id} { from { --n: 0; } to { --n: ${entero ? v : 0}; } }
#${id} .num::after { content: counter(n); }
#${id} .titular .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(0.6)} + var(--i) * 0.07s) both; }
#${id} .fuente-dato { animation: aparecer 0.4s linear ${r(1.2)} both; }`,
      golpes: [{ dt: llega, nombre: "la cifra llega", peso: 0.3 }],
    };
  },
  lista(e, id) {
    const items = e.items || [];
    const nT = nPalabras(e.titulo || "");
    const chips = items.map((it, k) => `<span class="chip" style="--k:${k}">${esc(it)}</span>`).join("");
    return {
      lectura: [e.titulo, ...items].filter(Boolean).join(" "), extra: 1.0 + 0.15 * items.length,
      html: `<div class="flujo">${e.kicker ? `<p class="kicker">${esc(e.kicker)}</p>` : ""}${e.titulo ? `<h2 class="titular" style="font-size:${tamTitular(e.titulo)}px">${palabrasMask(e.titulo)}</h2>` : ""}<div class="chips">${chips}</div></div>`,
      css: `#${id} .kicker { animation: entrar-izq 0.5s ${C_ENTRA} ${r(PRE)} both; }
#${id} .titular .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(PRE + 0.1)} + var(--i) * 0.07s) both; }
#${id} .chips { display: flex; flex-wrap: wrap; gap: 26px; margin-top: 30px; }
#${id} .chip { font-size: 44px; font-weight: 600; padding: 20px 40px; border-radius: 999px; border: 4px solid var(--accent);
  animation: aterrizar ${d(SUAVE.duracion)} ${SUAVE.easing} calc(${r(0.45 + nT * 0.07)} + var(--k) * 0.14s) both; }`,
      golpes: [],
    };
  },
  pasos(e, id, ctx) {
    const pasos = e.pasos || [];
    const n = Math.max(1, pasos.length);
    const ancho = Math.min(250, Math.floor((1600 - (n - 1) * 44) / n));
    const xs = pasos.map((_, k) => 160 + k * (ancho + 44));
    const y = 720;
    const x0 = xs[0] + ancho / 2, x1 = xs[n - 1] + ancho / 2, largo = Math.max(1, x1 - x0);
    const p = 60 / ctx.bpm;
    const nT = nPalabras(e.titulo || "");
    const t1 = ctx.grilla(0.5 + nT * 0.05);  // el primer nodo cae en la grilla; los demás, uno por tiempo
    const tNodo = (k) => t1 + k * p;
    const nodos = pasos.map((t, k) => `<div class="nodo${k === n - 1 ? " ultimo" : ""}" style="left:${xs[k]}px;--k:${k};width:${ancho}px">${esc(t)}</div>`).join("");
    const css = [`#${id} .kicker { animation: entrar-izq 0.5s ${C_ENTRA} ${r(PRE)} both; }`,
      `#${id} .titular .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(PRE + 0.1)} + var(--i) * 0.07s) both; }`,
      `#${id} .linea { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: visible; }`,
      `#${id} .linea path { fill: none; stroke: var(--main); stroke-width: 6; stroke-linecap: round; --largo: ${largo}; stroke-dasharray: ${largo}; stroke-dashoffset: ${largo};
  animation: dibujar ${d(Math.max(0.4, (n - 1) * p))} linear ${r(tNodo(0))} both; }`,
      `#${id} .nodo { position: absolute; top: ${y - 52}px; height: 104px; display: flex; align-items: center; justify-content: center; text-align: center;
  font-size: ${ancho < 200 ? 28 : 32}px; font-weight: 700; border-radius: 20px; background: var(--ink); color: var(--ground); padding: 0 12px;
  animation: aterrizar ${d(SUAVE.duracion)} ${SUAVE.easing} calc(${r(tNodo(0))} + var(--k) * ${d(p)}) both; }`,
      `#${id} .nodo.ultimo { background: var(--main); color: var(--ink); }`,
      `#${id} .pulso { position: absolute; left: ${x0 - 14}px; top: ${y - 14}px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 24px 6px var(--main); opacity: 0; --dx: ${largo}px; animation: viajar 1.4s ease-in-out ${r(tNodo(n - 1) + 0.4)} forwards; }`];  // forwards: con both, el from (opacidad 1) se ve antes de salir
    return {
      lectura: e.titulo || "", extra: 1.2 + n * p + 1.4,
      html: `<div class="flujo">${e.kicker ? `<p class="kicker">${esc(e.kicker)}</p>` : ""}${e.titulo ? `<h2 class="titular" style="font-size:${Math.min(88, tamTitular(e.titulo))}px">${palabrasMask(e.titulo)}</h2>` : ""}</div>
<svg class="linea" viewBox="0 0 1920 1080" aria-hidden="true"><path d="M ${x0} ${y} L ${x1} ${y}" /></svg>${nodos}<div class="pulso"></div>`,
      css: css.join("\n"),
      golpes: [{ dt: ctx.cuadroRel(tNodo(n - 1)), nombre: "último paso", peso: 0.3 }],
    };
  },
  montaje(e, id, ctx) {
    const pal = e.palabras || [];
    const p = 60 / ctx.bpm;
    const paso = 2 * p;
    // fondos alternados. Si sigue un impacto (fondo main), la última palabra va en el color que más contrasta con main:
    // con la última sobre main, el corte al impacto casi no se veía (salto de luminancia 2,4 de 255) y el juez del
    // audio quedaba al borde. El texto va en ground o ink, el que más contraste tenga con su fondo.
    // tres colores distintos de la paleta (si ink y main son el mismo, como en cenia-clara, entra ground)
    const nombres = [];
    for (const nom of ["accent", "ink", "main", "ground"]) {
      if (nombres.length < 3 && !nombres.some((x) => String(ctx.color(x)).toLowerCase() === String(ctx.color(nom)).toLowerCase())) nombres.push(nom);
    }
    const y = (nom) => ctx.luma(nom);
    let corr = 0;
    if (ctx.siguiente === "impacto" && pal.length) {
      const mejor = nombres.filter((x) => ctx.color(x) !== ctx.color("main"))
        .reduce((a, b) => (Math.abs(y(b) - y("main")) > Math.abs(y(a) - y("main")) ? b : a), nombres[0]);
      corr = (nombres.indexOf(mejor) - ((pal.length - 1) % nombres.length) + nombres.length) % nombres.length;
    }
    const fondoDe = (k) => nombres[(k + corr) % nombres.length];
    const tinta = (f) => (Math.abs(y("ground") - y(f)) >= Math.abs(y("ink") - y(f)) ? "ground" : "ink");
    const html = pal.map((w, k) => `<div class="pal" style="--k:${k};background:var(--${fondoDe(k)});color:var(--${tinta(fondoDe(k))})"><span class="in">${esc(w)}</span></div>`).join("");
    // cada palabra es visible solo en su golpe: su propia ventana relativa a la escena. Un hijo con visibility: visible
    // se ve aunque la sección esté oculta, así que la última palabra se oculta en el --sale de la escena (no "nunca").
    const css = [`#${id} .pal { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: ${pal.some((w) => w.length > 9) ? 200 : 260}px;
  font-weight: 700; letter-spacing: -0.04em; visibility: hidden; }`];
    pal.forEach((_, k) => {
      const a = k === 0 ? 0 : ctx.cuadroRel(k * paso);
      const fin = k === pal.length - 1 ? "var(--sale)" : r(ctx.cuadroRel((k + 1) * paso) - 0.0005);
      css.push(`#${id} .pal:nth-child(${k + 1}) { animation: mostrar 1ms steps(1, jump-start) ${r(a - 0.0005)} both, ocultar 1ms steps(1, jump-start) ${fin} forwards; }`);
      css.push(`#${id} .pal:nth-child(${k + 1}) .in { display: inline-block; animation: golpe-palabra 0.45s ${C_ENTRA} ${r(a + (k === 0 ? PRE : -0.05))} both; }`);
    });
    return {
      lectura: "", extra: 0, beats: 2 * pal.length, html, css: css.join("\n"), medio: ctx.cuadroRel(Math.floor(pal.length / 2) * paso) + 0.2,
      golpes: pal.slice(1).map((w, k) => ({ dt: ctx.cuadroRel((k + 1) * paso), nombre: `montaje: ${w}`, peso: 0.3 })),
    };
  },
  impacto(e, id, ctx) {
    const tSello = ctx.grilla(1.6);
    const rnd = azar(e.semilla || 7);
    let chispas = "";
    for (let k = 0; k < 60; k++) {
      const a = rnd() * Math.PI * 2, dist = 300 + rnd() * 800, tam = 4 + rnd() * 9;
      chispas += `<i class="p" style="--x:${(Math.cos(a) * dist).toFixed(1)}px;--y:${(Math.sin(a) * dist).toFixed(1)}px;--d:${(0.7 + rnd() * 0.6).toFixed(2)}s;width:${tam.toFixed(1)}px;height:${tam.toFixed(1)}px;background:${rnd() < 0.7 ? "var(--ink)" : "var(--accent)"}"></i>`;
    }
    const tam = e.titulo.length <= 12 ? 210 : e.titulo.length <= 20 ? 160 : 120;
    return {
      lectura: [e.titulo, e.bajada, e.sello].filter(Boolean).join(" "), extra: 1.2,
      html: `<div class="chispas">${chispas}</div><div class="centro"><div class="grande">${esc(e.titulo)}</div>${e.bajada ? `<p class="linea-baja">${palabrasMask(e.bajada)}</p>` : ""}</div>${
        e.sello ? `<div class="sello">${esc(e.sello)}</div>` : ""}`,
      css: `#${id} { background: var(--main); }
#${id} .grande { font-size: ${tam}px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; animation: impacto ${d(GOLPE.duracion)} ${GOLPE.easing} ${r(PRE)} both; }
#${id} .linea-baja { margin-top: 40px; font-size: 56px; font-weight: 600; color: var(--ground); }
#${id} .linea-baja .wd { animation: subir 0.6s ${C_ENTRA} calc(${r(0.35)} + var(--i) * 0.08s) both; }
#${id} .chispas { position: absolute; left: 960px; top: 540px; }
#${id} .p { position: absolute; border-radius: 50%; opacity: 0; animation: chispa var(--d) ${C_SUAVE_IN} ${r(0)} both; }
#${id} .sello { position: absolute; right: 160px; bottom: 140px; font-size: 46px; font-weight: 700; color: var(--ground); background: var(--ink);
  padding: 18px 36px; border-radius: 20px; animation: aterrizar ${d(SUAVE.duracion)} ${SUAVE.easing} ${r(tSello)} both; }`,
      golpes: e.sello ? [{ dt: tSello, nombre: "sello", peso: 0.3 }] : [],
    };
  },
  cierre(e, id) {
    const t = letras(e.logo || "CENIA");
    const asienta = PRE + t.n * 0.06 + SUAVE.duracion;
    return {
      lectura: e.linea || "", extra: 0, fijo: Math.max(3.5, lectura(e.linea || "")) + asienta + 0.5, asienta,
      html: `<div class="centro"><div class="logo">${t.html}</div><div class="regla"></div>${e.linea ? `<p class="meta">${esc(e.linea)}</p>` : ""}</div>`,
      css: `#${id} .logo { font-size: ${t.n <= 8 ? 220 : 150}px; font-weight: 700; letter-spacing: 0.04em; white-space: pre; }
#${id} .logo .ch { animation: asentar ${d(SUAVE.duracion)} ${SUAVE.easing} calc(${r(PRE)} + var(--i) * 0.06s) both; }
#${id} .regla { width: 0; height: 10px; border-radius: 5px; background: var(--main); margin: 30px 0 28px; animation: regla 0.5s ${C_ENTRA} ${r(asienta)} both; }
#${id} .meta { font-size: 38px; font-weight: 500; color: var(--accent); animation: aparecer 0.4s linear ${r(asienta + 0.2)} both; }`,
      golpes: [],
    };
  },
  libre(e, id) {
    // escena escrita a mano: html y css propios. Los tiempos se escriben relativos con calc(var(--t0) + Xs) y los
    // selectores van con #ID (se reemplaza por el id de la escena) para que no toquen otras escenas.
    return {
      lectura: e.lectura || "", extra: 0, fijo: e.segundos || 5,
      html: String(e.html || "").replaceAll("#ID", `#${id}`), css: String(e.css || "").replaceAll("#ID", `#${id}`),
      golpes: (e.golpes || []).map((g) => ({ dt: g.t, nombre: g.nombre || "golpe", peso: g.peso || 0.3 })),
    };
  },
};

// ---------------------------------------------------------------- transiciones (capa propia, relativa al corte)
function transicion(tipo, id, { salidaSobreMain = false } = {}) {
  // la cortina tiene que verse sobre la escena que sale: después de un impacto (fondo main) va en el color de la tinta.
  // Una cortina main sobre fondo main no se ve en el cuadro del corte y el cambio se mide un cuadro tarde.
  if (tipo === "cortina") return { desde: -0.3, hasta: 0.3, html: `<div class="capa" id="${id}"><div class="velo"></div></div>`,
    css: `#${id} .velo { position: absolute; inset: 0; background: var(${salidaSobreMain ? "--ink" : "--main"}); clip-path: inset(0 100% 0 0); animation: cortina 0.6s linear ${r(-0.3)} both; }` };
  if (tipo === "mascara") return { desde: -0.4, hasta: 0, html: `<div class="capa" id="${id}"><div class="circulo"></div></div>`,
    css: `#${id} .circulo { position: absolute; left: 860px; top: 440px; width: 200px; height: 200px; border-radius: 50%; background: var(--accent);
  animation: crecer 0.4s ${C_SALE} ${r(-0.4)} both; }` };
  if (tipo === "destello") return { desde: 0, hasta: 0.4, html: `<div class="capa" id="${id}"><div class="flash"></div></div>`,
    css: `#${id} .flash { position: absolute; inset: 0; background: #FFFFFF; opacity: 0; animation: destello 0.4s ease-out ${r(0)} forwards; }` };
  return null;  // corte y fuga no llevan capa (la fuga va en la cámara de la escena que sale)
}

// ---------------------------------------------------------------- escena libre: su CSS no puede tocar otras escenas
// Cada regla empieza con #ID. Los @keyframes de una escena libre son globales: no pueden pisar los de la base y entran en
// la clave de caché de todas las escenas.
function validarCssLibre(css, k, nombresBase) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const keyframes = [];
  let resto = "", i = 0;
  for (;;) {
    const m = s.slice(i).match(/@keyframes\s+([\w-]+)\s*\{/);
    if (!m) { resto += s.slice(i); break; }
    const ini = i + m.index;
    resto += s.slice(i, ini);
    let j = ini + m[0].length, prof = 1;
    while (j < s.length && prof > 0) { if (s[j] === "{") prof++; else if (s[j] === "}") prof--; j++; }
    if (nombresBase.has(m[1]) || m[1].startsWith("cuenta-")) throw new Error(`escena ${k + 1} (libre): @keyframes ${m[1]} ya existe en la base; usa otro nombre`);
    keyframes.push({ nombre: m[1], texto: s.slice(ini, j) });
    i = j;
  }
  for (const m of resto.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const sels = m[1].trim();
    if (sels.startsWith("@")) throw new Error(`escena ${k + 1} (libre): ${sels.split(/\s/)[0]} no se permite; solo reglas que empiezan con #ID y @keyframes`);
    for (const sel of sels.split(",")) {
      if (!/^#ID(?![\w-])/.test(sel.trim())) throw new Error(`escena ${k + 1} (libre): el selector "${sel.trim()}" debe empezar con #ID (si no, toca otras escenas y la caché queda vieja)`);
    }
  }
  if (/[{}]/.test(resto.replace(/([^{}]+)\{[^{}]*\}/g, ""))) throw new Error(`escena ${k + 1} (libre): llaves sin cerrar en el CSS`);
  return keyframes;
}

// ---------------------------------------------------------------- armado
export function construir(guion, { salida = ".", copiarFuentes = true } = {}) {
  const bpm = guion.bpm || 128;
  const p = 60 / bpm;
  const pal = typeof guion.paleta === "object" ? guion.paleta : PALETAS[guion.paleta || "cenia-oscura"];
  if (!pal) throw new Error(`paleta desconocida: ${guion.paleta}. Usa una de ${Object.keys(PALETAS).join(", ")} o {ground, main, ink, accent}`);
  const fuente = guion.fuente || "Quicksand";
  if (!FUENTES[fuente]) throw new Error(`fuente desconocida: ${fuente}. Usa ${Object.keys(FUENTES).join(" o ")}`);
  const escenas = guion.escenas || [];
  const avisos = [];
  if (!escenas.length) throw new Error("el guion no tiene escenas");
  escenas.forEach((e, k) => {
    if (!TIPOS.includes(e.tipo)) throw new Error(`escena ${k + 1}: tipo "${e.tipo}" no existe. Tipos: ${TIPOS.join(", ")}`);
    if (e.entrada && !ENTRADAS.includes(e.entrada)) throw new Error(`escena ${k + 1}: entrada "${e.entrada}" no existe. Entradas: ${ENTRADAS.join(", ")}`);
  });
  if (escenas[escenas.length - 1].tipo !== "cierre") avisos.push("la última escena no es un cierre: el video termina sin logo quieto");
  const cuadro = (t) => Math.round(t * FPS);
  // 1) duración de cada escena en tiempos (múltiplos de 2 = medio compás) desde la regla de lectura
  const piezas = escenas.map((e, k) => {
    const id = `e${k + 1}`;
    const cuadroRel = (t) => Math.round(t * FPS) / FPS;
    // grilla de semicorcheas relativa al inicio de la escena (que cae en un tiempo): los golpes internos van ahí
    const ctx = { bpm, cuadroRel, grilla: (t) => cuadroRel(Math.round(t / (p / 4)) * (p / 4)),
      siguiente: escenas[k + 1]?.tipo, luma: (nom) => lumaHex(pal[nom]), color: (nom) => pal[nom] };
    const pz = CATALOGO[e.tipo](e, id, ctx);
    let seg = pz.fijo ?? (0.6 + (pz.lectura ? lectura(pz.lectura) : 0) + pz.extra);
    let beats = pz.beats ?? Math.max(4, 2 * Math.ceil(seg / (2 * p) - 1e-9));
    if (e.compases) {
      const pedidos = Math.round(e.compases * 4);
      if (pedidos * p + 1e-9 < seg && e.tipo !== "montaje") avisos.push(`escena ${k + 1} (${e.tipo}): ${e.compases} compases dan ${(pedidos * p).toFixed(1)} s y su texto necesita ${seg.toFixed(1)} s (regla de lectura)`);
      beats = pedidos;
    }
    return { e, id, pz, beats, necesita_s: seg };
  });
  // 2) los principales caen en inicio de compás: se alarga la escena anterior lo justo
  // 3) tiempos en cuadros exactos; la última escena (cierre) dura lo que necesita, salvo que el guion fije sus compases
  const colocar = () => {
    let b = 0;
    piezas.forEach((pz) => { pz.extraPrincipal = 0; });
    piezas.forEach((pz, k) => {
      if (pz.e.principal && b % 4 !== 0 && k > 0) {
        const falta = 4 - (b % 4);
        piezas[k - 1].extraPrincipal = falta;
        b += falta;
      }
      pz.b0 = b;
      b += pz.beats;
    });
    piezas.forEach((pz, k) => {
      pz.f0 = cuadro(pz.b0 * p);
      pz.f1 = k + 1 < piezas.length ? cuadro(piezas[k + 1].b0 * p) : pz.f0 + cuadro(pz.e.compases ? pz.beats * p : (pz.pz.fijo ?? pz.beats * p));
    });
    return piezas[piezas.length - 1].f1 / FPS;
  };
  let durTotal = colocar();
  // 1b) duración pedida ("duracion" en el guion): lo que falta se reparte en medios compases entre las escenas que no
  //     fijaron sus compases (no el montaje ni el cierre), primero la de lectura más justa. Así el guion se escribe una vez.
  const objetivo = Number(guion.duracion) || null;
  if (objetivo) {
    const elegibles = piezas.filter((pz) => !pz.e.compases && !["montaje", "cierre", "libre"].includes(pz.e.tipo));
    // en cada paso, medio compás a la escena de lectura más justa cuyo alargue acerca el total al pedido (un principal
    // va en inicio de compás: antes de un principal, a veces medio compás solo se come el relleno y no cambia el total)
    for (let i = 0; i < 400 && elegibles.length && durTotal < objetivo - p / 2; i++) {
      const orden = [...elegibles].sort((x, y) => y.necesita_s / (y.beats * p) - x.necesita_s / (x.beats * p));
      let elegido = null;
      for (const pz of orden) {
        pz.beats += 2;
        const nuevo = colocar();
        if (Math.abs(nuevo - objetivo) < Math.abs(durTotal - objetivo) - 1e-6) { elegido = nuevo; break; }
        pz.beats -= 2;
      }
      if (elegido === null) { durTotal = colocar(); break; }
      durTotal = elegido;
    }
    if (durTotal > objetivo + 2 * p) avisos.push(`el guion pide ${objetivo} s y sus textos necesitan ${durTotal.toFixed(1)} s: quita una escena o acorta textos`);
  }
  const total = piezas[piezas.length - 1].f1;
  const durS = total / FPS;
  // 4) golpes (plan de cortes)
  const cortes = [];
  piezas.forEach((pz, k) => {
    const t0 = pz.f0 / FPS;
    if (k > 0) cortes.push({ t: t0, nombre: `${pz.id} ${pz.e.tipo}${pz.e.principal ? " (PRINCIPAL)" : ""}: entra con ${pz.e.entrada || "corte"}`, peso: pz.e.principal ? 1.0 : 0.6 });
    for (const g of pz.pz.golpes) if (g.dt < (pz.f1 - pz.f0) / FPS - 0.2) cortes.push({ t: Math.round((t0 + g.dt) * FPS) / FPS, nombre: `${pz.id} ${g.nombre}`, peso: g.peso });
    if (pz.e.principal && t0 < 2.3) avisos.push(`${pz.id}: el principal cae a ${t0.toFixed(2)} s; antes de 2,3 s no cabe el riser`);
  });
  // posición de los principales y entradas repetidas (avisos, no errores)
  const prin = piezas.filter((pz) => pz.e.principal);
  prin.forEach((pz, i) => {
    const pct = (100 * pz.f0) / total;
    const [lo, hi] = prin.length === 1 ? [35, 65] : i === 0 ? [25, 50] : i === prin.length - 1 ? [55, 75] : [25, 75];
    if (pct < lo - 0.5 || pct > hi + 0.5) avisos.push(`${pz.id}: el principal cae al ${pct.toFixed(0)} % del video; ${prin.length === 1 ? "el principal" : i === 0 ? "el primero" : "el último"} va entre el ${lo} y el ${hi} % (mueve escenas antes o después)`);
  });
  piezas.forEach((pz, k) => {
    const ent = pz.e.entrada || "corte";
    if (k > 1 && ent !== "corte" && ent === (piezas[k - 1].e.entrada || "corte")) avisos.push(`${pz.id}: entra con ${ent} igual que la anterior; varía la entrada`);
  });
  const ultima = piezas[piezas.length - 1];
  const finalS = ultima.pz.asienta !== undefined ? Math.round((ultima.f0 / FPS + ultima.pz.asienta) * FPS) / FPS : durS - 3.5;
  if (!piezas.some((pz) => pz.e.principal)) avisos.push("ninguna escena es principal: marca con \"principal\": true la escena donde cae la música (la de impacto, entre el 35 % y el 65 %)");
  // 5) HTML: base + escenas (relativas a --t0) + capas de transición; claves de caché por escena
  const css0 = base(pal, fuente);
  const nombresBase = new Set([...css0.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const kfLibres = [];
  escenas.forEach((e, k) => {
    if (e.tipo !== "libre") return;
    for (const kf of validarCssLibre(String(e.css || ""), k, nombresBase)) {
      if (kfLibres.some((x) => x.nombre === kf.nombre)) throw new Error(`escena ${k + 1} (libre): @keyframes ${kf.nombre} ya lo define otra escena libre`);
      kfLibres.push(kf);
    }
  });
  const globalLibres = kfLibres.map((x) => x.texto).join("\n");
  const fuentesHash = (() => {
    const dir = path.join(AQUI, "..", "assets", "plantilla", "fuentes");
    try { return hash(readFileSync(path.join(dir, FUENTES[fuente]))); } catch { return "sin-fuente"; }
  })();
  const capas = [];
  const partes = piezas.map((pz, k) => {
    const sigue = piezas[k + 1];
    const durEsc = (pz.f1 - pz.f0) / FPS;
    const cssEsc = `${camara(pz.id, durEsc, sigue && sigue.e.entrada === "fuga")}\n${pz.pz.css}`;
    const htmlEsc = `<div class="camara">${pz.pz.html}</div>`;
    const tr = k > 0 ? transicion(pz.e.entrada || "corte", `t${k + 1}`, { salidaSobreMain: piezas[k - 1].e.tipo === "impacto" }) : null;
    if (tr) capas.push({ ...tr, f: pz.f0, k });
    return { pz, cssEsc, htmlEsc };
  });
  // la capa de una transición toca el final de la escena anterior y el comienzo de la que entra
  const claves = partes.map(({ pz, cssEsc, htmlEsc }, k) => {
    const tocan = capas.filter((c) => c.k === k || c.k === k + 1).map((c) => `${c.k === k ? "entra" : "sale"}:${c.html}${c.css}`);
    const sigueFuga = piezas[k + 1] && piezas[k + 1].e.entrada === "fuga" ? "fuga" : "";
    return hash(VERSION_CATALOGO, css0, globalLibres, cssEsc, htmlEsc, ...tocan, sigueFuga, String(pz.f1 - pz.f0), fuentesHash);
  });
  const sec = (t) => `${Math.floor((t - 0.0005) * 1e4 + 1e-7) / 1e4}s`;  // igual que s() de utilidades: 0,5 ms antes del cuadro
  const htmlEscenas = partes.map(({ pz, htmlEsc }, k) => {
    const sale = k + 1 < partes.length ? sec(pz.f1 / FPS) : `${(durS + 10).toFixed(1)}s`;
    return `<section class="escena" id="${pz.id}" data-tipo="${pz.e.tipo}" style="--t0:calc(${pz.f0} * 1s / ${FPS});--entra:${sec(pz.f0 / FPS)};--sale:${sale}">${htmlEsc}</section>`;
  }).join("\n");
  const htmlCapas = capas.map((c) => c.html.replace('class="capa"', `class="capa" style="--t0:calc(${c.f} * 1s / ${FPS});--entra:${sec((c.f / FPS) + c.desde)};--sale:${sec((c.f / FPS) + c.hasta)}"`)).join("\n");
  const css = [css0, ...partes.map((x) => x.cssEsc), ...capas.map((c) => c.css)].join("\n");
  const html = `<!doctype html>
<html lang="es" data-duracion="${durS}">
<head>
<meta charset="utf-8">
<title>${esc(guion.titulo || "showreel")}</title>
<!-- Generado por escenas.mjs desde guion.json: no editar a mano. Catálogo v${VERSION_CATALOGO}. -->
<style>
${css}
</style>
</head>
<body>
<div id="raiz">
${htmlEscenas}
${htmlCapas}
</div>
</body>
</html>
`;
  // 6) archivos
  mkdirSync(salida, { recursive: true });
  writeFileSync(path.join(salida, "escena.html"), html);
  const plan = { cortes: cortes.sort((a, b2) => a.t - b2.t).map((c) => ({ ...c, t: Number(c.t.toFixed(4)) })), final_s: Number(finalS.toFixed(4)),
    duracion_s: durS, bpm_guion: bpm };
  writeFileSync(path.join(salida, "plan_cortes.json"), JSON.stringify(plan, null, 1));
  const manifiesto = { version_catalogo: VERSION_CATALOGO, html_sha: createHash("sha256").update(html).digest("hex").slice(0, 24),
    fps: FPS, cuadros: total, duracion_s: durS, bpm, final_s: plan.final_s,
    escenas: piezas.map((pz, k) => ({ id: pz.id, tipo: pz.e.tipo, cuadro_ini: pz.f0, cuadro_fin: pz.f1, clave: claves[k],
      // lo único que puede verse en los cuadros de esta escena: ella y las capas de transición que tocan su tramo.
      // El render oculta todo lo demás, así nada de otra escena se cuela en su caché.
      visibles: [pz.id, ...capas.filter((c) => c.k === k || c.k === k + 1).map((c) => `t${c.k + 1}`)],
      // cuadros de la vista: el corte, el medio (todo ya llegó: después del último golpe interno y antes de la salida)
      // y el último. Con el medio en 1,6 s fijos, un sello que aterriza a 1,64 s no se veía en ningún cuadro.
      revisar: (() => {
        const dur = (pz.f1 - pz.f0) / FPS;
        const ultimo = Math.max(0, ...pz.pz.golpes.map((g) => g.dt));
        const medio = pz.pz.medio ?? Math.min(dur - 0.6, Math.max(1.6, ultimo + 0.8, 0.45 * dur));
        return [pz.f0, Math.min(pz.f1 - 1, pz.f0 + Math.max(1, Math.round(medio * FPS))), pz.f1 - 1];
      })() })) };
  writeFileSync(path.join(salida, "escenas.json"), JSON.stringify(manifiesto, null, 1));
  const ct = (bb) => `${Math.floor(bb / 4) + 1}.${(bb % 4) + 1}`;
  const filas = piezas.map((pz) => {
    const txt = [pz.e.titulo, pz.e.bajada, pz.e.texto, pz.e.valor !== undefined ? [pz.e.prefijo, pz.e.valor, pz.e.unidad].filter((x) => x !== undefined && x !== "").join(" ") : null,
      (pz.e.items || pz.e.pasos || pz.e.palabras || []).join(" · "), pz.e.logo, pz.e.linea].filter(Boolean).join(" / ");
    const pw = nPalabras(pz.pz.lectura || "");
    const golpe = cortes.filter((c) => c.t >= pz.f0 / FPS - 1e-6 && c.t < pz.f1 / FPS - 1e-6).map((c) => c.peso.toFixed(1)).join(" ");
    return `| ${pz.id} | ${pz.e.tipo}${pz.e.principal ? " **principal**" : ""} | ${pz.e.entrada || (pz.f0 ? "corte" : "—")} | ${ct(pz.b0)} | ${(pz.f0 / FPS).toFixed(2)} | ${((pz.f1 - pz.f0) / FPS).toFixed(2)} | ${esc(txt).slice(0, 90)} | ${pw} | ${pz.pz.lectura ? lectura(pz.pz.lectura).toFixed(1) : "—"} | ${golpe || "—"} |`;
  });
  const sb = [`# Storyboard · ${durS.toFixed(2)} s · ${bpm} bpm · ${piezas.length} escenas`, "",
    "| # | Tipo | Entrada | Compás.tiempo | Inicio (s) | Dura (s) | Texto | Palabras | Lectura (s) | Golpes (peso) |", "|---|---|---|---|---|---|---|---|---|---|", ...filas, "",
    `Logo quieto desde ${plan.final_s} s (${(durS - plan.final_s).toFixed(1)} s quieto). Cortes: ${cortes.length}.`, ...(avisos.length ? ["", "Avisos:", ...avisos.map((a) => `- ${a}`)] : [])].join("\n");
  writeFileSync(path.join(salida, "storyboard.md"), sb + "\n");
  if (copiarFuentes) {
    const dst = path.join(salida, "fuentes");
    mkdirSync(dst, { recursive: true });
    const src = path.join(AQUI, "..", "assets", "plantilla", "fuentes", FUENTES[fuente]);
    if (existsSync(src) && !existsSync(path.join(dst, FUENTES[fuente]))) copyFileSync(src, path.join(dst, FUENTES[fuente]));
  }
  return { duracion_s: durS, escenas: piezas.length, cortes: cortes.length, avisos, storyboard: sb };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const archivo = args.find((a) => !a.startsWith("--")) || "guion.json";
  const i = args.indexOf("--salida");
  const salida = i >= 0 ? args[i + 1] : path.dirname(path.resolve(archivo));
  const t0 = Date.now();
  try {
    const res = construir(JSON.parse(readFileSync(archivo, "utf8")), { salida });
    console.log(res.storyboard);
    console.log(`\nlisto en ${Date.now() - t0} ms: escena.html, plan_cortes.json, escenas.json, storyboard.md (${res.duracion_s.toFixed(2)} s)`);
  } catch (err) {
    console.error(`error en el guion: ${err.message}`);
    process.exit(2);
  }
}
