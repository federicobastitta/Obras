// Datos de demostración: dos obras de ejemplo con todo cargado (tareas en todos los estados, grupos, presupuestos,
// pagos, fotos, archivos, comentarios e historial) para mostrar cómo se usa la app. Quedan marcadas como «demo»
// y se pueden borrar enteras. No tocan ninguna obra real.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { nuevoToken } from './db.js';

const DIA = 86400000;
const hace = (dias) => new Date(Date.now() - dias * DIA);
const en = (dias) => new Date(Date.now() + dias * DIA).toISOString().slice(0, 10);

// ---------- fotos de ejemplo (escenas dibujadas, sin depender de nada externo) ----------
const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function trozo(tipo, datos) {
  const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
function aPng(W, H, px) {
  const fila = W * 3;
  const crudo = Buffer.alloc((fila + 1) * H);
  for (let y = 0; y < H; y++) px.copy(crudo, y * (fila + 1) + 1, y * fila, (y + 1) * fila);
  const cab = Buffer.alloc(13);
  cab.writeUInt32BE(W, 0);
  cab.writeUInt32BE(H, 4);
  cab[8] = 8;
  cab[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', cab), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

function escena(tipo, momento, semilla) {
  const W = 480, H = 320;
  const px = Buffer.alloc(W * H * 3);
  const limpio = momento === 'despues';
  let s = (semilla * 7919 + 13) % 233280;
  const azar = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const tope = (v) => Math.max(0, Math.min(255, v));
  const rect = (x0, y0, w, h, [r, g, b], ruido = 0) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
        const k = (y * W + x) * 3;
        const d = ruido ? (azar() - 0.5) * ruido : 0;
        px[k] = tope(r + d); px[k + 1] = tope(g + d); px[k + 2] = tope(b + d);
      }
    }
  };
  rect(0, 0, W, H, limpio ? [232, 226, 214] : [186, 178, 164], limpio ? 6 : 26);
  rect(0, 236, W, 84, limpio ? [150, 124, 98] : [112, 104, 96], limpio ? 8 : 30);
  rect(0, 232, W, 6, limpio ? [250, 248, 242] : [140, 134, 124]);
  switch (tipo) {
    case 'cocina':
      rect(40, 150, 400, 14, limpio ? [90, 92, 98] : [70, 66, 62], 8);
      rect(40, 164, 400, 70, limpio ? [200, 164, 112] : [140, 116, 88], 10);
      for (let x = 40; x < 440; x += 80) rect(x, 164, 2, 70, [60, 50, 40]);
      rect(170, 40, 140, 56, limpio ? [205, 210, 216] : [116, 116, 116], 6);
      if (!limpio) rect(90, 100, 70, 30, [96, 90, 84], 24);
      break;
    case 'bano':
      for (let y = 0; y < 232; y += 28) rect(0, y, W, 2, limpio ? [200, 208, 214] : [150, 150, 148]);
      for (let x = 0; x < W; x += 28) rect(x, 0, 2, 232, limpio ? [200, 208, 214] : [150, 150, 148]);
      rect(300, 150, 110, 82, limpio ? [250, 250, 250] : [214, 208, 196], 4);
      if (!limpio) rect(110, 196, 70, 36, [92, 122, 152], 12);
      break;
    case 'galeria':
      for (let x = 0; x < W; x += 40) rect(x, 236, 2, 84, [70, 50, 34]);
      for (let x = 60; x < W; x += 170) rect(x, 30, 24, 206, limpio ? [244, 240, 232] : [176, 168, 156], 8);
      if (limpio) for (let x = 90; x < W; x += 85) rect(x, 70, 14, 14, [255, 226, 150]);
      break;
    case 'pileta':
      rect(40, 150, 400, 150, limpio ? [64, 168, 212] : [128, 120, 108], limpio ? 14 : 28);
      rect(40, 138, 400, 14, limpio ? [238, 234, 224] : [160, 154, 146], 6);
      break;
    case 'electrico':
      rect(150, 50, 180, 170, limpio ? [200, 204, 208] : [120, 120, 118], 6);
      for (let i = 0; i < 6; i++) rect(170 + i * 26, 80, 18, 40, limpio ? [60, 64, 70] : [84, 84, 84]);
      if (limpio) for (let i = 0; i < 6; i++) rect(176 + i * 26, 90, 6, 14, [90, 200, 120]);
      else for (let i = 0; i < 5; i++) rect(180 + i * 30, 130 + (i % 2) * 20, 4, 70, [190, 60, 50]);
      break;
    case 'pintura':
      rect(0, 0, limpio ? W : 240, 232, [150, 196, 176], 8);
      rect(330, 60, 90, 120, limpio ? [250, 250, 246] : [210, 204, 190], 4);
      break;
    case 'piso':
      for (let x = 0; x < W; x += 60) rect(x, 236, 2, 84, [88, 70, 54]);
      for (let y = 236; y < H; y += 28) rect(0, y, W, 2, [88, 70, 54]);
      rect(60, 60, 140, 100, limpio ? [190, 214, 230] : [170, 176, 178], 4);
      break;
    default:
      rect(80, 140, 320, 90, limpio ? [186, 150, 104] : [130, 112, 90], 8);
      rect(80, 130, 320, 12, limpio ? [90, 92, 98] : [70, 68, 66], 6);
  }
  return aPng(W, H, px);
}

