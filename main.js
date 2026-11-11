
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

// #&#&# Desarrollo: configuración local del proyecto.
// #&#&# Aplicación instalada: configuración externa en AppData.
const rutaEnv = app.isPackaged
    ? path.join(app.getPath('appData'), 'PanaderiaGestion', '.env')
    : path.join(__dirname, '.env');

const resultadoEnv = dotenv.config({ path: rutaEnv });
if (resultadoEnv.error) {
    console.error('No se pudo leer el archivo de configuración:', rutaEnv);
}


const baseDatos = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5
});

let ventanaPrincipal = null;
let sesionActual = null;
let modoRestauracion = false;
const intentos = new Map();

function crearVentana() {
    ventanaPrincipal = new BrowserWindow({
        width: 1200,
        height: 780,
        minWidth: 760,
        minHeight: 560,
        title: 'Sistema de Gestión de Panadería',
        backgroundColor: '#f5f7fa',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    ventanaPrincipal.loadFile(path.join(__dirname, 'index.html'));
    ventanaPrincipal.webContents.on('will-navigate', e => e.preventDefault());
    ventanaPrincipal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ventanaPrincipal.on('closed', () => {
        ventanaPrincipal = null;
        sesionActual = null;
    });
}

function origenAutorizado(evento) {
    return Boolean(
        ventanaPrincipal &&
        !ventanaPrincipal.isDestroyed() &&
        evento.sender === ventanaPrincipal.webContents &&
        evento.senderFrame === ventanaPrincipal.webContents.mainFrame
    );
}

// #&#&# Verificar rol, activación y vigencia de la contraseña.
// #&#&# Si se restablece una contraseña, la sesión previa queda invalidada.
async function verificarPermiso(evento, rolesPermitidos) {
    if (modoRestauracion || !origenAutorizado(evento) || !sesionActual ||
        !rolesPermitidos.includes(sesionActual.rol)) return false;
    try {
        const [filas] = await baseDatos.execute(
            `SELECT rol, activo, contrasena_hash
             FROM usuarios WHERE id_usuario = ? LIMIT 1`,
            [sesionActual.id_usuario]
        );
        const usuario = filas[0];
        if (!usuario || Number(usuario.activo) !== 1 ||
            usuario.rol !== sesionActual.rol ||
            usuario.contrasena_hash !== sesionActual.hashSesion) {
            sesionActual = null;
            return false;
        }
        return true;
    } catch (error) {
        console.error('Verificación de sesión:', error.code || error.message);
        return false;
    }
}

const accesoDenegado = () => ({
    ok: false,
    mensaje: 'Acceso denegado. Se requiere una sesión de administrador vigente.'
});

function usuarioPublico() {
    if (!sesionActual) return null;
    return {
        id_usuario: sesionActual.id_usuario,
        nombre_usuario: sesionActual.nombre_usuario,
        rol: sesionActual.rol
    };
}

ipcMain.handle('auth:iniciar', async (evento, datos) => {
    if (modoRestauracion || !origenAutorizado(evento)) return accesoDenegado();
    if (!datos || typeof datos.nombre_usuario !== 'string' ||
        typeof datos.contrasena !== 'string') {
        return { ok: false, mensaje: 'Introduce usuario y contraseña.' };
    }
    const nombre = datos.nombre_usuario.trim();
    const clave = datos.contrasena;
    if (!nombre || nombre.length > 50 || !clave || clave.length > 1024) {
        return { ok: false, mensaje: 'Credenciales no válidas.' };
    }

    const ahora = Date.now();
    const control = intentos.get(nombre) || { fallos: 0, hasta: 0 };
    if (ahora < control.hasta) {
        return { ok: false, mensaje: 'Cuenta temporalmente bloqueada. Intenta en 30 segundos.' };
    }
    sesionActual = null;
    try {
        const [filas] = await baseDatos.execute(
            `SELECT id_usuario, nombre_usuario, contrasena_hash, rol, activo
             FROM usuarios WHERE nombre_usuario = ? AND activo = 1 LIMIT 1`,
            [nombre]
        );
        const u = filas[0];
        const valido = Boolean(u) && await bcrypt.compare(clave, u.contrasena_hash);
        if (!valido || !['administrador', 'cajero'].includes(u.rol)) {
            control.fallos++;
            if (control.fallos >= 5) {
                control.fallos = 0;
                control.hasta = Date.now() + 30000;
            }
            intentos.set(nombre, control);
            if (intentos.size > 100) intentos.delete(intentos.keys().next().value);
            return { ok: false, mensaje: 'Usuario o contraseña incorrectos, o acceso temporalmente limitado.' };
        }
        intentos.delete(nombre);
        sesionActual = {
            id_usuario: Number(u.id_usuario),
            nombre_usuario: u.nombre_usuario,
            rol: u.rol,
            hashSesion: u.contrasena_hash
        };
        return { ok: true, usuario: usuarioPublico() };
    } catch (error) {
        console.error('Inicio de sesión:', error.code || error.message);
        return { ok: false, mensaje: 'No se pudo iniciar sesión.' };
    }
});

ipcMain.handle('auth:sesion', async evento => {
    if (modoRestauracion || !origenAutorizado(evento)) return { ok: false, usuario: null };
    if (!sesionActual) return { ok: true, usuario: null };
    const valido = await verificarPermiso(evento, ['administrador', 'cajero']);
    return { ok: true, usuario: valido ? usuarioPublico() : null };
});

ipcMain.handle('auth:cerrar', evento => {
    if (!origenAutorizado(evento)) return accesoDenegado();
    sesionActual = null;
    return { ok: true };
});

const dineroValido = valor =>
    typeof valor === 'string' &&
    /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(valor.trim());

const codigoValido = valor =>
    typeof valor === 'string' &&
    /^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(valor);

const enteroValido = (valor, minimo) => {
    const texto = String(valor ?? '').trim();
    if (!/^\d+$/.test(texto)) return false;
    const numero = Number(texto);
    return Number.isSafeInteger(numero) && numero >= minimo && numero <= 2147483647;
};

function fechaValida(texto) {
    if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const anio = Number(texto.slice(0, 4));
    if (anio < 1000) return false;
    const fecha = new Date(`${texto}T00:00:00.000Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

ipcMain.handle('productos:listar', async evento => {
    if (!await verificarPermiso(evento, ['administrador'])) return accesoDenegado();
    try {
        const [filas] = await baseDatos.execute(
            `SELECT p.codigo, p.nombre, p.precio_venta, p.stock_minimo, p.activo,
                    COALESCE(SUM(l.cantidad_disponible), 0) AS stock_total
             FROM productos p LEFT JOIN lotes l ON l.id_producto = p.id_producto
             GROUP BY p.id_producto, p.codigo, p.nombre, p.precio_venta,
                      p.stock_minimo, p.activo
             ORDER BY p.nombre ASC, p.codigo ASC`
        );
        return { ok: true, productos: filas.map(f => ({
            codigo: f.codigo,
            nombre: f.nombre,
            precio_venta: Number(f.precio_venta),
            stock_minimo: Number(f.stock_minimo),
            stock_total: Number(f.stock_total),
            activo: Number(f.activo) === 1
        })) };
    } catch (error) {
        console.error('Listar productos:', error.code || error.message);
        return { ok: false, mensaje: 'No fue posible consultar productos.' };
    }
});

ipcMain.handle('productos:registrar', async (evento, datos) => {
    if (!await verificarPermiso(evento, ['administrador'])) return accesoDenegado();
    const codigo = typeof datos?.codigo === 'string' ? datos.codigo.trim().toUpperCase() : '';
    const nombre = typeof datos?.nombre === 'string' ? datos.nombre.trim() : '';
    if (!codigoValido(codigo) || nombre.length < 2 || nombre.length > 150 ||
        !dineroValido(datos?.costo_referencia) || !dineroValido(datos?.precio_venta) ||
        !enteroValido(datos?.stock_minimo, 0)) {
        return { ok: false, mensaje: 'Revisa código, nombre, importes y stock mínimo.' };
    }
    try {
        const [resultado] = await baseDatos.execute(
            `INSERT INTO productos
              (codigo, nombre, costo_referencia, precio_venta, stock_minimo, activo)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [codigo, nombre, datos.costo_referencia.trim(),
                datos.precio_venta.trim(), Number(datos.stock_minimo)]
        );
        return { ok: true, id_producto: resultado.insertId, mensaje: 'Producto registrado correctamente.' };
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return { ok: false, mensaje: 'Ese código ya está registrado.' };
        console.error('Registrar producto:', error.code || error.message);
        return { ok: false, mensaje: 'No fue posible registrar el producto.' };
    }
});

