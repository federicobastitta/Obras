import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp } from '../servidor/app.js';
import { crearObra, abrirBase, cargarTareas, altaDeObras } from '../servidor/db.js';
import { asegurarDemo } from '../servidor/demo.js';

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
  const ultimas = (await pedir(duena, 'GET', '/api/fotos')).datos.fotos;
  assert.deepEqual(ultimas.map((f) => [f.id, f.tarea_id, f.momento, f.persona]), [[sub.datos.id, tareaId, 'despues', 'Constructor']]);
  assert.deepEqual((await pedir(otra.token, 'GET', '/api/fotos')).datos.fotos, [], 'otra obra no las ve');
  assert.equal((await pedir(duena, 'DELETE', '/api/fotos/' + sub.datos.id)).codigo, 200);
});

test('presupuesto en grupo: un monto para varias tareas, se aprueba junto y el avance sigue por tarea', async () => {
  const ids = [];
  for (const texto of ['Picaporte baño', 'Cortina baño', 'Lavarropas']) {
    ids.push((await pedir(duena, 'POST', '/api/tareas', { texto, lugar: 'Baño' })).datos.id);
  }
  const cuerpo = { nombre: 'Baños', tareas: [ids[0], ids[1]], monto: 90000, moneda: 'ARS', plazo: '2026-12-20', nota: 'Todo junto' };
  assert.equal((await pedir(duena, 'POST', '/api/grupos', cuerpo)).codigo, 403, 'solo el constructor agrupa');
  assert.equal((await pedir(constructor, 'POST', '/api/grupos', { ...cuerpo, tareas: [ids[0]] })).codigo, 400, 'mínimo dos');
  assert.equal((await pedir(constructor, 'POST', '/api/grupos', { ...cuerpo, tareas: [ids[0], tareaId] })).codigo, 409, 'una ya terminada no entra');
  const alta = await pedir(constructor, 'POST', '/api/grupos', cuerpo);
  assert.equal(alta.codigo, 201);
  const gid = alta.datos.id;
  assert.equal((await pedir(constructor, 'POST', '/api/grupos', { ...cuerpo, tareas: [ids[1], ids[2]] })).codigo, 409, 'ya está en otro grupo');

  const acc = (tk, id, c) => pedir(tk, 'POST', `/api/tareas/${id}/accion`, c);
  assert.equal((await acc(constructor, ids[0], { accion: 'presupuestar', monto: 1, plazo: '2026-12-20' })).codigo, 409, 'no se presupuesta suelta');
  assert.equal((await acc(duena, ids[0], { accion: 'aprobar' })).codigo, 409, 'se aprueba el grupo');
  assert.equal((await pedir(duena, 'POST', `/api/tareas/${ids[0]}/pagos`, { monto: 10, fecha: '2026-12-01' })).codigo, 409);

  assert.equal((await pedir(duena, 'POST', `/api/grupos/${gid}/accion`, { accion: 'rechazar', motivo: 'Caro' })).codigo, 200);
  assert.equal((await pedir(constructor, 'GET', '/api/tareas/' + ids[0])).datos.tarea.estado, 'pendiente');
  assert.equal((await pedir(constructor, 'PATCH', '/api/grupos/' + gid, { ...cuerpo, monto: 80000 })).codigo, 200);
  assert.equal((await pedir(constructor, 'POST', `/api/grupos/${gid}/accion`, { accion: 'aprobar' })).codigo, 403);
  assert.equal((await pedir(duena, 'POST', `/api/grupos/${gid}/accion`, { accion: 'aprobar' })).codigo, 200);
  assert.equal((await pedir(constructor, 'PATCH', '/api/grupos/' + gid, { ...cuerpo, monto: 1 })).codigo, 409, 'aprobado no se cambia');
  assert.equal((await pedir(constructor, 'DELETE', '/api/grupos/' + gid)).codigo, 409, 'aprobado no se desarma');

  assert.equal((await acc(constructor, ids[0], { accion: 'realizada' })).codigo, 200);
  assert.equal((await pedir(duena, 'POST', `/api/grupos/${gid}/pagos`, { monto: 30000, fecha: '2026-12-05' })).codigo, 201);
  const lista = (await pedir(duena, 'GET', '/api/tareas')).datos;
  const g = lista.grupos.find((x) => x.id === gid);
  assert.deepEqual([g.estado, g.monto, g.pagado, g.cantidad], ['aprobado', 80000, 30000, 2]);
  assert.deepEqual(lista.tareas.filter((t) => t.grupo_id === gid).map((t) => t.estado), ['realizada', 'aprobada']);
  assert.equal((await pedir(otra.token, 'GET', '/api/grupos/' + gid)).codigo, 404, 'otra obra no lo ve');

  // Un grupo sin aprobar se puede desarmar: las tareas vuelven a quedar sin presupuesto.
  const extra = (await pedir(duena, 'POST', '/api/tareas', { texto: 'Espejo', lugar: 'Baño' })).datos.id;
  const g2 = (await pedir(constructor, 'POST', '/api/grupos', { tareas: [ids[2], extra], monto: 5000, plazo: '2026-12-22' })).datos.id;
  assert.equal((await pedir(constructor, 'DELETE', '/api/grupos/' + g2)).codigo, 200);
  const suelta = (await pedir(duena, 'GET', '/api/tareas/' + extra)).datos;
  assert.deepEqual([suelta.tarea.estado, suelta.tarea.grupo_id, suelta.tarea.plazo, suelta.grupo], ['pendiente', null, null, null]);
});

