# medir-windows.ps1: prepara Windows para la skill y mide una corrida completa, y la GPU si hay una que sirva.
#
# Uso, desde PowerShell, en la carpeta del plugin (video-showreel-nativo):
#   powershell -ExecutionPolicy Bypass -File .\bench\medir-windows.ps1 [-Repeticiones 3] [-SinGpu | -SoloGpu] [-SoloInstalar]
# Tarda unos 15 a 25 minutos la primera vez (instalar y medir); las siguientes, unos 10.
# -SoloGpu repite solo la medición de GPU contra CPU.
# -SoloInstalar deja todo listo para usar la skill en Windows (pasos 1 a 3) y corre la prueba completa, sin medir.
# Los scripts de la skill encuentran solos el entorno de Python de abajo; no hace falta activarlo.
#
# Qué hace:
#   1. Revisa Node 22 o más, ffmpeg y Python 3.11 a 3.13. Si falta alguno, pregunta y lo instala con winget.
#   2. Crea un entorno de Python aislado en %LOCALAPPDATA%\video-showreel-nativo\venv con scripts\requirements.txt.
#      No toca el Python del sistema.
#   3. Instala el navegador del render (chromium-headless-shell de Playwright) si falta.
#   4. Corre bench\medir-equipo.mjs: prueba completa, la parte de máquina de la corrida final-1 (3 veces) y GPU contra CPU.
#      El resultado queda en bench\resultados\<fecha>_windows.txt y .json.
param([int]$Repeticiones = 3, [switch]$SinGpu, [switch]$SoloGpu, [switch]$SoloInstalar)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$Raiz = Split-Path -Parent $PSScriptRoot
$Scripts = Join-Path $Raiz "skills\video-showreel-nativo\scripts"

function Fallar($msg) { Write-Host "FALTA: $msg" -ForegroundColor Red; exit 2 }
function Tiene($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refrescar-Path {
  # se agrega al final: así no se pierde lo que esta ventana ya tenía (por ejemplo, un entorno de conda activo)
  $env:Path = $env:Path + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Instalar($id, $nombre) {
  if (-not (Tiene "winget")) { Fallar "$nombre. No encontré winget: instálalo a mano y vuelve a correr el script." }
  $r = Read-Host "Falta $nombre. ¿Lo instalo con winget ($id)? [S/n]"
  if ($r -match '^[nN]') { Fallar "$nombre (sin eso no se puede seguir)." }
  winget install -e --id $id
  Refrescar-Path
}
function Version-Python($exe, $pre) {
  if (-not (Tiene $exe)) { return $null }
  $out = & $exe @pre -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return "$out".Trim()
}
function Buscar-Python {
  foreach ($c in @("py -3.13", "py -3.12", "py -3.11", "python")) {
    $partes = $c -split " "
    $exe = $partes[0]; $pre = @($partes | Select-Object -Skip 1)
    $v = Version-Python $exe $pre
    if ($v -and ([version]$v -ge [version]"3.11") -and ([version]$v -le [version]"3.13")) { return @{ exe = $exe; pre = $pre; version = $v } }
  }
  return $null
}

# ---------------------------------------------------------------- 1. requisitos
Refrescar-Path  # lo que winget instaló en otra ventana (esta puede tener el PATH de antes)
$nodeOk = $false
if (Tiene "node") { $v = node -p "process.versions.node.split('.')[0]"; $nodeOk = ([int]$v -ge 22) }
if (-not $nodeOk) { Instalar "OpenJS.NodeJS.LTS" "Node 22 o más" }
if (-not (Tiene "node")) { Fallar "Node: se instaló, pero esta ventana no lo ve. Cierra PowerShell, ábrelo de nuevo y vuelve a correr el script." }
if (-not (Tiene "ffmpeg")) { Instalar "Gyan.FFmpeg" "ffmpeg" }
if (-not (Tiene "ffmpeg")) { Fallar "ffmpeg: se instaló, pero esta ventana no lo ve. Cierra PowerShell, ábrelo de nuevo y vuelve a correr el script." }
$Py = Buscar-Python
if (-not $Py) {
  Instalar "Python.Python.3.12" "Python 3.11 a 3.13"
  $Py = Buscar-Python
  if (-not $Py) { Fallar "Python: se instaló, pero esta ventana no lo ve. Cierra PowerShell, ábrelo de nuevo y vuelve a correr el script." }
}
Write-Host "node $(node --version) · $((ffmpeg -version | Select-Object -First 1)) · Python $($Py.version) ($($Py.exe) $($Py.pre -join ' '))"

# ---------------------------------------------------------------- 2. entorno de Python
$Venv = Join-Path $env:LOCALAPPDATA "video-showreel-nativo\venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$listo = $false
if (Test-Path $VenvPy) { & $VenvPy -c "import numba, scipy, pyloudnorm, soundfile, matplotlib" 2>$null; $listo = ($LASTEXITCODE -eq 0) }
if (-not $listo) {
  Write-Host "Creando el entorno de Python en $Venv (una sola vez, unos 300 MB)…"
  if (Test-Path $Venv) { Remove-Item -Recurse -Force $Venv }
  $pre = $Py.pre
  & $Py.exe @pre -m venv $Venv
  if ($LASTEXITCODE -ne 0) { Fallar "no pude crear el entorno de Python en $Venv" }
  & $VenvPy -m pip install --quiet --upgrade pip
  & $VenvPy -m pip install --quiet -r (Join-Path $Scripts "requirements.txt")
  if ($LASTEXITCODE -ne 0) { Fallar "pip no pudo instalar scripts\requirements.txt (copia el error de arriba)" }
}
$env:SHOWREEL_PYTHON = $VenvPy
$env:PYTHONUTF8 = "1"
$env:Path = (Join-Path $Venv "Scripts") + ";" + $env:Path
& $VenvPy -c "import sys, numba, scipy; print('python listo:', sys.version.split()[0], '· numba', numba.__version__)"

# ---------------------------------------------------------------- 3. navegador del render
& node (Join-Path $Scripts "render-nativo.mjs") --verificar *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Instalando el navegador del render (chromium-headless-shell, unos 100 MB, una sola vez)…"
  & npx -y playwright@1.56.0 install chromium-headless-shell
  & node (Join-Path $Scripts "render-nativo.mjs") --verificar
  if ($LASTEXITCODE -ne 0) { Fallar "el navegador del render (mira el mensaje de arriba)" }
}

if ($SoloInstalar) {
  $Prueba = Join-Path $env:TEMP "prueba-video-showreel-nativo"
  Write-Host "Prueba completa del pipeline en $Prueba (unos minutos)…"
  & node (Join-Path $Scripts "prueba-completa.mjs") $Prueba
  if ($LASTEXITCODE -ne 0) { Fallar "la prueba completa no pasó (copia el error de arriba)" }
  Write-Host "Listo: la skill funciona en este equipo." -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- 4. medir
$a = @((Join-Path $PSScriptRoot "medir-equipo.mjs"), "--repeticiones", "$Repeticiones", "--etiqueta", "windows")
if ($SinGpu) { $a += "--sin-gpu" }
if ($SoloGpu) { $a[4] = "windows-gpu"; $a += "--solo-gpu" }
& node @a
exit $LASTEXITCODE
