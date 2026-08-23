import { readFile, readdir } from "node:fs/promises";

const files = (await readdir(new URL(".", import.meta.url)))
  .filter((name) => name.endsWith(".json") && name !== "package.json")
  .sort();

const required = new Set([
  "booking-google-calendar.json",
  "appointment-reminders.json",
  "no-show-recovery.json",
  "review-reputation.json",
  "call-logging.json",
  "retell-tools.json"
]);

for (const name of files) {
  const workflow = JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
  if (!workflow.name || !Array.isArray(workflow.nodes) || !workflow.connections || !workflow.settings) {
    throw new Error(`${name}: not an n8n workflow export shape`);
  }
  const names = new Set(workflow.nodes.map((node) => node.name));
  if (names.size !== workflow.nodes.length) throw new Error(`${name}: duplicate node name`);
  for (const node of workflow.nodes.filter((candidate) => candidate.type === "n8n-nodes-base.code")) {
    try {
      new Function(node.parameters.jsCode);
    } catch (error) {
      throw new Error(`${name}: code node ${node.name} does not parse: ${error.message}`);
    }
  }
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(source)) throw new Error(`${name}: connection source ${source} is missing`);
    for (const branch of outputs.main || []) {
      for (const edge of branch) {
        if (!names.has(edge.node)) throw new Error(`${name}: connection target ${edge.node} is missing`);
      }
    }
  }
  if (JSON.stringify(workflow).includes("shoosh.app.n8n.cloud")) throw new Error(`${name}: leaked reference n8n URL`);
  required.delete(name);
  console.log(`${name}: ${workflow.nodes.length} nodes, valid structure`);
}

if (required.size) throw new Error(`Missing workflows: ${[...required].join(", ")}`);
