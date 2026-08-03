import type { ElementInfo } from './snapshot-parser.js';

/**
 * Hierarchical representation of a page snapshot. The snapshot YAML is
 * indentation-based (each level = 2 spaces) so parent/child relationships
 * can be recovered directly from the serialized AX tree.
 */

export interface TreeNode {
  ref: string;
  role: string;
  name: string;
  text?: string;
  url?: string;
  value?: string;
  description?: string;
  level?: number;
  cursor?: string;
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  selected?: boolean;
  selector?: string;
  domId?: string;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  depth: number;
  /** Human-readable hierarchy path, e.g. "main > region > button". */
  path: string;
  /** Refs of ancestors, root-first (excludes self). */
  ancestors: string[];
  children: TreeNode[];
}

export interface ElementTree {
  root: TreeNode | null;
  nodes: TreeNode[];
  byRef: Map<string, TreeNode>;
  interactive: TreeNode[];
  links: TreeNode[];
  headings: TreeNode[];
  inputs: TreeNode[];
  buttons: TreeNode[];
}

/**
 * Flat registry record for a tree node. Stored per-page inside the website
 * profile so element lookups can be answered without re-parsing snapshots.
 */
export interface TreeRecord {
  ref: string;
  role: string;
  name: string;
  text?: string;
  url?: string;
  value?: string;
  description?: string;
  level?: number;
  selector?: string;
  domId?: string;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  pageUrl: string;
  path: string;
  depth: number;
  childRefs: string[];
  ancestorRefs: string[];
}

const INPUT_ROLES = new Set([
  'textbox', 'combobox', 'checkbox', 'radio', 'searchbox',
  'spinbutton', 'slider', 'listbox', 'switch',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'tab', 'menuitem', 'option', 'treeitem',
]);

function roleIsInteractive(role: string): boolean {
  return INPUT_ROLES.has(role) || INTERACTIVE_ROLES.has(role);
}

function computePath(parent: TreeNode | null, role: string): string {
  if (role === 'RootWebArea' || role === 'generic') return parent?.path ?? '';
  const parts: string[] = [];
  if (parent && parent.path) parts.push(parent.path);
  parts.push(role);
  return parts.join(' > ');
}

interface ParsedLine {
  role: string;
  name: string;
  level?: number;
  cursor?: string;
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  selected?: boolean;
}

function parseElementLine(line: string): ParsedLine | null {
  const isText = /^\s*-\s*"/.test(line);
  let role = 'generic';
  let name = '';
  if (isText) {
    role = 'text';
    const nameMatch = line.match(/"([^"]+)"/);
    name = nameMatch ? nameMatch[1] : '';
  } else {
    const roleMatch = line.match(/-\s+([\w-]+)/);
    role = roleMatch ? roleMatch[1] : 'generic';
    const nameMatch = line.match(/"([^"]+)"/);
    name = nameMatch ? nameMatch[1] : '';
  }

  const levelMatch = line.match(/\[level=(\d+)\]/);
  const cursorMatch = line.match(/\[cursor=(\w+)\]/);
  const disabledMatch = line.match(/\[disabled\]/);
  const expandedMatch = line.match(/\[expanded=(true|false)\]/);
  const pressedMatch = line.match(/\[pressed=(true|false)\]/);
  const selectedMatch = line.match(/\[selected=(true|false)\]/);

  return {
    role,
    name,
    level: levelMatch ? parseInt(levelMatch[1], 10) : undefined,
    cursor: cursorMatch?.[1],
    disabled: !!disabledMatch,
    expanded: expandedMatch ? expandedMatch[1] === 'true' : undefined,
    pressed: pressedMatch ? pressedMatch[1] === 'true' : undefined,
    selected: selectedMatch ? selectedMatch[1] === 'true' : undefined,
  };
}

/**
 * Builds a hierarchical element tree from a snapshot YAML document.
 * Preserves the AX-tree parent/child structure via indentation and tags each
 * node with its hierarchy path (e.g. "main > region > button").
 */
