// Motor FALSO con la misma interfaz que world.js (WebAssembly), solo para probar la pagina
// sin compilar. No es WORLD: genera un tono de seno que sigue el mapa de tiempo.
function createWorld() {
  const heap = new Float64Array(1 << 22);  // 32 MB de "memoria"
  let brk = 8;
  const M = { HEAPF64: heap };
  let N = 0, fs = 0, fp = 5, f0 = null;

  M._malloc = (bytes) => {
    const p = brk;
    brk += Math.ceil(bytes / 8) * 8;
    if (brk / 8 > heap.length) throw new Error('mock sin memoria');
    return p;
  };
  M._free = () => {};
  M._w_analizar = (px, n, fs_, fp_, f0min, f0max, harvest) => {
    fs = fs_; fp = fp_;
    N = Math.floor(n / (fs * fp / 1000)) + 1;
    f0 = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const t = i * fp / 1000;
      // dos frases con un vibrato de +-3 Hz alrededor de 158 Hz (que esta ~27 cents sobre D#3)
      f0[i] = (t > 1.4 && t < 1.6) ? 0 : 158 + 3 * Math.sin(2 * Math.PI * 5.5 * t);
    }
    brk = 8;  // el mock reinicia su "memoria" en cada analisis
    return N;
  };
  M._w_f0_ptr = () => { const p = M._malloc(N * 8); heap.set(f0, p / 8); return p; };
  M._w_largo_salida = (out) => Math.floor((out - 1) * fp / 1000 * fs) + 1;
  M._w_render = (pm, out, ps, pf, py, L) => {
    if (L !== M._w_largo_salida(out)) return -2;
    let fase = 0;
    for (let i = 0; i < L; i++) {
      const j = Math.min(out - 1, Math.floor(i / (fs * fp / 1000)));
      if (heap[pm / 8 + j] < 0) { heap[py / 8 + i] = 0; continue; }  // silencio
      const src = Math.min(N - 1, Math.max(0, Math.round(heap[pm / 8 + j])));
      const f = f0[src] * Math.pow(2, (ps ? heap[ps / 8 + j] : 0) / 12);
      fase += 2 * Math.PI * f / fs;
      heap[py / 8 + i] = f > 0 ? 0.5 * Math.sin(fase) : 0;
    }
    return 0;
  };
  return Promise.resolve(M);
}
