// Panel administrativo de Maciel Barbershop.
// La autenticación la resuelve Supabase Auth; los permisos, las políticas RLS
// (tabla `administrators`). Ningún secreto vive en este archivo.
import { sb, configured } from '../js/supabase.js';
import {
  esc, money, toast, dateKey, dayLong, hhmm, friendlyError, STATUS,
  DEFAULT_MSG_RESERVATION, DEFAULT_MSG_ORDER,
} from '../js/utils.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const WEEK = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const TABS = [
  ['dashboard', 'Resumen'], ['reservas', 'Reservas'], ['pedidos', 'Pedidos'], ['horarios', 'Horarios'],
  ['servicios', 'Servicios'], ['productos', 'Productos'], ['config', 'Configuración'],
];
let currentUser = null;

/* ------------------------------------------------------------ Utilidades */
const loading = () => '<div class="center-pad"><span class="spinner"></span></div>';

function fail(el, err) {
  console.error(err);
  el.innerHTML = `<div class="empty"><strong>Ocurrió un error</strong>${esc(friendlyError(err))}</div>`;
}

/** UPDATE que detecta cuando RLS bloquea silenciosamente la operación. */
async function mustUpdate(table, id, patch, idCol = 'id') {
  const { data, error } = await sb.from(table).update(patch).eq(idCol, id).select();
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo guardar. Verificá que tu usuario sea administrador.');
  return data[0];
}

async function uploadImage(file, folder) {
  const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
  if (!okTypes.includes(file.type)) throw new Error('Formato no permitido. Usá JPG, PNG, WebP o SVG.');
  if (file.size > 3 * 1024 * 1024) throw new Error('La imagen supera los 3 MB.');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[file.type];
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('public-images').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
  if (error) throw error;
  return sb.storage.from('public-images').getPublicUrl(path).data.publicUrl;
}

/* --------------------------------------------------------- Formularios */
function fieldHtml(f, v) {
  if (f.section) return `<h3 class="section-title field--wide">${esc(f.section)}</h3>`;
  const id = `f-${f.name}`;
  const wide = f.wide || ['textarea', 'image'].includes(f.type) ? ' field--wide' : '';
  const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '';
  const val = v ?? f.default ?? '';
  const req = f.required ? 'required' : '';
  if (f.type === 'checkbox') {
    return `<div class="field${wide}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
  }
  let ctl;
  if (f.type === 'textarea') ctl = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" ${req}>${esc(val)}</textarea>`;
  else if (f.type === 'select') ctl = `<select id="${id}" name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'image') ctl = `${val ? `<img class="preview-img" src="${esc(val)}" alt="">` : ''}<input type="file" id="${id}" name="${f.name}" accept="image/jpeg,image/png,image/webp,image/svg+xml">`;
  else ctl = `<input type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${esc(val)}" ${req}
      ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}
      ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}>`;
  return `<div class="field${wide}"><label for="${id}">${esc(f.label)}</label>${ctl}${hint}</div>`;
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.section) continue;
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'image') out[f.name] = el.files[0] || null;
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value.trim();
  }
  return out;
}

/** Diálogo con formulario. onSubmit(valores) puede lanzar error: el diálogo queda abierto. */
function formDialog({ title, fields, values = {}, submitLabel = 'Guardar', onSubmit }) {
  const dlg = $('#modal');
  dlg.innerHTML = `<div class="dialog__body">
    <div class="dialog__head"><h3>${esc(title)}</h3><button class="dialog__close" type="button" data-x aria-label="Cerrar">×</button></div>
    <form class="form-grid" id="dlg-form">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}
      <div class="field--wide item__actions"><button class="btn btn--primary" type="submit">${esc(submitLabel)}</button><button class="btn btn--ghost" type="button" data-x>Cancelar</button></div>
    </form></div>`;
  dlg.showModal();
  dlg.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  $('#dlg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await onSubmit(readForm(e.target, fields));
      dlg.close();
    } catch (err) {
      toast(friendlyError(err), 'error');
      btn.disabled = false;
    }
  });
}

/* --------------------------------------------------------------- Sesión */
function renderLogin(message = '') {
  app.innerHTML = `<div class="login"><form class="login__card" id="login-form">
    <img src="/assets/logo.svg" alt="MB">
    <h1>Panel privado</h1>
    <div class="error-box" role="alert">${esc(message)}</div>
    <div class="field"><label for="l-email">Correo</label><input id="l-email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="l-pass">Contraseña</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
    <button class="btn btn--primary btn--block" type="submit">Ingresar</button>
  </form></div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const box = $('.error-box');
    btn.disabled = true; box.textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
    if (error) {
      btn.disabled = false;
      box.textContent = /Invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.' : friendlyError(error);
      return;
    }
    await enter(data.user);
  });
}

