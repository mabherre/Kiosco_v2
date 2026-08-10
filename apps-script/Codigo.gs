/**
 * BACKEND - App de Ventas Kiosco
 * ---------------------------------
 * Este script va PEGADO en el editor de Apps Script (script.google.com)
 * de una Hoja de Cálculo de Google (Google Sheets), como script "vinculado" (contenedor).
 * Ver README.md para el paso a paso de instalación y despliegue.
 *
 * Crea automáticamente (si no existen) 3 pestañas en la hoja:
 *  - Productos      : ID | Nombre | Precio | FotoURL | Activo
 *  - Ventas         : ID | Fecha | Usuario | Total
 *  - DetalleVentas  : ID | VentaID | ProductoID | ProductoNombre | Cantidad | PrecioUnitario | Subtotal
 *
 * Expone un Web App (doGet / doPost) que el frontend consume por fetch().
 */

var CARPETA_FOTOS = 'FotosKiosco';

// Estos dos valores tienen que ser IDÉNTICOS a los de js/config.js
// (TOKEN_APP y CLAVE_ADMIN). Si los cambiás acá, cambialos también allá.
var TOKEN_APP = 'kioscoAppSecreto2026';
var CLAVE_ADMIN = 'kiosco2026';
var CLAVE_VENDEDOR = 'ventas2026';

// Acciones que sólo puede hacer un Administrador (requieren CLAVE_ADMIN).
var ACCIONES_SOLO_ADMIN = ['agregarProducto', 'actualizarProducto', 'eliminarProducto'];
// Acciones que sólo puede hacer un Vendedor (requieren CLAVE_VENDEDOR).
var ACCIONES_SOLO_VENDEDOR = ['registrarVenta', 'buscarTransferencias', 'obtenerTransferenciasSinUsar'];

// Hoja externa donde se registran las transferencias recibidas (abonos de
// clientes). No es la misma hoja que la del kiosco: se abre por ID.
var ID_HOJA_TRANSFERENCIAS = '1jEK_0p0WOxA36t7-iOtwZXEdcT8-Xmpl_bzh5_r7nt8';
var PESTANA_TRANSFERENCIAS = 'registro';
// Columnas (1-based) de esa hoja, en este orden:
// Fecha | Documento | Movimiento | RUN | Nombre completo | Abono | Estado | Fila origen | Estado Pago
var COL_TRANSF_FECHA = 1;
var COL_TRANSF_RUN = 4;
var COL_TRANSF_NOMBRE = 5;
var COL_TRANSF_ABONO = 6;
var COL_TRANSF_ESTADO_PAGO = 9;

