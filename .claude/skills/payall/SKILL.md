---
name: payall
description: |
  Configura TODOS los pagos de un funnel de ventas con Polar (Merchant of Record).
  Implementa 6 productos en 3 grupos: (1) Producto Principal one-time, (2) Pack Premium
  con upsell-1 one-time y downsell-1 one-time, (3) SaaS App con suscripciones anuales
  y mensuales (upsell-2, downsell-2, monthly). Crea checkouts, webhook handler con soporte
  de pagos unicos Y suscripciones, modelo Prisma Purchase y PolarCheckoutButton reutilizable.

  Stack: Next.js + Prisma + PostgreSQL + Auth.js v5. NO usa Supabase.

  Activar cuando: "configura todos los pagos", "conectar pagos del funnel", "payall",
  "integrar polar completo", "activar cobros del funnel", "conectar checkouts del funnel".

  Pre-requisito: auth implementada — User tiene flags hasUpsell1/Downsell1/Upsell2/Downsell2.
  NO USAR para: un solo producto aislado (usar /add-payments), analytics, reportes.
allowed-tools: Bash(npm *), Bash(npx *), Read, Write, Edit, Glob, Grep
---

# Skill PayAll — Pagos Completos del Funnel de Ventas con Polar

Configura 6 productos en Polar organizados en 3 grupos para un funnel de ventas completo.
Soporta pagos unicos (one-time) Y suscripciones. Conecta cada boton de cada pagina del funnel.

NO PREGUNTES. Lee BUSINESS_LOGIC.md primero para extraer nombres y precios del proyecto.
Luego ejecuta el Golden Path completo.

## Paso 0 — Identificar los Productos del Proyecto

Antes de escribir codigo, leer `BUSINESS_LOGIC.md` (o preguntar al usuario si no existe) para
extraer los nombres reales de los 6 productos:

| Grupo | Clave | Precio base | Tipo |
|-------|-------|-------------|------|
| Producto Principal | `main` | $7 | one-time |
| Pack Premium | `upsell1` | $27 | one-time |
| Pack Premium (oferta) | `downsell1` | $17 | one-time |
| SaaS App (anual) | `upsell2` | $49/año | subscription |
| SaaS App (mensual economico) | `downsell2` | $7/mes | subscription |
| SaaS App (mensual normal) | `monthly` | $9/mes | subscription |

Flujo del funnel:
`/ (home)` → compra `main` → `/upsell-1` → acepta (`upsell1`) o rechaza → `/downsell-1`
→ acepta (`downsell1`) o rechaza → `/upsell-2` → acepta (`upsell2`) o rechaza → `/downsell-2`
→ acepta (`downsell2`) → `/gracias`

## Mapa de Productos

| # | Producto | Precio | Tipo | Paginas | Env Var |
|---|----------|--------|------|---------|----------|
| 1 | [MAIN_NAME] | $7 | one-time | `/` | `POLAR_PRODUCT_ID_MAIN` |
| 2 | [PACK_PREMIUM_NAME] | $27 | one-time | `/upsell-1`, `/upsell-1-acceso` | `POLAR_PRODUCT_ID_UPSELL1` |
| 3 | [PACK_PREMIUM_NAME] (oferta) | $17 | one-time | `/downsell-1` | `POLAR_PRODUCT_ID_DOWNSELL1` |
| 4 | [SAAS_NAME] (anual) | $49/año | subscription | `/upsell-2`, `/upsell-2-acceso` | `POLAR_PRODUCT_ID_UPSELL2` |
| 5 | [SAAS_NAME] (mensual) | $7/mes | subscription | `/downsell-2` | `POLAR_PRODUCT_ID_DOWNSELL2` |
| 6 | [SAAS_NAME] (mensual normal) | $9/mes | subscription | `/upsell-2-acceso` | `POLAR_PRODUCT_ID_MONTHLY` |

## Pre-requisitos

1. Modelo `User` con flags `hasUpsell1`, `hasDownsell1`, `hasUpsell2`, `hasDownsell2`
   y timestamps `*PurchasedAt`. Verificar en `prisma/schema.prisma`.
2. SDK instalado: `npm install @polar-sh/sdk`.
3. `.env.local` con `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_ENVIRONMENT`,
   y las 6 vars `POLAR_PRODUCT_ID_*`.

## Principios Criticos

