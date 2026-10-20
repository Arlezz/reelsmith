#!/usr/bin/env python3
"""Benchmark fijo del pipeline: corre los videos de referencia de punta a punta (parte de máquina) y guarda el desglose.

Uso:
  python3 benchmark.py --skill <carpeta de la skill> [--refs ref20,ref90] [--repeticiones 3] [--etiqueta linea-base]
                       [--golden <carpeta>] [--guardar-golden] [--render-extra "--trabajadores 2"] [--trabajo <carpeta>]

Por cada referencia (bench/referencias/<ref>/: escena.html o construir.mjs, plan_cortes.json, meta.json) y cada
repetición, en una carpeta limpia:
  construir → render (con hoja de contacto) → cortes → música → mezcla → jueces (check-audio por cada principal y
  medir_pista)
Mide cada etapa con el reloj de pared del benchmark y guarda además lo que cada script anotó en tiempos.jsonl
(por ejemplo, cuánto del render fue dibujar y cuánto esperar a ffmpeg).

Calidad: compara video-mudo.mp4 con el de referencia guardado (--golden): primero por md5; si difiere, SSIM promedio
y mínimo (ffmpeg ssim), una vez por referencia. check-audio debe dar PASA.

Resultados: bench/resultados/<AAAA-MM-DD_HHMM>_<etiqueta>.json y .md, con la mediana por etapa.

Comparación A/B (antes y después en la misma ventana de tiempo, porque la velocidad de la máquina cambia durante el día):
  python3 benchmark.py --variantes '[{"nombre": "base", "skill": "<skill vieja>", "modo": "etapas"},
                                     {"nombre": "nueva", "skill": "<skill nueva>", "modo": "final"}]' --repeticiones 3
  Las corridas se intercalan: repetición 1 de cada variante en cada referencia, luego la 2, etc.
  Modos: "etapas" (el pipeline paso a paso de la versión 0.1.0), "final" (showreel.mjs final: render ∥ audio y
  jueces en paralelo; las etapas se solapan y el total es el reloj de pared) y "render" (solo el render, para medir
  el render aislado).
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
ETAPAS = ["construir", "render", "cortes", "musica", "mezcla", "verificar_audio", "verificar_musica"]


def md5(ruta):
    h = hashlib.md5()
    with open(ruta, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def correr(cmd, cwd, env, log):
    t0 = time.time()
    p = subprocess.run(cmd, cwd=cwd, env=env, shell=True, capture_output=True, text=True)
    dt = time.time() - t0
    with open(log, "a") as f:
        f.write(f"$ {cmd}\n# {dt:.2f} s, código {p.returncode}\n{p.stdout[-4000:]}{p.stderr[-4000:]}\n")
    return dt, p


def ssim(a, b):
    p = subprocess.run(["ffmpeg", "-nostats", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]ssim=stats_file=-", "-f", "null", "-"],
                       capture_output=True, text=True)
    vals = [float(m) for m in re.findall(r"All:([0-9.]+)", p.stdout)]
    prom = re.search(r"SSIM .*All:([0-9.]+)", p.stderr)
    return {"ssim_promedio": float(prom.group(1)) if prom else (sum(vals) / len(vals) if vals else None),
            "ssim_minimo": min(vals) if vals else None, "cuadros": len(vals)}


def maquina():
    mem, cpu = 0, ""
    try:
        mem = int(open("/proc/meminfo").read().split("MemTotal:")[1].split("kB")[0]) // 1024
        cpu = [l for l in open("/proc/cpuinfo") if l.startswith("model name")][0].split(":")[1].strip()
    except Exception:
        try:  # macOS
            mem = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout) // 1048576
            cpu = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
        except Exception:
            pass
    ff = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.split("\n")[0]
    return {"sistema": platform.platform(), "cpus": os.cpu_count(), "memoria_mb": mem, "cpu": cpu, "ffmpeg": ff,
            "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
            "gpu": "VideoToolbox (macOS)" if "h264_videotoolbox" in subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
            else "ninguna detectada"}


def una_corrida(ref, skill, trabajo, i, extra, golden, guardar_golden, calidad_hecha, nombre=None):
    src = os.path.join(AQUI, "referencias", ref)
    meta = json.load(open(os.path.join(src, "meta.json")))
    w = os.path.join(trabajo, f"{nombre}-{ref}-{i}" if nombre else f"{ref}-{i}")
    shutil.rmtree(w, ignore_errors=True)
    shutil.copytree(src, w)
    env = dict(os.environ, SHOWREEL_TIEMPOS=os.path.join(w, "tiempos.jsonl"))
    log = os.path.join(w, "benchmark.log")
    S = os.path.join(skill, "scripts")
    t = {}
    dur = f"--duracion {meta['duracion_s']}" if "duracion_s" in meta else ""
    if os.path.exists(os.path.join(w, "construir.mjs")):
        t["construir"], p = correr("node construir.mjs", w, env, log)
    else:
        t["construir"] = 0.0
    t["render"], p = correr(f"node {S}/render-nativo.mjs escena.html video-mudo.mp4 --hoja hoja.png {dur} {extra}", w, env, log)
    if p.returncode:
        raise SystemExit(f"falló el render de {ref}: ver {log}")
    t["cortes"], p = correr(f"python3 -I {S}/medir_cortes.py video-mudo.mp4 --plan plan_cortes.json --salida cortes.json", w, env, log)
    t["musica"], p = correr(f"python3 {S}/componer.py cortes.json --estilo {meta['estilo']} --salida musica --video video-mudo.mp4", w, env, log)
    t["mezcla"], p = correr(f"python3 -I {S}/planificar_mezcla.py musica/variante.json", w, env, log)
    principales = [c["t"] for c in json.load(open(os.path.join(w, "cortes.json")))["cortes"] if c["peso"] >= 1.0]
    t["verificar_audio"], resultados_audio = 0.0, []
    for pr in principales:
        dt, p = correr(f"node {S}/check-audio.mjs musica/musica.mp4 --expect {pr} --marker musica/sfx-impacto.wav", w, env, log)
        t["verificar_audio"] += dt
        resultados_audio.append("PASA" if p.returncode == 0 else "FALLA")
    t["verificar_musica"], p = correr(f"python3 -I {S}/medir_pista.py musica/composicion.json --wav musica/stems/musica.wav", w, env, log)
    musica_res = "PASA" if p.returncode == 0 else "REVISAR"
    internos = [json.loads(l) for l in open(env["SHOWREEL_TIEMPOS"])] if os.path.exists(env["SHOWREEL_TIEMPOS"]) else []
    render_int = next((x["datos"] for x in internos if x["etapa"] == "render"), {})
    out = {"etapas_s": {k: round(v, 2) for k, v in t.items()}, "total_s": round(sum(t.values()), 2),
           "render_interno": render_int, "check_audio": resultados_audio, "medir_pista": musica_res,
           "md5_video_mudo": md5(os.path.join(w, "video-mudo.mp4")), "md5_mp4_final": md5(os.path.join(w, "musica", "musica.mp4"))}
    g = os.path.join(golden, ref) if golden else None
    if g and guardar_golden and i == 0:
        os.makedirs(g, exist_ok=True)
        shutil.copy(os.path.join(w, "video-mudo.mp4"), os.path.join(g, "video-mudo.mp4"))
        shutil.copy(os.path.join(w, "musica", "musica.mp4"), os.path.join(g, "musica.mp4"))
        json.dump({"md5_video_mudo": out["md5_video_mudo"], "md5_mp4_final": out["md5_mp4_final"]}, open(os.path.join(g, "md5.json"), "w"))
    if g and os.path.exists(os.path.join(g, "md5.json")):
        ref_md5 = json.load(open(os.path.join(g, "md5.json")))
        out["video_igual_al_golden"] = out["md5_video_mudo"] == ref_md5["md5_video_mudo"]
        out["final_igual_al_golden"] = out["md5_mp4_final"] == ref_md5["md5_mp4_final"]
        if not out["video_igual_al_golden"] and (nombre, ref) not in calidad_hecha:
            out["ssim_vs_golden"] = ssim(os.path.join(w, "video-mudo.mp4"), os.path.join(g, "video-mudo.mp4"))
            calidad_hecha.add((nombre, ref))
    return out


def preparar(ref, trabajo, nombre, i):
    src = os.path.join(AQUI, "referencias", ref)
    meta = json.load(open(os.path.join(src, "meta.json")))
    w = os.path.join(trabajo, f"{nombre}-{ref}-{i}")
    shutil.rmtree(w, ignore_errors=True)
    shutil.copytree(src, w)
    env = dict(os.environ, SHOWREEL_TIEMPOS=os.path.join(w, "tiempos.jsonl"))
    return meta, w, env, os.path.join(w, "benchmark.log")


def comparar_golden(out, ref, w, golden, clave_calidad, calidad_hecha, final_mp4):
    g = os.path.join(golden, ref) if golden else None
    if not (g and os.path.exists(os.path.join(g, "md5.json"))):
        return
    ref_md5 = json.load(open(os.path.join(g, "md5.json")))
    out["video_igual_al_golden"] = out["md5_video_mudo"] == ref_md5["md5_video_mudo"]
    out["final_igual_al_golden"] = final_mp4 is not None and out.get("md5_mp4_final") == ref_md5["md5_mp4_final"]
    if not out["video_igual_al_golden"] and clave_calidad not in calidad_hecha:
        out["ssim_vs_golden"] = ssim(os.path.join(w, "video-mudo.mp4"), os.path.join(g, "video-mudo.mp4"))
        calidad_hecha.add(clave_calidad)


def corrida_final(ref, skill, trabajo, nombre, i, extra, golden, calidad_hecha):
    """showreel.mjs final: el total es el reloj de pared; por etapa, lo que cada script anotó (se solapan)."""
    meta, w, env, log = preparar(ref, trabajo, nombre, i)
    S = os.path.join(skill, "scripts")
    t_constr = 0.0
    if os.path.exists(os.path.join(w, "construir.mjs")):
        t_constr, p = correr("node construir.mjs", w, env, log)
    elif os.path.exists(os.path.join(w, "guion.json")):
        t_constr, p = correr(f"node {S}/showreel.mjs construir", w, env, log)
    dur = f"--duracion {meta['duracion_s']}" if "duracion_s" in meta else ""
    dt, p = correr(f"node {S}/showreel.mjs final --estilo {meta['estilo']} {dur} {extra}", w, env, log)
    if not os.path.exists(os.path.join(w, "final.json")):
        raise SystemExit(f"falló showreel final en {ref}: ver {log}")
    fin = json.load(open(os.path.join(w, "final.json")))
    internos = [json.loads(l) for l in open(env["SHOWREEL_TIEMPOS"])] if os.path.exists(env["SHOWREEL_TIEMPOS"]) else []
    etapas = {"construir": round(t_constr, 2)}
    for x in internos:
        if x.get("tipo") == "maquina":
            etapas[x["etapa"]] = round(etapas.get(x["etapa"], 0.0) + x["s"], 2)
    final_mp4 = os.path.join(w, fin["mp4"])
    out = {"modo": "final", "etapas_s": etapas, "total_s": round(t_constr + dt, 2),
           "render_interno": next((x["datos"] for x in internos if x["etapa"] == "render"), {}),
           "check_audio": [c.split(": ")[-1] for c in fin["check_audio"]], "medir_pista": fin["medir_pista"],
           "recompuesto": fin.get("recompuesto"), "md5_video_mudo": md5(os.path.join(w, "video-mudo.mp4")), "md5_mp4_final": md5(final_mp4)}
    comparar_golden(out, ref, w, golden, (nombre, ref), calidad_hecha, final_mp4)
    return out


def corrida_render(ref, skill, trabajo, nombre, i, extra, golden, calidad_hecha):
    meta, w, env, log = preparar(ref, trabajo, nombre, i)
    S = os.path.join(skill, "scripts")
    t_constr = 0.0
    if os.path.exists(os.path.join(w, "construir.mjs")):
        t_constr, p = correr("node construir.mjs", w, env, log)
    dur = f"--duracion {meta['duracion_s']}" if "duracion_s" in meta else ""
    dt, p = correr(f"node {S}/render-nativo.mjs escena.html video-mudo.mp4 --hoja hoja.png {dur} {extra}", w, env, log)
    if p.returncode:
        raise SystemExit(f"falló el render de {ref}: ver {log}")
    internos = [json.loads(l) for l in open(env["SHOWREEL_TIEMPOS"])] if os.path.exists(env["SHOWREEL_TIEMPOS"]) else []
    out = {"modo": "render", "etapas_s": {"construir": round(t_constr, 2), "render": round(dt, 2)}, "total_s": round(dt, 2),
           "render_interno": next((x["datos"] for x in internos if x["etapa"] == "render"), {}),
           "check_audio": [], "medir_pista": "—", "md5_video_mudo": md5(os.path.join(w, "video-mudo.mp4"))}
    comparar_golden(out, ref, w, golden, (nombre, ref), calidad_hecha, None)
    return out


def ab(a):
    """Variantes intercaladas en la misma ventana de tiempo."""
    variantes = json.loads(a.variantes)
    res = {"fecha": datetime.now().isoformat(timespec="seconds"), "etiqueta": a.etiqueta, "maquina": maquina(),
           "variantes": variantes, "refs": {}}
    calidad_hecha = set()
    reps = {(v["nombre"], ref): [] for v in variantes for ref in a.refs.split(",")}
    for i in range(a.repeticiones):
        for ref in a.refs.split(","):
            for v in variantes:
                skill = os.path.abspath(v["skill"])
                extra = v.get("extra", "")
                if v["modo"] == "etapas":
                    r = una_corrida(ref, skill, a.trabajo, i, extra, a.golden, False, calidad_hecha, nombre=v["nombre"])
                    r["modo"] = "etapas"
                elif v["modo"] == "final":
                    r = corrida_final(ref, skill, a.trabajo, v["nombre"], i, extra, a.golden, calidad_hecha)
                else:
                    r = corrida_render(ref, skill, a.trabajo, v["nombre"], i, extra, a.golden, calidad_hecha)
                reps[(v["nombre"], ref)].append(r)
                print(f"[{v['nombre']}] {ref} #{i + 1}: total {r['total_s']} s · render {r['etapas_s'].get('render')} s · "
                      f"check-audio {r['check_audio']} · medir_pista {r['medir_pista']} · "
                      f"video={'golden' if r.get('video_igual_al_golden') else r['md5_video_mudo'][:8]}", flush=True)
    lineas = [f"# Benchmark A/B {a.etiqueta} · {res['fecha']}", "",
              f"Máquina: {res['maquina']['cpus']} CPU ({res['maquina']['cpu']}), {res['maquina']['memoria_mb']} MB, "
              f"{res['maquina']['ffmpeg']}, node {res['maquina']['node']}, GPU: {res['maquina']['gpu']}.",
              f"Mediana de {a.repeticiones} corridas por variante, intercaladas. "
              "En modo final las etapas se solapan (render ∥ audio): el total es el reloj de pared, no la suma.", ""]
    for ref in a.refs.split(","):
        res["refs"][ref] = {}
        etapas = []
        for v in variantes:
            for r in reps[(v["nombre"], ref)]:
                etapas += [k for k in r["etapas_s"] if k not in etapas]
        lineas += [f"## {ref}", "", "| Etapa | " + " | ".join(v["nombre"] + " (s)" for v in variantes) + " |",
                   "|---|" + "---|" * len(variantes)]
        for v in variantes:
            rs = reps[(v["nombre"], ref)]
            res["refs"][ref][v["nombre"]] = {"repeticiones": rs, "modo": v["modo"],
                                             "mediana_s": {k: mediana([r["etapas_s"].get(k, 0.0) for r in rs]) for k in etapas},
                                             "mediana_total_s": mediana([r["total_s"] for r in rs]),
                                             "totales_s": [r["total_s"] for r in rs],
                                             "deterministico": len({r["md5_video_mudo"] for r in rs}) == 1}
        for k in etapas:
            lineas.append(f"| {k} | " + " | ".join(str(res["refs"][ref][v["nombre"]]["mediana_s"][k]) for v in variantes) + " |")
        lineas.append("| **total (pared)** | " + " | ".join(f"**{res['refs'][ref][v['nombre']]['mediana_total_s']}**" for v in variantes) + " |")
        lineas.append("")
        for v in variantes:
            d = res["refs"][ref][v["nombre"]]
            rs = d["repeticiones"]
            ss = next((r["ssim_vs_golden"] for r in rs if "ssim_vs_golden" in r), None)
            lineas.append(f"- **{v['nombre']}** ({v['modo']}): totales {d['totales_s']} · determinista {d['deterministico']} · "
                          f"check-audio {[r['check_audio'] for r in rs]} · medir_pista {[r['medir_pista'] for r in rs]} · "
                          f"video = golden (md5) {[r.get('video_igual_al_golden') for r in rs]}"
                          + (f" · SSIM vs golden {ss['ssim_promedio']:.4f} (mín {ss['ssim_minimo']:.4f})" if ss else ""))
        if len(variantes) >= 2:
            t0, t1 = res["refs"][ref][variantes[0]["nombre"]]["mediana_total_s"], res["refs"][ref][variantes[-1]["nombre"]]["mediana_total_s"]
            if t0 and t1:
                lineas.append(f"- **{variantes[-1]['nombre']} vs {variantes[0]['nombre']}:** {t0} s → {t1} s ({t0 / t1:.2f}×, {100 * (t0 - t1) / t0:.0f} % menos)")
        lineas.append("")
    os.makedirs(os.path.join(AQUI, "resultados"), exist_ok=True)
    base = os.path.join(AQUI, "resultados", datetime.now().strftime("%Y-%m-%d_%H%M") + "_" + a.etiqueta)
    json.dump(res, open(base + ".json", "w"), indent=1, ensure_ascii=False)
    open(base + ".md", "w").write("\n".join(lineas))
    print("\n".join(lineas))
    print(f"guardado: {base}.json y .md")


def mediana(vals):
    return round(statistics.median(vals), 2) if vals else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill")
    ap.add_argument("--refs", default="ref20,ref90")
    ap.add_argument("--repeticiones", type=int, default=3)
    ap.add_argument("--etiqueta", default="corrida")
    ap.add_argument("--golden")
    ap.add_argument("--guardar-golden", action="store_true")
    ap.add_argument("--render-extra", default="")
    ap.add_argument("--trabajo", default="/tmp/bench-video-trabajo")
    ap.add_argument("--variantes", help='JSON: [{"nombre", "skill", "modo": "etapas|final|render", "extra"}]; intercala las corridas')
    a = ap.parse_args()
    if a.variantes:
        return ab(a)
    if not a.skill:
        ap.error("falta --skill (o --variantes)")
    skill = os.path.abspath(a.skill)
    res = {"fecha": datetime.now().isoformat(timespec="seconds"), "etiqueta": a.etiqueta, "skill": skill,
           "render_extra": a.render_extra, "maquina": maquina(), "refs": {}}
    calidad_hecha = set()
    for ref in a.refs.split(","):
        reps = []
        for i in range(a.repeticiones):
            r = una_corrida(ref, skill, a.trabajo, i, a.render_extra, a.golden, a.guardar_golden, calidad_hecha)
            reps.append(r)
            print(f"{ref} #{i + 1}: total {r['total_s']} s · render {r['etapas_s']['render']} s · check-audio {r['check_audio']} · "
                  f"medir_pista {r['medir_pista']} · video={'golden' if r.get('video_igual_al_golden') else r['md5_video_mudo'][:8]}", flush=True)
        med = {k: mediana([r["etapas_s"][k] for r in reps]) for k in ETAPAS}
        tot = mediana([r["total_s"] for r in reps])
        res["refs"][ref] = {"repeticiones": reps, "mediana_s": med, "mediana_total_s": tot,
                            "deterministico": len({r["md5_video_mudo"] for r in reps}) == 1}
    os.makedirs(os.path.join(AQUI, "resultados"), exist_ok=True)
    base = os.path.join(AQUI, "resultados", datetime.now().strftime("%Y-%m-%d_%H%M") + "_" + a.etiqueta)
    json.dump(res, open(base + ".json", "w"), indent=1, ensure_ascii=False)
    lineas = [f"# Benchmark {a.etiqueta} · {res['fecha']}", "", f"Máquina: {res['maquina']['cpus']} CPU ({res['maquina']['cpu']}), "
              f"{res['maquina']['memoria_mb']} MB, {res['maquina']['ffmpeg']}, node {res['maquina']['node']}, GPU: {res['maquina']['gpu']}.",
              f"Skill: `{skill}` · render extra: `{a.render_extra or '—'}` · mediana de {a.repeticiones} corridas.", ""]
    for ref, d in res["refs"].items():
        lineas += [f"## {ref}", "", "| Etapa | Mediana (s) | % |", "|---|---|---|"]
        for k in ETAPAS:
            v = d["mediana_s"][k]
            lineas.append(f"| {k} | {v} | {round(100 * v / d['mediana_total_s'], 1) if d['mediana_total_s'] else 0} |")
        r0 = d["repeticiones"][0]
        lineas += [f"| **total** | **{d['mediana_total_s']}** | 100 |", "",
                   f"Render por dentro (corrida 1): `{json.dumps(r0['render_interno'], ensure_ascii=False)}`", "",
                   f"Determinista entre repeticiones: {d['deterministico']} · check-audio: {[r['check_audio'] for r in d['repeticiones']]} · "
                   f"medir_pista: {[r['medir_pista'] for r in d['repeticiones']]}"]
        if "video_igual_al_golden" in r0:
            lineas.append(f"Video igual al golden (md5): {[r.get('video_igual_al_golden') for r in d['repeticiones']]} · "
                          f"SSIM: {next((r['ssim_vs_golden'] for r in d['repeticiones'] if 'ssim_vs_golden' in r), 'no hizo falta')}")
        lineas.append("")
    open(base + ".md", "w").write("\n".join(lineas))
    print("\n".join(lineas))
    print(f"guardado: {base}.json y .md")


if __name__ == "__main__":
    sys.exit(main())
