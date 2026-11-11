'use strict';

// #&#&# PASO 32. RESPALDOS Y RESTAURACIÓN DE MYSQL
// #&#&# Solo funciona en el proceso principal de Electron.
// #&#&# No recibe rutas arbitrarias desde la interfaz.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const DIA_MS = 24 * 60 * 60 * 1000;
const INTERVALO_REVISION_MS = 60 * 1000;
const INTERVALO_REINTENTO_MS = 30 * 60 * 1000;
const MAX_COPIAS = 3;
const NOMBRE_COPIA = /^panaderia_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql$/;

function registrarRespaldos({
    ipcMain, app, dialog, shell, baseDatos,
    origenAutorizado, verificarPermiso,
    activarMantenimiento, cerrarConexiones
}) {
    const directorio = path.join(app.getPath('userData'), 'respaldos');
    const directorioEmergencia = path.join(
        app.getPath('userData'), 'recuperacion_pre_restauracion'
    );

    let ocupado = false;
    let restauracionCerrada = false;
    let ultimoErrorAutomatico = '';
    let ultimoIntentoAutomatico = 0;
    let intervalo = null;

    const errorRespuesta = mensaje => ({ ok: false, mensaje });

    function configuracionMySQL() {
        const nombre = process.env.DB_NAME || '';
        if (!/^[A-Za-z0-9_]+$/.test(nombre)) {
            throw new Error('DB_NAME de .env debe contener solamente letras, números o guiones bajos.');
        }
        const puerto = Number(process.env.DB_PORT || 3306);
        if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
            throw new Error('DB_PORT de .env no es válido.');
        }
        if (!process.env.DB_HOST || !process.env.DB_USER ||
            typeof process.env.DB_PASSWORD !== 'string') {
            throw new Error('Revisa DB_HOST, DB_USER y DB_PASSWORD en .env.');
        }
        return {
            database: nombre,
            host: process.env.DB_HOST,
            port: puerto,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        };
    }

    // #&#&# La contraseña jamás se pasa en la línea de comandos.
    // #&#&# Se usa un archivo temporal limitado al usuario local.
    function escaparOpcion(valor) {
        return `"${String(valor).replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"').replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')}\"`;
    }

    async function configTemporal() {
        const db = configuracionMySQL();
        const carpeta = await fsp.mkdtemp(path.join(os.tmpdir(), 'panaderia-mysql-'));
        const archivo = path.join(carpeta, 'cliente.cnf');
        try {
            const contenido = `[client]\n` +
                `host=${escaparOpcion(db.host)}\n` +
                `port=${db.port}\n` +
                `user=${escaparOpcion(db.user)}\n` +
                `password=${escaparOpcion(db.password)}\n` +
                `default-character-set=utf8mb4\n`;
            await fsp.writeFile(archivo, contenido, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            return { archivo, carpeta, db };
        } catch (error) {
            await fsp.rm(carpeta, { recursive: true, force: true });
            throw error;
        }
    }

    async function limpiarTemporal(conf) {
        if (conf) await fsp.rm(conf.carpeta, { recursive: true, force: true });
    }

    // #&#&# Configuración opcional: MYSQL_BIN_DIR en .env.
    // #&#&# También reconoce algunas instalaciones comunes de MySQL en Windows.
    async function buscarEjecutable(nombre) {
        const exe = process.platform === 'win32' ? `${nombre}.exe` : nombre;
        const especifico = process.env[nombre === 'mysqldump' ? 'MYSQLDUMP_PATH' : 'MYSQL_CLIENT_PATH'];
        if (especifico) return especifico.trim();
        const directorioBin = (process.env.MYSQL_BIN_DIR || '').trim();
        if (directorioBin) return path.join(directorioBin, exe);

        if (process.platform === 'win32') {
            const raices = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
                .filter(Boolean);
            for (const raiz of raices) {
                const base = path.join(raiz, 'MySQL');
                let nombres = [];
                try { nombres = await fsp.readdir(base); } catch (_) { /* No existe */ }
                const servidores = nombres.filter(n => /^MySQL Server \d+(?:\.\d+)*$/.test(n))
                    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
                for (const carpeta of servidores) {
                    const candidato = path.join(base, carpeta, 'bin', exe);
                    try { await fsp.access(candidato); return candidato; } catch (_) { /* Siguiente */ }
                }
            }
        }
        return exe; // #&#&# Buscar en PATH.
    }

    // #&#&# Ejecutar sin shell: no se interpreta texto como comandos de Windows.
    function ejecutar(programa, argumentos, archivoEntrada = null) {
        return new Promise((resolver, rechazar) => {
            let terminado = false;
            let stderr = '';
            const hijo = spawn(programa, argumentos, {
                windowsHide: true,
                shell: false,
                stdio: [archivoEntrada ? 'pipe' : 'ignore', 'ignore', 'pipe']
            });
            const finalizar = error => {
                if (terminado) return;
                terminado = true;
                if (error) rechazar(error);
                else resolver();
            };
            hijo.on('error', error => {
                if (error.code === 'ENOENT') {
                    finalizar(new Error(
                        `No se encontró ${path.basename(programa)}. ` +
                        'Configura MYSQL_BIN_DIR en .env con la carpeta bin de MySQL Server.'
                    ));
                } else finalizar(error);
            });
            hijo.stderr.on('data', datos => {
                if (stderr.length < 16000) stderr += String(datos).slice(0, 16000 - stderr.length);
            });
            if (archivoEntrada) {
                const lectura = fs.createReadStream(archivoEntrada);
                lectura.on('error', error => { hijo.kill(); finalizar(error); });
                hijo.stdin.on('error', () => { /* EPIPE: el cliente rechazó la importación. */ });
                lectura.pipe(hijo.stdin);
                hijo.once('close', () => lectura.destroy());
            }
            hijo.on('close', codigo => {
                if (codigo === 0) finalizar();
                else finalizar(new Error(
                    `${path.basename(programa)} finalizó con código ${codigo}. ` +
                    (stderr.trim().slice(-650) || 'Consulta el registro de errores de MySQL.')
                ));
            });
        });
    }

    async function sha256De(archivo) {
        return new Promise((resolver, rechazar) => {
            const hash = crypto.createHash('sha256');
            const flujo = fs.createReadStream(archivo);
            flujo.on('data', bloque => hash.update(bloque));
            flujo.on('error', rechazar);
            flujo.on('end', () => resolver(hash.digest('hex')));
        });
    }

    async function listarInterno() {
        await fsp.mkdir(directorio, { recursive: true });
        const nombres = (await fsp.readdir(directorio))
            .filter(nombre => NOMBRE_COPIA.test(nombre));
        const copias = [];
        for (const nombre of nombres) {
            try {
                const sql = path.join(directorio, nombre);
                const meta = JSON.parse(await fsp.readFile(`${sql}.json`, 'utf8'));
                const info = await fsp.lstat(sql);
                if (!info.isFile() || info.isSymbolicLink() ||
                    meta.version !== 1 || meta.nombre !== nombre ||
                    meta.base_datos !== configuracionMySQL().database ||
                    !/^[a-f0-9]{64}$/.test(meta.sha256) ||
                    info.size !== meta.tamano_bytes ||
                    !['manual', 'automatica'].includes(meta.tipo) ||
                    !Number.isFinite(Date.parse(meta.creado_en))) continue;
                copias.push({
                    nombre, tipo: meta.tipo, creado_en: meta.creado_en,
                    tamano_bytes: info.size
                });
            } catch (_) {
                // #&#&# Copia sin metadatos válidos: no disponible para restaurar.
            }
        }
        return copias.sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    }

    async function verificarInterno(nombre) {
        if (typeof nombre !== 'string' || !NOMBRE_COPIA.test(nombre)) {
            throw new Error('Nombre de respaldo no permitido.');
        }
        const copia = (await listarInterno()).find(x => x.nombre === nombre);
        if (!copia) throw new Error('El respaldo no existe o sus metadatos están incompletos.');
        const archivo = path.join(directorio, nombre);
        const meta = JSON.parse(await fsp.readFile(`${archivo}.json`, 'utf8'));
        const hash = await sha256De(archivo);
        if (hash !== meta.sha256) {
            throw new Error('La copia está alterada o dañada: el SHA-256 no coincide.');
        }
        return { archivo, copia };
    }

    async function aplicarRetencion() {
        const copias = await listarInterno();
        const sobrantes = copias.slice(MAX_COPIAS);
        for (const copia of sobrantes) {
            const archivo = path.join(directorio, copia.nombre);
            await fsp.unlink(archivo);
            await fsp.rm(`${archivo}.json`, { force: true });
        }
    }

    async function conservarUnaRecuperacion() {
        const archivos = (await fsp.readdir(directorioEmergencia))
            .filter(nombre => /^pre_restauracion_\d{4}-\d\d-\d\dT/.test(nombre) &&
                nombre.endsWith('.sql'))
            .sort().reverse();
        for (const nombre of archivos.slice(1)) {
            await fsp.rm(path.join(directorioEmergencia, nombre), { force: true });
            await fsp.rm(path.join(directorioEmergencia, `${nombre}.json`), { force: true });
        }
    }

    async function crearArchivoRespaldo(carpetaDestino, tipo, nombreEspecial = null) {
        await fsp.mkdir(carpetaDestino, { recursive: true });
        const db = configuracionMySQL();
        const creadoEn = new Date().toISOString();
        const nombre = nombreEspecial ||
            `panaderia_${creadoEn.replace(/:/g, '-').replace('.', '-').replace(/\.000Z$/, '-000Z')}.sql`;
        // #&#&# Siempre utilizar un nombre permitido y distinto.
        const sql = path.join(carpetaDestino, nombre);
        const temporal = `${sql}.partial`;
        let config = null;
        try {
            config = await configTemporal();
            const programa = await buscarEjecutable('mysqldump');
            await ejecutar(programa, [
                `--defaults-extra-file=${config.archivo}`,
                '--single-transaction', '--quick', '--no-tablespaces',
                '--set-gtid-purged=OFF', '--default-character-set=utf8mb4',
                `--result-file=${temporal}`, db.database
            ]);
            const info = await fsp.stat(temporal);
            if (!info.isFile() || info.size < 500) {
                throw new Error('mysqldump generó un archivo vacío o demasiado pequeño.');
            }
            const hash = await sha256De(temporal);
            const meta = {
                version: 1, nombre, base_datos: db.database,
                creado_en: creadoEn, tipo,
                tamano_bytes: info.size, sha256: hash
            };
            await fsp.rename(temporal, sql);
            await fsp.writeFile(`${sql}.json`, JSON.stringify(meta, null, 2), {
                encoding: 'utf8', flag: 'wx', mode: 0o600
            });
            return { nombre, creado_en: creadoEn, tamano_bytes: info.size, tipo };
        } catch (error) {
            await fsp.rm(temporal, { force: true });
            await fsp.rm(sql, { force: true });
            await fsp.rm(`${sql}.json`, { force: true });
            throw error;
        } finally {
            await limpiarTemporal(config);
        }
    }

    async function importarArchivo(archivo) {
        let config = null;
        try {
            config = await configTemporal();
            const programa = await buscarEjecutable('mysql');
            await ejecutar(programa, [
                `--defaults-extra-file=${config.archivo}`,
                '--default-character-set=utf8mb4',
                '--binary-mode=1',
                `--database=${config.db.database}`
            ], archivo);
        } finally {
            await limpiarTemporal(config);
        }
    }

    // #&#&# Comprobación periódica. Si la aplicación estuvo cerrada,
    // #&#&# el respaldo pendiente se genera al volver a abrirla.
    async function revisarAutomatico() {
        if (ocupado || restauracionCerrada) return;
        const ahora = Date.now();
        if (ahora - ultimoIntentoAutomatico < INTERVALO_REINTENTO_MS) return;
        ocupado = true;
        try {
            const copias = await listarInterno();
            const fecha = copias.length ? Date.parse(copias[0].creado_en) : 0;
            if (fecha && ahora - fecha < DIA_MS) return;
            ultimoIntentoAutomatico = ahora;
            await crearArchivoRespaldo(directorio, 'automatica');
            await aplicarRetencion();
            ultimoErrorAutomatico = '';
        } catch (error) {
            ultimoIntentoAutomatico = Date.now();
            ultimoErrorAutomatico = error.message;
            console.error('Respaldo automático:', error.message);
        } finally {
            ocupado = false;
        }
    }

    // #&#&# LISTAR: solo administrador.
    ipcMain.handle('respaldos:listar', async evento => {
        if (!await verificarPermiso(evento, ['administrador'])) return errorRespuesta('Acceso denegado.');
        try {
            return {
                ok: true, respaldos: await listarInterno(),
                ubicacion: directorio,
                error_automatico: ultimoErrorAutomatico,
                en_proceso: ocupado
            };
        } catch (error) {
            return errorRespuesta(`No se pueden consultar respaldos: ${error.message}`);
        }
    });

    // #&#&# RESPALDO MANUAL.
    ipcMain.handle('respaldos:crear', async evento => {
        if (!await verificarPermiso(evento, ['administrador'])) return errorRespuesta('Acceso denegado.');
        if (ocupado || restauracionCerrada) return errorRespuesta('Otra operación de respaldo está en curso.');
        ocupado = true;
        try {
            const copia = await crearArchivoRespaldo(directorio, 'manual');
            await aplicarRetencion();
            return { ok: true, copia, mensaje: 'Respaldo creado correctamente.' };
        } catch (error) {
            console.error('Respaldo manual:', error.message);
            return errorRespuesta(`No se pudo generar la copia: ${error.message}`);
        } finally {
            ocupado = false;
        }
    });

    // #&#&# VERIFICACIÓN DE SHA-256.
    ipcMain.handle('respaldos:verificar', async (evento, nombre) => {
        if (!await verificarPermiso(evento, ['administrador'])) return errorRespuesta('Acceso denegado.');
        if (ocupado || restauracionCerrada) return errorRespuesta('Hay otra operación en curso.');
        ocupado = true;
        try {
            await verificarInterno(nombre);
            return { ok: true, mensaje: 'Integridad SHA-256 verificada. Esta prueba no sustituye una restauración de ensayo.' };
        } catch (error) {
            return errorRespuesta(error.message);
        } finally {
            ocupado = false;
        }
    });

    // #&#&# MOSTRAR CARPETA. Permite copiar SQL+JSON a un USB.
    ipcMain.handle('respaldos:abrir-carpeta', async evento => {
        if (!await verificarPermiso(evento, ['administrador'])) return errorRespuesta('Acceso denegado.');
        try {
            await fsp.mkdir(directorio, { recursive: true });
            const respuesta = await shell.openPath(directorio);
            return respuesta ? errorRespuesta(respuesta) : { ok: true };
        } catch (error) {
            return errorRespuesta(error.message);
        }
    });

    // #&#&# RESTAURACIÓN DESTRUCTIVA, CON DOBLE CONFIRMACIÓN.
    // #&#&# El respaldo de emergencia queda fuera de las tres copias normales.
    ipcMain.handle('respaldos:restaurar', async (evento, datos) => {
        if (!await verificarPermiso(evento, ['administrador'])) return errorRespuesta('Acceso denegado.');
        if (ocupado || restauracionCerrada) return errorRespuesta('Hay otra operación en curso.');
        if (!datos || datos.confirmacion !== 'RESTAURAR') {
            return errorRespuesta('Debes escribir RESTAURAR para confirmar.');
        }
        let seleccionado;
        try { seleccionado = await verificarInterno(datos.nombre); }
        catch (error) { return errorRespuesta(error.message); }

        const respuesta = dialog.showMessageBoxSync({
            type: 'warning',
            title: 'Confirmación final de restauración',
            buttons: ['Cancelar', 'Restaurar base de datos'],
            defaultId: 0, cancelId: 0, noLink: true,
            message: '¿Reemplazar los datos actuales por este respaldo?',
            detail: 'Se guardará primero una copia de recuperación del estado actual. ' +
                'Los cambios posteriores al respaldo seleccionado se perderán. ' +
                'La importación MySQL no es una transacción atómica.'
        });
        if (respuesta !== 1) return errorRespuesta('Restauración cancelada.');
        ocupado = true;
        activarMantenimiento(true);
        try {
            // #&#&# Mantener una sola copia de recuperación, con nombre fijo.
            // #&#&# Si ya existe, se conserva hasta crear correctamente la siguiente.
            const nombreEmergencia = 'pre_restauracion_' +
                new Date().toISOString().replace(/[:.]/g, '-') + '.sql';
            await crearArchivoRespaldo(directorioEmergencia, 'emergencia', nombreEmergencia);
            await conservarUnaRecuperacion();
            // #&#&# Evitar nuevas consultas y esperar las conexiones en uso.
            try {
                await cerrarConexiones();
            } catch (error) {
                // #&#&# No continuar usando el pool si su cierre fue incompleto.
                restauracionCerrada = true;
                return {
                    ok: false, requiere_reinicio: true,
                    mensaje: 'No se pudo cerrar MySQL con seguridad. No se importó la copia. ' +
                        'Reinicia la aplicación y revisa la conexión.'
                };
            }
            restauracionCerrada = true;
            try {
                await importarArchivo(seleccionado.archivo);
                return {
                    ok: true, requiere_reinicio: true,
                    mensaje: 'Restauración finalizada. Debes cerrar y abrir nuevamente la aplicación.'
                };
            } catch (error) {
                // #&#&# Intento de recuperación automática del estado anterior.
                let recuperacion = 'No fue posible recuperar los datos automáticamente.';
                try {
                    await importarArchivo(path.join(directorioEmergencia, nombreEmergencia));
                    recuperacion = 'La importación de recuperación finalizó; verifica los datos antes de continuar.';
                } catch (fallo) {
                    console.error('Fallo de recuperación automática:', fallo.message);
                }
                console.error('Fallo de restauración:', error.message);
                return {
                    ok: false, requiere_reinicio: true,
                    mensaje: `La restauración no terminó correctamente. ${recuperacion} ` +
                        'Cierra la aplicación y comprueba MySQL antes de seguir trabajando.'
                };
            }
        } catch (error) {
            if (!restauracionCerrada) activarMantenimiento(false);
            console.error('No se pudo iniciar restauración:', error.message);
            return errorRespuesta(`No se inició la restauración: ${error.message}`);
        } finally {
            ocupado = false;
        }
    });

    // #&#&# Después de importar, el pool está cerrado: solo queda salir.
    ipcMain.handle('respaldos:cerrar-aplicacion', evento => {
        if (!origenAutorizado(evento) || !restauracionCerrada) {
            return errorRespuesta('Esta opción solo se habilita tras restaurar.');
        }
        setImmediate(() => app.quit());
        return { ok: true };
    });

    function iniciarAutomatico() {
        if (intervalo) return;
        // #&#&# La primera revisión comienza al arrancar Electron.
        setImmediate(() => revisarAutomatico().catch(error => {
            console.error('Planificador:', error.message);
        }));
        intervalo = setInterval(() => revisarAutomatico().catch(error => {
            console.error('Planificador:', error.message);
        }), INTERVALO_REVISION_MS);
        intervalo.unref();
    }

    return { iniciarAutomatico };
}

module.exports = registrarRespaldos;
