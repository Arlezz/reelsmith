#!/usr/bin/env python3
"""Mide los cortes y transiciones de un video ya renderizado y los cruza con los del storyboard.

Uso: python3 -I medir_cortes.py video.mp4 [--plan plan_cortes.json] [--salida cortes.json]

plan_cortes.json (lo escribe quien arma el storyboard):
  {"cortes": [{"t": 9.5667, "nombre": "corte principal", "peso": 1.0}, ...], "final_s": 17.5}
  peso: 1,0 = corte principal (lleva caída de la música e impacto); 0,6 = cambio de sección (whoosh);
        0,3-0,4 = cambio menor (acento suave). final_s: cuando se asienta el logo o la frase final (opcional).

Qué mide (ffmpeg, por cuadro):
  - scdet (puntaje de cambio de escena), salto de luminancia media y pico aislado de mafd: cortes duros (puntaje > 6,
    salto > 20 niveles, o puntaje > 3 con un mafd que triplica el del cuadro siguiente, típico de un cambio de fondo).
  - mafd (diferencia media absoluta entre cuadros): transiciones suaves; se marca el primer cuadro quieto
    tras una ráfaga de movimiento (así se detectó la salida hacia el logo en la prueba, que no es un corte duro).
  - asentamiento final: primer instante, en el último 40 % del video, desde el que el cuadro queda casi quieto
    (mafd < 0,3) por al menos 0,5 s.
Salida: cortes.json con los cortes del plan reemplazados por su instante medido (el cuadro detectado más cercano, a
+-3 cuadros para secciones y principales, a +-1 para cambios menores) y la deriva plan → medido; los que no se detectan
quedan con su instante planificado y "detectado": false. Una cortina que cubre la pantalla justo en el corte se registra
como "transicion" (no hay salto entre dos cuadros): es lo esperado.
Sin plan, entrega los candidatos con un peso sugerido para que el agente los nombre y pondere.
"""

import time

T_INICIO = time.time()  # reloj desde el arranque del proceso (tiempos.jsonl)
import argparse  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402

for _flujo in (sys.stdout, sys.stderr):  # Windows: la consola y las tuberías no son UTF-8 por defecto
    if hasattr(_flujo, "reconfigure"):
        _flujo.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiempos  # noqa: E402


def _parsear(out):
    frames, cur = [], None
    for linea in out.splitlines():
        if linea.startswith("frame:"):
            if cur:
                frames.append(cur)
            cur = {"t": float(linea.split("pts_time:")[1]), "score": 0.0, "mafd": 0.0, "y": 0.0}
        elif "lavfi.scd.score=" in linea:
            cur["score"] = float(linea.split("=")[1])
        elif "lavfi.scd.mafd=" in linea:
            cur["mafd"] = float(linea.split("=")[1])
        elif "lavfi.signalstats.YAVG=" in linea:
            cur["y"] = float(linea.split("=")[1])
    if cur:
        frames.append(cur)
    return frames


def medir(video):
    """Métricas por cuadro: puntaje de escena y mafd (scdet) y luminancia media.

    La luminancia media es la misma que imprime signalstats (YAVG = suma de Y / píxeles, con formato %g), pero se
    calcula aquí sobre el plano Y crudo (extractplanes): signalstats calcula además croma, saturación y tono, y se
    llevaba 57 de los 66 s en un video de 90 s. Verificado cuadro a cuadro contra signalstats en los videos de
    referencia: valores idénticos."""
    import tempfile

    import numpy as np

    p = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=r_frame_rate,width,height:format=duration",
            "-of",
            "json",
            video,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(p.stdout)
    st = info["streams"][0]
    num, den = map(int, st["r_frame_rate"].split("/"))
    fps = num / den
    dur = float(info["format"]["duration"])
    w, h = int(st["width"]), int(st["height"])
    with tempfile.TemporaryDirectory() as td:
        meta = os.path.join(td, "meta.txt")
        # el archivo va con ruta relativa (ffmpeg corre en la carpeta temporal): una ruta de Windows (C:\...) dentro del
        # grafo de filtros rompe su sintaxis por los dos puntos y las barras invertidas
        pr = subprocess.Popen(
            [
                "ffmpeg",
                "-nostats",
                "-v",
                "error",
                "-i",
                os.path.abspath(video),
                "-filter_complex",
                "[0:v]scdet=threshold=3,metadata=print:file=meta.txt,extractplanes=y[y]",
                "-map",
                "[y]",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "gray",
                "-",
            ],
            stdout=subprocess.PIPE,
            cwd=td,
        )
        ys = []
        n = w * h
        while True:
            buf = pr.stdout.read(n)
            if len(buf) < n:
                break
            ys.append(float(f"{int(np.frombuffer(buf, dtype=np.uint8).sum(dtype=np.int64)) / n:g}"))
        if pr.wait():
            raise RuntimeError("ffmpeg falló al medir los cortes")
        frames, cur = [], None
        for linea in open(meta, encoding="utf-8", errors="replace"):
            if linea.startswith("frame:"):
                if cur:
                    frames.append(cur)
                cur = {"t": float(linea.split("pts_time:")[1]), "score": 0.0, "mafd": 0.0, "y": 0.0}
            elif "lavfi.scd.score=" in linea:
                cur["score"] = float(linea.split("=")[1])
            elif "lavfi.scd.mafd=" in linea:
                cur["mafd"] = float(linea.split("=")[1])
        if cur:
            frames.append(cur)
    if len(frames) != len(ys):
        raise RuntimeError(f"cuadros medidos distintos: {len(frames)} con scdet, {len(ys)} con luminancia")
    for f, y in zip(frames, ys, strict=False):
        f["y"] = y
    return fps, dur, frames


