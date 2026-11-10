// Sitio público de Maciel Barbershop
import { sb, configured } from './supabase.js';
import {
  esc, money, num, fill, waUrl, toast, copyText, dateKey, parseKey, dayLong, hhmm,
  validName, validPhone, friendlyError, DEFAULT_MSG_RESERVATION, DEFAULT_MSG_ORDER,
} from './utils.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const WEEK = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const S = {
  settings: null,
  services: [],
  products: [],
  hours: [],
  blocked: [],
  pick: { service: null, day: null, time: null },
};

/* ---------------------------------------------------------------- UI base */
function setupNav() {
  const nav = $('#nav');
  const toggle = $('#nav-toggle');
  const menu = $('#nav-menu');
  const onScroll = () => nav.classList.toggle('is-solid', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

let revealObserver;
function setupReveal() {
  if (!('IntersectionObserver' in window)) {
    $$('.reveal').forEach((el) => el.classList.add('is-in'));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add('is-in');
        revealObserver.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  observeReveals();
}
function observeReveals(root = document) {
  $$('.reveal:not(.is-in)', root).forEach((el) => revealObserver ? revealObserver.observe(el) : el.classList.add('is-in'));
}

function setButtonLoading(btn, loading, label) {
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Procesando…';
  } else {
    btn.disabled = false;
    btn.textContent = label || btn.dataset.label || btn.textContent;
  }
}

/* ---------------------------------------------------------- Configuración */
function igHandle(v) {
  return String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
}

function applySettings() {
  const s = S.settings;
  if (!s) return;
  const binds = { ...s, city_suffix: s.city ? `, ${s.city}` : '' };
  $$('[data-bind]').forEach((el) => {
    const v = binds[el.dataset.bind];
    if (el.dataset.bind === 'opening_note') {
      el.textContent = v || '';
      el.hidden = !v;
    } else if (v !== undefined && v !== null) {
      el.textContent = v;
    }
  });
  document.title = `${s.business_name} | Reservá tu turno online`;

  if (s.logo_url) $$('.js-logo img').forEach((img) => { img.src = s.logo_url; });
  if (s.hero_image_url) {
    $('#hero-bg').style.backgroundImage = `linear-gradient(rgba(11,11,13,.2), rgba(11,11,13,.2)), url("${s.hero_image_url.replace(/"/g, '%22')}")`;
  }

  const wa = waUrl(s.whatsapp_number, '');
  const floatBtn = $('#wa-float');
  const contactWa = $('#contact-wa');
  floatBtn.hidden = !wa; contactWa.hidden = !wa;
  if (wa) { floatBtn.href = wa; contactWa.href = wa; }

  const ig = igHandle(s.instagram);
  const igUrl = ig ? `https://www.instagram.com/${ig}` : '#';
  ['#contact-ig', '#footer-ig'].forEach((sel) => {
    const a = $(sel);
    a.href = igUrl;
    a.hidden = !ig;
    if (sel === '#contact-ig') a.textContent = ig ? `Instagram @${ig}` : 'Instagram';
  });

  const tel = $('#contact-tel');
  tel.hidden = !s.contact_phone;
  if (s.contact_phone) { tel.href = `tel:${s.contact_phone.replace(/[^\d+]/g, '')}`; tel.textContent = `Llamar ${s.contact_phone}`; }
  const mail = $('#contact-mail');
  mail.hidden = !s.contact_email;
  if (s.contact_email) { mail.href = `mailto:${s.contact_email}`; mail.textContent = s.contact_email; }

  const query = [s.address, s.city].filter(Boolean).join(', ');
  $('#maps-link').href = s.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const mapBox = $('#map-box');
  if (query && !mapBox.firstElementChild) {
    mapBox.innerHTML = `<iframe title="Mapa de ${esc(s.business_name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed"></iframe>`;
  }
}

function renderHours() {
  const box = $('#hours-list');
  const active = S.hours.filter((h) => h.active);
  if (!active.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const ranges = active.filter((h) => h.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const txt = ranges.length ? ranges.map((r) => `${hhmm(r.start_time)} a ${hhmm(r.end_time)}`).join(' · ') : 'Cerrado';
    return `<div><span>${WEEK[wd]}</span><span>${txt}</span></div>`;
  }).join('');
}

/* ----------------------------------------------------------------- Datos */
async function loadData() {
  const today = dateKey(new Date());
  const [settings, services, products, hours, blocked] = await Promise.all([
    sb.from('business_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('services').select('*').eq('active', true).order('sort_order').order('name'),
    sb.from('products').select('*').eq('active', true).order('sort_order').order('name'),
    sb.from('working_hours').select('*'),
    sb.from('blocked_dates').select('*').gte('day', today),
  ]);
  for (const r of [settings, services, products, hours, blocked]) if (r.error) throw r.error;
  S.settings = settings.data;
  S.services = services.data || [];
  S.products = products.data || [];
  S.hours = hours.data || [];
  S.blocked = blocked.data || [];
}

/* -------------------------------------------------------------- Servicios */
function renderServices() {
  const box = $('#services-list');
  if (!S.services.length) {
    box.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>Próximamente</strong>Estamos cargando los servicios. Escribinos por WhatsApp para consultar.</div>';
    return;
  }
  box.innerHTML = S.services.map((s) => `
    <article class="svc reveal">
      <h3>${esc(s.name)}</h3>
      ${s.description ? `<p>${esc(s.description)}</p>` : ''}
      <div class="svc__row"><span class="muted">${s.duration_minutes} min</span><span class="svc__price">${money(s.price)}</span></div>
      <button class="btn btn--ghost btn--sm" data-book="${s.id}" type="button">Reservar</button>
    </article>`).join('');
  observeReveals(box);
}

/* --------------------------------------------------------------- Reservas */
function setSteps(n) {
  $$('.steps li').forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle('is-done', i < n);
    li.classList.toggle('is-active', i === n);
  });
}

function renderBookingStart() {
  const loading = $('#booking-loading');
  const empty = $('#booking-empty');
  const form = $('#booking-form');
  loading.hidden = true;

  const hasHours = S.hours.some((h) => h.active);
  if (!S.services.length || !hasHours) {
    empty.hidden = false;
    form.hidden = true;
    const wa = waUrl(S.settings?.whatsapp_number, '');
    empty.innerHTML = `<strong>Reservas online próximamente</strong>${
      !S.services.length ? 'Todavía no hay servicios disponibles.' : 'Todavía no hay horarios configurados.'
    }${wa ? `<br><br><a class="btn btn--primary" href="${wa}" target="_blank" rel="noopener">Reservar por WhatsApp</a>` : ''}`;
    return;
  }
  empty.hidden = true;
  form.hidden = false;
  $('#service-options').innerHTML = S.services.map((s) => `
    <button type="button" class="option" role="radio" aria-checked="false" data-service="${s.id}">
      <span><span class="option__name">${esc(s.name)}</span><span class="option__meta">${s.duration_minutes} min${s.description ? ' · ' + esc(s.description) : ''}</span></span>
      <span class="option__price">${money(s.price)}</span>
    </button>`).join('');
  resetPick();
}

function resetPick() {
  S.pick = { service: null, day: null, time: null };
  ['#step-day', '#step-time', '#step-data'].forEach((s) => { $(s).hidden = true; });
  $$('#service-options .option').forEach((b) => b.setAttribute('aria-checked', 'false'));
  setSteps(1);
}

function openDays() {
  const win = S.settings?.booking_window_days ?? 14;
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i <= win; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const key = dateKey(d);
    const open = S.hours.some((h) => h.weekday === d.getDay() && h.active);
    const closed = S.blocked.some((b) => b.day === key && !b.start_time);
    if (open && !closed) out.push({ key, d });
  }
  return out;
}

