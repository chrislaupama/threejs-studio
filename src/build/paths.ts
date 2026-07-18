const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const URL_OR_WINDOWS_RESERVED = /[%:?#<>"|*]/u;
const WINDOWS_DRIVE = /^[a-zA-Z]:/u;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_AMBIGUOUS_SEGMENT_END = /[. ]$/u;

export class BuildPathError extends Error {
  readonly code = 'invalid_build_path';

  constructor(readonly input: string, message: string) {
    super(`Invalid build path ${JSON.stringify(input)}: ${message}`);
    this.name = 'BuildPathError';
  }
}

/**
 * Produces a portable ZIP/static-host path. Dot segments and repeated separators
 * are normalized, while traversal, absolute, URL-like, and ambiguous encoded
 * paths are rejected before an archive is created.
 */
export function normalizeBuildPath(input: string): string {
  if (typeof input !== 'string') throw new BuildPathError(String(input), 'the path must be a string.');
  if (!input.length) throw new BuildPathError(input, 'the path cannot be empty.');
  if (input !== input.trim()) throw new BuildPathError(input, 'leading or trailing whitespace is not allowed.');
  if (CONTROL_CHARACTER.test(input)) throw new BuildPathError(input, 'control characters are not allowed.');
  if (URL_OR_WINDOWS_RESERVED.test(input)) {
    throw new BuildPathError(input, 'URL escapes, URL delimiters, and platform-reserved characters are not allowed.');
  }

  const slashed = input.replaceAll('\\', '/').normalize('NFC');
  if (slashed.startsWith('/') || slashed.startsWith('//') || WINDOWS_DRIVE.test(input)) {
    throw new BuildPathError(input, 'absolute paths are not allowed.');
  }
  if (slashed.endsWith('/')) throw new BuildPathError(input, 'file paths cannot end with a separator.');

  const normalizedSegments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw new BuildPathError(input, 'parent traversal is not allowed.');
    if (WINDOWS_AMBIGUOUS_SEGMENT_END.test(segment)) {
      throw new BuildPathError(input, 'path segments cannot end with a dot or space.');
    }
    if (WINDOWS_DEVICE_NAME.test(segment)) {
      throw new BuildPathError(input, 'Windows reserved device names are not allowed.');
    }
    normalizedSegments.push(segment);
  }

  if (!normalizedSegments.length) throw new BuildPathError(input, 'the path must identify a file.');
  return normalizedSegments.join('/');
}

export function normalizeBuildFilename(input: string): string {
  const normalized = normalizeBuildPath(input);
  if (normalized.includes('/')) throw new BuildPathError(input, 'archive filenames cannot contain directories.');
  return normalized.toLowerCase().endsWith('.zip') ? normalized : `${normalized}.zip`;
}
