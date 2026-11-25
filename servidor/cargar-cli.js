// Carga en la app la lista de datos-iniciales/carga.json, una sola vez por identificador (lo corre infra/instalar.sh).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase, cargarTareas } from './db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = path.resolve(process.env.DIR_DATOS || path.join(raiz, 'datos'));
const carga = JSON.parse(fs.readFileSync(path.join(raiz, 'datos-iniciales', 'carga.json'), 'utf8'));
const db = abrirBase(path.join(dirDatos, 'obras.db'));
db.exec('PRAGMA busy_timeout = 5000');
const r = cargarTareas(db, { ...carga, propietario: process.env.PROPIETARIO || 'Propietario' });
if (!r.hecho) console.log(`La carga «${carga.id}» ya estaba hecha: no se repite.`);
else {
  console.log(`Carga «${carga.id}»: ${r.tareas} tareas en la obra «${r.obra}».`);
  if (r.token) {
    const base = (process.env.URL_BASE || '').replace(/\/$/, '');
    fs.appendFileSync(path.join(dirDatos, 'primer-acceso.txt'), `${r.obra}: ${base}/#k=${r.token}\n`);
    console.log('Se creó una obra nueva: su link quedó al final de primer-acceso.txt');
  }
}
