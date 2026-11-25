import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { abrirBase, ahora, nuevoToken, TIPOS_DE_OBRA } from './db.js';
import { cargarDemo } from './demo.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const MAX_JSON = 64 * 1024;
const MAX_FOTO = 4 * 1024 * 1024;
const MAX_ARCHIVO = 20 * 1024 * 1024;
// Lo que se puede adjuntar a una tarea. Siempre se entrega como descarga, nunca se abre dentro de la app.
const EXTENSIONES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'dwg', 'dxf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'zip'];
const ROLES = ['propietario', 'arquitecto', 'constructor'];

class ErrorHttp extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}
const falla = (codigo, mensaje) => new ErrorHttp(codigo, mensaje);

function texto(v, max, { requerido = false, nombre = 'El texto' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (requerido && !s) throw falla(400, `${nombre} no puede quedar vacío.`);
  if (s.length > max) throw falla(400, `${nombre} es demasiado largo (máximo ${max} caracteres).`);
  return s;
}
function fechaDia(v, { requerido = false, nombre = 'La fecha' } = {}) {
  if (v == null || v === '') {
    if (requerido) throw falla(400, `${nombre} es obligatoria.`);
    return null;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw falla(400, `${nombre} no es válida.`);
  }
  return v;
}
function monto(v, nombre = 'El monto') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1e12) throw falla(400, `${nombre} tiene que ser un número entero, sin centavos.`);
  return n;
}
function tipoDeImagen(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', '.jpg'];
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', '.png'];
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return ['image/webp', '.webp'];
  return null;
}

