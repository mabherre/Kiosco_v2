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
var ACCIONES_SOLO_VENDEDOR = ['registrarVenta', 'buscarTransferencias', 'obtenerTransferenciasSinUsar', 'auditoriaDelDia', 'ventasDelDia', 'proximoNumeroBoleta'];

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
    if (accion === 'diagnosticoAlumnos') {
      return respond({ ok: true, diagnostico: diagnosticoAlumnos_() });
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
        resultado = ventasDelDia(data);
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
      case 'proximoNumeroBoleta':
        resultado = proximoNumeroBoletaSugerido(data);
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
  // nombre, apellido paterno y apellido materno de cada alumno). Se acepta
  // tanto "Alumno" como "Alumnos" (singular o plural, sin importar
  // mayúsculas) para no depender de un nombre exacto de pestaña: si se
  // buscara solo "Alumno" y la pestaña real se llamara "Alumnos", el
  // sistema no la encontraría y crearía otra vacía por separado.
  //
  // Si hay más de una pestaña candidata (por ejemplo, quedó una vacía de
  // antes y otra con los datos reales), se usa la que tiene más filas: es
  // la que realmente tiene contenido cargado.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var nombresValidos = ['alumno', 'alumnos'];
  var hojas = ss.getSheets();
  var candidatas = [];
  for (var i = 0; i < hojas.length; i++) {
    if (nombresValidos.indexOf(hojas[i].getName().trim().toLowerCase()) !== -1) {
      candidatas.push(hojas[i]);
    }
  }
  if (candidatas.length > 0) {
    candidatas.sort(function (a, b) { return b.getLastRow() - a.getLastRow(); });
    return candidatas[0];
  }
  // No existe ninguna: se crea vacía para completarla a mano.
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
function indiceColumna_(sheet, nombreEncabezado, filaEncabezado) {
  filaEncabezado = filaEncabezado || 1;
  var encabezados = sheet.getRange(filaEncabezado, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < encabezados.length; i++) {
    if (String(encabezados[i]).trim().toLowerCase() === nombreEncabezado.trim().toLowerCase()) {
      return i + 1;
    }
  }
  return -1;
}

// Si la hoja no tiene una columna con ese nombre, la agrega al final (sin
// tocar las columnas existentes). Se usa para que la columna "IDCliente" se
// cree sola la primera vez, sin que el administrador tenga que agregarla a
// mano en la hoja de cálculo.
function agregarColumnaSiFalta_(sheet, nombreEncabezado) {
  var idx = indiceColumna_(sheet, nombreEncabezado);
  if (idx > 0) return idx;
  var nuevaCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, nuevaCol).setValue(nombreEncabezado);
  return nuevaCol;
}

// Busca, dentro de la columna IDCliente de la hoja Ventas, una fila que ya
// tenga ese identificador (para no registrar dos veces la misma venta si el
// celular la reintenta, por ejemplo porque la respuesta del servidor se
// perdió por corte de señal la primera vez). Devuelve {ventaId, fecha} o
// null si no la encuentra.
function buscarVentaPorIdCliente_(sheet, idxIdCliente, idxNumeroBoleta, idCliente) {
  var filasDeDatos = sheet.getLastRow() - 1;
  if (filasDeDatos < 1) return null;

  // Primero se lee sólo la columna IDCliente (una lectura liviana) para ver
  // si esa venta ya existe. Sólo si la encuentra, se leen los demás datos de
  // esa fila puntual.
  var columnaIdCliente = sheet.getRange(2, idxIdCliente, filasDeDatos, 1).getValues();
  for (var i = 0; i < columnaIdCliente.length; i++) {
    var valorCelda = String(columnaIdCliente[i][0] || '');
    if (valorCelda && valorCelda === String(idCliente)) {
      var filaReal = i + 2;
      var idxId = indiceColumna_(sheet, 'ID');
      var idxFecha = indiceColumna_(sheet, 'Fecha');
      var valoresId = idxId > 0 ? sheet.getRange(filaReal, idxId).getValue() : '';
      var valoresFecha = idxFecha > 0 ? sheet.getRange(filaReal, idxFecha).getValue() : null;
      var valoresBoleta = idxNumeroBoleta > 0 ? sheet.getRange(filaReal, idxNumeroBoleta).getValue() : '';
      return {
        ventaId: valoresId,
        fecha: (valoresFecha instanceof Date) ? valoresFecha.toISOString() : new Date().toISOString(),
        numeroBoleta: valoresBoleta
      };
    }
  }
  return null;
}

