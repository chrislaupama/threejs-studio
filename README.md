# ThreeJS Game Studio

ThreeJS Game Studio is a browser-based game editor built around Three.js. It brings the familiar scene-building workflow of desktop engines to the web: a live 3D viewport, scene hierarchy, component inspector, project assets, edit/play isolation, project persistence, and a playable web export.

This repository contains a complete editor vertical slice with progressive disclosure: first-time creators start in **Essentials**, while experienced users can reveal the full **Advanced** workspace without changing or downgrading project data.

## What works today

- Live Three.js scene viewport with orbit controls, object picking, framing, camera presets, grid, and transform gizmos.
- Persisted Essentials/Advanced experiences over the same project document, plus a real-action Quick Start flow for add → style → play → build.
- Hierarchy and viewport selection synchronized with the Inspector.
- Create box, sphere, capsule, cylinder, cone, plane, torus, and empty-group entities.
- Edit names, visibility, locks, position, rotation, scale, PBR material values, lights, cameras, fog, exposure, grid, and shadows.
- Stack multiple gameplay components on an object: Spin, Float, and Move with Keyboard (WASD/arrow keys), each with novice-safe defaults and advanced controls.
- Inspect and manipulate authored project data through a versioned AI capability registry with typed inputs, stable IDs, immutable results, validation, declared scope metadata, risk metadata, and contextual approval rules.
- Use the local Guided Assistant to inspect the project or prepare scene, material, behavior, visibility, hierarchy, and world changes for review. Accepted pure project-tool proposals commit atomically as one undoable editor action.
- Connect trusted same-page integrations through a revision-checked in-page bridge that exposes cloned project/editor context and typed tools without exposing React, DOM, or Three.js objects.
- Built-in prefabs and materials that can be added or applied from the Project browser.
- Import self-contained GLB or embedded-resource glTF models. Imports are analyzed for meshes, triangles, materials, textures, animation clips, bounds, file size, and browser-budget warnings before the project changes.
- Imported model files persist in revisioned IndexedDB storage, can be instantiated repeatedly through a shared parsed-model cache, retain their glTF materials, and show visible loading/missing/error placeholders with relink recovery.
- Undo/redo, duplicate, delete, keyboard shortcuts, command palette, and an editor console.
- Play, pause, deterministic single-step, stop, Game Camera view, and clean fullscreen preview. Play mode is mutation-locked and Stop restores authored transforms.
- Browser autosave plus portable editable project packages. Schema-v1 and schema-v2 projects migrate to validated schema v3 with stable component/asset IDs and path-specific import errors.
- One-click single-HTML web build using the same serialized scene document as the editor preview; referenced model bytes are embedded in the download.
- Responsive authoring layout with compact drawers and review controls on narrow screens.
- Desktop and mobile Playwright coverage with WebGL pixel sampling and visual baselines.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5188`.

Production checks:

```bash
npm run check
npm run build
npm test
npm run preview
```

## Editor controls

| Action | Control |
| --- | --- |
| Orbit / pan / zoom | Mouse drag / secondary drag / wheel |
| Select | Click object or hierarchy row |
| Select tool | `Q` |
| Move | `W` |
| Rotate | `E` |
| Scale | `R` |
| Frame selected | `F` or double-click object |
| Duplicate | `Cmd/Ctrl + D` |
| Undo / redo | `Cmd/Ctrl + Z` / `Shift + Cmd/Ctrl + Z` |
| Save | `Cmd/Ctrl + S` |
| Command palette | `Cmd/Ctrl + K` |
| New / open project | `Cmd/Ctrl + N` / `Cmd/Ctrl + O` |
| Build / play-stop | `Cmd/Ctrl + B` / `Cmd/Ctrl + P` |
| Toggle panels | `Cmd/Ctrl + 1` / `2` / `3` |
| Delete | `Delete` / `Backspace` |
| Exit Play/Preview | `Escape` |

## Architecture

The serialized `ProjectDocument` is the source of truth. React owns editor chrome and editing state; `ViewportEngine` owns Three.js renderer lifecycle and reconciles project entities into live `Object3D` instances.

```text
Human controls · Guided Assistant · browser bridge
                         ↕
          Typed authoring capabilities
                         ↕
       ProjectDocument + undo history
                         ↕
         ViewportEngine / persistence
                         ↓
       Edit · Play preview · web build
