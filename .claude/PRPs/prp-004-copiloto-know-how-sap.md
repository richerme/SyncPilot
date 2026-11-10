# PRP-004: Copiloto con know-how de consultor SAP ABAP y búsqueda en internet

> **Estado**: FASES 1-2 EN PRODUCCIÓN (2026-11-10 14:21, commit `fd4a8b8`, deploy verde). Aprobado el 10 nov (fases 1 y 2; «Investigar» solo con botón); el usuario dio el OK en el chat («sube el know-how de SyncPilot»). Falta la fase 3 (ajustes con reuniones reales).
> **Pedido del usuario (10 nov)**: que el Copiloto, cuando lo que preguntan no está en la reunión ni en los Documentos, conteste de forma proactiva como un consultor SAP ABAP actual o investigue rápido en internet; y que tenga de respaldo un «know-how» de todo lo que hoy debe saber un consultor SAP ABAP, guardado como prompt, para entender bien las preguntas y contestar mejor.

## Lo que hay hoy (verificado en el código, 10 nov)

- **Perfil del Copiloto** (`src/features/live/copilot/profile.ts`, `COPILOT_INSTRUCTIONS`):
  - Es el copiloto de Rick, consultor SAP ABAP que revisa requerimientos con clientes y funcionales: especificaciones funcionales, mejoras (user exits, BAdIs, enhancement points), reportes/ALV, interfaces (IDocs, RFC/BAPI, OData, APIs), formularios Adobe/Smart, conversiones, workflows, CDS y RAP, rendimiento, transportes y pruebas.
  - Contesta en inglés, en primera persona, de 2 a 5 frases fáciles de decir en voz alta.
  - Usa la transcripción y los Documentos con nombres de objetos reales.
  - **Regla clave: «Never invent facts that are not in the transcript or documents»**. Si algo no se sabe, lo dice y propone el siguiente paso. No compromete fechas ni alcance.
- **Contexto** (`src/lib/meetingContext.ts`): los Documentos activos completos van en un caché de Gemini junto con esas instrucciones. Se suman un resumen de la reunión y hasta 100 términos para el reconocimiento de voz.
- **Internet: NO.** Ni la ruta `/api/meetings/:id/answer` ni el caché usan herramientas de búsqueda. El conocimiento general de SAP que muestra hoy es el del modelo, sin una base propia ni fuentes.
- **Desde el 10 nov** hay respaldo por OpenRouter si Gemini falla (rama `fix/copiloto-respaldo`).

## Propuesta

### Fase 1 — Paquete de know-how SAP ABAP (respaldo fijo, sin internet)

- **Qué es:** un archivo `src/features/live/copilot/knowhow-sap-abap.md`, en inglés y de unos 15-25k tokens. Lo escribo yo y lo revisa el usuario. Lo que cubre:
  - S/4HANA:
    - simplificaciones: Business Partner, ACDOCA, MATDOC, el nuevo modelo de precios;
    - Simplification Item Catalog;
    - migraciones Brownfield, Greenfield y Bluefield;
    - SUM, DMO y Readiness Check.
  - ABAP moderno: sintaxis 7.4+/7.5x, expresiones, ABAP SQL, CDS view entities y DCL, AMDP, ABAP Unit y test doubles.
  - ABAP Cloud y RAP:
    - BDEF, behavior pool, EML, draft, servicios OData V4 y Fiori elements;
    - el modelo de 3 niveles (tier 1/2/3) y las APIs liberadas;
    - ATC, Clean Core niveles A-D y Cloudification Repository.
  - BTP: ABAP Environment, desarrollo side-by-side, CAP, Event Mesh e Integration Suite.
  - Mejoras: BAdIs clásicos y nuevos, enhancement framework, user exits/CMOD, implicit enhancements y su riesgo en upgrades.
  - Interfaces: IDocs (WE02/WE19/BD87, partner profiles, ALE), RFC/BAPI, OData, SOAP y proxies, colas qRFC/bgRFC.
  - Formularios: Adobe Forms y SmartForms, y Output Management en S/4.
  - Diagnóstico y rendimiento:
    - debugging: breakpoints, watchpoints y debugger scripting;
    - ST22, SM21, ST05/SQLM/SAT, ST12, SM37 y SM50/SM66;
    - optimización en HANA: code pushdown, FOR ALL ENTRIES vs JOIN, buffering.
  - Transporte y calidad: STMS, CTS+/gCTS, abapGit, ATC y Code Inspector, y la revisión de código.
  - Seguridad: AUTHORITY-CHECK, roles y SU53/ST01.
  - Cómo se trabaja en un proyecto: specs funcionales y técnicas, estimación, cutover, hypercare y defectos.
