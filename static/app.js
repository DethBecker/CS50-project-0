'use strict';

// ------------------------------------------------------------- utilidades
const $ = (sel, el = document) => el.querySelector(sel);
const vista = $('#vista');
const modal = $('#modal');
let META = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatoDinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dinero = (n) => formatoDinero.format(n || 0);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const fecha = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00' : iso)
  .toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const hoyIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const gramos = (g) => `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(g || 0)} g`;
const nombreRollo = (r) => [r.material, r.color, r.marca].filter(Boolean).join(' ');
const fechaHora = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

const ETIQUETAS = {
  prospecto: 'Prospecto', cliente: 'Cliente',
  borrador: 'Borrador', enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada', pagada: 'Pagada',
  recibido: 'Recibido', diagnostico: 'En diagnóstico', esperando_aprobacion: 'Esperando aprobación',
  esperando_refacciones: 'Esperando refacciones', en_reparacion: 'En reparación', listo: 'Listo para entrega',
  entregado: 'Entregado', cancelado: 'Cancelado',
};
const TIPOS_EQUIPO = ['Laptop', 'Computadora de escritorio', 'Consola', 'Impresora 3D', 'Tarjeta / electrónica', 'Otro'];
const etq = (clave) => ETIQUETAS[clave] || clave;
const chip = (clave) => `<span class="chip ${esc(clave)}">${esc(etq(clave))}</span>`;
const categoria = (clave) => META.categorias[clave] || clave;
const opciones = (lista, actual) => lista.map(([valor, texto]) =>
  `<option value="${esc(valor)}" ${String(valor) === String(actual ?? '') ? 'selected' : ''}>${esc(texto)}</option>`).join('');
const tabla = (encabezados, filasHtml, vacio) => (filasHtml.length
  ? `<div class="tabla-scroll"><table><thead><tr>${encabezados.map((e) => `<th class="${e.startsWith('$') ? 'num' : ''}">${esc(e.replace(/^\$/, ''))}</th>`).join('')}</tr></thead><tbody>${filasHtml.join('')}</tbody></table></div>`
  : `<div class="vacio">${esc(vacio)}</div>`);

async function api(ruta, metodo = 'GET', cuerpo) {
  const resp = await fetch('/api/v1' + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(datos.error || `Error ${resp.status}`);
  return datos;
}

let avisoTimer;
function aviso(texto, error = false) {
  const el = $('#aviso');
  el.textContent = texto;
  el.className = error ? 'error' : '';
  el.style.display = 'block';
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/** Abre un formulario modal; alGuardar recibe los campos como objeto. */
function formulario(titulo, camposHtml, alGuardar) {
  modal.innerHTML = `<form><h2>${esc(titulo)}</h2><div class="campos">${camposHtml}</div>
    <p class="error-form" style="color:var(--mal);margin:0"></p>
    <div class="acciones"><button type="button" data-act="cerrar">Cancelar</button>
    <button class="primario">Guardar</button></div></form>`;
  const form = $('form', modal);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await alGuardar(Object.fromEntries(new FormData(form)));
      modal.close();
    } catch (e) {
      $('.error-form', modal).textContent = e.message;
    }
  };
  modal.showModal();
}

async function intentar(fn, mensajeOk) {
  try {
    await fn();
    if (mensajeOk) aviso(mensajeOk);
  } catch (e) {
    aviso(e.message, true);
  }
}

// --------------------------------------------------------------- tablero
async function tablero() {
  const t = await api('/tablero');
  const enTaller = t.equipos_por_estado.reduce((s, e) => s + e.n, 0);
  vista.innerHTML = `
    <h1>Tablero</h1>
    <div class="rejilla">
      <div class="kpi"><div class="valor">${dinero(t.ingresos_mes)}</div><div class="etq">Ingresos del mes</div></div>
      <div class="kpi"><div class="valor">${dinero(t.ingresos_total)}</div><div class="etq">Ingresos acumulados</div></div>
      <div class="kpi"><div class="valor">${t.clientes}</div><div class="etq">Clientes</div></div>
      <div class="kpi"><div class="valor">${t.prospectos}</div><div class="etq">Prospectos</div></div>
      <div class="kpi"><div class="valor">${t.cotizaciones_abiertas}</div><div class="etq">Cotizaciones abiertas · ${dinero(t.monto_abierto)}</div></div>
      <div class="kpi"><div class="valor">${enTaller}</div><div class="etq">Equipos en taller</div></div>
    </div>
    <div class="dos">
      <div class="panel"><h2>Equipos en taller por estado</h2>
        ${tabla(['Estado', '$Equipos'], t.equipos_por_estado.map((e) => `<tr><td>${chip(e.estado)}</td><td class="num">${e.n}</td></tr>`), 'No hay equipos en taller.')}
      </div>
      <div class="panel"><h2>Ingresos por tipo de servicio</h2>
        ${tabla(['Categoría', '$Monto'], t.ventas_por_categoria.map((v) => `<tr><td>${esc(categoria(v.categoria))}</td><td class="num">${dinero(v.monto)}</td></tr>`), 'Aún no hay ventas registradas.')}
      </div>
      <div class="panel"><h2>Recordatorios pendientes</h2>
        ${tabla(['Fecha', 'Contacto', 'Tarea', ''], t.recordatorios.map((r) => `<tr>
          <td class="${r.fecha < hoyIso() ? 'vencido' : ''}">${fecha(r.fecha)}${r.fecha === hoyIso() ? ' (hoy)' : ''}</td>
          <td><a href="#/contacto/${r.cliente_id}">${esc(r.cliente_nombre)}</a></td><td>${esc(r.texto)}</td>
          <td class="num"><button class="mini" data-act="recordatorioHecho" data-id="${r.id}" data-hecho="1">✓ Hecho</button></td></tr>`), 'No hay tareas pendientes.')}
      </div>
      <div class="panel"><h2>Cumpleaños en los próximos 30 días</h2>
        ${tabla(['Fecha', 'Contacto', 'Cumple'], t.cumpleanos.map((c) => `<tr class="fila-link" data-ir="#/contacto/${c.id}">
          <td>${fecha(c.fecha)}${c.dias === 0 ? ' (hoy)' : ''}</td><td>${esc(c.nombre)}</td><td>${c.edad} años</td></tr>`), 'Ningún cumpleaños próximo.')}
      </div>
      <div class="panel"><h2>Filamento disponible</h2>
        ${tabla(['Material', '$Rollos', '$Restante'], t.material.map((m) => `<tr class="fila-link" data-ir="#/inventario">
          <td>${esc(m.material)}</td><td class="num">${m.rollos}</td><td class="num ${m.restante <= 0 ? 'vencido' : ''}">${gramos(m.restante)}</td></tr>`), 'Aún no hay rollos en el inventario.')}
      </div>
      <div class="panel"><h2>Mejores clientes</h2>
        ${tabla(['Cliente', '$Total gastado'], t.mejores_clientes.map((c) => `<tr class="fila-link" data-ir="#/contacto/${c.id}"><td>${esc(c.nombre)}</td><td class="num">${dinero(c.total)}</td></tr>`), 'Aún no hay ventas registradas.')}
      </div>
    </div>`;
}

