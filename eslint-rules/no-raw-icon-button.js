// eslint-rules/no-raw-icon-button.js
// Bans hand-rolled icon-only buttons: a <button> whose only content is a
// material-symbols-outlined glyph (class on the button itself, or on its
// single child span). Use IconButton (or ToolbarButton for icon + label)
// from @/components. Helper-classed icons are not detected — the offender
// inventory is the authoritative audit for those.
const MARKER = 'material-symbols-outlined'

const classNameText = (opening) => {
  const attr = opening.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name.name === 'className'
  )
  if (!attr || !attr.value) {
    return ''
  }
  if (attr.value.type === 'Literal') {
    return String(attr.value.value ?? '')
  }
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression.type === 'TemplateLiteral'
  ) {
    return attr.value.expression.quasis.map((q) => q.value.raw).join(' ')
  }

  return ''
}

const isBlankText = (child) =>
  child.type === 'JSXText' && child.value.trim() === ''

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow hand-rolled icon-only buttons; use IconButton/ToolbarButton from @/components',
    },
    messages: {
      rawIconButton:
        'Raw icon-only <button> — use IconButton from @/components/IconButton (or ToolbarButton for icon + label). There is no @/components barrel; import the specific module.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXElement(node) {
        const opening = node.openingElement
        if (
          opening.name.type !== 'JSXIdentifier' ||
          opening.name.name !== 'button'
        ) {
          return
        }
        if (classNameText(opening).includes(MARKER)) {
          context.report({ node, messageId: 'rawIconButton' })

          return
        }

        const meaningful = node.children.filter((c) => !isBlankText(c))
        if (
          meaningful.length === 1 &&
          meaningful[0].type === 'JSXElement' &&
          classNameText(meaningful[0].openingElement).includes(MARKER)
        ) {
          context.report({ node, messageId: 'rawIconButton' })
        }
      },
    }
  },
}
