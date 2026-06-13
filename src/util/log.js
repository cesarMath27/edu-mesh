// =============================================================================
//  LOGGER MÍNIMO CON COLOR (sin dependencias)
// -----------------------------------------------------------------------------
//  Sirve para distinguir de un vistazo la salida de cada nodo en la terminal
//  durante la simulación (semilla en verde, alumno en cian, etc.).
// =============================================================================

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

/**
 * Crea una función de log etiquetada y coloreada.
 * @param {string} tag   Etiqueta visible, p.ej. "SEMILLA:Ana".
 * @param {string} color Nombre del color (clave de COLORS).
 */
export function makeLogger(tag, color = 'cyan') {
  const c = COLORS[color] ?? COLORS.cyan;
  return (msg) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`${COLORS.dim}${ts}${COLORS.reset} ${c}[${tag}]${COLORS.reset} ${msg}`);
  };
}