- **Dónde va:** en el mismo caché de la reunión, después de las instrucciones. Así no suma latencia: el caché ya existe y solo crece.
  - El caché de Gemini cobra el almacenamiento por hora y token, así que hay que medir el costo con el tamaño final.
  - En el respaldo de OpenRouter va en el prompt, sin caché.
- **Regla nueva en las instrucciones:**
  - Los datos del proyecto (tickets, objetos Z, fechas, estado) salen SOLO de la reunión y los Documentos, como hoy.
  - Las preguntas generales de SAP («¿qué es un BAdI?», «¿cómo depuro un IDoc?», «¿qué cambia en S/4?») se contestan con el know-how y el conocimiento del modelo, como consultor senior: correctas, cortas y sin inventar números de nota SAP.
  - Si no está seguro de algo que depende de la versión, lo dice y ofrece confirmarlo.
- **Costo:** ~0 extra en la llamada si va en el caché.
  - Pendiente de medir: el almacenamiento del caché (horas de reunión × ~20k tokens más).
  - Latencia: igual que hoy (~1 s a la primera palabra con caché).

### Fase 2 — Búsqueda en internet solo cuando hace falta

- **Cómo:** Gemini con la herramienta `googleSearch` (grounding) en una segunda llamada, nunca en la del primer segundo.
- **Flujo:**
  1. El Copiloto contesta al momento con reunión, Documentos y know-how, como hoy.
  2. Si la respuesta dice que no sabe o depende de la versión, o si el usuario pulsa «Investigar» (botón nuevo en la tarjeta), corre la llamada con búsqueda.
  3. Llega una segunda tarjeta «Verificado en internet», con 1-3 fuentes (título y dominio) para leer, no para decir en voz alta.
- **Alternativa en OpenRouter:** el modo `:online` / plugin `web`, si se queda en el respaldo.
- **Costo y latencia: POR VERIFICAR antes de aprobar.**
  - El grounding con Google Search tiene una cuota gratis al día y después se cobra por cada 1,000 búsquedas o prompts. El esquema cambió entre Gemini 2.x y 3.x, así que hay que leer la página de precios vigente.
  - La búsqueda suma típicamente 2-5 s.
  - Con 1-5 búsquedas por reunión, el costo esperado es de centavos por reunión. Se confirma midiendo 10 llamadas.
- **Riesgos:**
  - Fuentes viejas o de foros con datos de otras versiones: mostrar la fuente y la fecha.
  - Lo que se manda a internet: la consulta de búsqueda no debe llevar nombres del cliente ni datos de la reunión. Solo se busca la pregunta técnica, reescrita sin datos del proyecto. El cliente es de un tercero: cuidar lo que sale.
  - Distraer en vivo: la tarjeta aparece aparte y no reemplaza la primera respuesta.

### Fase 3 — Ajustes del prompt con reuniones reales

- **Insumo:** las respuestas guardadas (`meetingSuggestion` tipo `reply`).
- **Revisión:** se revisa con el usuario qué preguntas no supo contestar y se agregan esos temas al know-how. No se guarda texto de los clientes fuera de la BD de SyncPilot.

## Criterios de éxito

- **Pregunta general que no está en los Documentos** («¿cómo encuentro qué BAdI usar para validar una orden de venta?»): contesta en ~1 s con pasos concretos (SE18/SE19, buscar en el código con un breakpoint en `cl_exithandler=>get_instance`, BAdIs de VA01) y sin inventar datos del proyecto.
- **Pregunta de versión** («¿esto ya está liberado para ABAP Cloud?»): la primera respuesta dice que lo confirmará, y «Investigar» trae la respuesta con su fuente en ≤ 6 s.
- **Sin regresiones:** las preguntas del proyecto siguen saliendo solo de la reunión y los Documentos.
- **Costo:** medido y anotado.

## Decisiones del usuario (10 nov)

1. Alcance: fases 1 y 2.
2. «Investigar» solo con botón. Toma lo que se pregunta y el contexto de lo que se está hablando en la reunión.

## Implementación (10 nov 2026, rama `feat/prp004-know-how`, SIN SUBIR)

Falta el OK del usuario en el chat («sube el know-how de SyncPilot») para hacer merge a main y desplegar.

### Fase 1: know-how SAP ABAP (commit `a290cad`)