function doGet(e) {
  try {
    var accion = e.parameter.accion || e.parameter.action;
    if (accion === 'getProductos' || accion === 'getProducts') {
      return respond({ ok: true, productos: getProductos() });
    }
    if (accion === 'ping') {
      return respond({ ok: true, mensaje: 'Backend Kiosco activo' });
    }
    return respond({ ok: false, error: 'Acción GET no soportada: ' + accion });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var accion = data.accion || data.action;
    var resultado;

    // Filtro 1: todas las peticiones tienen que traer el token de la app.
    // Esto no reemplaza una autenticación real (el token vive en un archivo
    // público del sitio), pero frena a quien golpee esta URL sin pasar por
    // la app.
    if (data.tokenApp !== TOKEN_APP) {
      return respond({ ok: false, error: 'No autorizado.' });
    }

    // Filtro 2: las acciones de administrador además necesitan la clave.
    if (ACCIONES_SOLO_ADMIN.indexOf(accion) !== -1 && data.claveAdmin !== CLAVE_ADMIN) {
      return respond({ ok: false, error: 'Clave de administrador incorrecta.' });
    }

    // Filtro 3: las acciones de vendedor además necesitan su clave.
    if (ACCIONES_SOLO_VENDEDOR.indexOf(accion) !== -1 && data.claveVendedor !== CLAVE_VENDEDOR) {
      return respond({ ok: false, error: 'Clave de vendedor incorrecta.' });
    }

    switch (accion) {
      case 'getProductos':
        resultado = { productos: getProductos() };
        break;
      case 'agregarProducto':
        resultado = agregarProducto(data);
        break;
      case 'actualizarProducto':
        resultado = actualizarProducto(data);
        break;
      case 'eliminarProducto':
        resultado = eliminarProducto(data);
        break;
      case 'registrarVenta':
        resultado = registrarVenta(data);
        break;
      case 'buscarTransferencias':
        resultado = buscarTransferencias(data);
        break;
      case 'obtenerTransferenciasSinUsar':
        resultado = obtenerTransferenciasSinUsar();
        break;
      case 'resumenTransferencias':
        resultado = resumenTransferencias();
        break;
      default:
        return respond({ ok: false, error: 'Acción POST no reconocida: ' + accion });
    }
    return respond(Object.assign({ ok: true }, resultado));
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- Hojas ---------------- */

function getSheet_(nombre, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getProductosSheet_() {
  return getSheet_('Productos', ['ID', 'Nombre', 'Precio', 'FotoURL', 'Activo']);
}
function getVentasSheet_() {
  return getSheet_('Ventas', ['ID', 'Fecha', 'Usuario', 'Total']);
}
function getDetalleSheet_() {
  // El nombre del producto y el subtotal no se guardan: se pueden obtener
  // buscando el ProductoID en la hoja Productos y multiplicando
  // Cantidad x PrecioUnitario.
  return getSheet_('DetalleVentas', ['ID', 'VentaID', 'ProductoID', 'Cantidad', 'PrecioUnitario']);
}

/* ---------------- Productos ---------------- */

function getProductos() {
  var sheet = getProductosSheet_();
  var values = sheet.getDataRange().getValues();
  var productos = [];
  for (var i = 1; i < values.length; i++) {
    var fila = values[i];
    var activo = fila[4];
    if (activo === false || activo === 'FALSE' || activo === 'NO') continue;
    productos.push({
      id: String(fila[0]),
      nombre: fila[1],
      precio: Number(fila[2]) || 0,
      fotoUrl: fila[3] || ''
    });
  }
  return productos;
}

function agregarProducto(data) {
  var sheet = getProductosSheet_();
  var id = Utilities.getUuid();
  var fotoUrl = '';
  if (data.fotoBase64) {
    fotoUrl = guardarImagenEnDrive_(data.fotoBase64, 'producto_' + id);
  }
  sheet.appendRow([id, data.nombre, Number(data.precio) || 0, fotoUrl, true]);
  return { id: id, fotoUrl: fotoUrl };
}

function actualizarProducto(data) {
  var sheet = getProductosSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) {
      var fila = i + 1;
      if (data.nombre !== undefined) sheet.getRange(fila, 2).setValue(data.nombre);
      if (data.precio !== undefined) sheet.getRange(fila, 3).setValue(Number(data.precio) || 0);
      if (data.fotoBase64) {
        var fotoUrl = guardarImagenEnDrive_(data.fotoBase64, 'producto_' + data.id);
        sheet.getRange(fila, 4).setValue(fotoUrl);
      }
      return { actualizado: true };
    }
  }
  return { actualizado: false, error: 'Producto no encontrado' };
}

function eliminarProducto(data) {
  var sheet = getProductosSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) {
      sheet.getRange(i + 1, 5).setValue(false); // baja lógica, conserva historial de ventas
      return { eliminado: true };
    }
  }
  return { eliminado: false, error: 'Producto no encontrado' };
}

function guardarImagenEnDrive_(base64Data, nombreArchivo) {
  var match = base64Data.match(/^data:(.*);base64,(.*)$/);
  if (!match) return '';
  var contentType = match[1];
  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, contentType, nombreArchivo);
  var folder = getOrCreateFolder_(CARPETA_FOTOS);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // El formato "uc?export=view" de Drive falla seguido al incrustarlo como <img>.
  // El endpoint "thumbnail" es más confiable para mostrar la foto directo en la app.
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
}

function getOrCreateFolder_(nombre) {
  var folders = DriveApp.getFoldersByName(nombre);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(nombre);
}

/* ---------------- Ventas ---------------- */

function registrarVenta(data) {
  var ventasSheet = getVentasSheet_();
  var detalleSheet = getDetalleSheet_();
  var ventaId = Utilities.getUuid();
  var fecha = new Date();

  ventasSheet.appendRow([ventaId, fecha, data.usuario || '', Number(data.total) || 0]);

  // Se escriben todas las filas del detalle en una sola llamada (en vez de
  // una llamada por producto) para que registrar la venta sea más rápido.
  var items = data.items || [];
  if (items.length > 0) {
    var filas = items.map(function (it) {
      return [
        Utilities.getUuid(),
        ventaId,
        it.productoId,
        Number(it.cantidad) || 0,
        Number(it.precioUnitario) || 0
      ];
    });
    var filaInicial = detalleSheet.getLastRow() + 1;
    detalleSheet.getRange(filaInicial, 1, filas.length, filas[0].length).setValues(filas);
  }

  // Si la venta se hizo a partir de una transferencia seleccionada, se marca
  // esa fila como usada en la hoja de transferencias.
  var transferenciaYaEstabaUsada = false;
  if (data.transferenciaFila) {
    var resultadoMarca = marcarTransferenciaUsada({ fila: data.transferenciaFila });
    transferenciaYaEstabaUsada = !!resultadoMarca.yaEstabaUsada;
  }

  return {
    ventaId: ventaId,
    fecha: fecha.toISOString(),
    transferenciaYaEstabaUsada: transferenciaYaEstabaUsada
  };
}

