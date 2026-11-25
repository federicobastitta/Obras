// Construir: tareas, presupuestos, plazos, fotos y pagos de una obra (presupuestos y pagos apagados: CON_PRESUPUESTOS).
const app = document.getElementById('app');
const CLAVE = 'obras.token';
const CLAVE_ACCESOS = 'obras.accesos';

let token = null;
let yo = null;
let obra = null;
let tareas = [];
let grupos = [];
let filtro = null;
let urlsDeFotos = [];

// ---------- movimiento de las fotos ----------
// Al inclinar el celular las fotos se desplazan un poco, como si fueran una ventana. En la computadora sigue al mouse.
const tilt = { x: 0, y: 0, ox: 0, oy: 0, base: null, recibido: false, raf: 0 };
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');
const limitar = (n) => Math.max(-1, Math.min(1, n));
function animarTilt() {
  tilt.x += (tilt.ox - tilt.x) * 0.12;
  tilt.y += (tilt.oy - tilt.y) * 0.12;
  const r = document.documentElement.style;
  r.setProperty('--mx', tilt.x.toFixed(3));
  r.setProperty('--my', tilt.y.toFixed(3));
  tilt.raf = Math.abs(tilt.ox - tilt.x) > 0.002 || Math.abs(tilt.oy - tilt.y) > 0.002 ? requestAnimationFrame(animarTilt) : 0;
}
function alInclinar(e) {
  if (e.gamma == null || e.beta == null || sinMovimiento.matches) return;
  tilt.recibido = true;
  document.getElementById('mover')?.remove();
  if (!tilt.base) tilt.base = { b: e.beta, g: e.gamma };
  // La posición de reposo se va ajustando sola, para que siga la forma en que se agarra el celular.
  tilt.base.b += (e.beta - tilt.base.b) * 0.004;
  tilt.base.g += (e.gamma - tilt.base.g) * 0.004;
  tilt.ox = limitar((e.gamma - tilt.base.g) / 22);
  tilt.oy = limitar((e.beta - tilt.base.b) / 22);
  if (!tilt.raf) tilt.raf = requestAnimationFrame(animarTilt);
}
function alMoverMouse(e) {
  if (e.pointerType !== 'mouse' || sinMovimiento.matches) return;
  tilt.ox = limitar((e.clientX / innerWidth - 0.5) * 2);
  tilt.oy = limitar((e.clientY / innerHeight - 0.5) * 2);
  if (!tilt.raf) tilt.raf = requestAnimationFrame(animarTilt);
}
const pideAutorizacion = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
/** En iPhone el sensor solo manda datos después de que la persona da permiso, y el permiso se pide con un toque. */
async function activarMovimiento() {
  if (sinMovimiento.matches) return false;
  if (pideAutorizacion()) {
    try { if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false; } catch { return false; }
  }
  try { localStorage.setItem('construir.movimiento', '1'); } catch {}
  return true;
}
// El sensor se escucha siempre: en Android y en la computadora los datos llegan solos; en iPhone llegan cuando se da el permiso.
window.addEventListener('deviceorientation', alInclinar);
window.addEventListener('pointermove', alMoverMouse, { passive: true });
if (pideAutorizacion()) {
  // Si ya lo activó antes, se vuelve a pedir en el primer toque.
  let antes = false;
  try { antes = localStorage.getItem('construir.movimiento') === '1'; } catch {}
  if (antes) window.addEventListener('pointerdown', () => activarMovimiento(), { once: true });
}

// Dueño 25/11/2026: «por ahora sacá todo lo que dice presupuestos», «va a ser de uso interno». En true vuelve todo.
const CON_PRESUPUESTOS = false;
const ESTADOS = {
  pendiente: [CON_PRESUPUESTOS ? 'Sin presupuesto' : 'Pendiente', 'pend'],
  presupuestada: ['Presupuesto a aprobar', 'info'],
  aprobada: ['Aprobada, por hacer', 'info'],
  realizada: ['Realizada, a verificar', 'pend'],
  verificada: ['Terminada', 'ok'],
  devuelta: ['Devuelta', 'mal'],
};
const ESTADOS_PRESUPUESTO = {
  sin: ['Sin presupuesto', 'pend'],
  presupuestado: ['A aprobar', 'info'],
  aprobado: ['Aprobado', 'ok'],
  rechazado: ['Rechazado', 'mal'],
};
/** Estado del presupuesto de una tarea suelta (las que están en grupo usan el estado del grupo). */
function estadoPresupuesto(t) {
  if (t.estado === 'presupuestada') return 'presupuestado';
  if (t.monto == null) return 'sin';
  return t.estado === 'pendiente' ? 'rechazado' : 'aprobado';
}
const chipPresupuesto = (estado) => h('span', { class: 'chip ' + ESTADOS_PRESUPUESTO[estado][1] }, ESTADOS_PRESUPUESTO[estado][0]);
const TIPOS_DE_OBRA = ['Vivienda', 'Clínica o consultorio', 'Local comercial', 'Oficina', 'Edificio', 'Industria o depósito', 'Espacio exterior', 'Otra'];
const RUBROS = ['Plomería', 'Electricidad', 'Albañilería', 'Pintura', 'Carpintería', 'Herrería', 'Gas', 'Durlock y yesería', 'Pisos y revestimientos', 'Aire acondicionado', 'Pileta', 'Jardinería', 'Vidrios y aberturas', 'Techos e impermeabilización'];
/** Cómo se nombra a una persona según su rol: un constructor con acceso limitado es un proveedor de un rubro. */
const rotulo = (p) => (p.pide ? 'Pide tareas' : p.limitado ? `Proveedor${p.rubro ? ' · ' + p.rubro : ''}` : ROLES[p.rol] + (p.rubro ? ' · ' + p.rubro : ''));
const CLAVE_TIPO = { 'Vivienda': 'vivienda', 'Clínica o consultorio': 'clinica', 'Local comercial': 'local', 'Oficina': 'oficina', 'Edificio': 'edificio', 'Industria o depósito': 'industria', 'Espacio exterior': 'exterior' };
const ROLES = { propietario: 'Propietario', arquitecto: 'Arquitecto', constructor: 'Constructor' };
const EVENTOS = {
  creada: 'cargó la tarea',
  editada: 'cambió la tarea',
  presupuestada: 'cargó el presupuesto',
  aprobada: 'aprobó el presupuesto',
  rechazada: 'rechazó el presupuesto',
  realizada: 'la marcó como realizada',
  verificada: 'la verificó',
  devuelta: 'la devolvió',
  desagrupada: 'la sacó del grupo',
  comentario: 'comentó',
  foto: 'subió una foto',
  foto_borrada: 'borró una foto',
  archivo: 'subió un archivo',
  archivo_borrado: 'borró un archivo',
  pago: 'registró un pago',
  pago_borrado: 'borró un pago',
};

// ---------- utilidades ----------
function h(etiqueta, attrs, ...hijos) {
  const n = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const x of hijos.flat()) {
    if (x == null || x === false) continue;
    n.append(x instanceof Node ? x : document.createTextNode(String(x)));
  }
  return n;
}
// Íconos de línea (trazo de 1,75 px, 24 px de grilla).
const ICONOS = {
  casa: ['M3 10.5L12 3l9 7.5', 'M5 9v11h14V9', 'M10 20v-5h4v5'],
  mas: ['M12 5v14', 'M5 12h14'],
  usuariomas: ['M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20', 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'M19 8v6', 'M22 11h-6'],
  enlace: ['M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 5', 'M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19'],
  flask: ['M9 3h6', 'M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3', 'M7.5 15h9'],
  papelera: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  billete: ['M3 6h18v12H3z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
  ojo: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'],
  carpeta: ['M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.5h8.8A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z'],
  camara: ['M4 8h3l1.5-2.5h7L17 8h3v11H4z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7'],
  reloj: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 7.5V12l3 2'],
  clip: ['M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.2 3.2 0 0 1 4.5 4.5L9.5 17a1.4 1.4 0 0 1-2-2L15 7.5'],
  chat: ['M20 12a8 8 0 0 1-11.5 7.2L4 20.5l1.3-4A8 8 0 1 1 20 12z'],
  lista: ['M9 4h6v3H9z', 'M7 5.5H5.5V20h13V5.5H17', 'M9 12h6', 'M9 16h4'],
  grafico: ['M5 20V10', 'M12 20V4', 'M19 20v-7'],
  atras: ['M15 5l-7 7 7 7'],
};
function ico(nombre) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONOS[nombre] || []) {
    const trazo = document.createElementNS(NS, 'path');
    trazo.setAttribute('d', d);
    svg.append(trazo);
  }
  return svg;
}
const iniciales = (nombre) => nombre.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase();

