#!/usr/bin/env python3
"""Planifica y ejecuta la mezcla de una variante de escucha (vía nativa: video mudo + ffmpeg).

Uso: python3 -I planificar_mezcla.py variante.json [--solo-audio]
  --solo-audio: deja el master en audio.m4a sin unirlo al video (para mezclar mientras el video se renderiza); después,
  `bash mezcla.sh unir` (o el ffmpeg de la última línea) lo une al video sin recodificar.
Escribe junto al json: mezcla.sh (los comandos ffmpeg literales, para reproducir la mezcla con bash), plan.json
(parámetros calculados y su porqué), stems/musica.wav, stems/efectos.wav y el MP4 final.
La mezcla la ejecuta este script con los mismos comandos de mezcla.sh (mezclar(), más abajo), así corre igual en Linux,
macOS y Windows sin bash. Con REELSMITH_MEZCLA_BASH=1 la ejecuta bash con mezcla.sh: los dos caminos dan el mismo
audio.m4a, byte a byte.

Reglas de oficio que aplica:
  - Música: entra en el archivo en `entrada_s`. Con la pista de componer.py es 0: ya viene escrita a la medida de los
    cortes. (Con una pista ajena, entrada_s es el punto que hace caer su golpe o caída en un corte.) Si t = 0 del video no cae en un beat (más de 40 ms), fundido de
    entrada de un beat (60/BPM s, curva qsin); fundido de salida en los últimos 1,5 s (curva cuadrática: -12 dB a la mitad,
    que se oye parejo; la de cuarto de seno se mantiene alta y cae de golpe, y suena a corte); la mezcla dura exactamente lo
    que dura el video.
  - Efectos: cada uno se alinea por su punto de oficio: impactos por el ataque (onset), whooshes por su
    pico, risers por su final. Nivel: el máximo momentáneo del efecto (400 ms) queda `rel_db` por debajo
    del nivel de corto plazo de la música (3 s) en ese instante; por defecto -8 dB (rango pedido -6 a -10).
  - Todo a 48 kHz en float (remuestreo soxr de ffmpeg, o el de ffmpeg si ese build no trae libsoxr, como el de Homebrew); master con ganancia lineal a -14 LUFS medidos con ebur128 y techo de -2 dBTP antes del AAC (limitador de pico verdadero si hace falta; el MP4 queda bajo -1,2 dBTP; si no, se baja la ganancia y se recodifica); video copiado.
  - Guardas (red team): (a) antes de mezclar, la música debe estar presente en el 90 % del video (nivel de corto plazo a
    10 LU o menos de su integrado; se excluye el fundido de salida). Una entrada en una intro silenciosa o de ruido se
    rechaza con código 3 en vez de producir un MP4 que "pasa" los chequeos de loudness con 8 s de silencio.
    (b) la referencia de nivel de cada efecto tiene un piso en el integrado de la música menos 10 LU: sin piso, un efecto
    sobre silencio recibe ganancia -inf dB y desaparece. (c) tras mezclar, los stems deben salir a 48 kHz, estéreo y con
    exactamente duración x 48000 muestras; si alguien edita mezcla.sh y quita la normalización de entrada, falla aquí.
"""

import time

T_INICIO = time.time()  # reloj desde el arranque del proceso (tiempos.jsonl)
import json  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import shlex  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402

for _flujo in (sys.stdout, sys.stderr):  # Windows: la consola y las tuberías no son UTF-8 por defecto
    if hasattr(_flujo, "reconfigure"):
        _flujo.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402
import pyloudnorm as pyln  # noqa: E402
import soundfile as sf  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiempos  # noqa: E402

SR = 48000


def _hay_soxr():
    """El remuestreador SoX (libsoxr) es opcional en ffmpeg: el ffmpeg de Homebrew (macOS) no lo trae. Sin él se usa
    el de ffmpeg (swr) con un filtro largo; en las pistas de 48 kHz no cambia nada (no hay que remuestrear)."""
    if os.environ.get("REELSMITH_SIN_SOXR"):  # para probar el camino sin libsoxr
        return False
    try:
        r = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=44100:cl=mono",
                "-t",
                "0.05",
                "-af",
                "aresample=48000:resampler=soxr",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
        )
        return r.returncode == 0
    except OSError:
        return False


