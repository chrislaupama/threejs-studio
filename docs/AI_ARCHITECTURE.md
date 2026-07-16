# ThreeJS Game Studio — AI Authoring Architecture

## Status at a glance

ThreeJS Game Studio is being built as an AI-native editor, not as a human editor with screen automation added later. Human controls, the built-in assistant, and future external agents are expected to operate on the same serializable `ProjectDocument` through the same typed authoring capabilities.

The current milestone ships:

- A versioned authoring capability manifest with JSON-compatible argument schemas, declared scope metadata, read/write effects, risk levels, and approval policies.
- Fifteen pure, validated project tools for inspection, full starter-project reset, and undoable scene, material, gameplay, world, light, camera, and existing-model-instance changes.
- A local Guided Assistant that turns a deliberately limited set of plain-language requests or structured tool JSON into reviewable proposals. It is a deterministic planner, not a model-backed AI service.
- A proposal surface that shows each planned call before any write is applied. Accepted pure project-tool plans validate atomically and enter the editor as one history step.
- Fourteen browser-host definitions for editor-only capabilities such as selection, viewport controls, Play/Stop, history, console, layout, save/export/build, and user-mediated import requests.
- A trusted same-page integration bridge at `window.__THREE_GAME_STUDIO_AGENT__` with API version 1. It exposes manifest discovery, a cloned project/editor snapshot, revision-checked tool requests, and event subscription without exposing React state, DOM nodes, or Three.js objects.
- Contract tests for project-tool immutability, validation, capability metadata, hierarchy safety, contextual approvals, and representative authoring domains.

The current milestone does **not** ship an MCP server, remote transport, cloud model, OpenAI API integration, or hidden provider credentials. Those consume the same contract in later phases.

## Non-negotiable parity invariant

Every authorable feature must be usable through both the human editor and the typed authoring-tool layer. A feature is not complete if it exists only as a React callback or a direct Three.js mutation.

For every new authorable field or action:

1. Keep its durable state in `ProjectDocument` or in an explicitly referenced asset record. Do not hide authored game state in React, the DOM, or `Object3D.userData`.
2. Add or extend a typed capability with an input schema, scope, effect, risk level, approval rule, and availability constraints.
3. Reuse the same pure project operation in the human and agent paths.
4. Validate arguments before execution and validate the complete resulting project before commit.
5. Route successful mutations through normal editor history, logging, autosave, selection, and viewport reconciliation.
6. Add contract coverage and a browser workflow proving that the result is visible and undoable.
7. Update the capability matrix in this document.

System-managed values such as stable IDs, timestamps, import diagnostics, hashes, and asset revisions remain readable but are changed only by their owning operation. AI access to every authorable area does not mean unrestricted writes to integrity metadata.

This repository also carries the same rule in `AGENTS.md` so it remains an implementation constraint rather than a one-time design note.

## Boundaries

```text
Human editor controls ─────────────┐
                                   │
Guided Assistant proposal UI ──────┼──> typed capability + policy layer
                                   │                │
Future model-backed provider ──────┤                ├──> validated ProjectDocument
                                   │                │          │
Future MCP adapter ────────────────┘                │          ├──> history / autosave
                                                    │          └──> asset references
Browser host capabilities <─────────────────────────┘
          │
          ├──> selection / viewport / runtime / layout
          └──> explicit file picker / save / export / build

ProjectDocument ──> ViewportEngine ──> derived Three.js objects
```

The durable project model is the trust boundary:

- Tools accept and return JSON-compatible, serializable data.
- Project tools work on clones and never mutate the caller's document.
- `ViewportEngine` reconciles approved document state into Three.js; agents do not receive `Object3D`, renderer, material, texture, control, canvas, or animation-loop references.
- Browser-host actions are explicit adapters around editor orchestration. They do not turn React setters into a public API.
- Play mode remains mutation-locked. An agent must stop Play before changing authored data, just like a human.

## Capability contract

