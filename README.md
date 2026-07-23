# ThreeJS Studio

ThreeJS Studio is a local-first, browser-based editor for building Three.js games. The product direction is a familiar engine workflow—Hierarchy, viewport, Inspector, assets, scripts, Play, diagnostics, and builds—over a portable, serializable project format.

Canonical website: [threejs.studio](https://threejs.studio) · Repository: [chrislaupama/threejs-studio](https://github.com/chrislaupama/threejs-studio)

## Implementation status

This branch makes schema v5 the durable project format, adds the first game-authoring surfaces, and makes the bundled Collect & Escape project playable in editor Play and the offline ZIP through a versioned runtime-binding adapter. Authored TypeScript now compiles and executes in an opaque behavior Worker in both paths, but it does not yet replace the specialized adapters that own visible gameplay; that boundary is called out explicitly below.

### Integrated in the editor

- A schema-v5 `ProjectDocumentV5` is authoritative for load, local save/autosave, history snapshots, portable project packages, the integration bridge, scripts, build profiles, and the Collect & Escape template. Existing v1–v4 projects migrate deterministically.
- The existing scene editor continues through a disposable schema-v4 projection. Scene edits are merged back into v5 without dropping other scenes, generalized assets, prefabs, runtime UI, or non-keyboard input bindings.
- Live Three.js viewport with picking, orbit controls, camera views, transform gizmos, grid, diagnostics, hierarchy, Inspector, assets, console, Undo/Redo, shortcuts, responsive layouts, and self-contained GLB/glTF import.
- Shadcn generated from preset `b3YRKAGXPE`, backed by Base UI and Tailwind CSS v4, with the preset's Zinc/Lyra/Geist/Lucide theme. Menus, the command palette, icon buttons, and every new game-authoring panel use the new system. The legacy editor migration is still incremental.
- A Game Authoring workspace with Scripts, Input, Game UI, and Build tabs. Monaco is loaded lazily; saving executable source requires an explicit review dialog and enters the normal validated, autosaved, one-step Undo path.
- A typed schema-v5 game capability manifest for script list/read/upsert/delete, Collect & Escape creation, build-profile reads, and offline-build preparation. The existing schema-v4 tool/host layer remains as a compatibility surface.
- Play/Pause/Step/Stop use the shared fixed-60-Hz `RuntimeSession`. Projects carrying `threejs-studio.runtime-bindings.v1` run through `ProjectGameRuntime`: generalized keyboard/pointer/touch/gamepad input, Rapier-backed physics, pickups, score/countdown, exit win/fail/restart, and the framework-free accessible runtime HUD. Projects without that manifest retain Rotate, Float, and Keyboard Move compatibility. Stop disposes runtime state and restores the authored scene.
- The primary Build command emits an offline ZIP containing a production runtime projection of the validated v5 project, local version-locked Three.js and Rapier modules, available model bytes, hashes, a network-dark CSP, and a CSP-safe HUD stylesheet. When scripts exist, the exact hash-checked compiled module executes inside a packaged opaque iframe/Worker before the main runtime boots; raw TypeScript and source maps are omitted from production, and the old single-file HTML exporter remains available as a legacy option.
- The offline `runtime-bindings.v1` adapter runs Collect & Escape at fixed 60 Hz with Rapier character collision, keyboard/gamepad movement, accessible hold-style touch controls, sensor pickups/exit, score/countdown, win/fail/restart, diagnostics, and runtime/DOM/GPU cleanup.
- Chromium and mobile WebKit coverage for the migrated menus/dialogs/typing surfaces, including axe checks with no serious or critical findings in the tested core and overlay states.

### Implemented foundations not yet end-to-end

- Component, input, physics, event/state, runtime-UI, compiler/sandbox, secure preview-host, workspace-layout, and offline-runtime modules have focused contract/browser tests.
- `RuntimePreviewHost` mounts an opaque-origin, network-dark iframe and validates identity, sequencing, lifecycle commands, diagnostics, and cleanup. Play now mounts a hidden instance for the compiled behavior and mirrors Start/Pause/Step/Resume/Restart/Stop into it; the visible Three.js runtime still runs in `ViewportEngine`.
- Editor Play and export still use separate manifest-driven gameplay adapters. Both now execute the same compiled behavior bytes in the opaque behavior host, but emitted SDK commands and variables are diagnostic telemetry only and do not yet drive transforms, physics, collisions, runtime UI, audio, or scene transitions. The offline adapter uses a purpose-built accessible HUD after validating the runtime-UI asset, while editor Play mounts the generic runtime-UI renderer.
- The adapters are specialized to the v1 Collect-style tag/rule contract rather than arbitrary scripts or visual graphs. Editor character motion uses the current axis-aligned collision adapter, and current Play remains inside `ViewportEngine` rather than the opaque preview host.
- The offline renderer still does not decode packaged GLB/glTF model binaries. Generalized asset loading, arbitrary behavior execution, and exact Play/export runtime parity remain open.
- Collect & Escape is a deterministic, valid v5 template and a runnable vertical slice. It is not yet the complete product proof because the public TypeScript behavior runs but does not drive the visible game, and the two gameplay hosts have not converged.
- Prefab records and multiple scenes are preserved and validated, but full prefab, scene-transition, and multi-scene editing workflows are not implemented.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5188`.

Checks:

```bash
npm run check
npm run build
npm run test:contracts
npm run test:browser:desktop
npm run test:browser:mobile
npm run build && npm run test:preview
npm run verify:visual
```

`npm test` remains the complete local Playwright run across both configured browser profiles. The targeted commands above mirror the release CI gate: browserless contracts run once without starting Vite or requiring an installed browser, desktop Chromium carries the complete editor/browser and axe coverage, mobile WebKit repeats the cross-browser responsive, touch, runtime-UI, secure-preview, script-sandbox, Assistant, and accessibility journeys, and the preview smoke boots the built hashed assets before exercising Play and Stop.

The reviewed screenshot suite is `tests/visual-regression.spec.ts`. Its committed baselines were captured on arm64 macOS 26, so CI compares them on the matching `macos-26` runner family and never updates snapshots automatically. Review visual changes locally on macOS 26 before committing refreshed baselines:

```bash
npm run verify:visual -- --update-snapshots=all
npm run verify:visual
```

Playwright retains traces and screenshots for failures, with video recorded on the first retry in CI. CI fails tests that pass only on retry and publishes isolated HTML/JUnit reports and failure artifacts for seven days.

## Deploy to Cloudflare

Production hosting uses an asset-only Cloudflare Worker. The apex custom domain, caching policy, and asset directory are declared in `wrangler.jsonc`; public source maps are disabled. A separate minimal Worker declared in `wrangler.www.jsonc` permanently redirects `www.threejs.studio` to the canonical apex while preserving paths and query strings.

```bash
npm ci
npm run check
npm run cloudflare:dry-run
npm run deploy:cloudflare
npm run cloudflare:www:dry-run
npm run deploy:cloudflare:www
```

`deploy:cloudflare` runs a clean production build before publishing. The `www` Worker can be deployed independently and does not replace the editor Worker. The authenticated Cloudflare account must own the active `threejs.studio` zone.

## Editor controls

| Action | Control |
| --- | --- |
| Orbit / pan / zoom | Mouse drag / secondary drag / wheel |
| Select | Click object or hierarchy row |
| Select / Move / Rotate / Scale | `Q` / `W` / `E` / `R` |
| Frame selected | `F` or double-click object |
| Duplicate | `Cmd/Ctrl + D` |
| Undo / redo | `Cmd/Ctrl + Z` / `Shift + Cmd/Ctrl + Z` |
| Save | `Cmd/Ctrl + S` |
| Command palette | `Cmd/Ctrl + K` |
| Build / play-stop | `Cmd/Ctrl + B` / `Cmd/Ctrl + P` |
| Toggle panels | `Cmd/Ctrl + 1` / `2` / `3` |
| Exit Play/Preview | `Escape` |

## Architecture

`ProjectDocumentV5` is the durable source of truth. Live Three.js objects, React state, device input, DOM nodes, renderer handles, object URLs, and runtime/save-game state are derived or transient and must not enter the authoring API.

```text
Human editor · Guided Assistant · typed integrations
                       ↓
         validated pure project operations
                       ↓
      ProjectDocumentV5 + revision + history
                 ↓ compatibility view
             legacy scene editor
                       ↓
       compiler, asset pipeline, runtime
                    ↙     ↘
               editor Play  offline ZIP
```

The target is one command path and one sandboxed runtime path. Today, v5 is authoritative and compiled behavior lifecycle execution is shared, while SDK command application, the legacy scene projection, the visible Play host, and the restricted offline renderer remain convergence work.

Important areas:

- `src/editor/projectV5.ts` and `src/editor/gameProject.ts` — v5 migration/validation plus the legacy scene compatibility adapter.
- `src/editor/projectCommands.ts` — atomic schema-v4 command protocol retained while a v5 command registry is built.
- `src/editor/gameAuthoring.ts` and `src/editor/agentTools.ts` — shared script operations and typed legacy/v5 capability layers.
- `src/components/studio/GameAuthoringWorkspace.tsx` — integrated Scripts/Input/Game UI/Build workspace.
- `src/runtime/` — fixed-step kernel, protocol, and additive secure iframe host.
- `src/gameplay/`, `src/runtime-ui/`, and `src/scripting/` — game-system foundations.
- `src/build/` — deterministic offline ZIP assembly, script compilation, and the current local runtime bundle.
- `src/components/ui/` and `src/components/studio/` — generated Base UI primitives and Studio composites.

## Shadcn/Base UI policy

Shadcn controls the editor UI only; exported game UI uses a separate serializable DOM/CSS runtime. `components.json`, generated source, theme CSS, dependency versions, and the lockfile are committed so CI never resolves `@latest`.

The preset owns semantic tokens such as `--background`, `--primary`, `--accent`, `--border`, and `--ring`. Studio-specific tokens—including `--studio-brand`, viewport, selection, gizmos, diagnostics, and density—remain separate. Legacy CSS is imported through a lower-priority named cascade layer during migration.

Base UI supplies accessible primitives, not automatic product accessibility. Explicit labels, correct semantics, visible focus, contrast, keyboard behavior, portal cleanup, and automated checks remain required.

## AI authoring invariant

Every durable human authoring feature must have a typed capability over the same pure project operation. Tools receive and return serializable data, validate before and after mutation, use optimistic revisions, and enter normal history/autosave. File selection, executable-code changes, permissions, destructive actions, and external communication retain a visible approval boundary.

The same-page bridge is a trusted integration seam, not an authenticated MCP server. Approval-required v5 bridge calls create a reviewable Assistant proposal and commit only after the user applies it through the normal validated history path. See [AI Authoring Architecture](docs/AI_ARCHITECTURE.md).

## First complete-game proof

The acceptance game is **Collect & Escape**: move through a compact arena, collect every shard before the countdown expires, then reach the exit. The versioned adapters now prove the core loop in editor Play and offline output, and both execute the authored lifecycle in isolation. The release gate remains the complete author → script-driven visible Play → stop → reopen → same-runtime export → complete-offline journey with keyboard, touch, and gamepad.

See [Product Plan](docs/PRODUCT_PLAN.md) for delivery gates and [Game Authoring Architecture](docs/GAME_AUTHORING_ARCHITECTURE.md) for the implementation boundary.
