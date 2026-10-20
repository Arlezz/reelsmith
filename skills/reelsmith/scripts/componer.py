#!/usr/bin/env python3
"""Compone por código la música y los efectos de un video a partir de sus cortes medidos (cortes.json).

Uso: python3 componer.py cortes.json --estilo corporativa|trailer --salida carpeta [--video video-mudo.mp4] [--bpm 128]

Escribe en la carpeta:
  musica.wav              música (duración exacta del video, 48 kHz, float, estéreo, pico -3 dBFS, sin master)
  sfx-*.wav               efectos sueltos (whoosh corto, largo y de salida; riser; impacto)
  composicion.json        tempo, compases con su tipo y acorde, puntos de golpe con su error contra la grilla, efectos
  variante.json           insumo de planificar_mezcla.py (mezcla nativa en ffmpeg)
Imprime un resumen con "avisos" (corte a más de 45 ms de la grilla, principal sin espacio para el riser, logo encima
del último principal): léelos antes de mezclar.

Roles de los cortes (por peso en cortes.json):
  peso >= 1,0  principal: caída de la música (compás de build antes, semicorchea de silencio, sección completa),
               riser que termina en el corte e impacto en el corte. Puede haber varios.
  0,6 a 0,99   sección: acento musical en el instante exacto + whoosh.
  < 0,6        menor: acento suave en el instante exacto, sin efecto de sonido.
  final_s      instante en que se asienta el logo o la frase final: ahí cae el acorde o golpe final.

Reglas (ver references/musica-y-mezcla.md):
  - Tempo constante dentro del rango del estilo: el primer corte principal es tiempo fuerte; los demás principales
    caen lo más cerca posible de un tiempo; el resto, de la grilla de semicorcheas.
  - Cada corte principal reinicia la grilla (es tiempo fuerte exacto). El desajuste entre principales se absorbe en el
    build, que no tiene pulso fijo (redoble que acelera), y los tiempos que sobran forman un compás corto dentro del build.
  - Los acentos van en el instante exacto del corte; bombo y bajo, en la grilla.
  - El final se compone: cae en el tiempo fuerte más cercano al asentamiento del logo (si queda a un tiempo o menos)
    o en el tiempo más cercano; la cola termina antes del final del video.
Todo se sintetiza (sintesis.py): derechos 100 % propios. Semillas fijas: misma entrada, mismos archivos (md5).
"""

import time

T_INICIO = time.time()  # reloj desde el arranque del proceso (tiempos.jsonl)
import argparse  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402

for _flujo in (sys.stdout, sys.stderr):  # Windows: la consola y las tuberías no son UTF-8 por defecto
    if hasattr(_flujo, "reconfigure"):
        _flujo.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402
from scipy.io import wavfile  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sintesis as S  # noqa: E402
import tiempos  # noqa: E402
from sintesis import SR, ns  # noqa: E402

ESTILOS = {
    "corporativa": {"rango": (118.0, 130.0), "tonalidad": "C mayor"},
    "trailer": {"rango": (135.0, 150.0), "tonalidad": "D menor"},
}


class Pista:
    def __init__(self, n):
        self.x = np.zeros((n, 2))

    def poner(self, y, t, g=1.0):
        if y.ndim == 1:
            y = S.estereo(y)
        i = ns(t)
        if i < 0:
            y = y[-i:]
            i = 0
        k = min(len(y), len(self.x) - i)
        if k > 0:
            self.x[i : i + k] += g * y[:k]


# ======================================================================= estructura
def clasificar(cortes):
    cs = sorted(cortes, key=lambda c: c["t"])
    principales = [c for c in cs if c["peso"] >= 1.0]
    if not principales:  # sin principal declarado: el más pesado
        principales = [max(cs, key=lambda c: c["peso"])]
    for c in cs:
        c["rol"] = "principal" if c in principales else ("seccion" if c["peso"] >= 0.6 else "menor")
    return cs, [c["t"] for c in principales]


def buscar_tempo(cortes, P, rango):
    """Primer principal = tiempo fuerte. Clave: (peor error de los demás principales contra un tiempo, peor error
    del resto contra la semicorchea de su segmento, error medio ponderado). Cada principal reinicia la grilla."""
    mejor = None
    for bpm in np.arange(rango[0], rango[1] + 1e-9, 0.01):
        p = 60 / bpm
        e_pr = [abs((P[k] - P[k - 1]) / p - round((P[k] - P[k - 1]) / p)) * p for k in range(1, len(P))]
        errs, pesos = [], []
        for c in cortes:
            if c["rol"] == "principal":
                continue
            ancla = max([x for x in P if x <= c["t"]], default=P[0])
            k = (c["t"] - ancla) / p * 4
            errs.append(abs(k - round(k)) * p / 4)
            pesos.append(c["peso"])
        clave = (
            round(max(e_pr, default=0) * 1000 / 5),
            round(max(errs, default=0) * 1000),
            sum(e * w for e, w in zip(errs, pesos, strict=False)) / max(sum(pesos), 1e-9),
        )
        if mejor is None or clave < mejor[0]:
            mejor = (clave, round(float(bpm), 2))
    return mejor[1]


