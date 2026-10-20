#!/usr/bin/env python3
"""Vara de producción y ritmo de una pista compuesta por componer.py (lo medible; el juicio final es de oído).

Uso: python3 -I medir_pista.py carpeta/composicion.json [--wav stems/musica.wav] [--png medicion.png] [--json salida.json]

Lee composicion.json (compases, principales, final) y la música (por defecto musica.wav junto al json; tras mezclar,
conviene pasar --wav con stems/musica.wav). Compara contra perfil-profesional.json: cifras medidas de 4 pistas
profesionales de Mixkit (los audios no vienen en la skill).

Criterios (PASA / REVISAR):
  1. espectro: tercios de octava entre 63 Hz y 10 kHz, 0 dB en 1 kHz, a 4 dB o menos de la envolvente de las
     referencias (mínimo y máximo por banda), medido desde 0 s hasta el golpe final (sin la cola). Fuera de eso suena
     delgada, opaca o chillona. (La primera corporativa, que se oía delgada, quedaba a 5-6 dB bajo la envolvente
     entre 150 y 630 Hz.)
  2. graves bajo 50 Hz: sin exceso sobre la referencia más cargada + 3 dB (el notebook no los reproduce y se comen
     el margen del limitador).
  3. ancho: correlación L/R sobre 300 Hz entre 0,15 y 0,60 (referencias: 0,17 a 0,43). Más alto suena angosta; más
     bajo, desarmada en mono.
  4. arco: la caída suena entre 1,5 y 2,5 LU más fuerte que la sección A (no aplica si no hay sección A).
  5. golpe en cada corte principal: escalón >= 6 dB en graves o en total (1 s antes contra 1 s después) y un ataque
     grave a 40 ms o menos del corte.
Informativo: loudness, PLR, correlación bajo 150 Hz, tempo de la composición.
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
import pyloudnorm as pyln  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import butter, sosfilt  # noqa: E402

SR = 48000
TOL_ESPECTRO_DB = 4.0
AQUI = os.path.dirname(os.path.abspath(__file__))


def sos(tipo, f):
    return butter(4, f, tipo, fs=SR, output="sos")


def tercios(y, frecs):
    m = y.mean(1)
    out = []
    for f in frecs:
        lo, hi = f / 2 ** (1 / 6), min(f * 2 ** (1 / 6), SR / 2 * 0.99)
        s = sosfilt(sos("band", [lo, hi]), m)
        out.append(10 * np.log10(np.mean(s**2) + 1e-20))
    out = np.array(out)
    return out - out[int(np.argmin(np.abs(np.array(frecs) - 1000)))]


def correlacion(y, tipo, f):
    h = sosfilt(sos(tipo, f), y, axis=0)
    return float(np.corrcoef(h[:, 0], h[:, 1])[0, 1])


def escalon_y_ataque(y, t):
    """Escalón de nivel (dB RMS) 1 s después contra 1 s antes, total y bajo 150 Hz; ataque grave más cercano."""
    m = y.mean(1)
    g = sosfilt(sos("low", 150), m)

    def rms(x, a, b):
        s = x[max(0, int(a * SR)) : int(b * SR)]
        return 20 * np.log10(np.sqrt(np.mean(s**2)) + 1e-12) if len(s) else -120.0

    esc_total = rms(m, t + 0.05, t + 1.0) - rms(m, t - 1.0, t - 0.05)
    esc_graves = rms(g, t + 0.05, t + 1.0) - rms(g, t - 1.0, t - 0.05)
    # ataque grave: primer instante, en +-80 ms, en que la envolvente grave (ventanas de 2 ms) supera la mitad de su
    # máximo de los 150 ms siguientes al corte
    w = int(0.002 * SR)
    a, b = int((t - 0.08) * SR), int((t + 0.15) * SR)
    seg = np.abs(g[max(0, a) : b])
    env = np.array([seg[i : i + w].max() for i in range(0, len(seg) - w, w)])
    i_corte = int(0.08 * SR) // w
    pico = env[i_corte:].max() if len(env) > i_corte else 0
    sobre = np.where(env >= 0.5 * pico)[0] if pico > 0 else np.array([])
    ataque_ms = abs((sobre[0] - i_corte) * w / SR * 1000) if len(sobre) else None
    return (
        round(float(esc_total), 1),
        round(float(esc_graves), 1),
        (round(float(ataque_ms), 1) if ataque_ms is not None else None),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("composicion")
    ap.add_argument("--wav")
    ap.add_argument("--png")
    ap.add_argument("--json")
    a = ap.parse_args()
    comp = json.load(open(a.composicion, encoding="utf-8"))
    wav = a.wav or os.path.join(os.path.dirname(os.path.abspath(a.composicion)), "musica.wav")
    y, sr = sf.read(wav, always_2d=True)
    if sr != SR:
        sys.exit(f"la pista debe estar a {SR} Hz (tiene {sr})")
    if y.shape[1] == 1:
        y = np.repeat(y, 2, 1)
    perfil = json.load(open(os.path.join(AQUI, "perfil-profesional.json"), encoding="utf-8"))
    F = np.array(perfil["frecuencias_hz"])
    R = np.array([p["tercios_db"] for p in perfil["pistas"]])
    lo, hi = R.min(0), R.max(0)
    # el espectro se mide sobre el cuerpo de la pista (hasta el golpe final): la cola es un acorde que se apaga y las
    # referencias son tramos de 20 s con la música en marcha
    fin_cuerpo = comp["final"]["t"] if comp["final"]["t"] > 5 else len(y) / SR
    b = tercios(y[: int(fin_cuerpo * SR)], F)
    crit = {}

    # 1. espectro
    sel = (F >= 60) & (F <= 10500)
    fuera = np.where(b < lo, b - lo, np.where(b > hi, b - hi, 0.0))
    malas = [
        {"hz": int(round(f)), "db_fuera": round(float(d), 1)}
        for f, d in zip(F[sel], fuera[sel], strict=False)
        if abs(d) > TOL_ESPECTRO_DB
    ]
    crit["1_espectro"] = {
        "pasa": not malas,
        "bandas_fuera_de_tolerancia": malas,
        "tolerancia_db": TOL_ESPECTRO_DB,
        "peor_db": round(float(fuera[sel][np.argmax(np.abs(fuera[sel]))]), 1),
        "lectura": "negativo = falta energía (delgada u opaca); positivo = sobra",
    }
    # 2. graves bajo 50 Hz
    sub = F < 56
    exceso = b[sub] - (hi[sub] + 3)
    crit["2_graves_bajo_50hz"] = {
        "pasa": bool((exceso <= 0).all()),
        "exceso_max_db": round(float(max(0.0, exceso.max())), 1),
    }
    # 3. ancho
    c300 = correlacion(y, "high", 300)
    crit["3_ancho"] = {
        "pasa": 0.15 <= c300 <= 0.60,
        "corr_sobre_300hz": round(c300, 2),
        "rango": [0.15, 0.60],
        "referencias": [p["corr_sobre_300hz"] for p in perfil["pistas"]],
    }
    # 4. arco
    meter = pyln.Meter(SR)
    integrado = meter.integrated_loudness(y)
    p = 60 / comp["bpm"]
    secc = {}
    for c in comp["compases"]:
        secc.setdefault(c["tipo"], []).append(y[int(c["t0"] * SR) : int((c["t0"] + c["tiempos"] * p) * SR)])
    arco = {}
    for k, v in secc.items():
        x = np.concatenate(v)
        if len(x) > 0.5 * SR:
            arco[k] = round(float(meter.integrated_loudness(x) - integrado), 1)
    if "drop" in arco and "A" in arco:
        d = arco["drop"] - arco["A"]
        crit["4_arco"] = {
            "pasa": 1.5 <= d <= 2.5,
            "caida_menos_A_lu": round(d, 1),
            "rango": [1.5, 2.5],
            "lu_vs_integrado": arco,
        }
    else:  # la intro es tenue a propósito: compararla con la caída no dice nada del arco
        crit["4_arco"] = {
            "pasa": None,
            "nota": "sin sección A o sin caída de duración suficiente: no aplica",
            "lu_vs_integrado": arco,
        }
    # 5. golpe en cada principal
    golpes = []
    for t in comp["principales"]:
        et, eg, at = escalon_y_ataque(y, t)
        golpes.append(
            {
                "t": t,
                "escalon_total_db": et,
                "escalon_graves_db": eg,
                "ataque_grave_ms": at,
                "pasa": max(et, eg) >= 6 and at is not None and at <= 40,
            }
        )
    crit["5_golpe_principal"] = {"pasa": all(g["pasa"] for g in golpes), "cortes": golpes}

    pico = 20 * np.log10(np.abs(y).max() + 1e-12)
    info = {
        "integrado_lufs": round(float(integrado), 1),
        "pico_dbfs": round(float(pico), 1),
        "plr_db": round(float(pico - integrado), 1),
        "corr_bajo_150hz": round(correlacion(y, "low", 150), 2),
        "bpm": comp["bpm"],
        "estilo": comp["estilo"],
        "tercios_db": {str(int(round(f))): round(float(x), 1) for f, x in zip(F, b, strict=False)},
    }
    evaluados = [v["pasa"] for v in crit.values() if v["pasa"] is not None]
    res = {
        "pista": wav,
        "resultado": "PASA" if all(evaluados) else "REVISAR",
        "criterios": crit,
        "informativo": info,
        "referencia": "perfil-profesional.json: "
        + ", ".join(f"{q['titulo']} (Mixkit {q['mixkit_id']})" for q in perfil["pistas"]),
    }
    if a.png:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(1, 2, figsize=(14, 4))
        ax[0].fill_between(F, lo, hi, color="0.85", label="envolvente profesional")
        ax[0].fill_between(
            F, lo - TOL_ESPECTRO_DB, hi + TOL_ESPECTRO_DB, color="0.93", zorder=0, label=f"±{TOL_ESPECTRO_DB:g} dB"
        )
        ax[0].semilogx(F, b, lw=2, color="#E72887", label=comp["estilo"])
        ax[0].set_xlim(30, 16000)
        ax[0].set_ylim(-30, 25)
        ax[0].set_xlabel("Hz (tercios de octava, 0 dB en 1 kHz)")
        ax[0].legend(fontsize=8)
        ax[0].grid(alpha=0.3, which="both")
        h = int(0.1 * SR)
        tt, ss = [], []
        for i in range(0, len(y) - 3 * SR, h):
            tt.append((i + 1.5 * SR) / SR)
            ss.append(meter.integrated_loudness(y[i : i + 3 * SR]) - integrado)
        ax[1].plot(tt, ss, color="#090E50", lw=1.5, label="corto plazo (3 s) vs integrado")
        for c in comp["compases"]:
            ax[1].axvline(c["t0"], color="0.85", lw=0.6)
        for t in comp["principales"]:
            ax[1].axvline(t, color="#E72887", lw=2)
        ax[1].axvline(comp["final"]["t"], color="#090E50", lw=1, ls="--")
        ax[1].set_ylim(-20, 6)
        ax[1].set_xlabel("s (rosa: cortes principales; punteado: golpe final)")
        ax[1].legend(fontsize=8)
        ax[1].grid(alpha=0.3)
        fig.suptitle(f"{comp['estilo']} · {comp['bpm']} bpm · {res['resultado']}", fontsize=10)
        fig.tight_layout()
        fig.savefig(a.png, dpi=100)
    sys.path.insert(0, AQUI)
    import tiempos

    tiempos.registrar("verificar_musica", T_INICIO, resultado=res["resultado"])
    txt = json.dumps(res, indent=1, ensure_ascii=False)
    if a.json:
        open(a.json, "w", encoding="utf-8").write(txt)
    print(txt)
    return 0 if res["resultado"] == "PASA" else 1


if __name__ == "__main__":
    sys.exit(main())
