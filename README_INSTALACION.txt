v0.3.9 - Corrección de rentabilidades sin histórico y gráfico oficial Tradegate

No requiere cambios en Supabase ni redeploy de resolve-fund.
Subir todo el contenido del parche a GitHub Pages y forzar recarga.

Cambios:
- Evita mostrar +0,00 % cuando sólo existe una cotización y no hay histórico suficiente.
- En esos casos muestra —, no un dato falso.
- Para posiciones Tradegate muestra los gráficos oficiales publicados por Tradegate (1M, 1A y 5A).
- Mantiene la valoración actual por la cotización exacta de Tradegate.
