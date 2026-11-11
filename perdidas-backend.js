// #&#&# PASO 31: RETIRO MANUAL DE MERCANCÍA VENCIDA
// #&#&# Los datos se registran en perdidas_vencimiento y movimientos_inventario.
// #&#&# Las existencias se descuentan de lotes en una única transacción.

module.exports = function registrarPerdidas({
    ipcMain, baseDatos, verificarPermiso, obtenerSesionActual
}) {
    const denegado = () => ({
        ok: false,
        mensaje: 'Solo un administrador puede registrar o consultar pérdidas.'
    });
    const enteroPositivo = valor =>
        Number.isSafeInteger(valor) && valor >= 1 && valor <= 2147483647;

    function fechaValida(valor) {
        if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
        const fecha = new Date(`${valor}T00:00:00.000Z`);
        return Number(valor.slice(0, 4)) >= 1000 &&
            !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
    }

    function cantidadDeCentavos(valor) {
        const texto = String(valor);
        if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(texto)) {
            throw new Error('COSTO_LOTE_INVALIDO');
        }
        const [parte, decimales = ''] = texto.split('.');
        return BigInt(parte) * 100n + BigInt(decimales.padEnd(2, '0'));
    }

    // #&#&# Mostrar los lotes que realmente han vencido, tengan o no el producto activo.
    ipcMain.handle('perdidas:listar-lotes-vencidos', async evento => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        try {
            const [filas] = await baseDatos.execute(
                `SELECT l.id_lote, p.codigo, p.nombre, p.activo,
                        l.cantidad_disponible, l.costo_unitario,
                        DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento
                 FROM lotes l
                 JOIN productos p ON p.id_producto = l.id_producto
                 WHERE l.cantidad_disponible > 0
                   AND l.fecha_vencimiento < CURDATE()
                 ORDER BY l.fecha_vencimiento ASC, p.nombre ASC, l.id_lote ASC`
            );
            return {
                ok: true,
                lotes: filas.map(f => ({
                    id_lote: Number(f.id_lote),
                    codigo: f.codigo,
                    nombre: f.nombre,
                    activo: Number(f.activo) === 1,
                    cantidad_disponible: Number(f.cantidad_disponible),
                    costo_unitario: String(f.costo_unitario),
                    fecha_vencimiento: f.fecha_vencimiento
                }))
            };
        } catch (error) {
            console.error('Consultar lotes vencidos:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudieron cargar los lotes vencidos.' };
        }
    });

    // #&#&# Confirmar un retiro: verificar vigencia, bloquear producto y lote,
    // #&#&# descontar stock, registrar pérdida y movimiento. Todo o nada.
    ipcMain.handle('perdidas:registrar', async (evento, datos) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();

        const idLote = datos?.id_lote;
        const cantidad = datos?.cantidad;
        const observacion = typeof datos?.observacion === 'string'
            ? datos.observacion.trim() : null;
        if (!datos || typeof datos !== 'object' || Array.isArray(datos) ||
            !enteroPositivo(idLote) || !enteroPositivo(cantidad) ||
            observacion === null || observacion.length > 255) {
            return {
                ok: false,
                mensaje: 'Selecciona un lote y una cantidad válidos. La observación admite 255 caracteres.'
            };
        }

        const sesion = obtenerSesionActual();
        if (!sesion || sesion.rol !== 'administrador') return denegado();

        let conexion;
        let activa = false;
        try {
            conexion = await baseDatos.getConnection();
            await conexion.beginTransaction();
            activa = true;

            // #&#&# Orden de bloqueos coherente con las ventas: usuario → producto → lote.
            const [usuarios] = await conexion.execute(
                `SELECT id_usuario, rol, activo, contrasena_hash
                 FROM usuarios WHERE id_usuario = ? FOR UPDATE`,
                [sesion.id_usuario]
            );
            const usuario = usuarios[0];
            if (!usuario || Number(usuario.activo) !== 1 ||
                usuario.rol !== 'administrador' ||
                usuario.contrasena_hash !== sesion.hashSesion) {
                await conexion.rollback();
                activa = false;
                return denegado();
            }

            // #&#&# Obtener la pertenencia del lote para bloquear también su producto.
            const [referencias] = await conexion.execute(
                `SELECT id_producto FROM lotes WHERE id_lote = ?`, [idLote]
            );
            if (referencias.length !== 1) {
                await conexion.rollback();
                activa = false;
                return { ok: false, mensaje: 'El lote seleccionado no existe.' };
            }
            const [productos] = await conexion.execute(
                `SELECT id_producto, codigo, nombre FROM productos
                 WHERE id_producto = ? FOR UPDATE`,
                [referencias[0].id_producto]
            );
            if (!productos.length) {
                throw new Error('PRODUCTO_ASOCIADO_NO_EXISTE');
            }
            const [lotes] = await conexion.execute(
                `SELECT id_producto, cantidad_disponible, costo_unitario,
                        DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                        CASE WHEN fecha_vencimiento < CURDATE() THEN 1 ELSE 0 END AS vencido
                 FROM lotes WHERE id_lote = ? FOR UPDATE`,
                [idLote]
            );
            const lote = lotes[0];
            if (!lote || Number(lote.id_producto) !== Number(productos[0].id_producto)) {
                throw new Error('LOTE_NO_COINCIDE_CON_PRODUCTO');
            }
            if (Number(lote.vencido) !== 1) {
                await conexion.rollback();
                activa = false;
                return {
                    ok: false,
                    mensaje: 'Solo pueden retirarse como pérdida los lotes vencidos antes de hoy.'
                };
            }
            if (Number(lote.cantidad_disponible) < cantidad) {
                await conexion.rollback();
                activa = false;
                return {
                    ok: false,
                    mensaje: `El lote solo tiene ${lote.cantidad_disponible} unidad(es). Actualiza la lista.`
                };
            }

            // #&#&# Evitar desbordar el DECIMAL(14,2) del valor de pérdida.
            const centavos = cantidadDeCentavos(lote.costo_unitario) * BigInt(cantidad);
            if (centavos > 999999999999999n) {
                await conexion.rollback();
                activa = false;
                return { ok: false, mensaje: 'El valor de la pérdida supera el máximo permitido.' };
            }

            const [actualizacion] = await conexion.execute(
                `UPDATE lotes SET cantidad_disponible = cantidad_disponible - ?
                 WHERE id_lote = ? AND cantidad_disponible >= ?`,
                [cantidad, idLote, cantidad]
            );
            if (actualizacion.affectedRows !== 1) {
                throw new Error('EXISTENCIAS_MODIFICADAS');
            }
            const [registro] = await conexion.execute(
                `INSERT INTO perdidas_vencimiento
                 (id_lote, id_usuario, cantidad, costo_unitario, observacion)
                 VALUES (?, ?, ?, ?, ?)`,
                [idLote, sesion.id_usuario, cantidad, String(lote.costo_unitario),
                    observacion || null]
            );
            await conexion.execute(
                `INSERT INTO movimientos_inventario
                 (id_lote, id_usuario, tipo_movimiento, cantidad, id_perdida)
                 VALUES (?, ?, 'perdida_vencimiento', ?, ?)`,
                [idLote, sesion.id_usuario, cantidad, registro.insertId]
            );

            const vigente = obtenerSesionActual();
            if (!vigente || vigente.id_usuario !== sesion.id_usuario ||
                vigente.rol !== 'administrador' || vigente.hashSesion !== sesion.hashSesion) {
                throw new Error('SESION_CAMBIADA');
            }
            await conexion.commit();
            activa = false;
            return {
                ok: true,
                mensaje: 'Pérdida por vencimiento registrada. Se descontó el lote.',
                registro: {
                    id_perdida: Number(registro.insertId),
                    id_lote: idLote,
                    producto: productos[0].nombre,
                    cantidad,
                    valor_perdida: `${centavos / 100n}.${String(centavos % 100n).padStart(2, '0')}`
                }
            };
        } catch (error) {
            if (conexion && activa) {
                try { await conexion.rollback(); } catch (fallo) {
                    console.error('Rollback de pérdida:', fallo.message);
                }
            }
            console.error('Registrar pérdida:', error.code || error.message);
            return {
                ok: false,
                mensaje: 'La pérdida no se registró y no se descontó parcialmente el inventario.'
            };
        } finally {
            if (conexion) conexion.release();
        }
    });

    // #&#&# Historial de retiros manuales: 25 resultados por página.
    ipcMain.handle('perdidas:listar', async (evento, filtros = {}) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        if (!filtros || typeof filtros !== 'object' || Array.isArray(filtros)) {
            return { ok: false, mensaje: 'Filtros de pérdidas no válidos.' };
        }
        const pagina = filtros.pagina === undefined ? 1 : filtros.pagina;
        const desde = filtros.desde === undefined ? '' : filtros.desde;
        const hasta = filtros.hasta === undefined ? '' : filtros.hasta;
        if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10000 ||
            typeof desde !== 'string' || (desde && !fechaValida(desde)) ||
            typeof hasta !== 'string' || (hasta && !fechaValida(hasta)) ||
            (desde && hasta && desde > hasta)) {
            return { ok: false, mensaje: 'Comprueba las fechas de búsqueda.' };
        }
        const condiciones = [];
        const parametros = [];
        if (desde) {
            condiciones.push('pv.fecha_registro >= ?');
            parametros.push(`${desde} 00:00:00`);
        }
        if (hasta) {
            condiciones.push('pv.fecha_registro < DATE_ADD(?, INTERVAL 1 DAY)');
            parametros.push(hasta);
        }
        const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
        try {
            const [totales] = await baseDatos.execute(
                `SELECT COUNT(*) AS total_registros,
                        COALESCE(SUM(pv.valor_perdida), 0) AS valor_total
                 FROM perdidas_vencimiento pv ${donde}`,
                parametros
            );
            const totalRegistros = Number(totales[0].total_registros);
            const paginas = Math.max(1, Math.ceil(totalRegistros / 25));
            const actual = Math.min(pagina, paginas);
            const [filas] = await baseDatos.execute(
                `SELECT pv.id_perdida, pv.id_lote, p.codigo, p.nombre,
                        u.nombre_usuario AS responsable,
                        DATE_FORMAT(pv.fecha_registro, '%Y-%m-%d %H:%i:%s') AS fecha_registro,
                        DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                        pv.cantidad, pv.costo_unitario, pv.valor_perdida, pv.observacion
                 FROM perdidas_vencimiento pv
                 JOIN lotes l ON l.id_lote = pv.id_lote
                 JOIN productos p ON p.id_producto = l.id_producto
                 JOIN usuarios u ON u.id_usuario = pv.id_usuario
                 ${donde}
                 ORDER BY pv.fecha_registro DESC, pv.id_perdida DESC
                 LIMIT ? OFFSET ?`,
                [...parametros, 25, (actual - 1) * 25]
            );
            return {
                ok: true,
                pagina: actual,
                paginas,
                total_registros: totalRegistros,
                valor_total: String(totales[0].valor_total),
                perdidas: filas.map(f => ({
                    id_perdida: Number(f.id_perdida),
                    id_lote: Number(f.id_lote),
                    codigo: f.codigo,
                    nombre: f.nombre,
                    responsable: f.responsable,
                    fecha_registro: f.fecha_registro,
                    fecha_vencimiento: f.fecha_vencimiento,
                    cantidad: Number(f.cantidad),
                    costo_unitario: String(f.costo_unitario),
                    valor_perdida: String(f.valor_perdida),
                    observacion: f.observacion || ''
                }))
            };
        } catch (error) {
            console.error('Consultar pérdidas:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo consultar el historial de pérdidas.' };
        }
    });
};
