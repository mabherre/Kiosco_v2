# App de Ventas para Kiosco

App web (funciona en el navegador Chrome de un celular o tablet Android) para:

- Ingresar con dos perfiles: **Vendedor** (solo nombre) y **Administrador** (clave compartida + nombre, para saber quién hizo cada cambio).
- **Administrador:** CRUD completo de productos con foto, y un resumen con la cantidad y el monto total de transferencias sin usar.
- **Vendedor:** registrar ventas seleccionando productos y cantidades (con subtotales y total automáticos), marcando si la venta es en **efectivo** o por **transferencia**, y buscar transferencias recibidas por RUN o nombre para aplicarlas a una venta. También tiene una pestaña de **Auditoría** con el total vendido en el día (efectivo y transferencia) y el detalle por producto, ambos limitados a sus propias ventas del día.
- Guardar todo en una Google Sheet compartida (productos, ventas y detalle de cada venta).
- Imprimir un comprobante por una impresora térmica Bluetooth (ESC/POS, 58mm) al cerrar cada venta.

### Perfiles y claves

Tanto Administrador como Vendedor piden una clave compartida (la misma para todas las personas de ese perfil) además del nombre. Se definen en `js/config.js`: `CLAVE_ADMIN` (por defecto `kiosco2026`) y `CLAVE_VENDEDOR` (por defecto `ventas2026`). Cambialas por las que quieras usar.

Además del filtro visual, el backend (`Codigo.gs`) valida esas mismas claves: `CLAVE_ADMIN` antes de agregar, editar o borrar productos; `CLAVE_VENDEDOR` antes de registrar una venta o buscar transferencias. También exige un `TOKEN_APP` en cada pedido para que no cualquiera que encuentre la URL de Apps Script pueda usarla directo sin pasar por la app. **Importante:** `CLAVE_ADMIN`, `CLAVE_VENDEDOR` y `TOKEN_APP` tienen que ser idénticos en `js/config.js` y en `Codigo.gs` — si cambiás uno, cambiá el otro y volvé a desplegar una nueva versión en Apps Script.

Dicho esto, como es una app 100% del lado del cliente (sin usuarios reales con contraseña propia), estos valores quedan visibles para cualquiera que revise el código fuente de la página o el repositorio de GitHub. Es una barrera razonable contra un uso casual o accidental, no una seguridad real de nivel empresarial — no seria buena idea usar esta app para datos más sensibles que los que ya maneja (productos, ventas, y el RUN/nombre de las transferencias).

### Transferencias

El vendedor busca transferencias en una hoja de cálculo externa (compartida por Mabel), sólo entre las filas cuya columna **Estado Pago** está vacía. Al elegir una, queda visible el monto del abono en la pantalla de venta; al registrar la venta, esa fila se marca automáticamente como **Usado** en la columna Estado Pago (no se borra ni se mueve, solo se marca). El administrador ve, en la pestaña Resumen, cuántas transferencias quedan sin usar y la suma de sus montos.

Para que esto funcione, la cuenta de Google que despliega el Apps Script (la misma que uso para "Ejecutar como: Yo") necesita tener acceso de edición a esa hoja externa de transferencias.

### Tipo de venta, IDs e Auditoría

- **IDs:** Productos, Ventas y DetalleVentas usan números enteros correlativos (1, 2, 3...) en vez de códigos largos. Cada ID nuevo es el número más alto que ya existe en esa columna más 1, así que podés reordenar o completar filas a mano en la hoja sin que se rompa nada.
- **Tipo de venta:** en la pestaña Vender hay dos botones, **💵 Efectivo** y **💳 Transferencia**. Por defecto queda en Efectivo; si el vendedor aplica una transferencia con el botón "Usar" (desde la pestaña Transferencias), cambia solo a Transferencia. Esto se guarda en la columna `Tipo_venta` de la hoja Ventas.
- **Auditoría (vendedor):** muestra, solo para el vendedor que tiene la sesión abierta, cuánto vendió hoy en efectivo, cuánto por transferencia, y el detalle de cantidades por producto vendidas hoy. Se actualiza con el botón "🔄 Actualizar" o al abrir la pestaña.

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

1. Al abrir la app, ingresá tu nombre → **Entrar**. Se guarda mientras la app siga abierta (si la cerrás y la volvés a abrir, vuelve a pedir el nombre; así cada turno queda identificado).
2. Pestaña **Productos**: tocá **+ Nuevo producto**, cargá nombre, precio y sacá/elegí una foto. **Guardar**. Se sube a la Google Sheet automáticamente.
3. Pestaña **Vender**: tocá **+** sobre cada producto para agregarlo al carrito con la cantidad deseada. El total se calcula solo.
4. Antes de imprimir por primera vez: tocá **🖨️ Impresora** (arriba), encendé/emparejá tu impresora térmica Bluetooth y seleccionala en la lista que aparece. Chrome recuerda la conexión para las próximas ventas (puede pedir reconectar si la impresora se apaga).
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
