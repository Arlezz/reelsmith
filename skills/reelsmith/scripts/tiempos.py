#!/usr/bin/env python3
"""Desglose de tiempos de una corrida: marcas de etapa del agente y registros automáticos de cada script.

Uso:
  python3 tiempos.py marca <etapa> [--nota "texto"]     marca el inicio de una etapa del agente
  python3 tiempos.py informe [--json salida.json]       imprime la tabla de la corrida

Etapas del agente (en orden): pedido, contenido, preguntas, guion, vista, correccion, final, entrega, fin.
Cada marca cierra la etapa anterior. Los scripts de máquina (render, vista, cortes,
música, mezcla, jueces) escriben solos su registro; el informe resta ese tiempo de la etapa del agente que lo contiene.

Archivo: tiempos.jsonl en la carpeta actual, o la ruta de la variable REELSMITH_TIEMPOS. Una línea JSON por evento.
"""

import json
import os
import sys
import time

for _flujo in (sys.stdout, sys.stderr):  # Windows: la consola y las tuberías no son UTF-8 por defecto
    if hasattr(_flujo, "reconfigure"):
        _flujo.reconfigure(encoding="utf-8", errors="replace")

ARCHIVO = os.environ.get("REELSMITH_TIEMPOS", "tiempos.jsonl")


def registrar(etapa, t0, t1=None, **datos):
    """Lo llaman los scripts de máquina al terminar. Nunca hace fallar al script que lo llama."""
    try:
        t1 = time.time() if t1 is None else t1
        with open(ARCHIVO, "a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "v": 1,
                        "tipo": "maquina",
                        "etapa": etapa,
                        "t0": round(t0, 3),
                        "t1": round(t1, 3),
                        "s": round(t1 - t0, 3),
                        "pid": os.getpid(),
                        "datos": datos,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except OSError:
        pass


def marca(etapa, nota=None):
    with open(ARCHIVO, "a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {"v": 1, "tipo": "marca", "etapa": etapa, "t": round(time.time(), 3), "nota": nota}, ensure_ascii=False
            )
            + "\n"
        )


def cargar(ruta=ARCHIVO):
    if not os.path.exists(ruta):
        return []
    return [json.loads(linea) for linea in open(ruta, encoding="utf-8") if linea.strip()]


