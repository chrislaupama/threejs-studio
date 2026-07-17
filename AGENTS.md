# ThreeJS Studio contributor contract

## AI parity is a shipping requirement

Every authorable feature must be usable through both the human editor and the typed authoring-tool layer. A control is not complete when it exists only as a React callback or direct Three.js mutation.

- Keep `ProjectDocument` authoritative. Tools accept and return serializable data; never expose `Object3D`, renderer, DOM, React state, object URLs, or browser handles as the project API.
- Add or update a capability in `src/editor/agentTools.ts` whenever a project field, asset reference, gameplay component, world setting, build action, or editor/runtime action is added.
- Reuse the same pure project operations for human and agent workflows. Agent mutations must enter the normal commit/history path so they are validated, logged, autosaved, and undoable.
- Give every tool an explicit input schema, description, scope, read/write effect, approval policy, and availability constraints. File selection, external communication, destructive changes, and irreversible operations require a visible human-review boundary.
- Validate tool arguments before execution and validate the complete project after a mutation. Never partially apply a failed multi-tool plan.
- External callers must use optimistic revision checks. Return structured results and stable error codes instead of relying on toast text.
- Keep model/provider logic outside the editor core. The built-in assistant, an OpenAI Agents SDK service, and an MCP adapter should consume the same capability manifest and executor.
- Add contract tests for new tools plus a browser test proving the resulting mutation is visible and undoable. Update the AI capability matrix in `docs/AI_ARCHITECTURE.md`.

If a new human control cannot yet be exposed safely to agents, document the gap and the required approval/transport work before calling the feature complete.
