---
name: primer
description: "Cargar contexto completo del proyecto al inicio de una conversacion. Lee BUSINESS_LOGIC.md, estructura de features, estado de la BD, y configuracion actual. Activar cuando el agente no tiene contexto del proyecto o el usuario dice: que tenemos, donde estamos, dame contexto, resumeme el proyecto."
allowed-tools: Read, Grep, Glob, Bash
---

# Primer: Contexto SaaS Factory VPS

Este proyecto fue creado con **SaaS Factory VPS**, una template optimizada para desarrollo Agent-First con deploy en VPS propio via Coolify.

## Lo Que Ya Sabes (SaaS Factory DNA)

### Golden Path (Stack Fijo)
No hay decisiones tecnicas que tomar. El stack esta definido:

| Capa | Tecnologia | Notas |
|------|------------|-------|
| Framework | Next.js 16 + Turbopack | App Router, Server Components |
| UI | React 19 + TypeScript | Strict mode |
| Styling | Tailwind CSS 3.4 | Sin CSS custom |
| Backend | PostgreSQL + Prisma ORM | Migraciones declarativas, type-safe |
| Auth | Auth.js v5 (NextAuth) | Credentials + Google OAuth |
| Validation | Zod | Schemas compartidos client/server |
| Deploy | Coolify (Docker) | VPS propio, sin vendor lock-in |

### Arquitectura Feature-First
```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Route group: paginas de auth
│   ├── (main)/            # Route group: paginas con sidebar
│   └── api/               # API Routes (auth, etc.)
├── features/              # Todo colocalizado por feature
│   └── [feature-name]/
│       ├── components/    # UI de la feature
│       ├── services/      # Logica de negocio
│       ├── hooks/         # React hooks
│       └── types/         # TypeScript types
├── lib/
│   ├── db.ts              # Prisma client singleton
│   └── auth.ts            # Auth.js v5 config
├── middleware.ts           # Proteccion de rutas
└── prisma/
    └── schema.prisma      # Modelos de datos
```

### MCPs Disponibles
Tienes 3 MCPs conectados. Usalos:

| MCP | Comandos Clave | Cuando Usar |
|-----|----------------|-------------|
| **Coolify** | Gestionar apps, DBs, deployments | Deploy, crear BD, monitorear |
| **Next.js DevTools** | `nextjs_index`, `nextjs_call`, `browser_eval` | Debug errores, ver estado del servidor |
| **Playwright** | `browser_navigate`, `browser_snapshot`, `browser_click` | Validacion visual, testing UI |

### Skills Disponibles
Delega tareas complejas usando los skills especializados:

| Skill | Responsabilidad |
|-------|-----------------|
| `frontend` | UI/UX, componentes, Tailwind, animaciones |
| `backend` | Server Actions, APIs, logica de negocio |
| `database-admin` | Migraciones Prisma, queries complejas |
| `calidad` | Tests, quality gates, verificacion |
| `coolify-deployer` | Deploy, env vars, dominios |
| `documentacion` | README, docs tecnicos |
| `codebase-analyst` | Patrones, convenciones del proyecto |

### Skills Slash Disponibles
- `primer` - Este skill (contexto inicial)
- `prp` - Generar Product Requirements Proposal
- `new-app` - Crear nueva aplicacion desde cero
- `landing` - Crear landing page de alta conversion
- `add-login` - Inyectar sistema de autenticacion completo
- `database` - Operaciones de base de datos con Prisma
- `eject-sf` - Eliminar configuracion SaaS Factory
- `update-sf` - Actualizar a la ultima version

---

## Proceso de Contextualizacion

### 1. Leer Identidad del Proyecto

Lee `CLAUDE.md` y `BUSINESS_LOGIC.md` (si existe) y extrae:
- **Nombre del proyecto**
- **Problema que resuelve** (propuesta de valor)
- **Usuario target** (avatar)
- **Reglas de negocio especificas**

### 2. Mapear Estado de BD (via Prisma)

```bash
npx prisma migrate status
```

Revisa `prisma/schema.prisma` para ver:
- Que modelos existen
- Relaciones entre modelos
- Indices configurados

### 3. Escanear Features Implementadas

Revisa `src/app/` y `src/features/` para entender:
- Que paginas existen
- Que features estan construidas
- Que API endpoints hay

### 4. Entregar Resumen

```markdown
# [Nombre del Proyecto]

## Template
SaaS Factory VPS v4.1 (Next.js 16 + Prisma + Coolify)

## Proposito
[Que problema resuelve en 1-2 lineas]

## Estado Actual

### Base de Datos (Prisma)
| Modelo | Campos clave |
|--------|-------------|
| ... | ... |

### Rutas Implementadas
- `/` -> [descripcion]
- `/dashboard` -> [descripcion]
- ...

### API Endpoints
- `POST /api/xxx` -> [que hace]
- ...

## MCPs Activos
SI Coolify | SI Next.js DevTools | SI Playwright

## Comandos
- `npm run dev` -> Desarrollo
- `npm run build` -> Build
- `npx prisma studio` -> Explorar BD

## Listo para trabajar
En que te ayudo?
```

---

## Filosofia SaaS Factory

### El Humano Decide QUE, Tu Ejecutas COMO
- El humano define el problema de negocio
- Tu traduces a codigo usando el Golden Path
- No preguntas "que stack usar?" - ya esta decidido

### Velocidad = Inteligencia
- Turbopack permite 100 iteraciones en 30 segundos
- Usa Playwright para validar visualmente → codigo → screenshot → iterar

### MCPs son tus Sentidos
- **Coolify MCP** = Tu infraestructura (deploy, BD, servicios)
- **Next.js DevTools** = Tus ojos en errores/logs
- **Playwright** = Tu validacion visual

---

*SaaS Factory VPS: Agent-First Development. Deploy en tu propio servidor.*
