// #&#&# Modificar producto: permite reactivarlo e inactivarlo.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const selector = $('editar-codigo');
    const form = $('form-modificar-producto');
    const guardar = $('btn-actualizar-producto');
    const mensaje = $('mensaje-editar-producto');
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    let version = 0;
    let codigoCargado = '';

    function vaciar() {
        ['editar-nombre', 'editar-costo', 'editar-precio', 'editar-minimo']
            .forEach(id => { $(id).value = ''; });
        $('editar-activo').checked = false;
        guardar.disabled = true;
        codigoCargado = '';
    }

    async function obtenerDetalle() {
        const actual = ++version;
        const codigo = selector.value;
        vaciar();
        if (!codigo) {
            mensaje.textContent = 'Selecciona un producto.';
            return;
        }
        mensaje.textContent = 'Cargando detalles...';
        try {
            const r = await window.panaderiaAPI.obtenerDetalleProducto(codigo);
            if (actual !== version || selector.value !== codigo) return;
            if (!r.ok) {
                mensaje.textContent = r.mensaje;
                return;
            }
            const p = r.producto;
            $('editar-nombre').value = p.nombre;
            $('editar-costo').value = p.costo_referencia;
            $('editar-precio').value = p.precio_venta;
            $('editar-minimo').value = String(p.stock_minimo);
            $('editar-activo').checked = p.activo;
            codigoCargado = p.codigo;
            guardar.disabled = false;
            mensaje.textContent = 'Revisa los campos y guarda los cambios.';
            mensaje.className = 'mensaje';
        } catch (error) {
            console.error('Detalle:', error);
            if (actual === version) mensaje.textContent = 'Error al cargar el producto.';
        }
    }

    async function cargarOpciones(codigoObjetivo = '') {
        const actual = ++version;
        vaciar();
        selector.disabled = true;
        selector.replaceChildren();
        const inicial = document.createElement('option');
        inicial.value = '';
        inicial.textContent = 'Selecciona un producto';
        selector.appendChild(inicial);
        mensaje.textContent = 'Cargando productos...';
        try {
            const r = await window.panaderiaAPI.listarProductos();
            if (actual !== version) return;
            if (!r.ok) {
                mensaje.textContent = r.mensaje;
                return;
            }
            const productos = r.productos.sort((a, b) => collator.compare(a.nombre, b.nombre));
            for (const p of productos) {
                const op = document.createElement('option');
                op.value = p.codigo;
                op.textContent = `${p.nombre} (${p.codigo})${p.activo ? '' : ' — Inactivo'}`;
                selector.appendChild(op);
            }
            selector.disabled = false;
            if (codigoObjetivo && productos.some(p => p.codigo === codigoObjetivo)) {
                selector.value = codigoObjetivo;
                await obtenerDetalle();
            } else {
                mensaje.textContent = 'Selecciona un producto para editarlo.';
            }
        } catch (error) {
            console.error('Listado para edición:', error);
            if (actual === version) mensaje.textContent = 'No se pudieron cargar los productos.';
        } finally {
            if (actual === version) selector.disabled = false;
        }
    }

    selector.addEventListener('change', obtenerDetalle);
    form.addEventListener('submit', async evento => {
        evento.preventDefault();
        if (!codigoCargado || selector.value !== codigoCargado) {
            mensaje.textContent = 'Selecciona un producto y carga sus datos.';
            return;
        }
        const datos = {
            codigo: codigoCargado,
            nombre: $('editar-nombre').value.trim(),
            costo_referencia: $('editar-costo').value.trim(),
            precio_venta: $('editar-precio').value.trim(),
            stock_minimo: $('editar-minimo').value.trim(),
            activo: $('editar-activo').checked
        };
        guardar.disabled = true;
        selector.disabled = true;
        mensaje.textContent = 'Guardando cambios...';
        mensaje.className = 'mensaje';
        try {
            const r = await window.panaderiaAPI.modificarProducto(datos);
            mensaje.textContent = r.mensaje;
            mensaje.className = r.ok ? 'mensaje exito' : 'mensaje error';
        } catch (error) {
            console.error('Modificar:', error);
            mensaje.textContent = 'Error al actualizar el producto.';
            mensaje.className = 'mensaje error';
        } finally {
            selector.disabled = false;
            guardar.disabled = !codigoCargado;
        }
    });

    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail.modulo === 'productos' && evento.detail.funcion === 'modificar') {
            cargarOpciones(evento.detail.codigo || '');
        }
    });
    window.addEventListener('panaderia:cerrar-vistas', () => {
        version++;
        selector.value = '';
        selector.replaceChildren();
        vaciar();
        mensaje.textContent = '';
    });
})();
