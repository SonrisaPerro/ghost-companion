// =============================================================================
// rotations.test.mjs — unit tests for the rotation resolver + source parser.
// Run: node --test scripts/rotations.test.mjs   (from server/)
//
// Ground truth (seed): week of 2026-06-30 → 2026-07-07 (reset Tue 17:00 UTC).
//   featured raids    = Crota's End + Vault of Glass
//   featured dungeons = Warlord's Ruin + Grasp of Avarice
//   GM Alert          = The Sunless Cell (weapon: Null Composure)
// =============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRotations } from '../src/rotations.js'
import { parseWeek, pageModifiedAt } from '../src/rotations-source.js'

// A moment squarely inside the June 30 – July 7 reset week (after Tue 17:00 UTC).
const INSIDE_WEEK = new Date('2026-07-01T12:00:00.000Z')
const WEEK_ISO = '2026-06-30T17:00:00.000Z'

test('resolves the ground-truth week to source=computed, verified', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.equal(r.source, 'computed')
  assert.equal(r.verified, true)
  assert.equal(r.weekOf, WEEK_ISO)
  assert.equal(r.origin, 'seed')
})

test('featured raids match ground truth', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.deepEqual(r.featuredRaids, ["Crota's End", 'Vault of Glass'])
})

test('featured dungeons match ground truth', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.deepEqual(r.featuredDungeons, ["Warlord's Ruin", 'Grasp of Avarice'])
})

test('Grandmaster Alert + weapon match ground truth', () => {
  const r = resolveRotations(INSIDE_WEEK)
  assert.deepEqual(r.grandmasterAlert, {
    activity: 'The Sunless Cell',
    weapon: 'Null Composure'
  })
})

test('an unentered week resolves to source=unknown (no fabrication)', () => {
  const r = resolveRotations(new Date('2027-01-05T18:00:00.000Z'))
  assert.equal(r.source, 'unknown')
  assert.equal(r.verified, false)
  assert.deepEqual(r.featuredRaids, [])
  assert.deepEqual(r.featuredDungeons, [])
  assert.equal(r.grandmasterAlert, null)
  assert.equal(r.origin, null)
})

test('resolves right at the reset boundary (Tue 17:00:00 UTC)', () => {
  const r = resolveRotations(new Date(WEEK_ISO))
  assert.equal(r.weekOf, WEEK_ISO)
  assert.equal(r.source, 'computed')
})

test('one second BEFORE reset falls into the prior (unentered) week', () => {
  const r = resolveRotations(new Date('2026-06-30T16:59:59.000Z'))
  assert.equal(r.weekOf, '2026-06-23T17:00:00.000Z')
  assert.equal(r.source, 'unknown')
})

// --- source parser (rotations-source.js) ------------------------------------
// Fixture modeled on the real Kyber's markup: structured kyber-rad-title blocks
// (raids first, then dungeons) with a STALE on-page date, gated by the page's
// article:modified_time (which the real page keeps current even when the visible
// date text is not).
const MODIFIED_AFTER_RESET = '2026-07-01T03:11:18+00:00' // > WEEK_ISO reset
const FIXTURE = `
  <meta property="article:modified_time" content="${MODIFIED_AFTER_RESET}" />
  <h1>Weekly Featured Raids and Dungeons</h1>
  <div class="kyber-rad-title">Crota&#8217;s End</div><div class="kyber-rad-date">June 16 - 23</div>
  <div class="kyber-rad-title">Vault of Glass</div>
  <div class="kyber-rad-title">Warlord&#8217;s Ruin</div>
  <div class="kyber-rad-title">Grasp of Avarice</div>
`

test('parseWeek extracts + classifies featured raids and dungeons', () => {
  const w = parseWeek(FIXTURE, WEEK_ISO)
  assert.ok(w, 'should validate')
  assert.deepEqual(w.featuredRaids, ["Crota's End", 'Vault of Glass'])
  assert.deepEqual(w.featuredDungeons, ["Warlord's Ruin", 'Grasp of Avarice'])
  assert.equal(w.source, 'kyberscorner')
  assert.equal(w.verified, false)
  assert.equal(w.grandmasterAlert, null) // no stable GM source
})

test('parseWeek rejects a page not edited since the target reset (stale guard)', () => {
  // Same content, but resolving a FUTURE week whose reset is after the page's
  // modified_time → the page can't be for that week yet → reject.
  const w = parseWeek(FIXTURE, '2026-07-14T17:00:00.000Z')
  assert.equal(w, null)
})

test('parseWeek rejects a page with no modified_time metadata', () => {
  const noMeta = FIXTURE.replace(/<meta[^>]*>/, '')
  assert.equal(parseWeek(noMeta, WEEK_ISO), null)
})

test('parseWeek rejects when no known raid/dungeon titles are present', () => {
  const junk = `<meta property="article:modified_time" content="${MODIFIED_AFTER_RESET}" />` +
    '<div class="kyber-rad-title">Some Menu Link</div>'
  assert.equal(parseWeek(junk, WEEK_ISO), null)
})

test('pageModifiedAt parses the article:modified_time meta', () => {
  assert.equal(pageModifiedAt(FIXTURE), Date.parse(MODIFIED_AFTER_RESET))
  assert.ok(Number.isNaN(pageModifiedAt('<html></html>')))
})
