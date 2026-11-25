# Obras

App para llevar los pendientes de una obra entre el propietario, el arquitecto y el constructor.
Se instala en el celular (PWA) y cada persona entra con su link personal, sin contraseña.

## Qué hace

- El propietario o el arquitecto cargan las tareas, por lugar de la casa y con prioridad.
- El constructor le pone presupuesto (pesos o dólares) y plazo probable a cada tarea.
- El propietario o el arquitecto aprueban o rechazan el presupuesto (el rechazo pide motivo).
- El constructor marca la tarea como realizada; el propietario o el arquitecto la verifican o la devuelven con el motivo.
- Fotos de antes y después, comentarios, pagos y un historial de quién hizo qué y cuándo.
- Varias obras: quien dirige una obra puede crear otra desde la pestaña Obras y pasar de una a otra.
- Resumen: avance, tareas con plazo vencido y plata presupuestada, aprobada, pagada y saldo por lugar.

Estados de una tarea: sin presupuesto → presupuesto a aprobar → aprobada → realizada → terminada (o devuelta).

## Cómo está hecha

- `servidor/`: Node 22 sin dependencias (`node:http` y `node:sqlite`). La base y las fotos van a la carpeta de datos.
- `web/`: las pantallas, en JavaScript simple, sin paso de compilación.
- `pruebas/`: pruebas del servidor (`npm test`).
- `datos-iniciales/casa.json`: las tareas con las que arranca la primera obra.

## Correrla

```bash
npm start
```

Variables: `PUERTO` (3400), `DIR_DATOS` (`./datos`), `ESCUCHAR` (`127.0.0.1`), `URL_BASE`, `OBRA_NOMBRE`, `PROPIETARIO`.

La primera vez crea la obra inicial y deja el link del propietario en `<DIR_DATOS>/primer-acceso.txt`.
Desde la pestaña Personas, el propietario crea los links del arquitecto y del constructor.

## Servidor

`infra/obras.service` es el servicio de systemd (código en `/opt/obras`, datos en `/var/lib/obras`).
`scripts/desplegar.sh` corre las pruebas, reinicia y comprueba `/salud`. Tiene que ir detrás de https
(Caddy o nginx): sin https el celular no deja instalarla como app.

## Lo que todavía no tiene

Avisos al celular o por WhatsApp, varios gremios que vean solo lo suyo, dependencias entre tareas,
uso sin señal (hoy abre las pantallas pero necesita conexión para los datos), y exportar a PDF o Excel.
