// Prepara la demostración desde el servidor (lo corre infra/instalar.sh cuando existe datos-iniciales/demo.json).
// Crea las obras de ejemplo si faltan, le pone nombre al arquitecto y deja los links en <DIR_DATOS>/demo-acceso.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase } from './db.js';
import { asegurarDemo } from './demo.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = path.resolve(process.env.DIR_DATOS || path.join(raiz, 'datos'));
const config = JSON.parse(fs.readFileSync(path.join(raiz, 'datos-iniciales', 'demo.json'), 'utf8'));
fs.mkdirSync(path.join(dirDatos, 'fotos'), { recursive: true });
fs.mkdirSync(path.join(dirDatos, 'archivos'), { recursive: true });

const db = abrirBase(path.join(dirDatos, 'obras.db'));
db.exec('PRAGMA busy_timeout = 5000');
const links = asegurarDemo(db, {
  dirFotos: path.join(dirDatos, 'fotos'),
  dirArchivos: path.join(dirDatos, 'archivos'),
  propietario: process.env.PROPIETARIO || 'Propietario',
  arquitecto: config.arquitecto,
  urlBase: process.env.URL_BASE || '',
});
const archivo = path.join(dirDatos, 'demo-acceso.txt');
fs.writeFileSync(archivo, `Arquitecto (${config.arquitecto}): ${links.arquitecto}\nPropietario: ${links.propietario}\n`, { mode: 0o600 });
console.log(`Demostración lista para ${config.arquitecto}. Links en ${archivo}`);
