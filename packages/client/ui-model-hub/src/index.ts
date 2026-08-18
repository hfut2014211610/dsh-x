/**
 * Host half of the model-hub settings page: a marker plugin so the loader has
 * an entry the client-module scan can pair with this package's `dsh.client`
 * declaration. All behavior lives in the browser half; configuration state
 * lives in the `dsh-x-model-hub` settings namespace owned by the host plugin.
 *
 * @module @deepseek-ai/dsh-client-ui-model-hub
 */

export const name = 'client-ui-model-hub'

/** No host-side behavior: the page talks to the settings seam over the wire. */
export function apply(): void {}
