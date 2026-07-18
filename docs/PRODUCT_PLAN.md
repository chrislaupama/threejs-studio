# ThreeJS Studio — Product Plan

## Product vision

Build a professional, web-first game-development environment that feels familiar to users of Godot, Unity, and Unreal while producing transparent Three.js projects and offline web builds.

The product promise is:

> Build scenes visually, program reusable behavior, press Play instantly, and export the same game runtime without editor-only repair.

## Product principles

1. `ProjectDocumentV5` is authoritative; editor and runtime objects are derived.
2. Human and typed AI authoring use the same validated, revision-checked project operations.
3. Play, Preview, tests, and exported games converge on one runtime.
4. User code compiles outside the UI thread and executes outside the editor origin.
5. Runtime/save-game state never mutates authored project data.
6. Web output remains inspectable, portable, and hostable without vendor lock-in.
7. Accessibility, lifecycle cleanup, diagnostics, and performance are release gates.
8. A feature is complete only when its author → play → save/reopen → export path works.

## Status legend

- **Integrated** — used by the mounted editor workflow.
- **Partial** — an integrated slice exists, but the complete domain is not end-to-end.
- **Foundation** — implemented as a contract/module with focused coverage, not yet a complete product surface.
- **Planned** — not yet implemented.

## Current checkpoint

Schema v5 is now the durable project format. The existing Hierarchy, Inspector, assets, and viewport remain operational through a schema-v4 active-scene projection that merges edits back into v5. This prevents the UI migration from blocking persistence while preserving v5-only data.

The checkpoint also includes the shadcn/Base UI foundation, a mounted Game Authoring workspace, validated script-source authoring, typed v5 game tools, an additive secure preview host, generalized game systems, a deterministic offline ZIP command, and a complete authored Collect & Escape template.

Collect & Escape now runs through a versioned manifest adapter in editor Play and through an equivalent specialized adapter in the offline ZIP. Both cover movement, Rapier collision/sensors, pickups, score/countdown, exit win/fail/restart, HUD/touch controls, and cleanup. It is still a partial vertical slice: the authored TypeScript bundle is packaged but not executed, Play and export use separate implementations, and current Play is not hosted in the opaque iframe.

## Phase 0 — Shadcn/Base UI editor foundation

### Integrated

- Tailwind CSS v4, Vite integration, and the `@/*` alias.
- Shadcn initialized with preset `b3YRKAGXPE` and Base UI; generated source, `components.json`, dependencies, and lockfile are committed.
- Preset-owned semantic tokens plus separate `--studio-*` brand/viewport/editor tokens.
- Legacy CSS imported through a lower-priority named cascade layer.
- Dark-theme provider, Tooltip provider, Sonner host, and local `EditorPreferences` separate from project data.
- Generated primitives for forms, menus/overlays, tabs/collapsibles, scroll/resizable/sheet/drawer, alerts/toasts, and related compositions.
- Application Menubar, command dialog, icon buttons/tooltips, and every new Game Authoring surface use the new system.
- Desktop Chromium and mobile WebKit coverage for migrated menus/dialogs/typing surfaces, focus restoration, portal cleanup, shortcut suppression, and axe serious/critical findings.

### Foundations

- Serializable split-tree workspace model, panel registry, desktop resizable shell, mobile sheet/drawer surfaces, and preference synchronization have focused tests.

### Exit work

- Adopt the workspace shell as the default workbench.
- Migrate Hierarchy, Inspector, assets, console, legacy Input Actions, Quick Start, build, Assistant, viewport-adjacent controls, and remaining mobile surfaces.
- Finish hierarchy roving-tab-stop/arrow/Home/End/rename semantics and broaden focus, contrast, target-size, axe, and visual coverage.
- Remove obsolete legacy selectors one surface at a time.

## Phase 1 — Authoritative contracts and runtime convergence

### Integrated