The capability protocol is currently `threejs-game-studio.authoring` version 1 over project schema v3. The manifest contains 29 tools: 15 pure project tools and 14 mounted-editor host tools. Tool names use the `studio_` namespace. Each definition advertises:

- Stable name, title, and description.
- Domain and declared scopes.
- Read-only versus mutating effect.
- JSON-compatible input schema with unknown properties rejected.
- Risk level: `read`, `low`, `moderate`, or `destructive`.
- Approval policy: `none`, `when-sensitive`, or `required`.
- Reversibility and a plain-language rationale.
- Whether execution belongs to the pure project layer or browser host.

Scope names in the current manifest describe the access a future authenticated host must grant; the in-page bridge does not authenticate callers or enforce scope grants. It assumes the JavaScript executing in the editor page is trusted. Mutations still cross the editor-owned proposal boundary, while permitted read-only calls return immediately. Authenticated identity and scope enforcement belong to the planned companion adapter.

Representative pure project tools include:

- Project lifecycle and inspection: `studio_get_project_summary`, `studio_reset_project`, `studio_list_nodes`, `studio_get_node`, `studio_search_nodes`.
- Scene: `studio_create_primitive`, `studio_create_group`, `studio_update_node`, `studio_duplicate_node`, `studio_delete_node`.
- Gameplay: `studio_add_component`, `studio_update_component`, `studio_remove_component`.
- World: `studio_update_world_settings`.
- Assets: `studio_add_model_instance` for an existing, trusted project asset.

The browser host extends the same namespace for editor context, diagnostics, selection, viewport state, runtime control, history, console, layout, save/export/build, and user-mediated project/model import requests. These actions are intentionally separate from pure project mutation because they depend on browser state or user activation.

Unknown tools, unsupported properties, invalid type-specific fields, missing references, hierarchy cycles, root deletion, invalid fog ranges, and malformed transforms fail without partially changing the project.

## Capability matrix

| Area | Inspect | Manipulate | Current route | Notes |
| --- | --- | --- | --- | --- |
| Project lifecycle, metadata, and totals | Yes | Limited | Project tools | Full starter reset is covered; project/scene rename should gain explicit tools before new UI is added. |
| Scene hierarchy | Yes | Yes | Project tools | Create, rename, reparent, duplicate, delete, visibility, locks, and stable IDs. |
| Transforms | Yes | Yes | Project tools | Position, Euler rotation, and scale; no direct `Object3D` access. |
| Primitive materials | Yes | Yes | Project tools | Base/emissive color, intensity, metalness, roughness, and shadows. |
| Gameplay components | Yes | Yes | Project tools | Add/update/remove Rotate, Float, and Keyboard Move by stable component ID. |
| World/render settings | Yes | Yes | Project tools | Background, fog, exposure, grid, and realtime shadows. |
| Lights and cameras | Yes | Yes | Project tools | Type-specific validated properties; sensitive framing/lighting edits carry approval metadata. |
| Imported model metadata | Yes | Indirect | Project + browser host | Existing assets can be instanced and model nodes resized; source selection/relink remains user-mediated. |
| Selection and viewport | Yes | Yes | Browser host | Select, frame, camera view, tool, grid, snapping, and view state without renderer exposure. |
| Runtime and history | Yes | Yes | Browser host | Play/pause/resume/fixed-step/stop, clean Preview/exit, and undo/redo remain subject to editor mode rules. |
| Console and layout | Yes | Yes | Browser host | Bounded console reads/clear and panel/experience controls. |
| Save/export/build | Contextual | Yes | Browser host | Explicit host actions; downloads remain visible to the user. |
| Project/model file selection | No path access | Request only | Browser host | An agent can request the picker; only the user chooses a file. |
| Raw asset bytes | Metadata only | No | Planned staged transfer | Large binary data does not travel in ordinary tool JSON. |
| Scripts, physics, audio, animation, UI canvas | Not yet | Not yet | Future registry entries | Their human and agent surfaces must ship together. |