function pdf(titulo) {
  const t = titulo.replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 60);
  const texto = `BT /F1 16 Tf 20 150 Td (${t}) Tj ET BT /F1 10 Tf 20 120 Td (Documento de demostracion) Tj ET`;
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n` +
    `4 0 obj<</Length ${texto.length}>>stream\n${texto}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n` +
    `trailer<</Root 1 0 R/Size 6>>\n%%EOF\n`,
  );
}

// ---------- armado de una obra ----------
function construirObra(db, ctx, def) {
  const ins = (sql, ...v) => Number(db.prepare(sql).run(...v).lastInsertRowid);
  const obraId = ins('INSERT INTO obras (nombre, tipo, demo, creada) VALUES (?, ?, 1, ?)', def.nombre, def.tipo, hace(def.edad).toISOString());
  const P = {};
  for (const [clave, x] of Object.entries(def.personas)) {
    const token = nuevoToken();
    const id = ins(
      'INSERT INTO personas (obra_id, nombre, rol, rubro, limitado, token, creada) VALUES (?, ?, ?, ?, ?, ?, ?)',
      obraId, x.nombre, x.rol, x.rubro || '', x.limitado ? 1 : 0, token, hace(def.edad).toISOString(),
    );
    P[clave] = { id, token, ...x };
  }
  const dir = P[def.dir];

  const G = {};
  for (const g of def.grupos || []) {
    const plazo = en(g.pl);
    const id = ins(
      'INSERT INTO grupos (obra_id, nombre, estado, monto, moneda, nota, plazo, motivo, creado_por, creado, aprobado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      obraId, g.nombre, g.estado, g.m, g.mo || 'ARS', g.n || '', plazo, '', P[g.q].id, hace(g.pr).toISOString(), g.estado === 'aprobado' ? hace(g.ap).toISOString() : null,
    );
    G[g.nombre] = { ...g, id, plazo, moneda: g.mo || 'ARS' };
    for (const [dias, monto, nota] of g.pagos || []) {
      ins('INSERT INTO pagos (grupo_id, persona_id, monto, fecha, nota, creada) VALUES (?, ?, ?, ?, ?, ?)', id, dir.id, monto, en(-dias), nota || '', hace(dias).toISOString());
    }
  }

  for (const x of def.tareas) {
    const g = x.g ? G[x.g] : null;
    const quien = P[x.q || def.con];
    const plazo = g ? g.plazo : x.pl == null ? null : en(x.pl);
    const monto = g ? null : x.m ?? null;
    const moneda = g ? g.moneda : x.mo || 'ARS';
    const edad = x.edad ?? 20;
    const pr = x.pr ?? edad - 1;
    const ap = x.ap ?? Math.max(0, edad - 3);
    const estado = x.e;
    const aprobada = ['aprobada', 'realizada', 'verificada', 'devuelta'].includes(estado);
    const hecha = ['realizada', 'verificada', 'devuelta'].includes(estado);
    const conPrecio = g || monto != null;
    const id = ins(
      `INSERT INTO tareas (obra_id, grupo_id, asignada_a, lugar, texto, prioridad, estado, monto, moneda, presupuesto_nota, plazo, motivo,
        creada_por, creada, presupuestada_en, aprobada_en, realizada_en, verificada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      obraId, g ? g.id : null, x.q ? P[x.q].id : null, x.l, x.t, x.p || 'media', estado, monto, moneda, g ? '' : x.n || '', plazo, x.mot || '',
      dir.id, hace(edad).toISOString(), conPrecio ? hace(pr).toISOString() : null, aprobada ? hace(ap).toISOString() : null,
      hecha ? hace(x.r).toISOString() : null, estado === 'verificada' ? hace(x.v).toISOString() : null,
    );

    const evs = [[hace(edad), dir, 'creada', x.q && P[x.q].limitado ? `encargada a ${P[x.q].nombre} (${P[x.q].rubro})` : '']];
    if (conPrecio) {
      const det = g ? `en el grupo «${g.nombre}»: ${moneda} ${g.m} · plazo ${plazo}${g.n ? ' · ' + g.n : ''}` : `${moneda} ${monto} · plazo ${plazo}${x.n ? ' · ' + x.n : ''}`;
      evs.push([hace(pr), quien, 'presupuestada', det]);
    }
    if (estado === 'pendiente' && x.mot) evs.push([hace(pr - 0.5), dir, 'rechazada', g ? `grupo «${g.nombre}»: ${x.mot}` : x.mot]);
    if (aprobada) evs.push([hace(ap), dir, 'aprobada', g ? `grupo «${g.nombre}»: ${moneda} ${g.m}` : `${moneda} ${monto}`]);
    if (hecha) evs.push([hace(x.r), quien, 'realizada', '']);
    if (estado === 'devuelta') evs.push([hace(x.d), dir, 'devuelta', x.mot]);
    if (estado === 'verificada') evs.push([hace(x.v), dir, 'verificada', '']);
    for (const [dias, clave, tipo, det] of x.ev || []) evs.push([hace(dias), P[clave], tipo, det]);
    for (const [dias, monto2, nota] of x.pagos || []) {
      ins('INSERT INTO pagos (tarea_id, persona_id, monto, fecha, nota, creada) VALUES (?, ?, ?, ?, ?, ?)', id, dir.id, monto2, en(-dias), nota || '', hace(dias).toISOString());
      evs.push([hace(dias), dir, 'pago', `${moneda} ${monto2}${nota ? ' · ' + nota : ''}`]);
    }
    const fotos = [];
    for (const [dias, clave, momento, tipoEscena] of x.fotos || []) {
      const archivo = `${id}-${nuevoToken().slice(0, 16)}.png`;
      const ruta = path.join(ctx.dirFotos, archivo);
      fs.writeFileSync(ruta, escena(tipoEscena, momento, ++ctx.semilla));
      ctx.escritos.push(ruta);
      fotos.push([dias, P[clave], momento, archivo]);
      evs.push([hace(dias), P[clave], 'foto', momento === 'antes' ? 'antes' : momento === 'despues' ? 'después' : '']);
    }
    const adjuntos = [];
    for (const [dias, clave, nombre, contenido] of x.arch || []) {
      const archivo = `${id}-${nuevoToken().slice(0, 16)}`;
      const ruta = path.join(ctx.dirArchivos, archivo);
      const datos = nombre.endsWith('.pdf') ? pdf(nombre.replace(/\.pdf$/, '')) : Buffer.from(contenido || '');
      fs.writeFileSync(ruta, datos);
      ctx.escritos.push(ruta);
      adjuntos.push([dias, P[clave], nombre, archivo, datos.length]);
      evs.push([hace(dias), P[clave], 'archivo', nombre]);
    }
    evs.sort((a, b) => a[0] - b[0]);
    for (const [f, persona, tipo, det] of evs) ins('INSERT INTO eventos (tarea_id, persona_id, tipo, detalle, fecha) VALUES (?, ?, ?, ?, ?)', id, persona.id, tipo, det, f.toISOString());
    for (const [dias, persona, momento, archivo] of fotos) ins('INSERT INTO fotos (tarea_id, persona_id, momento, archivo, tipo, fecha) VALUES (?, ?, ?, ?, ?, ?)', id, persona.id, momento, archivo, 'image/png', hace(dias).toISOString());
    for (const [dias, persona, nombre, archivo, tam] of adjuntos) ins('INSERT INTO archivos (tarea_id, persona_id, nombre, archivo, tamano, fecha) VALUES (?, ?, ?, ?, ?, ?)', id, persona.id, nombre, archivo, tam, hace(dias).toISOString());
  }
  return { token: dir.token, nombre: def.nombre, tipo: def.tipo };
}

