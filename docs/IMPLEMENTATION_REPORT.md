# ThreeJS Game Studio — Implementation Report

## Outcome

Implemented and extended the first functional ThreeJS Game Studio editor vertical slice. The result is a React + TypeScript + Vite web application with a direct Three.js viewport, validated schema-v3 project model, progressive Essentials/Advanced authoring, stackable gameplay components, hierarchy, component inspector, built-in and imported model assets, command history, isolated edit/play modes, revisioned browser persistence, portable project import/export, a single-HTML online game build, responsive layouts, diagnostics, an AI-native typed authoring/proposal/browser-bridge foundation, and browser QA.

This report does not claim that the current milestone is a complete Unity/Unreal replacement, a premium AAA game, an externally connectable MCP server, or a model-backed AI service. It establishes the editor/runtime architecture, complete authoring loop, first production asset-pipeline slice, and shared human/agent capability seam needed for later prefab, physics, scripting, animation, audio, UI-canvas, MCP, model-provider, and offline-packaging milestones.

## Iteration 4 — AI-native authoring registry, proposals, and browser bridge

- Added a versioned `threejs-game-studio.authoring` capability manifest for project schema v3. Every advertised tool includes a JSON-compatible input schema, domain, declared scope metadata, read/write effect, risk level, approval policy, reversibility, and rationale.
- Added 15 pure project tools covering project/scene inspection, complete starter-project reset, scene creation and hierarchy, transforms, primitive PBR materials, visibility/locks/shadows, gameplay-component add/update/remove, world/rendering settings, light/camera properties, and instances of existing imported models.
- Project tools operate on clones, reject unknown/invalid properties, use stable node/asset/component IDs, and validate the complete resulting project. A failed pure project-tool multi-call plan returns the original project rather than a partial mutation.
- Added a local Guided Assistant that understands a bounded set of scene summaries, creation, transform, material, gameplay, visibility, duplication, deletion, and background requests. It can also parse structured tool-call JSON. It is deterministic and requires no network or API key; it is not described as a language model.
- Added a responsive Studio Assistant panel with current context/revision, suggested requests, transcript, exact-value/contextual-risk review, explicit tool proposal, effects, Discard, and Apply controls. Read-only calls can return immediately; writes remain reviewable and accepted pure project-tool batches enter normal history as one Undo step. One mutation proposal is reserved synchronously so concurrent requests cannot orphan an approval. Project writes and editor-host actions are reviewed separately, and mutating host actions are proposed one at a time.
- Added 14 browser-host tool definitions for editor context/diagnostics, selection, viewport state, Play/Pause/Resume/Step/Stop/Preview controls, history, console, layout, save/export/build, and user-mediated import requests, producing a 29-tool combined manifest. Host definitions are separate from pure project mutation because they depend on live browser/editor state.
- Added `window.__THREE_GAME_STUDIO_AGENT__`, a trusted same-page integration bridge with API version 1 over cloned project/editor data. Its `manifest`, `snapshot`, `request`, and `subscribe` contract supports capability discovery, revision-checked tool requests, visible `approval_required` proposals, and proposal/project lifecycle events without exposing React setters, DOM nodes, Three.js instances, raw IndexedDB handles, object URLs, credentials, or arbitrary JavaScript execution. Its declared scopes are advisory metadata in this milestone; the bridge does not authenticate callers or enforce grants.
- Added an in-session monotonic authoring revision. Plans capture their base revision and stale plans are rejected after intervening human, agent, history, or import changes instead of silently overwriting them.
- Added contextual approval metadata. Destructive subtree deletion always requires approval; locked/root/hierarchy/camera/light changes can escalate to required approval. The built-in proposal UI currently gives every write a visible review boundary.
- Added `AGENTS.md` as an ongoing shipping rule: every new durable human authoring surface must gain a matching typed capability, normal history/autosave integration, contract coverage, and a browser-visible Undo test.
- Documented the external MCP sidecar, model-provider, audit/event, and staged-binary boundaries in `docs/AI_ARCHITECTURE.md`. None of those future transports/providers is falsely claimed as shipped.

## Iteration 3 — Imported model asset pipeline and schema v3

