# Benchmark A/B ab-base-vs-nueva · 2026-10-19T01:38:50

Máquina: 2 CPU (Intel(R) Xeon(R) Processor @ 2.80GHz), 8029 MB, ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers, node v22.22.0, GPU: ninguna detectada.
Mediana de 3 corridas por variante, intercaladas. En modo final las etapas se solapan (render ∥ audio): el total es el reloj de pared, no la suma.

## ref20

| Etapa | base (s) | nueva (s) |
|---|---|---|
| construir | 0.0 | 0.0 |
| render | 84.5 | 57.52 |
| cortes | 14.05 | 3.01 |
| musica | 5.25 | 5.35 |
| mezcla | 10.9 | 10.65 |
| verificar_audio | 15.64 | 3.37 |
| verificar_musica | 1.68 | 3.75 |
| **total (pared)** | **130.62** | **84.77** |

- **base** (etapas): totales [130.62, 130.28, 145.34] · determinista True · check-audio [['PASA'], ['PASA'], ['PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [True, True, True]
- **nueva** (final): totales [79.52, 84.77, 94.92] · determinista True · check-audio [['PASA'], ['PASA'], ['PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [False, False, False] · SSIM vs golden 0.9991 (mín 0.9972)
- **nueva vs base:** 130.62 s → 84.77 s (1.54×, 35 % menos)

## ref90

| Etapa | base (s) | nueva (s) |
|---|---|---|
| construir | 0.06 | 0.06 |
| render | 268.08 | 205.28 |
| cortes | 67.0 | 19.36 |
| musica | 21.1 | 54.18 |
| mezcla | 65.89 | 134.22 |
| verificar_audio | 142.11 | 28.31 |
| verificar_musica | 3.78 | 12.88 |
| **total (pared)** | **573.17** | **224.19** |

- **base** (etapas): totales [527.27, 573.17, 573.57] · determinista True · check-audio [['PASA', 'PASA'], ['PASA', 'PASA'], ['PASA', 'PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [True, True, True]
- **nueva** (final): totales [210.76, 236.27, 224.19] · determinista True · check-audio [['PASA', 'PASA'], ['PASA', 'PASA'], ['PASA', 'PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [False, False, False] · SSIM vs golden 0.9981 (mín 0.9953)
- **nueva vs base:** 573.17 s → 224.19 s (2.56×, 61 % menos)
