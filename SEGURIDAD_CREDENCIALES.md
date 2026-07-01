# Seguridad de credenciales y backups

Este sistema maneja datos reales de clientes, operaciones, liquidaciones, cuenta corriente y documentos. Por eso, las credenciales y backups nunca deben mezclarse con los archivos que se suben a GitHub o Render.

## Nunca subir a GitHub

- `app_web_real/data/conexion_supabase_privada.txt`
- `app_web_real/data/local-db.json`
- `app_web_real/data/postgres-runtime-cache.json`
- `app_web_real/data/backups/`
- archivos `.env`
- logs `server*.log`

La raiz del proyecto tiene un `.gitignore` para bloquear estos archivos, pero igual conviene revisar antes de subir cambios.

## Donde guardar claves

En produccion, las claves deben estar solamente en Render:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `AUTH_REQUIRED=1`
- `COOKIE_SECURE=1`
- `NODE_ENV=production`
- `BACKUP_DOWNLOAD_ENABLED=0`
- `CONSULTA_DOCUMENTS_ENABLED=0`

`BACKUP_DOWNLOAD_ENABLED=0` deja bloqueada la descarga del backup completo desde la web. Para hacer un backup puntual, se puede cambiar temporalmente a `1`, generar el backup y volver a `0`.

`CONSULTA_DOCUMENTS_ENABLED=0` evita que usuarios de solo consulta vean todos los documentos adjuntos. Si mas adelante se crea un usuario para clientes, primero hay que agregar permisos por cliente/documento antes de habilitarlo.

Para uso local, guardar archivos de conexion fuera del proyecto, por ejemplo:

```text
C:\Users\Usuario\Documents\Credenciales privadas\
```

## Si una credencial pudo haberse expuesto

1. Entrar a Supabase.
2. Cambiar/rotar la password o key afectada.
3. Actualizar la variable correspondiente en Render.
4. Hacer `Save, rebuild and deploy`.
5. Verificar que la app quede `Live`.

## Regla practica

El codigo puede subirse.  
Los datos reales, backups y claves no se suben nunca.
