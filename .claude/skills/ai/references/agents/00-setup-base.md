# Bloque 00: Setup Base

> Configuracion inicial para todos los bloques de AI Templates.

**Tiempo:** 10 minutos
**Prerequisitos:** Proyecto Next.js existente

---

## 1. Instalar Dependencias

```bash
# Core AI SDK v5
npm install ai@latest @ai-sdk/react @openrouter/ai-sdk-provider

# Validacion
npm install zod

# Prisma ya esta instalado en el proyecto (para historial, etc.)
```

---

## 2. Variables de Entorno

```env
# .env.local

# OpenRouter (REQUERIDO)
OPENROUTER_API_KEY=sk-or-v1-tu-api-key

# Base de datos (Prisma ya esta configurado en el proyecto)
# DATABASE_URL ya esta en .env.local

# Metadata para OpenRouter (opcional pero recomendado)
NEXT_PUBLIC_SITE_URL=https://tu-app.com
NEXT_PUBLIC_SITE_NAME=Tu App
```

### Obtener API Keys

1. **OpenRouter**: https://openrouter.ai/keys
2. **PostgreSQL**: Ya configurado via docker-compose + Prisma

---

## 3. Configurar OpenRouter Provider

```typescript
// lib/ai/openrouter.ts
// NUNCA MODIFICAR - Provider base

import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
})

// Modelos disponibles (MODIFICAR segun necesites)
export const MODELS = {
  // Rapidos y economicos
  fast: 'google/gemini-2.0-flash-exp:free',

  // Balanceados
  balanced: 'anthropic/claude-3-5-sonnet',

  // Potentes
  powerful: 'anthropic/claude-3-5-sonnet',

  // Vision (para analisis de imagenes)
  vision: 'google/gemini-2.0-flash-exp:free',
} as const

export type ModelKey = keyof typeof MODELS
```

---

## 4. Base de Datos (Ya Configurada)

El proyecto ya tiene Prisma configurado en `src/lib/db.ts`.
Para bloques que necesiten persistencia (historial, etc.), usar directamente:

```typescript
import { prisma } from '@/lib/db'

// Ejemplo: guardar datos
const record = await prisma.miModelo.create({ data: { ... } })
```

---

## 5. Estructura de Carpetas Recomendada

```
src/
├── app/
│   └── api/
│       └── chat/           # API route para chat
│           └── route.ts
├── lib/
│   ├── ai/
│   │   └── openrouter.ts   # Provider configurado
│   ├── db.ts              # Prisma client (ya existente)
│   └── auth.ts            # Auth.js config (ya existente)
├── features/
│   └── chat/               # Feature de chat
│       ├── components/
│       ├── hooks/
│       └── types/
└── .env.local
```

---

## 6. Verificar Setup

Crea un endpoint de prueba:

```typescript
// app/api/test/route.ts
// ELIMINAR despues de verificar

import { openrouter, MODELS } from '@/lib/ai/openrouter'
import { generateText } from 'ai'

export async function GET() {
  try {
    const { text } = await generateText({
      model: openrouter(MODELS.fast),
      prompt: 'Di "Setup OK" en una palabra',
    })

    return Response.json({ status: 'ok', response: text })
  } catch (error) {
    return Response.json({
      status: 'error',
      message: String(error)
    }, { status: 500 })
  }
}
```

Prueba en: `http://localhost:3000/api/test`

---

## Checklist

- [ ] Dependencias instaladas
- [ ] `.env.local` configurado con OPENROUTER_API_KEY
- [ ] `lib/ai/openrouter.ts` creado
- [ ] (Opcional) Prisma client configurado
- [ ] Endpoint de prueba funciona

---

## Siguiente Bloque

Elige tu camino:

- **Chat tradicional**: Ve a `01-chat-streaming.md`
- **Agente transparente**: Ve a `01-alt-action-stream.md`
