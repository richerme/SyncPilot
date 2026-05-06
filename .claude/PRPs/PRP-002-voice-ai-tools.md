# PRP-002: Voice AI Tools — Página /audio-tools + PWA

> **Estado**: APROBADO ✅
> **Fecha**: 2026-05-06
> **Proyecto**: SyncPilot

---

## Objetivo

Crear una nueva página `/audio-tools` con **5 herramientas de IA de voz** + convertir SyncPilot en **PWA instalable**.
Stack ampliado: OpenRouter (Gemini 2.5 Flash-Lite) + **OpenAI TTS** (speech synthesis) + **RNNoise WebAssembly** (noise cancellation profesional) + Web Audio API.

---

## Stack Tecnológico Aprobado

| Capa | Tecnología | Uso |
|------|-----------|-----|
| Transcripción | OpenRouter Gemini 2.5 Flash-Lite | Audio → texto |
| Traducción texto | OpenRouter (chatCompletion) | Texto → texto en otro idioma |
| **Síntesis de voz** | **OpenAI TTS API (`tts-1`)** | Texto traducido → audio en idioma destino |
| **Noise Cancellation** | **RNNoise WebAssembly** | Cancelación de ruido profesional local (sin latencia de red) |
| Detección de acento | OpenRouter multimodal | Análisis de idioma, acento, región |
| Meeting Analysis | OpenRouter (chatCompletion) | Análisis enriquecido post-reunión |
| **PWA** | next-pwa + Web App Manifest | App instalable en desktop/mobile |

**Variables de entorno nuevas requeridas:**
```
OPENAI_API_KEY=sk-...   # Para OpenAI TTS
```

---

## Por Qué

| Problema | Solución |
|----------|----------|
| No hay speech-to-speech: audio en idioma A → audio en idioma B | Audio Translator + OpenAI TTS: transcripción → traducción → síntesis |
| Ruido en micrófono degrada transcripciones | RNNoise WASM: cancelación profesional sin API, 0 latencia red |
| No se puede instalar SyncPilot como app nativa | PWA: instalable en Windows/Mac/Android/iOS desde el browser |
| Sin traducción en tiempo real durante reuniones | Live Translator toggle en /live con traducción por segmentos |
| Sin análisis profundo post-reunión | Meeting Assistant Pro con OpenRouter sobre transcript completo |

---

## Qué

### Criterios de Éxito

- [ ] PWA instalable: `manifest.json` + service worker + ícono → botón "Instalar" aparece en Chrome/Edge
- [ ] `/audio-tools` accesible desde sidebar con 5 tabs funcionales
- [ ] **Audio Translator**: subir MP3/WAV/MP4/WebM/M4A → transcripción + traducción + síntesis de voz (botón para escuchar y descargar audio traducido)
- [ ] **Speech-to-Speech**: el resultado de Audio Translator incluye audio sintetizado con OpenAI TTS
- [ ] **Live Translator**: toggle en `/live` → cada segmento muestra traducción en el idioma seleccionado
- [ ] **Language & Accent Detector**: grabar 10-15s → análisis de idioma, acento, región, claridad, sugerencias
- [ ] **Meeting Assistant Pro**: analizar reunión del historial → resumen ejecutivo, decisiones, pasos, participantes, tensiones
- [ ] **Noise Cancellation**: RNNoise WASM activo en grabaciones y sesiones en vivo; toggles con visualizador
- [ ] `npm run typecheck` y `npm run build` pasan sin errores

### Comportamiento Esperado (Happy Path)

**Audio Translator + Speech-to-Speech:**
1. Usuario sube un MP3 (o graba 30s)
2. API transcribe con OpenRouter → obtiene texto en idioma original
3. API traduce con OpenRouter → obtiene texto en idioma destino
4. API sintetiza con OpenAI TTS (`tts-1`, voz `nova`) → obtiene audio MP3
5. Frontend muestra: texto original | texto traducido | player de audio con el audio sintetizado
6. Botones: "Descargar texto" (.txt) + "Descargar audio" (.mp3)

**Live Translator:**
1. Usuario activa toggle "Traducir a [idioma]" en `/live`
2. Cada nuevo segmento del transcript dispara `POST /api/audio-tools/translate-segment`
3. Traducción aparece debajo del segmento original en color tenue (italics)
4. Indicador de "traduciendo..." mientras espera respuesta

**Language & Accent Detector:**
1. Usuario graba 10-15s con countdown visual
2. API analiza con OpenRouter multimodal (audio + prompt de análisis)
3. Resultado en tarjeta: idioma (bandera + nombre), acento probable, región estimada, score claridad (0-100), 3 sugerencias específicas de mejora