def candidatos(fps, frames):
    c = []
    for i, f in enumerate(frames):
        salto = abs(f["y"] - frames[i - 1]["y"]) if i else 0
        # corte duro: puntaje de escena alto o salto de luminancia media de más de 20 niveles en un cuadro
        # (un cambio de fondo rosa → blanco tiene puntaje bajo pero salta ~90 niveles)
        pico = (
            0 < i < len(frames) - 1
            and f["score"] > 3
            and f["mafd"] >= 1.8 * frames[i - 1]["mafd"]
            and f["mafd"] >= 3 * frames[i + 1]["mafd"]
        )  # cambio de fondo: pico aislado de mafd en un cuadro
        if f["score"] > 6 or salto > 20 or pico:
            peso = 0.6 if f["score"] > 30 else 0.3
            c.append(
                {
                    "t": round(f["t"], 4),
                    "frame": i,
                    "tipo": "corte",
                    "score": round(f["score"], 1),
                    "salto_luma": round(salto, 1),
                    "peso_sugerido": peso,
                }
            )
    # transiciones suaves: ráfaga de movimiento (>= 4 cuadros con mafd > 2) seguida de un cuadro quieto
    i = 0
    n = len(frames)
    while i < n:
        if frames[i]["mafd"] > 2:
            j = i
            while j < n and frames[j]["mafd"] > 0.5:
                j += 1
            if j - i >= 4 and j < n and not any(abs(x["frame"] - j) <= 3 for x in c):
                c.append(
                    {
                        "t": round(frames[j]["t"], 4),
                        "frame": j,
                        "tipo": "transicion",
                        "score": round(max(f["score"] for f in frames[i:j]), 1),
                        "salto_luma": 0.0,
                        "peso_sugerido": 0.4,
                    }
                )
            i = j + 1
        else:
            i += 1
    return sorted(c, key=lambda x: x["t"])


def asentamiento(fps, dur, frames):
    k = int(0.5 * fps)
    for i in range(int(0.6 * len(frames)), len(frames) - k):
        if all(f["mafd"] < 0.3 for f in frames[i : i + k]) and frames[i - 1]["mafd"] >= 0.3:
            ultimo = i
    try:
        return round(frames[ultimo]["t"], 4)
    except NameError:
        return None


def main():
    t_ini = T_INICIO
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--plan")
    ap.add_argument("--salida")
    a = ap.parse_args()
    fps, dur, frames = medir(a.video)
    cand = candidatos(fps, frames)
    final_medido = asentamiento(fps, dur, frames)
    doc = {
        "video": a.video,
        "fps": round(fps, 3),
        "duracion_video_s": round(dur, 4),
        "metodo": "ffmpeg scdet + mafd + signalstats por cuadro",
        "candidatos": cand,
    }
    if a.plan:
        plan = json.load(open(a.plan, encoding="utf-8"))
        cortes = []
        for pc in plan["cortes"]:
            # un cambio menor (aterrizaje, palabra) solo se empareja a +-1 cuadro: con +-3 cuadros, un aterrizaje se
            # emparejaba con el final de una cortina vecina y el acento sonaba 100 ms antes
            tol = (1.5 if pc["peso"] < 0.6 else 3.5) / fps
            cerca = [c for c in cand if abs(c["t"] - pc["t"]) <= tol]
            if cerca:
                m = min(cerca, key=lambda c: abs(c["t"] - pc["t"]))
                cortes.append(
                    {
                        "t": m["t"],
                        "nombre": pc["nombre"],
                        "peso": pc["peso"],
                        "detectado": True,
                        "tipo": m["tipo"],
                        "deriva_ms": round((m["t"] - pc["t"]) * 1000, 1),
                    }
                )
            else:
                cortes.append(
                    {"t": pc["t"], "nombre": pc["nombre"], "peso": pc["peso"], "detectado": False, "deriva_ms": None}
                )
        doc["cortes"] = cortes
        doc["final_s"] = plan.get("final_s", final_medido)
        doc["final_medido_s"] = final_medido
        doc["no_planificados"] = [c for c in cand if not any(abs(c["t"] - x["t"]) <= 3.5 / fps for x in cortes)]
    else:
        doc["cortes"] = [
            {"t": c["t"], "nombre": f"{c['tipo']} {k + 1}", "peso": c["peso_sugerido"], "detectado": True}
            for k, c in enumerate(cand)
        ]
        doc["final_s"] = final_medido
        doc["nota"] = "sin plan: nombra los cortes y marca con peso 1,0 el corte principal antes de componer"
    tiempos.registrar("cortes", t_ini, cuadros=len(frames), cortes=len(doc["cortes"]))
    txt = json.dumps(doc, indent=1, ensure_ascii=False)
    if a.salida:
        open(a.salida, "w", encoding="utf-8").write(txt)
    print(
        txt
        if not a.salida
        else json.dumps(
            {
                "cortes": len(doc["cortes"]),
                "final_s": doc["final_s"],
                "no_detectados": [c["nombre"] for c in doc["cortes"] if not c.get("detectado", True)],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    sys.exit(main())
