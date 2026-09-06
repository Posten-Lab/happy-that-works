import { describe, expect, it } from 'vitest'
import { MessageMetaSchema } from './types'

describe('MessageMetaSchema', () => {
  it('preserves provider-advertised reasoning effort values', () => {
    const parsed = MessageMetaSchema.parse({
      model: 'gpt-5.6-sol',
      effort: 'ultra',
    })

    expect(parsed).toEqual({
      model: 'gpt-5.6-sol',
      effort: 'ultra',
    })
  })
})
