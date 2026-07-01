// =============================================================================
// rotations.test.mjs — unit tests for the deterministic rotation resolver.
// Run: node --test scripts/rotations.test.mjs   (from server/)
//
// Ground truth: week of 2026-06-30 → 2026-07-07 (reset Tue 2026-06-30 17:00 UTC).
//   featured raids    = Crota's End + Vault of Glass
//   featured dungeons = Warlord's Ruin + Grasp of Avarice
//   GM Nightfall      = The Sunless Cell (reward: Null Composure)
// =============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRotations } from '../src/rotations.js'

// A moment squarely inside the June 30 – July 7 reset week (after Tue 17:00 UTC).
const INSIDE_WEEK = new Date('2026-07-01T12:00:00.000Z')

test('resolves the ground-truth week to source=computed, verified', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.equal(r.source, 'computed')
  assert.equal(r.verified, true)
  assert.equal(r.weekOf, '2026-06-30T17:00:00.000Z')
})

test('featured raids match ground truth', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.deepEqual(r.featuredRaids, ["Crota's End", 'Vault of Glass'])
})

test('featured dungeons match ground truth', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.deepEqual(r.featuredDungeons, ["Warlord's Ruin", 'Grasp of Avarice'])
})

test('Grand Master Nightfall + reward match ground truth', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.deepEqual(r.grandmasterNightfall, {
    activity: 'The Sunless Cell',
    weapon: 'Null Composure'
  })
})

test('an unentered week resolves to source=unknown (no fabrication)', () => {
  // Far-future week that is intentionally absent from the table.
  const r = resolveRotations(new Date('2027-01-05T18:00:00.000Z'))
  assert.equal(r.source, 'unknown')
  assert.equal(r.verified, false)
  assert.deepEqual(r.featuredRaids, [])
  assert.deepEqual(r.featuredDungeons, [])
  assert.equal(r.grandmasterNightfall, null)
})

test('resolves right at the reset boundary (Tue 17:00:00 UTC)', () => {
  const r = resolveRotations(new Date('2026-06-30T17:00:00.000Z'))
  assert.equal(r.weekOf, '2026-06-30T17:00:00.000Z')
  assert.equal(r.source, 'computed')
})

test('one second BEFORE reset falls into the prior (unentered) week', () => {
  const r = resolveRotations(new Date('2026-06-30T16:59:59.000Z'))
  assert.equal(r.weekOf, '2026-06-23T17:00:00.000Z')
  assert.equal(r.source, 'unknown')
})
