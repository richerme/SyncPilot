# PRP-005: «Investigar» sin que te nombren e idiomas que se cambian dentro de IA en Vivo

> **Estado**: APROBADO (2026-11-19) e implementado en la rama `feat/investigar-idiomas-rendimiento` (PR). Falta el merge del usuario y su prueba en una reunión real.
> **Decisiones del usuario (19 nov, en el chat)**:
> 1. La tarjeta, y también el resultado de la búsqueda, en el idioma que se está hablando en la reunión. Ninguna de las opciones a-c: el modelo detecta el idioma de las últimas líneas.
> 2. (a) botón en el pie, junto a «💬 Responder».
> 3. (b) el idioma que se elige en IA en Vivo vale solo para esa reunión.
> 4. (b) selector EN/ES para las respuestas del Copiloto.
>
> Además pidió investigar por qué la reunión «se comienza a trabar» a los pocos minutos de compartir pantalla, y si es por memoria. Eso es la fase 3.
> **Pedido del usuario (19 nov)**:
> 1. Que el botón «Investigar» no dependa de que digan su nombre: un botón propio, junto a los del pie, que tome lo que se está hablando (sobre todo los últimos puntos, que son los que dirigen la reunión) e investigue con base en eso, para ampliar el contexto cuando algo no se entiende.
> 2. Cambiar el idioma de la traducción desde IA en Vivo, sin terminar la reunión, ir a Voice AI y empezar otra. Por ejemplo, en una entrevista que pasa del inglés al español. Toda la reunión y lo que contestó el Copiloto debe seguir en la misma sesión.

## Lo que hay hoy (verificado en el código, 19 nov)

- **«🔎 Investigar» solo vive en las tarjetas de respuesta.**
  - El botón está en `AnswerCard` (`src/app/live/page.tsx:135`). Sin una respuesta del Copiloto, ya sea porque dijeron «Rick», por el botón Responder o por una pregunta escrita, no aparece.
  - La llamada es `researchCopilot(answer)` → `POST /api/meetings/:id/research` con la pregunta, la respuesta y lo que el navegador aún no guarda.
  - En el servidor, `runResearch` (`src/lib/copilotResearch.ts`):
    1. reescribe la pregunta (pregunta + respuesta + los últimos 4,000 caracteres de la reunión) en una pregunta genérica de SAP estándar;
    2. `scrubQuery` quita lo que identifica al cliente;
    3. Gemini con Google Search contesta en inglés, en 2 a 4 frases, con 1-3 fuentes.
  - Medido el 10 nov: p50 4.1 s y ~0.025 USD por clic.
- **«Ver en Reuniones» solo aparece cuando la sesión terminó** (`page.tsx:570`). Durante la reunión, el pie tiene «💬 Responder» y «Finalizar sesión».
- **Traducción:**
  - El idioma y el interruptor viven solo en Voice AI → Live Translator (localStorage `syncpilot_live_translator_enabled/_lang`). IA en Vivo solo los muestra, con la insignia «🌐 Trad. ES» (`page.tsx:277`).
  - El idioma entra al iniciar: `startSession(voiceLang, translator.lang, …)` → `translateToRef`. Soniox lo fija al abrir el stream (`translation.target_language`, `src/features/live/engines/streamEngine.ts:201`), así que un cambio a media reunión no le llega.
  - Tu voz (micrófono) se traduce aparte con `translate-segment` (`useLiveTranslation`). Eso ya acepta un cambio de idioma a media sesión y re-traduce los últimos 8 fragmentos. El respaldo por tramos funciona igual.
- **«Idioma de tu voz»** (English / es-MX) también se elige solo antes de iniciar: el reconocimiento del micrófono arranca con un idioma fijo.
- **El stream de Soniox ya sabe reconectarse sin perder la reunión** (vigilante del 18 nov, `streamEngine.ts:268`). La transcripción, las respuestas, la grabación y la reunión en la BD siguen.

## Propuesta

### Fase 1 — «🔎 Investigar» libre, con lo último que se habló

- **Botón** «🔎 Investigar» en el pie, junto a «💬 Responder», mientras la sesión está activa. Se desactiva mientras corre una investigación.
- **Al pulsarlo** aparece en la columna del Copiloto una tarjeta «Lo que se está hablando», en dos partes:
  1. **De qué se habla ahora** (1-2 s, sin internet):
     - 2 a 4 viñetas con los últimos puntos de la reunión, tomados de los últimos ~3 minutos de transcripción, con más peso al final;
     - los términos técnicos se explican en una línea;
     - usa el contexto de la reunión y los Documentos, que ya están en el caché.
  2. **Verificado en internet** (~4-5 s, como hoy):
     - el tema técnico principal de esos puntos pasa por la misma protección de hoy: reescritura en una pregunta genérica de SAP y `scrubQuery`. A Google solo sale esa pregunta, nunca la reunión.
     - El resultado trae 2 a 4 frases y 1-3 fuentes.
     - Si lo último fue solo del proyecto (estado, fechas, personas), sale únicamente la primera parte, con la nota «No había un tema técnico que buscar».
