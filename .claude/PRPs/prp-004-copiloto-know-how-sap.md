# PRP-004: Copiloto con know-how de consultor SAP ABAP y búsqueda en internet

> **Estado**: APROBADO (2026-11-10): fases 1 y 2; «Investigar» solo con botón, con la pregunta y el contexto de la reunión. Implementación en la rama `feat/prp004-know-how`.
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

## Lo que necesito del usuario para avanzar

1. Aprobar el alcance: solo la fase 1, o la 1 y la 2.
2. Para la fase 2, decidir si «Investigar» es solo con botón o también automático cuando el Copiloto no sabe.

## Aprendizajes

### 2026-11-10: El Copiloto dependía de un solo proveedor
- **Error**: Gemini respondió 402 «prepayment credits are depleted» y el Copiloto mostró «No se pudo generar la respuesta» en dos reuniones seguidas.
- **Fix**: respaldo por OpenRouter y error que dice qué pasó (`src/lib/copilotAnswer.ts`).
- **Aplicar en**: cualquier llamada en vivo con un solo proveedor. También el resumen y los términos del contexto de la reunión (`buildBrief`), que hoy se quedan vacíos sin avisar si Gemini falla.