def solape(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def union(intervalos):
    tot, fin = 0.0, -1e18
    for i0, i1 in sorted(intervalos):
        if i1 <= fin:
            continue
        tot += i1 - max(i0, fin)
        fin = i1
    return tot


def camino_critico(maq, tramos, t_ini, t_fin):
    """Cadena de lo que determinó el final, de atrás hacia adelante: en cada instante, el registro de máquina que
    terminó justo ahí (lo que se estaba esperando); entre registros, la etapa del agente. Las partes que corrieron en
    paralelo y terminaron antes no están en la ruta. Devuelve segundos en ruta por (etapa, tipo); suman el total."""
    en_ruta = {}

    def agente(a, b):
        for etapa, x0, x1 in tramos:
            d = solape(a, b, x0, x1)
            if d > 0:
                en_ruta[(etapa, "agente")] = en_ruta.get((etapa, "agente"), 0.0) + d
        if not tramos:
            en_ruta[("sin registro", "agente")] = en_ruta.get(("sin registro", "agente"), 0.0) + (b - a)

    t = t_fin
    for _ in range(10000):
        if t <= t_ini + 1e-3:
            break
        previos = [m for m in maq if m["t0"] < t - 1e-3 and t - 2.0 <= m["t1"] <= t + 0.05]
        if previos:
            m = max(previos, key=lambda m: (m["t1"], -m["t0"]))
            a = max(m["t0"], t_ini)
            if m["t1"] < t:
                agente(m["t1"], t)
            en_ruta[(m["etapa"], "maquina")] = en_ruta.get((m["etapa"], "maquina"), 0.0) + (min(m["t1"], t) - a)
            t = a
        else:
            antes = max([m["t1"] for m in maq if m["t1"] < t - 1e-3], default=t_ini)
            antes = max(antes, t_ini)
            agente(antes, t)
            t = antes
    return en_ruta


def informe(ev):
    marcas = sorted([e for e in ev if e["tipo"] == "marca"], key=lambda e: e["t"])
    # una corrida reanudada vuelve a marcar "pedido": cuenta desde el último
    ultimo_pedido = max([m["t"] for m in marcas if m["etapa"] == "pedido"], default=None)
    if ultimo_pedido is not None:
        marcas = [m for m in marcas if m["t"] >= ultimo_pedido]
        ev = [e for e in ev if e["tipo"] == "marca" or e["t0"] >= ultimo_pedido - 1]
    maq = [e for e in ev if e["tipo"] == "maquina"]
    filas = []
    if marcas:
        t_ini = marcas[0]["t"]
        t_fin = marcas[-1]["t"] if marcas[-1]["etapa"] == "fin" else max([marcas[-1]["t"]] + [m["t1"] for m in maq])
        tramos = [
            (m["etapa"], m["t"], (marcas[i + 1]["t"] if i + 1 < len(marcas) else t_fin))
            for i, m in enumerate(marcas)
            if m["etapa"] != "fin"
        ]
    else:  # solo registros de máquina (benchmark): un tramo por registro
        t_ini = min(m["t0"] for m in maq)
        t_fin = max(m["t1"] for m in maq)
        tramos = []
    total = t_fin - t_ini
    por_agente = {}
    for etapa, a, b in tramos:
        dentro = [(max(m["t0"], a), min(m["t1"], b)) for m in maq if solape(m["t0"], m["t1"], a, b) > 0]
        d = por_agente.setdefault(etapa, {"s": 0.0, "veces": 0})
        d["s"] += (b - a) - union(dentro)
        d["veces"] += 1
    for etapa, d in por_agente.items():
        filas.append({"etapa": etapa, "tipo": "agente", "s": round(d["s"], 1), "veces": d["veces"]})
    por_maq = {}
    for m in maq:
        d = por_maq.setdefault(m["etapa"], {"s": 0.0, "veces": 0, "datos": []})
        d["s"] += m["s"]
        d["veces"] += 1
        d["datos"].append(m.get("datos", {}))
    for k, d in por_maq.items():
        filas.append({"etapa": k, "tipo": "maquina", "s": round(d["s"], 1), "veces": d["veces"]})
    s_maq_total = union([(m["t0"], m["t1"]) for m in maq])
    for f in filas:
        f["pct"] = round(100 * f["s"] / total, 1) if total > 0 else 0.0
    en_ruta = camino_critico(maq, tramos, t_ini, t_fin)
    for f in filas:
        f["en_ruta_s"] = round(en_ruta.get((f["etapa"], f["tipo"]), 0.0), 1)
    filas.sort(key=lambda f: (-f["en_ruta_s"], -f["s"]))
    ruta = [f for f in filas if f["en_ruta_s"] > 0][:3]
    return {
        "total_s": round(total, 1),
        "agente_s": round(total - s_maq_total, 1) if marcas else 0.0,
        "maquina_s": round(s_maq_total, 1),
        "filas": filas,
        "ruta_critica": [f"{f['etapa']} ({f['tipo']}, {f['en_ruta_s']} s)" for f in ruta],
    }


def imprimir(r):
    print(f"total {r['total_s']} s · agente {r['agente_s']} s · máquina {r['maquina_s']} s")
    print(f"{'etapa':16} {'tipo':8} {'s':>8} {'%':>6} {'en ruta':>8}  veces")
    for f in r["filas"]:
        print(
            f"{f['etapa']:16} {f['tipo']:8} {f['s']:8.1f} {f['pct']:6.1f} {f['en_ruta_s']:8.1f}  {f.get('veces', '')}"
        )
    print(
        "en ruta = segundos en la ruta crítica (lo que se esperó; lo que corrió en paralelo y terminó antes no cuenta)"
    )
    print("ruta crítica (las 3 etapas que más pesan en ella): " + " · ".join(r["ruta_critica"]))


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("marca", "informe"):
        sys.exit(__doc__)
    if sys.argv[1] == "marca":
        if len(sys.argv) < 3:
            sys.exit("falta la etapa: python3 tiempos.py marca <etapa>")
        nota = sys.argv[sys.argv.index("--nota") + 1] if "--nota" in sys.argv else None
        marca(sys.argv[2], nota)
        return
    r = informe(cargar())
    if "--json" in sys.argv:
        open(sys.argv[sys.argv.index("--json") + 1], "w", encoding="utf-8").write(
            json.dumps(r, indent=1, ensure_ascii=False)
        )
    imprimir(r)


if __name__ == "__main__":
    main()
