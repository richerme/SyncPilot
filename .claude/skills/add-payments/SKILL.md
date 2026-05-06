---
name: add-payments
description: |
  Integra sistema de pagos con Polar (Merchant of Record) en tu proyecto Next.js + Prisma.
  Crea checkout, webhooks, base de datos y frontend completo.

  Usar cuando: "agrega pagos", "add payments", "integra Polar", "quiero cobrar",
  "checkout", "suscripciones", "webhook", "sistema de cobros", "monetizar",
  "add billing", "cobrar por mi app", "pasarela de pagos", "polar".

  Pre-requisito: /add-login (necesita auth + User model en Prisma).
  NO USAR para: Stripe directo, analytics de pagos, reportes de revenue.
allowed-tools: Bash(npm *), Bash(npx *), Read, Write, Edit, Glob, Grep
---

# Add Payments — Polar Integration

Integra un sistema de pagos completo usando Polar como Merchant of Record.
Polar corre encima de Stripe. Maneja impuestos, facturacion e IVA internacional.
Tu solo recibes dinero. No necesitas empresa constituida.

NO PREGUNTES. Ejecuta el Golden Path completo.

## Pre-requisitos

Antes de crear archivos, verifica:

1. `/add-login` ejecutado — busca `src/lib/auth.ts`. Si no existe, dile al usuario que ejecute `/add-login` primero.
2. Paquete: `npm install @polar-sh/sdk`

## Principios Criticos

- **Polar = Merchant of Record.** Ellos son el vendedor legal.
- **Polar corre encima de Stripe.** No son competidores, son capas.
- **El webhook es la fuente de verdad.** NUNCA confies en el frontend para validar pagos.
- **subscription.active = acceso.** NO des acceso en checkout.updated.
- **Idempotencia obligatoria.** El mismo webhook puede llegar multiples veces.
- **SIEMPRE .trim() en secrets.** Espacios invisibles rompen la verificacion de firma.

## Archivos a Crear

### 1. Prisma Schema Update

Add to `prisma/schema.prisma`:

```prisma
// Add hasAccess to User model
// User model already exists from add-login — add this field:
//   hasAccess Boolean @default(false)

enum PurchaseStatus {
  pending
  completed
  canceled
  refunded
}

enum BillingInterval {
  month
  year
}

model Purchase {
  id                  String          @id @default(cuid())
  userId              String
  user                User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  status              PurchaseStatus  @default(pending)
  polarCheckoutId     String?
  polarSubscriptionId String?         @unique
  polarCustomerId     String?
  priceCents          Int?
  billingInterval     BillingInterval?
  currentPeriodEnd    DateTime?
  cancelAtPeriodEnd   Boolean         @default(false)
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  @@index([userId])
  @@index([status])
}
```

Then run: `npx prisma migrate dev --name add_payments`

### 2. Polar Client

Archivo: `src/shared/lib/polar.ts`

```typescript
import { Polar } from '@polar-sh/sdk';

const isSandbox = process.env.POLAR_ENVIRONMENT === 'sandbox';

export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN?.trim(),
  server: isSandbox ? 'sandbox' : 'production',
});

// CRITICO: .trim() evita espacios invisibles que rompen verificacion de firma
export const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET?.trim() ?? '';

export const POLAR_PRODUCT_ID = process.env.POLAR_PRODUCT_ID ?? '';
```

### 3. Webhook Handler

Este es el archivo mas critico. Aqui es donde el dinero se convierte en acceso.

