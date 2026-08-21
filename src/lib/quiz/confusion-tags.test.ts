import { describe, it, expect } from 'vitest'
import { CONFUSION_TAGS as UI_TAGS } from './types'
import { CONFUSION_TAGS as SCHEMA_TAGS } from '../../../supabase/functions/_shared/schemas'

/**
 * The closed confusion-tag enum exists in two places on purpose: the edge
 * functions are Deno-flavoured and tsconfig.app.json only includes `src`, so
 * the UI cannot import the schema module it mirrors.
 *
 * This test is what makes that duplication safe rather than merely documented.
 * A tag added to one list and not the other passes typecheck, passes the build,
 * and only surfaces at runtime as a diagnosis whose tag the UI has no idea what
 * to do with — or, worse, a tag the model is allowed to emit that no later
 * pattern pass will ever group. `schemas.ts` imports nothing but zod, so it
 * resolves under the existing vitest config with no extra wiring.
 */
describe('CONFUSION_TAGS', () => {
  it('is identical in the UI mirror and the zod schema, in the same order', () => {
    expect([...UI_TAGS]).toEqual([...SCHEMA_TAGS])
  })

  it('has no duplicates on either side', () => {
    expect(new Set(UI_TAGS).size).toBe(UI_TAGS.length)
    expect(new Set(SCHEMA_TAGS).size).toBe(SCHEMA_TAGS.length)
  })
})
