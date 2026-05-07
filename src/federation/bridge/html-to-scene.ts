/**
 * HTML wireframe template → SceneGraph converter.
 *
 * Parses robo-architect's wf-* HTML wireframe format and produces
 * an open-pencil SceneGraph with FRAME, TEXT, and RECTANGLE nodes.
 */
import { SceneGraph } from '@open-pencil/core'
import type { SceneNode, NodeType, Fill } from '@open-pencil/core'

const CONTAINER_TAGS = new Set([
  'DIV', 'SPAN', 'MAIN', 'SECTION', 'HEADER', 'NAV', 'FOOTER',
  'FORM', 'FIELDSET', 'ARTICLE', 'ASIDE', 'FIGURE', 'UL', 'OL', 'LI'
])

interface ConvertCtx {
  graph: SceneGraph
  pageId: string
  cursorY: number
}

function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  return { r, g, b, a: 1 }
}

function solidFill(hex: string): Fill {
  return { type: 'SOLID', color: hexToColor(hex), opacity: 1, visible: true } as Fill
}

function parsePx(val: string | null): number {
  if (!val) return 0
  return parseInt(val, 10) || 0
}

/**
 * Convert an HTML wireframe template to a SceneGraph.
 * Returns the graph and the root frame ID.
 */
export function htmlToSceneGraph(html: string): { graph: SceneGraph; frameId: string } {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id

  // Create a root frame for the wireframe
  const rootFrame = graph.createNode('FRAME', pageId, {
    name: 'Wireframe',
    width: 1100,
    height: 800,
    fills: [solidFill('#ffffff')],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'AUTO',
    counterAxisSizing: 'FIXED',
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    itemSpacing: 0,
    clipsContent: true
  })

  // Parse HTML
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const root = doc.querySelector('.wf-root') || doc.body

  const ctx: ConvertCtx = { graph, pageId, cursorY: 0 }

  walkChildren(root, rootFrame.id, ctx)

  // Auto-size root frame height based on content
  const children = graph.getChildren(rootFrame.id)
  if (children.length > 0) {
    const lastChild = children[children.length - 1]
    const totalHeight = lastChild.y + lastChild.height + 16
    graph.updateNode(rootFrame.id, { height: Math.max(800, totalHeight) })
  }

  return { graph, frameId: rootFrame.id }
}

function walkChildren(parent: Element, parentNodeId: string, ctx: ConvertCtx) {
  for (const child of Array.from(parent.children)) {
    const tag = child.tagName
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'META') continue

    convertElement(child, parentNodeId, ctx)
  }
}

function convertElement(el: Element, parentNodeId: string, ctx: ConvertCtx) {
  const cls = el.className?.toString?.() || ''

  // wf-* class-based detection
  if (cls.includes('wf-appbar')) return convertAppbar(el, parentNodeId, ctx)
  if (cls.includes('wf-card')) return convertCard(el, parentNodeId, ctx)
  if (cls.includes('wf-table') && el.tagName === 'TABLE') return convertTable(el, parentNodeId, ctx)
  if (cls.includes('wf-btn')) return convertButton(el, parentNodeId, ctx, cls.includes('wf-btn--primary'))
  if (cls.includes('wf-input')) return convertInput(el, parentNodeId, ctx)
  if (cls.includes('wf-main')) return convertMain(el, parentNodeId, ctx)
  if (cls.includes('wf-grid')) return convertGrid(el, parentNodeId, ctx)

  // Text-only elements
  if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') {
    return convertHeading(el, parentNodeId, ctx)
  }
  if (el.tagName === 'P' || el.tagName === 'LABEL') {
    return convertText(el, parentNodeId, ctx, 13)
  }

  // Generic containers
  if (CONTAINER_TAGS.has(el.tagName)) {
    if (el.children.length > 0) {
      walkChildren(el, parentNodeId, ctx)
    } else {
      const text = el.textContent?.trim()
      if (text) convertText(el, parentNodeId, ctx, 13)
    }
  }
}

