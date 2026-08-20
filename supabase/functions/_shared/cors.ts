// Shared CORS configuration for edge functions invoked directly from the
// browser via supabase-js's `supabase.functions.invoke(...)`.
//
// WHY THIS LIST OF HEADERS, VERIFIED AGAINST THE ACTUAL CLIENT SOURCE:
// A browser preflight (OPTIONS) only succeeds if every header the real
// request will carry is named in Access-Control-Allow-Headers — an omitted
// name fails the preflight even though header MATCHING itself is
// case-insensitive. Inspecting the installed client packages (not
// documentation) shows exactly four headers supabase-js v2 attaches to a
// default `functions.invoke(name, { body })` call with no explicit
// `headers`/`region` option:
//
//   - apikey          — node_modules/@supabase/supabase-js/src/lib/fetch.ts
//                        `fetchWithAuth()`: `if (!headers.has('apikey')) headers.set('apikey', supabaseKey)`.
//                        This wrapped fetch becomes the FunctionsClient's
//                        customFetch (SupabaseClient.ts `get functions()`),
//                        so every invoke() call carries it.
//   - Authorization   — same file/function: `headers.set('Authorization', \`Bearer ${accessToken}\`)`.
//   - X-Client-Info   — node_modules/@supabase/supabase-js/src/lib/constants.ts
//                        `DEFAULT_HEADERS = { 'X-Client-Info': 'supabase-js-<env>/<version>' }`,
//                        merged into `SupabaseClient.headers` and passed as
//                        `FunctionsClient`'s `headers` option
//                        (node_modules/@supabase/functions-js/src/FunctionsClient.ts
//                        constructor), so `invoke()` sends it via
//                        `{ ..._headers, ...this.headers, ...headers }`.
//   - Content-Type    — node_modules/@supabase/functions-js/src/FunctionsClient.ts
//                        `invoke()`: set to 'application/json' whenever the
//                        call body isn't a Blob/ArrayBuffer/string/FormData,
//                        which is how every caller in this app invokes
//                        (plain object bodies).
//
// `X-Supabase-Api-Version` (seen in @supabase/auth-js) and `x-region`
// (FunctionsClient, only added when an explicit `region` option is passed)
// are NOT part of this app's default invoke() calls — grep of src/ shows no
// caller passes `region` or custom `headers`. If that ever changes, this
// list needs to change with it.
export const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Client-Info, Apikey'

/**
 * Builds the CORS header set for a browser-invokable edge function.
 * `appOrigin` should come from `Deno.env.get('APP_ORIGIN')` at the call
 * site (defaulting to `http://localhost:5173`) — kept as a parameter here,
 * rather than read from Deno.env inside this module, so _shared stays free
 * of Deno-only globals and runs under `npm run typecheck:shared` and under
 * vitest (see cors.test.ts) the same as every other _shared module.
 */
export function buildCorsHeaders(appOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': appOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    // Lets the browser cache a successful preflight for 24h instead of
    // re-running OPTIONS before every single POST to this function.
    'Access-Control-Max-Age': '86400',
  }
}
