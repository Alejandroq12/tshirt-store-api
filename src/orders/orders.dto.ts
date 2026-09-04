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

const REQUIRES_TIME_OF_DAY = /T/;

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
  @Matches(REQUIRES_TIME_OF_DAY, {
    message: '$property must be a date-time, not a date.',
  })
  from?: string;

  @IsOptional()
  @IsISO8601(ISO_DATE_TIME)
  @Matches(REQUIRES_TIME_OF_DAY, {
    message: '$property must be a date-time, not a date.',
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
