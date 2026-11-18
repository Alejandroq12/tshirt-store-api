// The largest value a PostgreSQL int column holds. A larger integer passes
// IsInt and then fails the write, so the DTO caps it here.
export const INT4_MAX = 2147483647;
