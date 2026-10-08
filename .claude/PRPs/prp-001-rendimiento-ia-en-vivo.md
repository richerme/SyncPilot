# PRP-001: Rendimiento de grabación y reproducción, IA en Vivo, Copiloto y Live Translator

> **Estado**: IMPLEMENTADO (2026-10-08)
> **Pedido del usuario**: el equipo se trababa en reuniones de más de 30 min; los videos tardaban en empezar; la transcripción en vivo tenía retraso; el Copiloto debía contestar solo cuando le preguntan a Rick, en inglés y con el contexto de sus documentos; el Live Translator debía traducir la reunión en curso.

## Diagnóstico (datos de producción, 8 oct)

- 40 grabaciones, 10.4 GB, todas WebM VP9 de 200-580 MB, **ninguna con duración**: el reproductor saltaba al final (`currentTime = 1e101`) para calcularla y recorría el archivo antes de empezar; además el servidor entregaba el video de 1 MB en 1 MB.
- La grabación codificaba VP9 (software) a 1080p/30 fps/5 Mbps y guardaba TODO el video en memoria hasta detenerla (~1.1 GB por 30 min).
- IA en Vivo: un MediaRecorder nuevo cada 2 s + base64, cortes fijos que partían palabras, silencios enviados, respuestas fuera de orden.
- Copiloto: sugerencias automáticas cada 3 s (977 guardadas en 6 reuniones); solo veía los primeros 3,000 caracteres de los documentos; los .docx no se leían.
- Live Translator: solo guardaba un ajuste.

## Qué se hizo

| Área | Cambio |
|---|---|
| Grabación | H.264 (tarjeta de video) → VP8 → VP9; 15 fps, 2.5 Mbps; cada pedazo de 5 s se sube mientras se graba (`chunkUploader`, offset idempotente, reintentos) |
| Cierre | `POST /api/recordings/:id/complete` re-empaqueta sin re-codificar (`-c copy`): H.264 → MP4 faststart, VP8/9 → WebM con Cues al inicio; guarda duración |
| Reproducción | rangos abiertos hasta el final del archivo, Content-Type por extensión, `preload="metadata"`, sin el truco de saltar al final si se conoce la duración |
| Grabaciones viejas | `scripts/remux-recordings.cjs` (`--aplicar`, luego `--limpiar` para borrar los `recording.orig.webm`) |
| Transcripción | AudioWorklet 16 kHz → cortes en pausas de 0.3 s (máx. 5 s, cortando en el tramo más bajo), sin silencios, WAV binario, entrega en orden, fin de turno local (1.2 s) |
| Modelos | ver `src/lib/geminiModels.ts`; vocabulario SAP en las instrucciones de transcripción |
| Copiloto | solo con botón **Responder**, al oír "Rick" (espera fin de la pregunta, máx. 8 s; enfriamiento 15 s) o pregunta escrita; inglés, primera persona, perfil de consultor SAP ABAP (`copilot/profile.ts`); streaming; documentos buscados en el servidor (`lib/docContext.ts`, hasta 12k caracteres relevantes); `.docx` extraídos sin dependencias (`lib/docx.ts`) |
| Live Translator | `BroadcastChannel` entre pestañas: la reunión de IA en Vivo se traduce en vivo en Voice AI Tools (turno re-traducido mientras se habla, se reutiliza al cerrarlo) |

## Mediciones

- Re-empaquetar una reunión de 45 min (289 MB): 1.4 s en el servidor.
- Transcripción de un tramo de 3.5 s: gemini-3.5-flash 0.8 s (mediana) vs gemini-2.5-flash 1.4 s. Cadena completa con audio de prueba: 0.85-1.0 s por tramo, sin palabras perdidas.
- Traducción: gemini-3.5-flash-lite 0.6 s. Copiloto: primera palabra 0.8 s.

## Aprendizajes (Auto-Blindaje)

### 2026-10-08: el WebM de MediaRecorder no trae duración ni índice
- **Error**: los videos tardaban en empezar y el truco `currentTime = 1e101` recorría el archivo completo.
- **Fix**: re-empaquetar con ffmpeg `-c copy` al cerrar la grabación (segundos) y guardar `durationSecs`.
- **Aplicar en**: cualquier app que grabe con MediaRecorder.

### 2026-10-08: Gemini 3.x con el razonamiento encendido devuelve vacío
- **Error**: gemini-3.5-flash sin `thinkingBudget: 0` y `maxOutputTokens: 256` respondió "" (el razonamiento se comió los tokens). En los Flash-Lite, `thinkingBudget: 0` da 400.
- **Fix**: `NO_THINKING` en Flash; nada en Flash-Lite.

### 2026-10-08: cortes fijos de audio pierden las palabras de la orilla
- **Error**: con cortes cada 3.5 s Gemini perdió "for the" y "the IDoc" y escribió "batting" por "BAdI".
- **Fix**: cortar en pausas de 0.3 s (máx. 5 s en el punto más bajo) + vocabulario SAP en las instrucciones.

### 2026-10-08: gemini-2.5-flash-lite ya no se ofrece a cuentas nuevas
- **Fix**: gemini-3.5-flash-lite; listar modelos con `ai.models.list()` antes de fijar uno.

## Pruebas

`npx tsx scripts/test-live-logic.ts <audio.wav>`: segmentador (pausas, tope, silencio, fin de turno), entrega en orden, WAV, detección del nombre, extracción de .docx.
