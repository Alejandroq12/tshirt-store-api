import { ValidateIf } from 'class-validator';

export const OptionalProperty = () =>
  ValidateIf((_object, value) => value !== undefined);
