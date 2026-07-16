# ThreeJS Game Studio — Product Plan

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

## Milestone 1 — Editor foundation (implemented)

- React + TypeScript editor shell around a direct Three.js viewport.
- Versioned, validated schema-v2 project format with automatic schema-v1 behavior migration.
- Starter scene with meshes, lights, camera, materials, world settings, and stackable gameplay components.
- Essentials and Advanced authoring experiences over one shared project, with a persisted real-action Quick Start journey.
- Hierarchy, picking, transform gizmos, inspector, built-in assets, and scene/game tabs.
- Command history for create, edit, duplicate, delete, visibility, materials, and transforms.
- Strict edit/play isolation, pause/fixed-step/stop, clean preview, local autosave, and validated JSON round-trip.
- Spin, Float, and Keyboard Move components that compose in editor Play mode and the standalone HTML runtime.
- Standalone HTML web build for primitive scenes and built-in gameplay components.
- Responsive editor states, desktop/mobile smoke tests, and screenshot baselines.

Success metric: a new user can follow Add → Style → Play → Build without knowing Three.js terminology, while an advanced user can stack and tune components, inspect renderer state, save/reload stable IDs, and export a runnable page.

## Milestone 2 — Asset and prefab pipeline

- IndexedDB project store with document migrations and idle autosave.
- Binary asset records separated from project metadata.
- GLB/glTF model import with scale, bounds, animation, triangle, material, and texture diagnostics.
- PNG, JPEG, WebP, HDR/EXR, and audio import with thumbnails and load/error states.
- Reference-counted asset cache, object-URL revocation, and explicit Three.js disposal.
- Drag a model into the viewport; drag a material/texture onto a mesh.
- Prefab creation, nested prefab instances, overrides, and missing-reference recovery.
- Editable `.tjsstudio` ZIP package with `manifest.json`, project data, and assets.

Success metric: an imported GLB survives save/reload, instantiates multiple times without duplicate resource cost, and appears in an exported offline package.

## Milestone 3 — Gameplay framework

- Extend the shipped gameplay-component foundation into a registry covering transform, model, camera, light, collider, rigid body, audio source, and custom behavior definitions.
- Rapier physics integration with fixed timestep, sensors, collision layers, debug shapes, and restart cleanup.
- Replace the current Keyboard Move preset with an Input Actions editor mapping keyboard, pointer, touch, and gamepad to named intents.
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
    viewport/          renderer, scene bridge, picking, editor helpers
    panels/            hierarchy, inspector, assets, console, timeline
  runtime/
    scene-loader/      shared project → Three.js instantiation
    systems/           input, physics, behavior, audio, animation, UI
  assets/              import, cache, thumbnails, lifecycle, diagnostics
  persistence/         IndexedDB and project package formats
  export/              runtime packaging and build profiles
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

## Definition of a credible “full game” release

The studio can claim full-game authoring when all of these exist end to end:

- Imported assets, prefabs, scenes, input actions, physics, behaviors/scripts, animation, audio, UI, persistence, and build profiles.
- A complete objective/progression/fail/restart loop built from shipped components.
- Editor Play mode and production export run the same project without manual code repair.
- Desktop and mobile input/rendering pass automated and human playtests.
- Save/load, migration, package import/export, missing assets, and runtime cleanup are tested.
- A public extension contract exists so game-specific systems do not require forking the editor.
