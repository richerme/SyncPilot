# PRP-001: SyncPilot V2 — Grabación + Transcripción de Reuniones

> **Estado**: PENDIENTE
> **Fecha**: 2026-05-06
> **Proyecto**: SyncPilot

---

## Objetivo

Replicar y mejorar la app SyncPilot original sobre el stack Golden Path (Next.js 16 + Prisma + PostgreSQL + Auth.js v5 + Gemini API), eliminando Supabase por completo y sustituyendo el almacenamiento de archivos por volúmenes Docker en el VPS. La app debe tener grabación de pantalla/audio con procesamiento IA (transcripción, capítulos, resumen, action items), reproductor de video con transcript sincronizado, transcripción en vivo de reuniones (modo "Reunión Completa: Pestaña + Micrófono") y un dashboard con historial de grabaciones, historial de reuniones y documentos de contexto.

---

## Por Qué

| Problema | Solución |
|----------|----------|
| Supabase tiene costo, lock-in de proveedor y límites de storage/bandwidth | Almacenamiento propio en Docker volume del VPS, sin costos por GB ni por request |
| Auth de Supabase no es compatible con el stack estándar de la fábrica | Auth.js v5 con Prisma adapter, patrón unificado y controlado |
| El código original usa patrones Supabase (RLS, triggers SQL, `createClient`) por todo el codebase | Stack limpio: Prisma ORM + PostgreSQL, sin lógica de seguridad dispersa en SQL |
| El app de referencia funciona pero no tiene CI, deploy propio ni infraestructura VPS | Deploy en Coolify con Docker, DB PostgreSQL propia, volumen montado para archivos |

**Valor de negocio**: App completamente self-hosted, costo operativo predecible, control total del dato, arquitectura replicable para otros proyectos de la fábrica.

---

## Qué

### Criterios de Éxito

- [ ] Usuario puede registrarse/loguearse con email+password o Google OAuth
- [ ] Usuario puede grabar pantalla + audio del sistema, ver barra de progreso de upload y disparar "Procesar con IA"
- [ ] Procesamiento IA genera: transcripción con timestamps, capítulos, resumen ejecutivo, key points y action items
- [ ] Reproductor de video muestra video con transcript sincronizado y navegación por capítulos
- [ ] Transcripción en vivo funciona en modo "Reunión Completa (Pestaña + Micrófono)" mezclando getDisplayMedia + getUserMedia con Web Audio API
- [ ] Dashboard muestra historial de grabaciones e historial de reuniones
- [ ] Documentos de contexto se pueden subir y se cargan en la sesión en vivo
- [ ] Archivos de video se guardan en filesystem del VPS (Docker volume, no Supabase Storage)
- [ ] `npm run build` exitoso sin errores de TypeScript

### Comportamiento Esperado (Happy Path)

**Módulo Grabación:**
1. Usuario va a `/record`, da título, configura audio del sistema (on/off) y webcam (on/off)
2. Hace clic en "Iniciar grabación" → se dispara `getDisplayMedia` + `getUserMedia` → se mezclan con Web Audio API
3. Barra de estado persistente muestra duración + audio meter durante toda la sesión (barra flotante cross-route)
4. Al detener, el blob de video se sube en chunks al endpoint `/api/recordings/upload` → se guarda en `/uploads/videos/{userId}/{id}.webm` del VPS
5. En la página de la grabación aparece botón "Procesar con IA" → llama a `/api/process/recording`
6. Backend sube el archivo a Gemini File API, lo procesa, guarda transcript/chapters/summary/action_items en PostgreSQL
7. Reproductor de video muestra el video con panel lateral de transcript+capítulos sincronizados

**Módulo Reunión en Vivo:**
1. Usuario va a `/live`, selecciona modo de audio (Solo Micrófono / Solo Pestaña / **Reunión Completa (Pestaña + Micrófono)** / Avanzado)
2. En modo "Reunión Completa": `getDisplayMedia` para audio de pestaña + `getUserMedia` para micrófono, mezclados via Web Audio API → stream combinado
3. Chunks de audio de 3 segundos se envían a `/api/live/transcribe` (Gemini inline audio → texto)
4. Transcript aparece en tiempo real en columna izquierda; sugerencias IA aparecen automáticamente en columna derecha
5. Al finalizar, la sesión queda guardada en BD; aparece en historial de reuniones

