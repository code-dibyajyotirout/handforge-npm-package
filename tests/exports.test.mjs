import test from 'node:test';
import assert from 'node:assert/strict';

test('HandForge subpath and root module exports test', async () => {
  const root = await import('../dist/index.js');
  assert.ok(root.SculptingEngine, 'SculptingEngine exported from root');
  assert.ok(root.TransformGizmo, 'TransformGizmo exported from root');
  assert.ok(root.AnimTimeline, 'AnimTimeline exported from root');
  assert.ok(root.ProjectManager, 'ProjectManager exported from root');
  assert.ok(root.OneEuroFilter, 'OneEuroFilter exported from root');
  assert.ok(root.OneEuroFilter3D, 'OneEuroFilter3D exported from root');
  assert.ok(root.CoordinateMapper, 'CoordinateMapper exported from root');
  assert.ok(root.GestureClassifier, 'GestureClassifier exported from root');
  assert.ok(root.SpatialTracker, 'SpatialTracker exported from root');
  assert.ok(root.Studio, 'Studio exported from root');

  const engine = await import('../dist/engine/index.js');
  assert.ok(engine.SculptingEngine, 'SculptingEngine exported from engine');
  assert.ok(engine.TransformGizmo, 'TransformGizmo exported from engine');
  assert.ok(engine.AnimTimeline, 'AnimTimeline exported from engine');
  assert.ok(engine.ProjectManager, 'ProjectManager exported from engine');

  const math = await import('../dist/math/index.js');
  assert.ok(math.OneEuroFilter, 'OneEuroFilter exported from math');
  assert.ok(math.OneEuroFilter3D, 'OneEuroFilter3D exported from math');
  assert.ok(math.CoordinateMapper, 'CoordinateMapper exported from math');
  assert.ok(math.GestureClassifier, 'GestureClassifier exported from math');

  const vision = await import('../dist/vision/index.js');
  assert.ok(vision.SpatialTracker, 'SpatialTracker exported from vision');

  const components = await import('../dist/components/index.js');
  assert.ok(components.Studio, 'Studio component exported from components');
});
