import assert from 'node:assert/strict';
import test from 'node:test';
import { cropBox, dragCrop, MAX_ZOOM, outputSize, zoomCrop } from '../shared/crop.js';

test('a square crop fits the shorter side and never leaves the image', () => {
  assert.deepEqual(cropBox(4000, 3000), { left: 500, top: 0, side: 3000 });
  assert.deepEqual(cropBox(3000, 4000, { zoom: 2 }), { left: 750, top: 1250, side: 1500 });
  assert.deepEqual(cropBox(4000, 3000, { zoom: 2, x: 0, y: 1 }), { left: 0, top: 1500, side: 1500 });
  assert.equal(cropBox(1000, 1000, { zoom: 99 }).side, 1000 / MAX_ZOOM);
  assert.equal(cropBox(1000, 1000, { zoom: .2 }).side, 1000);
});

test('dragging moves the photo under the frame, and zoom stays in range', () => {
  const crop = { zoom: 2, x: .5, y: .5 };
  // A 2000 px wide image at zoom 2 shows 1000 px in a 250 px frame, so 50 screen px is 200 image px.
  const moved = dragCrop(2000, 2000, crop, 50, 0, 250);
  assert.equal(moved.x, .4);
  assert.equal(moved.y, .5);
  assert.equal(dragCrop(2000, 2000, crop, 5000, -5000, 250).x, .25, 'clamped at the left edge');
  assert.equal(dragCrop(2000, 2000, crop, 5000, -5000, 250).y, .75, 'clamped at the bottom edge');
  assert.equal(zoomCrop(crop, 9).zoom, MAX_ZOOM);
  assert.equal(zoomCrop(crop, 0).zoom, 1);
});

test('photos are exported at up to 1024 px without blowing up small originals', () => {
  assert.equal(outputSize(3000), 1024);
  assert.equal(outputSize(300), 600);
  assert.equal(outputSize(40), 256);
});
