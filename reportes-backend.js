// #&#&# PASO 31: REPORTES ADMINISTRATIVOS
// #&#&# Cálculos con precios y costos HISTÓRICOS de detalle_ventas.
// #&#&# Ganancia bruta estimada = ingreso de artículos vendidos - costo de artículos vendidos.
// #&#&# Las pérdidas por vencimiento se muestran SEPARADAS, no son gastos generales.

module.exports = function registrarReportes({ ipcMain, baseDatos, verificarPermiso }) {
    const denegado = () => ({
        ok: false, mensaje: 'Solo el administrador puede consultar reportes.'
    });

    function fechaValida(valor) {
        if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
        const fecha = new Date(`${valor}T00:00:00.000Z`);
        return Number(valor.slice(0, 4)) >= 1000 &&
            !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
    }

    ipcMain.handle('reportes:consultar', async (evento, filtros) => {
        if (!await verificarPermiso(evento, ['administrador'])) return denegado();
        if (!filtros || typeof filtros !== 'object' || Array.isArray(filtros) ||
            !fechaValida(filtros.desde) || !fechaValida(filtros.hasta) ||
            filtros.desde > filtros.hasta) {
            return { ok: false, mensaje: 'Selecciona un período de fechas válido.' };
        }

        const fechas = [filtros.desde, filtros.hasta];
        // #&#&# Incluir la fecha final completa con un límite superior exclusivo.
        const periodoVenta = `v.fecha_venta >= ? AND
            v.fecha_venta < DATE_ADD(?, INTERVAL 1 DAY)`;
        const periodoPerdida = `pv.fecha_registro >= ? AND
            pv.fecha_registro < DATE_ADD(?, INTERVAL 1 DAY)`;

        try {
            // #&#&# Cada consulta utiliza los mismos límites de fecha.
            const [ventas] = await baseDatos.execute(
                `SELECT COUNT(*) AS numero_ventas,
                        COALESCE(SUM(v.total), 0) AS ingresos_ventas
                 FROM ventas v WHERE ${periodoVenta}`,
                fechas
            );

            const [costos] = await baseDatos.execute(
                `SELECT COALESCE(SUM(d.cantidad), 0) AS unidades_vendidas,
                        COALESCE(SUM(d.cantidad * d.precio_unitario), 0) AS ingresos_detalle,
                        COALESCE(SUM(d.cantidad * d.costo_unitario), 0) AS costo_vendido,
                        COALESCE(SUM(d.cantidad *
                            (d.precio_unitario - d.costo_unitario)), 0) AS ganancia_bruta
                 FROM detalle_ventas d
                 JOIN ventas v ON v.id_venta = d.id_venta
                 WHERE ${periodoVenta}`,
                fechas
            );

            const [diarios] = await baseDatos.execute(
                `SELECT DATE_FORMAT(v.fecha_venta, '%Y-%m-%d') AS dia,
                        COUNT(*) AS numero_ventas,
                        COALESCE(SUM(v.total), 0) AS ingresos
                 FROM ventas v
                 WHERE ${periodoVenta}
                 GROUP BY DATE_FORMAT(v.fecha_venta, '%Y-%m-%d')
                 ORDER BY dia ASC`,
                fechas
            );

            // #&#&# El nombre es el ACTUAL; código identifica el artículo.
            // #&#&# Los importes y costos se leen del detalle histórico.
            const [productos] = await baseDatos.execute(
                `SELECT p.codigo, p.nombre AS nombre_actual,
                        SUM(d.cantidad) AS unidades,
                        COUNT(DISTINCT d.id_venta) AS ventas_con_producto,
                        COALESCE(SUM(d.cantidad * d.precio_unitario), 0) AS ingresos,
                        COALESCE(SUM(d.cantidad * d.costo_unitario), 0) AS costo,
                        COALESCE(SUM(d.cantidad *
                            (d.precio_unitario - d.costo_unitario)), 0) AS ganancia_bruta
                 FROM detalle_ventas d
                 JOIN ventas v ON v.id_venta = d.id_venta
                 JOIN lotes l ON l.id_lote = d.id_lote
                 JOIN productos p ON p.id_producto = l.id_producto
                 WHERE ${periodoVenta}
                 GROUP BY p.id_producto, p.codigo, p.nombre
                 ORDER BY unidades DESC, ingresos DESC, p.nombre ASC
                 LIMIT 100`,
                fechas
            );

            const [perdidas] = await baseDatos.execute(
                `SELECT COUNT(*) AS registros,
                        COALESCE(SUM(pv.cantidad), 0) AS unidades,
                        COALESCE(SUM(pv.valor_perdida), 0) AS valor
                 FROM perdidas_vencimiento pv
                 WHERE ${periodoPerdida}`,
                fechas
            );

            const ventasResumen = ventas[0];
            const costosResumen = costos[0];
            const perdidasResumen = perdidas[0];

            return {
                ok: true,
                periodo: { desde: filtros.desde, hasta: filtros.hasta },
                resumen: {
                    numero_ventas: Number(ventasResumen.numero_ventas),
                    ingresos_ventas: String(ventasResumen.ingresos_ventas),
                    unidades_vendidas: Number(costosResumen.unidades_vendidas),
                    ingresos_detalle: String(costosResumen.ingresos_detalle),
                    costo_vendido: String(costosResumen.costo_vendido),
                    ganancia_bruta: String(costosResumen.ganancia_bruta)
                },
                ventas_diarias: diarios.map(f => ({
                    dia: f.dia,
                    numero_ventas: Number(f.numero_ventas),
                    ingresos: String(f.ingresos)
                })),
                productos: productos.map(f => ({
                    codigo: f.codigo,
                    nombre_actual: f.nombre_actual,
                    unidades: Number(f.unidades),
                    ventas_con_producto: Number(f.ventas_con_producto),
                    ingresos: String(f.ingresos),
                    costo: String(f.costo),
                    ganancia_bruta: String(f.ganancia_bruta)
                })),
                perdidas_vencimiento: {
                    registros: Number(perdidasResumen.registros),
                    unidades: Number(perdidasResumen.unidades),
                    valor: String(perdidasResumen.valor)
                }
            };
        } catch (error) {
            console.error('Reportes administrativos:', error.code || error.message);
            return { ok: false, mensaje: 'No se pudieron calcular los reportes del período.' };
        }
    });
};
