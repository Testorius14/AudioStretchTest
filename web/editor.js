// Logica de edicion (sin pantalla): se puede probar con Node.
//
// Estado de edicion `est`:
//   mapa   : por cada cuadro de la linea de tiempo ACTUAL, de que cuadro (fraccionario) del audio
//            original sale. Un valor negativo (-1) significa SILENCIO.
//   semis  : cambio de tono en semitonos, por cuadro
//   form   : razon de formantes (1 = sin cambio), por cuadro
//   cortes : lista ordenada de indices de cuadro donde hay una frontera entre segmentos
//            (un corte en c separa el cuadro c-1 del c)
// Estirar, cortar, mover y borrar son solo operaciones sobre estos arreglos. El audio se
// sintetiza despues con WORLD siguiendo el estado.
(function (root) {
  'use strict';

  const SILENCIO = -1;
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  // Interpola arr en la posicion fraccionaria p SIN cruzar un corte (ahi hay un salto de contenido).
  // esMapa: ademas no interpola contra un silencio.
  function muestrear(arr, p, cortes, esMapa) {
    const n = arr.length;
    if (p <= 0) return arr[0];
    if (p >= n - 1) return arr[n - 1];
    const i = Math.floor(p), f = p - i;
    if (f === 0) return arr[i];
    const a = arr[i], b = arr[i + 1];
    if ((cortes && cortes.has(i + 1)) || (esMapa && (a < 0 || b < 0))) return f < 0.5 ? a : b;
    return a * (1 - f) + b * f;
  }

  function estadoInicial(n) {
    const mapa = new Float64Array(n), semis = new Float64Array(n), form = new Float64Array(n);
    for (let i = 0; i < n; i++) { mapa[i] = i; form[i] = 1; }
    return { mapa, semis, form, cortes: [] };
  }

  function copiar(est) {
    return { mapa: est.mapa.slice(), semis: est.semis.slice(), form: est.form.slice(),
             cortes: (est.cortes || []).slice() };
  }

  function limpiarCortes(lista, n) {
    return Array.from(new Set(lista.map(Math.round))).filter((c) => c > 0 && c < n).sort((a, b) => a - b);
  }

  // ---------- Estirar ----------
  // Estira el tramo [a, b] (en cuadros de la linea de tiempo actual) por `factor`.
  // Devuelve { est, nuevoA, nuevoB } o null si el tramo es demasiado corto.
  function estirar(est, a, b, factor, conservar) {
    const n = est.mapa.length, ultimo = n - 1;
    a = limitar(a, 0, ultimo);
    b = limitar(b, a, ultimo);
    if (!(factor > 0) || b - a < 2) return null;
    const largo = (b - a) * factor;
    const total = conservar ? a + largo + (ultimo - b) + 1 : largo + 1;
    const out = Math.max(2, Math.floor(total));
    const setC = new Set(est.cortes || []);
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
      s = limitar(s, 0, ultimo);
      mapa[j] = muestrear(est.mapa, s, setC, true);
      semis[j] = muestrear(est.semis, s, setC, false);
      form[j] = muestrear(est.form, s, setC, false);
    }
    const nc = [];
    for (const c of est.cortes || []) {
      if (conservar) {
        if (c <= a) nc.push(c);
        else if (c < b) nc.push(a + (c - a) * factor);
        else nc.push(c + (factor - 1) * (b - a));
      } else if (c > a && c < b) {
        nc.push((c - a) * factor);
      }
    }
    return {
      est: { mapa, semis, form, cortes: limpiarCortes(nc, out) },
      nuevoA: conservar ? a : 0,
      nuevoB: (conservar ? a : 0) + largo,
    };
  }

  // ---------- Segmentos: cortar, mover, borrar ----------
  function limites(est) { return [0].concat(est.cortes || [], [est.mapa.length]); }

  // Segmento (entre cortes) que contiene el cuadro j: { c0, c1 } con c1 exclusivo.
  function segmentoEn(est, j) {
    const L = limites(est), n = est.mapa.length;
    j = limitar(Math.floor(j), 0, n - 1);
    for (let i = 0; i < L.length - 1; i++) if (j >= L[i] && j < L[i + 1]) return { c0: L[i], c1: L[i + 1] };
    return null;
  }

  // Agrega un corte en el cuadro j. Devuelve el estado nuevo, o null si no se puede
  // (muy cerca de un borde o de otro corte).
  function dividir(est, j) {
    j = Math.round(j);
    const n = est.mapa.length;
    if (j < 2 || j > n - 2) return null;
    if ((est.cortes || []).some((c) => Math.abs(c - j) < 2)) return null;
    const e = copiar(est);
    e.cortes.push(j);
    e.cortes.sort((a, b) => a - b);
    return e;
  }

  function esSilencio(est, c0, c1) {
    for (let j = c0; j < c1; j++) if (est.mapa[j] >= 0) return false;
    return true;
  }

  // Mueve el segmento [c0, c1) `delta` cuadros. Deja silencio donde estaba y pisa lo que haya
  // donde cae. Si se pasa del final, la linea de tiempo se alarga. Devuelve { est, c0, c1 } o null.
  function mover(est, c0, c1, delta) {
    const n = est.mapa.length, len = c1 - c0;
    delta = Math.round(delta);
    const ns = Math.max(0, c0 + delta);
    if (len < 1 || ns === c0) return null;
    const ne = ns + len, N = Math.max(n, ne);
    const mapa = new Float64Array(N).fill(SILENCIO);
    const semis = new Float64Array(N), form = new Float64Array(N).fill(1);
    mapa.set(est.mapa); semis.set(est.semis); form.set(est.form);
    const sm = est.mapa.slice(c0, c1), ss = est.semis.slice(c0, c1), sf = est.form.slice(c0, c1);
    for (let j = c0; j < c1; j++) { mapa[j] = SILENCIO; semis[j] = 0; form[j] = 1; }
    mapa.set(sm, ns); semis.set(ss, ns); form.set(sf, ns);
    const lista = (est.cortes || []).concat([c0, c1, ns, ne]).filter((c) => !(c > ns && c < ne));
    return { est: { mapa, semis, form, cortes: limpiarCortes(lista, N) }, c0: ns, c1: ne };
  }

  // Borra los cuadros [c0, c1). Con cerrar=true se cierra el hueco; si no, queda silencio.
  // Devuelve { est } o null (por ejemplo si no quedaria nada).
  function borrar(est, c0, c1, cerrar) {
    const n = est.mapa.length;
    c0 = limitar(Math.round(c0), 0, n);
    c1 = limitar(Math.round(c1), 0, n);
    if (c1 - c0 < 1) return null;
    if (cerrar) {
      const d = c1 - c0, N = n - d;
      if (N < 2) return null;
      const mapa = new Float64Array(N), semis = new Float64Array(N), form = new Float64Array(N);
      mapa.set(est.mapa.subarray(0, c0)); mapa.set(est.mapa.subarray(c1), c0);
      semis.set(est.semis.subarray(0, c0)); semis.set(est.semis.subarray(c1), c0);
      form.set(est.form.subarray(0, c0)); form.set(est.form.subarray(c1), c0);
      const lista = [];
      for (const c of est.cortes || []) {
        if (c <= c0) lista.push(c);
        else if (c >= c1) lista.push(c - d);
      }
      lista.push(c0);
      return { est: { mapa, semis, form, cortes: limpiarCortes(lista, N) } };
    }
    const e = copiar(est);
    for (let j = c0; j < c1; j++) { e.mapa[j] = SILENCIO; e.semis[j] = 0; e.form[j] = 1; }
    e.cortes = limpiarCortes(e.cortes.concat([c0, c1]), n);
    return { est: e };
  }

  // ---------- Tono ----------
  // F0 (Hz) del original en la posicion fraccionaria p (0 = sin voz). Igual criterio que el motor C++.
  function f0En(f0, p) {
    const N = f0.length;
    p = limitar(p, 0, N - 1);
    const i0 = Math.floor(p), i1 = Math.min(i0 + 1, N - 1), fr = p - i0;
    const a = f0[i0], b = f0[i1];
    if (a > 0 && b > 0) return Math.exp((1 - fr) * Math.log(a) + fr * Math.log(b));
    return fr < 0.5 ? a : b;
  }

  // Curva de tono actual (Hz por cuadro) con los cambios de semitonos aplicados.
  function curvaPitch(f0, est, conCambios) {
    const n = est.mapa.length, out = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (est.mapa[j] < 0) { out[j] = 0; continue; }
      const f = f0En(f0, est.mapa[j]);
      out[j] = f > 0 ? (conCambios === false ? f : f * Math.pow(2, est.semis[j] / 12)) : 0;
    }
    return out;
  }

  // Fija el tono de los cuadros [desde, hasta] a `hz` (solo donde hay voz).
  function fijarTono(est, f0, desde, hasta, hz) {
    const n = est.mapa.length;
    const j0 = limitar(Math.floor(desde), 0, n - 1);
    const j1 = limitar(Math.ceil(hasta), 0, n - 1);
    for (let j = j0; j <= j1; j++) {
      if (est.mapa[j] < 0) continue;
      const base = f0En(f0, est.mapa[j]);
      if (base > 0) est.semis[j] = 12 * Math.log2(hz / base);
    }
  }

  // Vuelve al tono original en los cuadros [a, b].
  function restablecerTono(est, a, b) {
    const n = est.mapa.length;
    for (let j = limitar(Math.floor(a), 0, n - 1); j <= limitar(Math.ceil(b), 0, n - 1); j++) est.semis[j] = 0;
  }

  // ---------- Afinar a la nota ----------
  function midiBase(f0, est) {
    const n = est.mapa.length, m = new Float64Array(n).fill(NaN);
    for (let j = 0; j < n; j++) {
      if (est.mapa[j] < 0) continue;
      const f = f0En(f0, est.mapa[j]);
      if (f > 0) m[j] = 69 + 12 * Math.log2(f / 440);
    }
    return m;
  }

  function medianaMovil(vals, w) {
    const L = vals.length, h = w >> 1, out = new Float64Array(L);
    for (let k = 0; k < L; k++) {
      const v = [];
      for (let q = Math.max(0, k - h); q <= Math.min(L - 1, k + h); q++) v.push(vals[q]);
      v.sort((a, b) => a - b);
      out[k] = v[v.length >> 1];
    }
    return out;
  }

  const medianaDe = (v) => { const t = Array.from(v).sort((a, b) => a - b); return t[t.length >> 1]; };

  // Ajustes de la deteccion de notas (en cuadros de 5 ms)
  const VENTANA_VIBRATO = 41;  // ~200 ms: cubre un ciclo de vibrato
  const UMBRAL_NOTA = 0.75;    // semitonos de diferencia para considerar otra nota
  const RACHA_NOTA = 8;        // durante cuantos cuadros seguidos (40 ms)
  const MINIMO_NOTA = 15;      // las notas mas cortas (75 ms) se unen a la vecina

  // Parte una secuencia de alturas (en semitonos) en notas. Una nota termina cuando la altura se
  // aleja de la mediana de la nota (mas de `umbral`) durante `racha` cuadros seguidos. Las notas
  // muy cortas (vibrato ancho, ruido) se unen a su vecina mas parecida.
  function segmentarRun(vals, umbral, racha, minimo) {
    const L = vals.length;
    const insertar = (arr, v) => {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
      arr.splice(lo, 0, v);
    };
    const inicios = [0];
    let ordenado = [], desv = 0;
    for (let k = 0; k < L; k++) {
      const v = vals[k];
      if (ordenado.length >= 6) {
        const med = ordenado[ordenado.length >> 1];
        desv = Math.abs(v - med) > umbral ? desv + 1 : 0;
        if (desv >= racha) {
          const kc = k - racha + 1;
          inicios.push(kc);
          ordenado = [];
          for (let q = kc; q <= k; q++) insertar(ordenado, vals[q]);
          desv = 0;
          continue;
        }
      }
      insertar(ordenado, v);
    }
    const rangos = inicios.map((s, i) => [s, i + 1 < inicios.length ? inicios[i + 1] - 1 : L - 1]);
    const med = (r) => medianaDe(vals.slice(r[0], r[1] + 1));
    while (rangos.length > 1) {
      const idx = rangos.findIndex((r) => r[1] - r[0] + 1 < minimo);
      if (idx < 0) break;
      let dest;
      if (idx === 0) dest = 1;
      else if (idx === rangos.length - 1) dest = idx - 1;
      else dest = Math.abs(med(rangos[idx - 1]) - med(rangos[idx])) <= Math.abs(med(rangos[idx + 1]) - med(rangos[idx])) ? idx - 1 : idx + 1;
      const a = Math.min(idx, dest), b = Math.max(idx, dest);
      rangos.splice(a, 2, [rangos[a][0], rangos[b][1]]);
    }
    return rangos;
  }

  // Detecta las notas cantadas entre los cuadros [a, b]: { j0, j1, med } con med en MIDI (fraccionario).
  function detectarNotas(f0, est, a, b) {
    const n = est.mapa.length;
    const j0 = limitar(Math.floor(a), 0, n - 1), j1 = limitar(Math.ceil(b), 0, n - 1);
    const midi = midiBase(f0, est), cortes = new Set(est.cortes || []);
    const notas = [];
    let j = j0;
    while (j <= j1) {
      if (isNaN(midi[j])) { j++; continue; }
      let r1 = j;
      while (r1 + 1 <= j1 && !isNaN(midi[r1 + 1]) && !cortes.has(r1 + 1)) r1++;
      // 1) quitar picos sueltos; 2) alisar con una mediana de ~200 ms, que borra el vibrato pero
      // conserva nitidos los saltos entre notas; 3) buscar los cambios de nota en esa curva.
      // El centro de cada nota se mide sobre la curva sin alisar (el vibrato es simetrico).
      const filt = medianaMovil(midi.subarray(j, r1 + 1), 5);
      const lisa = medianaMovil(filt, VENTANA_VIBRATO);
      for (const [ia, ib] of segmentarRun(lisa, UMBRAL_NOTA, RACHA_NOTA, MINIMO_NOTA)) {
        notas.push({ j0: j + ia, j1: j + ib, med: medianaDe(filt.subarray(ia, ib + 1)) });
      }
      j = r1 + 1;
    }
    return { notas, midi, cortes };
  }

  // Lleva cada nota cantada a su nota exacta.
  //   opt.retener : 0 = nota plana (sin vibrato ni deriva), 1 = solo corrige la desafinacion y
  //                 conserva el vibrato; valores intermedios conservan una parte
  //   opt.fuerza  : 0..1, cuanto se acerca a la nota exacta (1 = del todo)
  // Modifica est.semis en [a, b]. Devuelve { notas, cuadros }.
  function afinar(est, f0, a, b, opt) {
    opt = opt || {};
    const retener = limitar(opt.retener === undefined ? 0 : opt.retener, 0, 1);
    const fuerza = limitar(opt.fuerza === undefined ? 1 : opt.fuerza, 0, 1);
    const { notas, midi, cortes } = detectarNotas(f0, est, a, b);
    const n = est.mapa.length, fin = new Float64Array(n).fill(NaN);
    for (const nota of notas) {
      const objetivoCentro = Math.round(nota.med);
      for (let j = nota.j0; j <= nota.j1; j++) {
        if (isNaN(midi[j])) continue;
        const objetivo = objetivoCentro + retener * (midi[j] - nota.med);
        fin[j] = midi[j] + fuerza * (objetivo - midi[j]);
      }
    }
    // Pequena rampa (unos 20 ms) entre notas pegadas, para que el salto no suene a golpe
    for (let i = 0; i + 1 < notas.length; i++) {
      const A = notas[i], B = notas[i + 1];
      if (B.j0 !== A.j1 + 1 || cortes.has(B.j0)) continue;
      const p = A.j1 - 2, q = B.j0 + 2;
      if (p < A.j0 || q > B.j1 || isNaN(fin[p]) || isNaN(fin[q])) continue;
      for (let j = A.j1 - 1; j <= B.j0 + 1; j++) fin[j] = fin[p] + (fin[q] - fin[p]) * (j - p) / (q - p);
    }
    let cuadros = 0;
    for (let j = 0; j < n; j++) {
      if (isNaN(fin[j]) || isNaN(midi[j])) continue;
      est.semis[j] = fin[j] - midi[j];
      cuadros++;
    }
    return { notas: notas.length, cuadros };
  }

  // ---------- Notas ----------
  const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const hzAMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
  const midiAHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const nombreNota = (m) => NOMBRES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  const esTeclaNegra = (m) => [1, 3, 6, 8, 10].indexOf(((Math.round(m) % 12) + 12) % 12) >= 0;

  // ---------- Archivos ----------
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

  // Proyecto: el audio original (16 bits) + las ediciones. Al abrirlo se vuelve a analizar el
  // audio (con los mismos parametros da el mismo resultado) y se restauran las ediciones.
  // Formato: 'EVP1' + largo de cabecera (4 bytes) + cabecera JSON + audio int16 + mapa/semis/form float64.
  const relleno8 = (x) => (8 - (x % 8)) % 8;

  function guardarProyecto(p) {
    const n = p.est.mapa.length, nAudio = p.audio.length;
    const cab = new TextEncoder().encode(JSON.stringify({
      v: 1, fs: p.fs, fp: p.fp, f0min: p.f0min, f0max: p.f0max, harvest: !!p.harvest,
      cuadrosOrig: p.cuadrosOrig, nAudio, n, cortes: p.est.cortes || [],
    }));
    const off0 = 8 + cab.length + relleno8(8 + cab.length);
    const bytesAudio = nAudio * 2, offF = off0 + bytesAudio + relleno8(bytesAudio);
    const buf = new ArrayBuffer(offF + n * 8 * 3), u8 = new Uint8Array(buf);
    u8.set([0x45, 0x56, 0x50, 0x31]);
    new DataView(buf).setUint32(4, cab.length, true);
    u8.set(cab, 8);
    new Int16Array(buf, off0, nAudio).set(p.audio);
    new Float64Array(buf, offF, n).set(p.est.mapa);
    new Float64Array(buf, offF + n * 8, n).set(p.est.semis);
    new Float64Array(buf, offF + n * 16, n).set(p.est.form);
    return buf;
  }

  function leerProyecto(buf) {
    const malo = () => new Error('El archivo no es un proyecto valido');
    if (!buf || buf.byteLength < 12) throw malo();
    const u8 = new Uint8Array(buf);
    if (u8[0] !== 0x45 || u8[1] !== 0x56 || u8[2] !== 0x50 || u8[3] !== 0x31) throw malo();
    const hl = new DataView(buf).getUint32(4, true);
    if (8 + hl > buf.byteLength) throw malo();
    let cab;
    try { cab = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl))); } catch (e) { throw malo(); }
    if (!cab || cab.v !== 1 || !(cab.n > 1) || !(cab.nAudio > 0) || !(cab.fs > 0)) throw malo();
    const off0 = 8 + hl + relleno8(8 + hl);
    const bytesAudio = cab.nAudio * 2, offF = off0 + bytesAudio + relleno8(bytesAudio);
    if (offF + cab.n * 24 > buf.byteLength) throw malo();
    const f64 = (o) => new Float64Array(buf.slice(o, o + cab.n * 8));
    return {
      fs: cab.fs, fp: cab.fp, f0min: cab.f0min, f0max: cab.f0max, harvest: !!cab.harvest,
      cuadrosOrig: cab.cuadrosOrig,
      audio: new Int16Array(buf.slice(off0, off0 + bytesAudio)),
      est: { mapa: f64(offF), semis: f64(offF + cab.n * 8), form: f64(offF + cab.n * 16), cortes: cab.cortes || [] },
    };
  }

  const API = { SILENCIO, muestrear, estadoInicial, copiar, estirar, limites, segmentoEn, dividir, esSilencio,
                mover, borrar, f0En, curvaPitch, fijarTono, restablecerTono, detectarNotas, afinar,
                hzAMidi, midiAHz, nombreNota, esTeclaNegra, aWav, guardarProyecto, leerProyecto };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Editor = API;
})(typeof self !== 'undefined' ? self : this);
