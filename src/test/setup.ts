import '@testing-library/jest-dom/vitest'

// Mock scrollIntoView for all tests (not available in jsdom)
Element.prototype.scrollIntoView = (): void => {
  // No-op mock implementation
}