function selectService(id) {
  const svc = S.services.find((s) => s.id === id);
  if (!svc) return;
  S.pick = { service: svc, day: null, time: null };
  $$('#service-options .option').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.service === id)));
  $('#step-time').hidden = true;
  $('#step-data').hidden = true;

  const days = openDays();
  const wk = new Intl.DateTimeFormat('es-AR', { weekday: 'short' });
  const mo = new Intl.DateTimeFormat('es-AR', { month: 'short' });
  $('#day-options').innerHTML = days.map(({ key, d }) => `
    <button type="button" class="chip" role="radio" aria-checked="false" data-day="${key}">
      <small>${wk.format(d).replace('.', '')}</small><strong>${d.getDate()}</strong><small>${mo.format(d).replace('.', '')}</small>
    </button>`).join('');
  $('#day-empty').hidden = days.length > 0;
  $('#step-day').hidden = false;
  setSteps(2);
  $('#step-day').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function selectDay(key) {
  S.pick.day = key;
  S.pick.time = null;
  $$('#day-options .chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.day === key)));
  $('#step-data').hidden = true;
  $('#step-time').hidden = false;
  setSteps(3);
  await loadSlots();
  $('#step-time').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadSlots() {
  const box = $('#time-options');
  const loading = $('#time-loading');
  const empty = $('#time-empty');
  box.innerHTML = '';
  empty.hidden = true;
  loading.hidden = false;
  const { service, day } = S.pick;
  const { data, error } = await sb.rpc('get_available_slots', { p_service_id: service.id, p_day: day });
  // Si el cliente cambió de día mientras cargaba, ignorar respuesta vieja
  if (S.pick.day !== day || S.pick.service?.id !== service.id) return;
  loading.hidden = true;
  if (error) { toast(friendlyError(error), 'error'); return; }
  if (!data.length) { empty.hidden = false; return; }
  box.innerHTML = data.map((r) => `<button type="button" class="chip" role="radio" aria-checked="false" data-time="${hhmm(r.slot_time)}">${hhmm(r.slot_time)}</button>`).join('');
}

function selectTime(t) {
  S.pick.time = t;
  $$('#time-options .chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.time === t)));
  const { service, day } = S.pick;
  $('#booking-summary').innerHTML = `<dl>
    <dt>Servicio</dt><dd>${esc(service.name)}</dd>
    <dt>Día</dt><dd>${esc(dayLong(day))}</dd>
    <dt>Horario</dt><dd>${esc(t)} hs</dd>
    <dt>Precio</dt><dd>${money(service.price)}</dd></dl>`;
  $('#step-data').hidden = false;
  setSteps(4);
  $('#step-data').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function fieldError(id, msg) {
  const input = $(`#${id}`);
  const err = $(`[data-error-for="${id}"]`);
  err.textContent = msg || '';
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

async function submitBooking(e) {
  e.preventDefault();
  const name = $('#b-name').value;
  const phone = $('#b-phone').value;
  const { service, day, time } = S.pick;
  if (!service || !day || !time) { toast('Elegí servicio, día y horario.', 'error'); return; }
  const okName = validName(name);
  const okPhone = validPhone(phone);
  fieldError('b-name', okName ? '' : 'Ingresá tu nombre y apellido.');
  fieldError('b-phone', okPhone ? '' : 'Ingresá un teléfono válido (solo números, con código de área).');
  if (!okName || !okPhone) { (okName ? $('#b-phone') : $('#b-name')).focus(); return; }

  const btn = $('#booking-submit');
  setButtonLoading(btn, true);
  const { data, error } = await sb.rpc('create_reservation', {
    p_service_id: service.id, p_day: day, p_time: time, p_name: name, p_phone: phone,
  });
  setButtonLoading(btn, false);
  if (error) {
    toast(friendlyError(error), 'error');
    if (/horario/i.test(error.message)) { S.pick.time = null; $('#step-data').hidden = true; setSteps(3); loadSlots(); }
    return;
  }
  showReservationPayment(data);
}

function aliasBlock() {
  const s = S.settings;
  if (!s?.mp_alias) {
    return '<div class="notice">El negocio todavía no cargó el alias de pago. Escribinos por WhatsApp y te pasamos los datos.</div>';
  }
  return `<div class="alias">
    <div><small>Alias de Mercado Pago${s.account_holder ? ` · Titular: ${esc(s.account_holder)}` : ''}</small><code>${esc(s.mp_alias)}</code></div>
    <button type="button" class="btn btn--ghost btn--sm" data-copy="${esc(s.mp_alias)}">Copiar</button>
  </div>`;
}

function waButton(url, label) {
  return url
    ? `<a class="js-wa-proof btn btn--primary btn--block" href="${url}" target="_blank" rel="noopener">${label}</a>`
    : '<div class="notice">El negocio todavía no configuró su número de WhatsApp.</div>';
}

function showReservationPayment(r) {
  const s = S.settings;
  const msg = fill(s.msg_reservation || DEFAULT_MSG_RESERVATION, {
    nombre: r.name, servicio: r.service, dia: dayLong(r.day), hora: hhmm(r.time), sena: num(r.deposit),
  });
  const url = waUrl(s.whatsapp_number, msg);
  const box = $('#booking-payment');
  $('#booking-form').hidden = true;
  box.hidden = false;
  box.innerHTML = `<div class="pay">
    <div class="pay__ok"><h3>¡Solicitud enviada!</h3><p class="muted">Tu turno quedó <strong>pendiente de pago</strong>. Falta un último paso.</p></div>
    <div class="summary"><dl>
      <dt>Servicio</dt><dd>${esc(r.service)}</dd>
      <dt>Día</dt><dd>${esc(dayLong(r.day))}</dd>
      <dt>Horario</dt><dd>${esc(hhmm(r.time))} hs</dd>
      <dt>Nombre</dt><dd>${esc(r.name)}</dd></dl></div>
    ${Number(r.deposit) > 0
      ? `<div class="pay__amount"><small>Seña a transferir</small><strong>${money(r.deposit)}</strong></div>`
      : '<div class="notice notice--info">Este servicio no requiere seña. Avisanos por WhatsApp para confirmar.</div>'}
    ${Number(r.deposit) > 0 ? aliasBlock() : ''}
    <ol>
      ${Number(r.deposit) > 0 ? '<li>Copiá el alias y transferí el importe desde Mercado Pago o tu banco.</li><li>Sacá una captura del comprobante.</li>' : ''}
      <li>Tocá el botón de abajo: se abre WhatsApp con el mensaje listo.</li>
      <li><strong>Adjuntá la captura manualmente</strong> y enviá.</li>
      <li>Te confirmamos el turno apenas verifiquemos el pago.</li>
    </ol>
    ${waButton(url, 'Enviar comprobante por WhatsApp')}
    <div class="notice">Tu horario queda reservado por ${r.hold_minutes} minutos. Si no recibimos el comprobante, se libera automáticamente.</div>
    <button type="button" class="btn btn--ghost btn--block" id="booking-again">Hacer otra reserva</button>
  </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const link = $(".js-wa-proof", box);
  if (link) {
    link.addEventListener('click', () => {
      // No bloquea la apertura de WhatsApp. NO marca el pago como recibido:
      // solo pasa a "pendiente de confirmación" hasta que el dueño verifique.
      sb.rpc('mark_reservation_proof_sent', { p_id: r.id, p_token: r.token }).then(({ error }) => {
        if (error) console.warn(error.message);
        else toast('Cuando envíes el comprobante, el dueño confirmará tu turno.');
      });
    });
  }
  $('#booking-again').addEventListener('click', () => {
    box.hidden = true; box.innerHTML = '';
    $('#booking-form').reset();
    ['b-name', 'b-phone'].forEach((id) => fieldError(id, ''));
    $('#booking-form').hidden = false;
    resetPick();
    $('#reservar').scrollIntoView({ behavior: 'smooth' });
  });
}

/* ---------------------------------------------------------------- Tienda */
const PLACEHOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3h8l1 4H7l1-4zM7 7h10v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7z"/></svg>';

function stockLabel(p) {
  if (p.stock <= 0) return '<span class="stock stock--out">Sin stock</span>';
  if (p.stock <= 3) return `<span class="stock stock--low">Últimas ${p.stock} unidades</span>`;
  return '<span class="stock stock--ok">Disponible</span>';
}

function renderProducts() {
  const box = $('#products-list');
  if (!S.products.length) {
    box.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>Próximamente</strong>Muy pronto vas a poder comprar productos de barbería acá.</div>';
    return;
  }
  box.innerHTML = S.products.map((p) => `
    <article class="prod reveal">
      <div class="prod__img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" width="400" height="400">` : PLACEHOLDER_ICON}</div>
      <div class="prod__body">
        <h3>${esc(p.name)}</h3>
        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
        ${stockLabel(p)}
        <div class="prod__foot">
          <span class="prod__price">${money(p.price)}</span>
          <button class="btn btn--primary btn--sm" type="button" data-buy="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>Comprar</button>
        </div>
      </div>
    </article>`).join('');
  observeReveals(box);
}

function openShop(productId) {
  const p = S.products.find((x) => x.id === productId);
  if (!p || p.stock <= 0) return;
  const max = Math.min(p.stock, 20);
  let qty = 1;
  const dlg = $('#shop-dialog');
  const body = $('#shop-body');
  body.innerHTML = `
    <div class="dialog__head"><h3 id="shop-title">Comprar</h3><button class="dialog__close" type="button" data-close aria-label="Cerrar">×</button></div>
    <form id="shop-form" novalidate>
      <div class="summary"><dl><dt>Producto</dt><dd>${esc(p.name)}</dd><dt>Precio unitario</dt><dd>${money(p.price)}</dd></dl></div>
      <div class="field"><label>Cantidad</label>
        <div class="qty"><button type="button" data-qty="-1" aria-label="Menos">−</button><output id="qty-out" aria-live="polite">1</output><button type="button" data-qty="1" aria-label="Más">+</button></div>
      </div>
      <div class="field"><label for="s-name">Nombre y apellido</label><input id="s-name" type="text" autocomplete="name" maxlength="80" placeholder="Ej: Juan Pérez" required><span class="error" data-error-for="s-name"></span></div>
      <div class="field"><label for="s-phone">Teléfono / WhatsApp</label><input id="s-phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="Ej: 351 123 4567" required><span class="error" data-error-for="s-phone"></span></div>
      <div class="pay__amount" style="margin-bottom:1rem"><small>Total</small><strong id="shop-total">${money(p.price)}</strong></div>
      <button class="btn btn--primary btn--block" type="submit" id="shop-submit">Continuar al pago</button>
    </form>`;
  if (!dlg.open) dlg.showModal();

  const out = $('#qty-out', body);
  const total = $('#shop-total', body);
  body.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
    qty = Math.min(max, Math.max(1, qty + Number(b.dataset.qty)));
    out.textContent = qty;
    total.textContent = money(p.price * qty);
    if (qty === max && Number(b.dataset.qty) > 0 && p.stock < 20) toast(`Stock máximo: ${p.stock}`);
  }));

  $('#shop-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#s-name', body).value;
    const phone = $('#s-phone', body).value;
    const okName = validName(name);
    const okPhone = validPhone(phone);
    fieldError('s-name', okName ? '' : 'Ingresá tu nombre y apellido.');
    fieldError('s-phone', okPhone ? '' : 'Ingresá un teléfono válido.');
    if (!okName || !okPhone) return;
    const btn = $('#shop-submit', body);
    setButtonLoading(btn, true);
    const { data, error } = await sb.rpc('create_order', {
      p_name: name, p_phone: phone, p_items: [{ product_id: p.id, quantity: qty }],
    });
    setButtonLoading(btn, false);
    if (error) { toast(friendlyError(error), 'error'); refreshProducts(); return; }
    showOrderPayment(data, p, qty);
    refreshProducts();
  });
}

