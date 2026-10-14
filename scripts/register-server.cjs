/* eslint-disable @typescript-eslint/no-require-imports -- Local Node CommonJS server loader. */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
Module._extensions[".ts"] = (loaded, filename) => {
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  return resolveFilename.call(this, request.startsWith("@/") ? path.resolve("src", request.slice(2)) : request, parent, ...args);
};