- **Servidor:**
  - la misma ruta `/research` con `mode: 'context'`, sin pregunta ni respuesta;
  - un prompt de reescritura nuevo: «el tema técnico principal de los ÚLTIMOS minutos»;
  - un paso de resumen con Gemini y el caché de la reunión, con respaldo por OpenRouter;
  - se guarda en el historial de la reunión como hoy (`meetingSuggestion` de tipo `info`).
- **Costo:** ~0.025 USD por clic (la búsqueda); el resumen casi no cuesta.
- **Pruebas:**
  - `scripts/test-copilot-research.ts` con el modo contexto, sin red y con `--real 5`, usando transcripciones inventadas: que el tema salga de los últimos puntos y no del inicio, y que no salga nada del cliente;
  - después, en el navegador con audio de prueba.

### Fase 2 — Idiomas dentro de IA en Vivo, sin cortar la reunión

- **La insignia «🌐 Trad. ES» pasa a ser un selector** con:
  - el idioma de la traducción (los mismos de Voice AI);
  - el interruptor para mostrar u ocultar la columna de traducción.
- **Al cambiar el idioma con la reunión en curso:**
  - **Soniox:** cierra y abre el stream con el idioma nuevo, usando la reconexión del vigilante, y muestra el aviso «Cambiando la traducción a Español…».
    - Es la **misma reunión**: transcripción, respuestas del Copiloto, investigaciones, grabación y documentos siguen; nada empieza de cero.
    - Antes de subirlo mido el hueco del cambio. La meta es menos de 1.5 s sin palabras nuevas.
  - **Tu voz y el respaldo por tramos:** cambian al momento, como ya lo hacen.
  - **Lo traducido antes del cambio:** se queda en el idioma anterior, salvo los últimos 8 fragmentos, que se re-traducen al nuevo para que la lectura siga.
- **«Idioma de tu voz» también se cambia en vivo,** con el mismo tipo de selector. Solo reinicia el reconocimiento de tu micrófono (menos de 1 s). Si la reunión pasa al español y tu micrófono sigue en inglés, tu voz saldría mal transcrita.
- **Diagnóstico:** cada cambio de idioma queda en el diag de la reunión (`GET /api/meetings/<id>/diag`).
- **Pruebas:**
  - `scripts/test-soniox-stream.ts`, cambiando el idioma a media prueba para medir el hueco;
  - en el navegador: cambiar de idioma dos veces en una sesión y revisar que la transcripción, las respuestas y la grabación sigan completas.

## Decisiones del usuario

1. **Idioma de la tarjeta «Lo que se está hablando»:**
   - (a) en el idioma de la traducción si está activa; si no, en inglés. **Recomendado**, porque es para entender lo que no se captó.
   - (b) siempre en inglés, como el Copiloto.
   - (c) siempre en español.
2. **Dónde va el botón:**
   - (a) en el pie, junto a «💬 Responder». **Recomendado**: «Ver en Reuniones» solo aparece cuando la sesión ya terminó.
   - (b) en el encabezado de la columna del Copiloto.
3. **El idioma que se elige en IA en Vivo:**
   - (a) queda como el nuevo predeterminado, y Voice AI muestra el mismo. **Recomendado**: un solo ajuste, sin dos lugares que se contradigan.
   - (b) vale solo para esa reunión; el predeterminado sigue siendo el de Voice AI.
4. **El Copiloto hoy siempre contesta en inglés:**
   - (a) se queda así; es lo que pediste.
   - (b) agregar en la misma barra un selector EN/ES para sus respuestas, útil si toda la reunión es en español. Es algo más de trabajo: el idioma va en cada pregunta, no en el caché.

### Fase 3 — Rendimiento con pantalla compartida (pedido del 19 nov)

**Diagnóstico (código y documentación de Chrome; sin datos de una reunión real todavía):**

- **No parece memoria de la página.** Una hora de reunión son ~10k palabras, menos de 1 MB de texto, y el registro de cada reunión ya anotaba la memoria cada 5 min. La memoria del equipo no la pude leer: la consulta al sistema se bloqueó y no la intenté por otro camino.
- **Causa 1 (la más probable, encaja con «a los pocos minutos»): la pestaña tapada.**
  - Al compartir pantalla, SyncPilot queda detrás de lo que se presenta. Chrome frena los relojes de una pestaña oculta a 1 por segundo y, **después de 5 minutos oculta y en silencio, a 1 por minuto** (Chrome 88+, «intensive throttling», confirmado en developer.chrome.com).
  - La salida de audio de SyncPilot está en silencio (ganancia 0), así que la regla le aplica.
  - Lo que dependía de esos relojes:
    - el vigilante de Soniox (revisión cada 1 s; tapado, cada minuto: un corte tardaba hasta 1 min en recuperarse);
    - la espera de 8 s después de oír «Rick»;
    - la pausa entre reconexiones;
    - el tiempo límite para abrir la conexión;
    - el contador de duración, que sumaba 1 por tic y se atrasaba.
