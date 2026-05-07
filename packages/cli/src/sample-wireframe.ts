/**
 * Sample script: Build a wireframe from common_only.fig components
 * and export it as a .fig file.
 *
 * Usage:  bun run packages/cli/src/sample-wireframe.ts
 */

import {
  type SceneGraph,
  type SceneNode,
  SceneGraph as SceneGraphCtor,
  computeAllLayouts
} from '@open-pencil/core'
import { loadDocument } from './headless'

// -- IO helpers (fig export) --
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core'

const io = new IORegistry(BUILTIN_IO_FORMATS)

const LIB_PATH = process.env.COMPONENT_LIBRARY_PATH || './input/common_only.fig'
const OUTPUT_PATH = process.env.OUTPUT_PATH || './output/sample-wireframe.fig'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function findComponentByName(graph: SceneGraph, name: string): SceneNode | null {
  const lower = name.toLowerCase()
  // Exact match first
  for (const node of graph.getAllNodes()) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.name.toLowerCase() === lower) {
      return node
    }
  }
  // Substring match
  for (const node of graph.getAllNodes()) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.name.toLowerCase().includes(lower)) {
      return node
    }
  }
  return null
}

/** Find the first variant (COMPONENT child) of a COMPONENT_SET. */
function firstVariant(graph: SceneGraph, setNode: SceneNode): SceneNode | null {
  if (setNode.type === 'COMPONENT') return setNode
  for (const childId of setNode.childIds) {
    const child = graph.getNode(childId)
    if (child?.type === 'COMPONENT') return child
  }
  return null
}

function findTextChildRecursive(graph: SceneGraph, parentId: string, nameHint: string): SceneNode | null {
  const parent = graph.getNode(parentId)
  if (!parent) return null
  const lower = nameHint.toLowerCase()
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.type === 'TEXT' && (child.name.toLowerCase().includes(lower) || child.text?.toLowerCase().includes(lower))) {
      return child
    }
    const found = findTextChildRecursive(graph, child.id, nameHint)
    if (found) return found
  }
  // If no match by name, return the first TEXT node
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.type === 'TEXT') return child
    const found = findFirstText(graph, child.id)
    if (found) return found
  }
  return null
}

function findFirstText(graph: SceneGraph, parentId: string): SceneNode | null {
  const parent = graph.getNode(parentId)
  if (!parent) return null
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.type === 'TEXT') return child
    const r = findFirstText(graph, child.id)
    if (r) return r
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  Extract minimal graph                                              */
/* ------------------------------------------------------------------ */

/**
 * Build a new SceneGraph containing only the wireframe frame, its children,
 * and all referenced component trees (so INSTANCE → COMPONENT links survive).
 */