## Proposal, approval, and commit flow

The current built-in assistant follows a propose-then-apply workflow:

1. The planner receives a cloned project snapshot, stable selected-node ID, and prompt.
2. Read-only plans may run immediately and return structured summaries.
3. Mutating plans become visible proposals listing their tool calls and effects.
4. The user can discard or explicitly apply the proposal.
5. A pure project-tool batch resolves intra-plan references, validates each operation against a working clone, and aborts the whole batch if any call fails.
6. A successful changed project batch enters the normal editor commit path once, producing one Undo step.

Project-tool writes and live editor-host actions are reviewed as separate transactions. Mutating editor-host actions are proposed one at a time because live browser/session state cannot yet be rolled back atomically.

The editor synchronously reserves one pending mutation proposal before returning `approval_required`. A concurrent mutation request is rejected until that proposal is applied or discarded, so every returned proposal ID continues to identify the visible review surface. Essentials shows exact changed values in plain language; Advanced also exposes validated structured arguments. Context-sensitive locked-node, root, hierarchy, camera, and light operations are elevated to the high-attention review treatment.

All assistant-authored writes currently receive a visible review boundary, including changes whose capability metadata would permit a trusted host to run them without additional confirmation. Destructive calls such as subtree deletion always require explicit approval. Locked-node, scene-root, hierarchy, camera, and light changes can dynamically escalate a `when-sensitive` policy to `required`.

An agent never approves its own operation. File selection, external communication, destructive changes, and future irreversible operations must retain an editor-owned user boundary even if an external client claims it already asked permission.

## Authoring revision and conflicts

Project schema version and authoring revision are different values. The browser host maintains a monotonic authoring revision for the open editing session. A proposal records the revision it was planned against and may apply only if that revision still matches. If a human, another proposal, Undo/Redo, import, or another authorized caller changes the project first, the stale proposal must be discarded and planned again.

External mutation envelopes must include:

- Target project/session identity.
- `baseRevision`.
- A client-generated `operationId` for retry deduplication.
- Typed calls and an optional human-readable label.
- A server-issued approval reference when required.

The current bridge returns a structured `revision_conflict` result with the current revision when `baseRevision` is stale; it must never silently overwrite intervening work. Pure project-tool transactions increment revision once after atomic commit. `updatedAt` is display/persistence metadata, not a concurrency token.

The local milestone's in-browser revision guard is the beginning of this contract. Durable revision heads, operation deduplication, actor attribution, and an append-only event log are required before collaborative or remote mutation ships.

## Browser bridge

The browser bridge is an integration seam for trusted same-page code and automated verification. It exposes cloned data and typed operations rather than UI internals:

```ts
window.__THREE_GAME_STUDIO_AGENT__ = {
  apiVersion: 1,
  manifest(),
  snapshot(),
  request({ tool, arguments, baseRevision, requestId }),
  subscribe(listener), // returns unsubscribe
};
```

Read requests return a structured `completed` result. A mutating bridge request does not silently edit the project: it returns `approval_required`, opens the matching proposal in the Assistant, and waits for the user to Apply or Discard it. Subscribers receive bounded events for proposal creation/application/dismissal and project revision changes.

Its contract must remain:

- Versioned and limited to the current open editor page.
- Snapshot reads return clones.
- Mutation calls require the expected authoring revision.
- Results are structured and never depend on parsing toast text.
- No DOM nodes, React setters, Three.js instances, browser object URLs, raw IndexedDB handles, credentials, or arbitrary code execution are exposed.

The global bridge is **not an MCP server** and is not an authentication or authorization boundary. Its scope labels are advisory until a trusted host enforces them, and any code executing in the same page realm can invoke its read operations or submit a proposal. Installing the future external connection must be opt-in and requires a companion adapter with pairing, authentication, enforced scopes, rate/size limits, cancellation, and audit attribution.

## External MCP phase

The first external adapter should be a local sidecar using MCP stdio toward the user's MCP host. The sidecar should serve or pair with the local editor over a loopback-only authenticated channel:

