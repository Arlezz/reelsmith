// comparar-md5.mjs: compara los md5 de una prueba completa con los de bench/referencia-md5.json (la máquina de prueba).
//
// Uso: node bench/comparar-md5.mjs <carpeta de reelsmith prueba> [--estricto]
//   Sin --estricto, solo informa: con otro Chromium, otro ffmpeg u otra arquitectura el video puede cambiar en píxeles
//   sueltos sin que sea un error. Con --estricto sale con 1 si alguno difiere (para un equipo igual al de referencia,
//   como el contenedor). En GitHub Actions deja una advertencia por cada archivo distinto.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [carpeta] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!carpeta) { console.error("uso: node bench/comparar-md5.mjs <carpeta de la prueba> [--estricto]"); process.exit(2); }
const ref = JSON.parse(readFileSync(path.join(AQUI, "referencia-md5.json"), "utf8"));
let distintos = 0;
for (const [archivo, esperado] of Object.entries(ref.md5)) {
  const f = path.join(carpeta, archivo);
  if (!existsSync(f)) { console.log(`FALTA     ${archivo}`); distintos++; continue; }
  const md5 = createHash("md5").update(readFileSync(f)).digest("hex");
  const igual = md5 === esperado;
  if (!igual) distintos++;
  console.log(`${igual ? "IGUAL    " : "DISTINTO "} ${archivo}${igual ? "" : `  (${md5}; referencia ${esperado})`}`);
  if (!igual && process.env.GITHUB_ACTIONS) console.log(`::warning title=md5 distinto::${archivo} no es idéntico al de la máquina de prueba`);
}
console.log(distintos ? `${distintos} de ${Object.keys(ref.md5).length} distintos de la referencia (${ref.equipo.sistema}, ${ref.equipo.navegador})`
  : "todos idénticos a la referencia");
process.exit(distintos && process.argv.includes("--estricto") ? 1 : 0);
