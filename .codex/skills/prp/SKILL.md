---
name: prp
description: "Planificar una feature compleja antes de implementarla. Genera un PRP (Product Requirements Proposal) con objetivo, comportamiento, modelo de datos, y fases. Activar SIEMPRE antes de bucle-agentico, o cuando el usuario dice: planea esto, necesito un sistema de X, quiero agregar algo grande."
context: fork
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Skill: prp

Lee e implementa las instrucciones completas de este skill desde:

```
.claude/skills/prp/SKILL.md
```

Sigue **exactamente** el flujo definido en ese archivo.

> Nota: El template base de PRP esta en `.claude/PRPs/prp-base.md`.
> Los PRPs generados se guardan en `.claude/PRPs/prp-{feature}.md`.
