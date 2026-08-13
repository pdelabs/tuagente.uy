#!/usr/bin/env node

/** Enforces the portal's browser-to-agent network boundary.
 *
 * Public-site API calls are outside this rule. Any browser call that includes a
 * customer agent endpoint must be defined in app/app/lib/agent.ts.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "app", "app");
const BOUNDARY = join(ROOT, "lib", "agent.ts");
const EXTENSIONS = new Set([".ts", ".tsx"]);
const AGENT_ENDPOINT = /(?:cfg\.(?:adapter|endpoint)|\.adapter\s*\+|\.endpoint\s*\+|\/portal\/|\/api\/sessions|\/api\/jobs)/;
const violations = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) inspect(path);
  }
}

function inspect(path) {
  if (path === BOUNDARY) return;
  const source = readFileSync(path, "utf8");
  for (const [index, line] of source.split("\n").entries()) {
    if (/\bfetch\s*\(/.test(line) && AGENT_ENDPOINT.test(line)) {
      violations.push(`${relative(process.cwd(), path)}:${index + 1}`);
    }
  }
}

visit(ROOT);

if (violations.length) {
  console.error("Customer-agent fetches must live in app/app/lib/agent.ts:");
  console.error(violations.map((item) => `  ${item}`).join("\n"));
  process.exit(1);
}

console.log("Portal network boundary is intact.");
