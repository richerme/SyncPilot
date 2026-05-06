# Bloque 06: RAG Basico

> Retrieval Augmented Generation con PostgreSQL pgvector + Prisma.

**Tiempo:** 30 minutos
**Prerequisitos:** Bloque 00 (Setup), PostgreSQL con pgvector habilitado

---

## Que Obtienes

- Base de conocimiento consultable por el agente
- Embeddings almacenados en PostgreSQL
- Busqueda semantica (por significado, no keywords)
- Tool `getInformation` para el chat

---

## Concepto RAG

```
┌─────────────────────────────────────────────────────────────┐
│                      FLUJO RAG                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  INDEXACION (una vez):                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Documento│ -> │ Chunking │ -> │ Embeddings│ -> PostgreSQL│
│  └──────────┘    └──────────┘    └──────────┘              │
│                                                             │
│  CONSULTA (cada pregunta):                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Pregunta │ -> │ Embedding│ -> │ Busqueda │ -> │Context│ │
│  └──────────┘    └──────────┘    │ Similitud│    └───┬───┘ │
│                                  └──────────┘        │     │
│                                                      v     │
│                                               ┌──────────┐ │
│                                               │    LLM   │ │
│                                               │ Respuesta│ │
│                                               └──────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Setup PostgreSQL pgvector

### Habilitar extension

Ejecutar en tu base de datos (via Prisma migration o SQL directo):

```sql
-- Crear migracion manual para habilitar pgvector
-- prisma/migrations/XXXXXX_enable_pgvector/migration.sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Prisma Schema

```prisma
// prisma/schema.prisma
// AGREGAR estos modelos

model Resource {
  id         String      @id @default(cuid())
  content    String
  metadata   Json        @default("{}")
  embeddings Embedding[]
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt
}

model Embedding {
  id         String   @id @default(cuid())
  resourceId String
  resource   Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  content    String
  // pgvector no tiene tipo nativo en Prisma, usamos raw SQL para el campo vector
  createdAt  DateTime @default(now())

  @@index([resourceId])
}
```

### Agregar columna vector via SQL migration

```sql
-- prisma/migrations/XXXXXX_add_vector_column/migration.sql
-- Ejecutar despues de prisma migrate dev

ALTER TABLE "Embedding" ADD COLUMN "embedding" vector(1536);

CREATE INDEX ON "Embedding"
USING hnsw ("embedding" vector_cosine_ops);

-- Funcion de busqueda por similitud
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id text,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    "Embedding".id,
    "Embedding".content,
    1 - ("Embedding"."embedding" <=> query_embedding) AS similarity
  FROM "Embedding"
  WHERE 1 - ("Embedding"."embedding" <=> query_embedding) > match_threshold
  ORDER BY "Embedding"."embedding" <=> query_embedding
  LIMIT match_count;
$$;
```

> **Nota**: pgvector no tiene soporte nativo en Prisma schema. Usamos migraciones SQL manuales para el campo vector y la funcion de busqueda. Prisma `$queryRaw` se usa para interactuar con estos campos.

---

## 2. Configurar Embeddings

```typescript
// lib/ai/embeddings.ts

import { embed, embedMany } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'

// Modelo de embeddings
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'

// Generar embedding de un texto
export async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
    value: text,
  })
  return embedding
}

// Generar embeddings de multiples textos
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: openrouter.textEmbeddingModel(EMBEDDING_MODEL),
    values: texts,
  })
  return embeddings
}
```

---

## 3. Funciones de Chunking

```typescript
// lib/ai/chunking.ts

interface Chunk {
  content: string
  index: number
}

// Dividir texto en chunks por oraciones
// MODIFICAR: Ajusta segun tu caso de uso
export function chunkText(text: string, maxChunkSize = 500): Chunk[] {
  // Dividir por oraciones
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0)

  const chunks: Chunk[] = []
  let currentChunk = ''
  let chunkIndex = 0

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex++,
      })
      currentChunk = sentence
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      index: chunkIndex,
    })
  }

  return chunks
}
```

---

## 4. Servicio RAG (Prisma + Raw SQL)

```typescript
// lib/ai/rag.ts

import { prisma } from '@/lib/db'
import { generateEmbedding, generateEmbeddings } from './embeddings'
import { chunkText } from './chunking'
import { Prisma } from '@prisma/client'

// Agregar documento a la base de conocimiento
export async function addDocument(content: string, metadata?: Record<string, unknown>) {
  // 1. Guardar recurso original
  const resource = await prisma.resource.create({
    data: { content, metadata: metadata ?? Prisma.JsonNull },
  })

  // 2. Dividir en chunks
  const chunks = chunkText(content)

  // 3. Generar embeddings
  const embeddings = await generateEmbeddings(chunks.map(c => c.content))

  // 4. Guardar embeddings con vector via raw SQL
  for (let i = 0; i < chunks.length; i++) {
    const embeddingRecord = await prisma.embedding.create({
      data: {
        resourceId: resource.id,
        content: chunks[i].content,
      },
    })

    // Actualizar el campo vector via raw SQL (Prisma no soporta tipo vector nativamente)
    const vectorStr = `[${embeddings[i].join(',')}]`
    await prisma.$executeRaw`
      UPDATE "Embedding"
      SET "embedding" = ${vectorStr}::vector
      WHERE "id" = ${embeddingRecord.id}
    `
  }

  return resource.id
}

// Buscar contenido relevante
export async function findRelevantContent(
  query: string,
  threshold = 0.5,
  limit = 5
): Promise<{ content: string; similarity: number }[]> {
  // 1. Generar embedding de la pregunta
  const queryEmbedding = await generateEmbedding(query)

  // 2. Buscar similares via raw SQL (pgvector)
  const vectorStr = `[${queryEmbedding.join(',')}]`
  const results = await prisma.$queryRaw<{ id: string; content: string; similarity: number }[]>`
    SELECT * FROM match_embeddings(
      ${vectorStr}::vector,
      ${threshold}::float,
      ${limit}::int
    )
  `

  return results
}
```

