import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS obras (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  demo INTEGER NOT NULL DEFAULT 0,
  creada TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llaves (
  codigo TEXT PRIMARY KEY,
  propietario TEXT NOT NULL,
  nombre TEXT NOT NULL,
  creada TEXT NOT NULL,
  UNIQUE (propietario, nombre)
);
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY,
  obra_id INTEGER NOT NULL REFERENCES obras(id),
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('propietario','arquitecto','constructor')),
  token TEXT NOT NULL UNIQUE,
  rubro TEXT NOT NULL DEFAULT '',
  limitado INTEGER NOT NULL DEFAULT 0,
  activa INTEGER NOT NULL DEFAULT 1,
  creada TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grupos (
  id INTEGER PRIMARY KEY,
  obra_id INTEGER NOT NULL REFERENCES obras(id),
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'presupuestado' CHECK (estado IN ('presupuestado','aprobado','rechazado')),
  monto INTEGER NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  nota TEXT NOT NULL DEFAULT '',
  plazo TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  creado_por INTEGER REFERENCES personas(id),
  creado TEXT NOT NULL,
  aprobado_en TEXT
);

CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY,
  obra_id INTEGER NOT NULL REFERENCES obras(id),
  grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL,
  asignada_a INTEGER REFERENCES personas(id),
  lugar TEXT NOT NULL DEFAULT '',
  texto TEXT NOT NULL,
  prioridad TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('alta','media','baja')),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','presupuestada','aprobada','realizada','verificada','devuelta')),
  monto INTEGER,
  moneda TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS','USD')),
  presupuesto_nota TEXT NOT NULL DEFAULT '',
  plazo TEXT,
  motivo TEXT NOT NULL DEFAULT '',
  creada_por INTEGER REFERENCES personas(id),
  creada TEXT NOT NULL,
  presupuestada_en TEXT,
  aprobada_en TEXT,
  realizada_en TEXT,
  verificada_en TEXT
);
CREATE INDEX IF NOT EXISTS tareas_obra ON tareas(obra_id);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES personas(id),
  tipo TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  fecha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS eventos_tarea ON eventos(tarea_id);

CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES personas(id),
  momento TEXT NOT NULL DEFAULT 'otro' CHECK (momento IN ('antes','despues','otro')),
  archivo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  fecha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fotos_tarea ON fotos(tarea_id);