REMUESTREO = "resampler=soxr:precision=28" if _hay_soxr() else "resampler=swr:filter_size=128:cutoff=0.97"
REMUESTREO_CORTO = "resampler=soxr" if REMUESTREO.startswith("resampler=soxr") else "resampler=swr:filter_size=64"
# primera etapa de TODA entrada, en numpy y en ffmpeg: frecuencia y canales fijos antes de contar muestras
NORMALIZAR = f"aresample=48000:{REMUESTREO},aformat=sample_fmts=flt:channel_layouts=stereo"


def leer(path):
    """Decodifica cualquier entrada exactamente como lo hará el grafo de ffmpeg: 48 kHz (SoX), estéreo, float.
    Así los cálculos en muestras (entrada, retardos) valen igual en numpy y en ffmpeg aunque la pista venga a
    44,1 kHz o en mono (red team: con muestras calculadas a 48 kHz sobre un archivo a 44,1 kHz el impacto se corre
    845 ms y la caída de la música 6,4 s)."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-af", NORMALIZAR, "-f", "f32le", "-"], capture_output=True
    )
    if p.returncode != 0:
        raise SystemExit(
            f"ffmpeg no pudo leer {path} (código {p.returncode}):\n{p.stderr.decode(errors='replace')[-2000:]}"
        )
    return np.frombuffer(p.stdout, dtype="<f4").reshape(-1, 2).astype(np.float64)


def env_db(y, win_s):
    m = (y**2).mean(1)
    w = max(1, int(win_s * SR))
    return 10 * np.log10(np.convolve(m, np.ones(w) / w, "same") + 1e-12)


def punto_de_alineacion(y, modo):
    """Instante dentro del archivo del efecto que debe coincidir con el evento del video."""
    e5 = env_db(y, 0.005)
    if modo == "onset":  # primer cruce a 20 dB del máximo de la envolvente de 5 ms
        return int(np.argmax(e5 >= e5.max() - 20))
    if modo == "pico":  # máximo de la envolvente de 50 ms
        return int(np.argmax(env_db(y, 0.05)))
    if modo == "final":  # último instante a 20 dB del máximo (final abrupto de un riser)
        idx = np.where(e5 >= e5.max() - 20)[0]
        return int(idx[-1])
    raise ValueError(modo)


def m_max(meter, y):
    """Máximo de la sonoridad momentánea (bloques de 400 ms, salto 100 ms)."""
    best = -np.inf
    for i in range(0, max(1, len(y) - int(0.4 * SR)), int(0.1 * SR)):
        seg = y[i : i + int(0.4 * SR)]
        if len(seg) < int(0.4 * SR):
            break
        with np.errstate(divide="ignore"):
            v = meter.integrated_loudness(seg)
        if np.isfinite(v):
            best = max(best, v)
    return float(best)


def _rel(p, base):
    try:
        return os.path.relpath(p, base)
    except ValueError:  # Windows: otra unidad de disco
        return os.path.abspath(p)


def _medir(ruta, cwd):
    """Lo mismo que medir() en mezcla.sh: sonoridad integrada y pico verdadero del resumen de ebur128, como texto."""
    p = subprocess.run(
        ["ffmpeg", "-nostats", "-i", ruta, "-af", "ebur128=peak=true", "-f", "null", "-"],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    i = tp = None
    en_i = en_tp = False
    for linea in (p.stdout + p.stderr).splitlines():
        campos = linea.split()
        if "Integrated loudness:" in linea:
            en_i = True
        if en_i and " I:" in linea and len(campos) > 1:
            i, en_i = campos[1], False
        if "True peak:" in linea:
            en_tp = True
        if en_tp and "Peak:" in linea and len(campos) > 1:
            tp, en_tp = campos[1], False
    if i is None or tp is None:
        raise SystemExit(f"ebur128 no dio sonoridad o pico de {ruta} (código {p.returncode}):\n{p.stderr[-2000:]}")
    return i, tp


def _ffmpeg(args, cwd):
    p = subprocess.run(["ffmpeg", *args], cwd=cwd)
    if p.returncode != 0:
        raise SystemExit(f"falló ffmpeg (código {p.returncode}): ffmpeg {' '.join(args)[:600]}")


def mezclar(base, entradas_rel, grafo_stems, dur, video_rel, salida, solo_audio):
    """Los pasos 1 a 5 de mezcla.sh, con los mismos argumentos de ffmpeg y la misma aritmética (los valores de ebur128
    pasan como texto, igual que en bash), sin bash: así corre igual en Windows."""
    os.makedirs(os.path.join(base, "stems"), exist_ok=True)
    ins = [x for p in entradas_rel for x in ("-i", p)]
    # 1) mezcla cruda + stems
    _ffmpeg(
        [
            "-y",
            "-v",
            "error",
            *ins,
            "-filter_complex",
            f"\n  {grafo_stems}",
            "-map",
            "[mix]",
            "-c:a",
            "pcm_f32le",
            "stems/mezcla-cruda.wav",
            "-map",
            "[stm]",
            "-c:a",
            "pcm_f32le",
            "stems/musica.wav",
            "-map",
            "[stf]",
            "-c:a",
            "pcm_f32le",
            "stems/efectos.wav",
        ],
        base,
    )
    # 2) medición; limitador de pico verdadero si la ganancia rompería el techo de -2,0 dBTP
    i, tp = _medir("stems/mezcla-cruda.wav", base)
    g = -14 - (float(i))
    necesita = "si" if float(tp) + g > -2.0 else "no"
    master_in = "stems/mezcla-cruda.wav"
    if necesita == "si":
        c = -2.3 - g
        lim = round(10 ** (c / 20), 4)
        _ffmpeg(
            [
                "-y",
                "-v",
                "error",
                "-i",
                "stems/mezcla-cruda.wav",
                "-af",
                f"aresample=192000:{REMUESTREO_CORTO},alimiter=limit={lim}:attack=1:release=60:level=0:latency=1,aresample=48000:{REMUESTREO_CORTO}",
                "-c:a",
                "pcm_f32le",
                "stems/mezcla-limitada.wav",
            ],
            base,
        )
        master_in = "stems/mezcla-limitada.wav"
        i, tp = _medir(master_in, base)
    print(f"master: limitador previo={necesita} · entrada I={i} LUFS TP={tp} dBTP", flush=True)
    # 3) y 4) ganancia lineal a -14 LUFS y AAC; si el pico verdadero del AAC pasa de -1,2 dBTP, se baja y se recodifica
    aten = 0
    for vuelta in (1, 2, 3):
        gan = round(-14 - (float(i)) - aten, 3)
        _ffmpeg(
            [
                "-y",
                "-v",
                "error",
                "-i",
                master_in,
                "-af",
                f"volume={gan}dB",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "48000",
                "-t",
                f"{dur}",
                "audio.m4a",
            ],
            base,
        )
        tpf = _medir("audio.m4a", base)[1]
        print(
            f"AAC: vuelta {vuelta}, ganancia {gan} dB (atenuación {aten} dB), pico verdadero del master {tpf} dBTP",
            flush=True,
        )
        if float(tpf) <= -1.2:
            break
        aten = round(float(aten) + float(tpf) + 1.5, 2)
    # 5) unir al video sin recodificar
    if not solo_audio:
        _ffmpeg(
            [
                "-y",
                "-v",
                "error",
                "-i",
                video_rel,
                "-i",
                "audio.m4a",
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c",
                "copy",
                "-t",
                f"{dur}",
                "-movflags",
                "+faststart",
                salida,
            ],
            base,
        )
        print(f"listo: {salida}")
    else:
        print("listo: audio.m4a (falta unirlo al video: bash mezcla.sh unir)")


def main():
    cfg_path = [a for a in sys.argv[1:] if not a.startswith("--")][0]
    solo_audio = "--solo-audio" in sys.argv
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    base = os.path.dirname(os.path.abspath(cfg_path))
    os.makedirs(os.path.join(base, "stems"), exist_ok=True)
    dur = float(cfg["duracion_video_s"])
    meter = pyln.Meter(SR)  # BS.1770-4, ponderación K
    t0 = time.time()

    # ---------- música ----------
    mus = leer(cfg["musica"]["archivo"])
    s = float(cfg["musica"]["entrada_s"])
    bpm = float(cfg["musica"]["bpm"])
    fade_in = 60.0 / bpm if cfg["musica"].get("t0_fuera_de_beat", False) else 0.0
    fade_in = float(cfg["musica"].get("fade_in_s", fade_in))
    fade_out = float(cfg["musica"].get("fade_out_s", 1.5))
    i_s = int(round(s * SR))
    tramo = mus[i_s : i_s + int(dur * SR)]
    if len(tramo) < int(dur * SR):  # pista más corta que el video desde esa entrada: silencio hasta el final
        tramo = np.vstack([tramo, np.zeros((int(dur * SR) - len(tramo), 2))])
    # nivel de corto plazo de la música (3 s) en cada evento, medido sobre el tramo que realmente sonará,
    # con los fundidos aplicados (se aplican igual que en el filtro ffmpeg de abajo)
    tt = np.arange(len(tramo)) / SR
    g = np.ones(len(tramo))
    if fade_in > 0:
        k = tt < fade_in
        g[k] = np.sin(np.pi / 2 * tt[k] / fade_in)  # qsin
    k = tt >= dur - fade_out
    g[k] = np.clip((dur - tt[k]) / fade_out, 0, 1) ** 2  # squ: -12 dB a mitad del fundido, perceptualmente parejo
    tramo_f = tramo * g[:, None]
    I_tramo = float(meter.integrated_loudness(tramo_f))  # con compuertas BS.1770: ignora el silencio
    piso_ref = I_tramo - 10.0 if np.isfinite(I_tramo) else -40.0
    S_mus = []
    for i in range(0, int((dur - fade_out) * SR) - int(3 * SR) + 1, int(0.1 * SR)):
        with np.errstate(divide="ignore"):
            S_mus.append(float(meter.integrated_loudness(tramo_f[i : i + int(3 * SR)])))
    S_mus = np.array(S_mus)
    presencia = float(np.mean(S_mus >= piso_ref)) if len(S_mus) else 0.0
    hueco = None
    if presencia < 0.9:
        bajos = np.where(S_mus < piso_ref)[0]
        hueco = [
            0.0 if bajos[0] == 0 else round(float(bajos[0] * 0.1 + 1.5), 1),
            round(float(bajos[-1] * 0.1 + 1.5), 1),
        ]  # centros de ventana
    diag_musica = {"integrado_tramo_lufs": round(I_tramo, 2), "presencia": round(presencia, 3), "hueco_aprox_s": hueco}
    if presencia < 0.9 and not cfg["musica"].get("permitir_huecos", False):
        json.dump(
            {
                "variante": cfg["nombre"],
                "error": "musica_ausente",
                **diag_musica,
                "explicacion": "la música no suena en al menos el 90 % del video desde esta entrada (intro de silencio o ruido, "
                "o el final del archivo). Revise entrada_s o declare permitir_huecos.",
            },
            open(os.path.join(base, "plan.json"), "w", encoding="utf-8"),
            indent=1,
            ensure_ascii=False,
        )
        print(
            f"ERROR musica_ausente: presencia {presencia:.0%} (< 90 %), hueco aprox. {hueco} s, entrada {s} s",
            file=sys.stderr,
        )
        sys.exit(3)

    filtros = []
    entradas = [cfg["musica"]["archivo"]]
    # Tiempos por conteo de muestras, no por PTS: tras adelay/apad, ffmpeg 6.1 puede dejar marcas de tiempo que hacen que un
    # atrim por segundos descarte el audio (red team: un whoosh de 24 bits desapareció). asetpts=N/SR/TB + atrim por muestras.
    n_tot = int(dur * SR)
    musica_f = (
        f"[0:a]{NORMALIZAR},atrim=start_sample={i_s}:end_sample={i_s + n_tot},asetpts=N/SR/TB,"
        + (f"afade=t=in:st=0:d={fade_in:.4f}:curve=qsin," if fade_in > 0 else "")
        + f"afade=t=out:st={dur - fade_out:.4f}:d={fade_out:.4f}:curve=squ,"
        + f"apad=whole_len={n_tot},asetpts=N/SR/TB,atrim=end_sample={n_tot}[mus]"
    )
    filtros.append(musica_f)

    # ---------- efectos ----------
    plan_fx = []
    etiquetas = []
    for n, ev in enumerate(cfg["efectos"], start=1):
        y = leer(ev["archivo"])
        i_al = punto_de_alineacion(y, ev["alinear"])
        t_ev = float(ev["t"])
        start = t_ev - i_al / SR
        recorte = 0
        if start < 0:  # el efecto empezaría antes de t = 0: se recorta su cabeza
            recorte = int(round(-start * SR))
            start = 0.0
        delay = int(round(start * SR))
        a, b = int((t_ev - 1.5) * SR), int((t_ev + 1.5) * SR)
        with np.errstate(divide="ignore"):
            mus_S_real = float(meter.integrated_loudness(tramo_f[max(0, a) : min(len(tramo_f), b)]))
        mus_S = max(mus_S_real, piso_ref)  # piso: sin música en el evento, el efecto se nivela contra la música típica
        fx_M = m_max(meter, y[recorte:])
        rel = float(ev.get("rel_db", -8.0))
        gain_db = (mus_S + rel) - fx_M
        entradas.append(ev["archivo"])
        lab = f"fx{n}"
        filtros.append(
            f"[{n}:a]{NORMALIZAR},"
            + (f"atrim=start_sample={recorte}," if recorte else "")
            + f"asetpts=N/SR/TB,volume={gain_db:.2f}dB,adelay={delay}S:all=1,"
            + f"apad=whole_len={int(dur * SR)},asetpts=N/SR/TB,atrim=end_sample={int(dur * SR)}[{lab}]"
        )
        etiquetas.append(f"[{lab}]")
        plan_fx.append(
            {
                "evento": ev.get("nombre", ""),
                "archivo": os.path.basename(ev["archivo"]),
                "alinear": ev["alinear"],
                "t_evento_s": t_ev,
                "punto_en_archivo_s": round(i_al / SR, 4),
                "inicio_en_video_s": round(start, 5),
                "delay_muestras": delay,
                "musica_S_lufs": round(mus_S, 2),
                "musica_S_real_lufs": round(mus_S_real, 2),
                "referencia": "música en el evento"
                if mus_S_real >= piso_ref
                else "piso (música ausente o muy baja en el evento)",
                "efecto_Mmax_lufs": round(fx_M, 2),
                "rel_objetivo_db": rel,
                "ganancia_db": round(gain_db, 2),
            }
        )

    # Efectos apilados (por ejemplo riser + impacto en el mismo corte) suman nivel: se simula el bus de efectos en
    # numpy y, para cada evento, si el máximo momentáneo de su ventana supera el objetivo, se baja por igual a todos
    # los efectos que suenan en esa ventana. Tres pasadas bastan para converger.
    señales = [leer(ev["archivo"]) for ev in cfg["efectos"]]

    def colocar(p_, y_, a=0, b=None):
        """Un efecto colocado en la línea de tiempo; con a y b, solo esa ventana (mismos valores)."""
        if b is not None:
            return simular_uno(p_, y_, a, b)
        out = np.zeros((int(dur * SR), 2))
        rec = (
            int(round(max(0.0, p_["punto_en_archivo_s"] - p_["t_evento_s"]) * SR))
            if p_["inicio_en_video_s"] == 0.0
            else 0
        )
        seg = y_[rec:] * 10 ** (p_["ganancia_db"] / 20)
        d0 = p_["delay_muestras"]
        n_ = min(len(seg), len(out) - d0)
        if n_ > 0:
            out[d0 : d0 + n_] += seg[:n_]
        return out

    def simular_uno(p_, y_, a, b):
        out = np.zeros((b - a, 2))
        rec = (
            int(round(max(0.0, p_["punto_en_archivo_s"] - p_["t_evento_s"]) * SR))
            if p_["inicio_en_video_s"] == 0.0
            else 0
        )
        d0 = p_["delay_muestras"]
        n_ = min(len(y_) - rec, int(dur * SR) - d0)
        i0, i1 = max(a, d0), min(b, d0 + max(0, n_))
        if i1 > i0:
            out[i0 - a : i1 - a] += y_[rec + i0 - d0 : rec + i1 - d0] * 10 ** (p_["ganancia_db"] / 20)
        return out

    def simular(a=0, b=None):
        """Bus de efectos entre las muestras a y b. Solo se construye esa ventana: los valores son idénticos (bit a bit)
        a los del bus completo, porque fuera de su tramo cada efecto aporta ceros. Construir el bus entero en cada
        ajuste se llevaba 17 de los 54 s en un video de 90 s con 14 efectos."""
        b = int(dur * SR) if b is None else b
        out = np.zeros((b - a, 2))
        for p_, y_ in zip(plan_fx, señales, strict=False):
            rec = (
                int(round(max(0.0, p_["punto_en_archivo_s"] - p_["t_evento_s"]) * SR))
                if p_["inicio_en_video_s"] == 0.0
                else 0
            )
            d0 = p_["delay_muestras"]
            n_ = min(len(y_) - rec, int(dur * SR) - d0)
            i0, i1 = max(a, d0), min(b, d0 + max(0, n_))
            if i1 > i0:
                out[i0 - a : i1 - a] += y_[rec + i0 - d0 : rec + i1 - d0] * 10 ** (p_["ganancia_db"] / 20)
        return out

    def bloque_max(y):
        """Inicio (muestra) del bloque de 400 ms con mayor sonoridad momentánea."""
        best, ib = -np.inf, 0
        for i in range(0, max(1, len(y) - int(0.4 * SR)), int(0.1 * SR)):
            with np.errstate(divide="ignore"):
                v = (
                    meter.integrated_loudness(y[i : i + int(0.4 * SR)])
                    if len(y[i : i + int(0.4 * SR)]) == int(0.4 * SR)
                    else -np.inf
                )
            if np.isfinite(v) and v > best:
                best, ib = v, i
        return ib, best

    for _ in range(3):
        for p_ in plan_fx:
            a2 = int(max(0, p_["inicio_en_video_s"] - 0.05) * SR)
            b2 = int(min(dur, p_["t_evento_s"] + 1.0) * SR)
            bus_v = simular(a2, b2)  # se vuelve a simular tras cada ajuste para no corregir dos veces el mismo grupo
            exceso = (m_max(meter, bus_v) - p_["musica_S_lufs"]) - p_["rel_objetivo_db"]
            if exceso > 0.25:
                # solo bajan los efectos que de verdad suenan en el bloque del máximo (a 6 dB o menos del total);
                # un efecto que apenas empieza o termina en la ventana no se toca (red team con música propia:
                # un whoosh que tocaba el inicio silencioso del riser se bajaba 2,3 dB sin motivo)
                ib, nivel = bloque_max(bus_v)
                i0, i1 = a2 + ib, a2 + ib + int(0.4 * SR)
                for q_, y_ in zip(plan_fx, señales, strict=False):
                    with np.errstate(divide="ignore"):
                        aporte = meter.integrated_loudness(colocar(q_, y_, i0, i1))
                    if np.isfinite(aporte) and aporte >= nivel - 6.0:
                        q_["ganancia_db"] = round(q_["ganancia_db"] - exceso, 2)
                        q_["ajuste_por_apilamiento_db"] = round(q_.get("ajuste_por_apilamiento_db", 0) - exceso, 2)
    for n, p_ in enumerate(plan_fx, start=1):  # reescribir los filtros con las ganancias finales
        filtros[n] = re.sub(r"volume=-?[\d.]+dB", f"volume={p_['ganancia_db']:.2f}dB", filtros[n])

    fx_mix = (
        (
            "".join(etiquetas)
            + f"amix=inputs={len(etiquetas)}:normalize=0:duration=longest,asetpts=N/SR/TB,atrim=end_sample={int(dur * SR)}[fx]"
        )
        if len(etiquetas) > 1
        else (etiquetas[0] + "anull[fx]")
    )
    filtros.append(fx_mix)
    filtros.append(
        f"[mus][fx]amix=inputs=2:normalize=0:duration=longest,asetpts=N/SR/TB,atrim=end_sample={int(dur * SR)}[mix]"
    )
    grafo = ";\n  ".join(f for f in filtros if f)

    st_m, st_f, raw = (os.path.join(base, "stems", x) for x in ("musica.wav", "efectos.wav", "mezcla-cruda.wav"))
    q = shlex.quote
    entradas_rel = [_rel(p, base) for p in entradas]
    ins = " ".join(f"-i {q(p)}" for p in entradas_rel)
    video_rel = _rel(cfg["video"], base)
    # el mismo grafo se usa para la mezcla y para exportar los stems (asplit en cada bus)
    grafo_stems = grafo.replace("[mus];", "[mus0];").replace("[fx];", "[fx0];")
    grafo_stems = grafo_stems.replace("[mus][fx]amix", "[mus1][fx1]amix")
    grafo_stems += ";\n  [mus0]asplit=2[mus1][stm];\n  [fx0]asplit=2[fx1][stf]"
    sh = f"""#!/usr/bin/env bash
