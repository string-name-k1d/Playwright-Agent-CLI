export interface ElementInfo {
  ref: string;
  role: string;
  name: string;
  value?: string;
  url?: string;
  text?: string;
  level?: number;
  cursor?: string;
  description?: string;
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  selected?: boolean;
  orientation?: string;
}

export interface ContentBlock {
  ref: string;
  type: string;
  name: string;
  description?: string;
  children: { ref: string; role: string; name: string }[];
}

export const TABLE_ROLES = new Set([
  'cell', 'gridcell', 'columnheader', 'rowheader',
]);

export interface SnapshotElements {
  elements: ElementInfo[];
  links: { ref: string; name: string; url: string }[];
  headings: { ref: string; name: string; level: number }[];
  buttons: { ref: string; name: string }[];
  inputs: { ref: string; name: string; role: string; value?: string }[];
  images: { ref: string; name: string }[];
  regions: ElementInfo[];
  articles: ElementInfo[];
  groups: ElementInfo[];
  contentBlocks: ContentBlock[];
  dialogs: ElementInfo[];
  alerts: ElementInfo[];
  cells: { ref: string; name: string; role: string }[];
}

const BLOCK_ROLES = new Set([
  'article', 'section', 'region', 'group', 'form',
  'complementary', 'main', 'navigation', 'tabpanel',
  'figure', 'dialog', 'alert', 'toolbar', 'menu',
]);

const INPUT_ROLES = new Set([
  'textbox', 'combobox', 'checkbox', 'radio', 'searchbox',
  'spinbutton', 'slider', 'listbox', 'switch',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'tab', 'menuitem', 'option', 'treeitem',
]);

export function parseSnapshotElements(yaml: string): SnapshotElements {
  const elements: ElementInfo[] = [];
  const links: { ref: string; name: string; url: string }[] = [];
  const headings: { ref: string; name: string; level: number }[] = [];
  const buttons: { ref: string; name: string }[] = [];
  const inputs: { ref: string; name: string; role: string; value?: string }[] = [];
  const images: { ref: string; name: string }[] = [];
  const regions: ElementInfo[] = [];
  const articles: ElementInfo[] = [];
  const groups: ElementInfo[] = [];
  const dialogs: ElementInfo[] = [];
  const alerts: ElementInfo[] = [];
  const cells: { ref: string; name: string; role: string }[] = [];

  const lines = yaml.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const refMatch = line.match(/\[ref=(e\d+)\]/);
    if (!refMatch) continue;
    const ref = refMatch[1];

    const roleMatch = line.match(/- (\w[\w\s]*?)\s/);
    const role = roleMatch ? roleMatch[1].trim() : 'generic';

    const nameMatch = line.match(/"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : '';

    const cursorMatch = line.match(/\[cursor=(\w+)\]/);
    const levelMatch = line.match(/\[level=(\d+)\]/);
    const disabledMatch = line.match(/\[disabled\]/);
    const expandedMatch = line.match(/\[expanded=(true|false)\]/);
    const pressedMatch = line.match(/\[pressed=(true|false)\]/);
    const selectedMatch = line.match(/\[selected=(true|false)\]/);

    let url: string | undefined;
    let description: string | undefined;
    let value: string | undefined;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const childLine = lines[j];
      const childUrlMatch = childLine.match(/\/url:\s*(.+)/);
      if (childUrlMatch) {
        url = childUrlMatch[1].trim().replace(/^["']|["']$/g, '');
      }
      const childDescMatch = childLine.match(/\/description:\s*"([^"]+)"/);
      if (childDescMatch) {
        description = childDescMatch[1];
      }
      const childValueMatch = childLine.match(/\/value:\s*"([^"]+)"/);
      if (childValueMatch) {
        value = childValueMatch[1];
      }
      if (childLine.match(/\[ref=e\d+\]/)) break;
    }

    const element: ElementInfo = {
      ref,
      role,
      name,
      value,
      url,
      description,
      text: !name && role === 'text' ? line.replace(/.*-\s*/, '').trim() : undefined,
      level: levelMatch ? parseInt(levelMatch[1]) : undefined,
      cursor: cursorMatch?.[1],
      disabled: !!disabledMatch,
      expanded: expandedMatch ? expandedMatch[1] === 'true' : undefined,
      pressed: pressedMatch ? pressedMatch[1] === 'true' : undefined,
      selected: selectedMatch ? selectedMatch[1] === 'true' : undefined,
    };

    elements.push(element);

    if (url && (role === 'link' || role === 'navigation')) {
      links.push({ ref, name, url });
    }

    if (role === 'heading' && element.level) {
      headings.push({ ref, name, level: element.level });
    }

    if (role === 'button') {
      buttons.push({ ref, name });
    }

    if (INPUT_ROLES.has(role)) {
      inputs.push({ ref, name, role, value });
    }

    if (role === 'img' || role === 'image') {
      images.push({ ref, name });
    }

    if (role === 'region' || role === 'complementary' || role === 'main') {
      regions.push(element);
    }

    if (role === 'article' || role === 'figure') {
      articles.push(element);
    }

    if (role === 'group' || role === 'tabpanel') {
      groups.push(element);
    }

    if (role === 'dialog') {
      dialogs.push(element);
    }

    if (role === 'alert') {
      alerts.push(element);
    }

    if (TABLE_ROLES.has(role)) {
      cells.push({ ref, name, role });
    }
  }

  const contentBlocks = extractContentBlocks(elements, yaml);

  return {
    elements, links, headings, buttons, inputs, images,
    regions, articles, groups, contentBlocks, dialogs, alerts, cells,
  };
}

