# Construir


El nombre de la app es **Construir**; por dentro (repo, servicio y carpetas del servidor) sigue llamándose `obras`.
App para llevar los pendientes de una obra entre el propietario, el arquitecto y el constructor.
Se instala en el celular (PWA) y cada persona entra con su link personal, sin contraseña.

## Qué hace

- El propietario o el arquitecto cargan las tareas, por lugar de la casa y con prioridad.
- En la hoja de Presupuestos, el constructor cotiza una tarea sola o varias juntas con un solo precio y una sola
  fecha de entrega (pesos o dólares). Al tocar un presupuesto se abre una ventana con lo cargado: monto, fecha de
  entrega, estado y pagos.
- El propietario o el arquitecto aprueban o rechazan el presupuesto (el rechazo pide motivo).
- El constructor marca la tarea como realizada; el propietario o el arquitecto la verifican o la devuelven con el motivo.
- Fotos de antes y después, comentarios, pagos y un historial de quién hizo qué y cuándo.
- Inicio con cuadros y carpetas: todas las obras de la persona, cada una con su tipo (vivienda, clínica, local…), avance, lo que espera su
  respuesta, plazos vencidos y saldo. Desde ahí se crean obras nuevas y se entra a cada una.
- Proveedores: desde Inicio se da de alta un proveedor (plomero, electricista…) con el trabajo que se le encarga en
  una obra. Recibe un link y ve solo ese trabajo: lo presupuesta, le pone fecha, sube fotos y lo marca al terminar.
- Quien llega sin link ve una página que explica la app, pensada para un arquitecto.
- Resumen: avance, tareas con plazo vencido y plata presupuestada, aprobada, pagada y saldo por lugar.

Estados de una tarea: sin presupuesto → presupuesto a aprobar → aprobada → realizada → terminada (o devuelta).

## Cómo está hecha

- `servidor/`: Node 22 sin dependencias (`node:http` y `node:sqlite`). La base y las fotos van a la carpeta de datos.
- `web/`: las pantallas, en JavaScript simple, sin paso de compilación.
- `pruebas/`: pruebas del servidor (`npm test`).
- `datos-iniciales/obras.json`: las obras con las que arranca (Casa con sus tareas de `casa.json`, y las sedes, vacías).

## Correrla

```bash
npm start
```

Variables: `PUERTO` (3400), `DIR_DATOS` (`./datos`), `ESCUCHAR` (`127.0.0.1`), `URL_BASE`, `OBRA_NOMBRE`, `PROPIETARIO`.

La primera vez crea las obras iniciales y deja en `<DIR_DATOS>/primer-acceso.txt` un link que las abre todas juntas.
Desde la pestaña Personas, el propietario crea los links del arquitecto y del constructor.

## Servidor

`infra/instalar.sh` instala o actualiza todo y se puede correr las veces que haga falta. Lo corre Alldoo como root,
parado en `/opt/obras`, después de bajar el código:

- baja un Node 22 propio a `/opt/obras-node` (no toca el Node del sistema ni lo demás que corra en la máquina);
- corre las pruebas y, si fallan, no instala nada;
- crea el usuario `obras`, los datos en `/var/lib/obras` y el servicio `obras` (`infra/obras.service`);
- con la variable `DOMINIO`, suma un sitio de nginx para esa dirección y le saca el certificado https.

Sin https el celular no deja instalarla como app. La primera vez, los links de acceso quedan en
`/var/lib/obras/primer-acceso.txt`.

## Lo que todavía no tiene

Avisos al celular o por WhatsApp, dependencias entre tareas,
uso sin señal (hoy abre las pantallas pero necesita conexión para los datos), y exportar a PDF o Excel.