- **Causa 2: subida y procesador compartidos.**
  - Si la Grabación de SyncPilot corre a la vez, codifica 1080p a 15 fps y sube ~2.6 Mbps sin parar. Al mismo tiempo, Teams codifica y sube la pantalla compartida.
  - Si la subida no alcanza, los pedazos del video se acumulan en memoria del navegador (`chunkUploader`, sin tope) y el audio hacia Soniox se atrasa (`bufferedAmount`).
- **Causa 3: cada palabra redibujaba toda la pantalla.**
  - Cada mensaje de Soniox (5-10 por segundo) actualizaba el estado de la página completa: 2 listas con TODOS los fragmentos de la reunión.
  - Además, cada frase oída se anotaba en el registro de depuración, con un redibujo más y un `console.log`.
  - El costo crece con lo largo de la reunión.

**Cambios (en esta entrega):**

- **Relojes en un Worker** (`src/features/live/utils/ticker.ts`): ahí corren el vigilante, la espera de «Rick», la pausa entre reconexiones y el tiempo límite de conexión. Los relojes de un Worker no entran en esa regla de Chrome. La duración ahora se calcula desde la hora de inicio.
- **Menos trabajo por palabra:**
  - la vista previa se pinta como máximo 10 veces por segundo, y al momento cuando se cierra un fragmento;
  - en pantalla solo los últimos 300 fragmentos, con un botón «Mostrar los N fragmentos anteriores»;
  - solo se anota en el registro la frase que trae «Rick».
- **Diagnóstico cada minuto** (`src/features/live/diag/perfMonitor.ts`, en `GET /api/meetings/<id>/diag`):
  - si la pestaña estaba visible y cuánto tiempo estuvo tapada;
  - el atraso máximo de la página (latido del Worker) y las tareas de más de 50 ms;
  - memoria, nodos de la pantalla, audio que no sale hacia Soniox y video de la Grabación que falta por subir.
  - Al empezar anota los núcleos, la memoria aproximada del equipo y qué se compartió (pestaña, ventana o pantalla). Con la primera reunión de prueba se sabe cuál causa pesa más.

**Pendiente de decisión del usuario:** bajar la Grabación cuando corre junto con IA en Vivo; propuesta: 1080p a 8 fps y ~1.2 Mbps. Las pantallas de SAP o de documentos casi no se mueven, así que se verían igual de nítidas, con la mitad de subida y de trabajo. No se cambia sin su OK.

## Lo medido (19 nov)

- **Investigar libre, real con Gemini** (`scripts/test-copilot-research.ts --real-contexto`, reuniones inventadas):
  - el resumen sale en p50 1.8 s / p90 2.1 s;
  - la búsqueda tarda 3.8-5.9 s;
  - el idioma se detecta bien (español y inglés) y la búsqueda contesta en ese idioma;
  - los puntos son de lo último que se habló y la pregunta que sale a internet no lleva nombres, objetos Z, SID ni tickets;
  - 23 pruebas sin red pasan.
  - Ajuste: la instrucción ya distingue «Rick:» de «Meeting:». Antes, un punto decía «Rick is asking» cuando preguntaba el cliente.
- **Cambio de idioma, real con Soniox** (`scripts/test-lang-switch.ts`, audio de reunión SAP de 36 s):
  - reabrir la conexión tarda 0.6-1.0 s, y la primera palabra nueva llega a 0.95-1.5 s del cambio;
  - la traducción pasa al idioma nuevo (es → fr en la prueba);
  - **pérdida de palabras:** cerrando de golpe se perdían 4 de 100 (lo que Soniox aún no confirmaba). Con el cierre ordenado (`drain`: la conexión vieja recibe `finalize` y entrega sus últimas palabras durante 2.5 s mientras la nueva ya recibe el audio) se transcribieron 99 y 100 de 100.
- `tsc --noEmit` sin errores, `next build` OK y las pruebas del vigilante pasan. ESLint no está configurado en el repo: `next lint` pide configurarlo.

## Entrega

- Rama `feat/investigar-idiomas-rendimiento` y un PR con las 3 fases, como el PR #1 del 18 nov. El usuario aprueba el merge y el deploy sale solo.
- Falta su prueba en una reunión real:
  - el botón «Investigar» del pie;
  - un cambio de idioma a media reunión;
  - el EN/ES del Copiloto;
  - compartir pantalla más de 5 minutos con SyncPilot tapado.
  - Después se lee el diagnóstico de esa reunión.
