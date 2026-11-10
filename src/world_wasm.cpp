// Capa fina sobre WORLD para usar desde JavaScript (WebAssembly) o desde C++ nativo.
//
// Flujo:
//   1) w_analizar(...)        -> analiza el audio una sola vez (F0, espectro, aperiodicidad)
//   2) w_mapa_estirar(...)    -> arma un "mapa de tiempo": para cada cuadro de salida, de que
//                                cuadro (fraccionario) del original sale
//   3) w_render(...)          -> sintetiza audio siguiendo el mapa, con cambio opcional de
//                                tono (semitonos) y de formantes (razon) por cuadro
//
// El mapa de tiempo es la pieza clave: estirar un tramo es solo recorrer los cuadros
// del tramo mas despacio. Mas adelante el mismo mecanismo sirve para mover y recortar notas.

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <vector>

#include "world/cheaptrick.h"
#include "world/d4c.h"
#include "world/dio.h"
#include "world/harvest.h"
#include "world/stonemask.h"
#include "world/synthesis.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define API extern "C"
#endif

namespace {

struct Estado {
  int fs = 0;
  double frame_period = 5.0;  // ms
  int frames = 0;
  int fft_size = 0;
  int bins = 0;
  std::vector<double> t, f0, sp, ap;  // sp y ap: frames * bins, contiguos
};

Estado E;

std::vector<double*> filas(std::vector<double>& v, int n, int bins) {
  std::vector<double*> r(n);
  for (int i = 0; i < n; ++i) r[i] = v.data() + (size_t)i * bins;
  return r;
}

}  // namespace

// Devuelve la cantidad de cuadros, o un numero negativo si algo falla.
API int w_analizar(const double* x, int n, int fs, double frame_period, double f0_min,
                   double f0_max, int usar_harvest) {
  if (!x || n <= 0 || fs <= 0 || frame_period <= 0) return -1;
  Estado nuevo;
  nuevo.fs = fs;
  nuevo.frame_period = frame_period;

  if (usar_harvest) {
    HarvestOption opt;
    InitializeHarvestOption(&opt);
    opt.f0_floor = f0_min;
    opt.f0_ceil = f0_max;
    opt.frame_period = frame_period;
    nuevo.frames = GetSamplesForHarvest(fs, n, frame_period);
    nuevo.t.assign(nuevo.frames, 0.0);
    nuevo.f0.assign(nuevo.frames, 0.0);
    Harvest(x, n, fs, &opt, nuevo.t.data(), nuevo.f0.data());
  } else {
    DioOption opt;
    InitializeDioOption(&opt);
    opt.f0_floor = f0_min;
    opt.f0_ceil = f0_max;
    opt.frame_period = frame_period;
    opt.speed = 2;
    nuevo.frames = GetSamplesForDIO(fs, n, frame_period);
    nuevo.t.assign(nuevo.frames, 0.0);
    std::vector<double> f0_crudo(nuevo.frames, 0.0);
    nuevo.f0.assign(nuevo.frames, 0.0);
    Dio(x, n, fs, &opt, nuevo.t.data(), f0_crudo.data());
    StoneMask(x, n, fs, nuevo.t.data(), f0_crudo.data(), nuevo.frames, nuevo.f0.data());
  }

  CheapTrickOption ct;
  InitializeCheapTrickOption(fs, &ct);
  ct.q1 = -0.15;
  ct.f0_floor = f0_min;
  ct.fft_size = GetFFTSizeForCheapTrick(fs, &ct);
  nuevo.fft_size = ct.fft_size;
  nuevo.bins = ct.fft_size / 2 + 1;

  nuevo.sp.assign((size_t)nuevo.frames * nuevo.bins, 0.0);
  nuevo.ap.assign((size_t)nuevo.frames * nuevo.bins, 0.0);
  auto sp_filas = filas(nuevo.sp, nuevo.frames, nuevo.bins);
  auto ap_filas = filas(nuevo.ap, nuevo.frames, nuevo.bins);

  CheapTrick(x, n, fs, nuevo.t.data(), nuevo.f0.data(), nuevo.frames, &ct, sp_filas.data());

  D4COption d4c;
  InitializeD4COption(&d4c);
  D4C(x, n, fs, nuevo.t.data(), nuevo.f0.data(), nuevo.frames, nuevo.fft_size, &d4c,
      ap_filas.data());

  E = std::move(nuevo);
  return E.frames;
}

API int w_cuadros() { return E.frames; }
API int w_bins() { return E.bins; }
API int w_fft_size() { return E.fft_size; }
API double w_frame_period() { return E.frame_period; }
API int w_fs() { return E.fs; }
// Curva de F0 original (frames valores; 0 = sin voz). JS puede leerla para dibujarla.
API const double* w_f0_ptr() { return E.f0.data(); }

