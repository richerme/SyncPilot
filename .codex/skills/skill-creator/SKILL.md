---
name: skill-creator
description: "Crear nuevos skills para extender la fabrica de software. Genera un nuevo directorio con SKILL.md siguiendo el estandar del proyecto. Activar cuando el usuario dice: crea un skill, nuevo skill, quiero agregar una herramienta nueva a la factory."
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Skill: skill-creator

Lee e implementa las instrucciones completas de este skill desde:

```
.claude/skills/skill-creator/SKILL.md
```

> Nota: Los nuevos skills se crean en `.claude/skills/` (implementacion completa).
> Opcionalmente crear el stub correspondiente en `.codex/skills/` para compatibilidad con Codex.

Sigue **exactamente** el flujo definido en ese archivo.
