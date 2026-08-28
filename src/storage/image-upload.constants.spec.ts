import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  isSupportedImageType,
} from './image-upload.constants';

describe('isSupportedImageType', () => {
  it.each(Object.keys(IMAGE_CONTENT_TYPES))('accepts %s', (contentType) => {
    expect(isSupportedImageType(contentType)).toBe(true);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', ''])(
    'rejects %s',
    (contentType) => {
      expect(isSupportedImageType(contentType)).toBe(false);
    },
  );

  it.each([
    'constructor',
    'toString',
    'valueOf',
    '__proto__',
    'hasOwnProperty',
  ])('rejects the inherited property %s', (contentType) => {
    expect(isSupportedImageType(contentType)).toBe(false);
  });

  it('maps every accepted type to a distinct extension', () => {
    const extensions = Object.values(IMAGE_CONTENT_TYPES);

    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it('states the 5 MB limit the lifecycle document specifies', () => {
    expect(IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
