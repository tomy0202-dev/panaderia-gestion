
const mysql = require('mysql2/promise');

async function comprobarBaseDatos() {
    let conexion;

    try {
        // Conectarse a MySQL con la configuración local
        conexion = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Conexión a MySQL exitosa.');

        // Consultar el producto registrado anteriormente
        const [productos] = await conexion.execute(
            `SELECT
                p.codigo,
                p.nombre,
                COALESCE(
                    SUM(l.cantidad_disponible), 0
                ) AS stock_total
             FROM productos p
             LEFT JOIN lotes l
                ON p.id_producto = l.id_producto
             WHERE p.codigo = ?
             GROUP BY
                p.id_producto,
                p.codigo,
                p.nombre`,
            ['GAS-400']
        );

        if (productos.length === 0) {
            console.log('No se encontró GAS-400.');
        } else {
            console.table(productos);
        }

    } catch (error) {
        console.error(
            'Error al consultar MySQL:',
            error.code || error.message
        );
    } finally {
        if (conexion) {
            await conexion.end();
        }
    }
}

comprobarBaseDatos();
