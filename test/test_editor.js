// Prueba de la logica de edicion: node test/test_editor.js
const E = require('../web/editor.js');
let fallos = 0;
function check(c, msg) { console.log((c ? '  OK    ' : '  FALLO ') + msg); if (!c) fallos++; }
const cerca = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

const n = 601; // 3 s a 5 ms
let est = E.estadoInicial(n);
check(est.mapa.length === n && est.mapa[100] === 100 && est.form[5] === 1, 'estado inicial es la identidad');

console.log('Estirar 1.0-2.0 s (cuadros 200-400) x3 conservando el resto');
let r = E.estirar(est, 200, 400, 3, true);
check(r.est.mapa.length === 1001, 'largo ' + r.est.mapa.length + ' (esperado 1001)');
let mono = true; for (let j = 1; j < r.est.mapa.length; j++) mono = mono && r.est.mapa[j] >= r.est.mapa[j - 1];
check(mono, 'el mapa es creciente');
check(cerca(r.est.mapa[100], 100), 'antes del tramo no cambia');
check(cerca(r.est.mapa[200 + 300], 200 + 100), 'a mitad del tramo estirado apunta a mitad del original');
check(cerca(r.est.mapa[1000], 600), 'termina en el ultimo cuadro original');
check(cerca(r.nuevoA, 200) && cerca(r.nuevoB, 800), 'nueva seleccion 200-800');

console.log('Estirar dos veces (composicion)');
let r2 = E.estirar(r.est, 200, 800, 0.5, true);
check(r2.est.mapa.length === 701, 'largo ' + r2.est.mapa.length + ' (esperado 701)');
// En r.est el cuadro 500 apunta al original 300 (200 + 300/3). Con x0.5 sobre 200-800,
// el cuadro 350 de la salida sale del cuadro 500 de r.est, o sea del original 300.
check(cerca(r2.est.mapa[350], 300, 1e-6), 'la composicion apunta al original correcto (' + r2.est.mapa[350] + ')');

console.log('Solo el tramo (descartar el resto)');
let r3 = E.estirar(est, 200, 400, 3, false);
check(r3.est.mapa.length === 601, 'largo ' + r3.est.mapa.length + ' (esperado 601)');
check(cerca(r3.est.mapa[0], 200) && cerca(r3.est.mapa[600], 400), 'va de 200 a 400');
check(cerca(r3.nuevoA, 0) && cerca(r3.nuevoB, 600), 'seleccion cubre todo');

console.log('Tramo demasiado corto');
check(E.estirar(est, 100, 101, 2, true) === null, 'devuelve null');

console.log('Tono');
const f0 = new Float64Array(n).fill(150);
for (let i = 250; i < 300; i++) f0[i] = 0; // zona sin voz
let c = E.curvaPitch(f0, est);
check(cerca(c[100], 150, 1e-6) && c[270] === 0, 'curva: 150 Hz con voz, 0 sin voz');
E.fijarTono(est, f0, 100, 120, 300);
c = E.curvaPitch(f0, est);
check(cerca(c[110], 300, 1e-6), 'fijar tono a 300 Hz');
check(cerca(est.semis[110], 12, 1e-6), 'equivale a +12 semitonos');
check(cerca(c[130], 150), 'fuera del rango no cambia');
let rr = E.estirar(est, 90, 130, 2, true);
const ci = E.curvaPitch(f0, rr.est);
check(cerca(ci[2 * 20 + 90], 300, 1), 'el cambio de tono acompana al estiramiento');

console.log('Notas');
check(E.nombreNota(69) === 'A4' && E.nombreNota(60) === 'C4', 'nombres de nota');
check(cerca(E.midiAHz(69), 440) && cerca(E.hzAMidi(880), 81), 'Hz <-> MIDI');
check(E.esTeclaNegra(61) && !E.esTeclaNegra(60), 'teclas negras');

console.log('WAV');
const w = E.aWav(new Float32Array([0, 0.5, -0.5, 1]), 22050);
const dv = new DataView(w);
check(w.byteLength === 52 && dv.getUint32(24, true) === 22050 && dv.getInt16(46, true) > 16000, 'cabecera y datos del WAV');

