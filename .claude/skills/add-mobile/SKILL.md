---
name: add-mobile
description: |
  Convierte tu Next.js en PWA instalable + sistema de notificaciones push completo.
  Service worker, manifest, VAPID keys, subscribe/unsubscribe, iOS compatibility.

  Usar cuando: "agrega PWA", "add PWA", "notificaciones push", "push notifications",
  "instalar en telefono", "app movil", "mobile", "service worker", "manifest",
  "hacer instalable", "notificaciones", "VAPID", "web push".

  Pre-requisito: /add-login (necesita User model en Prisma).
  NO USAR para: emails (usar /add-emails), app nativa (React Native/Flutter).
allowed-tools: Bash(npm *), Bash(npx *), Bash(npx web-push *), Read, Write, Edit, Glob, Grep
---

# Add Mobile — PWA + Push Notifications

Convierte tu web en una app instalable con notificaciones push.
Sin App Store. Sin Google Play. Sin pagar $99/año a Apple.

Este skill viene de 14 commits de debugging en produccion.
Todos los gotchas de iOS Safari ya estan resueltos.

NO PREGUNTES. Ejecuta el Golden Path completo.

## Pre-requisitos

1. `/add-login` ejecutado — busca `src/lib/auth.ts`.
2. Paquetes: `npm install web-push`

## Principios Criticos

- **NO instales next-pwa, Serwist, ni Workbox.** Hazlo manual. Los paquetes rompen iOS.
- **El Service Worker NUNCA intercepta fetch.** Esto rompe iOS Safari PWA. Solo push + cache cleanup.
- **Usa window.location.origin para registrar el SW.** iOS rechaza redirects 307.
- **PWARegister DEBE estar en el layout.** Si se remueve, todo deja de funcionar silenciosamente.
- **VAPID keys se generan UNA VEZ** y se guardan en .env. No regenerar.
- **Apple falla silenciosamente.** Endpoints de Apple no retornan statusCode en errores. Detectar y limpiar.

## Archivos a Crear

### 1. Prisma Schema Update

Add to `prisma/schema.prisma`:

```prisma
model PushSubscription {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint   String
  p256dh     String
  auth       String
  deviceName String?
  browser    String?
  userAgent  String?
  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())

  @@unique([userId, endpoint])
  @@index([userId])
  @@index([endpoint])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String
  title     String
  body      String?
  data      Json     @default("{}")
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId, createdAt(sort: Desc)])
}
```

Then run: `npx prisma migrate dev --name add_push_notifications`

### 2. PWA Manifest

Archivo: `public/manifest.json`

Reemplaza nombre, colores e iconos con los de la app del usuario.

```json
{
  "name": "My App",
  "short_name": "MyApp",
  "description": "Mi aplicacion",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "lang": "es",
  "icons": [
    { "src": "/icons/icon-72.png", "sizes": "72x72", "type": "image/png" },
    { "src": "/icons/icon-96.png", "sizes": "96x96", "type": "image/png" },
    { "src": "/icons/icon-128.png", "sizes": "128x128", "type": "image/png" },
    { "src": "/icons/icon-144.png", "sizes": "144x144", "type": "image/png" },
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

NOTA: El usuario debe crear los iconos en `public/icons/`. Pueden generarse desde un PNG de 512x512.

### 3. Service Worker

Archivo: `public/sw.js`

```javascript
// Service Worker v1.0
// CRITICO: NO incluir fetch handler (rompe iOS Safari PWA)

const CACHE_NAME = 'app-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Push: recibir notificacion del servidor
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Notificacion', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Notificacion', {
      body: payload.body || '',
      icon: payload.icon || '/icons/icon-192.png',
      badge: payload.badge || '/icons/icon-72.png',
      data: payload.data || {},
      tag: payload.tag,
      requireInteraction: payload.requireInteraction || false,
    })
  );
});

// Click: navegar a la URL de la notificacion
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

