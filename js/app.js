/**
 * APP.JS - Lógica principal de la interfaz.
 */
(function () {

  var estado = {
    rol: null, // 'vendedor' | 'admin'
    usuario: null,
    productos: [],
    carrito: {}, // { productoId: { producto, cantidad } }
    transferenciaSeleccionada: null, // { fila, fecha, run, nombreCompleto, abono }
    tipoVenta: 'efectivo', // 'efectivo' | 'transferencia'
    alumnoActual: null, // { fila, apellidoMaterno } - credenciales del vendedor logueado
    alumnosDisponibles: [] // copia de la hoja Alumno para los selects del login
  };

  /* ---------- Utilidades UI ---------- */
  function $(id) { return document.getElementById(id); }

  function mostrarCarga(texto) {
    $('overlay-carga-texto').textContent = texto || 'Cargando...';
    $('overlay-carga').classList.remove('oculto');
  }
  function ocultarCarga() {
    $('overlay-carga').classList.add('oculto');
  }
  var toastTimeout;
  function toast(msg, esError) {
    if (esError) {
      // Los errores se muestran con alert() para que no se pierdan
      // (el cartel rojo desaparece solo y en el celular a veces no se
      // alcanza a leer). Además queda un texto que se puede copiar/mandar.
      alert('⚠️ ' + msg);
      return;
    }
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('error');
    t.classList.remove('oculto');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () { t.classList.add('oculto'); }, 3500);
  }
  // Separa los miles con punto (formato chileno) y redondea a entero, sin
  // decimales (ej. 1234.5 -> "$1.235").
  function formatoMiles(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function formatoMoneda(n) {
    return CONFIG.MONEDA + formatoMiles(Number(n) || 0);
  }

  /* ---------- Login ---------- */
  function iniciarSesion() {
    var usuarioGuardado = sessionStorage.getItem('kiosco_usuario');
    var rolGuardado = sessionStorage.getItem('kiosco_rol');
    if (usuarioGuardado && rolGuardado) {
      if (rolGuardado === 'vendedor') {
        var alumnoGuardado = null;
        try { alumnoGuardado = JSON.parse(sessionStorage.getItem('kiosco_alumno') || 'null'); } catch (e) {}
        if (!alumnoGuardado || !alumnoGuardado.fila) {
          // Sesión de vendedor incompleta (por ejemplo, restos de una
          // versión anterior de la app): mejor pedir que entre de nuevo.
          sessionStorage.removeItem('kiosco_usuario');
          sessionStorage.removeItem('kiosco_rol');
          sessionStorage.removeItem('kiosco_alumno');
          $('pantalla-login').classList.add('activa');
          return;
        }
        estado.alumnoActual = alumnoGuardado;
        DB.establecerAlumno(alumnoGuardado);
      }
      entrarComo(rolGuardado, usuarioGuardado);
      return;
    }
    $('pantalla-login').classList.add('activa');
  }

  function entrarComo(rol, nombre) {
    estado.rol = rol;
    estado.usuario = nombre;
    sessionStorage.setItem('kiosco_usuario', nombre);
    sessionStorage.setItem('kiosco_rol', rol);
    $('usuario-actual').textContent = nombre + (rol === 'admin' ? ' (administrador)' : '');
    $('pantalla-login').classList.remove('activa');
    $('pantalla-login').classList.add('oculto');
    $('app').classList.remove('oculto');
    mostrarTabsSegunRol();
    cargarProductos();
    actualizarBadgePendientes();
    actualizarBadgeImpresora();
    intentarSincronizar(true);
    if (rol === 'vendedor') refrescarCacheTransferencias();
  }

  // Paso 1: elegir rol
  $('btn-rol-vendedor').addEventListener('click', function () {
    $('login-paso-rol').classList.add('oculto');
    $('login-paso-vendedor').classList.remove('oculto');
    cargarAlumnosLogin();
  });
  $('btn-rol-admin').addEventListener('click', function () {
    $('login-paso-rol').classList.add('oculto');
    $('login-paso-admin').classList.remove('oculto');
  });
  $('btn-volver-rol-1').addEventListener('click', function () {
    $('login-paso-vendedor').classList.add('oculto');
    $('login-paso-rol').classList.remove('oculto');
  });
  $('btn-volver-rol-2').addEventListener('click', function () {
    $('login-paso-admin').classList.add('oculto');
    $('login-paso-rol').classList.remove('oculto');
  });

  // Paso 2a: elegir curso y alumno (llena los selects del login de Vendedor)
  function cargarAlumnosLogin() {
    var selectCurso = $('select-curso-vendedor');
    var selectAlumno = $('select-alumno-vendedor');
    selectCurso.innerHTML = '<option value="">Cargando cursos...</option>';
    selectCurso.disabled = true;
    selectAlumno.innerHTML = '<option value="">Seleccionar primero un curso</option>';
    selectAlumno.disabled = true;
    DB.obtenerAlumnos()
      .then(function (alumnos) {
        estado.alumnosDisponibles = alumnos || [];
        var cursos = [];
        estado.alumnosDisponibles.forEach(function (a) {
          if (a.curso && cursos.indexOf(a.curso) === -1) cursos.push(a.curso);
        });
        cursos.sort();
        selectCurso.innerHTML = '<option value="">Seleccionar un curso</option>' +
          cursos.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join('');
        selectCurso.disabled = false;
      })
      .catch(function (err) {
        selectCurso.innerHTML = '<option value="">No se pudo cargar (revisá la conexión)</option>';
        toast('No se pudo cargar la lista de cursos: ' + err.message, true);
      });
  }

  $('select-curso-vendedor').addEventListener('change', function () {
    var curso = this.value;
    var selectAlumno = $('select-alumno-vendedor');
    if (!curso) {
      selectAlumno.innerHTML = '<option value="">Seleccionar primero un curso</option>';
      selectAlumno.disabled = true;
      return;
    }
    var alumnosDelCurso = estado.alumnosDisponibles
      .filter(function (a) { return a.curso === curso; })
      .sort(function (a, b) { return (a.nombre + a.apellidoPaterno).localeCompare(b.nombre + b.apellidoPaterno); });
    selectAlumno.innerHTML = '<option value="">Seleccionar un nombre</option>' +
      alumnosDelCurso.map(function (a) {
        return '<option value="' + a.fila + '">' + escapeHtml(a.nombre + ' ' + a.apellidoPaterno) + '</option>';
      }).join('');
    selectAlumno.disabled = false;
  });

  function mostrarErrorVendedor(msg) {
    $('login-error-vendedor').textContent = msg;
    $('login-error-vendedor').classList.remove('oculto');
  }

  // Paso 2a: entrar como vendedor (el alumno elegido + su apellido materno)
  $('btn-entrar-vendedor').addEventListener('click', function () {
    $('login-error-vendedor').classList.add('oculto');
    if (!$('select-curso-vendedor').value) {
      mostrarErrorVendedor('Seleccionar un curso.');
      return;
    }
    var fila = Number($('select-alumno-vendedor').value);
    if (!fila) {
      mostrarErrorVendedor('Seleccionar un nombre de la lista.');
      return;
    }
    var apellidoMaterno = $('input-apellido-materno').value.trim();
    if (!apellidoMaterno) {
      mostrarErrorVendedor('Ingresar el apellido materno.');
      return;
    }
    mostrarCarga('Verificando...');
    DB.iniciarSesionAlumno(fila, apellidoMaterno)
      .then(function (resp) {
        var alumno = { fila: fila, apellidoMaterno: apellidoMaterno };
        estado.alumnoActual = alumno;
        DB.establecerAlumno(alumno);
        sessionStorage.setItem('kiosco_alumno', JSON.stringify(alumno));
        entrarComo('vendedor', resp.usuario);
      })
      .catch(function (err) { mostrarErrorVendedor(err.message); })
      .then(ocultarCarga);
  });
  $('input-apellido-materno').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('btn-entrar-vendedor').click();
  });

  // Paso 2b: entrar como administrador
  $('btn-entrar-admin').addEventListener('click', function () {
    var clave = $('input-clave-admin').value;
    var nombre = $('input-nombre-admin').value.trim();
    if (clave !== CONFIG.CLAVE_ADMIN) {
      $('login-error-admin').textContent = 'Clave incorrecta.';
      $('login-error-admin').classList.remove('oculto');
      return;
    }
    if (!nombre) {
      $('login-error-admin').textContent = 'Ingresar el nombre para continuar.';
      $('login-error-admin').classList.remove('oculto');
      return;
    }
    entrarComo('admin', nombre);
  });
  $('input-nombre-admin').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('btn-entrar-admin').click();
  });

  $('btn-cambiar-usuario').addEventListener('click', function () {
    sessionStorage.removeItem('kiosco_usuario');
    sessionStorage.removeItem('kiosco_rol');
    sessionStorage.removeItem('kiosco_alumno');
    location.reload();
  });

  /* ---------- Tabs ---------- */
  function mostrarTabsSegunRol() {
    document.querySelectorAll('.tab').forEach(function (btn) {
      if (btn.dataset.rol === estado.rol) {
        btn.classList.remove('oculto');
      } else {
        btn.classList.add('oculto');
      }
    });
    var primera = document.querySelector('.tab[data-rol="' + estado.rol + '"]');
    if (primera) activarTab(primera.dataset.tab);
  }

  function activarTab(nombreTab) {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('activa'); });
    document.querySelectorAll('.tab-contenido').forEach(function (c) { c.classList.remove('activa'); });
    var boton = document.querySelector('.tab[data-tab="' + nombreTab + '"]');
    if (boton) boton.classList.add('activa');
    var contenido = $('tab-' + nombreTab);
    if (contenido) contenido.classList.add('activa');
    if (nombreTab === 'resumen') cargarResumenTransferencias();
    if (nombreTab === 'transferencias') refrescarCacheTransferencias();
    if (nombreTab === 'auditoria') cargarAuditoria();
    if (nombreTab === 'ventas-dia') cargarVentasDelDia();
    if (nombreTab === 'recaudacion') cargarRecaudacion();
  }

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () { activarTab(btn.dataset.tab); });
  });

  /* ---------- Cargar productos ---------- */
  function cargarProductos() {
    mostrarCarga('Cargando productos...');
    DB.obtenerProductos()
      .then(function (productos) {
        estado.productos = productos || [];
        renderizarProductosVenta();
        renderizarProductosAdmin();
      })
      .catch(function (err) { toast('Error al cargar productos: ' + err.message, true); })
      .then(ocultarCarga);
  }

  /* ---------- Vista Venta ---------- */
  function renderizarProductosVenta() {
    var cont = $('grid-productos-venta');
    cont.innerHTML = '';
    if (!estado.productos.length) {
      cont.innerHTML = '<p>No hay productos cargados. Agregalos en la pestaña Productos.</p>';
      return;
    }
    estado.productos.forEach(function (p) {
      var enCarrito = estado.carrito[p.id];
      var div = document.createElement('div');
      div.className = 'tarjeta-producto' + (enCarrito ? ' seleccionado' : '');
      div.innerHTML =
        (p.fotoUrl
          ? '<img src="' + p.fotoUrl + '" alt="">'
          : '<div class="sin-foto">📦</div>') +
        '<div class="nombre">' + escapeHtml(p.nombre) + '</div>' +
        '<div class="precio">' + formatoMoneda(p.precio) + '</div>' +
        '<div class="stepper">' +
        '<button class="btn-restar">−</button>' +
        '<span class="cantidad">' + (enCarrito ? enCarrito.cantidad : 0) + '</span>' +
        '<button class="btn-sumar">+</button>' +
        '</div>';
      div.querySelector('.btn-sumar').addEventListener('click', function (e) {
        e.stopPropagation();
        cambiarCantidad(p, 1);
      });
      div.querySelector('.btn-restar').addEventListener('click', function (e) {
        e.stopPropagation();
        cambiarCantidad(p, -1);
      });
      cont.appendChild(div);
    });
  }

  function cambiarCantidad(producto, delta) {
    var item = estado.carrito[producto.id];
    var cantidadActual = item ? item.cantidad : 0;
    var nuevaCantidad = Math.max(0, cantidadActual + delta);
    if (nuevaCantidad === 0) {
      delete estado.carrito[producto.id];
    } else {
      estado.carrito[producto.id] = { producto: producto, cantidad: nuevaCantidad };
    }
    renderizarProductosVenta();
    renderizarCarrito();
  }

  function renderizarCarrito() {
    var cont = $('carrito-items');
    var items = Object.values(estado.carrito);
    if (!items.length) {
      cont.innerHTML = '<p class="vacio">No hay productos seleccionados</p>';
      $('carrito-total-monto').textContent = formatoMoneda(0);
      $('btn-registrar-venta').disabled = true;
      return;
    }
    var total = 0;
    cont.innerHTML = items.map(function (item) {
      var subtotal = item.producto.precio * item.cantidad;
      total += subtotal;
      return '<div class="carrito-item">' +
        '<div class="info">' + escapeHtml(item.producto.nombre) + ' x' + item.cantidad + '</div>' +
        '<div class="subtotal">' + formatoMoneda(subtotal) + '</div>' +
        '</div>';
    }).join('');
    $('carrito-total-monto').textContent = formatoMoneda(total);
    $('btn-registrar-venta').disabled = false;
  }

  $('btn-registrar-venta').addEventListener('click', registrarVenta);

  function registrarVenta() {
    var items = Object.values(estado.carrito).map(function (item) {
      return {
        productoId: item.producto.id,
        productoNombre: item.producto.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.producto.precio,
        subtotal: item.producto.precio * item.cantidad
      };
    });
    if (!items.length) return;
    var total = items.reduce(function (acc, it) { return acc + it.subtotal; }, 0);
    var venta = {
      usuario: estado.usuario,
      items: items,
      total: total,
      fecha: new Date().toISOString(),
      tipoVenta: estado.tipoVenta,
      // Se adjunta acá (y no en db.js) para que quede guardado dentro de la
      // venta si termina encolada sin señal: así, cuando se sincronice más
      // tarde, se revalida con las credenciales de quien la hizo, aunque
      // para entonces haya iniciado sesión otro vendedor en el celular.
      alumno: estado.alumnoActual
    };
    if (estado.transferenciaSeleccionada) {
      venta.transferenciaFila = estado.transferenciaSeleccionada.fila;
    }

    mostrarCarga('Registrando venta...');
    DB.registrarVenta(venta)
      .then(function (respuesta) {
        venta.ventaId = respuesta.ventaId;
        finalizarVentaExitosa(venta, false);
      })
      .catch(function (err) {
        if (err.esErrorDeRed) {
          // Sin señal: la venta queda guardada en el celular y se manda
          // sola cuando vuelva la conexión. No se pierde nada.
          DB.encolarVenta(venta);
          actualizarBadgePendientes();
          finalizarVentaExitosa(venta, true);
          return;
        }
        toast('Error al registrar la venta: ' + err.message, true);
      })
      .then(ocultarCarga);
  }

  function finalizarVentaExitosa(venta, pendienteDeSincronizar) {
    if (venta.transferenciaFila) quitarTransferenciaDelListado_(venta.transferenciaFila);
    estado.carrito = {};
    estado.transferenciaSeleccionada = null;
    estado.tipoVenta = 'efectivo';
    renderizarProductosVenta();
    renderizarCarrito();
    renderizarBannerTransferencia();
    renderizarSelectorTipoVenta();
    mostrarVentaExito(venta, pendienteDeSincronizar);
  }

  // Se guarda acá la última venta para poder imprimirla con un toque
  // "fresco" del usuario (Bluetooth y compartir archivos exigen que la
  // acción salga de un toque directo, no de algo disparado automáticamente
  // después de esperar una respuesta de red).
  var ultimaVentaRegistrada = null;

  function mostrarVentaExito(venta, pendienteDeSincronizar) {
    ultimaVentaRegistrada = venta;
    var texto = 'Vendedor: ' + venta.usuario + ' — Total: ' + formatoMoneda(venta.total);
    if (pendienteDeSincronizar) {
      texto += ' — ⚠️ Guardada en el celular, sin señal todavía. Se va a mandar sola a la hoja apenas haya conexión.';
    }
    $('venta-exito-resumen').textContent = texto;
    $('modal-venta-exito').classList.remove('oculto');
  }

  $('btn-cerrar-venta-exito').addEventListener('click', function () {
    $('modal-venta-exito').classList.add('oculto');
  });

  $('btn-imprimir-comprobante').addEventListener('click', function () {
    if (!ultimaVentaRegistrada) return;
    imprimirSiCorresponde(ultimaVentaRegistrada);
  });

  function imprimirSiCorresponde(venta) {
    // 1) Si hay una impresora BLE genérica conectada (ESC/POS estándar), se
    //    imprime directo sin pasos extra.
    if (Impresora.soportado() && Impresora.estaConectada()) {
      mostrarCarga('Imprimiendo...');
      return Impresora.imprimirVenta(venta)
        .then(function () {
          toast('Comprobante impreso.');
          $('modal-venta-exito').classList.add('oculto');
        })
        .catch(function (err) { toast('Falló la impresión: ' + err.message, true); })
        .then(ocultarCarga);
    }
    // 2) Muchas impresoras de bolsillo (como las que usan la app "Fun
    //    Print") no son compatibles con Web Bluetooth: se comparte el
    //    comprobante como imagen para terminarlo de imprimir desde esa app.
    if (Impresora.puedeCompartirImagenes()) {
      return Impresora.compartirTicket(venta)
        .then(function () {
          $('modal-venta-exito').classList.add('oculto');
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return; // el usuario cerró el menú de compartir
          toast('No se pudo compartir el comprobante: ' + err.message, true);
        });
    }
    toast('Este navegador no permite compartir el comprobante automáticamente.', true);
  }

  /* ---------- Sincronización de ventas pendientes ---------- */
  function actualizarBadgePendientes() {
    var n = DB.obtenerColaVentas().length;
    var badge = $('badge-pendientes');
    if (n > 0) {
      badge.textContent = n;
      badge.classList.remove('oculto');
      $('btn-sincronizar').classList.remove('oculto');
    } else {
      badge.classList.add('oculto');
      $('btn-sincronizar').classList.add('oculto');
    }
  }

  var sincronizando = false;
  function intentarSincronizar(silencioso) {
    if (sincronizando || !DB.hayVentasPendientes()) return;
    sincronizando = true;
    DB.sincronizarVentasPendientes()
      .then(function (resultado) {
        actualizarBadgePendientes();
        if (resultado.sincronizadas > 0) {
          toast(resultado.sincronizadas + ' venta(s) pendiente(s) sincronizada(s).');
        }
        if (resultado.conflictos > 0) {
          toast('Atención: ' + resultado.conflictos + ' venta(s) sincronizada(s) usaban una transferencia que ya había sido usada por otra venta. Revisar con un administrador.', true);
        }
      })
      .catch(function (err) {
        if (!silencioso) toast('No se pudo sincronizar: ' + err.message, true);
      })
      .then(function () { sincronizando = false; });
  }

  $('btn-sincronizar').addEventListener('click', function () { intentarSincronizar(false); });
  window.addEventListener('online', function () { intentarSincronizar(true); });
  setInterval(function () { intentarSincronizar(true); }, 45000);

  /* ---------- Impresora: conectar + indicador de "no conectada" ---------- */
  function actualizarBadgeImpresora() {
    var badge = $('badge-impresora');
    if (Impresora.soportado() && Impresora.estaConectada()) {
      badge.classList.add('oculto');
    } else {
      badge.classList.remove('oculto');
    }
  }

  // Se entera al toque si la impresora se desconecta sola (se apaga, se
  // aleja, se queda sin batería) para que el indicador quede al día.
  Impresora.alCambiarEstado(actualizarBadgeImpresora);

  $('btn-conectar-impresora').addEventListener('click', function () {
    if (!Impresora.soportado()) {
      toast('Este navegador no soporta Bluetooth. Usar Chrome en Android.', true);
      return;
    }
    mostrarCarga('Buscando impresora...');
    Impresora.conectar()
      .then(function () { toast('Impresora conectada.'); })
      .catch(function (err) { toast('No se pudo conectar la impresora: ' + err.message, true); })
      .then(function () { ocultarCarga(); actualizarBadgeImpresora(); });
  });

  /* ---------- Vista Productos (admin) ---------- */
  function renderizarProductosAdmin() {
    var cont = $('lista-productos-admin');
    if (!estado.productos.length) {
      cont.innerHTML = '<p>No hay productos cargados todavía.</p>';
      return;
    }
    cont.innerHTML = '';
    estado.productos.forEach(function (p) {
      var div = document.createElement('div');
      div.className = 'fila-producto-admin';
      div.innerHTML =
        (p.fotoUrl
          ? '<img src="' + p.fotoUrl + '" alt="">'
          : '<div class="sin-foto">📦</div>') +
        '<div class="info">' +
        '<div class="nombre">' + escapeHtml(p.nombre) + '</div>' +
        '<div class="precio">' + formatoMoneda(p.precio) + '</div>' +
        '</div>' +
        '<button class="btn btn-chico btn-editar">Editar</button>';
      div.querySelector('.btn-editar').addEventListener('click', function () { abrirModalProducto(p); });
      cont.appendChild(div);
    });
  }

  $('btn-nuevo-producto').addEventListener('click', function () { abrirModalProducto(null); });

  var fotoBase64Actual = null;

  function abrirModalProducto(producto) {
    fotoBase64Actual = null;
    $('modal-producto-error').classList.add('oculto');
    $('producto-foto').value = '';
    if (producto) {
      $('modal-producto-titulo').textContent = 'Editar producto';
      $('producto-id').value = producto.id;
      $('producto-nombre').value = producto.nombre;
      $('producto-precio').value = producto.precio;
      if (producto.fotoUrl) {
        $('producto-foto-preview').src = producto.fotoUrl;
        $('producto-foto-preview').classList.remove('oculto');
      } else {
        $('producto-foto-preview').classList.add('oculto');
      }
      $('btn-eliminar-producto').classList.remove('oculto');
    } else {
      $('modal-producto-titulo').textContent = 'Nuevo producto';
      $('producto-id').value = '';
      $('producto-nombre').value = '';
      $('producto-precio').value = '';
      $('producto-foto-preview').classList.add('oculto');
      $('btn-eliminar-producto').classList.add('oculto');
    }
    $('modal-producto').classList.remove('oculto');
  }

  $('btn-cancelar-producto').addEventListener('click', function () {
    $('modal-producto').classList.add('oculto');
  });

  $('producto-foto').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      fotoBase64Actual = reader.result;
      $('producto-foto-preview').src = fotoBase64Actual;
      $('producto-foto-preview').classList.remove('oculto');
    };
    reader.readAsDataURL(file);
  });

  $('btn-guardar-producto').addEventListener('click', function () {
    var id = $('producto-id').value;
    var nombre = $('producto-nombre').value.trim();
    var precio = parseFloat($('producto-precio').value);

    if (!nombre || isNaN(precio) || precio < 0) {
      $('modal-producto-error').textContent = 'Completá nombre y precio válidos.';
      $('modal-producto-error').classList.remove('oculto');
      return;
    }

    var payload = { nombre: nombre, precio: precio };
    if (fotoBase64Actual) payload.fotoBase64 = fotoBase64Actual;

    mostrarCarga('Guardando producto...');
    var promesa = id
      ? DB.actualizarProducto(Object.assign({ id: id }, payload))
      : DB.agregarProducto(payload);

    promesa
      .then(function () {
        toast('Producto guardado.');
        $('modal-producto').classList.add('oculto');
        cargarProductos();
      })
      .catch(function (err) { toast('Error al guardar: ' + err.message, true); })
      .then(ocultarCarga);
  });

  $('btn-eliminar-producto').addEventListener('click', function () {
    var id = $('producto-id').value;
    if (!id) return;
    if (!confirm('¿Eliminar este producto? Ya no se podrá vender, pero el historial de ventas se conserva.')) return;
    mostrarCarga('Eliminando...');
    DB.eliminarProducto(id)
      .then(function () {
        toast('Producto eliminado.');
        $('modal-producto').classList.add('oculto');
        cargarProductos();
      })
      .catch(function (err) { toast('Error al eliminar: ' + err.message, true); })
      .then(ocultarCarga);
  });

  /* ---------- Selector de tipo de venta (efectivo / transferencia) ---------- */
  function renderizarSelectorTipoVenta() {
    $('btn-tipo-efectivo').classList.toggle('activo', estado.tipoVenta === 'efectivo');
    $('btn-tipo-transferencia').classList.toggle('activo', estado.tipoVenta === 'transferencia');
  }

  function elegirTipoVenta(tipo) {
    estado.tipoVenta = tipo;
    renderizarSelectorTipoVenta();
  }

  $('btn-tipo-efectivo').addEventListener('click', function () { elegirTipoVenta('efectivo'); });
  $('btn-tipo-transferencia').addEventListener('click', function () { elegirTipoVenta('transferencia'); });

  /* ---------- Transferencias (vendedor) ---------- */
  function renderizarBannerTransferencia() {
    var banner = $('banner-transferencia');
    if (!estado.transferenciaSeleccionada) {
      banner.classList.add('oculto');
      return;
    }
    var t = estado.transferenciaSeleccionada;
    $('banner-transferencia-texto').textContent =
      'Transferencia de ' + t.nombreCompleto + ' (RUN ' + t.run + ') — Abono disponible: ' + formatoMoneda(t.abono);
    banner.classList.remove('oculto');
  }

  $('btn-quitar-transferencia').addEventListener('click', function () {
    estado.transferenciaSeleccionada = null;
    renderizarBannerTransferencia();
  });

  $('btn-buscar-transferencia').addEventListener('click', buscarTransferencias);
  $('input-buscar-transferencia').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') buscarTransferencias();
  });

  function buscarTransferencias() {
    var texto = $('input-buscar-transferencia').value.trim();
    if (!texto) return;
    mostrarCarga('Buscando...');
    DB.buscarTransferencias(texto)
      .then(function (resp) { renderizarResultadosTransferencias(resp.transferencias || [], null); })
      .catch(function (err) {
        if (err.esErrorDeRed) {
          // Sin señal: buscamos en la última copia guardada.
          var enCache = DB.buscarTransferenciasEnCache(texto);
          renderizarResultadosTransferencias(enCache.transferencias, enCache.actualizado);
          return;
        }
        toast('Error al buscar transferencias: ' + err.message, true);
      })
      .then(ocultarCarga);
  }

  // Trae la lista completa de transferencias sin usar y la guarda local,
  // para que la búsqueda offline tenga datos lo más frescos posible.
  // Se hace "en silencio": si falla (sin señal), no molesta con un error.
  function refrescarCacheTransferencias() {
    DB.obtenerTransferenciasSinUsar().catch(function () {});
  }

  // Saca del listado ya mostrado (sin esperar a un refresco) la transferencia
  // que se acaba de usar en una venta, para que no siga apareciendo como
  // disponible hasta que alguien busque de nuevo.
  function quitarTransferenciaDelListado_(fila) {
    if (!fila) return;
    var cont = $('resultados-transferencias');
    var el = cont.querySelector('.transferencia-item[data-fila="' + fila + '"]');
    if (el) el.remove();
    if (!cont.querySelector('.transferencia-item') && !cont.querySelector('.vacio')) {
      cont.innerHTML += '<p class="vacio">No se encontraron transferencias sin usar con ese dato.</p>';
    }
  }

  function renderizarResultadosTransferencias(lista, actualizadoOffline) {
    var cont = $('resultados-transferencias');
    var avisoOffline = actualizadoOffline
      ? '<p class="aviso-offline">⚠️ Sin conexión: mostrando datos guardados el ' +
        new Date(actualizadoOffline).toLocaleString() + '. Pueden estar desactualizados.</p>'
      : '';
    if (!lista.length) {
      cont.innerHTML = avisoOffline + '<p class="vacio">No se encontraron transferencias sin usar con ese dato.</p>';
      return;
    }
    cont.innerHTML = avisoOffline;
    lista.forEach(function (t) {
      var div = document.createElement('div');
      div.className = 'transferencia-item';
      div.dataset.fila = t.fila;
      var fechaTexto = t.fecha ? new Date(t.fecha).toLocaleDateString() : '';
      div.innerHTML =
        '<div class="info">' +
        '<div class="nombre">' + escapeHtml(t.nombreCompleto) + '</div>' +
        '<div class="detalle">RUN: ' + escapeHtml(t.run) + (fechaTexto ? ' — ' + fechaTexto : '') + '</div>' +
        '<div class="abono">Abono: ' + formatoMoneda(t.abono) + '</div>' +
        '</div>' +
        '<button class="btn btn-primario btn-usar-transferencia">Usar</button>';
      div.querySelector('.btn-usar-transferencia').addEventListener('click', function () {
        estado.transferenciaSeleccionada = t;
        estado.tipoVenta = 'transferencia';
        renderizarBannerTransferencia();
        renderizarSelectorTipoVenta();
        activarTab('venta');
      });
      cont.appendChild(div);
    });
  }

  /* ---------- Resumen de transferencias (admin) ---------- */
  function cargarResumenTransferencias() {
    mostrarCarga('Cargando resumen...');
    DB.resumenTransferencias()
      .then(function (resp) {
        $('resumen-cantidad').textContent = resp.cantidad;
        $('resumen-monto').textContent = formatoMoneda(resp.montoTotal);
      })
      .catch(function (err) { toast('Error al cargar el resumen: ' + err.message, true); })
      .then(ocultarCarga);
  }

  $('btn-actualizar-resumen').addEventListener('click', cargarResumenTransferencias);

  /* ---------- Auditoría del día (vendedor) ---------- */
  function cargarAuditoria() {
    mostrarCarga('Cargando auditoría...');
    DB.auditoriaDelDia(estado.usuario)
      .then(function (resp) {
        $('auditoria-efectivo').textContent = formatoMoneda(resp.totalEfectivo || 0);
        $('auditoria-transferencia').textContent = formatoMoneda(resp.totalTransferencia || 0);
        var cont = $('auditoria-productos');
        var productos = resp.productos || [];
        if (!productos.length) {
          cont.innerHTML = '<p class="vacio">Todavía no se registraron ventas propias hoy.</p>';
          return;
        }
        cont.innerHTML = productos.map(function (p) {
          return '<div class="fila-auditoria-producto">' +
            '<span class="nombre">' + escapeHtml(p.nombre) + '</span>' +
            '<span class="cantidad">x' + p.cantidad + '</span>' +
            '</div>';
        }).join('');
      })
      .catch(function (err) { toast('Error al cargar la auditoría: ' + err.message, true); })
      .then(ocultarCarga);
  }

  $('btn-actualizar-auditoria').addEventListener('click', cargarAuditoria);

  /* ---------- Ventas del día (vendedor) ---------- */
  function cargarVentasDelDia() {
    mostrarCarga('Cargando ventas del día...');
    DB.ventasDelDia(estado.usuario)
      .then(function (resp) {
        var cont = $('lista-ventas-dia');
        var ventas = resp.ventas || [];
        if (!ventas.length) {
          cont.innerHTML = '<p class="vacio">Todavía no se registraron ventas propias hoy.</p>';
          return;
        }
        cont.innerHTML = ventas.map(function (v) {
          var hora = new Date(v.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          var tipoTexto = v.tipoVenta === 'transferencia' ? '💳 Transferencia' : '💵 Efectivo';
          var productosHtml = (v.productos || []).map(function (p) {
            return '<div class="producto-linea">' +
              '<span>' + escapeHtml(p.nombre) + ' x' + p.cantidad + '</span>' +
              '<span>' + formatoMoneda(p.subtotal) + '</span>' +
              '</div>';
          }).join('');
          return '<div class="venta-dia-item">' +
            '<div class="cabecera">' +
            '<span class="hora">' + hora + '</span>' +
            '<span class="vendedor">' + escapeHtml(v.usuario) + '</span>' +
            '<span class="tipo ' + v.tipoVenta + '">' + tipoTexto + '</span>' +
            '<span class="total">' + formatoMoneda(v.total) + '</span>' +
            '</div>' +
            '<div class="productos">' + (productosHtml || '<span>Sin detalle de productos.</span>') + '</div>' +
            '</div>';
        }).join('');
      })
      .catch(function (err) { toast('Error al cargar las ventas del día: ' + err.message, true); })
      .then(ocultarCarga);
  }

  $('btn-actualizar-ventas-dia').addEventListener('click', cargarVentasDelDia);

  /* ---------- Recaudación por vendedor y día (admin) ---------- */
  function cargarRecaudacion() {
    mostrarCarga('Cargando recaudación...');
    DB.recaudacionPorVendedorYDia()
      .then(function (lista) {
        var cont = $('tabla-recaudacion-wrap');
        if (!lista.length) {
          cont.innerHTML = '<p class="vacio">Todavía no hay ventas registradas.</p>';
          return;
        }
        var totalEfectivo = 0, totalTransferencia = 0, totalGeneral = 0;
        var filas = lista.map(function (r) {
          totalEfectivo += r.efectivo;
          totalTransferencia += r.transferencia;
          totalGeneral += r.total;
          return '<tr>' +
            '<td>' + escapeHtml(r.fecha) + '</td>' +
            '<td>' + escapeHtml(r.usuario) + '</td>' +
            '<td>' + formatoMoneda(r.efectivo) + '</td>' +
            '<td>' + formatoMoneda(r.transferencia) + '</td>' +
            '<td>' + formatoMoneda(r.total) + '</td>' +
            '</tr>';
        }).join('');
        cont.innerHTML =
          '<table class="tabla-recaudacion">' +
          '<thead><tr><th>Fecha</th><th>Vendedor</th><th>Efectivo</th><th>Transferencia</th><th>Total</th></tr></thead>' +
          '<tbody>' + filas + '</tbody>' +
          '<tfoot><tr>' +
          '<td colspan="2">Total general</td>' +
          '<td>' + formatoMoneda(totalEfectivo) + '</td>' +
          '<td>' + formatoMoneda(totalTransferencia) + '</td>' +
          '<td>' + formatoMoneda(totalGeneral) + '</td>' +
          '</tr></tfoot>' +
          '</table>';
      })
      .catch(function (err) { toast('Error al cargar la recaudación: ' + err.message, true); })
      .then(ocultarCarga);
  }

  $('btn-actualizar-recaudacion').addEventListener('click', cargarRecaudacion);

  /* ---------- Helpers ---------- */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- Arranque ---------- */
  if (!DB.urlConfigurada()) {
    toast('Falta configurar la URL de Apps Script en js/config.js', true);
  }
  iniciarSesion();

  // Registrar service worker para uso offline básico (si el archivo se sirve por http/https).
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

})();
