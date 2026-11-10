// Logica de edicion (sin pantalla): se puede probar con Node.
//
// Estado de edicion `est` = tres arreglos con un valor por cuadro de la linea de tiempo ACTUAL:
//   mapa  : de que cuadro (fraccionario) del audio original sale este cuadro
//   semis : cambio de tono en semitonos
//   form  : razon de formantes (1 = sin cambio)
// Estirar un tramo es solo remuestrear estos tres arreglos. El audio se sintetiza
// despues con WORLD siguiendo el estado.
(function (root) {
  'use strict';

  function muestrear(arr, p) {
    const n = arr.length;
    if (p <= 0) return arr[0];
    if (p >= n - 1) return arr[n - 1];
    const i = Math.floor(p), f = p - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  }

  function estadoInicial(n) {
    const mapa = new Float64Array(n), semis = new Float64Array(n), form = new Float64Array(n);
    for (let i = 0; i < n; i++) { mapa[i] = i; form[i] = 1; }
    return { mapa, semis, form };
  }

  function copiar(est) {
    return { mapa: est.mapa.slice(), semis: est.semis.slice(), form: est.form.slice() };
  }

  // Estira el tramo [a, b] (en cuadros de la linea de tiempo actual) por `factor`.
  // Devuelve { est, nuevoA, nuevoB } o null si el tramo es demasiado corto.
  function estirar(est, a, b, factor, conservar) {
    const n = est.mapa.length, ultimo = n - 1;
    a = Math.max(0, Math.min(ultimo, a));
    b = Math.max(a, Math.min(ultimo, b));
    if (!(factor > 0) || b - a < 2) return null;
    const largo = (b - a) * factor;
    const total = conservar ? a + largo + (ultimo - b) + 1 : largo + 1;
    const out = Math.max(2, Math.floor(total));
    const mapa = new Float64Array(out), semis = new Float64Array(out), form = new Float64Array(out);
    for (let j = 0; j < out; j++) {
      let s;
      if (conservar) {
        if (j < a) s = j;
        else if (j < a + largo) s = a + (j - a) / factor;
        else s = b + (j - a - largo);
      } else {
        s = a + j / factor;
      }
      s = Math.max(0, Math.min(ultimo, s));
      mapa[j] = muestrear(est.mapa, s);
      semis[j] = muestrear(est.semis, s);
      form[j] = muestrear(est.form, s);
    }
    return {
      est: { mapa, semis, form },
      nuevoA: conservar ? a : 0,
      nuevoB: (conservar ? a : 0) + largo,
    };
  }

  // F0 (Hz) del original en la posicion fraccionaria p (0 = sin voz). Igual criterio que el motor C++.
  function f0En(f0, p) {
    const N = f0.length;
    p = Math.max(0, Math.min(N - 1, p));
    const i0 = Math.floor(p), i1 = Math.min(i0 + 1, N - 1), fr = p - i0;
    const a = f0[i0], b = f0[i1];
    if (a > 0 && b > 0) return Math.exp((1 - fr) * Math.log(a) + fr * Math.log(b));
    return fr < 0.5 ? a : b;
  }

  // Curva de tono actual (Hz por cuadro) con los cambios de semitonos aplicados.
  function curvaPitch(f0, est, conCambios) {
    const n = est.mapa.length, out = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const f = f0En(f0, est.mapa[j]);
      out[j] = f > 0 ? (conCambios === false ? f : f * Math.pow(2, est.semis[j] / 12)) : 0;
    }
    return out;
  }

  // Fija el tono de los cuadros [desde, hasta] a `hz` (solo donde hay voz).
  function fijarTono(est, f0, desde, hasta, hz) {
    const n = est.mapa.length;
    const j0 = Math.max(0, Math.min(n - 1, Math.floor(desde)));
    const j1 = Math.max(0, Math.min(n - 1, Math.ceil(hasta)));
    for (let j = j0; j <= j1; j++) {
      const base = f0En(f0, est.mapa[j]);
      if (base > 0) est.semis[j] = 12 * Math.log2(hz / base);
    }
  }

  const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const hzAMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
  const midiAHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const nombreNota = (m) => NOMBRES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const esTeclaNegra = (m) => [1, 3, 6, 8, 10].indexOf(((Math.round(m) % 12) + 12) % 12) >= 0;

  // Audio float [-1, 1] -> archivo WAV de 16 bits (ArrayBuffer)
  function aWav(muestras, fs) {
    const n = muestras.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, fs, true); v.setUint32(28, fs * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    txt(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, muestras[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  const API = { muestrear, estadoInicial, copiar, estirar, f0En, curvaPitch, fijarTono,
                hzAMidi, midiAHz, nombreNota, esTeclaNegra, aWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Editor = API;
})(typeof self !== 'undefined' ? self : this);
