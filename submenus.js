(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const menu = $('navegacion');
    const grupos = {
        productos: {
            titulo: 'Productos', inicial: 'consultar',
            opciones: [
                ['consultar', 'Consultar productos'],
                ['registrar', 'Registrar producto'],
                ['modificar', 'Modificar producto']
            ]
        },
        inventario: {
            titulo: 'Inventario', inicial: 'lotes',
            opciones: [['lotes', 'Consultar lotes'], ['entrada', 'Registrar entrada']]
        },
        ventas: {
            titulo: 'Ventas', inicial: 'registrar',
            opciones: [
                ['registrar', 'Registrar venta'],
                ['consultar', 'Consultar ventas']
            ]
        },
        usuarios: {
            titulo: 'Usuarios', inicial: 'consultar',
            opciones: [
                ['consultar', 'Consultar usuarios'],
                ['registrar', 'Registrar usuario'],
                ['estado', 'Activar / desactivar'],
                ['clave', 'Restablecer contraseña']
            ]
        },
        perdidas: {
            titulo: 'Pérdidas por vencimiento', inicial: 'registrar',
            opciones: [
                ['registrar', 'Registrar pérdida'],
                ['consultar', 'Consultar pérdidas']
            ]
        },
        reportes: {
            titulo: 'Reportes administrativos', inicial: 'resumen',
            opciones: [
                ['resumen', 'Resumen de ventas'],
                ['productos', 'Productos más vendidos'],
                ['ganancias', 'Ganancia bruta estimada']
            ]
        },
        respaldos: {
            titulo: 'Respaldos y restauración', inicial: 'gestionar',
            opciones: [
                ['gestionar', 'Copias de seguridad'],
                ['restaurar', 'Restaurar copia']
            ]
        }
    };
    const directos = {
        inicio: 'Inicio', alertas: 'Alertas'
    };
    let rolActual = null;

    for (const [modulo, grupo] of Object.entries(grupos)) {
        const principal = menu.querySelector(`[data-modulo="${modulo}"]`);
        const contenedor = document.createElement('div');
        contenedor.id = `submenu-${modulo}`;
        contenedor.className = 'submenu-opciones';
        contenedor.hidden = true;
        contenedor.setAttribute('role', 'group');
        contenedor.setAttribute('aria-label', `Funciones de ${grupo.titulo}`);
        for (const [funcion, etiqueta] of grupo.opciones) {
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = 'submenu-boton';
            boton.dataset.funcion = funcion;
            boton.textContent = etiqueta;
            boton.addEventListener('click', () => abrirFuncion(modulo, funcion));
            contenedor.appendChild(boton);
        }
        const flecha = document.createElement('span');
        flecha.className = 'flecha-submenu';
        flecha.textContent = '⌄';
        flecha.setAttribute('aria-hidden', 'true');
        principal.appendChild(flecha);
        principal.classList.add('menu-con-submenu');
        principal.setAttribute('aria-expanded', 'false');
        principal.setAttribute('aria-controls', contenedor.id);
        principal.after(contenedor);
    }

    function permitido(modulo) {
        if (!rolActual) return false;
        return rolActual === 'administrador' || (rolActual === 'cajero' && modulo === 'ventas');
    }

    function funcionPermitida(modulo, funcion) {
        if (!permitido(modulo)) return false;
        if (modulo === 'ventas') {
            if (funcion === 'registrar') return rolActual === 'cajero';
            if (funcion === 'consultar') return rolActual === 'administrador';
        }
        return true;
    }

    function inicialPermitida(modulo) {
        if (modulo === 'ventas' && rolActual === 'administrador') return 'consultar';
        return grupos[modulo].inicial;
    }

    function actualizarMenus() {
        menu.querySelectorAll('[data-modulo]').forEach(boton => {
            boton.hidden = !permitido(boton.dataset.modulo);
        });
        for (const boton of menu.querySelectorAll('#submenu-ventas [data-funcion]')) {
            boton.hidden = !funcionPermitida('ventas', boton.dataset.funcion);
        }
        $('accesos-admin').hidden = rolActual !== 'administrador';
    }

    function ocultarSubmenus() {
        menu.querySelectorAll('.submenu-opciones').forEach(s => { s.hidden = true; });
        menu.querySelectorAll('.menu-con-submenu').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
        });
    }

    function mostrar(modulo, funcion = null, codigo = null) {
        if (!permitido(modulo) ||
            (grupos[modulo] && !funcionPermitida(modulo, funcion))) return;
        menu.querySelectorAll('[data-modulo]').forEach(b => {
            const activo = b.dataset.modulo === modulo;
            b.classList.toggle('seleccionado', activo);
            if (activo) b.setAttribute('aria-current', 'page');
            else b.removeAttribute('aria-current');
        });
        ocultarSubmenus();
        if (grupos[modulo]) {
            const principal = menu.querySelector(`[data-modulo="${modulo}"]`);
            const submenu = $(`submenu-${modulo}`);
            submenu.hidden = false;
            principal.setAttribute('aria-expanded', 'true');
            submenu.querySelectorAll('[data-funcion]').forEach(b => {
                const elegido = b.dataset.funcion === funcion;
                b.classList.toggle('submenu-seleccionado', elegido);
                if (elegido) b.setAttribute('aria-current', 'page');
                else b.removeAttribute('aria-current');
            });
        }
        document.querySelectorAll('.pantalla').forEach(s => {
            s.hidden = s.id !== `vista-${modulo}`;
        });
        document.querySelectorAll('[data-subvista]').forEach(panel => {
            panel.hidden = !(panel.closest('.pantalla')?.id === `vista-${modulo}` &&
                panel.dataset.subvista === funcion);
        });
        const etiqueta = grupos[modulo] ?
            grupos[modulo].opciones.find(x => x[0] === funcion)?.[1] : directos[modulo];
        $('titulo-pagina').textContent = etiqueta || modulo;
        $('descripcion-pagina').textContent = '';
        $('contenido-principal').scrollTop = 0;
        window.dispatchEvent(new CustomEvent('panaderia:vista', {
            detail: { modulo, funcion, codigo }
        }));
    }

    function abrirFuncion(modulo, funcion, codigo = null) {
        if (!grupos[modulo] ||
            !grupos[modulo].opciones.some(x => x[0] === funcion) ||
            !funcionPermitida(modulo, funcion)) return;
        mostrar(modulo, funcion, codigo);
    }

    menu.querySelectorAll('[data-modulo]').forEach(boton => {
        boton.addEventListener('click', () => {
            const modulo = boton.dataset.modulo;
            if (!permitido(modulo)) return;
            if (grupos[modulo]) abrirFuncion(modulo, inicialPermitida(modulo));
            else mostrar(modulo);
        });
    });

    document.querySelectorAll('[data-acceso]').forEach(boton => {
        boton.addEventListener('click', () => {
            const modulo = boton.dataset.acceso;
            if (grupos[modulo]) abrirFuncion(modulo, inicialPermitida(modulo));
        });
    });

    window.panaderiaUI = {
        abrirFuncion,
        mostrarInicio: () => mostrar('inicio'),
        definirRol(rol) {
            rolActual = ['administrador', 'cajero'].includes(rol) ? rol : null;
            actualizarMenus();
            if (rolActual === 'cajero') mostrar('ventas', 'registrar');
            else if (rolActual === 'administrador') mostrar('inicio');
        },
        limpiar() {
            rolActual = null;
            actualizarMenus();
            ocultarSubmenus();
            document.querySelectorAll('.pantalla').forEach(s => { s.hidden = true; });
            window.dispatchEvent(new Event('panaderia:cerrar-vistas'));
        },
        cerrarSesion: async () => {
            window.dispatchEvent(new Event('panaderia:solicitar-cierre'));
        }
    };
    actualizarMenus();
})();
