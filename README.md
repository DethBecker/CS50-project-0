# CRM Taller

CRM para un taller de electrónica: contactos (prospectos y clientes), cotizador,
historial de cotizaciones y compras, y seguimiento de los equipos en el taller.

Servicios contemplados: reparación y diagnóstico electrónico, mantenimiento de
laptops / computadoras / consolas, impresión 3D, modelado 3D y venta de piezas
estandarizadas.

## Cómo ejecutarlo

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Abre <http://127.0.0.1:5000>. Los datos se guardan en `crm.db` (SQLite), que se
crea solo la primera vez.

| Variable    | Para qué sirve                                   | Por defecto |
|-------------|--------------------------------------------------|-------------|
| `CRM_HOST`  | Interfaz de red. `0.0.0.0` lo abre a la red local | `127.0.0.1` |
| `CRM_PORT`  | Puerto                                           | `5000`      |
| `CRM_DB`    | Ruta del archivo de base de datos                | `crm.db`    |

> La aplicación todavía **no tiene inicio de sesión**. Por eso solo escucha en
> la propia máquina; antes de abrirla a la red con `CRM_HOST=0.0.0.0` conviene
> agregar autenticación.

## Módulos

- **Tablero** – ingresos del mes y acumulados, prospectos/clientes, cotizaciones
  abiertas, equipos en taller por estado e ingresos por tipo de servicio.
- **Contactos** – cada entrada es *prospecto* o *cliente*. La ficha muestra el
  total gastado, el historial de servicios y productos adquiridos, el historial
  de cotizaciones, sus equipos y comentarios. Un prospecto pasa a cliente
  automáticamente al registrar su primera compra.
- **Cotizador** – una cotización se arma con partidas de tres calculadoras:
  - *Servicio*: horas × tarifa + refacciones con margen + recargo de urgencia.
  - *Impresión 3D*: material por gramo + uso de máquina + energía, merma por
    fallos, post-proceso, margen, urgencia y cobro mínimo.
  - *Pieza estandarizada*: del catálogo (descuenta existencia al cobrar) o
    captura libre.

  Todas las variables están siempre activas; sus valores base se cambian en
  **Configuración**.
- **Cotizaciones** – historial con estados (borrador, enviada, aceptada,
  rechazada, pagada), vista imprimible/PDF y «Registrar pago», que pasa las
  partidas al historial del cliente.
- **Taller** – tablero tipo kanban de órdenes (recibido → diagnóstico → … →
  entregado) con bitácora de avances por equipo y fecha promesa.
- **Recordatorios y cumpleaños** – cada contacto puede tener fecha de nacimiento
  y recordatorios de seguimiento con fecha; el tablero muestra los pendientes y
  los cumpleaños de los próximos 30 días.
- **Inventario de filamento** – rollos con material, cantidad, costo y fecha de
  adquisición. El material restante se descuenta al autorizar («Marcar
  aceptada») una cotización de impresión 3D que use un rollo, al registrar una
  pieza fallida y al fabricar stock de una pieza del catálogo. Si la cotización
  deja de estar autorizada, el material regresa al rollo.
- **Catálogo de piezas** y **Configuración** (datos del negocio, IVA, tarifas,
  márgenes y materiales).

## Arquitectura y crecimiento

La interfaz web (`static/`) solo consume la API REST de `app.py` (`/api/v1/...`),
así que cualquier otro equipo de la red puede usar los mismos datos. Ejemplo,
reportar el avance de una orden desde otra máquina:

```bash
curl -X POST http://SERVIDOR:5000/api/v1/equipos/1/estado \
     -H 'Content-Type: application/json' \
     -d '{"estado": "listo", "nota": "Pruebas terminadas"}'
```

Pasos naturales para la integración en red: autenticación (usuarios y llaves de
API), respaldo automático de `crm.db`, y registro de los aparatos de la red
(impresoras 3D, estaciones de trabajo) para que reporten su estado a la API.
