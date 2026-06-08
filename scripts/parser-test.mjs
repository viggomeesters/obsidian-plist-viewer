import assert from "node:assert/strict";
import fs from "node:fs";
import esbuild from "esbuild";
import { DOMParser } from "@xmldom/xmldom";

globalThis.Node = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
};

await esbuild.build({
  bundle: true,
  entryPoints: ["src/parser.ts"],
  format: "esm",
  outfile: ".tmp-parser-test.mjs",
  platform: "node",
  target: "node20",
});

const { parsePlist } = await import(new URL("../.tmp-parser-test.mjs", import.meta.url));
const parser = new DOMParser({
  errorHandler: {
    warning() {},
    error(message) {
      throw new Error(message);
    },
    fatalError(message) {
      throw new Error(message);
    },
  },
});

function readFixture(name) {
  return fs.readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
}

function findChild(node, key) {
  return node.children.find((child) => child.key === key);
}

function treeContains(node, text) {
  return node.searchText.includes(text) || node.children.some((child) => treeContains(child, text));
}

const simple = parsePlist(readFixture("simple.plist"), parser);
assert.equal(simple.isMalformed, false);
assert.equal(simple.format, "xml");
assert.ok(simple.root);
assert.equal(simple.root.kind, "dict");
assert.equal(findChild(simple.root, "Name").value, "Example");
assert.equal(findChild(simple.root, "Enabled").kind, "bool");
assert.equal(findChild(simple.root, "Enabled").value, "true");
assert.equal(findChild(simple.root, "Count").kind, "integer");
assert.equal(findChild(simple.root, "Ratio").kind, "real");
assert.equal(findChild(simple.root, "Created").kind, "date");
assert.equal(findChild(simple.root, "PayloadContent").kind, "data");
assert.equal(findChild(simple.root, "PayloadContent").sensitive, true);
assert.match(findChild(simple.root, "PayloadContent").displayValue, /masked data/);

const nested = parsePlist(readFixture("nested.plist"), parser);
assert.equal(nested.isMalformed, false);
const servers = findChild(nested.root, "Servers");
assert.equal(servers.kind, "array");
assert.equal(servers.childCount, 2);
assert.ok(treeContains(nested.root, "fallback.test"));
assert.ok(treeContains(nested.root, "preferences"));

const profile = parsePlist(readFixture("profile.mobileconfig"), parser);
assert.equal(profile.isMalformed, false);
assert.ok(profile.profile);
assert.equal(profile.profile.displayName, "Security Review Demo");
assert.equal(profile.profile.identifier, "com.example.security-review");
assert.equal(profile.profile.payloadCount, 5);
assert.ok(profile.profile.payloads.some((payload) => payload.type === "com.apple.wifi.managed"));
assert.ok(profile.profile.payloads.some((payload) => payload.type === "com.apple.vpn.managed"));
assert.ok(profile.profile.payloads.some((payload) => payload.type === "com.apple.security.root"));
assert.ok(profile.profile.payloads.some((payload) => payload.type === "com.apple.applicationaccess"));
assert.ok(profile.warnings.some((warning) => warning.label === "Wi-Fi payload"));
assert.ok(profile.warnings.some((warning) => warning.label === "VPN payload"));
assert.ok(profile.warnings.some((warning) => warning.label === "Root certificate"));
assert.ok(profile.warnings.some((warning) => warning.label === "Restrictions payload"));
assert.ok(profile.warnings.some((warning) => warning.label === "Unknown payload"));
assert.ok(profile.warnings.some((warning) => warning.label === "Removal disallowed"));
assert.ok(profile.warnings.some((warning) => warning.label === "Sensitive values"));
const payloadContent = findChild(profile.root, "PayloadContent");
const wifiPayload = payloadContent.children[0];
assert.equal(findChild(wifiPayload, "Password").displayValue.includes("demo-secret"), false);
assert.ok(treeContains(profile.root, "com.example.security-review.wifi"));

const invalid = parsePlist(readFixture("invalid.plist"), {
  parseFromString() {
    throw new Error("Opening and ending tag mismatch");
  },
});
assert.equal(invalid.isMalformed, true);
assert.ok(invalid.warnings.some((warning) => warning.label === "Parse error"));

const binary = parsePlist(readFixture("binary.plist"), parser);
assert.equal(binary.isBinary, true);
assert.equal(binary.format, "binary");
assert.ok(binary.warnings.some((warning) => warning.label === "Binary plist"));
assert.equal(binary.root, null);

const largePlist = `<?xml version="1.0"?><plist><array>${Array.from({ length: 10005 }, (_, index) => `<string>value ${index}</string>`).join("")}</array></plist>`;
const large = parsePlist(largePlist, parser, 10000);
assert.equal(large.renderedNodeCount, 10000);
assert.ok(large.skippedNodes > 0);
assert.ok(large.warnings.some((warning) => warning.label === "Render cap"));

fs.rmSync(new URL("../.tmp-parser-test.mjs", import.meta.url));
console.log("PLIST parser fixture tests passed.");
