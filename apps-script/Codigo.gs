/**
 * BACKEND - App de Ventas Kiosco
 * ---------------------------------
 * Este script va PEGADO en el editor de Apps Script (script.google.com)
 * de una Hoja de Cálculo de Google (Google Sheets), como script "vinculado" (contenedor).
 * Ver README.md para el paso a paso de instalación y despliegue.
 *
 * Crea automáticamente (si no existen) 3 pestañas en la hoja:
 *  - Productos      : ID | Nombre | Precio | FotoURL | Activo
 *  - Ventas         : ID | Fecha | Usuario | Total | Tipo_venta
 *  - DetalleVentas  : ID | VentaID | ProductoID | Cantidad | PrecioUnitario
 *
 * Además usa una pestaña "Alumno" (creada a mano) con columnas Curso,
 * Nombre, Apellido Paterno y Apellido Materno: el Vendedor entra eligiendo
 * su curso y su nombre, y confirma con su Apellido Materno a modo de
 * contraseña individual (no hay clave compartida de Vendedor).
 *
 * Los ID de las tres hojas son números enteros correlativos (no UUID):
 * cada uno sigue desde el máximo que ya exista en su hoja.
 *
 * Expone un Web App (doGet / doPost) que el frontend consume por fetch().
 */

var CARPETA_FOTOS = 'FotosKiosco';

// Este valor tiene que ser IDÉNTICO al de js/config.js (TOKEN_APP y
// CLAVE_ADMIN). Si lo cambiás acá, cambialo también allá.
var TOKEN_APP = 'kioscoAppSecreto2026';
var CLAVE_ADMIN = 'kiosco2026';

// Acciones que sólo puede hacer un Administrador (requieren CLAVE_ADMIN).
var ACCIONES_SOLO_ADMIN = ['agregarProducto', 'actualizarProducto', 'eliminarProducto', 'recaudacionPorVendedorYDia'];
// Acciones que sólo puede hacer un Vendedor. En vez de una clave
// compartida, cada pedido tiene que traer data.alumno = {fila, apellidoMaterno}
// y se valida contra la hoja Alumno (ver validarAlumno_).
var ACCIONES_SOLO_VENDEDOR = ['registrarVenta', 'buscarTransferencias', 'obtenerTransferenciasSinUsar', 'auditoriaDelDia', 'ventasDelDia'];

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

    // Filtro 3: las acciones de vendedor necesitan un alumno válido (curso +
    // nombre + apellido materno correcto), no una clave compartida.
    if (ACCIONES_SOLO_VENDEDOR.indexOf(accion) !== -1) {
      var validacionAlumno = validarAlumno_(data.alumno || {});
      if (!validacionAlumno.autorizado) {
        return respond({ ok: false, error: validacionAlumno.error || 'No autorizado como vendedor.' });
      }
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
      case 'auditoriaDelDia':
        resultado = auditoriaDelDia(data);
        break;
      case 'ventasDelDia':
        resultado = ventasDelDia();
        break;
      case 'obtenerAlumnos':
        resultado = obtenerAlumnos();
        break;
      case 'iniciarSesionAlumno':
        resultado = validarAlumno_(data.alumno || {});
        break;
      case 'recaudacionPorVendedorYDia':
        resultado = recaudacionPorVendedorYDia();
        break;
      default:
        return respond({ ok: false, error: 'Acción POST no reconocida: ' + accion });
    }
    // Algunas acciones (como iniciarSesionAlumno) devuelven autorizado:false
    // en vez de tirar una excepción; se traduce a un error prolijo en vez de
    // envolverlo como si hubiera sido exitoso.
    if (resultado && resultado.autorizado === false) {
      return respond({ ok: false, error: resultado.error || 'No autorizado.' });
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
  return getSheet_('Ventas', ['ID', 'Fecha', 'Usuario', 'Total', 'Tipo_venta']);
}
function getDetalleSheet_() {
  // El nombre del producto y el subtotal no se guardan: se pueden obtener
  // buscando el ProductoID en la hoja Productos y multiplicando
  // Cantidad x PrecioUnitario.
  return getSheet_('DetalleVentas', ['ID', 'VentaID', 'ProductoID', 'Cantidad', 'PrecioUnitario']);
}
function getAlumnoSheet_() {
  // Esta pestaña ya la crea y completa la persona a cargo del kiosco (curso,
  // nombre, apellido paterno y apellido materno de cada alumno). Si por
  // algún motivo no existe todavía, se crea vacía con estos encabezados.
  return getSheet_('Alumno', ['Curso', 'Nombre', 'Apellido Paterno', 'Apellido Materno']);
}