- Bind to `127.0.0.1`, never every interface.
- Require a high-entropy, one-time pairing flow confirmed in the editor.
- Validate the browser origin and assign a random per-tab session ID.
- Start read-only and grant project/editor/file/build scopes explicitly.
- Treat the browser as final authority for revision and approval checks.
- Reuse the existing capability manifest and executors rather than reimplementing project behavior.

This sidecar is planned, not present in the current repository. A hosted MCP service is a later collaboration phase and would require HTTPS Streamable HTTP, OAuth, resource-bound authorization, durable project storage, and server-side audit. An HTTPS-hosted page should not assume it can safely or reliably connect to an arbitrary unauthenticated local WebSocket.

## Built-in model-provider phase

The current Guided Assistant is intentionally local and deterministic. It recognizes a bounded set of scene summaries, creation, transform, material, behavior, visibility, duplication, deletion, and world-background requests. It can also accept structured tool-call JSON. This proves the planning, review, validation, commit, and Undo path without pretending a language model is present.

A future model-backed provider will receive the same cloned context and capability manifest, then return the same proposal shape. Provider/model code remains outside the editor core.

No cloud API key may be embedded in Vite variables, shipped JavaScript, localStorage, prompts, logs, or project packages. A real cloud provider requires one of:

- A secure backend/token broker.
- A desktop or local companion using operating-system secret storage.
- A local model.
- An external MCP host that already owns its model credentials.

The browser assistant must not ask users to paste provider secrets into an ordinary project form.

## Binary assets

The current browser host may request the existing project/model file picker, but the user chooses the file and the importer enforces its normal validation. Agents receive model metadata and stable asset IDs, not arbitrary filesystem paths or IndexedDB handles.

Large binaries must not be base64-encoded into normal MCP or model tool calls. The external asset phase should use a staged protocol:

1. `prepare` declares filename, MIME type, byte length, SHA-256 digest, and intent.
2. The trusted adapter returns a short-lived upload ID and size/type limits.
3. Bytes transfer out of band over an authenticated, chunked local or hosted endpoint.
4. The browser verifies size/digest and runs the existing importer before mutation.
5. `complete` atomically stores the source, updates asset metadata/revision, and optionally creates an instance.
6. Abandoned staging records expire and are garbage-collected.

Relink uses the same sequence with an expected asset revision. The adapter must never accept unrestricted `file://` paths or silently read folders.

## Audit and privacy roadmap

Every external or model-backed commit should eventually append a domain event containing project/revision, timestamp, actor type, authenticated session/client, operation ID, affected stable references, before/after hashes, approval reference, warnings, and outcome. Undo/Redo create new events rather than erasing prior history.

Do not record binary contents, access tokens, provider secrets, or raw prompts by default. The editor console remains operational feedback, not a durable security audit log.

## Delivery phases

1. **Shipped foundation:** typed manifest, pure project tools, capability/risk metadata, Guided Assistant, proposal review, atomic pure project-tool batch execution, browser-host tools, trusted same-page integration bridge, revision guard, normal history integration, and contract/browser tests.
2. **Parity hardening:** move remaining human-only project mutations behind shared commands, add schema-field coverage checks, durable operation envelopes, actor attribution, and append-only events.
3. **Local MCP sidecar:** stdio MCP adapter, loopback pairing, read-only discovery first, scoped writes, cancellation, and audit linkage.
4. **Staged assets/builds:** out-of-band binary transfer, digests, quotas, task progress, build artifact handles, and relink transactions.
5. **Model-backed assistant:** provider abstraction connected to a local model, secure companion, or backend; same proposals and approvals.
6. **Hosted collaboration:** backend-authoritative revisions, object storage, OAuth-protected MCP transport, project membership, durable audit, and conflict-aware multi-user authoring.

The architectural rule across every phase is simple: adding more intelligence or transport must not create a more privileged mutation path than the one used by the human editor.
