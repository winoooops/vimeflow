import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KeyCap } from './KeyCap'

test('renders its child glyph', () => {
  render(<KeyCap>⌘</KeyCap>)
  expect(screen.getByText('⌘')).toBeInTheDocument()
})

test('small is the default size', () => {
  render(<KeyCap>N</KeyCap>)
  expect(screen.getByText('N').className).toContain('h-[16px]')
})

test('medium size opts into the taller keycap', () => {
  render(<KeyCap size="md">esc</KeyCap>)
  expect(screen.getByText('esc').className).toContain('h-[18px]')
})

test('active brightens toward the accent', () => {
  render(<KeyCap active>0</KeyCap>)
  expect(screen.getByText('0').className).toContain('text-primary')
})

test('idle keeps the muted tone', () => {
  render(<KeyCap>0</KeyCap>)
  expect(screen.getByText('0').className).toContain('text-on-surface-muted')
})
