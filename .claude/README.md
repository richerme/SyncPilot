# SaaS Factory VPS V4 - Template Documentation

> **Fuente de verdad del template.** Guardada en `.claude/` para preservarla durante el desarrollo de proyectos.

---

## Que es SaaS Factory?

Template **production-ready** para crear aplicaciones SaaS modernas con desarrollo asistido por IA. Filosofia Henry Ford: un solo stack perfeccionado. Deploy en tu propio VPS via Coolify.

### Lo que incluye

- Next.js 16 (App Router) + TypeScript
- PostgreSQL + Prisma ORM (type-safe database)
- Auth.js v5 (Email/Password + Google OAuth)
- Tailwind CSS + shadcn/ui
- 22 Skills de Claude Code (V4)
- Arquitectura Feature-First optimizada para IA
- Docker multi-stage build para produccion
- Testing, linting y type checking configurados
- 5 Design Systems listos para usar
- AI Templates (Vercel AI SDK v5 + OpenRouter)

---

## Tech Stack (Golden Path)

```yaml
Runtime: Node.js + TypeScript
Framework: Next.js 16 (App Router)
Database: PostgreSQL + Prisma ORM
Auth: Auth.js v5 (NextAuth)
Styling: Tailwind CSS 3.4
Components: shadcn/ui
State: Zustand
Validation: Zod
Testing: Playwright CLI + MCP
AI Engine: Vercel AI SDK v5 + OpenRouter
Deploy: Coolify (Docker + GitHub → VPS)
```

**Por que Email/Password y no OAuth?**
Para evitar bloqueos de bots durante testing. Google OAuth requiere verificacion.

---

## Arquitectura Feature-First

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Rutas auth (grupo)
│   ├── (main)/              # Rutas principales
│   ├── api/                 # API Routes (auth, etc.)
│   ├── layout.tsx
│   └── page.tsx
│
├── features/                 # Organizadas por funcionalidad
│   ├── auth/
│   │   ├── components/      # LoginForm, SignupForm
│   │   ├── hooks/           # useAuth, useSession
│   │   ├── services/        # authService.ts
│   │   ├── types/           # User, Session
│   │   └── store/           # authStore.ts
│   │
│   └── [tu-feature]/        # Misma estructura
│
├── shared/                   # Codigo reutilizable
│   ├── components/          # Button, Card, Input
│   ├── hooks/               # useDebounce, useLocalStorage
│   ├── lib/                 # Utilidades compartidas
│   ├── types/               # Tipos compartidos
│   └── utils/               # helpers
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

> **Por que Feature-First?** Cada feature tiene TODO lo necesario en un solo lugar. Perfecto para que la IA entienda contexto completo sin navegar multiples carpetas.

---

## Quick Start

### 1. Levantar PostgreSQL local

```bash
docker compose up -d
```

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Configurar Variables de Entorno

```bash
cp .env.local.example .env.local
# Editar con tus credenciales
```

### 4. Crear Tablas

```bash
npx prisma migrate dev
```

### 5. Configurar MCPs (Opcional)

```bash
cp .claude/example.mcp.json .mcp.json
# Editar con tokens de Coolify
```

### 6. Iniciar Desarrollo

```bash
npm run dev
```

---

## Comandos npm

### Development
```bash
npm run dev          # Servidor desarrollo
npm run build        # Build para produccion
npm run start        # Servidor produccion
```

### Quality Assurance
```bash
npm run lint         # ESLint
npm run lint:fix     # Fix automatico
npm run typecheck    # TypeScript check
```

### Prisma
```bash
npx prisma migrate dev     # Crear y aplicar migracion en desarrollo
npx prisma migrate deploy  # Aplicar migraciones en produccion
npx prisma generate        # Regenerar cliente despues de cambiar schema
npx prisma studio          # UI visual para explorar datos
npx prisma db push         # Push rapido sin migracion (solo dev)
```

### Docker
```bash
docker compose up -d       # Levantar PostgreSQL local
docker compose down        # Detener PostgreSQL
```

---

## Skills (V4)

> V4 migra TODO a Skills. Hot reload, auto-discovery, zero config.
> Cada skill es una carpeta con `SKILL.md` (frontmatter YAML + instrucciones).

