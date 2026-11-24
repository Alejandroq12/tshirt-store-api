import type { ImageContentType } from '../storage/image-upload.constants';

interface SignaturePart {
  offset: number;
  bytes: Buffer;
}

// WebP is a RIFF container: bytes 4-7 hold the chunk size, which varies per
// file, so only the two fixed tags around it are compared.
const SIGNATURES: Readonly<Record<ImageContentType, readonly SignaturePart[]>> =
  {
    'image/jpeg': [{ offset: 0, bytes: Buffer.from([0xff, 0xd8, 0xff]) }],
    'image/png': [
      {
        offset: 0,
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
    ],
    'image/webp': [
      { offset: 0, bytes: Buffer.from('RIFF', 'ascii') },
      { offset: 8, bytes: Buffer.from('WEBP', 'ascii') },
    ],
  };

// Compares only the leading bytes against the declared type's signature; the
// image is not decoded. A buffer too short to hold the signature does not match.
export const matchesImageSignature = (
  content: Buffer,
  contentType: ImageContentType,
): boolean =>
  SIGNATURES[contentType].every(({ offset, bytes }) =>
    content.subarray(offset, offset + bytes.length).equals(bytes),
  );
