import { clientBundle } from '../../../packages/client/tsdown.client.ts'

// Host half compiles straight from src (no repo tsc face for personal
// packages); the client entry defaults to src/client/index.ts when no build
// face is selected.
export default clientBundle('@personal/dsh-x-ui-model-hub', ['src/index.ts'])
