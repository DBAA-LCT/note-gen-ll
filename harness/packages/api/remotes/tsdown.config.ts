import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-remotes',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {
    hostPhase: true,
    // Rolldown on Windows cannot consume the package's references-only
    // aggregate tsconfig. The host artifact is built from the host face.
    lib: { tsconfig: 'tsconfig.host.json' },
  },
)
