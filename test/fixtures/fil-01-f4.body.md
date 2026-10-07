Phase 4 (se hace PRIMERO: no depende de la base de datos y es shippable sola; borra los caminos donde el usuario escribía metadatos, que F2 ya no tiene que portar).

## Alcance
- Nuevo `src/components/PlatformChips.tsx` (chips «Dónde la vi» extraídos de TitleForm); `MarkWatchedSheet` gana prop `platform?: Platform | null` y solo manda el campo si el caller lo conocía o el usuario tocó un chip. Ficha (`FichaWatchedSection`, `TitleActionRow` vía `TitleFichaActions`) pasa `title.platform`; deck/sala/Quiero ver no (su `platform` es disponibilidad derivada).
- `markTitleWatched` parsea `platform` opcional (`formData.has`), `""` → null.
- Borrar `src/app/titulos/[id]/editar/*`, `TitleForm.tsx`, `TmdbPicker.tsx`, `EditTitleBodySkeleton`; el footer de la ficha («Editar ficha» + «Quitar de Filmia») desaparece entero. Las filas huérfanas (sin watchedAt ni listas) se conservan.
- Quitar la etiqueta «Ya en Filmia» en `TmdbSearchResults`, `SearchPreviewSheet` y el sufijo de `AddTitleToListCta`; el estado por usuario (botones «En Quiero ver»/«Vista» deshabilitados, SharedPoster, Ficha) se queda.
- Código muerto: `createTitle`/`updateTitle`/`deleteTitle`/`syncLists`/`scheduleTitleEnrichment`/`readTitleFields`/`seriesProgressData` en `actions/titles.ts`; `searchTmdb`/`enrichFromTmdb`/`getMetadataConfig` en `actions/metadata.ts`; `readMetadataFields`/`enrichMetadataOnSave` en `lib/metadata.ts`; `parseTitleKind`/`parseYear`; `getCollectionLists`; rutas `/editar` en `revalidate-surfaces.ts`, `actions/lists.ts`, `rendering.ts` (AUTH_DYNAMIC_PAGES → 11). `/titulos/nuevo` se queda (redirect a /buscar).
- Scripts verify: fase-3 (asserts de TitleForm/editar/Quitar de Filmia → assert negativo + PlatformChips), fase-4 (length 11, sin syncLists), quiero-ver (sin titles.ts en la lista de «awards»), nav (sin caso /editar). Test nuevo `src/lib/form-data.test.ts` para `parsePlatform`.

## Done when
- [ ] `npm run lint && npm run typecheck && npm test && npm run verify` en verde
- [ ] Ficha sin «Editar ficha» ni «Quitar de Filmia»; `/titulos/<id>/editar` da 404
- [ ] `/buscar` no muestra «Ya en Filmia» pero «En Quiero ver»/«Vista» siguen deshabilitados cuando aplica
- [ ] Marqué visto guarda la plataforma y «Editar registro» la precarga; glow en /watchlist y filtro en /diario la reflejan
- [ ] PR a sandbox

- 2026-10-07 · claimed by Claude Code (sesión catalog split, worktree movie-database-design-64954a)
- 2026-10-06 · Código listo en commit 569e8a3 (jl/catalog-split, 24 archivos, +83/−517), aún sin push. Result: ✓ test — npm run lint, typecheck, test (202/202, 3 nuevos de parsePlatform) y verify (fase-4: 11 auth / 2 public) en verde. Result: ✓ live — dev server local contra Neon (.env del checkout principal), cuenta filmia-test: ficha de La Odisea sin «Editar ficha»/«Quitar de Filmia» ni footer; /titulos/<id>/editar → 404; Marqué visto muestra «Dónde la vi» (15 chips, Ninguna por defecto), MUBI se guarda y se precarga al reabrir «Editar registro», restaurado a Ninguna al final; a 375px 5 filas sin overflow horizontal; /buscar «La Odisea» sin «Ya en Filmia», en el preview «Vista» deshabilitado y «Quiero ver» activo; sin errores en el log del server. Corrección al Done when: el filtro de plataforma de /diario es de disponibilidad (resolveCatalogAvailability) y solo cae en Title.platform cuando no hay datos de providers, así que NO refleja «Dónde la vi» por diseño; se quita ese criterio.
- 2026-10-06 · Result: ✓ live — PR #121 abierto a sandbox (jl/catalog-split @ 569e8a3); verificación completa en el cuerpo del PR y en la nota anterior. Pendiente: CI en GitHub y merge por Jorge.
- 2026-10-07 · Done a petición de Jorge: #121 mergeado a sandbox (ab8f69c, 2026-10-07 06:01Z).
