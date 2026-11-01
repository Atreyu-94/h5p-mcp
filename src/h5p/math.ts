import type {Native} from '../domain/types.js';
import {checkTree} from '../domain/limits.js';
// MathDisplay is an addon, not a runnable activity. Never download on export.
const MATH_LIBRARY = { machineName: 'H5P.MathDisplay', majorVersion: 1, minorVersion: 0 };

export function containsLatex(value: unknown): boolean {
  checkTree(value);
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string' && /\\\(|\\\[|\$\$/.test(current)) return true;
    if (current && typeof current === 'object') stack.push(...Object.values(current));
  }
  return false;
}

export async function inspectMath(manager: Native, params: unknown): Promise<Native> {
  if (!containsLatex(params)) return { detected: false };
  try {
    const library = await manager.getLibrary(MATH_LIBRARY);
    return { detected: true, installed: true, library: 'H5P.MathDisplay 1.0', patch_version: library.patchVersion };
  } catch {
    return { detected: true, installed: false, library: 'H5P.MathDisplay 1.0',
      error: 'LaTeX requires H5P.MathDisplay 1.0. Install the official addon with h5p-mcp admin package <absolute MathDisplay.h5p path>; export never downloads it.' };
  }
}
