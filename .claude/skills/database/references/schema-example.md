# Ejemplo de Schema Prisma — SaaS B2B

> Schema de referencia para un SaaS tipico con auth, tenants, y features de negocio.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// Auth.js v5 — Modelos requeridos
// ============================================

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  role          Role      @default(USER)
  accounts      Account[]
  sessions      Session[]
  tenants       TenantMember[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Account {
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([provider, providerAccountId])
}

model Session {
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model VerificationToken {
  identifier String
  token      String
  expires    DateTime

  @@id([identifier, token])
}

// ============================================
// App — Multi-tenant SaaS
// ============================================

enum Role {
  USER
  ADMIN
}

enum TenantRole {
  OWNER
  ADMIN
  MEMBER
}

model Tenant {
  id        String         @id @default(cuid())
  name      String
  slug      String         @unique
  members   TenantMember[]
  projects  Project[]
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
}

model TenantMember {
  id        String     @id @default(cuid())
  userId    String
  tenantId  String
  role      TenantRole @default(MEMBER)
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant    Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdAt DateTime   @default(now())

  @@unique([userId, tenantId])
  @@index([tenantId])
}

model Project {
  id          String   @id @default(cuid())
  name        String
  description String?
  status      String   @default("active")
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  tasks       Task[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tenantId])
}

model Task {
  id          String    @id @default(cuid())
  title       String
  description String?
  status      String    @default("pending")
  priority    Int       @default(0)
  dueDate     DateTime?
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([projectId])
  @@index([status])
}
```

## Notas

- Los modelos `User`, `Account`, `Session`, `VerificationToken` son requeridos por Auth.js
- `Tenant` + `TenantMember` implementan multi-tenancy basico
- Todos los modelos de negocio deben tener `@@index` en sus foreign keys
- `onDelete: Cascade` asegura limpieza automatica al eliminar el padre
