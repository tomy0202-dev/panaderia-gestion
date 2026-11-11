// #&#&# PASO 30: ALERTAS INFORMATIVAS DE INVENTARIO
// #&#&# No descuenta unidades, no desactiva productos, no elimina lotes.
module.exports = function registrarAlertas({ ipcMain, baseDatos, verificarPermiso }) {
    ipcMain.handle('alertas:consultar', async evento => {
        if (!await verificarPermiso(evento, ['administrador'])) {
            return {
                ok: false,
                mensaje: 'Solo el administrador puede consultar alertas de inventario.'
            };
        }
        try {
            // #&#&# Stock mínimo: solo productos activos; incluye stock cero.
            const [minimos] = await baseDatos.execute(
                `SELECT p.codigo, p.nombre, p.stock_minimo,
                        COALESCE(SUM(l.cantidad_disponible), 0) AS stock_total
                 FROM productos p
                 LEFT JOIN lotes l ON l.id_producto = p.id_producto
                 WHERE p.activo = 1
                 GROUP BY p.id_producto, p.codigo, p.nombre, p.stock_minimo
                 HAVING stock_total <= p.stock_minimo
                 ORDER BY p.nombre ASC, p.codigo ASC`
            );

            // #&#&# Próximos a vencer: hoy y los próximos tres días.
            // #&#&# Vencidos: todas las fechas anteriores a hoy.
            // #&#&# Los lotes inactivos también se incluyen si conservan unidades:
            // #&#&# siguen representando posibles pérdidas físicas del negocio.
            const [lotes] = await baseDatos.execute(
                `SELECT l.id_lote, p.codigo, p.nombre, p.activo,
                        l.cantidad_disponible,
                        DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
                        DATEDIFF(l.fecha_vencimiento, CURDATE()) AS dias_restantes
                 FROM lotes l
                 JOIN productos p ON p.id_producto = l.id_producto
                 WHERE l.cantidad_disponible > 0
                   AND l.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
                 ORDER BY l.fecha_vencimiento ASC, l.id_lote ASC`
            );
            const fechas = lotes.map(f => ({
                id_lote: Number(f.id_lote),
                codigo: f.codigo,
                nombre: f.nombre,
                activo: Number(f.activo) === 1,
                cantidad_disponible: Number(f.cantidad_disponible),
                fecha_vencimiento: f.fecha_vencimiento,
                dias_restantes: Number(f.dias_restantes)
            }));
            return {
                ok: true,
                stock_bajo: minimos.map(f => ({
                    codigo: f.codigo,
                    nombre: f.nombre,
                    stock_minimo: Number(f.stock_minimo),
                    stock_total: Number(f.stock_total)
                })),
                proximos: fechas.filter(f => f.dias_restantes >= 0),
                vencidos: fechas.filter(f => f.dias_restantes < 0)
            };
        } catch (error) {
            console.error('Consulta de alertas:', error.code || error.message);
            return {
                ok: false,
                mensaje: 'No se pudieron consultar las alertas de inventario.'
            };
        }
    });
};
