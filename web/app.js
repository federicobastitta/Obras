// Obras: tareas, presupuestos, plazos, fotos y pagos de una obra.
const app = document.getElementById('app');
const CLAVE = 'obras.token';

let token = null;
let yo = null;
let obra = null;
let tareas = [];
let filtro = null;
let urlsDeFotos = [];

const ESTADOS = {
  pendiente: ['Sin presupuesto', 'pend'],
  presupuestada: ['Presupuesto a aprobar', 'info'],
  aprobada: ['Aprobada, por hacer', 'info'],
  realizada: ['Realizada, a verificar', 'pend'],
  verificada: ['Terminada', 'ok'],
  devuelta: ['Devuelta', 'mal'],
};
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
  comentario: 'comentó',
  foto: 'subió una foto',
  foto_borrada: 'borró una foto',
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
function meToca(t) {
  if (esConstructor()) return ['pendiente', 'aprobada', 'devuelta'].includes(t.estado);
  return ['presupuestada', 'realizada'].includes(t.estado);
}

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
    try { localStorage.removeItem(CLAVE); } catch {}
    token = null;
    pantallaIngreso('El link de acceso no es válido o fue dado de baja.');
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

// ---------- ingreso ----------
function pantallaIngreso(mensaje) {
  const campo = h('input', { id: 'codigo', type: 'text', autocomplete: 'off', placeholder: 'Pegá acá tu link de acceso' });
  app.replaceChildren(
    h('main', null,
      h('form', {
        class: 'caja ingreso',
        onsubmit: (e) => {
          e.preventDefault();
          const v = campo.value.trim();
          const k = (v.match(/k=([0-9a-f]{20,})/i) || v.match(/^([0-9a-f]{20,})$/i) || [])[1];
          if (!k) return avisar('Ese link no tiene un código de acceso.', true);
          guardarToken(k);
          arrancar();
        },
      },
        h('h2', null, 'Obras'),
        mensaje ? h('p', { class: 'nota' }, mensaje) : null,
        h('p', { class: 'sub' }, 'Para entrar hace falta el link personal que te pasó el propietario o el arquitecto de la obra.'),
        h('label', { for: 'codigo' }, 'Link de acceso', campo),
        h('button', { class: 'principal', type: 'submit' }, 'Entrar'),
      ),
    ),
  );
}
function guardarToken(k) {
  token = k;
  try { localStorage.setItem(CLAVE, k); } catch {}
}

// ---------- marco ----------
function marco(actual, ...contenido) {
  for (const u of urlsDeFotos) URL.revokeObjectURL(u);
  urlsDeFotos = [];
  const pestana = (ruta, texto) => h('a', { href: '#/' + ruta, 'aria-current': actual === ruta ? 'page' : null }, texto);
  app.replaceChildren(
    h('header', { class: 'barra' },
      h('div', { class: 'fila' },
        h('h1', null, obra.nombre),
        h('span', { class: 'quien' }, `${yo.nombre} · ${ROLES[yo.rol]}`),
      ),
      h('nav', { class: 'pestanas' },
        pestana('', 'Tareas'),
        pestana('resumen', 'Resumen'),
        esDireccion() ? pestana('personas', 'Personas') : null,
      ),
    ),
    h('main', null, ...contenido),
  );
}

