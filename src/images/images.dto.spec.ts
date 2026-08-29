import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UploadProductImageRequest } from './images.dto';

const SKU_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

describe('UploadProductImageRequest', () => {
  it('normalizes one multipart SKU field and exact Boolean strings', () => {
    const input = plainToInstance(UploadProductImageRequest, {
      skuIds: SKU_ID,
      primary: 'false',
    });

    expect(validateSync(input)).toHaveLength(0);
    expect(input).toEqual({ skuIds: [SKU_ID], primary: false });
  });

  it('accepts an omitted or empty SKU list as a fallback scope', () => {
    const omitted = plainToInstance(UploadProductImageRequest, {});
    const empty = plainToInstance(UploadProductImageRequest, { skuIds: [] });

    expect(validateSync(omitted)).toHaveLength(0);
    expect(validateSync(empty)).toHaveLength(0);
  });

  it.each([
    { skuIds: [SKU_ID, SKU_ID] },
    { skuIds: ['not-a-uuid'] },
    { skuIds: null },
    { primary: 'TRUE' },
    { primary: null },
  ])('rejects invalid multipart fields: %p', (value) => {
    const input = plainToInstance(UploadProductImageRequest, value);

    expect(validateSync(input).length).toBeGreaterThan(0);
  });
});