// ---------- las dos obras de ejemplo ----------
function casa(propietario, arquitecto) {
  return {
    nombre: 'Casa Los Álamos', tipo: 'Vivienda', edad: 40, dir: 'dir', con: 'con',
    personas: {
      dir: { nombre: propietario, rol: 'propietario' },
      arq: { nombre: arquitecto || 'Lucía Fernández (demo)', rol: 'arquitecto' },
      con: { nombre: 'Marcos Giménez (demo)', rol: 'constructor' },
      plo: { nombre: 'Pedro Ruiz (demo)', rol: 'constructor', rubro: 'Plomería', limitado: true },
      ele: { nombre: 'Sofía Ledesma (demo)', rol: 'constructor', rubro: 'Electricidad', limitado: true },
      pin: { nombre: 'Hugo Benítez (demo)', rol: 'constructor', rubro: 'Pintura', limitado: true },
    },
    grupos: [
      { nombre: 'Plomería baño completo', q: 'plo', estado: 'presupuestado', m: 138000, n: 'Incluye materiales y mano de obra', pl: 9, pr: 2 },
      { nombre: 'Electricidad de galería', q: 'ele', estado: 'aprobado', m: 260000, n: 'Cableado, tablero y luminarias', pl: 5, pr: 12, ap: 9, pagos: [[8, 100000, 'Anticipo del 40 %']] },
    ],
    tareas: [
      { l: 'Cocina', t: 'Instalar campana extractora', e: 'verificada', m: 185000, n: 'Incluye conducto y colocación', pl: -12, edad: 34, r: 14, v: 12,
        pagos: [[24, 90000, 'Anticipo'], [11, 95000, 'Saldo']],
        fotos: [[33, 'dir', 'antes', 'cocina'], [14, 'con', 'despues', 'cocina']],
        ev: [[20, 'con', 'comentario', 'Llegó la campana. Mañana la instalo.'], [19, 'dir', 'comentario', 'Perfecto, gracias.']] },
      { l: 'Cocina', t: 'Colocar mesada de granito', e: 'verificada', m: 420000, n: 'Granito gris mara, con bacha', pl: -8, edad: 32, r: 10, v: 8,
        pagos: [[22, 200000, 'Anticipo'], [7, 220000, 'Saldo']],
        fotos: [[10, 'con', 'despues', 'cocina']],
        arch: [[30, 'arq', 'Plano de mesada.pdf']] },
      { l: 'Cocina', t: 'Pintar paredes y cielorraso', e: 'realizada', q: 'pin', m: 96000, n: 'Dos manos, látex lavable', pl: -1, edad: 18, r: 1,
        fotos: [[17, 'dir', 'antes', 'pintura'], [1, 'pin', 'despues', 'pintura']],
        ev: [[1, 'pin', 'comentario', 'Terminé hoy. Falta que la revisen.']] },
      { l: 'Baño principal', t: 'Cambiar flexibles y canillas', e: 'presupuestada', q: 'plo', g: 'Plomería baño completo', p: 'alta', edad: 6,
        fotos: [[5, 'dir', 'antes', 'bano']], arch: [[2, 'plo', 'Presupuesto plomería.pdf']] },
      { l: 'Baño principal', t: 'Colocar inodoro y bidet', e: 'presupuestada', q: 'plo', g: 'Plomería baño completo', edad: 6 },
      { l: 'Baño principal', t: 'Destapar y revisar desagües', e: 'presupuestada', q: 'plo', g: 'Plomería baño completo', edad: 6,
        ev: [[2, 'plo', 'comentario', 'Los precios son por el baño completo. Si quieren, lo separo por tarea.']] },
      { l: 'Baño principal', t: 'Colocar cortina de baño', e: 'aprobada', m: 18500, pl: 3, edad: 14 },
      { l: 'Galería', t: 'Iluminación LED y dicroicas', e: 'aprobada', q: 'ele', g: 'Electricidad de galería', p: 'alta', edad: 16,
        fotos: [[3, 'ele', 'antes', 'galeria']] },
      { l: 'Galería', t: 'Colocar enchufes en columnas', e: 'aprobada', q: 'ele', g: 'Electricidad de galería', edad: 16,
        ev: [[4, 'ele', 'comentario', 'Necesito saber la altura de los enchufes. ¿40 cm del piso?'], [4, 'arq', 'comentario', 'Sí, 40 cm. Cajas embutidas.']] },
      { l: 'Galería', t: 'Instalar tablero eléctrico', e: 'realizada', q: 'ele', g: 'Electricidad de galería', edad: 16, r: 2,
        fotos: [[2, 'ele', 'antes', 'electrico'], [2, 'ele', 'despues', 'electrico']],
        arch: [[2, 'ele', 'Diagrama unifilar.pdf']] },
      { l: 'Galería', t: 'Colocar piedras decorativas', e: 'pendiente', q: 'con', p: 'baja', edad: 8 },
      { l: 'Galería', t: 'Colocar fuente', e: 'presupuestada', m: 340000, n: 'Fuente de piedra con bomba', pl: 14, edad: 5 },
      { l: 'Galería', t: 'Instalar canilla en sector externo', e: 'aprobada', m: 22000, pl: -2, edad: 18, p: 'alta',
        ev: [[6, 'dir', 'comentario', 'Esta es urgente: ya empieza la temporada de riego.']] },
      { l: 'Pileta', t: 'Terminar borde de pileta', e: 'aprobada', m: 3200, mo: 'USD', n: 'Material y colocación', pl: 6, edad: 22, pagos: [[9, 1000, 'Anticipo en dólares']],
        fotos: [[9, 'dir', 'antes', 'pileta']] },
      { l: 'Pileta', t: 'Instalar caldera de pileta', e: 'presupuestada', m: 1850, mo: 'USD', n: 'Equipo con instalación', pl: 11, edad: 4 },
      { l: 'Pileta', t: 'Instalar filtros de pileta', e: 'aprobada', m: 900, mo: 'USD', pl: 7, edad: 12 },
      { l: 'Pileta', t: 'Comprobar llenado y filtrado', e: 'pendiente', p: 'alta', edad: 3 },
      { l: 'Living', t: 'Instalar los espejos', e: 'devuelta', m: 54000, pl: 2, edad: 20, r: 5, d: 3, mot: 'Uno de los espejos quedó torcido y faltan sellar los bordes.',
        fotos: [[5, 'con', 'despues', 'generico']] },
      { l: 'Living', t: 'Colocar zócalos', e: 'verificada', m: 38000, pl: -15, edad: 36, r: 18, v: 15, pagos: [[16, 38000, 'Pago total']] },
      { l: 'Lavadero', t: 'Colocar lavarropas', e: 'pendiente', m: 62000, n: 'Con instalación y conexión', pl: 10, edad: 9, mot: 'Muy caro, pedime otra cotización.' },
      { l: 'Lavadero', t: 'Revisar pérdida del termotanque', e: 'aprobada', q: 'plo', m: 24000, pl: 1, edad: 7, p: 'alta',
        fotos: [[6, 'dir', 'antes', 'bano']] },
      { l: 'Interior', t: 'Colocar picaporte baño planta alta', e: 'realizada', m: 6500, pl: 2, edad: 10, r: 1 },
      { l: 'Frente', t: 'Pintar portón y rejas', e: 'aprobada', q: 'pin', m: 72000, pl: 4, edad: 9 },
      { l: 'Frente', t: 'Colocar timbre y portero', e: 'pendiente', p: 'baja', edad: 2 },
    ],
  };
}

