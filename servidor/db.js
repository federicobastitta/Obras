import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS obras (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  creada TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY,
  obra_id INTEGER NOT NULL REFERENCES obras(id),
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('propietario','arquitecto','constructor')),
  token TEXT NOT NULL UNIQUE,
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
  // Bases creadas antes de que las obras tuvieran tipo.
  if (!db.prepare('PRAGMA table_info(obras)').all().some((c) => c.name === 'tipo')) {
    db.exec("ALTER TABLE obras ADD COLUMN tipo TEXT NOT NULL DEFAULT ''");
  }
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
