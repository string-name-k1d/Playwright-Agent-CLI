import chalk from 'chalk';
import { chromium, type Browser, type BrowserContext, type Page, type BrowserContextOptions, type Locator } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ElementInfo } from './snapshot-parser.js';

interface CdpAxNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  properties?: { name: string; value: { type: string; value?: any } }[];
  states?: { name: string; value?: { type: string; value?: any } }[];
  childIds: string[];
  backendDOMNodeId?: string;
  ignored?: boolean;
}

interface SerializedNode {
  role: string;
  name: string;
  description?: string;
  url?: string;
  value?: string;
  level?: number;
  focused?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  selected?: boolean;
  checked?: boolean;
  invalid?: boolean;
  orientation?: string;
  valuemin?: number;
  valuemax?: number;
  valuetext?: string;
  children?: SerializedNode[];
  selector?: string;
  domId?: string;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

interface DomInfo {
  tag: string;
  id?: string;
  dataTestId?: string;
  ariaLabel?: string;
  href?: string;
  className?: string;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface TrackedPage {
  url: string;
  title: string;
  timestamp: string;
}

export class PlaywrightSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private refCounter = 0;
  private _visitedPages: TrackedPage[] = [];
  private _domCache = new Map<string, DomInfo[]>();
  private _occCounters = new Map<string, number>();

  get visitedPages(): TrackedPage[] {
    return this._visitedPages;
  }

  get currentPage(): Page | null {
    return this.page;
  }

  async launch(
    url: string,
    opts: {
      profile?: string;
      snapshotDepth?: number;
      headless?: boolean;
      httpCredentials?: { username: string; password: string };
      ignoreHTTPSErrors?: boolean;
    } = {},
  ): Promise<void> {
    const contextOptions: BrowserContextOptions = {
      // Private/test sites (UAT, internal hosts) often use self-signed or
      // expired TLS certs — ignore HTTPS errors by default.
      ignoreHTTPSErrors: opts.ignoreHTTPSErrors ?? true,
    };
    const headless = opts.headless ?? false;

    if (opts.httpCredentials) {
      contextOptions.httpCredentials = opts.httpCredentials;
    }

    const launchArgs: string[] = [];

    if (opts.profile) {
      const dirExists = existsSync(opts.profile);
      if (!dirExists) mkdirSync(opts.profile, { recursive: true });
      // Clear stale Chrome lock files from previous runs. Use rmSync directly
      // (no existsSync guard): a broken SingletonLock symlink points at a dead
      // pid/hostname from an older container, existsSync() reports it as gone,
      // but Chromium still refuses to launch ("profile appears to be in use").
      try {
        for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
          rmSync(join(opts.profile, f), { force: true });
        }
      } catch {}
      // Disable Chromium's single-instance handoff so a stale SingletonLock from a
      // killed/crashed browser never makes launch fail with "profile is in use".
      launchArgs.push('--no-singleton');
      this.context = await (chromium as any).launchPersistentContext(opts.profile, {
        headless,
        args: launchArgs,
        ...contextOptions,
      });
      const ctx = this.context!;
      const pages = ctx.pages();
      this.page = pages.length > 0 ? pages[0] : await ctx.newPage();
    } else {
      this.browser = await chromium.launch({
        headless,
        args: launchArgs,
      });
      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();
    }

    this._setupListeners();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
  }

  private _setupListeners(): void {
    if (!this.page) return;

    this.page.on('load', () => {
      this._trackCurrentPage();
    });

    this.page.on('framenavigated', () => {
      this._trackCurrentPage();
    });

    this.context?.on('page', (page: Page) => {
      page.on('load', () => {
        this._trackCurrentPage(page);
      });
    });
  }

  private _trackCurrentPage(page?: Page): void {
    const p = page ?? this.page;
    if (!p) return;
    const url = p.url();
    if (!url || url === 'about:blank' || url.startsWith('chrome-devtools://')) return;
    if (this._visitedPages.length > 0) {
      const last = this._visitedPages[this._visitedPages.length - 1];
      if (last.url === url) return;
    }
    const entry: TrackedPage = { url, title: '', timestamp: new Date().toISOString() };
    this._visitedPages.push(entry);
    p.title().then(title => { entry.title = title; }).catch(() => {});
  }

