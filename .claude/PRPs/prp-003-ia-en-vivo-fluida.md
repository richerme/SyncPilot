# PRP-003: IA en Vivo fluida — transcripción palabra por palabra, traducción a la par y Copiloto con todo el contexto

> **Estado**: APROBADO (2026-10-15) — en implementación
> **Pedido del usuario**: la transcripción se pausa y luego muestra de golpe lo último; la traducción se retrasa porque espera a la transcripción. Quiere que las palabras aparezcan fluidas conforme avanza el audio y que la traducción vaya a la par. Los Documentos deben estar en el contexto de cada reunión (de qué trata y para encontrar respuestas), y el Copiloto (al oír "Rick" o con el botón) debe tener todos los Documentos y todo lo que se ha hablado en la reunión.

## Diagnóstico (15 oct)

| Síntoma | Causa en el código |
|---|---|
| Pausa y luego texto "de golpe" | El audio se manda en tramos (`SpeechSegmenter`): se corta en una pausa de 0.3 s o a los **5 s**. El umbral de voz es fijo (RMS 0.008); con ruido de fondo de la llamada casi nunca "oye" la pausa, así que cada tramo llega con ~5 s de habla de una vez, más ~1.3 s de Gemini (medido hoy: p50 1.25 s, p90 1.6 s, máx. 1.8 s en 20 llamadas). |
| Huecos que se acumulan | `OrderedDelivery` entrega en orden estricto: si un tramo tarda (o falla y cae a Whisper, que va después de Gemini y no en paralelo), todos los siguientes esperan y salen juntos. No hay tiempo límite por petición. |
| Traducción atrasada | `useLiveTranslation` traduce el texto ya transcrito (250 ms de espera + ~0.6 s) y re-traduce el turno completo con cada tramo: hereda todo el retraso de la transcripción. |
| Documentos | Son globales (activos/inactivos); se cortan a **50,000 caracteres** por documento y los PDF a lo que quepa en 8,192 tokens de salida (~30k caracteres). El Copiloto solo recibe hasta 12,000 caracteres elegidos por palabras en común. No hay "de qué trata la reunión". |
| Copiloto | Recibe los últimos 60 fragmentos recortados a **6,000 caracteres** (~5 min de reunión). Lo anterior se pierde aunque esté guardado en la base de datos. |

**Conclusión**: con tramos no puede haber palabras fluidas (el mínimo es "duración del tramo + respuesta"). Hace falta reconocimiento de voz **en streaming**.

## Mediciones que respaldan la propuesta (15 oct)

- **Copiloto con todo el contexto**: documentos de 198k caracteres + reunión de 30k (77,655 tokens) con gemini-3.5-flash: primera palabra **1.25-1.8 s sin caché** y **0.9-1.3 s con caché explícito** (creado en 0.6 s). Respuesta correcta a un dato del requisito 377 de 500 (tabla y BAPI exactas).
- **Transcripción por tramos actual**: p50 1.25 s, p90 1.6 s por tramo de 3.5 s (sin contar la espera del tramo).

## Opciones de transcripción en streaming

| Opción | Palabras en vivo | Traducción | Contra |
|---|---|---|---|
| **Soniox** (`stt-rt-v5`, recomendado) | Sí: tokens finales y no finales que se reemplazan | **En el mismo stream**, empieza antes de que termine la frase | Cuenta nueva y `SONIOX_API_KEY`. $0.12 USD por hora, traducción incluida. El audio de las reuniones pasa por un tercero más. |
| Gemini Live API (`gemini-3.8-live`) | Transcripción de entrada | Habría que pedírsela al modelo como respuesta | Es un agente de voz que contesta. Sesiones de 15 min sin gestión de sesión. 32k de contexto. La transcripción no es su función principal. |
| Deepgram / AssemblyAI | Sí | Aparte (otra llamada) | La traducción vuelve a esperar al texto. |

Soniox además acepta **contexto** (hasta 8,000 tokens: términos y texto) y separa a los hablantes. Aguanta 300 min por stream, y el navegador se conecta con una **llave temporal** creada en el servidor, así que la llave real nunca llega al navegador.

## Comportamiento esperado

1. Las palabras de la reunión aparecen conforme se dicen (≤ 1 s detrás del audio). Las que aún pueden cambiar se ven en gris claro y se fijan en segundos.
2. Con Live Translator encendido, la traducción aparece a la par en la columna derecha, del audio y no del texto ya cerrado.
3. Al iniciar la reunión, IA en Vivo muestra **"Contexto de la reunión"**: los documentos activos cargados completos y un resumen de qué trata la reunión (tema, objetos SAP, pendientes, preguntas probables).
4. Al oír "Rick" (o con **Responder**), el Copiloto contesta con todos los documentos y toda la reunión hasta ese momento; la primera palabra llega en ≤ 2 s.
5. Si Soniox falla o no hay llave, IA en Vivo sigue funcionando con la transcripción por tramos ya sin atascos (fase 1) y lo avisa.

