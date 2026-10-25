import { Notice, Plugin, TFile, TextFileView, WorkspaceLeaf, setIcon } from "obsidian";
import { ParsedPlist, PlistTreeNode, ProfilePayload, WarningItem, parsePlist } from "./parser";

const VIEW_TYPE_PLIST_VIEWER = "plist-viewer";
const PLIST_EXTENSIONS = ["plist", "mobileconfig"];

type ViewMode = "tree" | "source" | "security";

export default class PlistViewerPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_PLIST_VIEWER, (leaf) => new PlistViewerView(leaf));
    this.registerExtensions(PLIST_EXTENSIONS, VIEW_TYPE_PLIST_VIEWER);

    this.addCommand({
      id: "open-current-plist-in-viewer",
      name: "Open current PLIST or mobileconfig in viewer",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isPlistFile(file)) return false;

        if (!checking) {
          void this.openPlistFile(file);
        }
        return true;
      },
    });
  }

  async openPlistFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_PLIST_VIEWER,
      state: { file: file.path },
      active: true,
    });
  }
}

class PlistViewerView extends TextFileView {
  private mode: ViewMode = "tree";
  private filterValue = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PLIST_VIEWER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "PLIST viewer";
  }

  getIcon(): string {
    return "shield-check";
  }

  setViewData(data: string): void {
    this.data = data;
    this.render();
  }

  getViewData(): string {
    return this.data;
  }

  clear(): void {
    this.data = "";
    this.contentEl.empty();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("plist-viewer");

    const header = container.createDiv({ cls: "plist-viewer__header" });
    this.renderTitle(header);
    this.renderToolbar(header);

    if (!this.file) {
      renderMessage(container, "No PLIST file is attached to this viewer.");
      return;
    }

    if (!isPlistFile(this.file)) {
      renderMessage(container, "This viewer only supports .plist and .mobileconfig files.");
      return;
    }

    const parsed = parsePlist(this.data);
    renderSummary(container, parsed, this.file.extension.toLowerCase());
    renderWarnings(container, parsed.warnings);

    if (!this.data.trim()) {
      renderMessage(container, "This file is empty.");
      return;
    }

    if (this.mode === "source" || parsed.isMalformed || parsed.isBinary || parsed.isLarge || !parsed.root) {
      renderSource(container, this.data);
      return;
    }

    if (this.mode === "security") {
      renderSecurity(container, parsed);
      return;
    }

    renderTree(container, parsed, this.filterValue);
  }

  private renderTitle(parent: HTMLElement): void {
    const title = parent.createDiv({ cls: "plist-viewer__title" });
    title.createDiv({
      cls: "plist-viewer__filename",
      text: this.file?.name ?? "PLIST file",
    });
    title.createDiv({
      cls: "plist-viewer__path",
      text: this.file?.path ?? "",
    });
  }

  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "plist-viewer__toolbar" });

    const searchWrap = toolbar.createDiv({ cls: "plist-viewer__search" });
    setIcon(searchWrap.createSpan({ cls: "plist-viewer__search-icon" }), "search");
    const searchInput = searchWrap.createEl("input", {
      attr: {
        "aria-label": "Filter PLIST keys, values, payload types, and identifiers",
        placeholder: "Filter",
        spellcheck: "false",
        type: "search",
        value: this.filterValue,
      },
    });
    searchInput.addEventListener("input", () => {
      this.filterValue = searchInput.value;
      this.render();
    });

    const modeGroup = toolbar.createDiv({
      cls: "plist-viewer__segmented",
      attr: { "aria-label": "View mode" },
    });
    const treeButton = createTextButton(modeGroup, "Tree");
    const sourceButton = createTextButton(modeGroup, "Source");
    const securityButton = createTextButton(modeGroup, "Security");
    treeButton.toggleClass("is-active", this.mode === "tree");
    sourceButton.toggleClass("is-active", this.mode === "source");
    securityButton.toggleClass("is-active", this.mode === "security");

    treeButton.addEventListener("click", () => {
      this.mode = "tree";
      this.render();
    });
    sourceButton.addEventListener("click", () => {
      this.mode = "source";
      this.render();
    });
    securityButton.addEventListener("click", () => {
      this.mode = "security";
      this.render();
    });

    const refreshButton = createIconButton(toolbar, "refresh-cw", "Refresh file");
    refreshButton.addEventListener("click", () => {
      void this.reloadFile();
    });
  }

  private async reloadFile(): Promise<void> {
    if (!this.file) {
      new Notice("No PLIST file to refresh");
      return;
    }

    try {
      this.data = await this.app.vault.read(this.file);
      this.render();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.addClass("plist-viewer");
      renderMessage(this.contentEl, `Unable to read file: ${getErrorMessage(error)}`);
    }
  }
}

