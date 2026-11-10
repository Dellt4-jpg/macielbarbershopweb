-- =====================================================================
-- MACIEL BARBERSHOP — Esquema completo para Supabase (PostgreSQL)
-- Ejecutar UNA vez en: Supabase Dashboard > SQL Editor > New query
-- Es idempotente en lo posible, pero pensado para un proyecto nuevo.
-- Zona horaria de negocio: America/Argentina/Cordoba
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Administradores. Solo se agregan desde el SQL Editor (ver README).
-- Ninguna política permite insertar desde el cliente: nadie puede
-- otorgarse permisos de administrador.
create table if not exists public.administrators (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

-- Configuración general (una sola fila, id = 1)
create table if not exists public.business_settings (
  id                  int primary key default 1 check (id = 1),
  business_name       text not null default 'Maciel Barbershop',
  tagline             text not null default 'Tu mejor versión empieza en el sillón.',
  logo_url            text,
  hero_image_url      text,
  whatsapp_number     text not null default '',
  address             text not null default 'Rubén Darío 846',
  city                text not null default '',
  maps_url            text not null default '',
  instagram           text not null default 'maciel.barbershopp',
  contact_phone       text not null default '',
  contact_email       text not null default '',
  opening_note        text not null default '',
  mp_alias            text not null default '',
  account_holder      text not null default '',
  default_deposit     numeric(10,2) not null default 0 check (default_deposit >= 0),
  slot_interval_minutes int not null default 30 check (slot_interval_minutes between 5 and 240),
  booking_window_days int not null default 14 check (booking_window_days between 1 and 90),
  hold_minutes        int not null default 60 check (hold_minutes between 5 and 1440),
  msg_reservation     text not null default
$m$Hola! Quiero confirmar mi reserva en Maciel Barbershop.

Nombre: {nombre}
Servicio: {servicio}
Día: {dia}
Horario: {hora}
Seña: ${sena}

Adjunto el comprobante de transferencia para confirmar mi turno.$m$,
  msg_order           text not null default
$m$Hola! Quiero realizar una compra en Maciel Barbershop.

Nombre: {nombre}
Producto: {producto}
Cantidad: {cantidad}
Total: ${total}

Adjunto el comprobante de transferencia.$m$,
  updated_at          timestamptz not null default now()
);

create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 80),
  description      text not null default '',
  price            numeric(10,2) not null check (price >= 0),
  duration_minutes int not null check (duration_minutes between 5 and 480),
  -- Seña: 'default' usa business_settings.default_deposit,
  --       'fixed' un importe propio, 'percent' un % del precio.
  deposit_type     text not null default 'default' check (deposit_type in ('default','fixed','percent')),
  deposit_value    numeric(10,2) not null default 0 check (deposit_value >= 0),
  active           boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  price       numeric(10,2) not null check (price >= 0),
  stock       int not null default 0 check (stock >= 0),
  image_url   text,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Franjas horarias por día. weekday: 0 = domingo ... 6 = sábado.
-- Un día puede tener varias franjas; los huecos entre franjas son descansos.
-- Un día sin franjas activas está cerrado.
create table if not exists public.working_hours (
  id         uuid primary key default gen_random_uuid(),
  weekday    smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  active     boolean not null default true,
  check (end_time > start_time)
);
create index if not exists working_hours_weekday_idx on public.working_hours(weekday);

-- Bloqueos / feriados / excepciones.
-- start_time y end_time NULL = día completo cerrado.
create table if not exists public.blocked_dates (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,
  start_time time,
  end_time   time,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  check ((start_time is null and end_time is null)
      or (start_time is not null and end_time is not null and end_time > start_time))
);
create index if not exists blocked_dates_day_idx on public.blocked_dates(day);