function clinica(propietario, arquitecto) {
  return {
    nombre: 'Clínica Norte', tipo: 'Clínica o consultorio', edad: 25, dir: 'dir', con: 'con',
    personas: {
      dir: { nombre: propietario, rol: 'propietario' },
      arq: { nombre: arquitecto || 'Lucía Fernández (demo)', rol: 'arquitecto' },
      con: { nombre: 'Diego Salas (demo)', rol: 'constructor' },
      aire: { nombre: 'Aire Sur (demo)', rol: 'constructor', rubro: 'Aire acondicionado', limitado: true },
    },
    grupos: [],
    tareas: [
      { l: 'Recepción', t: 'Mostrador de atención a medida', e: 'aprobada', m: 580000, n: 'Melamina y cubierta de cuarzo', pl: 12, edad: 14, pagos: [[7, 200000, 'Anticipo']],
        arch: [[13, 'arq', 'Plano mostrador.pdf']] },
      { l: 'Recepción', t: 'Instalar cartelería y señalética', e: 'presupuestada', m: 120000, pl: 15, edad: 3 },
      { l: 'Consultorio 1', t: 'Instalar aire acondicionado split', e: 'aprobada', q: 'aire', m: 890000, n: 'Equipo frío/calor 3000 frigorías', pl: 8, edad: 11,
        pagos: [[5, 300000, 'Anticipo']], fotos: [[4, 'aire', 'antes', 'generico']] },
      { l: 'Consultorio 1', t: 'Cambiar piso vinílico', e: 'realizada', m: 410000, pl: -2, edad: 20, r: 2,
        fotos: [[15, 'dir', 'antes', 'piso'], [2, 'con', 'despues', 'piso']] },
      { l: 'Consultorio 1', t: 'Instalar tomas de datos', e: 'aprobada', m: 45000, pl: 5, edad: 9 },
      { l: 'Sala de espera', t: 'Pintura general', e: 'verificada', m: 150000, pl: -10, edad: 24, r: 12, v: 10, pagos: [[11, 75000, 'Anticipo'], [9, 75000, 'Saldo']],
        fotos: [[12, 'con', 'despues', 'pintura']] },
      { l: 'Sala de espera', t: 'Colocar sillones y cortinas', e: 'pendiente', p: 'baja', edad: 4 },
      { l: 'Baños', t: 'Colocar barrales de accesibilidad', e: 'presupuestada', m: 68000, n: 'Barrales de acero inoxidable', pl: 7, edad: 2 },
      { l: 'Baños', t: 'Cambiar canillas por temporizadas', e: 'aprobada', m: 64000, pl: -3, edad: 15, p: 'alta' },
    ],
  };
}