- Schema v3 adds a validated model asset catalog and explicit model scene nodes while keeping binary source data out of the project document. Schema v1 runs sequential v1→v2→v3 migration; schema v2 adds `assets: []`; schema v4+ is rejected.
- Self-contained GLB and glTF files with embedded data resources are parsed before any project mutation. External buffers/images, Draco, Meshopt, KTX2, malformed files, empty scenes, and files over 100 MiB fail atomically with actionable guidance.
- Every import records file size, mesh/triangle/material/texture counts, animation clip names, bounds, and scale/performance warnings. Essentials shows a plain-language model summary and fit controls; Advanced shows the full diagnostics and stable asset ID.
- Model bytes are stored as revisioned `ArrayBuffer` records in IndexedDB. Relinking creates a new revision so Undo can still reference the previous source; localStorage continues to hold the small authoritative document.
- The viewport loads each asset revision once, creates multiple instances with `SkeletonUtils.clone`, shares geometry/material/texture ownership, guards stale async loads, and disposes cache-owned GPU resources only after the final instance releases them.
- Model nodes remain selectable and transformable while loading. Missing or corrupt local bytes preserve the node, authored transform, and component data behind a visible placeholder and relink action instead of disappearing.
- Editable `.tjsstudio.json` packages now include base64 model sources. The web builder refuses to silently omit a missing model and embeds every referenced source into the downloaded HTML; Three.js modules still load from jsDelivr, so this is an online single-file build rather than an offline package.
- The visual harness now covers Essentials, Advanced, imported-model canvas visibility, and Advanced model authoring surfaces on desktop and mobile.

## Iteration 2 — Progressive authoring and schema v2

- Essentials is now the default experience. It keeps Create, Objects, Details, transforms, Play, Build, plain-language Appearance/Motion controls, and a compact Quick Start card in focus.
- Quick Start advances only after real actions in sequence: add a shape, style it, then Play. It persists dismissal/progress and ends with a working Build action.
- Advanced reveals the denser viewport, renderer, pause/step, Scene/Game, local/global, snapping, project assets, console, IDs, and component-specific controls. Switching experience never changes project data or history.
- Schema v2 replaces the single optional behavior with a stable `components[]` collection. Rotate, Float, and Keyboard Move can be composed on the same object.
- Schema-v1 behavior data migrates exactly once. Imports reject future schemas and malformed nested values with paths such as `nodes[8].components[0].speed` without replacing the open project.
- Play accepts WASD/arrow input, Pause freezes simulation, Step advances exactly `1/60`, and Stop restores authored transforms. Every mutation entry point is guarded while Play/Paused/Preview is active.
- World controls now include background, fog enable/color/range, exposure, grid sizing, and project shadows, with simpler defaults in Essentials and full values in Advanced.

## Game design brief (editor authoring brief)

- Creator promise: build a Three.js scene visually, immediately test it, and export a normal web game.
- Target feeling: fast, precise, technical, and trustworthy rather than dashboard-like.
- Primary verb: select and manipulate scene entities.
- Objective: turn a serializable scene document into a playable web build.
- Pressure: minimize the delay and state drift between authoring, Play mode, and export.
- Reward/progression: each edit is visible in the viewport, reversible through history, and preserved in the project/build.
- Fail/retry: Undo/Redo for authoring errors; Stop restores the untouched authoring document after runtime preview.
- Skill expression: scene composition, transform/material/light/camera tuning, hierarchy organization, and gameplay-component setup.
- Non-goals for this milestone: arbitrary user script execution, physics, standalone texture/audio import, animation playback/timelines, compressed or multi-file glTF ingestion, nested prefabs, an external MCP sidecar, a model-backed provider, collaborative cloud storage, and offline static packaging.

## Core loop

Choose or create an entity → select it in the hierarchy or viewport → edit its components → press Play or Preview → observe the runtime result → Stop and iterate → save/export/build.

The editor preview and generated page both consume the same `ProjectDocument` schema so the core loop does not fork into separate authoring and runtime state models.

## Level/encounter plan (first-run authoring flow)

- Start: the user lands directly in a populated `MainWorld` scene rather than a marketing or empty screen.
- First decision: select the central Player Core or another object from the hierarchy/viewport.
- First challenge: understand transform, appearance, motion, light, and camera controls without reading raw JSON.
- First reward: the selected entity and gizmo respond immediately; the Inspector reflects the same entity.
- Landmark: the cyan Player Core, violet Orbit Ring, raised platform, and illuminated arch make the starter composition easy to orient around.
- Escalation: add primitives/materials, duplicate/delete, make an object move, then reveal snapping/local space and stack Rotate, Float, or Keyboard Move components in Advanced.
- Recovery: Undo/Redo and Stop return to a known state; autosave and project export protect work.
- Completion: Preview removes editor chrome; Build downloads a standalone HTML game.
- Tuning knobs: transforms, PBR values, light intensity/color, camera FOV/clipping, component speed/axis/distance/phase/movement plane, fog, exposure, grid, shadows, and project settings.

