const bcrypt = require('bcryptjs');

// #&#&# Gestión básica de cuentas: solo administradores.
module.exports = function registrarUsuarios({
    ipcMain, baseDatos, verificarPermiso, obtenerSesionActual
}) {
    const denegado = () => ({ ok: false, mensaje: 'Se requiere una sesión de administrador.' });
    const idValido = id => Number.isSafeInteger(id) && id > 0;
    const nombreValido = nombre => /^[a-z][a-z0-9._-]{3,29}$/.test(nombre);
    const claveValida = clave => typeof clave === 'string' &&
        clave.length >= 12 && Buffer.byteLength(clave, 'utf8') <= 72;

    ipcMain.handle('usuarios:listar', async evento => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        try {
            const [filas] = await baseDatos.execute(
                `SELECT id_usuario, nombre_usuario, rol, activo,
                        DATE_FORMAT(fecha_creacion, '%Y-%m-%d %H:%i') AS fecha_creacion
                 FROM usuarios WHERE nombre_usuario <> ? ORDER BY nombre_usuario ASC`,
                ['sistema_desarrollo']
            );
            return { ok: true, usuarios: filas.map(u => ({
                id_usuario: Number(u.id_usuario),
                nombre_usuario: u.nombre_usuario,
                rol: u.rol,
                activo: Number(u.activo) === 1,
                fecha_creacion: u.fecha_creacion
            })) };
        } catch (error) {
            console.error('Listar usuarios:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudieron consultar las cuentas.' };
        }
    });

    ipcMain.handle('usuarios:registrar', async (evento, datos) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        const nombre = typeof datos?.nombre_usuario === 'string'
            ? datos.nombre_usuario.trim().toLowerCase() : '';
        if (!nombreValido(nombre) || nombre === 'sistema_desarrollo' ||
            !['administrador', 'cajero'].includes(datos?.rol) ||
            !claveValida(datos?.contrasena)) {
            return { ok: false, mensaje: 'Revisa el nombre (4–30 caracteres), rol y contraseña (mínimo 12 caracteres, máximo 72 bytes).' };
        }
        try {
            const hash = await bcrypt.hash(datos.contrasena, 12);
            const [r] = await baseDatos.execute(
                `INSERT INTO usuarios
                 (nombre_usuario, contrasena_hash, rol, activo)
                 VALUES (?, ?, ?, 1)`, [nombre, hash, datos.rol]
            );
            return { ok: true, id_usuario: r.insertId, mensaje: 'Usuario registrado.' };
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return { ok: false, mensaje: 'El nombre de usuario ya existe.' };
            console.error('Registrar usuario:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo registrar el usuario.' };
        }
    });

    ipcMain.handle('usuarios:cambiar-estado', async (evento, datos) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        const id = datos?.id_usuario;
        const activo = datos?.activo;
        if (!idValido(id) || typeof activo !== 'boolean') {
            return { ok: false, mensaje: 'Selecciona usuario y estado válidos.' };
        }
        const actual = obtenerSesionActual();
        if (!actual) return denegado();
        if (id === actual.id_usuario && !activo) {
            return { ok: false, mensaje: 'No puedes desactivar tu propia cuenta.' };
        }
        let conexion;
        let iniciada = false;
        try {
            conexion = await baseDatos.getConnection();
            await conexion.beginTransaction();
            iniciada = true;
            // #&#&# Serializar cambios de administradores antes de contar los activos.
            await conexion.execute(
                `SELECT id_usuario FROM usuarios
                 WHERE rol = 'administrador' ORDER BY id_usuario FOR UPDATE`
            );
            const [filas] = await conexion.execute(
                `SELECT id_usuario, nombre_usuario, rol, activo
                 FROM usuarios WHERE id_usuario = ? FOR UPDATE`, [id]
            );
            const u = filas[0];
            if (!u || u.nombre_usuario === 'sistema_desarrollo') {
                await conexion.rollback(); iniciada = false;
                return { ok: false, mensaje: 'Usuario no disponible.' };
            }
            if (!activo && u.rol === 'administrador' && Number(u.activo) === 1) {
                const [conteo] = await conexion.execute(
                    `SELECT COUNT(*) AS total FROM usuarios
                     WHERE rol = 'administrador' AND activo = 1`
                );
                if (Number(conteo[0].total) <= 1) {
                    await conexion.rollback(); iniciada = false;
                    return { ok: false, mensaje: 'Debe quedar al menos un administrador activo.' };
                }
            }
            await conexion.execute(
                `UPDATE usuarios SET activo = ? WHERE id_usuario = ?`,
                [activo ? 1 : 0, id]
            );
            await conexion.commit(); iniciada = false;
            return { ok: true, mensaje: activo ? 'Usuario activado.' : 'Usuario desactivado.' };
        } catch (error) {
            if (conexion && iniciada) {
                try { await conexion.rollback(); } catch (e) { console.error('Rollback usuario:', e.message); }
            }
            console.error('Cambiar estado usuario:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo actualizar el estado.' };
        } finally {
            if (conexion) conexion.release();
        }
    });

    ipcMain.handle('usuarios:restablecer-clave', async (evento, datos) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        if (!idValido(datos?.id_usuario) || !claveValida(datos?.contrasena)) {
            return { ok: false, mensaje: 'Selecciona una cuenta y contraseña válida.' };
        }
        const actual = obtenerSesionActual();
        try {
            const hash = await bcrypt.hash(datos.contrasena, 12);
            const [r] = await baseDatos.execute(
                `UPDATE usuarios SET contrasena_hash = ?
                 WHERE id_usuario = ? AND nombre_usuario <> ?`,
                [hash, datos.id_usuario, 'sistema_desarrollo']
            );
            if (r.affectedRows !== 1) return { ok: false, mensaje: 'Usuario no encontrado.' };
            return {
                ok: true,
                mensaje: 'Contraseña actualizada. Las sesiones anteriores dejarán de ser válidas.',
                requiere_reingreso: actual?.id_usuario === datos.id_usuario
            };
        } catch (error) {
            console.error('Restablecer contraseña:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo actualizar la contraseña.' };
        }
    });
};