- V5 load/save/autosave/history/package path with strict v1–v5 loading and deterministic v4 migration.
- Lossless active-scene compatibility adapter for legacy editor controls.
- Versioned v5 scenes/entities/layers, prefabs, asset union, generalized input maps, variables/events, runtime UI, build profiles, and permissions.
- Pure validated script-source operations used by both Monaco Save and typed game tools.
- V5 bridge snapshot and typed game manifest for scripts, template creation, and build-profile preparation.
- Visible Assistant proposal/apply flow for approval-required v5 bridge mutations, with stale-revision rejection and normal one-step Undo.
- `RuntimeSession` schedules Play at fixed 60 Hz with a five-tick cap and exact Step.
- `ProjectGameRuntime` detects/validates `runtime-bindings.v1`, then orchestrates generalized input, Rapier, gameplay events/state, transforms/visibility, diagnostics, and the generic runtime-UI HUD in editor Play without mutating v5.
- Primary Build emits a deterministic, hashed, network-independent ZIP with local Three.js and Rapier modules, a source-stripped v5 runtime projection, inert compiled-script artifacts, available model bytes, and a local HUD stylesheet. Production bootstrap does not execute authored modules and the CSP denies all connections.
- The offline v1 adapter runs the Collect rules with Rapier character collision, keyboard/gamepad input, touch controls, score/countdown, win/fail/restart, diagnostics, and cleanup.

### Foundations

- Atomic schema-v4 command executor with optimistic revisions, strict payloads, structured errors, patches, affected records, and inverse snapshots.
- Registry definitions for existing Rotate, Float, and Keyboard Move components.
- Opaque-origin `RuntimePreviewHost` with identity/sequence validation, lifecycle commands, throttled diagnostics, restrictive CSP, and complete host cleanup.
- Offline runtime that validates v4/v5 projects, selects the startup scene, renders primitives/lights/cameras, and uses a deterministic scheduler.

### Exit work

- Replace compatibility commands with a v5-native command registry used by every human and agent mutation.
- Add transactional coordination between project, source, and binary revisions.
- Generalize the v1 binding contract into a registry-compiled runtime snapshot.
- Execute authored TypeScript/graph bundles rather than built-in equivalent rules.
- Move Play/Preview from same-page `ViewportEngine` ownership into `RuntimePreviewHost`.
- Make Play and export instantiate identical scene/assets/systems/runtime UI, load packaged models, and prove complete teardown.

Exit gate: a migrated legacy project and a v5 project reach the same deterministic checkpoints in sandboxed Play and an offline build without authored-data mutation.

## Phase 2 — First complete game: Collect & Escape

### Authored template now

- Compact arena, player, obstacles, five pickups, exit, camera, and lights.
- Keyboard, touch, and gamepad input mappings.
- Physics body/collider/sensor/layer records.
- Typed variables, events, timers, objective, win/fail/restart data.
- A real editable TypeScript behavior source.
- Responsive accessible runtime-UI/HUD data with touch controls.
- Default-deny offline production build profile.
- Editor command, typed replacement capability, deterministic validation tests, persistence, and packaging.

### Integrated vertical-slice runtime

- Editor Play feeds keyboard, pointer/touch HUD actions, and polled gamepads through the generalized input resolver.
- Editor Play uses the Rapier wrapper, deterministic state/events/objectives/timers, sensor pickups/exit, runtime-only transforms/visibility, and the generic accessible runtime-UI renderer.
- Offline output packages local Rapier and runs keyboard/gamepad movement, hold-style touch controls, character collision, pickups/exit, score/countdown, win/fail/restart, a minimal accessible HUD, diagnostics, and cleanup.
- Focused controller tests cover movement without document mutation, deterministic win/fail/restart, hold/release touch behavior, and HUD disposal. Focused offline tests cover keyboard win, gamepad movement, timeout, restart, HUD, and disposal.

### Remaining production integration