### Invocables por el Usuario (/)

| Skill | Comando | Descripcion |
|-------|---------|-------------|
| `new-app` | `/new-app` | Entrevista de negocio → BUSINESS_LOGIC.md |
| `landing` | `/landing` | Landing cinematica scroll-stop + copy AIDA/PAS |
| `primer` | `/primer` | Inicializar contexto del proyecto |
| `add-login` | `/add-login` | Auth completo Auth.js v5 (Email + Google OAuth) |
| `add-payments` | `/add-payments` | Pagos con Polar (checkout, webhooks, suscripciones) |
| `add-emails` | `/add-emails` | Emails transaccionales con Resend + React Email |
| `add-mobile` | `/add-mobile` | PWA instalable + push notifications |
| `eject-sf` | `/eject-sf` | Remover SaaS Factory del proyecto (DESTRUCTIVO) |
| `update-sf` | `/update-sf` | Actualizar a ultima version |
| `bucle-agentico` | `/bucle-agentico` | Bucle Agentico para sistemas complejos (por fases) |
| `prp` | `/prp [feature]` | Generar Product Requirements Proposal |
| `ai` | `/ai [template]` | Implementar AI Templates (chat, RAG, vision, tools) |
| `database` | `/database` | Prisma: modelos, migraciones, queries, relaciones |
| `qa` | `/qa [descripcion]` | QA automatizado con Playwright CLI |
| `memory-manager` | `/memory-manager` | Memoria persistente POR PROYECTO |
| `image-generation` | `/image-generation` | Generar imagenes con OpenRouter + Gemini |
| `autoresearch` | `/autoresearch` | Auto-optimizar skills (patron Karpathy) |
| `skill-creator` | `/skill-creator` | Crear nuevos skills |

### Invocables por Claude (automaticos)

| Skill | Se activa cuando... |
|-------|---------------------|
| `backend` | Tareas de Server Actions, APIs, logica de negocio, validaciones |
| `frontend` | UI/UX, componentes React, Tailwind, animaciones |
| `database-admin` | Migraciones Prisma, queries complejas, optimizacion |
| `codebase-analyst` | Analisis de patrones, convenciones, arquitectura |
| `coolify-deployer` | Deploy, env vars, dominios, PostgreSQL en VPS |
| `documentacion` | Actualizar docs despues de cambios en codigo |
| `calidad` | Testing, quality gates, validacion |

### Crear un Nuevo Skill

```bash
# Opcion 1: Usar skill-creator
/skill-creator

# Opcion 2: Manual
mkdir .claude/skills/mi-skill
# Crear SKILL.md con frontmatter + instrucciones
```

---

## MCPs Configurados

- **Next.js DevTools** - Conectado a `/_next/mcp` para debug en tiempo real
- **Playwright** - Validacion visual y testing automatizado (CLI preferido sobre MCP)
- **Coolify** - Gestion de apps, bases de datos y deploys en VPS

---

## Sistema PRP (Product Requirements Proposals)

> Contrato humano-IA antes de escribir codigo.

```
1. Humano: "Necesito [feature]"
2. /prp [feature] → IA investiga y genera PRP
3. Humano revisa y aprueba
4. /bucle-agentico → Ejecuta fase por fase
```

---

## AI Templates - Sistema de Bloques LEGO

Templates copy-paste para construir agentes IA con **Vercel AI SDK v5 + OpenRouter**.

| # | Bloque | Descripcion |
|---|--------|-------------|
| 00 | Setup Base | Configuracion inicial |
| 01 | Chat Streaming | Chat con useChat |
| 01-ALT | Action Stream | Agente transparente paso a paso |
| 02 | Web Search | Busqueda con :online |
| 03 | Historial | Persistencia con Prisma |
| 04 | Vision | Analisis de imagenes |
| 05 | Tools | Funciones/herramientas |
| 06 | RAG | pgvector + embeddings |

Standalone: `single-call`, `structured-outputs`, `generative-ui`

Usa `/ai [template]` para implementar cualquier bloque.

---

## Design Systems

Sistemas de diseno visuales en `.claude/design-systems/`.