## Fases

### Fase 1: transcripción actual sin atascos (respaldo; no requiere cuenta nueva)
- Mostrar cada tramo en cuanto llega, en su lugar. Un tramo que tarda se ve como "…" y ya no detiene a los demás. Tiempo límite de 4 s por tramo.
- Umbral de voz que se ajusta al ruido de fondo, para encontrar las pausas en llamadas con ruido. Corte forzado a los 3 s en vez de 5.
- Traducir cada tramo en cuanto llega, en paralelo, y re-traducir el turno al cerrarlo para que la frase quede coherente.
- **Validación**: `scripts/test-live-logic.ts` con un tramo lento simulado: los siguientes salen sin esperar.

### Fase 2: transcripción y traducción en streaming (Soniox)
- `POST /api/live/stt-token`: llave temporal (60 s, `transcribe_websocket`, `client_reference_id` = reunión) más el contexto de la reunión (términos y resumen de la fase 3).
- Navegador: el mismo AudioWorklet (100 ms, 16 kHz) manda PCM s16le directo al WebSocket. La configuración incluye:
  - `language_hints` ["en","es"]
  - detección de fin de frase
  - separación de hablantes
  - `translation: one_way` al idioma de Live Translator
  - `context.terms` (vocabulario SAP y términos de los documentos)
- Al cerrar cada frase se guarda el fragmento con su hablante (tabla `Transcript`, como hoy). Si la conexión se cae, se reconecta con otra llave; a la segunda falla pasa a la fase 1.
- La voz de Rick (micrófono) sigue con el reconocimiento del navegador: es inmediato y gratis.
- **Validación**: reunión de prueba sintética de 3-5 min en español e inglés con términos SAP. Retraso palabra-pantalla ≤ 1 s y traducción ≤ 1.5 s; "BAdI", "IDoc" y los Z-objetos de los documentos bien escritos.

### Fase 3: Documentos en el contexto de cada reunión
- Leer los documentos completos:
  - Subir los topes de 50k caracteres.
  - Los PDF largos se extraen por partes.
  - Un script vuelve a extraer los documentos ya subidos que quedaron cortados.
- Al iniciar la reunión se arma su contexto con los documentos activos completos:
  - Caché explícito de Gemini por 3 h, renovable; si son menos de ~1,000 tokens, van directo en el prompt.
  - Un resumen de qué trata la reunión.
  - La lista de términos para Soniox.
  - Campos nuevos en `Meeting`: `contextCacheName`, `contextExpiresAt`, `contextBrief`, `contextDocs` (migración Prisma).
- IA en Vivo muestra el panel "Contexto de la reunión" con los documentos cargados y el resumen.
- **Validación**: con un documento de >50k caracteres, el Copiloto contesta un dato del final del documento.

### Fase 4: Copiloto con toda la reunión y todos los documentos
- El servidor lee **toda** la transcripción de la reunión desde la base de datos y le suma lo que aún no se guardó.
- Prompt: caché de documentos + resumen + reunión completa + pregunta.
- Con Soniox, "Rick" se dispara al detectar el fin de la pregunta (≈0.5 s) en vez de esperar 1.2 s de silencio; se mantiene el tope de 8 s.
- **Validación**: pregunta sobre algo dicho en el minuto 2 de una reunión de 30 min y sobre un dato de los documentos. Primera palabra ≤ 2 s.

### Fase 5: validación y despliegue
- Pruebas automáticas, Playwright en producción (IA en Vivo, panel de contexto, Documentos), despliegue sin build en el VPS.
- Prueba del usuario en una reunión real.

## Lo que necesita el usuario

1. Crear la cuenta en soniox.com y una llave de API.
2. Ponerla como `SONIOX_API_KEY` en Coolify (app syncpilot-v2) y en el `.env.local` de SyncPilot (para las pruebas locales).
3. En la cuenta de Soniox, revisar la retención de datos y desactivar que guarden el audio, si la opción existe. Son reuniones con clientes.

## Costos

- Soniox: $0.12 USD por hora de reunión (transcripción + traducción).
- Gemini: el Copiloto lee hasta ~80k tokens por respuesta cuando hay muchos documentos; con caché los documentos se cobran a tarifa reducida. Se mide el costo real en la fase 4.
- La transcripción por tramos con Gemini queda solo como respaldo.