function extractWireframeGraph(source: SceneGraph, frameId: string): SceneGraph {
  const graph = new SceneGraphCtor()
  for (const id of [...graph.nodes.keys()]) graph.nodes.delete(id)

  const neededIds = new Set<string>()
  const pages = source.getPages()
  const originalPage = pages[0]

  // Step 1: collect wireframe frame subtree + all referenced componentIds
  function collectSubtree(id: string) {
    if (neededIds.has(id)) return
    neededIds.add(id)
    const node = source.getNode(id)
    if (!node) return
    if (node.componentId) collectSubtree(node.componentId)
    for (const childId of node.childIds) collectSubtree(childId)
  }
  collectSubtree(frameId)

  // Step 2: for each referenced component, walk UP to its page-level ancestor
  // and include that entire ancestor tree (COMPONENT_SET → COMPONENT → children)
  const pageLevelAncestors = new Set<string>()

  // Components may live on any page (including Internal Only Canvas)
  const allPageIds = new Set(source.getPages(true).map(p => p.id))

  function findPageLevelAncestor(id: string): string | null {
    let current = source.getNode(id)
    while (current) {
      if (current.parentId && allPageIds.has(current.parentId)) return current.id
      if (!current.parentId) return null
      current = source.getNode(current.parentId)
    }
    return null
  }

  // Collect all componentIds referenced by any node in neededIds
  const referencedComponentIds = new Set<string>()
  for (const id of neededIds) {
    const node = source.getNode(id)
    if (node?.componentId) referencedComponentIds.add(node.componentId)
  }

  // For each referenced component, find its page-level ancestor
  for (const compId of referencedComponentIds) {
    const ancestor = findPageLevelAncestor(compId)
    if (ancestor) pageLevelAncestors.add(ancestor)
  }

  // Collect full subtrees of all page-level ancestors
  for (const ancestorId of pageLevelAncestors) {
    collectSubtree(ancestorId)
  }

  // Step 3: after collecting ancestor trees, some new instances may reference
  // additional components — iterate until stable
  let prevSize = 0
  while (neededIds.size !== prevSize) {
    prevSize = neededIds.size
    const newCompIds = new Set<string>()
    for (const id of neededIds) {
      const node = source.getNode(id)
      if (node?.componentId && !neededIds.has(node.componentId)) {
        newCompIds.add(node.componentId)
      }
    }
    for (const compId of newCompIds) {
      const ancestor = findPageLevelAncestor(compId)
      if (ancestor) collectSubtree(ancestor)
      else collectSubtree(compId)
    }
  }

  console.log(`  Included ${pageLevelAncestors.size} component trees, ${neededIds.size} total nodes`)

  // Step 4: build the new graph
  const root = source.getNode(source.rootId)!

  // Group page-level ancestors by their parent page
  const ancestorsByPage = new Map<string, string[]>()
  for (const aId of pageLevelAncestors) {
    const node = source.getNode(aId)
    const pageId = node?.parentId ?? originalPage.id
    if (!ancestorsByPage.has(pageId)) ancestorsByPage.set(pageId, [])
    ancestorsByPage.get(pageId)!.push(aId)
  }

  // Ensure the wireframe page is included
  if (!ancestorsByPage.has(originalPage.id)) ancestorsByPage.set(originalPage.id, [])
  // Add wireframe frame to its page
  ancestorsByPage.get(originalPage.id)!.push(frameId)

  // Build page list
  const outputPageIds: string[] = []
  for (const [pageId, children] of ancestorsByPage) {
    const page = source.getNode(pageId)
    if (!page) continue
    outputPageIds.push(pageId)
    graph.nodes.set(pageId, {
      ...structuredClone(page),
      childIds: children
    } as SceneNode)
  }

  graph.nodes.set(source.rootId, {
    ...structuredClone(root),
    childIds: outputPageIds
  } as SceneNode)
  ;(graph as any).rootId = source.rootId

  // Copy all needed nodes
  for (const id of neededIds) {
    if (graph.nodes.has(id)) continue
    const node = source.getNode(id)
    if (!node) continue
    graph.nodes.set(id, structuredClone(node) as SceneNode)
  }

  // Fix parent references for page-level children
  for (const [pageId, children] of ancestorsByPage) {
    for (const cid of children) {
      const node = graph.nodes.get(cid)
      if (node) node.parentId = pageId
    }
  }

  // Position wireframe at origin
  const frame = graph.nodes.get(frameId)
  if (frame) { frame.x = 0; frame.y = 0 }

  // Copy referenced images
  for (const node of graph.getAllNodes()) {
    for (const fill of (node.fills || []) as any[]) {
      if (fill?.type === 'IMAGE' && fill.imageRef && source.images.has(fill.imageRef)) {
        graph.images.set(fill.imageRef, source.images.get(fill.imageRef)!)
      }
    }
  }

  // Rebuild instance index
  for (const node of graph.getAllNodes()) {
    if (node.componentId) {
      let set = graph.instanceIndex.get(node.componentId)
      if (!set) { set = new Set(); graph.instanceIndex.set(node.componentId, set) }
      set.add(node.id)
    }
  }

  return graph
}

