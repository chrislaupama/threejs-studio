# ThreeJS Studio — Product Plan

## Product vision

Build a professional game-authoring environment that runs in a browser and exports standard Three.js games. The editor should feel familiar to Unity and Unreal users without copying either product: scene-first workflow, direct manipulation, component-based authoring, fast play iteration, transparent web output, and a data format developers can own.

The core promise is:

> Build the scene visually, add reusable game behavior, press Play instantly, and export a normal web game.

## Product principles

1. **The project document is authoritative.** Editor and runtime scenes are derived views, never save-state containers.
2. **Preview and export share a runtime loader.** A game cannot behave differently merely because it left the editor.
3. **Direct manipulation first.** Common authoring should happen through the viewport, hierarchy, inspector, and assets—not raw JSON.
4. **Web-native output.** glTF, TypeScript/JavaScript, Web Audio, browser input, and static hosting remain visible and portable.
5. **Safe extension points.** User code runs behind a Worker or sandboxed-frame boundary, not in the editor origin.
6. **Performance is inspectable.** Draw calls, triangles, textures, frame time, and runtime ownership stay visible.
7. **Honest milestones.** A control ships when its workflow works end to end.
8. **Human/AI authoring parity.** Every durable human authoring control must have a typed, validated capability over the same project operation; neither agents nor integrations receive direct React, DOM, renderer, or `Object3D` access.

## Milestone 1 — Editor foundation (implemented)

- React + TypeScript editor shell around a direct Three.js viewport.
- Versioned, validated schema-v4 project format with sequential schema-v1 behavior → schema-v2 component → schema-v3 asset-catalog → schema-v4 Input Actions migration.
- Starter scene with meshes, lights, camera, materials, world settings, and stackable gameplay components.
- Essentials and Advanced authoring experiences over one shared project, with a persisted real-action Quick Start journey.
- Hierarchy, picking, transform gizmos, inspector, built-in assets, and scene/game tabs.
- Command history for create, edit, duplicate, delete, visibility, materials, and transforms.
- Strict edit/play isolation, pause/fixed-step/stop, clean preview, local autosave, and validated JSON round-trip.
- Spin, Float, and Keyboard Move components that compose in editor Play mode and the standalone HTML runtime.
- Standalone HTML web build for primitive scenes and built-in gameplay components.
- Responsive editor states, desktop/mobile smoke tests, and screenshot baselines.

Success metric: a new user can follow Add → Style → Play → Build without knowing Three.js terminology, while an advanced user can stack and tune components, inspect renderer state, save/reload stable IDs, and export a runnable page.

## Milestone 2 — Asset and prefab pipeline (model slice implemented)

- Revisioned IndexedDB model storage with binary records separated from schema-v4 project metadata. **Implemented.**
- Self-contained GLB/embedded-resource glTF import with fit/original sizing, bounds, animation-name, triangle, material, texture, and file-size diagnostics. **Implemented.**
- Shared parsed-model cache, SkeletonUtils instances, reference counting, stale-load guards, explicit GPU disposal, and visible loading/missing/error recovery. **Implemented.**
- Novice Create/import/reuse/relink flow plus Advanced Models catalog and technical diagnostics. **Implemented.**
- Portable editable JSON package with embedded model sources and single-HTML online builds with referenced models embedded. **Implemented.**
- Whole-project IndexedDB document storage with idle autosave and quota management.
- PNG, JPEG, WebP, HDR/EXR, and audio import with thumbnails and load/error states.
- Drag a model into the viewport; drag a material/texture onto a mesh.
- Prefab creation, nested prefab instances, overrides, and missing-reference recovery.
- Editable `.tjsstudio` ZIP package with `manifest.json`, project data, and assets.
- Draco, Meshopt, KTX2, and multi-file glTF package ingestion with configured decoders and dependency mapping.

Current model-slice result: an imported GLB survives save/reload, instantiates multiple times without duplicate geometry/texture ownership, recovers from missing local bytes, round-trips through an editable package, and appears in the online single-HTML build. Milestone completion still requires the offline ZIP, general media assets, drag/drop, and prefab system.

Verified slice limits: imports are capped at 100 MiB and must be self-contained; editable packages currently use in-memory base64 JSON; imported animation clips are cataloged but not yet playable; repeated models share GPU resources but are not automatically batched into instanced draw calls.

## AI-native authoring foundation (registry/proposal/bridge slice implemented)

