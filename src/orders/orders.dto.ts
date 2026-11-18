import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  ValidateBy,
} from 'class-validator';

import { IntegerQuery } from '../common/validation/integer-query.decorator';

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,7})\.\d{2}$/;

const ISO_DATE_TIME = { strict: true, strictSeparator: true } as const;

// IsISO8601 also admits week, ordinal, basic and hour-only forms that
// Date cannot parse; format: date-time needs seconds and an offset.
const RFC_3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// An offset can carry an instant across a year boundary:
// 9999-12-31T23:59:59-23:59 is year 10000 in UTC. Date writes such a year as
// +010000, or -000001 below year 0, which Prisma cannot send to PostgreSQL,
// so the query answered 500. A string Date cannot read is left to the format
// checks.
const InFourDigitUtcYear = () =>
  ValidateBy({
    name: 'inFourDigitUtcYear',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string') return true;
        const year = new Date(value).getUTCFullYear();
        return Number.isNaN(year) || (year >= 0 && year <= 9999);
      },
      defaultMessage: () =>
        '$property must fall within the years 0000 to 9999 in UTC.',
    },
  });

export enum OrderStatusFilter {
  PENDING = 'pending',
  PAID = 'paid',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  CANCELLED = 'cancelled',
}

export enum OrderStatusUpdate {
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  CANCELLED = 'cancelled',
}

export class OrderIdParams {
  @IsUUID()
  orderId!: string;
}

export class ListOrdersQuery {
  @IntegerQuery()
  @Min(1)
  limit!: number;

  @IntegerQuery()
  @Min(0)
  offset!: number;
}

export class ListMyOrdersQuery extends ListOrdersQuery {
  @IsOptional()
  @IsISO8601(ISO_DATE_TIME)
  @Matches(RFC_3339_DATE_TIME, {
    message: '$property must be an RFC 3339 date-time with a time-zone offset.',
  })
  @InFourDigitUtcYear()
  from?: string;

  @IsOptional()
  @IsISO8601(ISO_DATE_TIME)
  @Matches(RFC_3339_DATE_TIME, {
    message: '$property must be an RFC 3339 date-time with a time-zone offset.',
  })
  @InFourDigitUtcYear()
  to?: string;

  @IsOptional()
  @IsEnum(OrderStatusFilter)
  status?: OrderStatusFilter;

  @IsOptional()
  @Matches(AMOUNT_PATTERN)
  minPrice?: string;

  @IsOptional()
  @Matches(AMOUNT_PATTERN)
  maxPrice?: string;
}

export class OrderStatusUpdateRequest {
  @IsEnum(OrderStatusUpdate)
  status!: OrderStatusUpdate;
}