// -------------------------------------------------------------- contactos
const filtroContactos = { tipo: '', q: '' };

function camposContacto(c = {}) {
  return `
    <label class="ancho">Nombre *<input name="nombre" required value="${esc(c.nombre)}"></label>
    <label>Categoría<select name="tipo">${opciones([['prospecto', 'Prospecto'], ['cliente', 'Cliente']], c.tipo)}</select></label>
    <label>Teléfono<input name="telefono" value="${esc(c.telefono)}"></label>
    <label>Correo<input name="email" type="email" value="${esc(c.email)}"></label>
    <label>Empresa<input name="empresa" value="${esc(c.empresa)}"></label>
    <label>¿Cómo nos conoció?<input name="origen" value="${esc(c.origen)}"></label>
    <label>Fecha de nacimiento<input name="fecha_nacimiento" type="date" value="${esc(c.fecha_nacimiento)}"></label>
    <label class="ancho">Notas<textarea name="notas">${esc(c.notas)}</textarea></label>`;
}

async function contactos() {
  vista.innerHTML = `
    <div class="barra"><h1>Contactos</h1><span class="espacio"></span>
      <input id="buscar" type="search" placeholder="Buscar nombre, teléfono, correo…" value="${esc(filtroContactos.q)}">
      <select id="filtro-tipo">${opciones([['', 'Todos'], ['prospecto', 'Prospectos'], ['cliente', 'Clientes']], filtroContactos.tipo)}</select>
      <button class="primario" data-act="nuevoContacto">+ Nuevo contacto</button></div>
    <div class="panel" id="lista"></div>`;
  const cargar = async () => {
    const lista = await api(`/clientes?tipo=${filtroContactos.tipo}&q=${encodeURIComponent(filtroContactos.q)}`);
    $('#lista').innerHTML = tabla(
      ['Nombre', 'Categoría', 'Teléfono', 'Correo', 'Cotizaciones', 'En taller', '$Total gastado'],
      lista.map((c) => `<tr class="fila-link" data-ir="#/contacto/${c.id}">
        <td><strong>${esc(c.nombre)}</strong>${c.empresa ? `<br><span class="tenue">${esc(c.empresa)}</span>` : ''}</td>
        <td>${chip(c.tipo)}</td><td>${esc(c.telefono)}</td><td>${esc(c.email)}</td>
        <td>${c.num_cotizaciones}</td><td>${c.equipos_activos}</td><td class="num">${dinero(c.total_gastado)}</td></tr>`),
      'No hay contactos con ese filtro.');
  };
  $('#buscar').oninput = (ev) => { filtroContactos.q = ev.target.value; cargar().catch((e) => aviso(e.message, true)); };
  $('#filtro-tipo').onchange = (ev) => { filtroContactos.tipo = ev.target.value; cargar().catch((e) => aviso(e.message, true)); };
  await cargar();
}

async function contacto(id) {
  const c = await api(`/clientes/${id}`);
  const activos = c.equipos.filter((e) => !['entregado', 'cancelado'].includes(e.estado)).length;
  vista.innerHTML = `
    <div class="barra"><h1>${esc(c.nombre)}</h1>${chip(c.tipo)}<span class="espacio"></span>
      <button data-act="editarContacto" data-id="${c.id}">Editar</button>
      <button class="peligro" data-act="borrarContacto" data-id="${c.id}">Borrar</button></div>
    <div class="rejilla">
      <div class="kpi"><div class="valor">${dinero(c.total_gastado)}</div><div class="etq">Total gastado en el taller</div></div>
      <div class="kpi"><div class="valor">${c.ventas.length}</div><div class="etq">Servicios / productos adquiridos</div></div>
      <div class="kpi"><div class="valor">${c.cotizaciones.length}</div><div class="etq">Cotizaciones</div></div>
      <div class="kpi"><div class="valor">${activos}</div><div class="etq">Equipos en taller</div></div>
    </div>
    <div class="panel"><h2>Datos de contacto</h2>
      <div class="campos">
        <div><span class="tenue">Teléfono</span><br>${esc(c.telefono) || '—'}</div>
        <div><span class="tenue">Correo</span><br>${esc(c.email) || '—'}</div>
        <div><span class="tenue">Empresa</span><br>${esc(c.empresa) || '—'}</div>
        <div><span class="tenue">Origen</span><br>${esc(c.origen) || '—'}</div>
        <div><span class="tenue">Fecha de nacimiento</span><br>${c.fecha_nacimiento ? fecha(c.fecha_nacimiento) : '—'}</div>
        <div><span class="tenue">Alta</span><br>${fecha(c.creado)}</div>
      </div>
      ${c.notas ? `<p style="white-space:pre-wrap;margin-bottom:0">${esc(c.notas)}</p>` : ''}
    </div>
    <div class="panel"><h2>Recordatorios de seguimiento</h2>
      <form id="form-recordatorio" class="barra">
        <input name="texto" required placeholder="Tarea: llamar para confirmar, enviar cotización…" style="flex:1;min-width:200px">
        <input name="fecha" type="date" required value="${hoyIso()}" title="Fecha del recordatorio">
        <button class="primario">Agregar recordatorio</button></form>
      ${tabla(['Fecha', 'Tarea', ''], c.recordatorios.map((r) => `<tr>
        <td class="${r.hecho ? 'hecho' : (r.fecha < hoyIso() ? 'vencido' : '')}">${fecha(r.fecha)}</td>
        <td class="${r.hecho ? 'hecho' : ''}">${esc(r.texto)}</td>
        <td class="num"><button class="mini" data-act="recordatorioHecho" data-id="${r.id}" data-hecho="${r.hecho ? '' : '1'}">${r.hecho ? 'Reabrir' : '✓ Hecho'}</button>
          <button class="mini peligro" data-act="borrarRecordatorio" data-id="${r.id}">✕</button></td></tr>`),
      'Sin recordatorios.')}
    </div>
    <div class="panel"><div class="barra"><h2>Historial de servicios y productos</h2><span class="espacio"></span>
      <button data-act="nuevaVenta" data-id="${c.id}">+ Venta directa</button></div>
      ${tabla(['Fecha', 'Tipo', 'Descripción', 'Origen', '$Monto', ''], c.ventas.map((v) => `<tr>
        <td>${fecha(v.fecha)}</td><td>${esc(categoria(v.categoria))}</td><td>${esc(v.descripcion)}</td>
        <td>${v.cotizacion_id ? `<a href="#/cotizacion/${v.cotizacion_id}">COT-${String(v.cotizacion_id).padStart(4, '0')}</a>` : 'Venta directa'}</td>
        <td class="num">${dinero(v.monto)}</td>
        <td class="num"><button class="mini peligro" title="Borrar venta" data-act="borrarVenta" data-id="${v.id}">✕</button></td></tr>`),
      'Todavía no ha adquirido servicios ni productos.')}
    </div>
    <div class="panel"><div class="barra"><h2>Historial de cotizaciones</h2><span class="espacio"></span>
      <a class="btn" href="#/cotizador/nueva/${c.id}">+ Nueva cotización</a></div>
      ${tabla(['Folio', 'Fecha', 'Concepto', 'Estado', '$Total'], c.cotizaciones.map((q) => `<tr class="fila-link" data-ir="#/cotizacion/${q.id}">
        <td>${esc(q.folio)}</td><td>${fecha(q.creado)}</td><td>${esc(q.resumen)}</td><td>${chip(q.estado)}</td><td class="num">${dinero(q.total)}</td></tr>`),
      'Sin cotizaciones.')}
    </div>
    <div class="panel"><div class="barra"><h2>Equipos</h2><span class="espacio"></span>
      <button data-act="nuevoEquipo" data-cliente="${c.id}">+ Ingresar equipo</button></div>
      ${tabla(['Orden', 'Ingreso', 'Equipo', 'Falla', 'Estado'], c.equipos.map((e) => `<tr class="fila-link" data-ir="#/equipo/${e.id}">
        <td>${esc(e.folio)}</td><td>${fecha(e.creado)}</td><td>${esc([e.tipo_equipo, e.marca, e.modelo].filter(Boolean).join(' '))}</td>
        <td>${esc(e.falla)}</td><td>${chip(e.estado)}</td></tr>`),
      'Sin equipos registrados.')}
    </div>
    <div class="panel"><h2>Comentarios</h2>
      <form id="form-comentario" class="barra"><textarea name="texto" required placeholder="Agregar comentario…" style="flex:1;min-height:42px"></textarea>
        <button class="primario">Agregar</button></form>
      ${c.comentarios.map((m) => `<div class="comentario"><div class="meta"><span>${fechaHora(m.creado)}</span>
        <button class="mini peligro" data-act="borrarComentario" data-id="${m.id}">✕</button></div>${esc(m.texto)}</div>`).join('')
        || '<div class="vacio">Sin comentarios.</div>'}
    </div>`;
  $('#form-recordatorio').onsubmit = (ev) => {
    ev.preventDefault();
    intentar(async () => {
      await api(`/clientes/${id}/recordatorios`, 'POST', Object.fromEntries(new FormData(ev.target)));
      await navegar();
    });
  };
  $('#form-comentario').onsubmit = (ev) => {
    ev.preventDefault();
    intentar(async () => {
      await api(`/clientes/${id}/comentarios`, 'POST', { texto: ev.target.texto.value });
      await navegar();
    });
  };
}

