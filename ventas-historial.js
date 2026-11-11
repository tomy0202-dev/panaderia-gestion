// #&#&# PASO 29: HISTORIAL DE VENTAS CON DETALLE VISIBLE (LECTURA, SOLO ADMINISTRADOR)
// #&#&# Muestra fecha, responsable, importes y detalles por lote.

(() => {
    'use strict';

    const $ = id => document.getElementById(id);
    const formulario = $('form-filtros-ventas');
    const cuerpo = $('cuerpo-historial-ventas');
    const mensaje = $('mensaje-historial-ventas');
    const indicadores = $('indicadores-historial');
    const paginacion = $('paginacion-historial');
    const detalle = $('detalle-historial-venta');

    if (!formulario || !cuerpo || !detalle) {
        console.error('No se encontraron los controles del historial de ventas.');
        return;
    }

    const pesos = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 2
    });

    let paginaActual = 1;
    let paginasDisponibles = 0;
    let versionListado = 0;
    let versionDetalle = 0;
    let versionSesion = 0;

    function dinero(valor) {
        return pesos.format(Number(valor));
    }

    function fechaVisible(texto) {
        // #&#&# MySQL retorna 'AAAA-MM-DD HH:mm:ss'.
        // #&#&# Sin conversiones de zona horaria en JavaScript.
        if (typeof texto !== 'string' || texto.length < 19) {
            return String(texto ?? '');
        }
        return `${texto.slice(8, 10)}/${texto.slice(5, 7)}/` +
            `${texto.slice(0, 4)} ${texto.slice(11)}`;
    }

    function celda(texto) {
        const td = document.createElement('td');
        td.textContent = String(texto ?? '');
        return td;
    }

    // #&#&# El detalle es un diálogo modal, no un panel debajo de la lista.
    // #&#&# Puede cerrarse con el botón o con Escape.
    function ocultarDetalle() {
        ++versionDetalle;
        if (detalle.open) detalle.close();
        $('cuerpo-detalle-venta').replaceChildren();
        $('detalle-resumen-venta').textContent = '';
        $('detalle-mensaje-venta').textContent = '';
    }

    function filtrosActuales() {
        const numero = $('historial-numero').value.trim();
        const desde = $('historial-desde').value;
        const hasta = $('historial-hasta').value;
        const cajero = $('historial-cajero').value.trim();

        if (numero && !/^[1-9]\d{0,14}$/.test(numero)) {
            throw new Error('El número de venta debe ser un entero positivo.');
        }
        if (desde && hasta && desde > hasta) {
            throw new Error('La fecha inicial no puede superar la final.');
        }

        return {
            pagina: 1,
            numero_venta: numero,
            desde,
            hasta,
            cajero
        };
    }

    async function consultarVentas(paginaSolicitada = 1) {
        const version = ++versionListado;
        const sesion = versionSesion;
        ocultarDetalle();

        let filtros;
        try {
            filtros = filtrosActuales();
        } catch (error) {
            mensaje.className = 'mensaje error';
            mensaje.textContent = error.message;
            return;
        }

        filtros.pagina = paginaSolicitada;
        mensaje.className = 'mensaje';
        mensaje.textContent = 'Consultando ventas...';
        $('btn-actualizar-historial').disabled = true;
        cuerpo.replaceChildren();
        indicadores.hidden = true;
        paginacion.hidden = true;

        try {
            const respuesta = await window.panaderiaAPI.listarHistorialVentas(filtros);
            if (version !== versionListado || sesion !== versionSesion) return;

            if (!respuesta.ok) {
                mensaje.className = 'mensaje error';
                mensaje.textContent = respuesta.mensaje;
                return;
            }

            paginaActual = respuesta.pagina;
            paginasDisponibles = Math.ceil(
                respuesta.total_registros / respuesta.tamano_pagina
            );

            $('historial-total-ventas').textContent =
                String(respuesta.total_registros);
            $('historial-total-importe').textContent =
                dinero(respuesta.importe_total);
            indicadores.hidden = false;

            // #&#&# Filas creadas con textContent, nunca HTML dinámico.
            for (const venta of respuesta.ventas) {
                const fila = document.createElement('tr');
                [
                    `#${venta.id_venta}`,
                    fechaVisible(venta.fecha_venta),
                    venta.responsable,
                    venta.productos,
                    venta.unidades,
                    dinero(venta.total)
                ].forEach(texto => fila.appendChild(celda(texto)));

                const acciones = document.createElement('td');
                const boton = document.createElement('button');
                boton.type = 'button';
                boton.className = 'boton-editar-fila';
                boton.textContent = 'Ver detalle';
                boton.setAttribute(
                    'aria-label', `Ver detalle de la venta ${venta.id_venta}`
                );
                boton.addEventListener('click', () => {
                    consultarDetalle(venta.id_venta);
                });
                acciones.appendChild(boton);
                fila.appendChild(acciones);
                cuerpo.appendChild(fila);
            }

            if (respuesta.total_registros === 0) {
                mensaje.textContent = 'No se encontraron ventas con esos filtros.';
            } else {
                const desde = (paginaActual - 1) * respuesta.tamano_pagina + 1;
                const hasta = Math.min(
                    respuesta.total_registros,
                    paginaActual * respuesta.tamano_pagina
                );
                mensaje.textContent = `Mostrando ventas ${desde} a ${hasta} ` +
                    `de ${respuesta.total_registros}.`;
                paginacion.hidden = false;
                $('historial-pagina').textContent =
                    `Página ${paginaActual} de ${paginasDisponibles}`;
                $('historial-anterior').disabled = paginaActual <= 1;
                $('historial-siguiente').disabled =
                    paginaActual >= paginasDisponibles;
            }
        } catch (error) {
            console.error('Historial de ventas:', error);
            if (version === versionListado && sesion === versionSesion) {
                mensaje.className = 'mensaje error';
                mensaje.textContent = 'Error al consultar ventas.';
            }
        } finally {
            if (version === versionListado && sesion === versionSesion) {
                $('btn-actualizar-historial').disabled = false;
            }
        }
    }

    async function consultarDetalle(idVenta) {
        const version = ++versionDetalle;
        const sesion = versionSesion;
        // #&#&# Mostrar inmediatamente la ventana, incluso si MySQL tarda
        // #&#&# o devuelve un error. El administrador siempre recibirá respuesta.
        if (!detalle.open) detalle.showModal();
        $('detalle-titulo-venta').textContent = `Detalle de venta #${idVenta}`;
        $('detalle-mensaje-venta').className = 'mensaje';
        $('detalle-mensaje-venta').textContent = 'Consultando detalle...';
        $('detalle-resumen-venta').textContent = '';
        $('cuerpo-detalle-venta').replaceChildren();

        try {
            const respuesta = await window.panaderiaAPI.obtenerDetalleVenta(idVenta);
            if (version !== versionDetalle || sesion !== versionSesion) return;

            if (!respuesta.ok) {
                $('detalle-mensaje-venta').className = 'mensaje error';
                $('detalle-mensaje-venta').textContent = respuesta.mensaje;
                return;
            }

            const venta = respuesta.venta;
            $('detalle-resumen-venta').textContent =
                `Fecha: ${fechaVisible(venta.fecha_venta)} · ` +
                `Usuario responsable: ${venta.responsable} · ` +
                `Total: ${dinero(venta.total)}`;

            for (const linea of venta.detalles) {
                const fila = document.createElement('tr');
                [
                    linea.codigo,
                    linea.nombre_actual,
                    `#${linea.id_lote}`,
                    linea.vencimiento,
                    linea.cantidad,
                    dinero(linea.precio_unitario),
                    dinero(linea.costo_unitario),
                    dinero(linea.subtotal)
                ].forEach(texto => fila.appendChild(celda(texto)));
                $('cuerpo-detalle-venta').appendChild(fila);
            }

            $('detalle-mensaje-venta').textContent = venta.detalles.length
                ? `${venta.detalles.length} registro(s) de lote para esta venta.`
                : 'Esta venta existe, pero no tiene líneas en detalle_ventas. ' +
                  'Comprueba la venta con la consulta SQL de diagnóstico.';

        } catch (error) {
            console.error('Detalle de venta:', error);
            if (version === versionDetalle && sesion === versionSesion) {
                $('detalle-mensaje-venta').className = 'mensaje error';
                $('detalle-mensaje-venta').textContent =
                    'No se pudo consultar el detalle de esta venta.';
            }
        }
    }

    formulario.addEventListener('submit', evento => {
        evento.preventDefault();
        consultarVentas(1);
    });

    $('btn-actualizar-historial').addEventListener('click', () => {
        consultarVentas(paginaActual);
    });
    $('btn-limpiar-historial').addEventListener('click', () => {
        formulario.reset();
        consultarVentas(1);
    });
    $('historial-anterior').addEventListener('click', () => {
        if (paginaActual > 1) consultarVentas(paginaActual - 1);
    });
    $('historial-siguiente').addEventListener('click', () => {
        if (paginaActual < paginasDisponibles) consultarVentas(paginaActual + 1);
    });
    $('cerrar-detalle-venta').addEventListener('click', ocultarDetalle);
    // #&#&# Evitar que una consulta tardía vuelva a escribir sobre una
    // #&#&# ventana que el usuario cerró pulsando Escape.
    detalle.addEventListener('cancel', evento => {
        evento.preventDefault();
        ocultarDetalle();
    });

    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail.modulo === 'ventas' &&
            evento.detail.funcion === 'consultar') {
            consultarVentas(1);
        } else {
            // #&#&# Ignorar respuestas tardías de pantallas ya cerradas.
            ++versionListado;
            ocultarDetalle();
        }
    });

    window.addEventListener('panaderia:cerrar-vistas', () => {
        ++versionSesion;
        ++versionListado;
        ocultarDetalle();
        formulario.reset();
        cuerpo.replaceChildren();
        indicadores.hidden = true;
        paginacion.hidden = true;
        mensaje.textContent = '';
    });
})();