- Execute the authored TypeScript behavior through the Studio SDK and opaque sandbox; current adapters implement equivalent built-in rules and read exposed binding properties.
- Replace the editor's axis-aligned movement/collision adapter with a general registry-backed character-controller component and debug display.
- Use the same runtime, state implementation, and generic runtime-UI renderer in Play and export.
- Add general authoring operations/forms/tools for input, physics, state/events, runtime UI, and permissions.
- Run the complete served ZIP journey with networking disabled, non-root hosting, and desktop/mobile control parity.

### Exit gate

The game can be authored, played, paused/stepped, stopped without document mutation, reopened, exported, served from a non-root path with networking disabled, and completed on desktop and mobile. Keyboard, touch, and gamepad mappings reach equivalent checkpoints.

## Phase 3 — Complete programming experience

### Partial/foundation now

- V5 script assets and source catalog with normalized virtual paths, revisions, source-size validation, normal history/autosave, and code approval.
- Lazy Monaco workspace with file creation/editing and diagnostics surface.
- Studio behavior SDK, bounded virtual file system, `esbuild-wasm` compiler Worker/client, content hashes, dependency metadata, diagnostics, source maps, and last-known-good compiler result.
- Build-time compilation packages successful script output into the ZIP.
- Opaque sandbox document/protocol tests deny network and browser/editor handles.

### Remaining

- Script component attachment and Inspector-exposed schema properties.
- Multi-file navigation, complete SDK autocomplete, formatting, search/references, templates, and rename/delete UI.
- Runtime execution and last-known-good hot reload in `RuntimePreviewHost`.
- Revision-tagged stale-compile cancellation, watchdogs, lifecycle cleanup, and source-linked logs.
- Breakpoints, event tracing, runtime entity/variable inspection, and debugging.
- Visual logic graphs compiled to the same behavior/runtime model.
- Complete typed tools for attachment, properties, compilation, and diagnostics.

Exit gate: a compile failure keeps the last-known-good game running, and Stop/restart removes every worker, timer, listener, Blob URL, and runtime resource.

## Phase 4 — Content and game structure

- Multi-scene authoring, transitions, persistent entities, and scene loading.
- Prefab creation, linked instances, sparse overrides, apply/revert, unpack, nesting, and variants.
- Asset importers for textures, materials, environments, audio, animation, scripts, fonts, and runtime UI.
- Dependency inspection, source revisioning, thumbnails, compression, decoders, and missing-reference recovery.
- Animator/state machines, clip events, preview, and root-motion policy.
- Web Audio mixer, spatial sources, buses, gesture unlock, and cleanup.
- Particle/VFX emitters, trails, post-processing profiles, and event-driven effects.
- Save-slot schemas/migrations separate from project data.

Exit gate: a multi-scene game with reusable prefabs, imported content, animation/audio/VFX, and migrated saves runs identically in Play and export.

## Phase 5 — Professional editor workflow

- Adopt and extend the current split-tree/panel registry into custom docking.
- Saved Layout, Scripting, Animation, UI, and Debugging workspaces.
- Multi-selection, drag/drop reparenting, contextual creation, prefab override visualization, and searchable references.
- Monaco, graph editor, timeline, asset grid, virtualized console, profiler, and Assistant tool-call cards as Studio composites.
- Project Settings for Input, Tags/Layers, Physics, Audio, Permissions, and Builds.
- Runtime profiler for frame time, draw calls, triangles, memory, physics, scripts, audio, and asset budgets.
- Templates and onboarding for common genres.

Exit gate: an experienced developer can build and debug routine game features without leaving the editor, while all durable controls retain AI parity.

## Phase 6 — Production and ecosystem

- Deterministic cached builds, asset variants, LODs, compressed textures, streaming, and enforced budgets.
- Versioned plugin/extension manifests over Studio registries.
- CI validation, headless playtests, accessibility, parity, and reviewed visual baselines.
- Local MCP sidecar with authenticated pairing/scopes/audit, then optional hosted transport.
- Provider adapters without client-side secrets.
- Hosted builds, collaboration, marketplace, multiplayer tooling, native packaging, and dedicated 2D workflows remain later initiatives, not dependencies of the first complete game.