// Próximo número de boleta para ESE vendedor en el día de hoy (arranca en 1
// cada día, como un talonario físico). Cuenta cuántas ventas de ese vendedor
// ya hay hoy y usa el máximo + 1 (en vez de sólo contar filas), para que
// autocorrija si alguna vez se borra o edita una fila a mano.
function boletaSiguienteDelDia_(sheet, idxFecha, idxUsuario, idxNumeroBoleta, usuario, hoy) {
  var filasDeDatos = sheet.getLastRow() - 1;
  if (filasDeDatos < 1) return 1;

  var valores = sheet.getRange(2, 1, filasDeDatos, sheet.getLastColumn()).getValues();
  var maximo = 0;
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    var fechaFila = idxFecha > 0 ? fila[idxFecha - 1] : null;
    if (!(fechaFila instanceof Date) || !esMismoDia_(fechaFila, hoy)) continue;
    var usuarioFila = idxUsuario > 0 ? String(fila[idxUsuario - 1] || '') : '';
    if (usuarioFila !== usuario) continue;
    var n = idxNumeroBoleta > 0 ? Number(fila[idxNumeroBoleta - 1]) : 0;
    if (!isNaN(n) && n > maximo) maximo = n;
  }
  return maximo + 1;
}

// Sólo lectura: dice cuál sería el próximo N° de boleta de ESE vendedor hoy,
// sin registrar nada. La app la usa al iniciar sesión (si hay señal en ese
// momento) para "poner al día" su contador local, y así poder seguir
// numerando boletas de forma provisoria si más tarde se queda sin conexión.
function proximoNumeroBoletaSugerido(data) {
  var usuario = String(data.usuario || '');
  var ventasSheet = getVentasSheet_();
  var idxFecha = indiceColumna_(ventasSheet, 'Fecha');
  var idxUsuario = indiceColumna_(ventasSheet, 'Usuario');
  var idxNumeroBoleta = indiceColumna_(ventasSheet, 'N° Boleta');
  if (idxNumeroBoleta < 1) return { numeroBoleta: 1 };
  return { numeroBoleta: boletaSiguienteDelDia_(ventasSheet, idxFecha, idxUsuario, idxNumeroBoleta, usuario, new Date()) };
}

// Igual que indiceColumna_, pero probando varios nombres posibles para el
// mismo encabezado (por ejemplo, "Apellido Materno" o "Segundo Apellido").
// Devuelve el índice del primero que encuentre.
function indiceColumnaVarios_(sheet, nombresPosibles, filaEncabezado) {
  for (var i = 0; i < nombresPosibles.length; i++) {
    var idx = indiceColumna_(sheet, nombresPosibles[i], filaEncabezado);
    if (idx > 0) return idx;
  }
  return -1;
}

// Lee la fila de encabezados UNA sola vez (una sola llamada a la hoja) para
// poder buscar varias columnas sin repetir la lectura. Cada llamada a
// getRange()/getValues() es una ida y vuelta a Google Sheets, y sumadas
// hacían más lenta cada acción (por ejemplo, registrar una venta hacía 5
// lecturas de encabezado seguidas). Se usa junto con indiceEnLista_.
function leerEncabezados_(sheet, filaEncabezado) {
  filaEncabezado = filaEncabezado || 1;
  var valores = sheet.getRange(filaEncabezado, 1, 1, sheet.getLastColumn()).getValues()[0];
  return valores.map(function (v) { return String(v || '').trim().toLowerCase(); });
}

// Busca el índice (1-based) de alguno de los nombres posibles dentro de un
// arreglo de encabezados ya leído (sin volver a llamar a la hoja).
function indiceEnLista_(encabezadosNormalizados, nombresPosibles) {
  for (var i = 0; i < nombresPosibles.length; i++) {
    var buscado = nombresPosibles[i].trim().toLowerCase();
    var idx = encabezadosNormalizados.indexOf(buscado);
    if (idx !== -1) return idx + 1;
  }
  return -1;
}

