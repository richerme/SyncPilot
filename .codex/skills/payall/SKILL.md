---
name: payall
description: |
  Configura TODOS los pagos de un funnel de ventas con Polar (Merchant of Record).
  Implementa 6 productos en 3 grupos: (1) Producto Principal one-time, (2) Pack Premium
  con upsell-1 one-time y downsell-1 one-time, (3) SaaS App con suscripciones anuales
  y mensuales (upsell-2, downsell-2, monthly). Crea checkouts, webhook handler con soporte
  de pagos unicos Y suscripciones, modelo Prisma Purchase y PolarCheckoutButton reutilizable.
  Activar cuando: "configura todos los pagos", "conectar pagos del funnel", "payall",
  "integrar polar completo", "activar cobros del funnel", "conectar checkouts del funnel".
  Pre-requisito: auth implementada — User tiene flags hasUpsell1/Downsell1/Upsell2/Downsell2.
  NO USAR para: un solo producto aislado (usar /add-payments), analytics, reportes.
allowed-tools: Bash(npm *), Bash(npx *), Read, Write, Edit, Glob, Grep
---

# Skill: payall

Lee e implementa las instrucciones completas de este skill desde:

```
.claude/skills/payall/SKILL.md
```

Sigue **exactamente** el flujo definido en ese archivo:
1. Leer BUSINESS_LOGIC.md para identificar los 6 productos (main, upsell1, downsell1, upsell2, downsell2, monthly)
2. Instalar `@polar-sh/sdk`
3. Crear `src/lib/polar.ts` con los 6 productos reales del proyecto
4. Crear checkout API route (SUCCESS_URLS por producto), webhook handler con subscription.active/canceled y PolarCheckoutButton
5. Conectar botones en cada pagina del funnel (main, upsell-1/acceso, downsell-1, upsell-2/acceso, downsell-2)
