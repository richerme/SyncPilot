# SaaS Factory VPS V4

Template production-ready para crear aplicaciones SaaS con desarrollo asistido por IA. Filosofia Agent-First: el usuario dice que quiere, el agente construye todo. Deploy en tu propio VPS via Coolify.

## Que incluye

- Next.js 16 (App Router) + TypeScript
- PostgreSQL + Prisma ORM (type-safe database)
- Auth.js v5 (Email/Password + Google OAuth)
- Tailwind CSS + shadcn/ui
- 22 Skills de Claude Code (V4)
- Playwright CLI para QA automatizado
- AI Templates (Vercel AI SDK v5 + OpenRouter)
- 5 Design Systems listos para usar
- Arquitectura Feature-First optimizada para IA
- Docker multi-stage build para produccion
- Deploy en VPS via Coolify (sin vendor lock-in)

## Quick Start

### 1. Levantar PostgreSQL local

```bash
docker compose up -d
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Variables de Entorno

```bash
cp .env.local.example .env.local
# Editar con tus credenciales
```

### 4. Crear tablas

```bash
npx prisma migrate dev
```

### 5. MCPs (Opcional)

```bash
cp .claude/example.mcp.json .mcp.json
# Editar con tokens de Coolify
```

### 6. Desarrollar

```bash
npm run dev
```

## Tech Stack

```yaml
Runtime: Node.js + TypeScript
Framework: Next.js 16 (App Router)
Database: PostgreSQL + Prisma ORM
Auth: Auth.js v5 (NextAuth)
Styling: Tailwind CSS 3.4
Components: shadcn/ui
State: Zustand
Validation: Zod
AI Engine: Vercel AI SDK v5 + OpenRouter
Testing: Playwright CLI + MCP
Deploy: Coolify (Docker + GitHub → VPS)
```

## Arquitectura Feature-First

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Rutas auth
│   ├── (main)/              # Rutas principales
│   ├── api/                 # API Routes (auth, etc.)
│   └── layout.tsx
│
├── features/                 # Organizadas por funcionalidad
│   └── [feature]/
│       ├── components/
│       ├── hooks/
│       ├── services/
│       ├── types/
│       └── store/
│
├── shared/                   # Codigo reutilizable
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── types/
│
├── lib/
│   ├── db.ts                # Prisma client singleton
│   └── auth.ts              # Auth.js v5 config
│
├── middleware.ts             # Proteccion de rutas (Auth.js)
│
└── prisma/
    └── schema.prisma         # Modelos de datos
```

## Skills (22 total)

### Para el usuario

| Skill | Que hace |
|-------|----------|
| `/new-app` | Entrevista de negocio → BUSINESS_LOGIC.md |
| `/landing` | Landing cinematica scroll-stop + copy AIDA/PAS |
| `/add-login` | Auth completo (Auth.js v5: Email + Google OAuth) |
| `/add-payments` | Pagos con Polar (checkout, webhooks, suscripciones) |
| `/add-emails` | Emails transaccionales con Resend + React Email |
| `/add-mobile` | PWA instalable + push notifications |
| `/bucle-agentico` | Implementar features complejas por fases |
| `/prp` | Planificar features complejas antes de implementar |
| `/ai [template]` | Agregar IA: chat, RAG, vision, tools |
| `/database` | Prisma: modelos, migraciones, queries, relaciones |
| `/qa` | QA automatizado con Playwright CLI |
| `/primer` | Inicializar contexto del proyecto |
| `/memory-manager` | Memoria persistente POR PROYECTO |
| `/image-generation` | Generar imagenes con OpenRouter + Gemini |
| `/autoresearch` | Auto-optimizar skills (patron Karpathy) |
| `/update-sf` | Actualizar a ultima version |
| `/eject-sf` | Remover SaaS Factory (destructivo) |
| `/skill-creator` | Crear nuevos skills |

### Automaticos (Claude los activa segun la tarea)

backend, frontend, database-admin, codebase-analyst, coolify-deployer, documentacion, calidad

## AI Templates

Bloques LEGO para construir features de IA con Vercel AI SDK v5 + OpenRouter:

| Template | Que hace |
|----------|----------|
| setup-base | Configuracion inicial |
| chat | Chat streaming con useChat |
| web-search | Busqueda con :online |
| historial | Persistencia con Prisma |
| vision | Analisis de imagenes |
| tools | Funciones/herramientas |
| rag | pgvector + embeddings |
| single-call | generateText() puntual |
| structured-outputs | generateObject() con Zod |
| generative-ui | LLM decide que componente renderizar |

## Design Systems

5 sistemas visuales listos en `.claude/design-systems/`:

- **Liquid Glass** - iOS-like, transparencias
- **Gradient Mesh** - Degradados fluidos
- **Neumorphism** - Soft UI, sombras suaves
- **Bento Grid** - Grids asimetricos
- **Neobrutalism** - Bold, bordes duros

## Comandos

```bash
npm run dev          # Desarrollo
npm run build        # Build produccion
npm run typecheck    # TypeScript check
npm run lint         # ESLint
```

### Prisma

```bash
npx prisma migrate dev     # Crear y aplicar migracion
npx prisma migrate deploy  # Aplicar en produccion
npx prisma generate        # Regenerar cliente
npx prisma studio          # UI visual para datos
```

### Docker (Desarrollo Local)

```bash
docker compose up -d       # Levantar PostgreSQL
docker compose down        # Detener PostgreSQL
```

## Deploy (Coolify)

El agente despliega automaticamente a tu VPS via Coolify:

1. Crea repo privado en GitHub
2. Crea PostgreSQL en Coolify
3. Configura app con Dockerfile
4. Variables de entorno: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`
5. Deploy automatico

Variables en Coolify:
- `DATABASE_URL` (connection string de PostgreSQL en Coolify)
- `AUTH_SECRET` (generado con `npx auth secret`)
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (si usa Google OAuth)
- `NEXT_PUBLIC_SITE_URL` (dominio de la app)

## Estructura .claude/

```
.claude/
├── skills/              # 22 Skills (V4)
├── memory/              # Memoria persistente (git-versioned)
├── PRPs/                # Product Requirements Proposals
├── design-systems/      # 5 sistemas de diseno
├── hooks/               # Scripts en eventos
└── example.mcp.json     # Config de MCPs
```

---

**SaaS Factory VPS V4** | Agent-First. Todo es un Skill. Deploy en tu propio servidor.
