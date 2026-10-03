import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";

import {
  isMermaidFile,
  isMermaidLanguage,
  mermaidDeclarationLine,
  mermaidHasContent,
} from "../src/mermaid.ts";

// The engine needs a DOM, so only the pure decision layer is covered here:
// which fences and files are treated as diagrams, and which blocks are worth
// loading the engine for. Everything past that gate is mermaid's own parser.

test("only a mermaid fence info string asks for a diagram", () => {
  for (const language of ["mermaid", "Mermaid", " MERMAID "]) {
    assert.equal(isMermaidLanguage(language), true, language);
  }
  for (const language of ["", "mermaid-extra", "mmd", "javascript", "python", null, undefined]) {
    assert.equal(isMermaidLanguage(language), false, String(language));
  }
});

test("standalone diagram files are recognized by extension alone", () => {
  for (const name of ["flow.mmd", "flow.mermaid", "Flow.MMD", "artifacts/plan.mmd"]) {
    assert.equal(isMermaidFile(name), true, name);
  }
  for (const name of ["flow.md", "flow.mmd.txt", "mmd", "flow.markdown", "flow.mmdx", "mermaid"]) {
    assert.equal(isMermaidFile(name), false, name);
  }
});

test("the declaration is the first line that is not blank or a mermaid comment", () => {
  assert.equal(mermaidDeclarationLine("flowchart TD\n  A-->B"), "flowchart TD");
  assert.equal(mermaidDeclarationLine("\n\n%% a note\n%% another\n  graph LR"), "graph LR");
  assert.equal(
    mermaidDeclarationLine("   \n%%{init: {'theme':'dark'}}%%\nsequenceDiagram"),
    "sequenceDiagram",
  );
  assert.equal(mermaidDeclarationLine("%% only comments\n%% more"), "");
  assert.equal(mermaidDeclarationLine(""), "");
});

test("a block with only whitespace and comments is skipped before the engine loads", () => {
  for (const code of ["", "   ", "\n\n\t\n", "%% a diagram goes here\n%% TODO", "%%"]) {
    assert.equal(mermaidHasContent(code), false, JSON.stringify(code));
  }
});

test("anything with a line in it is handed to the engine to judge", () => {
  // The gate deliberately does not try to name the diagram type: mermaid
  // registers a detector per diagram at runtime, so a local keyword list would
  // go stale. A block like "A --> B" is a headerless flowchart body and only
  // mermaid can say whether it parses.
  for (const code of [
    "flowchart TD\n A-->B",
    "sequenceDiagram\n A->>B: hi",
    "stateDiagram-v2\n [*] --> S",
    "mindmap\n root((a))",
    "A --> B",
    "%% a comment\n\nflowchart LR\n A-->B",
  ]) {
    assert.equal(mermaidHasContent(code), true, JSON.stringify(code));
  }
});

// Walks the hast for a <pre><code class="language-…"> so the assertions do not
// depend on where remark-rehype puts its inter-element whitespace.
function fencedBlock(tree) {
  const pre = tree.children.find(
    (node) => node.tagName === "pre" && node.children?.[0]?.tagName === "code",
  );
  return pre?.children[0];
}

const processor = unified().use(remarkParse).use(remarkRehype);

test("a ```mermaid fence reaches the renderer as a language-mermaid code block", () => {
  const tree = processor.runSync(
    processor.parse("Before\n\n```mermaid\nflowchart TD\n  A-->B\n```\n\nAfter\n"),
  );
  const code = fencedBlock(tree);
  assert.ok(code.properties.className.includes("language-mermaid"));
  assert.equal(code.children[0].value.trim(), "flowchart TD\n  A-->B");
  assert.equal(isMermaidLanguage(code.properties.className[0].slice("language-".length)), true);
});

test("a fence with no info string is not routed to the diagram renderer", () => {
  const code = fencedBlock(processor.runSync(processor.parse("```\nflowchart TD\n  A-->B\n```")));
  assert.equal(code.properties.className, undefined);
  assert.equal(isMermaidLanguage(code.properties.className?.[0]), false);
});

test("a half-streamed mermaid fence still arrives as a diagram block", () => {
  // An unterminated fence has no closing backticks, which is what every
  // in-flight chat message looks like. The renderer gets the same code node, so
  // the diagram is attempted and simply falls back to source until it completes.
  const code = fencedBlock(processor.runSync(processor.parse("```mermaid\nflowchart TD\n  A-->")));
  assert.ok(code.properties.className.includes("language-mermaid"));
  assert.equal(mermaidHasContent(code.children[0].value), true);
});

test("a half-streamed fence that is still empty falls back without loading", () => {
  const code = fencedBlock(processor.runSync(processor.parse("```mermaid")));
  assert.ok(code.properties.className.includes("language-mermaid"));
  assert.equal(mermaidHasContent(code.children[0]?.value ?? ""), false);
});