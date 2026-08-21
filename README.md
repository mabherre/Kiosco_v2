# App de Ventas para Kiosco

App web (funciona en el navegador Chrome de un celular o tablet Android) para:

- Ingresar con dos perfiles: **Vendedor** (elige su curso y su nombre de una lista, y confirma con su apellido materno) y **Administrador** (clave compartida + nombre, para saber quién hizo cada cambio).
- **Administrador:** CRUD completo de productos con foto, un resumen con la cantidad y el monto total de transferencias sin usar, y una pestaña de **Recaudación** con el total recaudado por cada vendedor y día, separando efectivo de transferencia.
- **Vendedor:** registrar ventas seleccionando productos y cantidades (con subtotales y total automáticos), marcando si la venta es en **efectivo** o por **transferencia**, y buscar transferencias recibidas por RUN o nombre para aplicarlas a una venta. También tiene una pestaña de **Auditoría** con el total vendido en el día (efectivo y transferencia) y el detalle por producto, ambos limitados a sus propias ventas del día, y una pestaña de **Ventas del día** con todas las ventas del día en curso (de cualquier vendedor), de la más reciente a la más antigua, con el detalle de productos de cada una.
- Guardar todo en una Google Sheet compartida (productos, ventas y detalle de cada venta).
- Imprimir un comprobante por una impresora térmica Bluetooth (ESC/POS, 58mm) al cerrar cada venta.

### Perfiles y claves

**Administrador:** pide una clave compartida (la misma para todos los administradores) además del nombre. Se define en `js/config.js` como `CLAVE_ADMIN` (por defecto `kiosco2026`). Cambiala por la que quieras usar.

**Vendedor:** ya no tiene una clave compartida. En su lugar, elige su **curso** y después su **nombre** en dos listas desplegables, y confirma con su **Apellido Materno** a modo de contraseña individual. Esos datos salen de la pestaña **Alumno** de la Google Sheet (ver sección "Hoja Alumno" más abajo).

Además del filtro visual, el backend (`Codigo.gs`) valida todo del lado del servidor: `CLAVE_ADMIN` antes de agregar, editar o borrar productos; y el Apellido Materno del alumno elegido (comparado contra la hoja Alumno) antes de registrar una venta, buscar transferencias, o ver auditoría/ventas del día/recaudación. También exige un `TOKEN_APP` en cada pedido para que no cualquiera que encuentre la URL de Apps Script pueda usarla directo sin pasar por la app. **Importante:** `CLAVE_ADMIN` y `TOKEN_APP` tienen que ser idénticos en `js/config.js` y en `Codigo.gs` — si cambiás uno, cambiá el otro y volvé a desplegar una nueva versión en Apps Script.

Dicho esto, como es una app 100% del lado del cliente (sin usuarios reales con contraseña propia en el sentido estricto), estos valores quedan visibles para cualquiera que revise el código fuente de la página o el repositorio de GitHub. Es una barrera razonable contra un uso casual o accidental, no una seguridad real de nivel empresarial — no sería buena idea usar esta app para datos más sensibles que los que ya maneja (productos, ventas, apellidos de alumnos, y el RUN/nombre de las transferencias).

### Hoja Alumno (login de Vendedor)

La pestaña **Alumno** de la Google Sheet la carga y mantiene quien administra el kiosco (no la genera la app). Tiene que tener estas columnas (en cualquier orden — el backend las busca por nombre, no por posición):

| Curso | Nombre | Apellido Paterno | Apellido Materno |
|---|---|---|---|

- **Apellido Materno** es la "contraseña" que cada alumno escribe para entrar como Vendedor. No se muestra nunca en la lista de nombres del login (esa lista sólo trae curso, nombre y apellido paterno).
- Si preferís otros encabezados (por ejemplo "Segundo Apellido" en vez de "Apellido Materno"), también los reconoce: revisá la función `indiceColumnaVarios_` en `Codigo.gs` si necesitás agregar otra variante.
- Si la pestaña Alumno no existe todavía, el backend la crea vacía con estos encabezados la primera vez que alguien intenta ver la lista de cursos — pero hay que completarla a mano con los datos reales para que alguien pueda entrar.
- El nombre que queda registrado en cada venta (columna Usuario de la hoja Ventas) es "Nombre ApellidoPaterno (Curso)", generado por el backend a partir de esta hoja.

### Transferencias