create table if not exists public.reservations (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid references public.services(id) on delete set null,
  service_name   text not null,
  price          numeric(10,2) not null,
  deposit_amount numeric(10,2) not null default 0,
  customer_name  text not null,
  customer_phone text not null,
  day            date not null,
  start_time     time not null,
  end_time       time not null,
  status         text not null default 'pendiente_pago'
    check (status in ('pendiente_pago','pendiente_confirmacion','confirmada','cancelada','finalizada')),
  access_token   uuid not null default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists reservations_day_idx on public.reservations(day, start_time);
create index if not exists reservations_status_idx on public.reservations(status);

-- GARANTÍA ANTI-DUPLICADOS a nivel de base de datos:
-- dos reservas no canceladas no pueden solaparse en el tiempo,
-- ni siquiera si dos personas reservan en el mismo milisegundo.
alter table public.reservations drop constraint if exists reservations_no_overlap;
alter table public.reservations
  add constraint reservations_no_overlap
  exclude using gist (tsrange(day + start_time, day + end_time, '[)') with &&)
  where (status <> 'cancelada');

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  customer_name  text not null,
  customer_phone text not null,
  total          numeric(10,2) not null default 0,
  status         text not null default 'pendiente_pago'
    check (status in ('pendiente_pago','pendiente_confirmacion','confirmada','entregada','cancelada')),
  access_token   uuid not null default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders(status);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price   numeric(10,2) not null,
  quantity     int not null check (quantity > 0)
);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- Fila única de configuración (sin datos ficticios: solo valores base)
insert into public.business_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. TRIGGERS
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['business_settings','services','products','reservations','orders'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Al cancelar un pedido se devuelve el stock. Un pedido cancelado no se reactiva.
create or replace function public.orders_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'cancelada' and new.status <> 'cancelada' then
    raise exception 'Un pedido cancelado no puede reactivarse. Creá uno nuevo.';
  end if;
  if new.status = 'cancelada' and old.status <> 'cancelada' then
    update public.products p
       set stock = p.stock + oi.quantity
      from public.order_items oi
     where oi.order_id = new.id and oi.product_id = p.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_status_guard on public.orders;
create trigger trg_orders_status_guard before update of status on public.orders
  for each row execute function public.orders_status_guard();

-- ---------------------------------------------------------------------
-- 3. FUNCIÓN is_admin()
-- ---------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.administrators where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.administrators    enable row level security;
alter table public.business_settings enable row level security;
alter table public.services          enable row level security;
alter table public.products          enable row level security;
alter table public.working_hours     enable row level security;
alter table public.blocked_dates     enable row level security;
alter table public.reservations      enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;

-- administrators: cada usuario solo ve su propia fila. SIN insert/update/delete.
drop policy if exists administrators_self_read on public.administrators;
create policy administrators_self_read on public.administrators
  for select to authenticated using (user_id = auth.uid());

-- business_settings: lectura pública (alias, dirección, etc. se muestran en la web)
drop policy if exists settings_public_read on public.business_settings;
create policy settings_public_read on public.business_settings
  for select to anon, authenticated using (true);
drop policy if exists settings_admin_write on public.business_settings;
create policy settings_admin_write on public.business_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- services
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services
  for select to anon, authenticated using (active or (select public.is_admin()));
drop policy if exists services_admin_all on public.services;
create policy services_admin_all on public.services
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- products
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated using (active or (select public.is_admin()));
drop policy if exists products_admin_all on public.products;
create policy products_admin_all on public.products
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- working_hours
drop policy if exists hours_public_read on public.working_hours;
create policy hours_public_read on public.working_hours
  for select to anon, authenticated using (true);
drop policy if exists hours_admin_all on public.working_hours;
create policy hours_admin_all on public.working_hours
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- blocked_dates
drop policy if exists blocked_public_read on public.blocked_dates;
create policy blocked_public_read on public.blocked_dates
  for select to anon, authenticated using (true);
drop policy if exists blocked_admin_all on public.blocked_dates;
create policy blocked_admin_all on public.blocked_dates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- reservations / orders / order_items: SOLO administradores.
-- Los clientes jamás leen ni escriben estas tablas directamente:
-- crean registros mediante funciones RPC validadas en el servidor.
drop policy if exists reservations_admin_all on public.reservations;
create policy reservations_admin_all on public.reservations
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists orders_admin_all on public.orders;
create policy orders_admin_all on public.orders
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists order_items_admin_all on public.order_items;
create policy order_items_admin_all on public.order_items
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Defensa extra: el rol anónimo no tiene acceso directo a tablas sensibles
revoke all on public.reservations, public.orders, public.order_items, public.administrators from anon;
-- Y los usuarios autenticados no pueden tocar administrators (aparte de leer su fila)
revoke insert, update, delete on public.administrators from authenticated;

-- ---------------------------------------------------------------------
-- 5. FUNCIONES RPC (lógica validada en el servidor)
-- ---------------------------------------------------------------------

-- Horarios disponibles para un servicio en una fecha.
create or replace function public.get_available_slots(p_service_id uuid, p_day date)
returns table (slot_time time)
language plpgsql stable security definer set search_path = public as $$
declare
  v_dur      int;
  v_interval int;
  v_window   int;
  v_hold     int;
  v_now      timestamp := timezone('America/Argentina/Cordoba', now());
begin
  select s.duration_minutes into v_dur from public.services s where s.id = p_service_id and s.active;
  if v_dur is null then return; end if;

  select b.slot_interval_minutes, b.booking_window_days, b.hold_minutes
    into v_interval, v_window, v_hold
    from public.business_settings b where b.id = 1;

  if p_day < v_now::date or p_day > v_now::date + v_window then return; end if;

  -- Día completo bloqueado (feriado, vacaciones, etc.)
  if exists (select 1 from public.blocked_dates bd
              where bd.day = p_day and bd.start_time is null) then
    return;
  end if;

  return query
  select g.t::time
  from (
    select distinct s2.t
    from public.working_hours w
    cross join lateral generate_series(
      p_day + w.start_time,
      p_day + w.end_time - make_interval(mins => v_dur),
      make_interval(mins => v_interval)
    ) as s2(t)
    where w.weekday = extract(dow from p_day)::int
      and w.active
      and s2.t > v_now
      -- bloqueos parciales (descansos puntuales)
      and not exists (
        select 1 from public.blocked_dates bd
         where bd.day = p_day and bd.start_time is not null
           and tsrange(p_day + bd.start_time, p_day + bd.end_time, '[)')
            && tsrange(s2.t, s2.t + make_interval(mins => v_dur), '[)')
      )
      -- reservas existentes (las pendientes de pago vencidas no bloquean)
      and not exists (
        select 1 from public.reservations r
         where r.status <> 'cancelada'
           and not (r.status = 'pendiente_pago'
                    and r.created_at < now() - make_interval(mins => v_hold))
           and tsrange(r.day + r.start_time, r.day + r.end_time, '[)')
            && tsrange(s2.t, s2.t + make_interval(mins => v_dur), '[)')
      )
  ) g
  order by 1;
end $$;

-- Crear reserva (PENDIENTE DE PAGO). Precio y seña salen del servidor.
create or replace function public.create_reservation(
  p_service_id uuid, p_day date, p_time time, p_name text, p_phone text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_service  public.services%rowtype;
  v_settings public.business_settings%rowtype;
  v_name     text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_phone    text := btrim(coalesce(p_phone,''));
  v_digits   text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_deposit  numeric;
  v_end      time;
  v_id       uuid;
  v_token    uuid;
begin
  if char_length(v_name) < 3 or char_length(v_name) > 80 or position(' ' in v_name) = 0 then
    raise exception 'Ingresá tu nombre y apellido.';
  end if;
  if char_length(v_digits) < 8 or char_length(v_digits) > 15 or v_phone !~ '^[0-9+()\s-]+$' then
    raise exception 'Ingresá un teléfono válido.';
  end if;

  select * into v_service from public.services where id = p_service_id and active;
  if not found then raise exception 'Ese servicio no está disponible.'; end if;
  select * into v_settings from public.business_settings where id = 1;

  -- Serializa las reservas concurrentes (además de la restricción de exclusión)
  perform pg_advisory_xact_lock(hashtext('maciel_reservations'));

  -- Libera reservas sin pago cuyo plazo venció
  update public.reservations
     set status = 'cancelada'
   where status = 'pendiente_pago'
     and created_at < now() - make_interval(mins => v_settings.hold_minutes);

  -- Anti-abuso: máximo 3 reservas pendientes por teléfono
  if (select count(*) from public.reservations r
       where regexp_replace(r.customer_phone, '\D', '', 'g') = v_digits
         and r.status in ('pendiente_pago','pendiente_confirmacion')
         and r.day >= (timezone('America/Argentina/Cordoba', now()))::date) >= 3 then
    raise exception 'Ya tenés reservas pendientes. Esperá la confirmación o contactanos por WhatsApp.';
  end if;

  if not exists (select 1 from public.get_available_slots(p_service_id, p_day) g where g.slot_time = p_time) then
    raise exception 'Ese horario ya no está disponible. Elegí otro, por favor.';
  end if;

  v_end := p_time + make_interval(mins => v_service.duration_minutes);

  v_deposit := case v_service.deposit_type
    when 'fixed'   then v_service.deposit_value
    when 'percent' then round(v_service.price * v_service.deposit_value / 100)
    else v_settings.default_deposit
  end;
  v_deposit := least(greatest(coalesce(v_deposit,0),0), v_service.price);

  begin
    insert into public.reservations
      (service_id, service_name, price, deposit_amount, customer_name, customer_phone, day, start_time, end_time)
    values
      (v_service.id, v_service.name, v_service.price, v_deposit, v_name, v_phone, p_day, p_time, v_end)
    returning id, access_token into v_id, v_token;
  exception when exclusion_violation then
    raise exception 'Ese horario ya no está disponible. Elegí otro, por favor.';
  end;

  return json_build_object(
    'id', v_id, 'token', v_token, 'service', v_service.name, 'price', v_service.price,
    'deposit', v_deposit, 'day', p_day, 'time', p_time, 'name', v_name,
    'hold_minutes', v_settings.hold_minutes
  );
end $$;

-- El cliente avisó que va a mandar el comprobante: pasa a "pendiente de confirmación".
-- NO marca el pago como recibido; solo el administrador confirma.
create or replace function public.mark_reservation_proof_sent(p_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.reservations
     set status = 'pendiente_confirmacion'
   where id = p_id and access_token = p_token and status = 'pendiente_pago';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Crear pedido. Precios, stock y cantidades se validan acá.
-- p_items: [{"product_id":"<uuid>","quantity":2}]
create or replace function public.create_order(p_name text, p_phone text, p_items jsonb)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_name     text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_phone    text := btrim(coalesce(p_phone,''));
  v_digits   text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_hold     int;
  v_order_id uuid;
  v_token    uuid;
  v_total    numeric := 0;
  v_item     record;
  v_prod     public.products%rowtype;
  v_summary  jsonb := '[]'::jsonb;
begin
  if char_length(v_name) < 3 or char_length(v_name) > 80 or position(' ' in v_name) = 0 then
    raise exception 'Ingresá tu nombre y apellido.';
  end if;
  if char_length(v_digits) < 8 or char_length(v_digits) > 15 or v_phone !~ '^[0-9+()\s-]+$' then
    raise exception 'Ingresá un teléfono válido.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'El pedido está vacío.';
  end if;

  select hold_minutes into v_hold from public.business_settings where id = 1;

  -- Libera pedidos sin pago vencidos (el trigger devuelve el stock)
  update public.orders set status = 'cancelada'
   where status = 'pendiente_pago' and created_at < now() - make_interval(mins => v_hold);

  if (select count(*) from public.orders o
       where regexp_replace(o.customer_phone, '\D', '', 'g') = v_digits
         and o.status in ('pendiente_pago','pendiente_confirmacion')) >= 3 then
    raise exception 'Ya tenés pedidos pendientes. Esperá la confirmación o contactanos por WhatsApp.';
  end if;

  insert into public.orders (customer_name, customer_phone) values (v_name, v_phone)
  returning id, access_token into v_order_id, v_token;

  for v_item in
    select (e->>'product_id')::uuid as pid, (e->>'quantity')::int as qty
      from jsonb_array_elements(p_items) e
  loop
    if v_item.qty is null or v_item.qty < 1 or v_item.qty > 20 then
      raise exception 'Cantidad inválida.';
    end if;
    select * into v_prod from public.products where id = v_item.pid and active for update;
    if not found then raise exception 'Uno de los productos ya no está disponible.'; end if;
    if v_prod.stock < v_item.qty then
      raise exception 'No hay stock suficiente de "%". Disponible: %.', v_prod.name, v_prod.stock;
    end if;

    update public.products set stock = stock - v_item.qty where id = v_prod.id;
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
      values (v_order_id, v_prod.id, v_prod.name, v_prod.price, v_item.qty);
    v_total := v_total + v_prod.price * v_item.qty;
    v_summary := v_summary || jsonb_build_object('name', v_prod.name, 'quantity', v_item.qty, 'unit_price', v_prod.price);
  end loop;

  update public.orders set total = v_total where id = v_order_id;

  return json_build_object('id', v_order_id, 'token', v_token, 'total', v_total,
                           'items', v_summary, 'hold_minutes', v_hold, 'name', v_name);
end $$;

create or replace function public.mark_order_proof_sent(p_id uuid, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.orders set status = 'pendiente_confirmacion'
   where id = p_id and access_token = p_token and status = 'pendiente_pago';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Guarda atómicamente las franjas de un día de la semana (solo admin).
-- p_ranges: [{"start_time":"09:00","end_time":"12:00"}, ...]
create or replace function public.save_working_day(p_weekday int, p_active boolean, p_ranges jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'No autorizado.'; end if;
  if p_weekday not between 0 and 6 then raise exception 'Día inválido.'; end if;

  delete from public.working_hours where weekday = p_weekday;

  insert into public.working_hours (weekday, start_time, end_time, active)
  select p_weekday, r.start_time, r.end_time, p_active
    from jsonb_to_recordset(coalesce(p_ranges, '[]'::jsonb)) as r(start_time time, end_time time);
end $$;

-- Permisos de ejecución
revoke all on function public.get_available_slots(uuid, date) from public;
revoke all on function public.create_reservation(uuid, date, time, text, text) from public;
revoke all on function public.mark_reservation_proof_sent(uuid, uuid) from public;
revoke all on function public.create_order(text, text, jsonb) from public;
revoke all on function public.mark_order_proof_sent(uuid, uuid) from public;
revoke all on function public.save_working_day(int, boolean, jsonb) from public;
revoke all on function public.is_admin() from public;

grant execute on function public.get_available_slots(uuid, date) to anon, authenticated;
grant execute on function public.create_reservation(uuid, date, time, text, text) to anon, authenticated;
grant execute on function public.mark_reservation_proof_sent(uuid, uuid) to anon, authenticated;
grant execute on function public.create_order(text, text, jsonb) to anon, authenticated;
grant execute on function public.mark_order_proof_sent(uuid, uuid) to anon, authenticated;
grant execute on function public.save_working_day(int, boolean, jsonb) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. STORAGE (imágenes de productos, logo y portada)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-images', 'public-images', true, 3145728,
        array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/svg+xml'];

drop policy if exists "public images read" on storage.objects;
create policy "public images read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'public-images');

drop policy if exists "admin images insert" on storage.objects;
create policy "admin images insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'public-images' and (select public.is_admin()));

drop policy if exists "admin images update" on storage.objects;
create policy "admin images update" on storage.objects
  for update to authenticated using (bucket_id = 'public-images' and (select public.is_admin()));

drop policy if exists "admin images delete" on storage.objects;
create policy "admin images delete" on storage.objects
  for delete to authenticated using (bucket_id = 'public-images' and (select public.is_admin()));