function convertAppbar(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const appbar = graph.createNode('FRAME', parentId, {
    name: 'AppBar',
    width: 1100,
    height: 48,
    fills: [solidFill('#fafafa')],
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'SPACE_BETWEEN',
    counterAxisAlign: 'CENTER',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
    counterAxisSizing: 'FIXED',
    primaryAxisSizing: 'FIXED'
  })

  // Extract title
  const titleEl = el.querySelector('.wf-title')
  if (titleEl) {
    graph.createNode('TEXT', appbar.id, {
      name: 'Title',
      text: titleEl.textContent?.trim() || 'Title',
      fontSize: 14,
      fontWeight: 700,
      width: 200,
      height: 20,
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
  }

  // Extract subtitle
  const subtitleEl = el.querySelector('.wf-subtitle')
  if (subtitleEl) {
    graph.createNode('TEXT', appbar.id, {
      name: 'Subtitle',
      text: subtitleEl.textContent?.trim() || '',
      fontSize: 11,
      fontWeight: 400,
      width: 200,
      height: 16,
      fills: [solidFill('#8c8c8c')],
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
  }
}

function convertCard(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const card = graph.createNode('FRAME', parentId, {
    name: 'Card',
    width: 1068,
    height: 200,
    fills: [solidFill('#ffffff')],
    cornerRadius: 6,
    strokes: [{ type: 'SOLID', color: hexToColor('#e8e8e8'), opacity: 1, visible: true, weight: 1, strokeAlign: 'INSIDE' } as any],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'AUTO',
    counterAxisSizing: 'FILL',
    itemSpacing: 0,
    clipsContent: true
  })

  // Card header
  const headerEl = el.querySelector('.wf-card__header')
  if (headerEl) {
    const header = graph.createNode('FRAME', card.id, {
      name: 'Card Header',
      width: 1068,
      height: 36,
      fills: [solidFill('#fafafa')],
      layoutMode: 'HORIZONTAL',
      counterAxisAlign: 'CENTER',
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 8,
      paddingBottom: 8,
      counterAxisSizing: 'FIXED',
      primaryAxisSizing: 'FILL'
    })
    const titleEl = headerEl.querySelector('.wf-card__title')
    if (titleEl) {
      graph.createNode('TEXT', header.id, {
        name: 'Card Title',
        text: titleEl.textContent?.trim() || 'Card',
        fontSize: 13,
        fontWeight: 700,
        width: 200,
        height: 18,
        textAutoResize: 'WIDTH_AND_HEIGHT'
      })
    }
  }

  // Card body
  const bodyEl = el.querySelector('.wf-card__body')
  if (bodyEl) {
    const body = graph.createNode('FRAME', card.id, {
      name: 'Card Body',
      width: 1068,
      height: 160,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'AUTO',
      counterAxisSizing: 'FILL',
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
      itemSpacing: 8
    })
    walkChildren(bodyEl, body.id, ctx)
  }
}

function convertTable(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const table = graph.createNode('FRAME', parentId, {
    name: 'Table',
    width: 1044,
    height: 200,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'AUTO',
    counterAxisSizing: 'FILL',
    itemSpacing: 0
  })

  // Parse headers
  const headers: string[] = []
  el.querySelectorAll('th').forEach((th) => {
    headers.push(th.textContent?.trim() || '')
  })

  if (headers.length > 0) {
    const headerRow = graph.createNode('FRAME', table.id, {
      name: 'Header Row',
      width: 1044,
      height: 32,
      fills: [solidFill('#fafafa')],
      layoutMode: 'HORIZONTAL',
      counterAxisAlign: 'CENTER',
      paddingLeft: 8,
      paddingRight: 8,
      counterAxisSizing: 'FIXED',
      primaryAxisSizing: 'FILL',
      itemSpacing: 4
    })
    const colWidth = Math.floor(1028 / headers.length)
    for (const header of headers) {
      graph.createNode('TEXT', headerRow.id, {
        name: header || 'Column',
        text: header,
        fontSize: 12,
        fontWeight: 600,
        width: colWidth,
        height: 18,
        textAutoResize: 'HEIGHT'
      })
    }
  }

  // Parse rows (first 5)
  const rows = el.querySelectorAll('tbody tr')
  let rowCount = 0
  for (const row of rows) {
    if (rowCount >= 5) break
    const cells = row.querySelectorAll('td')
    if (cells.length === 0) continue

    const dataRow = graph.createNode('FRAME', table.id, {
      name: `Row ${rowCount + 1}`,
      width: 1044,
      height: 32,
      layoutMode: 'HORIZONTAL',
      counterAxisAlign: 'CENTER',
      paddingLeft: 8,
      paddingRight: 8,
      counterAxisSizing: 'FIXED',
      primaryAxisSizing: 'FILL',
      itemSpacing: 4,
      strokes: [{ type: 'SOLID', color: hexToColor('#f0f0f0'), opacity: 1, visible: true, weight: 1, strokeAlign: 'INSIDE' } as any]
    })

    const colWidth = Math.floor(1028 / Math.max(cells.length, 1))
    cells.forEach((cell) => {
      graph.createNode('TEXT', dataRow.id, {
        name: 'Cell',
        text: cell.textContent?.trim() || '',
        fontSize: 12,
        width: colWidth,
        height: 18,
        textAutoResize: 'HEIGHT'
      })
    })
    rowCount++
  }
}

function convertButton(el: Element, parentId: string, ctx: ConvertCtx, isPrimary: boolean) {
  const { graph } = ctx
  const text = el.textContent?.trim() || 'Button'
  graph.createNode('FRAME', parentId, {
    name: text,
    width: Math.max(80, text.length * 8 + 24),
    height: 28,
    fills: [solidFill(isPrimary ? '#1890ff' : '#f5f5f5')],
    cornerRadius: 4,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingLeft: 12,
    paddingRight: 12,
    counterAxisSizing: 'FIXED',
    primaryAxisSizing: 'AUTO'
  })
}

function convertInput(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const placeholder = el.getAttribute('placeholder') || ''
  graph.createNode('FRAME', parentId, {
    name: placeholder || 'Input',
    width: 240,
    height: 32,
    fills: [solidFill('#ffffff')],
    cornerRadius: 4,
    strokes: [{ type: 'SOLID', color: hexToColor('#d9d9d9'), opacity: 1, visible: true, weight: 1, strokeAlign: 'INSIDE' } as any],
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER',
    paddingLeft: 8,
    paddingRight: 8,
    counterAxisSizing: 'FIXED',
    primaryAxisSizing: 'FILL'
  })
}

function convertMain(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const main = graph.createNode('FRAME', parentId, {
    name: 'Main Content',
    width: 1100,
    height: 600,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'AUTO',
    counterAxisSizing: 'FILL',
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    itemSpacing: 10
  })
  walkChildren(el, main.id, ctx)
}

function convertGrid(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const grid = graph.createNode('FRAME', parentId, {
    name: 'Grid',
    width: 1068,
    height: 200,
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    primaryAxisSizing: 'AUTO',
    counterAxisSizing: 'FILL',
    itemSpacing: 10,
    counterAxisSpacing: 10
  })
  walkChildren(el, grid.id, ctx)
}

function convertHeading(el: Element, parentId: string, ctx: ConvertCtx) {
  const { graph } = ctx
  const text = el.textContent?.trim() || ''
  const level = parseInt(el.tagName[1])
  const fontSize = level === 1 ? 24 : level === 2 ? 18 : 14
  graph.createNode('TEXT', parentId, {
    name: text || 'Heading',
    text,
    fontSize,
    fontWeight: 700,
    width: 400,
    height: fontSize + 8,
    textAutoResize: 'WIDTH_AND_HEIGHT'
  })
}

function convertText(el: Element, parentId: string, ctx: ConvertCtx, fontSize: number) {
  const { graph } = ctx
  const text = el.textContent?.trim() || ''
  if (!text) return
  graph.createNode('TEXT', parentId, {
    name: text.slice(0, 30),
    text,
    fontSize,
    width: 400,
    height: fontSize + 6,
    textAutoResize: 'WIDTH_AND_HEIGHT'
  })
}
