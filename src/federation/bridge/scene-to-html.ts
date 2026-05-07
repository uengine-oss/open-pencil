/**
 * SceneGraph → HTML wireframe template converter.
 *
 * Converts an open-pencil SceneGraph back to robo-architect's
 * wf-* CSS class HTML wireframe format for backward compatibility.
 */
import type { SceneGraph, SceneNode } from '@open-pencil/core'

function colorToHex(color: { r: number; g: number; b: number }): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0')
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0')
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function getNodeFillColor(node: SceneNode): string | null {
  if (!node.fills || node.fills.length === 0) return null
  const fill = node.fills[0]
  if (fill.type === 'SOLID' && fill.visible !== false) {
    return colorToHex(fill.color)
  }
  return null
}

function isAppBar(node: SceneNode): boolean {
  return node.name.toLowerCase().includes('appbar') ||
    node.name.toLowerCase().includes('app bar') ||
    node.name.toLowerCase().includes('navbar') ||
    node.name.toLowerCase().includes('header')
}

function isCard(node: SceneNode): boolean {
  return node.name.toLowerCase().includes('card')
}

function isTable(node: SceneNode, graph: SceneGraph): boolean {
  if (node.name.toLowerCase().includes('table')) return true
  // Check if children look like rows (multiple horizontal frames)
  const children = graph.getChildren(node.id)
  if (children.length >= 2) {
    const allHorizontal = children.every(c => c.layoutMode === 'HORIZONTAL')
    if (allHorizontal && children.length >= 3) return true
  }
  return false
}

function isButton(node: SceneNode): boolean {
  return node.name.toLowerCase().includes('button') ||
    node.name.toLowerCase().includes('btn')
}

function isInput(node: SceneNode): boolean {
  return node.name.toLowerCase().includes('input') ||
    node.name.toLowerCase().includes('field') ||
    node.name.toLowerCase().includes('search')
}

/**
 * Convert a SceneGraph to HTML wireframe template.
 * Processes the first FRAME child of the first page.
 */
export function sceneGraphToHtml(graph: SceneGraph, frameId?: string): string {
  const pages = graph.getPages()
  if (pages.length === 0) return '<div class="wf-root wf-theme-ant"></div>'

  const page = pages[0]
  const children = graph.getChildren(page.id)

  let targetFrame: SceneNode | null = null
  if (frameId) {
    targetFrame = graph.getNode(frameId) ?? null
  }
  if (!targetFrame && children.length > 0) {
    targetFrame = children[0]
  }
  if (!targetFrame) return '<div class="wf-root wf-theme-ant"></div>'

  const parts: string[] = []
  parts.push('<div class="wf-root wf-theme-ant">')
  renderNode(graph, targetFrame, parts, 1)
  parts.push('</div>')

  return parts.join('\n')
}

function indent(level: number): string {
  return '  '.repeat(level)
}

function renderNode(graph: SceneGraph, node: SceneNode, parts: string[], depth: number) {
  if (node.type === 'TEXT') {
    renderTextNode(node, parts, depth)
    return
  }

  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') {
    renderShapeNode(node, parts, depth)
    return
  }

  if (node.type !== 'FRAME' && node.type !== 'GROUP' && node.type !== 'SECTION' &&
      node.type !== 'COMPONENT' && node.type !== 'INSTANCE') {
    return
  }

  const children = graph.getChildren(node.id)

  // Determine semantic type
  if (isAppBar(node)) {
    renderAppBar(graph, node, children, parts, depth)
  } else if (isCard(node)) {
    renderCard(graph, node, children, parts, depth)
  } else if (isTable(node, graph)) {
    renderTable(graph, node, children, parts, depth)
  } else if (isButton(node)) {
    renderButton(node, parts, depth)
  } else if (isInput(node)) {
    renderInput(node, parts, depth)
  } else if (node.layoutMode === 'VERTICAL' && depth === 1) {
    // Main content area
    parts.push(`${indent(depth)}<div class="wf-main">`)
    for (const child of children) {
      renderNode(graph, child, parts, depth + 1)
    }
    parts.push(`${indent(depth)}</div>`)
  } else if (node.layoutMode === 'HORIZONTAL' && node.layoutWrap === 'WRAP') {
    // Grid
    parts.push(`${indent(depth)}<div class="wf-grid">`)
    for (const child of children) {
      renderNode(graph, child, parts, depth + 1)
    }
    parts.push(`${indent(depth)}</div>`)
  } else {
    // Generic container
    const style = buildFrameStyle(node)
    parts.push(`${indent(depth)}<div${style ? ` style="${style}"` : ''}>`)
    for (const child of children) {
      renderNode(graph, child, parts, depth + 1)
    }
    parts.push(`${indent(depth)}</div>`)
  }
}

