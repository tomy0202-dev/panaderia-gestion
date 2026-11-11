// #&#&# PASO 30: CARRO DE COMPRAS MULTIPRODUCTO Y DESCUENTO FEFO
// #&#&# Solo cajeros registran ventas; los administradores consultan el historial.
// #&#&# Los precios, la disponibilidad y el orden de lotes se leen en MySQL.

module.exports = function registrarVentas({
    ipcMain,
    baseDatos,
    verificarPermiso,
    obtenerSesionActual
}) {
    const rolesVenta = ['cajero'];
    const MAX_PRODUCTOS = 60;
    const MAX_CANTIDAD = 2147483647;
    const MAX_TOTAL_CENTAVOS = 999999999999n; // #&#&# DECIMAL(12,2)

    const denegado = () => ({
        ok: false,
        mensaje: 'Solo un cajero con sesión vigente puede registrar ventas.'
    });

    function codigoValido(valor) {
        return typeof valor === 'string' &&
            /^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(valor);
    }

    function cantidadValida(valor) {
        return Number.isSafeInteger(valor) && valor >= 1 && valor <= MAX_CANTIDAD;
    }

    function centavos(valor) {
        const texto = String(valor);
        if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(texto)) {
            throw new Error('IMPORTE_INVALIDO');
        }
        const [entero, decimales = ''] = texto.split('.');
        return BigInt(entero) * 100n + BigInt(decimales.padEnd(2, '0'));
    }

    function dineroTexto(valorCentavos) {
        return `${valorCentavos / 100n}.${String(valorCentavos % 100n).padStart(2, '0')}`;
    }

    // #&#&# Todos los artículos aparecen en el catálogo, incluso inactivos
    // #&#&# o sin stock. Solo los activos con unidades permiten el botón +.
    ipcMain.handle('ventas:listar-catalogo', async evento => {
        if (!await verificarPermiso(evento, rolesVenta)) return denegado();

        try {
            const [filas] = await baseDatos.execute(
                `SELECT p.codigo, p.nombre, p.precio_venta, p.activo,
                        COALESCE(SUM(l.cantidad_disponible), 0) AS stock_total
                 FROM productos p
                 LEFT JOIN lotes l ON l.id_producto = p.id_producto
                 GROUP BY p.id_producto, p.codigo, p.nombre, p.precio_venta, p.activo
                 ORDER BY p.nombre ASC, p.codigo ASC`
            );
            return {
                ok: true,
                productos: filas.map(f => ({
                    codigo: f.codigo,
                    nombre: f.nombre,
                    precio_venta: String(f.precio_venta),
                    stock_total: Number(f.stock_total),
                    activo: Number(f.activo) === 1
                }))
            };
        } catch (error) {
            console.error('Catálogo de ventas:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo cargar el catálogo de ventas.' };
        }
    });

    // #&#&# Registrar todos los artículos del carrito en una única transacción.
    ipcMain.handle('ventas:registrar', async (evento, datos) => {
        if (!await verificarPermiso(evento, rolesVenta)) return denegado();

        const items = datos?.items;
        if (!datos || typeof datos !== 'object' || Array.isArray(datos) ||
            !Array.isArray(items) || items.length < 1 || items.length > MAX_PRODUCTOS ||
            typeof datos.aceptar_vencidos !== 'boolean' ||
            typeof datos.total_esperado !== 'string' ||
            !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(datos.total_esperado)) {
            return { ok: false, mensaje: 'El carrito o la confirmación no son válidos.' };
        }

        const codigos = new Set();
        const pedidos = [];
        for (const item of items) {
            const codigo = typeof item?.codigo === 'string'
                ? item.codigo.trim().toUpperCase() : '';
            if (!codigoValido(codigo) || !cantidadValida(item?.cantidad) ||
                codigos.has(codigo)) {
                return {
                    ok: false,
                    mensaje: 'Hay productos repetidos o cantidades inválidas en el carrito.'
                };
            }
            codigos.add(codigo);
            pedidos.push({ codigo, cantidad: item.cantidad });
        }

        // #&#&# Orden fijo de bloqueo para reducir interbloqueos entre cajas.
        pedidos.sort((a, b) => a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0);
        const sesion = obtenerSesionActual();
        if (!sesion || sesion.rol !== 'cajero') return denegado();

        let conexion;
        let transaccionActiva = false;
        try {
            conexion = await baseDatos.getConnection();
            await conexion.beginTransaction();
            transaccionActiva = true;

            // #&#&# Confirmar la cuenta dentro de la transacción.
            const [usuarios] = await conexion.execute(
                `SELECT id_usuario, rol, activo, contrasena_hash
                 FROM usuarios WHERE id_usuario = ? FOR UPDATE`,
                [sesion.id_usuario]
            );
            const usuario = usuarios[0];
            if (!usuario || Number(usuario.activo) !== 1 ||
                usuario.rol !== 'cajero' || usuario.rol !== sesion.rol ||
                usuario.contrasena_hash !== sesion.hashSesion) {
                await conexion.rollback();
                transaccionActiva = false;
                return denegado();
            }

            let totalCentavos = 0n;
            const productosVenta = [];
            const lotesVencidos = [];

            // #&#&# Primero validar y reservar con bloqueos todos los productos y lotes.
            // #&#&# Todavía no se escribe ningún cambio en inventario.
            for (const pedido of pedidos) {
                const [productos] = await conexion.execute(
                    `SELECT id_producto, codigo, nombre, precio_venta, activo
                     FROM productos WHERE codigo = ? FOR UPDATE`,
                    [pedido.codigo]
                );
                const producto = productos[0];
                if (!producto || Number(producto.activo) !== 1) {
                    await conexion.rollback();
                    transaccionActiva = false;
                    return {
                        ok: false,
                        mensaje: `${pedido.codigo} está inactivo o ya no existe. Actualiza el catálogo.`
                    };
                }

                const [lotes] = await conexion.execute(
                    `SELECT id_lote, cantidad_disponible, costo_unitario,
                            DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                            CASE WHEN fecha_vencimiento < CURDATE() THEN 1 ELSE 0 END AS vencido
                     FROM lotes
                     WHERE id_producto = ? AND cantidad_disponible > 0
                     ORDER BY fecha_vencimiento ASC, id_lote ASC FOR UPDATE`,
                    [producto.id_producto]
                );

                let pendiente = pedido.cantidad;
                const seleccion = [];
                for (const lote of lotes) {
                    if (pendiente === 0) break;
                    const disponible = Number(lote.cantidad_disponible);
                    const cantidad = Math.min(disponible, pendiente);
                    if (cantidad <= 0) continue;
                    const seleccionado = {
                        id_lote: Number(lote.id_lote),
                        cantidad,
                        costo_unitario: String(lote.costo_unitario),
                        fecha_vencimiento: lote.fecha_vencimiento,
                        vencido: Number(lote.vencido) === 1
                    };
                    seleccion.push(seleccionado);
                    if (seleccionado.vencido) {
                        lotesVencidos.push({
                            codigo: pedido.codigo,
                            nombre: producto.nombre,
                            id_lote: seleccionado.id_lote,
                            cantidad,
                            fecha_vencimiento: seleccionado.fecha_vencimiento
                        });
                    }
                    pendiente -= cantidad;
                }

                if (pendiente > 0) {
                    await conexion.rollback();
                    transaccionActiva = false;
                    return {
                        ok: false,
                        mensaje: `No hay stock suficiente de ${producto.nombre} (${pedido.codigo}). ` +
                            `Faltan ${pendiente} unidades. No se registró ninguna venta.`
                    };
                }

                const precioUnitario = String(producto.precio_venta);
                const subtotalCentavos = centavos(precioUnitario) * BigInt(pedido.cantidad);
                totalCentavos += subtotalCentavos;
                if (subtotalCentavos > MAX_TOTAL_CENTAVOS ||
                    totalCentavos > MAX_TOTAL_CENTAVOS) {
                    await conexion.rollback();
                    transaccionActiva = false;
                    return { ok: false, mensaje: 'El importe de la venta supera el límite permitido.' };
                }
                productosVenta.push({
                    codigo: pedido.codigo,
                    nombre: producto.nombre,
                    cantidad: pedido.cantidad,
                    precio_unitario: precioUnitario,
                    subtotal: dineroTexto(subtotalCentavos),
                    seleccion
                });
            }

            // #&#&# Proteger al cajero si cambiaron los precios mientras armaba el carrito.
            if (dineroTexto(totalCentavos) !== datos.total_esperado) {
                await conexion.rollback();
                transaccionActiva = false;
                return {
                    ok: false,
                    mensaje: 'El importe cambió desde que preparaste el carrito. ' +
                        'Actualiza los productos y revisa nuevamente el total.'
                };
            }

            // #&#&# Los lotes vencidos requieren autorización explícita del cajero.
            // #&#&# La segunda solicitud vuelve a calcular precios, stock y FEFO.
            if (lotesVencidos.length && !datos.aceptar_vencidos) {
                await conexion.rollback();
                transaccionActiva = false;
                return {
                    ok: false,
                    requiere_confirmacion: true,
                    mensaje: 'La venta utilizaría unidades vencidas.',
                    lotes_vencidos: lotesVencidos
                };
            }

            const total = dineroTexto(totalCentavos);
            const [venta] = await conexion.execute(
                `INSERT INTO ventas (id_usuario, fecha_venta, total)
                 VALUES (?, NOW(), ?)`,
                [sesion.id_usuario, total]
            );

            for (const articulo of productosVenta) {
                for (const lote of articulo.seleccion) {
                    const [actualizacion] = await conexion.execute(
                        `UPDATE lotes SET cantidad_disponible = cantidad_disponible - ?
                         WHERE id_lote = ? AND cantidad_disponible >= ?`,
                        [lote.cantidad, lote.id_lote, lote.cantidad]
                    );
                    if (actualizacion.affectedRows !== 1) {
                        throw new Error('STOCK_MODIFICADO');
                    }
                    const [detalle] = await conexion.execute(
                        `INSERT INTO detalle_ventas
                         (id_venta, id_lote, cantidad, precio_unitario, costo_unitario)
                         VALUES (?, ?, ?, ?, ?)`,
                        [venta.insertId, lote.id_lote, lote.cantidad,
                            articulo.precio_unitario, lote.costo_unitario]
                    );
                    await conexion.execute(
                        `INSERT INTO movimientos_inventario
                         (id_lote, id_usuario, tipo_movimiento, cantidad, id_detalle)
                         VALUES (?, ?, 'venta', ?, ?)`,
                        [lote.id_lote, sesion.id_usuario,
                            lote.cantidad, detalle.insertId]
                    );
                }
            }

            const vigente = obtenerSesionActual();
            if (!vigente || vigente.id_usuario !== sesion.id_usuario ||
                vigente.rol !== 'cajero' || vigente.hashSesion !== sesion.hashSesion) {
                throw new Error('SESION_CAMBIADA_DURANTE_VENTA');
            }

            await conexion.commit();
            transaccionActiva = false;
            return {
                ok: true,
                mensaje: 'Venta registrada correctamente.',
                venta: {
                    id_venta: Number(venta.insertId),
                    total,
                    productos: productosVenta.map(p => ({
                        codigo: p.codigo,
                        nombre: p.nombre,
                        cantidad: p.cantidad,
                        precio_unitario: p.precio_unitario,
                        subtotal: p.subtotal,
                        lotes_utilizados: p.seleccion.map(l => ({
                            id_lote: l.id_lote,
                            cantidad: l.cantidad,
                            fecha_vencimiento: l.fecha_vencimiento
                        }))
                    }))
                }
            };
        } catch (error) {
            if (conexion && transaccionActiva) {
                try { await conexion.rollback(); } catch (fallo) {
                    console.error('Rollback de venta:', fallo.message);
                }
            }
            console.error('Venta múltiple:', error.code || error.message);
            return {
                ok: false,
                mensaje: 'No se registró ninguna parte de la venta. Revisa el catálogo e inténtalo de nuevo.'
            };
        } finally {
            if (conexion) conexion.release();
        }
    });

    // #&#&# HISTORIAL: CONSULTAR VENTAS, SOLO ADMINISTRADOR
    // #&#&# Filtros aplicados en MySQL y paginación real de 25 resultados.
    // #&#&# Las fechas mostradas se formatean en la zona horaria de MySQL.

    function fechaValida(valor) {
        if (typeof valor !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(valor) ||
            Number(valor.slice(0, 4)) < 1000) return false;

        const fecha = new Date(`${valor}T00:00:00.000Z`);
        return !Number.isNaN(fecha.getTime()) &&
            fecha.toISOString().slice(0, 10) === valor;
    }

    const denegadoHistorial = () => ({
        ok: false,
        mensaje: 'Solo el administrador puede consultar el historial de ventas.'
    });

    ipcMain.handle('ventas:listar-historial', async (evento, filtros = {}) => {
        if (!await verificarPermiso(evento, ['administrador'])) {
            return denegadoHistorial();
        }

        if (!filtros || typeof filtros !== 'object' || Array.isArray(filtros)) {
            return { ok: false, mensaje: 'Filtros de búsqueda no válidos.' };
        }

        const pagina = filtros.pagina === undefined ? 1 : filtros.pagina;
        const desde = filtros.desde === undefined ? '' : filtros.desde;
        const hasta = filtros.hasta === undefined ? '' : filtros.hasta;
        const cajero = typeof filtros.cajero === 'string'
            ? filtros.cajero.trim() : '';
        const numeroVenta = filtros.numero_venta === undefined
            ? '' : String(filtros.numero_venta).trim();

        if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10000 ||
            typeof desde !== 'string' || (desde && !fechaValida(desde)) ||
            typeof hasta !== 'string' || (hasta && !fechaValida(hasta)) ||
            typeof filtros.cajero !== 'undefined' &&
                (typeof filtros.cajero !== 'string' || filtros.cajero.length > 50) ||
            cajero.length > 50 ||
            (numeroVenta && (!/^\d{1,15}$/.test(numeroVenta) ||
                !Number.isSafeInteger(Number(numeroVenta)))) ||
            (desde && hasta && desde > hasta)) {
            return { ok: false, mensaje: 'Revisa las fechas y los filtros de búsqueda.' };
        }

        const condiciones = [];
        const parametros = [];

        if (desde) {
            condiciones.push('v.fecha_venta >= ?');
            parametros.push(`${desde} 00:00:00`);
        }
        if (hasta) {
            condiciones.push('v.fecha_venta < DATE_ADD(?, INTERVAL 1 DAY)');
            parametros.push(hasta);
        }
        if (cajero) {
            // #&#&# LOCATE trata el texto literalmente, sin comodines SQL.
            condiciones.push('LOCATE(LOWER(?), LOWER(u.nombre_usuario)) > 0');
            parametros.push(cajero);
        }
        if (numeroVenta) {
            condiciones.push('v.id_venta = ?');
            parametros.push(Number(numeroVenta));
        }

        const donde = condiciones.length
            ? `WHERE ${condiciones.join(' AND ')}` : '';
        const cantidadPorPagina = 25;

        try {
            const [conteos] = await baseDatos.execute(
                `SELECT COUNT(*) AS total_registros,
                        COALESCE(SUM(v.total), 0) AS importe_total
                 FROM ventas v
                 JOIN usuarios u ON u.id_usuario = v.id_usuario
                 ${donde}`,
                parametros
            );

            const totalRegistros = Number(conteos[0].total_registros);
            const totalPaginas = Math.max(1, Math.ceil(totalRegistros / cantidadPorPagina));
            const paginaEfectiva = Math.min(pagina, totalPaginas);
            const desplazamiento = (paginaEfectiva - 1) * cantidadPorPagina;
            const [filas] = await baseDatos.execute(
                `SELECT
                    v.id_venta,
                    DATE_FORMAT(v.fecha_venta, '%Y-%m-%d %H:%i:%s') AS fecha_venta,
                    u.nombre_usuario AS responsable,
                    v.total,
                    COALESCE(SUM(d.cantidad), 0) AS unidades,
                    COUNT(DISTINCT l.id_producto) AS tipos_productos,
                    GROUP_CONCAT(DISTINCT p.nombre ORDER BY p.nombre SEPARATOR ', ') AS productos
                 FROM ventas v
                 JOIN usuarios u ON u.id_usuario = v.id_usuario
                 LEFT JOIN detalle_ventas d ON d.id_venta = v.id_venta
                 LEFT JOIN lotes l ON l.id_lote = d.id_lote
                 LEFT JOIN productos p ON p.id_producto = l.id_producto
                 ${donde}
                 GROUP BY v.id_venta, v.fecha_venta, u.nombre_usuario, v.total
                 ORDER BY v.fecha_venta DESC, v.id_venta DESC
                 LIMIT ? OFFSET ?`,
                [...parametros, cantidadPorPagina, desplazamiento]
            );

            return {
                ok: true,
                pagina: paginaEfectiva,
                tamano_pagina: cantidadPorPagina,
                total_registros: totalRegistros,
                importe_total: String(conteos[0].importe_total),
                ventas: filas.map(f => ({
                    id_venta: Number(f.id_venta),
                    fecha_venta: f.fecha_venta,
                    responsable: f.responsable,
                    total: String(f.total),
                    unidades: Number(f.unidades),
                    tipos_productos: Number(f.tipos_productos),
                    productos: f.productos || 'Sin detalle'
                }))
            };
        } catch (error) {
            console.error('Consultar historial de ventas:', error.code || error.message);
            return { ok: false, mensaje: 'No fue posible consultar el historial de ventas.' };
        }
    });

    // #&#&# DETALLE: LOTES Y PRECIOS HISTÓRICOS DE UNA VENTA.
    // #&#&# Se consulta, pero no se modifica ni se anula desde esta pantalla.
    ipcMain.handle('ventas:obtener-detalle', async (evento, idVenta) => {
        if (!await verificarPermiso(evento, ['administrador'])) {
            return denegadoHistorial();
        }

        if (!Number.isSafeInteger(idVenta) || idVenta <= 0) {
            return { ok: false, mensaje: 'Selecciona una venta válida.' };
        }

        try {
            const [ventas] = await baseDatos.execute(
                `SELECT v.id_venta,
                        DATE_FORMAT(v.fecha_venta, '%Y-%m-%d %H:%i:%s') AS fecha_venta,
                        v.total, u.nombre_usuario AS responsable
                 FROM ventas v
                 JOIN usuarios u ON u.id_usuario = v.id_usuario
                 WHERE v.id_venta = ? LIMIT 1`,
                [idVenta]
            );

            if (!ventas.length) {
                return { ok: false, mensaje: 'Esa venta no existe.' };
            }

            const [lineas] = await baseDatos.execute(
                `SELECT d.id_detalle, l.id_lote, p.codigo,
                        p.nombre AS nombre_actual,
                        DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS vencimiento,
                        d.cantidad, d.precio_unitario,
                        d.costo_unitario, d.subtotal
                 FROM detalle_ventas d
                 JOIN lotes l ON l.id_lote = d.id_lote
                 JOIN productos p ON p.id_producto = l.id_producto
                 WHERE d.id_venta = ?
                 ORDER BY d.id_detalle ASC`,
                [idVenta]
            );

            return {
                ok: true,
                venta: {
                    id_venta: Number(ventas[0].id_venta),
                    fecha_venta: ventas[0].fecha_venta,
                    responsable: ventas[0].responsable,
                    total: String(ventas[0].total),
                    detalles: lineas.map(d => ({
                        id_detalle: Number(d.id_detalle),
                        id_lote: Number(d.id_lote),
                        codigo: d.codigo,
                        nombre_actual: d.nombre_actual,
                        vencimiento: d.vencimiento,
                        cantidad: Number(d.cantidad),
                        precio_unitario: String(d.precio_unitario),
                        costo_unitario: String(d.costo_unitario),
                        subtotal: String(d.subtotal)
                    }))
                }
            };
        } catch (error) {
            console.error('Detalle de venta:', error.code || error.message);
            return { ok: false, mensaje: 'No fue posible consultar el detalle de la venta.' };
        }
    });
};
