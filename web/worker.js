// Worker: corre WORLD (WebAssembly) fuera del hilo de la pantalla para que no se congele.
importScripts('world.js');

let M = null;
const listo = createWorld().then((m) => { M = m; });

function aWasm(arr) {
  const p = M._malloc(arr.length * 8);
  M.HEAPF64.set(arr, p / 8);  // se lee HEAPF64 despues de malloc: la memoria puede haber crecido
  return p;
}
function deWasm(p, n) {
  return new Float64Array(M.HEAPF64.buffer.slice(p, p + n * 8));
}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    await listo;
    if (d.cmd === 'analizar') {
      const px = aWasm(d.x);
      const N = M._w_analizar(px, d.x.length, d.fs, d.fp, d.f0min, d.f0max, d.harvest ? 1 : 0);
      M._free(px);
      if (N < 0) throw new Error('el analisis fallo (codigo ' + N + ')');
      const f0 = deWasm(M._w_f0_ptr(), N);
      self.postMessage({ id: d.id, cuadros: N, f0: f0 }, [f0.buffer]);
    } else if (d.cmd === 'render') {
      const out = d.mapa.length;
      const L = M._w_largo_salida(out);
      const pm = aWasm(d.mapa), ps = aWasm(d.semis), pf = aWasm(d.form);
      const py = M._malloc(L * 8);
      const r = M._w_render(pm, out, ps, pf, py, L);
      const y64 = r === 0 ? deWasm(py, L) : null;
      M._free(pm); M._free(ps); M._free(pf); M._free(py);
      if (r !== 0) throw new Error('la sintesis fallo (codigo ' + r + ')');
      const y = new Float32Array(L);
      for (let i = 0; i < L; i++) y[i] = y64[i];
      self.postMessage({ id: d.id, y: y }, [y.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: d.id, error: String(err && err.message ? err.message : err) });
  }
};