// --------------------------------------------------------------- cotizador
let Q = null; // cotización en edición
let pestana = 'servicio';
let catalogoPiezas = [];
let rollos = [];

const SERVICIOS = [['reparacion', 'Reparación electrónica'], ['diagnostico', 'Diagnóstico electrónico'],
  ['mantenimiento', 'Mantenimiento (laptop / PC / consola)'], ['modelado3d', 'Modelado 3D']];
const PRIORIDAD = [['normal', 'Normal'], ['urgente', 'Urgente']];

/** Precio de un servicio: mano de obra + refacciones con margen + recargo de urgencia. */
function calcularServicio(f, cfg) {
  const manoObra = num(f.horas) * num(f.tarifa);
  const refacciones = num(f.refacciones) * (1 + num(f.margen) / 100);
  const base = manoObra + refacciones;
  const urgencia = f.prioridad === 'urgente' ? base * cfg.recargo_urgencia_pct / 100 : 0;
  return { manoObra, refacciones, urgencia, precio: r2(base + urgencia) };
}

/** Precio por pieza impresa: material + máquina + energía, merma, post-proceso, margen y urgencia. */
function calcularImpresion(f, cfg) {
  const cantidad = Math.max(1, Math.round(num(f.cantidad)));
  const rollo = rollos.find((r) => String(r.id) === f.rollo_id);
  // Con rollo del inventario se usa su costo real por gramo; sin rollo, el precio de Configuración.
  const precioGramo = rollo ? rollo.costo_gramo : (cfg.materiales[f.material] || 0);
  const material = num(f.peso) * precioGramo;
  const maquina = num(f.horas) * cfg.costo_maquina_hora;
  const energia = num(f.horas) * cfg.costo_energia_hora;
  const merma = (material + maquina + energia) * cfg.tasa_fallos_pct / 100;
  const postproceso = num(f.postproceso) * cfg.tarifa_postproceso_hora;
  const costo = material + maquina + energia + merma + postproceso;
  const margen = costo * num(f.margen) / 100;
  const urgencia = f.prioridad === 'urgente' ? (costo + margen) * cfg.recargo_urgencia_pct / 100 : 0;
  let precio = r2(costo + margen + urgencia);
  const minimoAplicado = precio > 0 && precio * cantidad < cfg.minimo_3d;
  if (minimoAplicado) precio = r2(cfg.minimo_3d / cantidad);
  return { cantidad, rollo, precioGramo, material, maquina, energia, merma, postproceso, margen, urgencia, precio, minimoAplicado };
}

const lineas = (pares) => `<table>${pares.map(([texto, valor, fuerte]) =>
  `<tr class="${fuerte ? 'fuerte' : ''}"><td>${esc(texto)}</td><td class="num">${dinero(valor)}</td></tr>`).join('')}</table>`;

function htmlCalculadora(cfg) {
  if (pestana === 'servicio') {
    return `<form id="calc" class="campos">
      <label class="ancho">Servicio<select name="tipo">${opciones(SERVICIOS)}</select></label>
      <label class="ancho">Descripción del trabajo *<input name="descripcion" required placeholder="Ej. Cambio de puerto de carga, laptop HP"></label>
      <label>Horas de mano de obra<input name="horas" type="number" min="0" step="0.25" value="1"></label>
      <label>Tarifa por hora ($)<input name="tarifa" type="number" min="0" step="0.01" value="${cfg.tarifa_reparacion}"></label>
      <label>Costo de refacciones ($)<input name="refacciones" type="number" min="0" step="0.01" value="0"></label>
      <label>Margen en refacciones (%)<input name="margen" type="number" min="0" step="1" value="${cfg.margen_refacciones_pct}"></label>
      <label>Prioridad (urgente +${cfg.recargo_urgencia_pct}%)<select name="prioridad">${opciones(PRIORIDAD)}</select></label>
      <div class="resultado ancho" id="desglose"></div>
      <div class="ancho"><button class="primario">Agregar a la cotización</button></div></form>`;
  }
  if (pestana === 'impresion3d') {
    return `<form id="calc" class="campos">
      <label class="ancho">Descripción de la pieza *<input name="descripcion" required placeholder="Ej. Carcasa para sensor"></label>
      <label class="ancho">Rollo del inventario<select name="rollo_id">${opciones([['', '— Sin rollo (no descuenta inventario) —'],
        ...rollos.map((r) => [r.id, `${nombreRollo(r)} · quedan ${gramos(r.restante)} · ${dinero(r.costo_gramo)}/g`])])}</select></label>
      <label id="campo-material">Material<select name="material">${opciones(Object.entries(cfg.materiales).map(([m, p]) => [m, `${m} (${dinero(p)}/g)`]))}</select></label>
      <label>Peso por pieza (g)<input name="peso" type="number" min="0" step="0.1" value="50"></label>
      <label>Horas de impresión por pieza<input name="horas" type="number" min="0" step="0.1" value="3"></label>
      <label>Horas de post-proceso por pieza<input name="postproceso" type="number" min="0" step="0.05" value="0.25"></label>
      <label>Cantidad de piezas<input name="cantidad" type="number" min="1" step="1" value="1"></label>
      <label>Margen de ganancia (%)<input name="margen" type="number" min="0" step="1" value="${cfg.margen_3d_pct}"></label>
      <label>Prioridad (urgente +${cfg.recargo_urgencia_pct}%)<select name="prioridad">${opciones(PRIORIDAD)}</select></label>
      <div class="resultado ancho" id="desglose"></div>
      <div class="ancho"><button class="primario">Agregar a la cotización</button></div></form>`;
  }
  return `<form id="calc" class="campos">
    <label class="ancho">Pieza del catálogo<select name="producto">${opciones([['', '— Captura libre —'],
      ...catalogoPiezas.map((p) => [p.id, `${p.nombre} · ${dinero(p.precio)} · existencia ${p.stock}`])])}</select></label>
    <label class="ancho">Descripción *<input name="descripcion" required></label>
    <label>Precio unitario ($)<input name="precio" type="number" min="0" step="0.01" value="0"></label>
    <label>Cantidad<input name="cantidad" type="number" min="1" step="1" value="1"></label>
    <div class="resultado ancho" id="desglose"></div>
    <div class="ancho"><button class="primario">Agregar a la cotización</button></div></form>`;
}