CREATE TABLE IF NOT EXISTS archivos (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES personas(id),
  nombre TEXT NOT NULL,
  archivo TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  fecha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS archivos_tarea ON archivos(tarea_id);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY,
  tarea_id INTEGER REFERENCES tareas(id) ON DELETE CASCADE,
  grupo_id INTEGER REFERENCES grupos(id) ON DELETE CASCADE,
  persona_id INTEGER REFERENCES personas(id),
  monto INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  nota TEXT NOT NULL DEFAULT '',
  creada TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pagos_tarea ON pagos(tarea_id);
`;

export function abrirBase(ruta) {
  const db = new DatabaseSync(ruta);
  db.exec(ESQUEMA);
  // Columnas sumadas después de la primera instalación: se agregan a las bases que ya existen.
  const asegurar = (tabla, columna, definicion) => {
    if (!db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna)) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    }
  };
  asegurar('obras', 'tipo', "TEXT NOT NULL DEFAULT ''");
  asegurar('obras', 'demo', 'INTEGER NOT NULL DEFAULT 0');
  asegurar('personas', 'rubro', "TEXT NOT NULL DEFAULT ''");
  asegurar('personas', 'limitado', 'INTEGER NOT NULL DEFAULT 0');
  asegurar('tareas', 'asignada_a', 'INTEGER REFERENCES personas(id)');
  // Quien pide tareas desde Conectar o FC: entra con su usuario de allá (externo = "conectar:12" / "fc:usuario")
  // y solo ve los pedidos que cargó él.
  asegurar('personas', 'pide', 'INTEGER NOT NULL DEFAULT 0');
  asegurar('llaves', 'rol', "TEXT NOT NULL DEFAULT 'constructor'");
  asegurar('personas', 'externo', "TEXT NOT NULL DEFAULT ''");
  // Tarea que Darío o Alejandro hicieron sin que nadie la pidiera (dueño 25/11/2026): se carga ya realizada y con foto.
  asegurar('tareas', 'fuera_de_pedido', 'INTEGER NOT NULL DEFAULT 0');
  return db;
}

export const TIPOS_DE_OBRA = ['Vivienda', 'Clínica o consultorio', 'Local comercial', 'Oficina', 'Edificio', 'Industria o depósito', 'Espacio exterior', 'Otra'];
export const ahora = () => new Date().toISOString();
export const nuevoToken = () => randomBytes(24).toString('hex');

/** Crea una obra con su primera persona (propietario) y, si se pasan, sus tareas. Devuelve el token del propietario. */
export function crearObra(db, { nombre, propietario, tipo = '', tareas = [] }) {
  const t = ahora();
  const obraId = db.prepare('INSERT INTO obras (nombre, tipo, creada) VALUES (?, ?, ?)').run(nombre, tipo, t).lastInsertRowid;
  const token = nuevoToken();
  const personaId = db
    .prepare("INSERT INTO personas (obra_id, nombre, rol, token, creada) VALUES (?, ?, 'propietario', ?, ?)")
    .run(obraId, propietario, token, t).lastInsertRowid;
  const ins = db.prepare('INSERT INTO tareas (obra_id, lugar, texto, creada_por, creada) VALUES (?, ?, ?, ?, ?)');
  const ev = db.prepare("INSERT INTO eventos (tarea_id, persona_id, tipo, detalle, fecha) VALUES (?, ?, 'creada', '', ?)");
  for (const x of tareas) {
    const id = ins.run(obraId, x.lugar || '', x.texto, personaId, t).lastInsertRowid;
    ev.run(id, personaId, t);
  }
  return { obraId: Number(obraId), personaId: Number(personaId), token };
}

/**
 * Carga una lista de tareas en una obra, una sola vez por identificador. Usa la obra con ese nombre; si no existe y hay
 * una única obra todavía sin tareas, usa esa (y le pone el nombre y el tipo); si no, crea una obra nueva.
 * Devuelve { hecho, obra, tareas, token? } (token solo si hubo que crear una obra nueva).
 */
export function cargarTareas(db, { id, obra, tipo = '', tareas, propietario = 'Propietario' }) {
  db.exec('CREATE TABLE IF NOT EXISTS cargas (id TEXT PRIMARY KEY, fecha TEXT NOT NULL)');
  if (db.prepare('SELECT 1 FROM cargas WHERE id = ?').get(id)) return { hecho: false };
  db.exec('BEGIN');
  try {
    let fila = db.prepare('SELECT id FROM obras WHERE nombre = ? AND demo = 0 ORDER BY id LIMIT 1').get(obra);
    let token = null;
    if (!fila) {
      const todas = db.prepare('SELECT o.id, (SELECT COUNT(*) FROM tareas t WHERE t.obra_id = o.id) AS n FROM obras o WHERE o.demo = 0').all();
      if (todas.length === 1 && todas[0].n === 0) {
        fila = { id: todas[0].id };
        db.prepare('UPDATE obras SET nombre = ?, tipo = ? WHERE id = ?').run(obra, tipo, fila.id);
      } else {
        const nueva = crearObra(db, { nombre: obra, tipo, propietario });
        fila = { id: nueva.obraId };
        token = nueva.token;
      }
    }
    const quien = db.prepare("SELECT id FROM personas WHERE obra_id = ? AND rol = 'propietario' AND activa = 1 ORDER BY id LIMIT 1").get(fila.id);
    const t = ahora();
    const ins = db.prepare('INSERT INTO tareas (obra_id, lugar, texto, creada_por, creada) VALUES (?, ?, ?, ?, ?)');
    const ev = db.prepare("INSERT INTO eventos (tarea_id, persona_id, tipo, detalle, fecha) VALUES (?, ?, 'creada', '', ?)");
    for (const x of tareas) ev.run(ins.run(fila.id, x.lugar || '', x.texto, quien ? quien.id : null, t).lastInsertRowid, quien ? quien.id : null, t);
    db.prepare('INSERT INTO cargas (id, fecha) VALUES (?, ?)').run(id, t);
    db.exec('COMMIT');
    return { hecho: true, obra, tareas: tareas.length, token };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Da de alta varias obras vacías con un mismo propietario, una sola vez por identificador.
 * Devuelve { hecho, tokens } con el acceso de propietario de cada obra, en el mismo orden.
 */
export function altaDeObras(db, { id, propietario, obras }) {
  db.exec('CREATE TABLE IF NOT EXISTS cargas (id TEXT PRIMARY KEY, fecha TEXT NOT NULL)');
  if (db.prepare('SELECT 1 FROM cargas WHERE id = ?').get(id)) return { hecho: false, tokens: [] };
  db.exec('BEGIN');
  try {
    const tokens = obras.map((o) => crearObra(db, { nombre: o.nombre, tipo: o.tipo || '', propietario }).token);
    db.prepare('INSERT INTO cargas (id, fecha) VALUES (?, ?)').run(id, ahora());
    db.exec('COMMIT');
    return { hecho: true, tokens };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Obras activas (no demo) cuyo propietario se llama así: por ejemplo, las sedes de «Diagnosticar». */
export function obrasDelPropietario(db, propietario) {
  return db.prepare(`SELECT DISTINCT o.id, o.nombre FROM obras o JOIN personas p ON p.obra_id = o.id
    WHERE o.demo = 0 AND p.rol = 'propietario' AND p.activa = 1 AND p.nombre = ? ORDER BY o.id`).all(propietario);
}

/**
 * Da de alta a quienes ejecutan las tareas (constructores, sin limitar) en todas las obras de un propietario,
 * una sola vez por identificador. Devuelve { hecho, personas: [{ nombre, tokens }] }.
 */
export function altaDeEquipo(db, { id, propietario, personas }) {
  db.exec('CREATE TABLE IF NOT EXISTS cargas (id TEXT PRIMARY KEY, fecha TEXT NOT NULL)');
  if (db.prepare('SELECT 1 FROM cargas WHERE id = ?').get(id)) return { hecho: false, personas: [] };
  const obras = obrasDelPropietario(db, propietario);
  if (!obras.length) throw new Error(`No hay obras del propietario «${propietario}».`);
  db.exec('BEGIN');
  try {
    const t = ahora();
    const ins = db.prepare("INSERT INTO personas (obra_id, nombre, rol, rubro, limitado, token, creada) VALUES (?, ?, 'constructor', ?, 0, ?, ?)");
    const salida = personas.map((x) => ({
      nombre: x.nombre,
      tokens: obras.map((o) => { const tk = nuevoToken(); ins.run(o.id, x.nombre, x.rubro || '', tk, t); return tk; }),
    }));
    db.prepare('INSERT INTO cargas (id, fecha) VALUES (?, ?)').run(id, t);
    db.exec('COMMIT');
    return { hecho: true, personas: salida };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Entrada de alguien que pide tareas desde otro sistema: en cada obra del propietario usa (o crea) su persona
 * «pide», con rol arquitecto para poder cargar pedidos. Devuelve los tokens, uno por obra (sin las dadas de baja).
 */
export function entradaDeQuienPide(db, { propietario, externo, nombre }) {
  const obras = obrasDelPropietario(db, propietario);
  const buscar = db.prepare('SELECT token, activa FROM personas WHERE obra_id = ? AND externo = ? AND pide = 1');
  const ins = db.prepare("INSERT INTO personas (obra_id, nombre, rol, token, pide, externo, creada) VALUES (?, ?, 'arquitecto', ?, 1, ?, ?)");
  const ponerNombre = db.prepare('UPDATE personas SET nombre = ? WHERE token = ?');
  const tokens = [];
  db.exec('BEGIN');
  try {
    for (const o of obras) {
      const ya = buscar.get(o.id, externo);
      if (ya) {
        if (!ya.activa) continue;
        ponerNombre.run(nombre, ya.token);
        tokens.push(ya.token);
      } else {
        const tk = nuevoToken();
        ins.run(o.id, nombre, tk, externo, ahora());
        tokens.push(tk);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return tokens;
}

/**
 * Llave de una persona del equipo: un solo código corto que abre todas sus obras de ese propietario (las de hoy y las
 * que se sumen). Los links con varios códigos separados por coma se rompían al pasar por WhatsApp (dueño 25/11/2026).
 */
export function llaveDeEquipo(db, { propietario, nombre, rol = 'constructor' }) {
  const ya = db.prepare('SELECT codigo FROM llaves WHERE propietario = ? AND nombre = ?').get(propietario, nombre);
  if (ya) return ya.codigo;
  const codigo = nuevoToken();
  db.prepare('INSERT INTO llaves (codigo, propietario, nombre, rol, creada) VALUES (?, ?, ?, ?, ?)').run(codigo, propietario, nombre, rol, ahora());
  return codigo;
}

/** Suma a cada persona del equipo en las obras del propietario donde todavía no está (una sede nueva). Devuelve cuántas sumó. */
export function completarEquipo(db, { propietario, personas }) {
  const esta = db.prepare("SELECT 1 FROM personas WHERE obra_id = ? AND nombre = ? AND rol = 'constructor' AND pide = 0");
  const ins = db.prepare("INSERT INTO personas (obra_id, nombre, rol, rubro, limitado, token, creada) VALUES (?, ?, 'constructor', ?, 0, ?, ?)");
  let n = 0;
  for (const o of obrasDelPropietario(db, propietario)) {
    for (const x of personas) if (!esta.get(o.id, x.nombre)) { ins.run(o.id, x.nombre, x.rubro || '', nuevoToken(), ahora()); n++; }
  }
  return n;
}

/** Tokens que abre una llave: las personas activas con ese nombre que ejecutan tareas en las obras del propietario. */
export function tokensDeLlave(db, codigo) {
  const ll = db.prepare('SELECT propietario, nombre, rol FROM llaves WHERE codigo = ?').get(String(codigo || ''));
  if (!ll) return [];
  return obrasDelPropietario(db, ll.propietario)
    .map((o) => db.prepare('SELECT token FROM personas WHERE obra_id = ? AND nombre = ? AND rol = ? AND activa = 1 AND pide = 0 ORDER BY id LIMIT 1').get(o.id, ll.nombre, ll.rol))
    .filter(Boolean).map((x) => x.token);
}