Archivo: `src/app/api/webhooks/polar/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
  validateEvent,
  WebhookVerificationError,
} from '@polar-sh/sdk/webhooks';
import { POLAR_WEBHOOK_SECRET } from '@/shared/lib/polar';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let event;
  try {
    event = validateEvent(body, headers, POLAR_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error('[Webhook] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 403 }
      );
    }
    throw error;
  }

  try {
    switch (event.type) {
      case 'subscription.active':
        await handleSubscriptionActive(event.data);
        break;

      case 'subscription.canceled':
      case 'subscription.revoked':
        await handleSubscriptionCanceled(event.data);
        break;

      case 'checkout.updated':
        if (event.data.status === 'succeeded') {
          await handleCheckoutSucceeded(event.data);
        }
        break;

      default:
        console.log(`[Webhook] Unhandled event: ${event.type}`);
    }
  } catch (error) {
    console.error(`[Webhook] Error handling ${event.type}:`, error);
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

// ================================================================
// AQUI es donde das acceso. NO en checkout.updated.
// ================================================================
async function handleSubscriptionActive(subscription: any) {
  const userId = subscription.metadata?.user_id;
  if (!userId) {
    console.error('[Webhook] subscription.active without user_id in metadata');
    return;
  }

  // Idempotencia: si ya procesamos este periodo, ignorar
  const existing = await prisma.purchase.findUnique({
    where: { polarSubscriptionId: subscription.id },
    select: { currentPeriodEnd: true },
  });

  if (existing?.currentPeriodEnd?.toISOString() === subscription.current_period_end) {
    console.log('[Webhook] Duplicate subscription.active, skipping');
    return;
  }

  // Crear o actualizar purchase + dar acceso en transaccion
  await prisma.$transaction([
    prisma.purchase.upsert({
      where: { polarSubscriptionId: subscription.id },
      create: {
        userId,
        status: 'completed',
        polarSubscriptionId: subscription.id,
        polarCustomerId: subscription.customer_id,
        priceCents: subscription.amount,
        billingInterval: subscription.recurring_interval,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: false,
      },
      update: {
        status: 'completed',
        polarCustomerId: subscription.customer_id,
        priceCents: subscription.amount,
        billingInterval: subscription.recurring_interval,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: false,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { hasAccess: true },
    }),
  ]);

  console.log(`[Webhook] Access granted: ${userId}`);
}

async function handleSubscriptionCanceled(subscription: any) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;

  // Verificar si tiene otra suscripcion activa antes de revocar
  const otherActive = await prisma.purchase.count({
    where: {
      userId,
      status: 'completed',
      polarSubscriptionId: { not: subscription.id },
    },
  });

  // Marcar esta suscripcion como cancelada
  await prisma.purchase.update({
    where: { polarSubscriptionId: subscription.id },
    data: { status: 'canceled' },
  });

  // Solo revocar acceso si no tiene otras suscripciones activas
  if (otherActive === 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { hasAccess: false },
    });

    console.log(`[Webhook] Access revoked: ${userId}`);
  }
}

// Solo vincula checkout_id. NO da acceso.
async function handleCheckoutSucceeded(checkout: any) {
  const userId = checkout.metadata?.user_id;
  if (!userId) return;

  await prisma.purchase.updateMany({
    where: {
      userId,
      status: 'pending',
      polarCheckoutId: null,
    },
    data: { polarCheckoutId: checkout.id },
  });

  console.log(`[Webhook] Checkout linked: ${checkout.id} -> ${userId}`);
}
```

### 5. Server Action para Checkout

Archivo: `src/features/billing/actions/checkout.ts`

```typescript
'use server';

import { auth } from '@/lib/auth';
import { polar, POLAR_PRODUCT_ID } from '@/shared/lib/polar';

export async function createCheckout() {
  const session = await auth();

  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  const user = session.user;

  try {
    const checkout = await polar.checkouts.custom.create({
      productId: POLAR_PRODUCT_ID,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
      customerEmail: user.email!,
      metadata: {
        user_id: user.id,
        product_type: 'subscription',
      },
    });

    return { url: checkout.url };
  } catch (error) {
    console.error('[Checkout] Error:', error);
    return { error: 'Failed to create checkout' };
  }
}
```

### 6. Checkout Page

