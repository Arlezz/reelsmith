// construir.mjs: escribe escena.html (solo HTML y CSS) y plan_cortes.json desde los mismos datos.
// Es un ejemplo completo y funcional de 17,5 s con la paleta CENIA oscura. Para un video nuevo, copia esta carpeta,
// cambia GUION y las escenas, y conserva el contrato (ver references/construccion-html.md).
//
//   node construir.mjs            → escena.html + plan_cortes.json
//   node <skill>/scripts/render-nativo.mjs escena.html video-mudo.mp4 --hoja hoja.png
import { writeFileSync } from "node:fs";
import { aCuadro, azar, escribirPlan, grilla, letras, palabras, resorte, s, ventana } from "./utilidades.mjs";

// ---------------------------------------------------------------- guion sobre la grilla
// La grilla es la del estilo musical elegido (corporativa 118-130 bpm). Los cortes caen en tiempos de esta grilla
// redondeados al cuadro; componer.py luego busca el tempo exacto que mejor los calza.
const BPM = 128;
const g = (compas, tiempo = 0) => grilla(BPM, compas, tiempo);
const T = {
  cortina1: g(2),        // apertura → pasos (cambio de sección)
  mascara: g(4),         // pasos → montaje (cambio de sección)
  mide: g(4, 2),         // montaje: segunda palabra (cambio menor)
  principal: g(5),       // la caída: todo cambia aquí
  derechos: g(6),        // dentro de la caída (cambio menor)
  salida: g(7),          // caída → logo (cambio de sección)
};
const DURACION = 17.5;
const LOGO_QUIETO = aCuadro(T.salida + 0.9); // cuando el logo termina de asentarse

const PALETA = { ground: "#090E50", main: "#E72887", ink: "#FFFFFF", accent: "#FAD4E7" }; // CENIA oscura
const suave = resorte({ zeta: 0.85, frecuencia: 1.8 });   // aterrizajes: sobrepaso mínimo
const golpe = resorte({ zeta: 0.55, frecuencia: 2.4 });   // solo para el impacto del corte principal

// ---------------------------------------------------------------- piezas generadas
const titulo = letras("video-with-ai");
const pasos = ["HTML y CSS", "render", "cortes", "música", "mezcla", "juez"];
const chips = pasos.map((p, k) => `<div class="chip" style="--t:${s(T.cortina1 + 0.9 + k * 0.12)}">${p}</div>`).join("");
const rnd = azar(7);
let chispas = "";
for (let k = 0; k < 70; k++) {
  const a = rnd() * Math.PI * 2, d = 300 + rnd() * 800, tam = 4 + rnd() * 9, col = rnd() < 0.7 ? "#FFFFFF" : PALETA.accent;
  chispas += `<i class="p" style="--x:${(Math.cos(a) * d).toFixed(1)}px;--y:${(Math.sin(a) * d).toFixed(1)}px;--d:${(0.7 + rnd() * 0.6).toFixed(2)}s;` +
    `width:${tam.toFixed(1)}px;height:${tam.toFixed(1)}px;background:${col}"></i>`;
}
const logo = letras("CENIA");

