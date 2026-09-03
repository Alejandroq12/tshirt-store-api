#!/usr/bin/env node
/**
 * An MCP server that exposes api/openapi.yaml to Claude Code as structured
 * tools rather than as 2,800 lines of YAML to read and re-read.
 *
 * Why this exists: answering "what is left to build, and what exactly does the
 * contract say about it" used to mean loading the whole contract into context.
 * These tools answer it in a few hundred tokens, and they answer it from the
 * contract itself, so the answer cannot drift from the delivered specification.
 *
 * Transport is stdio: Claude Code starts this process and speaks JSON-RPC over
 * its standard input and output. Nothing may be written to stdout except
 * protocol messages — use stderr for diagnostics.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  findOperation,
  loadOperations,
  progress,
} from './contract-operations.mjs';

const server = new McpServer({
  name: 'tshirt-contract',
  version: '1.0.0',
});

const asText = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
});

const summarise = (operation) => ({
  operationId: operation.operationId,
  route: `${operation.method} ${operation.path}`,
  tag: operation.tag,
  authorization: operation.authorization,
  implemented: operation.implemented,
});

server.registerTool(
  'list_contract_operations',
  {
    title: 'List contract operations',
    description:
      'Every operation declared in api/openapi.yaml, in document order, with whether this repository implements it. Filter to narrow the answer.',
    inputSchema: {
      tag: z
        .string()
        .optional()
        .describe(
          'Only this tag, for example Authentication, Products, Cart, Orders.',
        ),
      implemented: z
        .boolean()
        .optional()
        .describe(
          'true for delivered operations only, false for the ones still to build.',
        ),
      authorization: z
        .string()
        .optional()
        .describe(
          'Substring of x-authorization, for example manager or client.',
        ),
    },
  },
  async ({ tag, implemented, authorization }) => {
    const operations = loadOperations().filter(
      (operation) =>
        (tag === undefined ||
          operation.tag.toLowerCase() === tag.toLowerCase()) &&
        (implemented === undefined || operation.implemented === implemented) &&
        (authorization === undefined ||
          operation.authorization
            .toLowerCase()
            .includes(authorization.toLowerCase())),
    );

    return asText({
      matched: operations.length,
      operations: operations.map(summarise),
    });
  },
);

server.registerTool(
  'get_operation',
  {
    title: 'Get one contract operation',
    description:
      'The full contract entry for one operationId: route, summary, the requirement it serves, who may call it, every declared status code, the request schema, and the controller that implements it.',
    inputSchema: {
      operationId: z
        .string()
        .describe('The operationId exactly as the contract spells it.'),
    },
  },
  async ({ operationId }) => {
    const operation = findOperation(operationId);

    if (!operation) {
      const known = loadOperations()
        .map((candidate) => candidate.operationId)
        .join(', ');

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `No operation "${operationId}" in api/openapi.yaml. Known operationIds: ${known}`,
          },
        ],
      };
    }

    return asText(operation);
  },
);

server.registerTool(
  'next_unimplemented_operation',
  {
    title: 'Next operation to build',
    description:
      'The first operation the contract declares that no controller implements yet, in contract order. Use it to answer "what is next" without guessing.',
    inputSchema: {
      tag: z.string().optional().describe('Restrict the search to one tag.'),
    },
  },
  async ({ tag }) => {
    const next = loadOperations().find(
      (operation) =>
        !operation.implemented &&
        (tag === undefined ||
          operation.tag.toLowerCase() === tag.toLowerCase()),
    );

    if (!next) {
      return asText({
        done: true,
        message: 'Every operation in that scope is implemented.',
      });
    }

    return asText(next);
  },
);

server.registerTool(
  'contract_progress',
  {
    title: 'Contract progress',
    description:
      'How many of the contract operations are implemented, overall and broken down by tag.',
    inputSchema: {},
  },
  async () => {
    const operations = loadOperations();
    const byTag = {};

    for (const operation of operations) {
      byTag[operation.tag] ??= { implemented: 0, total: 0 };
      byTag[operation.tag].total += 1;
      if (operation.implemented) byTag[operation.tag].implemented += 1;
    }

    return asText({ overall: progress(), byTag });
  },
);

/**
 * The same data as a resource rather than a tool. A tool is something Claude
 * decides to call; a resource is something it can be handed. Both are exposed
 * here on purpose, because the distinction is the part of MCP worth learning.
 */
server.registerResource(
  'contract-operations',
  'contract://operations',
  {
    title: 'Contract operations',
    description:
      'Every operation in api/openapi.yaml with its implementation state.',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(loadOperations().map(summarise), null, 2),
      },
    ],
  }),
);

const main = async () => {
  await server.connect(new StdioServerTransport());
};

main().catch((error) => {
  process.stderr.write(
    `tshirt-contract MCP server failed: ${error.stack ?? error}\n`,
  );
  process.exit(1);
});