  async goto(url: string): Promise<void> {
    if (!this.page) throw new Error('Session not started. Call launch() first.');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error('Session not started.');
    try {
      await this.page.locator(selector).click();
      await this.page.waitForTimeout(500);
    } catch {
      await this.page.click(selector);
    }
  }

  async clickElement(el: ElementInfo, nth?: number): Promise<void> {
    if (!this.page) throw new Error('Session not started.');
    const nonClickable = new Set(['generic', 'StaticText', 'InlineTextBox', 'text', 'paragraph', 'heading']);
    if (nonClickable.has(el.role)) {
      throw new Error(`Element [${el.ref}] has role "${el.role}" which is not clickable`);
    }
    let locator: Locator;
    if (el.role && el.name) {
      locator = this.page.getByRole(el.role as any, { name: el.name, exact: true });
    } else if (el.name) {
      locator = this.page.getByText(el.name, { exact: true });
    } else {
      throw new Error(`Cannot resolve element [${el.ref}] to a locator`);
    }
    if (nth !== undefined) {
      locator = locator.nth(nth);
    }
    await locator.click();
    await this.page.waitForTimeout(500);
  }

  async fill(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('Session not started.');
    await this.page.locator(selector).fill(text);
    await this.page.waitForTimeout(200);
  }

  /**
   * Reveals droplist-only controls before snapshotting. On content-add forms that
   * use Drupal paragraphs, the block-type dropbuttons only exist after a section
   * has been added — clicking the first N-Column Section button renders them.
   */
  async prepareForExploration(): Promise<void> {
    if (!this.page) throw new Error('Session not started.');
    try {
      // Only auto-add a section on node-add forms; never modify an existing node
      // during re-exploration (edit pages: /node/<id>/edit/...).
      if (!this.page.url().includes('/node/add/')) return;
      const sectionBtn = this.page.getByRole('button', { name: /^Add \d+-Column Section$/ }).first();
      if (await sectionBtn.isVisible().catch(() => false)) {
        await sectionBtn.click();
        await this.page.waitForTimeout(1500);
        await this.page.waitForLoadState('networkidle').catch(() => {});
        await this.page.waitForTimeout(500);
      }
    } catch {}
  }

