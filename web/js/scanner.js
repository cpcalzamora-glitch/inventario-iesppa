// Lectura de códigos con la cámara trasera (Code 128 y QR) usando html5-qrcode (web/vendor).
// Del QR se toma el texto antes del primer '|'.

export function limpiarCodigo(texto) {
  return String(texto || '').split('|')[0].trim().replace(/[^0-9A-Za-z\-]/g, '').toUpperCase();
}

export class Escaner {
  constructor(elementId, alLeer) {
    this.elementId = elementId;
    this.alLeer = alLeer;
    this.qr = null;
    this.ocupado = false;
    this.ultimo = { codigo: '', t: 0 };
  }

  async iniciar() {
    const F = window.Html5QrcodeSupportedFormats;
    this.qr = new window.Html5Qrcode(this.elementId, {
      formatsToSupport: [F.CODE_128, F.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });
    await this.qr.start(
      { facingMode: 'environment' },
      {
        fps: 15,
        qrbox: (w, hgt) => ({ width: Math.floor(w * 0.9), height: Math.max(120, Math.floor(hgt * 0.35)) }),
        disableFlip: true
      },
      (texto) => this.leido(texto),
      () => {}
    );
    try { // enfoque continuo y linterna si el equipo lo permite
      await this.qr.applyVideoConstraints({ focusMode: 'continuous', advanced: [{ focusMode: 'continuous' }] });
    } catch (e) { /* no soportado */ }
  }

  leido(texto) {
    if (this.ocupado) return;
    const codigo = limpiarCodigo(texto);
    if (!codigo) return;
    const ahora = Date.now();
    if (codigo === this.ultimo.codigo && ahora - this.ultimo.t < 2500) return; // misma etiqueta aún frente a la cámara
    this.ultimo = { codigo, t: ahora };
    this.ocupado = true;
    Promise.resolve(this.alLeer(codigo)).finally(() => {
      this.ultimo.t = Date.now();
      this.ocupado = false;
    });
  }

  async linterna(encender) {
    try { await this.qr.applyVideoConstraints({ advanced: [{ torch: !!encender }] }); return true; } catch (e) { return false; }
  }

  async detener() {
    if (!this.qr) return;
    try { if (this.qr.isScanning) await this.qr.stop(); this.qr.clear(); } catch (e) { /* ya detenido */ }
    this.qr = null;
  }
}
