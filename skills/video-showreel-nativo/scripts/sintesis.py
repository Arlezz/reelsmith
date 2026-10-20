"""Motor de síntesis propio para música y efectos de motion graphics (sin muestras externas: derechos 100 % propios).

Todo se genera con numpy/scipy/numba a 48 kHz en float64 estéreo, con semillas fijas: misma entrada, mismo audio.
Piezas:
  osciladores con polyBLEP (sierra, cuadrada), seno con frecuencia variable, ruido;
  filtro de estado variable (SVF) con corte variable por muestra; biquads fijos (scipy);
  reverb por convolución con respuestas de impulso sintéticas (decaimiento distinto por banda);
  delay ping-pong, compresor, sidechain, saturación;
  instrumentos: bombo, clap, caja, hats metálicos, platillo, tom, pluck FM, pluck de sierra, supersaw, bajo house,
  sub, reese, braam, golpe metálico, swell invertido;
  efectos de sonido: whoosh, riser, impacto.
"""
import functools

import numpy as np
from numba import njit
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
NOTAS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
         "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


# ---------------------------------------------------------------- utilidades
def ns(s):
    return int(round(s * SR))


def tt(n):
    return np.arange(n) / SR


def midi(nombre):
    """'A4' -> 69; 'C#3' -> 49."""
    return 12 * (int(nombre[-1]) + 1) + NOTAS[nombre[:-1]]


def hz(nota):
    m = midi(nota) if isinstance(nota, str) else nota
    return 440.0 * 2 ** ((m - 69) / 12)


def db(x):
    return 10 ** (x / 20)


def estereo(x, pan=0.0):
    """Mono -> estéreo con paneo de potencia constante (pan -1 izquierda, +1 derecha). Si ya es estéreo, lo deja."""
    if x.ndim == 2:
        return x
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)


def sos(tipo, f, orden=2):
    # el diseño del filtro se repite miles de veces con los mismos parámetros: se guarda (2 s de 18 en un video de 90 s)
    return _sos(tipo, tuple(f) if isinstance(f, (list, tuple, np.ndarray)) else float(f), orden)


@functools.lru_cache(maxsize=None)
def _sos(tipo, f, orden):
    return butter(orden, list(f) if isinstance(f, tuple) else f, tipo, fs=SR, output="sos")


def filtrar(x, tipo, f, orden=2):
    return sosfilt(sos(tipo, f, orden), x, axis=0)


def env_exp(n, ataque=0.002, tau=0.3):
    t = tt(n)
    e = np.exp(-t / tau)
    a = max(1, ns(ataque))
    e[:a] *= np.linspace(0, 1, a)
    return e


def env_adsr(n, a, d, s, r, largo):
    """Envolvente ADSR lineal en segundos; 'largo' es cuánto dura la nota antes del release."""
    t = tt(n)
    e = np.zeros(n)
    k = t < a
    e[k] = t[k] / max(a, 1e-6)
    k = (t >= a) & (t < a + d)
    e[k] = 1 - (1 - s) * (t[k] - a) / max(d, 1e-6)
    k = (t >= a + d) & (t < largo)
    e[k] = s
    k = t >= largo
    nivel = s if largo >= a + d else np.interp(largo, [0, a, a + d], [0, 1, s])
    e[k] = nivel * np.clip(1 - (t[k] - largo) / max(r, 1e-6), 0, 1)
    return e


def _rng(semilla):
    return np.random.default_rng(int(semilla) % (2 ** 32))


def saturar(x, drive=1.5):
    return np.tanh(drive * x) / np.tanh(drive)


# ---------------------------------------------------------------- osciladores (numba)
@njit(cache=True)
def _sierra(freq, fase):
    n = freq.shape[0]
    y = np.empty(n)
    ph = fase
    for i in range(n):
        dt = freq[i] / 48000.0
        v = 2.0 * ph - 1.0
        if ph < dt:
            x = ph / dt
            v -= x + x - x * x - 1.0
        elif ph > 1.0 - dt:
            x = (ph - 1.0) / dt
            v -= x * x + x + x + 1.0
        y[i] = v
        ph += dt
        if ph >= 1.0:
            ph -= 1.0
    return y


