import { Prisma } from '@prisma/client';

import { StockCycleService } from './stock-cycle.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('StockCycleService', () => {
  const aggregate = jest.fn();
  const productUpdate = jest.fn();
  const queryRaw = jest.fn();
  const transaction = {
    productSku: { aggregate },
    product: { update: productUpdate },
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient;
  const service = new StockCycleService();

  beforeEach(() => {
    jest.clearAllMocks();
    aggregate.mockResolvedValue({ _sum: { stockQuantity: 7 } });
    productUpdate.mockResolvedValue({ id: PRODUCT_ID });
    queryRaw.mockResolvedValue([]);
  });

  it('runs the required low-stock sequence across two cycles', async () => {
    let cycle = 0;
    queryRaw.mockImplementation(() =>
      Promise.resolve([{ id: `notification-cycle-${cycle}` }]),
    );
    productUpdate.mockImplementation(() => {
      cycle += 1;
      return Promise.resolve({ id: PRODUCT_ID });
    });

    await expect(
      service.evaluate(transaction, PRODUCT_ID, 5, 2),
    ).resolves.toEqual(['notification-cycle-0']);
    await expect(
      service.evaluate(transaction, PRODUCT_ID, 2, 1),
    ).resolves.toEqual([]);
    await expect(
      service.evaluate(transaction, PRODUCT_ID, 1, 8),
    ).resolves.toEqual([]);
    await expect(
      service.evaluate(transaction, PRODUCT_ID, 8, 3),
    ).resolves.toEqual(['notification-cycle-1']);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(productUpdate).toHaveBeenCalledTimes(1);
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
      data: { lowStockCycle: { increment: 1 } },
      select: { id: true },
    });
  });

  it('builds the audience from likes and excludes paid non-cancelled purchases', async () => {
    queryRaw.mockResolvedValue([{ id: 'notification-id' }]);

    await expect(
      service.evaluate(transaction, PRODUCT_ID, 4, 3),
    ).resolves.toEqual(['notification-id']);

    const [query] = queryRaw.mock.calls[0] as [Prisma.Sql];
    const sql = query.strings.join(' ');
    expect(sql).toContain('JOIN product_likes');
    expect(sql).toContain("u.role = 'CLIENT'");
    expect(sql).toContain('oi.product_id = p.id');
    expect(sql).toContain('o.paid_at IS NOT NULL');
    expect(sql).toContain("o.status <> 'CANCELLED'");
    expect(sql).toContain(
      'ON CONFLICT (client_id, product_id, low_stock_cycle) DO NOTHING',
    );
    expect(query.values).toEqual([PRODUCT_ID]);
  });

  it.each([
    [3, 2],
    [2, 3],
    [8, 9],
  ])(
    'does nothing when stock changes from %i to %i without crossing',
    async (before, after) => {
      await expect(
        service.evaluate(transaction, PRODUCT_ID, before, after),
      ).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
      expect(productUpdate).not.toHaveBeenCalled();
    },
  );

  it('returns aggregate SKU stock and represents a product without SKUs as zero', async () => {
    await expect(service.totalStock(transaction, PRODUCT_ID)).resolves.toBe(7);
    aggregate.mockResolvedValue({ _sum: { stockQuantity: null } });
    await expect(service.totalStock(transaction, PRODUCT_ID)).resolves.toBe(0);
    expect(aggregate).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID },
      _sum: { stockQuantity: true },
    });
  });
});