// =====================  Cortar, mover, borrar  =====================
console.log('Cortes: dividir y segmentos');
const e0 = E.estadoInicial(n);
let e1 = E.dividir(e0, 200); e1 = E.dividir(e1, 400);
check(JSON.stringify(e1.cortes) === '[200,400]', 'dos cortes: ' + JSON.stringify(e1.cortes));
check(e0.cortes.length === 0, 'dividir no modifica el original');
check(E.dividir(e1, 201) === null, 'no deja cortes a menos de 2 cuadros de otro');
check(E.dividir(e1, 1) === null && E.dividir(e1, n - 1) === null, 'no corta pegado a los bordes');
let sg = E.segmentoEn(e1, 300);
check(sg.c0 === 200 && sg.c1 === 400, 'segmento del medio 200-400');
sg = E.segmentoEn(e1, 0); check(sg.c0 === 0 && sg.c1 === 200, 'primer segmento 0-200');
sg = E.segmentoEn(e1, 600); check(sg.c0 === 400 && sg.c1 === n, 'ultimo segmento 400-' + n);

console.log('Mover un segmento');
let mv = E.mover(e1, 200, 400, 100);
check(mv.c0 === 300 && mv.c1 === 500, 'nuevo lugar 300-500');
check(mv.est.mapa.length === n, 'la linea de tiempo no cambia de largo');
check(mv.est.mapa[199] === 199 && mv.est.mapa[200] === -1 && mv.est.mapa[299] === -1, 'queda silencio donde estaba (200-299)');
check(mv.est.mapa[300] === 200 && mv.est.mapa[499] === 399, 'el segmento llega entero a 300-499');
check(mv.est.mapa[500] === 500 && mv.est.mapa[600] === 600, 'lo que estaba despues no se toca');
check(JSON.stringify(mv.est.cortes) === '[200,300,500]', 'cortes: ' + JSON.stringify(mv.est.cortes));
check(E.esSilencio(mv.est, 200, 300) && !E.esSilencio(mv.est, 300, 310), 'esSilencio');
check(e1.mapa[250] === 250, 'mover no modifica el original');
mv = E.mover(e1, 400, n, 100);
check(mv.est.mapa.length === 701 && mv.est.mapa[700] === 600 && mv.est.mapa[400] === -1, 'pasarse del final alarga la linea de tiempo');
check(JSON.stringify(mv.est.cortes) === '[200,400,500]', 'cortes al alargar: ' + JSON.stringify(mv.est.cortes));
mv = E.mover(e1, 200, 400, -500);
check(mv.c0 === 0 && mv.c1 === 200 && mv.est.mapa[0] === 200, 'no pasa del inicio (se pega en 0)');
check(E.mover(e1, 200, 400, 0) === null, 'mover 0 cuadros devuelve null');

console.log('Borrar');
let bo = E.borrar(e1, 200, 400, true);
check(bo.est.mapa.length === 401 && bo.est.mapa[199] === 199 && bo.est.mapa[200] === 400, 'cerrando el hueco: 401 cuadros y se juntan');
check(JSON.stringify(bo.est.cortes) === '[200]', 'cortes tras cerrar: ' + JSON.stringify(bo.est.cortes));
bo = E.borrar(e1, 200, 400, false);
check(bo.est.mapa.length === n && bo.est.mapa[300] === -1 && bo.est.mapa[400] === 400, 'dejando silencio: mismo largo y hueco de silencio');
check(JSON.stringify(bo.est.cortes) === '[200,400]', 'cortes tras silenciar');
check(E.borrar(e1, 0, n, true) === null, 'no deja borrar todo');
check(E.borrar(e1, 100, 100, true) === null, 'rango vacio devuelve null');

console.log('Estirar respeta los cortes');
r = E.estirar(e1, 250, 350, 2, true);
check(r.est.mapa.length === 701, 'largo ' + r.est.mapa.length + ' (esperado 701)');
check(JSON.stringify(r.est.cortes) === '[200,500]', 'los cortes se desplazan: ' + JSON.stringify(r.est.cortes));
const saltos = E.estadoInicial(20);
for (let j = 10; j < 20; j++) saltos.mapa[j] = 100 + (j - 10);
saltos.cortes = [10];
r = E.estirar(saltos, 5, 15, 2, true);
check(!Array.from(r.est.mapa).some((v) => v > 9.5 && v < 99.5), 'no interpola a traves de un corte (sin cuadros inventados)');
const conHueco = E.estadoInicial(20);
for (let j = 0; j < 20; j++) conHueco.mapa[j] = 100 + j;
conHueco.mapa[10] = -1;
r = E.estirar(conHueco, 5, 15, 2, true);
check(!Array.from(r.est.mapa).some((v) => v > -0.5 && v < 99.5), 'no interpola contra un silencio (sin valores a medio camino)');
check(E.curvaPitch(new Float64Array(20).fill(150), conHueco)[10] === 0, 'un silencio no tiene tono');

