import type {
  SettingsSection,
  SettingsSectionId,
  SettingsTarget,
} from './types'

interface ParsedSearchQuery {
  normalized: string
  compact: string
  tokens: string[]
}

interface SettingsSearchInput {
  sections: SettingsSection[]
  targets: SettingsTarget[]
  query: string
}

export type SettingsSearchResult =
  | {
      key: string
      kind: 'section'
      section: SettingsSection
      score: number
    }
  | {
      key: string
      kind: 'target'
      section: SettingsSection
      target: SettingsTarget
      score: number
    }

export interface SettingsSearchModel {
  sections: SettingsSection[]
  targets: SettingsTarget[]
  results: SettingsSearchResult[]
}

export const settingsSectionResultKey = (id: SettingsSectionId): string =>
  `section:${id}`

export const settingsTargetResultKey = (target: SettingsTarget): string =>
  `target:${target.id}`

const normalizeSearchText = (value: string | undefined): string =>
  value
    ?.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() ?? ''

const compactText = (value: string): string => value.replace(/\s+/g, '')

const parseSearchQuery = (query: string): ParsedSearchQuery => {
  const normalized = normalizeSearchText(query)

  return {
    normalized,
    compact: compactText(normalized),
    tokens: normalized.split(/\s+/).filter(Boolean),
  }
}

const isSubsequence = (needle: string, haystack: string): boolean => {
  let needleIndex = 0

  for (const char of haystack) {
    if (char === needle[needleIndex]) {
      needleIndex += 1
    }

    if (needleIndex === needle.length) {
      return true
    }
  }

  return false
}

const tokenScore = (text: string, token: string): number | null => {
  const words = text.split(/\s+/).filter(Boolean)

  if (words.includes(token)) {
    return 36
  }

  if (words.some((word) => word.startsWith(token))) {
    return 30
  }

  if (text.includes(token)) {
    return 24
  }

  if (
    token.length > 2 &&
    words.some(
      (word) => word.length >= token.length && isSubsequence(token, word)
    )
  ) {
    return 12
  }

  return null
}

const scoreSearchText = (
  text: string,
  query: ParsedSearchQuery
): number | null => {
  if (!text || query.tokens.length === 0) {
    return null
  }

  const tokenScores = query.tokens.map((token) => tokenScore(text, token))
  if (tokenScores.some((score) => score === null)) {
    return null
  }

  const numericTokenScores = tokenScores.filter(
    (score): score is number => score !== null
  )

  const phraseScore =
    text === query.normalized
      ? 72
      : text.includes(query.normalized)
        ? 54
        : compactText(text).includes(query.compact)
          ? 42
          : 0

  return (
    phraseScore + numericTokenScores.reduce((total, score) => total + score, 0)
  )
}

const scoreSection = (
  section: SettingsSection,
  query: ParsedSearchQuery
): number | null => {
  const score = scoreSearchText(normalizeSearchText(section.label), query)

  return score === null ? null : score + 20
}

const scoreTarget = (
  target: SettingsTarget,
  section: SettingsSection,
  query: ParsedSearchQuery
): number | null => {
  const fields = [
    { value: target.label, weight: 90 },
    { value: target.subsection, weight: 58 },
    { value: section.label, weight: 46 },
    { value: target.hint, weight: 32 },
  ]

  const combined = normalizeSearchText(
    fields
      .map((field) => field.value)
      .filter(Boolean)
      .join(' ')
  )
  const combinedScore = scoreSearchText(combined, query)

  if (combinedScore === null) {
    return null
  }

  const bestFieldScore = Math.max(
    0,
    ...fields.map((field) => {
      const score = scoreSearchText(normalizeSearchText(field.value), query)

      return score === null ? 0 : score + field.weight
    })
  )

  return combinedScore + bestFieldScore + 30
}

