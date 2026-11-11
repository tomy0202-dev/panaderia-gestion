
const path = require('node:path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

require('dotenv').config({
    path: path.join(__dirname, '.env')
});

// #&#&# Solicitar una contraseña sin mostrarla
async function solicitarContrasena(password, rol) {

    while (true) {

        const primera = await password({
            message: `Contraseña para ${rol}:`,
            mask: '*',
            toggleMask: false,

            validate: (valor) => {
                const longitud = Buffer.byteLength(
                    valor,
                    'utf8'
                );

                if (longitud < 12 || longitud > 72) {
                    return (
                        'Utiliza una contraseña de ' +
                        '12 a 72 bytes.'
                    );
                }

                return true;
            }
        });

        const segunda = await password({
            message: `Repite la contraseña de ${rol}:`,
            mask: '*',
            toggleMask: false
        });

        if (primera === segunda) {
            return primera;
        }

        console.log(
            'Las contraseñas no coinciden. Inténtalo nuevamente.'
        );
    }
}

// #&#&# Crear las cuentas iniciales
async function iniciar() {

    const { password } = await import(
        '@inquirer/prompts'
    );

    let conexion;
    let transaccion = false;

    try {
        conexion = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // #&#&# No crear cuentas iniciales si ya existen
        // #&#&# usuarios humanos activos.
        const [conteo] = await conexion.execute(
            `SELECT COUNT(*) AS total
             FROM usuarios
             WHERE activo = 1`
        );

        if (Number(conteo[0].total) > 0) {
            console.log(
                'Ya existen usuarios activos. ' +
                'No se crearán cuentas iniciales adicionales.'
            );
            return;
        }

        // #&#&# Comprobar los nombres reservados
        const [existentes] = await conexion.execute(
            `SELECT nombre_usuario
             FROM usuarios
             WHERE nombre_usuario IN (?, ?)`,
            ['admin_principal', 'cajero_principal']
        );

        if (existentes.length > 0) {
            console.log(
                'Uno de los nombres iniciales ya existe. ' +
                'Revisa la tabla usuarios antes de continuar.'
            );
            return;
        }

        console.log(
            '\nCONFIGURACIÓN INICIAL DE USUARIOS'
        );

        console.log(
            'Las contraseñas no aparecerán en pantalla.'
        );

        // #&#&# Solicitar contraseñas individuales
        const claveAdministrador =
            await solicitarContrasena(
                password,
                'admin_principal'
            );

        const claveCajero =
            await solicitarContrasena(
                password,
                'cajero_principal'
            );

        if (claveAdministrador === claveCajero) {
            console.log(
                'Administrador y cajero deben utilizar ' +
                'contraseñas diferentes.'
            );
            return;
        }

        // #&#&# Generar hashes seguros
        const hashAdministrador = await bcrypt.hash(
            claveAdministrador,
            12
        );

        const hashCajero = await bcrypt.hash(
            claveCajero,
            12
        );

        // #&#&# Guardar ambas cuentas en una transacción
        await conexion.beginTransaction();
        transaccion = true;

        await conexion.execute(
            `INSERT INTO usuarios (
                nombre_usuario,
                contrasena_hash,
                rol,
                activo
             )
             VALUES (?, ?, 'administrador', 1)`,
            ['admin_principal', hashAdministrador]
        );

        await conexion.execute(
            `INSERT INTO usuarios (
                nombre_usuario,
                contrasena_hash,
                rol,
                activo
             )
             VALUES (?, ?, 'cajero', 1)`,
            ['cajero_principal', hashCajero]
        );

        await conexion.commit();
        transaccion = false;

        console.log(
            '\nUsuarios creados correctamente:'
        );

        console.log(
            '- admin_principal: administrador'
        );

        console.log(
            '- cajero_principal: cajero'
        );

        console.log(
            '\nLas contraseñas se almacenaron como hashes.'
        );

    } catch (error) {

        if (conexion && transaccion) {
            await conexion.rollback();
        }

        console.error(
            'Error al configurar usuarios:',
            error.code || error.message
        );

        process.exitCode = 1;

    } finally {

        if (conexion) {
            await conexion.end();
        }
    }
}

iniciar();
