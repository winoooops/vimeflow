import { describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SettingsContext } from '../settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '../settings/store/settingsDefaults'
import type { AppSettings } from '../../bindings/AppSettings'
import { useKeybindings } from './useKeybindings'

const renderKeybindings = (
  customKeybindings: Record<string, string> = {}
): {
  result: { current: ReturnType<typeof useKeybindings> }
  update: ReturnType<typeof vi.fn>
} => {
  const update = vi.fn()
  const settings: AppSettings = { ...DEFAULT_SETTINGS, customKeybindings }

  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(
      SettingsContext.Provider,
      { value: { settings, saveError: null, update } },
      children
    )
  const { result } = renderHook(() => useKeybindings(), { wrapper })

  return { result, update }
}

describe('useKeybindings', () => {
  test('bindingFor reflects a stored override', () => {
    const { result } = renderKeybindings({ 'dock-toggle': 'Mod+KeyK' })
    expect(result.current.bindingFor('dock-toggle')).toEqual({
      code: 'KeyK',
      mods: new Set(['Mod']),
    })
  })

  test('setUserBinding rejects a super-less override without persisting', () => {
    const { result, update } = renderKeybindings()
    expect(
      result.current.setUserBinding('dock-toggle', {
        code: 'Digit0',
        mods: new Set(),
      })
    ).toEqual({ ok: false, reason: 'invalid-super' })
    expect(update).not.toHaveBeenCalled()
  })

  test("setUserBinding rejects shadowing the palette defaults as 'conflict'", () => {
    const { result, update } = renderKeybindings()
    expect(
      result.current.setUserBinding('dock-toggle', {
        code: 'Semicolon',
        mods: new Set(['Mod']),
      })
    ).toEqual({ ok: false, reason: 'conflict' })
    expect(update).not.toHaveBeenCalled()
  })

  test('setUserBinding allows the palette and leader to intentionally overlap', () => {
    const { result, update } = renderKeybindings({
      palette: 'Mod+KeyP',
    })

    expect(
      result.current.setUserBinding('palette-leader', {
        code: 'KeyP',
        mods: new Set(['Mod']),
      })
    ).toEqual({ ok: true })

    expect(update).toHaveBeenCalledWith({
      customKeybindings: {
        palette: 'Mod+KeyP',
        'palette-leader': 'Mod+KeyP',
      },
    })
  })

  test("setUserBinding rejects shadowing the settings shortcut as 'reserved'", () => {
    const { result, update } = renderKeybindings()
    expect(
      result.current.setUserBinding('dock-toggle', {
        code: 'Comma',
        mods: new Set(['Mod']),
      })
    ).toEqual({ ok: false, reason: 'reserved' })
    expect(update).not.toHaveBeenCalled()
  })

  test("setUserBinding rejects macOS literal Ctrl+, as 'reserved'", () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      platform: 'MacIntel',
    })
    const { result, update } = renderKeybindings()

    try {
      expect(
        result.current.setUserBinding('dock-toggle', {
          code: 'Comma',
          mods: new Set(['Ctrl']),
        })
      ).toEqual({ ok: false, reason: 'reserved' })
      expect(update).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test("setUserBinding rejects shadowing the browser address shortcut as 'reserved'", () => {
    const { result, update } = renderKeybindings()
    expect(
      result.current.setUserBinding('dock-toggle', {
        code: 'KeyL',
        mods: new Set(['Mod']),
      })
    ).toEqual({ ok: false, reason: 'reserved' })
    expect(update).not.toHaveBeenCalled()
  })

  test("setUserBinding rejects display-only commands as 'reserved'", () => {
    const { result, update } = renderKeybindings()
    expect(
      result.current.setUserBinding('settings', {
        code: 'KeyP',
        mods: new Set(['Mod']),
      })
    ).toEqual({ ok: false, reason: 'reserved' })
    expect(update).not.toHaveBeenCalled()
  })

  test("setUserBinding rejects a rebindable-vs-rebindable collision as 'conflict'", () => {
    const { result, update } = renderKeybindings()

    const outcome = result.current.setUserBinding('dock-toggle', {
      code: 'Digit1',
      mods: new Set(['Mod']),
    })
    expect(outcome).toEqual({ ok: false, reason: 'conflict' })
    expect(update).not.toHaveBeenCalled()
  })

  test('setUserBinding persists a valid override', () => {
    const { result, update } = renderKeybindings()
    expect(
      result.current.setUserBinding('dock-toggle', {
        code: 'KeyK',
        mods: new Set(['Mod']),
      })
    ).toEqual({ ok: true })

    expect(update).toHaveBeenCalledWith({
      customKeybindings: { 'dock-toggle': 'Mod+KeyK' },
    })
  })

  test('resetBinding removes the override', () => {
    const { result, update } = renderKeybindings({ 'dock-toggle': 'Mod+KeyK' })
    result.current.resetBinding('dock-toggle')
    expect(update).toHaveBeenCalledWith({ customKeybindings: {} })
  })
})