function renderTextNode(node: SceneNode, parts: string[], depth: number) {
  const text = escapeHtml(node.text || '')
  if (!text) return

  if (node.fontWeight >= 700 && node.fontSize >= 20) {
    parts.push(`${indent(depth)}<h1>${text}</h1>`)
  } else if (node.fontWeight >= 700 && node.fontSize >= 16) {
    parts.push(`${indent(depth)}<h2>${text}</h2>`)
  } else if (node.fontWeight >= 700 && node.fontSize >= 13) {
    parts.push(`${indent(depth)}<h3>${text}</h3>`)
  } else {
    parts.push(`${indent(depth)}<p>${text}</p>`)
  }
}

function renderShapeNode(node: SceneNode, parts: string[], depth: number) {
  const fill = getNodeFillColor(node)
  const style = [
    `width:${Math.round(node.width)}px`,
    `height:${Math.round(node.height)}px`,
    fill ? `background:${fill}` : '',
    node.cornerRadius ? `border-radius:${node.cornerRadius}px` : ''
  ].filter(Boolean).join(';')

  parts.push(`${indent(depth)}<div style="${style}"></div>`)
}

function renderAppBar(graph: SceneGraph, node: SceneNode, children: SceneNode[], parts: string[], depth: number) {
  parts.push(`${indent(depth)}<div class="wf-appbar">`)

  // Left section
  parts.push(`${indent(depth + 1)}<div class="wf-appbar__left">`)
  for (const child of children) {
    if (child.type === 'TEXT') {
      if (child.fontWeight >= 700) {
        parts.push(`${indent(depth + 2)}<span class="wf-title">${escapeHtml(child.text)}</span>`)
      } else {
        parts.push(`${indent(depth + 2)}<span class="wf-subtitle">${escapeHtml(child.text)}</span>`)
      }
    }
  }
  parts.push(`${indent(depth + 1)}</div>`)

  // Right section (buttons/actions)
  const buttons = children.filter(c => isButton(c))
  if (buttons.length > 0) {
    parts.push(`${indent(depth + 1)}<div class="wf-appbar__right">`)
    for (const btn of buttons) {
      renderButton(btn, parts, depth + 2)
    }
    parts.push(`${indent(depth + 1)}</div>`)
  }

  parts.push(`${indent(depth)}</div>`)
}

