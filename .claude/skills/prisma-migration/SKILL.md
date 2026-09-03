---
name: prisma-migration
description: How this repository changes the database — the Prisma schema, the constraints migration that holds everything Prisma cannot express, the test database, and the composite foreign keys that must not be broken. Use when adding or changing a model, column, index, CHECK constraint, trigger or migration.
---

# Changing the database

The schema is not only `prisma/schema.prisma`. Eighteen CHECK constraints, seven
indexes and one trigger live in SQL, because Prisma cannot express any of them.
A change that ignores the SQL half will pass `prisma validate` and fail at
runtime.

Read [`docs/db.dbml`](../../../docs/db.dbml) first — it is the anchor for the
data model, and a table or column that is not in it needs a requirement before
it needs a migration.

## What lives where

| Object                                     | Where                                                        |
| ------------------------------------------ | ------------------------------------------------------------ |
| Models, columns, relations, unique indexes | `prisma/schema.prisma`                                       |
| CHECK constraints (18)                     | `prisma/migrations/20260828002527_constraints/migration.sql` |
| Partial and supporting indexes (7)         | same file                                                    |
| The one trigger                            | same file                                                    |

The directory timestamps guarantee order: `..._init` applies, then
`..._constraints`. `prisma migrate deploy` follows that order in CI and in
production.

## Two things that must not be broken

**The composite foreign keys.** `sku_image_assignments` and `order_items` use
composite foreign keys. Prisma needs a unique index on the referenced side, and
`uq_sku_parent` and `uq_product_image_parent` — both on `(product_id, id)` —
exist for that and nothing else. They look redundant next to the primary key.
They are not. Removing one breaks the schema at generate time.

**The delete trigger on products.** There is no `DELETE` operation for a
product; retiring one is `PATCH` with `status: retired`, and the trigger rejects
a physical delete. A migration that drops it removes the guarantee the contract
depends on.

## The procedure

1. **Find the anchor.** Quote the requirement, the contract schema, or
   `docs/db.dbml`. A column no operation reads or writes does not get created.
2. **Edit `prisma/schema.prisma`.** Match the existing naming: snake_case in the
   database through `@map` and `@@map`, camelCase in TypeScript.
3. **Decide whether SQL is needed.** A CHECK, a partial index, a trigger, or an
   exclusion constraint cannot go in the schema. It goes in a new migration
   alongside the generated one.
4. **Generate the migration.** `npm run db:migrate` — it prompts, so the
   repository owner runs it. Never run it unattended, and never
   `prisma migrate reset`: it drops the development database.
5. **Read the generated SQL before it is applied.** Prisma renames by dropping
   and recreating, which silently discards data. If the generated SQL contains a
   `DROP COLUMN` you did not intend, stop.
6. **Migrate the test database.** `npm run db:migrate:test` uses `.env.test`.
   `npm run test:e2e` does it for you, but a failing e2e run right after a
   schema change is usually this step missing.
7. **Regenerate the client.** `npm run db:generate`, then `npm run typecheck` —
   a schema change that breaks a service shows up as a type error, and that is
   the cheapest place to see it.
8. **Update `docs/db.dbml`.** It is an anchor; an anchor that disagrees with the
   database is worse than none.

## The environment files

`.env` and `.env.test` are the repository owner's and cannot be read or written
here. `.env.example` and `.env.test.example` carry the same keys with placeholder
values, and they are the ones to read.

A new environment variable is not just a line in a template. It also needs:

- validation in `src/config/env.validation.ts`, so a bad value stops the boot;
- if it is secret-shaped, its name in `SECRET_VARIABLES` in
  `src/logging/redaction.ts`;
- if it is secret-shaped, its `.env.example` value in `PUBLISHED_PLACEHOLDERS` in
  `src/config/published-placeholders.ts`, so production refuses to boot with a
  value that is public in the repository.

A spec reads the templates from disk and fails when the third one is missed.
