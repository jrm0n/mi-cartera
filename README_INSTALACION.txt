MI CARTERA v0.2.0 CLOUD (BETA)

REQUISITOS
1. El proyecto Supabase debe tener aplicada la migración 001_schema_inicial.
2. Antes de usar esta versión debe ejecutarse backend/002_cloud_helpers.sql en SQL Editor.
3. config.js contiene únicamente Project URL + Publishable Key. Ambos son valores de cliente; NO contiene service_role, sb_secret ni contraseña de base de datos.

INSTALACIÓN PWA
- La carpeta debe publicarse en un dominio HTTPS. Abrir index.html como file:// permite revisar el archivo, pero no ofrece una instalación PWA completa.
- Chrome/Edge/Android: usar “Instalar aplicación” cuando aparezca o desde el menú del navegador.
- iPhone/iPad: Safari > Compartir > Añadir a pantalla de inicio.
- PC: Chrome/Edge > Instalar aplicación.

SINCRONIZACIÓN
- Supabase es la fuente de verdad.
- Al iniciar sesión, la app descarga cuentas, operaciones, traspasos, fondos e histórico NAV.
- Las operaciones nuevas se guardan primero en Supabase y después se vuelve a sincronizar la vista.
- Móvil y PC verán los mismos datos si inician sesión con el mismo usuario.
- La app conserva una copia local de lectura por dispositivo para mostrar la última cartera si Supabase no responde temporalmente.

VALORES LIQUIDATIVOS
- v0.2.0 NO obtiene todavía el VL de una fuente externa.
- Si fund_navs contiene datos, la app usa esos VL reales.
- Si no existe NAV online, la app muestra una valoración provisional basada en el NAV implícito de la operación inicial (importe/participaciones) y lo identifica como provisional.
- La tarea automática cada 24 horas se añadirá cuando se conecte una fuente de datos fiable para fondos.

VERSIONADO Y DATOS
- App: 0.2.0
- Esquema: 1
- Actualizar los archivos de la PWA no borra las tablas de Supabase.
- Las futuras modificaciones de esquema se harán mediante migraciones numeradas.
