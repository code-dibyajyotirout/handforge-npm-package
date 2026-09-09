import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimTimeline, ProjectManager } from '../dist/engine/index.js';

test('AnimTimeline manages keyframe state and export/import roundtrip', () => {
  const timeline = new AnimTimeline();
  assert.equal(timeline.count, 0);
  assert.equal(timeline.fps, 30);
  assert.equal(timeline.totalFrames, 120);

  // Import mock keyframes
  const mockData = {
    keyframes: [
      {
        frame: 0,
        parts: [{ name: 'mesh_0', rotation: { x: 0, y: 0, z: 0 }, scale: 1, position: { x: 0, y: 0, z: 0 } }]
      },
      {
        frame: 60,
        parts: [{ name: 'mesh_0', rotation: { x: 1, y: 0, z: 0 }, scale: 2, position: { x: 5, y: 0, z: 0 } }]
      }
    ],
    totalFrames: 120,
    fps: 30
  };

  timeline.importKeyframes(mockData);
  assert.equal(timeline.count, 2);

  const exported = timeline.exportKeyframes();
  assert.equal(exported.keyframes.length, 2);
  assert.equal(exported.totalFrames, 120);
  assert.equal(exported.fps, 30);
  assert.equal(exported.keyframes[1].frame, 60);

  timeline.seekTo(30);
  assert.equal(timeline.currentFrame, 30);
});

test('ProjectManager exposes file extension and constants', () => {
  assert.equal(ProjectManager.EXT, '.hf3d');
});