# Mezcla de la variante "{cfg["nombre"]}". Generado por planificar_mezcla.py; reproducible solo con ffmpeg.
# Música: {os.path.basename(cfg["musica"]["archivo"])} desde {s:.3f} s del archivo; {cfg["musica"].get("porque", "")}
set -euo pipefail
cd "$(dirname "$0")"
# "bash mezcla.sh unir": solo el paso 5 (unir audio.m4a al video), cuando la mezcla ya se hizo con --solo-audio
if [ "${{1:-}}" != "unir" ]; then
mkdir -p stems
# 1) mezcla cruda (float 48 kHz) + stems de música y efectos para verificar niveles
ffmpeg -y -v error {ins} -filter_complex "
  {grafo_stems}" \\
  -map "[mix]" -c:a pcm_f32le stems/mezcla-cruda.wav \\
  -map "[stm]" -c:a pcm_f32le stems/musica.wav \\
  -map "[stf]" -c:a pcm_f32le stems/efectos.wav
# 2) medición con ebur128 (BS.1770: sonoridad integrada y pico verdadero con sobremuestreo 4x). Objetivo de publicación
#    web: -14 LUFS integrado y techo de -2,0 dBTP ANTES del AAC (el códec agrega hasta ~0,5 dB de pico: así el MP4 queda
#    bajo -1 dBTP). La ganancia es lineal (volume). Si la ganancia rompería el techo, primero se limitan los picos con un
#    limitador de pico verdadero (sobremuestreo 4x + alimiter) y se vuelve a medir.
#    Hasta la versión 0.1.0 esto lo hacía loudnorm en dos pasadas: en modo lineal aplica la misma ganancia, pero
#    sobremuestrea todo el master a 192 kHz en cada pasada y se llevaba 31 de los 37 s de este script en un video de 90 s.
medir() {{ ffmpeg -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | awk '/Integrated loudness:/{{f=1}} f&&/ I:/{{i=$2; f=0}} /True peak:/{{g=1}} g&&/Peak:/{{p=$2; g=0}} END{{print i, p}}'; }}
read -r I TP < <(medir stems/mezcla-cruda.wav)
NECESITA=$(python3 -c "g=-14-($I); print('si' if $TP+g>-2.0 else 'no')")
MASTER_IN=stems/mezcla-cruda.wav
if [ "$NECESITA" = "si" ]; then
  # techo en el dominio previo a la ganancia: -2,0 dBTP - G, con 0,3 dB de margen por la estimación del sobremuestreo
  LIM=$(python3 -c "g=-14-($I); c=-2.3-g; print(round(10**(c/20),4))")
  ffmpeg -y -v error -i stems/mezcla-cruda.wav -af "aresample=192000:{REMUESTREO_CORTO},alimiter=limit=$LIM:attack=1:release=60:level=0:latency=1,aresample=48000:{REMUESTREO_CORTO}" -c:a pcm_f32le stems/mezcla-limitada.wav
  MASTER_IN=stems/mezcla-limitada.wav
  read -r I TP < <(medir "$MASTER_IN")