**Meeting Assistant Pro:**
1. Dropdown con reuniones recientes del usuario
2. Al seleccionar: muestra resumen del transcript (N fragmentos, duración)
3. "Analizar con IA" → OpenRouter genera análisis enriquecido
4. Tarjetas de resultado: resumen ejecutivo, decisiones tomadas, próximos pasos, participantes detectados, puntos de tensión, sentimiento general
5. Se guarda en `AiSummary` con `modelVersion: 'meeting-assistant-pro'`

**Noise Cancellation + RNNoise:**
1. Tab muestra estado actual: RNNoise activo/inactivo
2. Toggle "RNNoise WASM" → carga el módulo WASM y procesa el stream del micrófono
3. Visualizador de barras en tiempo real (con y sin procesamiento)
4. Settings se persisten en localStorage → aplicados automáticamente en `/live` y `/record`

**PWA:**
1. `manifest.json` con nombre "SyncPilot", ícono 192x192 y 512x512, theme color indigo
2. Service worker con next-pwa que cachea assets estáticos
3. En Chrome/Edge: aparece botón "Instalar SyncPilot" en la barra de URL
4. Instalado: se abre como ventana dedicada (sin barra de browser), ícono en taskbar/dock

---

## Contexto

### Referencias de Código

- `src/lib/openrouter.ts` — `transcribeAudio()` y `chatCompletion()` existentes; se reusan
- `src/app/api/live/transcribe/route.ts` — Patrón base para nuevas APIs
- `src/features/live/hooks/useLiveSession.ts` — Lógica de MediaRecorder + Web Audio API
- `src/app/live/page.tsx` — Punto de integración para Live Translator toggle
- `src/components/layout/Sidebar.tsx` — Agregar ítem "Herramientas de Voz"

### Nueva Librería: OpenAI SDK para TTS

```typescript
// src/lib/tts.ts
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function synthesizeSpeech(
  text: string,
  voice: 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer' = 'nova'
): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
    response_format: 'mp3',
  })
  return Buffer.from(await response.arrayBuffer())
}
```

### RNNoise WebAssembly

```typescript
// src/lib/rnnoise.ts (client-side only)
// Cargar desde CDN o bundlear el WASM
// La API expone un AudioWorkletProcessor que procesa frames de 480 samples
// Se integra con Web Audio API: source → RNNoiseProcessor → destination
```

**Recurso**: https://github.com/jishanshaikh4/rnnoise-wasm
**Alternativa**: usar el constraint `noiseSuppression: true` (navegador nativo) como fallback si WASM no carga.

### Arquitectura de Carpetas

```
src/
├── features/audio-tools/
│   ├── components/
│   │   ├── AudioToolsTabs.tsx           # Tab switcher (5 tabs)
│   │   ├── AudioTranslatorTab.tsx       # Upload + graba + traducción + TTS player
│   │   ├── AccentDetectorTab.tsx        # Graba 10-15s + tarjeta resultado
│   │   ├── MeetingAssistantTab.tsx      # Dropdown reuniones + análisis
│   │   ├── NoiseCancellationTab.tsx     # RNNoise toggles + visualizador
│   │   └── AudioLevelVisualizer.tsx     # AnalyserNode → canvas barras
│   ├── hooks/
│   │   ├── useAudioRecorder.ts          # Grabar N segundos
│   │   ├── useAudioLevel.ts             # AnalyserNode para visualizar
│   │   ├── useRNNoise.ts                # Carga WASM + aplica al stream
│   │   └── useLiveTranslator.ts         # Toggle + traducción por segmento
│   ├── services/
│   │   └── audioToolsApi.ts             # fetch wrappers
│   └── types/
│       └── index.ts                     # AccentAnalysis, MeetingAnalysis, etc.
│
├── app/
│   ├── (main)/audio-tools/page.tsx      # Página principal
│   ├── api/audio-tools/
│   │   ├── translate/route.ts           # POST: audio → transcripción + traducción + TTS
│   │   ├── translate-segment/route.ts   # POST: texto → texto traducido
│   │   ├── detect-language/route.ts     # POST: audio → análisis
│   │   └── meeting-analysis/route.ts    # GET + POST: análisis enriquecido
│   └── api/tts/route.ts                 # POST: texto → stream de audio MP3
│
├── lib/
│   ├── tts.ts                           # OpenAI TTS wrapper
│   └── rnnoise.ts                       # RNNoise WASM loader (client-only)
│
└── public/
    ├── manifest.json                    # PWA manifest
    ├── sw.js                            # Service worker (generado por next-pwa)
    └── icons/
        ├── icon-192.png                 # PWA icon
        └── icon-512.png                 # PWA icon splash
```

### Modelo de Datos (sin cambios)

- `AiSummary` reutilizado con `meetingId` + `modelVersion: 'meeting-assistant-pro'`
- Audio Translator y Accent Detector: efímeros (no se persisten)
- Preferencias de Noise Cancellation: `localStorage`

---

