// #&#&# PASO 31: PANTALLAS INDEPENDIENTES DE PÉRDIDAS POR VENCIMIENTO
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const moneda = valor => {
        const numero = Number(valor);
        if (!Number.isFinite(numero)) return '—';
        return new Intl.NumberFormat('es-CO', {
            style: 'currency', currency: 'COP',
            minimumFractionDigits: 0, maximumFractionDigits: 2
        }).format(numero);
    };
    const fecha = texto => String(texto || '').replace('T', ' ');
    let lotes = [];
    let tokenSesion = 0;
    let solicitudLotes = 0;
    let solicitudHistorial = 0;
    let paginaActual = 1;
    let totalPaginas = 1;

    function mensaje(id, texto, error = false) {
        const e = $(id);
        e.textContent = texto;
        e.classList.toggle('error', error);
        e.classList.toggle('exito', !error && /^Pérdida registrada/.test(texto));
    }

    function fila(cuerpo, valores) {
        const tr = document.createElement('tr');
        for (const valor of valores) {
            const td = document.createElement('td');
            td.textContent = String(valor ?? '');
            tr.appendChild(td);
        }
        cuerpo.appendChild(tr);
    }

    function filtrarLotes() {
        const selector = $('perdida-id-lote');
        const actual = selector.value;
        const busqueda = $('buscar-lote-perdida').value.trim().toLocaleLowerCase('es');
        selector.replaceChildren();
        const inicial = document.createElement('option');
        inicial.value = '';
        inicial.textContent = 'Selecciona un lote vencido';
        selector.appendChild(inicial);
        for (const l of lotes) {
            if (!`${l.nombre} ${l.codigo} ${l.id_lote}`.toLocaleLowerCase('es').includes(busqueda)) continue;
            const opcion = document.createElement('option');
            opcion.value = String(l.id_lote);
            opcion.textContent = `${l.nombre} · ${l.codigo} · lote #${l.id_lote} · ${l.cantidad_disponible} ud.`;
            selector.appendChild(opcion);
        }
        if (Array.from(selector.options).some(o => o.value === actual)) {
            selector.value = actual;
        }
        actualizarResumen();
    }

    function actualizarResumen() {
        const lote = lotes.find(l => String(l.id_lote) === $('perdida-id-lote').value);
        const cantidadTexto = $('perdida-cantidad').value.trim();
        const cantidad = /^\d+$/.test(cantidadTexto) ? Number(cantidadTexto) : 0;
        const valida = lote && Number.isSafeInteger(cantidad) &&
            cantidad >= 1 && cantidad <= lote.cantidad_disponible;
        $('resumen-lote-perdida').hidden = !lote;
        $('btn-registrar-perdida').disabled = !valida;
        if (!lote) return;
        $('perdida-descripcion-lote').textContent = `${lote.nombre} (${lote.codigo}) · lote #${lote.id_lote}`;
        $('perdida-disponibles').textContent = String(lote.cantidad_disponible);
        $('perdida-fecha-lote').textContent = lote.fecha_vencimiento;
        $('perdida-costo-lote').textContent = moneda(lote.costo_unitario);
        $('perdida-valor-estimado').textContent = valida
            ? moneda(Number(lote.costo_unitario) * cantidad) : '—';
    }

    async function cargarLotes() {
        const token = tokenSesion;
        const solicitud = ++solicitudLotes;
        $('perdida-id-lote').disabled = true;
        $('btn-registrar-perdida').disabled = true;
        mensaje('mensaje-registrar-perdida', 'Consultando lotes vencidos...');
        try {
            const respuesta = await window.panaderiaAPI.listarLotesVencidos();
            if (token !== tokenSesion || solicitud !== solicitudLotes) return;
            if (!respuesta.ok) {
                mensaje('mensaje-registrar-perdida', respuesta.mensaje, true);
                lotes = [];
            } else {
                lotes = respuesta.lotes;
                mensaje('mensaje-registrar-perdida', lotes.length
                    ? `Hay ${lotes.length} lote(s) vencido(s) con existencias.`
                    : 'No hay lotes vencidos con existencias disponibles.');
            }
            filtrarLotes();
        } catch (error) {
            console.error('Lotes vencidos:', error);
            if (token === tokenSesion && solicitud === solicitudLotes) {
                mensaje('mensaje-registrar-perdida', 'No se pudo consultar los lotes vencidos.', true);
            }
        } finally {
            if (token === tokenSesion && solicitud === solicitudLotes) {
                $('perdida-id-lote').disabled = false;
            }
        }
    }

    function limpiarFormulario() {
        $('form-registrar-perdida').reset();
        actualizarResumen();
    }

    $('buscar-lote-perdida').addEventListener('input', filtrarLotes);
    $('perdida-id-lote').addEventListener('change', actualizarResumen);
    $('perdida-cantidad').addEventListener('input', actualizarResumen);
    $('btn-limpiar-perdida').addEventListener('click', limpiarFormulario);
    $('btn-recargar-lotes-vencidos').addEventListener('click', cargarLotes);

    $('form-registrar-perdida').addEventListener('submit', async evento => {
        evento.preventDefault();
        const idLote = Number($('perdida-id-lote').value);
        const cantidad = Number($('perdida-cantidad').value);
        const lote = lotes.find(l => l.id_lote === idLote);
        if (!lote || !Number.isSafeInteger(cantidad) || cantidad < 1 ||
            cantidad > lote.cantidad_disponible) {
            mensaje('mensaje-registrar-perdida', 'Comprueba el lote y la cantidad disponible.', true);
            return;
        }
        const estimado = moneda(Number(lote.costo_unitario) * cantidad);
        const confirma = window.confirm(
            `¿Registrar retiro por vencimiento?\n\nProducto: ${lote.nombre}\n` +
            `Lote: #${lote.id_lote}\nUnidades: ${cantidad}\nValor estimado: ${estimado}\n\n` +
            'Se descontarán estas unidades del inventario. La operación quedará en el historial.'
        );
        if (!confirma) return;

        const token = tokenSesion;
        const boton = $('btn-registrar-perdida');
        boton.disabled = true;
        $('perdida-id-lote').disabled = true;
        mensaje('mensaje-registrar-perdida', 'Guardando retiro y movimiento de inventario...');
        try {
            const respuesta = await window.panaderiaAPI.registrarPerdida({
                id_lote: idLote,
                cantidad,
                observacion: $('perdida-observacion').value.trim()
            });
            if (token !== tokenSesion) return;
            if (!respuesta.ok) {
                mensaje('mensaje-registrar-perdida', respuesta.mensaje, true);
                return;
            }
            limpiarFormulario();
            await cargarLotes();
            if (token !== tokenSesion) return;
            mensaje('mensaje-registrar-perdida',
                `Pérdida registrada #${respuesta.registro.id_perdida}. ` +
                `Se retiraron ${respuesta.registro.cantidad} unidad(es). ` +
                `Valor: ${moneda(respuesta.registro.valor_perdida)}.`);
            $('mensaje-registrar-perdida').classList.add('exito');
            window.dispatchEvent(new Event('panaderia:inventario-cambiado'));
        } catch (error) {
            console.error('Registrar pérdida:', error);
            if (token === tokenSesion) {
                mensaje('mensaje-registrar-perdida', 'Error al registrar la pérdida.', true);
            }
        } finally {
            if (token === tokenSesion) {
                $('perdida-id-lote').disabled = false;
                actualizarResumen();
            }
        }
    });

    async function cargarHistorial(pagina = 1) {
        const token = tokenSesion;
        const solicitud = ++solicitudHistorial;
        const desde = $('perdidas-desde').value;
        const hasta = $('perdidas-hasta').value;
        mensaje('mensaje-historial-perdidas', 'Consultando historial...');
        try {
            const respuesta = await window.panaderiaAPI.listarPerdidas({ pagina, desde, hasta });
            if (token !== tokenSesion || solicitud !== solicitudHistorial) return;
            if (!respuesta.ok) {
                mensaje('mensaje-historial-perdidas', respuesta.mensaje, true);
                return;
            }
            paginaActual = respuesta.pagina;
            totalPaginas = respuesta.paginas;
            $('tabla-historial-perdidas').replaceChildren();
            for (const p of respuesta.perdidas) {
                fila($('tabla-historial-perdidas'), [
                    p.id_perdida, fecha(p.fecha_registro), p.responsable,
                    `${p.nombre} (${p.codigo})`, p.id_lote, p.fecha_vencimiento,
                    p.cantidad, moneda(p.costo_unitario), moneda(p.valor_perdida),
                    p.observacion || '—'
                ]);
            }
            $('indicadores-perdidas').hidden = false;
            $('total-retiros-perdidas').textContent = String(respuesta.total_registros);
            $('total-valor-perdidas').textContent = moneda(respuesta.valor_total);
            $('paginacion-perdidas').hidden = respuesta.total_registros <= 25;
            $('perdidas-pagina').textContent = `Página ${paginaActual} de ${totalPaginas}`;
            $('perdidas-anterior').disabled = paginaActual <= 1;
            $('perdidas-siguiente').disabled = paginaActual >= totalPaginas;
            mensaje('mensaje-historial-perdidas', respuesta.total_registros
                ? `Mostrando ${respuesta.perdidas.length} retiro(s) en esta página.`
                : 'No hay pérdidas registradas para estas fechas.');
        } catch (error) {
            console.error('Consultar pérdidas:', error);
            if (token === tokenSesion && solicitud === solicitudHistorial) {
                mensaje('mensaje-historial-perdidas', 'Error al consultar pérdidas.', true);
            }
        }
    }

    $('form-filtros-perdidas').addEventListener('submit', evento => {
        evento.preventDefault();
        cargarHistorial(1);
    });
    $('btn-actualizar-perdidas').addEventListener('click', () => cargarHistorial(paginaActual));
    $('btn-limpiar-filtros-perdidas').addEventListener('click', () => {
        $('perdidas-desde').value = '';
        $('perdidas-hasta').value = '';
        cargarHistorial(1);
    });
    $('perdidas-anterior').addEventListener('click', () => {
        if (paginaActual > 1) cargarHistorial(paginaActual - 1);
    });
    $('perdidas-siguiente').addEventListener('click', () => {
        if (paginaActual < totalPaginas) cargarHistorial(paginaActual + 1);
    });

    window.addEventListener('panaderia:vista', evento => {
        const { modulo, funcion } = evento.detail || {};
        if (modulo !== 'perdidas') return;
        if (funcion === 'registrar') cargarLotes();
        if (funcion === 'consultar') cargarHistorial(1);
    });
    window.addEventListener('panaderia:cerrar-vistas', () => {
        ++tokenSesion;
        ++solicitudLotes;
        ++solicitudHistorial;
        lotes = [];
        paginaActual = 1;
        totalPaginas = 1;
        limpiarFormulario();
        $('perdida-id-lote').replaceChildren();
        $('tabla-historial-perdidas').replaceChildren();
        $('indicadores-perdidas').hidden = true;
        $('paginacion-perdidas').hidden = true;
        $('mensaje-registrar-perdida').textContent = '';
        $('mensaje-historial-perdidas').textContent = '';
        $('perdidas-desde').value = '';
        $('perdidas-hasta').value = '';
    });
})();
