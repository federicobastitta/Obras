import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp } from '../servidor/app.js';
import { crearObra } from '../servidor/db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = fs.mkdtempSync(path.join(os.tmpdir(), 'obras-'));
const { servidor, db } = crearApp({ dirDatos, dirWeb: path.join(raiz, 'web') });
const obra = crearObra(db, { nombre: 'Casa de prueba', propietario: 'Dueña', tareas: [{ lugar: 'Cocina', texto: 'Instalar extractor' }] });
const otra = crearObra(db, { nombre: 'Otra obra', propietario: 'Otro dueño', tareas: [{ lugar: 'Baño', texto: 'Ajena' }] });

await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${servidor.address().port}`;
test.after(() => servidor.close());

async function pedir(token, metodo, ruta, cuerpo, cabeceras = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + token, ...(cuerpo && !Buffer.isBuffer(cuerpo) ? { 'Content-Type': 'application/json' } : {}), ...cabeceras },
    body: cuerpo ? (Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  });
  const tipo = r.headers.get('content-type') || '';
  return { codigo: r.status, datos: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

const duena = obra.token;
let constructor;
let tareaId;

test('sin link válido no se entra', async () => {
  assert.equal((await pedir('nada', 'GET', '/api/yo')).codigo, 401);
});

test('el propietario ve su obra y suma al constructor', async () => {
  const yo = await pedir(duena, 'GET', '/api/yo');
  assert.equal(yo.datos.persona.rol, 'propietario');
  assert.equal(yo.datos.obra.nombre, 'Casa de prueba');
  const alta = await pedir(duena, 'POST', '/api/personas', { nombre: 'Constructor', rol: 'constructor' });
  assert.equal(alta.codigo, 201);
  constructor = alta.datos.token;
  const lista = await pedir(duena, 'GET', '/api/tareas');
  assert.equal(lista.datos.tareas.length, 1);
  tareaId = lista.datos.tareas[0].id;
});

test('el constructor no puede crear tareas ni ver personas', async () => {
  assert.equal((await pedir(constructor, 'POST', '/api/tareas', { texto: 'x' })).codigo, 403);
  assert.equal((await pedir(constructor, 'GET', '/api/personas')).codigo, 403);
});

test('nadie ve tareas de otra obra', async () => {
  const ajena = (await pedir(otra.token, 'GET', '/api/tareas')).datos.tareas[0].id;
  assert.equal((await pedir(duena, 'GET', '/api/tareas/' + ajena)).codigo, 404);
  assert.equal((await pedir(constructor, 'POST', `/api/tareas/${ajena}/accion`, { accion: 'realizada' })).codigo, 404);
});

test('circuito: presupuesto, rechazo, nuevo presupuesto, aprobación, realizada, devuelta, verificada', async () => {
  const acc = (tk, c) => pedir(tk, 'POST', `/api/tareas/${tareaId}/accion`, c);
  assert.equal((await acc(duena, { accion: 'presupuestar', monto: 1000, plazo: '2026-12-10' })).codigo, 403);
  assert.equal((await acc(constructor, { accion: 'presupuestar', monto: 1000 })).codigo, 400, 'el plazo es obligatorio');
  assert.equal((await acc(constructor, { accion: 'presupuestar', monto: 150000, moneda: 'ARS', plazo: '2026-12-10', nota: 'Con materiales' })).codigo, 200);
  assert.equal((await acc(constructor, { accion: 'realizada' })).codigo, 409, 'falta aprobar');
  assert.equal((await acc(duena, { accion: 'rechazar' })).codigo, 400, 'pide motivo');
  assert.equal((await acc(duena, { accion: 'rechazar', motivo: 'Muy caro' })).codigo, 200);
  assert.equal((await acc(constructor, { accion: 'presupuestar', monto: 120000, plazo: '2026-12-12' })).codigo, 200);
  assert.equal((await acc(constructor, { accion: 'aprobar' })).codigo, 403);
  assert.equal((await acc(duena, { accion: 'aprobar' })).codigo, 200);
  assert.equal((await acc(constructor, { accion: 'presupuestar', monto: 999999, plazo: '2026-12-12' })).codigo, 409, 'aprobado no se cambia');
  assert.equal((await acc(constructor, { accion: 'realizada' })).codigo, 200);
  assert.equal((await acc(duena, { accion: 'devolver', motivo: 'Quedó flojo' })).codigo, 200);
  assert.equal((await acc(constructor, { accion: 'realizada' })).codigo, 200);
  assert.equal((await acc(duena, { accion: 'verificar' })).codigo, 200);

  const d = (await pedir(constructor, 'GET', '/api/tareas/' + tareaId)).datos;
  assert.equal(d.tarea.estado, 'verificada');
  assert.equal(d.tarea.monto, 120000);
  assert.deepEqual(
    d.eventos.map((e) => e.tipo),
    ['creada', 'presupuestada', 'rechazada', 'presupuestada', 'aprobada', 'realizada', 'devuelta', 'realizada', 'verificada'],
  );
});

test('pagos: solo dirección, y se suman en la lista', async () => {
  assert.equal((await pedir(constructor, 'POST', `/api/tareas/${tareaId}/pagos`, { monto: 1, fecha: '2026-12-01' })).codigo, 403);
  assert.equal((await pedir(duena, 'POST', `/api/tareas/${tareaId}/pagos`, { monto: 50000, fecha: '2026-12-01', nota: 'Anticipo' })).codigo, 201);
  assert.equal((await pedir(duena, 'POST', `/api/tareas/${tareaId}/pagos`, { monto: 20000.5, fecha: '2026-12-02' })).codigo, 400);
  const t = (await pedir(duena, 'GET', '/api/tareas')).datos.tareas[0];
  assert.equal(t.pagado, 50000);
});

test('fotos y comentarios', async () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
  assert.equal((await pedir(constructor, 'POST', `/api/tareas/${tareaId}/fotos?momento=despues`, Buffer.from('<html>'))).codigo, 400);
  const sub = await pedir(constructor, 'POST', `/api/tareas/${tareaId}/fotos?momento=despues`, jpg);
  assert.equal(sub.codigo, 201);
  const foto = await pedir(duena, 'GET', '/api/fotos/' + sub.datos.id);
  assert.equal(foto.codigo, 200);
  assert.ok(foto.datos.equals(jpg));
  assert.equal((await pedir(otra.token, 'GET', '/api/fotos/' + sub.datos.id)).codigo, 404, 'otra obra no la ve');
  assert.equal((await pedir(constructor, 'POST', `/api/tareas/${tareaId}/comentarios`, { texto: 'Listo <b>ya</b>' })).codigo, 201);
  const t = (await pedir(duena, 'GET', '/api/tareas')).datos.tareas[0];
  assert.equal(t.fotos, 1);
  assert.equal(t.comentarios, 1);
  assert.equal((await pedir(duena, 'DELETE', '/api/fotos/' + sub.datos.id)).codigo, 200);
});

test('dar de baja a una persona le corta el acceso', async () => {
  const personas = (await pedir(duena, 'GET', '/api/personas')).datos.personas;
  const c = personas.find((x) => x.rol === 'constructor');
  assert.equal((await pedir(duena, 'PATCH', '/api/personas/' + c.id, { activa: false })).codigo, 200);
  assert.equal((await pedir(constructor, 'GET', '/api/yo')).codigo, 401);
  const yo = personas.find((x) => x.rol === 'propietario');
  assert.equal((await pedir(duena, 'PATCH', '/api/personas/' + yo.id, { activa: false })).codigo, 409);
});

test('archivos: sirve la página y no deja salir de la carpeta web', async () => {
  assert.equal((await fetch(base + '/salud')).status, 200);
  assert.equal((await fetch(base + '/..%2Fpackage.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/servidor/app.js')).status, 404);
});
