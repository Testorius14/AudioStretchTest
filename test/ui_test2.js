// Pruebas de las funciones nuevas en Chrome sin pantalla, con el motor falso:
//   node test/ui_test2.js
// Cubre: cortar, mover, borrar, estirar con cortes, afinar a la nota, guardar/abrir proyecto y la
// app instalable (manifest, service worker y funcionamiento sin conexion).
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const Editor = require('../web/editor.js');

const raiz = path.join(__dirname, '..');
const sitio = '/tmp/ui_site2';
fs.rmSync(sitio, { recursive: true, force: true });
fs.mkdirSync(sitio, { recursive: true });
for (const f of fs.readdirSync(path.join(raiz, 'web'))) {
  if (f !== 'world.js') fs.copyFileSync(path.join(raiz, 'web', f), path.join(sitio, f));
}
fs.copyFileSync(path.join(__dirname, 'mock_world.js'), path.join(sitio, 'world.js'));

const SR = 22050, x = new Float32Array(SR * 3);
for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 150 * i / SR);
fs.writeFileSync('/tmp/prueba2.wav', Buffer.from(Editor.aWav(x, SR)));

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
  await new Promise((r) => srv.listen(8766, r));
  const nav = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const ctxt = await nav.newContext({ viewport: { width: 1100, height: 650 }, acceptDownloads: true });
  const pag = await ctxt.newPage();
  const errores = [];
  pag.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  pag.on('response', (r) => { if (r.status() === 404) errores.push('404: ' + r.url()); });
  pag.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errores.push('console: ' + m.text()); });

  const estado = () => pag.textContent('#estado');
  const esperar = async (txt, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await estado()).includes(txt)) return true; await pag.waitForTimeout(80); }
    return false;
  };
  const leerEst = () => pag.evaluate(() => {
    const S = window.estirador.estado();
    return { n: S.est.mapa.length, cortes: S.est.cortes.slice(), mapa: Array.from(S.est.mapa), semis: Array.from(S.est.semis),
             seg: S.seg, sel: S.sel, hayTono: S.hayTono, curva: Array.from(S.curvaAct), base: Array.from(S.curvaBase) };
  });
  let caja;
  const xT = (t) => caja.x + 46 + (caja.width - 46) / 3 * t;   // 3 s ocupan todo el ancho
  const arrastrar = async (t0, t1, y = 150) => {
    await pag.mouse.move(xT(t0), caja.y + y); await pag.mouse.down();
    await pag.mouse.move((xT(t0) + xT(t1)) / 2, caja.y + y, { steps: 4 });
    await pag.mouse.move(xT(t1), caja.y + y, { steps: 4 }); await pag.mouse.up();
  };
  const tocar = async (t, y = 150) => { await pag.mouse.move(xT(t), caja.y + y); await pag.mouse.down(); await pag.mouse.up(); };
  const abrirAudio = async () => {
    await pag.setInputFiles('#archivo', '/tmp/prueba2.wav');
    return esperar('Listo');
  };
  const bajarWav = async () => {
    const [d] = await Promise.all([pag.waitForEvent('download', { timeout: 20000 }), pag.click('#bGuardar')]);
    await d.saveAs('/tmp/salida_t2.wav');
    const w = fs.readFileSync('/tmp/salida_t2.wav');
    const pcm = new Int16Array(w.buffer, w.byteOffset + 44, (w.length - 44) / 2);
    const rms = (a, b) => { let s = 0, k = 0; for (let i = (a * SR) | 0; i < Math.min(pcm.length, (b * SR) | 0); i++) { s += pcm[i] * pcm[i]; k++; } return k ? Math.sqrt(s / k) : 0; };
    const frec = (a, b) => { let c = 0; for (let i = Math.max(1, (a * SR) | 0); i < (b * SR | 0); i++) if (pcm[i - 1] < 0 && pcm[i] >= 0) c++; return c / (b - a); };
    return { dur: pcm.length / SR, rms, frec };
  };

  await pag.goto('http://localhost:8766/');
  check(await abrirAudio(), 'abre el audio de prueba');
  caja = await pag.locator('#c').boundingBox();

  console.log('Barra de herramientas');
  for (const id of ['tSel', 'tTono', 'tCortar', 'tMover', 'bBorrar', 'bAfinar', 'bTonoOrig', 'bGuardarProy', 'bAbrirProy'])
    check(await pag.locator('#' + id).count() === 1, 'existe #' + id);
  await pag.screenshot({ path: '/tmp/ui2_0_barra.png' });

  // ---------------- Afinar ----------------
  console.log('Afinar a la nota (en todo el audio)');
  let e0 = await leerEst();
  let medida = await bajarWav();
  const f_antes = medida.frec(0.2, 1.2);
  await pag.click('#bAfinar');
  check(await esperar('Afinadas 2 notas'), 'detecta las 2 frases (' + (await estado()) + ')');
  let e1 = await leerEst();
  const tramo = e1.curva.slice(60, 270);   // 0.3 s a 1.35 s
  const mx = Math.max(...tramo), mn = Math.min(...tramo);
  check(mx - mn < 0.01, 'la voz queda en un solo tono (varia ' + (mx - mn).toFixed(4) + ' Hz)');
  check(Math.abs(tramo[10] - 155.5635) < 0.05, 'y es la nota exacta: ' + tramo[10].toFixed(3) + ' Hz (D#3 = 155.563 Hz)');
  check(e1.hayTono && Math.max(...e1.base.slice(60, 270)) - Math.min(...e1.base.slice(60, 270)) > 4, 'la curva gris conserva el tono original con su vibrato');
  check(e1.curva[290] === 0 && e1.curva[310] === 0, 'el silencio entre frases no se toca');
  medida = await bajarWav();
  const f_desp = medida.frec(0.2, 1.2);
  check(Math.abs(f_desp - 155.56) < 2.5, 'el WAV suena a ' + f_desp.toFixed(1) + ' Hz (antes ' + f_antes.toFixed(1) + ' Hz)');
  await pag.screenshot({ path: '/tmp/ui2_1_afinado.png' });
  await pag.click('#bTonoOrig');
  e1 = await leerEst();
  check(!e1.hayTono && e1.semis.every((v) => v === 0), 'Tono original lo deja como estaba');
  await pag.click('#bDeshacer');
  e1 = await leerEst();
  check(e1.hayTono, 'Deshacer vuelve a lo afinado');
  await pag.click('#bDeshacer');
  e1 = await leerEst();
  check(!e1.hayTono, 'y otro Deshacer deja el audio sin afinar');

  console.log('Afinar solo la seleccion');
  await arrastrar(0.0, 1.0, 150);
  await pag.click('#bAfinar');
  check(await esperar('dentro de la selección'), 'afina dentro de la seleccion (' + (await estado()) + ')');
  e1 = await leerEst();
  check(e1.semis[100] !== 0 && e1.semis[250] === 0, 'solo cambia lo seleccionado');
  await pag.click('#bDeshacer');

  // ---------------- Cortar ----------------
  console.log('Cortar');
  await abrirAudio();
  await pag.click('#tCortar');
  await tocar(1.0);
  await tocar(2.0);
  let ec = await leerEst();
  check(ec.cortes.length === 2 && Math.abs(ec.cortes[0] - 200) <= 2 && Math.abs(ec.cortes[1] - 400) <= 2, 'dos cortes cerca de 1.0 y 2.0 s: ' + JSON.stringify(ec.cortes));
  const [c1, c2] = ec.cortes;
  await tocar(1.0);
  check((await estado()).includes('No se puede cortar'), 'no deja un segundo corte pegado a otro');
  await pag.screenshot({ path: '/tmp/ui2_2_cortes.png' });

  console.log('Estirar con cortes');
  await pag.click('#tSel');
  await arrastrar(1.2, 1.8);
  await pag.fill('#factor', '2'); await pag.click('#bEstirar');
  await esperar('Tramo estirado');
  let ee = await leerEst();
  check(ee.cortes.length === 2 && ee.cortes[0] === c1 && Math.abs(ee.cortes[1] - (c2 + 120)) <= 3, 'el corte de despues se desplaza 120 cuadros (0.6 s): ' + JSON.stringify(ee.cortes));
  await pag.click('#bDeshacer');

  // ---------------- Mover ----------------
  console.log('Mover');
  await pag.click('#tMover');
  await tocar(1.5);
  let em = await leerEst();
  check(em.seg && em.seg.c0 === c1 && em.seg.c1 === c2, 'elige el segmento del medio: ' + JSON.stringify(em.seg));
  await arrastrar(1.5, 2.5);
  em = await leerEst();
  check(em.seg && Math.abs(em.seg.c0 - (c1 + 200)) <= 3, 'el segmento se movio 1 s: ' + JSON.stringify(em.seg));
  check(em.mapa[c1 + 50] === -1 && em.mapa[c1 + 190] === -1, 'donde estaba quedo en silencio');
  check(Math.abs(em.mapa[c1 + 250] - (c1 + 50)) < 1e-9, 'el contenido llego intacto al nuevo lugar');
  await pag.screenshot({ path: '/tmp/ui2_3_movido.png' });
  medida = await bajarWav();
  check(Math.abs(medida.dur - 3.0) < 0.1, 'el WAV dura ' + medida.dur.toFixed(2) + ' s');
  check(medida.rms(1.1, 1.9) < 50, 'el hueco suena a silencio (rms ' + medida.rms(1.1, 1.9).toFixed(1) + ')');
  check(medida.rms(0.2, 0.9) > 3000 && medida.rms(2.1, 2.9) > 3000, 'la voz antes y despues se escucha (rms ' + medida.rms(0.2, 0.9).toFixed(0) + ' y ' + medida.rms(2.1, 2.9).toFixed(0) + ')');

  console.log('Borrar el segmento movido');
  await pag.check('#cerrar');
  await pag.click('#bBorrar');
  em = await leerEst();
  check(em.n < 420 && em.n > 380, 'cerrando el hueco quedan ' + em.n + ' cuadros (~400)');
  medida = await bajarWav();
  check(Math.abs(medida.dur - 2.0) < 0.1, 'el WAV dura ' + medida.dur.toFixed(2) + ' s (esperado ~2.0)');
  await pag.click('#bDeshacer');
  em = await leerEst();
  check(em.n === 601, 'Deshacer devuelve los 601 cuadros');

  console.log('Borrar dejando silencio (sin cerrar el hueco)');
  await pag.uncheck('#cerrar');
  await pag.click('#tMover'); await tocar(0.5);
  await pag.click('#bBorrar');
  em = await leerEst();
  check(em.n === 601 && em.mapa[100] === -1, 'mismo largo y el segmento queda en silencio');

  // ---------------- Proyecto ----------------
  console.log('Guardar y abrir proyecto');
  await abrirAudio();
  await pag.click('#tCortar'); await tocar(1.0);
  await pag.click('#tMover'); await tocar(1.5); await arrastrar(1.5, 2.0);
  await pag.click('#bAfinar');
  await esperar('Afinadas');
  const antes = await leerEst();
  const [dp] = await Promise.all([pag.waitForEvent('download', { timeout: 20000 }), pag.click('#bGuardarProy')]);
  check(dp.suggestedFilename() === 'prueba2.estirador', 'nombre del archivo: ' + dp.suggestedFilename());
  await dp.saveAs('/tmp/proyecto_t2.estirador');
  check(fs.statSync('/tmp/proyecto_t2.estirador').size > 100000, 'el archivo guarda el audio (' + Math.round(fs.statSync('/tmp/proyecto_t2.estirador').size / 1024) + ' KB)');

  const pag2 = await ctxt.newPage();
  pag2.on('pageerror', (e) => errores.push('pageerror2: ' + e.message));
  await pag2.goto('http://localhost:8766/');
  await pag2.setInputFiles('#archivoProy', '/tmp/proyecto_t2.estirador');
  let ok2 = false;
  for (let i = 0; i < 150 && !ok2; i++) { ok2 = (await pag2.textContent('#estado')).includes('Proyecto abierto'); if (!ok2) await pag2.waitForTimeout(100); }
  check(ok2, 'el proyecto se abre (' + (await pag2.textContent('#estado')) + ')');
  const despues = await pag2.evaluate(() => {
    const S = window.estirador.estado();
    return { n: S.est.mapa.length, cortes: S.est.cortes.slice(), mapa: Array.from(S.est.mapa), semis: Array.from(S.est.semis), hayTono: S.hayTono };
  });
  check(despues.n === antes.n && JSON.stringify(despues.cortes) === JSON.stringify(antes.cortes), 'mismos cortes y mismo largo');
  check(JSON.stringify(despues.mapa) === JSON.stringify(antes.mapa) && JSON.stringify(despues.semis) === JSON.stringify(antes.semis), 'mismas ediciones (movimientos, silencios y afinado)');
  check(despues.hayTono, 'el afinado sigue aplicado');
  await pag2.screenshot({ path: '/tmp/ui2_4_proyecto_abierto.png' });
  await pag2.setInputFiles('#archivoProy', '/tmp/prueba2.wav');
  await pag2.waitForTimeout(500);
  check((await pag2.textContent('#estado')).includes('No se pudo abrir el proyecto'), 'un archivo que no es proyecto se rechaza con un mensaje claro');
  await pag2.close();

  // ---------------- App instalable ----------------
  console.log('App instalable (PWA)');
  const man = await pag.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  check(man.name === 'Estirador vocal' && man.display === 'standalone' && man.start_url === './' && man.icons.length === 2, 'el manifest es valido');
  const cdp = await ctxt.newCDPSession(pag);
  try {
    const r = await cdp.send('Page.getInstallabilityErrors');
    // 'in-incognito' aparece solo porque el navegador de pruebas corre en modo privado
    const reales = r.installabilityErrors.filter((e) => e.errorId !== 'in-incognito');
    check(reales.length === 0, 'Chrome no encuentra problemas para instalarla' + (reales.length ? ': ' + JSON.stringify(reales) : ''));
  } catch (e) { console.log('        (no se pudo consultar la instalabilidad: ' + e.message + ')'); }
  await pag.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await pag.reload();
  await pag.waitForTimeout(300);
  check(await pag.evaluate(() => !!navigator.serviceWorker.controller), 'el service worker controla la pagina');
  const guardados = await pag.evaluate(() => caches.open('estirador-v1').then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname)));
  for (const f of ['/index.html', '/editor.js', '/worker.js', '/world.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'])
    check(guardados.includes(f) || (f === '/index.html' && guardados.includes('/')), 'guardado para uso sin conexion: ' + f);

  console.log('Sin conexion');
  await ctxt.setOffline(true);
  await pag.reload();
  check(await pag.locator('#bAbrir').count() === 1, 'la pagina abre sin internet');
  check(await abrirAudio(), 'y se puede abrir un audio y analizarlo sin internet');
  await pag.screenshot({ path: '/tmp/ui2_5_offline.png' });
  await ctxt.setOffline(false);

  console.log('Pantalla chica (telefono)');
  await pag.setViewportSize({ width: 412, height: 800 });
  await pag.waitForTimeout(300);
  await pag.screenshot({ path: '/tmp/ui2_6_telefono.png' });
  const desborda = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!desborda, 'la barra no se sale de la pantalla en un telefono');

  check(errores.length === 0, 'sin errores en la consola' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await nav.close(); srv.close();
  console.log(fallos ? '\n' + fallos + ' FALLOS' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); srv.close(); process.exit(2); });