/** Como Node.append / replaceChildren pero ignorando null y false (los nativos escriben la palabra «null»). */
const anexar = (padre, ...hijos) => { for (const x of hijos.flat()) if (x != null && x !== false) padre.append(x); };
const reemplazar = (padre, ...hijos) => { padre.replaceChildren(); anexar(padre, ...hijos); };
const dosDigitos = (n) => String(n).padStart(2, '0');
function dia(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
function momento(iso) {
  const f = new Date(iso);
  return `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}/${f.getFullYear()} ${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;
}
function hoy() {
  const f = new Date();
  return `${f.getFullYear()}-${dosDigitos(f.getMonth() + 1)}-${dosDigitos(f.getDate())}`;
}
const numero = new Intl.NumberFormat('es-AR');
const plata = (monto, moneda) => (moneda === 'USD' ? 'US$ ' : '$ ') + numero.format(monto);
const esDireccion = () => yo.rol === 'propietario' || yo.rol === 'arquitecto';
const esConstructor = () => yo.rol === 'constructor';
const terminada = (t) => t.estado === 'verificada';
const vencida = (t) => t.plazo && t.plazo < hoy() && !['realizada', 'verificada'].includes(t.estado);
/** Si la tarea espera una respuesta de alguien con ese rol. */
function leToca(t, rol) {
  if (rol === 'constructor') return ['pendiente', 'aprobada', 'devuelta'].includes(t.estado);
  return ['presupuestada', 'realizada'].includes(t.estado);
}
const meToca = (t) => leToca(t, yo.rol);

let relojAviso;
function avisar(texto, error = false) {
  const a = document.getElementById('aviso');
  a.textContent = texto;
  a.className = 'aviso' + (error ? ' error' : '');
  a.hidden = false;
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => (a.hidden = true), error ? 6000 : 2500);
}

async function api(metodo, ruta, cuerpo) {
  const op = { method: metodo, headers: { Authorization: 'Bearer ' + token } };
  if (cuerpo instanceof Blob) op.body = cuerpo;
  else if (cuerpo) {
    op.headers['Content-Type'] = 'application/json';
    op.body = JSON.stringify(cuerpo);
  }
  let r;
  try {
    r = await fetch('/api' + ruta, op);
  } catch {
    throw new Error('No hay conexión. Probá de nuevo cuando vuelva la señal.');
  }
  if (r.status === 401) {
    const quedan = accesos().filter((x) => x.token !== token);
    guardarAccesos(quedan);
    try { localStorage.removeItem(CLAVE); } catch {}
    token = null;
    yo = null;
    if (quedan.length) {
      avisar('Ese acceso fue dado de baja. Pasaste a otra de tus obras.', true);
      cambiarDeObra(quedan[quedan.length - 1].token);
    } else {
      pantallaIngreso('El link de acceso no es válido o fue dado de baja.');
    }
    throw new Error('Acceso no válido.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'No se pudo completar.');
  return datos;
}

/** Ejecuta una acción de un botón o formulario: lo deshabilita mientras corre y muestra el error si falla. */
async function hacer(control, tarea, hecho) {
  if (control) control.disabled = true;
  try {
    await tarea();
    if (hecho) avisar(hecho);
    return true;
  } catch (e) {
    avisar(e.message, true);
    return false;
  } finally {
    if (control) control.disabled = false;
  }
}

async function achicar(archivo) {
  const MAX = 1600;
  let img;
  try {
    img = await createImageBitmap(archivo);
  } catch {
    throw new Error('Ese archivo no es una foto que se pueda leer.');
  }
  const escala = Math.min(1, MAX / Math.max(img.width, img.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo preparar la foto.'))), 'image/jpeg', 0.82));
}

// ---------- inicio (sin link de acceso) ----------
// Página de presentación, pensada para un arquitecto: qué resuelve la app y cómo se entra.
function pantallaIngreso(mensaje) {
  document.title = 'Construir';
  const campo = h('input', { id: 'codigo', type: 'text', autocomplete: 'off', placeholder: 'Pegá acá tu link de acceso' });
  const entrar = h('form', {
    class: 'caja', id: 'entrar',
    onsubmit: (e) => {
      e.preventDefault();
      const v = campo.value.trim();
      const k = (v.match(/k=([0-9a-f]{20,}(?:,[0-9a-f]{20,})*)/i) || v.match(/^([0-9a-f]{20,})$/i) || [])[1];
      if (!k) return avisar('Ese link no tiene un código de acceso.', true);
      history.replaceState(null, '', location.pathname + '#k=' + k);
      arrancar();
    },
  },
    h('h2', null, 'Entrar a tu obra'),
    mensaje ? h('p', { class: 'nota' }, mensaje) : null,
    h('p', { class: 'sub' }, 'Cada persona entra con un link personal, sin usuario ni contraseña. Si ya te pasaron el tuyo, abrilo o pegalo acá.'),
    h('label', { for: 'codigo' }, 'Link de acceso', campo),
    h('button', { class: 'principal', type: 'submit' }, 'Entrar'));

  const funcion = (icono, titulo, texto) => h('article', { class: 'funcion' }, h('span', { class: 'icono' }, ico(icono)), h('h3', null, titulo), h('p', null, texto));
  const paso = (titulo, texto) => h('li', null, h('strong', null, titulo), h('span', null, texto));
  const etapa = (clase, nombre, quien) => h('li', null, h('span', { class: 'chip ' + clase }, nombre), h('span', { class: 'sub' }, quien));
  const irAEntrar = (e) => { e.preventDefault(); entrar.scrollIntoView({ behavior: 'smooth' }); campo.focus({ preventScroll: true }); };

  app.replaceChildren(
    h('header', { class: 'portada' },
      h('div', { class: 'arriba' },
        h('span', { class: 'logo' }, h('span', { class: 'marca-logo' }, ico('casa')), 'Construir'),
        h('a', { class: 'boton', href: '#entrar', onclick: irAEntrar }, 'Entrar')),
      h('div', { class: 'ancho-pagina' },
        h('h1', null, CON_PRESUPUESTOS ? 'Los pendientes de tu obra, con precio, fecha y responsable.' : 'Los pendientes de cada sede, con fecha y responsable.'),
        h('p', { class: 'bajada' }, CON_PRESUPUESTOS ? 'Cargás lo que falta hacer, el constructor lo presupuesta y le pone fecha de entrega, y vos aprobás y verificás desde el celular. Todo queda escrito: nadie discute qué se pidió ni cuánto se acordó.' : 'Cargás lo que hay que hacer en cada sede, mantenimiento lo resuelve y lo marca como realizado, y vos lo verificás desde el celular. Todo queda escrito.'),
        h('div', { class: 'fila' },
          h('a', { class: 'boton principal', href: '#entrar', onclick: irAEntrar }, 'Ya tengo mi link de acceso')))),
    h('main', { class: 'inicio' },
      mensaje ? entrar : null,
      h('section', null,
        h('h2', null, 'Qué hacés como arquitecto'),
        h('div', { class: 'funciones' },
          funcion('lista', 'Cargás los pendientes', 'Tarea por tarea, ordenadas por ambiente y con prioridad. Les sumás fotos para mostrar qué hay que hacer.'),
          CON_PRESUPUESTOS && funcion('billete', 'Recibís el presupuesto', 'El constructor cotiza cada tarea, o junta varias con un solo precio. Siempre con fecha de entrega y una nota de qué incluye.'),
          funcion('check', 'Aprobás o rechazás', 'Con un toque. Si rechazás, queda escrito el motivo y el constructor puede volver a cotizar.'),
          funcion('ojo', 'Verificás el trabajo', 'Cuando el constructor marca una tarea como realizada, la revisás: la das por terminada o la devolvés con el motivo.'),
          CON_PRESUPUESTOS && funcion('grafico', 'Controlás la plata', 'Registrás anticipos y pagos. El resumen muestra presupuestado, aprobado, pagado y saldo, por ambiente y en total.'),
          funcion('carpeta', 'Llevás varias obras', 'Cada obra tiene sus tareas, su gente y sus números por separado. Pasás de una a otra desde la misma app.'))),
      h('section', null,
        h('h2', null, 'El recorrido de cada tarea'),
        h('p', { class: 'sub' }, 'En todo momento se ve en qué etapa está cada pendiente y a quién le toca moverlo.'),
        h('ol', { class: 'circuito' },
          CON_PRESUPUESTOS && etapa('pend', 'Sin presupuesto', 'Cotiza el constructor'),
          CON_PRESUPUESTOS && etapa('info', 'Presupuesto a aprobar', 'Aprobás vos'),
          etapa('info', 'Aprobada, por hacer', 'Trabaja el constructor'),
          etapa('pend', 'Realizada, a verificar', 'Verificás vos'),
          etapa('ok', 'Terminada', 'Queda en el historial'))),
      h('section', null,
        h('h2', null, 'Lo que queda registrado'),
        h('div', { class: 'funciones' },
          funcion('camara', 'Fotos de antes y después', 'Las sube cualquiera desde el celular, en la tarea que corresponde.'),
          funcion('clip', 'Archivos y planos', 'PDF, planos, planillas y otros documentos, junto a la tarea a la que pertenecen.'),
          funcion('chat', 'Comentarios', 'Las preguntas y aclaraciones quedan en la tarea, no perdidas en un chat.'),
          funcion('reloj', 'Historial', 'Quién cargó, cotizó, aprobó, pagó o devolvió cada cosa, con fecha y hora.'))),
      h('section', null,
        h('h2', null, 'Cómo se empieza'),
        h('ol', { class: 'pasos' },
          paso('Entrás con tu link.', 'Lo recibís por WhatsApp y lo abrís en el celular. Se puede instalar como una app.'),
          paso('Sumás a las personas.', 'Al constructor y al propietario les generás su propio link desde la pestaña Personas.'),
          paso('Cargás los pendientes.', CON_PRESUPUESTOS ? 'El constructor los ve al instante y empieza a presupuestar.' : 'Quien los hace los ve al instante.'))),
      mensaje ? null : entrar,
    ),
  );
}
function guardarToken(k) {
  token = k;
  try { localStorage.setItem(CLAVE, k); } catch {}
}

// Un link por obra: el celular recuerda todos los que se abrieron para poder pasar de una obra a otra.
function accesos() {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE_ACCESOS) || '[]');
    return Array.isArray(lista) ? lista.filter((x) => x && typeof x.token === 'string') : [];
  } catch {
    return [];
  }
}
function guardarAccesos(lista) {
  try { localStorage.setItem(CLAVE_ACCESOS, JSON.stringify(lista)); } catch {}
}
function recordarAcceso() {
  const lista = accesos().filter((x) => x.token !== token);
  lista.push({ token, obra: obra.nombre, tipo: obra.tipo || '', persona: yo.nombre, rol: yo.rol, rubro: yo.rubro || '', limitado: !!yo.limitado, pide: !!yo.pide });
  guardarAccesos(lista);
}
function cambiarDeObra(k, destino = '') {
  guardarToken(k);
  yo = null;
  filtro = null;
  history.replaceState(null, '', location.pathname + (destino ? '#/' + destino : ''));
  arrancar();
}

// ---------- marco ----------
function marco(actual, ...contenido) {
  for (const u of urlsDeFotos) URL.revokeObjectURL(u);
  urlsDeFotos = [];
  const pestana = (ruta, texto) => h('a', { href: '#/' + ruta, 'aria-current': actual === ruta ? 'page' : null }, texto);
  app.replaceChildren(
    h('header', { class: 'barra' },
      h('div', { class: 'arriba' },
        h('a', { class: 'logo', href: '#/' }, h('span', { class: 'marca-logo' }, ico('casa')), 'Construir'),
        h('div', { class: 'persona' },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(yo.nombre)),
          h('span', { class: 'quien' }, h('strong', null, yo.nombre), h('span', null, rotulo(yo))))),
      actual === '' ? null : h('div', { class: 'contexto' },
        h('h1', null, obra.nombre),
        obra.tipo ? h('span', { class: 'chip' }, obra.tipo) : null,
        obra.demo ? h('span', { class: 'chip pend' }, 'Demo') : null),
      h('nav', { class: 'pestanas' },
        pestana('', 'Inicio'),
        pestana('tareas', 'Tareas'),
        CON_PRESUPUESTOS ? pestana('presupuestos', 'Presupuestos') : null,
        pestana('resumen', 'Resumen'),
        esDireccion() && !yo.pide ? pestana('personas', 'Personas') : null,
      ),
    ),
    h('main', null, ...contenido),
  );
}

async function cargarTareas() {
  const d = await api('GET', '/tareas');
  tareas = d.tareas;
  grupos = d.grupos || [];
}

// ---------- ayudantes compartidos ----------
/** Constructor y proveedores activos de la obra abierta (solo lo puede pedir quien dirige). */
async function quienesEjecutan() {
  try {
    return (await api('GET', '/personas')).personas.filter((x) => x.rol === 'constructor' && x.activa);
  } catch {
    return [];
  }
}
function selectorDeQuien(id, personas, actual) {
  const sel = h('select', { id }, h('option', { value: '' }, 'Sin encargar a nadie en particular'), personas.map((x) => h('option', { value: x.id }, `${x.nombre} · ${rotulo(x)}`)));
  sel.value = actual ?? '';
  return sel;
}
const ES_FOTO = /\.(jpe?g|png|webp|heic)$/i;
const tamano = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Sube fotos y archivos a una tarea con el link indicado. Las fotos se achican; lo demás va tal cual (hasta 20 MB). */
async function subirAdjuntos(k, tareaId, lista, momentoFoto = 'otro') {
  for (const a of lista) {
    const foto = a.type.startsWith('image/') && !/heic/i.test(a.type + a.name);
    if (!foto && a.size > 20 * 1024 * 1024) throw new Error(`«${a.name}» pesa más de 20 MB.`);
    const ruta = foto ? `/api/tareas/${tareaId}/fotos?momento=${momentoFoto}` : `/api/tareas/${tareaId}/archivos?nombre=${encodeURIComponent(a.name)}`;
    let r;
    try {
      r = await fetch(ruta, { method: 'POST', headers: { Authorization: 'Bearer ' + k }, body: foto ? await achicar(a) : a });
    } catch (e) {
      throw new Error(e.message && !/fetch/i.test(e.message) ? e.message : 'No hay conexión. Probá de nuevo cuando vuelva la señal.');
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `No se pudo subir «${a.name}».`);
  }
}
async function bajarArchivo(a) {
  const r = await fetch('/api/archivos/' + a.id, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('No se pudo bajar el archivo.');
  const u = URL.createObjectURL(await r.blob());
  const enlace = h('a', { href: u, download: a.nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
/** Link que abre WhatsApp en su lista de contactos, con el mensaje ya escrito, para elegir a quién mandárselo. */
function linkDeWhatsApp(mensaje) {
  const texto = encodeURIComponent(mensaje);
  // En el celular se abre la app directo en "Enviar a…"; en la computadora, WhatsApp Web.
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? `whatsapp://send?text=${texto}` : `https://wa.me/?text=${texto}`;
}
function botonWhatsApp(mensaje, clase, texto) {
  const href = linkDeWhatsApp(mensaje);
  // El link de la app se abre en el lugar; el de WhatsApp Web, en otra pestaña.
  return h('a', { class: clase, href, target: href.startsWith('https:') ? '_blank' : null, rel: 'noopener' }, texto);
}

/** Ventana emergente con título y botón de cerrar. Devuelve { cuerpo, cerrar }. */
function ventana(titulo, alCerrar) {
  const cuerpo = h('div', { class: 'cuerpo-ventana' });
  const caja = h('div', { class: 'ventana', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
    h('div', { class: 'fila entre' }, h('h2', { class: 'tarea' }, titulo), h('button', { class: 'chico', type: 'button', onclick: () => cerrar() }, 'Cerrar')),
    cuerpo);
  const fondo = h('div', { class: 'fondo', onclick: (e) => { if (e.target === fondo) cerrar(); } }, caja);
  function cerrar() {
    fondo.remove();
    if (alCerrar) alCerrar();
  }
  document.body.append(fondo);
  return { cuerpo, cerrar };
}

// ---------- lista ----------
function chipEstado(t) {
  const [texto, clase] = ESTADOS[t.estado];
  return h('span', { class: 'chip ' + clase }, texto);
}

async function vistaLista() {
  await cargarTareas();
  const abiertas = tareas.filter((t) => !terminada(t));
  const mias = tareas.filter(meToca);
  if (!filtro) filtro = mias.length ? 'mias' : 'abiertas';
  const opciones = [
    ['mias', 'Me toca', mias],
    ['abiertas', 'Abiertas', abiertas],
    ['terminadas', 'Terminadas', tareas.filter(terminada)],
    ['todas', 'Todas', tareas],
  ];
  const ver = opciones.find((o) => o[0] === filtro)[2];

  const lugares = [...new Set(tareas.map((t) => t.lugar).filter(Boolean))];
  let alta = null;
  if (esDireccion()) {
    const encargada = selectorDeQuien('n-quien', await quienesEjecutan(), null);
    const texto = h('input', { id: 'n-texto', type: 'text', maxlength: 400, required: true, placeholder: 'Qué falta hacer' });
    const lugar = h('input', { id: 'n-lugar', type: 'text', maxlength: 60, list: 'lugares', placeholder: 'Cocina, pileta, frente…' });
    const prioridad = h('select', { id: 'n-prioridad' },
      h('option', { value: 'media' }, 'Normal'), h('option', { value: 'alta' }, 'Alta'), h('option', { value: 'baja' }, 'Baja'));
    alta = h('details', { class: 'caja' },
      h('summary', { class: 'titulo' }, 'Nueva tarea'),
      h('form', {
        class: 'rejilla',
        onsubmit: async (e) => {
          e.preventDefault();
          const ok = await hacer(e.submitter, () => api('POST', '/tareas', { texto: texto.value, lugar: lugar.value, prioridad: prioridad.value, asignada_a: encargada.value || null }), 'Tarea cargada.');
          if (ok) { filtro = 'abiertas'; vistaLista(); }
        },
      },
        h('label', { class: 'ancho', for: 'n-texto' }, 'Tarea', texto),
        h('label', { for: 'n-lugar' }, 'Lugar de la casa', lugar),
        h('label', { for: 'n-prioridad' }, 'Prioridad', prioridad),
        h('label', { class: 'ancho', for: 'n-quien' }, 'Encargada a', encargada),
        h('datalist', { id: 'lugares' }, lugares.map((l) => h('option', { value: l }))),
        h('button', { class: 'principal ancho', type: 'submit' }, 'Agregar tarea'),
      ),
    );
  }

  const filtros = h('div', { class: 'filtros', role: 'group', 'aria-label': 'Qué tareas mostrar' },
    opciones.map(([clave, nombre, lista]) =>
      h('button', { type: 'button', 'aria-pressed': String(filtro === clave), onclick: () => { filtro = clave; vistaLista(); } }, `${nombre} ${lista.length}`)),
  );

  const porLugar = new Map();
  for (const t of ver) {
    const k = t.lugar || 'Sin lugar';
    if (!porLugar.has(k)) porLugar.set(k, []);
    porLugar.get(k).push(t);
  }
  const cuerpo = [];
  if (!ver.length) {
    const vacios = {
      mias: 'No hay nada esperando tu respuesta.',
      abiertas: tareas.length ? 'No queda ninguna tarea abierta.' : 'Todavía no hay tareas cargadas.',
      terminadas: 'Todavía no hay tareas terminadas.',
      todas: 'Todavía no hay tareas cargadas.',
    };
    cuerpo.push(h('p', { class: 'vacio' }, vacios[filtro]));
  }
  for (const [lugar, lista] of porLugar) {
    cuerpo.push(h('h2', { class: 'grupo' }, lugar, h('small', null, `${lista.length} ${lista.length === 1 ? 'tarea' : 'tareas'}`)));
    cuerpo.push(h('ul', { class: 'lista' }, lista.map((t) =>
      h('li', { class: terminada(t) ? 'terminada' : null },
        h('a', { href: '#/tarea/' + t.id },
          h('span', { class: 'texto' }, t.texto),
          h('span', { class: 'datos' },
            chipEstado(t),
            t.prioridad === 'alta' && !terminada(t) ? h('span', { class: 'chip mal' }, 'Prioridad alta') : null,
            t.asignada_nombre && !yo.limitado ? h('span', { class: 'chip' }, `${t.asignada_rubro || 'Proveedor'} · ${t.asignada_nombre}`) : null,
            t.grupo_id ? h('span', { class: 'chip' }, 'Grupo: ' + (grupos.find((g) => g.id === t.grupo_id)?.nombre || '')) : null,
            t.monto != null ? h('span', null, plata(t.monto, t.moneda)) : null,
            t.plazo ? h('span', { class: vencida(t) ? 'vencida' : null }, (vencida(t) ? 'Venció el ' : 'Entrega ') + dia(t.plazo)) : null,
            t.fotos ? h('span', null, `${t.fotos} ${t.fotos === 1 ? 'foto' : 'fotos'}`) : null,
            t.archivos ? h('span', null, `${t.archivos} ${t.archivos === 1 ? 'archivo' : 'archivos'}`) : null,
            t.comentarios ? h('span', null, `${t.comentarios} ${t.comentarios === 1 ? 'comentario' : 'comentarios'}`) : null,
          ),
        ),
      ))));
  }
  marco('tareas', alta, filtros, ...cuerpo);
}

// ---------- detalle ----------
async function vistaTarea(id) {
  const { tarea: t, grupo, eventos, fotos, archivos } = await api('GET', '/tareas/' + id);
  const recargar = () => vistaTarea(id);
  const accion = (control, cuerpo, hecho) => hacer(control, () => api('POST', `/tareas/${id}/accion`, cuerpo), hecho).then((ok) => ok && recargar());

  /** Botón que primero pide un motivo y después manda la acción. */
  function conMotivo(etiqueta, nombreAccion, hecho) {
    const idCampo = 'motivo-' + nombreAccion;
    const campo = h('textarea', { id: idCampo, maxlength: 500, required: true });
    const form = h('form', {
      class: 'caja', hidden: true,
      onsubmit: (e) => { e.preventDefault(); accion(e.submitter, { accion: nombreAccion, motivo: campo.value }, hecho); },
    },
      h('label', { for: idCampo }, 'Motivo', campo),
      h('div', { class: 'fila' },
        h('button', { class: 'peligro', type: 'submit' }, etiqueta),
        h('button', { type: 'button', onclick: () => { form.hidden = true; boton.hidden = false; } }, 'Cancelar')),
    );
    const boton = h('button', { class: 'peligro', type: 'button', onclick: () => { form.hidden = false; boton.hidden = true; campo.focus(); } }, etiqueta);
    return [boton, form];
  }

  // Presupuesto y entrega: acá va el resumen; lo cargado se ve en la ventana de presupuesto.
  const presupuesto = h('section', { class: 'caja' }, h('h2', null, 'Presupuesto y entrega'));
  const origen = grupo || (t.monto != null ? t : null);
  if (origen) {
    anexar(presupuesto, 
      grupo ? h('p', { class: 'sub' }, `Presupuestada junto con otras tareas, en el grupo «${grupo.nombre}»`) : null,
      h('div', { class: 'fila' }, h('span', { class: 'grande' }, plata(origen.monto, origen.moneda)), chipPresupuesto(grupo ? grupo.estado : estadoPresupuesto(t))),
      h('p', { class: 'sub' }, h('span', { class: vencida(t) ? 'vencida' : null }, 'Fecha de entrega: ' + dia(origen.plazo))),
      h('div', { class: 'fila' },
        h('button', { type: 'button', onclick: () => abrirPresupuesto(grupo ? { grupo: grupo.id } : { tarea: t.id }, recargar) }, 'Ver presupuesto')),
    );
  } else {
    anexar(presupuesto, 
      h('p', { class: 'sub' }, esConstructor() ? 'Todavía no cargaste el presupuesto.' : 'El constructor todavía no cargó el presupuesto.'),
      esConstructor() && t.estado === 'pendiente' ? h('div', { class: 'fila' }, h('a', { class: 'boton', href: '#/presupuestos' }, 'Ir a la hoja de presupuestos')) : null,
    );
  }

  // Avance
  const avance = h('section', { class: 'caja' }, h('h2', null, 'Avance'));
  const lineas = [];
  if (t.realizada_en) lineas.push(`Realizada el ${dia(t.realizada_en)}`);
  if (t.verificada_en) lineas.push(`Verificada el ${dia(t.verificada_en)}`);
  anexar(avance, h('p', { class: 'sub' }, lineas.length ? lineas.join(' · ') : 'Todavía no se hizo.'));
  if (t.estado === 'devuelta' && t.motivo) anexar(avance, h('p', { class: 'nota' }, 'Devuelta: ' + t.motivo));
  if (esConstructor() && ['pendiente', 'aprobada', 'devuelta'].includes(t.estado)) {
    anexar(avance, h('div', { class: 'fila' },
      h('button', { class: 'bien', type: 'button', onclick: (e) => accion(e.currentTarget, { accion: 'realizada' }, 'Marcada como realizada.') }, 'Marcar como realizada')));
  }
  if (esConstructor() && t.estado === 'presupuestada') anexar(avance, h('p', { class: 'sub' }, 'Vas a poder marcarla como realizada cuando aprueben el presupuesto.'));
  if (esDireccion()) {
    const botones = [];
    if (t.estado !== 'verificada') {
      botones.push(h('button', { class: t.estado === 'realizada' ? 'bien' : null, type: 'button', onclick: (e) => accion(e.currentTarget, { accion: 'verificar' }, 'Tarea terminada.') },
        t.estado === 'realizada' ? 'Verificar y dar por terminada' : 'Dar por terminada'));
    }
    let formDevolver = null;
    if (['realizada', 'verificada'].includes(t.estado)) {
      const [b, f] = conMotivo('Devolver', 'devolver', 'Tarea devuelta.');
      botones.push(b);
      formDevolver = f;
    }
    anexar(avance, h('div', { class: 'fila' }, botones), formDevolver);
  }

  // Fotos
  const ETIQUETA = { antes: 'Antes', despues: 'Después', otro: '' };
  const rejilla = h('div', { class: 'fotos' });
  for (const f of fotos) {
    const img = h('img', { alt: `Foto ${ETIQUETA[f.momento] || ''} subida por ${f.persona || 'alguien'}`.replace('  ', ' ') });
    const boton = h('button', { class: 'foto', type: 'button', onclick: () => abrirFoto(f, img.src, recargar) }, img, ETIQUETA[f.momento] ? h('span', null, ETIQUETA[f.momento]) : null);
    rejilla.append(boton);
    fetch('/api/fotos/' + f.id, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { const u = URL.createObjectURL(b); urlsDeFotos.push(u); img.src = u; })
      .catch(() => { img.alt = 'No se pudo cargar la foto'; });
  }
  const cuando = h('select', { id: 'f-momento' }, h('option', { value: 'antes' }, 'Antes'), h('option', { value: 'despues' }, 'Después'), h('option', { value: 'otro' }, 'Otra'));
  cuando.value = ['realizada', 'verificada'].includes(t.estado) || esConstructor() ? 'despues' : 'antes';
  const archivo = h('input', {
    id: 'f-archivo', type: 'file', accept: 'image/*', multiple: true,
    onchange: async () => {
      const elegidos = [...archivo.files];
      if (!elegidos.length) return;
      const ok = await hacer(archivo, async () => {
        for (const a of elegidos) await api('POST', `/tareas/${id}/fotos?momento=${cuando.value}`, await achicar(a));
      }, elegidos.length === 1 ? 'Foto subida.' : `${elegidos.length} fotos subidas.`);
      if (ok) recargar(); else archivo.value = '';
    },
  });
  const cajaFotos = h('section', { class: 'caja' },
    h('h2', null, 'Fotos'),
    fotos.length ? rejilla : h('p', { class: 'sub' }, 'Todavía no hay fotos.'),
    h('div', { class: 'rejilla' },
      h('label', { for: 'f-momento' }, 'La foto es de', cuando),
      h('label', { for: 'f-archivo' }, 'Agregar fotos', archivo)),
  );

  // Archivos (planos, presupuestos en PDF, planillas…)
  const subirArchivo = h('input', {
    id: 'a-archivo', type: 'file', multiple: true,
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.dwg,.dxf,.zip,image/*',
    onchange: async () => {
      const elegidos = [...subirArchivo.files];
      if (!elegidos.length) return;
      const ok = await hacer(subirArchivo, () => subirAdjuntos(token, id, elegidos, cuando.value), elegidos.length === 1 ? 'Archivo subido.' : `${elegidos.length} archivos subidos.`);
      if (ok) recargar(); else subirArchivo.value = '';
    },
  });
  const cajaArchivos = h('section', { class: 'caja' },
    h('h2', null, 'Archivos'),
    archivos.length ? h('ul', { class: 'historial' }, archivos.map((a) =>
      h('li', null,
        h('span', { class: 'fila entre' },
          h('strong', { class: 'texto' }, a.nombre),
          h('span', { class: 'fila' },
            h('button', { class: 'chico', type: 'button', onclick: (e) => hacer(e.currentTarget, () => bajarArchivo(a)) }, 'Descargar'),
            esDireccion() || a.persona_id === yo.id ? h('button', { class: 'chico peligro', type: 'button', onclick: (e) => hacer(e.currentTarget, () => api('DELETE', '/archivos/' + a.id), 'Archivo borrado.').then((ok) => ok && recargar()) }, 'Borrar') : null)),
        h('span', { class: 'cuando' }, `${tamano(a.tamano)} · ${a.persona || 'Alguien'} · ${momento(a.fecha)}`))))
      : h('p', { class: 'sub' }, 'Todavía no hay archivos.'),
    h('label', { for: 'a-archivo' }, 'Agregar archivos (PDF, planos, planillas… hasta 20 MB)', subirArchivo));

  // Comentarios e historial
  const comentario = h('textarea', { id: 'c-texto', maxlength: 1000, required: true, placeholder: 'Escribí una pregunta o aclaración' });
  const cajaHistorial = h('section', { class: 'caja' },
    h('h2', null, 'Comentarios e historial'),
    h('ul', { class: 'historial' }, eventos.map((e) =>
      h('li', { class: e.tipo === 'comentario' ? 'comentario' : null },
        h('span', null, h('strong', null, e.persona || 'Alguien'), ' ', EVENTOS[e.tipo] || e.tipo),
        e.detalle ? h('span', { class: 'dicho' }, detalleLegible(e)) : null,
        h('span', { class: 'cuando' }, momento(e.fecha))))),
    h('form', {
      class: 'caja',
      onsubmit: async (e) => {
        e.preventDefault();
        const ok = await hacer(e.submitter, () => api('POST', `/tareas/${id}/comentarios`, { texto: comentario.value }));
        if (ok) recargar();
      },
    },
      h('label', { for: 'c-texto' }, 'Nuevo comentario', comentario),
      h('button', { class: 'principal', type: 'submit' }, 'Comentar')),
  );

  // Edición
  let edicion = null;
  if (esDireccion()) {
    const texto = h('input', { id: 'e-texto', type: 'text', maxlength: 400, required: true, value: t.texto });
    const lugar = h('input', { id: 'e-lugar', type: 'text', maxlength: 60, value: t.lugar });
    const prioridad = h('select', { id: 'e-prioridad' }, h('option', { value: 'media' }, 'Normal'), h('option', { value: 'alta' }, 'Alta'), h('option', { value: 'baja' }, 'Baja'));
    prioridad.value = t.prioridad;
    const encargada = selectorDeQuien('e-quien', await quienesEjecutan(), t.asignada_a);
    const confirmar = h('div', { class: 'fila', hidden: true },
      h('span', { class: 'sub' }, 'Se borra la tarea con sus fotos, pagos e historial.'),
      h('button', { class: 'peligro', type: 'button', onclick: async (e) => { if (await hacer(e.currentTarget, () => api('DELETE', '/tareas/' + id), 'Tarea borrada.')) location.hash = '#/tareas'; } }, 'Sí, borrar'),
      h('button', { type: 'button', onclick: () => { confirmar.hidden = true; } }, 'No'));
    edicion = h('details', { class: 'caja' },
      h('summary', { class: 'titulo' }, 'Editar o borrar la tarea'),
      h('form', {
        class: 'rejilla',
        onsubmit: async (e) => {
          e.preventDefault();
          const ok = await hacer(e.submitter, () => api('PATCH', '/tareas/' + id, { texto: texto.value, lugar: lugar.value, prioridad: prioridad.value, asignada_a: encargada.value || null }), 'Cambios guardados.');
          if (ok) recargar();
        },
      },
        h('label', { class: 'ancho', for: 'e-texto' }, 'Tarea', texto),
        h('label', { for: 'e-lugar' }, 'Lugar de la casa', lugar),
        h('label', { for: 'e-prioridad' }, 'Prioridad', prioridad),
        h('label', { class: 'ancho', for: 'e-quien' }, 'Encargada a', encargada),
        h('button', { class: 'principal', type: 'submit' }, 'Guardar cambios'),
        h('button', { class: 'peligro', type: 'button', onclick: () => { confirmar.hidden = false; } }, 'Borrar tarea')),
      confirmar);
  }

  marco('tareas',
    h('a', { class: 'volver', href: '#/tareas' }, ico('atras'), 'Tareas'),
    h('section', { class: 'detalle caja' },
      h('p', { class: 'sub' }, t.lugar || 'Sin lugar'),
      h('h2', { class: 'tarea' }, t.texto),
      h('div', { class: 'datos' },
        chipEstado(t),
        t.prioridad !== 'media' ? h('span', { class: 'chip' + (t.prioridad === 'alta' ? ' mal' : '') }, 'Prioridad ' + t.prioridad) : null,
        h('span', null, 'Cargada el ' + dia(t.creada)))),
    CON_PRESUPUESTOS ? presupuesto : null, avance, cajaFotos, cajaArchivos, cajaHistorial, edicion,
  );
}

function detalleLegible(e) {
  // Los montos se guardan como "ARS 120000": se muestran con formato y la fecha en día/mes/año.
  return e.detalle
    .replace(/\b(ARS|USD) (\d+)\b/g, (_, moneda, n) => plata(Number(n), moneda))
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

function abrirFoto(f, src, recargar) {
  if (!src) return;
  const puedeBorrar = esDireccion() || f.persona_id === yo.id;
  const cerrar = () => visor.remove();
  const visor = h('div', { class: 'visor', role: 'dialog', 'aria-label': 'Foto ampliada' },
    h('img', { src, alt: 'Foto ampliada' }),
    h('div', { class: 'fila' },
      h('span', null, `${f.persona || 'Alguien'} · ${momento(f.fecha)}`),
      puedeBorrar ? h('button', { class: 'chico peligro', type: 'button', onclick: async (e) => { if (await hacer(e.currentTarget, () => api('DELETE', '/fotos/' + f.id), 'Foto borrada.')) { cerrar(); recargar(); } } }, 'Borrar foto') : null,
      h('button', { class: 'chico', type: 'button', onclick: cerrar }, 'Cerrar')));
  document.body.append(visor);
}

// ---------- resumen ----------
async function vistaResumen() {
  await cargarTareas();
  const cuenta = (f) => tareas.filter(f).length;
  const hechas = cuenta(terminada);
  const avance = tareas.length ? Math.round((hechas / tareas.length) * 100) : 0;

  const cajas = [
    h('section', { class: 'caja' },
      h('h2', null, 'Avance de la obra'),
      h('p', { class: 'grande' }, `${avance}%`),
      h('p', { class: 'sub' }, `${hechas} de ${tareas.length} tareas terminadas`),
      h('div', { class: 'cifras' },
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'pendiente')), h('span', { class: 'sub' }, CON_PRESUPUESTOS ? 'Sin presupuesto' : 'Pendientes')),
        CON_PRESUPUESTOS ? h('div', null, h('strong', null, cuenta((t) => t.estado === 'presupuestada')), h('span', { class: 'sub' }, 'Presupuesto a aprobar')) : null,
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'aprobada' || t.estado === 'devuelta')), h('span', { class: 'sub' }, 'Por hacer')),
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'realizada')), h('span', { class: 'sub' }, 'A verificar')),
        h('div', null, h('strong', { class: cuenta(vencida) ? 'vencida' : null }, cuenta(vencida)), h('span', { class: 'sub' }, 'Con plazo vencido')))),
  ];

  const yaAprobada = (t) => ['aprobada', 'realizada', 'verificada', 'devuelta'].includes(t.estado);
  const renglones = [
    ...tareas.filter((t) => !t.grupo_id && (t.monto != null || t.pagado > 0)).map((t) => ({
      donde: t.lugar || 'Sin lugar', moneda: t.moneda, pagado: t.pagado,
      monto: estadoPresupuesto(t) === 'rechazado' ? 0 : t.monto || 0, aprobado: yaAprobada(t) ? t.monto || 0 : 0,
    })),
    ...grupos.map((g) => ({
      donde: 'Grupo: ' + g.nombre, moneda: g.moneda, pagado: g.pagado,
      monto: g.estado === 'rechazado' ? 0 : g.monto, aprobado: g.estado === 'aprobado' ? g.monto : 0,
    })),
  ];
  for (const moneda of CON_PRESUPUESTOS ? ['ARS', 'USD'] : []) {
    const con = renglones.filter((r) => r.moneda === moneda);
    if (!con.length) continue;
    const suma = (lista, campo) => lista.reduce((n, r) => n + r[campo], 0);
    const filas = new Map();
    for (const r of con) {
      if (!filas.has(r.donde)) filas.set(r.donde, []);
      filas.get(r.donde).push(r);
    }
    // «data-et» es el rótulo de cada número cuando la tabla se apila en pantallas muy angostas.
    const fila = (nombre, lista, etiqueta = 'td') =>
      h('tr', null,
        h(etiqueta === 'th' ? 'th' : 'td', null, nombre),
        h(etiqueta, { 'data-et': 'Presup.' }, numero.format(suma(lista, 'monto'))),
        h(etiqueta, { 'data-et': 'Aprob.' }, numero.format(suma(lista, 'aprobado'))),
        h(etiqueta, { 'data-et': 'Pagado' }, numero.format(suma(lista, 'pagado'))),
        h(etiqueta, { 'data-et': 'Saldo' }, numero.format(suma(lista, 'aprobado') - suma(lista, 'pagado'))));
    cajas.push(h('section', { class: 'caja' },
      h('h2', null, moneda === 'USD' ? 'Plata en dólares' : 'Plata en pesos'),
      h('div', { class: 'tabla' },
        h('table', null,
          h('thead', null, h('tr', null, [['Lugar o grupo', 'Lugar'], ['Presupuestado', 'Presup.'], ['Aprobado', 'Aprob.'], ['Pagado', 'Pagado'], ['Saldo', 'Saldo']].map(([largo, corto]) => h('th', null, h('span', { class: 'largo' }, largo), h('span', { class: 'corto' }, corto))))),
          h('tbody', null, [...filas].map(([k, lista]) => fila(k, lista))),
          h('tfoot', null, fila('Total', con, 'th')))),
      h('p', { class: 'sub' }, 'Saldo = aprobado menos pagado.')));
  }
  if (cajas.length === 1 && CON_PRESUPUESTOS) cajas.push(h('p', { class: 'vacio' }, 'Todavía no hay presupuestos ni pagos cargados.'));
  marco('resumen', ...cajas);
}

// ---------- personas ----------
async function vistaPersonas() {
  if (!esDireccion()) { location.hash = '#/'; return; }
  const { personas } = await api('GET', '/personas');
  const link = (p) => `${location.origin}/#k=${p.token}`;
  async function copiar(p) {
    const texto = link(p);
    try {
      await navigator.clipboard.writeText(texto);
      avisar(`Link de ${p.nombre} copiado. Mandáselo por WhatsApp.`);
    } catch {
      const campo = document.getElementById('link-' + p.id);
      campo.hidden = false;
      campo.select();
      avisar('Mantené apretado el link para copiarlo.');
    }
  }
  const nombre = h('input', { id: 'pe-nombre', type: 'text', maxlength: 60, required: true, placeholder: 'Nombre' });
  const rol = h('select', { id: 'pe-rol' }, Object.entries(ROLES).reverse().map(([k, v]) => h('option', { value: k }, v)));
  marco('personas',
    h('section', { class: 'caja' },
      h('h2', null, 'Quién entra a esta obra'),
      h('p', { class: 'sub' }, 'Cada persona entra con su link personal. Quien tenga el link entra como esa persona: mandalo solo a ella.'),
      h('ul', { class: 'historial' }, personas.map((p) =>
        h('li', null,
          h('span', { class: 'fila entre' },
            h('span', null, h('strong', null, p.nombre), ` · ${rotulo(p)}`, p.id === yo.id ? ' (vos)' : '', p.activa ? '' : ' · dada de baja'),
            h('span', { class: 'fila' },
              p.activa && p.id !== yo.id ? botonWhatsApp(`Hola ${p.nombre}, te paso tu link para entrar a ${obra.nombre} en Construir: ${link(p)}`, 'boton chico', 'WhatsApp') : null,
              p.activa ? h('button', { class: 'chico', type: 'button', onclick: () => copiar(p) }, 'Copiar link') : null,
              p.id !== yo.id ? h('button', {
                class: 'chico' + (p.activa ? ' peligro' : ''), type: 'button',
                onclick: (e) => hacer(e.currentTarget, () => api('PATCH', '/personas/' + p.id, { activa: !p.activa }), p.activa ? 'Acceso dado de baja.' : 'Acceso reactivado.').then((ok) => ok && vistaPersonas()),
              }, p.activa ? 'Dar de baja' : 'Reactivar') : null)),
          h('input', { id: 'link-' + p.id, type: 'text', readonly: true, hidden: true, value: link(p), 'aria-label': 'Link de ' + p.nombre }))))),
    h('form', {
      class: 'caja',
      onsubmit: async (e) => {
        e.preventDefault();
        const ok = await hacer(e.submitter, () => api('POST', '/personas', { nombre: nombre.value, rol: rol.value }), 'Persona agregada. Copiá su link y mandáselo.');
        if (ok) vistaPersonas();
      },
    },
      h('h2', null, 'Agregar una persona'),
      h('div', { class: 'rejilla' },
        h('label', { for: 'pe-nombre' }, 'Nombre', nombre),
        h('label', { for: 'pe-rol' }, 'Rol', rol)),
      h('button', { class: 'principal', type: 'submit' }, 'Agregar')),
  );
}

// ---------- hoja de presupuestos ----------
async function vistaPresupuestos() {
  await cargarTareas();
  const recargar = () => vistaPresupuestos();
  const cajas = [];

  if (esConstructor()) {
    const sinPrecio = tareas.filter((t) => !t.grupo_id && t.estado === 'pendiente');
    const elegidas = new Set();
    const monto = h('input', { id: 'h-monto', type: 'number', inputmode: 'numeric', min: 0, step: 1, required: true });
    const moneda = h('select', { id: 'h-moneda' }, h('option', { value: 'ARS' }, 'Pesos'), h('option', { value: 'USD' }, 'Dólares'));
    const plazo = h('input', { id: 'h-plazo', type: 'date', required: true });
    const nota = h('input', { id: 'h-nota', type: 'text', maxlength: 500, placeholder: 'Qué incluye: materiales, mano de obra…' });
    const nombre = h('input', { id: 'h-nombre', type: 'text', maxlength: 80, placeholder: 'Baños, electricidad de galería…' });
    const campoNombre = h('label', { class: 'ancho', for: 'h-nombre', hidden: true }, 'Nombre del grupo', nombre);
    const enviar = h('button', { class: 'principal ancho', type: 'submit', disabled: true }, 'Elegí una o más tareas');
    const actualizar = () => {
      const n = elegidas.size;
      campoNombre.hidden = n < 2;
      enviar.disabled = n === 0;
      enviar.textContent = n === 0 ? 'Elegí una o más tareas' : n === 1 ? 'Presupuestar esta tarea' : `Presupuestar las ${n} tareas juntas`;
    };
    cajas.push(h('form', {
      class: 'caja',
      onsubmit: async (e) => {
        e.preventDefault();
        const datos = { monto: Number(monto.value), moneda: moneda.value, plazo: plazo.value, nota: nota.value };
        const ids = [...elegidas];
        const ok = await hacer(enviar, () => (ids.length === 1
          ? api('POST', `/tareas/${ids[0]}/accion`, { accion: 'presupuestar', ...datos })
          : api('POST', '/grupos', { ...datos, nombre: nombre.value, tareas: ids })), 'Presupuesto enviado.');
        if (ok) recargar();
      },
    },
      h('h2', null, 'Cargar un presupuesto'),
      sinPrecio.length
        ? h('p', { class: 'sub' }, 'Marcá una tarea para presupuestarla sola, o varias para ponerles un solo precio y una sola fecha de entrega.')
        : h('p', { class: 'sub' }, 'No hay tareas esperando presupuesto.'),
      sinPrecio.length ? h('ul', { class: 'lista' }, sinPrecio.map((t) =>
        h('li', null, h('label', { class: 'elegir', for: 'h-t' + t.id },
          h('input', {
            id: 'h-t' + t.id, type: 'checkbox',
            onchange: (e) => { if (e.target.checked) elegidas.add(t.id); else elegidas.delete(t.id); actualizar(); },
          }),
          h('span', { class: 'cuerpo' },
            h('span', { class: 'texto' }, t.texto),
            h('span', { class: 'datos' }, h('span', null, t.lugar || 'Sin lugar'), t.motivo ? h('span', { class: 'chip mal' }, 'Presupuesto rechazado') : null)))))) : null,
      sinPrecio.length ? h('div', { class: 'rejilla' },
        campoNombre,
        h('label', { for: 'h-monto' }, 'Monto total, sin centavos', monto),
        h('label', { for: 'h-moneda' }, 'Moneda', moneda),
        h('label', { for: 'h-plazo' }, 'Fecha de entrega', plazo),
        h('label', { for: 'h-nota' }, 'Nota', nota),
        enviar) : null,
    ));
  }

  // Presupuestos cargados: primero los que esperan respuesta.
  const cargados = [
    ...grupos.map((g) => ({ ref: { grupo: g.id }, titulo: g.nombre, sub: `Grupo de ${g.cantidad} ${g.cantidad === 1 ? 'tarea' : 'tareas'}`, estado: g.estado, monto: g.monto, moneda: g.moneda, plazo: g.plazo, pagado: g.pagado })),
    ...tareas.filter((t) => !t.grupo_id && t.monto != null).map((t) => ({ ref: { tarea: t.id }, titulo: t.texto, sub: t.lugar || 'Sin lugar', estado: estadoPresupuesto(t), monto: t.monto, moneda: t.moneda, plazo: t.plazo, pagado: t.pagado })),
  ];
  const orden = { presupuestado: 0, rechazado: 1, aprobado: 2 };
  cargados.sort((a, b) => orden[a.estado] - orden[b.estado]);
  cajas.push(h('h2', { class: 'grupo' }, 'Presupuestos cargados', h('small', null, String(cargados.length))));
  cajas.push(cargados.length
    ? h('ul', { class: 'lista' }, cargados.map((c) =>
      h('li', null, h('button', { class: 'renglon', type: 'button', onclick: () => abrirPresupuesto(c.ref, recargar) },
        h('span', { class: 'texto' }, c.titulo),
        h('span', { class: 'datos' },
          chipPresupuesto(c.estado),
          h('strong', null, plata(c.monto, c.moneda)),
          h('span', null, 'Entrega ' + dia(c.plazo)),
          h('span', null, c.sub),
          c.pagado ? h('span', null, 'Pagado ' + plata(c.pagado, c.moneda)) : null)))))
    : h('p', { class: 'vacio' }, 'Todavía no hay presupuestos cargados.'));
  marco('presupuestos', ...cajas);
}

/** Botón que primero pide un motivo y después llama a enviar(motivo, boton). */
function pedirMotivo(etiqueta, idCampo, enviar) {
  const campo = h('textarea', { id: idCampo, maxlength: 500, required: true });
  const form = h('form', { class: 'caja', hidden: true, onsubmit: (e) => { e.preventDefault(); enviar(campo.value, e.submitter); } },
    h('label', { for: idCampo }, 'Motivo', campo),
    h('div', { class: 'fila' },
      h('button', { class: 'peligro', type: 'submit' }, etiqueta),
      h('button', { type: 'button', onclick: () => { form.hidden = true; boton.hidden = false; } }, 'Cancelar')));
  const boton = h('button', { class: 'peligro', type: 'button', onclick: () => { form.hidden = false; boton.hidden = true; campo.focus(); } }, etiqueta);
  return [boton, form];
}

/** Ventana con lo cargado de un presupuesto (de una tarea o de un grupo): monto, fecha de entrega, estado y pagos. */
async function abrirPresupuesto(ref, alCambiar) {
  let cambio = false;
  const ventana = h('div', { class: 'ventana', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Presupuesto' });
  const fondo = h('div', { class: 'fondo', onclick: (e) => { if (e.target === fondo) cerrar(); } }, ventana);
  function cerrar() {
    fondo.remove();
    if (cambio && alCambiar) alCambiar();
  }

  async function pintar() {
    let d;
    try {
      d = ref.grupo ? await api('GET', '/grupos/' + ref.grupo) : await api('GET', '/tareas/' + ref.tarea);
      if (!ref.grupo && d.grupo) {
        ref = { grupo: d.grupo.id };
        d = await api('GET', '/grupos/' + ref.grupo);
      }
    } catch (e) {
      avisar(e.message, true);
      return false;
    }
    const esGrupo = !!ref.grupo;
    const x = esGrupo ? d.grupo : d.tarea;
    const base = esGrupo ? '/grupos/' + x.id : '/tareas/' + x.id;
    const estado = esGrupo ? x.estado : estadoPresupuesto(x);
    const nota = esGrupo ? x.nota : x.presupuesto_nota;
    const pagado = d.pagos.reduce((n, g) => n + g.monto, 0);
    const tras = (ok) => { if (ok) { cambio = true; pintar(); } };
    const mandar = (control, metodo, ruta, cuerpo, hecho) => hacer(control, () => api(metodo, ruta, cuerpo), hecho).then(tras);

    const partes = [
      h('div', { class: 'fila entre' },
        h('p', { class: 'sub' }, esGrupo ? `Presupuesto en grupo · ${d.tareas.length} ${d.tareas.length === 1 ? 'tarea' : 'tareas'}` : x.lugar || 'Sin lugar'),
        h('button', { class: 'chico', type: 'button', onclick: cerrar }, 'Cerrar')),
      h('h2', { class: 'tarea' }, esGrupo ? x.nombre : x.texto),
    ];
    if (esGrupo) {
      partes.push(h('ul', { class: 'lista' }, d.tareas.map((t) =>
        h('li', null, h('a', { href: '#/tarea/' + t.id, onclick: () => fondo.remove() },
          h('span', { class: 'texto' }, t.texto),
          h('span', { class: 'datos' }, chipEstado(t), h('span', null, t.lugar || 'Sin lugar')))))));
    }
    partes.push(h('section', { class: 'caja' },
      h('div', { class: 'fila' }, h('span', { class: 'grande' }, x.monto != null ? plata(x.monto, x.moneda) : 'Sin presupuesto'), chipPresupuesto(estado)),
      x.plazo ? h('p', null, 'Fecha de entrega: ', h('strong', { class: x.plazo < hoy() && estado !== 'aprobado' ? 'vencida' : null }, dia(x.plazo))) : null,
      nota ? h('p', { class: 'texto' }, nota) : null,
      estado === 'rechazado' && x.motivo ? h('p', { class: 'nota' }, 'Rechazado: ' + x.motivo) : null,
      estado === 'aprobado' ? h('p', { class: 'sub' }, `Aprobado el ${dia(esGrupo ? x.aprobado_en : x.aprobada_en)}`) : null,
    ));

    if (esDireccion() && estado === 'presupuestado') {
      const [rechazar, formRechazo] = pedirMotivo('Rechazar', 'v-motivo', (motivo, control) => mandar(control, 'POST', base + '/accion', { accion: 'rechazar', motivo }, 'Presupuesto rechazado.'));
      partes.push(
        h('div', { class: 'fila' },
          h('button', { class: 'bien', type: 'button', onclick: (e) => mandar(e.currentTarget, 'POST', base + '/accion', { accion: 'aprobar' }, 'Presupuesto aprobado.') }, 'Aprobar presupuesto'),
          rechazar),
        formRechazo);
    }

    if (esConstructor() && estado !== 'aprobado') {
      const monto = h('input', { id: 'v-monto', type: 'number', inputmode: 'numeric', min: 0, step: 1, required: true, value: x.monto ?? '' });
      const moneda = h('select', { id: 'v-moneda' }, h('option', { value: 'ARS' }, 'Pesos'), h('option', { value: 'USD' }, 'Dólares'));
      moneda.value = x.moneda;
      const plazo = h('input', { id: 'v-plazo', type: 'date', required: true, value: x.plazo ?? '' });
      const campoNota = h('input', { id: 'v-nota', type: 'text', maxlength: 500, value: nota });
      const nombre = esGrupo ? h('input', { id: 'v-nombre', type: 'text', maxlength: 80, required: true, value: x.nombre }) : null;
      partes.push(h('details', { class: 'caja' },
        h('summary', { class: 'titulo' }, 'Cambiar el presupuesto'),
        h('form', {
          class: 'rejilla',
          onsubmit: (e) => {
            e.preventDefault();
            const datos = { monto: Number(monto.value), moneda: moneda.value, plazo: plazo.value, nota: campoNota.value };
            if (esGrupo) mandar(e.submitter, 'PATCH', base, { ...datos, nombre: nombre.value }, 'Presupuesto cambiado.');
            else mandar(e.submitter, 'POST', base + '/accion', { accion: 'presupuestar', ...datos }, 'Presupuesto cambiado.');
          },
        },
          esGrupo ? h('label', { class: 'ancho', for: 'v-nombre' }, 'Nombre del grupo', nombre) : null,
          h('label', { for: 'v-monto' }, 'Monto total, sin centavos', monto),
          h('label', { for: 'v-moneda' }, 'Moneda', moneda),
          h('label', { for: 'v-plazo' }, 'Fecha de entrega', plazo),
          h('label', { for: 'v-nota' }, 'Nota', campoNota),
          h('button', { class: 'principal ancho', type: 'submit' }, 'Guardar y volver a enviar')),
        esGrupo ? h('div', { class: 'fila' },
          h('button', {
            class: 'peligro', type: 'button',
            onclick: async (e) => { if (await hacer(e.currentTarget, () => api('DELETE', base), 'Grupo desarmado: las tareas quedaron sin presupuesto.')) { cambio = true; cerrar(); } },
          }, 'Desarmar el grupo')) : null));
    }

    if (estado === 'aprobado' || d.pagos.length) {
      const caja = h('section', { class: 'caja' },
        h('h2', null, 'Pagos'),
        h('p', { class: 'sub' }, d.pagos.length ? `Pagado: ${plata(pagado, x.moneda)} · Saldo: ${plata(x.monto - pagado, x.moneda)}` : 'Sin pagos registrados.'),
        d.pagos.length ? h('ul', { class: 'historial' }, d.pagos.map((g) =>
          h('li', null,
            h('span', { class: 'fila entre' },
              h('strong', null, plata(g.monto, x.moneda)),
              esDireccion() ? h('button', { class: 'chico peligro', type: 'button', onclick: (e) => mandar(e.currentTarget, 'DELETE', `${base}/pagos/${g.id}`, null, 'Pago borrado.') }, 'Borrar') : null),
            h('span', { class: 'cuando' }, `${dia(g.fecha)} · lo registró ${g.persona || 'alguien'}`),
            g.nota ? h('span', { class: 'dicho' }, g.nota) : null))) : null);
      if (esDireccion()) {
        const monto = h('input', { id: 'v-pago', type: 'number', inputmode: 'numeric', min: 1, step: 1, required: true });
        const fecha = h('input', { id: 'v-fecha', type: 'date', required: true, value: hoy() });
        const notaPago = h('input', { id: 'v-nota-pago', type: 'text', maxlength: 300, placeholder: 'Anticipo, transferencia, efectivo…' });
        caja.append(h('details', null,
          h('summary', null, 'Registrar un pago'),
          h('form', {
            class: 'rejilla',
            onsubmit: (e) => { e.preventDefault(); mandar(e.submitter, 'POST', base + '/pagos', { monto: Number(monto.value), fecha: fecha.value, nota: notaPago.value }, 'Pago registrado.'); },
          },
            h('label', { for: 'v-pago' }, `Monto en ${x.moneda === 'USD' ? 'dólares' : 'pesos'}`, monto),
            h('label', { for: 'v-fecha' }, 'Fecha', fecha),
            h('label', { class: 'ancho', for: 'v-nota-pago' }, 'Nota', notaPago),
            h('button', { class: 'principal ancho', type: 'submit' }, 'Guardar pago'))));
      }
      partes.push(caja);
    }
    ventana.replaceChildren(...partes);
    return true;
  }

  if (await pintar()) document.body.append(fondo);
}

// ---------- inicio: cuadros, como un escritorio ----------
/** Pide datos con el link de otra obra, sin tocar la sesión actual. */
async function pedirCon(k, metodo, ruta, cuerpo) {
  const op = { method: metodo, headers: { Authorization: 'Bearer ' + k } };
  if (cuerpo) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(cuerpo); }
  let r;
  try { r = await fetch('/api' + ruta, op); } catch { throw new Error('No hay conexión. Probá de nuevo cuando vuelva la señal.'); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'No se pudo completar.');
  return datos;
}
function selectorDeTipo(id, actual = '') {
  const sel = h('select', { id }, h('option', { value: '' }, 'Sin definir'), TIPOS_DE_OBRA.map((t) => h('option', { value: t }, t)));
  sel.value = actual;
  return sel;
}

async function vistaInicio() {
  // En un mismo celular puede haber links de distintas personas (por ejemplo, el dueño que prueba el link de un proveedor).
  // El Inicio muestra solo las obras del perfil con el que se entró: misma persona y mismo rol. Nunca se mezclan.
  const perfilDe = (x) => [x.persona, x.rol, x.limitado ? 1 : 0, x.pide ? 1 : 0].join('|');
  const miPerfil = perfilDe({ persona: yo.nombre, rol: yo.rol, limitado: yo.limitado, pide: yo.pide });
  const guardados = accesos();
  const lista = guardados.filter((x) => perfilDe(x) === miPerfil || x.token === token);
  const otrosPerfiles = new Map();
  for (const x of guardados) {
    if (lista.includes(x)) continue;
    const k = perfilDe(x);
    if (!otrosPerfiles.has(k)) otrosPerfiles.set(k, { ...x, obras: 0 });
    otrosPerfiles.get(k).obras += 1;
  }
  const enDias = (n) => { const f = new Date(); f.setDate(f.getDate() + n); return `${f.getFullYear()}-${dosDigitos(f.getMonth() + 1)}-${dosDigitos(f.getDate())}`; };
  const limite = enDias(7);
  const fichas = await Promise.all(lista.map(async (x) => {
    try {
      const [quien, datos, ultimas, hechos] = await Promise.all([pedirCon(x.token, 'GET', '/yo'), pedirCon(x.token, 'GET', '/tareas'), pedirCon(x.token, 'GET', '/fotos').catch(() => ({ fotos: [] })), pedirCon(x.token, 'GET', '/actividad').catch(() => ({ eventos: [] }))]);
      const ts = datos.tareas;
      const rol = quien.persona.rol;
      const saldos = {};
      const sumar = (moneda, aprobado, pagado) => { if (aprobado || pagado) saldos[moneda] = (saldos[moneda] || 0) + aprobado - pagado; };
      for (const t of ts) if (!t.grupo_id) sumar(t.moneda, ['aprobada', 'realizada', 'verificada', 'devuelta'].includes(t.estado) ? t.monto || 0 : 0, t.pagado);
      for (const g of datos.grupos || []) sumar(g.moneda, g.estado === 'aprobado' ? g.monto : 0, g.pagado);
      return {
        token: x.token, obra: quien.obra, persona: quien.persona, rol, total: ts.length,
        hechas: ts.filter(terminada).length,
        tocan: ts.filter((t) => leToca(t, rol)).length,
        vencidas: ts.filter(vencida).length,
        saldos,
        fotos: (ultimas.fotos || []).map((f) => ({ ...f, token: x.token, obra: quien.obra.nombre })),
        actividad: (hechos.eventos || []).map((e) => ({ ...e, token: x.token, obra: quien.obra.nombre })),
        // Presupuestos que esperan la aprobación de quien dirige la obra: grupos y tareas sueltas.
        aAprobar: rol === 'constructor' ? [] : [
          ...(datos.grupos || []).filter((g) => g.estado === 'presupuestado').map((g) => ({
            token: x.token, obra: quien.obra.nombre, ruta: '/grupos/' + g.id, titulo: g.nombre,
            detalle: `Grupo de ${g.cantidad} ${g.cantidad === 1 ? 'tarea' : 'tareas'}`, monto: g.monto, moneda: g.moneda, plazo: g.plazo,
          })),
          ...ts.filter((t) => !t.grupo_id && t.estado === 'presupuestada').map((t) => ({
            token: x.token, obra: quien.obra.nombre, ruta: '/tareas/' + t.id, titulo: t.texto,
            detalle: t.asignada_nombre ? `${t.asignada_rubro || 'Proveedor'} · ${t.asignada_nombre}` : t.lugar || '', monto: t.monto, moneda: t.moneda, plazo: t.plazo,
          })),
        ],
        // Lo que vence en los próximos 7 días o ya venció, y todavía no se hizo.
        porVencer: ts.filter((t) => t.plazo && t.plazo <= limite && !['realizada', 'verificada'].includes(t.estado))
          .map((t) => ({ token: x.token, obra: quien.obra.nombre, id: t.id, texto: t.texto, plazo: t.plazo, quien: t.asignada_nombre || '' })),
      };
    } catch {
      return { token: x.token, obra: { nombre: x.obra, tipo: x.tipo || '' }, persona: x, rol: x.rol, error: true, total: 0, hechas: 0, tocan: 0, vencidas: 0, saldos: {}, porVencer: [], aAprobar: [], fotos: [], actividad: [] };
    }
  }));
  guardarAccesos(guardados.map((x) => { const f = fichas.find((y) => y.token === x.token); return f && !f.error ? { ...x, obra: f.obra.nombre, tipo: f.obra.tipo || '', persona: f.persona.nombre, rol: f.persona.rol, rubro: f.persona.rubro || '', limitado: !!f.persona.limitado, pide: !!f.persona.pide } : x; }));
  fichas.sort((a, b) => b.tocan - a.tocan || b.vencidas - a.vencidas);
  const dirigidas = fichas.filter((f) => !f.error && !(f.persona && f.persona.pide) && (f.rol === 'propietario' || f.rol === 'arquitecto'));
  const suma = (campo) => fichas.reduce((n, f) => n + f[campo], 0);
  const refrescar = () => { if (!location.hash.replace(/^#\/?/, '')) vistaInicio(); };

  // ----- ventanas -----
  function nuevaObra() {
    const v = ventana('Nueva obra');
    const nombre = h('input', { id: 'o-nombre', type: 'text', maxlength: 80, required: true, placeholder: 'Quincho, local de Lanús, casa de fin de semana…' });
    const tipo = selectorDeTipo('o-tipo');
    v.cuerpo.append(h('form', {
      class: 'rejilla',
      onsubmit: async (e) => {
        e.preventDefault();
        let nueva;
        const ok = await hacer(e.submitter, async () => { nueva = await api('POST', '/obras', { nombre: nombre.value, tipo: tipo.value }); }, 'Obra creada.');
        if (ok) { v.cerrar(); cambiarDeObra(nueva.token, 'tareas'); }
      },
    },
      h('p', { class: 'sub ancho' }, `Arranca vacía y entrás como ${ROLES[yo.rol].toLowerCase()}. Después le cargás las tareas y sumás a las personas.`),
      h('label', { for: 'o-nombre' }, 'Nombre de la obra', nombre),
      h('label', { for: 'o-tipo' }, 'Tipo de obra', tipo),
      h('button', { class: 'principal ancho', type: 'submit' }, 'Crear obra')));
    nombre.focus();
  }

  function editarObra(f) {
    const v = ventana('Datos de la obra');
    const nombre = h('input', { id: 'eo-nombre', type: 'text', maxlength: 80, required: true, value: f.obra.nombre });
    const tipo = selectorDeTipo('eo-tipo', f.obra.tipo || '');
    v.cuerpo.append(h('form', {
      class: 'rejilla',
      onsubmit: async (e) => {
        e.preventDefault();
        const ok = await hacer(e.submitter, async () => {
          const r = await pedirCon(f.token, 'PATCH', '/obra', { nombre: nombre.value, tipo: tipo.value });
          if (f.token === token) obra = r.obra;
        }, 'Obra actualizada.');
        if (ok) { v.cerrar(); refrescar(); }
      },
    },
      h('label', { for: 'eo-nombre' }, 'Nombre de la obra', nombre),
      h('label', { for: 'eo-tipo' }, 'Tipo de obra', tipo),
      h('button', { class: 'principal ancho', type: 'submit' }, 'Guardar')));
  }

  function nuevoProveedor() {
    const v = ventana('Nuevo proveedor', refrescar);
    // La obra se elige siempre a mano: no viene ninguna marcada, salvo que haya una sola.
    const cual = h('select', { id: 'pr-obra', required: true },
      dirigidas.length > 1 ? h('option', { value: '' }, 'Elegí la obra…') : null,
      dirigidas.map((f) => h('option', { value: f.token }, f.obra.nombre + (f.obra.tipo ? ` · ${f.obra.tipo}` : ''))));
    const nombre = h('input', { id: 'pr-nombre', type: 'text', maxlength: 60, required: true, placeholder: 'Nombre del proveedor' });
    const rubro = h('input', { id: 'pr-rubro', type: 'text', maxlength: 40, required: true, list: 'rubros', placeholder: 'Plomería, electricidad…' });
    const lugar = h('input', { id: 'pr-lugar', type: 'text', maxlength: 60, placeholder: 'Baño, cocina, toda la sede…' });
    const adjuntos = h('input', { id: 'pr-adjuntos', type: 'file', multiple: true, accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.dwg,.dxf,.zip,image/*' });
    const trabajos = h('textarea', { id: 'pr-trabajos', required: true, rows: 4, placeholder: 'Un trabajo por renglón.\nCambiar flexibles del baño\nDestapar rejilla del patio' });
    v.cuerpo.append(h('form', {
      class: 'rejilla',
      onsubmit: async (e) => {
        e.preventDefault();
        const destino = dirigidas.find((f) => f.token === cual.value);
        if (!destino) { avisar('Elegí a qué obra se asigna el proveedor.', true); cual.focus(); return; }
        let alta;
        const ok = await hacer(e.submitter, async () => {
          alta = await pedirCon(destino.token, 'POST', '/proveedores', {
            nombre: nombre.value, rubro: rubro.value, lugar: lugar.value,
            tareas: trabajos.value.split('\n').map((x) => x.trim()).filter(Boolean),
          });
        });
        if (!ok) return;
        const elegidos = [...adjuntos.files];
        let subidos = true;
        if (elegidos.length) subidos = await hacer(e.submitter, () => subirAdjuntos(destino.token, alta.ids[0], elegidos, 'antes'));
        const link = `${location.origin}/#k=${alta.token}`;
        const mensaje = `Hola ${nombre.value.trim()}, te paso el link para ver el trabajo de ${rubro.value.trim()} en ${destino.obra.nombre}: ${link}`;
        const campo = h('input', { id: 'pr-link', type: 'text', readonly: true, value: link, 'aria-label': 'Link del proveedor' });
        reemplazar(v.cuerpo, 
          h('p', null, h('strong', null, nombre.value.trim()), ` quedó como proveedor de ${rubro.value.trim()} en `, h('strong', null, destino.obra.nombre),
            `, con ${alta.tareas} ${alta.tareas === 1 ? 'trabajo encargado' : 'trabajos encargados'}.`),
          elegidos.length ? h('p', { class: subidos ? 'sub' : 'nota' }, subidos
            ? `Las fotos y archivos (${elegidos.length}) quedaron en el primer trabajo.`
            : 'El proveedor se creó, pero no se pudieron subir todas las fotos y archivos. Subilos desde la tarea.') : null,
          h('p', { class: 'sub' }, 'Tocá «Compartir por WhatsApp»: se abre tu lista de contactos para elegir a quién mandárselo. Con solo abrir el link entra a la app, sin usuario ni contraseña, y ve únicamente su trabajo: lo presupuesta, le pone fecha de entrega, sube fotos y archivos y lo marca cuando lo termina.'),
          campo,
          h('div', { class: 'fila' },
            botonWhatsApp(mensaje, 'boton principal', 'Compartir por WhatsApp'),
            h('button', {
              type: 'button',
              onclick: async () => {
                try { await navigator.clipboard.writeText(mensaje); avisar('Mensaje con el link copiado. Pegalo en WhatsApp.'); } catch { campo.select(); avisar('Mantené apretado el link para copiarlo.'); }
              },
            }, 'Copiar mensaje con el link'),
            h('button', { type: 'button', onclick: () => v.cerrar() }, 'Listo')));
      },
    },
      h('label', { class: 'ancho', for: 'pr-obra' }, 'Obra a la que se asigna', cual),
      h('label', { for: 'pr-nombre' }, 'Nombre', nombre),
      h('label', { for: 'pr-rubro' }, 'Rubro', rubro),
      h('datalist', { id: 'rubros' }, RUBROS.map((r) => h('option', { value: r }))),
      h('label', { class: 'ancho', for: 'pr-lugar' }, 'Lugar (opcional)', lugar),
      h('label', { class: 'ancho', for: 'pr-trabajos' }, 'Trabajo que le encargás', trabajos),
      h('label', { class: 'ancho', for: 'pr-adjuntos' }, 'Fotos y archivos del trabajo (opcional)', adjuntos),
      h('button', { class: 'principal ancho', type: 'submit' }, 'Crear proveedor y su link')));
    nombre.focus();
  }

  function sumarConLink() {
    const v = ventana('Sumar una obra con un link');
    const link = h('input', { id: 'o-link', type: 'text', autocomplete: 'off', placeholder: 'Pegá acá el link que te pasaron' });
    v.cuerpo.append(h('form', {
      class: 'rejilla',
      onsubmit: (e) => {
        e.preventDefault();
        const texto = link.value.trim();
        const k = (texto.match(/k=([0-9a-f]{20,}(?:,[0-9a-f]{20,})*)/i) || texto.match(/^([0-9a-f]{20,})$/i) || [])[1];
        if (!k) return avisar('Ese link no tiene un código de acceso.', true);
        v.cerrar();
        history.replaceState(null, '', location.pathname + '#k=' + k);
        yo = null;
        arrancar();
      },
    },
      h('label', { class: 'ancho', for: 'o-link' }, 'Link de acceso', link),
      h('button', { class: 'principal ancho', type: 'submit' }, 'Entrar a esa obra')));
    link.focus();
  }

  // ----- datos de demostración -----
  const hayDemo = fichas.some((f) => f.obra.demo);
  function cargarDemoUI() {
    const v = ventana('Datos de demostración');
    v.cuerpo.append(
      h('p', null, 'Crea dos obras de ejemplo, Casa Los Álamos y Clínica Norte, con todo cargado: tareas en todos los estados, presupuestos por tarea y en grupo, pagos, fotos, archivos, proveedores y comentarios.'),
      h('p', { class: 'sub' }, 'Tus obras reales no se tocan. Las de demostración llevan la marca «Demo» y las podés borrar cuando quieras.'),
      h('div', { class: 'fila' },
        h('button', {
          class: 'principal', type: 'button',
          onclick: async (e) => {
            const ok = await hacer(e.currentTarget, async () => {
              const r = await api('POST', '/demo');
              guardarAccesos([...accesos(), ...r.obras.map((o) => ({ token: o.token, obra: o.nombre, tipo: o.tipo, persona: yo.nombre, rol: 'propietario', rubro: '', limitado: false }))]);
            }, 'Demostración cargada.');
            if (ok) { v.cerrar(); vistaInicio(); }
          },
        }, 'Cargar demostración'),
        h('button', { type: 'button', onclick: () => v.cerrar() }, 'Cancelar')));
  }
  function quitarDemoUI() {
    const demoTokens = new Set(fichas.filter((f) => f.obra.demo).map((f) => f.token));
    const v = ventana('Quitar la demostración');
    v.cuerpo.append(
      h('p', null, 'Se borran las obras de demostración con todo lo que tienen cargado: tareas, presupuestos, pagos, fotos y archivos. No se puede deshacer.'),
      h('p', { class: 'sub' }, 'Tus obras reales no se tocan.'),
      h('div', { class: 'fila' },
        h('button', {
          class: 'peligro', type: 'button',
          onclick: async (e) => {
            const ok = await hacer(e.currentTarget, () => api('DELETE', '/demo'), 'Demostración borrada.');
            if (!ok) return;
            v.cerrar();
            const quedan = accesos().filter((x) => !demoTokens.has(x.token));
            guardarAccesos(quedan);
            if (!demoTokens.has(token)) vistaInicio();
            else if (quedan.length) cambiarDeObra(quedan[0].token);
            else { try { localStorage.removeItem(CLAVE); } catch {} token = null; yo = null; pantallaIngreso(); }
          },
        }, 'Sí, borrar la demostración'),
        h('button', { type: 'button', onclick: () => v.cerrar() }, 'Cancelar')));
  }

  // ----- cuadros -----
  const ICONO_ACCION = { 'Nueva obra': 'mas', 'Nuevo proveedor': 'usuariomas', 'Sumar proveedor con un link': 'enlace', 'Sumar obra con un link': 'enlace', 'Datos de demo': 'flask', 'Quitar la demo': 'papelera' };
  const accion = (titulo, detalle, alTocar) => h('button', { class: 'cuadro accion', type: 'button', onclick: alTocar },
    h('span', { class: 'mas', 'aria-hidden': 'true' }, ico(ICONO_ACCION[titulo] || 'mas')), h('strong', null, titulo), h('span', { class: 'sub' }, detalle));
  const dato = (valor, texto, clase) => h('div', { class: 'numero' + (clase && valor ? ' ' + clase : '') }, h('span', { class: 'cifra' }, valor), h('span', { class: 'sub' }, texto));

  const cuadrosDeObra = fichas.map((f) => {
    const avance = f.total ? Math.round((f.hechas / f.total) * 100) : 0;
    const dirige = dirigidas.includes(f);
    const cinta = h('span', { class: 'cinta', role: 'img', 'aria-label': `Avance: ${avance}%` });
    cinta.style.setProperty('--avance', avance);
    return h('div', { class: 'carpeta', 'data-tipo': CLAVE_TIPO[f.obra.tipo] || 'otra' },
      h('span', { class: 'solapa' }, f.obra.tipo || 'Tipo sin definir'),
      h('button', { class: 'cuadro obra', type: 'button', onclick: () => cambiarDeObra(f.token, 'tareas'), 'aria-label': `Abrir ${f.obra.nombre}` },
        h('strong', { class: 'texto' }, f.obra.nombre, f.obra.demo ? h('span', { class: 'chip pend' }, 'Demo') : null),
        f.error ? h('span', { class: 'chip mal' }, 'No se pudo leer') : cinta,
        f.error ? null : h('span', { class: 'sub' }, f.total ? `${avance}% · ${f.hechas} de ${f.total}` : 'Sin tareas todavía'),
        h('span', { class: 'datos' },
          f.tocan ? h('span', { class: 'chip info' }, `${f.tocan} para vos`) : null,
          f.vencidas ? h('span', { class: 'chip mal' }, `${f.vencidas} ${f.vencidas === 1 ? 'vencida' : 'vencidas'}`) : null,
          Object.entries(CON_PRESUPUESTOS ? f.saldos : {}).filter(([, n]) => n).map(([moneda, n]) => h('span', null, `Saldo ${plata(n, moneda)}`)),
          f.persona && f.persona.limitado ? h('span', null, rotulo(f.persona)) : null)),
      dirige ? h('button', { class: 'engranaje', type: 'button', onclick: () => editarObra(f), 'aria-label': `Cambiar nombre o tipo de ${f.obra.nombre}` }, 'Editar') : null);
  });

  // ----- presupuestos a aprobar -----
  const pendientes = fichas.flatMap((f) => f.aAprobar).sort((a, b) => (a.plazo || '').localeCompare(b.plazo || ''));
  const totales = {};
  for (const x of pendientes) totales[x.moneda] = (totales[x.moneda] || 0) + x.monto;
  const cajaAprobar = !dirigidas.length || !CON_PRESUPUESTOS ? [] : [
    h('h2', { class: 'grupo' }, 'Presupuestos a aprobar',
      h('small', null, pendientes.length ? Object.entries(totales).map(([moneda, n]) => plata(n, moneda)).join(' + ') : '')),
    pendientes.length
      ? h('ul', { class: 'lista' }, pendientes.map((x) =>
        h('li', { class: 'aprobar' },
          h('div', { class: 'cuerpo' },
            h('span', { class: 'texto' }, x.titulo),
            h('span', { class: 'datos' },
              h('strong', null, plata(x.monto, x.moneda)),
              h('span', null, 'Entrega ' + dia(x.plazo)),
              h('span', null, x.obra),
              x.detalle ? h('span', null, x.detalle) : null)),
          h('div', { class: 'fila' },
            h('button', {
              class: 'bien chico', type: 'button',
              onclick: (e) => hacer(e.currentTarget, () => pedirCon(x.token, 'POST', x.ruta + '/accion', { accion: 'aprobar' }), 'Presupuesto aprobado.').then((ok) => ok && refrescar()),
            }, 'Aprobar'),
            h('button', { class: 'chico', type: 'button', onclick: () => cambiarDeObra(x.token, 'presupuestos') }, 'Ver o rechazar')))))
      : h('p', { class: 'vacio' }, 'No hay presupuestos esperando tu aprobación.'),
  ];

  // ----- última actividad -----
  const haceCuanto = (iso) => {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const horas = Math.round(min / 60);
    if (horas < 24) return `hace ${horas} h`;
    const dias = Math.round(horas / 24);
    if (dias === 1) return 'ayer';
    return dias < 7 ? `hace ${dias} días` : dia(iso);
  };
  // Los movimientos seguidos de la misma persona, del mismo tipo y en la misma obra se juntan en uno
  // («Federico cargó 21 tareas»), así una carga grande no tapa todo lo demás.
  const PLURAL = {
    creada: (n) => `cargó ${n} tareas`, editada: (n) => `cambió ${n} tareas`, presupuestada: (n) => `cargó ${n} presupuestos`,
    aprobada: (n) => `aprobó ${n} presupuestos`, rechazada: (n) => `rechazó ${n} presupuestos`, realizada: (n) => `marcó ${n} tareas como realizadas`,
    verificada: (n) => `verificó ${n} tareas`, devuelta: (n) => `devolvió ${n} tareas`, comentario: (n) => `hizo ${n} comentarios`,
    foto: (n) => `subió ${n} fotos`, archivo: (n) => `subió ${n} archivos`, pago: (n) => `registró ${n} pagos`,
  };
  const juntar = [];
  for (const e of fichas.flatMap((f) => f.actividad).sort((a, b) => b.fecha.localeCompare(a.fecha))) {
    const deGrupo = /grupo «/.test(e.detalle || '');
    const clave = [e.token, e.persona, e.tipo, deGrupo ? e.detalle : ''].join('|');
    const ult = juntar[juntar.length - 1];
    if (ult && ult.clave === clave && Date.parse(ult.masVieja) - Date.parse(e.fecha) < 15 * 60000) { ult.n += 1; ult.masVieja = e.fecha; }
    else juntar.push({ ...e, clave, deGrupo, n: 1, masVieja: e.fecha });
  }
  const movimientos = juntar.slice(0, 8);
  const cajaActividad = [
    h('h2', { class: 'grupo' }, 'Última actividad', h('small', null, movimientos.length ? 'Lo último que pasó en tus obras' : '')),
    movimientos.length
      ? h('ul', { class: 'lista' }, movimientos.map((x) => {
        const varios = x.n > 1 && !x.deGrupo;
        const verbo = varios ? (PLURAL[x.tipo] ? PLURAL[x.tipo](x.n) : `${EVENTOS[x.tipo] || x.tipo} (${x.n} veces)`) : EVENTOS[x.tipo] || x.tipo;
        const titulo = x.n > 1 ? `${x.tarea} y ${x.n - 1} más` : x.tarea;
        return h('li', null, h('button', {
          class: 'renglon actividad', type: 'button',
          onclick: () => cambiarDeObra(x.token, varios ? 'tareas' : 'tarea/' + x.tarea_id),
        },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(x.persona || '?')),
          h('span', { class: 'cuerpo' },
            h('span', null, h('strong', null, x.persona || 'Alguien'), ' ', verbo),
            h('span', { class: 'texto' }, titulo),
            x.detalle && !varios ? h('span', { class: 'cita' }, detalleLegible(x)) : null,
            h('span', { class: 'datos' }, h('span', null, x.obra), h('span', null, haceCuanto(x.fecha))))));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay movimientos. Acá aparece lo que cargan, cotizan, aprueban y suben en tus obras.'),
  ];

  // ----- próximos vencimientos -----
  const vencimientos = fichas.flatMap((f) => f.porVencer).sort((a, b) => a.plazo.localeCompare(b.plazo));
  const cuando = (plazo) => {
    const dias = Math.round((Date.parse(plazo + 'T00:00:00') - Date.parse(hoy() + 'T00:00:00')) / 86400000);
    if (dias < 0) return [`Venció el ${dia(plazo)} · hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, 'mal'];
    if (dias === 0) return ['Vence hoy', 'pend'];
    if (dias === 1) return [`Vence mañana · ${dia(plazo)}`, 'pend'];
    return [`Vence el ${dia(plazo)} · en ${dias} días`, 'info'];
  };
  const TOPE = 8;
  const cajaVencimientos = [
    h('h2', { class: 'grupo' }, 'Próximos vencimientos', h('small', null, 'Vencidas y los próximos 7 días')),
    vencimientos.length
      ? h('ul', { class: 'lista' }, vencimientos.slice(0, TOPE).map((v) => {
        const [texto, clase] = cuando(v.plazo);
        return h('li', null, h('button', { class: 'renglon', type: 'button', onclick: () => cambiarDeObra(v.token, 'tarea/' + v.id) },
          h('span', { class: 'texto' }, v.texto),
          h('span', { class: 'datos' }, h('span', { class: 'chip ' + clase }, texto), h('span', null, v.obra), v.quien ? h('span', null, v.quien) : null)));
      }))
      : h('p', { class: 'vacio' }, 'No hay nada vencido ni por vencer en los próximos 7 días.'),
    vencimientos.length > TOPE ? h('p', { class: 'sub' }, `Y ${vencimientos.length - TOPE} más. Entrá a cada obra para verlas todas.`) : null,
  ];

  // ----- fotos de obra -----
  function botonMovimiento() {
    const b = h('button', {
      id: 'mover', class: 'chico', type: 'button', hidden: true,
      onclick: async (e) => {
        if (await activarMovimiento()) { e.currentTarget.remove(); avisar('Movimiento activado. Inclinás el celular y las fotos se mueven.'); }
        else avisar('No se dio permiso para el movimiento. Se puede cambiar en los ajustes del navegador.', true);
      },
    }, 'Activar el movimiento de las fotos');
    // En Android y en la computadora el movimiento llega solo; el botón aparece únicamente si no llegó nada (iPhone).
    setTimeout(() => { if (!tilt.recibido && b.isConnected) b.hidden = false; }, 1500);
    return b;
  }
  const recientes = fichas.flatMap((f) => f.fotos).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 12);
  const MOMENTO = { antes: 'Antes', despues: 'Después' };
  const porCargar = [];
  const cajaFotos = [
    h('h2', { class: 'grupo' }, 'Fotos de obra', h('small', null, recientes.length ? 'Subidas por los constructores' : '')),
    recientes.length && pideAutorizacion() && !tilt.recibido && !sinMovimiento.matches ? botonMovimiento() : null,
    recientes.length
      ? h('div', { class: 'fotos grandes' }, recientes.map((f) => {
        const img = h('img', { alt: `Foto de «${f.tarea}» en ${f.obra}`, loading: 'lazy' });
        porCargar.push([f, img]);
        return h('button', { class: 'foto', type: 'button', onclick: () => cambiarDeObra(f.token, 'tarea/' + f.tarea_id), 'aria-label': `Abrir «${f.tarea}» en ${f.obra}` },
          img, h('span', null, [f.obra, f.persona].filter(Boolean).join(' · ')));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay fotos subidas por los constructores o proveedores.'),
  ];

  marco('',
    h('div', { class: 'tablero' },
      dato(suma('tocan'), suma('tocan') === 1 ? 'Espera tu respuesta' : 'Esperan tu respuesta', 'aviso-info'),
      dato(suma('vencidas'), 'Con plazo vencido', 'aviso-mal'),
      dato(suma('total') - suma('hechas'), 'Tareas abiertas')),
    h('div', { class: 'cuadros acciones' },
      dirigidas.length ? accion('Nueva obra', 'Vivienda, clínica, local…', nuevaObra) : null,
      dirigidas.length ? accion('Nuevo proveedor', 'Plomero, electricista… con su link', nuevoProveedor) : null,
      dirigidas.length ? (hayDemo ? accion('Quitar la demo', 'Borra las obras de ejemplo', quitarDemoUI) : accion('Datos de demo', 'Obras de ejemplo con todo cargado', cargarDemoUI)) : null,
      accion(dirigidas.length ? 'Sumar proveedor con un link' : 'Sumar obra con un link', 'Con el link que te pasaron', sumarConLink)),
    ...cajaAprobar,
    ...cajaVencimientos,
    ...cajaActividad,
    h('h2', { class: 'grupo' }, fichas.length === 1 ? 'Tu obra' : 'Tus obras', h('small', null, 'Tocá una para abrirla')),
    h('div', { class: 'cuadros obras' }, cuadrosDeObra),
    ...cajaFotos,
    otrosPerfiles.size ? h('h2', { class: 'grupo' }, 'Otros accesos en este celular', h('small', null, 'No se mezclan con este')) : null,
    otrosPerfiles.size ? h('ul', { class: 'lista' }, [...otrosPerfiles.values()].map((x) =>
      h('li', { class: 'aprobar' },
        h('div', { class: 'cuerpo' },
          h('span', { class: 'texto' }, x.persona || 'Sin nombre'),
          h('span', { class: 'datos' }, h('span', null, rotulo(x)), h('span', null, `${x.obras} ${x.obras === 1 ? 'obra' : 'obras'}`))),
        h('button', { class: 'chico', type: 'button', onclick: () => cambiarDeObra(x.token) }, 'Entrar con este acceso')))) : null,
  );
  // Las fotos se piden después de dibujar, cada una con el link de su obra.
  for (const [f, img] of porCargar) {
    fetch('/api/fotos/' + f.id, { headers: { Authorization: 'Bearer ' + f.token } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { const u = URL.createObjectURL(b); urlsDeFotos.push(u); img.src = u; })
      .catch(() => { img.alt = 'No se pudo cargar la foto'; });
  }
}

// ---------- rutas ----------
async function mostrar() {
  if (!token || !yo) return;
  const ruta = location.hash.replace(/^#\/?/, '');
  try {
    if (ruta.startsWith('tarea/')) await vistaTarea(Number(ruta.slice(6)));
    else if (ruta === 'presupuestos' && CON_PRESUPUESTOS) await vistaPresupuestos();
    else if (ruta === 'resumen') await vistaResumen();
    else if (ruta === 'personas') await vistaPersonas();
    else if (ruta === 'tareas') await vistaLista();
    else await vistaInicio();
    window.scrollTo(0, 0);
  } catch (e) {
    if (!token) return;
    avisar(e.message, true);
    if (ruta) location.hash = '#/';
    else app.replaceChildren(h('main', null, h('p', { class: 'vacio' }, e.message), h('button', { class: 'principal', type: 'button', onclick: mostrar }, 'Reintentar')));
  }
}

async function arrancar() {
  // Entrada desde Conectar o FC: traen un código de un solo uso que Construir confirma con ese sistema.
  const desde = location.hash.match(/^#entrar=(conectar|fc):([A-Za-z0-9_-]{20,128})$/);
  if (desde) {
    history.replaceState(null, '', location.pathname);
    try {
      const r = await fetch('/api/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sistema: desde[1], codigo: desde[2] }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo entrar.');
      history.replaceState(null, '', location.pathname + '#k=' + d.tokens.join(','));
    } catch (e) {
      app.replaceChildren(h('main', null, h('p', { class: 'vacio' }, e.message)));
      return;
    }
  }
  // El link puede traer un código o varios separados por coma (uno por obra): se abre la primera y se recuerdan todas.
  const enLink = location.hash.match(/^#k=([0-9a-f]{20,}(?:,[0-9a-f]{20,})*)$/i);
  if (enLink) {
    const [primero, ...resto] = enLink[1].split(',');
    history.replaceState(null, '', location.pathname);
    for (const k of resto) {
      try {
        const r = await fetch('/api/yo', { headers: { Authorization: 'Bearer ' + k } });
        if (!r.ok) continue;
        const d = await r.json();
        guardarAccesos([...accesos().filter((x) => x.token !== k), { token: k, obra: d.obra.nombre, tipo: d.obra.tipo || '', persona: d.persona.nombre, rol: d.persona.rol, rubro: d.persona.rubro || '', limitado: !!d.persona.limitado, pide: !!d.persona.pide }]);
      } catch {}
    }
    guardarToken(primero);
  } else if (!token) {
    try { token = localStorage.getItem(CLAVE); } catch {}
  }
  if (!token) return pantallaIngreso();
  try {
    const d = await api('GET', '/yo');
    yo = d.persona;
    obra = d.obra;
    recordarAcceso();
    document.title = obra.nombre + ' · Construir';
    await mostrar();
  } catch (e) {
    if (token) app.replaceChildren(h('main', null, h('p', { class: 'vacio' }, e.message), h('button', { class: 'principal', type: 'button', onclick: arrancar }, 'Reintentar')));
  }
}

window.addEventListener('hashchange', () => {
  if (/^#(k|entrar)=/.test(location.hash)) { yo = null; arrancar(); } else mostrar();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
arrancar();
