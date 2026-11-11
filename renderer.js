// #&#&# Consulta y registro de productos: sin depender de submenús antiguos.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const formatoPesos = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', maximumFractionDigits: 2
    });
    const comparador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const normalizar = texto => String(texto || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let productos = [];
    let peticion = 0;

    // #&#&# Crear celdas seguras usando textContent.
    function celda(valor) {
        const td = document.createElement('td');
        td.textContent = String(valor);
        return td;
    }

    function pintarProductos() {
        const cuerpo = $('cuerpo-tabla-productos');
        const texto = normalizar($('buscar-nombre-producto').value.trim());
        const filtrados = productos.filter(p => normalizar(p.nombre).includes(texto));
        cuerpo.replaceChildren();
        for (const p of filtrados) {
            const tr = document.createElement('tr');
            [p.codigo, p.nombre, formatoPesos.format(p.precio_venta),
                p.stock_total, p.stock_minimo, p.activo ? 'Activo' : 'Inactivo']
                .forEach(valor => tr.appendChild(celda(valor)));
            const acciones = document.createElement('td');
            const editar = document.createElement('button');
            editar.type = 'button';
            editar.className = 'boton-editar-fila';
            editar.textContent = 'Editar';
            editar.setAttribute('aria-label', `Editar ${p.nombre}`);
            editar.addEventListener('click', () => {
                window.panaderiaUI.abrirFuncion('productos', 'modificar', p.codigo);
            });
            acciones.appendChild(editar);
            tr.appendChild(acciones);
            cuerpo.appendChild(tr);
        }
        $('contador-productos').textContent =
            `Mostrando ${filtrados.length} de ${productos.length} producto(s).`;
    }

    async function cargarProductos() {
        const version = ++peticion;
        const boton = $('btn-listar-productos');
        boton.disabled = true;
        $('estado-productos').textContent = 'Consultando productos...';
        try {
            const r = await window.panaderiaAPI.listarProductos();
            if (version !== peticion) return;
            if (!r.ok) {
                $('estado-productos').textContent = r.mensaje;
                productos = [];
            } else {
                productos = r.productos.sort((a, b) =>
                    comparador.compare(a.nombre, b.nombre) ||
                    comparador.compare(a.codigo, b.codigo)
                );
                $('estado-productos').textContent = `${productos.length} producto(s) consultado(s).`;
            }
            pintarProductos();
        } catch (error) {
            console.error('Productos:', error);
            if (version === peticion) $('estado-productos').textContent = 'Error al consultar productos.';
        } finally {
            if (version === peticion) boton.disabled = false;
        }
    }

    $('btn-listar-productos').addEventListener('click', cargarProductos);
    $('buscar-nombre-producto').addEventListener('input', pintarProductos);

    const formulario = $('form-registrar-producto');
    formulario.addEventListener('submit', async evento => {
        evento.preventDefault();
        const boton = $('btn-guardar-producto');
        const mensaje = $('mensaje-registro-producto');
        const datos = {
            codigo: $('codigo-producto').value.trim().toUpperCase(),
            nombre: $('nombre-producto').value.trim(),
            costo_referencia: $('costo-producto').value.trim(),
            precio_venta: $('precio-producto').value.trim(),
            stock_minimo: $('minimo-producto').value.trim()
        };
        boton.disabled = true;
        mensaje.textContent = 'Guardando producto...';
        mensaje.className = 'mensaje';
        try {
            const r = await window.panaderiaAPI.registrarProducto(datos);
            mensaje.textContent = r.mensaje;
            mensaje.className = r.ok ? 'mensaje exito' : 'mensaje error';
            if (r.ok) formulario.reset();
        } catch (error) {
            console.error('Registro de productos:', error);
            mensaje.textContent = 'No se pudo registrar el producto.';
            mensaje.className = 'mensaje error';
        } finally {
            boton.disabled = false;
        }
    });

    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail.modulo === 'productos' && evento.detail.funcion === 'consultar') {
            cargarProductos();
        }
    });

    // #&#&# Vaciar información consultada al cerrar sesión.
    window.addEventListener('panaderia:cerrar-vistas', () => {
        peticion++;
        productos = [];
        $('cuerpo-tabla-productos').replaceChildren();
        $('buscar-nombre-producto').value = '';
        $('estado-productos').textContent = '';
        $('contador-productos').textContent = '';
        formulario.reset();
        $('mensaje-registro-producto').textContent = '';
    });
})();