def sierra(freq, n=None, fase=0.0):
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=np.float64)
    return _sierra(f, float(fase))


def cuadrada(freq, n=None, fase=0.0):
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=np.float64)
    return 0.5 * (_sierra(f, float(fase)) - _sierra(f, (float(fase) + 0.5) % 1.0))


def seno(freq, n=None, fase=0.0):
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=np.float64)
    return np.sin(2 * np.pi * (np.cumsum(f) / SR + fase))


# ---------------------------------------------------------------- filtro de estado variable (TPT, numba)
@njit(cache=True)
def _svf(x, fc, q, modo):
    n = x.shape[0]
    y = np.empty(n)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(n):
        f = fc[i]
        if f > 21000.0:
            f = 21000.0
        if f < 10.0:
            f = 10.0
        g = np.tan(np.pi * f / 48000.0)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if modo == 0:
            y[i] = v2
        elif modo == 1:
            y[i] = v1
        else:
            y[i] = x[i] - k * v1 - v2
    return y


def svf(x, fc, q=0.707, modo="lp"):
    """Filtro de estado variable; fc escalar o arreglo (corte por muestra). Acepta mono o estéreo."""
    m = {"lp": 0, "bp": 1, "hp": 2}[modo]
    if x.ndim == 2:
        return np.stack([svf(x[:, c], fc, q, modo) for c in range(x.shape[1])], axis=1)
    f = np.full(x.shape[0], float(fc)) if np.isscalar(fc) else np.asarray(fc, dtype=np.float64)
    return _svf(np.ascontiguousarray(x, dtype=np.float64), f, float(q), m)