// Igual que encontrarFilaEncabezados_() + leerEncabezados_() juntas, pero
// leyendo la hoja una sola vez (en vez de una lectura para ubicar la fila de
// encabezados y otra para traer su contenido). Devuelve { fila, encabezados }.
function datosEncabezado_(sheet, nombresEsperados) {
  var maxFilas = Math.min(5, sheet.getLastRow());
  if (maxFilas < 1) return { fila: 1, encabezados: [] };

  var bloque = sheet.getRange(1, 1, maxFilas, sheet.getLastColumn()).getValues();
  var normalizado = bloque.map(function (fila) {
    return fila.map(function (v) { return String(v || '').trim().toLowerCase(); });
  });
  var nombresNormalizados = nombresEsperados.map(function (n) { return n.toLowerCase(); });

  for (var i = 0; i < normalizado.length; i++) {
    for (var j = 0; j < nombresNormalizados.length; j++) {
      if (normalizado[i].indexOf(nombresNormalizados[j]) !== -1) {
        return { fila: i + 1, encabezados: normalizado[i] };
      }
    }
  }
  return { fila: 1, encabezados: normalizado[0] || [] };
}

// Busca en cuál de las primeras filas de la hoja están realmente los
// encabezados (por si hay un título arriba, como "Lista de Alumnos 2026").
// Revisa las primeras 5 filas y se queda con la primera que contenga
// alguno de los nombres esperados. Si no encuentra ninguna, asume que es
// la fila 1 (comportamiento de antes).
function encontrarFilaEncabezados_(sheet, nombresEsperados) {
  var maxFilas = Math.min(5, sheet.getLastRow());
  if (maxFilas < 1) return 1;
  // Una sola lectura de las primeras filas (en vez de una lectura por fila).
  var bloque = sheet.getRange(1, 1, maxFilas, sheet.getLastColumn()).getValues();
  var nombresNormalizados = nombresEsperados.map(function (n) { return n.toLowerCase(); });
  for (var fila = 0; fila < bloque.length; fila++) {
    var textos = bloque[fila].map(function (v) { return String(v || '').trim().toLowerCase(); });
    for (var j = 0; j < nombresNormalizados.length; j++) {
      if (textos.indexOf(nombresNormalizados[j]) !== -1) {
        return fila + 1;
      }
    }
  }
  return 1;
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
  // bloqueo obliga a que se procesen de a una por vez. De paso, esto
  // también hace que el número de boleta por vendedor (más abajo) sea
  // seguro de calcular, sin que dos ventas casi simultáneas se lleven el
  // mismo número.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ventasSheet = getVentasSheet_();
    var detalleSheet = getDetalleSheet_();

    // Se aseguran las columnas IDCliente y N° Boleta (se agregan solas la
    // primera vez que hacen falta; no hay que crearlas a mano en la hoja).
    var idxIdCliente = agregarColumnaSiFalta_(ventasSheet, 'IDCliente');
    var idxNumeroBoleta = agregarColumnaSiFalta_(ventasSheet, 'N° Boleta');

    // Cada venta que arma la app trae un "idCliente" generado en el celular
    // (siempre el mismo para esa venta, se reintente o no). Si el celular
    // manda la misma venta más de una vez -por ejemplo, si el pedido llegó
    // bien al servidor pero la respuesta se perdió por corte de señal, y la
    // app la volvió a mandar creyendo que había fallado- acá se detecta y se
    // devuelve el resultado de la primera vez (con el mismo N° de boleta),
    // en vez de duplicarla.
    if (data.idCliente) {
      var yaRegistrada = buscarVentaPorIdCliente_(ventasSheet, idxIdCliente, idxNumeroBoleta, data.idCliente);
      if (yaRegistrada) {
        return {
          ventaId: yaRegistrada.ventaId,
          fecha: yaRegistrada.fecha,
          numeroBoleta: yaRegistrada.numeroBoleta,
          transferenciaYaEstabaUsada: false,
          yaEstabaRegistrada: true
        };
      }
    }

    var ventaId = siguienteId_(ventasSheet);
    var fecha = new Date();
    var tipoVenta = (data.tipoVenta === 'transferencia') ? 'transferencia' : 'efectivo';
    var usuario = data.usuario || '';

    // Se arma la fila según los encabezados reales de la hoja (por si el
    // orden de columnas cambió a mano, como al agregar Tipo_venta).
    var numColsVentas = ventasSheet.getLastColumn();
    var filaVenta = new Array(numColsVentas).fill('');
    // Se lee la fila de encabezados una sola vez (antes eran 5 lecturas
    // separadas, una por columna) para que registrar la venta sea más rápido.
    var encabezadosVentas = leerEncabezados_(ventasSheet, 1);
    var idxId = indiceEnLista_(encabezadosVentas, ['ID']);
    var idxFecha = indiceEnLista_(encabezadosVentas, ['Fecha']);
    var idxUsuario = indiceEnLista_(encabezadosVentas, ['Usuario']);
    var idxTotal = indiceEnLista_(encabezadosVentas, ['Total']);
    var idxTipoVenta = indiceEnLista_(encabezadosVentas, ['Tipo_venta']);

    // Número de boleta correlativo POR VENDEDOR y por día (arranca en 1 cada
    // día, como un talonario físico), para poder cruzarlo con un control en
    // papel además del registro digital.
    var numeroBoleta = boletaSiguienteDelDia_(ventasSheet, idxFecha, idxUsuario, idxNumeroBoleta, usuario, fecha);

    if (idxId > 0) filaVenta[idxId - 1] = ventaId;
    if (idxFecha > 0) filaVenta[idxFecha - 1] = fecha;
    if (idxUsuario > 0) filaVenta[idxUsuario - 1] = usuario;
    if (idxTotal > 0) filaVenta[idxTotal - 1] = Number(data.total) || 0;
    if (idxTipoVenta > 0) filaVenta[idxTipoVenta - 1] = tipoVenta;
    if (idxIdCliente > 0) filaVenta[idxIdCliente - 1] = data.idCliente || '';
    if (idxNumeroBoleta > 0) filaVenta[idxNumeroBoleta - 1] = numeroBoleta;
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
      numeroBoleta: numeroBoleta,
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

  var encabezadosVentas = leerEncabezados_(ventasSheet, 1);
  var idxId = indiceEnLista_(encabezadosVentas, ['ID']);
  var idxFecha = indiceEnLista_(encabezadosVentas, ['Fecha']);
  var idxUsuario = indiceEnLista_(encabezadosVentas, ['Usuario']);
  var idxTotal = indiceEnLista_(encabezadosVentas, ['Total']);
  var idxTipoVenta = indiceEnLista_(encabezadosVentas, ['Tipo_venta']);

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

// Ventas del día en curso hechas por el vendedor indicado (no las de los
// demás), con su detalle de productos, ordenadas de la más reciente a la
// más antigua.
function ventasDelDia(data) {
  var usuario = String((data && data.usuario) || '');
  var ventasSheet = getVentasSheet_();
  var detalleSheet = getDetalleSheet_();
  var productosSheet = getProductosSheet_();

  var encabezadosVentas = leerEncabezados_(ventasSheet, 1);
  var idxId = indiceEnLista_(encabezadosVentas, ['ID']);
  var idxFecha = indiceEnLista_(encabezadosVentas, ['Fecha']);
  var idxUsuario = indiceEnLista_(encabezadosVentas, ['Usuario']);
  var idxTotal = indiceEnLista_(encabezadosVentas, ['Total']);
  var idxTipoVenta = indiceEnLista_(encabezadosVentas, ['Tipo_venta']);
  var idxNumeroBoleta = indiceEnLista_(encabezadosVentas, ['N° Boleta']);

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

    var usuarioFila = idxUsuario > 0 ? String(fila[idxUsuario - 1] || '') : '';
    if (usuarioFila !== usuario) continue; // sólo las ventas propias del vendedor logueado

    var idVenta = idxId > 0 ? String(fila[idxId - 1]) : '';
    ventas.push({
      ventaId: idVenta,
      fecha: fechaFila.toISOString(),
      usuario: idxUsuario > 0 ? String(fila[idxUsuario - 1] || '') : '',
      total: idxTotal > 0 ? (Number(fila[idxTotal - 1]) || 0) : 0,
      tipoVenta: idxTipoVenta > 0 ? String(fila[idxTipoVenta - 1] || 'efectivo').toLowerCase() : 'efectivo',
      numeroBoleta: idxNumeroBoleta > 0 ? (fila[idxNumeroBoleta - 1] || '') : '',
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
  var encabezadosVentas = leerEncabezados_(ventasSheet, 1);
  var idxFecha = indiceEnLista_(encabezadosVentas, ['Fecha']);
  var idxUsuario = indiceEnLista_(encabezadosVentas, ['Usuario']);
  var idxTotal = indiceEnLista_(encabezadosVentas, ['Total']);
  var idxTipoVenta = indiceEnLista_(encabezadosVentas, ['Tipo_venta']);

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
    return { autorizado: false, error: 'Seleccionar el curso y el nombre de la lista.' };
  }

  var datosEncabezado = datosEncabezado_(sheet, ['Curso', 'Nombre', 'Nombres']);
  var encabezadosAlumno = datosEncabezado.encabezados;
  var idxCurso = indiceEnLista_(encabezadosAlumno, ['Curso']);
  var idxNombre = indiceEnLista_(encabezadosAlumno, ['Nombre', 'Nombres']);
  var idxApPaterno = indiceEnLista_(encabezadosAlumno, ['Apellido Paterno', 'ApellidoPaterno', 'Primer Apellido']);
  var idxApMaterno = indiceEnLista_(encabezadosAlumno, ['Apellido Materno', 'ApellidoMaterno', 'Segundo Apellido', 'SegundoApellido']);

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
  var datosEncabezado = datosEncabezado_(sheet, ['Curso', 'Nombre', 'Nombres']);
  var filaEncabezado = datosEncabezado.fila;
  var encabezadosAlumno = datosEncabezado.encabezados;
  var idxCurso = indiceEnLista_(encabezadosAlumno, ['Curso']);
  var idxNombre = indiceEnLista_(encabezadosAlumno, ['Nombre', 'Nombres']);
  var idxApPaterno = indiceEnLista_(encabezadosAlumno, ['Apellido Paterno', 'ApellidoPaterno', 'Primer Apellido']);

  var valores = sheet.getDataRange().getValues();
  var alumnos = [];
  // Los datos empiezan justo después de la fila de encabezados (que puede
  // no ser la 1, si hay un título arriba).
  for (var i = filaEncabezado; i < valores.length; i++) {
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

// Diagnóstico de sólo lectura (no expone Apellido Materno) para entender
// por qué el login de Vendedor no encuentra cursos/alumnos. Se puede abrir
// directo en el navegador agregando "?accion=diagnosticoAlumnos" a la URL
// del Web App: muestra en qué hoja de cálculo busca el script, qué pestañas
// tiene, cuál identificó como la de Alumno, en qué fila están los
// encabezados y qué columnas logró emparejar.
function diagnosticoAlumnos_() {
  var ssActiva = SpreadsheetApp.getActiveSpreadsheet();
  var resultado = {
    hojaDeCalculoActiva: { nombre: ssActiva.getName(), id: ssActiva.getId() },
    pestanasEnLaHojaActiva: ssActiva.getSheets().map(function (h) { return h.getName(); })
  };

  var sheet;
  try {
    sheet = getAlumnoSheet_();
  } catch (e) {
    resultado.errorAlBuscarHojaAlumno = String(e);
    return resultado;
  }

  resultado.pestanaAlumnoEncontrada = sheet.getName();
  resultado.totalFilasEnEsaPestana = sheet.getLastRow();
  resultado.totalColumnasEnEsaPestana = sheet.getLastColumn();

  if (sheet.getLastRow() < 1) {
    resultado.aviso = 'La pestaña está vacía (0 filas). Por eso no aparece ningún curso.';
    return resultado;
  }

  var filaEncabezado = encontrarFilaEncabezados_(sheet, ['Curso', 'Nombre', 'Nombres']);
  resultado.filaEncabezadoDetectada = filaEncabezado;
  resultado.contenidoDeEsaFila = sheet.getRange(filaEncabezado, 1, 1, sheet.getLastColumn()).getValues()[0];

  resultado.indiceColumnaCurso = indiceColumnaVarios_(sheet, ['Curso'], filaEncabezado);
  resultado.indiceColumnaNombre = indiceColumnaVarios_(sheet, ['Nombre', 'Nombres'], filaEncabezado);
  resultado.indiceColumnaApellidoPaterno = indiceColumnaVarios_(sheet, ['Apellido Paterno', 'ApellidoPaterno', 'Primer Apellido'], filaEncabezado);
  resultado.indiceColumnaApellidoMaterno = indiceColumnaVarios_(sheet, ['Apellido Materno', 'ApellidoMaterno', 'Segundo Apellido', 'SegundoApellido'], filaEncabezado);

  if (filaEncabezado < sheet.getLastRow()) {
    resultado.contenidoPrimeraFilaDeDatos = sheet.getRange(filaEncabezado + 1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  var alumnosResultado = obtenerAlumnos();
  resultado.cantidadAlumnosDetectados = alumnosResultado.alumnos.length;
  resultado.primerosAlumnos = alumnosResultado.alumnos.slice(0, 3);

  return resultado;
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
