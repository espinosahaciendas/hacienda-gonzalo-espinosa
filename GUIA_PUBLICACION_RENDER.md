# Guia de publicacion en Render

## Objetivo

Publicar la aplicacion web real con acceso por navegador desde cualquier computadora, usando:

- Render para alojar la pagina y el servidor.
- Supabase/PostgreSQL como base de datos.
- Login obligatorio con usuarios ADMIN y CONSULTA.

## Archivos que se suben

Subir solamente el paquete limpio:

```text
deploy/hacienda-render-upload.zip
```

No subir nunca:

- `data/conexion_supabase_privada.txt`
- `data/local-db.json`
- `data/backups/`
- `node_modules/`

## Configuracion en Render

Crear un Web Service con estos valores:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

Variables de entorno:

```text
AUTH_REQUIRED=1
COOKIE_SECURE=1
NODE_ENV=production
DATABASE_URL=<pegar la conexion privada de Supabase>
```

La variable `DATABASE_URL` debe pegarse solo en Render, nunca en GitHub ni en el chat.

## Prueba posterior

Despues del deploy:

1. Abrir la URL `onrender.com`.
2. Ingresar con usuario ADMIN.
3. Verificar que aparezcan operaciones, clientes, cuenta corriente y reportes.
4. Ingresar con usuario CONSULTA.
5. Verificar que pueda consultar y que no pueda guardar, editar ni anular.

## Nota de uso

El plan gratuito de Render puede demorarse al abrir porque el servicio se duerme por inactividad. Para uso de oficina, conviene pasar a un plan pago cuando el sistema quede validado.
