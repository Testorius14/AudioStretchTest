// Prueba de la pagina en Chrome sin pantalla, con el motor falso: node test/ui_test.js
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const Editor = require('../web/editor.js');

const raiz = path.join(__dirname, '..');
const sitio = '/tmp/ui_site';
fs.rmSync(sitio, { recursive: true, force: true });
fs.mkdirSync(sitio, { recursive: true });
for (const f of fs.readdirSync(path.join(raiz, 'web'))) {
  if (f !== 'world.js') fs.copyFileSync(path.join(raiz, 'web', f), path.join(sitio, f));  // world.js lo genera build.sh
}
fs.copyFileSync(path.join(__dirname, 'mock_world.js'), path.join(sitio, 'world.js'));

// WAV de prueba: 3 s a 22050 Hz
const SR = 22050, x = new Float32Array(SR * 3);
for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 150 * i / SR);
fs.writeFileSync('/tmp/prueba.wav', Buffer.from(Editor.aWav(x, SR)));

let fallos = 0;
const check = (c, m) => { console.log((c ? '  OK    ' : '  FALLO ') + m); if (!c) fallos++; };

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  const f = path.join(sitio, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => srv.listen(8765, r));
  const nav = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const pag = await nav.newPage({ viewport: { width: 1100, height: 650 }, acceptDownloads: true });
  const errores = [];
  pag.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  pag.on('response', (r) => { if (r.status() === 404 && !r.url().endsWith('favicon.ico')) errores.push('404: ' + r.url()); });
  pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push('console: ' + m.text()); });

  await pag.goto('http://localhost:8765/');
  const estado = () => pag.textContent('#estado');
  const esperar = async (txt, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await estado()).includes(txt)) return true; await pag.waitForTimeout(100); }
    return false;
  };

  console.log('Abrir audio');
  check((await pag.isDisabled('#bEstirar')), 'Estirar deshabilitado antes de abrir');
  await pag.setInputFiles('#archivo', '/tmp/prueba.wav');
  check(await esperar('Listo'), 'analisis termina (' + (await estado()) + ')');
  check(!(await pag.isDisabled('#bEstirar')), 'Estirar se habilita');
  await pag.screenshot({ path: '/tmp/ui_1_abierto.png' });

  console.log('Seleccionar con el mouse');
  const caja = await pag.locator('#c').boundingBox();
  const pps = (caja.width - 46) / 3;
  const xa = caja.x + 46 + pps * 1.0, xb = caja.x + 46 + pps * 2.0, yy = caja.y + 100;
  await pag.mouse.move(xa, yy); await pag.mouse.down();
  await pag.mouse.move((xa + xb) / 2, yy, { steps: 5 }); await pag.mouse.move(xb, yy, { steps: 5 });
  await pag.mouse.up();
  await pag.screenshot({ path: '/tmp/ui_2_seleccion.png' });

  console.log('Estirar x2 conservando el resto');
  await pag.fill('#factor', '2');
  await pag.click('#bEstirar');
  check(await esperar('Tramo estirado'), 'estirado (' + (await estado()) + ')');
  check(!(await pag.isDisabled('#bDeshacer')), 'Deshacer se habilita');
  await pag.screenshot({ path: '/tmp/ui_3_estirado.png' });

  console.log('Guardar WAV y medir el largo');
  const [desc] = await Promise.all([pag.waitForEvent('download', { timeout: 20000 }), pag.click('#bGuardar')]);
  await desc.saveAs('/tmp/salida.wav');
  const w = fs.readFileSync('/tmp/salida.wav');
  const dur = (w.length - 44) / 2 / SR;
  check(Math.abs(dur - 4.0) < 0.1, 'duracion ' + dur.toFixed(2) + ' s (esperado ~4.0: 3 s + 1 s extra)');
  const pcm = new Int16Array(w.buffer, w.byteOffset + 44, (w.length - 44) / 2);
  let pico = 0; for (const v of pcm) pico = Math.max(pico, Math.abs(v));
  check(pico > 8000 && pico < 32768, 'el audio no esta vacio ni saturado (pico ' + pico + ')');

  console.log('Reproducir y detener');
  await pag.click('#bPlay');
  await pag.waitForTimeout(600);
  check((await pag.textContent('#bPlay')).includes('Detener'), 'el boton pasa a Detener');
  await pag.screenshot({ path: '/tmp/ui_4_play.png' });
  await pag.click('#bPlay');
  check((await pag.textContent('#bPlay')).includes('Reproducir'), 'vuelve a Reproducir');

  console.log('Deshacer');
  await pag.click('#bDeshacer');
  check((await estado()).includes('Deshecho'), 'deshacer');
  const [d2] = await Promise.all([pag.waitForEvent('download', { timeout: 20000 }), pag.click('#bGuardar')]);
  await d2.saveAs('/tmp/salida2.wav');
  const dur2 = (fs.readFileSync('/tmp/salida2.wav').length - 44) / 2 / SR;
  check(Math.abs(dur2 - 3.0) < 0.1, 'tras deshacer vuelve a ~3.0 s (' + dur2.toFixed(2) + ')');

  console.log('Herramienta de tono');
  await pag.click('#tTono');
  await pag.mouse.move(xa, caja.y + 80); await pag.mouse.down();
  await pag.mouse.move(xb, caja.y + 160, { steps: 10 }); await pag.mouse.up();
  await pag.screenshot({ path: '/tmp/ui_5_tono.png' });
  const [d3] = await Promise.all([pag.waitForEvent('download', { timeout: 20000 }), pag.click('#bGuardar')]);
  await d3.saveAs('/tmp/salida3.wav');
  const w3 = fs.readFileSync('/tmp/salida3.wav');
  const p3 = new Int16Array(w3.buffer, w3.byteOffset + 44, (w3.length - 44) / 2);
  // Cruces por cero en 1.0-1.3 s: el tono cambio respecto de 150 Hz?
  const cruces = (ini, fin) => { let c = 0; for (let i = ini * SR | 0; i < (fin * SR | 0); i++) if (p3[i - 1] < 0 && p3[i] >= 0) c++; return c / (fin - ini); };
  const fAntes = cruces(0.2, 0.9), fTono = cruces(1.05, 1.35);
  console.log('        (frecuencia antes ' + fAntes.toFixed(0) + ' Hz, en lo editado ' + fTono.toFixed(0) + ' Hz)');
  check(Math.abs(fAntes - fTono) > 15, 'el dibujo de tono cambio el sonido en la zona editada');

  console.log('Zoom y desplazamiento');
  await pag.click('#bMas'); await pag.click('#bMas');
  await pag.fill('#desp', '1');
  await pag.screenshot({ path: '/tmp/ui_6_zoom.png' });

  check(errores.length === 0, 'sin errores en la consola' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await nav.close(); srv.close();
  console.log(fallos ? '\n' + fallos + ' FALLOS' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); srv.close(); process.exit(2); });
