# Maciel Barbershop — Web con reservas, tienda y panel administrativo

Sitio estático (HTML/CSS/JS, sin build de frameworks) + **Supabase** (PostgreSQL, Auth, Storage) + **GitHub Pages**.
Todo se guarda en una base de datos real; no se usa `localStorage` para datos del negocio.

```
maciel-barbershop/
├─ .github/workflows/deploy.yml   # publica /public en GitHub Pages
├─ scripts/build-config.js   # genera js/config.js desde variables de entorno
├─ supabase/schema.sql       # tablas, restricciones, RLS, funciones RPC, storage
└─ public/
   ├─ index.html             # sitio público
   ├─ css/ (base.css, site.css)
   ├─ js/  (config.js, supabase.js, utils.js, public.js)
   ├─ assets/logo.svg        # monograma MB provisorio
   └─ admin/ (index.html, admin.css, admin.js)   # panel privado
```

## Arquitectura (y por qué)

- **Los clientes nunca escriben tablas directamente.** Reservas y pedidos se crean con funciones SQL (`create_reservation`, `create_order`) que validan en el servidor: horario disponible, precio y seña, stock y cantidades. Las tablas `reservations`, `orders` y `order_items` solo son accesibles por administradores (RLS).
- **Sin dobles reservas:** además de la validación, hay una *exclusion constraint* en PostgreSQL que impide que dos reservas no canceladas se solapen, aunque dos personas reserven en el mismo instante.
- **Administradores:** solo existen si están en la tabla `administrators`, que únicamente se modifica desde el SQL Editor. Ningún usuario puede otorgarse permisos.
- **Sin contraseñas en el código.** Login con Supabase Auth. La *anon key* es pública por diseño; la *service_role key* **nunca** se usa en este proyecto.
- Una reserva sin pago se libera sola tras `hold_minutes` (configurable, 60 por defecto). Un pedido sin pago libera su stock igual.

## 1. Crear el proyecto en Supabase

1. Entrá a <https://supabase.com>, creá un proyecto nuevo y guardá la contraseña de la base.
2. **SQL Editor → New query**: pegá todo `supabase/schema.sql` y ejecutalo (Run). Debe terminar sin errores.
3. **Authentication → Providers → Email**: dejá habilitado Email y **desactivá "Allow new users to sign up"** (Authentication → Sign In / Providers → "Allow new users to sign up" OFF). Así nadie puede registrarse por su cuenta.
4. **Project Settings → API**: copiá la **Project URL** y la **anon public key**.

## 2. Crear el primer administrador

1. **Authentication → Users → Add user → Create new user**: ingresá el correo y una contraseña fuerte. Marcá "Auto Confirm User".
2. En **SQL Editor** ejecutá (cambiando el correo):

```sql
insert into public.administrators (user_id, full_name)
select id, 'Jere Maciel' from auth.users where email = 'TU-CORREO@ejemplo.com';
```

3. Ingresá a `https://TU-USUARIO.github.io/TU-REPO/admin/` con ese correo y contraseña. Si la cuenta no está en `administrators`, el panel la rechaza y cierra la sesión.

Para sumar otro administrador, repetí los pasos 1 y 2 con su correo.

## 3. Desplegar en GitHub Pages