ipcMain.handle('inventario:listar-lotes', async evento => {
    if (!await verificarPermiso(evento, ['administrador'])) return accesoDenegado();
    try {
        const [filas] = await baseDatos.execute(
            `SELECT l.id_lote, p.codigo, p.nombre, l.cantidad_disponible,
                    DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                    l.costo_unitario
             FROM lotes l JOIN productos p ON p.id_producto = l.id_producto
             ORDER BY l.fecha_vencimiento ASC, l.id_lote ASC`
        );
        return { ok: true, lotes: filas.map(f => ({
            id_lote: Number(f.id_lote),
            codigo: f.codigo,
            nombre: f.nombre,
            cantidad_disponible: Number(f.cantidad_disponible),
            fecha_vencimiento: f.fecha_vencimiento,
            costo_unitario: Number(f.costo_unitario)
        })) };
    } catch (error) {
        console.error('Listar lotes:', error.code || error.message);
        return { ok: false, mensaje: 'No fue posible consultar los lotes.' };
    }
});

ipcMain.handle('inventario:registrar-entrada', async (evento, datos) => {
    if (!await verificarPermiso(evento, ['administrador'])) return accesoDenegado();
    const codigo = typeof datos?.codigo === 'string' ? datos.codigo.trim().toUpperCase() : '';
    if (!codigoValido(codigo) || !enteroValido(datos?.cantidad, 1) ||
        !dineroValido(datos?.costo_unitario) || !fechaValida(datos?.fecha_vencimiento)) {
        return { ok: false, mensaje: 'Revisa producto, cantidad, costo y fecha de vencimiento.' };
    }
    const idUsuario = sesionActual.id_usuario;
    let conexion;
    let activa = false;
    try {
        conexion = await baseDatos.getConnection();
        await conexion.beginTransaction();
        activa = true;
        const [productos] = await conexion.execute(
            `SELECT id_producto, activo FROM productos WHERE codigo = ? FOR UPDATE`,
            [codigo]
        );
        if (!productos[0] || Number(productos[0].activo) !== 1) {
            await conexion.rollback();
            activa = false;
            return { ok: false, mensaje: 'Solo se admiten entradas de productos activos.' };
        }
        const [usuarios] = await conexion.execute(
            `SELECT id_usuario FROM usuarios WHERE id_usuario = ?
             AND rol = 'administrador' AND activo = 1 FOR UPDATE`,
            [idUsuario]
        );
        if (!usuarios[0]) {
            await conexion.rollback();
            activa = false;
            return accesoDenegado();
        }
        const [lote] = await conexion.execute(
            `INSERT INTO lotes
              (id_producto, cantidad_disponible, fecha_vencimiento, costo_unitario)
             VALUES (?, ?, ?, ?)`,
            [productos[0].id_producto, Number(datos.cantidad),
                datos.fecha_vencimiento, datos.costo_unitario.trim()]
        );
        await conexion.execute(
            `INSERT INTO movimientos_inventario
              (id_lote, id_usuario, tipo_movimiento, cantidad)
             VALUES (?, ?, 'entrada', ?)`,
            [lote.insertId, idUsuario, Number(datos.cantidad)]
        );
        await conexion.commit();
        activa = false;
        return { ok: true, id_lote: lote.insertId, mensaje: 'Entrada registrada correctamente.' };
    } catch (error) {
        if (conexion && activa) {
            try { await conexion.rollback(); } catch (e) {
                console.error('Rollback de entrada:', e.message);
            }
        }
        console.error('Registrar entrada:', error.code || error.message);
        return { ok: false, mensaje: 'No se registró la entrada; no se guardaron cambios parciales.' };
    } finally {
        if (conexion) conexion.release();
    }
});

require('./productos-editar-backend')({ ipcMain, baseDatos, verificarPermiso });
require('./usuarios-backend')({
    ipcMain, baseDatos, verificarPermiso,
    obtenerSesionActual: () => sesionActual
});

require('./ventas-backend')({
    ipcMain, baseDatos, verificarPermiso,
    obtenerSesionActual: () => sesionActual
});

require('./alertas-backend')({ ipcMain, baseDatos, verificarPermiso });

require('./perdidas-backend')({
    ipcMain, baseDatos, verificarPermiso,
    obtenerSesionActual: () => sesionActual
});

// #&#&# Reportes de ventas, productos y ganancia bruta estimada.
require('./reportes-backend')({ ipcMain, baseDatos, verificarPermiso });

const respaldos = require('./respaldos-backend')({
    ipcMain, app, dialog, shell, baseDatos,
    origenAutorizado, verificarPermiso,
    activarMantenimiento: estado => { modoRestauracion = estado; },
    cerrarConexiones: () => baseDatos.end()
});

app.whenReady().then(() => {
    crearVentana();
    respaldos.iniciarAutomatico();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
