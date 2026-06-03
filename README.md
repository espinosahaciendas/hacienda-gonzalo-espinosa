# Gonzalo Espinosa Hacienda - App web real

Esta carpeta es el inicio de la version web real del sistema.

El prototipo visual anterior queda intacto en `web_prototipo`. Esta app nueva ya funciona con servidor propio y una API interna.

## Abrir localmente

```powershell
cd app_web_real
node server.js
```

Luego abrir:

```text
http://localhost:4102
```

Tambien se puede iniciar con doble clic en:

```text
app_web_real/iniciar_app_web_real.bat
```

## Modos de datos

### Backup local

Es el modo actual. La primera vez crea una copia de trabajo desde el backup exportado por el prototipo:

```text
database/backup-gonzalo-espinosa-2026-05-29.json
```

La copia editable queda en:

```text
app_web_real/data/local-db.json
```

Sirve para seguir viendo y probando datos sin tocar el backup original.

### PostgreSQL

Cuando tengamos creada la base, la app puede leer desde PostgreSQL usando:

```powershell
npm install
$env:DATABASE_URL="postgres://usuario:password@host:5432/base"
node server.js
```

Si `DATABASE_URL` existe, la app usa PostgreSQL. Si no existe, usa el backup local.

## APIs iniciales

- `GET /api/health`
- `GET /api/clientes`
- `POST /api/clientes`
- `PUT /api/clientes/:id`
- `GET /api/clientes/:id/establecimientos`
- `GET /api/categorias`
- `GET /api/operaciones`
- `POST /api/operaciones`
- `GET /api/operaciones/:id`
- `POST /api/operaciones/:id/venta-lineas`
- `POST /api/operaciones/:id/liquidacion`
- `GET /api/cuenta-corriente/resumen`

## Modulo Clientes

Ya permite:

- alta;
- edicion;
- busqueda;
- control de duplicados por razon social;
- control de duplicados por CUIT;
- carga de establecimientos y RENSPA asociados al cliente.

## Proximo paso

El siguiente ajuste del modulo Clientes es llevar estos RENSPA a la carga de operaciones:

- sugerir RENSPA asociados al elegir vendedor/comprador;
- permitir RENSPA manual si no esta cargado;
- ofrecer guardarlo automaticamente en la ficha del cliente.

## Modulo Operaciones

Ya permite una primera alta de borrador con:

- fecha;
- tipo de operacion;
- destino;
- vendedor;
- comprador;
- consignataria cuando no es venta directa;
- RENSPA origen/destino sugeridos por cliente;
- RENSPA manual con opcion de guardarlo en la ficha del cliente;
- DTE;
- condiciones o minuta de la operacion.

Tambien permite cargar lineas de venta en una operacion:

- categoria existente o nueva;
- cabezas;
- kg bruto;
- desbaste vendedor;
- kg neto vendedor automatico con redondeo comercial;
- precio por kg o por cabeza;
- opcion de comprador con kilos/precio diferente;
- recalculo del total de la operacion.

La liquidacion inicial ya permite:

- importe bruto vendedor y comprador de solo lectura;
- importe facturado comun;
- IVA editable por parte;
- efectivo separado por parte;
- comision sobre facturado;
- comision sobre efectivo;
- comprobante por parte;
- neto de liquidacion separado del neto total de la operacion.
