#!/usr/bin/env bash
# Compila WORLD + la capa world_wasm.cpp a WebAssembly con Emscripten.
# Resultado: web/world.js (el .wasm va embebido adentro, un solo archivo).
#
# Uso:  bash build.sh        (hace falta tener `emcc` en el PATH)
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
  echo "No encuentro 'emcc'. Instala Emscripten primero (mira el README)." >&2
  exit 1
fi

W=third_party/world/src

EXPORTADAS=_w_analizar,_w_cuadros,_w_bins,_w_fft_size,_w_frame_period,_w_fs,_w_f0_ptr,\
_w_mapa_estirar,_w_largo_salida,_w_render,_w_liberar,_malloc,_free

em++ -O3 -std=c++14 -I"$W" \
  src/world_wasm.cpp \
  "$W/cheaptrick.cpp" "$W/codec.cpp" "$W/common.cpp" "$W/d4c.cpp" "$W/dio.cpp" \
  "$W/fft.cpp" "$W/harvest.cpp" "$W/matlabfunctions.cpp" "$W/stonemask.cpp" "$W/synthesis.cpp" \
  -o web/world.js \
  -sMODULARIZE=1 -sEXPORT_NAME=createWorld \
  -sSINGLE_FILE=1 \
  -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=2147483648 \
  -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS="$EXPORTADAS" \
  -sEXPORTED_RUNTIME_METHODS=HEAPF64

ls -lh web/world.js
echo "Listo. Para probar: cd web && python -m http.server 8000  (y abre http://localhost:8000)"