// Da el próximo ID entero correlativo de una hoja, mirando el máximo que
// ya existe en su primera columna (evita choques si se editaron IDs a mano).
function siguienteId_(sheet) {
  var filasDeDatos = sheet.getLastRow() - 1;
  if (filasDeDatos < 1) return 1; // hoja vacía (sólo encabezado): empieza en 1
  var valores = sheet.getRange(2, 1, filasDeDatos, 1).getValues();
  var maximo = 0;
  valores.forEach(function (fila) {
    var n = Number(fila[0]);
    if (!isNaN(n) && n > maximo) maximo = n;
  });
  return maximo + 1;
}

// Devuelve el índice (1-based) de una columna buscando su nombre en la
// fila de encabezados. Así, si alguien reordena o agrega columnas a mano
// en la hoja (como Tipo_venta), el código igual escribe en el lugar
// correcto en vez de asumir una posición fija.
function indiceColumna_(sheet, nombreEncabezado) {
  var encabezados = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < encabezados.length; i++) {
    if (String(encabezados[i]).trim().toLowerCase() === nombreEncabezado.trim().toLowerCase()) {
      return i + 1;
    }
  }
  return -1;
}

// Igual que indiceColumna_, pero probando varios nombres posibles para el
// mismo encabezado (por ejemplo, "Apellido Materno" o "Segundo Apellido").
// Devuelve el índice del primero que encuentre.
function indiceColumnaVarios_(sheet, nombresPosibles) {
  for (var i = 0; i < nombresPosibles.length; i++) {
    var idx = indiceColumna_(sheet, nombresPosibles[i]);
    if (idx > 0) return idx;
  }
  return -1;
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
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getProductosSheet_();
    var id = siguienteId_(sheet);
    var fotoUrl = '';
    if (data.fotoBase64) {
      fotoUrl = guardarImagenEnDrive_(data.fotoBase64, 'producto_' + id);
    }
    sheet.appendRow([id, data.nombre, Number(data.precio) || 0, fotoUrl, true]);
    return { id: id, fotoUrl: fotoUrl };
  } finally {
    lock.releaseLock();
  }
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
  // Si dos ventas llegan casi al mismo tiempo (dos vendedores, o una venta
  // que se sincroniza justo cuando se está guardando otra), sin este
  // bloqueo ambas podrían leer el mismo "último ID" antes de que la
  // primera termine de escribir, y quedar con el mismo número. El
  // bloqueo obliga a que se procesen de a una por vez.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ventasSheet = getVentasSheet_();
    var detalleSheet = getDetalleSheet_();
    var ventaId = siguienteId_(ventasSheet);
    var fecha = new Date();
    var tipoVenta = (data.tipoVenta === 'transferencia') ? 'transferencia' : 'efectivo';

    // Se arma la fila según los encabezados reales de la hoja (por si el
    // orden de columnas cambió a mano, como al agregar Tipo_venta).
    var numColsVentas = ventasSheet.getLastColumn();
    var filaVenta = new Array(numColsVentas).fill('');
    var idxId = indiceColumna_(ventasSheet, 'ID');
    var idxFecha = indiceColumna_(ventasSheet, 'Fecha');
    var idxUsuario = indiceColumna_(ventasSheet, 'Usuario');
    var idxTotal = indiceColumna_(ventasSheet, 'Total');
    var idxTipoVenta = indiceColumna_(ventasSheet, 'Tipo_venta');
    if (idxId > 0) filaVenta[idxId - 1] = ventaId;
    if (idxFecha > 0) filaVenta[idxFecha - 1] = fecha;
    if (idxUsuario > 0) filaVenta[idxUsuario - 1] = data.usuario || '';
    if (idxTotal > 0) filaVenta[idxTotal - 1] = Number(data.total) || 0;
    if (idxTipoVenta > 0) filaVenta[idxTipoVenta - 1] = tipoVenta;
    ventasSheet.appendRow(filaVenta);

    // Se escriben todas las filas del detalle en una sola llamada (en vez de
    // una llamada por producto) para que registrar la venta sea más rápido.
    var items = data.items || [];
    if (items.length > 0) {
      var siguienteIdDetalle = siguienteId_(detalleSheet);
      var filas = items.map(function (it, i) {
        return [
          siguienteIdDetalle + i,
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
  } finally {
    lock.releaseLock();
  }
}

// Auditoría del día: totales en efectivo/transferencia y detalle por
// producto, sólo de las ventas hechas por el vendedor indicado, sólo del
// día de hoy.
function auditoriaDelDia(data) {
  var usuario = String(data.usuario || '');
  var ventasSheet = getVentasSheet_();
  var detalleSheet = getDetalleSheet_();

  var idxId = indiceColumna_(ventasSheet, 'ID');
  var idxFecha = indiceColumna_(ventasSheet, 'Fecha');
  var idxUsuario = indiceColumna_(ventasSheet, 'Usuario');
  var idxTotal = indiceColumna_(ventasSheet, 'Total');
  var idxTipoVenta = indiceColumna_(ventasSheet, 'Tipo_venta');

  var hoy = new Date();

  var valoresVentas = ventasSheet.getDataRange().getValues();
  var idsVentasDeHoy = {};
  var totalEfectivo = 0;
  var totalTransferencia = 0;

  for (var i = 1; i < valoresVentas.length; i++) {
    var fila = valoresVentas[i];
    var fechaFila = idxFecha > 0 ? fila[idxFecha - 1] : null;
    var usuarioFila = idxUsuario > 0 ? String(fila[idxUsuario - 1] || '') : '';
    if (!(fechaFila instanceof Date) || !esMismoDia_(fechaFila, hoy)) continue;
    if (usuarioFila !== usuario) continue;

    var total = idxTotal > 0 ? (Number(fila[idxTotal - 1]) || 0) : 0;
    var tipo = idxTipoVenta > 0 ? String(fila[idxTipoVenta - 1] || '').toLowerCase() : 'efectivo';
    if (tipo === 'transferencia') totalTransferencia += total;
    else totalEfectivo += total;

    var idVenta = idxId > 0 ? String(fila[idxId - 1]) : '';
    if (idVenta) idsVentasDeHoy[idVenta] = true;
  }

  // Detalle por producto, sólo de esas ventas.
  var valoresDetalle = detalleSheet.getDataRange().getValues();
  var cantidadPorProducto = {}; // { productoId: cantidad }
  for (var j = 1; j < valoresDetalle.length; j++) {
    var filaDetalle = valoresDetalle[j];
    var ventaIdDetalle = String(filaDetalle[1]);
    if (!idsVentasDeHoy[ventaIdDetalle]) continue;
    var productoId = String(filaDetalle[2]);
    var cantidad = Number(filaDetalle[3]) || 0;
    cantidadPorProducto[productoId] = (cantidadPorProducto[productoId] || 0) + cantidad;
  }

  // Traducir ProductoID a nombre.
  var productosSheet = getProductosSheet_();
  var valoresProductos = productosSheet.getDataRange().getValues();
  var nombrePorId = {};
  for (var k = 1; k < valoresProductos.length; k++) {
    nombrePorId[String(valoresProductos[k][0])] = valoresProductos[k][1];
  }

  var detalleProductos = Object.keys(cantidadPorProducto).map(function (id) {
    return {
      productoId: id,
      nombre: nombrePorId[id] || ('Producto ' + id),
      cantidad: cantidadPorProducto[id]
    };
  }).sort(function (a, b) { return b.cantidad - a.cantidad; });

  return {
    totalEfectivo: totalEfectivo,
    totalTransferencia: totalTransferencia,
    productos: detalleProductos
  };
}

// Todas las ventas del día en curso (de cualquier vendedor), con su detalle
// de productos, ordenadas de la más reciente a la más antigua.
function ventasDelDia() {
  var ventasSheet = getVentasSheet_();
  var detalleSheet = getDetalleSheet_();
  var productosSheet = getProductosSheet_();

  var idxId = indiceColumna_(ventasSheet, 'ID');
  var idxFecha = indiceColumna_(ventasSheet, 'Fecha');
  var idxUsuario = indiceColumna_(ventasSheet, 'Usuario');
  var idxTotal = indiceColumna_(ventasSheet, 'Total');
  var idxTipoVenta = indiceColumna_(ventasSheet, 'Tipo_venta');

  var hoy = new Date();

  // Nombre de cada producto, para mostrarlo en el detalle sin guardarlo
  // duplicado en DetalleVentas.
  var nombrePorId = {};
  var valoresProductos = productosSheet.getDataRange().getValues();
  for (var k = 1; k < valoresProductos.length; k++) {
    nombrePorId[String(valoresProductos[k][0])] = valoresProductos[k][1];
  }

  // Se agrupa el detalle por VentaID una sola vez, en vez de recorrer toda
  // la hoja DetalleVentas por cada venta del día.
  var detallePorVenta = {};
  var valoresDetalle = detalleSheet.getDataRange().getValues();
  for (var j = 1; j < valoresDetalle.length; j++) {
    var filaDetalle = valoresDetalle[j];
    var ventaIdDetalle = String(filaDetalle[1]);
    var productoId = String(filaDetalle[2]);
    var cantidad = Number(filaDetalle[3]) || 0;
    var precioUnitario = Number(filaDetalle[4]) || 0;
    if (!detallePorVenta[ventaIdDetalle]) detallePorVenta[ventaIdDetalle] = [];
    detallePorVenta[ventaIdDetalle].push({
      nombre: nombrePorId[productoId] || ('Producto ' + productoId),
      cantidad: cantidad,
      precioUnitario: precioUnitario,
      subtotal: cantidad * precioUnitario
    });
  }

  var ventas = [];
  var valoresVentas = ventasSheet.getDataRange().getValues();
  for (var i = 1; i < valoresVentas.length; i++) {
    var fila = valoresVentas[i];
    var fechaFila = idxFecha > 0 ? fila[idxFecha - 1] : null;
    if (!(fechaFila instanceof Date) || !esMismoDia_(fechaFila, hoy)) continue;

    var idVenta = idxId > 0 ? String(fila[idxId - 1]) : '';
    ventas.push({
      ventaId: idVenta,
      fecha: fechaFila.toISOString(),
      usuario: idxUsuario > 0 ? String(fila[idxUsuario - 1] || '') : '',
      total: idxTotal > 0 ? (Number(fila[idxTotal - 1]) || 0) : 0,
      tipoVenta: idxTipoVenta > 0 ? String(fila[idxTipoVenta - 1] || 'efectivo').toLowerCase() : 'efectivo',
      productos: detallePorVenta[idVenta] || []
    });
  }

  // Más reciente primero. El ID es correlativo según el orden en que se
  // registraron las ventas, así que ordenar por ID (número) alcanza.
  ventas.sort(function (a, b) { return Number(b.ventaId) - Number(a.ventaId); });

  return { ventas: ventas };
}

function esMismoDia_(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

// Recaudación total por vendedor y por día, separando efectivo de
// transferencia. Incluye todo el historial de la hoja Ventas (no sólo el
// día de hoy). Sólo Administrador.
function recaudacionPorVendedorYDia() {
  var ventasSheet = getVentasSheet_();
  var idxFecha = indiceColumna_(ventasSheet, 'Fecha');
  var idxUsuario = indiceColumna_(ventasSheet, 'Usuario');
  var idxTotal = indiceColumna_(ventasSheet, 'Total');
  var idxTipoVenta = indiceColumna_(ventasSheet, 'Tipo_venta');

  var zonaHoraria = Session.getScriptTimeZone();
  var valores = ventasSheet.getDataRange().getValues();
  var grupos = {}; // clave: "AAAA-MM-DD|usuario"

  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    var fechaFila = idxFecha > 0 ? fila[idxFecha - 1] : null;
    if (!(fechaFila instanceof Date)) continue;

    var usuario = idxUsuario > 0 ? String(fila[idxUsuario - 1] || '(sin nombre)') : '(sin nombre)';
    var total = idxTotal > 0 ? (Number(fila[idxTotal - 1]) || 0) : 0;
    var tipo = idxTipoVenta > 0 ? String(fila[idxTipoVenta - 1] || '').toLowerCase() : 'efectivo';
    var fechaSolo = Utilities.formatDate(fechaFila, zonaHoraria, 'yyyy-MM-dd');
    var clave = fechaSolo + '|' + usuario;

    if (!grupos[clave]) {
      grupos[clave] = { fecha: fechaSolo, usuario: usuario, efectivo: 0, transferencia: 0, total: 0 };
    }
    if (tipo === 'transferencia') grupos[clave].transferencia += total;
    else grupos[clave].efectivo += total;
    grupos[clave].total += total;
  }

  var lista = Object.keys(grupos).map(function (clave) { return grupos[clave]; });
  // Más reciente primero; a igualdad de fecha, orden alfabético por vendedor.
  lista.sort(function (a, b) {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return a.usuario.localeCompare(b.usuario);
  });

  return { recaudacion: lista };
}

/* ---------------- Alumnos (login de Vendedor) ---------------- */

// Valida un alumno contra la hoja Alumno: la "contraseña" es su Apellido
// Materno. No hay clave compartida de Vendedor; cada pedido de una acción
// de vendedor trae {fila, apellidoMaterno} y se revalida acá mismo.
function validarAlumno_(alumno) {
  var sheet = getAlumnoSheet_();
  var fila = Number(alumno && alumno.fila);
  if (!fila || fila < 2 || fila > sheet.getLastRow()) {
    return { autorizado: false, error: 'Seleccioná tu curso y tu nombre de la lista.' };
  }

  var idxCurso = indiceColumnaVarios_(sheet, ['Curso']);
  var idxNombre = indiceColumnaVarios_(sheet, ['Nombre', 'Nombres']);
  var idxApPaterno = indiceColumnaVarios_(sheet, ['Apellido Paterno', 'ApellidoPaterno', 'Primer Apellido']);
  var idxApMaterno = indiceColumnaVarios_(sheet, ['Apellido Materno', 'ApellidoMaterno', 'Segundo Apellido', 'SegundoApellido']);

  var filaValores = sheet.getRange(fila, 1, 1, sheet.getLastColumn()).getValues()[0];
  var nombre = idxNombre > 0 ? String(filaValores[idxNombre - 1] || '').trim() : '';
  if (!nombre) {
    return { autorizado: false, error: 'Alumno no encontrado.' };
  }

  var apellidoMaternoReal = idxApMaterno > 0 ? String(filaValores[idxApMaterno - 1] || '').trim() : '';
  var ingresado = normalizarTexto_(alumno.apellidoMaterno);
  if (!apellidoMaternoReal || !ingresado || ingresado !== normalizarTexto_(apellidoMaternoReal)) {
    return { autorizado: false, error: 'El apellido materno no coincide.' };
  }

  var apellidoPaterno = idxApPaterno > 0 ? String(filaValores[idxApPaterno - 1] || '').trim() : '';
  var curso = idxCurso > 0 ? String(filaValores[idxCurso - 1] || '').trim() : '';
  var usuario = (nombre + ' ' + apellidoPaterno + (curso ? ' (' + curso + ')' : '')).trim();

  return { autorizado: true, usuario: usuario, curso: curso };
}

// Lista de alumnos para poblar los selectores de curso y nombre en el
// login. A propósito NO incluye el Apellido Materno (la "contraseña"), para
// no exponerlo antes de que el alumno se identifique.
function obtenerAlumnos() {
  var sheet = getAlumnoSheet_();
  var idxCurso = indiceColumnaVarios_(sheet, ['Curso']);
  var idxNombre = indiceColumnaVarios_(sheet, ['Nombre', 'Nombres']);
  var idxApPaterno = indiceColumnaVarios_(sheet, ['Apellido Paterno', 'ApellidoPaterno', 'Primer Apellido']);

  var valores = sheet.getDataRange().getValues();
  var alumnos = [];
  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    var nombre = idxNombre > 0 ? String(fila[idxNombre - 1] || '').trim() : '';
    if (!nombre) continue; // fila vacía
    alumnos.push({
      fila: i + 1,
      curso: idxCurso > 0 ? String(fila[idxCurso - 1] || '').trim() : '',
      nombre: nombre,
      apellidoPaterno: idxApPaterno > 0 ? String(fila[idxApPaterno - 1] || '').trim() : ''
    });
  }
  return { alumnos: alumnos };
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