- **Polar = Merchant of Record.** Ellos son el vendedor legal.
- **El webhook es la fuente de verdad.** NUNCA confies en el frontend para validar pagos.
- **Pagos unicos: dar acceso en `checkout.updated` (status=succeeded).**
- **Suscripciones: dar acceso en `subscription.active`, NO en checkout.updated.**
- **Idempotencia obligatoria.** Mismo webhook puede llegar varias veces. Usar `polarCheckoutId`/`polarSubscriptionId` UNIQUE.
- **SIEMPRE `.trim()` en secrets.** Espacios invisibles rompen la verificacion de firma.
- **El funnel es para usuarios NO autenticados.** Los checkouts NO requieren auth.

## Archivos a Crear/Modificar

### 1. `.env.local`

```env
POLAR_ACCESS_TOKEN=polar_oat_xxx
POLAR_WEBHOOK_SECRET=polar_whs_xxx
POLAR_ENVIRONMENT=sandbox

# Grupo 1: Producto Principal
POLAR_PRODUCT_ID_MAIN=<id-desde-polar-dashboard>

# Grupo 2: Pack Premium
POLAR_PRODUCT_ID_UPSELL1=<id-desde-polar-dashboard>
POLAR_PRODUCT_ID_DOWNSELL1=<id-desde-polar-dashboard>

# Grupo 3: SaaS App (suscripciones)
POLAR_PRODUCT_ID_UPSELL2=<id-desde-polar-dashboard>
POLAR_PRODUCT_ID_DOWNSELL2=<id-desde-polar-dashboard>
POLAR_PRODUCT_ID_MONTHLY=<id-desde-polar-dashboard>

NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 2. `src/lib/polar.ts`

```typescript
import { Polar } from "@polar-sh/sdk";

export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN?.trim(),
  server: process.env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
});

export const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET?.trim() ?? "";

// Rellenar con los nombres/precios reales del proyecto (leer BUSINESS_LOGIC.md)
export const PRODUCTS = {
  // Grupo 1: Producto Principal
  main: {
    id: process.env.POLAR_PRODUCT_ID_MAIN ?? "",
    name: "[MAIN_NAME]",       // ej. "El Plan de Accion Diario"
    price: 700,                 // cents ($7)
    type: "one_time" as const,
  },
  // Grupo 2: Pack Premium
  upsell1: {
    id: process.env.POLAR_PRODUCT_ID_UPSELL1 ?? "",
    name: "[PACK_PREMIUM_NAME]",  // ej. "Sistema de Control de Vida"
    price: 2700,                   // cents ($27)
    type: "one_time" as const,
  },
  downsell1: {
    id: process.env.POLAR_PRODUCT_ID_DOWNSELL1 ?? "",
    name: "[PACK_PREMIUM_NAME] (oferta)",
    price: 1700,                   // cents ($17)
    type: "one_time" as const,
  },
  // Grupo 3: SaaS App (suscripciones)
  upsell2: {
    id: process.env.POLAR_PRODUCT_ID_UPSELL2 ?? "",
    name: "[SAAS_NAME] (anual)",   // ej. "My App (anual)"
    price: 4900,                    // cents ($49)
    type: "subscription" as const,
    interval: "year",
  },
  downsell2: {
    id: process.env.POLAR_PRODUCT_ID_DOWNSELL2 ?? "",
    name: "[SAAS_NAME] (mensual economico)",
    price: 700,                     // cents ($7)
    type: "subscription" as const,
    interval: "month",
  },
  monthly: {
    id: process.env.POLAR_PRODUCT_ID_MONTHLY ?? "",
    name: "[SAAS_NAME] (mensual)",
    price: 900,                     // cents ($9)
    type: "subscription" as const,
    interval: "month",
  },
} as const;

export type ProductKey = keyof typeof PRODUCTS;

export function getProductKeyById(productId: string): ProductKey | null {
  for (const [key, p] of Object.entries(PRODUCTS)) {
    if (p.id === productId) return key as ProductKey;
  }
  return null;
}

// Flag y timestamp por producto en User
// 'main' no tiene flag — acceso libre tras la compra (cuenta creada via webhook)
export const PRODUCT_USER_FIELDS: Record<
  ProductKey,
  { flag?: "hasUpsell1" | "hasDownsell1" | "hasUpsell2" | "hasDownsell2";
    timestampField?: "upsell1PurchasedAt" | "downsell1PurchasedAt" | "upsell2PurchasedAt" | "downsell2PurchasedAt"; }
