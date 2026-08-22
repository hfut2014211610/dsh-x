import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { clientBundle } from '../tsdown.client.ts'

const ID = '@deepseek-ai/dsh-client-ui-werewolf'
const PNG_PREFIX = '\0dsh-werewolf-png:'
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

const bundle = clientBundle(ID, ['lib/types/index.js', 'lib/types/invariant.js'])

export default (input: Parameters<typeof bundle>[0]): ReturnType<typeof bundle> => bundle(input).map((config) => {
  if (config.name !== `${ID}/client`) return config
  return {
    ...config,
    plugins: [...(config.plugins ?? []), {
      name: 'dsh-werewolf-png-data-url',
      resolveId: {
        order: 'pre' as const,
        handler(source: string, importer: string | undefined) {
          if (!source.endsWith('.png') || importer === undefined) return null
          const emitted = resolve(dirname(importer), source)
          const boundary = emitted.indexOf(TYPES_MARKER)
          const file = boundary < 0
            ? emitted
            : resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
          return PNG_PREFIX + file
        },
      },
      async load(id: string) {
        if (!id.startsWith(PNG_PREFIX)) return null
        const base64 = (await readFile(id.slice(PNG_PREFIX.length))).toString('base64')
        return `export default ${JSON.stringify(`data:image/png;base64,${base64}`)}`
      },
    }],
  }
})