test('proveedores: entran con su link y ven solo el trabajo que se les encargó', async () => {
  assert.equal((await pedir(constructor, 'POST', '/api/proveedores', { nombre: 'x', rubro: 'y', tareas: ['z'] })).codigo, 403);
  assert.equal((await pedir(duena, 'POST', '/api/proveedores', { nombre: 'Pedro', rubro: 'Plomería', tareas: [] })).codigo, 400);
  const alta = await pedir(duena, 'POST', '/api/proveedores', { nombre: 'Pedro', rubro: 'Plomería', lugar: 'Baño', tareas: ['Cambiar flexibles', ' ', 'Destapar rejilla'] });
  assert.equal(alta.codigo, 201);
  assert.equal(alta.datos.tareas, 2);
  assert.equal(alta.datos.ids.length, 2);
  const plomero = alta.datos.token;
  const yo = (await pedir(plomero, 'GET', '/api/yo')).datos.persona;
  assert.deepEqual([yo.rol, yo.rubro, yo.limitado], ['constructor', 'Plomería', true]);

  const suyas = (await pedir(plomero, 'GET', '/api/tareas')).datos;
  assert.deepEqual(suyas.tareas.map((t) => t.texto), ['Cambiar flexibles', 'Destapar rejilla']);
  assert.deepEqual(suyas.grupos, [], 'no ve grupos de otros');
  assert.equal((await pedir(plomero, 'GET', '/api/tareas/' + tareaId)).codigo, 404, 'no ve tareas ajenas');
  assert.equal((await pedir(plomero, 'POST', `/api/tareas/${tareaId}/comentarios`, { texto: 'hola' })).codigo, 404);
  assert.equal((await pedir(plomero, 'GET', '/api/personas')).codigo, 403);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
  const ajena = (await pedir(duena, 'POST', `/api/tareas/${tareaId}/fotos`, jpg)).datos.id;
  assert.deepEqual((await pedir(plomero, 'GET', '/api/fotos')).datos.fotos, [], 'no ve fotos de trabajos ajenos');
  assert.ok(!(await pedir(duena, 'GET', '/api/fotos')).datos.fotos.some((f) => f.id === ajena), 'las que sube la dirección no van al Inicio');
  const gruposAjenos = (await pedir(duena, 'GET', '/api/tareas')).datos.grupos;
  assert.equal((await pedir(plomero, 'GET', '/api/grupos/' + gruposAjenos[0].id)).codigo, 404);

  // Presupuesta sus dos trabajos juntos; el constructor general no puede sumar tareas ajenas... y el plomero tampoco.
  const ids = suyas.tareas.map((t) => t.id);
  assert.equal((await pedir(plomero, 'POST', '/api/grupos', { tareas: [ids[0], tareaId], monto: 1, plazo: '2026-12-30' })).codigo, 404);
  const g = await pedir(plomero, 'POST', '/api/grupos', { nombre: 'Plomería baño', tareas: ids, monto: 70000, plazo: '2026-12-30' });
  assert.equal(g.codigo, 201);
  assert.equal((await pedir(plomero, 'GET', '/api/tareas')).datos.grupos.length, 1);
  assert.equal((await pedir(duena, 'POST', `/api/grupos/${g.datos.id}/accion`, { accion: 'aprobar' })).codigo, 200);
  assert.equal((await pedir(plomero, 'POST', `/api/tareas/${ids[0]}/accion`, { accion: 'realizada' })).codigo, 200);

  // La dirección ve a quién está encargada cada tarea, y puede encargar una tarea existente.
  const vista = (await pedir(duena, 'GET', '/api/tareas')).datos.tareas.find((t) => t.id === ids[0]);
  assert.deepEqual([vista.asignada_nombre, vista.asignada_rubro], ['Pedro', 'Plomería']);
  const nueva = (await pedir(duena, 'POST', '/api/tareas', { texto: 'Revisar termotanque', asignada_a: alta.datos.id })).datos.id;
  assert.equal((await pedir(plomero, 'GET', '/api/tareas/' + nueva)).codigo, 200);
  assert.equal((await pedir(duena, 'PATCH', '/api/tareas/' + nueva, { asignada_a: null })).codigo, 200);
  assert.equal((await pedir(plomero, 'GET', '/api/tareas/' + nueva)).codigo, 404, 'al sacársela deja de verla');
  assert.equal((await pedir(duena, 'POST', '/api/tareas', { texto: 'x', asignada_a: 999999 })).codigo, 400);
});

