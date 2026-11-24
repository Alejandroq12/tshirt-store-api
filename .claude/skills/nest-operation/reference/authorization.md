# Authentication and authorization on a route

Two separate mechanisms. Authentication answers "who is calling"; authorization
answers "may they do this". Conflating them is the mistake this file exists to
prevent.

## Authentication: on by default

`JwtAuthGuard` is registered as `APP_GUARD` in `AuthModule`, so it runs for
every route in the application. A new controller with no decorator requires a
valid access token, and the failure mode of forgetting a decorator is a locked
route rather than an open one.

Three states, and the contract's `x-authorization` decides which:

| `x-authorization` says               | Decorator         | `request.user`                    |
| ------------------------------------ | ----------------- | --------------------------------- |
| `anonymous`                          | `@Public()`       | absent                            |
| `anonymous or authenticated …`       | `@OptionalAuth()` | present if a valid token was sent |
| `authenticated`, `manager`, `client` | none              | always present                    |

Reading the caller:

```ts
// Required — throws 401 if the guard did not set it
changePassword(@CurrentUser() user: SessionPrincipal)

// Optional — pairs with @OptionalAuth()
getSku(@CurrentUser({ optional: true }) user?: SessionPrincipal)
```

`@CurrentUser()` without `optional` on an `@OptionalAuth()` route defeats the
point of the route. `@CurrentUser({ optional: true })` on a protected route is
harmless but says something untrue about the route to the next reader.

`@Public()` on a route the contract does not mark `anonymous` is the most
serious mistake available in this codebase. It is a one-word change that removes
authentication.

## Authorization: CASL, and only where a role is named

```ts
@Post()
@CheckAbilities({ action: 'create', subject: 'ProductSku' })
createSku(...)
```

`@CheckAbilities` sets metadata and applies `AbilitiesGuard` in one decorator.
`action` is one of `manage | create | read | list | update | delete`; `subject` is
one of `AppSubjects` in `src/authorization/ability.types.ts`. That is a Prisma
model name, with one exception: `'PaymentIntent'` names no table, because a
Payment Intent is stored on its order. It is a subject of its own so that the
client-only `createPaymentIntent` does not borrow an `Order` ability granted for
another operation.

**CASL does not guard the public reads.** `listProducts` and `getProduct` have no
ability check at all. Visibility there is a `where` clause in the service, not a
rule — an anonymous caller has no user to build an ability from. Adding
`@CheckAbilities` to a public read would break it, and the reason is worth
understanding rather than memorising.

## Registering a rule

Rules belong to the feature that owns the subject, in a private registrar inside
its module:

```ts
@Injectable()
class SkusAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role !== UserRole.MANAGER) return;
      can('create', 'ProductSku');
      can('update', 'ProductSku');
    });
  }
}

@Module({
  imports: [AuthorizationModule, NotificationsModule, PrismaModule],
  controllers: [SkusController],
  providers: [SkusService, SkusAbilityRegistrar],
})
export class SkusModule {}
```

Three things carry the design:

- `src/authorization/` holds the mechanism and **no rules**.
  `CaslAbilityFactory` starts empty; the features fill it. Adding a rule there
  is a finding.
- What is registered is a **function**, not a permission. It runs per caller, so
  the same registrar grants a manager two abilities and a client none.
- The module must import `AuthorizationModule` to inject `CaslAbilityFactory`.

The grant is deliberately narrow. A client gets exactly six rules
(`update ProductLike`, `manage Cart`, `create`/`list`/`update Order`,
`create PaymentIntent`) and a manager eight (`create`/`update Product`,
`create`/`update ProductSku`, `create ProductImage`, `read`/`update Order`,
`create PaymentLink`); `src/authorization/registered-abilities.spec.ts` lists
each expected ability per role and asserts both rule counts. Do not add
`can('read', 'Product')` to make the model tidier; nothing checks it, and that
test is the guard against permission creep, so a new rule means updating it on
purpose.

## Adding a rule for a new operation

1. `get_operation` → read `x-authorization` verbatim.
2. `client` or `manager` → one `@CheckAbilities` on the route and one `can(...)`
   in that feature's registrar. Nothing else.
3. Extend `registered-abilities.spec.ts`: the new ability is `true` for the role
   that gets it, `false` for every other role, and no unasked-for ability
   appeared.
4. Add the 403 case to the controller spec — the negative is the test that
   matters.
