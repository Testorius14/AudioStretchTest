# Estirador vocal (WORLD en el navegador)

Editor de voz que corre en una página web (también en el teléfono): abrís un audio, ves el tono
en un piano roll, elegís un tramo arrastrando sobre la onda, lo estirás y lo guardás como WAV.
Usa el vocoder WORLD compilado a WebAssembly.

## Qué hace

- **Seleccionar**: arrastrá para elegir un tramo (los bordes naranjas se pueden ajustar).
- **Estirar**: alarga o acorta solo ese tramo (factor 2 = dura el doble). Con "Conservar resto"
  marcado queda el audio de antes y después; si no, queda solo el tramo estirado.
- **Tono**: dibujá con el dedo o el mouse sobre las notas para cambiar el tono donde hay voz.
  La curva gris es el tono original.
- Deshacer, zoom (+ / −, o Ctrl + rueda), desplazamiento, reproducir y guardar WAV.

## Cómo está armado

```
src/world_wasm.cpp      capa sobre WORLD: analizar, mapa de tiempo, sintetizar
third_party/world/      código de WORLD (Masanori Morise, licencia BSD modificada)
web/index.html          interfaz
web/editor.js           lógica de edición (sin pantalla)
web/worker.js           corre WORLD en segundo plano
web/world.js            LO GENERA build.sh (WebAssembly embebido)
test/                   pruebas
build.sh                compila a WebAssembly
```

Estirar un tramo es recorrer más despacio los cuadros de análisis de WORLD (tono, timbre y
aspereza) dentro del tramo y volver a sintetizar. El mismo mecanismo (un "mapa de tiempo") sirve
después para mover y recortar notas.

## Cómo compilarlo

Necesitás el archivo `web/world.js`, que sale de compilar con Emscripten.

**Opción A: en tu PC**

1. Instalá Emscripten (en Arch el paquete se llama `emscripten`) y asegurate de que `emcc`
   funcione en la terminal.
2. `bash build.sh`
3. `cd web && python -m http.server 8000` y abrí http://localhost:8000
   (hay que abrirlo por http, no haciendo doble clic en el archivo).

**Opción B: GitHub (sin instalar nada)**

1. Subí esta carpeta a un repositorio de GitHub (rama `main`).
2. En Settings → Pages, elegí "GitHub Actions" como fuente.
3. Cada vez que subas cambios, `.github/workflows/publicar.yml` corre las pruebas, compila y
   publica la página. El link queda en la pestaña Actions / Pages, y lo abrís desde el teléfono.

## Estado de las pruebas

Verificado:
- Motor en C++ nativo (`test/test_nativo.cpp`): análisis, estirado, tono y formantes con una voz
  sintética. El tono se conserva al estirar y los largos son los esperados.
- Lógica de edición (`node test/test_editor.js`).
- Página en Chrome sin pantalla con un **motor falso** (`node test/ui_test.js`): abrir, seleccionar,
  estirar, reproducir, guardar, deshacer, tono, zoom.

**No verificado** (no se pudo en el entorno donde se escribió):
- La compilación a WebAssembly (`build.sh`) y el workflow de GitHub.
- El sonido real de WORLD con tus audios.
- El rendimiento y la memoria en un teléfono.

## Límites conocidos

- Memoria: WORLD guarda varios números por cada 5 ms de audio. Audios largos o calidad alta
  pueden agotar la memoria de un teléfono. Empezá con audios cortos y calidad 22 kHz.
- Solo audio mono (se mezcla a mono al abrir).
- WORLD funciona mejor con voz sola; estirados muy grandes pueden sonar con artefactos.
- Todavía no hay: edición de formantes en pantalla (el motor ya lo soporta), mover notas,
  cortar, ni instalar como app (PWA).
