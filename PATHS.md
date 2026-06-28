# Authoring acquisition paths

Ghost Companion's farming knowledge lives in [`src/data/dropRates.json`](src/data/dropRates.json).
Each item maps to one or more **acquisition paths** — the ways you can get it, with
the source activities that count as a "run" for auto-tracking. Adding an item is
just adding a JSON entry; no code changes required.

> Prefer not to touch JSON? You can add a path live from inside the app with
> **"+ ADD PATH"** after scanning an item — it writes to your local store and
> never touches this file. This guide is for baking paths into the shipped data
> (e.g. to contribute them back).

## The format

The file is keyed by item **name** (so it matches any reissue). `itemHash` is
stored for reference. Every path looks like:

```jsonc
"Vex Mythoclast": {
  "itemHash": 4289226715,
  "acquisitionPaths": [
    {
      "id": "final_boss",                     // stable id, unique within the item
      "method": "Final Boss — Atheon",        // short label shown on the card
      "pathType": "boss_drop",                // see path types below
      "location": "Vault of Glass",           // where / which activity
      "sourceActivityHashes": [3711931140, 3881495763, 1681562271, 3022541210, 1485585878],
      "dropRate": 0.1,                         // 0..1 chance per run
      "farmable": false,                       // true = repeatable, false = weekly-locked
      "weeklyLimitPerCharacter": 1,            // number, or null when farmable
      "estimatedMinutesPerRun": 45,            // rough minutes per attempt
      "description": "Drops only from Atheon, once per character per week.",
      "notes": "Run all three characters for 3 weekly chances."  // or null
    }
  ]
}
```

`sourceActivityHashes` is what makes **auto-tracking** work: when the Bungie API
reports you completing any activity in that list, the matching path's run counter
ticks up automatically. Include every variant (Standard, Master, Challenge Mode)
so it fires on any difficulty. Leave it `[]` for quest/vendor paths that aren't
tied to a repeatable activity.

### `pathType` values

`secret_chest` · `encounter_drop` · `boss_drop` · `craftable` · `vendor` ·
`quest` · `other` — these drive the icon and color on the card.

### Farmability rule (current game)

As of the Sept 2025 update (and the later MoT update), **every raid/dungeon
exotic is farmable on a single character with no weekly lockout** — so exotic
*drop* paths use `farmable: true` / `weeklyLimitPerCharacter: null`. Exceptions:
one-time quest exotics (`dropRate: 1.0`) and per-week secret chests stay weekly.
Legendary raid/dungeon weapons still follow per-character weekly encounter drops.
Don't mark something `craftable` unless the Manifest actually has a recipe — run
`npm run audit` and it'll flag a `craftable` path with no recipe.

## Finding the hashes

Don't guess hashes — look them up against the Manifest you've already downloaded:

```bash
npm run lookup -- "Vex Mythoclast"            # items + activities matching the name
npm run lookup -- --items "Fatebringer"       # items only
npm run lookup -- --activities "Vault of Glass"  # activities only (for sourceActivityHashes)
```

(The script self-relaunches under Electron to match better-sqlite3's ABI, so plain
`node scripts/lookup.mjs ...` works too.)

A name often returns several rows — reissues and Timelost/Adept variants share a
name but differ by hash. Any one current hash is fine for the reference field
since matching is by name; for `sourceActivityHashes`, include all the run
variants the lookup returns (normal, Standard, Master, Challenge Mode).

## Checklist before you commit

- [ ] `itemHash` and every `sourceActivityHash` came from `npm run lookup` (not memory).
- [ ] `dropRate` is between 0 and 1 (a community estimate is fine — note it's approximate).
- [ ] `farmable: false` entries have a numeric `weeklyLimitPerCharacter`; `farmable: true` uses `null`.
- [ ] The file still parses: `node -e "require('./src/data/dropRates.json')"`.
- [ ] `npm run audit` passes (verifies every itemHash/activityHash against the live Manifest and flags stale `craftable` flags).