function montarCalculadora(cfg) {
  $('#calculadora').innerHTML = htmlCalculadora(cfg);
  const form = $('#calc');
  const leer = () => Object.fromEntries(new FormData(form));
  const actualizar = () => {
    const f = leer();
    let html;
    if (pestana === 'servicio') {
      const c = calcularServicio(f, cfg);
      html = lineas([['Mano de obra', c.manoObra], ['Refacciones (con margen)', c.refacciones],
        ['Recargo por urgencia', c.urgencia], ['Precio del servicio', c.precio, true]]);
    } else if (pestana === 'impresion3d') {
      const c = calcularImpresion(f, cfg);
      $('#campo-material').style.display = c.rollo ? 'none' : '';
      const necesario = num(f.peso) * c.cantidad;
      html = (c.rollo && necesario > c.rollo.restante
        ? `<div class="vencido">El rollo no alcanza: se necesitan ${gramos(necesario)} y quedan ${gramos(c.rollo.restante)}.</div>` : '')
        + lineas([[`Material (${dinero(c.precioGramo)}/g)`, c.material], ['Uso de máquina', c.maquina], ['Energía', c.energia],
        [`Merma por fallos (${cfg.tasa_fallos_pct}%)`, c.merma], ['Post-proceso', c.postproceso],
        [`Margen (${num(f.margen)}%)`, c.margen], ['Recargo por urgencia', c.urgencia],
        ['Precio por pieza', c.precio, true], [`Importe (${c.cantidad} pza)`, r2(c.precio * c.cantidad), true]])
        + (c.minimoAplicado ? `<div class="tenue">Se aplicó el cobro mínimo de ${dinero(cfg.minimo_3d)}.</div>` : '');
    } else {
      html = lineas([['Importe', r2(num(f.precio) * Math.max(1, num(f.cantidad))), true]]);
    }
    $('#desglose').innerHTML = html;
  };
  form.oninput = actualizar;
  if (pestana === 'servicio') {
    form.tipo.onchange = () => { form.tarifa.value = cfg[`tarifa_${form.tipo.value}`]; actualizar(); };
  }
  if (pestana === 'pieza') {
    form.producto.onchange = () => {
      const p = catalogoPiezas.find((x) => String(x.id) === form.producto.value);
      if (p) { form.descripcion.value = p.nombre; form.precio.value = p.precio; }
      actualizar();
    };
  }
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const f = leer();
    let partida;
    if (pestana === 'servicio') {
      const c = calcularServicio(f, cfg);
      partida = { categoria: f.tipo, descripcion: `${categoria(f.tipo)}: ${f.descripcion.trim()}`, cantidad: 1, precio_unitario: c.precio, detalle: f };
    } else if (pestana === 'impresion3d') {
      const c = calcularImpresion(f, cfg);
      const material = c.rollo ? nombreRollo(c.rollo) : f.material;
      partida = { categoria: 'impresion3d', descripcion: `Impresión 3D (${material}): ${f.descripcion.trim()}`, cantidad: c.cantidad, precio_unitario: c.precio,
        detalle: { ...f, rollo_id: c.rollo ? c.rollo.id : null } };
    } else {
      partida = { categoria: 'pieza', descripcion: f.descripcion.trim(), cantidad: Math.max(1, num(f.cantidad)), precio_unitario: r2(num(f.precio)),
        detalle: f.producto ? { producto_id: Number(f.producto) } : {} };
    }
    if (partida.precio_unitario <= 0) return aviso('El precio de la partida debe ser mayor a cero.', true);
    Q.partidas.push(partida);
    pintarPartidas();
    form.descripcion.value = '';
    form.descripcion.focus();
  };
  actualizar();
}

function pintarPartidas() {
  const subtotal = r2(Q.partidas.reduce((s, p) => s + r2(p.cantidad * p.precio_unitario), 0));
  const descuento = r2(subtotal * Math.min(num(Q.descuento_pct), 100) / 100);
  const iva = r2((subtotal - descuento) * Q.iva_pct / 100);
  $('#partidas').innerHTML = tabla(['Concepto', '$Cant.', '$P. unitario', '$Importe', ''],
    Q.partidas.map((p, i) => `<tr><td>${esc(p.descripcion)}<br><span class="tenue">${esc(categoria(p.categoria))}</span></td>
      <td class="num">${p.cantidad}</td><td class="num">${dinero(p.precio_unitario)}</td><td class="num">${dinero(p.cantidad * p.precio_unitario)}</td>
      <td class="num"><button type="button" class="mini peligro" data-act="quitarPartida" data-i="${i}">✕</button></td></tr>`),
    'Agrega partidas con la calculadora de la izquierda.')
    + `<table class="totales"><tr><td>Subtotal</td><td class="num">${dinero(subtotal)}</td></tr>
      <tr><td>Descuento</td><td class="num">−${dinero(descuento)}</td></tr>
      <tr><td>IVA (${Q.iva_pct}%)</td><td class="num">${dinero(iva)}</td></tr>
      <tr class="total"><td>Total</td><td class="num">${dinero(subtotal - descuento + iva)}</td></tr></table>`;
}