## Fuera de alcance
- Transcribir el micrófono de Rick con Soniox (hoy lo hace el navegador sin costo).
- Documentos por reunión (hoy se eligen con activo/inactivo en Documentos; se puede agregar después).

## Avance

| Fase | Estado | Qué quedó |
|---|---|---|
| 1 | Hecha (15 oct) | `engines/chunkedEngine.ts` (motor por tramos con vista previa fuera de orden, tope de 5 s por tramo), pausa relativa al ruido en `SpeechSegmenter` (tramos ≤ 3 s), traducción del turno con 120 ms de espera. Pruebas: `npx tsx scripts/test-live-logic.ts <wav>` (22 ✓). |
| 2 | Código listo (commit local 947bb14, sin desplegar) | `engines/streamEngine.ts` (WebSocket con llave temporal en los protocolos `['soniox-api-key', llave]`, audio guardado mientras abre, `StreamTurns` arma el turno y cierra en `<end>`, traducción tardía se agrega al último pedazo, 1 reconexión y luego motor por tramos), `POST /api/live/stt-token`, insignia «⚡ Palabra por palabra». Prueba real: `npx tsx --env-file=.env --env-file=.env.local scripts/test-soniox-stream.ts <wav>`. 15 oct: llave y conexión OK, pero Soniox responde **402 organization_balance_exhausted** (cuenta sin saldo). |
| 3 | Hecha (15 oct) | `lib/documentText.ts` (texto completo, tope 1M; PDF con 65k tokens de salida), `lib/meetingContext.ts` (caché de Gemini por reunión con los documentos completos y las instrucciones, 3 h renovable; resumen y términos; relee documentos cortados con los topes viejos), `POST /api/meetings/:id/context`, panel «Contexto de la reunión». |
| 4 | Hecha (15 oct) | `/answer` lee TODA la reunión de la BD (con `[mm:ss]` y quién habla) + lo no guardado (`live`), caché de documentos (o documentos completos en el prompt; fragmentos solo si pasan de ~600k tokens), resumen. Los fragmentos se guardan con `speaker`. El caché se borra al terminar la reunión. |
| 5 | Pendiente | Despliegue y prueba en reunión real. |

## Aprendizajes (Auto-Blindaje)

### 2026-10-15: Soniox autentica en los protocolos del WebSocket y cobra por adelantado
- La llave temporal se crea con `POST /v1/auth/temporary-api-key` (`usage_type: transcribe_websocket`) y el navegador la manda como `new WebSocket(url, ['soniox-api-key', llave])`; `api_key` dentro del mensaje de inicio está en desuso (se rechaza desde el 15 ene 2027).
- Sin saldo, la conexión abre y el primer mensaje es `402 organization_balance_exhausted`: el motor lo trata como falla y sigue por tramos.

### 2026-10-15: umbral de voz fijo + ruido de la llamada = texto a saltos
- **Error**: con ruido de fondo (RMS 0.02) el segmentador viejo nunca "oía" la pausa: tramos de 4.6 · 4.4 · 4.1 s y **0** fines de turno (el Copiloto por "Rick" solo salía por el tope de 8 s).
- **Fix**: pausa = por debajo de max(0.008, 1.8× piso de ruido de 6 s, 0.2× voz de 3 s). Mismo audio: tramos de 0.8-2.5 s y los 2 fines de turno. "Hay algo que mandar" sigue siendo absoluto para no descartar voz baja.
- **Aplicar en**: cualquier detección de voz sobre audio de llamadas (siempre traen ruido o ruido de confort).

### 2026-10-15: entrega en orden estricto = huecos que salen de golpe
- **Error**: `OrderedDelivery` retenía todo detrás de un tramo lento, sin tiempo límite.
- **Fix**: la vista previa muestra los tramos que ya llegaron aunque uno anterior siga en camino ("…"), y cada tramo tiene 5 s; el historial sigue en orden.

### 2026-10-15: `scripts/migrate.cjs` solo aplica la migración inicial
- **Error (evitado)**: el contenedor arranca con `migrate.cjs`, que solo aplica migraciones si la tabla `User` NO existe. Una migración nueva de Prisma nunca llegaría a producción.
- **Fix**: el contexto de la reunión vive en memoria del servidor (`lib/meetingContext.ts`), sin cambiar el esquema. Si algún día hace falta una columna nueva, primero hay que hacer que `migrate.cjs` registre y aplique migraciones pendientes.

### 2026-10-15: con `cachedContent` no se puede mandar `systemInstruction`
- **Fix**: las instrucciones del Copiloto van DENTRO del caché; la petición solo lleva la reunión y la pregunta. Si el caché caducó o falla, se responde sin caché con los documentos en el prompt.
