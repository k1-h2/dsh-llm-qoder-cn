/**
 * What one CLI usage frame becomes on the harness seam.
 *
 * The two backends disagree about what `input_tokens` counts, and the harness's
 * buckets are disjoint, so getting this wrong shows up as an inflated total and
 * a wrong context percentage rather than as an error. The frame below is a real
 * second-turn frame from this backend (9 805 of 10 268 prompt tokens served from
 * cache), and the harness's own disclosure rule is why a zero cache bucket must
 * still be reported rather than omitted.
 *
 * The second half pins which frame may supply the occupancy sample at all: only
 * a finished request may, because the turn-level `result` frame sums every
 * request the inner turn made and once pegged a 1M window at 100%.
 */
import { describe, expect, it } from 'vitest'
import { carriesTokens, meteredUsage, requestUsageSample } from '../src/session.ts'

/** A turn that produced no reasoning text. */
const noReasoning = (): { reasoningTokens?: number } => ({})

describe('metered usage', () => {
  it('takes the cached halves out of the prompt total', () => {
    // The CLI reports the whole prompt in input_tokens and measures its context
    // ratio against that same number, so the harness's uncached bucket is the
    // remainder. Keeping input_tokens as-is would count the cached prefix twice.
    expect(meteredUsage({
      input_tokens: 10_268,
      output_tokens: 233,
      cache_read_input_tokens: 9_805,
      cache_creation_input_tokens: 0,
    }, noReasoning)).toEqual({
      inputTokens: 463,
      outputTokens: 233,
      cacheReadTokens: 9_805,
      cacheWriteTokens: 0,
      totalTokens: 10_501,
    })
  })

  it('reports both cache buckets even when the provider served none', () => {
    // An omitted cache bucket makes the harness withhold the turn's usage
    // disclosure, so a zero has to be stated rather than left out.
    expect(meteredUsage({ input_tokens: 321, output_tokens: 43 }, noReasoning)).toEqual({
      inputTokens: 321,
      outputTokens: 43,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 364,
    })
  })

  it('never reports more uncached input than the prompt held', () => {
    // A frame claiming more cached tokens than tokens is inconsistent; the
    // reading degrades to "nothing uncached" instead of a negative bucket.
    expect(meteredUsage({ input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 400 }, noReasoning))
      .toMatchObject({ inputTokens: 0, cacheReadTokens: 400 })
  })

  it('carries the clamped reasoning estimate alongside the metered total', () => {
    const usage = meteredUsage({ input_tokens: 900, output_tokens: 120 }, output => ({ reasoningTokens: Math.min(output, 300) }))
    expect(usage).toMatchObject({ outputTokens: 120, reasoningTokens: 120 })
  })

  it('refuses a frame that carries no metering at all', () => {
    // The CLI zeroes every token counter unless it was asked to expose them,
    // and those frames are exactly what the usage fallbacks exist for.
    const zeroed = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    expect(meteredUsage(zeroed, noReasoning)).toBeUndefined()
    expect(meteredUsage(undefined, noReasoning)).toBeUndefined()
    expect(meteredUsage({ context_usage_ratio: 0.49 }, noReasoning)).toBeUndefined()
  })
})

describe('usage sample selection', () => {
  it('takes metering from the frame a finished request emits', () => {
    // A four-request probe: message_delta reported 837 input for its own
    // request, which is the prompt this session is holding.
    const usage = { input_tokens: 837, output_tokens: 26, cache_read_input_tokens: 576 }
    expect(requestUsageSample({ type: 'stream_event', event: { type: 'message_delta', usage } })).toBe(usage)
  })

  it('ignores the zero filler a request-start frame carries', () => {
    expect(requestUsageSample({
      type: 'stream_event',
      event: { type: 'message_start', message: { usage: { input_tokens: 0, output_tokens: 0 } } },
    })).toBeUndefined()
  })

  it('ignores an assembled assistant message, which reports no request metering', () => {
    // Its own usage record is the zero filler; even a non-zero one would not be
    // sampled, because only a stream frame describes the live request.
    expect(requestUsageSample({
      type: 'assistant',
      usage: { input_tokens: 12, output_tokens: 3 },
    })).toBeUndefined()
  })

  it('ignores the whole-run total the result frame carries', () => {
    // The regression: the same probe's result frame summed all four requests
    // (2 921 input) and the next reading showed 9.8M against a 1M window.
    expect(requestUsageSample({
      type: 'result',
      usage: { input_tokens: 2_921, output_tokens: 195, cache_read_input_tokens: 1_728 },
    })).toBeUndefined()
  })

  it('recognizes real metering by any positive counter', () => {
    // A cached second turn can report a small uncached remainder; the cache
    // bucket is what makes it real, not the input total.
    expect(carriesTokens({ input_tokens: 463, output_tokens: 233 })).toBe(true)
    expect(carriesTokens({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 9_805 })).toBe(true)
    expect(carriesTokens({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(false)
    expect(carriesTokens({ context_usage_ratio: 0.49 })).toBe(false)
  })
})
