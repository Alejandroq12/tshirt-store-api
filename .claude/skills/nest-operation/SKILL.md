---
name: nest-operation
description: How this repository implements one HTTP operation from api/openapi.yaml — the file order, the DTO conventions, the status-code mapping, the CASL registrar pattern, and what the tests must cover. Use when adding or changing any operation, endpoint, route, controller, service method or DTO in this NestJS codebase.
---

# Implementing one contract operation

An operation is delivered when the contract, the code and the tests say the
same thing. Work in the order below; each step depends on the one before it, and
skipping ahead produces the two failures that actually happen here — a status
code nothing can reach, and a controller shaped differently from its four
neighbours.

Before anything else, get the contract entry: call `get_operation` on the
`tshirt-contract` MCP server with the operationId. Do not read
`api/openapi.yaml` in full for this.

Then read the closest implemented operation of the same shape and match it:

| Shape                            | Read this                                              |
| -------------------------------- | ------------------------------------------------------ |
| Manager write, 201 with Location | `src/skus/skus.controller.ts` `createSku`              |
| Manager write, 200               | `src/skus/skus.controller.ts` `updateSku`              |
| Public or optional-auth read     | `src/products/products.controller.ts` `getProduct`     |
| Paginated list                   | `src/products/products.controller.ts` `listProducts`   |
| Authenticated non-role operation | `src/auth/auth.controller.ts` `changePassword`         |
| Multipart upload                 | `src/images/images.controller.ts` `uploadProductImage` |

There is one way to do each of these. A second way is a finding, not a style
choice.

## The file order

```text
1. prisma/schema.prisma                              only if the model does not exist
2. src/<feature>/<feature>.dto.ts                    request classes and param classes
3. src/<feature>/types/<feature>.types.ts            the response interfaces
4. src/<feature>/services/<feature>.service.ts       the logic
5. src/<feature>/<feature>.controller.ts             the route
6. src/<feature>/<feature>.module.ts                 wiring, and the CASL registrar
7. src/<feature>/services/<feature>.service.spec.ts  written with step 4, not after
8. src/<feature>/<feature>.controller.spec.ts
9. test/<flow>.e2e-spec.ts                           only for authentication, checkout, order history
```

Every slice has this shape: the module, the controllers and the DTO at the
root, every `@Injectable()` provider in `services/`, the response interfaces
in `types/`. Response types live in `types/<feature>.types.ts`, not in the DTO
file and not in the service. See `SkuResponse` and `SkuDetailResponse` in
`src/skus/types/skus.types.ts`. The DTO file holds only what comes in; the
service imports its response types and builds them.

## The six rules that are not negotiable

1. **The controller method name equals the operationId, exactly.** `createSku`,
   not `create`. The repository's tooling correlates contract to code by this
   name and nothing else.
2. **Money is a decimal string at every layer.** Never a JavaScript number,
   never in a DTO, a response, or an intermediate variable.
3. **Every status code the contract declares must be reachable, and no others.**
   List them from `get_operation` and map each to a branch before writing the
   service.
4. **Unknown request properties are a 422.** `forbidNonWhitelisted` is on, so
   any field the client may send must be declared with validation decorators.
5. **Security is opt-out.** The default guard authenticates every route. Adding
   `@Public()` or `@OptionalAuth()` is a decision that the contract's
   `x-authorization` has to justify.
6. **CASL rules live in the feature module,** in a private `@Injectable()`
   registrar implementing `OnModuleInit`. Never in `src/authorization/`.

## Detail, loaded when needed

| File                                                     | Read it when                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [reference/dtos.md](reference/dtos.md)                   | writing step 2 — validation, optional properties, the money pattern |
| [reference/errors.md](reference/errors.md)               | writing step 4 — mapping a branch to a status code                  |
| [reference/authorization.md](reference/authorization.md) | writing steps 5 and 6 — decorators and the registrar                |
| [reference/testing.md](reference/testing.md)             | writing steps 7 to 9 — what the specs must cover                    |

## Before calling it done

- `npm run typecheck`, then `npm test`, then `npm run test:e2e` if step 9
  applies. `/verify` runs the whole gate.
- Ask the `contract-auditor` subagent to check the operation against the
  contract. It finds the missing status code you did not think of.
- Coverage thresholds are enforced at statements 85, branches 75, functions 80,
  lines 85. A new error branch with no test moves branches down first.
- Do not commit. Run `/pr` and hand the breakdown over.
