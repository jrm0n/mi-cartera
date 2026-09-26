v0.9.1 - Indicadores de rentabilidad simplificados

No requiere SQL nuevo.

Orden de instalación:
1. Publica app.js, index.html, config.js, sw.js y version.json en la raíz del repositorio de GitHub.
2. Abre la app y fuerza una recarga para que el móvil instale la versión 0.9.1.
3. Pulsa "Actualizar cartera" una sola vez: se actualizarán los instrumentos de todos los perfiles.

No es necesario ejecutar ninguna migración ni modificar la Edge Function para instalar esta versión.

Cambios principales:
- La cabecera de Análisis muestra únicamente Resultado en euros, TWR acumulada y XIRR anualizada.
- Se elimina la rentabilidad simple de las tarjetas, del detalle y de las opciones del gráfico para evitar duplicidad visual.
- La rentabilidad simple permanece disponible dentro de "Ver cálculo y operaciones incluidas" como dato auxiliar auditable.
- El gráfico conserva Valor € y TWR acumulada para todos los periodos.
- TWR se identifica expresamente como acumulada para el periodo seleccionado.
- XIRR se identifica expresamente como anualizada e incluye el aviso de que no es una previsión.
- Inicio, Posiciones, detalle y Análisis continúan usando el mismo motor financiero.

No sustituyas ni ejecutes archivos SQL: el esquema de datos sigue siendo el 10.

---

v0.8.0 - Primera versión del gráfico agregado

Se sustituye por v0.8.1 porque podía reducir la curva a los puntos inicial y final cuando una sola posición carecía de histórico completo.

---

v0.7.2 - Fuentes generales y rentabilidad YTD completa

No requiere SQL nuevo.

La instalación de v0.7.2 requería publicar la Edge Function resolve-fund incluida en su parche.

El resolutor consulta el VL más reciente por ISIN en VDOS/Quefondos para fondos tradicionales de cualquier gestora compatible, además de EODHD y de las fuentes oficiales específicas disponibles. Compara fechas y conserva siempre el dato más reciente; a igualdad de fecha, la fuente oficial tiene prioridad.

La app descarga el histórico de Supabase por páginas de 1.000 registros. Esto evita que el límite de filas del API recorte el principio del año y convierta una evolución parcial desde junio en una supuesta rentabilidad YTD. Si aun así falta el inicio del periodo, muestra N/D en vez de un porcentaje parcial engañoso.

La migración 015_recurring_operations_v0.7.0.sql sólo es necesaria si aún no instalaste la versión 0.7.0.

---

v0.7.1 - Actualización robusta de precios y VL

No requiere SQL nuevo. Añadió la fuente oficial de La Financière de l'Echiquier y el aviso de cotizaciones atrasadas.

---

v0.7.0 - Base 2026 editable y aportaciones recurrentes

Esta versión requiere haber aplicado 014_portfolios_v0.6.0.sql y ejecutar después 015_recurring_operations_v0.7.0.sql en Supabase > SQL Editor.

Orden obligatorio:
1. Si todavía no está aplicada, ejecutar 014_portfolios_v0.6.0.sql.
2. Ejecutar 015_recurring_operations_v0.7.0.sql y comprobar que finaliza sin errores.
3. Publicar el resto de archivos del parche en la raíz del repositorio de GitHub.
4. Abrir la app y forzar una recarga para instalar la versión 0.7.0.

Al editar una Base 2026 sólo se solicitan la base y las participaciones actuales. Las aportaciones recurrentes se guardan como una única regla y sus vencimientos se incorporan internamente al cálculo usando VL/precios exactos. Por ahora deben estar denominadas en EUR.

v0.5.2 - Reparación del alta automática por ISIN

No requiere SQL nuevo. Publica los archivos del parche en la raíz del repositorio de GitHub.

La app crea automáticamente el registro base del fondo cuando Supabase devuelve la violación de clave foránea 23503 y repite la consulta. También incorpora un respaldo verificado para IE0006TUI4G7, que el proveedor principal no identifica.

v0.5.1 - Alta simplificada de Base 2026

No requiere SQL nuevo ni cambios en Supabase. Publica los archivos del parche en la raiz del repositorio de GitHub.

En "Base 2026" sólo se introducen la entidad, el ISIN, la base a 01/01/2026 y las participaciones actuales. La app obtiene automáticamente el último VL/precio y su fecha. Si la cotización no está en euros, convierte el valor actual a EUR antes de calcular la rentabilidad anual.

v0.5.0 - Posiciones con base de referencia 2026

No requiere SQL nuevo. La opción "Base 2026" guarda el valor de referencia a 01/01/2026 en la propia operación y permite calcular la rentabilidad anual aunque se desconozca el histórico anterior.

La rentabilidad total histórica queda como N/D para estas posiciones, porque la base anual no sustituye al coste histórico/fiscal desconocido.

v0.4.9 - Rentabilidad anual de la posición

No requiere SQL nuevo. Actualizar resolve-fund en Supabase y después publicar el parche en GitHub.

v0.4.4 - Cierre Tradegate robusto

Cambios:
- Descubre automaticamente la pagina MarketScreener del mismo ISIN/listing Tradegate cuando no existe una URL cacheada.
- Verifica ISIN + mercado Tradegate antes de aceptar el precio.
- Usa el cierre publicado por MarketScreener cuando puede validarse; Tradegate Last queda solo como respaldo.
- Guarda la URL de la fuente de valoracion en Supabase para refrescos posteriores.
- Mantiene el historico proxy de Xetra y la separacion entre rentabilidad del activo y de la posicion.

Migracion nueva:
- 013_quote_source_cache_v0.4.4.sql

v0.4.3 - Arranque actualizado y cierre de mercado

Cambios:
- Valida importe, participaciones y precio/VL con tolerancia del 0,1 %.
- Las operaciones incoherentes quedan pendientes y dejan de generar rentabilidades falsas.
- Permite recalcular importe o precio desde el editor de operaciones.
- Permite marcar datos de ejecución confirmados por el banco.
- El detalle muestra la fecha y fuente exacta del precio utilizado.
- No sustituye silenciosamente el precio del mercado seleccionado por el de otra fuente.

Migración nueva:
- 012_operation_integrity_v0.4.1.sql

v0.4.0 - Histórico proxy y gráfico nativo

- Elimina los gráficos-imagen de Tradegate.
- Reconstruye, cuando falta histórico exacto del mercado seleccionado, una serie aproximada usando otro mercado del mismo ISIN.
- Prioriza proxy en la misma divisa (Xetra cuando está disponible) y calibra por proporcionalidad con una fecha común.
- Si el proxy usa otra divisa, admite ajuste FX con histórico EODHD.
- Las series aproximadas se marcan con ≈ y nunca se usan para validar operaciones con el umbral del 0,1 %.
- Separa rentabilidad del activo de resultado total de la posición.
- Resumen, Posiciones y detalle usan la misma lógica de rentabilidad.
- El botón Actualizar cartera refresca cotizaciones y va acumulando snapshots diarios en Supabase.
- Al abrir la app se intenta una actualización diaria automática, con límite conservador de instrumentos para el plan gratuito.

Actualización diaria servidor:
- Edge Function refresh-market-data con bloqueo de 18 h para proteger la cuota.
- 011_daily_refresh_v0.4.0.sql programa la llamada diaria a las 06:30 UTC.
