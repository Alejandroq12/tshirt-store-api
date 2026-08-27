# Notas para empezar la API

Apuntes para mí cuando arranque el desarrollo en NestJS. El contrato es
[../api/openapi.yaml](../api/openapi.yaml) y el modelo es [db.dbml](db.dbml); esto solo recoge
lo que hay que tener presente al traducirlos a código.

## 1. Antes de escribir la primera línea

### El `ValidationPipe` por defecto rompe 24 de mis 28 operaciones

NestJS responde `400` cuando falla la validación. Mi contrato documenta `422` en
24 de 28 operaciones. Sin esta configuración, casi todo el contrato queda
desmentido en la primera petición con payload inválido.

```ts
app.useGlobalPipes(
  new ValidationPipe({
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
);
```

`forbidNonWhitelisted` no es opcional: 36 de mis schemas declaran
`additionalProperties: false` y 9 declaran `unevaluatedProperties: false`. Si el
DTO acepta campos desconocidos, el código es más permisivo que el contrato.

### `constraints.sql` se aplica como migración manual

Prisma no soporta CHECK constraints, ni índices parciales, ni triggers. Por eso
viven en [constraints.sql](constraints.sql) y no en el schema:

| Objeto | Cantidad |
|---|---|
| CHECK constraints | 18 |
| Índices (3 únicos parciales, 4 de apoyo) | 7 |
| Triggers | 1 |

El orden es: aplicar el schema Prisma primero, `constraints.sql` después.

### FKs compuestas en Prisma

`sku_image_assignments` y `order_items` usan llaves foráneas compuestas. Prisma
las soporta con `fields: [...]` / `references: [...]`, pero exige un índice único
del lado referenciado. Ya existen: `uq_sku_parent` y `uq_product_image_parent`
(ambos sobre `(product_id, id)`). No los quitar del schema.

## 2. Lo que la base ya garantiza

No reimplementar estas reglas en código. Si se violan, PostgreSQL lanza
excepción; lo que sí hay que hacer es traducir esa excepción al `409` o `422`
que el contrato documenta.

| Regla | Quién la impone |
|---|---|
| Un solo pedido `PENDING` por cliente | `uq_one_pending_order` |
| `sku_code` único en toda la tienda | `uq_skus_code` |
| Una sola combinación talla+color por producto | `uq_sku_variant` |
| Un correo de stock bajo por cliente, producto y ciclo | `uq_stock_notice_cycle` |
| Un item por SKU en un carrito | `uq_cart_sku` |
| Una línea por SKU en un pedido | `uq_order_sku` |
| Una imagen primaria de producto y una por SKU | `uq_one_product_primary_image`, `uq_one_sku_primary_image` |
| Stock nunca negativo | `chk_skus_stock` |
| `low_stock_cycle` nunca negativo | `chk_products_low_stock_cycle`, `chk_stock_notice_cycle` |
| Un producto retirado no puede estar activo | `chk_products_retired_inactive` |
| `line_total = unit_price * quantity` | `chk_order_items_line` |
| `paid_at` coherente con el estado del pedido | `chk_orders_paid_at` |
| Ningún producto se borra físicamente | `trg_products_prevent_hard_delete` |

Hay 9 operaciones con `409` en el contrato. Cada una corresponde a una de estas
restricciones o a una transición de estado inválida.

## 3. Lo que solo garantiza el código

Nada en la base atrapa estos errores. Aquí es donde van a estar los bugs, así
que esta lista es también mi lista de tests unitarios de la semana 3.

| # | Regla | Qué pasa si se me olvida |
|---|---|---|
| 1 | Incrementar `products.low_stock_cycle` cuando el stock total vuelve a subir por encima de 3 | El sistema se comporta como si no existiera el ciclo: un correo por cliente y nunca más |
| 2 | Detectar el **flanco** de bajada (`> 3` → `<= 3`), no el nivel | Un `if (stock === 3)` se salta el caso 5 → 2, y quedarse en 2 vuelve a encolar correos |
| 3 | Tomar los locks en orden estable: producto primero, luego sus SKUs por id ascendente | Deadlocks bajo concurrencia (SQLSTATE 40P01) |
| 4 | Decrementar stock todo-o-nada | Un decremento parcial deja inventario y pedido inconsistentes |
| 5 | Reconciliar el carrito **restando** la cantidad pagada, no borrando la fila | Un carrito que creció de 2 a 5 pierde 3 unidades que el cliente sí quería |
| 6 | El worker que reprocesa `stripe_webhook_events WHERE processed_at IS NULL` con `FOR UPDATE SKIP LOCKED` | Un pago con stock insuficiente deja el pedido en `pending` para siempre; Stripe ya recibió el 204 y no reintenta |
| 7 | Revocar todas las sesiones al cambiar o resetear contraseña | Sesiones viejas siguen vivas tras un evento de seguridad |
| 8 | Rechazar la activación de un producto sin imagen primaria usable | El correo de stock bajo se queda sin imagen que incluir |
| 9 | Emparejar al comprador de un Payment Link por el email de la sesión de Stripe | Sin cliente no hay pedido: `orders.client_id` es NOT NULL |

Test mínimo para la regla 1 y 2, que son las más fáciles de romper:

```
stock 5 → 2   notifica y registra ciclo 0
stock 2 → 1   NO notifica (sigue por debajo del umbral)
stock 1 → 8   incrementa low_stock_cycle a 1
stock 8 → 3   vuelve a notificar al mismo cliente, ciclo 1
```

## 4. Guardrail del contrato

Para que el YAML no se degrade mientras desarrollo:

```json
"lint:api": "redocly lint api/openapi.yaml"
```

Estado al momento de entregar el diseño: válido, 0 errores, 1 advertencia
(`info-license`, ignorada a propósito).

## 5. Decisiones mías que debo confirmar con Erick mientras desarrollo

Ninguna bloquea el arranque, pero todas son interpretación propia y no
instrucción suya:

- **"Delete products" como baja lógica.** `PATCH /products/{id}` con
  `status: retired`, sin `DELETE`. Le pareció razonable en la reunión pero no lo
  confirmó como la interpretación definitiva.
- **Los estados `active` / `inactive` / `retired`.** Solo `inactive` traza
  directo a un requerimiento ("Disable products").
- **`retired` es permanente y no reactivable.**
- **El modelo de imágenes por SKU.** Él pidió resolver la selección por
  variante; el diseño concreto (`sku_image_assignments` M2M con fallback) es mío.
- **`GET /manager/products` como el endpoint innecesario.** Él dijo que había
  uno, nunca lo nombró. Lo quité por trazabilidad propia, no porque lo señalara.
- **Stripe.** El modelo todavía marca los identificadores como BLUEPRINT
  pendientes del workshop, mientras el contrato ya describe el flujo completo.
  Alinear cuando el workshop ocurra.

## 6. Dónde está documentada cada regla

| Busco | Archivo |
|---|---|
| Rutas, schemas, códigos, ejemplos | [openapi.yaml](../api/openapi.yaml) |
| Tablas, columnas, relaciones, índices | [db.dbml](db.dbml) |
| CHECKs, índices parciales, trigger | [constraints.sql](constraints.sql) |
| Estados, borrados, stock, sesiones, notificaciones | [data-lifecycle.md](data-lifecycle.md) |
| Flujos internos, locks, cola, monitoreo | [architecture.md](architecture.md) |
| Qué decidí yo y no viene de un requerimiento | la sección 5 de este archivo |
