// Da de alta las obras de datos-iniciales/altas.json con su propietario, una sola vez por identificador
// (lo corre infra/instalar.sh). Deja en <DIR_DATOS>/<archivo> un link que abre todas juntas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase, altaDeObras } from './db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = path.resolve(process.env.DIR_DATOS || path.join(raiz, 'datos'));
const alta = JSON.parse(fs.readFileSync(path.join(raiz, 'datos-iniciales', 'altas.json'), 'utf8'));
const db = abrirBase(path.join(dirDatos, 'obras.db'));
db.exec('PRAGMA busy_timeout = 5000');
const r = altaDeObras(db, alta);
if (!r.hecho) console.log(`El alta «${alta.id}» ya estaba hecha: no se repite.`);
else {
  const base = (process.env.URL_BASE || '').replace(/\/$/, '');
  const archivo = path.join(dirDatos, path.basename(alta.archivo || 'acceso-altas.txt'));
  fs.writeFileSync(archivo, `${alta.propietario}: ${base}/#k=${r.tokens.join(',')}\n`, { mode: 0o600 });
  console.log(`Alta «${alta.id}»: ${r.tokens.length} obras para ${alta.propietario}. Link en ${archivo}`);
}
