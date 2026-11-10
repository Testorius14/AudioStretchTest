// Prueba nativa (sin navegador) de la capa world_wasm.cpp con una voz sintetica.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

extern "C" {
int w_analizar(const double*, int, int, double, double, double, int);
int w_cuadros();
double w_frame_period();
const double* w_f0_ptr();
int w_mapa_estirar(double, double, double, int, double*, int);
int w_largo_salida(int);
int w_render(const double*, int, const double*, const double*, double*, int);
}

static int fallos = 0;
#define CHECK(cond, ...)                \
  do {                                  \
    if (cond) {                         \
      printf("  OK    ");               \
    } else {                            \
      printf("  FALLO ");               \
      ++fallos;                         \
    }                                   \
    printf(__VA_ARGS__);                \
    printf("\n");                       \
  } while (0)

static std::vector<double> voz(int fs, double seg, double f0) {
  int n = (int)(fs * seg);
  std::vector<double> x(n);
  double fase = 0;
  for (int i = 0; i < n; ++i) {
    double t = (double)i / fs;
    double f = f0 + 3.0 * std::sin(2 * M_PI * 5.0 * t);  // vibrato suave
    fase += 2 * M_PI * f / fs;
    double s = 0;
    for (int h = 1; h <= 20 && h * f < fs / 2 - 500; ++h) s += std::sin(h * fase) / h;
    x[i] = 0.3 * s;
  }
  return x;
}

static double mediana_f0(double desde_s, double hasta_s) {
  int N = w_cuadros();
  double fp = w_frame_period();
  const double* f0 = w_f0_ptr();
  std::vector<double> v;
  for (int i = 0; i < N; ++i) {
    double t = i * fp / 1000.0;
    if (t >= desde_s && t <= hasta_s && f0[i] > 0) v.push_back(f0[i]);
  }
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  return v[v.size() / 2];
}

static bool finito(const std::vector<double>& y, double* pico, double* rms) {
  double s = 0, p = 0;
  for (double v : y) {
    if (!std::isfinite(v)) return false;
    p = std::max(p, std::fabs(v));
    s += v * v;
  }
  *pico = p;
  *rms = std::sqrt(s / y.size());
  return true;
}

int main() {
  const int fs = 22050;
  auto x = voz(fs, 3.0, 150.0);
  double pico, rms_in;
  finito(x, &pico, &rms_in);

  printf("Analisis (DIO)\n");
  int N = w_analizar(x.data(), (int)x.size(), fs, 5.0, 71.0, 800.0, 0);
  CHECK(N > 500, "cuadros = %d", N);
  double f0_orig = mediana_f0(0.2, 2.8);
  CHECK(std::fabs(f0_orig - 150) < 5, "F0 original ~150 Hz (medido %.1f)", f0_orig);

  printf("Estirar 1.0-2.0 s por 3, conservando el resto\n");
  double ini = 1.0, fin = 2.0, factor = 3.0;
  int out = w_mapa_estirar(ini, fin, factor, 1, nullptr, 0);
  std::vector<double> mapa(out);
  int out2 = w_mapa_estirar(ini, fin, factor, 1, mapa.data(), out);
  CHECK(out2 == out, "mapa = %d cuadros", out);
  bool monotono = true;
  for (int j = 1; j < out; ++j) monotono &= (mapa[j] >= mapa[j - 1]);
  CHECK(monotono, "mapa creciente");
  CHECK(std::fabs(mapa[out - 1] - (N - 1)) < 1.0, "el mapa termina en el ultimo cuadro (%.1f de %d)",
        mapa[out - 1], N - 1);
  int L = w_largo_salida(out);
  std::vector<double> y(L, 0.0);
  int r = w_render(mapa.data(), out, nullptr, nullptr, y.data(), L);
  double pico_y, rms_y;
  CHECK(r == 0, "render devolvio %d", r);
  CHECK(finito(y, &pico_y, &rms_y), "sin NaN ni infinitos");
  CHECK(std::fabs(L / (double)fs - 5.0) < 0.05, "duracion %.2f s (esperado ~5.0)", L / (double)fs);
  CHECK(pico_y < 2.0 && rms_y > 0.3 * rms_in && rms_y < 3.0 * rms_in,
        "nivel razonable (rms %.3f vs %.3f original, pico %.2f)", rms_y, rms_in, pico_y);

  // Re-analizar la salida: el tono del tramo estirado debe seguir en ~150 Hz
  w_analizar(y.data(), L, fs, 5.0, 71.0, 800.0, 0);
  double f0_estirado = mediana_f0(1.3, 3.7);
  CHECK(std::fabs(f0_estirado - 150) < 6, "tono del tramo estirado ~150 Hz (medido %.1f)", f0_estirado);
  double f0_antes = mediana_f0(0.2, 0.9);
  CHECK(std::fabs(f0_antes - 150) < 6, "tono antes del tramo ~150 Hz (medido %.1f)", f0_antes);

  printf("Solo el tramo (descartar el resto)\n");
  w_analizar(x.data(), (int)x.size(), fs, 5.0, 71.0, 800.0, 0);
  int o3 = w_mapa_estirar(ini, fin, factor, 0, nullptr, 0);
  std::vector<double> m3(o3);
  w_mapa_estirar(ini, fin, factor, 0, m3.data(), o3);
  int L3 = w_largo_salida(o3);
  std::vector<double> y3(L3, 0.0);
  r = w_render(m3.data(), o3, nullptr, nullptr, y3.data(), L3);
  CHECK(r == 0 && finito(y3, &pico_y, &rms_y), "render ok");
  CHECK(std::fabs(L3 / (double)fs - 3.0) < 0.05, "duracion %.2f s (esperado ~3.0)", L3 / (double)fs);

  printf("Cambio de tono +12 semitonos y formantes x1.2\n");
  std::vector<double> st(out, 12.0), fo(out, 1.2);
  w_analizar(x.data(), (int)x.size(), fs, 5.0, 71.0, 800.0, 0);
  std::vector<double> y4(L, 0.0);
  r = w_render(mapa.data(), out, st.data(), fo.data(), y4.data(), L);
  CHECK(r == 0 && finito(y4, &pico_y, &rms_y), "render ok");
  w_analizar(y4.data(), L, fs, 5.0, 71.0, 1200.0, 0);
  double f0_sube = mediana_f0(0.2, 0.9);
  CHECK(std::fabs(f0_sube - 300) < 12, "tono subido ~300 Hz (medido %.1f)", f0_sube);

  printf("Con Harvest\n");
  N = w_analizar(x.data(), (int)x.size(), fs, 5.0, 71.0, 800.0, 1);
  CHECK(N > 500, "cuadros = %d", N);
  CHECK(std::fabs(mediana_f0(0.2, 2.8) - 150) < 5, "F0 ~150 Hz (medido %.1f)", mediana_f0(0.2, 2.8));

  printf(fallos ? "\n%d FALLOS\n" : "\nTodo bien\n", fallos);
  return fallos ? 1 : 0;
}