const sectionOrderOf = (
  sectionOrder: Map<SettingsSectionId, number>,
  section: SettingsSection
): number => sectionOrder.get(section.id) ?? Number.MAX_SAFE_INTEGER

const targetOrderOf = (
  targetOrder: Map<string, number>,
  target: SettingsTarget
): number => targetOrder.get(target.id) ?? Number.MAX_SAFE_INTEGER

export const searchSettings = ({
  sections,
  targets,
  query,
}: SettingsSearchInput): SettingsSearchModel => {
  const parsedQuery = parseSearchQuery(query)

  if (parsedQuery.normalized === '') {
    return {
      sections,
      targets: [],
      results: sections.map((section) => ({
        key: settingsSectionResultKey(section.id),
        kind: 'section',
        section,
        score: 0,
      })),
    }
  }

  const sectionById = new Map(sections.map((section) => [section.id, section]))

  const sectionOrder = new Map(
    sections.map((section, index) => [section.id, index])
  )

  const targetOrder = new Map(
    targets.map((target, index) => [target.id, index])
  )

  const sectionResults = sections.flatMap((section): SettingsSearchResult[] => {
    const score = scoreSection(section, parsedQuery)

    return score === null
      ? []
      : [
          {
            key: settingsSectionResultKey(section.id),
            kind: 'section',
            section,
            score,
          },
        ]
  })

  const targetResults = targets.flatMap((target): SettingsSearchResult[] => {
    const section = sectionById.get(target.section)
    if (section === undefined) {
      return []
    }

    const score = scoreTarget(target, section, parsedQuery)

    return score === null
      ? []
      : [
          {
            key: settingsTargetResultKey(target),
            kind: 'target',
            section,
            target,
            score,
          },
        ]
  })

  const scoreBySection = new Map<SettingsSectionId, number>()

  sectionResults.forEach((result) => {
    scoreBySection.set(result.section.id, result.score)
  })

  targetResults.forEach((result) => {
    const currentScore = scoreBySection.get(result.section.id) ?? 0
    scoreBySection.set(result.section.id, Math.max(currentScore, result.score))
  })

  const filteredSections = sections
    .filter((section) => scoreBySection.has(section.id))
    .sort((a, b) => {
      const scoreDelta =
        (scoreBySection.get(b.id) ?? 0) - (scoreBySection.get(a.id) ?? 0)

      return (
        scoreDelta ||
        sectionOrderOf(sectionOrder, a) - sectionOrderOf(sectionOrder, b)
      )
    })

  const filteredTargets = targetResults
    .sort((a, b) => {
      if (a.kind !== 'target' || b.kind !== 'target') {
        return 0
      }

      const scoreDelta = b.score - a.score
      if (scoreDelta !== 0) {
        return scoreDelta
      }

      const sectionDelta =
        sectionOrderOf(sectionOrder, a.section) -
        sectionOrderOf(sectionOrder, b.section)
      if (sectionDelta !== 0) {
        return sectionDelta
      }

      return (
        targetOrderOf(targetOrder, a.target) -
        targetOrderOf(targetOrder, b.target)
      )
    })
    .flatMap((result) => (result.kind === 'target' ? [result.target] : []))

  const sectionResultById = new Map(
    sectionResults.map((result) => [result.section.id, result])
  )

  const targetResultById = new Map(
    targetResults.flatMap((result) =>
      result.kind === 'target' ? [[result.target.id, result] as const] : []
    )
  )

  const results = filteredSections.flatMap(
    (section): SettingsSearchResult[] => {
      const sectionResult = sectionResultById.get(section.id)

      const sectionTargets = filteredTargets
        .filter((target) => target.section === section.id)
        .flatMap((target) => {
          const result = targetResultById.get(target.id)

          return result === undefined ? [] : [result]
        })

      return sectionResult === undefined
        ? sectionTargets
        : [sectionResult, ...sectionTargets]
    }
  )

  return {
    sections: filteredSections,
    targets: filteredTargets,
    results,
  }
}