## Skill-loading ledger

- Director: active; `/Users/chrislaupama/.agents/skills/threejs-game-director/SKILL.md`.
- Gameplay systems: loaded; `/Users/chrislaupama/.agents/skills/threejs-gameplay-systems/SKILL.md`.
- AAA graphics: loaded for imported-asset architecture and technical-art budgets; `/Users/chrislaupama/.agents/skills/threejs-aaa-graphics-builder/SKILL.md`; premium graphics claims remain out of scope.
- UI: loaded and executed; `/Users/chrislaupama/.agents/skills/threejs-game-ui-designer/SKILL.md`.
- Debug/profile: loaded and executed; `/Users/chrislaupama/.agents/skills/threejs-debug-profiler/SKILL.md`.
- QA/release: loaded and executed; `/Users/chrislaupama/.agents/skills/threejs-qa-release/SKILL.md`.
- Web 3D asset pipeline: loaded and executed; `game-studio:web-3d-asset-pipeline`.
- 3D generator, image generator, audio generator: not-needed for this milestone. The editor uses code-generated geometry, standard functional UI icons, and no audio; there is no premium hero-asset, generated-art, or active-game audio claim.

## Reference ledger

- Director phase playbook: yes; `threejs-game-director/references/phase-playbook.md`.
- Gameplay architecture workflow: yes; `threejs-gameplay-systems/references/gameplay-workflows.md`.
- Graphics implementation and technical art: yes; `threejs-aaa-graphics-builder/references/implementation-blueprint.md`, `technical-art.md`.
- Web asset pipeline references: yes; `game-studio/references/threejs-stack.md`, `gltf-loading-starter.md`, `web-3d-asset-pipeline.md`.
- UI patterns: yes; `threejs-game-ui-designer/references/ui-patterns.md`.
- UI quality, readability, responsive fit checklists: yes; `threejs-game-ui-designer/references/checklists/game-ui-quality.md`, `hud-readability.md`, `responsive-ui-fit.md`.
- Debug/profile checklist: yes; `threejs-debug-profiler/references/debug-profile-checklists.md`.
- Scene debugging checklist: yes; `threejs-debug-profiler/references/checklists/scene-debugging.md`.
- QA/release checklist: yes; `threejs-qa-release/references/qa-release-checklists.md`.
- Visual verification, playtest QA, release checklists: yes; `threejs-qa-release/references/checklists/visual-verification.md`, `playtest-qa.md`, `release.md`.
- Visual test harness reference/checklist: yes; `threejs-qa-release/references/visual-test-harness.md`, `references/checklists/visual-test-harness.md`.
- Physics, game-feel, premium visual scorecard/shader, generator, and audio references: not-needed because those production phases were not implemented or claimed.

## Phase ledger

- Gameplay systems: done — serializable project architecture, scene bridge, entity/component data, composable runtime loop, shared preview/build input, and diagnostics.
- External asset sourcing: skipped — no external art/audio asset surface or premium asset claim in this editor-foundation milestone.
- AAA graphics: scoped technical-art pass done — imported asset diagnostics, sizing, sharing, lifecycle ownership, mobile budgets, and runtime visibility are implemented; no AAA/premium scene claim.
- UI: done — studio shell, hierarchy, viewport toolbar, inspector, project browser, console, menus, command palette, status, preview, empty states, responsive drawers, and mobile review layout.
- Debug/profile: done — strict build, renderer/camera/resize checks, one renderer/loop, capped DPR, explicit disposal, and desktop/mobile diagnostics.
- QA/release: done — production build/preview, desktop Chromium and mobile WebKit workflows, pixel variance, screenshots, visual baselines, export download, console/page error checks, and render budgets.
- AI authoring foundation: done for this slice — typed project registry, guided local planner, proposal review, browser-host adapter, revision guard, normal history integration, parity contract, and tool/browser tests. MCP transport, authenticated pairing, model inference, durable audit, and staged binary transfer remain future phases.

## Files changed