// =====================  Afinar a la nota  =====================
console.log('Afinar a la nota');
const NF = 800;
const cents = (hz, ref) => 1200 * Math.log2(hz / ref);
const C4 = E.midiAHz(60), E4 = E.midiAHz(64), A3 = E.midiAHz(57);
const vib = (j, amp) => amp * Math.sin(2 * Math.PI * 5.5 * j * 0.005);
const f0a = new Float64Array(NF);
for (let j = 50; j < 300; j++) f0a[j] = C4 * Math.pow(2, (30 + vib(j, 40)) / 1200);   // C4 +30 cents, vibrato +-40
for (let j = 310; j < 500; j++) f0a[j] = E4 * Math.pow(2, (-25 + vib(j, 30)) / 1200); // E4 -25 cents, vibrato +-30
let estA = E.estadoInicial(NF);
let ra = E.afinar(estA, f0a, 0, NF - 1, { retener: 0, fuerza: 1 });
check(ra.notas === 2, 'detecta 2 notas (' + ra.notas + ')');
let cA = E.curvaPitch(f0a, estA), dev1 = 0, dev2 = 0;
for (let j = 50; j < 300; j++) dev1 = Math.max(dev1, Math.abs(cents(cA[j], C4)));
for (let j = 310; j < 500; j++) dev2 = Math.max(dev2, Math.abs(cents(cA[j], E4)));
check(dev1 < 0.01, 'la nota de +30 cents queda exacta en C4 (desvio maximo ' + dev1.toFixed(4) + ' cents)');
check(dev2 < 0.01, 'la nota de -25 cents queda exacta en E4 (desvio maximo ' + dev2.toFixed(4) + ' cents)');
check(cA[0] === 0 && cA[305] === 0 && cA[600] === 0, 'donde no hay voz no se toca');
check(cerca(estA.semis[0], 0) && cerca(estA.semis[600], 0), 'semitonos sin cambio fuera de las notas');

estA = E.estadoInicial(NF);
ra = E.afinar(estA, f0a, 0, NF - 1, { retener: 1, fuerza: 1 });
cA = E.curvaPitch(f0a, estA);
const cc = []; for (let j = 50; j < 300; j++) cc.push(cents(cA[j], C4));
const ordenado = cc.slice().sort((a, b) => a - b);
check(Math.abs(ordenado[ordenado.length >> 1]) < 3, 'conservando el vibrato: la nota queda centrada en C4 (mediana ' + ordenado[ordenado.length >> 1].toFixed(2) + ' cents)');
check(ordenado[ordenado.length - 1] - ordenado[0] > 60, 'el vibrato se conserva (rango ' + (ordenado[ordenado.length - 1] - ordenado[0]).toFixed(0) + ' cents)');

estA = E.estadoInicial(NF);
E.afinar(estA, f0a, 0, NF - 1, { retener: 1, fuerza: 0.5 });
cA = E.curvaPitch(f0a, estA);
const c5 = []; for (let j = 50; j < 300; j++) c5.push(cents(cA[j], C4));
c5.sort((a, b) => a - b);
check(Math.abs(c5[c5.length >> 1] - 15) < 3, 'fuerza 50%: llega a la mitad del camino (mediana ' + c5[c5.length >> 1].toFixed(2) + ' cents, esperado ~15)');

