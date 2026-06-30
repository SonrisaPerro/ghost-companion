// =============================================================================
// packages.test.js — unit tests for the pure guide-package logic.
// Run with `npm test` (Node's built-in test runner, no deps).
// Covers the validate → merge → export round-trip and the rejection paths the
// importer relies on to refuse malformed/hostile *.ghostpkg.json files.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCHEMA_VERSION,
  LIMITS,
  validatePackage,
  mergeGuides,
  buildExport,
  withinSizeLimit
} from '../src/main/packages.js'

const goodPkg = () => ({
  ghostPackage: SCHEMA_VERSION,
  name: "Vesper's Host secret chests",
  guides: [
    {
      id: 'vespers-host-chest-1',
      title: 'First secret chest — Vesper\'s Host',
      type: 'secret_chest',
      itemHash: 1234567890,
      item: 'Some Reward',
      activity: "Vesper's Host",
      steps: [{ title: 'Step 1', description: 'Do the thing.' }],
      notes: 'optional'
    }
  ]
})

test('accepts a well-formed package and normalizes fields', () => {
  const res = validatePackage(goodPkg())
  assert.equal(res.ok, true)
  assert.equal(res.name, "Vesper's Host secret chests")
  assert.equal(res.guides.length, 1)
  const g = res.guides[0]
  assert.equal(g.id, 'vespers-host-chest-1')
  assert.equal(g.type, 'secret_chest')
  assert.equal(g.itemHash, 1234567890)
  assert.equal(g.source, "Vesper's Host secret chests") // stamped from package name
  assert.equal(g.steps.length, 1)
  assert.deepEqual(g.steps[0], { title: 'Step 1', description: 'Do the thing.' })
})

test('rejects a missing/unknown schema version', () => {
  const res = validatePackage({ guides: [] })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /ghostPackage/)
})

test('rejects a non-object input', () => {
  for (const bad of [null, undefined, 42, 'string', []]) {
    const res = validatePackage(bad)
    assert.equal(res.ok, false)
  }
})

test('rejects a package with no guides array', () => {
  const res = validatePackage({ ghostPackage: SCHEMA_VERSION })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /guides/)
})

test('rejects guides missing id or title, and duplicate ids', () => {
  const noId = validatePackage({ ghostPackage: SCHEMA_VERSION, guides: [{ title: 'x' }] })
  assert.equal(noId.ok, false)
  assert.match(noId.errors.join(' '), /id/)

  const noTitle = validatePackage({ ghostPackage: SCHEMA_VERSION, guides: [{ id: 'a' }] })
  assert.equal(noTitle.ok, false)
  assert.match(noTitle.errors.join(' '), /title/)

  const dup = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    guides: [
      { id: 'a', title: 'A', steps: [] },
      { id: 'a', title: 'A2', steps: [] }
    ]
  })
  assert.equal(dup.ok, false)
  assert.match(dup.errors.join(' '), /duplicate/)
})

test('coerces an unknown type to "guide" and bad hashes to null', () => {
  const res = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    name: 'pkg',
    guides: [{ id: 'a', title: 'A', type: 'nonsense', itemHash: 'not-a-number', activityHash: -5, steps: [] }]
  })
  assert.equal(res.ok, true)
  assert.equal(res.guides[0].type, 'guide')
  assert.equal(res.guides[0].itemHash, null)
  assert.equal(res.guides[0].activityHash, null)
})

test('drops malformed steps but keeps the guide', () => {
  const res = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    name: 'pkg',
    guides: [{ id: 'a', title: 'A', steps: ['bad', null, { title: 'ok', description: 'd' }] }]
  })
  assert.equal(res.ok, true)
  assert.equal(res.guides[0].steps.length, 1)
  assert.deepEqual(res.guides[0].steps[0], { title: 'ok', description: 'd' })
})

test('mergeGuides: incoming wins on id collision, counts add vs update', () => {
  const existing = [{ id: 'a', title: 'old A' }, { id: 'b', title: 'B' }]
  const incoming = [{ id: 'a', title: 'new A' }, { id: 'c', title: 'C' }]
  const { guides, added, updated } = mergeGuides(existing, incoming)
  assert.equal(added, 1) // c
  assert.equal(updated, 1) // a
  assert.equal(guides.length, 3)
  assert.equal(guides.find((g) => g.id === 'a').title, 'new A')
})

test('mergeGuides tolerates null/empty inputs', () => {
  assert.deepEqual(mergeGuides(null, null), { guides: [], added: 0, updated: 0 })
  const r = mergeGuides(undefined, [{ id: 'x', title: 'X' }])
  assert.equal(r.added, 1)
  assert.equal(r.guides.length, 1)
})

// --- hard-limit / safety rejections -----------------------------------------

test('rejects an id with an unsafe charset', () => {
  for (const badId of ['../etc', 'a b', 'a/b', '-leading', 'tab\there', '💀']) {
    const res = validatePackage({
      ghostPackage: SCHEMA_VERSION,
      guides: [{ id: badId, title: 'T', steps: [] }]
    })
    assert.equal(res.ok, false, `expected reject for id ${JSON.stringify(badId)}`)
    assert.match(res.errors.join(' '), /invalid id/)
  }
})

test('rejects too many guides', () => {
  const guides = Array.from({ length: LIMITS.GUIDES + 1 }, (_, i) => ({
    id: `g${i}`, title: 'T', steps: []
  }))
  const res = validatePackage({ ghostPackage: SCHEMA_VERSION, guides })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /too many guides/)
})

test('rejects too many steps in a guide', () => {
  const steps = Array.from({ length: LIMITS.STEPS + 1 }, () => ({ title: 's', description: 'd' }))
  const res = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    guides: [{ id: 'a', title: 'A', steps }]
  })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /too many steps/)
})

test('rejects over-long strings (title, notes, step description)', () => {
  const longTitle = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    guides: [{ id: 'a', title: 'x'.repeat(LIMITS.TITLE + 1), steps: [] }]
  })
  assert.equal(longTitle.ok, false)

  const longNotes = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    guides: [{ id: 'a', title: 'A', notes: 'x'.repeat(LIMITS.NOTES + 1), steps: [] }]
  })
  assert.equal(longNotes.ok, false)

  const longStep = validatePackage({
    ghostPackage: SCHEMA_VERSION,
    guides: [{ id: 'a', title: 'A', steps: [{ title: 'ok', description: 'x'.repeat(LIMITS.STEP_DESC + 1) }] }]
  })
  assert.equal(longStep.ok, false)
})

test('withinSizeLimit gates raw text by byte length', () => {
  assert.equal(withinSizeLimit('{"ghostPackage":1,"guides":[]}'), true)
  assert.equal(withinSizeLimit('x'.repeat(LIMITS.PACKAGE_BYTES)), true)
  assert.equal(withinSizeLimit('x'.repeat(LIMITS.PACKAGE_BYTES + 1)), false)
  // multibyte content counts by bytes, not chars
  assert.equal(withinSizeLimit('€'.repeat(LIMITS.PACKAGE_BYTES / 2)), false)
})

test('buildExport → validatePackage round-trips cleanly', () => {
  const validated = validatePackage(goodPkg())
  const pkg = buildExport(validated.guides, 'My export')
  assert.equal(pkg.ghostPackage, SCHEMA_VERSION)
  assert.equal(pkg.name, 'My export')
  assert.ok(pkg.createdAt)
  const reread = validatePackage(pkg)
  assert.equal(reread.ok, true)
  assert.equal(reread.guides.length, 1)
  assert.equal(reread.guides[0].id, 'vespers-host-chest-1')
})