## Acceptance matrix

| Area | Implemented checkpoint | Product release proof |
| --- | --- | --- |
| Shadcn/Base UI | Preset, tokens/providers, generated components, migrated menus/dialog/workspace surfaces, focused a11y tests | Default shell and every editor surface migrated; complete keyboard/focus/axe/mobile coverage |
| Schema v5 | Authoritative load/save/history/package format plus legacy adapter | All authoring panels and runtime consumers operate v5-natively; adapter retired |
| Commands/AI | Atomic v4 compatibility executor; v5 script/template/build tools with inverse snapshots | Every v5 human mutation uses the common command registry and produces the same result through a tool and one-step Undo |
| Runtime | Shared scheduler plus v1 game-system adapter in same-page Play; secure host tested separately | `RuntimePreviewHost` is the sole Play/Preview path and the same compiled runtime runs in export |
| Scripts | Monaco source authoring, compiler/sandbox foundations, build packaging | Component attachment, sandbox execution, hot reload, diagnostics/debugging, and security acceptance |
| Input/physics/state | V1 Collect adapter consumes the production modules in editor Play; offline has an equivalent Rapier adapter | General registry components/settings/tools and one shared implementation |
| Runtime UI | Hardened generic renderer mounts the editor HUD; offline mounts a separate accessible HUD | Visual authoring and the same responsive HUD/touch implementation in Play/export |
| Offline build | Deterministic ZIP runs the specialized Collect rules with local Three/Rapier and no CDN | Exact Play runtime, model/decoder and compiled behavior execution, plus network-disabled journey |
| Collect & Escape | Authored v5 template and runnable editor/offline manifest adapters | Script-driven opaque Play, same-runtime export, full desktop/mobile control parity and reopen journey |

## Testing and release gates

### UI and accessibility

- Chromium and mobile WebKit workflows for menus, dialogs, command palette, portals, tabs, sheets, tooltips, toasts, focus restoration, and shortcut suppression.
- Full hierarchy tree keyboard model with one roving tab stop.
- `@axe-core/playwright` with zero serious/critical violations on core and overlay states.
- Accessible names/live regions, dark-theme contrast, visible focus, 44 px mobile targets, inert modals, scroll lock, and portal cleanup.
- Semantic tests pass before screenshot changes are accepted.

### Data and AI

- V4→v5 migration, malformed/cyclic references, component conflicts, source revisions, and package round trips.
- Registry contracts require validation, Inspector metadata, runtime support, AI metadata, and migration.
- Human/agent v5 equality plus one-step Undo for every authoring feature.
- Stale revision, approval, deduplication, atomic failure, and stable error coverage.

### Runtime, security, and build

- Fixed-step behavior at 30/60/144 FPS and frame spikes.
- Play/Pause/Step/Stop/restart/hot-reload/scene-transition cleanup.
- Checkpoint parity between Play and export.
- Scripts cannot reach parent DOM, editor storage, the authoring bridge, undeclared network endpoints, or raw browser handles.
- Production output runs with networking disabled and from non-root paths.
- No page/console errors, orphan portals, leaked body styles, listeners, physics/audio objects, GPU resources, or Blob URLs.

## Definition of a credible full-game release

ThreeJS Studio can claim complete game authoring only when:

- Scenes, prefabs, assets, generalized input, physics, scripts/graphs, animation, audio, VFX, runtime UI, save data, and build profiles work end to end.
- Collect & Escape is built using the same public authoring features users receive.
- Play and production export share one compiled project/runtime and deterministic checkpoints.
- Desktop and mobile control/rendering paths pass automated and human playtests.
- Save/load, migration, packages, missing assets, security boundaries, and cleanup are tested.
- Every authoring domain is discoverable and safely mutable through the typed AI layer.
- A versioned extension contract exists so game-specific systems do not require editor forks.