```

Important files:

- `src/App.tsx` — editor orchestration, history, persistence, menus, shortcuts, play state.
- `src/editor/types.ts` — serializable project and component contracts.
- `src/editor/project.ts` — starter project, document operations, asset library, import/export, runtime HTML builder.
- `src/editor/modelAssets.ts` — self-contained glTF parsing, import diagnostics, validation, and GPU-resource disposal.
- `src/editor/assetStore.ts` — revisioned IndexedDB model sources and portable project package encoding.
- `src/editor/agentTools.ts` — versioned capability manifest, typed project tools, validation, scopes, and risk/approval metadata.
- `src/editor/agentRuntime.ts` — local Guided Assistant provider, proposal planning, and atomic pure project-tool execution.
- `src/editor/AgentPanel.tsx` — human review surface for assistant context, tool proposals, approval, and results.
- `src/editor/ViewportEngine.ts` — Three.js renderer, scene reconciliation, controls, picking, gameplay-component runtime, diagnostics.
- `src/editor/components.tsx` — hierarchy, inspector, project browser, console, and reusable editor controls.
- `tests/model.spec.ts` — schema migration, validation, and component-preset coverage.
- `tests/agent-tools.spec.ts` — AI capability, immutability, validation, domain, and approval-boundary contract coverage.
- `tests/assistant-integration.spec.ts` — pure project-proposal atomicity, single-step Undo, responsive entry points, and browser-bridge contract coverage.
- `tests/visual.spec.ts` — Essentials journey, composable runtime, isolation, persistence, and nonblank WebGL coverage.
- `tests/visual-regression.spec.ts` — Essentials, Advanced, Studio Assistant, and imported-model desktop/mobile visual baselines.

Live `Object3D`, DOM, texture, and object-URL references never enter the project document. Schema v3 stores only asset metadata and stable references; model bytes live in IndexedDB or a portable export envelope. That boundary keeps save files stable and ensures the editor, preview, and exported runtime consume the same scene format.

## AI authoring status

The shipped Studio Assistant is a local, deterministic guided planner over the same typed project tools intended for future agents. It proves project inspection, exact-value and contextual-risk review, validation, revision checks, atomic pure project-tool application, history integration, and Undo without making a false model-provider claim. The editor reserves one visible mutation proposal at a time and rejects concurrent proposals instead of orphaning an approval. Project edits and live editor-host actions are reviewed separately; mutating editor-host actions are proposed one at a time because browser session state does not yet have transactional rollback.

An externally connectable MCP sidecar and a model-backed built-in provider are planned adapter phases; neither is included yet. The current browser bridge is a trusted same-page integration seam, not a remotely authenticated MCP endpoint. Its declared scopes are advisory capability metadata rather than authenticated permission grants, so the current bridge must not be treated as an authorization boundary. No provider API key is required or bundled, and cloud secrets must never be stored in client JavaScript or localStorage.

See [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) for the capability matrix, approval and conflict rules, MCP deployment boundary, staged binary plan, and the ongoing requirement that every new human authoring feature receive a matching typed AI capability.

## Export notes

The current web build is a single HTML file that embeds referenced GLB/glTF data but imports Three.js, GLTFLoader, SkeletonUtils, and OrbitControls from jsDelivr at runtime. It is therefore a portable online build, not an offline build. Editable `.tjsstudio.json` packages include project data and base64 model sources; a hashed static ZIP remains planned.

See [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) for the staged path from this foundation to a full browser game engine.

## Current scope boundaries

The studio does not yet execute arbitrary user scripts, expose an external MCP server, connect to a model-backed provider, import standalone texture/audio/environment assets, run physics, edit or play imported animation clips, create nested prefabs, decode Draco/Meshopt/KTX2 models, resolve multi-file glTF packages, or emit an offline static ZIP. The current importer intentionally accepts self-contained GLB and glTF files with data-URI resources, then gives actionable guidance for unsupported packages. Keyboard Move is a shipped data-driven component, not a substitute for the planned Input Actions system.

No external art assets are checked into this repository and no API keys are required. The starter scene and UI are generated entirely from code and Three.js geometry; local models enter only through the user-controlled import flow.