async function cotizador(id, clienteId) {
  const [clientes, piezas, inventario] = await Promise.all([api('/clientes'), api('/productos'), api('/rollos')]);
  catalogoPiezas = piezas;
  rollos = inventario;
  const cfg = META.config;
  if (id && id !== 'nueva') {
    const q = await api(`/cotizaciones/${id}`);
    if (q.estado === 'pagada') { location.hash = `#/cotizacion/${id}`; return; }
    Q = { id: q.id, folio: q.folio, cliente_id: q.cliente_id, partidas: q.partidas, descuento_pct: q.descuento_pct, iva_pct: q.iva_pct, notas: q.notas };
  } else {
    Q = { id: null, cliente_id: clienteId || '', partidas: [], descuento_pct: 0, iva_pct: cfg.iva_pct, notas: '' };
  }
  vista.innerHTML = `
    <h1>${Q.id ? `Editar ${esc(Q.folio)}` : 'Nueva cotización'}</h1>
    <div class="dos">
      <div class="panel"><h2>Calculadora</h2>
        <div class="pestanas">${[['servicio', 'Servicio'], ['impresion3d', 'Impresión 3D'], ['pieza', 'Pieza estandarizada']]
          .map(([k, t]) => `<button type="button" class="${k === pestana ? 'activo' : ''}" data-act="pestana" data-k="${k}">${t}</button>`).join('')}</div>
        <div id="calculadora"></div>
        <p class="tenue" style="margin-bottom:0;font-size:13px">Las tarifas, márgenes y materiales se ajustan en <a href="#/config">Configuración</a>.</p>
      </div>
      <div class="panel"><h2>Cotización</h2>
        <label>Contacto *<select id="q-cliente">${opciones([['', '— Selecciona —'], ...clientes.map((c) => [c.id, `${c.nombre} (${etq(c.tipo)})`])], Q.cliente_id)}</select></label>
        <div id="partidas"></div>
        <div class="campos" style="margin-top:12px">
          <label>Descuento (%)<input id="q-descuento" type="number" min="0" max="100" step="1" value="${esc(Q.descuento_pct)}"></label>
          <label class="ancho">Notas / condiciones<textarea id="q-notas">${esc(Q.notas)}</textarea></label>
        </div>
        <button class="primario" data-act="guardarCotizacion">Guardar cotización</button>
      </div>
    </div>`;
  $('#q-cliente').onchange = (ev) => { Q.cliente_id = ev.target.value; };
  $('#q-notas').oninput = (ev) => { Q.notas = ev.target.value; };
  $('#q-descuento').oninput = (ev) => { Q.descuento_pct = ev.target.value; pintarPartidas(); };
  montarCalculadora(cfg);
  pintarPartidas();
}

async function cotizaciones() {
  const lista = await api('/cotizaciones');
  vista.innerHTML = `
    <div class="barra"><h1>Cotizaciones</h1><span class="espacio"></span>
      <a class="btn primario" href="#/cotizador">+ Nueva cotización</a></div>
    <div class="panel">${tabla(['Folio', 'Fecha', 'Contacto', 'Concepto', 'Estado', '$Total'],
      lista.map((q) => `<tr class="fila-link" data-ir="#/cotizacion/${q.id}"><td>${esc(q.folio)}</td><td>${fecha(q.creado)}</td>
        <td>${esc(q.cliente_nombre)}</td><td>${esc(q.resumen)}</td><td>${chip(q.estado)}</td><td class="num">${dinero(q.total)}</td></tr>`),
      'Aún no hay cotizaciones.')}</div>`;
}

