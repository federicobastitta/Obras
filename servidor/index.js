import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { crearObra } from './db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirDatos = path.resolve(process.env.DIR_DATOS || path.join(raiz, 'datos'));
const puerto = Number(process.env.PUERTO || 3400);

const { servidor, db } = crearApp({ dirDatos, dirWeb: path.join(raiz, 'web') });

// Primera vez: crea las obras de datos-iniciales/obras.json con un mismo propietario y deja en
// datos/primer-acceso.txt un link que abre todas juntas (y debajo, el link de cada una).
if (db.prepare('SELECT COUNT(*) AS n FROM obras').get().n === 0) {
  const dirInicial = path.join(raiz, 'datos-iniciales');
  const lista = JSON.parse(fs.readFileSync(path.join(dirInicial, 'obras.json'), 'utf8'));
  const propietario = process.env.PROPIETARIO || 'Propietario';
  const base = (process.env.URL_BASE || `http://localhost:${puerto}`).replace(/\/$/, '');
  const creadas = lista.map((o) => {
    const tareas = o.tareas ? JSON.parse(fs.readFileSync(path.join(dirInicial, o.tareas), 'utf8')) : [];
    return { nombre: o.nombre, cantidad: tareas.length, token: crearObra(db, { nombre: o.nombre, propietario, tareas }).token };
  });
  const archivo = path.join(dirDatos, 'primer-acceso.txt');
  fs.writeFileSync(
    archivo,
    [`Todas las obras: ${base}/#k=${creadas.map((c) => c.token).join(',')}`, ...creadas.map((c) => `${c.nombre}: ${base}/#k=${c.token}`)].join('\n') + '\n',
    { mode: 0o600 },
  );
  console.log(`Obras iniciales creadas: ${creadas.map((c) => `${c.nombre} (${c.cantidad} tareas)`).join(', ')}. Links en ${archivo}`);
}

servidor.listen(puerto, process.env.ESCUCHAR || '127.0.0.1', () => {
  console.log(`Obras escuchando en el puerto ${puerto}`);
});