function renderSummary(parent: HTMLElement, parsed: ParsedPlist, extension: string): void {
  const summary = parent.createDiv({ cls: "plist-viewer__summary" });
  summary.createSpan({ cls: "plist-viewer__pill", text: `.${extension}` });
  summary.createSpan({ cls: "plist-viewer__pill", text: parsed.format });
  summary.createSpan({ cls: "plist-viewer__pill", text: `${parsed.renderedNodeCount}/${parsed.nodeCount} values` });
  summary.createSpan({
    cls: `plist-viewer__pill ${parsed.isMalformed || parsed.isBinary || parsed.isLarge ? "plist-viewer__pill--error" : ""}`,
    text: parsed.isMalformed ? "parse error" : parsed.isBinary ? "binary unsupported" : parsed.isLarge ? "large fallback" : "read-only",
  });
  if (parsed.profile) {
    summary.createSpan({ cls: "plist-viewer__pill", text: `${parsed.profile.payloadCount} payloads` });
  }
  if (parsed.skippedNodes > 0) {
    summary.createSpan({ cls: "plist-viewer__note", text: `${parsed.skippedNodes} values hidden by render cap` });
  }
}

function renderWarnings(parent: HTMLElement, warnings: WarningItem[]): void {
  if (warnings.length === 0) return;

  const box = parent.createDiv({ cls: "plist-viewer__warnings" });
  box.createDiv({ cls: "plist-viewer__warnings-title", text: "Security and parse warnings" });
  warnings.slice(0, 14).forEach((warning) => {
    box.createDiv({
      cls: `plist-viewer__warning plist-viewer__warning--${warning.severity}`,
      text: `${warning.label}: ${warning.message}`,
    });
  });
  if (warnings.length > 14) {
    box.createDiv({ cls: "plist-viewer__warning-more", text: `${warnings.length - 14} additional warnings hidden` });
  }
}

function renderTree(parent: HTMLElement, parsed: ParsedPlist, query: string): void {
  if (!parsed.root) {
    renderMessage(parent, "No PLIST values to display.");
    return;
  }

  const normalizedQuery = query.trim().toLowerCase();
  const body = parent.createDiv({ cls: "plist-viewer__body" });
  const main = body.createDiv({ cls: "plist-viewer__main" });
  const tree = main.createDiv({ cls: "plist-viewer__tree" });

  const rendered = renderNode(tree, parsed.root, normalizedQuery, true);
  if (!rendered) {
    renderMessage(tree, "No keys, values, payload types, or identifiers match the current filter.");
  }

  renderOutline(body, parsed.root, parsed.profile?.payloads ?? []);
}

function renderNode(parent: HTMLElement, node: PlistTreeNode, query: string, forceVisible = false): boolean {
  const childMatches = node.children
    .map((child) => ({ child, matches: nodeMatches(child, query) }))
    .filter(({ matches }) => !query || matches);
  const ownMatch = !query || node.searchText.includes(query);
  const visible = forceVisible || ownMatch || childMatches.length > 0;
  if (!visible) return false;

  if (node.children.length > 0) {
    const details = parent.createEl("details", {
      cls: `plist-viewer__branch plist-viewer__type-${node.kind}`,
    });
    details.open = node.depth < 3 || Boolean(query);
    const summary = details.createEl("summary", { cls: "plist-viewer__row" });
    renderNodeHeader(summary, node);

    const children = details.createDiv({ cls: "plist-viewer__children" });
    const candidates = query ? childMatches.map(({ child }) => child) : node.children;
    candidates.forEach((child) => {
      renderNode(children, child, query);
    });
    return true;
  }

  const row = parent.createDiv({ cls: `plist-viewer__row plist-viewer__leaf plist-viewer__type-${node.kind}` });
  renderNodeHeader(row, node);
  if (node.displayValue) {
    row.createSpan({ cls: `plist-viewer__value ${node.sensitive ? "is-sensitive" : ""}`, text: node.displayValue });
  }
  return true;
}

function nodeMatches(node: PlistTreeNode, query: string): boolean {
  if (!query || node.searchText.includes(query)) return true;
  return node.children.some((child) => nodeMatches(child, query));
}

function renderNodeHeader(parent: HTMLElement, node: PlistTreeNode): void {
  parent.createSpan({ cls: "plist-viewer__key", text: node.key });
  parent.createSpan({ cls: "plist-viewer__badge", text: node.kind });
  if (node.childCount > 0) {
    parent.createSpan({ cls: "plist-viewer__meta", text: `${node.childCount} children` });
  }
  if (node.sensitive) {
    parent.createSpan({ cls: "plist-viewer__sensitive", text: "masked" });
  }
  parent.createSpan({ cls: "plist-viewer__path-chip", text: node.path });
}