- `src/App.tsx`: editor orchestration, history, persistence, menus, shortcuts, panel state, Play/Stop, import/export/build.
- `src/editor/types.ts`: serializable project/entity/component contracts.
- `src/editor/project.ts`: starter scene, document operations, built-in assets, validation, downloads, standalone runtime builder.
- `src/editor/modelAssets.ts`: self-contained glTF validation/parsing, diagnostics, warnings, and imported-resource disposal.
- `src/editor/assetStore.ts`: revisioned IndexedDB sources, data-URL encoding, and portable editable project packages.
- `src/editor/agentTools.ts`: versioned capability manifest, pure project tools, argument/result validation, scopes, and contextual risk/approval assessment.
- `src/editor/agentRuntime.ts`: deterministic Guided Assistant provider, structured planning, intra-plan references, and atomic pure project-tool batches.
- `src/editor/AgentPanel.tsx`: responsive assistant transcript, context, suggestions, proposal review, effects, approval, and discard UI.
- `src/editor/ViewportEngine.ts`: Three.js lifecycle, reconciliation, picking, controls, gizmos, cameras, gameplay-component runtime, diagnostics, disposal.
- `src/editor/components.tsx`: hierarchy, inspector, assets, console, form controls.
- `src/styles.css`: complete responsive editor visual system.
- `tests/model.spec.ts`: sequential migration, nested asset/reference validation, runtime embedding, stable presets, and component composition.
- `tests/agent-tools.spec.ts`: capability stability, immutable inspection, scene/material/gameplay/world/model coverage, atomic invalid calls, and contextual approval boundaries.
- `tests/assistant-integration.spec.ts`: desktop/mobile Assistant entry points, no-mutation-before-approval, atomic pure project-tool Apply, single-step Undo, and browser-bridge manifest/snapshot/request/subscription coverage.
- `tests/fixtures/modelFixtures.ts`: deterministic 996-byte GLB and external-resource glTF fixtures generated in memory.
- `tests/visual.spec.ts`: real-action Essentials journey, Play isolation, stacked components, model import/persistence/reuse/missing recovery/relink/package/build, keyboard input, pause/step/stop, and nonblank canvas smoke tests.
- `tests/visual-regression.spec.ts` plus snapshots: deterministic Essentials, Advanced, imported-model viewport, and Advanced model-authoring desktop/mobile baselines.
- `README.md` and `docs/PRODUCT_PLAN.md`: usage, architecture, boundaries, and roadmap.
- Existing package/build/test configuration is reused without adding runtime dependencies.

## UI states and controls verified

- Edit, Scene view, Game Camera view, Play, Pause, single-step, Stop, and clean Preview.
- Hierarchy search, disclosure, synchronized selection, inline rename, visibility, lock.
- Create primitive/group, duplicate, delete, Undo/Redo.
- Transform position/rotation/scale, material color/metalness/roughness/shadows, light, camera, and stackable gameplay-component add/remove/edit.
- Project browser folders/search/asset activation; console clear/filter counts.
- Essentials Create/import/reuse, Advanced Models catalog, fit/original sizing, technical diagnostics, multiple shared instances, visible loading/missing/error states, and relink recovery.
- Menus, command palette, local autosave, editable project package import/export, and model-embedding web build.
- Studio Assistant open/close, project context and revision, guided read results, typed write proposals, Discard/Apply, atomic pure project-tool commit, visible scene result, and one-step Undo.
- Versioned browser bridge capability/snapshot reads, revision-checked proposal/application, editor-host controls, and structured error/event results without renderer or DOM exposure.
- Narrow-screen first load with viewport primary, slide-over panels, 42px compact panel controls, and desktop recommendation.

## QA/release evidence

- `npm run build`: pass with Vite 8.1.5 and TypeScript 6.0.3.
- `npm test`: 43 passed, 7 intentionally skipped desktop-only duplicate cases on mobile. The suite runs 50 cases across desktop Chromium and mobile WebKit; AI tool/bridge/approval/concurrent-and-in-flight proposal ownership/stale-plan/runtime/reset/atomic-Undo/prompt-history/destructive-review contracts, migration, components, model persistence, shared-resource, missing/relink, portable-package, embedded-build, import-failure, and ten active visual-baseline checks are covered.
- Production preview URL tested: `http://127.0.0.1:4188/`.
- Production interaction: Play → Escape restored `mode-edit`; Build downloaded `starter-project-web.html` without failure.
- Browser application errors: none. Page errors: none. Headless Chromium emitted only driver-level `ReadPixels` performance notices while screenshots were captured.
- Desktop Essentials canvas: 724×615 CSS/drawing buffer at DPR 1; nonblank; 116 sampled color buckets; variance 255.
- Mobile Essentials canvas: 390×556 CSS, 780×1112 drawing buffer at DPR 2; nonblank; 131 sampled color buckets; variance 255.
- Renderer diagnostics on both: 24 calls, 3,042 triangles, 25 geometries, 3 textures.
- Render budget: within desktop limits (300 calls / 750k triangles / 300 geometries / 60 textures) and mobile limits (150 / 300k / 200 / 40).
- Desktop inspection: `/private/tmp/threejs-studio-prod-inspection/desktop.png` and `.json`.
- Mobile inspection: `/private/tmp/threejs-studio-prod-inspection/mobile.png` and `.json`.
- Assistant inspection: `/private/tmp/threejs-studio-assistant-desktop.png` and `/private/tmp/threejs-studio-assistant-mobile.png`; both fit without document overflow and keep the composer/review actions reachable.
- `git diff --check`: pass.