fi
echo "master: limitador previo=$NECESITA · entrada I=$I LUFS TP=$TP dBTP"
# 3) ganancia lineal hasta -14 LUFS → master AAC 192 kbps 48 kHz (audio.m4a)
# 4) el AAC puede subir el pico verdadero hasta ~1 dB (medido en estas pistas); si el master queda sobre -1,2 dBTP se baja la
#    ganancia lo justo para dejarlo en -1,5 dBTP y se vuelve a codificar (máximo 2 vueltas). El loudness baja ≤ 0,5 LU.
ATEN=0
for vuelta in 1 2 3; do
  G=$(python3 -c "print(round(-14-($I)-$ATEN, 3))")
  ffmpeg -y -v error -i "$MASTER_IN" -af "volume=${{G}}dB" -c:a aac -b:a 192k -ar 48000 -t {dur} audio.m4a
  TPF=$(medir audio.m4a | awk '{{print $2}}')
  echo "AAC: vuelta $vuelta, ganancia $G dB (atenuación ${{ATEN}} dB), pico verdadero del master $TPF dBTP"
  OK=$(python3 -c "print('si' if float('$TPF') <= -1.2 else 'no')")
  [ "$OK" = "si" ] && break
  ATEN=$(python3 -c "print(round(float('$ATEN') + float('$TPF') + 1.5, 2))")
