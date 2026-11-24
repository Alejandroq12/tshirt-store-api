import type { ImageContentType } from '../storage/image-upload.constants';
import { matchesImageSignature } from './image-signature';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
]);

describe('matchesImageSignature', () => {
  it.each<[ImageContentType, Buffer]>([
    ['image/jpeg', JPEG],
    ['image/png', PNG],
    ['image/webp', WEBP],
  ])('accepts %s bytes declared as that type', (contentType, content) => {
    expect(matchesImageSignature(content, contentType)).toBe(true);
  });

  it.each<[ImageContentType, Buffer]>([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
    ['image/png', PNG.subarray(0, 8)],
    ['image/webp', WEBP.subarray(0, 12)],
  ])('accepts %s bytes that end at the signature', (contentType, content) => {
    expect(matchesImageSignature(content, contentType)).toBe(true);
  });

  it.each<[ImageContentType, Buffer]>([
    ['image/png', JPEG],
    ['image/webp', JPEG],
    ['image/jpeg', PNG],
    ['image/webp', PNG],
    ['image/jpeg', WEBP],
    ['image/png', WEBP],
  ])('refuses %s when the bytes are another format', (contentType, content) => {
    expect(matchesImageSignature(content, contentType)).toBe(false);
  });

  it.each<ImageContentType>(['image/jpeg', 'image/png', 'image/webp'])(
    'refuses text declared as %s',
    (contentType) => {
      expect(
        matchesImageSignature(
          Buffer.from('not an image, only text'),
          contentType,
        ),
      ).toBe(false);
    },
  );

  it('refuses a RIFF container that is not WebP', () => {
    const wave = Buffer.concat([WEBP.subarray(0, 8), Buffer.from('WAVE')]);

    expect(matchesImageSignature(wave, 'image/webp')).toBe(false);
  });

  it.each<[ImageContentType, Buffer]>([
    ['image/jpeg', JPEG.subarray(0, 2)],
    ['image/png', PNG.subarray(0, 7)],
    ['image/webp', WEBP.subarray(0, 11)],
    ['image/webp', WEBP.subarray(0, 4)],
  ])(
    'refuses %s bytes too short to hold the signature',
    (contentType, content) => {
      expect(matchesImageSignature(content, contentType)).toBe(false);
    },
  );

  it.each<ImageContentType>(['image/jpeg', 'image/png', 'image/webp'])(
    'refuses an empty file declared as %s',
    (contentType) => {
      expect(matchesImageSignature(Buffer.alloc(0), contentType)).toBe(false);
    },
  );
});