## Visual test harness

- Decision: added because the editor is UI-heavy and desktop/mobile panel fit is a high-regression surface.
- States: Essentials, Advanced, Studio Assistant proposal review, imported-model viewport, and Advanced model-authoring editor on desktop Chrome and mobile Safari/WebKit profiles.
- Determinism: gameplay components do not advance in Edit mode; transitions/animations and dynamic toast/FPS/autosave overlays are hidden for baseline capture.
- Update command: `npm test -- --update-snapshots=all`.
- Compare command: `npm test`.
- Baselines: ten active snapshots under `tests/visual-regression.spec.ts-snapshots/`, covering `studio-{essentials,advanced,assistant,imported-model,model-authoring}` on both browser profiles.
- Threshold: `maxDiffPixelRatio: 0.012` for full editor surfaces and `0.006` for imported-model canvas crops; no masks.
- Flake risk: minor WebGL antialiasing differences across operating systems/GPU drivers; smoke tests separately sample canvas pixels and interactions.

## Renderer/performance notes

- One `WebGLRenderer`, one animation loop, one `ResizeObserver`, editor camera plus project cameras.
- sRGB output, ACES filmic tone mapping, PCF shadows, 1024px starter directional-light shadow map.
- DPR capped at 2; current mobile profile renders at 2×.
- Scene nodes are reconciled in place; structural changes create/dispose objects while inspector edits update existing resources.
- Geometry/material/control/listener/renderer disposal is implemented.
- Current production bundle: 1,022.63 KB main JS / 273.32 KB gzip, 43.87 KB lazy GLTFLoader chunk / 13.06 KB gzip, and 64.66 KB CSS / 13.22 KB gzip. Three.js is the dominant runtime dependency; Vite still reports the main chunk above the 900 KB warning threshold.

## Remaining risks and planned work

- Browser localStorage remains suitable only for the current small authoritative document. Model bytes now use IndexedDB, but whole-project quota reporting, orphaned revision cleanup, and transactional garbage collection are still planned.
- The standalone build imports Three.js from jsDelivr and is not yet an offline ZIP.
- History currently stores full document snapshots and some inspector continuous inputs can create multiple entries; command transactions/structural sharing are planned.
- The current Guided Assistant is deterministic and intentionally bounded; a model-backed provider remains a separate adapter requiring a local model, secure companion/OS secret store, or hosted token broker. No browser API secret is shipped or stored.
- The current browser bridge is a trusted same-page typed integration seam, not an authenticated MCP endpoint. Manifest scope names are advisory and no caller identity or scope grant is enforced yet, so same-realm code must be trusted. The planned local MCP sidecar still needs stdio transport, loopback-only pairing, explicit enforced scopes, rate/size limits, cancellation, actor attribution, and durable audit events.
- Authoring revisions are currently session-local guards. Durable revision heads, client operation IDs/deduplication, structured conflict history, and append-only audit storage are required before remote or collaborative writes.
- External binary import remains user-mediated through browser file pickers. A later MCP/agent asset path must stage bytes out of band with declared size/type, SHA-256 verification, expiring upload IDs, quotas, and garbage collection; raw filesystem paths and ordinary base64 tool arguments are not acceptable.
- Model ingestion is intentionally limited to self-contained, uncompressed GLB or data-URI glTF up to 100 MiB. Multi-file packages, Draco/Meshopt/KTX2, standalone texture/audio/environment import, animation playback, LOD generation, and mesh optimization remain roadmap work.
- Portable editable packages base64-encode model bytes in memory, which is simple and deterministic for the current limit but not the final large-project ZIP format.
- Imported models share parsed geometry/material/texture ownership, but repeated instances still produce separate draw calls; automatic batching/instancing is planned.
- Prefabs, physics, input mapping, safe user scripting, runtime UI, multi-scene flow, and cloud collaboration remain roadmap work.
- The 1,022 KB main JavaScript chunk still needs deeper editor/runtime code splitting before a production hosting milestone.
- The editor is responsive for review and compact authoring, but desktop remains recommended for precision transforms.
- No bot playtest was added because this milestone is an editor authoring tool, not a release-ready game with objective/difficulty/failure gameplay.
