export const SCRIPT_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'] as const;
export const MAX_SCRIPT_FILE_COUNT = 512;
export const MAX_SCRIPT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SCRIPT_PROJECT_BYTES = 16 * 1024 * 1024;

export interface VirtualProjectFile {
  readonly path: string;
  readonly contents: string;
  readonly revision: number;
}

export interface VirtualProjectSnapshot {
  readonly revision: number;
  readonly files: readonly VirtualProjectFile[];
}

export type VirtualFileSystemErrorCode =
  | 'INVALID_PATH'
  | 'INVALID_CONTENT'
  | 'PATH_ESCAPES_ROOT'
  | 'UNSUPPORTED_EXTENSION'
  | 'DUPLICATE_FILE'
  | 'FILE_NOT_FOUND'
  | 'FILE_LIMIT_EXCEEDED'
  | 'FILE_TOO_LARGE'
  | 'PROJECT_TOO_LARGE';

export class VirtualFileSystemError extends Error {
  readonly code: VirtualFileSystemErrorCode;
  readonly path: string | null;

  constructor(code: VirtualFileSystemErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = 'VirtualFileSystemError';
    this.code = code;
    this.path = path;
  }
}

const textEncoder = new TextEncoder();

function sourceByteLength(contents: string) {
  return textEncoder.encode(contents).byteLength;
}

function hasSupportedExtension(path: string) {
  return SCRIPT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function directoryName(path: string) {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

export function normalizeVirtualPath(path: string, baseDirectory = '/'): string {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || path.includes('\\')) {
    throw new VirtualFileSystemError('INVALID_PATH', 'Virtual paths must be non-empty POSIX paths.', path || null);
  }
  if (path.includes('?') || path.includes('#') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(path)) {
    throw new VirtualFileSystemError('INVALID_PATH', 'Virtual paths cannot contain URLs, query strings, or fragments.', path);
  }

  const base = baseDirectory.startsWith('/') ? baseDirectory : `/${baseDirectory}`;
  const joined = path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path}`;
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new VirtualFileSystemError('PATH_ESCAPES_ROOT', `Virtual path "${path}" escapes the project root.`, path);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    throw new VirtualFileSystemError('INVALID_PATH', 'A virtual file path cannot resolve to the project root.', path);
  }
  return `/${segments.join('/')}`;
}

function validateFile(path: string, contents: string) {
  if (typeof contents !== 'string') {
    throw new VirtualFileSystemError('INVALID_CONTENT', `Script file "${path}" contents must be a string.`, path);
  }
  if (!hasSupportedExtension(path)) {
    throw new VirtualFileSystemError(
      'UNSUPPORTED_EXTENSION',
      `Script files must use one of: ${SCRIPT_SOURCE_EXTENSIONS.join(', ')}.`,
      path,
    );
  }
  const byteLength = sourceByteLength(contents);
  if (byteLength > MAX_SCRIPT_FILE_BYTES) {
    throw new VirtualFileSystemError(
      'FILE_TOO_LARGE',
      `Script file "${path}" exceeds the ${MAX_SCRIPT_FILE_BYTES} byte limit.`,
      path,
    );
  }
  return byteLength;
}

function validateProjectLimits(files: Iterable<Pick<VirtualProjectFile, 'path' | 'contents'>>) {
  let count = 0;
  let totalBytes = 0;
  for (const file of files) {
    count += 1;
    totalBytes += validateFile(file.path, file.contents);
  }
  if (count > MAX_SCRIPT_FILE_COUNT) {
    throw new VirtualFileSystemError(
      'FILE_LIMIT_EXCEEDED',
      `Script projects cannot contain more than ${MAX_SCRIPT_FILE_COUNT} files.`,
    );
  }
  if (totalBytes > MAX_SCRIPT_PROJECT_BYTES) {
    throw new VirtualFileSystemError(
      'PROJECT_TOO_LARGE',
      `Script project exceeds the ${MAX_SCRIPT_PROJECT_BYTES} byte limit.`,
    );
  }
}

export function createVirtualProjectSnapshot(
  files: readonly Pick<VirtualProjectFile, 'path' | 'contents'>[],
  revision = 0,
): VirtualProjectSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError('Virtual project revision must be a non-negative safe integer.');
  }
  const canonical = new Map<string, VirtualProjectFile>();
  for (const file of files) {
    const path = normalizeVirtualPath(file.path);
    if (canonical.has(path)) {
      throw new VirtualFileSystemError('DUPLICATE_FILE', `Duplicate virtual script path "${path}".`, path);
    }
    canonical.set(path, { path, contents: file.contents, revision });
  }
  validateProjectLimits(canonical.values());
  return {
    revision,
    files: [...canonical.values()].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export class VirtualProjectFileSystem {
  #revision: number;
  readonly #files = new Map<string, VirtualProjectFile>();

  constructor(snapshot: VirtualProjectSnapshot = { revision: 0, files: [] }) {
    const canonical = createVirtualProjectSnapshot(snapshot.files, snapshot.revision);
    this.#revision = canonical.revision;
    for (const file of canonical.files) this.#files.set(file.path, structuredClone(file));
  }

  get revision() {
    return this.#revision;
  }

  has(path: string) {
    return this.#files.has(normalizeVirtualPath(path));
  }

  readFile(path: string): VirtualProjectFile | null {
    const file = this.#files.get(normalizeVirtualPath(path));
    return file ? structuredClone(file) : null;
  }

  listFiles(): readonly VirtualProjectFile[] {
    return [...this.#files.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => structuredClone(file));
  }

  writeFile(pathValue: string, contents: string): VirtualProjectFile {
    const path = normalizeVirtualPath(pathValue);
    validateFile(path, contents);
    const existing = this.#files.get(path);
    const nextRevision = this.#revision + 1;
    const nextFile = { path, contents, revision: nextRevision };
    this.#files.set(path, nextFile);
    try {
      validateProjectLimits(this.#files.values());
    } catch (error) {
      if (existing) this.#files.set(path, existing);
      else this.#files.delete(path);
      throw error;
    }
    this.#revision = nextRevision;
    return structuredClone(nextFile);
  }

  deleteFile(pathValue: string): boolean {
    const path = normalizeVirtualPath(pathValue);
    if (!this.#files.delete(path)) return false;
    this.#revision += 1;
    return true;
  }

  snapshot(): VirtualProjectSnapshot {
    return {
      revision: this.#revision,
      files: this.listFiles(),
    };
  }
}

export function resolveVirtualImport(
  snapshot: VirtualProjectSnapshot,
  specifier: string,
  importerPath: string,
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const importer = normalizeVirtualPath(importerPath);
  const candidate = normalizeVirtualPath(specifier, directoryName(importer));
  const paths = new Set(snapshot.files.map((file) => file.path));
  const candidates = [candidate];
  if (!hasSupportedExtension(candidate)) {
    for (const extension of SCRIPT_SOURCE_EXTENSIONS) candidates.push(`${candidate}${extension}`);
    for (const extension of SCRIPT_SOURCE_EXTENSIONS) candidates.push(`${candidate}/index${extension}`);
  }
  return candidates.find((path) => paths.has(path)) ?? null;
}