console.log('Afinar: solo una parte, y notas pegadas');
estA = E.estadoInicial(NF);
E.afinar(estA, f0a, 0, 150, { retener: 0, fuerza: 1 });
check(estA.semis[100] !== 0 && estA.semis[200] === 0, 'solo cambia dentro del rango pedido');
const f0b = new Float64Array(400);
for (let j = 0; j < 200; j++) f0b[j] = C4 * Math.pow(2, (20 + vib(j, 30)) / 1200);
for (let j = 200; j < 400; j++) f0b[j] = E4 * Math.pow(2, (10 + vib(j, 30)) / 1200);
const estB = E.estadoInicial(400);
const dn = E.detectarNotas(f0b, estB, 0, 399);
check(dn.notas.length === 2 && Math.abs(dn.notas[0].j1 - 199) <= 6, 'dos notas pegadas, el limite cae cerca del cuadro 200 (' + dn.notas.map((x) => x.j0 + '-' + x.j1).join(', ') + ')');
E.afinar(estB, f0b, 0, 399, { retener: 0, fuerza: 1 });
const cB = E.curvaPitch(f0b, estB);
let salto = 0;
for (let j = 1; j < 400; j++) salto = Math.max(salto, Math.abs(12 * Math.log2(cB[j] / cB[j - 1])));
check(salto < 2, 'el salto entre notas pegadas se reparte en una rampa (maximo ' + salto.toFixed(2) + ' semitonos por cuadro, sin rampa seria 4)');
check(Math.abs(cents(cB[100], C4)) < 0.01 && Math.abs(cents(cB[300], E4)) < 0.01, 'las dos notas quedan exactas');

console.log('Afinar: vibrato ancho no se parte en varias notas');
const f0c = new Float64Array(400);
for (let j = 0; j < 400; j++) f0c[j] = A3 * Math.pow(2, vib(j, 80) / 1200);  // +-0.8 semitonos (vibrato ancho)
const estC = E.estadoInicial(400);
const rc = E.afinar(estC, f0c, 0, 399, { retener: 0, fuerza: 1 });
const cC = E.curvaPitch(f0c, estC);
let devC = 0; for (let j = 0; j < 400; j++) devC = Math.max(devC, Math.abs(cents(cC[j], A3)));
check(rc.notas === 1, 'una sola nota (' + rc.notas + ')');
check(devC < 0.01, 'queda plana en A3 (desvio maximo ' + devC.toFixed(4) + ' cents)');

console.log('Afinar: respeta cortes y silencios');
const estD = E.estadoInicial(NF);
estD.cortes = [150];
const dd = E.detectarNotas(f0a, estD, 0, NF - 1);
check(dd.notas.some((x) => x.j1 === 149) && dd.notas.some((x) => x.j0 === 150), 'una nota no cruza un corte');
const estE = E.estadoInicial(NF);
for (let j = 100; j < 130; j++) estE.mapa[j] = -1;
E.afinar(estE, f0a, 0, NF - 1, { retener: 0, fuerza: 1 });
check(estE.semis[110] === 0, 'el silencio no se afina');
const estF = E.estadoInicial(NF);
check(E.afinar(estF, new Float64Array(NF), 0, NF - 1, {}).notas === 0, 'sin voz: 0 notas');
E.restablecerTono(estA, 0, NF - 1);
check(estA.semis.every((v) => v === 0), 'restablecer tono');

// =====================  Proyecto  =====================
console.log('Archivo de proyecto');
const audioP = new Int16Array([0, 1000, -1000, 32767, -32768, 5, 7]);
const estP = { mapa: Float64Array.from([0, 1, 2, -1, 4]), semis: Float64Array.from([0, 0.5, 0, 0, -0.25]),
               form: Float64Array.from([1, 1, 1, 1, 1.2]), cortes: [2, 3] };
const bufP = E.guardarProyecto({ fs: 22050, fp: 5, f0min: 71, f0max: 800, harvest: true, cuadrosOrig: 5, audio: audioP, est: estP });
const pp = E.leerProyecto(bufP);
check(pp.fs === 22050 && pp.fp === 5 && pp.f0min === 71 && pp.f0max === 800 && pp.harvest === true && pp.cuadrosOrig === 5, 'parametros');
check(Array.from(pp.audio).join() === Array.from(audioP).join(), 'audio identico');
check(Array.from(pp.est.mapa).join() === Array.from(estP.mapa).join() && Array.from(pp.est.semis).join() === Array.from(estP.semis).join()
      && Array.from(pp.est.form).join() === Array.from(estP.form).join(), 'ediciones identicas (incluye el silencio)');
check(JSON.stringify(pp.est.cortes) === '[2,3]', 'cortes');
let lanzo = false; try { E.leerProyecto(new ArrayBuffer(40)); } catch (e) { lanzo = true; }
check(lanzo, 'un archivo cualquiera se rechaza');
lanzo = false; try { E.leerProyecto(bufP.slice(0, bufP.byteLength - 10)); } catch (e) { lanzo = true; }
check(lanzo, 'un proyecto cortado se rechaza');

console.log(fallos ? '\n' + fallos + ' FALLOS' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