function showOrderPayment(o, p, qty) {
  const s = S.settings;
  const msg = fill(s.msg_order || DEFAULT_MSG_ORDER, {
    nombre: o.name, producto: p.name, cantidad: String(qty), total: num(o.total),
  });
  const url = waUrl(s.whatsapp_number, msg);
  const body = $('#shop-body');
  body.innerHTML = `
    <div class="dialog__head"><h3 id="shop-title">¡Pedido registrado!</h3><button class="dialog__close" type="button" data-close aria-label="Cerrar">×</button></div>
    <div class="pay">
      <p class="muted" style="margin:0">Tu pedido quedó <strong>pendiente de pago</strong>.</p>
      <div class="summary"><dl><dt>Producto</dt><dd>${esc(p.name)}</dd><dt>Cantidad</dt><dd>${qty}</dd><dt>Nombre</dt><dd>${esc(o.name)}</dd></dl></div>
      <div class="pay__amount"><small>Total a transferir</small><strong>${money(o.total)}</strong></div>
      ${aliasBlock()}
      <ol><li>Copiá el alias y transferí el total.</li><li>Sacá una captura del comprobante.</li><li>Tocá el botón: se abre WhatsApp con el mensaje listo.</li><li><strong>Adjuntá la captura manualmente</strong> y enviá.</li></ol>
      ${waButton(url, 'Enviar comprobante por WhatsApp')}
      <div class="notice">Reservamos tu producto por ${o.hold_minutes} minutos. Si no recibimos el comprobante, se libera.</div>
    </div>`;
  const link = $(".js-wa-proof", body);
  if (link) link.addEventListener('click', () => {
    sb.rpc('mark_order_proof_sent', { p_id: o.id, p_token: o.token }).then(({ error }) => { if (error) console.warn(error.message); });
  });
}

