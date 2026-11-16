"""CRM de taller: contactos, cotizador, ventas y seguimiento de equipos.

Backend Flask + SQLite. Toda la funcionalidad se expone como API REST en
/api/v1 para que la interfaz web (y, más adelante, otros equipos de la red)
consuman los mismos datos.
"""
import json
import os
import sqlite3
from datetime import date, datetime

from flask import Flask, g, jsonify, request

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("CRM_DB", os.path.join(BASE, "crm.db"))

app = Flask(__name__, static_folder="static", static_url_path="/static")

CATEGORIAS = {
    "reparacion": "Reparación electrónica",
    "diagnostico": "Diagnóstico electrónico",
    "mantenimiento": "Mantenimiento",
    "impresion3d": "Impresión 3D",
    "modelado3d": "Modelado 3D",
    "pieza": "Pieza estandarizada",
    "otro": "Otro",
}
ESTADOS_COTIZACION = ["borrador", "enviada", "aceptada", "rechazada", "pagada"]
ESTADOS_EQUIPO = [
    "recibido",
    "diagnostico",
    "esperando_aprobacion",
    "esperando_refacciones",
    "en_reparacion",
    "listo",
    "entregado",
    "cancelado",
]

CONFIG_DEFAULT = {
    "negocio_nombre": "Mi Taller",
    "negocio_telefono": "",
    "negocio_direccion": "",
    "vigencia_dias": 15,
    "iva_pct": 16,
    # Cotizador de servicios
    "tarifa_reparacion": 350,
    "tarifa_diagnostico": 250,
    "tarifa_mantenimiento": 300,
    "tarifa_modelado3d": 400,
    "margen_refacciones_pct": 30,
    "recargo_urgencia_pct": 25,
    # Cotizador de impresión 3D
    "materiales": {"PLA": 0.5, "PETG": 0.6, "ABS": 0.6, "TPU": 0.9, "Resina": 1.2},
    "costo_maquina_hora": 15,
    "costo_energia_hora": 3,
    "tarifa_postproceso_hora": 150,
    "tasa_fallos_pct": 10,
    "margen_3d_pct": 50,
    "minimo_3d": 80,
}
CONFIG_TEXTO = {"negocio_nombre", "negocio_telefono", "negocio_direccion"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT DEFAULT '',
    email TEXT DEFAULT '',
    empresa TEXT DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'prospecto' CHECK (tipo IN ('prospecto', 'cliente')),
    origen TEXT DEFAULT '',
    notas TEXT DEFAULT '',
    creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comentarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cotizaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    estado TEXT NOT NULL DEFAULT 'borrador',
    partidas TEXT NOT NULL DEFAULT '[]',
    descuento_pct REAL NOT NULL DEFAULT 0,
    iva_pct REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    descuento REAL NOT NULL DEFAULT 0,
    iva REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notas TEXT DEFAULT '',
    creado TEXT NOT NULL,
    actualizado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    cotizacion_id INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL,
    tipo_equipo TEXT NOT NULL DEFAULT 'Otro',
    marca TEXT DEFAULT '',
    modelo TEXT DEFAULT '',
    serie TEXT DEFAULT '',
    falla TEXT DEFAULT '',
    accesorios TEXT DEFAULT '',
    diagnostico TEXT DEFAULT '',
    tecnico TEXT DEFAULT '',
    fecha_promesa TEXT DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'recibido',
    creado TEXT NOT NULL,
    entregado_en TEXT
);
CREATE TABLE IF NOT EXISTS equipo_eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    estado TEXT NOT NULL,
    nota TEXT DEFAULT '',
    creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    cotizacion_id INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL,
    categoria TEXT NOT NULL DEFAULT 'otro',
    descripcion TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT DEFAULT '',
    nombre TEXT NOT NULL,
    precio REAL NOT NULL DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    datos TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recordatorios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    fecha TEXT NOT NULL,
    hecho INTEGER NOT NULL DEFAULT 0,
    creado TEXT NOT NULL,
    completado_en TEXT
);
CREATE TABLE IF NOT EXISTS rollos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material TEXT NOT NULL,
    color TEXT DEFAULT '',
    marca TEXT DEFAULT '',
    peso_inicial REAL NOT NULL,
    restante REAL NOT NULL,
    costo REAL NOT NULL DEFAULT 0,
    fecha_adquisicion TEXT NOT NULL,
    notas TEXT DEFAULT '',
    creado TEXT NOT NULL
);
-- gramos > 0 es consumo de material; gramos < 0 es material que regresa al rollo.
CREATE TABLE IF NOT EXISTS material_movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rollo_id INTEGER NOT NULL REFERENCES rollos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    gramos REAL NOT NULL,
    nota TEXT DEFAULT '',
    cotizacion_id INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL,
    creado TEXT NOT NULL
);
"""

# Columnas agregadas después de la primera versión: (tabla, columna, definición).
MIGRACIONES = [
    ("clientes", "fecha_nacimiento", "TEXT DEFAULT ''"),
    ("productos", "gramos_pieza", "REAL NOT NULL DEFAULT 0"),
]


class ApiError(Exception):
    def __init__(self, mensaje, codigo=400):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.codigo = codigo


@app.errorhandler(ApiError)
def _api_error(e):
    return jsonify(error=e.mensaje), e.codigo


@app.errorhandler(404)
def _no_encontrado(_):
    return jsonify(error="No encontrado"), 404


# ---------------------------------------------------------------- utilidades


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def _cerrar_db(_):
    conexion = g.pop("db", None)
    if conexion is not None:
        conexion.close()


def init_db():
    conexion = sqlite3.connect(DB_PATH)
    conexion.executescript(SCHEMA)
    for tabla, columna, definicion in MIGRACIONES:
        existentes = [c[1] for c in conexion.execute(f"PRAGMA table_info({tabla})")]
        if columna not in existentes:
            conexion.execute(f"ALTER TABLE {tabla} ADD COLUMN {columna} {definicion}")
    conexion.commit()
    conexion.close()


def ahora():
    return datetime.now().isoformat(timespec="seconds")


def filas(sql, args=()):
    return [dict(r) for r in db().execute(sql, args).fetchall()]


def fila(sql, args=(), requerido=True):
    r = db().execute(sql, args).fetchone()
    if r is None:
        if requerido:
            raise ApiError("No encontrado", 404)
        return None
    return dict(r)


def cuerpo():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        raise ApiError("Se esperaba un objeto JSON")
    return datos


def texto(datos, clave, requerido=False):
    valor = str(datos.get(clave) or "").strip()
    if requerido and not valor:
        raise ApiError(f"El campo '{clave}' es obligatorio")
    return valor


def numero(valor, nombre="valor"):
    try:
        n = float(valor if valor not in (None, "") else 0)
    except (TypeError, ValueError):
        raise ApiError(f"'{nombre}' debe ser un número")
    if n != n or n < 0 or n == float("inf"):
        raise ApiError(f"'{nombre}' debe ser un número positivo")
    return n


def fecha_iso(datos, clave, requerido=False):
    valor = str(datos.get(clave) or "").strip()
    if not valor:
        if requerido:
            raise ApiError(f"El campo '{clave}' es obligatorio")
        return ""
    try:
        return datetime.strptime(valor, "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise ApiError(f"'{clave}' debe ser una fecha válida")


def id_cliente(datos):
    cid = datos.get("cliente_id")
    if not fila("SELECT id FROM clientes WHERE id = ?", (cid,), requerido=False):
        raise ApiError("Selecciona un contacto válido")
    return cid


def leer_config():
    r = db().execute("SELECT datos FROM config WHERE id = 1").fetchone()
    guardado = json.loads(r["datos"]) if r else {}
    return {**CONFIG_DEFAULT, **guardado}


def folio(prefijo, n):
    return f"{prefijo}-{n:04d}"


# ------------------------------------------------------------------ páginas


@app.get("/")
def inicio():
    return app.send_static_file("index.html")


@app.get("/api/v1/meta")
def meta():
    return jsonify(
        categorias=CATEGORIAS,
        estados_cotizacion=ESTADOS_COTIZACION,
        estados_equipo=ESTADOS_EQUIPO,
        config=leer_config(),
    )


# ------------------------------------------------------------ configuración


@app.put("/api/v1/config")
def guardar_config():
    datos = cuerpo()
    config = leer_config()
    for clave, valor in datos.items():
        if clave not in CONFIG_DEFAULT:
            continue
        if clave in CONFIG_TEXTO:
            config[clave] = str(valor or "").strip()
        elif clave == "materiales":
            if not isinstance(valor, dict) or not valor:
                raise ApiError("Debe existir al menos un material")
            config[clave] = {
                str(k).strip(): numero(v, f"material {k}")
                for k, v in valor.items()
                if str(k).strip()
            }
        else:
            config[clave] = numero(valor, clave)
    db().execute(
        "INSERT INTO config (id, datos) VALUES (1, ?) "
        "ON CONFLICT(id) DO UPDATE SET datos = excluded.datos",
        (json.dumps(config),),
    )
    db().commit()
    return jsonify(config)


# ----------------------------------------------------------------- contactos

CAMPOS_CLIENTE = ["nombre", "telefono", "email", "empresa", "origen", "notas"]


@app.get("/api/v1/clientes")
def listar_clientes():
    sql = """
        SELECT c.*,
          (SELECT COALESCE(SUM(monto), 0) FROM ventas v WHERE v.cliente_id = c.id) AS total_gastado,
          (SELECT COUNT(*) FROM cotizaciones q WHERE q.cliente_id = c.id) AS num_cotizaciones,
          (SELECT COUNT(*) FROM equipos e WHERE e.cliente_id = c.id
             AND e.estado NOT IN ('entregado', 'cancelado')) AS equipos_activos
        FROM clientes c WHERE 1 = 1
    """
    args = []
    tipo = request.args.get("tipo")
    if tipo in ("prospecto", "cliente"):
        sql += " AND c.tipo = ?"
        args.append(tipo)
    q = (request.args.get("q") or "").strip()
    if q:
        sql += " AND (c.nombre LIKE ? OR c.telefono LIKE ? OR c.email LIKE ? OR c.empresa LIKE ?)"
        args += [f"%{q}%"] * 4
    return jsonify(filas(sql + " ORDER BY c.nombre COLLATE NOCASE", args))


@app.post("/api/v1/clientes")
def crear_cliente():
    datos = cuerpo()
    valores = [texto(datos, c, requerido=(c == "nombre")) for c in CAMPOS_CLIENTE]
    tipo = datos.get("tipo") if datos.get("tipo") in ("prospecto", "cliente") else "prospecto"
    cur = db().execute(
        "INSERT INTO clientes (nombre, telefono, email, empresa, origen, notas, tipo, "
        "fecha_nacimiento, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (*valores, tipo, fecha_iso(datos, "fecha_nacimiento"), ahora()),
    )
    db().commit()
    return jsonify(fila("SELECT * FROM clientes WHERE id = ?", (cur.lastrowid,))), 201


@app.get("/api/v1/clientes/<int:cid>")
def ver_cliente(cid):
    cliente = fila("SELECT * FROM clientes WHERE id = ?", (cid,))
    cliente["ventas"] = filas(
        "SELECT * FROM ventas WHERE cliente_id = ? ORDER BY fecha DESC, id DESC", (cid,)
    )
    cliente["total_gastado"] = round(sum(v["monto"] for v in cliente["ventas"]), 2)
    cliente["cotizaciones"] = [
        salida_cotizacion(q, con_partidas=False)
        for q in filas("SELECT * FROM cotizaciones WHERE cliente_id = ? ORDER BY id DESC", (cid,))
    ]
    cliente["equipos"] = [
        salida_equipo(e)
        for e in filas("SELECT * FROM equipos WHERE cliente_id = ? ORDER BY id DESC", (cid,))
    ]
    cliente["comentarios"] = filas(
        "SELECT * FROM comentarios WHERE cliente_id = ? ORDER BY id DESC", (cid,)
    )
    cliente["recordatorios"] = filas(
        "SELECT * FROM recordatorios WHERE cliente_id = ? ORDER BY hecho, fecha, id", (cid,)
    )
    return jsonify(cliente)


@app.put("/api/v1/clientes/<int:cid>")
def editar_cliente(cid):
    actual = fila("SELECT * FROM clientes WHERE id = ?", (cid,))
    datos = cuerpo()
    valores = [texto({**actual, **datos}, c, requerido=(c == "nombre")) for c in CAMPOS_CLIENTE]
    tipo = datos.get("tipo") if datos.get("tipo") in ("prospecto", "cliente") else actual["tipo"]
    db().execute(
        "UPDATE clientes SET nombre=?, telefono=?, email=?, empresa=?, origen=?, notas=?, tipo=?, "
        "fecha_nacimiento=? WHERE id=?",
        (*valores, tipo, fecha_iso({**actual, **datos}, "fecha_nacimiento"), cid),
    )
    db().commit()
    return jsonify(fila("SELECT * FROM clientes WHERE id = ?", (cid,)))


@app.delete("/api/v1/clientes/<int:cid>")
def borrar_cliente(cid):
    fila("SELECT id FROM clientes WHERE id = ?", (cid,))
    for tabla in ("ventas", "cotizaciones", "equipos"):
        if db().execute(f"SELECT 1 FROM {tabla} WHERE cliente_id = ? LIMIT 1", (cid,)).fetchone():
            raise ApiError(
                "El contacto tiene historial (ventas, cotizaciones o equipos) y no se puede borrar",
                409,
            )
    db().execute("DELETE FROM clientes WHERE id = ?", (cid,))
    db().commit()
    return jsonify(ok=True)


@app.post("/api/v1/clientes/<int:cid>/comentarios")
def crear_comentario(cid):
    fila("SELECT id FROM clientes WHERE id = ?", (cid,))
    db().execute(
        "INSERT INTO comentarios (cliente_id, texto, creado) VALUES (?, ?, ?)",
        (cid, texto(cuerpo(), "texto", requerido=True), ahora()),
    )
    db().commit()
    return jsonify(ok=True), 201


@app.delete("/api/v1/comentarios/<int:mid>")
def borrar_comentario(mid):
    db().execute("DELETE FROM comentarios WHERE id = ?", (mid,))
    db().commit()
    return jsonify(ok=True)


# ------------------------------------------------------------- recordatorios


@app.get("/api/v1/recordatorios")
def listar_recordatorios():
    return jsonify(
        filas(
            "SELECT r.*, c.nombre AS cliente_nombre FROM recordatorios r "
            "JOIN clientes c ON c.id = r.cliente_id WHERE r.hecho = 0 ORDER BY r.fecha, r.id"
        )
    )


@app.post("/api/v1/clientes/<int:cid>/recordatorios")
def crear_recordatorio(cid):
    fila("SELECT id FROM clientes WHERE id = ?", (cid,))
    datos = cuerpo()
    db().execute(
        "INSERT INTO recordatorios (cliente_id, texto, fecha, creado) VALUES (?, ?, ?, ?)",
        (cid, texto(datos, "texto", requerido=True), fecha_iso(datos, "fecha", requerido=True),
         ahora()),
    )
    db().commit()
    return jsonify(ok=True), 201


@app.post("/api/v1/recordatorios/<int:rid>/hecho")
def marcar_recordatorio(rid):
    fila("SELECT id FROM recordatorios WHERE id = ?", (rid,))
    hecho = bool(cuerpo().get("hecho", True))
    db().execute(
        "UPDATE recordatorios SET hecho=?, completado_en=? WHERE id=?",
        (int(hecho), ahora() if hecho else None, rid),
    )
    db().commit()
    return jsonify(ok=True)


@app.delete("/api/v1/recordatorios/<int:rid>")
def borrar_recordatorio(rid):
    db().execute("DELETE FROM recordatorios WHERE id = ?", (rid,))
    db().commit()
    return jsonify(ok=True)


# ------------------------------------------------- inventario de filamento

TIPOS_MOVIMIENTO = {
    "cotizacion": "Cotización autorizada",
    "fallo": "Pieza fallida",
    "stock": "Fabricación de stock",
    "ajuste": "Ajuste manual",
}


def mover_material(rollo_id, gramos, tipo, nota="", cotizacion_id=None):
    """Descuenta gramos del rollo (o los regresa si son negativos) y lo registra."""
    db().execute("UPDATE rollos SET restante = restante - ? WHERE id = ?", (gramos, rollo_id))
    db().execute(
        "INSERT INTO material_movimientos (rollo_id, tipo, gramos, nota, cotizacion_id, creado) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (rollo_id, tipo, gramos, nota, cotizacion_id, ahora()),
    )


def consumo_cotizacion(partidas):
    """Gramos por rollo que consumen las partidas de impresión 3D de una cotización."""
    consumo = {}
    for p in partidas:
        detalle = p.get("detalle") or {}
        if p.get("categoria") != "impresion3d" or not detalle.get("rollo_id"):
            continue
        try:
            gramos = float(detalle.get("peso") or 0) * float(p.get("cantidad") or 0)
            rollo_id = int(detalle["rollo_id"])
        except (TypeError, ValueError):
            continue
        if gramos > 0:
            consumo[rollo_id] = consumo.get(rollo_id, 0) + gramos
    return consumo


def descontar_cotizacion(qid):
    """Descuenta el material de una cotización autorizada. No hace nada si ya se descontó."""
    if db().execute(
        "SELECT 1 FROM material_movimientos WHERE cotizacion_id = ? LIMIT 1", (qid,)
    ).fetchone():
        return
    q = fila("SELECT partidas FROM cotizaciones WHERE id = ?", (qid,))
    for rollo_id, gramos in consumo_cotizacion(json.loads(q["partidas"])).items():
        if fila("SELECT id FROM rollos WHERE id = ?", (rollo_id,), requerido=False):
            mover_material(rollo_id, gramos, "cotizacion", folio("COT", qid), qid)


def revertir_cotizacion(qid):
    """Regresa al inventario el material descontado por una cotización."""
    for m in filas("SELECT * FROM material_movimientos WHERE cotizacion_id = ?", (qid,)):
        db().execute(
            "UPDATE rollos SET restante = restante + ? WHERE id = ?", (m["gramos"], m["rollo_id"])
        )
    db().execute("DELETE FROM material_movimientos WHERE cotizacion_id = ?", (qid,))


def datos_rollo(datos):
    peso = numero(datos.get("peso_inicial"), "peso del rollo")
    if peso <= 0:
        raise ApiError("El peso del rollo debe ser mayor a cero")
    return {
        "material": texto(datos, "material", requerido=True),
        "color": texto(datos, "color"),
        "marca": texto(datos, "marca"),
        "peso_inicial": peso,
        "costo": round(numero(datos.get("costo"), "costo"), 2),
        "fecha_adquisicion": fecha_iso(datos, "fecha_adquisicion") or date.today().isoformat(),
        "notas": texto(datos, "notas"),
    }


@app.get("/api/v1/rollos")
def listar_rollos():
    rollos = filas("SELECT * FROM rollos ORDER BY material COLLATE NOCASE, fecha_adquisicion, id")
    for r in rollos:
        r["costo_gramo"] = round(r["costo"] / r["peso_inicial"], 4)
    return jsonify(rollos)


@app.post("/api/v1/rollos")
def crear_rollo():
    r = datos_rollo(cuerpo())
    db().execute(
        "INSERT INTO rollos (material, color, marca, peso_inicial, restante, costo, "
        "fecha_adquisicion, notas, creado) VALUES (?,?,?,?,?,?,?,?,?)",
        (r["material"], r["color"], r["marca"], r["peso_inicial"], r["peso_inicial"], r["costo"],
         r["fecha_adquisicion"], r["notas"], ahora()),
    )
    db().commit()
    return jsonify(ok=True), 201


@app.put("/api/v1/rollos/<int:rid>")
def editar_rollo(rid):
    actual = fila("SELECT * FROM rollos WHERE id = ?", (rid,))
    datos = cuerpo()
    r = datos_rollo({**actual, **datos})
    db().execute(
        "UPDATE rollos SET material=?, color=?, marca=?, peso_inicial=?, costo=?, "
        "fecha_adquisicion=?, notas=? WHERE id=?",
        (r["material"], r["color"], r["marca"], r["peso_inicial"], r["costo"],
         r["fecha_adquisicion"], r["notas"], rid),
    )
    if datos.get("restante") not in (None, ""):
        diferencia = actual["restante"] - numero(datos["restante"], "material restante")
        if abs(diferencia) > 1e-9:
            mover_material(rid, diferencia, "ajuste", "Corrección del material restante")
    db().commit()
    return jsonify(ok=True)


@app.delete("/api/v1/rollos/<int:rid>")
def borrar_rollo(rid):
    db().execute("DELETE FROM rollos WHERE id = ?", (rid,))
    db().commit()
    return jsonify(ok=True)


@app.post("/api/v1/rollos/<int:rid>/fallo")
def registrar_fallo(rid):
    fila("SELECT id FROM rollos WHERE id = ?", (rid,))
    datos = cuerpo()
    gramos = numero(datos.get("gramos"), "gramos")
    if gramos <= 0:
        raise ApiError("Indica cuántos gramos se perdieron")
    mover_material(rid, gramos, "fallo", texto(datos, "nota"))
    db().commit()
    return jsonify(ok=True), 201


@app.get("/api/v1/material/movimientos")
def listar_movimientos():
    movimientos = filas(
        "SELECT m.*, r.material, r.color FROM material_movimientos m "
        "JOIN rollos r ON r.id = m.rollo_id ORDER BY m.id DESC LIMIT 100"
    )
    for m in movimientos:
        m["tipo_nombre"] = TIPOS_MOVIMIENTO.get(m["tipo"], m["tipo"])
    return jsonify(movimientos)


# -------------------------------------------------------------- cotizaciones


def salida_cotizacion(q, con_partidas=True):
    q["folio"] = folio("COT", q["id"])
    partidas = json.loads(q.pop("partidas"))
    q["resumen"] = "; ".join(p["descripcion"] for p in partidas)
    if con_partidas:
        q["partidas"] = partidas
    return q


def calcular_cotizacion(datos, iva_pct):
    entrada = datos.get("partidas")
    if not isinstance(entrada, list) or not entrada:
        raise ApiError("Agrega al menos una partida a la cotización")
    partidas = []
    for p in entrada:
        if not isinstance(p, dict):
            raise ApiError("Partida inválida")
        cantidad = numero(p.get("cantidad", 1), "cantidad")
        precio = numero(p.get("precio_unitario"), "precio unitario")
        partidas.append(
            {
                "categoria": p.get("categoria") if p.get("categoria") in CATEGORIAS else "otro",
                "descripcion": texto(p, "descripcion", requerido=True),
                "cantidad": cantidad,
                "precio_unitario": round(precio, 2),
                "importe": round(cantidad * precio, 2),
                "detalle": p.get("detalle") if isinstance(p.get("detalle"), dict) else {},
            }
        )
    descuento_pct = min(numero(datos.get("descuento_pct"), "descuento"), 100)
    subtotal = round(sum(p["importe"] for p in partidas), 2)
    descuento = round(subtotal * descuento_pct / 100, 2)
    iva = round((subtotal - descuento) * iva_pct / 100, 2)
    return {
        "partidas": json.dumps(partidas),
        "descuento_pct": descuento_pct,
        "iva_pct": iva_pct,
        "subtotal": subtotal,
        "descuento": descuento,
        "iva": iva,
        "total": round(subtotal - descuento + iva, 2),
        "notas": texto(datos, "notas"),
    }


@app.get("/api/v1/cotizaciones")
def listar_cotizaciones():
    sql = (
        "SELECT q.*, c.nombre AS cliente_nombre FROM cotizaciones q "
        "JOIN clientes c ON c.id = q.cliente_id WHERE 1 = 1"
    )
    args = []
    if request.args.get("estado") in ESTADOS_COTIZACION:
        sql += " AND q.estado = ?"
        args.append(request.args["estado"])
    return jsonify(
        [salida_cotizacion(q, con_partidas=False) for q in filas(sql + " ORDER BY q.id DESC", args)]
    )


@app.post("/api/v1/cotizaciones")
def crear_cotizacion():
    datos = cuerpo()
    cid = id_cliente(datos)
    c = calcular_cotizacion(datos, leer_config()["iva_pct"])
    cur = db().execute(
        "INSERT INTO cotizaciones (cliente_id, partidas, descuento_pct, iva_pct, subtotal, "
        "descuento, iva, total, notas, creado, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (cid, c["partidas"], c["descuento_pct"], c["iva_pct"], c["subtotal"], c["descuento"],
         c["iva"], c["total"], c["notas"], ahora(), ahora()),
    )
    db().commit()
    return ver_cotizacion(cur.lastrowid), 201


@app.get("/api/v1/cotizaciones/<int:qid>")
def ver_cotizacion(qid):
    q = fila(
        "SELECT q.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, "
        "c.email AS cliente_email, c.empresa AS cliente_empresa FROM cotizaciones q "
        "JOIN clientes c ON c.id = q.cliente_id WHERE q.id = ?",
        (qid,),
    )
    return jsonify(salida_cotizacion(q))


@app.put("/api/v1/cotizaciones/<int:qid>")
def editar_cotizacion(qid):
    actual = fila("SELECT * FROM cotizaciones WHERE id = ?", (qid,))
    if actual["estado"] == "pagada":
        raise ApiError("Una cotización pagada ya no se puede modificar", 409)
    datos = cuerpo()
    cid = id_cliente(datos)
    c = calcular_cotizacion(datos, actual["iva_pct"])
    db().execute(
        "UPDATE cotizaciones SET cliente_id=?, partidas=?, descuento_pct=?, subtotal=?, "
        "descuento=?, iva=?, total=?, notas=?, actualizado=? WHERE id=?",
        (cid, c["partidas"], c["descuento_pct"], c["subtotal"], c["descuento"], c["iva"],
         c["total"], c["notas"], ahora(), qid),
    )
    # Si ya estaba autorizada, el material descontado se recalcula con las partidas nuevas.
    revertir_cotizacion(qid)
    if actual["estado"] == "aceptada":
        descontar_cotizacion(qid)
    db().commit()
    return ver_cotizacion(qid)


@app.post("/api/v1/cotizaciones/<int:qid>/estado")
def estado_cotizacion(qid):
    actual = fila("SELECT * FROM cotizaciones WHERE id = ?", (qid,))
    estado = cuerpo().get("estado")
    if estado not in ESTADOS_COTIZACION or estado == "pagada":
        raise ApiError("Estado inválido")
    if actual["estado"] == "pagada":
        raise ApiError("La cotización ya fue pagada", 409)
    db().execute(
        "UPDATE cotizaciones SET estado=?, actualizado=? WHERE id=?", (estado, ahora(), qid)
    )
    # Autorizar la cotización aparta el filamento; dejar de estar autorizada lo regresa.
    if estado == "aceptada":
        descontar_cotizacion(qid)
    else:
        revertir_cotizacion(qid)
    db().commit()
    return ver_cotizacion(qid)


@app.post("/api/v1/cotizaciones/<int:qid>/cobrar")
def cobrar_cotizacion(qid):
    """Convierte la cotización en ventas: una por partida, con descuento e IVA."""
    q = fila("SELECT * FROM cotizaciones WHERE id = ?", (qid,))
    if q["estado"] == "pagada":
        raise ApiError("La cotización ya fue pagada", 409)
    partidas = json.loads(q["partidas"])
    factor = (q["total"] / q["subtotal"]) if q["subtotal"] else 0
    restante = q["total"]
    fecha = ahora()
    for i, p in enumerate(partidas):
        ultimo = i == len(partidas) - 1
        monto = round(restante, 2) if ultimo else round(p["importe"] * factor, 2)
        restante -= monto
        db().execute(
            "INSERT INTO ventas (cliente_id, cotizacion_id, categoria, descripcion, monto, fecha) "
            "VALUES (?,?,?,?,?,?)",
            (q["cliente_id"], qid, p["categoria"], p["descripcion"], monto, fecha),
        )
        producto_id = p.get("detalle", {}).get("producto_id")
        if producto_id:
            db().execute(
                "UPDATE productos SET stock = MAX(stock - ?, 0) WHERE id = ?",
                (p["cantidad"], producto_id),
            )
    db().execute(
        "UPDATE cotizaciones SET estado='pagada', actualizado=? WHERE id=?", (fecha, qid)
    )
    db().execute("UPDATE clientes SET tipo='cliente' WHERE id=?", (q["cliente_id"],))
    descontar_cotizacion(qid)  # por si se cobró sin pasar por "aceptada"
    db().commit()
    return ver_cotizacion(qid)


@app.delete("/api/v1/cotizaciones/<int:qid>")
def borrar_cotizacion(qid):
    q = fila("SELECT * FROM cotizaciones WHERE id = ?", (qid,))
    if q["estado"] == "pagada":
        raise ApiError("Una cotización pagada forma parte del historial y no se puede borrar", 409)
    revertir_cotizacion(qid)
    db().execute("DELETE FROM cotizaciones WHERE id = ?", (qid,))
    db().commit()
    return jsonify(ok=True)


# -------------------------------------------------------------------- ventas


@app.post("/api/v1/ventas")
def crear_venta():
    """Venta directa de mostrador (sin cotización)."""
    datos = cuerpo()
    cid = id_cliente(datos)
    monto = numero(datos.get("monto"), "monto")
    if monto <= 0:
        raise ApiError("El monto debe ser mayor a cero")
    categoria = datos.get("categoria") if datos.get("categoria") in CATEGORIAS else "otro"
    db().execute(
        "INSERT INTO ventas (cliente_id, categoria, descripcion, monto, fecha) VALUES (?,?,?,?,?)",
        (cid, categoria, texto(datos, "descripcion", requerido=True), round(monto, 2), ahora()),
    )
    db().execute("UPDATE clientes SET tipo='cliente' WHERE id=?", (cid,))
    db().commit()
    return jsonify(ok=True), 201


@app.delete("/api/v1/ventas/<int:vid>")
def borrar_venta(vid):
    db().execute("DELETE FROM ventas WHERE id = ?", (vid,))
    db().commit()
    return jsonify(ok=True)


# ------------------------------------------------------------------- equipos

CAMPOS_EQUIPO = [
    "tipo_equipo", "marca", "modelo", "serie", "falla", "accesorios", "diagnostico",
    "tecnico", "fecha_promesa",
]


def salida_equipo(e):
    e["folio"] = folio("OT", e["id"])
    return e


def id_cotizacion(datos):
    qid = datos.get("cotizacion_id") or None
    if qid and not fila("SELECT id FROM cotizaciones WHERE id = ?", (qid,), requerido=False):
        raise ApiError("La cotización vinculada no existe")
    return qid


@app.get("/api/v1/equipos")
def listar_equipos():
    sql = (
        "SELECT e.*, c.nombre AS cliente_nombre FROM equipos e "
        "JOIN clientes c ON c.id = e.cliente_id"
    )
    if request.args.get("activos") == "1":
        sql += " WHERE e.estado NOT IN ('entregado', 'cancelado')"
    return jsonify([salida_equipo(e) for e in filas(sql + " ORDER BY e.id DESC")])


@app.post("/api/v1/equipos")
def crear_equipo():
    datos = cuerpo()
    cid = id_cliente(datos)
    valores = [texto(datos, c, requerido=(c == "tipo_equipo")) for c in CAMPOS_EQUIPO]
    cur = db().execute(
        "INSERT INTO equipos (cliente_id, cotizacion_id, tipo_equipo, marca, modelo, serie, "
        "falla, accesorios, diagnostico, tecnico, fecha_promesa, creado) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (cid, id_cotizacion(datos), *valores, ahora()),
    )
    db().execute(
        "INSERT INTO equipo_eventos (equipo_id, estado, nota, creado) VALUES (?,?,?,?)",
        (cur.lastrowid, "recibido", "Equipo recibido en taller", ahora()),
    )
    db().commit()
    return ver_equipo(cur.lastrowid), 201


@app.get("/api/v1/equipos/<int:eid>")
def ver_equipo(eid):
    e = fila(
        "SELECT e.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono "
        "FROM equipos e JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?",
        (eid,),
    )
    e["eventos"] = filas(
        "SELECT * FROM equipo_eventos WHERE equipo_id = ? ORDER BY id DESC", (eid,)
    )
    return jsonify(salida_equipo(e))


@app.put("/api/v1/equipos/<int:eid>")
def editar_equipo(eid):
    actual = fila("SELECT * FROM equipos WHERE id = ?", (eid,))
    datos = {**actual, **cuerpo()}
    valores = [texto(datos, c, requerido=(c == "tipo_equipo")) for c in CAMPOS_EQUIPO]
    db().execute(
        "UPDATE equipos SET cotizacion_id=?, tipo_equipo=?, marca=?, modelo=?, serie=?, falla=?, "
        "accesorios=?, diagnostico=?, tecnico=?, fecha_promesa=? WHERE id=?",
        (id_cotizacion(datos), *valores, eid),
    )
    db().commit()
    return ver_equipo(eid)


@app.post("/api/v1/equipos/<int:eid>/estado")
def estado_equipo(eid):
    """Cambia el estado y deja registro en la bitácora del equipo.

    Es el punto de entrada pensado para futuras integraciones de red
    (por ejemplo, una estación de trabajo que reporte avances).
    """
    fila("SELECT id FROM equipos WHERE id = ?", (eid,))
    datos = cuerpo()
    estado = datos.get("estado")
    if estado not in ESTADOS_EQUIPO:
        raise ApiError("Estado inválido")
    db().execute(
        "UPDATE equipos SET estado=?, entregado_en=? WHERE id=?",
        (estado, ahora() if estado == "entregado" else None, eid),
    )
    db().execute(
        "INSERT INTO equipo_eventos (equipo_id, estado, nota, creado) VALUES (?,?,?,?)",
        (eid, estado, texto(datos, "nota"), ahora()),
    )
    db().commit()
    return ver_equipo(eid)


# ------------------------------------------------------------------ catálogo


def datos_producto(datos):
    return (
        texto(datos, "sku"),
        texto(datos, "nombre", requerido=True),
        round(numero(datos.get("precio"), "precio"), 2),
        numero(datos.get("stock"), "stock"),
        numero(datos.get("gramos_pieza"), "gramos por pieza"),
    )


@app.get("/api/v1/productos")
def listar_productos():
    return jsonify(filas("SELECT * FROM productos ORDER BY nombre COLLATE NOCASE"))


@app.post("/api/v1/productos")
def crear_producto():
    db().execute(
        "INSERT INTO productos (sku, nombre, precio, stock, gramos_pieza) VALUES (?,?,?,?,?)",
        datos_producto(cuerpo()),
    )
    db().commit()
    return jsonify(ok=True), 201


@app.put("/api/v1/productos/<int:pid>")
def editar_producto(pid):
    fila("SELECT id FROM productos WHERE id = ?", (pid,))
    db().execute(
        "UPDATE productos SET sku=?, nombre=?, precio=?, stock=?, gramos_pieza=? WHERE id=?",
        (*datos_producto(cuerpo()), pid),
    )
    db().commit()
    return jsonify(ok=True)


@app.post("/api/v1/productos/<int:pid>/fabricar")
def fabricar_producto(pid):
    """Imprime piezas para stock: suma existencia y descuenta filamento del rollo."""
    producto = fila("SELECT * FROM productos WHERE id = ?", (pid,))
    datos = cuerpo()
    cantidad = numero(datos.get("cantidad"), "cantidad")
    gramos_pieza = numero(datos.get("gramos_pieza"), "gramos por pieza")
    if cantidad <= 0 or gramos_pieza <= 0:
        raise ApiError("Indica la cantidad de piezas y los gramos por pieza")
    rollo = fila("SELECT id FROM rollos WHERE id = ?", (datos.get("rollo_id"),), requerido=False)
    if not rollo:
        raise ApiError("Selecciona el rollo que se usó")
    db().execute(
        "UPDATE productos SET stock = stock + ?, gramos_pieza = ? WHERE id = ?",
        (cantidad, gramos_pieza, pid),
    )
    mover_material(
        rollo["id"], cantidad * gramos_pieza, "stock", f"{cantidad:g} × {producto['nombre']}"
    )
    db().commit()
    return jsonify(ok=True), 201


@app.delete("/api/v1/productos/<int:pid>")
def borrar_producto(pid):
    db().execute("DELETE FROM productos WHERE id = ?", (pid,))
    db().commit()
    return jsonify(ok=True)


# ------------------------------------------------------------------- tablero


def proximos_cumpleanos(dias=30):
    hoy = date.today()
    proximos = []
    for c in filas("SELECT id, nombre, fecha_nacimiento FROM clientes WHERE fecha_nacimiento != ''"):
        nacimiento = date.fromisoformat(c["fecha_nacimiento"])
        for anio in (hoy.year, hoy.year + 1):
            try:
                cumple = nacimiento.replace(year=anio)
            except ValueError:  # 29 de febrero en año no bisiesto
                cumple = date(anio, 3, 1)
            if cumple >= hoy:
                break
        if (cumple - hoy).days <= dias:
            proximos.append(
                {"id": c["id"], "nombre": c["nombre"], "fecha": cumple.isoformat(),
                 "dias": (cumple - hoy).days, "edad": anio - nacimiento.year}
            )
    return sorted(proximos, key=lambda c: c["dias"])


@app.get("/api/v1/tablero")
def tablero():
    mes = datetime.now().strftime("%Y-%m")
    uno = lambda sql, args=(): db().execute(sql, args).fetchone()[0]
    return jsonify(
        prospectos=uno("SELECT COUNT(*) FROM clientes WHERE tipo='prospecto'"),
        clientes=uno("SELECT COUNT(*) FROM clientes WHERE tipo='cliente'"),
        ingresos_mes=uno(
            "SELECT COALESCE(SUM(monto),0) FROM ventas WHERE substr(fecha,1,7)=?", (mes,)
        ),
        ingresos_total=uno("SELECT COALESCE(SUM(monto),0) FROM ventas"),
        cotizaciones_abiertas=uno(
            "SELECT COUNT(*) FROM cotizaciones WHERE estado IN ('borrador','enviada','aceptada')"
        ),
        monto_abierto=uno(
            "SELECT COALESCE(SUM(total),0) FROM cotizaciones "
            "WHERE estado IN ('borrador','enviada','aceptada')"
        ),
        equipos_por_estado=filas(
            "SELECT estado, COUNT(*) AS n FROM equipos "
            "WHERE estado NOT IN ('entregado','cancelado') GROUP BY estado"
        ),
        ventas_por_categoria=filas(
            "SELECT categoria, SUM(monto) AS monto FROM ventas GROUP BY categoria "
            "ORDER BY monto DESC"
        ),
        mejores_clientes=filas(
            "SELECT c.id, c.nombre, SUM(v.monto) AS total FROM ventas v "
            "JOIN clientes c ON c.id = v.cliente_id GROUP BY c.id ORDER BY total DESC LIMIT 5"
        ),
        recordatorios=filas(
            "SELECT r.*, c.nombre AS cliente_nombre FROM recordatorios r "
            "JOIN clientes c ON c.id = r.cliente_id WHERE r.hecho = 0 ORDER BY r.fecha, r.id"
        ),
        cumpleanos=proximos_cumpleanos(),
        material=filas(
            "SELECT material, COUNT(*) AS rollos, SUM(restante) AS restante, "
            "SUM(peso_inicial) AS inicial FROM rollos GROUP BY material "
            "ORDER BY material COLLATE NOCASE"
        ),
    )


init_db()

if __name__ == "__main__":
    # Por defecto solo escucha en esta máquina. Para abrirlo a la red local:
    #   CRM_HOST=0.0.0.0 python app.py
    app.run(
        host=os.environ.get("CRM_HOST", "127.0.0.1"),
        port=int(os.environ.get("CRM_PORT", "5000")),
        debug=os.environ.get("CRM_DEBUG") == "1",
    )