async function cotizacion(id) {
  const q = await api(`/cotizaciones/${id}`);
  const cfg = META.config;
  const pagada = q.estado === 'pagada';
  const vigencia = new Date(q.creado);
  vigencia.setDate(vigencia.getDate() + cfg.vigencia_dias);
  vista.innerHTML = `
    <div class="barra no-imprimir"><h1>${esc(q.folio)}</h1>${chip(q.estado)}<span class="espacio"></span>
      ${pagada ? '' : `<a class="btn" href="#/cotizador/${q.id}">Editar</a>
        ${['enviada', 'aceptada', 'rechazada'].filter((e) => e !== q.estado).map((e) =>
          `<button data-act="estadoCotizacion" data-id="${q.id}" data-estado="${e}">Marcar ${etq(e).toLowerCase()}</button>`).join('')}
        <button class="primario" data-act="cobrarCotizacion" data-id="${q.id}">Registrar pago</button>`}
      <button data-act="nuevoEquipo" data-cliente="${q.cliente_id}" data-cotizacion="${q.id}">Ingresar equipo</button>
      <button data-act="imprimir">Imprimir / PDF</button>
      ${pagada ? '' : `<button class="peligro" data-act="borrarCotizacion" data-id="${q.id}">Borrar</button>`}</div>
    <div class="panel">
      <div class="barra"><div><h2 style="font-size:20px;margin:0">${esc(cfg.negocio_nombre)}</h2>
        <span class="tenue">${esc([cfg.negocio_direccion, cfg.negocio_telefono].filter(Boolean).join(' · '))}</span></div>
        <span class="espacio"></span>
        <div class="derecha"><strong>Cotización ${esc(q.folio)}</strong><br>
          <span class="tenue">Fecha: ${fecha(q.creado)}<br>Vigencia: ${fecha(vigencia.toISOString())}</span></div></div>
      <p><span class="tenue">Para:</span> <a href="#/contacto/${q.cliente_id}"><strong>${esc(q.cliente_nombre)}</strong></a>
        ${esc([q.cliente_empresa, q.cliente_telefono, q.cliente_email].filter(Boolean).map((x) => ' · ' + x).join(''))}</p>
      ${tabla(['Concepto', '$Cant.', '$P. unitario', '$Importe'], q.partidas.map((p) => `<tr><td>${esc(p.descripcion)}</td>
        <td class="num">${p.cantidad}</td><td class="num">${dinero(p.precio_unitario)}</td><td class="num">${dinero(p.importe)}</td></tr>`), '')}
      <table class="totales"><tr><td>Subtotal</td><td class="num">${dinero(q.subtotal)}</td></tr>
        ${q.descuento ? `<tr><td>Descuento (${q.descuento_pct}%)</td><td class="num">−${dinero(q.descuento)}</td></tr>` : ''}
        <tr><td>IVA (${q.iva_pct}%)</td><td class="num">${dinero(q.iva)}</td></tr>
        <tr class="total"><td>Total</td><td class="num">${dinero(q.total)}</td></tr></table>
      ${q.notas ? `<p style="white-space:pre-wrap"><span class="tenue">Notas:</span><br>${esc(q.notas)}</p>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ taller
let verCerrados = false;

async function taller() {
  const equipos = await api(`/equipos${verCerrados ? '' : '?activos=1'}`);
  const hoy = new Date().toISOString().slice(0, 10);
  const estados = META.estados_equipo.filter((e) => verCerrados || !['entregado', 'cancelado'].includes(e));
  vista.innerHTML = `
    <div class="barra"><h1>Taller</h1><span class="espacio"></span>
      <label style="margin:0"><input type="checkbox" id="ver-cerrados" style="width:auto" ${verCerrados ? 'checked' : ''}> Mostrar entregados y cancelados</label>
      <button class="primario" data-act="nuevoEquipo">+ Ingresar equipo</button></div>
    <div class="kanban">${estados.map((estado) => {
      const grupo = equipos.filter((e) => e.estado === estado);
      return `<div class="columna"><h2>${esc(etq(estado))} · ${grupo.length}</h2>${grupo.map((e) => `
        <a class="tarjeta" href="#/equipo/${e.id}"><strong>${esc(e.folio)}</strong> · ${esc(e.tipo_equipo)}<br>
          ${esc([e.marca, e.modelo].filter(Boolean).join(' '))}<br><span class="tenue">${esc(e.cliente_nombre)}</span>
          ${e.fecha_promesa ? `<br><span class="${e.fecha_promesa < hoy && !['entregado', 'cancelado', 'listo'].includes(e.estado) ? 'vencido' : 'tenue'}">Promesa: ${fecha(e.fecha_promesa)}</span>` : ''}</a>`).join('')}</div>`;
    }).join('')}</div>`;
  $('#ver-cerrados').onchange = (ev) => { verCerrados = ev.target.checked; navegar(); };
}

function camposEquipo(e, clientes) {
  return `
    <label class="ancho">Contacto *<select name="cliente_id" required ${e.id ? 'disabled' : ''}>${opciones([['', '— Selecciona —'], ...clientes.map((c) => [c.id, c.nombre])], e.cliente_id)}</select></label>
    <label>Tipo de equipo<select name="tipo_equipo">${opciones(TIPOS_EQUIPO.map((t) => [t, t]), e.tipo_equipo)}</select></label>
    <label>Marca<input name="marca" value="${esc(e.marca)}"></label>
    <label>Modelo<input name="modelo" value="${esc(e.modelo)}"></label>
    <label>No. de serie<input name="serie" value="${esc(e.serie)}"></label>
    <label>Técnico asignado<input name="tecnico" value="${esc(e.tecnico)}"></label>
    <label>Fecha promesa<input name="fecha_promesa" type="date" value="${esc(e.fecha_promesa)}"></label>
    <label class="ancho">Falla reportada<textarea name="falla">${esc(e.falla)}</textarea></label>
    <label class="ancho">Accesorios que entrega<input name="accesorios" value="${esc(e.accesorios)}" placeholder="Cargador, cables, controles…"></label>
    ${e.id ? `<label class="ancho">Diagnóstico técnico<textarea name="diagnostico">${esc(e.diagnostico)}</textarea></label>` : ''}`;
}

async function equipo(id) {
  const e = await api(`/equipos/${id}`);
  const dato = (titulo, valor) => `<div><span class="tenue">${titulo}</span><br>${esc(valor) || '—'}</div>`;
  vista.innerHTML = `
    <div class="barra"><h1>${esc(e.folio)} · ${esc([e.tipo_equipo, e.marca, e.modelo].filter(Boolean).join(' '))}</h1>${chip(e.estado)}
      <span class="espacio"></span><button data-act="editarEquipo" data-id="${e.id}">Editar datos</button></div>
    <div class="dos">
      <div class="panel"><h2>Datos del equipo</h2><div class="campos">
        <div><span class="tenue">Cliente</span><br><a href="#/contacto/${e.cliente_id}">${esc(e.cliente_nombre)}</a> ${esc(e.cliente_telefono)}</div>
        ${dato('No. de serie', e.serie)}${dato('Técnico', e.tecnico)}
        ${dato('Ingreso', fecha(e.creado))}${dato('Fecha promesa', e.fecha_promesa ? fecha(e.fecha_promesa) : '')}
        ${dato('Entregado', e.entregado_en ? fecha(e.entregado_en) : '')}
        <div><span class="tenue">Cotización</span><br>${e.cotizacion_id ? `<a href="#/cotizacion/${e.cotizacion_id}">COT-${String(e.cotizacion_id).padStart(4, '0')}</a>` : '—'}</div>
        <div class="ancho" style="margin-top:10px">${dato('Falla reportada', e.falla)}</div>
        <div class="ancho" style="margin-top:10px">${dato('Accesorios', e.accesorios)}</div>
        <div class="ancho" style="margin-top:10px">${dato('Diagnóstico técnico', e.diagnostico)}</div>
      </div></div>
      <div class="panel"><h2>Seguimiento</h2>
        <form id="form-estado" class="campos">
          <label>Nuevo estado<select name="estado">${opciones(META.estados_equipo.map((s) => [s, etq(s)]), e.estado)}</select></label>
          <label class="ancho">Nota<input name="nota" placeholder="Ej. Se pidió la refacción, llega el viernes"></label>
          <div class="ancho" style="margin-bottom:14px"><button class="primario">Registrar avance</button></div>
        </form>
        <ul class="bitacora">${e.eventos.map((ev) => `<li>${chip(ev.estado)} <span class="tenue">${fechaHora(ev.creado)}</span>
          ${ev.nota ? `<br>${esc(ev.nota)}` : ''}</li>`).join('')}</ul>
      </div>
    </div>`;
  $('#form-estado').onsubmit = (ev) => {
    ev.preventDefault();
    intentar(async () => {
      await api(`/equipos/${id}/estado`, 'POST', Object.fromEntries(new FormData(ev.target)));
      await navegar();
    }, 'Avance registrado');
  };
}

// ---------------------------------------------------------------- catálogo
const camposProducto = (p = {}) => `
  <label class="ancho">Nombre *<input name="nombre" required value="${esc(p.nombre)}"></label>
  <label>SKU / clave<input name="sku" value="${esc(p.sku)}"></label>
  <label>Precio ($)<input name="precio" type="number" min="0" step="0.01" value="${esc(p.precio ?? 0)}"></label>
  <label>Existencia<input name="stock" type="number" min="0" step="1" value="${esc(p.stock ?? 0)}"></label>
  <label>Filamento por pieza (g)<input name="gramos_pieza" type="number" min="0" step="0.1" value="${esc(p.gramos_pieza ?? 0)}"></label>`;

async function catalogo() {
  catalogoPiezas = await api('/productos');
  vista.innerHTML = `
    <div class="barra"><h1>Catálogo de piezas estandarizadas</h1><span class="espacio"></span>
      <button class="primario" data-act="nuevoProducto">+ Nueva pieza</button></div>
    <div class="panel">${tabla(['SKU', 'Nombre', '$Precio', '$Existencia', ''], catalogoPiezas.map((p) => `<tr>
      <td>${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td class="num">${dinero(p.precio)}</td><td class="num">${p.stock}</td>
      <td class="num"><button class="mini" data-act="fabricarProducto" data-id="${p.id}">Fabricar stock</button>
        <button class="mini" data-act="editarProducto" data-id="${p.id}">Editar</button>
        <button class="mini peligro" data-act="borrarProducto" data-id="${p.id}">✕</button></td></tr>`),
    'El catálogo está vacío.')}</div>`;
}

// -------------------------------------------------------------- inventario
function camposRollo(r = {}) {
  const materiales = Object.keys(META.config.materiales);
  if (r.material && !materiales.includes(r.material)) materiales.push(r.material);
  return `
    <label>Material<select name="material">${opciones(materiales.map((m) => [m, m]), r.material)}</select></label>
    <label>Color<input name="color" value="${esc(r.color)}"></label>
    <label>Marca<input name="marca" value="${esc(r.marca)}"></label>
    <label>Cantidad de material (g) *<input name="peso_inicial" type="number" min="1" step="1" required value="${esc(r.peso_inicial ?? 1000)}"></label>
    <label>Costo del rollo ($) *<input name="costo" type="number" min="0" step="0.01" required value="${esc(r.costo ?? '')}"></label>
    <label>Fecha de adquisición<input name="fecha_adquisicion" type="date" value="${esc(r.fecha_adquisicion || hoyIso())}"></label>
    ${r.id ? `<label>Material restante (g)<input name="restante" type="number" step="0.1" value="${esc(r.restante)}"></label>` : ''}
    <label class="ancho">Notas<input name="notas" value="${esc(r.notas)}"></label>`;
}

async function inventario() {
  const [lista, movimientos] = await Promise.all([api('/rollos'), api('/material/movimientos')]);
  rollos = lista;
  const medidor = (r) => {
    const pct = Math.max(0, Math.min(100, r.restante / r.peso_inicial * 100));
    return `<div class="medidor ${r.restante <= 0 ? 'agotado' : (pct < 15 ? 'bajo' : '')}"><div style="width:${pct}%"></div></div>`;
  };
  vista.innerHTML = `
    <div class="barra"><h1>Inventario de filamento</h1><span class="espacio"></span>
      <button class="primario" data-act="nuevoRollo">+ Nuevo rollo</button></div>
    <div class="panel">${tabla(['Rollo', 'Adquisición', '$Costo', '$Costo por gramo', '$Inicial', '$Restante', ''], lista.map((r) => `<tr>
      <td><strong>${esc(nombreRollo(r))}</strong>${r.notas ? `<br><span class="tenue">${esc(r.notas)}</span>` : ''}</td>
      <td>${fecha(r.fecha_adquisicion)}</td><td class="num">${dinero(r.costo)}</td><td class="num">${dinero(r.costo_gramo)}</td>
      <td class="num">${gramos(r.peso_inicial)}</td>
      <td class="num ${r.restante <= 0 ? 'vencido' : ''}">${r.restante < 0 ? `Faltan ${gramos(-r.restante)}` : gramos(r.restante)}${medidor(r)}</td>
      <td class="num"><button class="mini" data-act="falloRollo" data-id="${r.id}">Registrar fallo</button>
        <button class="mini" data-act="editarRollo" data-id="${r.id}">Editar</button>
        <button class="mini peligro" data-act="borrarRollo" data-id="${r.id}">✕</button></td></tr>`),
    'Aún no hay rollos. Agrega el primero con «+ Nuevo rollo».')}</div>
    <div class="panel"><h2>Movimientos de material</h2>
      ${tabla(['Fecha', 'Rollo', 'Motivo', 'Detalle', '$Material'], movimientos.map((m) => `<tr>
        <td>${fechaHora(m.creado)}</td><td>${esc([m.material, m.color].filter(Boolean).join(' '))}</td><td>${esc(m.tipo_nombre)}</td>
        <td>${m.cotizacion_id ? `<a href="#/cotizacion/${m.cotizacion_id}">${esc(m.nota)}</a>` : esc(m.nota)}</td>
        <td class="num">${m.gramos > 0 ? '−' : '+'}${gramos(Math.abs(m.gramos))}</td></tr>`),
      'Sin movimientos todavía.')}</div>`;
}

// ----------------------------------------------------------- configuración
const CAMPOS_CONFIG = [
  ['Negocio', [['negocio_nombre', 'Nombre del negocio', 'text'], ['negocio_telefono', 'Teléfono', 'text'],
    ['negocio_direccion', 'Dirección', 'text'], ['vigencia_dias', 'Vigencia de cotizaciones (días)'], ['iva_pct', 'IVA (%)']]],
  ['Cotizador de servicios', [['tarifa_reparacion', 'Tarifa/hora reparación ($)'], ['tarifa_diagnostico', 'Tarifa/hora diagnóstico ($)'],
    ['tarifa_mantenimiento', 'Tarifa/hora mantenimiento ($)'], ['tarifa_modelado3d', 'Tarifa/hora modelado 3D ($)'],
    ['margen_refacciones_pct', 'Margen en refacciones (%)'], ['recargo_urgencia_pct', 'Recargo por urgencia (%)']]],
  ['Cotizador de impresión 3D', [['costo_maquina_hora', 'Uso de máquina por hora ($)'], ['costo_energia_hora', 'Energía por hora ($)'],
    ['tarifa_postproceso_hora', 'Tarifa/hora post-proceso ($)'], ['tasa_fallos_pct', 'Merma por fallos (%)'],
    ['margen_3d_pct', 'Margen de ganancia sugerido (%)'], ['minimo_3d', 'Cobro mínimo por trabajo ($)']]],
];

const filaMaterial = (nombre = '', precio = '') => `<div class="barra material" style="margin-bottom:6px">
  <input class="m-nombre" placeholder="Material" value="${esc(nombre)}" style="flex:1">
  <input class="m-precio" type="number" min="0" step="0.01" placeholder="$ por gramo" value="${esc(precio)}" style="width:130px">
  <button type="button" class="mini peligro" data-act="quitarMaterial">✕</button></div>`;

async function config() {
  const cfg = META.config;
  vista.innerHTML = `<h1>Configuración</h1><form id="form-config">
    ${CAMPOS_CONFIG.map(([titulo, campos]) => `<div class="panel"><h2>${titulo}</h2><div class="campos">
      ${campos.map(([clave, etiqueta, tipo]) => `<label>${etiqueta}<input name="${clave}" value="${esc(cfg[clave])}"
        ${tipo === 'text' ? '' : 'type="number" min="0" step="0.01"'}></label>`).join('')}</div></div>`).join('')}
    <div class="panel"><h2>Materiales de impresión 3D (precio por gramo)</h2>
      <div id="materiales">${Object.entries(cfg.materiales).map(([m, p]) => filaMaterial(m, p)).join('')}</div>
      <button type="button" data-act="agregarMaterial">+ Material</button></div>
    <button class="primario">Guardar configuración</button></form>`;
  $('#form-config').onsubmit = (ev) => {
    ev.preventDefault();
    const datos = Object.fromEntries(new FormData(ev.target));
    datos.materiales = {};
    document.querySelectorAll('.material').forEach((f) => {
      const nombre = $('.m-nombre', f).value.trim();
      if (nombre) datos.materiales[nombre] = $('.m-precio', f).value;
    });
    intentar(async () => {
      META.config = await api('/config', 'PUT', datos);
      $('#marca').textContent = META.config.negocio_nombre;
    }, 'Configuración guardada');
  };
}

// ---------------------------------------------------------------- acciones
const confirmar = (texto) => window.confirm(texto);

async function formularioEquipo(e) {
  const clientes = await api('/clientes');
  formulario(e.id ? `Editar ${e.folio}` : 'Ingresar equipo al taller', camposEquipo(e, clientes), async (f) => {
    if (e.id) {
      await api(`/equipos/${e.id}`, 'PUT', f);
      await navegar();
    } else {
      const nuevo = await api('/equipos', 'POST', { ...f, cotizacion_id: e.cotizacion_id });
      location.hash = `#/equipo/${nuevo.id}`;
    }
  });
}

const acciones = {
  cerrar: () => modal.close(),
  imprimir: () => window.print(),

  nuevoContacto: () => formulario('Nuevo contacto', camposContacto(), async (f) => {
    const c = await api('/clientes', 'POST', f);
    location.hash = `#/contacto/${c.id}`;
  }),
  editarContacto: async ({ id }) => {
    const c = await api(`/clientes/${id}`);
    formulario('Editar contacto', camposContacto(c), async (f) => { await api(`/clientes/${id}`, 'PUT', f); await navegar(); });
  },
  borrarContacto: async ({ id }) => {
    if (!confirmar('¿Borrar este contacto?')) return;
    await api(`/clientes/${id}`, 'DELETE');
    location.hash = '#/contactos';
  },
  borrarComentario: async ({ id }) => { await api(`/comentarios/${id}`, 'DELETE'); await navegar(); },

  nuevaVenta: ({ id }) => formulario('Venta directa', `
    <label>Tipo<select name="categoria">${opciones(Object.entries(META.categorias), 'pieza')}</select></label>
    <label>Monto cobrado, IVA incluido ($)<input name="monto" type="number" min="0.01" step="0.01" required></label>
    <label class="ancho">Descripción *<input name="descripcion" required></label>`,
  async (f) => { await api('/ventas', 'POST', { ...f, cliente_id: Number(id) }); await navegar(); }),
  borrarVenta: async ({ id }) => {
    if (!confirmar('¿Borrar esta venta del historial? El total gastado del cliente se reducirá.')) return;
    await api(`/ventas/${id}`, 'DELETE');
    await navegar();
  },

  pestana: ({ k }) => {
    pestana = k;
    document.querySelectorAll('.pestanas button').forEach((b) => b.classList.toggle('activo', b.dataset.k === k));
    montarCalculadora(META.config);
  },
  quitarPartida: ({ i }) => { Q.partidas.splice(Number(i), 1); pintarPartidas(); },
  guardarCotizacion: async () => {
    if (!Q.cliente_id) throw new Error('Selecciona el contacto de la cotización.');
    const cuerpo = { cliente_id: Number(Q.cliente_id), partidas: Q.partidas, descuento_pct: num(Q.descuento_pct), notas: Q.notas };
    const q = Q.id ? await api(`/cotizaciones/${Q.id}`, 'PUT', cuerpo) : await api('/cotizaciones', 'POST', cuerpo);
    aviso(`Cotización ${q.folio} guardada`);
    location.hash = `#/cotizacion/${q.id}`;
  },
  estadoCotizacion: async ({ id, estado }) => {
    await api(`/cotizaciones/${id}/estado`, 'POST', { estado });
    if (estado === 'aceptada') aviso('Cotización autorizada; el filamento se descontó del inventario');
    await navegar();
  },
  cobrarCotizacion: async ({ id }) => {
    if (!confirmar('¿Registrar el pago? Las partidas pasarán al historial del cliente y la cotización ya no podrá editarse.')) return;
    await api(`/cotizaciones/${id}/cobrar`, 'POST', {});
    aviso('Pago registrado en el historial del cliente');
    await navegar();
  },
  borrarCotizacion: async ({ id }) => {
    if (!confirmar('¿Borrar esta cotización?')) return;
    await api(`/cotizaciones/${id}`, 'DELETE');
    location.hash = '#/cotizaciones';
  },

  nuevoEquipo: ({ cliente, cotizacion }) => formularioEquipo({ cliente_id: cliente, cotizacion_id: cotizacion ? Number(cotizacion) : null }),
  editarEquipo: async ({ id }) => formularioEquipo(await api(`/equipos/${id}`)),

  recordatorioHecho: async ({ id, hecho }) => { await api(`/recordatorios/${id}/hecho`, 'POST', { hecho: Boolean(hecho) }); await navegar(); },
  borrarRecordatorio: async ({ id }) => { await api(`/recordatorios/${id}`, 'DELETE'); await navegar(); },

  nuevoRollo: () => formulario('Nuevo rollo de filamento', camposRollo(), async (f) => { await api('/rollos', 'POST', f); await navegar(); }),
  editarRollo: ({ id }) => {
    const r = rollos.find((x) => String(x.id) === id);
    formulario('Editar rollo', camposRollo(r), async (f) => { await api(`/rollos/${id}`, 'PUT', f); await navegar(); });
  },
  borrarRollo: async ({ id }) => {
    if (!confirmar('¿Borrar este rollo y su historial de movimientos?')) return;
    await api(`/rollos/${id}`, 'DELETE');
    await navegar();
  },
  falloRollo: ({ id }) => {
    const r = rollos.find((x) => String(x.id) === id);
    formulario(`Pieza fallida · ${nombreRollo(r)}`, `
      <label>Material perdido (g) *<input name="gramos" type="number" min="0.1" step="0.1" required></label>
      <label class="ancho">Nota<input name="nota" placeholder="Ej. Se despegó de la cama a la mitad"></label>`,
    async (f) => { await api(`/rollos/${id}/fallo`, 'POST', f); await navegar(); });
  },
  fabricarProducto: async ({ id }) => {
    const p = catalogoPiezas.find((x) => String(x.id) === id);
    rollos = await api('/rollos');
    if (!rollos.length) throw new Error('Primero agrega un rollo en Inventario de filamento.');
    formulario(`Fabricar stock · ${p.nombre}`, `
      <label class="ancho">Rollo usado *<select name="rollo_id" required>${opciones(rollos.map((r) => [r.id, `${nombreRollo(r)} · quedan ${gramos(r.restante)}`]))}</select></label>
      <label>Piezas fabricadas *<input name="cantidad" type="number" min="1" step="1" required value="1"></label>
      <label>Filamento por pieza (g) *<input name="gramos_pieza" type="number" min="0.1" step="0.1" required value="${esc(p.gramos_pieza || '')}"></label>`,
    async (f) => { await api(`/productos/${id}/fabricar`, 'POST', f); await navegar(); });
  },

  nuevoProducto: () => formulario('Nueva pieza', camposProducto(), async (f) => { await api('/productos', 'POST', f); await navegar(); }),
  editarProducto: ({ id }) => {
    const p = catalogoPiezas.find((x) => String(x.id) === id);
    formulario('Editar pieza', camposProducto(p), async (f) => { await api(`/productos/${id}`, 'PUT', f); await navegar(); });
  },
  borrarProducto: async ({ id }) => {
    if (!confirmar('¿Borrar esta pieza del catálogo?')) return;
    await api(`/productos/${id}`, 'DELETE');
    await navegar();
  },

  agregarMaterial: () => $('#materiales').insertAdjacentHTML('beforeend', filaMaterial()),
  quitarMaterial: (_, el) => el.closest('.material').remove(),
};

document.addEventListener('click', (ev) => {
  const boton = ev.target.closest('[data-act]');
  if (boton) {
    ev.preventDefault();
    intentar(() => acciones[boton.dataset.act](boton.dataset, boton));
    return;
  }
  const filaLink = ev.target.closest('[data-ir]');
  if (filaLink && !ev.target.closest('a, button')) location.hash = filaLink.dataset.ir;
});

// ------------------------------------------------------------------ rutas
const rutas = { tablero, contactos, contacto, cotizador, cotizaciones, cotizacion, taller, equipo, catalogo, inventario, config };

async function navegar() {
  const [nombre, id, extra] = location.hash.replace(/^#\/?/, '').split('/');
  const ruta = rutas[nombre] ? nombre : 'tablero';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('activo', a.getAttribute('href') === `#/${ruta}`));
  try {
    if (!META) {
      META = await api('/meta');
      $('#marca').textContent = META.config.negocio_nombre;
    }
    await rutas[ruta](id, extra);
  } catch (e) {
    vista.innerHTML = `<div class="panel"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p><a href="#/tablero">Volver al tablero</a></div>`;
  }
}

window.addEventListener('hashchange', navegar);
navegar();
