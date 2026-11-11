(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const formulario = $('formulario-acceso');
    const mensaje = $('mensaje-acceso');
    const boton = $('boton-iniciar-sesion');
    const pantalla = $('pantalla-acceso');

    function mostrarAcceso() {
        document.body.classList.remove('autenticado', 'rol-administrador', 'rol-cajero');
        $('barra-sesion').hidden = true;
        pantalla.hidden = false;
        formulario.reset();
        mensaje.textContent = '';
        window.panaderiaUI.limpiar();
        $('acceso-usuario').focus();
    }

    function mostrarSesion(u) {
        document.body.classList.add('autenticado');
        document.body.classList.remove('rol-administrador', 'rol-cajero');
        document.body.classList.add(`rol-${u.rol}`);
        pantalla.hidden = true;
        $('barra-sesion').hidden = false;
        $('sesion-nombre').textContent = u.nombre_usuario;
        $('sesion-rol').textContent = u.rol === 'administrador' ? 'Administrador' : 'Cajero';
        $('acceso-contrasena').value = '';
        mensaje.textContent = '';
        window.panaderiaUI.definirRol(u.rol);
    }

    formulario.addEventListener('submit', async evento => {
        evento.preventDefault();
        boton.disabled = true;
        mensaje.textContent = 'Comprobando credenciales...';
        try {
            const r = await window.panaderiaAPI.iniciarSesion({
                nombre_usuario: $('acceso-usuario').value.trim(),
                contrasena: $('acceso-contrasena').value
            });
            $('acceso-contrasena').value = '';
            if (!r.ok) {
                mensaje.textContent = r.mensaje;
                return;
            }
            mostrarSesion(r.usuario);
        } catch (error) {
            console.error('Inicio de sesión:', error);
            $('acceso-contrasena').value = '';
            mensaje.textContent = 'No se pudo iniciar sesión.';
        } finally {
            boton.disabled = false;
        }
    });

    async function cerrarSesion() {
        $('boton-cerrar-sesion').disabled = true;
        try {
            const r = await window.panaderiaAPI.cerrarSesion();
            if (r.ok) mostrarAcceso();
        } catch (error) {
            console.error('Cerrar sesión:', error);
        } finally {
            $('boton-cerrar-sesion').disabled = false;
        }
    }
    $('boton-cerrar-sesion').addEventListener('click', cerrarSesion);
    window.addEventListener('panaderia:solicitar-cierre', cerrarSesion);
    window.panaderiaUI.cerrarSesion = cerrarSesion;

    (async () => {
        try {
            const r = await window.panaderiaAPI.obtenerSesion();
            if (r.ok && r.usuario) mostrarSesion(r.usuario);
            else mostrarAcceso();
        } catch (error) {
            console.error('Comprobar sesión:', error);
            mostrarAcceso();
        }
    })();
})();
