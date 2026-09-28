export function validSignatureImage(value) {
  if (value === '' || value == null) return true;
  if (typeof value !== 'string' || value.length > 100000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value.slice(22), 'base64');
  return bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 1000
    && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 500
    && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND';
}
export const signatureImageField = { type: String, default: '', validate: { validator: validSignatureImage, message: 'Signature must be a PNG image under 100 KB and at most 1000 × 500 pixels.' } };
