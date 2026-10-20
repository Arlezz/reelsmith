# Benchmark A/B ab-render-ref20-final · 2026-10-19T05:19:31

Máquina: 2 CPU (Intel(R) Xeon(R) Processor @ 2.80GHz), 8029 MB, ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers, node v22.22.0, GPU: ninguna detectada.
Mediana de 3 corridas por variante, intercaladas. En modo final las etapas se solapan (render ∥ audio): el total es el reloj de pared, no la suma.

## ref20

| Etapa | base (s) | final (s) |
|---|---|---|
| construir | 0.0 | 0.0 |
| render | 89.63 | 59.99 |
| **total (pared)** | **89.63** | **59.99** |

- **base** (render): totales [98.14, 89.63, 86.42] · determinista True · check-audio [[], [], []] · medir_pista ['—', '—', '—'] · video = golden (md5) [True, True, True]
- **final** (render): totales [59.99, 61.17, 55.63] · determinista True · check-audio [[], [], []] · medir_pista ['—', '—', '—'] · video = golden (md5) [False, False, False] · SSIM vs golden 0.9991 (mín 0.9972)
- **final vs base:** 89.63 s → 59.99 s (1.49×, 33 % menos)
