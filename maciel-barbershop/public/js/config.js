// Configuración pública de Supabase.
// La "anon key" es PÚBLICA por diseño: la seguridad real la dan las políticas RLS.
// NUNCA pongas acá la "service_role key".
//
// Dos formas de completarla:
//  1) En GitHub: Settings > Secrets > Actions: SUPABASE_URL y SUPABASE_ANON_KEY (el workflow genera este archivo).
//  2) A mano: reemplazá los valores de abajo.
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
