// =============================================================================
//  GESTIÓN DE AUTORIDADES CURADORAS  (trust store multi-llave + rotación)
// -----------------------------------------------------------------------------
//  Uso:
//    npm run keys                              -> crea la 1ª autoridad si no hay
//    npm run keys -- --add --label="UNAM"      -> agrega otra autoridad
//    npm run keys -- --list                     -> lista autoridades y estado
//    npm run keys -- --revoke=<keyId>           -> revoca (rotación de llaves)
//
//  La PÚBLICA de cada autoridad queda en keys/trust-store.json (se distribuye).
//  La PRIVADA queda en keys/private/<keyId>.private.pem (NUNCA se comparte).
// =============================================================================

import { addAuthority, listAuthorities, revokeAuthority, pickSigningKeyId } from '../src/crypto/keystore.js';

const has = (flag) => process.argv.includes(flag);
const val = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (has('--list')) {
  const list = listAuthorities();
  if (list.length === 0) console.log('No hay autoridades. Corre: npm run keys');
  for (const a of list) {
    console.log(`${a.revoked ? '⛔' : '✅'} ${a.keyId}  ${a.label}` +
      `${a.revoked ? '  (REVOCADA)' : ''}${a.hasPrivate ? '  [tiene privada]' : ''}`);
  }
  process.exit(0);
}

const revoke = val('revoke');
if (revoke) {
  revokeAuthority(revoke);
  console.log(`⛔ Autoridad ${revoke} REVOCADA. Sus firmas dejan de ser válidas.`);
  process.exit(0);
}

const label = val('label') || 'Autoridad Curadora';

// Sin --add: solo crea la primera autoridad si aún no existe ninguna firmante.
if (!has('--add') && pickSigningKeyId()) {
  console.log('🔑 Ya existe al menos una autoridad. Usa "--add" para agregar otra o "--list" para verlas.');
  process.exit(0);
}

const { keyId, label: lbl } = addAuthority(label);
console.log(`🔑 Autoridad creada: ${lbl}`);
console.log(`   keyId: ${keyId}`);
console.log('   Pública añadida a keys/trust-store.json · Privada en keys/private/');
