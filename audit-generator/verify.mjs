import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const filePath = path.resolve(process.argv[2] || "output/pdf/atelier-nova-audit.pdf");
const fileStat = await stat(filePath);
const pdf = await readFile(filePath);
const body = pdf.toString("latin1");
const pageCount = (body.match(/\/Type \/Page\b/g) || []).length;
const startXrefMatch = body.match(/startxref\n(\d+)\n%%EOF/);
const xrefOffset = startXrefMatch ? Number(startXrefMatch[1]) : -1;
const xrefMatch = body.match(/xref\n0 (\d+)\n([\s\S]+?)\ntrailer/);
let xrefOffsetsValid = false;
if (xrefMatch && xrefOffset >= 0 && body.slice(xrefOffset, xrefOffset + 4) === "xref") {
  const entries = xrefMatch[2].split("\n").slice(1);
  xrefOffsetsValid = entries.every((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    return body.startsWith(`${index + 1} 0 obj`, offset);
  });
}
const requiredSections = [
  "SALON REVENUE AUDIT",
  "Executive Summary",
  "Revenue Leak Breakdown",
  "Solution Mapping",
  "What We'll Build",
  "Investment und nächste Schritte"
];
const missingSections = requiredSections.filter((section) => !body.includes(section));

const checks = {
  pdfHeader: body.startsWith("%PDF-1.4"),
  eofMarker: body.trimEnd().endsWith("%%EOF"),
  xrefOffsetsValid,
  nonTrivialSize: fileStat.size >= 15000,
  exactPageCount: pageCount === 6,
  requiredSectionsPresent: missingSections.length === 0,
  caseStudyOmitted: !/case study|fallstudie/i.test(body)
};

const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  throw new Error(`Audit PDF verification failed: ${failures.join(", ")}${missingSections.length ? `. Missing: ${missingSections.join(", ")}` : ""}`);
}

console.log(JSON.stringify({
  file: filePath,
  bytes: fileStat.size,
  pages: pageCount,
  checks: Object.fromEntries(Object.keys(checks).map((name) => [name, "PASS"]))
}, null, 2));