test('actividad: lo último que pasó, sin mezclar obras ni mostrar trabajos ajenos', async () => {
  const todos = (await pedir(duena, 'GET', '/api/actividad')).datos.eventos;
  assert.ok(todos.length > 5 && todos.length <= 30);
  assert.deepEqual(todos.map((e) => e.fecha), todos.map((e) => e.fecha).sort().reverse(), 'del más nuevo al más viejo');
  assert.ok(todos.every((e) => e.tarea && e.tipo));
  assert.ok(todos.some((e) => e.persona === 'Dueña') && todos.some((e) => e.rol === 'constructor'));
  // La obra ajena solo ve lo suyo.
  const ajenos = (await pedir(otra.token, 'GET', '/api/actividad')).datos.eventos;
  assert.ok(ajenos.every((e) => e.tarea === 'Ajena'));
  // El proveedor solo ve eventos de las tareas que tiene encargadas.
  const personas = (await pedir(duena, 'GET', '/api/personas')).datos.personas;
  const pedro = personas.find((x) => x.rubro === 'Plomería');
  const suyas = new Set((await pedir(pedro.token, 'GET', '/api/tareas')).datos.tareas.map((t) => t.texto));
  const vistos = (await pedir(pedro.token, 'GET', '/api/actividad')).datos.eventos;
  assert.ok(vistos.length > 0 && vistos.every((e) => suyas.has(e.tarea)));
  assert.equal((await pedir('nada', 'GET', '/api/actividad')).codigo, 401);
});