Archivo: `src/app/(auth)/checkout/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCheckout } from '@/features/billing/actions/checkout';

export default function CheckoutPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleCheckout() {
    setLoading(true);
    setError('');

    const result = await createCheckout();

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result.url) {
      window.location.href = result.url;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6 text-center">
        <h1 className="text-3xl font-bold">Suscribete</h1>
        <p className="text-muted-foreground">
          Accede a todas las funcionalidades con tu suscripcion.
        </p>

        {error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full py-3 px-6 bg-primary text-primary-foreground
                     rounded-lg font-medium hover:opacity-90
                     transition-opacity disabled:opacity-50"
        >
          {loading ? 'Redirigiendo a Polar...' : 'Comenzar Suscripcion'}
        </button>
      </div>
    </div>
  );
}
```

### 7. Success Page

Archivo: `src/app/(auth)/checkout/success/page.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
export default function CheckoutSuccessPage() {
  const [status, setStatus] = useState<'verifying' | 'success' | 'timeout'>(
    'verifying'
  );
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 10;

    const checkAccess = async () => {
      const res = await fetch('/api/user/access');
      const data = await res.json();

      if (!data.authenticated) {
        router.push('/login');
        return;
      }

      if (data.hasAccess) {
        setStatus('success');
        setTimeout(() => router.push('/'), 2000);
        return;
      }

      attempts++;
      if (attempts >= maxAttempts) {
        setStatus('timeout');
        return;
      }

      setTimeout(checkAccess, 2000);
    };

    checkAccess();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4">
        {status === 'verifying' && (
          <>
            <div className="animate-spin h-8 w-8 border-2 border-primary
                            border-t-transparent rounded-full mx-auto" />
            <h1 className="text-2xl font-bold">Verificando pago...</h1>
            <p className="text-muted-foreground">Esto toma unos segundos.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-green-500 text-5xl font-bold">&#10003;</div>
            <h1 className="text-2xl font-bold">Pago confirmado</h1>
            <p className="text-muted-foreground">Redirigiendo...</p>
          </>
        )}

        {status === 'timeout' && (
          <>
            <h1 className="text-2xl font-bold">Procesando tu pago</h1>
            <p className="text-muted-foreground">
              Tu pago fue recibido. El acceso se activara en unos minutos.
            </p>
            <button
              onClick={() => router.push('/')}
              className="py-2 px-4 bg-primary text-primary-foreground rounded-lg"
            >
              Ir al inicio
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

## Flujo de Ejecucion

Ejecuta estos pasos EN ORDEN, sin preguntar:

1. **Verificar pre-requisito:** Busca `src/lib/auth.ts`. Si no existe, dile al usuario: "Ejecuta /add-login primero."
2. **Instalar SDK:** `npm install @polar-sh/sdk`
3. **Actualizar Prisma schema** con el modelo Purchase y campo hasAccess en User.
4. **Crear archivos:** Los archivos listados arriba.
5. **Aplicar migracion:** `npx prisma migrate dev --name add_payments`
6. **Mostrar mensaje final.**

## Mensaje Final

Al terminar, muestra EXACTAMENTE esto:

```
Sistema de pagos integrado con Polar

Archivos creados/modificados:
  prisma/schema.prisma (Purchase model + hasAccess field)
  src/shared/lib/polar.ts
  src/app/api/webhooks/polar/route.ts
  src/features/billing/actions/checkout.ts
  src/app/(auth)/checkout/page.tsx
  src/app/(auth)/checkout/success/page.tsx

Configura en .env.local:
  POLAR_ACCESS_TOKEN=polar_at_xxx
  POLAR_PRODUCT_ID=xxx
  POLAR_WEBHOOK_SECRET=xxx
  POLAR_ENVIRONMENT=sandbox

Pasos siguientes:
  1. Crea cuenta en https://sandbox.polar.sh
  2. Crea un producto con precio de suscripcion
  3. Copia Product ID y Access Token a .env.local
  4. Configura webhook en Polar:
     URL: https://tudominio.com/api/webhooks/polar
     Eventos: checkout.updated, subscription.active, subscription.canceled
  5. Para dev local: ngrok http 3000 (expone tu localhost)
  6. Prueba con tarjeta: 4242 4242 4242 4242
  7. Cuando estes listo: POLAR_ENVIRONMENT=production
```