export function buildElementTree(yaml: string): ElementTree {
  const nodes: TreeNode[] = [];
  const byRef = new Map<string, TreeNode>();
  const interactive: TreeNode[] = [];
  const links: TreeNode[] = [];
  const headings: TreeNode[] = [];
  const inputs: TreeNode[] = [];
  const buttons: TreeNode[] = [];
  const stack: TreeNode[] = [];

  const lines = yaml.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const refMatch = line.match(/\[ref=(e\d+)\]/);
    if (!refMatch) continue;

    const parsed = parseElementLine(line);
    if (!parsed) continue;
    const ref = refMatch[1];
    const leading = (line.match(/^ */)?.[0]?.length ?? 0);
    const depth = leading / 2;

    let url: string | undefined;
    let description: string | undefined;
    let value: string | undefined;
    let selector: string | undefined;
    let domId: string | undefined;
    let required: boolean | undefined;
    let min: number | undefined;
    let max: number | undefined;
    let placeholder: string | undefined;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const childLine = lines[j];
      const childUrl = childLine.match(/\/url:\s*(.+)/);
      if (childUrl) url = childUrl[1].trim().replace(/^["']|["']$/g, '');
      const childDesc = childLine.match(/\/description:\s*"([^"]+)"/);
      if (childDesc) description = childDesc[1];
      const childValue = childLine.match(/\/value:\s*"([^"]+)"/);
      if (childValue) value = childValue[1];
      const childSelector = childLine.match(/\/selector:\s*(.+)/);
      if (childSelector) selector = childSelector[1].trim();
      const childDomId = childLine.match(/\/domid:\s*(.+)/);
      if (childDomId) domId = childDomId[1].trim();
      if (/\/required:\s*true/.test(childLine)) required = true;
      const childMin = childLine.match(/\/min:\s*(-?\d+(?:\.\d+)?)/);
      if (childMin) min = parseFloat(childMin[1]);
      const childMax = childLine.match(/\/max:\s*(-?\d+(?:\.\d+)?)/);
      if (childMax) max = parseFloat(childMax[1]);
      const childPlaceholder = childLine.match(/\/placeholder:\s*"([^"]+)"/);
      if (childPlaceholder) placeholder = childPlaceholder[1];
      if (/\[ref=e\d+\]/.test(childLine)) break;
    }

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const ancestors = parent ? [...parent.ancestors, parent.ref] : [];
    const path = computePath(parent, parsed.role);

    const node: TreeNode = {
      ref,
      role: parsed.role,
      name: parsed.name,
      url,
      description,
      value,
      level: parsed.level,
      cursor: parsed.cursor,
      disabled: parsed.disabled,
      expanded: parsed.expanded,
      pressed: parsed.pressed,
      selected: parsed.selected,
      selector,
      domId,
      required,
      min,
      max,
      placeholder,
      depth,
      path,
      ancestors,
      children: [],
    };
    if (parsed.role === 'text') node.text = parsed.name;

    if (parent) parent.children.push(node);
    nodes.push(node);
    byRef.set(ref, node);

    if (roleIsInteractive(node.role)) interactive.push(node);
    if (node.url && (node.role === 'link' || node.role === 'navigation')) links.push(node);
    if (node.role === 'heading') headings.push(node);
    if (INPUT_ROLES.has(node.role)) inputs.push(node);
    if (node.role === 'button') buttons.push(node);

    stack.push(node);
  }

  const root = nodes.find(n => n.ancestors.length === 0) ?? null;
  return { root, nodes, byRef, interactive, links, headings, inputs, buttons };
}

/**
 * Flattens a tree into registry records for the website profile.
 * The page root (RootWebArea) is excluded — top-level landmarks become roots
 * in the reconstructed records tree.
 */
export function toTreeRecords(tree: ElementTree, pageUrl: string): TreeRecord[] {
  return tree.nodes
    .filter(n => n.role !== 'RootWebArea')
    .map(n => ({
      ref: n.ref,
      role: n.role,
      name: n.name,
      text: n.text,
      url: n.url,
      value: n.value,
      description: n.description,
      level: n.level,
      selector: n.selector,
      domId: n.domId,
      required: n.required,
      min: n.min,
      max: n.max,
      placeholder: n.placeholder,
      disabled: n.disabled,
      pageUrl,
      path: n.path,
      depth: n.depth,
      childRefs: n.children.map(c => c.ref),
      ancestorRefs: n.ancestors,
    }));
}