> = {
  main:      {},
  upsell1:   { flag: "hasUpsell1",   timestampField: "upsell1PurchasedAt" },
  downsell1: { flag: "hasDownsell1", timestampField: "downsell1PurchasedAt" },
  upsell2:   { flag: "hasUpsell2",   timestampField: "upsell2PurchasedAt" },
  downsell2: { flag: "hasDownsell2", timestampField: "downsell2PurchasedAt" },
  monthly:   { flag: "hasUpsell2",   timestampField: "upsell2PurchasedAt" },
};
```

### 3. `prisma/schema.prisma` — Modelo Purchase

```prisma
model Purchase {
  id                String   @id @default(cuid())
  userId            String?
  user              User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  customerEmail     String
  customerName      String?
  productKey        String   // 'main' | 'upsell1' | 'downsell1' | 'upsell2' | 'downsell2' | 'monthly'
  productName       String?
  status            String   @default("pending") // 'pending' | 'completed' | 'canceled' | 'refunded'
  paymentType       String   @default("one_time") // 'one_time' | 'subscription'
  polarSubscriptionId String? @unique
  billingInterval   String?  // 'month' | 'year'
  currentPeriodEnd  DateTime?
  cancelAtPeriodEnd Boolean  @default(false)
  polarCheckoutId   String?  @unique
  polarOrderId      String?
  polarCustomerId   String?
  priceCents        Int?
  currency          String?
  metadata          Json?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([userId, createdAt])
  @@index([customerEmail])
  @@index([productKey])
  @@index([status])
}
```

Anadir relacion inversa en el modelo `User`:
```prisma
purchases  Purchase[]
```

### 4. `src/app/api/checkout/create/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { polar, PRODUCTS, type ProductKey } from "@/lib/polar";

const VALID_KEYS = Object.keys(PRODUCTS) as ProductKey[];
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const SUCCESS_URLS: Record<ProductKey, string> = {
  main:      `${BASE}/upsell-1`,
  upsell1:   `${BASE}/upsell-2`,
  downsell1: `${BASE}/upsell-2`,
  upsell2:   `${BASE}/gracias`,
  downsell2: `${BASE}/gracias`,
  monthly:   `${BASE}/gracias`,
};