function countNodes(graph: SceneGraph): number {
  let count = 0
  for (const _ of graph.getAllNodes()) count++
  return count
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`Loading component library: ${LIB_PATH}`)
  const libGraph = await loadDocument(LIB_PATH)

  // List available component sets for reference
  const sets: string[] = []
  for (const node of libGraph.getAllNodes()) {
    if (node.type === 'COMPONENT_SET') sets.push(node.name)
  }
  console.log(`Loaded ${sets.length} component sets`)

  // --- Build a sample "주문 관리" (Order Management) wireframe ---
  const pageId = libGraph.getPages()[0].id

  // Create a mobile frame (375 × 812)
  const rootFrame = libGraph.createNode('FRAME', pageId, {
    name: '주문 관리 화면',
    width: 375,
    height: 812,
    x: 2000, // place to the right of existing components
    y: 0,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
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

  console.log(`\nCreated root frame: ${rootFrame.id} (${rootFrame.name})`)

  // Define the component composition
  const composition: Array<{ name: string; overrides?: Record<string, string> }> = [
    { name: 'header-main', overrides: { title: '주문 관리' } },
    { name: 'input-search', overrides: { placeholder: '주문번호, 고객명 검색' } },
    { name: 'btn-tabbar', overrides: { label: '전체' } },
    { name: 'com-card-product', overrides: { title: '맥북 프로 14인치' } },
    { name: 'com-card-product', overrides: { title: '아이패드 에어' } },
    { name: 'com-card-product', overrides: { title: '에어팟 프로' } },
    { name: 'btn-main-task-bottom', overrides: { title: '새 주문 등록' } },
  ]

  let placedCount = 0
  for (const item of composition) {
    const compSet = findComponentByName(libGraph, item.name)
    if (!compSet) {
      console.log(`  ✗ Component not found: "${item.name}"`)
      continue
    }

    // Get the first variant (actual COMPONENT) if it's a COMPONENT_SET
    const comp = firstVariant(libGraph, compSet)
    if (!comp) {
      console.log(`  ✗ No variant found in set: "${item.name}"`)
      continue
    }

    // Create instance
    const instance = libGraph.createInstance(comp.id, rootFrame.id, {})
    if (!instance) {
      console.log(`  ✗ Failed to create instance of: "${comp.name}" (${comp.id})`)
      continue
    }

    // Apply text overrides
    if (item.overrides) {
      for (const [key, value] of Object.entries(item.overrides)) {
        const textNode = findTextChildRecursive(libGraph, instance.id, key)
        if (textNode) {
          libGraph.updateNode(textNode.id, { text: value })
          instance.overrides[`${textNode.id}:text`] = value
        }
      }
    }

    console.log(`  ✓ ${comp.name} → instance ${instance.id}`)
    placedCount++
  }

  console.log(`\nPlaced ${placedCount}/${composition.length} components`)

  // Compute layout
  computeAllLayouts(libGraph)

  // Export to .fig
  const outputDir = OUTPUT_PATH.split('/').slice(0, -1).join('/')
  await Bun.write(outputDir + '/.keep', '') // ensure dir exists

  const { exportFigFile } = await import('@open-pencil/core')

  // Build a minimal graph with only the wireframe frame + referenced components
  const miniGraph = extractWireframeGraph(libGraph, rootFrame.id)
  computeAllLayouts(miniGraph)

  console.log(`\nExporting to: ${OUTPUT_PATH}`)
  const figBytes = await exportFigFile(miniGraph)
  await Bun.write(OUTPUT_PATH, figBytes)

  const stats = await Bun.file(OUTPUT_PATH).stat()
  console.log(`Done! File size: ${(stats.size / 1024).toFixed(1)} KB`)
  console.log(`\nThe wireframe contains ${countNodes(miniGraph)} nodes.`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
