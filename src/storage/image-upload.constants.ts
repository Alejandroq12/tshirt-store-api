export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const IMAGE_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;

export const isSupportedImageType = (
  contentType: string,
): contentType is ImageContentType =>
  Object.hasOwn(IMAGE_CONTENT_TYPES, contentType);