**Módulo Dashboard:**
1. Cards con resumen de actividad reciente (últimas grabaciones + últimas reuniones)
2. Historial de grabaciones: título, duración, estado (uploading/processing/ready/error), acciones (ver, eliminar)
3. Historial de reuniones: fecha, duración, palabras, acciones (ver detalle)
4. Sección de documentos de contexto: subir PDF/TXT, listar, eliminar

---

## Contexto

### Referencias del Código Original (Recursos/)

- `Recursos/SyncPilot-initial/src/features/live/hooks/useLiveSession.ts` — Hook completo con 4 modos de captura (mic, tab, both, dual), chunk recording loop, integración con Gemini, AI suggestions debounce
- `Recursos/SyncPilot-initial/src/app/live/page.tsx` — UI completa de sesión en vivo con transcript + sugerencias + debug panel
- `Recursos/SyncPilot-initial/src/app/(main)/record/page.tsx` — UI de grabación con AudioMeter, recordingStore (Zustand)
- `Recursos/SyncPilot-initial/src/app/api/live/transcribe/route.ts` — Endpoint de transcripción en vivo usando `@google/genai` con inline audio base64
- `Recursos/SyncPilot-initial/src/app/api/process/recording/route.ts` — Procesamiento completo: descarga video → Gemini File API → JSON estructurado → guarda en BD
- `Recursos/SyncPilot-initial/supabase/001_syncpilot_schema.sql` — Schema original de BD (referencia para modelos Prisma)

### Documentación Relevante

- Gemini File API: `https://ai.google.dev/api/files` — Para subir videos grandes (>20MB) antes de procesarlos
- Gemini inline audio: funciona para chunks pequeños en base64 directamente en `inlineData`
- Web Audio API mixing: `AudioContext.createMediaStreamSource()` + `createMediaStreamDestination()` para mezclar streams
- `@google/genai` SDK: el original usa `GoogleGenAI` con `ai.models.generateContent()`

### Arquitectura Propuesta (Feature-First)

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (main)/
│   │   ├── layout.tsx          # Layout con sidebar
│   │   ├── dashboard/page.tsx
│   │   ├── record/page.tsx     # Grabación de pantalla+audio
│   │   ├── recordings/
│   │   │   ├── page.tsx        # Historial de grabaciones
│   │   │   └── [slug]/page.tsx # Reproductor + transcript
│   │   ├── meetings/
│   │   │   ├── page.tsx        # Historial de reuniones
│   │   │   └── [id]/page.tsx   # Detalle de reunión
│   │   └── documents/page.tsx  # Documentos de contexto
│   ├── live/
│   │   ├── layout.tsx          # Layout full-screen sin sidebar
│   │   └── page.tsx            # Sesión de transcripción en vivo
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── recordings/
│       │   ├── route.ts        # GET (listar) / POST (crear registro)
│       │   ├── upload/route.ts # POST (subir archivo al VPS filesystem)
│       │   └── [id]/route.ts   # PATCH (actualizar) / DELETE (eliminar)
│       ├── process/
│       │   ├── recording/route.ts  # POST: Gemini File API + analizar
│       │   └── [id]/route.ts       # GET: estado de procesamiento
│       ├── meetings/
│       │   ├── route.ts        # GET (listar) / POST (crear sesión)
│       │   └── [id]/
│       │       ├── route.ts    # GET (detalle) / POST (add transcript) / PATCH (finalizar)
│       │       └── suggest/route.ts # POST: AI suggestions
│       ├── documents/
│       │   ├── route.ts        # GET (listar) / POST (subir)
│       │   ├── content/route.ts # GET: texto concatenado para contexto IA
│       │   └── [id]/route.ts   # DELETE
│       └── files/
│           └── [...path]/route.ts  # GET: servir archivos desde filesystem
│
├── features/
│   ├── recording/
│   │   ├── components/
│   │   │   ├── RecordingStatusBar.tsx  # Barra flotante cross-route
│   │   │   └── AudioMeter.tsx
│   │   ├── hooks/
│   │   │   └── useMediaRecorder.ts
│   │   └── store/
│   │       └── recordingStore.ts  # Zustand: status, duration, audioLevel, progress
│   ├── live/
│   │   └── hooks/
│   │       └── useLiveSession.ts  # Replicar del original (4 modos, chunk loop, AI)
│   ├── player/
│   │   └── components/
│   │       ├── VideoPlayer.tsx     # Player custom con controles
│   │       └── TranscriptPanel.tsx # Panel sincronizado
│   ├── dashboard/
│   │   └── components/
│   │       └── StatsCards.tsx
│   └── documents/
│       └── components/
│           └── DocumentsList.tsx
│
└── shared/
    ├── components/
    │   └── Sidebar.tsx           # Sidebar dark con navegación
    └── lib/
        └── storage.ts            # Helpers para leer/escribir en VPS filesystem