/** Crea las dos obras de ejemplo. Devuelve el acceso de propietario de cada una. */
export function cargarDemo(db, { dirFotos, dirArchivos, propietario, arquitecto }) {
  const ctx = { dirFotos, dirArchivos, escritos: [], semilla: 0 };
  db.exec('BEGIN');
  try {
    const obras = [construirObra(db, ctx, casa(propietario, arquitecto)), construirObra(db, ctx, clinica(propietario, arquitecto))];
    db.exec('COMMIT');
    return obras;
  } catch (e) {
    db.exec('ROLLBACK');
    for (const r of ctx.escritos) fs.rmSync(r, { force: true });
    throw e;
  }
}

/**
 * Deja lista la demostración para mostrarle el sistema a un arquitecto con nombre propio: crea las obras de ejemplo si
 * no existen y le pone ese nombre al arquitecto. Devuelve un link para él y otro para el propietario; cada link abre
 * las obras de demostración juntas. Se puede llamar todas las veces que haga falta.
 */
export function asegurarDemo(db, { dirFotos, dirArchivos, propietario, arquitecto, urlBase }) {
  if (!db.prepare('SELECT COUNT(*) AS n FROM obras WHERE demo = 1').get().n) {
    cargarDemo(db, { dirFotos, dirArchivos, propietario, arquitecto });
  } else if (arquitecto) {
    db.prepare("UPDATE personas SET nombre = ? WHERE rol = 'arquitecto' AND obra_id IN (SELECT id FROM obras WHERE demo = 1)").run(arquitecto);
  }
  const de = (rol) => db
    .prepare('SELECT p.token FROM personas p JOIN obras o ON o.id = p.obra_id WHERE o.demo = 1 AND p.rol = ? AND p.activa = 1 ORDER BY o.id, p.id')
    .all(rol).map((x) => x.token);
  const base = (urlBase || '').replace(/\/$/, '');
  return { arquitecto: `${base}/#k=${de('arquitecto').join(',')}`, propietario: `${base}/#k=${de('propietario').join(',')}` };
}
