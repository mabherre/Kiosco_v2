/**
 * DB.JS - Comunicación con el backend (Google Apps Script) + caché local +
 * cola de ventas pendientes para cuando hay poca o ninguna señal.
 *
 * Nota técnica: se usa Content-Type "text/plain" en los POST a propósito.
 * Esto evita que el navegador dispare un "preflight" OPTIONS (petición CORS
 * compleja), que Apps Script no responde. Así, el POST llega directo como
 * una petición "simple" y funciona sin configurar CORS manualmente.
 */

var DB = (function () {

  var CACHE_PRODUCTOS_KEY = 'kiosco_productos_cache_v1';
  var CACHE_TRANSFERENCIAS_KEY = 'kiosco_transferencias_cache_v1';
  var COLA_VENTAS_KEY = 'kiosco_cola_ventas_v1';
  var TIMEOUT_MS = 20000; // si no responde en este tiempo, se trata como sin conexión
  // (Apps Script a veces tarda varios segundos en responder, sobre todo con
  // el servidor "frío"; un límite muy corto marcaba como error pedidos que
  // en realidad iban a terminar bien.)

  // Credenciales del alumno actualmente logueado como Vendedor ({fila,
  // apellidoMaterno}). Se adjuntan a cada acción de vendedor para que el
  // backend las revalide. Se completa con establecerAlumno() al iniciar
  // sesión (o al restaurar la sesión guardada).
  var alumnoActual = null;

  function urlConfigurada() {
    return CONFIG.URL_APPS_SCRIPT && CONFIG.URL_APPS_SCRIPT.indexOf('https://') === 0;
  }

  function llamarBackend(accion, payload) {
    if (!urlConfigurada()) {
      return Promise.reject(new Error('Falta configurar la URL de Apps Script en js/config.js'));
    }
    var body = Object.assign({ accion: accion, tokenApp: CONFIG.TOKEN_APP }, payload || {});

    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timeoutId = controller && setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch(CONFIG.URL_APPS_SCRIPT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        return res.json();
      })
      .then(function (json) {
        if (!json.ok) {
          // Llegó respuesta del servidor, pero la rechazó (clave incorrecta,
          // dato inválido, etc). Esto NO es un problema de conexión: no hay
          // que encolar, hay que avisar el error real.
          var err = new Error(json.error || 'Error desconocido del servidor');
          err.esErrorDeRed = false;
          throw err;
        }
        return json;
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err.esErrorDeRed === false) throw err; // ya es un error "real", lo dejamos pasar tal cual
        // TypeError (fetch falló) o AbortError (timeout): esto sí es un
        // problema de conexión.
        var errorDeRed = new Error(
          err.name === 'AbortError' ? 'La conexión tardó demasiado (sin señal).' : (err.message || 'Sin conexión')
        );
        errorDeRed.esErrorDeRed = true;
        throw errorDeRed;
      });
  }

  /* ---------------- Caché de productos ---------------- */

  function guardarCacheProductos(productos) {
    try { localStorage.setItem(CACHE_PRODUCTOS_KEY, JSON.stringify(productos)); } catch (e) {}
  }

  function leerCacheProductos() {
    try {
      var raw = localStorage.getItem(CACHE_PRODUCTOS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  /* ---------------- Caché de transferencias sin usar ---------------- */

  function guardarCacheTransferencias(lista) {
    try {
      localStorage.setItem(CACHE_TRANSFERENCIAS_KEY, JSON.stringify({
        actualizado: new Date().toISOString(),
        lista: lista
      }));
    } catch (e) {}
  }

  function leerCacheTransferencias() {
    try {
      var raw = localStorage.getItem(CACHE_TRANSFERENCIAS_KEY);
      return raw ? JSON.parse(raw) : { actualizado: null, lista: [] };
    } catch (e) { return { actualizado: null, lista: [] }; }
  }

  function normalizarTexto(s) {
    return String(s || '').toLowerCase().replace(/[.\-\s]/g, '');
  }

  // Marca una transferencia como usada en la copia local (para que no
  // vuelva a aparecer en búsquedas offline de esta misma sesión).
  function marcarUsadaEnCacheLocal(fila) {
    var cache = leerCacheTransferencias();
    cache.lista = cache.lista.filter(function (t) { return t.fila !== fila; });
    guardarCacheTransferencias(cache.lista);
  }

  /* ---------------- Cola de ventas pendientes de sincronizar ---------------- */

  function leerCola() {
    try {
      var raw = localStorage.getItem(COLA_VENTAS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function guardarCola(cola) {
    try { localStorage.setItem(COLA_VENTAS_KEY, JSON.stringify(cola)); } catch (e) {}
  }

  function encolarVenta(venta) {
    var cola = leerCola();
    venta.idLocal = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    cola.push(venta);
    guardarCola(cola);
    if (venta.transferenciaFila) marcarUsadaEnCacheLocal(venta.transferenciaFila);
    return venta.idLocal;
  }

  function quitarDeCola(idLocal) {
    var cola = leerCola().filter(function (v) { return v.idLocal !== idLocal; });
    guardarCola(cola);
  }

  return {
    urlConfigurada: urlConfigurada,

    obtenerProductos: function () {
      return llamarBackend('getProductos')
        .then(function (json) {
          guardarCacheProductos(json.productos);
          return json.productos;
        })
        .catch(function (err) {
          console.warn('No se pudo obtener productos del servidor, usando caché local:', err);
          return leerCacheProductos();
        });
    },

    // Estas tres acciones son sólo de Administrador: además del token de la
    // app, mandan la clave de administrador para que el backend la valide.
    agregarProducto: function (producto) {
      return llamarBackend('agregarProducto', Object.assign({ claveAdmin: CONFIG.CLAVE_ADMIN }, producto));
    },

    actualizarProducto: function (producto) {
      return llamarBackend('actualizarProducto', Object.assign({ claveAdmin: CONFIG.CLAVE_ADMIN }, producto));
    },

    eliminarProducto: function (id) {
      return llamarBackend('eliminarProducto', { id: id, claveAdmin: CONFIG.CLAVE_ADMIN });
    },

    // Credenciales del alumno logueado como Vendedor (ver arriba). Hay que
    // llamarla apenas se loguea (o al restaurar sesión), antes de usar
    // cualquiera de las acciones de vendedor de más abajo.
    establecerAlumno: function (alumno) {
      alumnoActual = alumno;
    },

    // Estas acciones son sólo de Vendedor: mandan las credenciales del
    // alumno logueado para que el backend las revalide contra la hoja
    // Alumno (no hay clave compartida de vendedor).
    registrarVenta: function (venta) {
      // La venta ya trae venta.alumno adjunto desde que se armó en app.js
      // (así una venta encolada sin señal conserva las credenciales de
      // quien la hizo, aunque después inicie sesión otra persona).
      return llamarBackend('registrarVenta', venta);
    },

    buscarTransferencias: function (texto) {
      return llamarBackend('buscarTransferencias', { texto: texto, alumno: alumnoActual });
    },

    resumenTransferencias: function () {
      return llamarBackend('resumenTransferencias');
    },

    auditoriaDelDia: function (usuario) {
      return llamarBackend('auditoriaDelDia', { usuario: usuario, alumno: alumnoActual });
    },

    ventasDelDia: function (usuario) {
      return llamarBackend('ventasDelDia', { usuario: usuario, alumno: alumnoActual });
    },

    obtenerTransferenciasSinUsar: function () {
      return llamarBackend('obtenerTransferenciasSinUsar', { alumno: alumnoActual })
        .then(function (json) {
          guardarCacheTransferencias(json.transferencias || []);
          return json.transferencias || [];
        });
    },

    // Lista de alumnos (curso, nombre, apellido paterno) para poblar los
    // selectores del login de Vendedor. No requiere sesión previa.
    obtenerAlumnos: function () {
      return llamarBackend('obtenerAlumnos').then(function (json) {
        return json.alumnos || [];
      });
    },

    // Login de Vendedor: valida el alumno elegido contra su Apellido
    // Materno. Devuelve { usuario, curso } si es correcto (rechaza con el
    // error real si no).
    iniciarSesionAlumno: function (fila, apellidoMaterno) {
      return llamarBackend('iniciarSesionAlumno', { alumno: { fila: fila, apellidoMaterno: apellidoMaterno } });
    },

    // Sólo lectura: próximo N° de boleta de ESE vendedor hoy, según el
    // servidor. Se usa al iniciar sesión (si hay señal) para poner al día el
    // contador local que permite seguir numerando boletas sin conexión.
    proximoNumeroBoleta: function (usuario) {
      return llamarBackend('proximoNumeroBoleta', { usuario: usuario, alumno: alumnoActual })
        .then(function (json) { return json.numeroBoleta; });
    },

    // Sólo Administrador: recaudación total por vendedor y por día,
    // separando efectivo de transferencia.
    recaudacionPorVendedorYDia: function () {
      return llamarBackend('recaudacionPorVendedorYDia', { claveAdmin: CONFIG.CLAVE_ADMIN })
        .then(function (json) { return json.recaudacion || []; });
    },

    // Busca en la copia guardada localmente (para cuando no hay señal).
    buscarTransferenciasEnCache: function (texto) {
      var termino = normalizarTexto(texto);
      var cache = leerCacheTransferencias();
      var resultados = cache.lista.filter(function (t) {
        return normalizarTexto(t.run).indexOf(termino) !== -1 ||
               normalizarTexto(t.nombreCompleto).indexOf(termino) !== -1;
      });
      return { transferencias: resultados, actualizado: cache.actualizado };
    },

    /* ---------- Cola de ventas pendientes ---------- */
    encolarVenta: encolarVenta,

    obtenerColaVentas: leerCola,

    hayVentasPendientes: function () { return leerCola().length > 0; },

    // Intenta mandar todas las ventas encoladas. Devuelve cuántas se
    // sincronizaron y cuántas quedaron pendientes (por ejemplo, si se corta
    // la señal a mitad de camino).
    sincronizarVentasPendientes: function () {
      var cola = leerCola();
      if (!cola.length) return Promise.resolve({ sincronizadas: 0, pendientes: 0, conflictos: 0 });

      var sincronizadas = 0;
      var conflictos = 0;

      function procesarSiguiente(i) {
        if (i >= cola.length) {
          return Promise.resolve({
            sincronizadas: sincronizadas,
            pendientes: leerCola().length,
            conflictos: conflictos
          });
        }
        var venta = cola[i];
        var ventaSinIdLocal = Object.assign({}, venta);
        delete ventaSinIdLocal.idLocal;

        // ventaSinIdLocal ya trae .alumno (se guardó junto con la venta al
        // encolarla), así que se revalida con las credenciales de quien la
        // hizo en su momento, no con la sesión actual.
        return llamarBackend('registrarVenta', ventaSinIdLocal)
          .then(function (respuesta) {
            quitarDeCola(venta.idLocal);
            sincronizadas++;
            if (respuesta.transferenciaYaEstabaUsada) conflictos++;
            return procesarSiguiente(i + 1);
          })
          .catch(function (err) {
            if (err.esErrorDeRed) {
              // Seguimos sin señal: se corta acá, lo que falta queda para la próxima.
              return { sincronizadas: sincronizadas, pendientes: leerCola().length, conflictos: conflictos };
            }
            // Error real (no de red): dejamos esa venta en la cola para
            // revisarla a mano, pero seguimos con las demás.
            console.warn('No se pudo sincronizar una venta pendiente:', err);
            return procesarSiguiente(i + 1);
          });
      }

      return procesarSiguiente(0);
    }
  };
})();
