---
name: database
description: "Todo lo relacionado con la base de datos: crear modelos Prisma, migraciones, queries, relaciones, indices, y operaciones CRUD. Activar cuando el usuario dice: necesito una tabla, crear modelo, base de datos, guardar datos, relaciones, migracion, query, o cualquier operacion de BD."
allowed-tools: Read, Write, Edit, Bash
---

# Database: Prisma + PostgreSQL

Gestiona todo lo relacionado con la base de datos usando Prisma ORM y PostgreSQL.

**NO preguntes. Ejecuta el patron correcto.**

---

## Setup Inicial

### PostgreSQL Local (desarrollo)

```bash
# Levantar PostgreSQL con Docker Compose
docker compose up -d

# Verificar conexion
npx prisma db push
```

### Variables de Entorno

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/myapp?schema=public"
```

En produccion (Coolify), la `DATABASE_URL` apunta a la base de datos PostgreSQL creada en Coolify.

---

## Schema Prisma (prisma/schema.prisma)

### Patron: Agregar un Modelo

```prisma
model Product {
  id          String   @id @default(cuid())
  name        String
  description String?
  price       Float
  active      Boolean  @default(true)
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId])
}
```

### Relaciones Comunes

```prisma
// One-to-Many
model User {
  id       String    @id @default(cuid())
  posts    Post[]
}

model Post {
  id       String @id @default(cuid())
  userId   String
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

// Many-to-Many
model Post {
  id         String     @id @default(cuid())
  categories Category[]
}

model Category {
  id    String @id @default(cuid())
  name  String @unique
  posts Post[]
}

// One-to-One
model User {
  id      String   @id @default(cuid())
  profile Profile?
}

model Profile {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### Tipos de Campo

| Prisma | PostgreSQL | Uso |
|--------|-----------|-----|
| `String` | `TEXT` | Texto |
| `Int` | `INTEGER` | Numeros enteros |
| `Float` | `DOUBLE PRECISION` | Decimales |
| `Boolean` | `BOOLEAN` | Si/No |
| `DateTime` | `TIMESTAMP(3)` | Fechas |
| `Json` | `JSONB` | Objetos complejos |
| `Enum` | `ENUM` | Valores fijos |

---

## Comandos Prisma

```bash
# Desarrollo: crear migracion + aplicar + regenerar cliente
npx prisma migrate dev --name nombre_descriptivo

# Produccion: solo aplicar migraciones pendientes
npx prisma migrate deploy

# Regenerar cliente (despues de cambiar schema)
npx prisma generate

# Push rapido sin migracion (solo dev, pierde datos)
npx prisma db push

# UI visual para explorar/editar datos
npx prisma studio

# Reset completo (DESTRUCTIVO)
npx prisma migrate reset
```

---

## Operaciones CRUD

### Crear

```typescript
import { prisma } from '@/lib/db'

// Crear uno
const user = await prisma.user.create({
  data: { email: 'user@example.com', name: 'Juan' },
})

// Crear con relaciones
const post = await prisma.post.create({
  data: {
    title: 'Mi Post',
    userId: user.id,
    categories: { connect: [{ id: 'cat1' }] },
  },
  include: { categories: true },
})

// Crear muchos
await prisma.user.createMany({
  data: [
    { email: 'a@example.com', name: 'A' },
    { email: 'b@example.com', name: 'B' },
  ],
})
```

### Leer

```typescript
// Uno por ID
const user = await prisma.user.findUnique({ where: { id: 'xxx' } })

// Listar con filtros
const users = await prisma.user.findMany({
  where: { active: true },
  orderBy: { createdAt: 'desc' },
  take: 10,
  skip: 0,
})

// Con relaciones
const user = await prisma.user.findUnique({
  where: { id: 'xxx' },
  include: { posts: true, profile: true },
})

// Contar
const count = await prisma.user.count({ where: { active: true } })
```

### Filtros

```typescript
where: { active: true, role: 'ADMIN' }                    // AND
where: { OR: [{ email: { contains: 'gmail' } }] }         // OR
where: { name: { contains: 'juan', mode: 'insensitive' } } // Case insensitive
where: { price: { gte: 10, lte: 100 } }                   // Rango
where: { role: { in: ['ADMIN', 'MOD'] } }                  // En lista
where: { deletedAt: null }                                  // Nulo
where: { posts: { some: { published: true } } }            // Por relacion
```

### Actualizar

```typescript
const user = await prisma.user.update({
  where: { id: 'xxx' },
  data: { name: 'Nuevo Nombre' },
})

// Upsert
const user = await prisma.user.upsert({
  where: { email: 'user@example.com' },
  update: { name: 'Actualizado' },
  create: { email: 'user@example.com', name: 'Nuevo' },
})
```

### Eliminar

```typescript
await prisma.user.delete({ where: { id: 'xxx' } })
await prisma.user.deleteMany({ where: { active: false } })
```

---

## Transacciones

```typescript
const result = await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { email: 'a@b.com', name: 'A' } })
  const post = await tx.post.create({ data: { title: 'Post', userId: user.id } })
  return { user, post }
})
```

---

## Patron: Server Action con Prisma

```typescript
'use server'

import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { z } from 'zod'

const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  price: z.number().positive(),
})

export async function createProduct(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: 'No autenticado' }

  const parsed = CreateProductSchema.safeParse({
    name: formData.get('name'),
    price: Number(formData.get('price')),
  })

  if (!parsed.success) return { error: parsed.error.flatten() }

  const product = await prisma.product.create({
    data: { ...parsed.data, userId: session.user.id },
  })

  return { success: true, product }
}
```

---

## Principios

- **Siempre migraciones**: `npx prisma migrate dev` para cada cambio de schema
- **Indices**: Agregar `@@index` en campos que se usan para filtrar/ordenar
- **onDelete: Cascade**: En relaciones donde el hijo no tiene sentido sin el padre
- **Validacion con Zod**: Siempre validar datos de usuario antes de pasar a Prisma
- **Transacciones**: Para operaciones que deben ser atomicas
- **No SQL manual**: Usar Prisma client para todo. SQL raw solo para queries de metricas

## Workflow

1. **Definir modelo** en `prisma/schema.prisma`
2. **Crear migracion**: `npx prisma migrate dev --name add_products`
3. **Implementar CRUD** en Server Actions
4. **Validar** con Zod
5. **Verificar** con `npx prisma studio`
