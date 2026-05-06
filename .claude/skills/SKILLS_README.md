# Skills System - SaaS Factory VPS V4

> Todo es un Skill. Hot reload. Auto-discovery. Zero config.

---

## Inventario de Skills

### Invocables por el Usuario (/)

| Skill | Comando | Descripcion |
|-------|---------|-------------|
| `new-app` | `/new-app` | Entrevista de negocio → BUSINESS_LOGIC.md |
| `landing` | `/landing` | Landing cinematica: scroll-driven video + copy AIDA/PAS + glass-morphism |
| `primer` | `/primer` | Inicializar contexto del proyecto |
| `add-login` | `/add-login` | Auth completo Auth.js v5 (login, signup, password reset, Google OAuth) |
| `add-payments` | `/add-payments` | Pagos con Polar (MoR): checkout, webhooks, suscripciones, acceso |
| `add-emails` | `/add-emails` | Emails transaccionales: Resend + React Email + batch + unsubscribe |
| `add-mobile` | `/add-mobile` | PWA instalable + push notifications (iOS compatible) |
| `eject-sf` | `/eject-sf` | Remover SaaS Factory del proyecto (DESTRUCTIVO) |
| `update-sf` | `/update-sf` | Actualizar a ultima version |
| `bucle-agentico` | `/bucle-agentico` | Bucle Agentico para sistemas complejos (por fases) |
| `sprint` | `/sprint` | Bucle Agentico para tareas rapidas |
| `prp` | `/prp [feature]` | Generar Product Requirements Proposal |
| `ai` | `/ai [template]` | Implementar AI Templates (chat, RAG, vision, tools) |
| `database` | `/database` | Prisma: modelos, migraciones, queries, relaciones |
| `qa` | `/qa [descripcion]` | QA automatizado con Playwright CLI |
| `skill-creator` | `/skill-creator` | Crear nuevos skills |
| `memory-manager` | `/memory-manager` | Memoria persistente por proyecto (reemplaza auto-memory) |
| `image-generation` | `/image-generation` | Generar/editar imagenes con OpenRouter + Gemini |
| `autoresearch` | `/autoresearch [skill]` | Auto-optimizar skills con loop autonomo (Karpathy) |

### Invocables por Claude (automaticos)

| Skill | Se activa cuando... |
|-------|---------------------|
| `backend` | Tareas de Server Actions, APIs, logica de negocio, validaciones |
| `frontend` | UI/UX, componentes React, Tailwind, animaciones |
| `database-admin` | Migraciones Prisma, queries SQL complejas, optimizacion |
| `codebase-analyst` | Analisis de patrones, convenciones, arquitectura |
| `coolify-deployer` | Deploy a Coolify, env vars, dominios, PostgreSQL |
| `documentacion` | Actualizar docs despues de cambios en codigo |
| `calidad` | Testing, quality gates, validacion |

---

## Estructura de un Skill

```
skill-name/
├── SKILL.md              # Requerido: frontmatter YAML + instrucciones
├── scripts/              # Opcional: codigo ejecutable (.py, .sh, .js)
├── references/           # Opcional: docs de referencia (>5k palabras)
└── assets/               # Opcional: templates, imagenes, fonts
```

### Frontmatter YAML

```yaml
---
name: skill-name                    # Identificador (lowercase, hyphens, max 64 chars)
description: Que hace               # Claude usa esto para decidir cuando activarlo
argument-hint: "[argumento]"        # Hint en autocomplete (opcional)
user-invocable: false               # Solo Claude puede invocarlo (opcional)
disable-model-invocation: true      # Solo el usuario puede invocarlo (opcional)
allowed-tools: Read, Write, Bash    # Tools permitidos sin pedir permiso (opcional)
model: claude-sonnet-4-6            # Modelo especifico (opcional)
context: fork                       # Ejecuta en subagent aislado (opcional)
agent: Explore                      # Tipo de agente (opcional)
---
```

### Progressive Disclosure

1. **Metadata** (~100 palabras) - Siempre en contexto (frontmatter)
2. **SKILL.md** (<5k palabras) - Cuando se activa
3. **Resources** (unlimited) - Bajo demanda (scripts/, references/, assets/)

---

## Memoria Persistente (.claude/memory/)

SaaS Factory VPS incluye un sistema de memoria persistente POR PROYECTO que reemplaza la auto-memory de Claude Code.

**Como funciona:**
- `.claude/memory/MEMORY.md` es el indice (max 200 lineas, se carga automaticamente)
- Carpetas por tipo: `user/`, `feedback/`, `project/`, `reference/`
- Git-versioned: cada cambio es un commit que puedes revertir
- El skill `memory-manager` gestiona cuando consultar y cuando guardar

---

## Recursos Compartidos

| Recurso | Path | Usado por |
|---------|------|-----------|
| PRP Template | `.claude/PRPs/prp-base.md` | Skill `prp` |
| AI Templates | `.claude/skills/ai/references/` | Skill `ai` |
| Design Systems | `.claude/design-systems/` | Directo (5 sistemas) |

---

## Crear un Nuevo Skill

```bash
# Opcion 1: Usar skill-creator
/skill-creator

# Opcion 2: Manual
mkdir .claude/skills/mi-skill
# Crear SKILL.md con frontmatter + instrucciones
```

---

*SaaS Factory VPS V4: Todo es un Skill.*