# ---------------------------------------------------------------- efectos
def ir_reverb(rt60=1.8, predelay=0.015, brillo=0.5, semilla=1):
    """Respuesta de impulso estéreo sintética: ruido decorrelado por canal con decaimiento por banda
    (graves algo más largos, agudos mucho más cortos, como una sala real)."""
    n = ns(rt60 * 1.3)
    t = tt(n)
    rng = _rng(semilla)
    ir = np.zeros((n, 2))
    for c in range(2):
        r = rng.standard_normal(n)
        lo = filtrar(r, "low", 400)
        mid = filtrar(r, "band", [400, 3500])
        hi = filtrar(r, "high", 3500)
        ir[:, c] = (1.2 * lo * np.exp(-6.91 * t / (rt60 * 1.15)) + mid * np.exp(-6.91 * t / rt60)
                    + brillo * hi * np.exp(-6.91 * t / (rt60 * 0.4)))
    ir *= np.clip(t / 0.01, 0, 1)[:, None]
    ir = np.vstack([np.zeros((ns(predelay), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(0)).max()


def convolver(x, ir):
    """x estéreo (n,2) con IR estéreo: canal L con IR L, canal R con IR R. Devuelve n + len(ir) muestras."""
    return np.stack([fftconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1)


@njit(cache=True)
def _pingpong(xl, xr, d, fb, damp):
    n = xl.shape[0]
    yl = np.zeros(n)
    yr = np.zeros(n)
    bl = np.zeros(d)
    br = np.zeros(d)
    idx = 0
    ll = 0.0
    lr = 0.0
    for i in range(n):
        ol = bl[idx]
        orr = br[idx]
        ll += damp * (ol - ll)
        lr += damp * (orr - lr)
        bl[idx] = xl[i] + fb * lr
        br[idx] = xr[i] + fb * ll
        yl[i] = ol
        yr[i] = orr
        idx += 1
        if idx >= d:
            idx = 0
    return yl, yr


def pingpong(x, retardo_s, fb=0.35, damp=0.35):
    """Delay ping-pong: entra por la izquierda, rebota a la derecha; damp es el paso bajo en la realimentación."""
    m = x.mean(1)
    yl, yr = _pingpong(np.ascontiguousarray(m), np.zeros_like(m), ns(retardo_s), fb, damp)
    return np.stack([yl, yr], axis=1)


@njit(cache=True)
def _comp(det_db, umbral, ratio, ataque, release, rodilla):
    n = det_db.shape[0]
    g = np.empty(n)
    env = 0.0
    aa = np.exp(-1.0 / (ataque * 48000.0))
    ar = np.exp(-1.0 / (release * 48000.0))
    for i in range(n):
        sobre = det_db[i] - umbral
        if sobre <= -rodilla / 2:
            gr = 0.0
        elif sobre >= rodilla / 2:
            gr = sobre * (1.0 - 1.0 / ratio)
        else:
            gr = (1.0 - 1.0 / ratio) * (sobre + rodilla / 2) ** 2 / (2.0 * rodilla)
        if gr > env:
            env = aa * env + (1.0 - aa) * gr
        else:
            env = ar * env + (1.0 - ar) * gr
        g[i] = -env
    return g


def comprimir(x, umbral=-12.0, ratio=2.0, ataque=0.01, release=0.15, rodilla=6.0, ganancia=0.0):
    det = 20 * np.log10(np.abs(x).max(1) + 1e-9)
    g = _comp(np.ascontiguousarray(det), umbral, ratio, ataque, release, rodilla)
    return x * db(g + ganancia)[:, None]


def sidechain(n, tiempos, prof=0.6, release=0.16, pre=0.003):
    """Curva de ganancia que agacha en cada golpe de bombo (profundidad lineal, release exponencial)."""
    d = np.zeros(n)
    t = tt(n)
    for tk in tiempos:
        a = max(0, ns(tk - pre))
        b = min(n, ns(tk + release * 6))
        if a >= n:
            continue
        seg = t[a:b] - tk
        v = np.where(seg < 0, np.clip(1 + seg / pre, 0, 1), np.exp(-np.clip(seg, 0, None) / release))
        d[a:b] = np.maximum(d[a:b], v)
    return 1 - prof * d


# ---------------------------------------------------------------- instrumentos
def bombo(dur=0.45, f0=150.0, f1=46.0, tau_tono=0.04, tau=0.3, click=0.35, drive=1.8, semilla=0):
    n = ns(dur)
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / tau_tono)
    cuerpo = seno(f) * env_exp(n, 0.0008, tau)
    rng = _rng(semilla)
    clk = filtrar(rng.standard_normal(n), "band", [1500, 6000]) * env_exp(n, 0.0002, 0.004)
    x = saturar(cuerpo + click * clk, drive)
    x *= np.clip((dur - t) / 0.02, 0, 1)
    return estereo(x * 0.9)


def clap(dur=0.4, semilla=1):
    n = ns(dur)
    rng = _rng(semilla)
    r = filtrar(rng.standard_normal(n), "band", [900, 3200])
    e = np.zeros(n)
    t = tt(n)
    for k, off in enumerate([0.0, 0.009, 0.018, 0.028]):
        tk = t - off
        e += np.where(tk >= 0, np.exp(-np.clip(tk, 0, None) / 0.006), 0) * (0.8 if k < 3 else 1.0)
    e += np.where(t >= 0.028, np.exp(-np.clip(t - 0.028, 0, None) / 0.11), 0) * 0.55
    return estereo(r * e * 0.6)


def caja(dur=0.35, f=190.0, semilla=2, brillo=1.0):
    n = ns(dur)
    t = tt(n)
    tono = seno(f * (1 + 0.25 * np.exp(-t / 0.012))) * env_exp(n, 0.0005, 0.07)
    rng = _rng(semilla)
    ruido = filtrar(rng.standard_normal(n), "high", 1800) * env_exp(n, 0.0005, 0.12) * brillo
    return estereo(saturar(0.7 * tono + 0.55 * ruido, 1.3) * 0.7)


def hat(abierto=False, semilla=3):
    dur = 0.32 if abierto else 0.07
    n = ns(dur)
    x = np.zeros(n)
    for i, f in enumerate([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]):
        x += cuadrada(f * 1.6, n, fase=(i * 0.137) % 1)
    rng = _rng(semilla)
    x = 0.6 * x / 6 + 0.4 * rng.standard_normal(n)
    x = filtrar(filtrar(x, "band", [6500, 12000]), "high", 6000)
    x *= env_exp(n, 0.0003, 0.11 if abierto else 0.018)
    return estereo(x * 0.5)


def platillo(dur=2.2, semilla=4, oscuro=False):
    n = ns(dur)
    rng = _rng(semilla)
    x = np.zeros((n, 2))
    for c in range(2):
        r = rng.standard_normal(n)
        m = sum(cuadrada(f * (1.9 + 0.01 * c), n, fase=rng.random()) for f in [205.3, 304.4, 369.6, 522.7, 540.0, 800.0])
        x[:, c] = 0.5 * r + 0.25 * m / 6
    x = filtrar(x, "high", 3000 if oscuro else 4000)
    x = filtrar(x, "low", 8000 if oscuro else 11000)
    return x * env_exp(n, 0.002, dur / 4.5)[:, None] * 0.35


def tom(dur=0.6, f=110.0, semilla=5, golpe=1.0):
    n = ns(dur)
    t = tt(n)
    cuerpo = seno(f * (1 + 0.5 * np.exp(-t / 0.03))) * env_exp(n, 0.0008, 0.18)
    rng = _rng(semilla)
    piel = filtrar(rng.standard_normal(n), "band", [300, 2500]) * env_exp(n, 0.0004, 0.02) * golpe
    return estereo(saturar(cuerpo + 0.5 * piel, 1.6) * 0.8)


def pluck_fm(f, dur=0.6, indice=3.0, razon=2.0, tau=0.35, tau_indice=0.12):
    """Pluck FM tipo campana/marimba digital: modulador con índice que decae."""
    n = ns(dur)
    t = tt(n)
    i_t = indice * np.exp(-t / tau_indice)
    mod = np.sin(2 * np.pi * f * razon * t)
    x = np.sin(2 * np.pi * f * t + i_t * mod) * env_exp(n, 0.0015, tau)
    x *= np.clip((dur - t) / 0.01, 0, 1)
    return x


def pluck_sierra(f, dur=0.4, corte0=6000.0, corte1=500.0, tau_f=0.08, tau=0.25, detune=0.07, q=1.2):
    n = ns(dur)
    t = tt(n)
    x = sierra(f, n) + sierra(f * 2 ** (detune / 12), n, 0.3)
    fc = corte1 + (corte0 - corte1) * np.exp(-t / tau_f)
    x = svf(x * 0.5, fc, q) * env_exp(n, 0.002, tau)
    return x * np.clip((dur - t) / 0.01, 0, 1)


def supersaw(notas, dur, corte=3000.0, voces=7, detune=0.25, ataque=0.01, release=0.3, sost=1.0,
             q=0.8, semilla=7, ancho=0.85, largo=None):
    """Acorde supersaw: 'voces' sierras por nota, desafinadas en +-detune semitonos y abiertas en estéreo.
    corte escalar o arreglo de n muestras."""
    n = ns(dur)
    rng = _rng(semilla)
    x = np.zeros((n, 2))
    for nt in notas:
        f = hz(nt)
        for v in range(voces):
            d = (v / (voces - 1) - 0.5) * 2 * detune if voces > 1 else 0.0
            if ancho >= 1.0 and voces > 1:  # ancho total: cada canal con su propio juego de voces (fases y desafines distintos)
                for c in range(2):
                    dc = d + (rng.random() - 0.5) * detune * 0.3
                    x[:, c] += sierra(f * 2 ** (dc / 12), n, rng.random()) / voces * np.sqrt(2)
                continue
            s = sierra(f * 2 ** (d / 12), n, rng.random())
            pan = (v / (voces - 1) - 0.5) * 2 * ancho if voces > 1 else 0.0
            x += estereo(s, pan) / voces
    x /= max(1, len(notas)) ** 0.5
    x = svf(x, corte, q)
    largo = dur - release if largo is None else largo
    e = env_adsr(n, ataque, 0.2, sost, release, largo)
    return x * e[:, None] * 0.5


def bajo_house(f, dur=0.22, corte0=1800.0, corte1=220.0, tau_f=0.06, sub=0.8, drive=1.4):
    n = ns(dur)
    t = tt(n)
    x = 0.6 * sierra(f, n) + 0.4 * cuadrada(f * 1.003, n, 0.25)
    fc = corte1 + (corte0 - corte1) * np.exp(-t / tau_f)
    x = svf(x, fc, 1.0)
    s = seno(f, n) * sub
    e = env_adsr(n, 0.003, 0.08, 0.7, 0.03, dur - 0.03)
    return saturar((x * 0.5 + s) * e, drive) * 0.6


def sub(f, dur, ataque=0.005, release=0.08, glide_desde=None, tau_glide=0.05):
    n = ns(dur)
    t = tt(n)
    fr = np.full(n, f) if glide_desde is None else f + (glide_desde - f) * np.exp(-t / tau_glide)
    return seno(fr) * env_adsr(n, ataque, 0.05, 0.9, release, dur - release)


def reese(f, dur, corte=420.0, drive=2.2, detune=0.14, ataque=0.01, release=0.08):
    n = ns(dur)
    x = sierra(f * 2 ** (detune / 12), n, 0.1) + sierra(f * 2 ** (-detune / 12), n, 0.6)
    x = svf(x * 0.5, corte, 1.1)
    x = saturar(x + 0.6 * seno(f, n), drive)
    return x * env_adsr(n, ataque, 0.1, 0.85, release, dur - release) * 0.6


def braam(notas, dur=2.5, semilla=8, abre=2400.0, cierra=260.0, drive=2.6):
    """Bronce sintético grave de tráiler: pila de sierras con filtro que abre rápido y cierra lento, saturada."""
    n = ns(dur)
    t = tt(n)
    fc = cierra + (abre - cierra) * (np.clip(t / 0.06, 0, 1) * np.exp(-np.clip(t - 0.06, 0, None) / 0.5))
    x = supersaw(notas, dur, corte=fc, voces=5, detune=0.18, ataque=0.012, release=dur * 0.6, q=1.4,
                 semilla=semilla, ancho=0.6, largo=dur * 0.35)
    x = saturar(x * 2.2, drive) * 0.5
    s = seno(hz(notas[0]), n) * env_exp(n, 0.01, dur / 3) * 0.5
    return x + estereo(s)


def golpe_metal(f=310.0, dur=2.0, semilla=9):
    """Golpe metálico inarmónico (parciales tipo placa) con transitorio de ruido."""
    n = ns(dur)
    t = tt(n)
    x = np.zeros(n)
    for k, (r, tau) in enumerate([(1.0, 0.9), (2.32, 0.6), (3.17, 0.45), (4.53, 0.3), (5.91, 0.22), (7.36, 0.15)]):
        x += np.sin(2 * np.pi * f * r * t + k) * np.exp(-t / tau) / (k + 1) ** 0.6
    rng = _rng(semilla)
    x += filtrar(rng.standard_normal(n), "high", 2500) * env_exp(n, 0.0002, 0.01) * 0.8
    x *= env_exp(n, 0.0005, dur)
    return x * 0.35


def swell_invertido(sonido, dur, ir):
    """Swell 'reverse reverb': la cola de reverb del sonido, invertida y recortada a 'dur' segundos; termina en 0."""
    mojado = convolver(sonido, ir)
    rev = mojado[::-1]
    k = min(len(rev), ns(dur))
    seg = rev[-k:]
    seg = seg * (np.linspace(0, 1, k) ** 2)[:, None]
    return seg / (np.abs(seg).max() + 1e-9)


# ---------------------------------------------------------------- efectos de sonido
def sfx_whoosh(dur=0.7, pico=0.68, f_lo=350.0, f_hi=5200.0, pan0=-0.8, pan1=0.8, semilla=11, tono=True, oscuro=False):
    """Whoosh: ruido por pasabanda que sube hasta el pico y cae, envolvente asimétrica y paneo que cruza."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    k = pico
    forma = np.where(u < k, (u / k) ** 2.2, np.exp(-(u - k) / ((1 - k) * 0.32)))
    fc = f_lo * (f_hi / f_lo) ** np.where(u < k, u / k, 1 - 0.6 * (u - k) / (1 - k))
    rng = _rng(semilla)
    r = rng.standard_normal(n)
    x = svf(r, fc, 1.6, "bp") * 1.6 + 0.35 * svf(r, fc * 0.4, 0.7, "lp")
    if tono:
        f_t = 180 * (2.5 ** np.where(u < k, u / k, 1 - (u - k) / (1 - k)))
        x += 0.18 * svf(sierra(f_t), fc, 0.9)
    if oscuro:
        x = filtrar(x, "low", 3500)
    x *= forma
    pan = pan0 + (pan1 - pan0) * np.clip(u / (k * 1.2), 0, 1)
    a = (pan + 1) * np.pi / 4
    y = np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)
    y *= np.clip((dur - t) / 0.01, 0, 1)[:, None]
    return y / (np.abs(y).max() + 1e-9)


def sfx_riser(dur=2.0, f0=180.0, f1=1400.0, semilla=12, oscuro=False):
    """Riser: ruido con pasabanda ascendente + racimo de sierras que suben de tono, crescendo, final seco."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    rng = _rng(semilla)
    fc = 400 * (12000 / 400) ** (u ** 1.3) if not oscuro else 250 * (6000 / 250) ** (u ** 1.3)
    ruido = np.stack([svf(rng.standard_normal(n), fc, 1.2, "bp") for _ in range(2)], axis=1)
    f = f0 * (f1 / f0) ** (u ** 1.6)
    tonal = np.zeros((n, 2))
    for i, d in enumerate([-0.12, -0.04, 0.05, 0.13]):
        tonal += estereo(sierra(f * 2 ** (d / 12), fase=rng.random()), (i / 3 - 0.5) * 1.4) / 4
    tonal = svf(tonal, fc * 0.8 + 300, 0.9)
    trem = 1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(4 + 20 * u ** 2) / SR))
    x = (ruido * 0.9 + tonal * 0.45) * ((u ** 2.4) * trem)[:, None]
    x *= np.clip((dur - t) / 0.004, 0, 1)[:, None]
    return x / (np.abs(x).max() + 1e-9)


def sfx_impacto(dur=2.6, estilo="corporativo", semilla=13):
    """Impacto: boom sub con caída de tono, golpe de cuerpo, crack de ruido y cola de reverb."""
    n = ns(dur)
    t = tt(n)
    rng = _rng(semilla)
    f = 34 + 70 * np.exp(-t / 0.09)
    boom = seno(f) * env_exp(n, 0.001, 0.75 if estilo == "corporativo" else 1.1)
    cuerpo = tom(0.8, 95 if estilo == "corporativo" else 70, semilla=semilla)[:, 0]
    cuerpo = np.concatenate([cuerpo, np.zeros(n - len(cuerpo))])
    crack = filtrar(rng.standard_normal(n), "band", [1200, 9000]) * env_exp(n, 0.0002, 0.03)
    x = saturar(boom * 0.9 + cuerpo * 0.6 + crack * (0.5 if estilo == "corporativo" else 0.8), 1.8)
    y = estereo(x)
    if estilo != "corporativo":
        m = golpe_metal(150.0, dur, semilla)
        y += estereo(m * 0.8, 0.0)
    ir = ir_reverb(2.6 if estilo != "corporativo" else 1.8, 0.01, 0.35, semilla)
    cola = convolver(y, ir)[:n]
    y = y + 0.35 * filtrar(cola, "high", 150)
    y *= np.clip((dur - t) / 0.3, 0, 1)[:, None]
    return y / (np.abs(y).max() + 1e-9)


def doble(fn, f, *args, cents=7.0, pan=0.55, **kw):
    """Duplica un instrumento mono con dos copias desafinadas +-cents y abiertas en estéreo (ancho sin Haas)."""
    a = fn(f * 2 ** (-cents / 1200), *args, **kw)
    b = fn(f * 2 ** (cents / 1200), *args, **kw)
    return estereo(a, -pan) * 0.5 + estereo(b, pan) * 0.5


def estante_agudos(x, f=9000.0, g_db=-6.0):
    """Estante de agudos aproximado con un cruce Butterworth complementario."""
    lo = filtrar(x, "low", f)
    hi = x - lo
    return lo + db(g_db) * hi


def peq(x, f0, g_db, q=0.8):
    """Ecualizador paramétrico (biquad de pico, fórmulas RBJ)."""
    from scipy.signal import tf2sos
    A = 10 ** (g_db / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return sosfilt(tf2sos(np.array(b) / a[0], np.array(a) / a[0]), x, axis=0)