async function cargarTareas() {
  tareas = (await api('GET', '/tareas')).tareas;
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
          const ok = await hacer(e.submitter, () => api('POST', '/tareas', { texto: texto.value, lugar: lugar.value, prioridad: prioridad.value }), 'Tarea cargada.');
          if (ok) { filtro = 'abiertas'; vistaLista(); }
        },
      },
        h('label', { class: 'ancho', for: 'n-texto' }, 'Tarea', texto),
        h('label', { for: 'n-lugar' }, 'Lugar de la casa', lugar),
        h('label', { for: 'n-prioridad' }, 'Prioridad', prioridad),
        h('datalist', { id: 'lugares' }, lugares.map((l) => h('option', { value: l }))),
        h('button', { class: 'principal ancho', type: 'submit' }, 'Agregar tarea'),
      ),
    );
  }

  const filtros = h('div', { class: 'filtros', role: 'group', 'aria-label': 'Qué tareas mostrar' },
    opciones.map(([clave, nombre, lista]) =>
      h('button', { type: 'button', 'aria-pressed': String(filtro === clave), onclick: () => { filtro = clave; vistaLista(); } }, `${nombre} ${lista.length}`)),
  );

  const grupos = new Map();
  for (const t of ver) {
    const k = t.lugar || 'Sin lugar';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(t);
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
  for (const [lugar, lista] of grupos) {
    cuerpo.push(h('h2', { class: 'grupo' }, lugar, h('small', null, `${lista.length} ${lista.length === 1 ? 'tarea' : 'tareas'}`)));
    cuerpo.push(h('ul', { class: 'lista' }, lista.map((t) =>
      h('li', { class: terminada(t) ? 'terminada' : null },
        h('a', { href: '#/tarea/' + t.id },
          h('span', { class: 'texto' }, t.texto),
          h('span', { class: 'datos' },
            chipEstado(t),
            t.prioridad === 'alta' && !terminada(t) ? h('span', { class: 'chip mal' }, 'Prioridad alta') : null,
            t.monto != null ? h('span', null, plata(t.monto, t.moneda)) : null,
            t.plazo ? h('span', { class: vencida(t) ? 'vencida' : null }, (vencida(t) ? 'Venció el ' : 'Plazo ') + dia(t.plazo)) : null,
            t.fotos ? h('span', null, `${t.fotos} ${t.fotos === 1 ? 'foto' : 'fotos'}`) : null,
            t.comentarios ? h('span', null, `${t.comentarios} ${t.comentarios === 1 ? 'comentario' : 'comentarios'}`) : null,
          ),
        ),
      ))));
  }
  marco('', alta, filtros, ...cuerpo);
}

