import { describe, it, expect } from 'vitest'
import { buildCorsHeaders, ALLOWED_HEADERS } from './cors'

// Every header name supabase-js v2's functions.invoke() actually sends by
// default (verified against node_modules/@supabase/supabase-js and
// node_modules/@supabase/functions-js — see cors.ts for citations). If a
// browser preflight is missing any one of these, the real request never
// goes out. This test is the regression guard for exactly the bug that
// shipped: ai-tutor and analyze-lecture allow-listed only Content-Type and
// Authorization, silently dropping X-Client-Info and Apikey.
const REQUIRED_HEADERS = ['content-type', 'authorization', 'x-client-info', 'apikey']

describe('buildCorsHeaders', () => {
  it('allows every header supabase-js functions.invoke() sends by default', () => {
    const headers = buildCorsHeaders('http://localhost:5173')
    const allowed = headers['Access-Control-Allow-Headers'].toLowerCase()
    for (const name of REQUIRED_HEADERS) {
      expect(allowed).toContain(name)
    }
  })

  it('binds Access-Control-Allow-Origin to the given appOrigin, never a wildcard', () => {
    const headers = buildCorsHeaders('https://example.com')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com')
    expect(headers['Access-Control-Allow-Origin']).not.toBe('*')
  })

  it('allows POST and OPTIONS', () => {
    const headers = buildCorsHeaders('http://localhost:5173')
    expect(headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(headers['Access-Control-Allow-Methods']).toContain('OPTIONS')
  })

  it('sets a Max-Age so the browser can cache the preflight', () => {
    const headers = buildCorsHeaders('http://localhost:5173')
    expect(Number(headers['Access-Control-Max-Age'])).toBeGreaterThan(0)
  })

  it('exports the raw allow-list string used by both edge functions', () => {
    expect(ALLOWED_HEADERS.toLowerCase()).toBe('content-type, authorization, x-client-info, apikey')
  })
})
