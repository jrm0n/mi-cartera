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