export async function POST(req: NextRequest) {
  try {
    const { productKey, name, email } = await req.json();

    if (!productKey || !VALID_KEYS.includes(productKey)) {
      return NextResponse.json({ error: "Invalid product key" }, { status: 400 });
    }

    const product = PRODUCTS[productKey as ProductKey];
    if (!product.id) {
      return NextResponse.json({ error: "Product not configured" }, { status: 500 });
    }

    const checkout = await polar.checkouts.create({
      products: [product.id],
      successUrl: SUCCESS_URLS[productKey as ProductKey],
      ...(email && { customerEmail: email }),
      ...(name && { customerName: name }),
      metadata: { product_key: productKey, source: "funnel" },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    console.error("[Checkout]", err);
    return NextResponse.json({ error: "Failed to create checkout" }, { status: 500 });
  }
}
```

### 5. `src/app/api/webhooks/polar/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { prisma } from "@/lib/db";
import { POLAR_WEBHOOK_SECRET, PRODUCTS, PRODUCT_USER_FIELDS, getProductKeyById } from "@/lib/polar";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  let event: any;
  try {
    event = validateEvent(body, headers, POLAR_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }
    throw err;
  }

  try {
    switch (event.type) {
      case "checkout.updated":
        if (event.data.status === "succeeded") await handleCheckout(event.data);
        break;
      case "subscription.active":
        await handleSubscriptionActive(event.data);
        break;
      case "subscription.canceled":
      case "subscription.revoked":
        await handleSubscriptionCanceled(event.data);
        break;
      case "order.created":
        if (event.data.checkout_id) {
          await prisma.purchase.updateMany({
            where: { polarCheckoutId: event.data.checkout_id },
            data: { polarOrderId: event.data.id, status: "completed" },
          });
        }
        break;
      default:
        console.log(`[Webhook/polar] Unhandled: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Webhook/polar] Error on ${event.type}:`, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckout(checkout: any) {
  const productKey = getProductKeyById(checkout.product_id);
  if (!productKey) return;

  const product = PRODUCTS[productKey];
  const isOneTime = product.type === "one_time";

  // Idempotencia
  const existing = await prisma.purchase.findUnique({
    where: { polarCheckoutId: checkout.id },
  });
  if (existing) return;

  const email = (checkout.customer_email || "").toLowerCase();
  const name = checkout.customer_name ?? null;
  const product = PRODUCTS[productKey];

  // Resolver o crear usuario
  let userId: string | null = null;
  let isNewUser = false;

  const byMeta = checkout.metadata?.user_id
    ? await prisma.user.findUnique({ where: { id: checkout.metadata.user_id }, select: { id: true } })
    : null;

  if (byMeta) {
    userId = byMeta.id;
  } else if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (byEmail) {
      userId = byEmail.id;
    } else {
      const created = await prisma.user.create({
        data: { email, name: name ?? email.split("@")[0] },
        select: { id: true },
      });
      userId = created.id;
      isNewUser = true;
    }
  }

  await prisma.purchase.create({
    data: {
      userId,
      customerEmail: email,
      customerName: name,
      productKey,
      productName: product.name,
      status: isOneTime ? "completed" : "pending",
      paymentType: product.type,
      polarCheckoutId: checkout.id,
      polarCustomerId: checkout.customer_id ?? null,
      priceCents: checkout.amount ?? product.price,
      currency: checkout.currency ?? "USD",
      metadata: (checkout.metadata ?? {}) as never,
    },
  });

  // Aplicar flag al User
  if (userId) {
    const fields = PRODUCT_USER_FIELDS[productKey];
    if (fields.flag && fields.timestampField) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { [fields.timestampField]: true } as any,
      });
      if (user && !(user as any)[fields.timestampField]) {
        await prisma.user.update({
          where: { id: userId },
          data: { [fields.flag]: true, [fields.timestampField]: new Date() },
        });
      }
    }
  }

  console.log(`[Webhook/polar] Processed ${productKey} for ${email} (new=${isNewUser})`);
}

async function handleSubscriptionActive(subscription: any) {
  const productKey = getProductKeyById(subscription.product_id);
  if (!productKey) return;
  const email = (subscription.customer?.email || subscription.metadata?.email || "").toLowerCase();
  const name = subscription.customer?.name ?? null;

  const existing = await prisma.purchase.findUnique({ where: { polarSubscriptionId: subscription.id } });
  if (existing?.currentPeriodEnd?.toISOString() === subscription.current_period_end) return;

  const { userId } = await resolveOrCreateUser({ email, customerName: name });

  await prisma.purchase.upsert({
    where: { polarSubscriptionId: subscription.id },
    create: {
      userId, customerEmail: email, customerName: name,
      productKey, productName: PRODUCTS[productKey].name,
      status: "completed", paymentType: "subscription",
      polarSubscriptionId: subscription.id,
      polarCustomerId: subscription.customer_id ?? null,
      priceCents: subscription.amount,
      currency: subscription.currency ?? "USD",
      billingInterval: subscription.recurring_interval ?? null,
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
      cancelAtPeriodEnd: false,
    },
    update: {
      status: "completed",
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
      cancelAtPeriodEnd: false,
    },
  });

  if (userId) await applyProductFlag(userId, productKey);
  console.log(`[Webhook/polar] Subscription active: ${productKey} for ${email}`);
}

async function handleSubscriptionCanceled(subscription: any) {
  const purchase = await prisma.purchase.findUnique({ where: { polarSubscriptionId: subscription.id } });
  await prisma.purchase.updateMany({
    where: { polarSubscriptionId: subscription.id },
    data: { status: "canceled", cancelAtPeriodEnd: true },
  });
  const userId = purchase?.userId ?? null;
  if (!userId) return;

  const otherActive = await prisma.purchase.findFirst({
    where: { userId, paymentType: "subscription", status: "completed",
      polarSubscriptionId: { not: subscription.id },
      productKey: { in: ["upsell2", "downsell2", "monthly"] },
    },
  });
  if (!otherActive) {
    await prisma.user.update({ where: { id: userId }, data: { hasUpsell2: false, hasDownsell2: false } });
    console.log(`[Webhook/polar] App access revoked: ${userId}`);
  }
}

async function resolveOrCreateUser(args: { email: string; customerName?: string | null; metadataUserId?: string }) {
  const { email, customerName, metadataUserId } = args;
  if (metadataUserId) {
    const u = await prisma.user.findUnique({ where: { id: metadataUserId }, select: { id: true } });
    if (u) return { userId: u.id, isNewUser: false };
  }
  if (!email) return { userId: null, isNewUser: false };
  const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (byEmail) return { userId: byEmail.id, isNewUser: false };
  const created = await prisma.user.create({
    data: { email, name: customerName ?? email.split("@")[0] }, select: { id: true },
  });
  return { userId: created.id, isNewUser: true };
}

async function applyProductFlag(userId: string, productKey: ProductKey) {
  const fields = PRODUCT_USER_FIELDS[productKey];
  if (!fields.flag || !fields.timestampField) return;
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { [fields.timestampField]: true } as any,
  });
  if (user && !(user as any)[fields.timestampField]) {
    await prisma.user.update({ where: { id: userId }, data: { [fields.flag]: true, [fields.timestampField]: new Date() } });
  }
}
```

### 6. `src/features/checkout/components/polar-checkout-button.tsx`

```tsx
"use client";
import { useState } from "react";