- **El paquete:** `src/features/live/copilot/knowhow.ts`. Es solo del servidor; `profile.ts` también se usa en el navegador.
  - Son 23.5k caracteres en inglés, escritos con palabras propias. Junto con las instrucciones suma **6,343 tokens**, menos que los 15-25k estimados: se priorizó que fuera denso y correcto.
  - Temas: 18 secciones, desde S/4HANA hasta cómo trabaja un proyecto, más «quick how-tos».
- **Regla nueva en `COPILOT_INSTRUCTIONS`:**
  - Los datos del proyecto salen solo de la reunión y los Documentos.
  - Las preguntas generales de SAP se contestan como consultor senior, sin inventar notas ni objetos.
  - Si la respuesta depende del release, lo dice.
- **Caché:**
  - Se crea siempre con instrucciones + know-how, haya o no documentos. Antes solo se creaba con documentos de 8k caracteres o más.
  - Si los documentos no caben, van como fragmentos en la pregunta (`docsInCache`).
  - El respaldo de OpenRouter lleva el mismo texto en el prompt.
- **Medido** (`scripts/test-copilot-knowhow.ts`):
  - El caché se crea en 0.5 s, al iniciar la reunión (ruta `/context`), no al preguntar.
  - Primera palabra: 0.83-1.25 s con caché y 0.87-1.26 s sin caché, igual que antes.
  - Las 3 preguntas de los criterios salieron concretas: SE18, el breakpoint en `CL_EXITHANDLER=>GET_INSTANCE` y Custom Logic; WE02/WE19/BD87; BAPI no liberado → RAP facade/EML o wrapper tier 2.
- **Costo:** el almacenamiento del caché es 0.50-1.00 USD por millón de tokens por hora (aistudio.google.com/docs/pricing). Son ~6.4k tokens más, unos **0.003-0.006 USD por hora de reunión**.

### Fase 2: «Investigar» (commits `ae61132`, `1caa9ba`)

- **Pantalla:** botón «🔎 Investigar» en cada respuesta terminada (`src/app/live/page.tsx`). Llama a `POST /api/meetings/:id/research` y abre debajo la tarjeta «Verificado en internet».
- **Lo que muestra la tarjeta:**
  - la búsqueda que salió;
  - el resultado sin modificar;
  - 1-3 fuentes (título · dominio);
  - las «Search Suggestions» de Google, en un iframe sandbox sin scripts, porque los términos del grounding piden mostrarlas con el resultado.
- **Privacidad** (`src/lib/copilotResearch.ts`):
  1. **Reescribir:** el modelo ve la pregunta, la primera respuesta y los últimos 4,000 caracteres de la reunión, y devuelve una pregunta genérica de SAP estándar, o vacía si es solo del proyecto.
  2. **Filtro fijo (`scrubQuery`):** quita objetos Z/Y, correos, URLs, números de 5 o más dígitos, SID-mandante y los términos propios de los documentos. Son propios los que no aparecen en el know-how ni en `SAP_TERMS` y no parecen transacción; cada palabra de un nombre compuesto también se bloquea.
  3. **Buscar:** Gemini + `googleSearch` recibe SOLO esa pregunta.
  - Respaldo en cada paso: OpenRouter (y en la búsqueda, el plugin `web`).
- **Historial:** se guarda como `meetingSuggestion` tipo `info` con `context = "Investigar: <búsqueda>"`, sin cambios de esquema. Los términos de Google permiten guardarlo como historial del usuario.
- **Pruebas** (`scripts/test-copilot-research.ts`), todas pasan:
  - Sin red, 13 pruebas: con una reunión inventada (empresa, persona, SID, objeto Z, ticket y proyecto ficticios) la búsqueda nunca recibe nada de eso, aunque la reescritura «se equivoque». Una pregunta solo del proyecto no busca. Si Gemini se queda sin saldo, entra el respaldo. Los parsers de Gemini y OpenRouter funcionan.
  - `--real 10`: 10 llamadas, sin ninguna fuga.
- **Latencia** (10 llamadas reales; reescribir con gemini-3.5-flash + Google Search):

  | Paso | p50 | p90 |
  |---|---|---|
  | Reescribir | 0.94 s | 1.67 s |
  | Buscar | 3.05 s | 4.25 s |
  | **Total** | **4.1 s** | **5.2 s** |

  Cumple el criterio de 6 s o menos.
