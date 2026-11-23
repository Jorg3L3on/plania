Plania: PLA-

## What

<!-- What changes, and why. One ticket per pull request. -->

## Checks

- [ ] Branch updated from the latest `main` before asking for review
- [ ] `pnpm exec tsc --noEmit` clean
- [ ] `pnpm exec tsc -p ui` clean
- [ ] `pnpm test`: _ passed, _ failed, _ skipped
- [ ] Screen changes: tried in a browser on a throwaway database, screenshots or a recording attached (or: no screen change)
- [ ] Words on the screen are plain Spanish, with no ticket keys or codes in them

## Notes

- Migrations: none / `drizzle/migrations/<file>` (written, not applied)
- MCP tools or error codes changed: no / yes, README tables regenerated
- `PROTOCOL_VERSION`: unchanged / bumped because …
