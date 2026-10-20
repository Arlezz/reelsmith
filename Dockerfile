# Reelsmith con todo instalado y versiones fijas: las mismas de la máquina de prueba (bench/referencia-md5.json).
#
#   docker build -t reelsmith .                         unos minutos; al final corre la prueba completa
#   docker run --rm -v "$PWD:/trabajo" reelsmith video  (o, con el comando instalado: reelsmith --docker video)
#
# Durante la construcción se corre `reelsmith prueba`: si un paso o un juez falla, la imagen no se construye. Al final
# se comparan los md5 con los de la máquina de prueba (solo informa: lo muestra el log de la construcción).
FROM ubuntu:24.04

ARG NODE_VERSION=22.22.0
ARG PLAYWRIGHT_VERSION=1.56.0

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    REELSMITH_PYTHON=/opt/reelsmith/venv/bin/python \
    REELSMITH_EN_CONTENEDOR=1 \
    NUMBA_CACHE_DIR=/opt/reelsmith/numba-cache \
    MPLCONFIGDIR=/tmp/matplotlib \
    PYTHONDONTWRITEBYTECODE=1 \
    RENDER_BANDERAS=--disable-dev-shm-usage

# ffmpeg 6.1 y Python 3.12 de Ubuntu 24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils ffmpeg python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Node 22: el binario oficial, verificado con su suma (el de Ubuntu 24.04 es el 18)
RUN set -eu; ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/'); \
    ARCHIVO="node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"; cd /tmp; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVO}"; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " ${ARCHIVO}\$" | sha256sum -c -; \
    tar -xJf "${ARCHIVO}" -C /usr/local --strip-components=1 --no-same-owner; rm "${ARCHIVO}"; node --version

# Chromium headless shell de Playwright 1.56.0 (build 1194), con las bibliotecas y fuentes del sistema que pide
RUN npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium-headless-shell \
    && rm -rf /root/.npm /var/lib/apt/lists/*

# paquetes de Python, en un entorno aislado
COPY skills/reelsmith/scripts/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/reelsmith/venv \
    && /opt/reelsmith/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /opt/reelsmith

# prueba completa: valida la imagen y deja compiladas las funciones de numba (la música no las recompila en cada
# corrida). La caché queda escribible para cualquier usuario: reelsmith --docker corre con el usuario de quien llama.
RUN node /opt/reelsmith/skills/reelsmith/scripts/reelsmith.mjs prueba /tmp/prueba \
    && node /opt/reelsmith/bench/comparar-md5.mjs /tmp/prueba \
    && rm -rf /tmp/prueba /tmp/reelsmith-render-cupos /tmp/render-nativo-* \
    && mkdir -p /opt/reelsmith/numba-cache && chmod -R a+rwX /opt/reelsmith/numba-cache \
    && ln -s /opt/reelsmith/skills/reelsmith/scripts/reelsmith.mjs /usr/local/bin/reelsmith

WORKDIR /trabajo
ENTRYPOINT ["node", "/opt/reelsmith/skills/reelsmith/scripts/reelsmith.mjs"]
CMD ["ayuda"]
