// #&#&# PASO 31: REPORTES ADMINISTRATIVOS DE SOLO LECTURA
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const moneda = valor => {
        const n = Number(valor);
        if (!Number.isFinite(n)) return '—';
        return new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP',
            minimumFractionDigits: 0, maximumFractionDigits: 2
        }).format(n);
    };
    const entero = n => new Intl.NumberFormat('es-CO').format(Number(n) || 0);
    let tokenSesion = 0;
    let version = 0;
    let desde = '';
    let hasta = '';

    // #&#&# Fecha local del computador; no usar toISOString, que convierte a UTC.
    function fechaLocal(d) {
        const z = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    }
    function establecerPeriodoActual() {
        const hoy = new Date();
        const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        desde = fechaLocal(inicio);
        hasta = fechaLocal(hoy);
        sincronizarFechas();
    }
    function sincronizarFechas() {
        document.querySelectorAll('#vista-reportes .reporte-desde').forEach(i => {
            i.value = desde;
        });
        document.querySelectorAll('#vista-reportes .reporte-hasta').forEach(i => {
            i.value = hasta;
        });
    }
    function mensaje(texto, error = false) {
        document.querySelectorAll('#vista-reportes .reporte-mensaje').forEach(p => {
            p.textContent = texto;
            p.classList.toggle('error', error);
        });
    }
    function fila(cuerpo, valores) {
        const tr = document.createElement('tr');
        for (const v of valores) {
            const td = document.createElement('td');
            td.textContent = String(v ?? '');
            tr.appendChild(td);
        }
        cuerpo.appendChild(tr);
    }
    function pintar(datos) {
        const r = datos.resumen;
        const perdidas = datos.perdidas_vencimiento;
        $('reporte-numero-ventas').textContent = entero(r.numero_ventas);
        $('reporte-ingresos-ventas').textContent = moneda(r.ingresos_ventas);
        $('reporte-unidades-vendidas').textContent = entero(r.unidades_vendidas);
        $('reporte-promedio-venta').textContent = moneda(r.numero_ventas
            ? Number(r.ingresos_ventas) / r.numero_ventas : 0);

        const diarios = $('reporte-tabla-diaria');
        diarios.replaceChildren();
        for (const d of datos.ventas_diarias) {
            fila(diarios, [d.dia, entero(d.numero_ventas), moneda(d.ingresos)]);
        }

        const productos = $('reporte-tabla-productos');
        productos.replaceChildren();
        datos.productos.forEach((p, indice) => {
            fila(productos, [indice + 1, p.codigo, p.nombre_actual,
                entero(p.unidades), entero(p.ventas_con_producto),
                moneda(p.ingresos), moneda(p.ganancia_bruta)]);
        });

        $('reporte-ingreso-detalle').textContent = moneda(r.ingresos_detalle);
        $('reporte-costo-vendido').textContent = moneda(r.costo_vendido);
        $('reporte-ganancia-bruta').textContent = moneda(r.ganancia_bruta);
        $('reporte-valor-perdidas').textContent = moneda(perdidas.valor);

        const ganancias = $('reporte-tabla-ganancias');
        ganancias.replaceChildren();
        for (const p of datos.productos) {
            fila(ganancias, [p.codigo, p.nombre_actual, entero(p.unidades),
                moneda(p.ingresos), moneda(p.costo), moneda(p.ganancia_bruta)]);
        }
        // #&#&# Avisar sobre ventas antiguas sin líneas u otros desfases.
        const diferencia = Math.abs(Number(r.ingresos_ventas) - Number(r.ingresos_detalle));
        $('reporte-aviso-conciliacion').textContent = diferencia >= 0.01
            ? 'Atención: el importe de la tabla ventas no coincide con la suma de sus ' +
              'detalles para este período. Revisa si existen ventas antiguas sin líneas registradas.'
            : 'Los importes de las ventas coinciden con la suma de los detalles registrados.';

        const total = datos.productos.length;
        mensaje(
            `Reporte calculado del ${datos.periodo.desde} al ${datos.periodo.hasta}. ` +
            `${entero(r.numero_ventas)} venta(s), ${entero(total)} producto(s) en el ranking. ` +
            `Pérdidas por vencimiento: ${entero(perdidas.registros)} retiro(s) ` +
            `y ${entero(perdidas.unidades)} unidad(es).`
        );
    }
    function limpiarVista() {
        ['reporte-numero-ventas', 'reporte-ingresos-ventas',
            'reporte-unidades-vendidas', 'reporte-promedio-venta',
            'reporte-ingreso-detalle', 'reporte-costo-vendido',
            'reporte-ganancia-bruta', 'reporte-valor-perdidas'].forEach(id => {
            $(id).textContent = '—';
        });
        ['reporte-tabla-diaria', 'reporte-tabla-productos', 'reporte-tabla-ganancias']
            .forEach(id => $(id).replaceChildren());
        $('reporte-aviso-conciliacion').textContent = '';
        mensaje('');
    }

    async function cargarReportes() {
        const token = tokenSesion;
        const solicitud = ++version;
        limpiarVista();
        mensaje('Calculando reportes desde MySQL...');
        try {
            const respuesta = await window.panaderiaAPI.consultarReportes({ desde, hasta });
            if (token !== tokenSesion || solicitud !== version) return;
            if (!respuesta.ok) {
                mensaje(respuesta.mensaje, true);
                return;
            }
            pintar(respuesta);
        } catch (error) {
            console.error('Reportes administrativos:', error);
            if (token === tokenSesion && solicitud === version) {
                mensaje('Error al consultar reportes.', true);
            }
        }
    }

    document.querySelectorAll('#vista-reportes [data-reporte-form]').forEach(form => {
        form.addEventListener('submit', evento => {
            evento.preventDefault();
            const d = form.querySelector('.reporte-desde').value;
            const h = form.querySelector('.reporte-hasta').value;
            if (!d || !h || d > h) {
                mensaje('Selecciona fechas válidas: "Desde" no puede ser posterior a "Hasta".', true);
                return;
            }
            desde = d;
            hasta = h;
            sincronizarFechas();
            cargarReportes();
        });
    });

    establecerPeriodoActual();
    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail?.modulo !== 'reportes') return;
        cargarReportes();
    });
    window.addEventListener('panaderia:cerrar-vistas', () => {
        ++tokenSesion;
        ++version;
        limpiarVista();
        establecerPeriodoActual();
    });
})();