interface Props {
  productKey: string;
  name?: string;
  email?: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function PolarCheckoutButton({ productKey, name, email, children, className = "", disabled = false }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/checkout/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey, name, email }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleClick} disabled={disabled || loading} className={className}>
      {loading ? "Redirigiendo..." : children}
    </button>
  );
}
```

## Flujo de Ejecucion

Ejecuta EN ORDEN, sin preguntar:

1. **Leer BUSINESS_LOGIC.md** — extraer los 6 productos (nombres reales) y el flujo del funnel.
2. **Instalar SDK:** `npm install @polar-sh/sdk`
3. **Actualizar `.env.local`** con las 6 vars `POLAR_PRODUCT_ID_*` + token/secret/environment.
4. **Actualizar `prisma/schema.prisma`** — agregar modelo `Purchase` (con `polarSubscriptionId`, `billingInterval`, `currentPeriodEnd`, `cancelAtPeriodEnd`) + relacion `purchases` en `User`.
5. **Sincronizar BD:** `npx prisma db push --accept-data-loss`
6. **Crear `src/lib/polar.ts`** — rellenar nombres reales de BUSINESS_LOGIC.md en los 6 productos.
7. **Crear `src/app/api/checkout/create/route.ts`** — ajustar `SUCCESS_URLS` segun las rutas del proyecto.
8. **Crear `src/app/api/webhooks/polar/route.ts`** — incluye handlers para checkout, subscription.active, subscription.canceled/revoked, order.created.
9. **Crear `PolarCheckoutButton`** en `src/features/checkout/components/`
10. **Actualizar paginas del funnel:**
    - `/` (home) — `<PolarCheckoutButton productKey="main">`
    - `/upsell-1` y `/upsell-1-acceso` — `productKey="upsell1"`
    - `/downsell-1` — `productKey="downsell1"`
    - `/upsell-2` — `productKey="upsell2"` (anual)
    - `/upsell-2-acceso` — `productKey="upsell2"` (anual) y `productKey="monthly"` (mensual $9)
    - `/downsell-2` — `productKey="downsell2"`
11. **Typecheck:** `npx tsc --noEmit`
12. **Mostrar mensaje final.**

## Mensaje Final

```
Sistema de pagos completo con Polar (Merchant of Record)

6 productos configurados:
  Grupo 1 — Producto Principal:
    1. [MAIN_NAME]               — $7    one-time   (/)

  Grupo 2 — Pack Premium:
    2. [PACK_PREMIUM_NAME]        — $27   one-time   (/upsell-1, /upsell-1-acceso)
    3. [PACK_PREMIUM_NAME] oferta — $17   one-time   (/downsell-1)

  Grupo 3 — SaaS App:
    4. [SAAS_NAME] (anual)        — $49/ano sub      (/upsell-2, /upsell-2-acceso)
    5. [SAAS_NAME] (mensual)      — $7/mes sub       (/downsell-2)
    6. [SAAS_NAME] (mensual)      — $9/mes sub       (/upsell-2-acceso)

Archivos creados/modificados:
  .env.local (6 Product IDs de Polar)
  prisma/schema.prisma (modelo Purchase completo + relacion en User)
  src/lib/polar.ts
  src/app/api/checkout/create/route.ts
  src/app/api/webhooks/polar/route.ts
  src/features/checkout/components/polar-checkout-button.tsx
  [paginas del funnel actualizadas con PolarCheckoutButton]

Webhook configurado para:
  checkout.updated, subscription.active, subscription.canceled,
  subscription.revoked, order.created

Flags del User:
  hasUpsell1   <- upsell1 o downsell1 completado
  hasDownsell1 <- downsell1 completado
  hasUpsell2   <- upsell2, downsell2 o monthly (cualquier sub activa)
  hasDownsell2 <- downsell2 o monthly

Pasos siguientes:
  1. Crear los 6 productos en Polar Dashboard (sandbox primero)
  2. Copiar los 6 Product IDs al .env.local
  3. Configurar webhook en Polar Dashboard:
       URL: https://[tu-dominio]/api/webhooks/polar
       Eventos: checkout.updated, subscription.active, subscription.canceled,
                subscription.revoked, order.created
  4. Dev local: npx polar listen --forward http://localhost:3000/api/webhooks/polar
  5. Prueba con tarjeta: 4242 4242 4242 4242
  6. Cuando estes listo: POLAR_ENVIRONMENT=production
```
