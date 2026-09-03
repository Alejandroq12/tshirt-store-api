# Tests for a new operation

The requirements ask for unit tests written alongside the code and focused on
services, plus end-to-end tests on three flows: authentication, checkout and
order history. Nothing else gets an e2e spec.

Two suites, two configurations:

| Suite | Config                                         | Location            | Pattern         |
| ----- | ---------------------------------------------- | ------------------- | --------------- |
| Unit  | `jest` block in `package.json`, `rootDir: src` | next to the subject | `*.spec.ts`     |
| E2E   | `test/jest-e2e.json`, `rootDir: .`             | `test/`             | `*.e2e-spec.ts` |

`npm run test:e2e` migrates the test database first and runs `--runInBand`,
because the specs truncate tables between cases.

## Unit specs construct the service directly

No `Test.createTestingModule` for a service. Instantiate it with hand-built
fakes, the way `src/skus/skus.service.spec.ts` does:

```ts
const skuCreate = jest.fn();
const prisma = {
  productSku: { create: skuCreate },
} as unknown as PrismaService;

const service = new SkusService(prisma, {
  get: () => 'USD',
} as unknown as ConfigService<EnvironmentVariables, true>);
```

Fixtures are module-level constants — `NOW` as a fixed `Date`, `SKU`, `MANAGER`
with a real-shaped UUID. Reuse the existing ones rather than inventing new
values.

Note `price: new Prisma.Decimal('19.90')` in a fixture. Prisma returns a
`Decimal`, the response is a string, and the conversion at the boundary is
something a test should actually assert.

## What to cover

Take the status codes from `get_operation` and write one case per code. In
order of what is most often missing here:

1. **Every non-2xx branch.** Each 409 separately when an operation has two
   distinct conflicts. Each 404 separately when one means "absent" and another
   means "not visible to you".
2. **The rules from the documents**, named in the test title: a password change
   revokes every session; activation is refused without a usable primary image;
   an idempotent operation applied twice leaves one row.
3. **Visibility.** The same read as anonymous, as a client, and as a manager,
   when the operation is `@OptionalAuth()`.
4. **The type boundary.** Decimal to string, Date to ISO string.
5. **The happy path.** It is the easiest and the least informative.

Controller specs are thin: the service is mocked, and what is being tested is
the wiring — that the right service method is called with the right arguments,
and that a 403 comes back for the wrong role.

## Coverage

Thresholds are enforced globally: statements 85, branches 75, functions 80,
lines 85. `index.ts`, `main.ts`, `bootstrap.ts` and `*.module.ts` are excluded
from collection, which is why a CASL registrar living in a module file is not
covered directly — `src/authorization/registered-abilities.spec.ts` covers it by
booting the real modules instead.

Branches is the threshold that breaks first, and it breaks for one reason: a new
error path with no test.

## End-to-end specs

Only for authentication, checkout and order history. Build the app with
`createTestApp()` from `test/support/create-test-app.ts` — it calls the same
`configureApp` that `main.ts` calls, so the pipe, the filter, helmet, CORS and
the prefix are the production ones. A test that configures its own app is
testing a different application.

`createTestApp` accepts overrides for `MailService` and `S3StorageService`. Use
them; a test must not send mail or write to S3.

Assert the status code, the response body, and the database state after the
call. A checkout test that does not read the row back has not tested checkout.