## Blueprint (7 Fases)

### Fase 0: PWA + Configuración inicial
**Objetivo**: Instalar `next-pwa`, crear `manifest.json`, íconos PWA (indigo/cyan del brand), configurar `next.config.ts` para service worker. Agregar `OPENAI_API_KEY` al `.env.local`.
**Validación**: En Chrome Dev Tools > Application > Manifest → aparece el manifest válido. Botón "Instalar" aparece en la URL bar.

### Fase 1: Estructura base + lib/tts.ts + Sidebar
**Objetivo**: Crear `src/lib/tts.ts` con OpenAI TTS, estructura de carpetas de la feature, página `/audio-tools` con tab switcher vacío, e ítem "Herramientas de Voz" en sidebar.
**Validación**: `/audio-tools` carga sin errores de TS con 5 tabs navegables.

### Fase 2: APIs de Backend (5 endpoints)
**Objetivo**: Implementar los 5 routes: `translate` (con llamada a TTS al final), `translate-segment`, `detect-language`, `meeting-analysis` (GET + POST), y `tts` (stream de audio).
**Validación**: Cada endpoint responde con JSON correcto. `typecheck` limpio.

### Fase 3: Audio Translator Tab (con Speech-to-Speech)
**Objetivo**: Upload/grabación → transcripción → traducción → síntesis TTS → player de audio embebido + botones descarga texto y audio.
**Validación**: Subir MP3, obtener texto traducido + audio reproducible del idioma destino.

### Fase 4: Language & Accent Detector Tab
**Objetivo**: Grabación 10-15s con countdown → análisis OpenRouter multimodal → tarjeta de resultado con todos los campos.
**Validación**: Grabar voz → tarjeta muestra idioma, acento, región, score, sugerencias.

### Fase 5: Meeting Assistant Pro Tab
**Objetivo**: Dropdown de reuniones → carga transcript → análisis enriquecido → tarjetas visuales.
**Validación**: Seleccionar reunión con transcript → análisis generado y mostrado.

### Fase 6: Noise Cancellation (RNNoise WASM) + Live Translator
**Objetivo**: RNNoise WASM integrado en hook `useRNNoise.ts` + visualizador de audio. Toggle Live Translator en `/live`. Settings persistidos en localStorage.
**Validación**: RNNoise activo muestra reducción de ruido en visualizador. Live Translator muestra traducciones debajo de cada segmento.

### Fase 7: Validación Final + Deploy
**Objetivo**: Typecheck + build + Playwright + commit + push + deploy Coolify.
**Validación**:
- [ ] `npm run typecheck` sin errores
- [ ] `npm run build` exitoso
- [ ] PWA instalable confirmado
- [ ] Todos los criterios de éxito cumplidos

---

## Gotchas

- [ ] **OpenAI TTS latencia**: Para textos largos, considerar streaming de audio (`response_format: 'mp3'` con stream). Para < 500 chars es casi inmediato.
- [ ] **RNNoise WASM**: Necesita `AudioWorklet` que no está disponible en todos los browsers. Fallback: `noiseSuppression: true` del constraint nativo.
- [ ] **AudioWorklet en Next.js**: El worklet JS debe estar en `/public` (accesible via URL) porque `audioCtx.audioWorklet.addModule()` necesita una URL, no un import.
- [ ] **Base64 → OpenAI TTS**: La respuesta es un Buffer binario (MP3). En el frontend usar `URL.createObjectURL(new Blob([buffer], { type: 'audio/mp3' }))`.
- [ ] **PWA + Next.js 15**: Usar `@ducanh2912/next-pwa` (fork activo de next-pwa compatible con App Router).
- [ ] **Service Worker en dev**: Desactivar SW en desarrollo (`disable: process.env.NODE_ENV === 'development'`) para no interferir con HMR.
- [ ] **OPENAI_API_KEY**: Agregar a `.env.local` Y a Coolify antes del deploy.
- [ ] **Live Translator debounce**: No traducir si el segmento es < 3 palabras. Usar `AbortController` si el siguiente segmento llega antes de que termine la traducción del anterior.

---

## Anti-Patrones

- NO llamar OpenAI TTS desde el cliente — siempre via `/api/tts` para proteger la API key
- NO cargar RNNoise WASM en SSR — usar `dynamic(() => import(...), { ssr: false })`
- NO guardar audio en el servidor — procesar en memoria y devolver como stream/buffer
- NO bloquear el UI durante síntesis TTS — usar estados de carga por herramienta
- NO hardcodear la voz de TTS — permitir selección entre las 6 voces de OpenAI (`nova`, `alloy`, `echo`, `fable`, `onyx`, `shimmer`)

---

## Aprendizajes (Self-Annealing)

> Se puebla durante la implementación.

---

*PRP aprobado. Implementación iniciada con bucle agéntico.*