function extractContentBlocks(elements: ElementInfo[], yaml: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = yaml.split('\n');

  for (const el of elements) {
    if (!BLOCK_ROLES.has(el.role) && !el.role.includes(' ')) continue;
    const lineIdx = lines.findIndex(l => l.includes(`[ref=${el.ref}]`));
    if (lineIdx === -1) continue;

    const children: { ref: string; role: string; name: string }[] = [];
    const childDepth = (lines[lineIdx].match(/^  /g) || []).length + 1;

    for (let j = lineIdx + 1; j < lines.length; j++) {
      const l = lines[j];
      const d = (l.match(/^  /g) || []).length;
      if (d <= childDepth - 1) break;
      if (!l.includes('[ref=')) continue;
      const r = l.match(/\[ref=(e\d+)\]/)?.[1];
      const ro = l.match(/- (\w[\w\s]*?) /)?.[1]?.trim();
      const n = l.match(/"([^"]+)"/)?.[1] || '';
      if (r && ro) children.push({ ref: r, role: ro, name: n });
    }

    if (children.length > 0 || el.description) {
      blocks.push({
        ref: el.ref,
        type: el.role,
        name: el.name,
        description: el.description,
        children,
      });
    }
  }

  return blocks;
}

export function getContentBlockSummary(blocks: ContentBlock[]): string {
  const lines: string[] = [];
  if (blocks.length === 0) return '';

  lines.push('Content Blocks:');
  for (const b of blocks) {
    const desc = b.description ? ` — ${b.description}` : '';
    lines.push(`  [${b.ref}] ${b.type}: "${b.name}"${desc}`);
    for (const c of b.children) {
      lines.push(`    · [${c.ref}] ${c.role}: "${c.name}"`);
    }
  }
  return lines.join('\n');
}

export function searchElements(elements: ElementInfo[], query: string): ElementInfo[] {
  const q = query.toLowerCase();
  return elements.filter(el =>
    el.name.toLowerCase().includes(q) ||
    el.ref.toLowerCase().includes(q) ||
    el.role.toLowerCase().includes(q) ||
    (el.text && el.text.toLowerCase().includes(q)) ||
    (el.url && el.url.toLowerCase().includes(q)) ||
    (el.description && el.description.toLowerCase().includes(q))
  );
}