done
fi  # fin de la mezcla (se salta con "unir")
# 5) unir el master al video mudo sin recodificar ninguno de los dos
if [ "${{SOLO_AUDIO:-0}}" != "1" ]; then
  ffmpeg -y -v error -i {q(video_rel)} -i audio.m4a -map 0:v -map 1:a -c copy -t {dur} -movflags +faststart {q(cfg["salida"])}
  echo "listo: {cfg["salida"]}"
else
  echo "listo: audio.m4a (falta unirlo al video: bash mezcla.sh unir)"
fi
"""
    sh_path = os.path.join(base, "mezcla.sh")
    with open(sh_path, "w", encoding="utf-8", newline="\n") as fsh:
        fsh.write(sh)
    os.chmod(sh_path, 0o755)
    t_plan = time.time() - t0
    t1 = time.time()
    if os.environ.get("REELSMITH_MEZCLA_BASH") == "1":  # para comprobar que mezcla.sh reproduce la misma mezcla
        subprocess.run(["bash", sh_path], check=True, env=dict(os.environ, SOLO_AUDIO="1" if solo_audio else "0"))
    else:
        mezclar(base, entradas_rel, grafo_stems, dur, video_rel, cfg["salida"], solo_audio)
    t_mix = time.time() - t1

    # ---------- formato de los stems: 48 kHz, estéreo, duración exacta ----------
    for st in (st_m, st_f, raw):
        info = sf.info(st)
        if info.samplerate != SR or info.channels != 2 or info.frames != int(dur * SR):
            print(
                f"ERROR formato_stem: {os.path.basename(st)} salió a {info.samplerate} Hz, {info.channels} canales, "
                f"{info.frames} muestras (se esperaban {SR} Hz, 2, {int(dur * SR)}). ¿Falta la normalización de entrada?",
                file=sys.stderr,
            )
            sys.exit(4)
    # ---------- verificación de niveles relativos sobre los stems renderizados ----------
    ms = leer(st_m)
    fs = leer(st_f)
    niveles = []
    for p in plan_fx:
        t_ev = p["t_evento_s"]
        a, b = int((t_ev - 1.5) * SR), int((t_ev + 1.5) * SR)
        with np.errstate(divide="ignore"):
            mus_S = max(float(meter.integrated_loudness(ms[max(0, a) : min(len(ms), b)])), piso_ref)
        a2 = int(max(0, p["inicio_en_video_s"] - 0.05) * SR)
        b2 = int(min(dur, t_ev + 1.0) * SR)
        fx_M = m_max(meter, fs[a2:b2])
        niveles.append(
            {
                "evento": p["evento"],
                "musica_S_lufs": round(mus_S, 2),
                "efecto_Mmax_lufs": round(fx_M, 2),
                "efecto_menos_musica_db": round(fx_M - mus_S, 2),
                "en_rango_-10_a_-6": bool(-10 <= fx_M - mus_S <= -6),
            }
        )
    plan = {
        "variante": cfg["nombre"],
        "salida": cfg["salida"],
        "musica": {
            **cfg["musica"],
            "fade_in_s": round(fade_in, 4),
            "fade_out_s": fade_out,
            "entrada_muestra": i_s,
            **diag_musica,
        },
        "efectos": plan_fx,
        "verificacion_niveles_stems": niveles,
        "tiempos_s": {
            "planificacion": round(t_plan, 2),
            "mezcla_ffmpeg": round(t_mix, 2),
            "total": round(t_plan + t_mix, 2),
        },
    }
    json.dump(plan, open(os.path.join(base, "plan.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    tiempos.registrar("mezcla", T_INICIO, planificacion_s=round(t_plan, 2), ffmpeg_s=round(t_mix, 2), duracion_s=dur)
    print(json.dumps(plan["tiempos_s"]), json.dumps(niveles, ensure_ascii=False))


if __name__ == "__main__":
    main()
