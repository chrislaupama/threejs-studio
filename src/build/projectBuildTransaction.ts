import type { ProjectDocumentV5 } from '../editor/types';

export interface ProjectBuildSnapshot {
  readonly project: ProjectDocumentV5;
  readonly revision: number;
}

export class BuildRevisionConflictError extends Error {
  readonly code = 'build_revision_conflict';
  readonly retryable = true;

  constructor(
    readonly buildRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Project changed from revision ${buildRevision} to ${currentRevision} while the build was being prepared. Run the build again.`,
    );
    this.name = 'BuildRevisionConflictError';
  }
}

function deepFreezeSnapshot<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const pending: object[] = [value];
  const visited: object[] = [];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    visited.push(current);
    for (const child of Object.values(current)) {
      if (typeof child === 'object' && child !== null) pending.push(child);
    }
  }
  for (let index = visited.length - 1; index >= 0; index -= 1) Object.freeze(visited[index]);
  return value;
}

/**
 * Captures the exact serializable authoring state a build is allowed to use.
 * The clone prevents later editor mutations from changing a build in flight.
 */
export function captureProjectBuildSnapshot(
  project: ProjectDocumentV5,
  revision: number,
): ProjectBuildSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError('Build revision must be a non-negative safe integer.');
  }
  return Object.freeze({
    project: deepFreezeSnapshot(structuredClone(project)),
    revision,
  });
}

/** Rejects a stale build before it can compile, package, or download an artifact. */
export function assertProjectBuildRevision(
  snapshot: Pick<ProjectBuildSnapshot, 'revision'>,
  currentRevision: number,
): void {
  if (currentRevision !== snapshot.revision) {
    throw new BuildRevisionConflictError(snapshot.revision, currentRevision);
  }
}
