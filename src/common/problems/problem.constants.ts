export const PROBLEM_TYPE = {
  BLANK: 'about:blank',
  EMPTY_CART: 'urn:tshirt-store:problem:empty-cart',
  PENDING_ORDER_EXISTS: 'urn:tshirt-store:problem:pending-order-exists',
} as const;

export type ProblemType = (typeof PROBLEM_TYPE)[keyof typeof PROBLEM_TYPE];

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