---

## 5. Tool para el Agente

```typescript
// lib/ai/tools/knowledge.ts

import { z } from 'zod'
import { findRelevantContent, addDocument } from '../rag'

export const knowledgeTools = {
  // Tool para buscar informacion
  getInformation: {
    description: 'Busca informacion relevante en la base de conocimiento',
    parameters: z.object({
      query: z.string().describe('La pregunta o tema a buscar'),
    }),
    execute: async ({ query }: { query: string }) => {
      const results = await findRelevantContent(query)

      if (results.length === 0) {
        return 'No encontre informacion relevante sobre eso.'
      }

      return results
        .map(r => r.content)
        .join('\n\n---\n\n')
    },
  },

  // Tool para agregar conocimiento (opcional)
  addKnowledge: {
    description: 'Agrega nueva informacion a la base de conocimiento',
    parameters: z.object({
      content: z.string().describe('El contenido a agregar'),
      source: z.string().optional().describe('Fuente de la informacion'),
    }),
    execute: async ({ content, source }: { content: string; source?: string }) => {
      const id = await addDocument(content, { source })
      return `Informacion agregada con ID: ${id}`
    },
  },
}
```

---

## 6. Integrar con Chat

```typescript
// app/api/chat/route.ts
// MODIFICAR: Agregar tools de RAG

import { openrouter, MODELS } from '@/lib/ai/openrouter'
import { streamText, convertToModelMessages, type UIMessage } from 'ai'
import { knowledgeTools } from '@/lib/ai/tools/knowledge'

const SYSTEM_PROMPT = `Eres un asistente con acceso a una base de conocimiento.
Cuando el usuario pregunte sobre algo, USA la tool getInformation para buscar.
Basa tus respuestas en la informacion encontrada.
Si no encuentras nada relevante, dilo honestamente.`

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: openrouter(MODELS.balanced),
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: knowledgeTools,
    maxSteps: 3, // Permitir multiples llamadas a tools
  })

  return result.toUIMessageStreamResponse()
}
```

---

## 7. Script para Indexar

```typescript
// scripts/index-docs.ts
// Ejecutar: npx tsx scripts/index-docs.ts

import { addDocument } from '@/lib/ai/rag'
import fs from 'fs'
import path from 'path'

async function indexDocuments(docsDir: string) {
  const files = fs.readdirSync(docsDir)

  for (const file of files) {
    if (!file.endsWith('.md') && !file.endsWith('.txt')) continue

    const content = fs.readFileSync(path.join(docsDir, file), 'utf-8')
    console.log(`Indexando: ${file}`)

    await addDocument(content, { source: file })
    console.log(`  ✓ Indexado`)
  }

  console.log('Indexacion completa!')
}

// Usar:
indexDocuments('./docs')
```

---

## Optimizaciones

### Hybrid Search (Keyword + Semantico)

```sql
-- Agregar busqueda full-text
ALTER TABLE "Embedding"
ADD COLUMN fts tsvector
GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED;

CREATE INDEX ON "Embedding" USING gin(fts);

-- Funcion de busqueda hibrida
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id text,
  content text,
  score float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id,
    e.content,
    (
      -- 60% semantico + 40% keyword
      0.6 * (1 - (e."embedding" <=> query_embedding)) +
      0.4 * ts_rank(e.fts, websearch_to_tsquery('spanish', query_text))
    ) AS score
  FROM "Embedding" e
  WHERE e.fts @@ websearch_to_tsquery('spanish', query_text)
     OR 1 - (e."embedding" <=> query_embedding) > 0.3
  ORDER BY score DESC
  LIMIT match_count;
$$;
```

### Cache de Embeddings

```typescript
// Los embeddings del mismo texto son deterministicos
// Puedes cachearlos para evitar recalcular

import { unstable_cache } from 'next/cache'

export const getCachedEmbedding = unstable_cache(
  async (text: string) => generateEmbedding(text),
  ['embedding'],
  { revalidate: 3600 * 24 } // 24 horas
)
```

---

## Checklist

- [ ] Extension pgvector habilitada en PostgreSQL
- [ ] Modelos `Resource` y `Embedding` en Prisma schema
- [ ] Columna vector y funcion `match_embeddings` creadas via SQL migration
- [ ] Servicio RAG implementado (`addDocument`, `findRelevantContent`)
- [ ] Tool `getInformation` integrada al agente
- [ ] Script de indexacion funcionando
- [ ] Probado con documentos reales

---

## Siguiente Paso

Con RAG configurado, tu agente puede:
- Responder preguntas sobre documentos
- Citar fuentes de informacion
- Aprender nuevo conocimiento dinamicamente

---

*"Un agente sin conocimiento solo puede adivinar. Con RAG, puede informar."*