test('obras nuevas: las crea quien dirige, y arrancan vacías y separadas', async () => {
  assert.equal((await pedir(constructor, 'POST', '/api/obras', { nombre: 'Quincho' })).codigo, 403);
  assert.equal((await pedir(duena, 'POST', '/api/obras', { nombre: '  ' })).codigo, 400);
  const alta = await pedir(duena, 'POST', '/api/obras', { nombre: 'Quincho' });
  assert.equal(alta.codigo, 201);
  const yo = (await pedir(alta.datos.token, 'GET', '/api/yo')).datos;
  assert.equal(yo.obra.nombre, 'Quincho');
  assert.equal(yo.persona.nombre, 'Dueña');
  assert.equal(yo.persona.rol, 'propietario');
  assert.equal((await pedir(alta.datos.token, 'GET', '/api/tareas')).datos.tareas.length, 0);
  // Tipo de obra: se elige al crear y se puede cambiar; un tipo inventado queda vacío.
  const local = await pedir(duena, 'POST', '/api/obras', { nombre: 'Local', tipo: 'Local comercial' });
  assert.equal((await pedir(local.datos.token, 'GET', '/api/yo')).datos.obra.tipo, 'Local comercial');
  assert.equal((await pedir(constructor, 'PATCH', '/api/obra', { tipo: 'Oficina' })).codigo, 403);
  assert.equal((await pedir(local.datos.token, 'PATCH', '/api/obra', { nombre: 'Local Lanús', tipo: 'Oficina' })).codigo, 200);
  assert.deepEqual((await pedir(local.datos.token, 'GET', '/api/yo')).datos.obra, { id: yo.obra.id + 1, nombre: 'Local Lanús', tipo: 'Oficina', demo: false });
  assert.equal((await pedir(local.datos.token, 'PATCH', '/api/obra', { tipo: 'Castillo' })).datos.obra.tipo, '');
  assert.equal((await pedir(duena, 'GET', '/api/yo')).datos.obra.nombre, 'Casa de prueba', 'no toca otras obras');
  assert.equal((await pedir(alta.datos.token, 'GET', '/api/tareas/' + tareaId)).codigo, 404);
  assert.ok((await pedir(duena, 'GET', '/api/tareas')).datos.tareas.length >= 1);
});

