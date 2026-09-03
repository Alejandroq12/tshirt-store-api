/**
 * Reads api/openapi.yaml and reports every operation it declares, together with
 * whether this repository implements it yet.
 *
 * An operation counts as implemented when a controller declares a method named
 * after its operationId and decorated with the HTTP verb the contract gives it.
 * CLAUDE.md makes the naming a rule, which is what allows the match; the verb is
 * what keeps a same-named helper from counting. It does not check the route path
 * or that the handler answers — the end-to-end suite is what proves that.
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

const HTTP_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\(/;

const METHOD_SIGNATURE =
  /^ {2}(?:(?:public|private|protected|override|readonly|async)\s+)*([a-zA-Z][\w$]*)\s*(?:<[^>]*>)?\s*\(/;

const STATIC_MEMBER = /^ {2}(?:public|private|protected)?\s*static\b/;

/**
 * Maps each routed controller method to the file and HTTP verb that declare it.
 *
 * Requiring the decorator, and not merely the name, is what keeps a helper that
 * happens to share an operationId from being reported as delivered.
 */
const routedMethods = () => {
  const methods = new Map();

  for (const file of collectControllerFiles(SOURCE_ROOT)) {
    let verb;

    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const decorator = HTTP_DECORATOR.exec(line);

      if (decorator) {
        verb = decorator[1].toUpperCase();
        continue;
      }

      if (STATIC_MEMBER.test(line)) {
        verb = undefined;
        continue;
      }

      const match = METHOD_SIGNATURE.exec(line);

      if (match) {
        if (verb !== undefined && !methods.has(match[1])) {
          methods.set(match[1], { file: relative(PROJECT_ROOT, file), verb });
        }

        verb = undefined;
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
  const methods = routedMethods();
  const operations = [];

  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];

      if (!operation?.operationId) continue;

      const routed = methods.get(operation.operationId);
      const controller =
        routed &&
        (routed.verb === 'ALL' || routed.verb === method.toUpperCase())
          ? routed
          : undefined;

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
        responses: describeResponses(operation.responses),
        requestSchema: schemaNameOf(operation.requestBody),
        implemented: controller !== undefined,
        controllerFile: controller?.file ?? null,
      });
    }
  }

  return operations;
};

/**
 * What each declared status code means, and the schema it carries.
 *
 * The bare status-code list is not enough: a caller asking "what produces the
 * 409" needs the contract's own description, and without it the only way to get
 * one is to read api/openapi.yaml — which is exactly the cost this server
 * exists to avoid.
 */
const describeResponses = (responses = {}) =>
  Object.fromEntries(
    Object.entries(responses).map(([code, response]) => {
      if (response?.$ref) {
        return [code, { sharedResponse: response.$ref.split('/').pop() }];
      }

      const schema = Object.values(response?.content ?? {})[0]?.schema?.$ref;

      return [
        code,
        {
          description: response?.description ?? '',
          ...(schema ? { schema: schema.split('/').pop() } : {}),
        },
      ];
    }),
  );

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
