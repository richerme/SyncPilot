---
name: add-login
description: "Inyectar sistema de autenticacion completo: login, signup, password reset, profiles, Google OAuth. Activar cuando el usuario dice: necesito login, agregar registro, autenticacion, que los usuarios puedan entrar, crear cuentas, o proteger rutas."
allowed-tools: Read, Write, Edit, Bash
---

# Sistema de Autenticacion Completo

Inyecta autenticacion B2B production-ready con Auth.js v5 + Prisma + Next.js 16.

**NO preguntes. Ejecuta el Golden Path completo.**

---

## Contexto Tecnico

**Auth.js v5 (NextAuth):**
- Config en `src/lib/auth.ts` con PrismaAdapter
- Route handler en `src/app/api/auth/[...nextauth]/route.ts`
- Middleware en `src/middleware.ts` para proteger rutas
- Providers: Credentials (email/password) + Google OAuth

**Prisma:**
- Modelos User, Account, Session, VerificationToken ya existen en `prisma/schema.prisma`
- PrismaAdapter conecta Auth.js con la BD automaticamente

**Patron Profiles:**
- Auth.js guarda datos basicos en `User` (name, email, image)
- Para datos adicionales, extender el modelo User en Prisma

---

## Archivos a Crear/Modificar

### 1. Verificar `prisma/schema.prisma`

Los modelos de Auth.js ya deben existir. Si no, agregarlos:

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  hashedPassword String?
  accounts      Account[]
  sessions      Session[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

> **Importante:** Agregar campo `hashedPassword String?` para login con email/password.

### 2. Instalar bcryptjs

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

### 3. Actualizar `src/lib/auth.ts`

```typescript
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        })

        if (!user?.hashedPassword) return null

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.hashedPassword,
        )

        if (!isValid) return null

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string
      return session
    },
  },
})
```

### 4. `src/middleware.ts`

```typescript
export { auth as middleware } from '@/lib/auth'

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/settings/:path*',
  ],
}
```

### 5. `src/app/api/auth/[...nextauth]/route.ts`

```typescript
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
```

### 6. `src/actions/auth.ts`

```typescript
'use server'

import { prisma } from '@/lib/db'
import { signIn, signOut } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function login(formData: FormData) {
  try {
    await signIn('credentials', {
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      redirectTo: '/dashboard',
    })
  } catch (error) {
    if ((error as Error).message?.includes('NEXT_REDIRECT')) throw error
    return { error: 'Credenciales invalidas' }
  }
}

export async function signup(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const name = formData.get('name') as string

  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return { error: 'El email ya esta registrado' }

  const hashedPassword = await bcrypt.hash(password, 12)

  await prisma.user.create({
    data: { email, name, hashedPassword },
  })

  await signIn('credentials', {
    email,
    password,
    redirectTo: '/dashboard',
  })
}

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/dashboard' })
}

export async function logout() {
  await signOut({ redirectTo: '/login' })
}
```

### 7. `src/features/auth/components/LoginForm.tsx`

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { login, loginWithGoogle } from '@/actions/auth'

export function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await login(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form action={loginWithGoogle}>
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continuar con Google
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-gray-500">o</span>
        </div>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input id="email" name="email" type="email" required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">Password</label>
          <input id="password" name="password" type="password" required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="text-center text-sm text-gray-600">
          <Link href="/forgot-password" className="text-blue-600 hover:underline">Forgot password?</Link>
        </p>
      </form>
    </div>
  )
}
```

### 8. `src/features/auth/components/SignupForm.tsx`

```tsx
'use client'

import { useState } from 'react'
import { signup, loginWithGoogle } from '@/actions/auth'

export function SignupForm() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await signup(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form action={loginWithGoogle}>
        <button type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          Registrarse con Google
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-gray-500">o</span>
        </div>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">Nombre</label>
          <input id="name" name="name" type="text"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input id="email" name="email" type="email" required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">Password</label>
          <input id="password" name="password" type="password" required minLength={6}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}
```

### 9. `src/hooks/useAuth.ts`

```typescript
'use client'

import { useSession } from 'next-auth/react'

export function useAuth() {
  const { data: session, status } = useSession()

  return {
    user: session?.user ?? null,
    loading: status === 'loading',
    authenticated: status === 'authenticated',
  }
}
```

### 10. `src/app/providers.tsx`

```tsx
'use client'

import { SessionProvider } from 'next-auth/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
```

> **Importante:** Envolver `{children}` con `<Providers>` en `src/app/layout.tsx`

### 11. Pages de auth

Crear las paginas en `src/app/(auth)/`:
- `login/page.tsx` — LoginForm
- `signup/page.tsx` — SignupForm

---

## Flujo de Ejecucion

1. Agregar campo `hashedPassword` al modelo User en Prisma
2. `npm install bcryptjs && npm install -D @types/bcryptjs`
3. `npx prisma migrate dev --name add_hashed_password`
4. Crear TODOS los archivos listados arriba
5. Agregar `<Providers>` en layout.tsx
6. Mostrar mensaje de completacion

---

## Mensaje Final

```
Auth implementado con Auth.js v5!

Incluye:
- Login/Signup con Email/Password (bcrypt)
- Login/Signup con Google OAuth
- Hook useAuth() con session
- Rutas protegidas via middleware (/dashboard, /settings)
- Server Actions (login, signup, logout, loginWithGoogle)

Configurar credenciales:

1. Generar AUTH_SECRET:
   npx auth secret

2. Agregar a .env.local:
   AUTH_SECRET=tu_secret_generado
   AUTH_URL=http://localhost:3000

3. Para Google OAuth (opcional):
   a. Google Cloud Console > APIs & Services > Credentials
   b. Crear OAuth 2.0 Client ID (tipo: Web application)
   c. Authorized redirect URI: http://localhost:3000/api/auth/callback/google
   d. Agregar a .env.local:
      AUTH_GOOGLE_ID=tu_client_id
      AUTH_GOOGLE_SECRET=tu_client_secret

4. npm run dev

Listo para probar en /login
```
