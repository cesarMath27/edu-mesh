// =============================================================================
//  SERIALIZACIÓN JSON DETERMINISTA  (para firmar/verificar de forma estable)
// -----------------------------------------------------------------------------
//  Una firma se calcula sobre BYTES. Si dos procesos serializan el mismo objeto
//  con las claves en distinto orden, los bytes difieren y la firma "no coincide".
//  `stableStringify` ordena las claves recursivamente -> serialización canónica.
// =============================================================================

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}
