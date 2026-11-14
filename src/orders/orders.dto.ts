import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,7})\.\d{2}$/;

const ISO_DATE_TIME = { strict: true, strictSeparator: true } as const;

// IsISO8601 also admits week, ordinal, basic and hour-only forms that
// Date cannot parse; format: date-time needs seconds and an offset.
const RFC_3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset!: number;
}

export class ListMyOrdersQuery extends ListOrdersQuery {
  @IsOptional()
  @IsISO8601(ISO_DATE_TIME)
  @Matches(RFC_3339_DATE_TIME, {
    message: '$property must be an RFC 3339 date-time with a time-zone offset.',
  })
  from?: string;

  @IsOptional()
  @IsISO8601(ISO_DATE_TIME)
  @Matches(RFC_3339_DATE_TIME, {
    message: '$property must be an RFC 3339 date-time with a time-zone offset.',
  })
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
