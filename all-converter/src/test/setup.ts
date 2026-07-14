// Shared Vitest setup. Browser-specific tests will opt into jsdom when introduced.
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => { cleanup() })
