# Estirador vocal (WORLD en el navegador)

Editor de voz que corre en una página web (también en el teléfono): abrís un audio, ves el tono
en un piano roll, y podés estirar, cortar, mover y afinar. Usa el vocoder WORLD compilado a
WebAssembly. Se puede instalar como app y funciona sin conexión.

## Qué hace

- **Seleccionar**: arrastrá para elegir un tramo (los bordes naranjas se pueden ajustar).
- **Estirar**: alarga o acorta solo ese tramo (factor 2 = dura el doble). Con "Conservar resto"
  marcado queda el audio de antes y después; si no, queda solo el tramo estirado.
- **Cortar**: tocá donde quieras partir el audio en segmentos (podés arrastrar para ajustar antes
  de soltar). Los cortes se ven como líneas blancas con un triángulo arriba.
- **Mover**: tocá un segmento para elegirlo y arrastralo en el tiempo. Donde estaba queda en
  silencio, y pisa lo que haya donde cae. Si se pasa del final, el audio se alarga.
- **Borrar**: borra el segmento elegido (herramienta Mover) o el tramo seleccionado. Con "Cerrar
  hueco" se juntan las partes; sin eso queda silencio.
- **Afinar a la nota**: lleva cada nota cantada a su nota exacta (si cantó C4 con +30 cents, queda
  en C4; si cantó F3 con -25 cents, queda en F3). Actúa en la selección, o en todo el audio si no
  hay selección. Tres modos:
  - *Nota exacta (plana)*: cada nota queda en una línea recta, sin vibrato.
  - *Con algo de vibrato*: conserva la mitad del vibrato.
  - *Solo corregir desafinación*: centra la nota en su tono exacto pero conserva el vibrato.
  El porcentaje indica cuánto se acerca a la nota exacta (100 % = del todo).
- **Tono**: dibujá con el dedo o el mouse sobre las notas para cambiar el tono donde hay voz.
  **Tono original** vuelve atrás en la selección (o en todo). La curva gris es siempre el original.
- Deshacer (hasta 40 pasos), zoom (+ / −, o Ctrl + rueda), desplazamiento, reproducir y guardar WAV.
- **Guardar proyecto / Abrir proyecto**: guarda el audio y todas las ediciones en un archivo
  `.estirador` para seguir después. Al abrirlo se vuelve a analizar el audio, así que tarda lo mismo
  que la primera vez.
- **Instalar app**: en Chrome de Android aparece el botón "Instalar app" (o el menú ⋮ → "Instalar
  app"). En iPhone: Compartir → "Agregar a inicio". Después se abre desde el ícono y funciona sin
  internet.

## Cómo está armado

```
src/world_wasm.cpp      capa sobre WORLD: analizar, sintetizar siguiendo un mapa de tiempo
third_party/world/      código de WORLD (Masanori Morise, licencia BSD modificada)
web/index.html          interfaz
web/editor.js           lógica de edición (cortes, mover, borrar, afinar, proyecto)
web/worker.js           corre WORLD en segundo plano
web/world.js            LO GENERA build.sh (WebAssembly embebido)
web/sw.js, manifest     app instalable y sin conexión
test/                   pruebas
build.sh                compila a WebAssembly
```

Todas las ediciones son operaciones sobre un "mapa de tiempo" con un valor por cada 5 ms: de qué
cuadro del audio original sale cada cuadro del resultado (o silencio), más el cambio de tono por
cuadro. Estirar es recorrer más despacio los cuadros de análisis de WORLD (tono, timbre y
aspereza) dentro del tramo; cortar y mover reordenan ese mapa; afinar ajusta el cambio de tono.
Luego WORLD sintetiza el audio siguiendo el mapa.

## Cómo compilarlo

Necesitás `web/world.js`, que sale de compilar con Emscripten. Lo más simple es GitHub:

1. Subí esta carpeta a un repositorio público de GitHub (rama `main`), incluida la carpeta oculta
   `.github`.
2. En Settings → Pages, elegí "GitHub Actions" como fuente.
3. Cada vez que subas cambios, `.github/workflows/publicar.yml` corre las pruebas, compila y
   publica la página. El link queda en Settings → Pages.

En tu PC: instalá Emscripten (en Arch, el paquete `emscripten`), corré `bash build.sh` y abrí la
carpeta `web` con `python -m http.server 8000` (hay que abrirla por http, no con doble clic).

## Pruebas

- `test/test_nativo.cpp`: el motor de C++ con una voz sintética (estirar, tono, formantes, silencios
  y saltos). Se corre en GitHub antes de compilar.
- `node test/test_editor.js`: la lógica de edición, incluida la detección y afinado de notas. Se
  corre en GitHub antes de compilar.
- `node test/ui_test.js` y `node test/ui_test2.js`: la página en Chrome sin pantalla, con un motor
  falso (`test/mock_world.js`) que reemplaza a WORLD. Necesitan Playwright; no corren en GitHub.

**No verificado** (no se pudo en el entorno donde se escribió):
- Cómo suena WORLD con voces reales, en particular tras cambios grandes de tono o muchos cortes.
- La detección de notas con canto real: se probó con voces sintéticas con vibrato de hasta ±0,6
  semitonos. Vibratos más anchos (±1 semitono o más) o glissandos largos pueden partir una nota
  en varias.
- Que no haya clics en los bordes de los segmentos movidos o cortados (no se agregó fundido).
- El rendimiento y la memoria en un teléfono.

## Límites conocidos

- Memoria: WORLD guarda varios números por cada 5 ms de audio. Audios largos o calidad alta
  pueden agotar la memoria de un teléfono. Empezá con audios cortos y calidad 22 kHz.
- Solo audio mono (se mezcla a mono al abrir).
- WORLD funciona mejor con voz sola; estirados muy grandes pueden sonar con artefactos.
- Todavía no hay edición de formantes en pantalla (el motor ya lo soporta).