// ---------- detalle ----------
async function vistaTarea(id) {
  const { tarea: t, eventos, fotos, pagos } = await api('GET', '/tareas/' + id);
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

  // Presupuesto
  const presupuesto = h('section', { class: 'caja' }, h('h2', null, 'Presupuesto y plazo'));
  if (t.monto != null) {
    presupuesto.append(
      h('p', { class: 'grande' }, plata(t.monto, t.moneda)),
      h('p', { class: 'sub' },
        h('span', { class: vencida(t) ? 'vencida' : null }, (vencida(t) ? 'El plazo venció el ' : 'Plazo probable: ') + dia(t.plazo)),
        t.estado === 'presupuestada' ? ' · falta aprobar' : t.aprobada_en ? ` · aprobado el ${dia(t.aprobada_en)}` : ''),
      t.presupuesto_nota ? h('p', { class: 'texto' }, t.presupuesto_nota) : null,
    );
  } else {
    presupuesto.append(h('p', { class: 'sub' }, esConstructor() ? 'Todavía no cargaste el presupuesto.' : 'El constructor todavía no cargó el presupuesto.'));
  }
  if (t.estado === 'pendiente' && t.motivo) presupuesto.append(h('p', { class: 'nota' }, 'Presupuesto rechazado: ' + t.motivo));
  if (esConstructor() && ['pendiente', 'presupuestada'].includes(t.estado)) {
    const monto = h('input', { id: 'p-monto', type: 'number', inputmode: 'numeric', min: 0, step: 1, required: true, value: t.monto ?? '' });
    const moneda = h('select', { id: 'p-moneda' }, h('option', { value: 'ARS' }, 'Pesos'), h('option', { value: 'USD' }, 'Dólares'));
    moneda.value = t.moneda;
    const plazo = h('input', { id: 'p-plazo', type: 'date', required: true, value: t.plazo ?? '' });
    const nota = h('input', { id: 'p-nota', type: 'text', maxlength: 500, placeholder: 'Qué incluye: materiales, mano de obra…', value: t.presupuesto_nota });
    presupuesto.append(h('form', {
      class: 'rejilla',
      onsubmit: (e) => {
        e.preventDefault();
        accion(e.submitter, { accion: 'presupuestar', monto: Number(monto.value), moneda: moneda.value, plazo: plazo.value, nota: nota.value }, 'Presupuesto enviado.');
      },
    },
      h('label', { for: 'p-monto' }, 'Monto, sin centavos', monto),
      h('label', { for: 'p-moneda' }, 'Moneda', moneda),
      h('label', { for: 'p-plazo' }, 'Plazo probable', plazo),
      h('label', { for: 'p-nota' }, 'Nota', nota),
      h('button', { class: 'principal ancho', type: 'submit' }, t.monto != null ? 'Cambiar presupuesto' : 'Enviar presupuesto'),
    ));
  }
  if (esDireccion() && t.estado === 'presupuestada') {
    const [rechazar, formRechazo] = conMotivo('Rechazar', 'rechazar', 'Presupuesto rechazado.');
    presupuesto.append(
      h('div', { class: 'fila' },
        h('button', { class: 'bien', type: 'button', onclick: (e) => accion(e.currentTarget, { accion: 'aprobar' }, 'Presupuesto aprobado.') }, 'Aprobar presupuesto'),
        rechazar),
      formRechazo,
    );
  }

  // Avance
  const avance = h('section', { class: 'caja' }, h('h2', null, 'Avance'));
  const lineas = [];
  if (t.realizada_en) lineas.push(`Realizada el ${dia(t.realizada_en)}`);
  if (t.verificada_en) lineas.push(`Verificada el ${dia(t.verificada_en)}`);
  avance.append(h('p', { class: 'sub' }, lineas.length ? lineas.join(' · ') : 'Todavía no se hizo.'));
  if (t.estado === 'devuelta' && t.motivo) avance.append(h('p', { class: 'nota' }, 'Devuelta: ' + t.motivo));
  if (esConstructor() && ['pendiente', 'aprobada', 'devuelta'].includes(t.estado)) {
    avance.append(h('div', { class: 'fila' },
      h('button', { class: 'bien', type: 'button', onclick: (e) => accion(e.currentTarget, { accion: 'realizada' }, 'Marcada como realizada.') }, 'Marcar como realizada')));
  }
  if (esConstructor() && t.estado === 'presupuestada') avance.append(h('p', { class: 'sub' }, 'Vas a poder marcarla como realizada cuando aprueben el presupuesto.'));
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
    avance.append(h('div', { class: 'fila' }, botones), formDevolver);
  }

  // Pagos
  const pagado = pagos.reduce((s, g) => s + g.monto, 0);
  const cajaPagos = h('section', { class: 'caja' },
    h('h2', null, 'Pagos'),
    h('p', { class: 'sub' },
      pagos.length ? `Pagado: ${plata(pagado, t.moneda)}` : 'Sin pagos registrados.',
      t.monto != null && pagos.length ? ` · Saldo: ${plata(t.monto - pagado, t.moneda)}` : ''),
    pagos.length ? h('ul', { class: 'historial' }, pagos.map((g) =>
      h('li', null,
        h('span', { class: 'fila entre' },
          h('strong', null, plata(g.monto, t.moneda)),
          esDireccion() ? h('button', { class: 'chico peligro', type: 'button', onclick: (e) => hacer(e.currentTarget, () => api('DELETE', `/tareas/${id}/pagos/${g.id}`), 'Pago borrado.').then((ok) => ok && recargar()) }, 'Borrar') : null),
        h('span', { class: 'cuando' }, `${dia(g.fecha)} · lo registró ${g.persona || 'alguien'}`),
        g.nota ? h('span', { class: 'dicho' }, g.nota) : null))) : null,
  );
  if (esDireccion()) {
    const monto = h('input', { id: 'g-monto', type: 'number', inputmode: 'numeric', min: 1, step: 1, required: true });
    const fecha = h('input', { id: 'g-fecha', type: 'date', required: true, value: hoy() });
    const nota = h('input', { id: 'g-nota', type: 'text', maxlength: 300, placeholder: 'Anticipo, transferencia, efectivo…' });
    cajaPagos.append(h('details', null,
      h('summary', null, 'Registrar un pago'),
      h('form', {
        class: 'rejilla',
        onsubmit: async (e) => {
          e.preventDefault();
          const ok = await hacer(e.submitter, () => api('POST', `/tareas/${id}/pagos`, { monto: Number(monto.value), fecha: fecha.value, nota: nota.value }), 'Pago registrado.');
          if (ok) recargar();
        },
      },
        h('label', { for: 'g-monto' }, `Monto en ${t.moneda === 'USD' ? 'dólares' : 'pesos'}`, monto),
        h('label', { for: 'g-fecha' }, 'Fecha', fecha),
        h('label', { class: 'ancho', for: 'g-nota' }, 'Nota', nota),
        h('button', { class: 'principal ancho', type: 'submit' }, 'Guardar pago'))));
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
    const confirmar = h('div', { class: 'fila', hidden: true },
      h('span', { class: 'sub' }, 'Se borra la tarea con sus fotos, pagos e historial.'),
      h('button', { class: 'peligro', type: 'button', onclick: async (e) => { if (await hacer(e.currentTarget, () => api('DELETE', '/tareas/' + id), 'Tarea borrada.')) location.hash = '#/'; } }, 'Sí, borrar'),
      h('button', { type: 'button', onclick: () => { confirmar.hidden = true; } }, 'No'));
    edicion = h('details', { class: 'caja' },
      h('summary', { class: 'titulo' }, 'Editar o borrar la tarea'),
      h('form', {
        class: 'rejilla',
        onsubmit: async (e) => {
          e.preventDefault();
          const ok = await hacer(e.submitter, () => api('PATCH', '/tareas/' + id, { texto: texto.value, lugar: lugar.value, prioridad: prioridad.value }), 'Cambios guardados.');
          if (ok) recargar();
        },
      },
        h('label', { class: 'ancho', for: 'e-texto' }, 'Tarea', texto),
        h('label', { for: 'e-lugar' }, 'Lugar de la casa', lugar),
        h('label', { for: 'e-prioridad' }, 'Prioridad', prioridad),
        h('button', { class: 'principal', type: 'submit' }, 'Guardar cambios'),
        h('button', { class: 'peligro', type: 'button', onclick: () => { confirmar.hidden = false; } }, 'Borrar tarea')),
      confirmar);
  }

  marco('',
    h('a', { href: '#/' }, '← Volver a las tareas'),
    h('section', { class: 'detalle caja' },
      h('p', { class: 'sub' }, t.lugar || 'Sin lugar'),
      h('h2', { class: 'tarea' }, t.texto),
      h('div', { class: 'datos' },
        chipEstado(t),
        t.prioridad !== 'media' ? h('span', { class: 'chip' + (t.prioridad === 'alta' ? ' mal' : '') }, 'Prioridad ' + t.prioridad) : null,
        h('span', null, 'Cargada el ' + dia(t.creada)))),
    presupuesto, avance, cajaPagos, cajaFotos, cajaHistorial, edicion,
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
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'pendiente')), h('span', { class: 'sub' }, 'Sin presupuesto')),
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'presupuestada')), h('span', { class: 'sub' }, 'Presupuesto a aprobar')),
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'aprobada' || t.estado === 'devuelta')), h('span', { class: 'sub' }, 'Por hacer')),
        h('div', null, h('strong', null, cuenta((t) => t.estado === 'realizada')), h('span', { class: 'sub' }, 'A verificar')),
        h('div', null, h('strong', { class: cuenta(vencida) ? 'vencida' : null }, cuenta(vencida)), h('span', { class: 'sub' }, 'Con plazo vencido')))),
  ];

  for (const moneda of ['ARS', 'USD']) {
    const con = tareas.filter((t) => t.moneda === moneda && (t.monto != null || t.pagado > 0));
    if (!con.length) continue;
    const aprobadas = (t) => ['aprobada', 'realizada', 'verificada', 'devuelta'].includes(t.estado);
    const suma = (lista, f) => lista.reduce((s, t) => s + (f(t) || 0), 0);
    const filas = new Map();
    for (const t of con) {
      const k = t.lugar || 'Sin lugar';
      if (!filas.has(k)) filas.set(k, []);
      filas.get(k).push(t);
    }
    const fila = (nombre, lista, etiqueta = 'td') => {
      const aprobado = suma(lista.filter(aprobadas), (t) => t.monto);
      const pagado = suma(lista, (t) => t.pagado);
      return h('tr', null,
        h(etiqueta === 'th' ? 'th' : 'td', null, nombre),
        h(etiqueta, null, numero.format(suma(lista, (t) => t.monto))),
        h(etiqueta, null, numero.format(aprobado)),
        h(etiqueta, null, numero.format(pagado)),
        h(etiqueta, null, numero.format(aprobado - pagado)));
    };
    cajas.push(h('section', { class: 'caja' },
      h('h2', null, moneda === 'USD' ? 'Plata en dólares' : 'Plata en pesos'),
      h('div', { class: 'tabla' },
        h('table', null,
          h('thead', null, h('tr', null, ['Lugar', 'Presupuestado', 'Aprobado', 'Pagado', 'Saldo'].map((x) => h('th', null, x)))),
          h('tbody', null, [...filas].map(([k, lista]) => fila(k, lista))),
          h('tfoot', null, fila('Total', con, 'th')))),
      h('p', { class: 'sub' }, 'Saldo = aprobado menos pagado.')));
  }
  if (cajas.length === 1) cajas.push(h('p', { class: 'vacio' }, 'Todavía no hay presupuestos ni pagos cargados.'));
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
            h('span', null, h('strong', null, p.nombre), ` · ${ROLES[p.rol]}`, p.id === yo.id ? ' (vos)' : '', p.activa ? '' : ' · dada de baja'),
            h('span', { class: 'fila' },
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

// ---------- rutas ----------
async function mostrar() {
  if (!token || !yo) return;
  const ruta = location.hash.replace(/^#\/?/, '');
  try {
    if (ruta.startsWith('tarea/')) await vistaTarea(Number(ruta.slice(6)));
    else if (ruta === 'resumen') await vistaResumen();
    else if (ruta === 'personas') await vistaPersonas();
    else await vistaLista();
    window.scrollTo(0, 0);
  } catch (e) {
    if (!token) return;
    avisar(e.message, true);
    if (ruta) location.hash = '#/';
    else app.replaceChildren(h('main', null, h('p', { class: 'vacio' }, e.message), h('button', { class: 'principal', type: 'button', onclick: mostrar }, 'Reintentar')));
  }
}

async function arrancar() {
  const enLink = location.hash.match(/^#k=([0-9a-f]{20,})$/i);
  if (enLink) {
    guardarToken(enLink[1]);
    history.replaceState(null, '', location.pathname);
  } else if (!token) {
    try { token = localStorage.getItem(CLAVE); } catch {}
  }
  if (!token) return pantallaIngreso();
  try {
    const d = await api('GET', '/yo');
    yo = d.persona;
    obra = d.obra;
    document.title = obra.nombre + ' · Obras';
    await mostrar();
  } catch (e) {
    if (token) app.replaceChildren(h('main', null, h('p', { class: 'vacio' }, e.message), h('button', { class: 'principal', type: 'button', onclick: arrancar }, 'Reintentar')));
  }
}

window.addEventListener('hashchange', () => {
  if (/^#k=/.test(location.hash)) { yo = null; arrancar(); } else mostrar();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
arrancar();
