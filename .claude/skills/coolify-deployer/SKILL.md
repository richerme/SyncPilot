---
name: coolify-deployer
description: "Desplegar la aplicacion Next.js en Coolify (VPS). Crea repo GitHub, configura app en Coolify, despliega con Docker y verifica healthcheck. Activar cuando el usuario dice: deploy, publicar, subir a produccion, poner en vivo, o cualquier variacion de desplegar la app."
user-invocable: false
context: fork
allowed-tools: Read, Write, Edit, Bash
---

# Coolify Deployer — Next.js a VPS

Despliega la aplicacion Next.js como contenedor Docker en Coolify, con PostgreSQL y variables de entorno configuradas.

---

## Prerequisitos — Verificar antes de empezar

### Variables de entorno requeridas:

```
GITHUB_TOKEN=         # PAT con scope 'repo'
COOLIFY_URL=          # ej: https://panel-coolify.tudominio.com
COOLIFY_TOKEN=        # API token de Coolify (Settings > API Keys)
```

Si alguna falta, pedirla al usuario antes de continuar.

### GitHub App en Coolify (1 vez por VPS)

Si el usuario nunca configuro esto, explicarle:

> 1. Panel de Coolify → menu lateral **"Sources"**
> 2. Click **"Add"** → **"GitHub App"**
> 3. **Name**: nombre descriptivo (ej: `coolify-tudominio`)
> 4. **Organization**: dejarlo vacio
> 5. **System Wide**: NO marcar
> 6. **Webhook Endpoint**: seleccionar el dominio HTTPS de Coolify
> 7. Click **"Register Now"** → GitHub abre pantalla de instalacion
> 8. En GitHub: seleccionar **"All repositories"**
> 9. Click **"Install"** → regresa a Coolify automaticamente

---

## Paso 1: Verificar que el proyecto esta listo

```bash
# Verificar que el build funciona
npm run build

# Verificar que existe Dockerfile
ls Dockerfile

# Verificar que prisma/schema.prisma existe
ls prisma/schema.prisma
```

Si el build falla, corregir antes de continuar.

---

## Paso 2: Crear repo privado en GitHub

```bash
# Crear repo privado (requiere gh CLI autenticado)
gh repo create NOMBRE-APP --private --source=. --push

# Si gh no esta disponible, usar la API:
curl -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "NOMBRE-APP", "private": true}'
```

Despues de crear el repo, vincular la GitHub App de Coolify:

```bash
# Obtener el installation_id de la GitHub App
curl -s "$COOLIFY_URL/api/v1/github-apps" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '.[0].installation_id'

# Vincular el repo (obtener repo_id de la respuesta de creacion)
curl -X PUT "https://api.github.com/user/installations/INSTALLATION_ID/repositories/REPO_ID" \
  -H "Authorization: Bearer $GITHUB_TOKEN"
```

---

## Paso 3: Crear base de datos PostgreSQL en Coolify

Usar el MCP de Coolify o la API:

```bash
# Via API: Crear PostgreSQL
curl -X POST "$COOLIFY_URL/api/v1/databases/postgresql" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_uuid": "PROJECT_UUID",
    "environment_name": "production",
    "name": "nombre-app-db",
    "postgres_user": "app_user",
    "postgres_password": "GENERAR_PASSWORD_SEGURO",
    "postgres_db": "nombre_app"
  }'
```

Guardar la `DATABASE_URL` resultante:
```
postgresql://app_user:PASSWORD@ALIAS:5432/nombre_app
```

---

## Paso 4: Crear app en Coolify

```bash
# Endpoint CORRECTO para repos privados
curl -X POST "$COOLIFY_URL/api/v1/applications/private-github-app" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project_uuid": "PROJECT_UUID",
    "environment_name": "production",
    "github_app_uuid": "GITHUB_APP_UUID",
    "git_repository": "owner/nombre-app",
    "git_branch": "main",
    "build_pack": "dockerfile",
    "dockerfile_location": "/Dockerfile",
    "ports_exposes": "3000"
  }'
```

> **Nota critica**: Usar `/api/v1/applications/private-github-app`, NO `/applications`.

Guardar el `APP_UUID` de la respuesta.

---

## Paso 5: Configurar variables de entorno

Los campos PATCH deben ir en requests SEPARADOS (limitacion de Coolify):

```bash
# Configurar cada variable individualmente
for var in \
  "DATABASE_URL=postgresql://..." \
  "AUTH_SECRET=$(npx auth secret --raw)" \
  "AUTH_URL=https://miapp.midominio.com" \
  "NEXT_PUBLIC_SITE_URL=https://miapp.midominio.com"
do
  KEY="${var%%=*}"
  VALUE="${var#*=}"
  curl -X POST "$COOLIFY_URL/api/v1/applications/$APP_UUID/envs" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"$KEY\", \"value\": \"$VALUE\", \"is_preview\": false}"
done
```

Si el usuario usa Google OAuth, agregar tambien:
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`

---

## Paso 6: Configurar dominio

```bash
# Asignar FQDN (dominio publico)
curl -X PATCH "$COOLIFY_URL/api/v1/applications/$APP_UUID" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fqdn": "https://miapp.midominio.com"}'
```

---

## Paso 7: Deploy

```bash
# Iniciar deploy
curl -X GET "$COOLIFY_URL/api/v1/deploy?uuid=$APP_UUID&force=true" \
  -H "Authorization: Bearer $COOLIFY_TOKEN"
```

---

## Paso 8: Monitorear deploy

Esperar ~120 segundos y verificar:

```bash
# Ver estado del ultimo deployment
curl -s "$COOLIFY_URL/api/v1/applications/$APP_UUID" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '.status'
```

**Indicadores de exito:**
- `status: "running"`
- La URL responde con 200

---

## Paso 9: Verificar y entregar

```
=== App desplegada exitosamente ===

URL: https://miapp.midominio.com
Base de datos: PostgreSQL en Coolify (interna)
Auth: Auth.js v5 configurado

Para futuros deploys:
- Hacer push a main → Coolify redespliega automaticamente
- O manual: Panel Coolify → App → Deploy
```

---

## Troubleshooting

- **Build falla**: Verificar que `npm run build` funciona localmente
- **`output: 'standalone'`**: Debe estar en `next.config.ts` para que el Dockerfile funcione
- **Migraciones fallan**: Verificar que `DATABASE_URL` es accesible desde el contenedor
- **FQDN no responde**: Verificar DNS apuntando al IP del VPS
- **422 en create_application**: `git_repository` debe ser `owner/repo` (sin prefijos)
- **Variables no se aplican**: Redeploy despues de cambiar env vars