function renderOutline(parent: HTMLElement, root: PlistTreeNode, payloads: ProfilePayload[]): void {
  const outline = parent.createDiv({ cls: "plist-viewer__outline" });
  outline.createDiv({ cls: "plist-viewer__outline-title", text: "Outline" });

  if (payloads.length > 0) {
    payloads.slice(0, 80).forEach((payload) => {
      const item = outline.createDiv({ cls: "plist-viewer__outline-item" });
      item.createSpan({ cls: "plist-viewer__outline-label", text: payload.displayName || payload.type || `Payload ${payload.index + 1}` });
      item.createSpan({ cls: "plist-viewer__outline-meta", text: payload.identifier || payload.uuid || payload.type });
    });
    return;
  }

  root.children.slice(0, 80).forEach((node) => {
    const item = outline.createDiv({ cls: "plist-viewer__outline-item" });
    item.createSpan({ cls: "plist-viewer__outline-label", text: node.key });
    item.createSpan({ cls: "plist-viewer__outline-meta", text: node.path });
  });
}

function renderSecurity(parent: HTMLElement, parsed: ParsedPlist): void {
  const body = parent.createDiv({ cls: "plist-viewer__security" });
  body.createDiv({ cls: "plist-viewer__section-title", text: "Profile summary" });

  if (!parsed.profile) {
    body.createDiv({ cls: "plist-viewer__message", text: "This PLIST does not look like a configuration profile." });
    return;
  }

  const profile = parsed.profile;
  const grid = body.createDiv({ cls: "plist-viewer__profile-grid" });
  addFact(grid, "Display name", profile.displayName || "(none)");
  addFact(grid, "Identifier", profile.identifier || "(none)");
  addFact(grid, "UUID", profile.uuid || "(none)");
  addFact(grid, "Organization", profile.organization || "(none)");
  addFact(grid, "Payloads", String(profile.payloadCount));

  body.createDiv({ cls: "plist-viewer__section-title", text: "Payloads" });
  if (profile.payloads.length === 0) {
    body.createDiv({ cls: "plist-viewer__message", text: "No payloads were found." });
    return;
  }

  profile.payloads.forEach((payload) => {
    const item = body.createDiv({ cls: "plist-viewer__payload" });
    item.createDiv({ cls: "plist-viewer__payload-title", text: payload.displayName || payload.type || `Payload ${payload.index + 1}` });
    addFact(item, "Type", payload.type || "(missing)");
    addFact(item, "Identifier", payload.identifier || "(none)");
    addFact(item, "UUID", payload.uuid || "(none)");
    payload.warnings.forEach((warning) => {
      item.createDiv({ cls: `plist-viewer__payload-warning plist-viewer__warning--${warning.severity}`, text: `${warning.label}: ${warning.message}` });
    });
  });
}

function addFact(parent: HTMLElement, label: string, value: string): void {
  const fact = parent.createDiv({ cls: "plist-viewer__fact" });
  fact.createSpan({ cls: "plist-viewer__fact-label", text: label });
  fact.createSpan({ cls: "plist-viewer__fact-value", text: value });
}

function renderSource(parent: HTMLElement, data: string): void {
  const source = parent.createDiv({ cls: "plist-viewer__source" });
  const pre = source.createEl("pre");
  data.split("\n").forEach((line, index) => {
    const lineEl = pre.createDiv({ cls: "plist-viewer__source-line" });
    lineEl.createSpan({ cls: "plist-viewer__line-number", text: String(index + 1) });
    const code = lineEl.createSpan({ cls: "plist-viewer__source-code" });
    highlightXmlLine(code, line);
  });
}

function highlightXmlLine(parent: HTMLElement, line: string): void {
  const tokenPattern = /(<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\/?[A-Za-z_][\w:.-]*|[A-Za-z_:][\w:.-]*(?==)|"[^"]*"|'[^']*'|[<>/=])/g;
  let cursor = 0;

  for (const match of line.matchAll(tokenPattern)) {
    if (match.index > cursor) {
      parent.createSpan({ text: line.slice(cursor, match.index) });
    }

    const token = match[0];
    parent.createSpan({ cls: tokenClass(token), text: token });
    cursor = match.index + token.length;
  }

  if (cursor < line.length) {
    parent.createSpan({ text: line.slice(cursor) });
  }
}

function tokenClass(token: string): string {
  if (token.startsWith("<!--")) return "plist-viewer__tok-comment";
  if (token.startsWith("<![CDATA[")) return "plist-viewer__tok-cdata";
  if (token.startsWith("<")) return "plist-viewer__tok-tag";
  if (token.startsWith("\"") || token.startsWith("'")) return "plist-viewer__tok-string";
  if (["<", ">", "/", "="].includes(token)) return "plist-viewer__tok-punctuation";
  return "plist-viewer__tok-attr";
}

function createIconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "clickable-icon plist-viewer__button",
    attr: { "aria-label": label, title: label, type: "button" },
  });
  setIcon(button, icon);
  return button;
}

function createTextButton(parent: HTMLElement, label: string): HTMLButtonElement {
  return parent.createEl("button", {
    cls: "plist-viewer__text-button",
    text: label,
    attr: { type: "button" },
  });
}

function renderMessage(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "plist-viewer__message", text: message });
}

function isPlistFile(file: TFile | null): file is TFile {
  return Boolean(file && PLIST_EXTENSIONS.includes(file.extension.toLowerCase()));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
