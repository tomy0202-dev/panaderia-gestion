// #&#&# Cuentas individuales: consulta, registro, estado y contraseña.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const normalizar = s => String(s || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const collator = new Intl.Collator('es', { sensitivity: 'base' });
    let usuarios = [];
    let version = 0;

    function celda(texto) {
        const td = document.createElement('td');
        td.textContent = String(texto || '');
        return td;
    }

    function pintarUsuarios() {
        const texto = normalizar($('buscar-usuario').value.trim());
        const rol = $('filtrar-rol-usuario').value;
        const estado = $('filtrar-estado-usuario').value;
        const lista = usuarios.filter(u =>
            normalizar(u.nombre_usuario).includes(texto) &&
            (rol === 'todos' || u.rol === rol) &&
            (estado === 'todos' || (estado === 'activos' && u.activo) ||
                (estado === 'inactivos' && !u.activo))
        );
        const cuerpo = $('tabla-usuarios');
        cuerpo.replaceChildren();
        for (const u of lista) {
            const tr = document.createElement('tr');
            [u.nombre_usuario, u.rol === 'administrador' ? 'Administrador' : 'Cajero',
                u.activo ? 'Activo' : 'Inactivo', u.fecha_creacion || '—']
                .forEach(v => tr.appendChild(celda(v)));
            cuerpo.appendChild(tr);
        }
        $('mensaje-lista-usuarios').textContent =
            `Mostrando ${lista.length} de ${usuarios.length} usuario(s).`;
    }

    function actualizarSelectores() {
        for (const id of ['usuario-estado-id', 'usuario-clave-id']) {
            const select = $(id);
            const anterior = select.value;
            select.replaceChildren();
            const inicio = document.createElement('option');
            inicio.value = '';
            inicio.textContent = 'Selecciona un usuario';
            select.appendChild(inicio);
            for (const u of usuarios) {
                const op = document.createElement('option');
                op.value = String(u.id_usuario);
                op.textContent = `${u.nombre_usuario} (${u.rol})`;
                select.appendChild(op);
            }
            if (usuarios.some(u => String(u.id_usuario) === anterior)) select.value = anterior;
        }
        mostrarEstado();
    }

    function mostrarEstado() {
        const id = Number($('usuario-estado-id').value);
        const u = usuarios.find(x => x.id_usuario === id);
        $('usuario-estado-actual').textContent = u ?
            `Estado actual: ${u.activo ? 'Activo' : 'Inactivo'}` : '';
    }

    async function cargarUsuarios() {
        const actual = ++version;
        const r = await window.panaderiaAPI.listarUsuarios();
        if (actual !== version) return;
        if (!r.ok) throw new Error(r.mensaje);
        usuarios = r.usuarios.sort((a, b) => collator.compare(a.nombre_usuario, b.nombre_usuario));
        pintarUsuarios();
        actualizarSelectores();
    }

    $('btn-actualizar-usuarios').addEventListener('click', () => {
        cargarUsuarios().catch(error => {
            $('mensaje-lista-usuarios').textContent = error.message;
        });
    });
    $('buscar-usuario').addEventListener('input', pintarUsuarios);
    $('filtrar-rol-usuario').addEventListener('change', pintarUsuarios);
    $('filtrar-estado-usuario').addEventListener('change', pintarUsuarios);
    $('usuario-estado-id').addEventListener('change', mostrarEstado);

    $('form-registrar-usuario').addEventListener('submit', async evento => {
        evento.preventDefault();
        const clave = $('nueva-clave-usuario').value;
        const mensaje = $('mensaje-registro-usuario');
        if (clave !== $('repetir-clave-usuario').value) {
            mensaje.textContent = 'Las contraseñas no coinciden.';
            return;
        }
        const boton = $('btn-guardar-usuario');
        boton.disabled = true;
        mensaje.textContent = 'Guardando usuario...';
        try {
            const r = await window.panaderiaAPI.registrarUsuario({
                nombre_usuario: $('nuevo-nombre-usuario').value.trim().toLowerCase(),
                rol: $('nuevo-rol-usuario').value,
                contrasena: clave
            });
            mensaje.textContent = r.mensaje;
            mensaje.className = r.ok ? 'mensaje exito' : 'mensaje error';
            if (r.ok) $('form-registrar-usuario').reset();
        } catch (error) {
            console.error('Registrar usuario:', error);
            mensaje.textContent = 'No se pudo registrar el usuario.';
        } finally {
            boton.disabled = false;
        }
    });

    $('form-estado-usuario').addEventListener('submit', async evento => {
        evento.preventDefault();
        const id = Number($('usuario-estado-id').value);
        const u = usuarios.find(x => x.id_usuario === id);
        const mensaje = $('mensaje-estado-usuario');
        if (!u) {
            mensaje.textContent = 'Selecciona una cuenta.';
            return;
        }
        const activo = $('usuario-nuevo-estado').value === '1';
        if (u.activo === activo) {
            mensaje.textContent = 'La cuenta ya tiene ese estado.';
            return;
        }
        if (!window.confirm(`¿Confirmas ${activo ? 'activar' : 'desactivar'} a ${u.nombre_usuario}?`)) return;
        const boton = $('btn-cambiar-estado');
        boton.disabled = true;
        mensaje.textContent = 'Guardando estado...';
        try {
            const r = await window.panaderiaAPI.cambiarEstadoUsuario({ id_usuario: id, activo });
            mensaje.textContent = r.mensaje;
            mensaje.className = r.ok ? 'mensaje exito' : 'mensaje error';
            if (r.ok) await cargarUsuarios();
        } catch (error) {
            console.error('Cambiar estado:', error);
            mensaje.textContent = 'No se pudo cambiar el estado.';
        } finally {
            boton.disabled = false;
        }
    });

    $('form-restablecer-clave').addEventListener('submit', async evento => {
        evento.preventDefault();
        const id = Number($('usuario-clave-id').value);
        const clave = $('usuario-clave-nueva').value;
        const mensaje = $('mensaje-clave-usuario');
        if (!usuarios.some(u => u.id_usuario === id)) {
            mensaje.textContent = 'Selecciona un usuario.';
            return;
        }
        if (clave !== $('usuario-clave-repetir').value) {
            mensaje.textContent = 'Las contraseñas no coinciden.';
            return;
        }
        const boton = $('btn-restablecer-clave');
        boton.disabled = true;
        mensaje.textContent = 'Restableciendo contraseña...';
        try {
            const r = await window.panaderiaAPI.restablecerClaveUsuario({
                id_usuario: id, contrasena: clave
            });
            mensaje.textContent = r.mensaje;
            mensaje.className = r.ok ? 'mensaje exito' : 'mensaje error';
            if (r.ok) {
                $('form-restablecer-clave').reset();
                if (r.requiere_reingreso) {
                    await window.panaderiaUI.cerrarSesion();
                }
            }
        } catch (error) {
            console.error('Restablecer contraseña:', error);
            mensaje.textContent = 'No se pudo cambiar la contraseña.';
        } finally {
            boton.disabled = false;
        }
    });

    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail.modulo !== 'usuarios') return;
        if (evento.detail.funcion !== 'registrar') {
            cargarUsuarios().catch(error => {
                const campo = {
                    consultar: 'mensaje-lista-usuarios',
                    estado: 'mensaje-estado-usuario',
                    clave: 'mensaje-clave-usuario'
                }[evento.detail.funcion];
                if (campo) $(campo).textContent = error.message;
            });
        }
    });

    window.addEventListener('panaderia:cerrar-vistas', () => {
        version++;
        usuarios = [];
        $('tabla-usuarios').replaceChildren();
        $('buscar-usuario').value = '';
        $('filtrar-rol-usuario').value = 'todos';
        $('filtrar-estado-usuario').value = 'todos';
        ['form-registrar-usuario', 'form-estado-usuario', 'form-restablecer-clave']
            .forEach(id => $(id).reset());
        ['mensaje-lista-usuarios', 'mensaje-registro-usuario',
            'mensaje-estado-usuario', 'mensaje-clave-usuario']
            .forEach(id => { $(id).textContent = ''; });
    });
})();