El vendedor busca transferencias en una hoja de cálculo externa (compartida por Mabel), sólo entre las filas cuya columna **Estado Pago** está vacía. Al elegir una, queda visible el monto del abono en la pantalla de venta; al registrar la venta, esa fila se marca automáticamente como **Usado** en la columna Estado Pago (no se borra ni se mueve, solo se marca). El administrador ve, en la pestaña Resumen, cuántas transferencias quedan sin usar y la suma de sus montos.

Para que esto funcione, la cuenta de Google que despliega el Apps Script (la misma que uso para "Ejecutar como: Yo") necesita tener acceso de edición a esa hoja externa de transferencias.

### Tipo de venta, IDs e Auditoría

- **IDs:** Productos, Ventas y DetalleVentas usan números enteros correlativos (1, 2, 3...) en vez de códigos largos. Cada ID nuevo es el número más alto que ya existe en esa columna más 1, así que podés reordenar o completar filas a mano en la hoja sin que se rompa nada.
- **Tipo de venta:** en la pestaña Vender hay dos botones, **💵 Efectivo** y **💳 Transferencia**. Por defecto queda en Efectivo; si el vendedor aplica una transferencia con el botón "Usar" (desde la pestaña Transferencias), cambia solo a Transferencia. Esto se guarda en la columna `Tipo_venta` de la hoja Ventas.
- **N° de boleta (control físico):** cada venta recibe además un número correlativo propio de cada vendedor, que **reinicia en 1 todos los días** (como un talonario físico). Se guarda en la columna `N° Boleta` de la hoja Ventas (se crea sola, no hace falta agregarla a mano) y se imprime en el ticket, para poder cruzarlo con un control en papel si hace falta. El número real y definitivo siempre lo calcula el servidor. Si la venta se registra sin señal, la app usa un número "provisorio" calculado en el mismo celular (marcado como "(provisoria)" en el ticket) para no dejar la boleta sin numerar; en el enorme mayoría de los casos ese número termina coincidiendo con el definitivo. Al iniciar sesión como vendedor, si hay señal en ese momento, la app se pone al día con el servidor para que el número provisorio arranque bien encaminado. Nota: si el mismo vendedor llega a usar dos celulares distintos el mismo día, los números provisorios de cada uno pueden no coincidir entre sí — para el control oficial, siempre vale el número que quedó escrito en la hoja Ventas, no el impreso.
- **Sin duplicados aunque falle la conexión:** cada venta lleva además un identificador único generado en el celular (columna `IDCliente`, también se crea sola). Si el pedido llega a registrarse en el servidor pero la respuesta se pierde por corte de señal, la app puede reintentar el envío sin miedo: el servidor reconoce que ya la había recibido y no la registra dos veces.
- **Auditoría (vendedor):** muestra, solo para el vendedor que tiene la sesión abierta, cuánto vendió hoy en efectivo, cuánto por transferencia, y el detalle de cantidades por producto vendidas hoy. Se actualiza con el botón "🔄 Actualizar" o al abrir la pestaña.
- **Ventas del día (vendedor):** lista las ventas del día en curso hechas por el vendedor que tiene la sesión abierta (no las de los demás), ordenadas de la más reciente a la más antigua. Cada tarjeta muestra hora, N° de boleta, tipo de venta, total y el detalle de productos vendidos en esa venta, además de un botón **"🖨️ Reimprimir boleta"** para volver a imprimir (o compartir) ese comprobante puntual. Se actualiza con el botón "🔄 Actualizar" o al abrir la pestaña (no funciona sin conexión).
- **Recaudación (administrador):** tabla con todo el historial de ventas agrupado por vendedor y día, mostrando el total en efectivo, el total por transferencia y el total general de cada combinación, más una fila con los totales generales. Se actualiza con el botón "🔄 Actualizar" o al abrir la pestaña (no funciona sin conexión).

### Funcionamiento con poca o ninguna señal

Pensado para el lugar donde funciona el kiosco, que puede tener señal débil:

- **Ventas:** si al tocar "Registrar venta" no hay conexión (o tarda demasiado), la venta queda guardada en el celular como pendiente — igual se puede imprimir el ticket en el momento, porque eso no depende de internet. Apenas vuelve la señal, la app manda solas todas las ventas pendientes a la Google Sheet (también se puede forzar con el botón "🔄 Sincronizar" que aparece en la barra de arriba cuando hay pendientes).
- **Productos:** quedan guardados en el celular después de la primera carga, así que la pantalla de Vender sigue funcionando sin señal.
- **Transferencias:** la app guarda una copia de las transferencias sin usar cada vez que hay señal (al entrar como vendedor y al abrir la pestaña Transferencias). Si después se busca sin conexión, usa esa copia guardada y avisa con un cartel amarillo que los datos pueden estar desactualizados.

