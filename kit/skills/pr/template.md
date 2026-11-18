# PR: body template

Copy the block, fill every section, and delete the hints in angle brackets. A section with nothing to
say keeps its heading and says so («Sin migraciones ni cambios de datos»).

```markdown
## Qué cambió

<Una o dos frases: qué es distinto para quien usa la app.>

- <Cambio en el código, por comportamiento>
- <…>

## Evidencia, antes y después

| Qué | Antes | Después |
|---|---|---|
| `<comando de pruebas>` | <141 de 142, falla "…"> | <142 de 142> |
| `<comando de tipos>` | <ok> | <ok> |
| <Pantalla a 1440> | <captura o descripción> | <captura o descripción> |
| <Pantalla a 390> | <captura o descripción> | <captura o descripción> |

Commit verificado: `<sha corto>`.
No verificado: <qué quedó sin probar, o "nada">.

## Riesgo de la mezcla

<Bajo | Medio | Alto>: <por qué>.

- Migraciones o cambios de datos: <ninguno | cuáles>
- Código compartido que toca: <ninguno | cuál>
- Variables de entorno o banderas nuevas: <ninguna | cuáles>
- Dependencias: <ninguna | cuáles y por qué>
- Qué más podría romperse y cómo se notaría: <…>

## Cómo deshacerlo

<Revertir el commit de mezcla basta | Pasos, en orden, cuando no basta.>

Plania: <KEY>
```

## Filled example

```markdown
## Qué cambió

Desde una lista ya se puede tocar "Compartir" y mandar un enlace; quien lo abre ve los mismos productos.

- La lista guarda si está compartida y con qué enlace.
- Una página nueva muestra la lista a quien abre el enlace, sin pedir cuenta.
- El enlace de una lista que no existe muestra un aviso, no un error.

## Evidencia, antes y después

| Qué | Antes | Después |
|---|---|---|
| `pnpm test` | 212 de 212 | 217 de 217 (5 pruebas nuevas) |
| `pnpm typecheck` | ok | ok |
| Lista a 390 | sin botón | botón "Compartir" arriba a la derecha |

Commit verificado: `3f9a2c1`.
No verificado: el enlace abierto desde WhatsApp en iPhone.

## Riesgo de la mezcla

Medio: agrega una migración y una página pública.

- Migraciones o cambios de datos: una columna nueva en listas, con valor por omisión; no reescribe datos.
- Código compartido que toca: ninguno.
- Variables de entorno o banderas nuevas: ninguna.
- Dependencias: ninguna.
- Qué más podría romperse y cómo se notaría: la página pública no revisa sesión; si mostrara listas no
  compartidas se notaría abriendo un enlace inventado (hay una prueba para eso).

## Cómo deshacerlo

Revertir el commit de mezcla. La columna puede quedarse: nada más la lee.

Plania: MIC-12
```