  /**
   * Interactively expands reveal-style controls so the components hidden behind
   * them become visible to the accessibility snapshot. Covers:
   *   - Drupal paragraphs "List additional actions" action buttons
   *   - "Toggle Actions" paragraphs dropdown toggles
   *   - Drupal dropbutton secondary actions ("Add <Block>" options)
   *   - closed ARIA tabs (e.g. jQuery UI "Advanced Options" tablists)
   *   - collapsed <details> regions
   * Multi-pass: each expansion can trigger an AJAX re-render that resets sibling
   * reveals, so keep clicking until a pass makes no new clicks (max 5 passes).
   */
  async expandReveals(): Promise<void> {
    if (!this.page) throw new Error('Session not started.');
    for (let pass = 0; pass < 5; pass++) {
      const clicked = await this.page.evaluate(() => {
        let n = 0;
        const clickIfNotOpen = (el: HTMLElement, alreadyOpen: boolean): void => {
          if (!alreadyOpen) {
            try {
              el.click();
              n++;
            } catch {}
          }
        };
        // 1. "List additional actions" reveal buttons (paragraphs actions).
        Array.from(document.querySelectorAll<HTMLElement>('button')).forEach((b) => {
          const label = b.getAttribute('aria-label') ?? b.textContent ?? '';
          if (/list additional actions/i.test(label)) {
            clickIfNotOpen(b, !!b.closest('.paragraphs-dropdown.open'));
          }
        });
        // 2. "Toggle Actions" dropdown toggles.
        document.querySelectorAll<HTMLElement>('.paragraphs-dropdown-toggle button').forEach((b) => {
          clickIfNotOpen(b, !!b.closest('.paragraphs-dropdown.open'));
        });
        // 3. Drupal dropbutton secondary actions.
        document.querySelectorAll<HTMLElement>('.dropbutton-wrapper:not(.open) .dropbutton-toggle button').forEach((b) => {
          clickIfNotOpen(b, false);
        });
        // 4. Closed ARIA tabs (jQuery UI "Advanced Options" tablists).
        document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="false"]').forEach((t) => {
          clickIfNotOpen(t, false);
        });
        // 5. Collapsed collapsible regions.
        document.querySelectorAll<HTMLDetailsElement>('details:not([open]) > summary').forEach((s) => {
          clickIfNotOpen(s, false);
        });
        return n;
      });
      if (clicked === 0) break;
      await this.page.waitForTimeout(700);
      await this.page.waitForLoadState('networkidle').catch(() => {});
    }
  }

  async screenshot(filename?: string): Promise<string> {
    if (!this.page) throw new Error('Session not started.');
    const path = filename ?? `screenshot-${Date.now()}.png`;
    await this.page.screenshot({ path, fullPage: true });
    return path;
  }

  async getAccessibilitySnapshot(): Promise<string> {
    if (!this.page) throw new Error('Session not started.');
    if (this.page.isClosed()) return '';

    // Interactively expand reveal-style controls ("List additional actions",
    // "Toggle Actions", dropbuttons, closed tabs, <details>) so the components
    // hidden behind them appear in the AX tree.
    await this.expandReveals();

    const cdp = await (this.page.context() as any).newCDPSession(this.page);
    const result: { nodes: CdpAxNode[] } = await cdp.send('Accessibility.getFullAXTree');
    if (!result?.nodes?.length) return '';

    this.refCounter = 0;
    const nodeMap = new Map<string, CdpAxNode>();
    for (const n of result.nodes) {
      nodeMap.set(n.nodeId, n);
    }
    const root = this._findRoot(result.nodes, nodeMap);
    if (!root) return '';

    const serialized = this._cdpNodeToSerialized(root, nodeMap);
    this._occCounters.clear();
    await this._enrichTree(serialized);
    const lines = this._serializeNode(serialized, 0);
    return lines.join('\n');
  }

  private _findRoot(nodes: CdpAxNode[], nodeMap: Map<string, CdpAxNode>): CdpAxNode | undefined {
    const parentCount = new Map<string, number>();
    for (const n of nodes) {
      if (n.ignored || n.role?.value === 'none') continue;
      for (const cid of n.childIds) {
        if (nodeMap.has(cid)) {
          parentCount.set(cid, (parentCount.get(cid) || 0) + 1);
        }
      }
    }
    for (const n of nodes) {
      if (n.ignored || n.role?.value === 'none') continue;
      if (!parentCount.has(n.nodeId)) return n;
    }
    return nodes.find(n => n.role?.value === 'RootWebArea');
  }

  private _cdpNodeToSerialized(cdp: CdpAxNode, nodeMap: Map<string, CdpAxNode>): SerializedNode {
    const role = cdp.role?.value || '';
    const name = cdp.name?.value || '';

    let url = '';
    let level: number | undefined;
    let focused = false;
    let disabled = false;
    let expanded: boolean | undefined;
    let pressed: boolean | undefined;
    let selected: boolean | undefined;
    let checked: boolean | undefined;

    const props = cdp.properties || [];
    for (const p of props) {
      if (p.name === 'url' && p.value?.value) url = String(p.value.value);
      if (p.name === 'level') level = Number(p.value?.value);
    }

    const states = cdp.states || [];
    for (const s of states) {
      if (s.name === 'focused') focused = true;
      if (s.name === 'disabled') disabled = true;
      if (s.name === 'expanded') expanded = true;
      if (s.name === 'collapsed') expanded = false;
      if (s.name === 'pressed') pressed = s.value?.value === true;
      if (s.name === 'selected') selected = s.value?.value === true;
      if (s.name === 'checked') checked = s.value?.value === true;
    }

    if (cdp.ignored || role === 'none' || role === 'generic') {
      const children: SerializedNode[] = [];
      for (const cid of cdp.childIds) {
        if (parseInt(cid) < 0) continue;
        const child = nodeMap.get(cid);
        if (child) {
          const cs = this._cdpNodeToSerialized(child, nodeMap);
          if (!cs.role && cs.children) {
            children.push(...cs.children);
          } else {
            children.push(cs);
          }
        }
      }
      return { role: '', name: '', children: children.length > 0 ? children : undefined };
    }

    const children: SerializedNode[] = [];
    for (const cid of cdp.childIds) {
      if (parseInt(cid) < 0) continue;
      const child = nodeMap.get(cid);
      if (child) {
        const cs = this._cdpNodeToSerialized(child, nodeMap);
        // Flatten empty-role wrappers
        if (!cs.role && cs.children) {
          children.push(...cs.children);
        } else {
          children.push(cs);
        }
      }
    }

    const result: SerializedNode = {
      role,
      name,
      url: url || undefined,
      level,
      focused,
      disabled,
      expanded,
      pressed,
      selected,
      checked,
      children: children.length > 0 ? children : undefined,
    };

    if (cdp.description?.value) result.description = cdp.description.value;
    if (cdp.value?.value) result.value = cdp.value.value;

    return result;
  }

  /**
   * Enriches the serialized AX tree with best-effort DOM info (id,
   * data-testid, href, required/min/max, placeholder) and a CSS selector so
   * the site map can carry real selectors like `input#shipping-fullname`.
   * Results are cached per (role, name) for the session lifetime; occurrence
   * indexes map to getByRole(...).nth(k) order (both follow DOM order).
   */
  private async _enrichTree(node: SerializedNode): Promise<void> {
    await this._enrichNode(node);
    for (const child of node.children ?? []) {
      await this._enrichTree(child);
    }
  }

  private async _enrichNode(node: SerializedNode): Promise<void> {
    if (!this.page || !node.role || !node.name) return;
    const skip = new Set(['text', 'generic', 'RootWebArea', 'StaticText', 'InlineTextBox', 'none', 'paragraph']);
    if (skip.has(node.role)) return;

    const key = `${node.role}|${node.name}`;
    const occ = this._occCounters.get(key) ?? 0;
    this._occCounters.set(key, occ + 1);

    let infos = this._domCache.get(key);
    if (!infos || infos.length <= occ) {
      infos = await this._domInfoFor(node.role, node.name);
      this._domCache.set(key, infos);
    }
    const info = infos.length > 0 ? infos[Math.min(occ, infos.length - 1)] : undefined;
    if (!info) return;

    if (info.id) node.domId = info.id;
    node.selector = composeSelector(info, node);
    if (info.required) node.required = true;
    if (info.min !== undefined) node.min = info.min;
    if (info.max !== undefined) node.max = info.max;
    if (info.placeholder) node.placeholder = info.placeholder;
  }

  private async _domInfoFor(role: string, name: string): Promise<DomInfo[]> {
    try {
      const locator = this.page!.getByRole(role as any, { name, exact: true });
      const infos = await locator.evaluateAll<DomInfo[]>(els =>
        (els as HTMLElement[]).map(el => {
          const attrs: Record<string, string> = {};
          for (const a of el.attributes) attrs[a.name] = a.value;
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            dataTestId: attrs['data-testid'],
            ariaLabel: attrs['aria-label'],
            href: (el as HTMLAnchorElement).getAttribute?.('href') || undefined,
            className: typeof el.className === 'string' ? el.className : undefined,
            required: el.hasAttribute('required') || attrs['aria-required'] === 'true',
            min: attrs['min'] !== undefined ? Number(attrs['min']) : undefined,
            max: attrs['max'] !== undefined ? Number(attrs['max']) : undefined,
            placeholder: attrs['placeholder'],
          };
        })
      );
      return infos;
    } catch {
      return [];
    }
  }

  private _serializeNode(node: SerializedNode, depth: number): string[] {
    if (!node.role) {
      return [];
    }

    if (node.role === 'InlineTextBox') {
      return [];
    }

    if (node.role === 'StaticText') {
      const text = node.name || '';
      if (!text) return [];
      this.refCounter++;
      const ref = `e${this.refCounter}`;
      const indent = '  '.repeat(depth);
      return [`${indent}  - "${text}" [ref=${ref}]`];
    }

    if (node.role === 'text' || node.role === 'none' || node.role === 'generic') {
      if (node.children?.length) {
        const lines: string[] = [];
        for (const child of node.children) {
          lines.push(...this._serializeNode(child, depth));
        }
        return lines;
      }
      return [];
    }

    this.refCounter++;
    const ref = `e${this.refCounter}`;
    const indent = '  '.repeat(depth);
    const nameAttr = node.name ? ` "${node.name}"` : '';
    const refAttr = `[ref=${ref}]`;
    const cursorAttr = node.role === 'link' || node.role === 'button' || node.role === 'checkbox' ? ' [cursor=pointer]' : '';
    const levelAttr = node.role === 'heading' && node.level ? ` [level=${node.level}]` : '';
    const activeAttr = node.focused ? ' [active]' : '';
    const disabledAttr = node.disabled ? ' [disabled]' : '';
    const expandedAttr = node.expanded !== undefined ? ` [expanded=${node.expanded}]` : '';
    const pressedAttr = node.pressed !== undefined ? ` [pressed=${node.pressed}]` : '';
    const selectedAttr = node.selected !== undefined ? ` [selected=${node.selected}]` : '';
    const checkedAttr = node.checked !== undefined ? ` [checked=${node.checked}]` : '';

    const header = `${indent}- ${node.role}${nameAttr} ${refAttr}${cursorAttr}${levelAttr}${activeAttr}${disabledAttr}${expandedAttr}${pressedAttr}${selectedAttr}${checkedAttr}:`;

    const lines: string[] = [header];

    if (node.description) {
      lines.push(`${indent}  - /description: "${node.description}"`);
    }

    if (node.url) {
      lines.push(`${indent}  - /url: ${node.url}`);
    }

    if (node.value) {
      lines.push(`${indent}  - /value: "${node.value}"`);
    }

    if (node.checked !== undefined) {
      lines.push(`${indent}  - /checked: ${node.checked}`);
    }

    if (node.orientation) {
      lines.push(`${indent}  - /orientation: ${node.orientation}`);
    }

    if (node.valuetext) {
      lines.push(`${indent}  - /valuetext: "${node.valuetext}"`);
    } else if (node.valuemin !== undefined && node.valuemax !== undefined) {
      lines.push(`${indent}  - /range: ${node.valuemin}..${node.valuemax}`);
    }

    if (node.invalid) {
      lines.push(`${indent}  - /invalid: true`);
    }

    if (node.domId) {
      lines.push(`${indent}  - /domid: ${node.domId}`);
    }

    if (node.selector) {
      lines.push(`${indent}  - /selector: ${node.selector}`);
    }

    if (node.required) {
      lines.push(`${indent}  - /required: true`);
    }

    if (node.min !== undefined) {
      lines.push(`${indent}  - /min: ${node.min}`);
    }

    if (node.max !== undefined) {
      lines.push(`${indent}  - /max: ${node.max}`);
    }

    if (node.placeholder) {
      lines.push(`${indent}  - /placeholder: "${node.placeholder}"`);
    }

    if (node.children) {
      for (const child of node.children) {
        lines.push(...this._serializeNode(child, depth + 1));
      }
    }

    return lines;
  }

  async saveSnapshot(dir: string): Promise<string> {
    if (!this.page) throw new Error('Session not started.');
    const filename = `explore-${Date.now()}.yaml`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, filename);
    const yaml = await this.getAccessibilitySnapshot();
    writeFileSync(path, yaml, 'utf-8');
    return path;
  }

  async getPageInfo(): Promise<{ url: string; title: string }> {
    if (!this.page) return { url: '', title: '' };
    const url = this.page.url();
    let title = '';
    try { title = await this.page.title(); } catch {}
    return { url, title };
  }

  async waitForTimeout(ms: number): Promise<void> {
    if (!this.page) throw new Error('Session not started.');
    await this.page.waitForTimeout(ms);
  }

  async evaluate<R>(fn: () => R): Promise<R> {
    if (!this.page) throw new Error('Session not started.');
    return this.page.evaluate(fn);
  }

  async close(): Promise<void> {
    try {
      if (this.page && !this.page.isClosed()) await this.page.close();
    } catch {}
    try {
      if (this.context) await this.context.close();
    } catch {}
    try {
      if (this.browser) await this.browser.close();
    } catch {}
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

/**
 * Builds a best-effort CSS selector for an element: `#id` when a stable id
 * exists, otherwise `data-testid`, then `tag[aria-label=...]`, then
 * `tag[data-testid=...]`, then `tag:has-text("...")` as a last resort.
 */
function composeSelector(info: DomInfo, node: SerializedNode): string {
  if (info.id) return `#${escapeCssIdentifier(info.id)}`;
  if (info.dataTestId) return `${info.tag}[data-testid='${escapeCssAttribute(info.dataTestId)}']`;
  const attrName = node.role === 'link' && info.href ? 'href' : info.ariaLabel ? 'aria-label' : '';
  if (attrName) {
    const value = attrName === 'href' ? (info.href ?? '') : (info.ariaLabel ?? '');
    return `${info.tag}[${attrName}='${escapeCssAttribute(value)}']`;
  }
  if (node.name) return `${info.tag}:has-text("${node.name.replace(/"/g, '\\"')}")`;
  return `${info.tag}`;
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/^(\d)/, '\\3$1 ').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