// Update: forzar activacion de nueva version
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Auto-reactivar si el browser invalida la suscripcion push
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription?.options || {
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      })
      .then((newSub) =>
        fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: newSub.toJSON(),
            oldEndpoint: event.oldSubscription?.endpoint,
          }),
        })
      )
  );
});
```

### 4. PWA Register Component

Archivo: `src/components/PWARegister.tsx`

```tsx
'use client';

import { useEffect } from 'react';

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // CRITICO: usar window.location.origin (iOS rechaza redirects 307)
    const swUrl = `${window.location.origin}/sw.js`;

    navigator.serviceWorker
      .register(swUrl, { scope: '/' })
      .then((registration) => {
        // Verificar updates cada 60 minutos
        setInterval(() => registration.update(), 60 * 60 * 1000);

        // Forzar activacion de nueva version
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'activated' &&
              navigator.serviceWorker.controller
            ) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
              setTimeout(() => window.location.reload(), 1000);
            }
          });
        });
      })
      .catch((err) => console.error('[PWA] Registration failed:', err));
  }, []);

  return null;
}
```

### 5. Push Subscription Hook

Archivo: `src/features/notifications/hooks/usePushSubscription.ts`

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';

interface UsePushSubscriptionReturn {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  loading: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushSubscription(userId?: string): UsePushSubscriptionReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window;

    setIsSupported(supported);

    if (!supported) {
      setLoading(false);
      return;
    }

    setPermission(Notification.permission);

    // Check existing subscription
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
        setLoading(false);
      });
    });
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported) return;
    setLoading(true);

    try {
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);

      if (currentPermission !== 'granted') {
        setLoading(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      // Convertir VAPID key de base64url a Uint8Array
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4);
      const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      const applicationServerKey = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        applicationServerKey[i] = rawData.charCodeAt(i);
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Registrar en servidor
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userId,
          deviceInfo: {
            platform: navigator.platform,
            language: navigator.language,
          },
        }),
      });

      setIsSubscribed(true);
    } catch (err) {
      console.error('[Push] Subscribe failed:', err);
    }

    setLoading(false);
  }, [isSupported, userId]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        await fetch('/api/notifications/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }

      setIsSubscribed(false);
    } catch (err) {
      console.error('[Push] Unsubscribe failed:', err);
    }
    setLoading(false);
  }, []);

  return { isSupported, permission, isSubscribed, loading, subscribe, unsubscribe };
}
```

### 6. Push Notification Prompt

Archivo: `src/features/notifications/components/PushNotificationPrompt.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import { usePushSubscription } from '../hooks/usePushSubscription';

interface PushNotificationPromptProps {
  userId?: string;
  autoShowDelay?: number;
}

export function PushNotificationPrompt({
  userId,
  autoShowDelay = 3000,
}: PushNotificationPromptProps) {
  const { isSupported, permission, isSubscribed, subscribe } =
    usePushSubscription(userId);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isSupported || isSubscribed || permission === 'denied') return;

    const dismissed = localStorage.getItem('push-prompt-dismissed');
    if (dismissed) return;

    const timer = setTimeout(() => setShow(true), autoShowDelay);
    return () => clearTimeout(timer);
  }, [isSupported, isSubscribed, permission, autoShowDelay]);

  if (!show) return null;

  const handleEnable = async () => {
    localStorage.setItem('push-prompt-dismissed', 'true');
    await subscribe();
    setShow(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('push-prompt-dismissed', 'true');
    setShow(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-card border
                    border-border rounded-lg p-4 shadow-lg space-y-3">
      <p className="text-sm font-medium">Activar notificaciones?</p>
      <p className="text-xs text-muted-foreground">
        Recibe avisos importantes incluso cuando no tengas la app abierta.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleEnable}
          className="px-3 py-1.5 text-xs bg-primary text-primary-foreground
                     rounded-md hover:opacity-90"
        >
          Activar
        </button>
        <button
          onClick={handleDismiss}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
```

### 7. Subscribe API Route

