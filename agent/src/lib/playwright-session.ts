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

  get visitedPages(): TrackedPage[] {
    return this._visitedPages;
  }

  get currentPage(): Page | null {
    return this.page;
  }

  async launch(url: string, opts: { profile?: string; snapshotDepth?: number } = {}): Promise<void> {
    const contextOptions: BrowserContextOptions = {};

    const launchArgs: string[] = [];

    if (opts.profile) {
      const dirExists = existsSync(opts.profile);
      if (!dirExists) mkdirSync(opts.profile, { recursive: true });
      // Clear stale Chrome lock files from previous runs
      try {
        const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
        for (const f of lockFiles) {
          const p = join(opts.profile, f);
          if (existsSync(p)) rmSync(p, { force: true });
        }
      } catch {}
      this.context = await (chromium as any).launchPersistentContext(opts.profile, {
        headless: false,
        args: launchArgs,
        ...contextOptions,
      });
      const ctx = this.context!;
      const pages = ctx.pages();
      this.page = pages.length > 0 ? pages[0] : await ctx.newPage();
    } else {
      this.browser = await chromium.launch({
        headless: false,
        args: launchArgs,
      });
      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();
    }

    this._setupListeners();
    await this.page.goto(url, { waitUntil: 'networkidle' });
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
    await this.page.goto(url, { waitUntil: 'networkidle' });
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

  async screenshot(filename?: string): Promise<string> {
    if (!this.page) throw new Error('Session not started.');
    const path = filename ?? `screenshot-${Date.now()}.png`;
    await this.page.screenshot({ path, fullPage: true });
    return path;
  }

  async getAccessibilitySnapshot(): Promise<string> {
    if (!this.page) throw new Error('Session not started.');
    if (this.page.isClosed()) return '';

    // Expand Drupal dropbutton secondary actions so hidden block types appear in the AX tree.
    // Two passes: first pass expands all toggles; some may trigger Paragraphs AJAX re-renders
    // that reset sibling dropbuttons to closed. Second pass catches those re-rendered ones.
    await this.page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('.dropbutton-toggle button').forEach(btn => btn.click());
    });
    await this.page.waitForTimeout(1000);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(500);
    await this.page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('.dropbutton-wrapper:not(.open) .dropbutton-toggle button').forEach(btn => btn.click());
    });
    await this.page.waitForTimeout(300);

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