```

### Modelo de Datos (Prisma)

```prisma
// Extiende User de Auth.js v5 con campos de perfil
model User {
  id            String       @id @default(cuid())
  name          String?
  email         String       @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  recordings    Recording[]
  meetings      Meeting[]
  documents     Document[]
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
}

model Recording {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  title          String       @default("Grabación sin título")
  slug           String       @unique
  description    String?
  status         String       @default("uploading")  // uploading | processing | ready | error
  storagePath    String?      // path relativo en filesystem: /uploads/videos/{userId}/{id}.webm
  thumbnailPath  String?
  durationSecs   Int?
  fileSizeBytes  BigInt?
  isPublic       Boolean      @default(false)
  shareToken     String?      @unique @default(cuid())
  viewCount      Int          @default(0)
  recordedAt     DateTime?
  transcripts    Transcript[]
  chapters       Chapter[]
  aiSummary      AiSummary?
  actionItems    ActionItem[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model Meeting {
  id           String       @id @default(cuid())
  userId       String
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  title        String       @default("Reunión sin título")
  status       String       @default("active")  // active | done | error
  startedAt    DateTime     @default(now())
  endedAt      DateTime?
  durationSecs Int?
  wordCount    Int          @default(0)
  transcripts  Transcript[]
  aiSummary    AiSummary?
  actionItems  ActionItem[]
  suggestions  MeetingSuggestion[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
}

model Transcript {
  id          String     @id @default(cuid())
  recordingId String?
  recording   Recording? @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  meetingId   String?
  meeting     Meeting?   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  startMs     Int
  endMs       Int
  speaker     String?
  text        String
  confidence  Float?
  language    String     @default("es")
  createdAt   DateTime   @default(now())
}

model Chapter {
  id          String    @id @default(cuid())
  recordingId String
  recording   Recording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  title       String
  startMs     Int
  endMs       Int
  summary     String?
  orderIndex  Int
  createdAt   DateTime  @default(now())
}

model AiSummary {
  id           String     @id @default(cuid())
  recordingId  String?    @unique
  recording    Recording? @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  meetingId    String?    @unique
  meeting      Meeting?   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  summaryText  String
  keyPoints    Json?
  sentiment    String?    // positive | neutral | negative
  modelVersion String     @default("gemini-2.5-flash")
  createdAt    DateTime   @default(now())
}

model ActionItem {
  id          String     @id @default(cuid())
  recordingId String?
  recording   Recording? @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  meetingId   String?
  meeting     Meeting?   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  text        String
  assignee    String?
  dueDateText String?
  isCompleted Boolean    @default(false)
  startMs     Int?
  createdAt   DateTime   @default(now())
}

model MeetingSuggestion {
  id          String   @id @default(cuid())
  meetingId   String
  meeting     Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  timestampMs Int
  type        String   // reply | question | info | warning
  text        String
  createdAt   DateTime @default(now())
}

model Document {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name         String
  storagePath  String   // /uploads/documents/{userId}/{id}.txt|pdf
  contentText  String?  // texto extraído para uso como contexto IA
  fileSizeBytes BigInt?
  mimeType     String?
  createdAt    DateTime @default(now())
}
```

### Variables de Entorno Requeridas

```env
DATABASE_URL=postgresql://...
AUTH_SECRET=...
AUTH_GOOGLE_ID=...          # opcional, para OAuth
AUTH_GOOGLE_SECRET=...      # opcional
GEMINI_API_KEY=...          # Google AI Studio
UPLOAD_DIR=/uploads         # Path base en el container (montado como volumen)
NEXT_PUBLIC_SITE_URL=...
```

### Docker Volume Config

En `docker-compose.yml` (desarrollo local):
```yaml
volumes:
  - ./uploads:/uploads   # mapea a UPLOAD_DIR
```

En Coolify (producción):
- Crear volumen persistente y montarlo en `/uploads` del container

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo se definen FASES. Las subtareas se generan just-in-time al entrar a cada fase en el bucle agéntico.

### Fase 1: Fundaciones — BD + Auth + Layout Base
**Objetivo**: Schema Prisma completo con migraciones aplicadas, Auth.js v5 configurado (email+password + Google OAuth opcional), layout sidebar dark (indigo/cyan) con rutas protegidas y navegación funcional.
**Validación**: `npx prisma migrate dev` exitoso, login/signup funciona, rutas `/dashboard`, `/record`, `/recordings`, `/meetings`, `/documents` accesibles tras login, sidebar muestra las 5 secciones, `npm run build` limpio.

### Fase 2: Grabación de Pantalla + Audio + Upload al VPS
**Objetivo**: Página `/record` con getDisplayMedia + getUserMedia, mezclado Web Audio API, AudioMeter visual, barra de estado flotante cross-route (RecordingStatusBar + Zustand), upload de blob al filesystem del VPS via `/api/recordings/upload` (chunked multipart), registro en BD con `status: 'uploading'` → `'ready'`.
**Validación**: Grabar 30 segundos, detener, ver progreso de upload, archivo aparece en `/uploads/videos/{userId}/`, registro en BD con `storagePath` poblado.

### Fase 3: Procesamiento IA con Gemini File API
**Objetivo**: Endpoint `/api/process/recording` que lee el archivo del filesystem local, lo sube a Gemini File API, genera el prompt estructurado, parsea JSON de respuesta, guarda Transcript[], Chapter[], AiSummary, ActionItem[] en PostgreSQL y cambia status a `'ready'`. UI: botón "Procesar con IA" en la página de grabación con polling de estado.
**Validación**: Click "Procesar con IA" → status cambia a `'processing'` → en ~30-60s cambia a `'ready'` con transcripción y capítulos guardados en BD.

### Fase 4: Reproductor de Video con Transcript Sincronizado
**Objetivo**: Página `/recordings/[slug]` con VideoPlayer custom (controles propios, no `<video>` nativo sin estilo), TranscriptPanel lateral que resalta el segmento activo según `currentTime`, navegación por capítulos que hace seek en el video, panel de resumen + key points + action items.
**Validación**: Abrir una grabación procesada, reproducir video, ver transcript resaltarse en tiempo real, hacer click en capítulo y video salta al timestamp correcto.

### Fase 5: Transcripción en Vivo (Módulo Reunión)
**Objetivo**: Replicar `useLiveSession.ts` del original adaptado al nuevo stack (sin Supabase — usa fetch a rutas API propias). Los 4 modos de audio (mic, tab, both, dual) deben funcionar. El modo **`'both'` (Reunión Completa: Pestaña + Micrófono)** es el prioritario: `getDisplayMedia` audio + `getUserMedia` mezclados via Web Audio API → chunks de 3s → `/api/live/transcribe` (Gemini inline) → transcript en tiempo real. Panel de sugerencias IA a la derecha con debounce automático. La sesión se guarda en BD (Meeting + Transcripts + Suggestions).
**Validación**: Iniciar sesión en modo "Reunión Completa", hablar y escuchar el audio de una pestaña, ver transcript aparecer cada ~3 segundos, ver sugerencias IA generarse automáticamente, finalizar sesión y verla en historial de reuniones.

### Fase 6: Dashboard + Historial + Documentos de Contexto
**Objetivo**: Dashboard con stats cards (total grabaciones, total reuniones, palabras transcritas totales), página de historial de grabaciones con tabla/cards (title, status badge, duration, acciones), página de historial de reuniones (fecha, duración, palabras), gestión de documentos de contexto (subir PDF/TXT → extraer texto → guardar en BD + filesystem, listar, eliminar), y que los documentos se carguen automáticamente en `useLiveSession` via `/api/documents/content`.
**Validación**: Dashboard muestra datos reales, documentos subidos aparecen en sesión en vivo (badge con count), historial de grabaciones y reuniones paginados correctamente.

### Fase 7: Validación Final
**Objetivo**: Sistema funcionando end-to-end
**Validación**:
- [ ] `npm run build` exitoso sin errores TypeScript
- [ ] `npm run typecheck` pasa limpio
- [ ] Flujo completo grabación → upload → procesamiento IA → reproductor funciona
- [ ] Transcripción en vivo modo "Reunión Completa" funciona en Chrome/Edge
- [ ] Dashboard muestra datos reales de BD
- [ ] Playwright screenshot confirma UI dark theme (indigo/cyan) en todas las páginas clave
- [ ] Todos los criterios de éxito del PRP cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta sección CRECE con cada error encontrado durante la implementación.

*(Vacío — se actualiza durante el bucle agéntico)*

---

## Gotchas

> Cosas críticas a tener en cuenta ANTES de implementar

- [ ] **AudioContext requiere gesto de usuario**: Crear `new AudioContext()` DENTRO del handler del botón "Iniciar sesión", no en `useEffect`. El original crea un `preemptiveAudioCtx` dentro de `startSession` para evitar que el navegador lo suspenda.
- [ ] **getDisplayMedia solo funciona con gesto del usuario**: No puede llamarse en `useEffect` ni en código asíncrono desacoplado del click. La cadena `click → startSession → getDisplayMedia` debe ser directa.
- [ ] **Modo `'both'` en Chrome/Edge requiere seleccionar "Pestaña" (no "Ventana" ni "Pantalla")** para obtener audio. Con audífonos Bluetooth en modo Manos Libres puede fallar. El original ya documenta esto en la UI con el warning de Windows.
- [ ] **Gemini File API tiene límite de tiempo**: Los archivos subidos se eliminan automáticamente tras 48h. No almacenar `fileUri` de Gemini como referencia permanente.
- [ ] **Upload de video grandes**: Usar streams/multipart (no leer todo en memoria). En Next.js con App Router, usar `request.body` como `ReadableStream` o `formData()` para recibir el archivo. El runtime Edge no soporta `fs` — usar `nodejs` runtime en el route.
- [ ] **Prisma + Next.js**: La relación `AiSummary` es 1-a-1 con `Recording` y 1-a-1 con `Meeting` — Prisma requiere `@unique` en ambos campos foráneos.
- [ ] **`UPLOAD_DIR` en Docker**: El path debe existir en el container. En Dockerfile, agregar `RUN mkdir -p /uploads` y el volumen debe montarse antes del start del servidor.
- [ ] **Auth.js v5 session en API routes**: Usar `auth()` de `@/lib/auth` (no `getServerSession`). El helper wrapper es `const session = await auth()`.
- [ ] **`@google/genai` vs Vercel AI SDK**: El original usa `@google/genai` directamente (no OpenRouter). Instalar `@google/genai` con `npm install @google/genai`.
- [ ] **MIME type para MediaRecorder**: `audio/webm;codecs=opus` es el formato más compatible. Al enviarlo a Gemini inline, usar solo el tipo base (`audio/webm`) porque Gemini no acepta el codec en el mimeType.

## Anti-Patrones

- NO usar Supabase en ninguna forma (ni `createClient`, ni Storage, ni Auth)
- NO usar `any` en TypeScript — especialmente en las APIs de Web Speech y MediaDevices
- NO almacenar archivos de video en memoria (ReadableStream directo a filesystem)
- NO olvidar `'use client'` en componentes con hooks de browser API
- NO crear tabla `profiles` separada — extender el modelo `User` de Auth.js v5 directamente
- NO usar SQL manual para migraciones — siempre `npx prisma migrate dev`
- NO ignorar el cleanup de streams en `useEffect` return function
- NO hardcodear `UPLOAD_DIR` en el código — siempre desde `process.env.UPLOAD_DIR`

---

*PRP pendiente aprobación. No se ha modificado código.*
