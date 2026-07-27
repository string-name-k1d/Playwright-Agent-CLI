export interface ElementInfo {
  ref: string;
  role: string;
  name: string;
  url?: string;
  text?: string;
  level?: number;
  cursor?: string;
}

export interface SnapshotElements {
  elements: ElementInfo[];
  links: { ref: string; name: string; url: string }[];
  headings: { ref: string; name: string; level: number }[];
  buttons: { ref: string; name: string }[];
  inputs: { ref: string; name: string; role: string }[];
  images: { ref: string; name: string }[];
}

export function parseSnapshotElements(yaml: string): SnapshotElements {
  const elements: ElementInfo[] = [];
  const links: { ref: string; name: string; url: string }[] = [];
  const headings: { ref: string; name: string; level: number }[] = [];
  const buttons: { ref: string; name: string }[] = [];
  const inputs: { ref: string; name: string; role: string }[] = [];
  const images: { ref: string; name: string }[] = [];

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

    // Look ahead for /url: on child lines (within next 5 lines)
    let url: string | undefined;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const childUrlMatch = lines[j].match(/\/url:\s*(.+)/);
      if (childUrlMatch) {
        url = childUrlMatch[1].trim().replace(/^["']|["']$/g, '');
        break;
      }
      // Stop looking if we hit another element with a ref
      if (lines[j].match(/\[ref=e\d+\]/)) break;
    }

    const cursorMatch = line.match(/\[cursor=(\w+)\]/);
    const levelMatch = line.match(/\[level=(\d+)\]/);

    const element: ElementInfo = {
      ref,
      role,
      name,
      url,
      text: !name && role === 'text' ? line.replace(/.*-\s*/, '').trim() : undefined,
      level: levelMatch ? parseInt(levelMatch[1]) : undefined,
      cursor: cursorMatch?.[1],
    };

    elements.push(element);

    if (url && (role === 'link' || role === 'navigation')) {
      links.push({ ref, name, url });
    }

    if (role === 'heading' && element.level) {
      headings.push({ ref, name, level: element.level });
    }

    if (role === 'button' || (role === 'link' && name)) {
      buttons.push({ ref, name });
    }

    if (['textbox', 'combobox', 'checkbox', 'radio', 'searchbox', 'spinbutton'].includes(role)) {
      inputs.push({ ref, name, role });
    }

    if (role === 'img' || role === 'image') {
      images.push({ ref, name });
    }
  }

  return { elements, links, headings, buttons, inputs, images };
}

export function searchElements(elements: ElementInfo[], query: string): ElementInfo[] {
  const q = query.toLowerCase();
  return elements.filter(el =>
    el.name.toLowerCase().includes(q) ||
    el.ref.toLowerCase().includes(q) ||
    el.role.toLowerCase().includes(q) ||
    (el.text && el.text.toLowerCase().includes(q)) ||
    (el.url && el.url.toLowerCase().includes(q))
  );
}

export function extractLinks(elements: ElementInfo[]): { ref: string; name: string; url: string }[] {
  return elements
    .filter(el => el.url && (el.role === 'link' || el.role === 'navigation'))
    .map(el => ({ ref: el.ref, name: el.name, url: el.url! }));
}

export function getElementSummary(elements: SnapshotElements): string {
  const lines: string[] = [];

  if (elements.links.length > 0) {
    lines.push('Links:');
    for (const l of elements.links.slice(0, 30)) {
      lines.push(`  [${l.ref}] "${l.name}" → ${l.url}`);
    }
  }

  if (elements.headings.length > 0) {
    lines.push('Headings:');
    for (const h of elements.headings.slice(0, 20)) {
      lines.push(`  [${h.ref}] H${h.level}: "${h.name}"`);
    }
  }

  if (elements.buttons.length > 0) {
    lines.push('Buttons:');
    for (const b of elements.buttons.slice(0, 15)) {
      lines.push(`  [${b.ref}] "${b.name}"`);
    }
  }

  if (elements.inputs.length > 0) {
    lines.push('Inputs:');
    for (const inp of elements.inputs.slice(0, 15)) {
      lines.push(`  [${inp.ref}] ${inp.role}: "${inp.name}"`);
    }
  }

  if (elements.images.length > 0) {
    lines.push('Images:');
    for (const img of elements.images.slice(0, 10)) {
      lines.push(`  [${img.ref}] "${img.name}"`);
    }
  }

  return lines.join('\n');
}
