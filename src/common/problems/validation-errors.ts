import { ValidationError } from 'class-validator';

import { ValidationProblemError } from './problem.types';

const isArrayIndex = (property: string): boolean => /^\d+$/.test(property);

const joinPath = (parent: string, property: string): string => {
  if (parent === '') return property;
  return isArrayIndex(property)
    ? `${parent}[${property}]`
    : `${parent}.${property}`;
};

export const flattenValidationErrors = (
  errors: ValidationError[],
  parentPath = '',
): ValidationProblemError[] => {
  const flattened: ValidationProblemError[] = [];

  for (const error of errors) {
    const field = joinPath(parentPath, error.property);

    for (const message of Object.values(error.constraints ?? {})) {
      flattened.push({ field, message });
    }

    if (error.children && error.children.length > 0) {
      flattened.push(...flattenValidationErrors(error.children, field));
    }
  }

  return flattened;
};
