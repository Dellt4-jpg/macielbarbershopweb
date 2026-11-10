// Genera public/js/config.js a partir de variables de entorno (GitHub Actions).
// Si no están definidas, deja el archivo existente (para configurarlo a mano).
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const target = path.join(__dirname, '..', 'public', 'js', 'config.js');

if (!url || !key) {
  console.warn('[build-config] SUPABASE_URL / SUPABASE_ANON_KEY no definidas: se mantiene js/config.js tal cual.');
  process.exit(0);
}
if (/service_role/i.test(key)) {
  console.error('[build-config] ¡Esa parece la service_role key! Usá solo la anon key.');
  process.exit(1);
}

const out = `// Archivo generado en el build. No editar.
export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(key)};
`;
fs.writeFileSync(target, out);
console.log('[build-config] js/config.js generado.');
