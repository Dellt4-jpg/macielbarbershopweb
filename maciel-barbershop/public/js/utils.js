// Utilidades compartidas por el sitio público y el panel.

export const STATUS = {
  pendiente_pago: 'Pendiente de pago',
  pendiente_confirmacion: 'Pendiente de confirmación',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  finalizada: 'Finalizada',
  entregada: 'Entregado',
};

export const DEFAULT_MSG_RESERVATION =
`Hola! Quiero confirmar mi reserva en Maciel Barbershop.

Nombre: {nombre}
Servicio: {servicio}
Día: {dia}
Horario: {hora}
Seña: \${sena}

Adjunto el comprobante de transferencia para confirmar mi turno.`;

export const DEFAULT_MSG_ORDER =
`Hola! Quiero realizar una compra en Maciel Barbershop.

Nombre: {nombre}
Producto: {producto}
Cantidad: {cantidad}
Total: \${total}

Adjunto el comprobante de transferencia.`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
/** "12.500" (sin símbolo) */
export const num = (n) => nf.format(Number(n) || 0);
/** "$ 12.500" */
export const money = (n) => `$${num(n)}`;

/** Reemplaza {variables} en una plantilla de mensaje. */
export const fill = (tpl, vars) =>
  String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** URL de WhatsApp con mensaje prellenado. Devuelve '' si no hay número. */
export function waUrl(number, text = '') {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Fecha local -> 'YYYY-MM-DD' (sin pasar por UTC). */
export const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const dayLong = (k) =>
  cap(new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseKey(k)));
export const dayShort = (k) =>
  new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseKey(k));
export const hhmm = (t) => String(t || '').slice(0, 5);

export const validName = (s) => {
  const v = String(s).trim().replace(/\s+/g, ' ');
  return v.length >= 3 && v.length <= 80 && v.includes(' ');
};
export const validPhone = (s) => {
  const v = String(s).trim();
  const d = v.replace(/\D/g, '');
  return /^[0-9+()\s-]+$/.test(v) && d.length >= 8 && d.length <= 15;
};

export function toast(msg, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('No se pudo copiar');
  }
}

/** Mensaje de error entendible a partir de un error de Supabase/red. */
export function friendlyError(err) {
  const m = String(err?.message || err || '');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión. Revisá tu internet e intentá de nuevo.';
  if (/row-level security|permission denied/i.test(m)) return 'No tenés permisos para realizar esta acción.';
  if (/JWT|expired/i.test(m)) return 'Tu sesión venció. Volvé a iniciar sesión.';
  return m || 'Ocurrió un error inesperado. Intentá de nuevo.';
}
