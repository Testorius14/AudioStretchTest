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

console.log(fallos ? '\n' + fallos + ' FALLOS' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