1. Subí todo el contenido de esta carpeta a un repositorio de GitHub (rama `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Cargá las claves de Supabase, de una de estas dos formas:
   - **Con secrets (recomendado):** Settings → Secrets and variables → Actions → New repository secret: `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
   - **A mano:** editá `public/js/config.js` con esos dos valores y hacé commit (la anon key es pública por diseño).
4. Cada push a `main` publica el sitio. Queda en `https://TU-USUARIO.github.io/TU-REPO/` y el panel en `.../admin/`.
5. Opcional: en **Authentication → URL Configuration** de Supabase, poné la URL del sitio como *Site URL*.

> GitHub Pages no permite configurar headers (CSP, HSTS). La seguridad real depende de RLS en Supabase, que ya está en `schema.sql`. Además, `robots.txt` solo funciona si el sitio está en la raíz de un dominio (usuario.github.io o dominio propio); el panel ya tiene `noindex`.

## 4. Cargar el negocio desde el panel (no hay datos ficticios)

Mientras no cargues nada, el sitio muestra estados vacíos. Entrá a `/admin` y completá, en este orden:

1. **Configuración**: logo MB, imagen de portada, WhatsApp, alias de Mercado Pago, titular, seña general, ciudad, Instagram.
2. **Servicios**: creá tus servicios con precio y duración (ej.: Corte clásico, Corte + barba, Degradado).
3. **Horarios**: abrí cada día con sus franjas (ej.: lunes 09:00–12:00 y 15:00–20:00), elegí el intervalo entre turnos y bloqueá feriados.
4. **Productos**: fotos, precios y stock.

Los cambios se guardan en Supabase y se reflejan al instante en la web pública.

## 5. WhatsApp y Mercado Pago

**WhatsApp**
- En Configuración → *WhatsApp del negocio* poné el número con código de país, **sin + ni espacios**. Argentina (celular): `549` + código de área sin 0 + número sin 15. Ej.: `5493511234567`.
- Al tocar "Enviar comprobante por WhatsApp" se abre `wa.me` con el mensaje armado. **El cliente adjunta la captura a mano** (WhatsApp no permite adjuntar desde un enlace).
- Podés editar los textos en Configuración → *Mensajes de WhatsApp*. Variables: reservas `{nombre} {servicio} {dia} {hora} {sena}`; compras `{nombre} {producto} {cantidad} {total}`. El botón "Restaurar" vuelve a los mensajes originales.

**Mercado Pago / transferencia**
- Cargá tu **alias** y el **titular** en Configuración. Se muestran con botón "Copiar". No hay integración de cobro automático: el pago se verifica a mano.
- Mercado Pago → Perfil → Alias: podés verlo o cambiarlo desde la app.

## 6. Flujo de estados

| Cuándo | Estado |
|---|---|
| El cliente confirma la solicitud | **Pendiente de pago** |
| El cliente toca "Enviar comprobante por WhatsApp" | **Pendiente de confirmación** (no implica pago recibido) |
| El dueño verifica el pago y toca "Confirmar pago" | **Confirmada** |
| Turno realizado | **Finalizada** |
| Cancelada por el dueño o vencida sin pago | **Cancelada** (libera horario/stock) |

Los pedidos siguen el mismo esquema, con **Entregado** al final.

## 7. Seguridad: resumen de RLS

- `business_settings`, `working_hours`, `blocked_dates`: lectura pública; escritura solo admin.
- `services`, `products`: lectura pública solo de los activos; escritura solo admin.
- `reservations`, `orders`, `order_items`: **solo admin** (los clientes usan RPC).
- `administrators`: cada usuario solo ve su fila; sin insert/update/delete desde el cliente.
- Storage `public-images`: lectura pública, escritura solo admin (máx. 3 MB, JPG/PNG/WebP/SVG).

## 8. Probar que todo funciona

1. Cargá un servicio, un horario de hoy o mañana y tu WhatsApp en el panel.
2. En el sitio, reservá un turno: debe aparecer la pantalla de seña y, al tocar el botón, abrirse WhatsApp con tus datos.
3. Intentá reservar el mismo horario desde otro navegador: debe decir que ya no está disponible.
4. En `/admin → Reservas`, confirmá el pago y verificá que el estado cambia.
5. Cambiá un precio en Servicios y recargá el sitio: se actualiza.

## Notas

- El logo incluido es un monograma MB provisorio. Subí el logo real en Configuración.
- Si querés cobrar automáticamente con Mercado Pago (Checkout Pro + webhooks) harían falta Supabase Edge Functions con tu access token; hoy se evita a propósito para no exponer secretos y mantener el flujo manual que pediste.

## Decisiones y límites a tener en cuenta

- **"Pendiente de confirmación" no vence solo.** Una reserva en "pendiente de pago" se libera sola pasados `hold_minutes`; en cambio, si el cliente tocó "Enviar comprobante" (pendiente de confirmación), el horario queda bloqueado hasta que el dueño confirme o cancele desde el panel.
- **Anti-abuso:** máximo 3 reservas/pedidos pendientes por teléfono. Alguien con muchos teléfonos podría bloquear horarios por `hold_minutes`; si pasara, bajá ese valor en Horarios o sumá un captcha (Cloudflare Turnstile).
- **Zona horaria:** los horarios se calculan en `America/Argentina/Cordoba` dentro de la base. Para otra zona, cambiá ese texto en `schema.sql`.
- **Imágenes:** no se usaron las fotos de Instagram ni de Legends Grooming Company (no llegaron al proyecto). Subí tu logo real, la portada y las fotos de productos desde el panel.
