"use strict";

const { humanReport, terminalText } = require("./project-report");

const USAGE = "Usage: node scripts/audit-project.js --path /absolute/project [--json] [--id id] [--name name] [--profile workspace] [--max-files n] [--max-file-bytes n] [--max-total-bytes n] [--max-duration-ms n]";
const valueOptions = new Map([
  ["--path", "projectPath"], ["--id", "projectId"], ["--name", "projectName"], ["--profile", "profile"],
]);
const limitOptions = new Map([
  ["--max-files", "maxFiles"], ["--max-file-bytes", "maxFileBytes"],
  ["--max-total-bytes", "maxTotalBytes"], ["--max-duration-ms", "maxDurationMs"],
]);

function parseArgs(argv) {
  const options = { limits: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--version") options.version = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else {
      const equals = arg.indexOf("=");
      const key = equals < 0 ? arg : arg.slice(0, equals);
      if (!valueOptions.has(key) && !limitOptions.has(key)) throw new Error("Unknown option: " + arg);
      const value = equals < 0 ? argv[++i] : arg.slice(equals + 1);
      if (!value || value.startsWith("--")) throw new Error(key + " requires a value.");
      if (limitOptions.has(key)) {
        const number = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
          throw new Error(key + " requires a positive whole number.");
        }
        options.limits[limitOptions.get(key)] = number;
      } else {
        if (key === "--profile" && value !== "workspace") throw new Error("Unknown profile: " + value);
        options[valueOptions.get(key)] = value;
      }
    }
  }
  if (!options.projectPath && !options.help && !options.version) throw new Error("--path is required.");
  return options;
}

function run(argv, auditProject, version) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(terminalText(error.message) + "\n" + USAGE + "\n");
    return 1;
  }
  if (options.version || options.help) {
    process.stdout.write((options.version ? version : USAGE) + "\n");
    return 0;
  }
  const report = auditProject(options);
  process.stdout.write((options.json ? JSON.stringify(report, null, 2) : humanReport(report)) + "\n");
  if (report.statusKey === "unavailable") return 1;
  if (report.statusKey === "attention") return 2;
  return 0;
}

module.exports = { run };
