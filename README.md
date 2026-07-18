# ThreeJS Studio

ThreeJS Studio is a local-first, browser-based editor for building Three.js games. The product direction is a familiar engine workflow—Hierarchy, viewport, Inspector, assets, scripts, Play, diagnostics, and builds—over a portable, serializable project format.

Canonical website: [threejs.studio](https://threejs.studio) · Repository: [chrislaupama/threejs-studio](https://github.com/chrislaupama/threejs-studio)

## Implementation status

This branch makes schema v5 the durable project format, adds the first game-authoring surfaces, and makes the bundled Collect & Escape project playable in editor Play and the offline ZIP through a versioned runtime-binding adapter. It is not yet the final shared, script-driven, opaque-origin runtime; that boundary is called out explicitly below.

### Integrated in the editor

- A schema-v5 `ProjectDocumentV5` is authoritative for load, local save/autosave, history snapshots, portable project packages, the integration bridge, scripts, build profiles, and the Collect & Escape template. Existing v1–v4 projects migrate deterministically.
- The existing scene editor continues through a disposable schema-v4 projection. Scene edits are merged back into v5 without dropping other scenes, generalized assets, prefabs, runtime UI, or non-keyboard input bindings.
- Live Three.js viewport with picking, orbit controls, camera views, transform gizmos, grid, diagnostics, hierarchy, Inspector, assets, console, Undo/Redo, shortcuts, responsive layouts, and self-contained GLB/glTF import.
- Shadcn generated from preset `b3YRKAGXPE`, backed by Base UI and Tailwind CSS v4, with the preset's Zinc/Lyra/Geist/Lucide theme. Menus, the command palette, icon buttons, and every new game-authoring panel use the new system. The legacy editor migration is still incremental.
- A Game Authoring workspace with Scripts, Input, Game UI, and Build tabs. Monaco is loaded lazily; saving executable source requires an explicit review dialog and enters the normal validated, autosaved, one-step Undo path.
- A typed schema-v5 game capability manifest for script list/read/upsert/delete, Collect & Escape creation, build-profile reads, and offline-build preparation. The existing schema-v4 tool/host layer remains as a compatibility surface.
- Play/Pause/Step/Stop use the shared fixed-60-Hz `RuntimeSession`. Projects carrying `threejs-studio.runtime-bindings.v1` run through `ProjectGameRuntime`: generalized keyboard/pointer/touch/gamepad input, Rapier-backed physics, pickups, score/countdown, exit win/fail/restart, and the framework-free accessible runtime HUD. Projects without that manifest retain Rotate, Float, and Keyboard Move compatibility. Stop disposes runtime state and restores the authored scene.
- The primary Build command emits an offline ZIP containing a production runtime projection of the validated v5 project, local version-locked Three.js and Rapier modules, inert compiled-script artifacts when present, available model bytes, hashes, a network-dark CSP, and a CSP-safe HUD stylesheet. Raw TypeScript and source maps are omitted from production; the old single-file HTML exporter remains available as a legacy option.
- The offline `runtime-bindings.v1` adapter runs Collect & Escape at fixed 60 Hz with Rapier character collision, keyboard/gamepad movement, accessible hold-style touch controls, sensor pickups/exit, score/countdown, win/fail/restart, diagnostics, and runtime/DOM/GPU cleanup.
- Chromium and mobile WebKit coverage for the migrated menus/dialogs/typing surfaces, including axe checks with no serious or critical findings in the tested core and overlay states.

### Implemented foundations not yet end-to-end

- Component, input, physics, event/state, runtime-UI, compiler/sandbox, secure preview-host, workspace-layout, and offline-runtime modules have focused contract/browser tests.
- `RuntimePreviewHost` mounts an opaque-origin, network-dark iframe and validates identity, sequencing, lifecycle commands, diagnostics, and cleanup. The current Play and Preview buttons do not use this host yet.
- Editor Play and export currently use separate manifest-driven adapters. Both implement Collect & Escape's rules, but neither executes the authored TypeScript behavior source. Compiled output is packaged with a non-executable extension and MIME type for the future opaque behavior sandbox, and bootstrap never imports or hands it to the runtime. The offline adapter uses a purpose-built accessible HUD after validating the runtime-UI asset, while editor Play mounts the generic runtime-UI renderer.
- The adapters are specialized to the v1 Collect-style tag/rule contract rather than arbitrary scripts or visual graphs. Editor character motion uses the current axis-aligned collision adapter, and current Play remains inside `ViewportEngine` rather than the opaque preview host.
- The offline renderer still does not decode packaged GLB/glTF model binaries. Generalized asset loading, arbitrary behavior execution, and exact Play/export runtime parity remain open.
- Collect & Escape is a deterministic, valid v5 template and a runnable vertical slice. It is not yet the complete product proof because the public TypeScript behavior does not drive execution and the two runtime hosts have not converged.
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
npm test
```

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

The target is one command path and one sandboxed runtime path. Today, v5 is authoritative, while the legacy scene projection, Play host, and restricted offline renderer remain convergence work.

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

The acceptance game is **Collect & Escape**: move through a compact arena, collect every shard before the countdown expires, then reach the exit. The versioned adapters now prove the core loop in editor Play and offline output. The release gate remains the complete author → script-driven sandboxed Play → stop → reopen → same-runtime export → complete-offline journey with keyboard, touch, and gamepad.

See [Product Plan](docs/PRODUCT_PLAN.md) for delivery gates and [Game Authoring Architecture](docs/GAME_AUTHORING_ARCHITECTURE.md) for the implementation boundary.