async function isAdmin(userId) {
  const { data, error } = await sb.from('administrators').select('user_id').eq('user_id', userId).maybeSingle();
  return !error && !!data;
}

async function enter(user) {
  if (!(await isAdmin(user.id))) {
    await sb.auth.signOut();
    return renderLogin('Esta cuenta no tiene permisos de administrador.');
  }
  currentUser = user;
  renderShell();
  route();
}

function renderShell() {
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="topbar__brand"><img src="/assets/logo.svg" alt="">Panel</div>
      <div class="item__actions"><a class="btn btn--ghost btn--sm" href="/" target="_blank" rel="noopener">Ver sitio</a><button class="btn btn--ghost btn--sm" id="logout">Salir</button></div>
    </header>
    <div><nav class="tabs" id="tabs">${TABS.map(([k, l]) => `<a href="#/${k}" data-tab="${k}">${l}</a>`).join('')}</nav>
    <main class="view" id="view"></main></div></div>`;
  $('#logout').addEventListener('click', async () => { await sb.auth.signOut(); renderLogin(); });
}

/* ---------------------------------------------------------------- Router */
const VIEWS = { dashboard: viewDashboard, reservas: viewReservations, pedidos: viewOrders, horarios: viewHours, servicios: viewServices, productos: viewProducts, config: viewSettings };

function route() {
  if (!currentUser) return;
  const key = (location.hash.replace(/^#\//, '') || 'dashboard');
  const name = VIEWS[key] ? key : 'dashboard';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === name));
  const view = $('#view');
  view.onclick = view.onchange = view.onsubmit = null; // evita handlers de la vista anterior
  view.innerHTML = loading();
  VIEWS[name](view).catch((err) => fail(view, err));
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------- Dashboard */
function resCard(r, actions = true) {
  const pending = ['pendiente_pago', 'pendiente_confirmacion'].includes(r.status);
  const btns = !actions ? '' : `<div class="item__actions">
    ${pending ? `<button class="btn btn--ok btn--sm" data-act="res" data-id="${r.id}" data-status="confirmada">Confirmar pago</button>` : ''}
    ${r.status === 'confirmada' ? `<button class="btn btn--primary btn--sm" data-act="res" data-id="${r.id}" data-status="finalizada">Finalizar</button>` : ''}
    ${pending || r.status === 'confirmada' ? `<button class="btn btn--danger btn--sm" data-act="res" data-id="${r.id}" data-status="cancelada">Cancelar</button>` : ''}
  </div>`;
  return `<article class="item"><div class="item__top">
    <div><div class="item__title">${esc(hhmm(r.start_time))} – ${esc(hhmm(r.end_time))} · ${esc(r.service_name)}</div>
    <div class="item__meta"><span>${esc(dayLong(r.day))}</span><span>${esc(r.customer_name)} · <a href="tel:${esc(r.customer_phone.replace(/[^\d+]/g, ''))}">${esc(r.customer_phone)}</a></span>
    <span>Precio ${money(r.price)} · Seña ${money(r.deposit_amount)}</span></div></div>
    <span class="badge badge--${r.status}">${STATUS[r.status]}</span></div>${btns}</article>`;
}

async function viewDashboard(el) {
  const today = dateKey(new Date());
  const pend = ['pendiente_pago', 'pendiente_confirmacion'];
  const head = { count: 'exact', head: true };
  const [todayR, upR, pendC, confC, totalC, ordC, sales] = await Promise.all([
    sb.from('reservations').select('*').eq('day', today).neq('status', 'cancelada').order('start_time'),
    sb.from('reservations').select('*').gt('day', today).in('status', [...pend, 'confirmada']).order('day').order('start_time').limit(8),
    sb.from('reservations').select('id', head).in('status', pend),
    sb.from('reservations').select('id', head).eq('status', 'confirmada').gte('day', today),
    sb.from('reservations').select('id', head),
    sb.from('orders').select('id', head).in('status', pend),
    sb.from('orders').select('total').in('status', ['confirmada', 'entregada']),
  ]);
  for (const r of [todayR, upR, pendC, confC, totalC, ordC, sales]) if (r.error) throw r.error;
  const salesTotal = (sales.data || []).reduce((a, o) => a + Number(o.total), 0);
  const stat = (l, v, alert) => `<div class="stat ${alert && v ? 'stat--alert' : ''}"><small>${l}</small><strong>${v}</strong></div>`;
  el.innerHTML = `<h2>Resumen</h2>
    <div class="stats">
      ${stat('Reservas de hoy', todayR.data.length)}
      ${stat('Reservas pendientes', pendC.count, true)}
      ${stat('Confirmadas (próximas)', confC.count)}
      ${stat('Pedidos pendientes', ordC.count, true)}
      ${stat('Ventas registradas', money(salesTotal))}
      ${stat('Total de reservas', totalC.count)}
    </div>
    <div class="panel"><h3>Hoy</h3><div class="list" data-list>${todayR.data.length ? todayR.data.map((r) => resCard(r)).join('') : '<div class="empty"><strong>Sin reservas hoy</strong>Cuando entren turnos, aparecen acá.</div>'}</div></div>
    <div class="panel"><h3>Próximas reservas</h3><div class="list" data-list>${upR.data.length ? upR.data.map((r) => resCard(r)).join('') : '<div class="empty"><strong>Sin próximas reservas</strong></div>'}</div></div>`;
}

/* --------------------------------------------------------------- Reservas */
async function viewReservations(el) {
  el.innerHTML = `<div class="view__head"><h2>Reservas</h2></div>
    <div class="filters">
      <div class="field"><label for="fr-day">Día</label><input type="date" id="fr-day"></div>
      <div class="field"><label for="fr-st">Estado</label><select id="fr-st"><option value="">Todos</option>${Object.entries(STATUS).filter(([k]) => k !== 'entregada').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    </div><div class="list" id="res-list" data-list>${loading()}</div>`;
  const load = async () => {
    const list = $('#res-list');
    let q = sb.from('reservations').select('*').order('day', { ascending: false }).order('start_time').limit(300);
    if ($('#fr-day').value) q = q.eq('day', $('#fr-day').value);
    if ($('#fr-st').value) q = q.eq('status', $('#fr-st').value);
    const { data, error } = await q;
    if (error) return fail(list, error);
    list.innerHTML = data.length ? data.map((r) => resCard(r)).join('')
      : '<div class="empty"><strong>Sin reservas</strong>No hay reservas con estos filtros.</div>';
  };
  $('#fr-day').addEventListener('change', load);
  $('#fr-st').addEventListener('change', load);
  await load();
}

/* ---------------------------------------------------------------- Pedidos */
function orderCard(o) {
  const pending = ['pendiente_pago', 'pendiente_confirmacion'].includes(o.status);
  const items = (o.order_items || []).map((i) => `${esc(i.product_name)} × ${i.quantity} (${money(i.unit_price)})`).join('<br>');
  return `<article class="item"><div class="item__top"><div>
    <div class="item__title">${esc(o.customer_name)} · ${money(o.total)}</div>
    <div class="item__meta"><span>${new Date(o.created_at).toLocaleString('es-AR')}</span><span><a href="tel:${esc(o.customer_phone.replace(/[^\d+]/g, ''))}">${esc(o.customer_phone)}</a></span><span>${items}</span></div></div>
    <span class="badge badge--${o.status}">${STATUS[o.status]}</span></div>
    <div class="item__actions">
      ${pending ? `<button class="btn btn--ok btn--sm" data-act="ord" data-id="${o.id}" data-status="confirmada">Confirmar pago</button>` : ''}
      ${o.status === 'confirmada' ? `<button class="btn btn--primary btn--sm" data-act="ord" data-id="${o.id}" data-status="entregada">Marcar entregado</button>` : ''}
      ${pending || o.status === 'confirmada' ? `<button class="btn btn--danger btn--sm" data-act="ord" data-id="${o.id}" data-status="cancelada">Cancelar</button>` : ''}
    </div></article>`;
}

async function viewOrders(el) {
  el.innerHTML = `<div class="view__head"><h2>Pedidos</h2></div>
    <div class="filters"><div class="field"><label for="fo-st">Estado</label><select id="fo-st"><option value="">Todos</option>${Object.entries(STATUS).filter(([k]) => k !== 'finalizada').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div></div>
    <div class="list" id="ord-list" data-list>${loading()}</div>`;
  const load = async () => {
    const list = $('#ord-list');
    let q = sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(200);
    if ($('#fo-st').value) q = q.eq('status', $('#fo-st').value);
    const { data, error } = await q;
    if (error) return fail(list, error);
    list.innerHTML = data.length ? data.map(orderCard).join('') : '<div class="empty"><strong>Sin pedidos</strong>Los pedidos de la tienda aparecen acá.</div>';
  };
  $('#fo-st').addEventListener('change', load);
  await load();
}

/* ---------------------------------------------------------------- Horarios */
async function viewHours(el) {
  const today = dateKey(new Date());
  const [h, s, b] = await Promise.all([
    sb.from('working_hours').select('*').order('start_time'),
    sb.from('business_settings').select('slot_interval_minutes,booking_window_days,hold_minutes').eq('id', 1).single(),
    sb.from('blocked_dates').select('*').gte('day', today).order('day').order('start_time'),
  ]);
  for (const r of [h, s, b]) if (r.error) throw r.error;

  const week = {};
  for (let d = 0; d < 7; d++) week[d] = { active: false, ranges: [] };
  h.data.forEach((r) => { week[r.weekday].ranges.push({ s: hhmm(r.start_time), e: hhmm(r.end_time) }); week[r.weekday].active = r.active; });

  const sync = () => el.querySelectorAll('.range').forEach((row) => {
    week[row.dataset.day].ranges[row.dataset.i] = { s: row.querySelector('[data-s]').value, e: row.querySelector('[data-e]').value };
  });

  const render = () => {
    el.innerHTML = `<h2>Horarios</h2>
    <div class="panel"><h3>Reglas generales</h3>
      <form id="gen-form" class="form-grid">
        <div class="field"><label for="g-int">Intervalo entre turnos (min)</label><input id="g-int" type="number" min="5" max="240" step="5" value="${s.data.slot_interval_minutes}" required><span class="hint">Cada cuántos minutos arranca un turno. Ej: 30 → 09:00, 09:30, 10:00…</span></div>
        <div class="field"><label for="g-win">Días hacia adelante para reservar</label><input id="g-win" type="number" min="1" max="90" value="${s.data.booking_window_days}" required></div>
        <div class="field"><label for="g-hold">Minutos para enviar el comprobante</label><input id="g-hold" type="number" min="5" max="1440" value="${s.data.hold_minutes}" required><span class="hint">Pasado ese tiempo, una reserva sin pago se libera.</span></div>
        <div class="field--wide"><button class="btn btn--primary btn--sm" type="submit">Guardar reglas</button></div>
      </form></div>
    <p class="muted">Cada día puede tener varias franjas. Los huecos entre franjas son los descansos (ej: 09:00–12:00 y 15:00–20:00 deja libre el mediodía). La duración de cada turno se configura en <a href="#/servicios">Servicios</a>.</p>
    ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<section class="day-card" data-day="${d}">
      <div class="day-card__head"><strong>${WEEK[d]}</strong><label class="check"><input type="checkbox" data-toggle ${week[d].active ? 'checked' : ''}> Abierto</label></div>
      ${week[d].ranges.length ? week[d].ranges.map((r, i) => `<div class="range" data-day="${d}" data-i="${i}"><input type="time" data-s value="${r.s}" aria-label="Desde"><span>a</span><input type="time" data-e value="${r.e}" aria-label="Hasta"><button class="btn btn--danger btn--sm" type="button" data-rm aria-label="Quitar franja">×</button></div>`).join('') : '<p class="muted">Sin franjas. Agregá una para abrir este día.</p>'}
      <div class="item__actions"><button class="btn btn--ghost btn--sm" type="button" data-add>+ Franja</button><button class="btn btn--primary btn--sm" type="button" data-save>Guardar ${WEEK[d].toLowerCase()}</button></div>
    </section>`).join('')}
    <div class="panel"><h3>Bloqueos, feriados y excepciones</h3>
      <form id="blk-form" class="form-grid">
        <div class="field"><label for="b-day">Fecha</label><input id="b-day" type="date" min="${today}" required></div>
        <div class="field"><label for="b-reason">Motivo (opcional)</label><input id="b-reason" type="text" maxlength="80" placeholder="Ej: Feriado"></div>
        <div class="field"><label for="b-from">Desde (vacío = todo el día)</label><input id="b-from" type="time"></div>
        <div class="field"><label for="b-to">Hasta</label><input id="b-to" type="time"></div>
        <div class="field--wide"><button class="btn btn--primary btn--sm" type="submit">Bloquear</button></div>
      </form>
      <div class="list" style="margin-top:1rem">${b.data.length ? b.data.map((x) => `<div class="item"><div class="item__top"><div><div class="item__title">${esc(dayLong(x.day))}</div><div class="item__meta"><span>${x.start_time ? `${hhmm(x.start_time)} a ${hhmm(x.end_time)}` : 'Día completo cerrado'}${x.reason ? ' · ' + esc(x.reason) : ''}</span></div></div><button class="btn btn--danger btn--sm" data-unblock="${x.id}">Quitar</button></div></div>`).join('') : '<div class="empty"><strong>Sin bloqueos</strong>Los feriados o días cerrados aparecen acá.</div>'}</div>
    </div>`;
  };
  render();

  el.onclick = async (e) => {
    const t = e.target;
    const card = t.closest('.day-card');
    if (card && t.closest('[data-add]')) {
      sync();
      const d = card.dataset.day;
      const last = week[d].ranges.at(-1);
      week[d].ranges.push(last ? { s: last.e, e: '20:00' } : { s: '09:00', e: '12:00' });
      week[d].active = true;
      return render();
    }
    if (card && t.closest('[data-rm]')) {
      sync();
      week[card.dataset.day].ranges.splice(Number(t.closest('.range').dataset.i), 1);
      return render();
    }
    if (card && t.closest('[data-save]')) {
      sync();
      const d = Number(card.dataset.day);
      week[d].active = card.querySelector('[data-toggle]').checked;
      const ranges = week[d].ranges.map((r) => ({ start_time: r.s, end_time: r.e }));
      if (week[d].active && !ranges.length) return toast('Agregá al menos una franja para abrir este día.', 'error');
      if (ranges.some((r) => !r.start_time || !r.end_time || r.start_time >= r.end_time)) return toast('Cada franja debe tener un "desde" anterior al "hasta".', 'error');
      const sorted = [...ranges].sort((a, b2) => a.start_time.localeCompare(b2.start_time));
      if (sorted.some((r, i) => i && r.start_time < sorted[i - 1].end_time)) return toast('Las franjas no pueden superponerse.', 'error');
      t.disabled = true;
      const { error } = await sb.rpc('save_working_day', { p_weekday: d, p_active: week[d].active, p_ranges: ranges });
      t.disabled = false;
      return error ? toast(friendlyError(error), 'error') : toast(`${WEEK[d]} guardado`);
    }
    const un = t.closest('[data-unblock]');
    if (un) {
      const { error } = await sb.from('blocked_dates').delete().eq('id', un.dataset.unblock);
      if (error) return toast(friendlyError(error), 'error');
      toast('Bloqueo eliminado');
      return viewHours(el);
    }
  };
  el.onchange = (e) => {
    const card = e.target.closest('.day-card');
    if (card && e.target.matches('[data-toggle]')) week[card.dataset.day].active = e.target.checked;
  };
  el.onsubmit = async (e) => {
    e.preventDefault();
    if (e.target.id === 'gen-form') {
      try {
        await mustUpdate('business_settings', 1, {
          slot_interval_minutes: Number($('#g-int').value), booking_window_days: Number($('#g-win').value), hold_minutes: Number($('#g-hold').value),
        });
        toast('Reglas guardadas');
      } catch (err) { toast(friendlyError(err), 'error'); }
    }
    if (e.target.id === 'blk-form') {
      const from = $('#b-from').value; const to = $('#b-to').value;
      if (!!from !== !!to) return toast('Completá "desde" y "hasta", o dejá ambos vacíos para cerrar todo el día.', 'error');
      if (from && from >= to) return toast('El "desde" debe ser anterior al "hasta".', 'error');
      const { error } = await sb.from('blocked_dates').insert({ day: $('#b-day').value, start_time: from || null, end_time: to || null, reason: $('#b-reason').value.trim() });
      if (error) return toast(friendlyError(error), 'error');
      toast('Bloqueo agregado');
      viewHours(el);
    }
  };
}

/* --------------------------------------------------------------- Servicios */
const SERVICE_FIELDS = [
  { name: 'name', label: 'Nombre', required: true, maxlength: 80 },
  { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
  { name: 'price', label: 'Precio ($)', type: 'number', min: 0, step: 1, required: true },
  { name: 'duration_minutes', label: 'Duración (min)', type: 'number', min: 5, max: 480, step: 5, required: true, default: 30 },
  { name: 'deposit_type', label: 'Tipo de seña', type: 'select', options: [['default', 'Usar seña general'], ['fixed', 'Importe fijo'], ['percent', 'Porcentaje del precio']] },
  { name: 'deposit_value', label: 'Valor de seña ($ o %)', type: 'number', min: 0, step: 1, hint: 'Solo si el tipo no es "seña general".' },
  { name: 'sort_order', label: 'Orden', type: 'number', step: 1, default: 0 },
  { name: 'active', label: 'Activo (visible para reservar)', type: 'checkbox', default: true },
];

async function viewServices(el) {
  const { data, error } = await sb.from('services').select('*').order('sort_order').order('name');
  if (error) throw error;
  const depText = (s) => s.deposit_type === 'fixed' ? `Seña ${money(s.deposit_value)}` : s.deposit_type === 'percent' ? `Seña ${s.deposit_value}%` : 'Seña general';
  el.innerHTML = `<div class="view__head"><h2>Servicios</h2><button class="btn btn--primary btn--sm" id="svc-new">+ Nuevo servicio</button></div>
    <div class="list">${data.length ? data.map((s) => `<article class="item ${s.active ? '' : 'item--off'}"><div class="item__top"><div>
      <div class="item__title">${esc(s.name)} · ${money(s.price)}</div>
      <div class="item__meta"><span>${s.duration_minutes} min · ${depText(s)}</span>${s.description ? `<span>${esc(s.description)}</span>` : ''}</div></div>
      <span class="badge">${s.active ? 'Activo' : 'Inactivo'}</span></div>
      <div class="item__actions"><button class="btn btn--ghost btn--sm" data-edit="${s.id}">Editar</button>
      <button class="btn btn--ghost btn--sm" data-toggle="${s.id}">${s.active ? 'Desactivar' : 'Activar'}</button>
      <button class="btn btn--danger btn--sm" data-del="${s.id}">Eliminar</button></div></article>`).join('')
      : '<div class="empty"><strong>Todavía no hay servicios</strong>Creá el primero (ej: Corte clásico) para habilitar las reservas.</div>'}</div>`;

  const save = (id) => async (v) => {
    if (v.deposit_type !== 'default' && v.deposit_value === null) throw new Error('Indicá el valor de la seña.');
    if (v.deposit_type === 'percent' && v.deposit_value > 100) throw new Error('El porcentaje no puede superar 100.');
    const row = { ...v, deposit_value: v.deposit_value ?? 0, sort_order: v.sort_order ?? 0 };
    if (id) await mustUpdate('services', id, row);
    else { const { error: e } = await sb.from('services').insert(row); if (e) throw e; }
    toast('Servicio guardado');
    viewServices(el);
  };
  $('#svc-new').onclick = () => formDialog({ title: 'Nuevo servicio', fields: SERVICE_FIELDS, onSubmit: save(null) });
  el.onclick = async (e) => {
    const t = e.target;
    const ed = t.closest('[data-edit]');
    if (ed) return formDialog({ title: 'Editar servicio', fields: SERVICE_FIELDS, values: data.find((s) => s.id === ed.dataset.edit), onSubmit: save(ed.dataset.edit) });
    const tg = t.closest('[data-toggle]');
    if (tg) {
      const s = data.find((x) => x.id === tg.dataset.toggle);
      try { await mustUpdate('services', s.id, { active: !s.active }); viewServices(el); } catch (err) { toast(friendlyError(err), 'error'); }
    }
    const del = t.closest('[data-del]');
    if (del && confirm('¿Eliminar este servicio? Las reservas ya hechas conservan su nombre y precio.')) {
      const { error: e2 } = await sb.from('services').delete().eq('id', del.dataset.del);
      if (e2) return toast(friendlyError(e2), 'error');
      toast('Servicio eliminado');
      viewServices(el);
    }
  };
}

/* --------------------------------------------------------------- Productos */
const PRODUCT_FIELDS = [
  { name: 'name', label: 'Nombre', required: true, maxlength: 120 },
  { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
  { name: 'price', label: 'Precio ($)', type: 'number', min: 0, step: 1, required: true },
  { name: 'stock', label: 'Stock (unidades)', type: 'number', min: 0, step: 1, required: true, default: 0 },
  { name: 'image_url', label: 'Fotografía', type: 'image', hint: 'JPG, PNG o WebP, hasta 3 MB. Si no subís una nueva, se mantiene la actual.' },
  { name: 'sort_order', label: 'Orden', type: 'number', step: 1, default: 0 },
  { name: 'active', label: 'Activo (visible en la tienda)', type: 'checkbox', default: true },
];

async function viewProducts(el) {
  const { data, error } = await sb.from('products').select('*').order('sort_order').order('name');
  if (error) throw error;
  el.innerHTML = `<div class="view__head"><h2>Productos</h2><button class="btn btn--primary btn--sm" id="prod-new">+ Nuevo producto</button></div>
    <div class="list">${data.length ? data.map((p) => `<article class="item ${p.active ? '' : 'item--off'}"><div class="item__row">
      ${p.image_url ? `<img class="item__img" src="${esc(p.image_url)}" alt="">` : '<div class="item__img"></div>'}
      <div style="flex:1"><div class="item__title">${esc(p.name)} · ${money(p.price)}</div><div class="item__meta"><span>Stock: ${p.stock}</span>${p.description ? `<span>${esc(p.description)}</span>` : ''}</div></div>
      <span class="badge">${p.active ? 'Activo' : 'Inactivo'}</span></div>
      <div class="item__actions"><button class="btn btn--ghost btn--sm" data-edit="${p.id}">Editar</button>
      <button class="btn btn--ghost btn--sm" data-toggle="${p.id}">${p.active ? 'Desactivar' : 'Activar'}</button>
      <button class="btn btn--danger btn--sm" data-del="${p.id}">Eliminar</button></div></article>`).join('')
      : '<div class="empty"><strong>Todavía no hay productos</strong>Agregá el primero para abrir la tienda.</div>'}</div>`;

  const save = (id, current) => async (v) => {
    const row = { ...v, sort_order: v.sort_order ?? 0, image_url: current?.image_url ?? null };
    if (v.image_url instanceof File) row.image_url = await uploadImage(v.image_url, 'products');
    if (id) await mustUpdate('products', id, row);
    else { const { error: e } = await sb.from('products').insert(row); if (e) throw e; }
    toast('Producto guardado');
    viewProducts(el);
  };
  $('#prod-new').onclick = () => formDialog({ title: 'Nuevo producto', fields: PRODUCT_FIELDS, onSubmit: save(null, null) });
  el.onclick = async (e) => {
    const t = e.target;
    const ed = t.closest('[data-edit]');
    if (ed) { const p = data.find((x) => x.id === ed.dataset.edit); return formDialog({ title: 'Editar producto', fields: PRODUCT_FIELDS, values: p, onSubmit: save(p.id, p) }); }
    const tg = t.closest('[data-toggle]');
    if (tg) {
      const p = data.find((x) => x.id === tg.dataset.toggle);
      try { await mustUpdate('products', p.id, { active: !p.active }); viewProducts(el); } catch (err) { toast(friendlyError(err), 'error'); }
    }
    const del = t.closest('[data-del]');
    if (del && confirm('¿Eliminar este producto? Los pedidos anteriores conservan su nombre y precio.')) {
      const { error: e2 } = await sb.from('products').delete().eq('id', del.dataset.del);
      if (e2) return toast(friendlyError(e2), 'error');
      toast('Producto eliminado');
      viewProducts(el);
    }
  };
}

/* ----------------------------------------------------------- Configuración */
const SETTINGS_FIELDS = [
  { section: 'Negocio' },
  { name: 'business_name', label: 'Nombre del negocio', required: true },
  { name: 'tagline', label: 'Frase comercial (portada)' },
  { name: 'logo_url', label: 'Logo (MB)', type: 'image', hint: 'Si no subís uno, se usa el monograma MB por defecto.' },
  { name: 'hero_image_url', label: 'Imagen de fondo de la portada', type: 'image' },
  { name: 'opening_note', label: 'Aviso en portada (opcional)', hint: 'Ej: Atendemos con turno previo.' },
  { section: 'Contacto y ubicación' },
  { name: 'whatsapp_number', label: 'WhatsApp del negocio', type: 'tel', hint: 'Con código de país, sin + ni espacios. Argentina móvil: 549 + código de área + número. Ej: 5493511234567', placeholder: '5493511234567' },
  { name: 'address', label: 'Dirección' },
  { name: 'city', label: 'Ciudad', hint: 'Mejora la precisión del mapa.' },
  { name: 'maps_url', label: 'Enlace de Google Maps (opcional)', type: 'url' },
  { name: 'instagram', label: 'Instagram (usuario)', hint: 'Sin @. Ej: maciel.barbershopp' },
  { name: 'contact_phone', label: 'Teléfono de contacto', type: 'tel' },
  { name: 'contact_email', label: 'Correo de contacto', type: 'email' },
  { section: 'Pagos y señas' },
  { name: 'mp_alias', label: 'Alias de Mercado Pago' },
  { name: 'account_holder', label: 'Titular de la cuenta' },
  { name: 'default_deposit', label: 'Seña general por turno ($)', type: 'number', min: 0, step: 1, hint: 'Se usa en los servicios con "seña general". Cada servicio puede tener la suya.' },
  { section: 'Mensajes de WhatsApp' },
  { name: 'msg_reservation', label: 'Mensaje para reservas', type: 'textarea', rows: 8, hint: 'Variables: {nombre} {servicio} {dia} {hora} {sena}' },
  { name: 'msg_order', label: 'Mensaje para compras', type: 'textarea', rows: 8, hint: 'Variables: {nombre} {producto} {cantidad} {total}' },
];

async function viewSettings(el) {
  const { data, error } = await sb.from('business_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  el.innerHTML = `<h2>Configuración</h2><form id="set-form" class="form-grid panel">
    ${SETTINGS_FIELDS.map((f) => fieldHtml(f, data[f.name])).join('')}
    <div class="field--wide item__actions"><button class="btn btn--primary" type="submit">Guardar cambios</button><button class="btn btn--ghost" type="button" id="reset-msgs">Restaurar mensajes originales</button></div>
  </form>`;
  $('#reset-msgs').onclick = () => {
    $('#f-msg_reservation').value = DEFAULT_MSG_RESERVATION;
    $('#f-msg_order').value = DEFAULT_MSG_ORDER;
    toast('Mensajes restaurados. Tocá "Guardar cambios" para aplicarlos.');
  };
  $('#set-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const v = readForm(e.target, SETTINGS_FIELDS);
      v.instagram = v.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
      v.whatsapp_number = v.whatsapp_number.replace(/\D/g, '');
      v.default_deposit = v.default_deposit ?? 0;
      for (const k of ['logo_url', 'hero_image_url']) {
        v[k] = v[k] instanceof File ? await uploadImage(v[k], 'branding') : data[k];
      }
      await mustUpdate('business_settings', 1, v);
      toast('Configuración guardada. Ya se refleja en la página pública.');
      viewSettings(el);
    } catch (err) {
      toast(friendlyError(err), 'error');
      btn.disabled = false;
    }
  };
}

/* ------------------------------------------- Acciones de estado (global) */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const table = b.dataset.act === 'res' ? 'reservations' : 'orders';
  const status = b.dataset.status;
  if (status === 'cancelada' && !confirm('¿Seguro que querés cancelar? Esta acción libera el horario o el stock.')) return;
  b.disabled = true;
  try {
    await mustUpdate(table, b.dataset.id, { status });
    toast(`Marcado como "${STATUS[status].toLowerCase()}"`);
    route();
  } catch (err) {
    toast(friendlyError(err), 'error');
    b.disabled = false;
  }
});

/* ------------------------------------------------------------------- Boot */
async function boot() {
  if (!configured) {
    app.innerHTML = '<div class="login"><div class="login__card"><h1>Falta configurar</h1><p class="muted" style="text-align:center">Completá <code>js/config.js</code> con tu URL y anon key de Supabase (ver README).</p></div></div>';
    return;
  }
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { currentUser = null; renderLogin(); } });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  await enter(session.user);
}
boot().catch((err) => { console.error(err); renderLogin(friendlyError(err)); });
