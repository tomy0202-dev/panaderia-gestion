// #&#&# PASO 30: VISTAS DE ALERTAS Y RESUMEN ADMINISTRATIVO
// #&#&# Todas las fechas proceden de MySQL; no hay cambios automáticos de stock.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const mensaje = $('mensaje-alertas');
    let version = 0;
    let versionSesion = 0;
    let datos = null;

    function celda(valor) {
        const td = document.createElement('td');
        td.textContent = String(valor ?? '');
        return td;
    }

    function agregarFila(cuerpo, celdas) {
        const tr = document.createElement('tr');
        for (const valor of celdas) tr.appendChild(celda(valor));
        cuerpo.appendChild(tr);
    }

    function textoFecha(dias) {
        if (dias === 0) return 'Vence hoy';
        if (dias === 1) return 'Vence mañana';
        if (dias > 1) return `Faltan ${dias} días`;
        return `Vencido hace ${Math.abs(dias)} día(s)`;
    }

    function pintarAlertas() {
        if (!datos) return;
        const { stock_bajo: bajos, proximos, vencidos } = datos;
        const tablas = {
            stock: $('tabla-alertas-stock'),
            proximos: $('tabla-alertas-proximos'),
            vencidos: $('tabla-alertas-vencidos')
        };
        Object.values(tablas).forEach(t => t.replaceChildren());
        for (const p of bajos) {
            agregarFila(tablas.stock, [p.codigo, p.nombre, p.stock_total, p.stock_minimo]);
        }
        for (const l of proximos) {
            agregarFila(tablas.proximos, [l.id_lote, l.nombre, l.codigo,
                l.cantidad_disponible, l.fecha_vencimiento, textoFecha(l.dias_restantes),
                l.activo ? 'Activo' : 'Inactivo']);
        }
        for (const l of vencidos) {
            agregarFila(tablas.vencidos, [l.id_lote, l.nombre, l.codigo,
                l.cantidad_disponible, l.fecha_vencimiento, textoFecha(l.dias_restantes),
                l.activo ? 'Activo' : 'Inactivo']);
        }
        $('contador-alerta-stock').textContent = `${bajos.length} producto(s)`;
        $('contador-alerta-proximos').textContent = `${proximos.length} lote(s)`;
        $('contador-alerta-vencidos').textContent = `${vencidos.length} lote(s)`;
        $('resumen-alertas-inicio').textContent =
            `${bajos.length} producto(s) en stock mínimo · ${proximos.length} lote(s) ` +
            `próximos a vencer · ${vencidos.length} lote(s) vencidos.`;
        $('resumen-alertas-inventario').textContent =
            `${bajos.length} producto(s) con stock bajo; ${proximos.length} lote(s) ` +
            `por vencer y ${vencidos.length} lote(s) vencidos.`;
        mensaje.className = 'mensaje';
        mensaje.textContent = bajos.length + proximos.length + vencidos.length
            ? 'Alertas calculadas a partir del inventario actual.'
            : 'No se encontraron alertas con los criterios configurados.';
    }

    async function consultarAlertas() {
        const peticion = ++version;
        const sesion = versionSesion;
        $('btn-actualizar-alertas').disabled = true;
        mensaje.className = 'mensaje';
        mensaje.textContent = 'Consultando alertas...';
        try {
            const r = await window.panaderiaAPI.consultarAlertas();
            if (peticion !== version || sesion !== versionSesion) return;
            if (!r.ok) {
                datos = null;
                mensaje.className = 'mensaje error';
                mensaje.textContent = r.mensaje;
                $('resumen-alertas-inicio').textContent = 'No fue posible consultar las alertas.';
                $('resumen-alertas-inventario').textContent = 'No fue posible consultar las alertas.';
                return;
            }
            datos = r;
            pintarAlertas();
        } catch (error) {
            console.error('Alertas:', error);
            if (peticion === version && sesion === versionSesion) {
                mensaje.className = 'mensaje error';
                mensaje.textContent = 'No fue posible cargar las alertas.';
            }
        } finally {
            if (peticion === version && sesion === versionSesion) {
                $('btn-actualizar-alertas').disabled = false;
            }
        }
    }

    $('btn-actualizar-alertas').addEventListener('click', consultarAlertas);
    document.querySelectorAll('[data-abrir-alertas]').forEach(boton => {
        boton.addEventListener('click', () => {
            document.querySelector('[data-modulo="alertas"]').click();
        });
    });

    window.addEventListener('panaderia:vista', evento => {
        const modulo = evento.detail.modulo;
        const rol = document.body.classList.contains('rol-administrador');
        if (!rol) return;
        if (['alertas', 'inicio', 'inventario'].includes(modulo)) {
            $('alertas-resumen-inicio').hidden = false;
            $('alertas-resumen-inventario').hidden = false;
            consultarAlertas();
        }
    });

    // #&#&# Actualizar los avisos después de registrar una pérdida manual.
    window.addEventListener('panaderia:inventario-cambiado', () => {
        if (document.body.classList.contains('rol-administrador')) {
            consultarAlertas();
        }
    });

    window.addEventListener('panaderia:cerrar-vistas', () => {
        ++versionSesion;
        ++version;
        datos = null;
        $('alertas-resumen-inicio').hidden = true;
        $('alertas-resumen-inventario').hidden = true;
        $('resumen-alertas-inicio').textContent = '';
        $('resumen-alertas-inventario').textContent = '';
        ['tabla-alertas-stock', 'tabla-alertas-proximos', 'tabla-alertas-vencidos']
            .forEach(id => $(id).replaceChildren());
        ['contador-alerta-stock', 'contador-alerta-proximos', 'contador-alerta-vencidos']
            .forEach(id => $(id).textContent = '');
        mensaje.textContent = '';
    });
})();
