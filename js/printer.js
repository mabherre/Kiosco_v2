/**
 * PRINTER.JS - Impresión por Bluetooth (Web Bluetooth API) a impresoras
 * térmicas genéricas ESC/POS de 58mm.
 *
 * Sólo funciona en Chrome para Android (no en iOS/Safari).
 * El usuario debe emparejar/conectar la impresora la primera vez con el
 * botón "🖨️ Impresora"; el navegador recuerda el permiso para las próximas.
 */

var Impresora = (function () {

  // UUIDs típicos usados por la mayoría de las mini impresoras térmicas
  // Bluetooth genéricas (clones "Goojprt/Zjiang" y similares).
  var SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
  var CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

  var dispositivo = null;
  var characteristic = null;
  var callbackCambioEstado = null;

  function soportado() {
    return !!navigator.bluetooth;
  }

  function conectar() {
    if (!soportado()) {
      return Promise.reject(new Error('Este navegador no soporta Bluetooth. Usá Chrome en Android.'));
    }
    // Importante: sólo se puede llamar a requestDevice() UNA vez por click
    // (necesita "gesto de usuario" activo). Se usa acceptAllDevices para que
    // aparezcan todas las impresoras cercanas, aunque no anuncien el UUID
    // exacto que esperamos.
    return navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    })
      .then(function (device) {
        dispositivo = device;
        // Si la impresora se apaga o se aleja durante el día, avisamos para
        // que el indicador de "no conectada" se actualice solo.
        device.addEventListener('gattserverdisconnected', function () {
          characteristic = null;
          if (callbackCambioEstado) callbackCambioEstado();
        });
        return device.gatt.connect();
      })
      .then(function (server) {
        return server.getPrimaryService(SERVICE_UUID);
      })
      .then(function (service) {
        return service.getCharacteristic(CHARACTERISTIC_UUID);
      })
      .then(function (char) {
        characteristic = char;
        if (callbackCambioEstado) callbackCambioEstado();
        return true;
      });
  }

  function estaConectada() {
    return !!(characteristic && dispositivo && dispositivo.gatt.connected);
  }

  // Permite que app.js se entere apenas cambia el estado de conexión
  // (conectada o desconectada), para actualizar el indicador visual.
  function alCambiarEstado(cb) {
    callbackCambioEstado = cb;
  }

  // --- Construcción de comandos ESC/POS ---
  var ESC = 0x1B, GS = 0x1D;

  function normalizarTexto(texto) {
    // Muchas impresoras baratas no soportan bien UTF-8/acentos: quitamos tildes/ñ.
    return String(texto)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ñ/gi, 'n');
  }

  function textoABytes(texto) {
    var normal = normalizarTexto(texto) + '\n';
    var bytes = [];
    for (var i = 0; i < normal.length; i++) bytes.push(normal.charCodeAt(i) & 0xFF);
    return bytes;
  }

  function construirTicket(venta) {
    var bytes = [];
    function push() { for (var i = 0; i < arguments.length; i++) bytes.push(arguments[i]); }
    function linea(texto) { bytes = bytes.concat(textoABytes(texto)); }
    function centrar(on) { push(ESC, 0x61, on ? 1 : 0); }
    function negrita(on) { push(ESC, 0x45, on ? 1 : 0); }

    push(ESC, 0x40); // inicializar

    centrar(true);
    negrita(true);
    linea(CONFIG.NOMBRE_KIOSCO || 'Kiosco');
    negrita(false);
    linea(new Date(venta.fecha || Date.now()).toLocaleString());
    linea('Vendedor: ' + venta.usuario);
    linea('--------------------------------');
    centrar(false);

    venta.items.forEach(function (it) {
      linea(it.cantidad + ' x ' + it.productoNombre);
      var precioTxt = CONFIG.MONEDA + it.subtotal.toFixed(2);
      var espacios = Math.max(1, 32 - precioTxt.length);
      linea(' '.repeat(espacios) + precioTxt);
    });

    linea('--------------------------------');
    negrita(true);
    linea('TOTAL: ' + CONFIG.MONEDA + venta.total.toFixed(2));
    negrita(false);
    linea('');
    centrar(true);
    linea('Gracias por su compra!');
    linea('');
    linea('');
    linea('');

    return new Uint8Array(bytes);
  }

  function enviarEnPartes(bytes) {
    var CHUNK = 20; // tamaño seguro de escritura BLE sin negociar MTU
    var i = 0;
    function siguiente() {
      if (i >= bytes.length) return Promise.resolve();
      var parte = bytes.slice(i, i + CHUNK);
      i += CHUNK;
      return characteristic.writeValue(parte)
        .then(function () { return new Promise(function (r) { setTimeout(r, 20); }); })
        .then(siguiente);
    }
    return siguiente();
  }

  function imprimirVenta(venta) {
    if (!estaConectada()) {
      return Promise.reject(new Error('La impresora no está conectada.'));
    }
    var bytes = construirTicket(venta);
    return enviarEnPartes(bytes);
  }

  /**
   * ---- Alternativa para impresoras que NO son BLE genéricas ----
   * Muchas mini impresoras térmicas baratas (como las que usan la app
   * "Fun Print") sólo se pueden manejar desde su propia app, con un
   * protocolo Bluetooth propietario que Web Bluetooth no puede usar.
   *
   * Para esos casos, generamos el comprobante como una imagen y usamos el
   * botón "Compartir" de Android para mandarla directo a esa app (Fun
   * Print, o la que corresponda), donde se termina de imprimir con un
   * toque más. Sigue siendo 100% gratuito.
   */
  function construirLineasTicket(venta) {
    var lineas = [];
    lineas.push({ texto: CONFIG.NOMBRE_KIOSCO || 'Kiosco', negrita: true, align: 'center' });
    lineas.push({ texto: new Date(venta.fecha || Date.now()).toLocaleString(), align: 'center' });
    lineas.push({ texto: 'Vendedor: ' + venta.usuario, align: 'left' });
    lineas.push({ texto: '--------------------------------', align: 'left' });
    venta.items.forEach(function (it) {
      lineas.push({ texto: it.cantidad + ' x ' + it.productoNombre, align: 'left' });
      lineas.push({ texto: CONFIG.MONEDA + it.subtotal.toFixed(2), align: 'right' });
    });
    lineas.push({ texto: '--------------------------------', align: 'left' });
    lineas.push({ texto: 'TOTAL: ' + CONFIG.MONEDA + venta.total.toFixed(2), negrita: true, align: 'left' });
    lineas.push({ texto: '', align: 'left' });
    lineas.push({ texto: 'Gracias por su compra!', align: 'center' });
    return lineas;
  }

  function generarImagenTicket(venta) {
    return new Promise(function (resolve) {
      var ancho = 384; // ancho típico de impresión para papel de 58mm
      var alturaLinea = 30;
      var margen = 14;
      var lineas = construirLineasTicket(venta);
      var canvas = document.createElement('canvas');
      canvas.width = ancho;
      canvas.height = margen * 2 + lineas.length * alturaLinea;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'top';

      var y = margen;
      lineas.forEach(function (l) {
        ctx.font = (l.negrita ? 'bold ' : '') + '22px monospace';
        var anchoTexto = ctx.measureText(l.texto).width;
        var x = margen;
        if (l.align === 'center') x = (canvas.width - anchoTexto) / 2;
        else if (l.align === 'right') x = canvas.width - margen - anchoTexto;
        ctx.fillText(l.texto, x, y);
        y += alturaLinea;
      });

      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
    });
  }

  function puedeCompartirImagenes() {
    return !!(navigator.share && navigator.canShare);
  }

  function compartirTicket(venta) {
    return generarImagenTicket(venta).then(function (blob) {
      var archivo = new File([blob], 'comprobante.png', { type: 'image/png' });

      if (puedeCompartirImagenes() && navigator.canShare({ files: [archivo] })) {
        return navigator.share({
          files: [archivo],
          title: 'Comprobante de venta'
        });
      }

      // Si el navegador no soporta compartir archivos, se descarga la
      // imagen para poder abrirla e imprimirla manualmente desde la app
      // de la impresora.
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'comprobante.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return Promise.resolve();
    });
  }

  return {
    soportado: soportado,
    conectar: conectar,
    estaConectada: estaConectada,
    alCambiarEstado: alCambiarEstado,
    imprimirVenta: imprimirVenta,
    puedeCompartirImagenes: puedeCompartirImagenes,
    compartirTicket: compartirTicket
  };
})();