function renderCard(graph: SceneGraph, node: SceneNode, children: SceneNode[], parts: string[], depth: number) {
  parts.push(`${indent(depth)}<div class="wf-card">`)

  // Detect header/body pattern
  let hasHeader = false
  for (const child of children) {
    const name = child.name.toLowerCase()
    if (name.includes('header')) {
      hasHeader = true
      const headerChildren = graph.getChildren(child.id)
      const title = headerChildren.find(c => c.type === 'TEXT')
      parts.push(`${indent(depth + 1)}<div class="wf-card__header">`)
      parts.push(`${indent(depth + 2)}<span class="wf-card__title">${escapeHtml(title?.text || node.name)}</span>`)
      parts.push(`${indent(depth + 1)}</div>`)
    } else if (name.includes('body') || (!hasHeader && child === children[children.length > 1 ? 1 : 0])) {
      parts.push(`${indent(depth + 1)}<div class="wf-card__body">`)
      const bodyChildren = graph.getChildren(child.id)
      for (const bodyChild of bodyChildren) {
        renderNode(graph, bodyChild, parts, depth + 2)
      }
      parts.push(`${indent(depth + 1)}</div>`)
    } else {
      renderNode(graph, child, parts, depth + 1)
    }
  }

  if (!hasHeader && children.length <= 1) {
    parts.push(`${indent(depth + 1)}<div class="wf-card__header">`)
    parts.push(`${indent(depth + 2)}<span class="wf-card__title">${escapeHtml(node.name)}</span>`)
    parts.push(`${indent(depth + 1)}</div>`)
    parts.push(`${indent(depth + 1)}<div class="wf-card__body">`)
    for (const child of children) {
      renderNode(graph, child, parts, depth + 2)
    }
    parts.push(`${indent(depth + 1)}</div>`)
  }

  parts.push(`${indent(depth)}</div>`)
}

function renderTable(graph: SceneGraph, node: SceneNode, children: SceneNode[], parts: string[], depth: number) {
  parts.push(`${indent(depth)}<table class="wf-table">`)

  if (children.length > 0) {
    // First row = header
    const headerRow = children[0]
    const headerCells = graph.getChildren(headerRow.id)
    parts.push(`${indent(depth + 1)}<thead><tr>`)
    for (const cell of headerCells) {
      const text = cell.type === 'TEXT' ? cell.text : cell.name
      parts.push(`${indent(depth + 2)}<th>${escapeHtml(text)}</th>`)
    }
    parts.push(`${indent(depth + 1)}</tr></thead>`)

    // Remaining rows = data
    if (children.length > 1) {
      parts.push(`${indent(depth + 1)}<tbody>`)
      for (let i = 1; i < children.length; i++) {
        const row = children[i]
        const cells = graph.getChildren(row.id)
        parts.push(`${indent(depth + 2)}<tr>`)
        for (const cell of cells) {
          const text = cell.type === 'TEXT' ? cell.text : cell.name
          parts.push(`${indent(depth + 3)}<td>${escapeHtml(text)}</td>`)
        }
        parts.push(`${indent(depth + 2)}</tr>`)
      }
      parts.push(`${indent(depth + 1)}</tbody>`)
    }
  }

  parts.push(`${indent(depth)}</table>`)
}

function renderButton(node: SceneNode, parts: string[], depth: number) {
  const fill = getNodeFillColor(node)
  const isPrimary = fill && fill !== '#f5f5f5' && fill !== '#ffffff'
  const cls = isPrimary ? 'wf-btn wf-btn--primary' : 'wf-btn'
  const label = node.name || 'Button'
  parts.push(`${indent(depth)}<button class="${cls}">${escapeHtml(label)}</button>`)
}

function renderInput(node: SceneNode, parts: string[], depth: number) {
  const placeholder = node.name || ''
  parts.push(`${indent(depth)}<input class="wf-input" placeholder="${escapeHtml(placeholder)}" />`)
}

function buildFrameStyle(node: SceneNode): string {
  const styles: string[] = []
  if (node.layoutMode === 'HORIZONTAL') {
    styles.push('display:flex', 'flex-direction:row')
    if (node.itemSpacing) styles.push(`gap:${node.itemSpacing}px`)
  } else if (node.layoutMode === 'VERTICAL') {
    styles.push('display:flex', 'flex-direction:column')
    if (node.itemSpacing) styles.push(`gap:${node.itemSpacing}px`)
  }
  if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
    styles.push(`padding:${node.paddingTop}px ${node.paddingRight}px ${node.paddingBottom}px ${node.paddingLeft}px`)
  }
  return styles.join(';')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
