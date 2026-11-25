// Da de alta a quienes ejecutan las tareas de un propietario (datos-iniciales/equipo.json) en todas sus obras,
// una sola vez por identificador (lo corre infra/instalar.sh). Deja en <DIR_DATOS>/<archivo> el link de cada uno.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase, altaDeEquipo, llaveDeEquipo, completarEquipo } from './db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = path.resolve(process.env.DIR_DATOS || path.join(raiz, 'datos'));
const alta = JSON.parse(fs.readFileSync(path.join(raiz, 'datos-iniciales', 'equipo.json'), 'utf8'));
const db = abrirBase(path.join(dirDatos, 'obras.db'));
db.exec('PRAGMA busy_timeout = 5000');
const r = altaDeEquipo(db, alta);
if (!r.hecho) console.log(`El alta «${alta.id}» ya estaba hecha: no se repite.`);
else console.log(`Alta «${alta.id}»: ${r.personas.map((x) => x.nombre).join(', ')}.`);
// Si se sumó una sede, el equipo queda también en esa.
const sumadas = completarEquipo(db, alta);
if (sumadas) console.log(`Equipo sumado en sedes nuevas: ${sumadas} accesos.`);
// Link de cada uno, con un solo código (llave) que abre todas sus sedes: se reescribe en cada instalación.
const base = (process.env.URL_BASE || '').replace(/\/$/, '');
const archivo = path.join(dirDatos, path.basename(alta.archivo || 'acceso-equipo.txt'));
const lineas = alta.personas.map((x) => `${x.nombre}: ${base}/#l=${llaveDeEquipo(db, { propietario: alta.propietario, nombre: x.nombre })}`);
// Y el link corto del propietario, que abre todas sus sedes (también las que se sumen).
lineas.push(`${alta.propietario} (propietario): ${base}/#l=${llaveDeEquipo(db, { propietario: alta.propietario, nombre: alta.propietario, rol: 'propietario' })}`);
fs.writeFileSync(archivo, lineas.join('\n') + '\n', { mode: 0o600 });
console.log(`Links del equipo en ${archivo}`);
