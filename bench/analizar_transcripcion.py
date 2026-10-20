#!/usr/bin/env python3
"""Separa el tiempo de una sesión de agente en tiempo del modelo y tiempo de herramientas, por etapa, y cuenta tokens.

Uso: python3 analizar_transcripcion.py sesion.jsonl [--json salida.json]

Lee la transcripción (formato de Claude Code / Cowork: una línea JSON por evento con timestamp). Reglas:
  - Tiempo del modelo: desde que llega el último resultado de herramienta (o el pedido) hasta el último bloque de la
    respuesta siguiente (pensar, escribir texto, escribir la llamada a la herramienta). Incluye escribir el código de
    las escenas, que viaja dentro de las llamadas Write/Edit.
  - Tiempo de herramienta: desde la llamada hasta su resultado. Se clasifica por el comando (render, cortes, música,
    mezcla, jueces, lectura de imágenes, otros).
  - Tokens: por id de mensaje, el último uso informado (entrada, caché creada, caché leída, salida).
"""
import argparse  # noqa: I001
import json
import re
from datetime import datetime

# Precios en USD por millón de tokens, tomados de https://platform.claude.com/docs/en/about-claude/pricing el
# 19/10/2026. Cambian: revísalos antes de citar un costo.
PRECIOS = {
    "claude-opus-5-5": {"entrada": 4.0, "salida": 20.0, "cache_5m": 5.0, "cache_1h": 8.0, "cache_leida": 0.20},
    "claude-sonnet-5-5": {"entrada": 2.0, "salida": 10.0, "cache_5m": 2.5, "cache_1h": 4.0, "cache_leida": 0.10},
}

ETAPAS = [
    ("render", r"render-nativo|(?:showreel|reelsmith)\.mjs\s+(render|final)|hyperframes render"),
    ("vista", r"(?:showreel|reelsmith)\.mjs\s+vista|--vista"),
    ("cortes", r"medir_cortes"),
    ("musica", r"componer\.py"),
    ("mezcla", r"planificar_mezcla|mezcla\.sh"),
    ("jueces", r"check-audio|medir_pista"),
    ("construir", r"construir\.mjs|escenas\.mjs|(?:showreel|reelsmith)\.mjs\s+construir"),
    ("ffmpeg_revision", r"ffmpeg .*(-frames:v|select=|tile=)"),
    ("instalacion", r"pip install|npm install|playwright@.* install|--verificar"),
]


def ts(x):
    return datetime.fromisoformat(x["timestamp"].replace("Z", "+00:00")).timestamp()


def clasificar(nombre, entrada):
    if nombre in ("Write", "Edit", "NotebookEdit"):
        return "escritura_archivo"
    if nombre == "Read":
        ruta = str(entrada.get("file_path", ""))
        return "ver_imagen" if re.search(r"\.(png|jpe?g|webp)$", ruta) else "leer_archivo"
    if nombre == "Bash":
        cmd = entrada.get("command", "")
        for etapa, rx in ETAPAS:
            if re.search(rx, cmd):
                return etapa
        return "bash_otro"
    return "herramienta_" + nombre


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl")
    ap.add_argument("--json")
    a = ap.parse_args()
    ev = [json.loads(l) for l in open(a.jsonl) if l.strip()]
    ev = [e for e in ev if "timestamp" in e and e.get("type") in ("user", "assistant")]
    ev.sort(key=ts)
    t_ini, t_fin = ts(ev[0]), ts(ev[-1])
    usos, llamadas, modelo = {}, {}, 0.0
    ultimo_fin_herr = t_ini   # momento en que el modelo recibe el turno
    ultimo_bloque = None
    ids_turno = set()
    for e in ev:
        t = ts(e)
        if e["type"] == "assistant":
            m = e.get("message", {})
            mid = m.get("id")
            if m.get("usage"):
                usos[mid] = dict(m["usage"], _modelo=m.get("model"))
            for c in m.get("content", []) or []:
                if c.get("type") == "tool_use":
                    llamadas[c["id"]] = {"nombre": c["name"], "entrada": c.get("input", {}), "t0": t}
            ultimo_bloque = t
            ids_turno.add(mid)
        else:  # user: pedido inicial o resultados de herramientas
            contenido = e.get("message", {}).get("content")
            if isinstance(contenido, list):
                for c in contenido:
                    if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") in llamadas:
                        ll = llamadas[c["tool_use_id"]]
                        ll["t1"] = t
            if ultimo_bloque is not None:
                modelo += max(0.0, ultimo_bloque - ultimo_fin_herr)
                ultimo_bloque = None
            ultimo_fin_herr = t
    if ultimo_bloque is not None:
        modelo += max(0.0, ultimo_bloque - ultimo_fin_herr)
    # herramientas: unión de intervalos por etapa (las llamadas en paralelo no se suman dos veces en el total)
    por_etapa = {}
    intervalos = []
    for ll in llamadas.values():
        if "t1" not in ll:
            continue
        et = clasificar(ll["nombre"], ll["entrada"])
        d = ll["t1"] - ll["t0"]
        por_etapa.setdefault(et, {"s": 0.0, "llamadas": 0})
        por_etapa[et]["s"] += d
        por_etapa[et]["llamadas"] += 1
        intervalos.append((ll["t0"], ll["t1"]))
    intervalos.sort()
    herr_union, fin = 0.0, -1e18
    for i0, i1 in intervalos:
        if i1 <= fin:
            continue
        herr_union += i1 - max(i0, fin)
        fin = i1
    tok = {"entrada": 0, "cache_creada": 0, "cache_leida": 0, "salida": 0}
    costo, sin_precio = 0.0, set()
    for u in usos.values():
        tok["entrada"] += u.get("input_tokens", 0)
        tok["cache_creada"] += u.get("cache_creation_input_tokens", 0)
        tok["cache_leida"] += u.get("cache_read_input_tokens", 0)
        tok["salida"] += u.get("output_tokens", 0)
        pr = PRECIOS.get(u.get("_modelo"))
        if not pr:
            sin_precio.add(u.get("_modelo"))
            continue
        cc = u.get("cache_creation") or {}
        c1h = cc.get("ephemeral_1h_input_tokens", 0)
        c5m = cc.get("ephemeral_5m_input_tokens", u.get("cache_creation_input_tokens", 0) - c1h)
        costo += (u.get("input_tokens", 0) * pr["entrada"] + u.get("output_tokens", 0) * pr["salida"] + c5m * pr["cache_5m"]
                  + c1h * pr["cache_1h"] + u.get("cache_read_input_tokens", 0) * pr["cache_leida"]) / 1e6
    total = t_fin - t_ini
    res = {"archivo": a.jsonl, "total_s": round(total, 1), "modelo_s": round(modelo, 1),
           "herramientas_s": round(herr_union, 1), "otros_s": round(total - modelo - herr_union, 1),
           "respuestas_del_modelo": len(usos), "llamadas_a_herramientas": len(llamadas),
           "por_etapa": {k: {"s": round(v["s"], 1), "llamadas": v["llamadas"]} for k, v in sorted(por_etapa.items(), key=lambda kv: -kv[1]["s"])},
           "tokens": tok, "modelos": sorted({str(u.get("_modelo")) for u in usos.values()}),
           "costo_usd": round(costo, 2), "costo_nota": "precios de lista del 19/10/2026 (PRECIOS en este script)"
           + (f"; sin precio para {sorted(map(str, sin_precio))}" if sin_precio else "")}
    txt = json.dumps(res, indent=1, ensure_ascii=False)
    if a.json:
        open(a.json, "w").write(txt)
    print(txt)


if __name__ == "__main__":
    main()
