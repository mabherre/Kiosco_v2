/**
 * CONFIGURACIÓN
 * -------------
 * Pegá acá la URL de tu Web App de Google Apps Script luego de desplegarla.
 * Ver README.md paso 3.
 *
 * Ejemplo:
 * URL_APPS_SCRIPT: 'https://script.google.com/macros/s/AKfycb.../exec'
 */
var CONFIG = {
  URL_APPS_SCRIPT: 'https://script.google.com/macros/s/AKfycbyHDZ9Cf9VmboDLkMDOIy3a9k9dRn-X__VlUSuB5ry4uqY4hC413dMUKnzqB7Gp1UoTcA/exec',
  NOMBRE_KIOSCO: 'Kiosco a luka',
  MONEDA: '$',
  // Clave para entrar como Administrador. Es la misma para todos los
  // administradores. Cambiala por la que quieras usar.
  CLAVE_ADMIN: 'kiosco2026',
  // Clave para entrar como Vendedor. Es la misma para todos los vendedores
  // (distinta a la de administrador). Cambiala por la que quieras usar.
  CLAVE_VENDEDOR: 'ventas2026',
  // Token que viaja en cada pedido al backend para que Apps Script sepa que
  // viene de esta app. Tiene que ser IDÉNTICO al TOKEN_APP de Codigo.gs —
  // si cambiás uno, cambiá el otro.
  TOKEN_APP: 'kioscoAppSecreto2026'
};