| Sistema | Estilo |
|---------|--------|
| **Liquid Glass** | iOS-like, transparencias |
| **Gradient Mesh** | Degradados fluidos |
| **Neumorphism** | Soft UI, sombras suaves |
| **Bento Grid** | Grids asimetricos |
| **Neobrutalism** | Bold, bordes duros |

---

## Estructura de .claude/

```
.claude/
├── skills/                    # Skills (V4) - 22 skills
│   ├── new-app/              # Entrevista de negocio
│   ├── landing/              # Landing pages
│   ├── primer/               # Context initialization
│   ├── add-login/            # Auth completo (Auth.js v5)
│   ├── add-payments/         # Pagos (Polar)
│   ├── add-emails/           # Emails (Resend)
│   ├── add-mobile/           # PWA + Push
│   ├── eject-sf/             # Remover SF
│   ├── update-sf/            # Actualizar SF
│   ├── bucle-agentico/       # Bucle Agentico BLUEPRINT
│   ├── prp/                  # Generar PRPs
│   ├── ai/                   # AI Templates hub
│   │   └── references/       # AI Templates (11 bloques)
│   ├── database/             # BD: Prisma + PostgreSQL
│   ├── database-admin/       # Agent: DB avanzada
│   ├── qa/                   # Playwright CLI QA
│   ├── backend/              # Agent: backend specialist
│   ├── frontend/             # Agent: frontend specialist
│   ├── coolify-deployer/     # Agent: deployment VPS
│   ├── codebase-analyst/     # Agent: pattern analysis
│   ├── documentacion/        # Agent: documentation
│   ├── calidad/              # Agent: testing & QA
│   ├── memory-manager/       # Memoria persistente
│   ├── image-generation/     # Generacion de imagenes
│   ├── autoresearch/         # Auto-optimizacion
│   └── skill-creator/        # Crear nuevos skills
│
├── memory/                    # Memoria persistente (git-versioned)
│   ├── MEMORY.md             # Indice (max 200 lineas)
│   ├── user/                 # Sobre el usuario/equipo
│   ├── feedback/             # Correcciones y patrones
│   ├── project/              # Decisiones y estado
│   └── reference/            # Donde encontrar cosas
│
├── PRPs/                      # Product Requirements Proposals
│   └── prp-base.md           # Template base
│
├── design-systems/            # Sistemas de diseno
│   ├── neobrutalism/
│   ├── liquid-glass/
│   ├── gradient-mesh/
│   ├── bento-grid/
│   └── neumorphism/
│
├── hooks/                     # Scripts en eventos
├── example.mcp.json           # Config de MCPs
└── README.md                  # Este archivo
```

---

## Database Setup (Prisma + PostgreSQL)

### 1. PostgreSQL Local

```bash
docker compose up -d
# PostgreSQL en localhost:5432, user: postgres, pass: postgres, db: myapp
```

### 2. Prisma Client

```typescript
// src/lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### 3. Migraciones

```bash
npx prisma migrate dev --name nombre_migracion  # Desarrollo
npx prisma migrate deploy                       # Produccion
```

---

## Auth Setup (Auth.js v5)

```typescript
// src/lib/auth.ts
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [/* Google, Credentials */],
  session: { strategy: 'jwt' },
})
```

---

## Deploy (Coolify)

El agente despliega automaticamente a tu VPS:

1. **Crear repo** privado en GitHub
2. **Crear PostgreSQL** en Coolify
3. **Crear app** con Dockerfile
4. **Configurar env vars**: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`
5. **Deploy**: Coolify detecta el Dockerfile y construye automaticamente

---

## Troubleshooting

### Puerto Ocupado (EADDRINUSE)

```bash
lsof -i :3000
kill -9 <PID>
```

### TypeScript Errors

```bash
npm run typecheck
rm -rf .next
npm install
```

### Prisma Errors

```bash
npx prisma generate          # Regenerar cliente
npx prisma migrate reset     # Reset completo (DESTRUCTIVO)
docker compose down && docker compose up -d  # Reiniciar PostgreSQL
```

---

**Template Version:** 4.1.0 VPS Edition
**Last Updated:** 2026-04-10

---

*SaaS Factory VPS V4: Todo es un Skill. Agent-First. Deploy en tu propio servidor.*