/* ---------------- Transferencias ---------------- */

function getHojaTransferencias_() {
  return SpreadsheetApp.openById(ID_HOJA_TRANSFERENCIAS).getSheetByName(PESTANA_TRANSFERENCIAS);
}

function normalizarTexto_(s) {
  return String(s || '').toLowerCase().replace(/[.\-\s]/g, '');
}

// Busca por RUN o nombre completo, sólo entre las filas cuya columna
// "Estado Pago" está vacía (todavía no usadas).
function buscarTransferencias(data) {
  var termino = normalizarTexto_(data.texto);
  if (!termino) return { transferencias: [] };

  var sheet = getHojaTransferencias_();
  var values = sheet.getDataRange().getValues();
  var resultados = [];

  for (var i = 1; i < values.length; i++) {
    var fila = values[i];
    var estadoPago = fila[COL_TRANSF_ESTADO_PAGO - 1];
    if (estadoPago) continue; // ya usada

    var run = String(fila[COL_TRANSF_RUN - 1] || '');
    var nombre = String(fila[COL_TRANSF_NOMBRE - 1] || '');

    if (normalizarTexto_(run).indexOf(termino) !== -1 || normalizarTexto_(nombre).indexOf(termino) !== -1) {
      var fechaCelda = fila[COL_TRANSF_FECHA - 1];
      resultados.push({
        fila: i + 1, // número real de la fila en la hoja, para poder marcarla luego
        fecha: (fechaCelda instanceof Date) ? fechaCelda.toISOString() : String(fechaCelda || ''),
        run: run,
        nombreCompleto: nombre,
        abono: Number(fila[COL_TRANSF_ABONO - 1]) || 0
      });
    }
  }

  return { transferencias: resultados };
}

function marcarTransferenciaUsada(data) {
  var fila = Number(data.fila);
  if (!fila || fila < 2) return { error: 'Fila inválida' };
  var sheet = getHojaTransferencias_();
  var celda = sheet.getRange(fila, COL_TRANSF_ESTADO_PAGO);
  // Si ya tenía algo escrito, es que otra venta (por ejemplo, sincronizada
  // después de haberse hecho sin conexión) ya la había usado antes.
  var yaEstabaUsada = !!celda.getValue();
  celda.setValue('Usado');
  return { actualizado: true, yaEstabaUsada: yaEstabaUsada };
}

// Lista completa de transferencias sin usar (para que la app guarde una
// copia local y pueda buscar sin conexión).
function obtenerTransferenciasSinUsar() {
  var sheet = getHojaTransferencias_();
  var values = sheet.getDataRange().getValues();
  var resultados = [];

  for (var i = 1; i < values.length; i++) {
    var fila = values[i];
    var estadoPago = fila[COL_TRANSF_ESTADO_PAGO - 1];
    if (estadoPago) continue;

    var fechaCelda = fila[COL_TRANSF_FECHA - 1];
    resultados.push({
      fila: i + 1,
      fecha: (fechaCelda instanceof Date) ? fechaCelda.toISOString() : String(fechaCelda || ''),
      run: String(fila[COL_TRANSF_RUN - 1] || ''),
      nombreCompleto: String(fila[COL_TRANSF_NOMBRE - 1] || ''),
      abono: Number(fila[COL_TRANSF_ABONO - 1]) || 0
    });
  }

  return { transferencias: resultados };
}

// Cantidad y monto total de transferencias todavía sin usar.
function resumenTransferencias() {
  var sheet = getHojaTransferencias_();
  var values = sheet.getDataRange().getValues();
  var cantidad = 0;
  var montoTotal = 0;

  for (var i = 1; i < values.length; i++) {
    var estadoPago = values[i][COL_TRANSF_ESTADO_PAGO - 1];
    if (!estadoPago) {
      cantidad++;
      montoTotal += Number(values[i][COL_TRANSF_ABONO - 1]) || 0;
    }
  }

  return { cantidad: cantidad, montoTotal: montoTotal };
}