export function extractLinks(elements: ElementInfo[]): { ref: string; name: string; url: string }[] {
  return elements
    .filter(el => el.url && (el.role === 'link' || el.role === 'navigation'))
    .map(el => ({ ref: el.ref, name: el.name, url: el.url! }));
}

export function extractUrls(elements: ElementInfo[]): { name: string; url: string }[] {
  return elements
    .filter(el => el.url)
    .map(el => ({ name: el.name || el.text || el.ref, url: el.url! }));
}

export function getElementSummary(elements: SnapshotElements): string {
  const lines: string[] = [];

  if (elements.contentBlocks.length > 0) {
    lines.push(getContentBlockSummary(elements.contentBlocks));
    lines.push('');
  }

  if (elements.links.length > 0) {
    lines.push('Links:');
    for (const l of elements.links.slice(0, 30)) {
      const locator = `getByRole('link', { name: '${l.name.replace(/'/g, "\\'")}' })`;
      lines.push(`  [${l.ref}] "${l.name}" → ${l.url}  (${locator})`);
    }
  }

  if (elements.headings.length > 0) {
    lines.push('Headings:');
    for (const h of elements.headings.slice(0, 20)) {
      const locator = `getByRole('heading', { name: '${h.name.replace(/'/g, "\\'")}', level: ${h.level} })`;
      lines.push(`  [${h.ref}] H${h.level}: "${h.name}"  (${locator})`);
    }
  }

  if (elements.buttons.length > 0) {
    lines.push('Buttons:');
    for (const b of elements.buttons.slice(0, 15)) {
      const locator = `getByRole('button', { name: '${b.name.replace(/'/g, "\\'")}' })`;
      lines.push(`  [${b.ref}] "${b.name}"  (${locator})`);
    }
  }

  if (elements.inputs.length > 0) {
    lines.push('Inputs:');
    for (const inp of elements.inputs.slice(0, 15)) {
      const val = inp.value !== undefined ? ` /value="${inp.value}"` : '';
      const locator = `getByRole('${inp.role}', { name: '${inp.name.replace(/'/g, "\\'")}' })`;
      lines.push(`  [${inp.ref}] ${inp.role}: "${inp.name}"${val}  (${locator})`);
    }
  }

  if (elements.images.length > 0) {
    lines.push('Images:');
    for (const img of elements.images.slice(0, 10)) {
      const locator = `getByRole('img', { name: '${img.name.replace(/'/g, "\\'")}' })`;
      lines.push(`  [${img.ref}] "${img.name}"  (${locator})`);
    }
  }

  if (elements.regions.length > 0) {
    lines.push('Landmarks:');
    for (const r of elements.regions.slice(0, 10)) {
      lines.push(`  [${r.ref}] ${r.role}: "${r.name}"`);
    }
  }

  if (elements.dialogs.length > 0) {
    lines.push('Dialogs:');
    for (const d of elements.dialogs) {
      lines.push(`  [${d.ref}] "${d.name}"`);
    }
  }

  if (elements.alerts.length > 0) {
    lines.push('Alerts:');
    for (const a of elements.alerts) {
      lines.push(`  [${a.ref}] "${a.name}"`);
    }
  }

  if (elements.cells.length > 0) {
    const headers = elements.cells.filter(c => c.role === 'columnheader' || c.role === 'rowheader');
    const dataCells = elements.cells.filter(c => c.role === 'cell' || c.role === 'gridcell');
    if (headers.length > 0) {
      lines.push('Table columns:');
      lines.push(`  ${headers.map(c => c.name).join(' │ ')}`);
    }
    if (dataCells.length > 0) {
      lines.push('Table data:');
      for (const c of dataCells.slice(0, 40)) {
        lines.push(`  [${c.ref}] ${c.name}`);
      }
    }
  }

  return lines.join('\n');
}
