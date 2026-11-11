// #&#&# PASO 30: CATÁLOGO BUSCABLE, CANTIDAD A LA DERECHA Y CARRITO
// #&#&# El carrito es provisional: únicamente MySQL confirma stock y precios.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const cuerpoCatalogo = $('cuerpo-catalogo-ventas');
    const cuerpoCarrito = $('cuerpo-carrito-ventas');
    const dialogo = $('dialogo-carrito-ventas');
    const mensaje = $('mensaje-venta');
    const mensajeCarrito = $('mensaje-carrito-ventas');
    const resultado = $('resultado-venta');
    const btnFinalizar = $('btn-finalizar-carrito');
    const btnCarrito = $('btn-abrir-carrito');
    const numero = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', maximumFractionDigits: 2
    });
    const ordenar = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const productos = new Map();
    const carrito = new Map();
    let versionCatalogo = 0;
    let versionSesion = 0;
    let guardando = false;
    let catalogoDisponible = false;

    const pesos = valor => numero.format(Number(valor));
    const normalizar = valor => String(valor || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    function celda(texto) {
        const td = document.createElement('td');
        td.textContent = String(texto ?? '');
        return td;
    }

    function cantidadValida(valor) {
        if (!/^[1-9]\d*$/.test(String(valor))) return null;
        const n = Number(valor);
        return Number.isSafeInteger(n) && n <= 2147483647 ? n : null;
    }

    // #&#&# Evitar aritmética de punto flotante al previsualizar el total.
    function centavos(valor) {
        const [entero, decimal = ''] = String(valor).split('.');
        return BigInt(entero) * 100n + BigInt(decimal.padEnd(2, '0'));
    }
    function dineroTexto(c) {
        return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
    }

    function resumenCarrito() {
        let total = 0n;
        let unidades = 0;
        let valido = carrito.size > 0;
        for (const [codigo, cantidad] of carrito) {
            const p = productos.get(codigo);
            if (!p || !p.activo || p.stock_total < cantidad || !cantidadValida(cantidad)) {
                valido = false;
                continue;
            }
            total += centavos(p.precio_venta) * BigInt(cantidad);
            unidades += cantidad;
        }
        return { total, unidades, valido };
    }

    function actualizarBotonCarrito() {
        const { total, unidades } = resumenCarrito();
        btnCarrito.textContent = `Carrito (${carrito.size} productos · ${unidades} unidades)`;
        $('venta-total-carrito-boton').textContent = pesos(dineroTexto(total));
        btnCarrito.disabled = carrito.size === 0 || guardando;
    }

    function pintarCatalogo() {
        cuerpoCatalogo.replaceChildren();
        const filtro = normalizar($('buscar-producto-venta').value.trim());
        const lista = [...productos.values()].filter(p =>
            normalizar(p.nombre).includes(filtro)
        ).sort((a, b) => ordenar.compare(a.nombre, b.nombre) ||
            ordenar.compare(a.codigo, b.codigo));

        for (const p of lista) {
            const fila = document.createElement('tr');
            fila.appendChild(celda(p.nombre));
            fila.appendChild(celda(p.codigo));
            fila.appendChild(celda(pesos(p.precio_venta)));
            fila.appendChild(celda(p.stock_total));
            const disponible = p.activo && p.stock_total > 0;
            fila.appendChild(celda(!p.activo ? 'Inactivo' :
                p.stock_total === 0 ? 'Sin existencias' : 'Disponible'));

            const cantidadCelda = document.createElement('td');
            const campo = document.createElement('input');
            campo.type = 'number';
            campo.min = '1';
            campo.max = String(Math.max(1, p.stock_total));
            campo.step = '1';
            campo.value = '1';
            campo.className = 'cantidad-catalogo-venta';
            campo.disabled = !disponible || guardando;
            campo.setAttribute('aria-label', `Cantidad de ${p.nombre}`);
            cantidadCelda.appendChild(campo);
            fila.appendChild(cantidadCelda);

            const accion = document.createElement('td');
            const agregar = document.createElement('button');
            agregar.type = 'button';
            agregar.className = 'boton-agregar-carrito';
            agregar.textContent = '+';
            agregar.title = `Añadir ${p.nombre} al carrito`;
            agregar.setAttribute('aria-label', `Añadir ${p.nombre} al carrito`);
            agregar.disabled = !disponible || guardando;
            agregar.addEventListener('click', () => {
                const cantidad = cantidadValida(campo.value.trim());
                const previa = carrito.get(p.codigo) || 0;
                if (!cantidad || cantidad > p.stock_total ||
                    previa + cantidad > p.stock_total) {
                    mensaje.className = 'mensaje error';
                    mensaje.textContent = `Cantidad inválida o superior al stock de ${p.nombre}. ` +
                        'Revisa también las unidades que ya están en el carrito.';
                    return;
                }
                if (!carrito.has(p.codigo) && carrito.size >= 60) {
                    mensaje.className = 'mensaje error';
                    mensaje.textContent = 'Se permiten como máximo 60 productos por venta.';
                    return;
                }
                carrito.set(p.codigo, previa + cantidad);
                campo.value = '1';
                mensaje.className = 'mensaje exito';
                mensaje.textContent = `${cantidad} unidad(es) de ${p.nombre} añadida(s) al carrito.`;
                actualizarBotonCarrito();
                if (dialogo.open) pintarCarrito();
            });
            accion.appendChild(agregar);
            fila.appendChild(accion);
            cuerpoCatalogo.appendChild(fila);
        }
        $('contador-catalogo-ventas').textContent =
            `Mostrando ${lista.length} de ${productos.size} producto(s).`;
    }

    function pintarCarrito() {
        cuerpoCarrito.replaceChildren();
        const productosCarrito = [...carrito.entries()];
        for (const [codigo, cantidad] of productosCarrito) {
            const p = productos.get(codigo);
            const fila = document.createElement('tr');
            fila.appendChild(celda(p ? p.nombre : `Producto ${codigo} no disponible`));
            fila.appendChild(celda(codigo));
            fila.appendChild(celda(p ? pesos(p.precio_venta) : '—'));
            fila.appendChild(celda(p ? p.stock_total : '—'));

            const celdaCantidad = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '1';
            input.max = String(p ? Math.max(1, p.stock_total) : 1);
            input.step = '1';
            input.value = String(cantidad);
            input.className = 'cantidad-carrito-venta';
            input.disabled = guardando;
            input.setAttribute('aria-label', `Cantidad en carrito de ${codigo}`);
            input.addEventListener('change', () => {
                const nueva = cantidadValida(input.value.trim());
                if (!nueva || !p || !p.activo || nueva > p.stock_total) {
                    mensajeCarrito.className = 'mensaje error';
                    mensajeCarrito.textContent =
                        'La cantidad debe ser entera, positiva y no superar las existencias.';
                    input.value = String(carrito.get(codigo));
                    return;
                }
                carrito.set(codigo, nueva);
                mensajeCarrito.textContent = '';
                pintarCarrito();
                actualizarBotonCarrito();
            });
            celdaCantidad.appendChild(input);
            fila.appendChild(celdaCantidad);
            fila.appendChild(celda(p ? pesos(dineroTexto(
                centavos(p.precio_venta) * BigInt(cantidad))) : '—'));

            const acciones = document.createElement('td');
            const quitar = document.createElement('button');
            quitar.type = 'button';
            quitar.className = 'boton-editar-fila';
            quitar.textContent = 'Quitar';
            quitar.disabled = guardando;
            quitar.addEventListener('click', () => {
                carrito.delete(codigo);
                pintarCarrito();
                actualizarBotonCarrito();
            });
            acciones.appendChild(quitar);
            fila.appendChild(acciones);
            cuerpoCarrito.appendChild(fila);
        }

        const r = resumenCarrito();
        $('carrito-total-venta').textContent = pesos(dineroTexto(r.total));
        $('carrito-unidades-venta').textContent = String(r.unidades);
        btnFinalizar.disabled = !r.valido || guardando;
        if (!guardando && !r.valido) {
            mensajeCarrito.className = 'mensaje error';
            mensajeCarrito.textContent = carrito.size === 0
                ? 'El carrito está vacío. Añade productos desde el catálogo.'
                : 'Hay productos inactivos, sin existencias o con cantidades inválidas. ' +
                  'Actualiza el catálogo o quítalos antes de finalizar.';
        } else if (!guardando) {
            mensajeCarrito.className = 'mensaje';
            mensajeCarrito.textContent = 'Los precios y existencias se comprobarán al finalizar.';
        }
    }

    async function cargarCatalogo() {
        const version = ++versionCatalogo;
        const sesion = versionSesion;
        catalogoDisponible = false;
        $('btn-actualizar-catalogo-ventas').disabled = true;
        mensaje.className = 'mensaje';
        mensaje.textContent = 'Actualizando productos...';
        try {
            const r = await window.panaderiaAPI.listarCatalogoVentas();
            if (version !== versionCatalogo || sesion !== versionSesion) return;
            productos.clear();
            if (!r.ok) {
                mensaje.className = 'mensaje error';
                mensaje.textContent = r.mensaje;
                return;
            }
            for (const p of r.productos) productos.set(p.codigo, p);
            catalogoDisponible = true;
            mensaje.className = 'mensaje';
            mensaje.textContent = `${productos.size} producto(s) consultado(s).`;
        } catch (error) {
            console.error('Catálogo:', error);
            if (version === versionCatalogo && sesion === versionSesion) {
                productos.clear();
                mensaje.className = 'mensaje error';
                mensaje.textContent = 'No se pudo actualizar el catálogo.';
            }
        } finally {
            if (version === versionCatalogo && sesion === versionSesion) {
                $('btn-actualizar-catalogo-ventas').disabled = false;
                pintarCatalogo();
                actualizarBotonCarrito();
                if (dialogo.open) pintarCarrito();
            }
        }
    }

    function pintarComprobante(venta) {
        resultado.replaceChildren();
        const titulo = document.createElement('h3');
        titulo.textContent = `Venta #${venta.id_venta} registrada`;
        resultado.appendChild(titulo);
        for (const p of venta.productos) {
            const linea = document.createElement('p');
            linea.textContent = `${p.cantidad} × ${p.nombre} (${p.codigo}) · ` +
                `${pesos(p.precio_unitario)} c/u · Subtotal ${pesos(p.subtotal)}`;
            resultado.appendChild(linea);
            for (const l of p.lotes_utilizados) {
                const detalle = document.createElement('p');
                detalle.className = 'venta-lote-comprobante';
                detalle.textContent = `Lote #${l.id_lote}: ${l.cantidad} unidades, vence ${l.fecha_vencimiento}`;
                resultado.appendChild(detalle);
            }
        }
        const total = document.createElement('p');
        total.className = 'venta-total-final';
        total.textContent = `Total: ${pesos(venta.total)}`;
        resultado.appendChild(total);
        resultado.hidden = false;
    }

    async function finalizarVenta() {
        if (guardando || !catalogoDisponible || !resumenCarrito().valido) return;
        const resumen = resumenCarrito();
        if (!window.confirm(`¿Confirmar la venta de ${resumen.unidades} unidad(es) ` +
            `de ${carrito.size} producto(s) por ${pesos(dineroTexto(resumen.total))}?\n` +
            'Se descontará inventario real.')) return;

        const items = [...carrito.entries()].map(([codigo, cantidad]) => ({ codigo, cantidad }));
        const totalEsperado = dineroTexto(resumen.total);
        const version = versionSesion;
        guardando = true;
        mensajeCarrito.className = 'mensaje';
        mensajeCarrito.textContent = 'Guardando venta completa en MySQL...';
        pintarCarrito();
        btnCarrito.disabled = true;
        try {
            let r = await window.panaderiaAPI.registrarVenta({
                items, total_esperado: totalEsperado, aceptar_vencidos: false
            });
            if (version !== versionSesion) return;
            if (r.requiere_confirmacion) {
                const aviso = (r.lotes_vencidos || []).map(l =>
                    `${l.nombre} · lote #${l.id_lote} · ${l.cantidad} unidad(es) · ` +
                    `venció ${l.fecha_vencimiento}`).join('\n');
                if (!window.confirm(
                    'ATENCIÓN: la venta utilizaría productos vencidos.\n\n' + aviso +
                    '\n\n¿Deseas venderlos igualmente?'
                )) {
                    mensajeCarrito.textContent = 'Venta cancelada: no se descontó inventario.';
                    return;
                }
                r = await window.panaderiaAPI.registrarVenta({
                    items, total_esperado: totalEsperado, aceptar_vencidos: true
                });
            }
            if (version !== versionSesion) return;
            if (!r.ok) {
                mensajeCarrito.className = 'mensaje error';
                mensajeCarrito.textContent = r.mensaje;
                await cargarCatalogo();
                return;
            }
            carrito.clear();
            cuerpoCarrito.replaceChildren();
            if (dialogo.open) dialogo.close();
            pintarComprobante(r.venta);
            await cargarCatalogo();
            if (version === versionSesion) {
                mensaje.className = 'mensaje exito';
                mensaje.textContent = `Venta #${r.venta.id_venta} registrada. ` +
                    'Las existencias se actualizaron correctamente.';
            }
        } catch (error) {
            console.error('Finalizar venta:', error);
            if (version === versionSesion) {
                mensajeCarrito.className = 'mensaje error';
                mensajeCarrito.textContent =
                    'Hubo un problema de comunicación. Comprueba el historial antes de reintentar.';
            }
        } finally {
            guardando = false;
            if (version === versionSesion) {
                pintarCatalogo();
                actualizarBotonCarrito();
                if (dialogo.open) pintarCarrito();
            }
        }
    }

    $('buscar-producto-venta').addEventListener('input', pintarCatalogo);
    $('btn-actualizar-catalogo-ventas').addEventListener('click', cargarCatalogo);
    btnCarrito.addEventListener('click', () => {
        if (!dialogo.open) {
            pintarCarrito();
            dialogo.showModal();
        }
    });
    $('btn-cerrar-carrito').addEventListener('click', () => dialogo.close());
    btnFinalizar.addEventListener('click', finalizarVenta);

    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail.modulo === 'ventas' && evento.detail.funcion === 'registrar') {
            $('buscar-producto-venta').value = '';
            cargarCatalogo();
        }
    });

    window.addEventListener('panaderia:cerrar-vistas', () => {
        ++versionSesion;
        ++versionCatalogo;
        guardando = false;
        catalogoDisponible = false;
        productos.clear();
        carrito.clear();
        if (dialogo.open) dialogo.close();
        cuerpoCatalogo.replaceChildren();
        cuerpoCarrito.replaceChildren();
        mensaje.textContent = '';
        mensajeCarrito.textContent = '';
        resultado.hidden = true;
        resultado.replaceChildren();
        $('buscar-producto-venta').value = '';
        $('contador-catalogo-ventas').textContent = '';
        actualizarBotonCarrito();
    });
    actualizarBotonCarrito();
})();
