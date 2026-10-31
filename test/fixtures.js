// Shared test data.

const seg = (marker, body) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
};

/** A JPEG-shaped file (never decoded): JFIF, an Exif block with a place in it, a frame header, a scan. */
export function fakeJpeg({ width = 640, height = 480, exif = 'Exif\0\0GPS 51.5N 0.12W Pixel 9' } = {}) {
  const sof = Buffer.alloc(15);
  sof.writeUInt8(8, 0);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof.writeUInt8(3, 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.from(exif, 'latin1')),
    seg(0xfe, Buffer.from('a comment from the camera', 'latin1')),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    Buffer.alloc(200, 0x5a),
    Buffer.from([0xff, 0xd9]),
  ]);
}