// Mapa de tiempo para estirar un tramo.
//   ini_s, fin_s    : tramo en segundos
//   factor          : 2 = el tramo dura el doble
//   conservar_resto : 1 = mantiene lo de antes y despues, 0 = solo el tramo estirado
//   mapa            : buffer de salida (puede ser null para solo contar)
//   capacidad       : cuantos valores caben en mapa
// Devuelve la cantidad de cuadros de salida (si mapa != null y no cabe, devuelve -1).
API int w_mapa_estirar(double ini_s, double fin_s, double factor, int conservar_resto,
                       double* mapa, int capacidad) {
  if (E.frames <= 1 || factor <= 0) return -1;
  const double ultimo = E.frames - 1;
  double a = std::max(0.0, std::min(ultimo, ini_s * 1000.0 / E.frame_period));
  double b = std::max(a, std::min(ultimo, fin_s * 1000.0 / E.frame_period));
  const double largo_tramo = (b - a) * factor;

  double total;
  if (conservar_resto)
    total = a + largo_tramo + (ultimo - b) + 1.0;
  else
    total = largo_tramo + 1.0;
  int out = std::max(2, (int)std::floor(total));
  if (!mapa) return out;
  if (out > capacidad) return -1;

  for (int j = 0; j < out; ++j) {
    double src;
    if (conservar_resto) {
      if (j < a)
        src = j;
      else if (j < a + largo_tramo)
        src = a + (j - a) / factor;
      else
        src = b + (j - a - largo_tramo);
    } else {
      src = a + j / factor;
    }
    mapa[j] = std::max(0.0, std::min(ultimo, src));
  }
  return out;
}

// Largo (en muestras) del audio que genera w_render para out_cuadros cuadros.
API int w_largo_salida(int out_cuadros) {
  return (int)((out_cuadros - 1) * E.frame_period / 1000.0 * E.fs) + 1;
}

// Sintetiza siguiendo el mapa.
//   mapa      : out_cuadros posiciones fraccionarias (en cuadros del original)
//   semitonos : null o out_cuadros valores (cambio de tono por cuadro)
//   formante  : null o out_cuadros razones (1 = sin cambio, >1 = formantes mas agudos)
//   y         : salida, y_length = w_largo_salida(out_cuadros)
// Devuelve 0 si salio bien.
API int w_render(const double* mapa, int out_cuadros, const double* semitonos,
                 const double* formante, double* y, int y_length) {
  if (E.frames <= 0 || !mapa || !y || out_cuadros < 2) return -1;
  if (y_length != w_largo_salida(out_cuadros)) return -2;
  const int bins = E.bins;
  const int N = E.frames;

  std::vector<double> f0(out_cuadros, 0.0);
  std::vector<double> sp((size_t)out_cuadros * bins), ap((size_t)out_cuadros * bins);
  std::vector<double> tmp(bins);

  for (int j = 0; j < out_cuadros; ++j) {
    double p = std::max(0.0, std::min((double)(N - 1), mapa[j]));
    int i0 = (int)std::floor(p);
    int i1 = std::min(i0 + 1, N - 1);
    double fr = p - i0;

    // F0: en escala logaritmica si los dos cuadros tienen voz; si no, el mas cercano
    double a = E.f0[i0], b = E.f0[i1];
    double f;
    if (a > 0 && b > 0)
      f = std::exp((1 - fr) * std::log(a) + fr * std::log(b));
    else
      f = (fr < 0.5) ? a : b;
    if (semitonos && f > 0) f *= std::pow(2.0, semitonos[j] / 12.0);
    f0[j] = f;

    const double* s0 = &E.sp[(size_t)i0 * bins];
    const double* s1 = &E.sp[(size_t)i1 * bins];
    const double* p0 = &E.ap[(size_t)i0 * bins];
    const double* p1 = &E.ap[(size_t)i1 * bins];
    double* so = &sp[(size_t)j * bins];
    double* po = &ap[(size_t)j * bins];

    for (int k = 0; k < bins; ++k) {
      double v0 = std::max(s0[k], 1e-16), v1 = std::max(s1[k], 1e-16);
      tmp[k] = (fr == 0.0) ? v0 : std::exp((1 - fr) * std::log(v0) + fr * std::log(v1));
      double q = (1 - fr) * p0[k] + fr * p1[k];
      po[k] = std::max(1e-12, std::min(1.0 - 1e-12, q));
    }

    double r = formante ? formante[j] : 1.0;
    if (r > 0 && std::fabs(r - 1.0) > 1e-6) {
      for (int k = 0; k < bins; ++k) {
        double pos = k / r;
        if (pos >= bins - 1) {
          so[k] = tmp[bins - 1];
        } else {
          int m = (int)pos;
          double g = pos - m;
          so[k] = (1 - g) * tmp[m] + g * tmp[m + 1];
        }
      }
    } else {
      for (int k = 0; k < bins; ++k) so[k] = tmp[k];
    }
  }

  auto sp_filas = filas(sp, out_cuadros, bins);
  auto ap_filas = filas(ap, out_cuadros, bins);
  Synthesis(f0.data(), out_cuadros, sp_filas.data(), ap_filas.data(), E.fft_size,
            E.frame_period, E.fs, y_length, y);
  return 0;
}

API void w_liberar() { E = Estado(); }
