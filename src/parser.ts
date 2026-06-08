export const RENDER_NODE_LIMIT = 10000;
export const LARGE_FILE_LIMIT_BYTES = 2_000_000;

export type PlistValueKind = "dict" | "array" | "string" | "integer" | "real" | "bool" | "date" | "data";

export interface WarningItem {
  label: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface PlistTreeNode {
  kind: PlistValueKind;
  key: string;
  value: string;
  displayValue: string;
  path: string;
  depth: number;
  childCount: number;
  children: PlistTreeNode[];
  searchText: string;
  sensitive: boolean;
  truncated?: boolean;
}

export interface ProfilePayload {
  index: number;
  type: string;
  identifier: string;
  uuid: string;
  displayName: string;
  organization: string;
  warnings: WarningItem[];
}

export interface ProfileSummary {
  isMobileConfig: boolean;
  displayName: string;
  identifier: string;
  uuid: string;
  organization: string;
  type: string;
  payloadCount: number;
  payloads: ProfilePayload[];
}

export interface ParsedPlist {
  root: PlistTreeNode | null;
  profile: ProfileSummary | null;
  warnings: WarningItem[];
  nodeCount: number;
  renderedNodeCount: number;
  skippedNodes: number;
  isMalformed: boolean;
  isBinary: boolean;
  isLarge: boolean;
  format: "xml" | "binary" | "unknown";
}

export interface XmlParserLike {
  parseFromString(data: string, mimeType: DOMParserSupportedType): Document;
}

interface Counter {
  total: number;
  rendered: number;
  skipped: number;
}

const KNOWN_PAYLOAD_TYPES = new Set([
  "Configuration",
  "com.apple.applicationaccess",
  "com.apple.cellular",
  "com.apple.certificatepreference",
  "com.apple.dnsSettings.managed",
  "com.apple.extensiblesso",
  "com.apple.ldap.account",
  "com.apple.mdm",
  "com.apple.security.acme",
  "com.apple.security.pem",
  "com.apple.security.pkcs1",
  "com.apple.security.pkcs12",
  "com.apple.security.root",
  "com.apple.security.scep",
  "com.apple.vpn.managed",
  "com.apple.webClip.managed",
  "com.apple.wifi.managed",
]);

const SECRET_KEY_PATTERN = /(password|passphrase|secret|token|credential|privatekey|sharedsecret|pres haredkey|pre[-_ ]?shared[-_ ]?key|payloadcontent)/i;

export function parsePlist(
  data: string,
  parser: XmlParserLike = new DOMParser(),
  nodeLimit = RENDER_NODE_LIMIT,
): ParsedPlist {
  const warnings: WarningItem[] = [];
  const trimmed = data.trim();

  if (!trimmed) {
    return emptyResult();
  }

  if (isBinaryPlist(data)) {
    return {
      ...emptyResult(),
      warnings: [
        warning("Binary plist", "Binary plists are detected but not converted in v0.1.", "warning"),
      ],
      isBinary: true,
      format: "binary",
    };
  }

  if (data.length > LARGE_FILE_LIMIT_BYTES) {
    return {
      ...emptyResult(),
      warnings: [
        warning("Large file", "This file is too large for safe interactive parsing. Use source view only.", "warning"),
      ],
      isLarge: true,
      format: "unknown",
    };
  }

  let document: Document;
  try {
    document = parser.parseFromString(data, "application/xml");
  } catch (error) {
    return malformedResult(`Unable to parse XML plist: ${getErrorMessage(error)}`);
  }

  const parserError = findParserError(document);
  if (parserError) {
    return malformedResult(parserError);
  }

  const plistElement = findPlistElement(document);
  if (!plistElement) {
    return malformedResult("No <plist> root element was found.");
  }

  const valueElement = elementChildren(plistElement).find(isPlistValueElement);
  if (!valueElement) {
    return malformedResult("The <plist> root does not contain a supported value element.");
  }

  const counter: Counter = { total: 0, rendered: 0, skipped: 0 };
  const root = normalizeValue(valueElement, "root", "/root", 0, counter, nodeLimit);
  const skippedNodes = counter.skipped;

  if (skippedNodes > 0) {
    warnings.push(warning("Render cap", `${skippedNodes} values are not rendered to keep the view responsive.`, "warning"));
  }

  const profile = analyzeProfile(root);
  const profileWarnings = profile
    ? [
        ...profile.payloads.flatMap((payload) => payload.warnings),
        ...profileLevelWarnings(root, profile),
      ]
    : [];
  warnings.push(...profileWarnings);

  return {
    root,
    profile,
    warnings,
    nodeCount: counter.total,
    renderedNodeCount: counter.rendered,
    skippedNodes,
    isMalformed: false,
    isBinary: false,
    isLarge: false,
    format: "xml",
  };
}

function normalizeValue(
  element: Element,
  key: string,
  path: string,
  depth: number,
  counter: Counter,
  limit: number,
): PlistTreeNode {
  counter.total += 1;
  const kind = elementNameToKind(element.nodeName);
  const sensitive = isSensitiveKey(key);

  if (counter.rendered >= limit) {
    counter.skipped += countValueElements(element);
    return createNode(kind, key, "", path, depth, [], sensitive, true);
  }

  counter.rendered += 1;

  if (kind === "dict") {
    const children = normalizeDict(element, path, depth, counter, limit);
    return createNode(kind, key, "", path, depth, children, sensitive, counter.skipped > 0);
  }

  if (kind === "array") {
    const children = normalizeArray(element, path, depth, counter, limit);
    return createNode(kind, key, "", path, depth, children, sensitive, counter.skipped > 0);
  }

  const rawValue = scalarValue(element, kind);
  return createNode(kind, key, rawValue, path, depth, [], sensitive, false);
}

function normalizeDict(element: Element, path: string, depth: number, counter: Counter, limit: number): PlistTreeNode[] {
  const children = elementChildren(element);
  const nodes: PlistTreeNode[] = [];
  let index = 0;

  while (index < children.length) {
    const keyElement = children[index];
    if (keyElement.nodeName !== "key") {
      index += 1;
      continue;
    }

    const key = textContent(keyElement) || "(empty key)";
    const valueElement = children[index + 1];
    if (!valueElement || !isPlistValueElement(valueElement)) {
      nodes.push(createNode("string", key, "", `${path}/${pathSegment(key)}`, depth + 1, [], false, false));
      index += 1;
      continue;
    }

    nodes.push(normalizeValue(valueElement, key, `${path}/${pathSegment(key)}`, depth + 1, counter, limit));
    index += 2;
  }

  return nodes;
}

function normalizeArray(element: Element, path: string, depth: number, counter: Counter, limit: number): PlistTreeNode[] {
  return elementChildren(element)
    .filter(isPlistValueElement)
    .map((child, index) => normalizeValue(child, `[${index}]`, `${path}/${index}`, depth + 1, counter, limit));
}

function createNode(
  kind: PlistValueKind,
  key: string,
  value: string,
  path: string,
  depth: number,
  children: PlistTreeNode[],
  sensitive: boolean,
  truncated: boolean,
): PlistTreeNode {
  const displayValue = sensitive && value ? maskValue(value, kind) : previewValue(value, kind);
  const node: PlistTreeNode = {
    kind,
    key,
    value,
    displayValue,
    path,
    depth,
    childCount: children.length,
    children,
    sensitive,
    truncated,
    searchText: "",
  };
  node.searchText = [
    kind,
    key,
    sensitive ? "[masked]" : value,
    displayValue,
    path,
    ...children.map((child) => child.searchText),
  ]
    .join(" ")
    .toLowerCase();
  return node;
}

function analyzeProfile(root: PlistTreeNode): ProfileSummary | null {
  if (root.kind !== "dict") return null;
  const type = valueAt(root, "PayloadType");
  const payloadContent = childAt(root, "PayloadContent");
  const isMobileConfig = type === "Configuration" || payloadContent?.kind === "array";
  if (!isMobileConfig) return null;

  const payloads = payloadContent?.children
    .filter((child) => child.kind === "dict")
    .map((payload, index) => analyzePayload(payload, index)) ?? [];

  return {
    isMobileConfig,
    displayName: valueAt(root, "PayloadDisplayName"),
    identifier: valueAt(root, "PayloadIdentifier"),
    uuid: valueAt(root, "PayloadUUID"),
    organization: valueAt(root, "PayloadOrganization"),
    type,
    payloadCount: payloads.length,
    payloads,
  };
}

function analyzePayload(payload: PlistTreeNode, index: number): ProfilePayload {
  const type = valueAt(payload, "PayloadType");
  return {
    index,
    type,
    identifier: valueAt(payload, "PayloadIdentifier"),
    uuid: valueAt(payload, "PayloadUUID"),
    displayName: valueAt(payload, "PayloadDisplayName"),
    organization: valueAt(payload, "PayloadOrganization"),
    warnings: payloadWarnings(payload, type),
  };
}

function payloadWarnings(payload: PlistTreeNode, type: string): WarningItem[] {
  const warnings: WarningItem[] = [];

  if (!type) {
    warnings.push(warning("Unknown payload", "A payload is missing PayloadType.", "warning"));
    return warnings;
  }

  if (!KNOWN_PAYLOAD_TYPES.has(type)) {
    warnings.push(warning("Unknown payload", `${type} is not in the built-in payload type list.`, "warning"));
  }

  if (type === "com.apple.mdm") {
    warnings.push(warning("MDM payload", "This profile contains MDM enrollment settings. The plugin only inspects them.", "critical"));
  }

  if (type === "com.apple.vpn.managed") {
    warnings.push(warning("VPN payload", "VPN settings can redirect traffic or include account credentials.", "warning"));
  }

  if (type === "com.apple.wifi.managed") {
    warnings.push(warning("Wi-Fi payload", "Wi-Fi payloads can include network credentials.", "warning"));
  }

  if (type === "com.apple.applicationaccess") {
    warnings.push(warning("Restrictions payload", "Restrictions can disable device features or change security posture.", "warning"));
  }

  if (isCertificatePayload(type)) {
    const label = type === "com.apple.security.root" ? "Root certificate" : "Certificate payload";
    warnings.push(warning(label, "Certificate payloads affect trust only if a user installs the profile outside this viewer.", "critical"));
  }

  if (containsSensitiveKey(payload)) {
    warnings.push(warning("Sensitive values", "This payload contains password, token, key, credential, or certificate-like fields.", "warning"));
  }

  return warnings;
}

function profileLevelWarnings(root: PlistTreeNode, profile: ProfileSummary): WarningItem[] {
  const warnings: WarningItem[] = [];
  const removalDisallowed = valueAt(root, "PayloadRemovalDisallowed");
  if (removalDisallowed === "true") {
    warnings.push(warning("Removal disallowed", "The profile declares PayloadRemovalDisallowed=true.", "critical"));
  }
  if (profile.payloadCount === 0) {
    warnings.push(warning("Empty profile", "No payloads were found in PayloadContent.", "info"));
  }
  return warnings;
}

function isBinaryPlist(data: string): boolean {
  return data.startsWith("bplist00") || data.charCodeAt(0) === 0;
}

function isCertificatePayload(type: string): boolean {
  return type.includes("certificate") || [
    "com.apple.security.pem",
    "com.apple.security.pkcs1",
    "com.apple.security.pkcs12",
    "com.apple.security.root",
    "com.apple.security.scep",
  ].includes(type);
}

function containsSensitiveKey(node: PlistTreeNode): boolean {
  return node.sensitive || node.children.some(containsSensitiveKey);
}

function isSensitiveKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function valueAt(node: PlistTreeNode, key: string): string {
  return childAt(node, key)?.value ?? "";
}

function childAt(node: PlistTreeNode, key: string): PlistTreeNode | undefined {
  return node.children.find((child) => child.key === key);
}

function elementNameToKind(name: string): PlistValueKind {
  if (name === "true" || name === "false") return "bool";
  if (["dict", "array", "string", "integer", "real", "date", "data"].includes(name)) {
    return name as PlistValueKind;
  }
  return "string";
}

function scalarValue(element: Element, kind: PlistValueKind): string {
  if (kind === "bool") return element.nodeName === "true" ? "true" : "false";
  return textContent(element);
}

function findPlistElement(document: Document): Element | null {
  if (document.documentElement?.nodeName === "plist") return document.documentElement;
  return document.getElementsByTagName("plist")[0] ?? null;
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === Node.ELEMENT_NODE);
}