function leerCuerpo(req, max) {
  return new Promise((ok, mal) => {
    const partes = [];
    let total = 0;
    req.on('data', (p) => {
      total += p.length;
      if (total > max) {
        mal(falla(413, 'El archivo es demasiado grande.'));
        req.destroy();
        return;
      }
      partes.push(p);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', mal);
  });
}
async function leerJson(req) {
  const b = await leerCuerpo(req, MAX_JSON);
  if (!b.length) return {};
  try {
    const o = JSON.parse(b.toString('utf8'));
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
    return o;
  } catch {
    throw falla(400, 'Los datos enviados no se pudieron leer.');
  }
}

export function crearApp({ dirDatos, dirWeb }) {
  fs.mkdirSync(path.join(dirDatos, 'fotos'), { recursive: true });
  fs.mkdirSync(path.join(dirDatos, 'archivos'), { recursive: true });
  const db = abrirBase(path.join(dirDatos, 'obras.db'));
  const dirFotos = path.join(dirDatos, 'fotos');
  const dirArchivos = path.join(dirDatos, 'archivos');

  const q = {
    persona: db.prepare('SELECT p.*, o.nombre AS obra_nombre, o.tipo AS obra_tipo, o.demo AS obra_demo FROM personas p JOIN obras o ON o.id = p.obra_id WHERE p.token = ? AND p.activa = 1'),
    tareas: db.prepare(`SELECT t.*,
        (SELECT COUNT(*) FROM fotos f WHERE f.tarea_id = t.id) AS fotos,
        (SELECT COUNT(*) FROM archivos a WHERE a.tarea_id = t.id) AS archivos,
        (SELECT COUNT(*) FROM eventos e WHERE e.tarea_id = t.id AND e.tipo = 'comentario') AS comentarios,
        (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p WHERE p.tarea_id = t.id) AS pagado,
        pa.nombre AS asignada_nombre, pa.rubro AS asignada_rubro
      FROM tareas t LEFT JOIN personas pa ON pa.id = t.asignada_a WHERE t.obra_id = ? ORDER BY t.id`),
    tarea: db.prepare('SELECT * FROM tareas WHERE id = ? AND obra_id = ?'),
    evento: db.prepare('INSERT INTO eventos (tarea_id, persona_id, tipo, detalle, fecha) VALUES (?, ?, ?, ?, ?)'),
    eventos: db.prepare(`SELECT e.id, e.tipo, e.detalle, e.fecha, p.nombre AS persona, p.rol
      FROM eventos e LEFT JOIN personas p ON p.id = e.persona_id WHERE e.tarea_id = ? ORDER BY e.id`),
    fotos: db.prepare(`SELECT f.id, f.momento, f.fecha, f.persona_id, p.nombre AS persona
      FROM fotos f LEFT JOIN personas p ON p.id = f.persona_id WHERE f.tarea_id = ? ORDER BY f.id`),
    pagos: db.prepare(`SELECT g.id, g.monto, g.fecha, g.nota, p.nombre AS persona
      FROM pagos g LEFT JOIN personas p ON p.id = g.persona_id WHERE g.tarea_id = ? ORDER BY g.fecha, g.id`),
    personas: db.prepare('SELECT id, nombre, rol, rubro, limitado, token, activa FROM personas WHERE obra_id = ? ORDER BY id'),
    grupos: db.prepare(`SELECT g.*,
        (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p WHERE p.grupo_id = g.id) AS pagado,
        (SELECT COUNT(*) FROM tareas t WHERE t.grupo_id = g.id) AS cantidad
      FROM grupos g WHERE g.obra_id = ? ORDER BY g.id`),
    grupo: db.prepare('SELECT * FROM grupos WHERE id = ? AND obra_id = ?'),
    tareasDeGrupo: db.prepare('SELECT id, texto, lugar, estado, asignada_a FROM tareas WHERE grupo_id = ? ORDER BY id'),
    pagosDeGrupo: db.prepare(`SELECT g.id, g.monto, g.fecha, g.nota, p.nombre AS persona
      FROM pagos g LEFT JOIN personas p ON p.id = g.persona_id WHERE g.grupo_id = ? ORDER BY g.fecha, g.id`),
  };

  function enTransaccion(f) {
    db.exec('BEGIN');
    try {
      const r = f();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function presupuestoDe(c) {
    return {
      m: monto(c.monto, 'El presupuesto'),
      moneda: c.moneda === 'USD' ? 'USD' : 'ARS',
      plazo: fechaDia(c.plazo, { requerido: true, nombre: 'El plazo' }),
      nota: texto(c.nota, 500, { nombre: 'La nota' }),
    };
  }

  /** Borra una obra entera con sus tareas, personas, fotos y archivos. Solo se usa con obras de demostración. */
  const borrarObra = (obraId) => {
    const rutas = [
      ...db.prepare('SELECT f.archivo FROM fotos f JOIN tareas t ON t.id = f.tarea_id WHERE t.obra_id = ?').all(obraId).map((f) => path.join(dirFotos, f.archivo)),
      ...db.prepare('SELECT a.archivo FROM archivos a JOIN tareas t ON t.id = a.tarea_id WHERE t.obra_id = ?').all(obraId).map((f) => path.join(dirArchivos, f.archivo)),
    ];
    enTransaccion(() => {
      db.prepare('DELETE FROM tareas WHERE obra_id = ?').run(obraId);
      db.prepare('DELETE FROM grupos WHERE obra_id = ?').run(obraId);
      db.prepare('DELETE FROM personas WHERE obra_id = ?').run(obraId);
      db.prepare('DELETE FROM obras WHERE id = ?').run(obraId);
    });
    for (const r of rutas) fs.rmSync(r, { force: true });
  };

  const esDireccion = (p) => p.rol === 'propietario' || p.rol === 'arquitecto';
  const soloDireccion = (p) => {
    if (!esDireccion(p)) throw falla(403, 'Esto solo lo puede hacer el propietario o el arquitecto.');
  };
  const soloConstructor = (p) => {
    if (p.rol !== 'constructor') throw falla(403, 'Esto solo lo puede hacer el constructor.');
  };
  const buscarTarea = (id, p) => {
    const t = q.tarea.get(Number(id), p.obra_id);
    // Un proveedor (acceso limitado) solo llega a los trabajos que tiene asignados.
    if (!t || (p.limitado && t.asignada_a !== p.id)) throw falla(404, 'No se encontró la tarea.');
    return t;
  };
  /** Valida a quién se le encarga una tarea: tiene que ser alguien que ejecuta (constructor o proveedor) de esta obra. */
  const aQuien = (valor, p_obra) => {
    if (valor == null || valor === '') return null;
    const x = db.prepare("SELECT id FROM personas WHERE id = ? AND obra_id = ? AND rol = 'constructor' AND activa = 1").get(Number(valor), p_obra);
    if (!x) throw falla(400, 'Esa persona no puede recibir trabajos en esta obra.');
    return x.id;
  };
  const anotar = (tareaId, p, tipo, detalle = '') => q.evento.run(tareaId, p.id, tipo, detalle, ahora());

  function accion(t, p, c) {
    const fijar = (campos) => {
      const k = Object.keys(campos);
      db.prepare(`UPDATE tareas SET ${k.map((x) => x + ' = ?').join(', ')} WHERE id = ?`).run(...k.map((x) => campos[x]), t.id);
    };
    if (t.grupo_id && ['presupuestar', 'aprobar', 'rechazar'].includes(c.accion)) {
      throw falla(409, 'Esta tarea se presupuestó en grupo: el presupuesto se cambia, aprueba o rechaza desde el grupo.');
    }
    switch (c.accion) {
      case 'presupuestar': {
        soloConstructor(p);
        if (!['pendiente', 'presupuestada'].includes(t.estado)) {
          throw falla(409, 'El presupuesto ya no se puede cambiar: la tarea ya fue aprobada o realizada.');
        }
        const m = monto(c.monto, 'El presupuesto');
        const moneda = c.moneda === 'USD' ? 'USD' : 'ARS';
        const plazo = fechaDia(c.plazo, { requerido: true, nombre: 'El plazo' });
        const nota = texto(c.nota, 500, { nombre: 'La nota' });
        fijar({ estado: 'presupuestada', monto: m, moneda, plazo, presupuesto_nota: nota, motivo: '', presupuestada_en: ahora() });
        anotar(t.id, p, 'presupuestada', `${moneda} ${m} · plazo ${plazo}${nota ? ' · ' + nota : ''}`);
        return;
      }
      case 'aprobar':
        soloDireccion(p);
        if (t.estado !== 'presupuestada') throw falla(409, 'Solo se aprueba una tarea que tiene presupuesto cargado.');
        fijar({ estado: 'aprobada', aprobada_en: ahora(), motivo: '' });
        anotar(t.id, p, 'aprobada', `${t.moneda} ${t.monto}`);
        return;
      case 'rechazar': {
        soloDireccion(p);
        if (t.estado !== 'presupuestada') throw falla(409, 'Solo se rechaza una tarea que tiene presupuesto cargado.');
        const motivo = texto(c.motivo, 500, { requerido: true, nombre: 'El motivo' });
        fijar({ estado: 'pendiente', motivo });
        anotar(t.id, p, 'rechazada', motivo);
        return;
      }
      case 'realizada':
        soloConstructor(p);
        if (t.estado === 'presupuestada') throw falla(409, 'Falta que aprueben el presupuesto antes de marcarla como realizada.');
        if (!['pendiente', 'aprobada', 'devuelta'].includes(t.estado)) throw falla(409, 'La tarea ya está marcada como realizada.');
        fijar({ estado: 'realizada', realizada_en: ahora(), motivo: '' });
        anotar(t.id, p, 'realizada');
        return;
      case 'verificar':
        soloDireccion(p);
        if (t.estado === 'verificada') throw falla(409, 'La tarea ya está verificada.');
        fijar({ estado: 'verificada', verificada_en: ahora(), realizada_en: t.realizada_en || ahora(), motivo: '' });
        anotar(t.id, p, 'verificada');
        return;
      case 'devolver': {
        soloDireccion(p);
        if (!['realizada', 'verificada'].includes(t.estado)) throw falla(409, 'Solo se devuelve una tarea que figura como realizada.');
        const motivo = texto(c.motivo, 500, { requerido: true, nombre: 'El motivo' });
        fijar({ estado: 'devuelta', motivo, verificada_en: null });
        anotar(t.id, p, 'devuelta', motivo);
        return;
      }
      default:
        throw falla(400, 'Acción desconocida.');
    }
  }

  async function api(req, res, url) {
    const m = req.method;
    const partes = url.pathname.split('/').filter(Boolean).slice(1); // sin "api"
    const aut = req.headers.authorization || '';
    const token = aut.startsWith('Bearer ') ? aut.slice(7).trim() : '';
    const p = token ? q.persona.get(token) : null;
    if (!p) throw falla(401, 'El link de acceso no es válido o fue dado de baja.');

    const responder = (codigo, obj) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    const [a, id, b, id2] = partes;

    if (a === 'yo' && m === 'GET') {
      return responder(200, {
        persona: { id: p.id, nombre: p.nombre, rol: p.rol, rubro: p.rubro, limitado: !!p.limitado },
        obra: { id: p.obra_id, nombre: p.obra_nombre, tipo: p.obra_tipo, demo: !!p.obra_demo },
      });
    }

    if (a === 'demo' && !id && (m === 'POST' || m === 'DELETE')) {
      // Obras de demostración: se cargan con todo completo para mostrar la app y se pueden borrar enteras.
      soloDireccion(p);
      if (m === 'POST') {
        if (db.prepare('SELECT COUNT(*) AS n FROM obras WHERE demo = 1').get().n) {
          throw falla(409, 'Ya hay datos de demostración cargados. Quitalos primero si querés volver a empezar.');
        }
        return responder(201, { obras: cargarDemo(db, { dirFotos, dirArchivos, propietario: p.nombre }) });
      }
      const borrar = db.prepare('SELECT id FROM obras WHERE demo = 1').all();
      for (const o of borrar) borrarObra(o.id);
      return responder(200, { borradas: borrar.length });
    }

    if (a === 'obras' && !id && m === 'POST') {
      // Quien dirige una obra puede abrir otra: entra a la nueva con el mismo nombre y rol, y un link propio.
      soloDireccion(p);
      const c = await leerJson(req);
      const nombre = texto(c.nombre, 80, { requerido: true, nombre: 'El nombre de la obra' });
      const tipo = TIPOS_DE_OBRA.includes(c.tipo) ? c.tipo : '';
      const t = ahora();
      const obraId = db.prepare('INSERT INTO obras (nombre, tipo, creada) VALUES (?, ?, ?)').run(nombre, tipo, t).lastInsertRowid;
      const tk = nuevoToken();
      db.prepare('INSERT INTO personas (obra_id, nombre, rol, token, creada) VALUES (?, ?, ?, ?, ?)').run(obraId, p.nombre, p.rol, tk, t);
      return responder(201, { token: tk, obra: { id: Number(obraId), nombre, tipo } });
    }

    if (a === 'obra' && !id && m === 'PATCH') {
      soloDireccion(p);
      const c = await leerJson(req);
      const nombre = texto(c.nombre ?? p.obra_nombre, 80, { requerido: true, nombre: 'El nombre de la obra' });
      const tipo = c.tipo === undefined ? p.obra_tipo : TIPOS_DE_OBRA.includes(c.tipo) ? c.tipo : '';
      db.prepare('UPDATE obras SET nombre = ?, tipo = ? WHERE id = ?').run(nombre, tipo, p.obra_id);
      return responder(200, { obra: { id: p.obra_id, nombre, tipo } });
    }

    if (a === 'tareas' && !id) {
      if (m === 'GET') {
        let lista = q.tareas.all(p.obra_id);
        let grupos = q.grupos.all(p.obra_id);
        if (p.limitado) {
          const ajenos = new Set(lista.filter((t) => t.grupo_id && t.asignada_a !== p.id).map((t) => t.grupo_id));
          lista = lista.filter((t) => t.asignada_a === p.id);
          const propios = new Set(lista.map((t) => t.grupo_id).filter(Boolean));
          grupos = grupos.filter((g) => propios.has(g.id) && !ajenos.has(g.id));
        }
        return responder(200, { tareas: lista, grupos });
      }
      if (m === 'POST') {
        soloDireccion(p);
        const c = await leerJson(req);
        const t = ahora();
        const nuevo = db
          .prepare('INSERT INTO tareas (obra_id, lugar, texto, prioridad, asignada_a, creada_por, creada) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(
            p.obra_id,
            texto(c.lugar, 60, { nombre: 'El lugar' }),
            texto(c.texto, 400, { requerido: true, nombre: 'La tarea' }),
            ['alta', 'media', 'baja'].includes(c.prioridad) ? c.prioridad : 'media',
            aQuien(c.asignada_a, p.obra_id),
            p.id,
            t,
          ).lastInsertRowid;
        anotar(nuevo, p, 'creada');
        return responder(201, { id: Number(nuevo) });
      }
    }

    if (a === 'tareas' && id && !b) {
      const t = buscarTarea(id, p);
      if (m === 'GET') {
        return responder(200, {
          tarea: t,
          grupo: t.grupo_id ? q.grupo.get(t.grupo_id, p.obra_id) : null,
          eventos: q.eventos.all(t.id),
          archivos: db.prepare(`SELECT a.id, a.nombre, a.tamano, a.fecha, a.persona_id, p.nombre AS persona
            FROM archivos a LEFT JOIN personas p ON p.id = a.persona_id WHERE a.tarea_id = ? ORDER BY a.id`).all(t.id),
          fotos: q.fotos.all(t.id),
          pagos: q.pagos.all(t.id),
        });
      }
      if (m === 'PATCH') {
        soloDireccion(p);
        const c = await leerJson(req);
        const nuevoTexto = texto(c.texto ?? t.texto, 400, { requerido: true, nombre: 'La tarea' });
        const lugar = texto(c.lugar ?? t.lugar, 60, { nombre: 'El lugar' });
        const prioridad = ['alta', 'media', 'baja'].includes(c.prioridad) ? c.prioridad : t.prioridad;
        const asignada = c.asignada_a === undefined ? t.asignada_a : aQuien(c.asignada_a, p.obra_id);
        db.prepare('UPDATE tareas SET texto = ?, lugar = ?, prioridad = ?, asignada_a = ? WHERE id = ?').run(nuevoTexto, lugar, prioridad, asignada, t.id);
        const cambios = [];
        if (asignada !== t.asignada_a) {
          const quien = asignada ? db.prepare('SELECT nombre FROM personas WHERE id = ?').get(asignada).nombre : 'nadie en particular';
          cambios.push(`encargada a ${quien}`);
        }
        if (nuevoTexto !== t.texto) cambios.push(`texto: «${t.texto}» → «${nuevoTexto}»`);
        if (lugar !== t.lugar) cambios.push(`lugar: ${t.lugar || 'sin lugar'} → ${lugar || 'sin lugar'}`);
        if (prioridad !== t.prioridad) cambios.push(`prioridad: ${t.prioridad} → ${prioridad}`);
        if (cambios.length) anotar(t.id, p, 'editada', cambios.join(' · '));
        return responder(200, { ok: true });
      }
      if (m === 'DELETE') {
        soloDireccion(p);
        const susFotos = db.prepare('SELECT archivo FROM fotos WHERE tarea_id = ?').all(t.id);
        const susArchivos = db.prepare('SELECT archivo FROM archivos WHERE tarea_id = ?').all(t.id);
        db.prepare('DELETE FROM tareas WHERE id = ?').run(t.id);
        for (const f of susFotos) fs.rm(path.join(dirFotos, f.archivo), { force: true }, () => {});
        for (const f of susArchivos) fs.rm(path.join(dirArchivos, f.archivo), { force: true }, () => {});
        return responder(200, { ok: true });
      }
    }

    if (a === 'tareas' && id && b) {
      const t = buscarTarea(id, p);
      if (b === 'accion' && m === 'POST') {
        accion(t, p, await leerJson(req));
        return responder(200, { ok: true });
      }
      if (b === 'comentarios' && m === 'POST') {
        const c = await leerJson(req);
        anotar(t.id, p, 'comentario', texto(c.texto, 1000, { requerido: true, nombre: 'El comentario' }));
        return responder(201, { ok: true });
      }
      if (b === 'archivos' && m === 'POST') {
        const nombre = texto(url.searchParams.get('nombre'), 150, { requerido: true, nombre: 'El nombre del archivo' }).replace(/[\\/\u0000-\u001f]/g, '_');
        const ext = (nombre.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1]?.toLowerCase();
        if (!EXTENSIONES.includes(ext)) throw falla(400, `Ese tipo de archivo no se puede subir. Se aceptan: ${EXTENSIONES.join(', ')}.`);
        const cuerpo = await leerCuerpo(req, MAX_ARCHIVO);
        if (!cuerpo.length) throw falla(400, 'El archivo está vacío.');
        const archivo = `${t.id}-${nuevoToken().slice(0, 16)}`;
        fs.writeFileSync(path.join(dirArchivos, archivo), cuerpo);
        const nuevo = db
          .prepare('INSERT INTO archivos (tarea_id, persona_id, nombre, archivo, tamano, fecha) VALUES (?, ?, ?, ?, ?, ?)')
          .run(t.id, p.id, nombre, archivo, cuerpo.length, ahora()).lastInsertRowid;
        anotar(t.id, p, 'archivo', nombre);
        return responder(201, { id: Number(nuevo) });
      }
      if (b === 'fotos' && m === 'POST') {
        const cuerpo = await leerCuerpo(req, MAX_FOTO);
        const tipo = tipoDeImagen(cuerpo);
        if (!tipo) throw falla(400, 'El archivo no es una foto (JPG, PNG o WebP).');
        const momento = ['antes', 'despues', 'otro'].includes(url.searchParams.get('momento')) ? url.searchParams.get('momento') : 'otro';
        const archivo = `${t.id}-${nuevoToken().slice(0, 16)}${tipo[1]}`;
        fs.writeFileSync(path.join(dirFotos, archivo), cuerpo);
        const nuevo = db
          .prepare('INSERT INTO fotos (tarea_id, persona_id, momento, archivo, tipo, fecha) VALUES (?, ?, ?, ?, ?, ?)')
          .run(t.id, p.id, momento, archivo, tipo[0], ahora()).lastInsertRowid;
        anotar(t.id, p, 'foto', momento === 'antes' ? 'antes' : momento === 'despues' ? 'después' : '');
        return responder(201, { id: Number(nuevo) });
      }
      if (b === 'pagos' && m === 'POST') {
        soloDireccion(p);
        if (t.grupo_id) throw falla(409, 'Esta tarea se presupuestó en grupo: los pagos se cargan en el grupo.');
        const c = await leerJson(req);
        const n = monto(c.monto);
        if (n === 0) throw falla(400, 'El monto del pago no puede ser cero.');
        const dia = fechaDia(c.fecha, { requerido: true, nombre: 'La fecha del pago' });
        const nota = texto(c.nota, 300, { nombre: 'La nota' });
        db.prepare('INSERT INTO pagos (tarea_id, persona_id, monto, fecha, nota, creada) VALUES (?, ?, ?, ?, ?, ?)').run(t.id, p.id, n, dia, nota, ahora());
        anotar(t.id, p, 'pago', `${t.moneda} ${n}${nota ? ' · ' + nota : ''}`);
        return responder(201, { ok: true });
      }
      if (b === 'pagos' && id2 && m === 'DELETE') {
        soloDireccion(p);
        const g = db.prepare('SELECT * FROM pagos WHERE id = ? AND tarea_id = ?').get(Number(id2), t.id);
        if (!g) throw falla(404, 'No se encontró el pago.');
        db.prepare('DELETE FROM pagos WHERE id = ?').run(g.id);
        anotar(t.id, p, 'pago_borrado', `${t.moneda} ${g.monto}`);
        return responder(200, { ok: true });
      }
    }

    if (a === 'grupos') {
      // Presupuesto en grupo: un solo monto y un plazo para varias tareas. El avance sigue siendo tarea por tarea.
      if (!id && m === 'POST') {
        soloConstructor(p);
        const c = await leerJson(req);
        const ids = Array.isArray(c.tareas) ? [...new Set(c.tareas.map(Number))] : [];
        if (ids.length < 2) throw falla(400, 'Elegí al menos dos tareas para presupuestarlas juntas.');
        const lista = ids.map((x) => buscarTarea(x, p));
        for (const t of lista) {
          if (t.grupo_id) throw falla(409, `«${t.texto}» ya está en otro grupo.`);
          if (!['pendiente', 'presupuestada'].includes(t.estado)) {
            throw falla(409, `«${t.texto}» ya fue aprobada o realizada: no se puede sumar a un grupo.`);
          }
        }
        const d = presupuestoDe(c);
        const nombre = texto(c.nombre, 80, { nombre: 'El nombre del grupo' }) || `Grupo de ${lista.length} tareas`;
        const gid = enTransaccion(() => {
          const t0 = ahora();
          const nuevo = db
            .prepare('INSERT INTO grupos (obra_id, nombre, monto, moneda, nota, plazo, creado_por, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(p.obra_id, nombre, d.m, d.moneda, d.nota, d.plazo, p.id, t0).lastInsertRowid;
          const poner = db.prepare(
            "UPDATE tareas SET grupo_id = ?, estado = 'presupuestada', monto = NULL, presupuesto_nota = '', plazo = ?, motivo = '', presupuestada_en = ? WHERE id = ?",
          );
          for (const t of lista) {
            poner.run(nuevo, d.plazo, t0, t.id);
            anotar(t.id, p, 'presupuestada', `en el grupo «${nombre}»: ${d.moneda} ${d.m} · plazo ${d.plazo}`);
          }
          return nuevo;
        });
        return responder(201, { id: Number(gid) });
      }
      if (id) {
        const g = q.grupo.get(Number(id), p.obra_id);
        if (!g) throw falla(404, 'No se encontró el grupo.');
        const suyas = q.tareasDeGrupo.all(g.id);
        if (p.limitado && !(suyas.length && suyas.every((t) => t.asignada_a === p.id))) throw falla(404, 'No se encontró el grupo.');
        if (!b && m === 'GET') return responder(200, { grupo: g, tareas: suyas, pagos: q.pagosDeGrupo.all(g.id) });
        if (!b && m === 'PATCH') {
          soloConstructor(p);
          if (g.estado === 'aprobado') throw falla(409, 'El presupuesto del grupo ya fue aprobado y no se puede cambiar.');
          const c = await leerJson(req);
          const d = presupuestoDe(c);
          const nombre = texto(c.nombre ?? g.nombre, 80, { requerido: true, nombre: 'El nombre del grupo' });
          enTransaccion(() => {
            const t0 = ahora();
            db.prepare("UPDATE grupos SET nombre = ?, monto = ?, moneda = ?, nota = ?, plazo = ?, estado = 'presupuestado', motivo = '' WHERE id = ?")
              .run(nombre, d.m, d.moneda, d.nota, d.plazo, g.id);
            db.prepare("UPDATE tareas SET estado = 'presupuestada', plazo = ?, motivo = '', presupuestada_en = ? WHERE grupo_id = ? AND estado IN ('pendiente','presupuestada')")
              .run(d.plazo, t0, g.id);
            for (const t of suyas) anotar(t.id, p, 'presupuestada', `en el grupo «${nombre}»: ${d.moneda} ${d.m} · plazo ${d.plazo}`);
          });
          return responder(200, { ok: true });
        }
        if (!b && m === 'DELETE') {
          if (g.estado === 'aprobado') throw falla(409, 'El grupo ya fue aprobado: no se puede desarmar.');
          enTransaccion(() => {
            for (const t of suyas) anotar(t.id, p, 'desagrupada', `grupo «${g.nombre}»`);
            db.prepare("UPDATE tareas SET estado = 'pendiente', plazo = NULL, motivo = '' WHERE grupo_id = ? AND estado IN ('pendiente','presupuestada')").run(g.id);
            db.prepare('DELETE FROM grupos WHERE id = ?').run(g.id);
          });
          return responder(200, { ok: true });
        }
        if (b === 'accion' && m === 'POST') {
          soloDireccion(p);
          const c = await leerJson(req);
          if (g.estado !== 'presupuestado') throw falla(409, 'Solo se aprueba o rechaza un grupo con presupuesto a aprobar.');
          if (c.accion === 'aprobar') {
            enTransaccion(() => {
              const t0 = ahora();
              db.prepare("UPDATE grupos SET estado = 'aprobado', aprobado_en = ?, motivo = '' WHERE id = ?").run(t0, g.id);
              db.prepare("UPDATE tareas SET estado = 'aprobada', aprobada_en = ?, motivo = '' WHERE grupo_id = ? AND estado = 'presupuestada'").run(t0, g.id);
              for (const t of suyas) anotar(t.id, p, 'aprobada', `grupo «${g.nombre}»: ${g.moneda} ${g.monto}`);
            });
            return responder(200, { ok: true });
          }
          if (c.accion === 'rechazar') {
            const motivo = texto(c.motivo, 500, { requerido: true, nombre: 'El motivo' });
            enTransaccion(() => {
              db.prepare("UPDATE grupos SET estado = 'rechazado', motivo = ? WHERE id = ?").run(motivo, g.id);
              db.prepare("UPDATE tareas SET estado = 'pendiente', motivo = ? WHERE grupo_id = ? AND estado = 'presupuestada'").run(motivo, g.id);
              for (const t of suyas) anotar(t.id, p, 'rechazada', `grupo «${g.nombre}»: ${motivo}`);
            });
            return responder(200, { ok: true });
          }
          throw falla(400, 'Acción desconocida.');
        }
        if (b === 'pagos' && m === 'POST') {
          soloDireccion(p);
          const c = await leerJson(req);
          const n = monto(c.monto);
          if (n === 0) throw falla(400, 'El monto del pago no puede ser cero.');
          const dia = fechaDia(c.fecha, { requerido: true, nombre: 'La fecha del pago' });
          db.prepare('INSERT INTO pagos (grupo_id, persona_id, monto, fecha, nota, creada) VALUES (?, ?, ?, ?, ?, ?)')
            .run(g.id, p.id, n, dia, texto(c.nota, 300, { nombre: 'La nota' }), ahora());
          return responder(201, { ok: true });
        }
        if (b === 'pagos' && id2 && m === 'DELETE') {
          soloDireccion(p);
          const r = db.prepare('DELETE FROM pagos WHERE id = ? AND grupo_id = ?').run(Number(id2), g.id);
          if (!r.changes) throw falla(404, 'No se encontró el pago.');
          return responder(200, { ok: true });
        }
      }
    }

    if (a === 'archivos' && id) {
      const f = db
        .prepare('SELECT a.*, t.obra_id, t.asignada_a FROM archivos a JOIN tareas t ON t.id = a.tarea_id WHERE a.id = ?')
        .get(Number(id));
      if (!f || f.obra_id !== p.obra_id || (p.limitado && f.asignada_a !== p.id)) throw falla(404, 'No se encontró el archivo.');
      if (m === 'GET') {
        const ruta = path.join(dirArchivos, f.archivo);
        if (!fs.existsSync(ruta)) throw falla(404, 'No se encontró el archivo.');
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.nombre)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        });
        return fs.createReadStream(ruta).pipe(res);
      }
      if (m === 'DELETE') {
        if (!esDireccion(p) && f.persona_id !== p.id) throw falla(403, 'Solo puede borrar el archivo quien lo subió, el propietario o el arquitecto.');
        db.prepare('DELETE FROM archivos WHERE id = ?').run(f.id);
        fs.rm(path.join(dirArchivos, f.archivo), { force: true }, () => {});
        anotar(f.tarea_id, p, 'archivo_borrado', f.nombre);
        return responder(200, { ok: true });
      }
    }

    if (a === 'actividad' && !id && m === 'GET') {
      // Lo último que pasó en la obra: quién hizo qué en cada tarea. Un proveedor solo ve lo de sus trabajos.
      const filas = db.prepare(`SELECT e.id, e.tipo, e.detalle, e.fecha, e.tarea_id, t.texto AS tarea, p.nombre AS persona, p.rol, p.rubro
          FROM eventos e JOIN tareas t ON t.id = e.tarea_id LEFT JOIN personas p ON p.id = e.persona_id
          WHERE t.obra_id = ? AND (? = 0 OR t.asignada_a = ?) ORDER BY e.fecha DESC, e.id DESC LIMIT 30`).all(p.obra_id, p.limitado ? 1 : 0, p.id);
      return responder(200, { eventos: filas });
    }

    if (a === 'fotos' && !id && m === 'GET') {
      // Últimas fotos que subieron el constructor y los proveedores (para el Inicio). Un proveedor solo ve las de sus trabajos.
      const filas = db.prepare(`SELECT f.id, f.tarea_id, f.momento, f.fecha, t.texto AS tarea, p.nombre AS persona
          FROM fotos f JOIN tareas t ON t.id = f.tarea_id JOIN personas p ON p.id = f.persona_id
          WHERE t.obra_id = ? AND p.rol = 'constructor' AND (? = 0 OR t.asignada_a = ?) ORDER BY f.id DESC LIMIT 12`).all(p.obra_id, p.limitado ? 1 : 0, p.id);
      return responder(200, { fotos: filas });
    }

    if (a === 'fotos' && id) {
      const f = db
        .prepare('SELECT f.*, t.obra_id, t.asignada_a FROM fotos f JOIN tareas t ON t.id = f.tarea_id WHERE f.id = ?')
        .get(Number(id));
      if (!f || f.obra_id !== p.obra_id || (p.limitado && f.asignada_a !== p.id)) throw falla(404, 'No se encontró la foto.');
      if (m === 'GET') {
        const ruta = path.join(dirFotos, f.archivo);
        if (!fs.existsSync(ruta)) throw falla(404, 'No se encontró la foto.');
        res.writeHead(200, { 'Content-Type': f.tipo, 'Cache-Control': 'private, max-age=31536000, immutable' });
        return fs.createReadStream(ruta).pipe(res);
      }
      if (m === 'DELETE') {
        if (!esDireccion(p) && f.persona_id !== p.id) throw falla(403, 'Solo puede borrar la foto quien la subió, el propietario o el arquitecto.');
        db.prepare('DELETE FROM fotos WHERE id = ?').run(f.id);
        fs.rm(path.join(dirFotos, f.archivo), { force: true }, () => {});
        anotar(f.tarea_id, p, 'foto_borrada');
        return responder(200, { ok: true });
      }
    }

    if (a === 'proveedores' && !id && m === 'POST') {
      // Alta de un proveedor (plomero, electricista…) con el trabajo que se le encarga: entra con su link y ve solo eso.
      soloDireccion(p);
      const c = await leerJson(req);
      const nombre = texto(c.nombre, 60, { requerido: true, nombre: 'El nombre del proveedor' });
      const rubro = texto(c.rubro, 40, { requerido: true, nombre: 'El rubro' });
      const lugar = texto(c.lugar, 60, { nombre: 'El lugar' });
      const trabajos = (Array.isArray(c.tareas) ? c.tareas : []).map((x) => texto(x, 400, { nombre: 'La tarea' })).filter(Boolean);
      if (!trabajos.length) throw falla(400, 'Escribí al menos un trabajo para encargarle.');
      if (trabajos.length > 50) throw falla(400, 'Son demasiados trabajos juntos: cargá hasta 50 por vez.');
      const tk = nuevoToken();
      const creadas = [];
      const personaId = enTransaccion(() => {
        const t0 = ahora();
        const nuevo = db
          .prepare("INSERT INTO personas (obra_id, nombre, rol, rubro, limitado, token, creada) VALUES (?, ?, 'constructor', ?, 1, ?, ?)")
          .run(p.obra_id, nombre, rubro, tk, t0).lastInsertRowid;
        const poner = db.prepare('INSERT INTO tareas (obra_id, lugar, texto, asignada_a, creada_por, creada) VALUES (?, ?, ?, ?, ?, ?)');
        for (const x of trabajos) {
          const tareaId = poner.run(p.obra_id, lugar, x, nuevo, p.id, t0).lastInsertRowid;
          creadas.push(Number(tareaId));
          anotar(tareaId, p, 'creada', `encargada a ${nombre} (${rubro})`);
        }
        return nuevo;
      });
      return responder(201, { id: Number(personaId), token: tk, tareas: trabajos.length, ids: creadas });
    }

    if (a === 'personas') {
      soloDireccion(p);
      if (m === 'GET' && !id) return responder(200, { personas: q.personas.all(p.obra_id) });
      if (m === 'POST' && !id) {
        const c = await leerJson(req);
        if (!ROLES.includes(c.rol)) throw falla(400, 'Elegí un rol: propietario, arquitecto o constructor.');
        const tk = nuevoToken();
        const ejecuta = c.rol === 'constructor';
        const nuevo = db
          .prepare('INSERT INTO personas (obra_id, nombre, rol, rubro, limitado, token, creada) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(
            p.obra_id, texto(c.nombre, 60, { requerido: true, nombre: 'El nombre' }), c.rol,
            ejecuta ? texto(c.rubro, 40, { nombre: 'El rubro' }) : '', ejecuta && c.limitado ? 1 : 0, tk, ahora(),
          ).lastInsertRowid;
        return responder(201, { id: Number(nuevo), token: tk });
      }
      if (m === 'PATCH' && id) {
        const otra = db.prepare('SELECT * FROM personas WHERE id = ? AND obra_id = ?').get(Number(id), p.obra_id);
        if (!otra) throw falla(404, 'No se encontró la persona.');
        const c = await leerJson(req);
        const activa = c.activa ? 1 : 0;
        if (!activa && otra.id === p.id) throw falla(409, 'No podés darte de baja a vos mismo.');
        db.prepare('UPDATE personas SET activa = ? WHERE id = ?').run(activa, otra.id);
        return responder(200, { ok: true });
      }
    }

    throw falla(404, 'No existe esa dirección.');
  }

  function estatico(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw falla(405, 'Método no permitido.');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const ruta = path.join(dirWeb, path.normalize(rel));
    if (!ruta.startsWith(dirWeb + path.sep) || !fs.existsSync(ruta) || !fs.statSync(ruta).isFile()) {
      throw falla(404, 'No existe esa página.');
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(ruta).pipe(res);
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/salud') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ok');
      }
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else estatico(req, res, url);
    } catch (e) {
      const codigo = e instanceof ErrorHttp ? e.codigo : 500;
      if (codigo === 500) console.error(e);
      if (res.headersSent) return res.end();
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: codigo === 500 ? 'Hubo un problema en el servidor.' : e.message }));
    }
  });

  return { servidor, db };
}