- **Costo por clic**, con el precio de Google en aistudio.google.com/docs/pricing (10 nov):
  - **Búsquedas:** 1.8 de Google por clic. El grounding de Gemini 3 y posteriores da 5,000 búsquedas gratis al mes, compartidas entre esos modelos con la misma cuenta; después cobra 14 USD por 1,000. Cada consulta a Google se cobra aparte: «A customer-submitted request to Gemini may result in one or more queries».
    - Dentro de lo gratis: 0 USD (~2,700 clics al mes).
    - Después: ~0.025 USD por clic.
  - **Tokens:** ~0.002 USD por clic.
  - **Respaldo de OpenRouter:** con modelos de Google usa la búsqueda nativa (mismo precio de Google); con Exa, 0.007 USD por petición.
- **No probado:** la pantalla en el navegador. No levanté la app local con BD y sesión. tsc pasa; el proyecto no tiene configuración de ESLint v9.

### Agregado al subir: documentos con varios clientes (commits `707da4d`, `fd4a8b8`)

Pedido del usuario (10 nov): su documento de estatus trae a varios clientes, cada uno con la fecha y hora de su reunión, y el Copiloto debe usar solo la entrada de la reunión actual.
- `src/lib/meetingIdentity.ts`: bloque «THIS MEETING» en cada pregunta (título si trae cliente, fecha en ISO, dd/mm/aaaa, español e inglés, y hora de Ciudad de México; `SYNCPILOT_TIME_ZONE` la cambia).
- Regla en `profile.ts` (va en el caché): primero la entrada que coincide en cliente, fecha y hora; si no, por el cliente del título o lo que se dice; nunca mezclar tareas de otros clientes; si no se sabe, sin datos del proyecto.
- El resumen inicial (`buildBrief`) recibe la reunión, elige esa entrada y dice cuál tomó; el título entra a la llave del contexto.
- «Investigar»: el título de la reunión se suma a lo que nunca sale a internet.
- En Vivo: campo opcional «Cliente o título» antes de iniciar (el POST de reuniones valida el título con Zod). Sin él, el título era «Reunión dd/mm/aaaa».
- Prueba real con clientes inventados (`scripts/test-meeting-identity.ts --real`): los 3 casos (fecha y hora, título, conversación) eligen la entrada correcta en 1.3-2.0 s. Caché con la regla: 6,549 tokens, primera palabra 0.73-0.77 s.
- Sin probar en el navegador: el campo nuevo y la tarjeta de «Investigar» (se revisan en la primera reunión real).
## Aprendizajes

### 2026-11-10: El Copiloto dependía de un solo proveedor
- **Error**: Gemini respondió 402 «prepayment credits are depleted» y el Copiloto mostró «No se pudo generar la respuesta» en dos reuniones seguidas.
- **Fix**: respaldo por OpenRouter y error que dice qué pasó (`src/lib/copilotAnswer.ts`).
- **Aplicar en**: cualquier llamada en vivo con un solo proveedor. También el resumen y los términos del contexto de la reunión (`buildBrief`), que hoy se quedan vacíos sin avisar si Gemini falla.

### 2026-11-10: El filtro fijo dejaba restos si quitaba primero los nombres
- **Error**: con «laura@ficticio.example» y «FNP-300», quitar primero los términos «Laura», «Ficticio» y «FNP» dejaba «@.example» y «-300» en la búsqueda.
- **Fix**: primero los patrones completos (correo, URL, SID-mandante, objetos Z/Y, números largos) y después los términos sueltos (`scrubQuery`).
- **Aplicar en**: cualquier limpieza de datos con patrones y listas a la vez: siempre del patrón más grande al más chico.

### 2026-11-10: gemini-3.5-flash ya se enruta a gemini-3.6-flash
- **Hallazgo**: la respuesta trae `modelVersion: gemini-3.6-flash`, y la página de precios de Google ya no lista 3.5 Flash. Según fuentes externas, Google lo marcó obsoleto el 8 oct 2026.
- **Qué hacer**: fuera del alcance de este PRP. Al cambiar `GEMINI_MODELS`, volver a medir la latencia de transcribir y del Copiloto.

### 2026-11-10: Los términos del grounding con Google Search
- Mostrar el resultado sin modificarlo, con sus enlaces y las Search Suggestions, solo al usuario que lo pidió.
- No poner nada intermedio entre el enlace y el destino.
- No analizar ni entrenar con los resultados.
- Guardarlos como historial del usuario está permitido (hasta 2 años).
- Por eso la tarjeta muestra el texto tal cual y el iframe de sugerencias.
