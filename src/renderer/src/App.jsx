// App.jsx — renders the Ghost Companion UI.
// All Bungie/Manifest/tracking logic lives in GhostCompanion.jsx and talks to
// the main process exclusively through window.api (see src/preload/index.js).
import GhostCompanion from './GhostCompanion.jsx'

export default function App() {
  return <GhostCompanion />
}
