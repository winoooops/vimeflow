const icons = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵' }

export const publishableFindings = (review) =>
  Array.isArray(review?.findings)
    ? review.findings.filter(
        (finding) =>
          finding?.guard?.passes === true &&
          Number(finding.confidence_score) > 0.8
      )
    : []

export const formatReviewComment = (raw, heading) => {
  try {
    const review = JSON.parse(raw)
    const findings = publishableFindings(review)
    const lines = [`## ${heading}`, '']

    if (findings.length > 0) {
      for (const finding of findings) {
        const sev = icons[finding.severity] || '⚪'
        lines.push(`### ${sev} [${finding.severity}] ${finding.title}`)
        lines.push('')
        lines.push(
          `📍 \`${finding.code_location.absolute_file_path}\` L${finding.code_location.line_range.start}-${finding.code_location.line_range.end}`
        )
        lines.push(
          `🎯 Confidence: ${(finding.confidence_score * 100).toFixed(0)}%`
        )
        lines.push('')
        lines.push(finding.body)
        if (finding.idea) {
          lines.push('')
          lines.push('<details><summary>💡 IDEA</summary>')
          lines.push('')
          lines.push(`- **I — Intent:** ${finding.idea.intent}`)
          lines.push(`- **D — Danger:** ${finding.idea.danger}`)
          lines.push(`- **E — Explain:** ${finding.idea.explain}`)
          lines.push(`- **A — Alternatives:** ${finding.idea.alternatives}`)
          lines.push('')
          lines.push('</details>')
        }
        lines.push('')
        lines.push('---')
        lines.push('')
      }
    } else {
      lines.push('✅ No issues found after review guard.')
      lines.push('')
    }

    const hasIssues = findings.length > 0
    const verdict = hasIssues ? '⚠️' : '✅'
    const correctness = hasIssues ? 'patch has issues' : 'patch is correct'
    const explanation = hasIssues
      ? review.overall_explanation
      : 'No findings passed the confidence, scope, and Ponytail guard.'
    lines.push('')
    lines.push(
      `**Overall: ${verdict} ${correctness}** (confidence: ${(review.overall_confidence_score * 100).toFixed(0)}%)`
    )
    lines.push('')
    lines.push(`> ${explanation}`)

    return lines.join('\n')
  } catch {
    return `## ${heading}\n\n${raw}`
  }
}