- Versioned `threejs-studio.authoring` capability manifest with JSON-compatible input schemas, stable namespaced tools, declared scope metadata, read/write effects, risk levels, reversibility, and approval policies. The former `threejs-game-studio.authoring` protocol remains declared as a compatibility protocol. Scope grants are not authenticated or enforced by the current same-page integration seam. **Implemented.**
- Pure, immutable project tools for project/scene inspection, hierarchy and transforms, primitive materials, gameplay components, world/rendering settings, lights/cameras, and existing imported-model instances. Every successful result is validated before it can enter editor history. **Implemented.**
- Local Guided Assistant with bounded plain-language planning and structured tool-call input, exact-value/contextual-risk proposal review, atomic pure project-tool multi-call validation, stale-revision rejection, one-step Undo, concurrent-proposal reservation, and normal autosave/viewport reconciliation. Project and editor-host mutations are reviewed separately, with host actions proposed one at a time. This is deliberately deterministic and not presented as a language model. **Implemented.**
- Eighteen pure project tools plus fourteen browser-host definitions for project/input inspection and authoring, editor context/diagnostics, selection, viewport, Play/Preview/Step controls, history, console, layout, save/export/build, and user-mediated file-picker requests, producing a 32-tool combined manifest; plus a versioned trusted same-page integration bridge over cloned data. **Implemented.**
- Contributor parity rule and contract tests requiring new human authoring areas to gain matching typed capabilities and browser/Undo coverage. **Implemented and ongoing.**
- Local MCP stdio sidecar with loopback pairing, explicit scopes, cancellation, structured conflicts, and audit attribution. **Planned; the current browser bridge is not an MCP server.**
- Model-backed built-in provider connected through a local model, secure companion, or hosted token broker. **Planned; no model API key or cloud provider is bundled.**
- Staged, digest-verified out-of-band asset transfer for external agents instead of large base64 tool arguments or unrestricted filesystem paths. **Planned.**

Current AI-slice result: a human can ask the Guided Assistant for supported project changes, inspect exact nested binding values, apply a pure project-tool plan as one reversible transaction, and continue editing through the normal UI. A trusted same-page integration can discover the same contract, read Input Actions immediately, and route reference-safe remaps, reassignments, deletion, and Undo through visible revision-checked review. Its scope labels are advisory metadata rather than an authorization boundary. External connectivity, authenticated scope enforcement, and model intelligence remain separate deployment phases.

Success metric: adding a new human authoring surface fails the milestone unless its durable data is reachable through the shared capability registry or is explicitly documented as system-managed/read-only. See `docs/AI_ARCHITECTURE.md` for the capability matrix and security boundary.

## Milestone 3 — Gameplay framework

- Extend the shipped gameplay-component foundation into a registry covering transform, model, camera, light, collider, rigid body, audio source, and custom behavior definitions.
- Named Input Actions v1: project-level, stable two-axis actions with supported physical keyboard-code bindings (including usable modifiers), novice presets, Advanced authoring with conflict prevention and component-to-action navigation, component references, normalized Play/build resolution, migration, diagnostics, Undo, and matching typed AI capabilities. **Implemented.**
- Rapier physics integration with fixed timestep, sensors, collision layers, debug shapes, and restart cleanup.
- Extend Input Actions with buttons, action contexts, conflict guidance, runtime rebinding, pointer, touch, and gamepad bindings.
- Scene flow, spawn points, tags/layers, events, timers, checkpoints, and save-game data.
- Data-driven behavior graph for common logic.
- TypeScript behavior SDK compiled in a Worker; runtime preview hosted in a sandboxed iframe.
- Shared runtime loader for editor Play mode and exported games.

Success metric: users can build a small third-person/arcade game with movement, collisions, scoring, failure, restart, multiple scenes, and mobile input without changing editor internals.

## Milestone 4 — Animation, audio, VFX, and world tools

- Animation clip browser, state machine, transition preview, root-motion policy, and timeline.
- Audio mixer groups, spatial audio, user-gesture unlock, mute/volume, and lifecycle cleanup.
- Particle/VFX authoring with pooling and event-driven emission.
- Terrain/heightfield tools, environment settings, post-processing profiles, fog, skies, and reflection probes.
- Instancing, LOD, occlusion/culling settings, light baking helpers, and render-quality tiers.
- UI canvas system for HUD, menus, anchoring, safe areas, localization-sized text, and touch controls.

Success metric: a game can reach a polished, responsive presentation with measured desktop/mobile budgets and without custom engine patches.