const html = `<!doctype html>
<html lang="es" data-duracion="${DURACION}">
<head>
<meta charset="utf-8">
<title>Ejemplo · reelsmith</title>
<!-- Generado por construir.mjs: no editar a mano. -->
<style>
@font-face { font-family: "Quicksand"; src: url("./fuentes/quicksand-latin-wght-normal.woff2") format("woff2"); font-weight: 300 700; font-display: block; }
:root {
  --ground: ${PALETA.ground}; --main: ${PALETA.main}; --ink: ${PALETA.ink}; --accent: ${PALETA.accent};
  --suave: ${suave.easing}; --golpe: ${golpe.easing};
  --sale-rapido: cubic-bezier(0.55, 0, 1, 0.45); --entra-rapido: cubic-bezier(0.16, 1, 0.3, 1);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--ground); }
#raiz { position: relative; width: 1920px; height: 1080px; overflow: hidden; font-family: Quicksand, sans-serif; color: var(--ink); background: var(--ground); }

/* contrato: cada escena es visible solo en su ventana (--entra, --sale), visible justo en el cuadro del corte */
.escena { position: absolute; inset: 0; visibility: hidden;
  animation: mostrar 1ms steps(1, jump-start) var(--entra) both, ocultar 1ms steps(1, jump-start) var(--sale) forwards; }
@keyframes mostrar { from { visibility: hidden; } to { visibility: visible; } }
@keyframes ocultar { from { visibility: visible; } to { visibility: hidden; } }
.centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ch, .wd { display: inline-block; }
.mask { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: 0.08em; }

/* ---------- A · apertura (0 → cortina 1) ---------- */
#a .titulo { font-size: 150px; font-weight: 700; letter-spacing: -0.03em; white-space: pre; }
/* la portada ya se ve en el cuadro 0: las primeras letras empiezan su entrada antes de 0 s (delay negativo) */
#a .titulo .ch { animation: letra 0.5s var(--suave) calc(-0.3s + var(--i) * 0.04s) both; }
@keyframes letra { from { transform: translateY(80px) scale(1.6); opacity: 0; } to { transform: none; opacity: 1; } }
#a .regla { width: 0; height: 10px; border-radius: 5px; background: var(--main); margin: 36px 0 30px; animation: regla 0.6s var(--entra-rapido) ${s(g(1) - 0.15)} both; }
@keyframes regla { to { width: 520px; } }
#a .bajada { font-size: 44px; font-weight: 500; color: var(--accent); }
#a .bajada .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(g(1) + 0.1)} + var(--i) * 0.08s) both; }
@keyframes subir { from { transform: translateY(110%); } to { transform: none; } }
#a .destello { position: absolute; inset: 0; background: var(--ink); opacity: 0; animation: destello 0.4s ease-out ${s(g(1))} forwards; } /* forwards: con both, el velo cubriría desde 0 s */
@keyframes destello { from { opacity: 0.35; } to { opacity: 0; } }
#a .camara { position: absolute; inset: 0; animation: empuje 3.8s ease-in-out 0s both; }
@keyframes empuje { from { transform: scale(1); } to { transform: scale(1.04); } }

/* cortina: cruza la pantalla y cubre justo en el corte (30 % antes, 70 % después) */
#cortina { position: absolute; inset: 0; background: var(--main); clip-path: inset(0 100% 0 0);
  animation: cortina 0.6s linear ${s(T.cortina1 - 0.3)} both; }
/* dentro de @keyframes, animation-timing-function no acepta var(): las curvas van literales */
@keyframes cortina { 0% { clip-path: inset(0 100% 0 0); animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
  50% { clip-path: inset(0 0 0 0); animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1); } 100% { clip-path: inset(0 0 0 100%); } }

/* ---------- B · pasos (cortina 1 → máscara) ---------- */
#b .kicker { position: absolute; left: 160px; top: 150px; font-size: 30px; font-weight: 700; letter-spacing: 0.22em; color: var(--main);
  animation: entrar-izq 0.5s var(--entra-rapido) ${s(T.cortina1 + 0.15)} both; }
#b h2 { position: absolute; left: 160px; top: 200px; font-size: 96px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
#b h2 .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.cortina1 + 0.25)} + var(--i) * 0.08s) both; }
@keyframes entrar-izq { from { transform: translateX(-40px); opacity: 0; } to { transform: none; opacity: 1; } }
#b .chips { position: absolute; left: 160px; top: 520px; display: flex; flex-wrap: wrap; gap: 28px; width: 1500px; }
#b .chip { font-size: 44px; font-weight: 600; padding: 22px 40px; border-radius: 999px; border: 4px solid var(--accent); color: var(--ink);
  animation: aterrizar ${s(suave.duracion)} var(--suave) var(--t) both; }
@keyframes aterrizar { from { transform: translateY(60px) scale(0.8); opacity: 0; } to { transform: none; opacity: 1; } }
#b .camara { position: absolute; inset: 0; transform-origin: 30% 40%; animation: empuje 3.8s ease-in-out ${s(T.cortina1)} both; }

/* máscara circular: un círculo navy crece desde el centro y la escena C aparece en el corte */
#mascara { position: absolute; left: 860px; top: 440px; width: 200px; height: 200px; border-radius: 50%; background: var(--accent);
  transform: scale(0); animation: crecer 0.4s var(--sale-rapido) ${s(T.mascara - 0.4)} both, ocultar 1ms steps(1, jump-start) ${s(T.mascara)} forwards; }
/* 12: el círculo cubre toda la pantalla justo en el cuadro del corte (en el anterior aún se ven las esquinas). Más grande
   cubriría un cuadro antes y el salto visual, que es lo que mide medir_cortes.py, quedaría adelantado. */
@keyframes crecer { to { transform: scale(12); } }

/* ---------- C · montaje (máscara → principal): una palabra por golpe, fondo que cambia en el corte ---------- */
#c { background: var(--accent); animation: mostrar 1ms steps(1, jump-start) var(--entra) both, ocultar 1ms steps(1, jump-start) var(--sale) forwards,
  fondo 1ms steps(1, jump-start) ${s(T.mide)} both; }
@keyframes fondo { from { background-color: var(--accent); } to { background-color: var(--ink); } }
#c .palabra { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 260px; font-weight: 700;
  letter-spacing: -0.04em; color: var(--ground); visibility: hidden; }
#c .p1 { --entra: ${s(T.mascara)}; --sale: ${s(T.mide)}; animation: mostrar 1ms steps(1, jump-start) var(--entra) both, ocultar 1ms steps(1, jump-start) var(--sale) forwards; }
#c .p2 { --entra: ${s(T.mide)}; --sale: ${s(T.principal)}; animation: mostrar 1ms steps(1, jump-start) var(--entra) both, ocultar 1ms steps(1, jump-start) var(--sale) forwards; }
#c .palabra .in { display: inline-block; animation: golpe-palabra 0.45s var(--entra-rapido) var(--entra) both; }
@keyframes golpe-palabra { from { transform: translateY(40%) scaleX(1.5); opacity: 0; } to { transform: none; opacity: 1; } }

/* ---------- D · caída (principal → salida) ---------- */
#d { background: var(--main); }
#d .grande { font-size: 210px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; animation: impacto ${s(golpe.duracion)} var(--golpe) ${s(T.principal)} both; }
@keyframes impacto { from { transform: scale(1.9); opacity: 0; } to { transform: none; opacity: 1; } }
#d .linea { margin-top: 40px; font-size: 56px; font-weight: 600; color: var(--ground); }
#d .linea .wd { animation: subir 0.6s var(--entra-rapido) calc(${s(T.principal + 0.35)} + var(--i) * 0.08s) both; }
#d .chispas { position: absolute; left: 960px; top: 540px; }
#d .p { position: absolute; border-radius: 50%; opacity: 0; animation: chispa var(--d) cubic-bezier(0.22, 0.61, 0.36, 1) ${s(T.principal)} both; }
@keyframes chispa { from { transform: translate(0, 0) scale(0.2); opacity: 1; } to { transform: translate(var(--x), var(--y)) scale(1); opacity: 0; } }
#d .sello { position: absolute; right: 160px; bottom: 140px; font-size: 48px; font-weight: 700; color: var(--ground); background: var(--ink);
  padding: 18px 36px; border-radius: 20px; animation: aterrizar ${s(suave.duracion)} var(--suave) ${s(T.derechos)} both; }
#d .camara { position: absolute; inset: 0; animation: empuje 3.8s ease-in-out ${s(T.principal)} both, fuga 0.35s var(--sale-rapido) ${s(T.salida - 0.35)} forwards; }
@keyframes fuga { from { transform: scale(1.04); opacity: 1; } to { transform: scale(2.4); opacity: 0; } }

/* ---------- E · logo (salida → final) ---------- */
#e .logo { font-size: 220px; font-weight: 700; letter-spacing: 0.04em; }
/* el logo empieza a entrar 0,15 s antes del corte (con la escena aún oculta): en el cuadro del corte ya se ve algo */
#e .logo .ch { animation: asentar ${s(suave.duracion)} var(--suave) calc(${s(T.salida - 0.15)} + var(--i) * 0.06s) both; }
@keyframes asentar { from { transform: translateY(70px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
#e .regla { width: 0; height: 10px; border-radius: 5px; background: var(--main); margin: 30px 0 28px; animation: regla 0.5s var(--entra-rapido) ${s(LOGO_QUIETO)} both; }
#e .meta { font-size: 38px; font-weight: 500; color: var(--accent); opacity: 0; animation: aparecer 0.4s linear ${s(LOGO_QUIETO + 0.2)} both; }
@keyframes aparecer { to { opacity: 1; } }
</style>
</head>
<body>
<div id="raiz">
  <section class="escena" id="a" style="${ventana(0, T.cortina1)}">
    <div class="camara"><div class="centro">
      <h1 class="titulo">${titulo.html}</h1>
      <div class="regla"></div>
      <p class="bajada">${palabras("Videos de proyecto hechos con código")}</p>
    </div></div>
    <div class="destello"></div>
  </section>

  <section class="escena" id="b" style="${ventana(T.cortina1, T.mascara)}">
    <div class="camara">
      <p class="kicker">PIPELINE</p>
      <h2>${palabras("Seis pasos, un solo comando")}</h2>
      <div class="chips">${chips}</div>
    </div>
  </section>

  <section class="escena" id="c" style="${ventana(T.mascara, T.principal)}">
    <div class="palabra p1"><span class="in">COMPONE</span></div>
    <div class="palabra p2"><span class="in">MIDE</span></div>
  </section>

  <section class="escena" id="d" style="${ventana(T.principal, T.salida)}">
    <div class="camara">
      <div class="chispas">${chispas}</div>
      <div class="centro">
        <div class="grande">VIDEO + MÚSICA</div>
        <p class="linea">${palabras("desde el mismo código")}</p>
      </div>
      <div class="sello">Derechos 100 % propios</div>
    </div>
  </section>

  <section class="escena" id="e" style="${ventana(T.salida, DURACION + 1)}">
    <div class="centro">
      <div class="logo">${logo.html}</div>
      <div class="regla"></div>
      <p class="meta">video-with-ai · showreel nativo</p>
    </div>
  </section>

  <div id="cortina"></div>
  <div id="mascara"></div>
</div>
</body>
</html>
`;
writeFileSync("escena.html", html);
const plan = escribirPlan("plan_cortes.json", [
  { t: g(1), nombre: "destello del título", peso: 0.3 },
  { t: T.cortina1, nombre: "cortina: apertura → pasos", peso: 0.6 },
  { t: T.mascara, nombre: "máscara: pasos → montaje", peso: 0.6 },
  { t: T.mide, nombre: "montaje: COMPONE → MIDE", peso: 0.3 },
  { t: T.principal, nombre: "CORTE PRINCIPAL: montaje → caída", peso: 1.0 },
  { t: T.derechos, nombre: "sello de derechos", peso: 0.3 },
  { t: T.salida, nombre: "salida: caída → logo", peso: 0.6 },
], LOGO_QUIETO, { bpm_guion: BPM, duracion_s: DURACION });
console.log(`escena.html (${(html.length / 1024).toFixed(0)} KB) y plan_cortes.json (${plan.cortes.length} cortes, final ${plan.final_s} s)`);
