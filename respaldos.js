// #&#&# PASO 32. INTERFACES DE RESPALDOS Y RESTAURACIÓN
// #&#&# Las rutas y las credenciales permanecen en el proceso principal.
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const tabla = $('cuerpo-lista-respaldos');
    const selector = $('respaldo-a-restaurar');
    const estadoLista = $('estado-respaldos');
    const estadoRestaurar = $('estado-restaurar');
    const btnCrear = $('btn-crear-respaldo');
    const btnActualizar = $('btn-actualizar-respaldos');
    const btnRestaurar = $('btn-confirmar-restauracion');
    const btnReiniciar = $('btn-cerrar-tras-restauracion');
    if (!tabla || !selector || !btnCrear) return;

    let trabajando = false;
    let reinicioPendiente = false;
    let copias = [];

    const formatearFecha = fecha => {
        const fechaValida = new Date(fecha);
        return Number.isNaN(fechaValida.getTime())
            ? 'Sin fecha' : fechaValida.toLocaleString('es-CO', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
    };

    function mostrarMensaje(elemento, texto, error = false) {
        elemento.textContent = texto;
        elemento.className = error ? 'mensaje error' : 'mensaje';
    }

    function bloquear(bloqueo) {
        trabajando = bloqueo;
        btnCrear.disabled = bloqueo || reinicioPendiente;
        btnActualizar.disabled = bloqueo || reinicioPendiente;
        btnRestaurar.disabled = bloqueo || reinicioPendiente;
        $('btn-abrir-carpeta-respaldos').disabled = bloqueo || reinicioPendiente;
        $('respaldo-a-restaurar').disabled = bloqueo || reinicioPendiente;
        $('confirmacion-restaurar').disabled = bloqueo || reinicioPendiente;
        tabla.querySelectorAll('button').forEach(btn => {
            btn.disabled = bloqueo || reinicioPendiente;
        });
    }

    function celda(valor) {
        const td = document.createElement('td');
        td.textContent = String(valor ?? '');
        return td;
    }

    function actualizarSelector() {
        const anterior = selector.value;
        selector.replaceChildren();
        const inicial = document.createElement('option');
        inicial.value = '';
        inicial.textContent = 'Selecciona una copia';
        selector.appendChild(inicial);
        copias.forEach(copia => {
            const opcion = document.createElement('option');
            opcion.value = copia.nombre;
            opcion.textContent = `${formatearFecha(copia.creado_en)} · ${copia.tipo} · ${copia.nombre}`;
            selector.appendChild(opcion);
        });
        if (copias.some(copia => copia.nombre === anterior)) selector.value = anterior;
    }

    function pintarCopias() {
        tabla.replaceChildren();
        copias.forEach(copia => {
            const tr = document.createElement('tr');
            tr.appendChild(celda(formatearFecha(copia.creado_en)));
            tr.appendChild(celda(copia.tipo === 'manual' ? 'Manual' : 'Automática'));
            tr.appendChild(celda((copia.tamano_bytes / 1024).toFixed(1) + ' KB'));
            tr.appendChild(celda(copia.nombre));
            const acciones = document.createElement('td');
            const verificar = document.createElement('button');
            verificar.type = 'button';
            verificar.className = 'boton-secundario boton-tabla-respaldo';
            verificar.textContent = 'Verificar';
            verificar.addEventListener('click', async () => {
                if (trabajando || reinicioPendiente) return;
                bloquear(true);
                mostrarMensaje(estadoLista, 'Comprobando integridad SHA-256...');
                try {
                    const resultado = await window.panaderiaAPI.verificarRespaldo(copia.nombre);
                    mostrarMensaje(estadoLista, resultado.mensaje, !resultado.ok);
                } catch (error) {
                    console.error(error);
                    mostrarMensaje(estadoLista, 'No fue posible verificar la copia.', true);
                } finally {
                    bloquear(false);
                }
            });
            const elegir = document.createElement('button');
            elegir.type = 'button';
            elegir.className = 'boton-secundario boton-tabla-respaldo';
            elegir.textContent = 'Restaurar...';
            elegir.addEventListener('click', () => {
                if (trabajando || reinicioPendiente) return;
                window.panaderiaUI.abrirFuncion('respaldos', 'restaurar');
                selector.value = copia.nombre;
                $('confirmacion-restaurar').value = '';
                mostrarMensaje(estadoRestaurar,
                    'Confirma el respaldo que seleccionaste y escribe RESTAURAR.');
            });
            acciones.append(verificar, elegir);
            tr.appendChild(acciones);
            tabla.appendChild(tr);
        });
        if (!copias.length) {
            const tr = document.createElement('tr');
            const td = celda('Todavía no hay respaldos disponibles.');
            td.colSpan = 5;
            tr.appendChild(td);
            tabla.appendChild(tr);
        }
        actualizarSelector();
    }

    async function cargar() {
        if (trabajando || reinicioPendiente) return;
        bloquear(true);
        mostrarMensaje(estadoLista, 'Consultando copias...');
        try {
            const r = await window.panaderiaAPI.listarRespaldos();
            if (!r.ok) {
                mostrarMensaje(estadoLista, r.mensaje, true);
                return;
            }
            copias = r.respaldos;
            pintarCopias();
            $('ruta-respaldos').textContent = r.ubicacion;
            const ultima = copias[0];
            $('ultimo-respaldo').textContent = ultima
                ? `Última copia: ${formatearFecha(ultima.creado_en)} (${ultima.tipo}).`
                : 'No existe ninguna copia registrada.';
            $('contador-respaldos').textContent =
                `${copias.length} de un máximo de 3 copias normales.`;
            $('mensaje-automatico').textContent = r.error_automatico
                ? `Último error de respaldo automático: ${r.error_automatico}`
                : 'El sistema revisa las copias al iniciar y mientras está abierto. ' +
                    'Si han transcurrido 24 horas desde la última, crea una automática.';
            mostrarMensaje(estadoLista, 'Copias cargadas correctamente.');
        } catch (error) {
            console.error(error);
            mostrarMensaje(estadoLista, 'No se pudieron consultar las copias.', true);
        } finally {
            bloquear(false);
        }
    }

    btnActualizar.addEventListener('click', cargar);

    btnCrear.addEventListener('click', async () => {
        if (trabajando || reinicioPendiente) return;
        bloquear(true);
        mostrarMensaje(estadoLista, 'Generando respaldo completo. No cierres Electron...');
        try {
            const r = await window.panaderiaAPI.crearRespaldoManual();
            if (!r.ok) {
                mostrarMensaje(estadoLista, r.mensaje, true);
                return;
            }
            mostrarMensaje(estadoLista, r.mensaje);
        } catch (error) {
            console.error(error);
            mostrarMensaje(estadoLista, 'No pudo completarse el respaldo.', true);
        } finally {
            bloquear(false);
        }
        await cargar();
    });

    $('btn-abrir-carpeta-respaldos').addEventListener('click', async () => {
        try {
            const r = await window.panaderiaAPI.abrirCarpetaRespaldos();
            if (!r.ok) mostrarMensaje(estadoLista, r.mensaje, true);
        } catch (error) {
            console.error(error);
            mostrarMensaje(estadoLista, 'No se pudo abrir la carpeta.', true);
        }
    });

    $('form-restaurar-respaldo').addEventListener('submit', async evento => {
        evento.preventDefault();
        if (trabajando || reinicioPendiente) return;
        const nombre = selector.value;
        const confirmacion = $('confirmacion-restaurar').value.trim();
        if (!copias.some(c => c.nombre === nombre)) {
            mostrarMensaje(estadoRestaurar, 'Selecciona una copia existente.', true);
            return;
        }
        if (confirmacion !== 'RESTAURAR') {
            mostrarMensaje(estadoRestaurar, 'Escribe exactamente RESTAURAR.', true);
            return;
        }
        bloquear(true);
        mostrarMensaje(estadoRestaurar,
            'Verificando copia y preparando restauración. No cierres Electron...');
        try {
            const r = await window.panaderiaAPI.restaurarRespaldo({ nombre, confirmacion });
            mostrarMensaje(estadoRestaurar, r.mensaje, !r.ok);
            if (r.requiere_reinicio) {
                reinicioPendiente = true;
                btnReiniciar.hidden = false;
                $('aviso-reinicio-respaldos').hidden = false;
                btnRestaurar.disabled = true;
            }
        } catch (error) {
            console.error(error);
            mostrarMensaje(estadoRestaurar,
                'No se pudo completar la solicitud. Revisa el estado de MySQL.', true);
        } finally {
            bloquear(false);
        }
    });

    btnReiniciar.addEventListener('click', async () => {
        try {
            await window.panaderiaAPI.cerrarTrasRestauracion();
        } catch (error) {
            console.error(error);
        }
    });

    window.addEventListener('panaderia:vista', evento => {
        if (evento.detail?.modulo === 'respaldos' && !reinicioPendiente) {
            cargar();
        }
    });

    window.addEventListener('panaderia:cerrar-vistas', () => {
        if (reinicioPendiente) return;
        copias = [];
        tabla.replaceChildren();
        actualizarSelector();
        $('ruta-respaldos').textContent = '';
        $('ultimo-respaldo').textContent = '';
        $('mensaje-automatico').textContent = '';
        $('confirmacion-restaurar').value = '';
        estadoLista.textContent = '';
        estadoRestaurar.textContent = '';
    });
})();
