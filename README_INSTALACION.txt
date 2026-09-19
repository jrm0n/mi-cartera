v0.3.5 - Corrección visual del logotipo de Trade Republic
1) Ejecutar backend/007_operation_management_v0.3.4.sql en Supabase SQL Editor.
2) Sustituir el código de la Edge Function resolve-fund por supabase/functions/resolve-fund/index.ts y desplegar.
3) Subir a GitHub Pages los archivos de la v0.3.4.
4) Las operaciones existentes se pueden editar, actualizar desde fuentes o eliminar.

MI CARTERA v0.3.0 DATA (BETA)

ORDEN DE INSTALACION
1. El secreto EODHD_API_TOKEN debe existir en Supabase Edge Function Secrets.
2. Ejecutar backend/005_data_sources_v0.3.0.sql en Supabase SQL Editor.
3. Crear/desplegar la Edge Function resolve-fund con supabase/functions/resolve-fund/index.ts.
   IMPORTANTE: desactivar la comprobacion legacy de JWT de gateway para resolve-fund.
   La funcion valida por si misma el token de usuario contra Supabase Auth.
4. Probar resolve-fund con un usuario autenticado y el ISIN LU2466448532.
5. Solo despues, subir a GitHub Pages los archivos de raiz, app.js, config.js,
   manifest.webmanifest, sw.js, version.json e icons/.

FUENTES
- EODHD: identificacion por ISIN, divisa, ultimo VL e historico EOD.
- VDOS/Quefondos: categoria, gestora y referencia cuando el dato aparece expresamente
  en la ficha publica. Si no aparece o la pagina no responde, queda Sin datos.

NO SE HACE
- No hay regex para deducir tematicas a partir del nombre.
- No se inventa una categoria cuando la fuente no la proporciona.
- No se guarda la API key EODHD en GitHub ni en el navegador.

LIMITACION DEL PLAN EODHD FREE
- La resolucion inicial de un ISIN desconocido consume una llamada Search.
- La primera descarga de historico consume una llamada EOD adicional.
- Una vez almacenado provider_symbol, las actualizaciones posteriores no necesitan repetir Search.

v0.3.2 - Validacion de operaciones
1) Ejecutar backend/006_operation_validation_v0.3.2.sql en Supabase SQL Editor.
2) No es necesario redeplegar resolve-fund para esta version.
3) Subir a GitHub Pages los archivos de la v0.3.2 y esperar al despliegue.
4) Umbral de validacion: diferencia absoluta de VL < 0,1 % = aceptada; >= 0,1 % = pendiente.
5) En traspasos se validan por separado fecha/VL de salida y fecha/VL de entrada.