/**
 * Reconstructs a TreeNode hierarchy from stored TreeRecords (no snapshot
 * needed). Top-level landmarks become the roots since RootWebArea is not
 * stored.
 */
export function treeFromRecords(records: TreeRecord[]): ElementTree | null {
  if (records.length === 0) return null;

  const byRef = new Map<string, TreeNode>();
  for (const r of records) {
    byRef.set(r.ref, {
      ref: r.ref,
      role: r.role,
      name: r.name,
      text: r.text,
      url: r.url,
      value: r.value,
      description: r.description,
      level: r.level,
      selector: r.selector,
      domId: r.domId,
      required: r.required,
      min: r.min,
      max: r.max,
      placeholder: r.placeholder,
      depth: r.depth,
      path: r.path,
      ancestors: r.ancestorRefs,
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const r of records) {
    const node = byRef.get(r.ref)!;
    const parentRef = r.ancestorRefs[r.ancestorRefs.length - 1];
    const parent = parentRef ? byRef.get(parentRef) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  for (const r of records) {
    const node = byRef.get(r.ref)!;
    node.children = r.childRefs.map(c => byRef.get(c)).filter((n): n is TreeNode => !!n);
  }

  const root = roots[0] ?? null;
  const nodes = records.map(r => byRef.get(r.ref)!);
  return {
    root,
    nodes,
    byRef,
    interactive: nodes.filter(n => roleIsInteractive(n.role)),
    links: nodes.filter(n => n.url && (n.role === 'link' || n.role === 'navigation')),
    headings: nodes.filter(n => n.role === 'heading'),
    inputs: nodes.filter(n => INPUT_ROLES.has(n.role)),
    buttons: nodes.filter(n => n.role === 'button'),
  };
}

/**
 * Generates a Playwright locator expression for an element. `[eN]` refs are
 * informational only — resolution happens via role + name.
 */
export function locatorFor(role: string, name: string): string {
  const escaped = name.replace(/'/g, "\\'");
  if (role === 'text' || role === 'paragraph' || role === 'StaticText') {
    return `getByText('${escaped}', { exact: true })`;
  }
  return `getByRole('${role}', { name: '${escaped}' })`;
}

export function nodeLabel(node: TreeNode, opts: { includeUrl?: boolean; includeSelector?: boolean } = {}): string {
  let label = `${node.role}${node.name ? ` "${node.name}"` : ''} [${node.ref}]`;
  if (opts.includeUrl && node.url) label += ` → ${node.url}`;
  if (node.role === 'heading' && node.level) label += ` (H${node.level})`;
  if (node.value !== undefined && node.value !== '') label += ` = "${node.value}"`;
  if (opts.includeSelector && node.selector) label += ` [${node.selector}]`;
  return label;
}

/** Renders a node and its descendants as an indented tree. */
export function formatTreeNode(node: TreeNode, opts: { includeText?: boolean } = {}): string {
  const lines: string[] = [];
  const render = (n: TreeNode, prefix: string, isLast: boolean): void => {
    lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${nodeLabel(n, { includeUrl: true })}`);
    const kids = opts.includeText ? n.children : n.children.filter(c => c.role !== 'text');
    for (let i = 0; i < kids.length; i++) {
      render(kids[i], prefix + (isLast ? '   ' : '│  '), i === kids.length - 1);
    }
  };
  render(node, '', true);
  return lines.join('\n');
}

export function formatTree(tree: ElementTree, opts: { includeText?: boolean } = {}): string {
  const root = tree.root;
  if (!root) return '(empty tree)';
  return formatTreeNode(root, opts);
}

export function treeNodeToElementInfo(n: TreeNode): ElementInfo {
  return {
    ref: n.ref,
    role: n.role,
    name: n.name,
    value: n.value,
    url: n.url,
    text: n.text,
    level: n.level,
    cursor: n.cursor,
    description: n.description,
    disabled: n.disabled,
    expanded: n.expanded,
    pressed: n.pressed,
    selected: n.selected,
    selector: n.selector,
    domId: n.domId,
    required: n.required,
    min: n.min,
    max: n.max,
    placeholder: n.placeholder,
  };
}
