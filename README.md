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
- Built-in prefabs and materials that can be added or applied from the Project browser.
- Undo/redo, duplicate, delete, keyboard shortcuts, command palette, and an editor console.
- Play, pause, deterministic single-step, stop, Game Camera view, and clean fullscreen preview. Play mode is mutation-locked and Stop restores authored transforms.
- Browser autosave plus editable JSON import/export. Schema-v1 projects migrate to validated schema v2 with stable component IDs and path-specific import errors.
- One-click standalone HTML web build using the same serialized scene document as the editor preview.
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
React editor chrome
        ↕
ProjectDocument + undo history + persistence
        ↕
ViewportEngine / scene bridge
        ↓
Edit view · Play preview · HTML web build
```

Important files:

- `src/App.tsx` — editor orchestration, history, persistence, menus, shortcuts, play state.
- `src/editor/types.ts` — serializable project and component contracts.
- `src/editor/project.ts` — starter project, document operations, asset library, import/export, runtime HTML builder.
- `src/editor/ViewportEngine.ts` — Three.js renderer, scene reconciliation, controls, picking, gameplay-component runtime, diagnostics.
- `src/editor/components.tsx` — hierarchy, inspector, project browser, console, and reusable editor controls.
- `tests/model.spec.ts` — schema migration, validation, and component-preset coverage.
- `tests/visual.spec.ts` — Essentials journey, composable runtime, isolation, persistence, and nonblank WebGL coverage.
- `tests/visual-regression.spec.ts` — Essentials and Advanced desktop/mobile visual baselines.

Live `Object3D`, DOM, texture, and object-URL references never enter the project document. That boundary keeps save files stable and ensures the editor, preview, and exported runtime consume the same scene format.

## Export notes

The current web build is a single HTML file that imports Three.js and OrbitControls from jsDelivr at runtime. Editable projects are exported as versioned `.tjsstudio.json` documents. A self-contained ZIP runtime and binary asset package are planned in the next asset-pipeline milestone.

See [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) for the staged path from this foundation to a full browser game engine.

## Current scope boundaries

The foundation does not yet execute arbitrary user scripts, import GLB/textures/audio, run physics, edit animation clips, or package binary assets. Those need dedicated asset storage, disposal, migration, and script-sandbox boundaries; they are deliberately planned rather than represented by inactive UI. Keyboard Move is a shipped data-driven component, not a substitute for the planned Input Actions system.

No external art assets or API keys are used. The starter scene and UI are generated entirely from code and Three.js geometry.
