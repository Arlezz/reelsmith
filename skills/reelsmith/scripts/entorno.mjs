// entorno.mjs: lo que cambia entre Linux, macOS y Windows al llamar a Python, a Node y a ffmpeg desde los scripts.
//
//   python(): el intérprete de Python. REELSMITH_PYTHON manda (una ruta). Si no está, usa el entorno aislado que crean
//     bench/medir-windows.ps1 (%LOCALAPPDATA%\reelsmith\venv) y bench/medir-mac-completo.sh
//     (~/.cache/reelsmith/venv), si existe; si no, prueba python3 y python (Linux y macOS) o python y py -3
//     (Windows: "python3" no existe ahí y "python" puede ser el acceso directo de la Microsoft Store, que no corre nada).
//     Necesita 3.11 o más.
//   pythonArgs(): opciones que van antes del script: -X utf8, para que Python lea y escriba UTF-8 aunque la consola de
//     Windows use otra página de códigos (con -I, PYTHONUTF8 no se respeta; -X utf8 sí).
//   NODE: el mismo Node que corre este script, para no tomar otra versión del PATH.
//   md5(archivo): suma md5 del archivo (macOS no trae md5sum y Windows tampoco).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const NODE = process.execPath;

let elegido = null;
// el entorno aislado de la skill (lo crean bench/medir-windows.ps1 y bench/medir-mac-completo.sh, o se crea a mano)
export const VENV = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "reelsmith", "venv")
  : path.join(os.homedir(), ".cache", "reelsmith", "venv");

// el primer intérprete que sirva, o null (python() corta el programa si no hay; doctor solo informa)
export function buscarPython() {
  if (elegido) return elegido;
  const venv = process.platform === "win32"
    ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python3");
  const candidatos = process.env.REELSMITH_PYTHON ? [[process.env.REELSMITH_PYTHON]]
    : [...(existsSync(venv) ? [[venv]] : []), ...(process.platform === "win32" ? [["python"], ["py", "-3"]] : [["python3"], ["python"]])];
  for (const [cmd, ...pre] of candidatos) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 3)"], { encoding: "utf8" });
    if (r.status === 0) return (elegido = { cmd, pre });
  }
  buscarPython.probados = candidatos.map((c) => c.join(" "));
  return null;
}

export function python() {
  const p = buscarPython();
  if (p) return p;
  console.error(`no encontré Python 3.11 o más (probé: ${buscarPython.probados.join(", ")}). ` +
    "Corre `reelsmith doctor`: dice cómo instalarlo. También puedes definir REELSMITH_PYTHON con la ruta del intérprete.");
  process.exit(2);
}

export const pythonArgs = (...args) => [...python().pre, "-X", "utf8", ...args];

// variables para los procesos de Python que no usan -I
export const ENV_PYTHON = { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

export const md5 = (archivo) => createHash("md5").update(readFileSync(archivo)).digest("hex");
