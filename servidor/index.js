import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { crearObra } from './db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = path.resolve(process.env.DIR_DATOS || path.join(raiz, 'datos'));
const puerto = Number(process.env.PUERTO || 3400);

const { servidor, db } = crearApp({ dirDatos, dirWeb: path.join(raiz, 'web') });

// Primera vez: crea la obra inicial y deja el link del propietario en datos/primer-acceso.txt.
if (db.prepare('SELECT COUNT(*) AS n FROM obras').get().n === 0) {
  const inicial = path.join(raiz, 'datos-iniciales', 'casa.json');
  const tareas = fs.existsSync(inicial) ? JSON.parse(fs.readFileSync(inicial, 'utf8')) : [];
  const { token } = crearObra(db, {
    nombre: process.env.OBRA_NOMBRE || 'Casa',
    propietario: process.env.PROPIETARIO || 'Propietario',
    tareas,
  });
  const base = (process.env.URL_BASE || `http://localhost:${puerto}`).replace(/\/$/, '');
  const archivo = path.join(dirDatos, 'primer-acceso.txt');
  fs.writeFileSync(archivo, `${base}/#k=${token}\n`, { mode: 0o600 });
  console.log(`Obra inicial creada con ${tareas.length} tareas. Link del propietario en ${archivo}`);
}

servidor.listen(puerto, process.env.ESCUCHAR || '127.0.0.1', () => {
  console.log(`Obras escuchando en el puerto ${puerto}`);
});