**Límite importante a tener en cuenta:** si dos vendedores usan la misma transferencia estando ambos sin señal al mismo tiempo (algo poco probable, pero posible), las dos ventas se van a sincronizar igual cuando vuelva la conexión, y la segunda va a mostrar un aviso de "transferencia ya usada por otra venta" para que un administrador lo revise a mano — no hay forma de evitar esto del todo sin conexión en tiempo real entre dispositivos.

Construida sólo con herramientas gratuitas: HTML/CSS/JavaScript plano + Google Sheets + Google Apps Script + Web Bluetooth API. No requiere servidores pagos, ni tiendas de aplicaciones, ni licencias.

**Importante:** la impresión Bluetooth desde el navegador sólo funciona en **Chrome para Android**. En iPhone/iPad no es posible por una limitación de Apple (Safari no soporta Web Bluetooth).

---

## 1. Crear la Google Sheet y el backend (Apps Script)

1. Entrá a [sheets.google.com](https://sheets.google.com) con tu cuenta de Google y creá una hoja de cálculo nueva. Llamala, por ejemplo, "Kiosco - Base de datos".
2. Menú **Extensiones → Apps Script**. Se abre el editor de scripts.
3. Borrá el contenido de `Code.gs` que aparece por defecto y pegá todo el contenido del archivo **`apps-script/Codigo.gs`** que te entregué.
4. Guardá el proyecto (ícono de disquete, o `Ctrl+S`). Podés ponerle nombre, ej. "Backend Kiosco".
5. Andá a **Implementar (Deploy) → Nueva implementación**.
   - Tipo: **Aplicación web**.
   - Descripción: la que quieras.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier usuario** (esto es necesario para que la app pueda llamar al script; los datos siguen viviendo únicamente en tu Google Sheet).
6. Hacé clic en **Implementar**. Google te va a pedir autorizar permisos (acceso a tu hoja y a Drive, para guardar las fotos). Aceptá.
7. Copiá la **URL de la aplicación web** que te da (termina en `/exec`).

> Cada vez que modifiques `Codigo.gs`, tenés que volver a **Implementar → Administrar implementaciones → editar (lápiz) → Nueva versión → Implementar** para que los cambios se apliquen.

Las pestañas `Productos`, `Ventas` y `DetalleVentas` se crean solas en la hoja la primera vez que la app los necesita, ya con la columna `Tipo_venta` incluida en `Ventas`. Si ya tenías estas pestañas de antes, agregá manualmente la columna `Tipo_venta` en `Ventas` (el nombre del encabezado puede ir en cualquier posición: el backend lo busca por nombre, no por posición fija).

La pestaña `Alumno` (curso, nombre y apellidos de cada alumno, para el login de Vendedor) **hay que cargarla a mano** con los datos reales — ver la sección "Hoja Alumno" más abajo.

---

## 2. Configurar la app con tu URL

1. Abrí el archivo **`js/config.js`**.
2. Reemplazá `PEGA_AQUI_TU_URL_DE_APPS_SCRIPT` por la URL que copiaste en el paso anterior. Por ejemplo:

```js
var CONFIG = {
  URL_APPS_SCRIPT: 'https://script.google.com/macros/s/AKfycb.../exec',
  NOMBRE_KIOSCO: 'Kiosco Don José',
  MONEDA: '$'
};
```

3. Podés cambiar también `NOMBRE_KIOSCO` (aparece impreso en el comprobante) y el símbolo de `MONEDA`.

---

## 3. Publicar la app en GitHub Pages (gratis, con URL fija)

1. Creá una cuenta gratuita en [github.com](https://github.com) (si no tenés una).
2. Creá un repositorio nuevo (botón **New**): nombre por ejemplo `kiosco-ventas`, marcalo como **Public**, sin agregar README (para no pisar el tuyo). Creá el repositorio.
3. Entrá al repositorio recién creado y subí los archivos: botón **Add file → Upload files**. Arrastrá **todo el contenido** de la carpeta de la app (no la carpeta en sí, sino lo que está adentro: `index.html`, `css/`, `js/`, `apps-script/`, `manifest.json`, `sw.js`, los íconos y `README.md`), respetando las subcarpetas. Confirmá con **Commit changes**.
4. Andá a **Settings → Pages** (menú izquierdo del repositorio).
5. En "Build and deployment", en **Source** elegí **Deploy from a branch**. En **Branch** elegí `main` y la carpeta `/ (root)`. Guardá.
6. Esperá uno o dos minutos y GitHub te va a mostrar una URL fija, algo como:
   `https://tu-usuario.github.io/kiosco-ventas/`
7. Abrí esa URL en Chrome desde el celular/tablet Android. Ahí queda la app, accesible siempre desde esa misma dirección (podés guardarla como marcador o "Agregar a pantalla de inicio" para que quede como ícono).

Cada vez que quieras actualizar algo (por ejemplo la URL de Apps Script en `js/config.js`), subís el archivo modificado de nuevo con **Add file → Upload files** (GitHub te va a preguntar si querés reemplazarlo) y esperás un minuto a que se actualice la página publicada.

---

## 4. Primer uso

1. Al abrir la app como Vendedor: elegí tu curso, después tu nombre, ingresá tu Apellido Materno → **Entrar**. La sesión se guarda mientras la app siga abierta (si la cerrás y la volvés a abrir, se mantiene; para cambiar de persona usá el botón "Salir").
2. Pestaña **Productos**: tocá **+ Nuevo producto**, cargá nombre, precio y sacá/elegí una foto. **Guardar**. Se sube a la Google Sheet automáticamente.
3. Pestaña **Vender**: tocá **+** sobre cada producto para agregarlo al carrito con la cantidad deseada. El total se calcula solo.
4. Antes de imprimir por primera vez: tocá **🖨️ Impresora** (arriba), encendé/emparejá tu impresora térmica Bluetooth y seleccionala en la lista que aparece. Mientras no esté conectada (por ejemplo, recién entraste a la app o la impresora se apagó), el botón muestra un aviso ⚠️; desaparece apenas se conecta. Esto es sólo un indicador — no impide vender ni imprimir por la alternativa de "Compartir" (ver más abajo).
   - **Pantalla y Bluetooth:** mientras la impresora está conectada, la app evita que la pantalla se apague sola por inactividad (así no se corta la conexión Bluetooth, que es lo que suele pasar en Android cuando la pantalla se bloquea). Si igual se corta —por ejemplo, si se aprieta el botón físico de encender/apagar— la app intenta reconectarse sola apenas se vuelve a prender la pantalla; si no lo logra después de varios intentos, avisa para reconectar a mano con el botón "🖨️ Impresora".
5. Tocá **Registrar venta e imprimir**: la venta queda guardada en la Google Sheet y se imprime el comprobante con fecha, vendedor, productos, cantidades, subtotales y total.

---

## 5. Estructura de archivos entregados

```
index.html            → pantallas de la app
css/style.css          → estilos (mobile-first)
js/config.js           → tu URL de Apps Script y datos del kiosco
js/db.js               → comunicación con Google Sheets (vía Apps Script)
js/printer.js          → impresión Bluetooth ESC/POS
js/app.js              → lógica de pantallas, carrito, CRUD
manifest.json, sw.js    → permiten "Agregar a pantalla de inicio" como acceso directo
icon-192.png, icon-512.png → íconos de la app
apps-script/Codigo.gs  → backend a pegar en Apps Script (Google Sheets)
```

## 6. Preguntas frecuentes

**¿Puedo usarla desde varios celulares a la vez?** Sí, todos escriben a la misma Google Sheet. Cada uno debe emparejar su propia impresora Bluetooth si la tiene cerca.

**¿Dónde veo el historial de ventas?** Directamente en la Google Sheet, pestañas `Ventas` y `DetalleVentas`.

**¿Qué pasa si elimino un producto?** Se da de baja (deja de aparecer para vender) pero no se borra de la hoja, así el historial de ventas pasadas no se rompe.

**¿Por qué el texto impreso no tiene tildes/ñ?** La mayoría de las impresoras térmicas Bluetooth baratas no soportan bien acentos; el sistema los reemplaza automáticamente por letras simples para que no salgan símbolos raros.

**Mi impresora no aparece al conectar, o es una mini impresora tipo "Fun Print".** Muchas impresoras de bolsillo baratas (las que se manejan con apps como Fun Print, Cat Printer, Peripage, Phomemo, etc.) usan un protocolo Bluetooth propietario que sólo su propia app sabe hablar — Web Bluetooth no puede conectarse directo a ellas.

Para esos casos, la app tiene un plan B automático: si no hay ninguna impresora BLE genérica conectada, al registrar la venta arma el comprobante como una imagen y abre el menú "Compartir" de Android para que elijas la app de tu impresora (por ejemplo Fun Print) y termines de imprimir ahí con un toque más. No es 100% automático en ese caso, pero sigue siendo gratuito y funciona con este tipo de impresoras.