async function refreshProducts() {
  const { data } = await sb.from('products').select('*').eq('active', true).order('sort_order').order('name');
  if (data) { S.products = data; renderProducts(); }
}

/* ------------------------------------------------------------------ Init */
function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const svc = t.closest('[data-service]');
    if (svc) return selectService(svc.dataset.service);
    const day = t.closest('[data-day]');
    if (day) return selectDay(day.dataset.day);
    const time = t.closest('[data-time]');
    if (time) return selectTime(time.dataset.time);
    const book = t.closest('[data-book]');
    if (book) {
      $('#reservar').scrollIntoView({ behavior: 'smooth' });
      return setTimeout(() => selectService(book.dataset.book), 450);
    }
    const buy = t.closest('[data-buy]');
    if (buy) return openShop(buy.dataset.buy);
    const copy = t.closest('[data-copy]');
    if (copy) {
      return copyText(copy.dataset.copy)
        .then(() => toast('Alias copiado'))
        .catch(() => toast('No se pudo copiar. Mantené presionado el alias para copiarlo.', 'error'));
    }
    if (t.closest('[data-reload]')) return location.reload();
    if (t.closest('[data-close]')) $('#shop-dialog').close();
    if (t === $('#shop-dialog')) $('#shop-dialog').close();
  });
  $('#booking-form').addEventListener('submit', submitBooking);
}

function showSetupNeeded() {
  $('#booking-loading').hidden = true;
  const empty = $('#booking-empty');
  empty.hidden = false;
  empty.innerHTML = '<strong>Sitio en configuración</strong>Falta conectar la base de datos (Supabase). Seguí el README para completar <code>js/config.js</code>.';
}

async function init() {
  $('#year').textContent = new Date().getFullYear();
  setupNav();
  setupReveal();
  bindEvents();
  if (!configured) { showSetupNeeded(); renderServices(); renderProducts(); return; }
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    $('#booking-loading').hidden = true;
    const empty = $('#booking-empty');
    empty.hidden = false;
    empty.innerHTML = `<strong>No pudimos cargar la información</strong>${esc(friendlyError(err))}<br><br><button class="btn btn--ghost" data-reload type="button">Reintentar</button>`;
    return;
  }
  applySettings();
  renderHours();
  renderServices();
  renderProducts();
  renderBookingStart();
}

init();
