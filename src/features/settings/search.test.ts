import { describe, expect, test } from 'vitest'
import { SETTINGS_SECTIONS, SETTINGS_TARGETS } from './sections'
import { searchSettings, type SettingsSearchModel } from './search'

const search = (query: string): SettingsSearchModel =>
  searchSettings({
    sections: SETTINGS_SECTIONS,
    targets: SETTINGS_TARGETS,
    query,
  })

const targetLabels = (query: string): string[] =>
  search(query).targets.map((target) => target.label)

describe('searchSettings', () => {
  test('returns section results when the query is empty', () => {
    const model = search('')

    expect(model.sections.map((section) => section.label)).toEqual(
      SETTINGS_SECTIONS.map((section) => section.label)
    )
    expect(model.targets).toEqual([])
    expect(model.results.map((result) => result.key)).toContain(
      'section:appearance'
    )
  })

  test('surfaces individual font setting rows before category results', () => {
    const model = search('font')

    expect(model.sections.map((section) => section.label)).toEqual([
      'Appearance',
    ])

    expect(model.targets.slice(0, 2).map((target) => target.label)).toEqual([
      'UI Font',
      'Mono Font',
    ])

    expect(model.results[0]).toMatchObject({
      kind: 'target',
      key: 'target:appearance-ui-font',
    })
  })

  test('matches fuzzy abbreviations against setting labels', () => {
    expect(targetLabels('ui fnt')).toContain('UI Font')
    expect(targetLabels('ui fnt')).not.toContain('Mono Font')
  })

  test('matches category and subsection context for settings', () => {
    expect(targetLabels('appearance fonts')).toEqual(['UI Font', 'Mono Font'])
  })
})
