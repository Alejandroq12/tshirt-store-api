/**
 * Reads api/openapi.yaml and reports every operation it declares, together with
 * whether this repository implements it yet.
 *
 * Implementation is detected by controller method name. CLAUDE.md makes that a
 * rule: a controller method is named exactly after the contract's operationId,
 * so a method called `createSku` is the implementation of `createSku` and there
 * is nothing else to correlate.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

const CONTRACT_PATH = join(PROJECT_ROOT, 'api', 'openapi.yaml');
const SOURCE_ROOT = join(PROJECT_ROOT, 'src');

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'patch',
  'delete',
  'head',
  'options',
];

const collectControllerFiles = (directory) => {
  const found = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      found.push(...collectControllerFiles(path));
      continue;
    }

    if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      found.push(path);
    }
  }

  return found;
};

/**
 * Maps each controller method name to the file that declares it.
 */
const controllerMethods = () => {
  const methods = new Map();

  for (const file of collectControllerFiles(SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(
      /^\s{2}(?:async\s+)?([a-zA-Z][\w$]*)\s*\(/gm,
    )) {
      const name = match[1];

      if (name !== 'constructor' && !methods.has(name)) {
        methods.set(name, relative(PROJECT_ROOT, file));
      }
    }
  }

  return methods;
};

/**
 * Every operation in the contract, in document order, annotated with its
 * implementation state.
 */
export const loadOperations = () => {
  const contract = parse(readFileSync(CONTRACT_PATH, 'utf8'));
  const methods = controllerMethods();
  const operations = [];

  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];

      if (!operation?.operationId) continue;

      const controller = methods.get(operation.operationId);

      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? 'Untagged',
        summary: operation.summary ?? '',
        requirement: operation['x-requirement'] ?? '',
        authorization: operation['x-authorization'] ?? '',
        contractStatus: operation['x-contract-status'] ?? '',
        statusCodes: Object.keys(operation.responses ?? {}),
        requestSchema: schemaNameOf(operation.requestBody),
        implemented: controller !== undefined,
        controllerFile: controller ?? null,
      });
    }
  }

  return operations;
};

/**
 * The `$ref` target name of a request body, when it has one. Inline schemas and
 * multipart uploads report their media type instead, which is enough to tell a
 * JSON operation from a file upload.
 */
const schemaNameOf = (requestBody) => {
  const content = requestBody?.content;

  if (!content) return null;

  const [mediaType, body] = Object.entries(content)[0];
  const ref = body?.schema?.$ref;

  return ref ? ref.split('/').pop() : mediaType;
};

export const findOperation = (operationId) =>
  loadOperations().find((operation) => operation.operationId === operationId) ??
  null;

export const progress = () => {
  const operations = loadOperations();
  const implemented = operations.filter((operation) => operation.implemented);

  return { implemented: implemented.length, total: operations.length };
};
