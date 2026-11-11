// #&#&# Inventario: entradas por lote y consulta con filtros.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const formato = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', maximumFractionDigits: 2
    });
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const normalizar = s => String(s || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let lotes = [];
    let peticionLotes = 0;
    let peticionProductos = 0;

    function celda(texto) {
        const td = document.createElement('td');
        td.textContent = String(texto);
        return td;
    }

    function pintarLotes() {
        const texto = normalizar($('buscar-nombre-lote').value.trim());
        const orden = $('ordenar-lotes').value;
        const filtrados = lotes.filter(l => normalizar(l.nombre).includes(texto));
        filtrados.sort((a, b) => {
            const nombre = collator.compare(a.nombre, b.nombre);
            const fecha = a.fecha_vencimiento.localeCompare(b.fecha_vencimiento);
            if (orden === 'nombre-desc') return -nombre || a.id_lote - b.id_lote;
            if (orden === 'fecha-asc') return fecha || nombre || a.id_lote - b.id_lote;
            if (orden === 'fecha-desc') return -fecha || nombre || a.id_lote - b.id_lote;
            return nombre || a.id_lote - b.id_lote;
        });
        const cuerpo = $('cuerpo-tabla-lotes');
        cuerpo.replaceChildren();
        for (const lote of filtrados) {
            const tr = document.createElement('tr');
            [lote.id_lote, lote.codigo, lote.nombre, lote.cantidad_disponible,
                lote.fecha_vencimiento, formato.format(lote.costo_unitario)]
                .forEach(valor => tr.appendChild(celda(valor)));
            cuerpo.appendChild(tr);
        }
        $('contador-lotes').textContent =
            `Mostrando ${filtrados.length} de ${lotes.length} lote(s).`;
    }

    async function cargarLotes() {
        const version = ++peticionLotes;
        const boton = $('btn-listar-lotes');
        boton.disabled = true;
        $('estado-lotes').textContent = 'Consultando lotes...';
        try {
            const r = await window.panaderiaAPI.listarLotes();
            if (version !== peticionLotes) return;
            lotes = r.ok ? r.lotes : [];
            $('estado-lotes').textContent = r.ok ?
                `${lotes.length} lote(s) consultado(s).` : r.mensaje;
            pintarLotes();
        } catch (error) {
            console.error('Lotes:', error);
            if (version === peticionLotes) $('estado-lotes').textContent = 'No se pudieron consultar los lotes.';
        } finally {
            if (version === peticionLotes) boton.disabled = false;
        }
    }

    async function cargarProductosEntrada() {
        const version = ++peticionProductos;
        const selector = $('entrada-codigo');
        selector.disabled = true;
        selector.replaceChildren();
        const inicial = document.createElement('option');
        inicial.value = '';
        inicial.textContent = 'Selecciona un producto activo';
        selector.appendChild(inicial);
        try {
            const r = await window.panaderiaAPI.listarProductos();
            if (version !== peticionProductos) return;
            if (!r.ok) {
                $('mensaje-entrada').textContent = r.mensaje;
                return;
            }
            r.productos.filter(p => p.activo).sort((a, b) => collator.compare(a.nombre, b.nombre))
                .forEach(p => {
                    const op = document.createElement('option');
                    op.value = p.codigo;
                    op.textContent = `${p.nombre} (${p.codigo})`;
                    selector.appendChild(op);
                });
        } catch (error) {
            console.error('Productos para entrada:', error);
            if (version === peticionProductos) $('mensaje-entrada').textContent = 'No se pudieron cargar productos.';
        } finally {
            if (version === peticionProductos) selector.disabled = false;
        }
    }

    $('btn-listar-lotes').addEventListener('click', cargarLotes);
    $('buscar-nombre-lote').addEventListener('input', pintarLotes);
    $('ordenar-lotes').addEventListener('change', pintarLotes);

    const form = $('form-ingreso-lote');
    form.addEventListener('submit', async evento => {
        evento.preventDefault();
        const boton = $('btn-registrar-entrada');
        const mensaje = $('mensaje-entrada');
        const datos = {
            codigo: $('entrada-codigo').value,
            cantidad: $('entrada-cantidad').value,
            fecha_vencimiento: $('entrada-fecha').value,
            costo_unitario: $('entrada-costo').value.trim()
        };
        boton.disabled = true;
        mensaje.textContent = 'Registrando entrada...';
        mensaje.className = 'mensaje';
        try {
            const r = await window.panaderiaAPI.registrarEntrada(datos);
            mensaje.textContent = r.ok ? `${r.mensaje} Lote #${r.id_lote}.` : r.mensaje;
            mensaje.className = r.ok ? 'mensaje exito' : 'mensaje error';
            if (r.ok) form.reset();
        } catch (error) {
            console.error('Entrada:', error);
            mensaje.textContent = 'No se pudo registrar la entrada.';
            mensaje.className = 'mensaje error';
        } finally {
            boton.disabled = false;
        }
    });

    window.addEventListener('panaderia:vista', evento => {
        const { modulo, funcion } = evento.detail;
        if (modulo === 'inventario' && funcion === 'lotes') cargarLotes();
        if (modulo === 'inventario' && funcion === 'entrada') cargarProductosEntrada();
    });
    window.addEventListener('panaderia:cerrar-vistas', () => {
        peticionLotes++;
        peticionProductos++;
        lotes = [];
        $('cuerpo-tabla-lotes').replaceChildren();
        $('buscar-nombre-lote').value = '';
        $('ordenar-lotes').value = 'nombre-asc';
        $('estado-lotes').textContent = '';
        $('contador-lotes').textContent = '';
        form.reset();
        $('mensaje-entrada').textContent = '';
    });
})();
