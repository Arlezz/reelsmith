# Benchmark A/B ab-base-vs-final · 2026-10-19T04:28:10

Máquina: 2 CPU (Intel(R) Xeon(R) Processor @ 2.80GHz), 8029 MB, ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers, node v22.22.0, GPU: ninguna detectada.
Mediana de 3 corridas por variante, intercaladas. En modo final las etapas se solapan (render ∥ audio): el total es el reloj de pared, no la suma.

## ref20

| Etapa | base (s) | final (s) |
|---|---|---|
| construir | 0.0 | 0.0 |
| render | 95.28 | 61.26 |
| cortes | 14.68 | 3.23 |
| musica | 6.03 | 5.06 |
| mezcla | 11.96 | 8.41 |
| verificar_audio | 15.68 | 3.46 |
| verificar_musica | 1.55 | 3.64 |
| **total (pared)** | **144.95** | **86.15** |

- **base** (etapas): totales [145.3, 144.67, 144.95] · determinista True · check-audio [['PASA'], ['PASA'], ['PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [True, True, True]
- **final** (final): totales [86.15, 79.54, 88.81] · determinista True · check-audio [['PASA'], ['PASA'], ['PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [False, False, False] · SSIM vs golden 0.9991 (mín 0.9972)
- **final vs base:** 144.95 s → 86.15 s (1.68×, 41 % menos)

## ref90

| Etapa | base (s) | final (s) |
|---|---|---|
| construir | 0.07 | 0.07 |
| render | 262.96 | 203.23 |
| cortes | 69.21 | 18.53 |
| musica | 20.57 | 51.99 |
| mezcla | 58.96 | 99.87 |
| verificar_audio | 143.04 | 28.16 |
| verificar_musica | 3.96 | 36.07 |
| **total (pared)** | **557.38** | **224.56** |

- **base** (etapas): totales [557.38, 544.48, 588.0] · determinista True · check-audio [['PASA', 'PASA'], ['PASA', 'PASA'], ['PASA', 'PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [True, True, True]
- **final** (final): totales [224.56, 218.33, 232.28] · determinista True · check-audio [['PASA', 'PASA'], ['PASA', 'PASA'], ['PASA', 'PASA']] · medir_pista ['PASA', 'PASA', 'PASA'] · video = golden (md5) [False, False, False] · SSIM vs golden 0.9981 (mín 0.9953)
- **final vs base:** 557.38 s → 224.56 s (2.48×, 60 % menos)