test('archivos adjuntos: se suben por tipo permitido, se bajan como descarga y respetan los accesos', async () => {
  const pdf = Buffer.from('%PDF-1.4 plano de prueba');
  const ruta = `/api/tareas/${tareaId}/archivos?nombre=${encodeURIComponent('Plano baño.pdf')}`;
  assert.equal((await pedir(duena, 'POST', `/api/tareas/${tareaId}/archivos?nombre=virus.exe`, pdf)).codigo, 400);
  assert.equal((await pedir(duena, 'POST', `/api/tareas/${tareaId}/archivos?nombre=pagina.html`, pdf)).codigo, 400);
  const sub = await pedir(duena, 'POST', ruta, pdf);
  assert.equal(sub.codigo, 201);
  const r = await fetch(`${base}/api/archivos/${sub.datos.id}`, { headers: { Authorization: 'Bearer ' + constructor } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/octet-stream');
  assert.match(r.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''Plano%20ba%C3%B1o\.pdf$/);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(pdf));
  const d = (await pedir(constructor, 'GET', '/api/tareas/' + tareaId)).datos;
  assert.deepEqual(d.archivos.map((a) => [a.nombre, a.tamano, a.persona]), [['Plano baño.pdf', pdf.length, 'Dueña']]);
  assert.equal((await pedir(duena, 'GET', '/api/tareas')).datos.tareas.find((t) => t.id === tareaId).archivos, 1);
  assert.equal((await pedir(otra.token, 'GET', '/api/archivos/' + sub.datos.id)).codigo, 404, 'otra obra no lo ve');
  assert.equal((await pedir(constructor, 'DELETE', '/api/archivos/' + sub.datos.id)).codigo, 403, 'no lo subió él');
  assert.equal((await pedir(duena, 'DELETE', '/api/archivos/' + sub.datos.id)).codigo, 200);
  assert.equal((await pedir(duena, 'GET', '/api/archivos/' + sub.datos.id)).codigo, 404);
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

test('demostración: se carga con todo completo, no toca lo real y se borra entera', async () => {
  const antes = (await pedir(duena, 'GET', '/api/tareas')).datos.tareas.length;
  const ejecutor = (await pedir(duena, 'POST', '/api/personas', { nombre: 'Tmp', rol: 'constructor' })).datos.token;
  assert.equal((await pedir(ejecutor, 'POST', '/api/demo')).codigo, 403);
  const alta = await pedir(duena, 'POST', '/api/demo');
  assert.equal(alta.codigo, 201);
  assert.equal(alta.datos.obras.length, 2);
  assert.equal((await pedir(duena, 'POST', '/api/demo')).codigo, 409, 'no se carga dos veces');

  const [casa, clinica] = alta.datos.obras;
  const yo = (await pedir(casa.token, 'GET', '/api/yo')).datos;
  assert.deepEqual([yo.obra.demo, yo.obra.tipo, yo.persona.rol], [true, 'Vivienda', 'propietario']);
  assert.equal((await pedir(clinica.token, 'GET', '/api/yo')).datos.obra.tipo, 'Clínica o consultorio');

  const d = (await pedir(casa.token, 'GET', '/api/tareas')).datos;
  const estados = new Set(d.tareas.map((t) => t.estado));
  for (const e of ['pendiente', 'presupuestada', 'aprobada', 'realizada', 'verificada', 'devuelta']) assert.ok(estados.has(e), 'falta el estado ' + e);
  assert.ok(d.tareas.length >= 20);
  assert.deepEqual(d.grupos.map((g) => g.estado).sort(), ['aprobado', 'presupuestado']);
  assert.ok(d.tareas.some((t) => t.moneda === 'USD'));
  assert.ok(d.tareas.some((t) => t.pagado > 0) && d.grupos.some((g) => g.pagado > 0));
  assert.ok(d.tareas.some((t) => t.plazo && t.plazo < new Date().toISOString().slice(0, 10) && !['realizada', 'verificada'].includes(t.estado)), 'hay vencidas');
  assert.ok(d.tareas.some((t) => t.fotos > 0) && d.tareas.some((t) => t.archivos > 0) && d.tareas.some((t) => t.asignada_rubro === 'Plomería'));

  const fotos = (await pedir(casa.token, 'GET', '/api/fotos')).datos.fotos;
  assert.ok(fotos.length > 0);
  const img = await fetch(`${base}/api/fotos/${fotos[0].id}`, { headers: { Authorization: 'Bearer ' + casa.token } });
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual([...Buffer.from(await img.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const personas = (await pedir(casa.token, 'GET', '/api/personas')).datos.personas;
  const plomero = personas.find((x) => x.rubro === 'Plomería');
  const suyas = (await pedir(plomero.token, 'GET', '/api/tareas')).datos.tareas;
  assert.ok(suyas.length > 0 && suyas.every((t) => t.asignada_rubro === 'Plomería'), 'el proveedor demo ve solo lo suyo');

  assert.equal((await pedir(duena, 'GET', '/api/tareas')).datos.tareas.length, antes, 'la obra real no cambió');

  const borrado = await pedir(duena, 'DELETE', '/api/demo');
  assert.deepEqual([borrado.codigo, borrado.datos.borradas], [200, 2]);
  assert.equal((await pedir(casa.token, 'GET', '/api/yo')).codigo, 401);
  assert.equal((await pedir(plomero.token, 'GET', '/api/yo')).codigo, 401);
  assert.equal((await pedir(duena, 'GET', '/api/tareas')).datos.tareas.length, antes);
  const restos = fs.readdirSync(path.join(dirDatos, 'fotos')).concat(fs.readdirSync(path.join(dirDatos, 'archivos')));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fotos').get().n, restos.length - fs.readdirSync(path.join(dirDatos, 'archivos')).length, 'no quedan fotos sueltas');
  assert.equal((await pedir(duena, 'POST', '/api/demo')).codigo, 201, 'se puede volver a cargar');
});

test('demostración con arquitecto propio: le pone el nombre y da un link que abre las dos obras', async () => {
  const op = { dirFotos: path.join(dirDatos, 'fotos'), dirArchivos: path.join(dirDatos, 'archivos'), propietario: 'Dueña', urlBase: 'https://ejemplo.test/' };
  const links = asegurarDemo(db, { ...op, arquitecto: 'Nazareno' });
  const tokens = links.arquitecto.replace('https://ejemplo.test/#k=', '').split(',');
  assert.equal(tokens.length, 2);
  for (const [i, nombre] of ['Casa Los Álamos', 'Clínica Norte'].entries()) {
    const yo = (await pedir(tokens[i], 'GET', '/api/yo')).datos;
    assert.deepEqual([yo.persona.nombre, yo.persona.rol, yo.obra.nombre, yo.obra.demo], ['Nazareno', 'arquitecto', nombre, true]);
  }
  // Como arquitecto ve todo y puede aprobar.
  const d = (await pedir(tokens[0], 'GET', '/api/tareas')).datos;
  assert.ok(d.tareas.length >= 20);
  const aAprobar = d.tareas.find((t) => !t.grupo_id && t.estado === 'presupuestada');
  assert.equal((await pedir(tokens[0], 'POST', `/api/tareas/${aAprobar.id}/accion`, { accion: 'aprobar' })).codigo, 200);
  assert.equal(links.propietario.split(',').length, 2);
  // Repetirlo no duplica nada y mantiene los mismos links.
  const antes = db.prepare('SELECT COUNT(*) AS n FROM obras WHERE demo = 1').get().n;
  assert.deepEqual(asegurarDemo(db, { ...op, arquitecto: 'Nazareno' }), links);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM obras WHERE demo = 1').get().n, antes);
});

test('carga de tareas por lista: una sola vez, en la obra vacía o en la que tiene ese nombre', async () => {
  const base2 = abrirBase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carga-')), 'obras.db'));
  const inicial = crearObra(base2, { nombre: 'Mi primera obra', propietario: 'Dueña' });
  const lista = [{ lugar: 'Cocina', texto: 'Instalar extractor' }, { lugar: 'Pileta', texto: 'Instalar filtros' }];
  const r = cargarTareas(base2, { id: 'c1', obra: 'Casa', tipo: 'Vivienda', tareas: lista });
  assert.deepEqual([r.hecho, r.tareas, r.token], [true, 2, null], 'usa la única obra vacía, sin crear otra');
  assert.deepEqual({ ...base2.prepare('SELECT nombre, tipo FROM obras WHERE id = ?').get(inicial.obraId) }, { nombre: 'Casa', tipo: 'Vivienda' });
  assert.equal(base2.prepare('SELECT COUNT(*) AS n FROM obras').get().n, 1);
  assert.deepEqual(base2.prepare('SELECT lugar, texto, estado, creada_por FROM tareas ORDER BY id').all().map((t) => [t.lugar, t.texto, t.estado, t.creada_por]),
    [['Cocina', 'Instalar extractor', 'pendiente', inicial.personaId], ['Pileta', 'Instalar filtros', 'pendiente', inicial.personaId]]);
  assert.equal(base2.prepare("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'creada'").get().n, 2);
  assert.equal(cargarTareas(base2, { id: 'c1', obra: 'Casa', tareas: lista }).hecho, false, 'repetir no duplica');
  assert.equal(base2.prepare('SELECT COUNT(*) AS n FROM tareas').get().n, 2);
  // Otra carga a la misma obra por nombre suma; a un nombre que no existe (y sin obra vacía) crea la obra y da su link.
  assert.equal(cargarTareas(base2, { id: 'c2', obra: 'Casa', tareas: [{ texto: 'Otra' }] }).token, null);
  const nueva = cargarTareas(base2, { id: 'c3', obra: 'Quincho', tareas: [{ texto: 'Parrilla' }], propietario: 'Dueña' });
  assert.ok(nueva.hecho && /^[0-9a-f]{48}$/.test(nueva.token));
  assert.equal(base2.prepare('SELECT COUNT(*) AS n FROM obras').get().n, 2);
});

test('alta de obras con un propietario: una sola vez, vacías y con acceso propio', async () => {
  const obras = [{ nombre: 'Sede de prueba A', tipo: 'Clínica o consultorio' }, { nombre: 'Sede de prueba B', tipo: 'Clínica o consultorio' }];
  const r = altaDeObras(db, { id: 'alta-prueba', propietario: 'Diagnosticar', obras });
  assert.equal(r.tokens.length, 2);
  for (const [i, o] of obras.entries()) {
    const yo = (await pedir(r.tokens[i], 'GET', '/api/yo')).datos;
    assert.deepEqual([yo.persona.nombre, yo.persona.rol, yo.obra.nombre, yo.obra.tipo, yo.obra.demo], ['Diagnosticar', 'propietario', o.nombre, o.tipo, false]);
    assert.equal((await pedir(r.tokens[i], 'GET', '/api/tareas')).datos.tareas.length, 0);
  }
  assert.equal((await pedir(r.tokens[0], 'GET', '/api/tareas/' + tareaId)).codigo, 404, 'no ve las obras de otros');
  assert.deepEqual(altaDeObras(db, { id: 'alta-prueba', propietario: 'Diagnosticar', obras }), { hecho: false, tokens: [] });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM obras WHERE nombre LIKE 'Sede de prueba %'").get().n, 2);
});
