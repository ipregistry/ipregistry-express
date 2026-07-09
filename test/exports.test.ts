import { describe, expect, it } from 'vitest'

import defaultExport, { ipregistry } from '../src/index.js'

describe('package exports', () => {
    it('exposes the middleware factory as the default export', () => {
        expect(defaultExport).toBe(ipregistry)
        expect(typeof defaultExport).toBe('function')
    })
})
