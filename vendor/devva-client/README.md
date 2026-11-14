# devva TypeScript client (vendored)

A built copy of the devva TypeScript client: `Tunolabs/devva-clients`, folder `typescript`, branch
`jl/dev01-ts-client-dc8d7b` at commit `a1e4d12`. `lib/` is `tsc` over its `src/` with no source maps. It goes
with the engine built from `Tunolabs/devva` `jl/dev01-integration-2` at `9924766`.

Plania loads `lib/index.js` at start; `DEVVA_CLIENT` names another build. The client reads the engine token
from `DEVVA_TOKEN`, which plania sets from the token file. Apache-2.0, see `LICENSE`.

To update: build the client at the new commit and replace `lib/`, `package.json` and `LICENSE`, then change
the commit above. Replace this folder with a dependency when the client is published.