## Milestone 5 — Build, collaboration, and ecosystem

- Self-contained static ZIP builds with hashed assets and configurable Vite base path.
- Development, preview, production, and quality-tier build profiles.
- Project templates, starter kits, reusable packages, and an extension manifest/API.
- Git-friendly text serialization with deterministic ordering and stable IDs.
- Optional cloud workspace, asset versioning, comments, branches, and multiplayer presence.
- CI commands for project validation, headless playtests, visual baselines, and deploy adapters.
- PWA/desktop packaging and Electron/Tauri filesystem bridge where browser permissions are limiting.

Success metric: teams can version, review, test, package, and deploy studio projects without vendor lock-in.

## Technical architecture target

```text
src/
  app/                 editor shell, commands, shortcuts, workspaces
  editor/
    model/             schemas, migrations, references, validation
    commands/          inverse operations and transactions
    agent/             capability registry, policy, proposals, host adapters
    viewport/          renderer, scene bridge, picking, editor helpers
    panels/            hierarchy, inspector, assets, console, timeline
  runtime/
    scene-loader/      shared project → Three.js instantiation
    systems/           input, physics, behavior, audio, animation, UI
  assets/              import, cache, thumbnails, lifecycle, diagnostics
  persistence/         IndexedDB and project package formats
  export/              runtime packaging and build profiles
  integrations/
    mcp/               local/hosted transport adapter over shared capabilities
  tests/               interaction, browser, visual, performance, migration
```

The current vertical slice keeps these boundaries compact, but its data model and scene bridge are already aligned with this target.

## Performance budgets

Starting editor/runtime budgets for ordinary scenes:

- Device pixel ratio capped at 2, with an adaptive mobile tier later.
- One renderer and one animation loop per active viewport.
- 60 FPS target on current desktop hardware; 30–60 FPS quality tiers on mobile.
- Explicit disposal on entity removal, scene close, project switch, and asset replacement.
- Shared geometries/materials and instancing for repeated props.
- Shadow maps limited to intentional casting lights; default 1024px map on the starter key light.
- Production diagnostics for draw calls, triangles, geometries, textures, and frame time.

Project-specific budgets should become configurable build warnings rather than hard engine limits.

## Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Browser storage and folder permissions | IndexedDB for working state; File System Access API where available; portable ZIP fallback. |
| User scripts compromise the editor | Compile in a Worker and run preview in a sandboxed iframe with a narrow message API. |
| Preview/export drift | Share the scene loader and runtime systems; clone the project document on Play. |
| GPU/resource leaks | Reference-count assets, centralize ownership, dispose explicitly, verify renderer memory. |
| History becomes noisy or huge | Command transactions for gizmo drags and numeric scrubbing; bounded history and structural sharing later. |
| Large projects overload React | Keep per-frame/transient state inside the imperative runtime; publish only coarse diagnostics to UI. |
| Mobile editor becomes cramped | One-surface-at-a-time drawers and review mode; desktop remains recommended for precise authoring. |
| Agent path drifts from human controls | Require every authorable schema area to register a shared typed capability and test visible, undoable parity. |
| Agent overwrites intervening work | Require a monotonic base revision for proposals/external writes and reject stale plans instead of silently rebasing. |
| Browser credentials leak | Ship no provider secret in Vite/client storage; use an external MCP host, local/desktop secret store, local model, or hosted token broker. |
| Untrusted same-page code invokes the integration bridge | Treat the current global as a trusted integration seam; its scope labels are advisory until an authenticated companion enforces grants. |
| External agents exfiltrate files/assets | Keep file choice user-mediated now; later use scoped pairing and staged digest-checked transfer rather than raw paths or inline binaries. |

## Definition of a credible “full game” release

The studio can claim full-game authoring when all of these exist end to end:

- Imported assets, prefabs, scenes, input actions, physics, behaviors/scripts, animation, audio, UI, persistence, and build profiles.
- A complete objective/progression/fail/restart loop built from shipped components.
- Editor Play mode and production export run the same project without manual code repair.
- Desktop and mobile input/rendering pass automated and human playtests.
- Save/load, migration, package import/export, missing assets, and runtime cleanup are tested.
- A public extension contract exists so game-specific systems do not require forking the editor.
- Every shipped authoring domain is discoverable and safely manipulable through the typed AI capability layer, with revision conflicts, approvals, and audit attribution enforced independently of the model or MCP client.
