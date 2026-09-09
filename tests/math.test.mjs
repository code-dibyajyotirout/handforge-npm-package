import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OneEuroFilter, OneEuroFilter3D, CoordinateMapper, GestureClassifier } from '../dist/math/index.js';

test('OneEuroFilter suppresses noise and smooths signal', () => {
  const filter = new OneEuroFilter(60, 1.0, 0.007, 1.0);
  
  // First measurement initializes state
  const val0 = filter.filter(10.0, 0.0);
  assert.equal(val0, 10.0);

  // Small perturbation should be heavily smoothed
  const val1 = filter.filter(10.1, 0.016);
  assert.ok(val1 < 10.1 && val1 > 10.0, 'Filtered value dampened noise');

  // Large rapid shift adapts cutoff to minimize latency
  const val2 = filter.filter(20.0, 0.033);
  assert.ok(val2 > 10.1, 'Adaptive filter reacts to fast movement');

  filter.reset();
  const resetVal = filter.filter(5.0, 0.0);
  assert.equal(resetVal, 5.0, 'Reset returns filter to initial state');
});

test('OneEuroFilter3D filters 3D coordinates independently', () => {
  const filter3D = new OneEuroFilter3D(60, 1.0, 0.007, 1.0);
  const inputVec1 = new THREE.Vector3(1.0, 2.0, 3.0);
  const v1 = filter3D.filter(inputVec1, 0.0);
  assert.equal(v1.x, 1.0);
  assert.equal(v1.y, 2.0);
  assert.equal(v1.z, 3.0);

  const inputVec2 = new THREE.Vector3(1.02, 2.01, 3.03);
  const v2 = filter3D.filter(inputVec2, 0.016);
  assert.ok(v2.x < 1.02 && v2.x > 1.0);
  assert.ok(v2.y < 2.01 && v2.y > 2.0);
  assert.ok(v2.z < 3.03 && v2.z > 3.0);
});

test('CoordinateMapper computes euclidean distance correctly', () => {
  const mapper = new CoordinateMapper();
  const p1 = { x: 0, y: 0, z: 0 };
  const p2 = { x: 3, y: 4, z: 0 };
  const dist = mapper.calculateDistance(p1, p2);
  assert.equal(dist, 5.0, '3-4-5 triangle distance is 5.0');
});

test('GestureClassifier classifies hover state with default landmarks', () => {
  const classifier = new GestureClassifier();
  const mapper = new CoordinateMapper();
  const emptyResult = classifier.classify([], mapper);
  assert.equal(emptyResult.state, 'hover');
  assert.equal(emptyResult.confidence, 0);
});
