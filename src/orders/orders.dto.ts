import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Min } from 'class-validator';

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

export class OrderStatusUpdateRequest {
  @IsEnum(OrderStatusUpdate)
  status!: OrderStatusUpdate;
}
