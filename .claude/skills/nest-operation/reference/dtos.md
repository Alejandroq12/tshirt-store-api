# DTOs and validation

Request classes live in `src/<feature>/<feature>.dto.ts`. Response types do not
— they are interfaces exported from the service.

The pipe is configured in `src/bootstrap.ts` with `whitelist: true`,
`forbidNonWhitelisted: true`, `transform: true` and
`errorHttpStatusCode: 422`. Three consequences follow, and they are the whole
reason this file exists:

- A property with no validation decorator is **stripped**, so the service never
  sees it.
- A property the client sends that no class declares is a **422**, not something
  ignored.
- Validation failures are **422**, never 400. 400 is reserved for a request that
  is well-formed but wrong — an expired reset token, for instance.

## Path parameters get their own class

```ts
export class SkuIdParams {
  @IsUUID()
  skuId!: string;
}
```

Bound with `@Param()` on the whole object, not `@Param('skuId')`. This is what
makes a malformed id a 422 instead of reaching the database as garbage — and the
contract declares that 422 on almost every parameterised route.

## Optional properties use `@OptionalProperty()`

Never `@IsOptional()`. From `src/common/validation/optional-property.decorator.ts`.

`@IsOptional()` from class-validator skips validation when the value is `null`
as well as when it is absent, so `{ "price": null }` passes and reaches the
service as `null`. `@OptionalProperty()` skips only when the key is absent, so
an explicit `null` is a 422. `docs/implementation-notes.md` covers why this
mattered enough to write a decorator for.

## Money

```ts
const POSITIVE_AMOUNT = /^(?!0\.00$)(0|[1-9]\d{0,7})\.\d{2}$/;

@IsString()
@Matches(POSITIVE_AMOUNT)
price!: string;
```

Two patterns exist and the contract distinguishes them:

- `PositiveAmount` — excludes `0.00`. Item prices, SKU prices.
- `Amount` — permits `0.00`. Totals and subtotals, because an empty cart has to
  be representable.

`@IsString()` before `@Matches` is not decoration: without it a number gets a
regex error rather than a type error, and the message a client sees is wrong.

## A patch request with every field optional

`updateSku` shows the shape. Every property is `@OptionalProperty()`, and the
"at least one property" rule cannot be a class-validator decorator, so the
controller checks it and throws:

```ts
throw new ValidationProblemException([
  { field: '', message: 'At least one property is required.' },
]);
```

`ValidationProblemException` comes from `src/common/problems`. An empty `field`
means the error is about the body as a whole rather than one property.

## String bounds come from the contract

`MinLength(1)` and `MaxLength(n)` where `n` is the `maxLength` in the schema, not
a guess. `get_operation` gives the request schema name; read it in
`api/openapi.yaml` under `components/schemas`.

## Enums

Validate against the Prisma enum, not a string literal union:

```ts
import { UserRole } from '@prisma/client';

@IsEnum(UserRole)
role!: UserRole;
```

The contract spells enum values in lowercase and Prisma in uppercase. The
mapping is explicit at the boundary — check how an existing operation does it
before inventing a second way.