Archivo: `src/app/api/notifications/subscribe/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { subscription, userId, deviceInfo, oldEndpoint } = await request.json();

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    // Si es un cambio de suscripcion, eliminar la anterior
    if (oldEndpoint) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint: oldEndpoint },
      });
    }

    // Check si ya existe
    const existing = await prisma.pushSubscription.findFirst({
      where: { endpoint: subscription.endpoint },
      select: { id: true },
    });

    if (existing) {
      await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: { lastUsedAt: new Date() },
      });

      return NextResponse.json({ success: true, subscription_id: existing.id });
    }

    const created = await prisma.pushSubscription.create({
      data: {
        userId: userId || null,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        browser: deviceInfo?.browser,
        userAgent: deviceInfo?.userAgent || '',
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, subscription_id: created.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { endpoint } = await request.json();

    await prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

### 8. Send Push API Route

Archivo: `src/app/api/notifications/send/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:noreply@example.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(request: NextRequest) {
  // Auth: solo con API_SECRET puede enviar
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.PUSH_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId, notification } = await request.json();

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (!subscriptions.length) {
      return NextResponse.json({ success: true, sent: 0 });
    }

    let sent = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(notification)
        );

        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: new Date() },
        });

        sent++;
      } catch (err: any) {
        // 4xx = subscription invalida, eliminar (excepto 429 rate limit)
        const status = err.statusCode;
        if ((status && status >= 400 && status < 500 && status !== 429) || !status) {
          await prisma.pushSubscription.delete({
            where: { id: sub.id },
          });
        }
        failed++;
      }
    }

    return NextResponse.json({ success: true, sent, failed });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

## Integracion con Layout

Despues de crear los archivos, agrega `<PWARegister />` y `<PushNotificationPrompt />` al layout principal.

Busca el layout principal (normalmente `src/app/layout.tsx` o un ClientLayoutWrapper).
Agrega:

```tsx
import PWARegister from '@/components/PWARegister';
import { PushNotificationPrompt } from '@/features/notifications/components/PushNotificationPrompt';

// Dentro del return, al final del body:
<PWARegister />
<PushNotificationPrompt userId={user?.id} />
```

Tambien agrega en el `<head>` del layout:

```tsx
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#000000" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

## Flujo de Ejecucion

1. Verificar `/add-login` (buscar `src/lib/auth.ts`).
2. Instalar: `npm install web-push`
3. Generar VAPID keys: `npx web-push generate-vapid-keys`
4. Actualizar Prisma schema con modelos PushSubscription y Notification.
5. Crear TODOS los archivos.
6. Agregar `<PWARegister />` y meta tags al layout.
7. Aplicar migracion: `npx prisma migrate dev --name add_push_notifications`
8. Mostrar mensaje final.

## Mensaje Final

```
PWA + Push Notifications integrados

Archivos creados:
  prisma/schema.prisma (PushSubscription + Notification models)
  public/manifest.json
  public/sw.js
  src/components/PWARegister.tsx
  src/features/notifications/hooks/usePushSubscription.ts
  src/features/notifications/components/PushNotificationPrompt.tsx
  src/app/api/notifications/subscribe/route.ts
  src/app/api/notifications/send/route.ts

Configura en .env.local (pega las keys generadas):
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=xxx
  VAPID_PRIVATE_KEY=xxx
  VAPID_SUBJECT=mailto:tu@email.com

Pendientes:
  1. Crea iconos PWA en public/icons/ (72, 96, 128, 144, 192, 512 px)
  2. Actualiza manifest.json con nombre y colores de tu app
  3. Prueba instalar la PWA: Chrome > menu > "Instalar app"
  4. Prueba push: envia POST a /api/notifications/send con Bearer token

Gotchas ya resueltos:
  - SW sin fetch handler (iOS Safari compatible)
  - VAPID key conversion a Uint8Array
  - Auto-reactivacion cuando browser invalida push subscription
  - Limpieza automatica de suscripciones invalidas (Apple silent failures)
  - PWARegister con window.location.origin (evita iOS 307 redirect)
```