def estructura(cortes, P, p, D, final_s, estilo):
    """Compases (inicio, tiempos, tipo, acordes), final, botón y corte de salida."""
    if estilo == "corporativa":
        prog_a, prog_drop, build_ch, final_ch = ["Am", "F", "C", "G"], ["C", "G", "Am", "F"], ["F", "G"], "C"
    else:
        prog_a, prog_drop, build_ch, final_ch = ["Dm", "Dm", "Bb", "Gm"], ["Dm", "Bb", "Gm", "A"], ["A"], "Dm"
    secc = [c["t"] for c in cortes if c["rol"] == "seccion"]
    compases = []
    # --- antes del primer principal: anacrusa + intro + A + build
    nb_tot = int(np.floor(P[0] / p + 1e-6))
    nb, r = nb_tot // 4, nb_tot % 4
    t_ini = P[0] - nb_tot * p
    if r:
        compases.append({"t0": t_ini, "beats": r, "tipo": "intro", "acordes": [prog_a[0]]})
    primera_secc = next((t for t in secc if t < P[0]), None)
    for k in range(nb, 0, -1):
        t0 = P[0] - 4 * k * p
        if k == 1:
            tipo = "build"
        elif primera_secc is not None:
            tipo = "intro" if t0 + 2 * p < primera_secc else "A"
        else:
            tipo = "intro" if k > (nb + 1) // 2 else "A"
        compases.append({"t0": t0, "beats": 4, "tipo": tipo})
    # --- entre principales: caída, respiro, build (con el compás corto escondido)
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        N = int(round((b - a) / p))
        m, r = max(0, (N - 4) // 4), max(0, (N - 4) % 4)
        n_drop = m if m < 6 else max(4, m - 2)
        for k in range(m):
            compases.append({"t0": a + 4 * k * p, "beats": 4, "tipo": "drop" if k < n_drop else "A"})
        compases.append({"t0": a + 4 * m * p, "beats": 4 + r, "tipo": "build", "fin": b})
    # --- después del último principal: caída hasta el final
    a = P[-1]
    # F = asentamiento del logo; sin dato, 2,4 s antes del final del video. Nunca antes del último principal:
    # si el logo se asienta casi encima de él, el corte principal es también el golpe final.
    F = final_s if final_s else D - 2.4
    F = min(max(F, a), D - 1.0)
    k_bar = round((F - a) / (4 * p))
    t_down = a + 4 * k_bar * p
    if abs(t_down - F) <= p and t_down + 1.0 <= D:
        t_fin, tipo_fin = t_down, "tiempo fuerte"
    else:
        t_fin, tipo_fin = a + round((F - a) / p) * p, "tiempo"
        while t_fin + 1.0 > D and t_fin - p >= a - 1e-6:
            t_fin -= p
    k = 0
    while a + 4 * k * p < t_fin - 1e-6:
        compases.append(
            {"t0": a + 4 * k * p, "beats": min(4, (t_fin - a - 4 * k * p) / p), "tipo": "drop" if k < 8 else "A"}
        )
        k += 1
    compases.sort(key=lambda c: c["t0"])
    # acordes
    ia = idrop = 0
    for c in compases:
        if "acordes" in c:
            continue
        if c["tipo"] in ("intro", "A"):
            c["acordes"] = [prog_a[ia % 4]]
            ia += 1
        elif c["tipo"] == "build":
            c["acordes"] = list(build_ch)
            ia = 0
        else:
            c["acordes"] = [prog_drop[idrop % 4]]
            idrop += 1
    # el último compás de caída antes del final prepara la cadencia
    drops = [c for c in compases if c["tipo"] == "drop" and c["t0"] < t_fin]
    if drops and estilo == "corporativa":
        drops[-1]["acordes"] = ["F", "G"]
    for c in compases:
        nxt = next((x["t0"] for x in compases if x["t0"] > c["t0"] + 1e-6), t_fin)
        c["fin"] = c.get("fin", nxt)
        c["p"] = (c["fin"] - c["t0"]) / c["beats"] if c["beats"] else p
    t_boton = t_fin + 4 * p if (estilo == "corporativa" and t_fin + 4 * p + 1.0 <= D) else None
    salida = next((c["t"] for c in cortes if c["rol"] == "seccion" and t_fin - 2 * p <= c["t"] < t_fin), None)
    return compases, t_fin, tipo_fin, t_boton, salida, final_ch


def compas_de(compases, t):
    c = [x for x in compases if x["t0"] <= t + 1e-6]
    return c[-1] if c else compases[0]


def acorde_en(compases, t):
    c = compas_de(compases, t)
    if len(c["acordes"]) == 1:
        return c["acordes"][0]
    return c["acordes"][0] if t < c["t0"] + (c["fin"] - c["t0"]) / 2 else c["acordes"][1]


# ======================================================================= mezcla interna (pre-master)
def mezclar(pistas, envios, ir_sala, ir_hall, kicks, retardo, D, eq=(), estante_db=-5.0):
    N = ns(D)
    n = len(next(iter(pistas.values())).x)
    seco = np.zeros((n, 2))
    env_sala = np.zeros((n, 2))
    env_hall = np.zeros((n, 2))
    env_delay = np.zeros((n, 2))
    sc = S.sidechain(n, kicks, prof=0.55, release=0.17)
    sc_suave = S.sidechain(n, kicks, prof=0.3, release=0.15)
    for nombre, pst in pistas.items():
        g, sala, hall, dly, hp, duck = envios[nombre]
        x = pst.x * g
        if hp:
            x = S.filtrar(x, "high", hp)
        if duck == "fuerte":
            x = x * sc[:, None]
        elif duck == "suave":
            x = x * sc_suave[:, None]
        seco += x
        env_sala += x * sala
        env_hall += x * hall
        env_delay += x * dly
    d = S.pingpong(env_delay, retardo, fb=0.38, damp=0.3)
    d = S.filtrar(d, "band", [300, 6000])
    env_hall += d * 0.35
    r1 = S.convolver(env_sala, ir_sala)[:n]
    r2 = S.convolver(env_hall, ir_hall)[:n]
    r = S.filtrar(r1 + r2 * 1.25, "high", 220) * sc_suave[:, None]
    mix = seco + d * 0.6 + r
    mix = S.filtrar(mix, "high", 28)
    mix = S.estante_agudos(mix, 8500, estante_db)
    mix = S.filtrar(mix, "low", 16500)
    for f0, g_db, q in eq:
        mix = S.peq(mix, f0, g_db, q)
    mix = S.comprimir(mix, umbral=-13, ratio=1.6, ataque=0.015, release=0.18, rodilla=6)
    mix = mix[:N]
    mix = S.saturar(mix / np.abs(mix).max() * 1.05, 1.2)
    mix *= np.clip((D - np.arange(N) / SR) / 0.12, 0, 1)[:, None]  # silencio exacto al final del video
    return mix / np.abs(mix).max() * S.db(-3.0)


def ultimo_dieciseisavo(c):
    return c["fin"] - c["p"] / 4


# ======================================================================= estilo corporativo
def corporativa(cortes, P, p, D, compases, t_fin, t_boton, salida, final_ch):
    n = ns(D) + ns(4.0)
    nombres = ["bombo", "clap", "hats", "caja", "platillo", "bajo", "pad", "arp", "lead", "stab", "campana", "keys"]
    pistas = {k: Pista(n) for k in nombres}
    VOZ = {"C": ["G3", "C4", "E4"], "G": ["G3", "B3", "D4"], "Am": ["A3", "C4", "E4"], "F": ["A3", "C4", "F4"]}
    RAIZ = {"C": "C2", "G": "G1", "Am": "A1", "F": "F1"}
    ARP = {
        "C": ["C5", "E5", "G5", "C6"],
        "G": ["B4", "D5", "G5", "B5"],
        "Am": ["C5", "E5", "A5", "C6"],
        "F": ["C5", "F5", "A5", "C6"],
    }
    MEL = {
        "C": [
            (0, "E5", 0.5),
            (0.75, "G5", 0.5),
            (1.5, "A5", 0.5),
            (2.5, "G5", 0.5),
            (3, "E5", 0.25),
            (3.25, "D5", 0.25),
            (3.5, "E5", 0.5),
        ],
        "G": [
            (0, "D5", 0.5),
            (0.75, "G5", 0.5),
            (1.5, "A5", 0.5),
            (2.5, "G5", 0.5),
            (3, "D5", 0.25),
            (3.25, "E5", 0.25),
            (3.5, "D5", 0.5),
        ],
        "Am": [
            (0, "C5", 0.5),
            (0.75, "E5", 0.5),
            (1.5, "A5", 0.5),
            (2.5, "G5", 0.5),
            (3, "E5", 0.25),
            (3.25, "G5", 0.25),
            (3.5, "A5", 0.5),
        ],
        "F": [
            (0, "A5", 0.5),
            (0.75, "C6", 0.5),
            (1.5, "A5", 0.5),
            (2.5, "G5", 0.5),
            (3, "F5", 0.25),
            (3.25, "E5", 0.25),
            (3.5, "D5", 0.5),
        ],
        "FG": [
            (0, "A5", 0.5),
            (0.75, "C6", 0.5),
            (1.5, "A5", 0.25),
            (1.75, "G5", 0.25),
            (2, "D5", 0.5),
            (2.5, "G5", 0.5),
            (3, "A5", 0.25),
            (3.25, "B5", 0.25),
            (3.5, "D6", 0.5),
        ],
    }
    ir_hall = S.ir_reverb(2.4, 0.02, 0.5, semilla=3)
    ir_sala = S.ir_reverb(0.9, 0.008, 0.4, semilla=4)
    kicks = []
    stop = salida if salida else t_fin  # la batería se detiene en el corte de salida (si existe) o en el final

    def stab(ch, dur=0.45, brillo=6000):
        notas = [VOZ[ch][0], VOZ[ch][1], VOZ[ch][2], VOZ[ch][1][:-1] + str(int(VOZ[ch][1][-1]) + 1)]
        return sum(S.doble(S.pluck_sierra, S.hz(nn), dur, corte0=brillo, tau_f=0.08, tau=0.22) for nn in notas) / 2

    primera_barra = True
    for ci, c in enumerate(compases):
        tp, pb = c["tipo"], c["p"]
        T = lambda b, c=c: c["t0"] + b * c["p"]  # noqa: E731
        # pad
        for j, ch in enumerate(c["acordes"]):
            a = T(c["beats"] * j / len(c["acordes"]))
            bfin = T(c["beats"] * (j + 1) / len(c["acordes"]))
            ini = 0.0 if primera_barra else a
            if tp == "build":
                fin = ultimo_dieciseisavo(c) if j == len(c["acordes"]) - 1 else bfin
                dur = fin - ini + (0.02 if j == len(c["acordes"]) - 1 else 0.35)
                corte = 1200 * (9000 / 1200) ** (
                    np.linspace((j) / len(c["acordes"]), (j + 1) / len(c["acordes"]), ns(dur)) ** 1.5
                )
                pistas["pad"].poner(
                    S.supersaw(
                        VOZ[ch] + [VOZ[ch][0][:-1] + "2"],
                        dur,
                        corte=corte,
                        ataque=0.05,
                        release=0.02 if j == len(c["acordes"]) - 1 else 0.35,
                        semilla=20 + ci,
                        detune=0.3,
                        ancho=1.0,
                    ),
                    ini,
                    0.55,
                )
            elif tp in ("intro", "A"):
                dur = bfin - ini + 0.35
                pistas["pad"].poner(
                    S.supersaw(
                        VOZ[ch] + [VOZ[ch][0][:-1] + "2"],
                        dur,
                        corte=1100 if tp == "intro" else 1800,
                        ataque=0.9 if primera_barra else 0.05,
                        release=0.35,
                        semilla=20 + ci,
                        detune=0.3,
                        ancho=1.0,
                    ),
                    ini,
                    0.8 if tp == "intro" else 0.55,
                )
            else:  # drop
                dur = bfin - a + 0.3
                pistas["pad"].poner(
                    S.supersaw(
                        [RAIZ[ch][:-1] + "3", *VOZ[ch], VOZ[ch][1][:-1] + "5"],
                        dur,
                        corte=4200,
                        ataque=0.01,
                        release=0.3,
                        semilla=40 + ci + j,
                        detune=0.3,
                        ancho=1.0,
                    ),
                    a,
                    1.0,
                )
        primera_barra = False
        nb = int(round(c["beats"] * 4))
        # arpegio (todo lo que no es caída), hasta la semicorchea previa al build terminado
        if tp in ("intro", "A", "build"):
            patron = [0, 1, 2, 3, 2, 1, 2, 1]
            for k in range(nb):
                t = T(k / 4)
                if tp == "build" and t >= ultimo_dieciseisavo(c) - 1e-6:
                    break
                ch = acorde_en(compases, t)
                vel = (0.55 + 0.45 * (k % 4 == 0)) * (0.75 if tp == "A" else 1.0)
                prog_i = 1.0 if tp != "intro" else min(1.0, 0.4 + 0.3 * ci)
                pistas["arp"].poner(
                    S.estereo(
                        S.pluck_fm(S.hz(ARP[ch][patron[k % 8]]), 0.35, indice=1.2 + 1.8 * prog_i, razon=1.0, tau=0.16),
                        0.65 if k % 2 else -0.65,
                    ),
                    t,
                    0.5 * vel,
                )
        # batería y bajo
        if tp == "A":
            for b in range(int(c["beats"])):
                t = T(b)
                if t >= stop - 1e-6:
                    continue
                kicks.append(t)
                pistas["bombo"].poner(S.bombo(semilla=ci * 8 + b), t, 0.72)
                pistas["bajo"].poner(S.bajo_house(S.hz(RAIZ[acorde_en(compases, t)]), 0.22), T(b + 0.5), 0.6)
                if b in (1, 3) and ci > 0 and compases[ci - 1]["tipo"] == "A":
                    pistas["clap"].poner(S.clap(semilla=ci * 4 + b), t, 0.7)
                    pistas["hats"].poner(S.hat(True, 50), T(b - 0.5), 0.4)
            for k in range(nb):
                pistas["hats"].poner(
                    S.estereo(S.hat(False, 40 + k % 7), 0.3), T(k / 4), [0.5, 0.22, 0.8, 0.3][k % 4] * 0.5
                )
        elif tp == "build":
            L = c["beats"]
            golpes = (
                [i * 0.5 for i in range(int(L - 2) * 2)]
                + [L - 2 + i * 0.25 for i in range(4)]
                + [L - 1 + i * 0.125 for i in range(6)]
            )
            for b in golpes:
                frac = b / (L - 0.25)
                pistas["caja"].poner(
                    S.caja(0.25, semilla=int(b * 8) + 100 + ci, brillo=0.8 + 0.4 * frac), T(b), 0.18 + 0.5 * frac**1.5
                )
        elif tp == "drop":
            ultimo = c["fin"] >= t_fin - 1e-6
            for b in range(int(np.ceil(c["beats"] - 1e-6))):
                t = T(b)
                if t >= stop - 1e-6 or (ultimo and b >= c["beats"] - 1):
                    continue
                kicks.append(t)
                pistas["bombo"].poner(S.bombo(semilla=200 + ci * 4 + b), t, 1.0)
                ch = acorde_en(compases, t)
                pistas["bajo"].poner(S.bajo_house(S.hz(RAIZ[ch]), 0.22, corte0=2200), T(b + 0.5), 1.0)
                pistas["bajo"].poner(S.sub(S.hz(RAIZ[ch]), 0.12, release=0.05), t, 0.25)
                if b in (1, 3):
                    pistas["clap"].poner(S.clap(semilla=300 + ci * 4 + b), t, 1.0)
                pistas["hats"].poner(S.estereo(S.hat(True, 70 + ci), -0.35), T(b + 0.5), 0.45)
            for k in range(nb):
                t = T(k / 4)
                if t < stop - 1e-6 and not (ultimo and k >= nb - 4):
                    pistas["hats"].poner(
                        S.estereo(S.hat(False, 60 + k % 5), 0.3), t, [0.5, 0.22, 0.8, 0.3][k % 4] * 0.7
                    )
            for off in (0.0, 0.75, 1.5, 2.5, 3.0):
                t = T(off)
                if off < c["beats"] and t < stop - 1e-6:
                    ch = acorde_en(compases, t)
                    ep = (
                        sum(
                            S.pluck_fm(S.hz(nn), 0.32, indice=0.9, razon=1.0, tau=0.22, tau_indice=0.08)
                            for nn in [RAIZ[ch][:-1] + "3", *VOZ[ch]]
                        )
                        / 3
                    )
                    pistas["keys"].poner(S.estereo(ep, 0.0), t, 0.8 if off in (0.0, 1.5) else 0.6)
            mel = MEL["FG"] if c["acordes"] == ["F", "G"] else MEL[c["acordes"][0]]
            for off, nt, durb in mel:
                t = T(off)
                if off < c["beats"] and t < stop - 1e-6:
                    voz = lambda ff, dd: (  # noqa: E731
                        0.6 * S.pluck_fm(ff, dd, indice=1.6, razon=1.0, tau=0.3)
                        + 0.5 * S.pluck_sierra(ff, dd, corte0=5000, tau_f=0.12, tau=0.3)
                    )
                    pistas["lead"].poner(S.doble(voz, S.hz(nt), durb * pb + 0.25, cents=6, pan=0.45), t, 0.9)
            if ultimo:  # relleno antes del final
                for b in (c["beats"] - 1, c["beats"] - 0.5, c["beats"] - 0.25):
                    if T(b) < stop - 0.06:
                        pistas["caja"].poner(
                            S.caja(0.25, semilla=int(b * 4) + 400 + ci), T(b), 0.6 + 0.2 * (b - c["beats"] + 1)
                        )
    # platillos en cada caída y cada 4 compases de caída
    for t in P:
        pistas["platillo"].poner(S.platillo(2.4, 90), t, 0.8)
    for k, c in enumerate([c for c in compases if c["tipo"] == "drop"]):
        if k % 4 == 2 and c["t0"] not in P:
            pistas["platillo"].poner(S.platillo(1.8, 91 + k), c["t0"], 0.6)
    # acentos en los cortes (instante exacto)
    menores_drop = 0
    for cc in cortes:
        t = cc["t"]
        if cc["rol"] == "principal" or abs(t - t_fin) < 0.06:
            continue
        cp = compas_de(compases, t)
        ch = acorde_en(compases, t)
        if cc["rol"] == "menor" and cp["tipo"] == "intro":
            notas = {
                "Am": ["A4", "C5", "E5", "B5"],
                "F": ["A4", "C5", "F5", "G5"],
                "C": ["G4", "C5", "E5", "D6"],
                "G": ["G4", "B4", "D5", "A5"],
            }[ch]
            camp = sum(S.pluck_fm(S.hz(nn), 2.2, indice=3.5, razon=3.5, tau=0.9, tau_indice=0.25) for nn in notas) / 3
            pistas["campana"].poner(camp, t, 0.6)
            pistas["bajo"].poner(S.sub(S.hz(RAIZ[ch]), 0.6, release=0.3), t, 0.6)
            pistas["campana"].poner(S.swell_invertido(S.estereo(camp), 0.85, ir_hall), t - 0.85, 0.35)
        elif cc["rol"] == "seccion" and t == salida:
            pistas["caja"].poner(S.tom(0.5, 140, 401), t, 0.8)
        elif cc["rol"] == "seccion" and (
            cp["tipo"] == "build"
            or (cp["fin"] - t) < cp["p"] * 1.01
            and compas_de(compases, cp["fin"] + 1e-3)["tipo"] == "build"
        ):
            pistas["clap"].poner(S.clap(semilla=77), t, 1.0)
            pistas["caja"].poner(S.caja(semilla=78), t, 0.6)
            pistas["platillo"].poner(S.platillo(1.2, 79, oscuro=True), t, 0.5)
        elif cc["rol"] == "seccion":
            sig = acorde_en(compases, t + cp["p"]) if (cp["fin"] - t) < cp["p"] else ch
            x = stab(sig, 0.5, 5500)
            pistas["stab"].poner(x, t, 0.8)
            pistas["stab"].poner(S.swell_invertido(x, 0.5, ir_hall), t - 0.5, 0.3)
            if cp["tipo"] != "drop":
                pistas["hats"].poner(S.hat(True, 31), t, 0.7)
        else:  # menor
            if cp["tipo"] == "drop" and menores_drop % 2 == 1:
                pistas["platillo"].poner(S.platillo(1.4, 92 + menores_drop), t, 0.45)
            else:
                pistas["stab"].poner(stab(ch, 0.45, 7000), t, 0.6 if cp["tipo"] == "drop" else 0.7)
            menores_drop += cp["tipo"] == "drop"
    # final y botón
    kicks.append(t_fin)
    pistas["bombo"].poner(S.bombo(0.6, tau=0.45, semilla=500), t_fin, 1.0)
    pistas["platillo"].poner(S.platillo(2.6, 93), t_fin, 0.8)
    largo = min(2.4, D - t_fin)
    pistas["pad"].poner(
        S.supersaw(
            ["C3", "G3", "C4", "E4", "G4", "C5"],
            largo,
            corte=np.linspace(5000, 900, ns(largo)),
            ataque=0.005,
            release=min(1.4, largo * 0.6),
            semilla=60,
        ),
        t_fin,
        1.0,
    )
    pistas["bajo"].poner(S.sub(S.hz("C2"), min(1.6, largo), release=min(1.0, largo * 0.5)), t_fin, 0.8)
    pistas["bajo"].poner(S.bajo_house(S.hz("C2"), 0.4), t_fin, 0.8)
    pistas["campana"].poner(
        sum(S.pluck_fm(S.hz(nn), min(2.0, largo), indice=2.5, razon=3.0, tau=0.8) for nn in ["C5", "E5", "G5"]) / 2.5,
        t_fin,
        0.6,
    )
    if t_boton:
        boton = (
            sum(
                S.pluck_fm(S.hz(nn), D - t_boton, indice=2.0, razon=3.0, tau=0.35, tau_indice=0.15)
                for nn in ["C5", "G5", "C6"]
            )
            / 2.5
        )
        pistas["campana"].poner(boton, t_boton, 0.5)
        pistas["bajo"].poner(S.sub(S.hz("C2"), min(0.5, D - t_boton), release=0.4), t_boton, 0.35)
    envios = {
        "bombo": (1.0, 0.0, 0.0, 0.0, None, None),
        "clap": (0.42, 0.35, 0.1, 0.0, 200, None),
        "caja": (0.5, 0.3, 0.1, 0.0, 120, None),
        "hats": (0.17, 0.05, 0.0, 0.0, 400, None),
        "platillo": (0.3, 0.0, 0.15, 0.0, 300, None),
        "bajo": (0.55, 0.0, 0.0, 0.0, 30, "fuerte"),
        "pad": (0.34, 0.0, 0.32, 0.0, 120, "fuerte"),
        "arp": (0.42, 0.05, 0.28, 0.4, 220, "suave"),
        "lead": (0.38, 0.0, 0.3, 0.3, 250, "suave"),
        "stab": (0.42, 0.1, 0.35, 0.15, 180, None),
        "campana": (0.42, 0.0, 0.5, 0.2, 200, None),
        "keys": (0.42, 0.08, 0.2, 0.0, 140, "suave"),
    }
    # ecualización medida contra perfil-profesional.json (medir_pista.py): cuerpo en 170-400 Hz y aire en 6 kHz
    mix = mezclar(
        pistas,
        envios,
        ir_sala,
        ir_hall,
        kicks,
        0.75 * p,
        D,
        eq=[(48, -6.5, 1.0), (170, 5.0, 1.0), (400, 6.5, 0.9), (2600, 1.0, 0.8), (6000, 3.0, 0.8)],
        estante_db=-1.0,
    )
    sfx = {
        "sfx-whoosh-corto.wav": S.sfx_whoosh(0.7, 0.68, semilla=11),
        "sfx-whoosh-largo.wav": S.sfx_whoosh(1.1, 0.72, f_lo=250, f_hi=4200, pan0=0.8, pan1=-0.8, semilla=14),
        "sfx-whoosh-salida.wav": S.sfx_whoosh(0.55, 0.7, f_lo=500, f_hi=7000, semilla=15),
        "sfx-riser.wav": S.sfx_riser(2.0, semilla=12),
        "sfx-impacto.wav": S.sfx_impacto(2.4, "corporativo", semilla=13),
    }
    return mix, sfx, kicks


# ======================================================================= estilo tráiler
def reese_ancho(f, largo, corte):
    """Reese con el grave en mono (bajo 250 Hz) y la parte alta abierta: dos copias con distinto desafine, una a cada
    lado. Sin esto la caída del tráiler suena angosta (correlación L/R sobre 300 Hz > 0,6)."""
    a = S.reese(f, largo, corte=corte, detune=0.14)
    b = S.reese(f, largo, corte=corte, detune=0.21)
    grave = S.filtrar((a + b) / 2, "low", 250)
    return (
        S.estereo(grave)
        + S.estereo(S.filtrar(a, "high", 250), -0.6) * 0.5
        + S.estereo(S.filtrar(b, "high", 250), 0.6) * 0.5
    )


def trailer(cortes, P, p, D, compases, t_fin, t_boton, salida, final_ch):
    n = ns(D) + ns(4.0)
    nombres = [
        "bombo",
        "caja",
        "tom",
        "hats",
        "platillo",
        "sub",
        "reese",
        "drone",
        "ostinato",
        "braam",
        "metal",
        "tick",
    ]
    pistas = {k: Pista(n) for k in nombres}
    RAIZ = {"Dm": 38, "Bb": 34, "Gm": 31, "A": 33}
    OST = {
        "Dm": [50, 62, 57, 62, 65, 62, 57, 62],
        "Bb": [46, 58, 53, 58, 62, 58, 53, 58],
        "Gm": [43, 55, 50, 55, 58, 55, 50, 55],
        "A": [45, 57, 52, 57, 61, 57, 52, 57],
    }
    BRAAM = {
        "Dm": ["D1", "D2", "A2", "D3"],
        "Bb": ["Bb0", "Bb1", "F2", "Bb2"],
        "Gm": ["G1", "G2", "D3"],
        "A": ["A1", "A2", "E3"],
    }
    ir_hall = S.ir_reverb(3.0, 0.025, 0.35, semilla=5)
    ir_sala = S.ir_reverb(1.2, 0.01, 0.3, semilla=6)
    kicks = []
    stop = salida if salida else t_fin
    # sin build (principal en los primeros 4 tiempos) se usa el propio principal como borde
    primer_build = next((c for c in compases if c["tipo"] == "build"), {"t0": P[0]})
    primera_secc = next((cc["t"] for cc in cortes if cc["rol"] == "seccion" and cc["t"] < P[0]), None)
    # drone desde 0 s hasta el inicio del primer build: el build queda sin grave y la caída marca el escalón
    dl = max(0.6, primer_build["t0"] + 0.1)
    pistas["drone"].poner(
        S.supersaw(
            ["D2", "A2", "D3"],
            dl,
            corte=np.linspace(250, 700, ns(dl)),
            ataque=0.5,
            release=0.6,
            voces=5,
            detune=0.16,
            semilla=1,
            ancho=1.0,
        ),
        0.0,
        1.0,
    )
    for ci, c in enumerate(compases):
        tp = c["tipo"]
        T = lambda b, c=c: c["t0"] + b * c["p"]  # noqa: E731
        nb = int(round(c["beats"] * 4))
        ch = c["acordes"][0]
        if tp in ("intro", "A") and c["t0"] < primer_build["t0"] - 1e-6:  # tic-tac antes del primer build
            for k in range(nb):
                t = T(k / 4)
                if t < primer_build["t0"] - c["p"]:
                    pistas["tick"].poner(
                        S.estereo(S.filtrar(S.hat(False, 500 + k % 3)[:, 0], "low", 9000), 0.25 if k % 2 else -0.25),
                        t,
                        0.5 if k % 4 == 0 else 0.25,
                    )
        if tp == "intro":
            for b in range(int(c["beats"])):
                if primera_secc is None or T(b) < primera_secc:
                    pistas["sub"].poner(S.sub(S.hz(RAIZ[ch]), 0.25, release=0.15), T(b), 0.6)
        if tp in ("intro", "A", "build"):  # ostinato desde la primera sección hasta la semicorchea previa a la caída
            for k in range(nb):
                t = T(k / 4)
                if primera_secc is not None and t < primera_secc - 0.03 and tp == "intro":
                    continue
                if tp == "build" and t >= ultimo_dieciseisavo(c) - 1e-6:
                    break
                apertura = min(1.0, max(0.0, (t - (primera_secc or 0)) / max(1.0, P[0] - (primera_secc or 0))))
                corte0 = 2200 + 5000 * apertura**2
                pistas["ostinato"].poner(
                    S.estereo(
                        S.pluck_sierra(
                            S.hz(OST[acorde_en(compases, t)][k % 8]),
                            0.18,
                            corte0=corte0,
                            corte1=350,
                            tau_f=0.05,
                            tau=0.09,
                            q=1.5,
                        ),
                        0.65 if k % 2 else -0.65,
                    ),
                    t,
                    0.55 + 0.25 * (k % 4 == 0),
                )
        if tp == "A":
            for off, g in ((0, 0.8), (1.5, 0.6), (3.5, 0.45)):
                if off < c["beats"] and T(off) < stop - 1e-6:
                    kicks.append(T(off))
                    pistas["bombo"].poner(
                        S.bombo(0.6, f0=120, f1=42, tau=0.42, drive=2.2, semilla=ci * 10 + int(off * 2)), T(off), g
                    )
                    pistas["sub"].poner(S.sub(S.hz(RAIZ[ch] - 12), 0.35, release=0.2), T(off), 0.5)
            if c["beats"] > 2:
                pistas["caja"].poner(S.caja(0.5, 170, semilla=ci), T(2), 0.7)
        elif tp == "build":
            L = c["beats"]
            golpes = (
                [i * 0.5 for i in range(int(L - 2) * 2)]
                + [L - 2 + i * 0.25 for i in range(4)]
                + [L - 1 + i * 0.125 for i in range(6)]
            )
            menores_aqui = [cc["t"] for cc in cortes if cc["rol"] == "menor" and c["t0"] <= cc["t"] < c["fin"]]
            for b in golpes:
                if any(abs(T(b) - tm) < 0.06 for tm in menores_aqui):
                    continue
                frac = b / (L - 0.25)
                # redoble de toms que sube de 140 a 210 Hz, filtrado sobre 200 Hz: el grave queda guardado para la caída
                # (sin esto el escalón en graves del corte principal no llegaba a 6 dB)
                tm = S.filtrar(S.tom(0.35, 140 + 70 * frac, semilla=int(b * 8) + 300 + ci), "high", 200, orden=4)
                pistas["tom"].poner(tm, T(b), 0.8 * (0.2 + 0.42 * frac**1.4))
        elif tp == "drop":
            for off, g in ((0, 1.0), (0.75, 0.6), (1.5, 0.85), (2.5, 0.7), (3.25, 0.5)):
                t = T(off)
                if off < c["beats"] and t < stop - 1e-6:
                    kicks.append(t)
                    pistas["bombo"].poner(
                        S.bombo(0.6, f0=125, f1=42, tau=0.4, drive=2.4, semilla=600 + ci * 8 + int(off * 4)), t, g
                    )
            if c["beats"] > 2 and T(2) < stop - 1e-6:
                pistas["caja"].poner(S.caja(0.55, 165, semilla=700 + ci), T(2), 1.0)
            largo = min(c["fin"], stop) - c["t0"] + 0.05
            if largo > 0.1:
                pistas["reese"].poner(reese_ancho(S.hz(RAIZ[ch]), largo, 380 + 120 * (ci % 4)), c["t0"], 0.8)
            for k in range(nb):
                if T(k / 4) < stop - 1e-6:
                    pistas["hats"].poner(
                        S.estereo(S.hat(False, 800 + k % 4), 0.35 if k % 4 < 2 else -0.35),
                        T(k / 4),
                        (0.5 if k % 2 == 0 else 0.25),
                    )
            for off, f, pan, g in ((3.5, 120, 0.4, 0.6), (3.75, 95, -0.4, 0.7)):
                if off < c["beats"] and T(off) < stop - 1e-6:
                    pistas["tom"].poner(S.estereo(S.tom(0.4, f, 750 + ci)[:, 0], pan), T(off), g)
    # caídas: braam + platillo + sub en cada principal; platillo cada 2 compases de caída
    for i, t in enumerate(P):
        pistas["braam"].poner(S.braam(BRAAM[acorde_en(compases, t)], 2.6, semilla=3 + i, abre=3200), t, 1.2)
        pistas["platillo"].poner(S.platillo(2.6, 80 + i, oscuro=True), t, 0.8)
        pistas["sub"].poner(S.sub(S.hz("D1"), 1.6, glide_desde=110, tau_glide=0.12, release=1.0), t, 1.0)
    for k, c in enumerate([c for c in compases if c["tipo"] == "drop"]):
        if k % 4 == 2:
            pistas["platillo"].poner(S.platillo(2.0, 82 + k, oscuro=True), c["t0"], 0.6)
    # acentos en los cortes (instante exacto)
    k_metal = 0
    for cc in cortes:
        t = cc["t"]
        if cc["rol"] == "principal" or abs(t - t_fin) < 0.06:
            continue
        cp = compas_de(compases, t)
        ch = acorde_en(compases, t)
        if cc["rol"] == "menor" and cp["tipo"] == "intro":  # golpe de apertura (destello del logo)
            m = S.golpe_metal(220.0, 2.2, 9)
            pistas["metal"].poner(m, t, 0.8)
            pistas["metal"].poner(S.swell_invertido(S.estereo(m), min(1.0, t), ir_hall), t - min(1.0, t), 0.45)
            pistas["braam"].poner(S.braam(["D2", "A2", "D3"], 1.4, semilla=2, abre=1600), t, 0.6)
            pistas["sub"].poner(S.sub(S.hz("D1"), 1.0, glide_desde=90, tau_glide=0.08, release=0.6), t, 0.9)
        elif cc["rol"] == "menor" and cp["tipo"] == "build":
            # dentro del build el acento va sin grave (filtrado sobre 140 Hz): el grave se guarda para la caída
            pistas["tom"].poner(S.filtrar(S.tom(0.8, 72, 350, golpe=1.4), "high", 140), t, 1.1)
            pistas["caja"].poner(S.caja(0.4, 165, semilla=351), t, 0.7)
        elif cc["rol"] == "menor":
            pistas["metal"].poner(
                S.estereo(
                    S.golpe_metal([260.0, 196.0][k_metal % 2], 1.4, 30 + k_metal), -0.5 if k_metal % 2 == 0 else 0.5
                ),
                t,
                0.6,
            )
            k_metal += 1
        elif t == salida:
            pistas["tom"].poner(S.tom(0.9, 62, 900, golpe=1.4), t, 1.0)
            pistas["platillo"].poner(S.platillo(1.2, 83, oscuro=True), t, 0.6)
        elif cp["tipo"] == "build" or (
            (cp["fin"] - t) < cp["p"] * 1.01 and compas_de(compases, cp["fin"] + 1e-3)["tipo"] == "build"
        ):
            pistas["caja"].poner(S.caja(0.5, 160, semilla=77), t, 1.0)
            pistas["tom"].poner(S.tom(0.7, 80, 78), t, 0.9)
            pistas["platillo"].poner(S.platillo(1.6, 79, oscuro=True), t, 0.6)
        elif cp["tipo"] == "drop":
            pistas["braam"].poner(S.braam(BRAAM[ch][1:], 0.9, semilla=4, abre=2000), t, 0.7)
            pistas["platillo"].poner(S.platillo(1.6, 81, oscuro=True), t, 0.5)
        else:
            pistas["tom"].poner(S.tom(0.9, 65, 20, golpe=1.2), t, 1.0)
            pistas["sub"].poner(S.sub(S.hz("D1"), 0.8, glide_desde=80, release=0.5), t, 0.8)
            pistas["metal"].poner(S.golpe_metal(330.0, 1.0, 21), t, 0.35)
    # final: braam con el logo, cola hasta el final del video; swell desde el corte de salida
    largo = D - t_fin
    final = S.braam(["D1", "D2", "A2", "D3", "F3"], largo, semilla=5, abre=2800, cierra=200)
    pistas["braam"].poner(final, t_fin, 1.0)
    if salida and t_fin - salida > 0.2:
        pistas["braam"].poner(S.swell_invertido(final[: ns(1.0)], t_fin - salida - 0.05, ir_hall), salida + 0.05, 0.4)
    pistas["metal"].poner(S.golpe_metal(147.0, largo, 33), t_fin, 0.7)
    pistas["sub"].poner(
        S.sub(S.hz("D1"), max(0.2, largo - 0.1), glide_desde=120, tau_glide=0.1, release=min(1.6, largo * 0.6)),
        t_fin,
        1.0,
    )
    pistas["platillo"].poner(S.platillo(largo, 84, oscuro=True), t_fin, 0.7)
    kicks.append(t_fin)
    pistas["bombo"].poner(S.bombo(0.9, f0=110, f1=38, tau=0.7, drive=2.6, semilla=901), t_fin, 1.0)
    envios = {
        "bombo": (1.0, 0.08, 0.0, 0.0, None, None),
        "caja": (0.55, 0.45, 0.15, 0.0, 120, None),
        "tom": (0.6, 0.3, 0.15, 0.0, 50, None),
        "hats": (0.14, 0.05, 0.0, 0.0, 500, None),
        "platillo": (0.3, 0.0, 0.2, 0.0, 300, None),
        "sub": (0.42, 0.0, 0.0, 0.0, 25, "fuerte"),
        "reese": (0.32, 0.0, 0.0, 0.0, 35, "fuerte"),
        "drone": (0.4, 0.0, 0.25, 0.0, 60, "suave"),
        "ostinato": (0.44, 0.05, 0.22, 0.3, 150, "suave"),
        "braam": (0.55, 0.0, 0.3, 0.0, 45, None),
        "metal": (0.32, 0.0, 0.45, 0.1, 150, None),
        "tick": (0.2, 0.1, 0.05, 0.1, 2000, None),
    }
    # -12,5 dB en 40 Hz: el sub en D1 (37 Hz) se comía el margen (medir_pista.py, criterio 2)
    mix = mezclar(
        pistas,
        envios,
        ir_sala,
        ir_hall,
        kicks,
        0.75 * p,
        D,
        eq=[(40, -12.5, 1.0), (120, -3.5, 0.9), (2400, 4.0, 0.8), (12000, -4.0, 0.7)],
    )
    sfx = {
        "sfx-whoosh-corto.wav": S.sfx_whoosh(0.65, 0.7, f_lo=250, f_hi=4000, semilla=21, oscuro=True),
        "sfx-whoosh-largo.wav": S.sfx_whoosh(
            1.1, 0.75, f_lo=200, f_hi=3000, pan0=0.8, pan1=-0.8, semilla=24, oscuro=True
        ),
        "sfx-whoosh-salida.wav": S.sfx_whoosh(0.6, 0.72, f_lo=300, f_hi=5000, semilla=25, oscuro=True),
        "sfx-riser.wav": S.sfx_riser(2.2, f0=120, f1=900, semilla=22, oscuro=True),
        "sfx-impacto.wav": S.sfx_impacto(3.0, "trailer", semilla=23),
    }
    return mix, sfx, kicks


# ======================================================================= principal
RISER_MIN_S = 2.3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cortes")
    ap.add_argument("--estilo", required=True, choices=sorted(ESTILOS))
    ap.add_argument("--salida", required=True)
    ap.add_argument(
        "--video", default="video-mudo.mp4", help="video sin audio (ruta tal como la verá planificar_mezcla.py)"
    )
    ap.add_argument("--bpm", type=float, help="forzar tempo (por defecto se busca en el rango del estilo)")
    a = ap.parse_args()
    t0 = time.time()
    doc = json.load(open(a.cortes, encoding="utf-8"))
    D = float(doc["duracion_video_s"])
    cortes, P = clasificar([dict(c) for c in doc["cortes"]])
    bpm = a.bpm or buscar_tempo(cortes, P, ESTILOS[a.estilo]["rango"])
    p = 60 / bpm
    compases, t_fin, tipo_fin, t_boton, salida, final_ch = estructura(cortes, P, p, D, doc.get("final_s"), a.estilo)
    fn = corporativa if a.estilo == "corporativa" else trailer
    mix, sfx, kicks = fn(cortes, P, p, D, compases, t_fin, t_boton, salida, final_ch)
    os.makedirs(a.salida, exist_ok=True)
    # WAV float sin bloque PEAK (libsndfile le pone fecha y rompe la reproducibilidad byte a byte)
    wavfile.write(os.path.join(a.salida, "musica.wav"), SR, mix.astype(np.float32))
    for nombre, y in sfx.items():
        wavfile.write(os.path.join(a.salida, nombre), SR, (y * S.db(-1.0)).astype(np.float32))
    # puntos de golpe y efectos
    golpes = []
    for c in cortes:
        ancla = max([x for x in P if x <= c["t"] + 1e-9], default=P[0])
        k = (c["t"] - ancla) / p * 4
        golpes.append(
            {
                "corte": c.get("nombre", ""),
                "rol": c["rol"],
                "t": c["t"],
                "tiempos_desde_principal": round(k) / 4,
                "error_grilla_ms": round((k - round(k)) * p / 4 * 1000, 1),
                "acento": "instante exacto del corte",
            }
        )
    eventos = []
    for c in cortes:
        if c["rol"] == "principal":
            if c["t"] >= RISER_MIN_S:  # el riser dura ~2 s: con un principal más temprano no cabe
                eventos.append(
                    {
                        "nombre": f"riser hacia {c.get('nombre', 'principal')}",
                        "archivo": "sfx-riser.wav",
                        "alinear": "final",
                        "t": c["t"],
                    }
                )
            eventos.append(
                {
                    "nombre": f"IMPACTO en {c.get('nombre', 'principal')}",
                    "archivo": "sfx-impacto.wav",
                    "alinear": "onset",
                    "t": c["t"],
                }
            )
        elif c["rol"] == "seccion":
            cp = compas_de(compases, c["t"])
            archivo = (
                "sfx-whoosh-salida.wav"
                if c["t"] == salida
                else ("sfx-whoosh-largo.wav" if cp["tipo"] == "drop" else "sfx-whoosh-corto.wav")
            )
            eventos.append(
                {"nombre": f"whoosh {c.get('nombre', '')}", "archivo": archivo, "alinear": "pico", "t": c["t"]}
            )
    comp = {
        "estilo": a.estilo,
        "bpm": bpm,
        "tonalidad": ESTILOS[a.estilo]["tonalidad"],
        "duracion_s": D,
        "frecuencia_hz": SR,
        "principales": P,
        "final": {
            "t": round(t_fin, 4),
            "cae_en": tipo_fin,
            "asentamiento_logo_s": doc.get("final_s"),
            "boton_s": round(t_boton, 4) if t_boton else None,
            "corte_de_salida_s": salida,
        },
        "compases": [
            {"t0": round(c["t0"], 4), "tiempos": round(c["beats"], 3), "tipo": c["tipo"], "acordes": c["acordes"]}
            for c in compases
        ],
        "puntos_de_golpe": golpes,
        "eventos_sfx": eventos,
        "bombos": len(kicks),
        "derechos": "100 % propios: todo sintetizado por este código, sin muestras ni modelos de terceros",
    }
    json.dump(
        comp, open(os.path.join(a.salida, "composicion.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False
    )
    variante = {
        "nombre": os.path.basename(os.path.normpath(a.salida)),
        "video": a.video,
        "duracion_video_s": D,
        "salida": os.path.basename(os.path.normpath(a.salida)) + ".mp4",
        "musica": {
            "archivo": os.path.join(a.salida, "musica.wav"),
            "titulo": f"{a.estilo} (compuesta por código)",
            "entrada_s": 0.0,
            "bpm": bpm,
            "t0_fuera_de_beat": False,
            "fade_out_s": 0.3,
            "porque": "compuesta a la medida de los cortes; el final está compuesto y el fundido de 0,3 s es solo una garantía",
        },
        "efectos": [{**ev, "archivo": os.path.join(a.salida, ev["archivo"])} for ev in eventos],
    }
    json.dump(
        variante, open(os.path.join(a.salida, "variante.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False
    )
    tiempos.registrar("musica", T_INICIO, estilo=a.estilo, duracion_s=D, bpm=bpm)
    peor = max((abs(g["error_grilla_ms"]) for g in golpes), default=0)
    avisos = []
    if peor > 45:
        avisos.append(
            f"un corte queda a {peor} ms de la grilla (> 45 ms): mueve ese corte 1 o 2 cuadros en el storyboard, "
            "baja su peso para que el acento lo lleve un efecto, o prueba --bpm con otro tempo del rango"
        )
    if abs(t_fin - P[-1]) < 1e-6:
        avisos.append("el logo se asienta encima del último corte principal: ese corte es también el golpe final")
    if all(c["rol"] != "principal" or c["t"] < RISER_MIN_S for c in cortes):
        avisos.append("ningún principal deja espacio para el riser (>= 2,3 s): va solo el impacto")
    comp["avisos"] = avisos
    json.dump(
        comp, open(os.path.join(a.salida, "composicion.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False
    )
    print(
        json.dumps(
            {
                "estilo": a.estilo,
                "bpm": bpm,
                "compases_hasta_el_final": len(compases),
                "principales": len(P),
                "final_s": round(t_fin, 4),
                "peor_error_grilla_ms": peor,
                "avisos": avisos,
                "tiempo_s": round(time.time() - t0, 1),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
