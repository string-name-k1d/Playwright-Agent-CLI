import { parseSnapshotElements, type ElementInfo } from './snapshot-parser.js';

interface LocatorMatch {
  role?: string;
  name?: string;
  isRegex?: boolean;
  nth?: number;
}

interface ResolvedRefs {
  refs: string[];
  note?: string;
}

/**
 * Post-processes a Playwright codegen output script, annotating each
 * getByRole/getByText/getByLabel locator with the matching accessibility
 * snapshot [eN] refs. Annotations are appended as trailing comments so the
 * file stays valid TypeScript.
 *
 * Repeating elements (multiple snapshot matches) are annotated with the full
 * ref list and a hint to disambiguate with .nth(), giving the AI generator an
 * unambiguous mapping for the "use element tags for repeating elements" flow.
 *
 * @param code - The raw codegen output (TypeScript spec)
 * @param snapshotContent - YAML accessibility snapshot captured during exploration
 * @returns The code with [eN] ref annotations appended as comments
 */
export function annotateCodegenSpec(code: string, snapshotContent?: string): string {
  if (!snapshotContent) return code;
  const parsed = parseSnapshotElements(snapshotContent);
  if (parsed.elements.length === 0) return code;

  const lines = code.split('\n');
  return lines.map((line) => annotateLine(line, parsed.elements)).join('\n');
}

function annotateLine(line: string, elements: ElementInfo[]): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return line;
  if (line.includes('[e')) return line;
  if (!/(getByRole|getByText|getByLabel)\(/.test(line)) return line;

  const locatorRe = /getByRole\(\s*['"]([a-z]+)['"]\s*(?:,\s*\{([^}]*)\})?|getByText\(\s*['"]([^'"]+)['"]|getByLabel\(\s*['"]([^'"]+)['"]/g;
  const locators = [...line.matchAll(locatorRe)];

  for (const m of locators) {
    const match: LocatorMatch = {};
    if (m[1] !== undefined) {
      match.role = m[1];
      const opts = m[2];
      if (opts) {
        const nm = opts.match(/name:\s*(['"/])(.*?)\1/);
        if (nm) {
          match.name = nm[2];
          match.isRegex = nm[1] === '/';
        }
      }
    } else if (m[3] !== undefined) {
      match.name = m[3];
    } else if (m[4] !== undefined) {
      match.name = m[4];
    }

    if (!match.name || match.name === '') continue;

    // Bound the chain scan to the current statement so a .nth() on a later
    // locator on the same line isn't misattributed to this one.
    const rest = line.slice(m.index! + m[0].length).split(';')[0];
    const nthMatch = rest.match(/\.nth\((\d+)\)/);
    const firstMatch = rest.match(/\.first\(\)/);
    match.nth = nthMatch ? parseInt(nthMatch[1], 10) : firstMatch ? 0 : undefined;

    const resolved = resolveRefs(elements, match);
    if (resolved) {
      const note = resolved.note ? ` (${resolved.note})` : '';
      return `${line} // [${resolved.refs.join(', ')}]${note}`;
    }
  }
  return line;
}

function resolveRefs(elements: ElementInfo[], match: LocatorMatch): ResolvedRefs | null {
  const { role, name, isRegex } = match;
  let candidates: ElementInfo[] = [];

  if (isRegex) {
    const re = new RegExp(name!);
    candidates = elements.filter((e) =>
      role
        ? e.role === role && re.test(e.name)
        : re.test(e.name) || (e.text !== undefined && re.test(e.text))
    );
  } else {
    // Exact-first: snapshot names match codegen locator names exactly in most
    // cases. Fall back to substring matching for names with markup/formatting.
    candidates = elements.filter((e) =>
      role
        ? e.role === role && e.name === name
        : e.name === name || (e.text !== undefined && e.text === name)
    );
    if (candidates.length === 0 && name!.length >= 3) {
      candidates = elements.filter((e) =>
        role
          ? e.role === role && (e.name.includes(name!) || name!.includes(e.name))
          : e.name.includes(name!) || (e.text !== undefined && e.text.includes(name!))
      );
    }
  }

  if (candidates.length === 0) return null;

  if (match.nth !== undefined && match.nth < candidates.length) {
    return { refs: [candidates[match.nth].ref] };
  }

  if (candidates.length === 1) {
    return { refs: [candidates[0].ref] };
  }

  return {
    refs: candidates.map((c) => c.ref),
    note: `${candidates.length} matches - use .nth()`,
  };
}
