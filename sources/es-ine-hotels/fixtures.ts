// Real INE Tempus responses captured 2026-10-18 through the GitHub probe (nult=1, latest month only, trimmed to a few series).
// Shapes are exactly as served: a JSON array of series, each with a Data array. Fecha is epoch ms (1785535200000 = 2026-07-31 22:00 UTC, i.e. 1 Aug 2026 Madrid).
const row = (valor: number) => `"Data":[{"Fecha":1785535200000, "FK_TipoDato":2, "FK_Periodo":8, "Anyo":2026, "Valor":${valor}, "Secreto":false}\n]\n}`;

// DATOS_TABLA/2059 (ADR by autonomous communities and provinces)
export const TABLE_2059 = `[{"COD":"EOT16414", "Nombre":"ADR. National. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(166.9)}
,{"COD":"EOT16415", "Nombre":"ADR. National. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(7.32)}
,{"COD":"EOT16416", "Nombre":"ADR. Andalucía. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(177.92)}
,{"COD":"EOT16417", "Nombre":"ADR. Andalucía. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(7.1)}
,{"COD":"EOT43302", "Nombre":"Almería. Average Daily Rate (ADR). All categories. Data. ", "FK_Unidad":7, "FK_Escala":1, ${row(169.99)}
,{"COD":"EOT43250", "Nombre":"Almería. Average Daily Rate (ADR). All categories. Annual variation rate. ", "FK_Unidad":135, "FK_Escala":1, ${row(4.27)}
,{"COD":"EOT43301", "Nombre":"Cádiz. Average Daily Rate (ADR). All categories. Data. ", "FK_Unidad":7, "FK_Escala":1, ${row(199.82)}
,{"COD":"EOT43249", "Nombre":"Cádiz. Average Daily Rate (ADR). All categories. Annual variation rate. ", "FK_Unidad":135, "FK_Escala":1, ${row(6.43)}
,{"COD":"EOT43300", "Nombre":"Córdoba. Average Daily Rate (ADR). All categories. Data. ", "FK_Unidad":7, "FK_Escala":1, ${row(64.55)}
,{"COD":"EOT43248", "Nombre":"Córdoba. Average Daily Rate (ADR). All categories. Annual variation rate. ", "FK_Unidad":135, "FK_Escala":1, ${row(-1.33)}
]`;

// DATOS_TABLA/46298 (ADR by tourist site / city)
export const TABLE_46298 = `[{"COD":"EOT43602", "Nombre":"Vitoria-Gasteiz. Average Daily Rate (ADR). All categories. Data. ", "FK_Unidad":7, "FK_Escala":1, ${row(114.73)}
,{"COD":"EOT43496", "Nombre":"Vitoria-Gasteiz. Average Daily Rate (ADR). All categories. Annual variation rate. ", "FK_Unidad":135, "FK_Escala":1, ${row(27.43)}
,{"COD":"EOT43600", "Nombre":"Alacant/Alicante. Average Daily Rate (ADR). All categories. Data. ", "FK_Unidad":7, "FK_Escala":1, ${row(155.71)}
,{"COD":"EOT43494", "Nombre":"Alacant/Alicante. Average Daily Rate (ADR). All categories. Annual variation rate. ", "FK_Unidad":135, "FK_Escala":1, ${row(3.26)}
,{"COD":"EOT43599", "Nombre":"Benidorm. Average Daily Rate (ADR). All categories. Data. ", "FK_Unidad":7, "FK_Escala":1, ${row(175.18)}
,{"COD":"EOT43493", "Nombre":"Benidorm. Average Daily Rate (ADR). All categories. Annual variation rate. ", "FK_Unidad":135, "FK_Escala":1, ${row(6.02)}
]`;

// DATOS_TABLA/2058 (ADR national, by hotel category)
export const TABLE_2058 = `[{"COD":"EOT16414", "Nombre":"ADR. National. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(166.9)}
,{"COD":"EOT16415", "Nombre":"ADR. National. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(7.32)}
,{"COD":"EOT16456", "Nombre":"National. ADR. Five gold stars. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(357.83)}
,{"COD":"EOT16457", "Nombre":"National. ADR. Five gold stars. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(5.98)}
,{"COD":"EOT16458", "Nombre":"National. ADR. Four gold stars. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(176.7)}
,{"COD":"EOT16459", "Nombre":"National. ADR. Four gold stars. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(7.83)}
,{"COD":"EOT16460", "Nombre":"National. ADR. Three gold stars. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(144.97)}
,{"COD":"EOT16461", "Nombre":"National. ADR. Three gold stars. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(7.14)}
,{"COD":"EOT16462", "Nombre":"National. ADR. Two gold stars. Datum.", "FK_Unidad":7, "FK_Escala":1, ${row(107.02)}
,{"COD":"EOT16463", "Nombre":"National. ADR. Two gold stars. Interannual variation rate.", "FK_Unidad":135, "FK_Escala":1, ${row(4.92)}
]`;