function isPlistValueElement(element: Element): boolean {
  return ["dict", "array", "string", "integer", "real", "true", "false", "date", "data"].includes(element.nodeName);
}

function countValueElements(element: Element): number {
  return elementChildren(element).filter(isPlistValueElement).length + 1;
}

function textContent(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pathSegment(value: string): string {
  return value.replace(/[~/]/g, "_");
}

function previewValue(value: string, kind: PlistValueKind): string {
  if (kind === "data" && value.length > 64) return `${value.slice(0, 64)}... (${value.length} chars)`;
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}

function maskValue(value: string, kind: PlistValueKind): string {
  if (kind === "data") return `[masked data, ${value.length} chars]`;
  return `[masked, ${value.length} chars]`;
}

function emptyResult(): ParsedPlist {
  return {
    root: null,
    profile: null,
    warnings: [],
    nodeCount: 0,
    renderedNodeCount: 0,
    skippedNodes: 0,
    isMalformed: false,
    isBinary: false,
    isLarge: false,
    format: "unknown",
  };
}

function malformedResult(message: string): ParsedPlist {
  return {
    ...emptyResult(),
    warnings: [warning("Parse error", message, "critical")],
    isMalformed: true,
    format: "xml",
  };
}

function warning(label: string, message: string, severity: WarningItem["severity"]): WarningItem {
  return { label, message, severity };
}

function findParserError(document: Document): string | null {
  const parserErrors = Array.from(document.getElementsByTagName("parsererror"));
  if (parserErrors.length === 0) return null;
  return parserErrors
    .map((error) => error.textContent?.replace(/\s+/g, " ").trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
