// #&#&# El estado del producto se controla ÚNICAMENTE con productos.activo.
module.exports = function registrarEdicionProductos({ ipcMain, baseDatos, verificarPermiso }) {
    const denegado = () => ({ ok: false, mensaje: 'Se requiere una sesión de administrador.' });
    const dinero = v => typeof v === 'string' &&
        /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(v.trim());
    const codigoValido = c => typeof c === 'string' &&
        /^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(c);

    ipcMain.handle('productos:obtener-detalle', async (evento, codigoRecibido) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        const codigo = typeof codigoRecibido === 'string'
            ? codigoRecibido.trim().toUpperCase() : '';
        if (!codigoValido(codigo)) return { ok: false, mensaje: 'Código inválido.' };
        try {
            const [filas] = await baseDatos.execute(
                `SELECT codigo, nombre, costo_referencia, precio_venta, stock_minimo, activo
                 FROM productos WHERE codigo = ? LIMIT 1`, [codigo]
            );
            if (!filas.length) return { ok: false, mensaje: 'Producto no encontrado.' };
            const p = filas[0];
            return { ok: true, producto: {
                codigo: p.codigo, nombre: p.nombre,
                costo_referencia: String(p.costo_referencia),
                precio_venta: String(p.precio_venta),
                stock_minimo: Number(p.stock_minimo),
                activo: Number(p.activo) === 1
            }};
        } catch (error) {
            console.error('Detalle de producto:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo consultar el producto.' };
        }
    });

    ipcMain.handle('productos:modificar', async (evento, datos) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        const codigo = typeof datos?.codigo === 'string'
            ? datos.codigo.trim().toUpperCase() : '';
        const nombre = typeof datos?.nombre === 'string' ? datos.nombre.trim() : '';
        const minimoTexto = String(datos?.stock_minimo ?? '').trim();
        const minimo = Number(minimoTexto);
        if (!codigoValido(codigo) || nombre.length < 2 || nombre.length > 150 ||
            !dinero(datos?.costo_referencia) || !dinero(datos?.precio_venta) ||
            !/^\d+$/.test(minimoTexto) || !Number.isSafeInteger(minimo) ||
            minimo > 2147483647 || typeof datos?.activo !== 'boolean') {
            return { ok: false, mensaje: 'Revisa los campos y el estado del producto.' };
        }
        try {
            const [r] = await baseDatos.execute(
                `UPDATE productos
                 SET nombre = ?, costo_referencia = ?, precio_venta = ?,
                     stock_minimo = ?, activo = ?
                 WHERE codigo = ?`,
                [nombre, datos.costo_referencia.trim(), datos.precio_venta.trim(),
                    minimo, datos.activo ? 1 : 0, codigo]
            );
            if (r.affectedRows !== 1) return { ok: false, mensaje: 'Producto no encontrado.' };
            return { ok: true, mensaje: 'Producto actualizado correctamente.' };
        } catch (error) {
            console.error('Modificar producto:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudo actualizar el producto.' };
        }
    });
};
