const { contextBridge, ipcRenderer } = require('electron');

// #&#&# Solo exponer operaciones específicas, no un IPC genérico.
contextBridge.exposeInMainWorld('panaderiaAPI', {
    iniciarSesion: datos => ipcRenderer.invoke('auth:iniciar', datos),
    obtenerSesion: () => ipcRenderer.invoke('auth:sesion'),
    cerrarSesion: () => ipcRenderer.invoke('auth:cerrar'),
    listarProductos: () => ipcRenderer.invoke('productos:listar'),
    registrarProducto: datos => ipcRenderer.invoke('productos:registrar', datos),
    obtenerDetalleProducto: codigo => ipcRenderer.invoke('productos:obtener-detalle', codigo),
    modificarProducto: datos => ipcRenderer.invoke('productos:modificar', datos),
    listarLotes: () => ipcRenderer.invoke('inventario:listar-lotes'),
    registrarEntrada: datos => ipcRenderer.invoke('inventario:registrar-entrada', datos),
    listarUsuarios: () => ipcRenderer.invoke('usuarios:listar'),
    registrarUsuario: datos => ipcRenderer.invoke('usuarios:registrar', datos),
    cambiarEstadoUsuario: datos => ipcRenderer.invoke('usuarios:cambiar-estado', datos),
    restablecerClaveUsuario: datos => ipcRenderer.invoke('usuarios:restablecer-clave', datos),
    // #&#&# Ventas: cada función se expone individualmente.
    listarCatalogoVentas: () => ipcRenderer.invoke('ventas:listar-catalogo'),
    registrarVenta: datos => ipcRenderer.invoke('ventas:registrar', datos),
    listarHistorialVentas: filtros => ipcRenderer.invoke('ventas:listar-historial', filtros),
    obtenerDetalleVenta: id => ipcRenderer.invoke('ventas:obtener-detalle', id),
    consultarAlertas: () => ipcRenderer.invoke('alertas:consultar'),
    // #&#&# Retiros manuales por vencimiento e historial de pérdidas.
    listarLotesVencidos: () => ipcRenderer.invoke('perdidas:listar-lotes-vencidos'),
    registrarPerdida: datos => ipcRenderer.invoke('perdidas:registrar', datos),
    listarPerdidas: filtros => ipcRenderer.invoke('perdidas:listar', filtros),
    // #&#&# Reportes administrativos; el backend exige rol administrador.
    consultarReportes: filtros => ipcRenderer.invoke('reportes:consultar', filtros),
    // #&#&# Respaldos: acciones específicas, sin acceso a rutas o SQL arbitrarios.
    listarRespaldos: () => ipcRenderer.invoke('respaldos:listar'),
    crearRespaldoManual: () => ipcRenderer.invoke('respaldos:crear'),
    verificarRespaldo: nombre => ipcRenderer.invoke('respaldos:verificar', nombre),
    abrirCarpetaRespaldos: () => ipcRenderer.invoke('respaldos:abrir-carpeta'),
    restaurarRespaldo: datos => ipcRenderer.invoke('respaldos:restaurar', datos),
    cerrarTrasRestauracion: () => ipcRenderer.invoke('respaldos:cerrar-aplicacion')
});
