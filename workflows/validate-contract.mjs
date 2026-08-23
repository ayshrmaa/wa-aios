import { readFile, readdir } from "node:fs/promises";

const here = new URL("./", import.meta.url);
const agentConfigUrl = new URL("../retell/agent-config.json", here);
const canonicalPaths = new Set([
  "book-appointment",
  "cancel-appointment",
  "check-availability",
  "find-appointment",
  "reschedule-appointment",
  "log-call",
  "log-complaint",
  "log-callback"
]);

// This webhook belongs to the review/ManyChat flow, not to the Retell voice agent.
const nonRetellWebhookPaths = new Set(["review-rating"]);

function webhookPath(url) {
  const match = String(url || "").match(/\/webhook(?:-test)?\/([^?#/]+)/);
  return match?.[1] || null;
}

const agentConfig = JSON.parse(await readFile(agentConfigUrl, "utf8"));
const customTools = (agentConfig.retellLlmData?.general_tools || []).filter(
  (tool) => tool.type === "custom"
);
const agentEntries = customTools.map((tool) => ({
  tool: tool.name,
  url: tool.url,
  path: webhookPath(tool.url)
}));

const jsonNames = (await readdir(here)).filter((name) => name.endsWith(".json")).sort();
const workflowEntries = [];
for (const name of jsonNames) {
  const parsed = JSON.parse(await readFile(new URL(name, here), "utf8"));
  if (!Array.isArray(parsed.nodes)) continue;
  for (const node of parsed.nodes) {
    if (node.type !== "n8n-nodes-base.webhook") continue;
    workflowEntries.push({ file: name, node: node.name, path: node.parameters?.path });
  }
}

const agentPaths = new Set(agentEntries.map((entry) => entry.path).filter(Boolean));
const workflowPaths = new Set(workflowEntries.map((entry) => entry.path).filter(Boolean));
const errors = [];

for (const entry of agentEntries.filter((candidate) => !candidate.path)) {
  errors.push(`- agent tool ${entry.tool} has an unreadable webhook URL: ${entry.url}`);
}
for (const path of canonicalPaths) {
  if (!agentPaths.has(path)) errors.push(`- required agent webhook URL is missing: /webhook/${path}`);
  if (!workflowPaths.has(path)) errors.push(`- agent expects /webhook/${path}, but no workflow exposes it`);
}
for (const entry of agentEntries) {
  if (entry.path && !workflowPaths.has(entry.path)) {
    errors.push(`- agent tool ${entry.tool} points to /webhook/${entry.path}, but no workflow exposes it`);
  }
}
for (const entry of workflowEntries) {
  if (!agentPaths.has(entry.path) && !nonRetellWebhookPaths.has(entry.path)) {
    errors.push(`+ workflow exposes unreachable /webhook/${entry.path} (${entry.file}: ${entry.node})`);
  }
}

for (const [label, entries] of [["agent", agentEntries], ["workflow", workflowEntries]]) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!entry.path || nonRetellWebhookPaths.has(entry.path)) continue;
    grouped.set(entry.path, [...(grouped.get(entry.path) || []), entry]);
  }
  for (const [path, duplicates] of grouped) {
    if (duplicates.length > 1) errors.push(`+ duplicate ${label} webhook path /webhook/${path} (${duplicates.length} definitions)`);
  }
}

if (errors.length) {
  console.error("FAIL Retell ↔ n8n webhook contract");
  for (const error of [...new Set(errors)].sort()) console.error(error);
  process.exit(1);
}

const matched = [...canonicalPaths].sort();
const excluded = workflowEntries
  .filter((entry) => nonRetellWebhookPaths.has(entry.path))
  .map((entry) => `${entry.path} (${entry.file})`)
  .sort();

console.log("PASS Retell ↔ n8n webhook contract");
console.log(`Agent custom tools: ${agentEntries.length}`);
console.log(`Matched webhook paths: ${matched.length}/${canonicalPaths.size}`);
for (const path of matched) console.log(`  /webhook/${path}`);
console.log(`Workflow JSON files parsed: ${jsonNames.length}`);
console.log(`Non-Retell webhooks excluded: ${excluded.join(", ") || "none"}`);
