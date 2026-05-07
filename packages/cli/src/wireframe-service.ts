/**
 * Bun HTTP service for component-based wireframe generation.
 *
 * Loads a .fig component library (e.g. common_only.fig), extracts the
 * component catalog, and exposes endpoints for:
 *   GET  /components       → component catalog (for LLM prompt injection)
 *   POST /render           → JSX + component instances → SerializedSceneGraph JSON
 *   GET  /health           → health check
 */

import {
  type SceneGraph,
  type SceneNode,
  renderJSX,
  computeAllLayouts,
  SceneGraph as SceneGraphCtor,
  exportFigFile
} from '@open-pencil/core'
import { loadDocument } from './headless'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ComponentInfo {
  id: string
  name: string
  type: string
  page: string
  width: number
  height: number
  children: ChildSummary[]
  /** Human-readable description of what this component contains */
  description: string
}

interface ChildSummary {
  name: string
  type: string
  text?: string
}

interface SerializedSceneNode {
  [key: string]: unknown
  id: string
  type: string
  name: string
  parentId: string | null
  childIds: string[]
}

interface SerializedSceneGraph {
  nodes: Record<string, SerializedSceneNode>
  rootId: string
  images: Record<string, string>
}

/* ------------------------------------------------------------------ */
/*  Global state                                                       */
/* ------------------------------------------------------------------ */

let libraryGraph: SceneGraph | null = null
let componentCatalog: ComponentInfo[] = []

/* ------------------------------------------------------------------ */
/*  Component catalog extraction                                       */
/* ------------------------------------------------------------------ */

function summarizeChildren(graph: SceneGraph, nodeId: string, depth = 0): ChildSummary[] {
  if (depth > 2) return []
  const node = graph.getNode(nodeId)
  if (!node) return []

  const result: ChildSummary[] = []
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    const summary: ChildSummary = { name: child.name, type: child.type }
    if (child.type === 'TEXT' && child.text) {
      summary.text = child.text.slice(0, 100)
    }
    result.push(summary)
  }
  return result
}

function describeComponent(graph: SceneGraph, node: SceneNode): string {
  const parts: string[] = []
  parts.push(`${node.width}×${node.height}`)
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    parts.push(`layout=${node.layoutMode}`)
  }
  const childTypes = node.childIds
    .map(id => graph.getNode(id))
    .filter(Boolean)
    .map(c => c!.type)
  if (childTypes.length > 0) {
    const typeCounts: Record<string, number> = {}
    for (const t of childTypes) typeCounts[t] = (typeCounts[t] || 0) + 1
    parts.push(
      'children: ' +
        Object.entries(typeCounts)
          .map(([t, c]) => `${c}×${t}`)
          .join(', ')
    )
  }
  return parts.join(', ')
}

function extractComponentCatalog(graph: SceneGraph): ComponentInfo[] {
  const components: ComponentInfo[] = []
  const pages = graph.getPages()

  for (const page of pages) {
    const walk = (nodeId: string) => {
      const node = graph.getNode(nodeId)
      if (!node) return
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        components.push({
          id: node.id,
          name: node.name,
          type: node.type,
          page: page.name,
          width: node.width,
          height: node.height,
          children: summarizeChildren(graph, node.id),
          description: describeComponent(graph, node)
        })
      }
      for (const childId of node.childIds) {
        walk(childId)
      }
    }
    walk(page.id)
  }
  return components
}

/* ------------------------------------------------------------------ */
/*  Serialization (matching federation bridge format)                   */
/* ------------------------------------------------------------------ */

/** Preserve commandsBlob as-is (Uint8Array) for internal clone, or encode to base64 data string for JSON transport. */
function serializeGeometryForTransport(paths: any[], toBase64: boolean): any[] {
  if (!paths) return []
  return paths.map((p: any) => {
    if (toBase64) {
      // For JSON transport: commandsBlob → base64 data string
      let data = ''
      if (p.commandsBlob instanceof Uint8Array && p.commandsBlob.length > 0) {
        let binary = ''
        for (let i = 0; i < p.commandsBlob.length; i++) binary += String.fromCharCode(p.commandsBlob[i])
        data = btoa(binary)
      } else if (typeof p.data === 'string') {
        data = p.data
      }
      return { windingRule: p.windingRule, data }
    } else {
      // For internal clone: keep commandsBlob
      return { windingRule: p.windingRule, commandsBlob: p.commandsBlob ?? new Uint8Array(0) }
    }
  })
}

function deserializeGeometry(paths: any[]): any[] {
  if (!paths) return []
  return paths.map((p: any) => {
    if (p.commandsBlob instanceof Uint8Array) return { windingRule: p.windingRule, commandsBlob: p.commandsBlob }
    if (typeof p.data === 'string' && p.data.length > 0) {
      const binary = atob(p.data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return { windingRule: p.windingRule, commandsBlob: bytes }
    }
    return { windingRule: p.windingRule ?? 'NONZERO', commandsBlob: new Uint8Array(0) }
  })
}

function serializeGraph(graph: SceneGraph): SerializedSceneGraph {
  const nodes: Record<string, SerializedSceneNode> = {}
  for (const node of graph.getAllNodes()) {
    const { fillGeometry, strokeGeometry, textPicture, ...rest } = node as any
    nodes[node.id] = {
      ...rest,
      fillGeometry: serializeGeometryForTransport(fillGeometry, true),
      strokeGeometry: serializeGeometryForTransport(strokeGeometry, true)
    }
  }

  const images: Record<string, string> = {}
  for (const [id, data] of graph.images) {
    let binary = ''
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
    images[id] = btoa(binary)
  }

  return { nodes, rootId: graph.rootId, images }
}

/** Serialize a single-frame subtree. */
function serializeFrameSubgraph(graph: SceneGraph, frameId: string): SerializedSceneGraph {
  const nodes: Record<string, SerializedSceneNode> = {}
  const imageRefs = new Set<string>()

  const collectNode = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    const { fillGeometry, strokeGeometry, textPicture, ...rest } = node as any
    nodes[id] = {
      ...rest,
      fillGeometry: serializeGeometryForTransport(fillGeometry, true),
      strokeGeometry: serializeGeometryForTransport(strokeGeometry, true)
    }
    // Collect image refs
    for (const fill of (node.fills ?? [])) {
      if ((fill as any).type === 'IMAGE' && (fill as any).imageRef) {
        imageRefs.add((fill as any).imageRef)
      }
    }
    for (const childId of node.childIds) collectNode(childId)
  }
  collectNode(frameId)

  // Wrap in minimal root → page → frame structure
  const pages = graph.getPages()
  const pageId = pages[0]?.id
  const root = graph.getNode(graph.rootId)!
  const page = graph.getNode(pageId)!

  nodes[pageId] = {
    ...serializeNodeBasic(page),
    childIds: [frameId]
  }
  nodes[graph.rootId] = {
    ...serializeNodeBasic(root),
    childIds: [pageId]
  }
  if (nodes[frameId]) {
    nodes[frameId].parentId = pageId
  }

  const images: Record<string, string> = {}
  for (const ref of imageRefs) {
    const data = graph.images.get(ref)
    if (data) {
      let binary = ''
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
      images[ref] = btoa(binary)
    }
  }

  return { nodes, rootId: graph.rootId, images }
}

function serializeNodeBasic(node: SceneNode): SerializedSceneNode {
  const { fillGeometry, strokeGeometry, textPicture, ...rest } = node as any
  return {
    ...rest,
    fillGeometry: [],
    strokeGeometry: []
  }
}

/* ------------------------------------------------------------------ */
/*  Wireframe rendering                                                */
/* ------------------------------------------------------------------ */

/**
 * Build a wireframe SceneGraph from a component composition descriptor.
 *
 * The descriptor is a JSON array of component placements:
 * [
 *   { "component": "AppBar", "overrides": { "title": "주문관리" } },
 *   { "component": "DataTable", "overrides": { "columns": ["주문번호","고객명","금액"] } },
 *   { "component": "Pagination" }
 * ]
 *
 * Or a JSX string that references components.
 */
async function renderWireframe(
  input: { jsx?: string; components?: ComponentPlacement[]; name?: string; width?: number; height?: number }
): Promise<SerializedSceneGraph> {
  if (!libraryGraph) throw new Error('Component library not loaded')

  // Create a fresh graph that includes the library components
  const graph = cloneGraphForRendering(libraryGraph)
  const pageId = graph.getPages()[0].id

  const frameName = input.name || 'Wireframe'
  const frameWidth = input.width || 375
  const frameHeight = input.height || 812

  if (input.jsx) {
    // Render JSX directly
    const result = await renderJSX(graph, input.jsx, { parentId: pageId })
    computeAllLayouts(graph)
    return serializeFrameSubgraph(graph, result.id)
  }

  if (input.components && input.components.length > 0) {
    // Build frame from component instances
    const rootFrame = graph.createNode('FRAME', pageId, {
      name: frameName,
      width: frameWidth,
      height: frameHeight,
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

    for (const placement of input.components) {
      const compNode = findComponentByName(graph, placement.component)
      if (compNode) {
        const instance = graph.createInstance(compNode.id, rootFrame.id, {})
        if (instance && placement.overrides) {
          applyTextOverrides(graph, instance, placement.overrides)
        }
      } else {
        // Fallback: render as a placeholder frame
        graph.createNode('FRAME', rootFrame.id, {
          name: placement.component,
          width: frameWidth,
          height: 48,
          fills: [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95, a: 1 }, opacity: 1, visible: true }],
          layoutMode: 'HORIZONTAL',
          primaryAxisAlign: 'CENTER',
          counterAxisAlign: 'CENTER',
          counterAxisSizing: 'FIXED',
          primaryAxisSizing: 'FILL'
        })
      }
    }

    computeAllLayouts(graph)
    return serializeFrameSubgraph(graph, rootFrame.id)
  }

  throw new Error('Either jsx or components must be provided')
}

interface ComponentPlacement {
  component: string
  overrides?: Record<string, unknown>
}

/** Find the first COMPONENT variant inside a COMPONENT_SET. */
function firstVariant(graph: SceneGraph, setNode: SceneNode): SceneNode | null {
  if (setNode.type === 'COMPONENT') return setNode
  for (const childId of setNode.childIds) {
    const child = graph.getNode(childId)
    if (child?.type === 'COMPONENT') return child
  }
  return null
}

/**
 * Find a component by name. Returns a COMPONENT node (resolving through
 * COMPONENT_SET if needed) that can be passed to createInstance.
 */
function findComponentByName(graph: SceneGraph, name: string): SceneNode | null {
  const lowerName = name.toLowerCase()

  // Pass 1: exact name match
  for (const node of graph.getAllNodes()) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
        node.name.toLowerCase() === lowerName) {
      return firstVariant(graph, node) ?? node
    }
  }
  // Pass 2: substring match
  for (const node of graph.getAllNodes()) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
        node.name.toLowerCase().includes(lowerName)) {
      return firstVariant(graph, node) ?? node
    }
  }
  return null
}

/** Apply text overrides to an instance's text children recursively. */
function applyTextOverrides(
  graph: SceneGraph,
  instance: SceneNode,
  overrides: Record<string, unknown>
): void {
  // Simple text replacement: if override has a "title" key, find child named "Title" etc.
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') continue
    const textNode = findTextChild(graph, instance.id, key)
    if (textNode) {
      graph.updateNode(textNode.id, { text: value })
      instance.overrides[`${textNode.id}:text`] = value
    }
  }

  // Special: columns override for table-like components
  if (Array.isArray(overrides.columns)) {
    const headerRow = findChildByName(graph, instance.id, 'Header')
      || findChildByName(graph, instance.id, 'header')
      || findChildByName(graph, instance.id, 'Header Row')
    if (headerRow) {
      // Update existing text children or add new ones
      const textChildren = headerRow.childIds
        .map(id => graph.getNode(id))
        .filter(n => n && n.type === 'TEXT')
      for (let i = 0; i < overrides.columns.length; i++) {
        if (i < textChildren.length) {
          graph.updateNode(textChildren[i]!.id, { text: String(overrides.columns[i]) })
        }
      }
    }
  }
}

function findTextChild(graph: SceneGraph, parentId: string, name: string): SceneNode | null {
  const parent = graph.getNode(parentId)
  if (!parent) return null
  const lowerName = name.toLowerCase()
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.type === 'TEXT' && child.name.toLowerCase().includes(lowerName)) return child
    const found = findTextChild(graph, child.id, name)
    if (found) return found
  }
  return null
}

function findChildByName(graph: SceneGraph, parentId: string, name: string): SceneNode | null {
  const parent = graph.getNode(parentId)
  if (!parent) return null
  const lowerName = name.toLowerCase()
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.name.toLowerCase().includes(lowerName)) return child
  }
  return null
}

/** Clone the library graph so we can render into it without modifying the original. */
function cloneGraphForRendering(source: SceneGraph): SceneGraph {
  const json = serializeGraph(source)
  // Rebuild a fresh graph from serialized data
  const graph = new SceneGraphCtor()
  // Clear defaults
  const defaults = [...graph.nodes.keys()]
  for (const id of defaults) graph.nodes.delete(id)

  for (const [id, serialized] of Object.entries(json.nodes)) {
    const { fillGeometry, strokeGeometry, ...rest } = serialized as any
    const node = {
      ...rest,
      fillGeometry: deserializeGeometry(fillGeometry),
      strokeGeometry: deserializeGeometry(strokeGeometry)
    } as SceneNode
    graph.nodes.set(id, node)
  }
  ;(graph as any).rootId = json.rootId

  for (const [id, base64] of Object.entries(json.images)) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    graph.images.set(id, bytes)
  }

  // Rebuild instance index
  for (const node of graph.getAllNodes()) {
    if (node.componentId) {
      let set = graph.instanceIndex.get(node.componentId)
      if (!set) {
        set = new Set()
        graph.instanceIndex.set(node.componentId, set)
      }
      set.add(node.id)
    }
  }

  return graph
}

/* ------------------------------------------------------------------ */
/*  SceneGraph → .fig export                                           */
/* ------------------------------------------------------------------ */

async function exportSceneGraphToFig(
  sceneGraphJson: SerializedSceneGraph,
  name: string
): Promise<Uint8Array> {
  // Deserialize the scene graph
  const graph = new SceneGraphCtor()
  for (const id of [...graph.nodes.keys()]) graph.nodes.delete(id)

  for (const [id, serialized] of Object.entries(sceneGraphJson.nodes)) {
    const { fillGeometry, strokeGeometry, ...rest } = serialized as any
    const node = {
      ...rest,
      fillGeometry: deserializeGeometry(fillGeometry),
      strokeGeometry: deserializeGeometry(strokeGeometry)
    } as SceneNode
    graph.nodes.set(id, node)
  }
  ;(graph as any).rootId = sceneGraphJson.rootId

  // Restore images
  for (const [id, base64] of Object.entries(sceneGraphJson.images || {})) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    graph.images.set(id, bytes)
  }

  // Rebuild instance index
  for (const node of graph.getAllNodes()) {
    if (node.componentId) {
      let set = graph.instanceIndex.get(node.componentId)
      if (!set) { set = new Set(); graph.instanceIndex.set(node.componentId, set) }
      set.add(node.id)
    }
  }

  // If the library is loaded, merge referenced components into the graph
  if (libraryGraph) {
    mergeReferencedComponents(graph, libraryGraph)
  }

  computeAllLayouts(graph)
  try {
    return await exportFigFile(graph)
  } catch (err: any) {
    // Log details for debugging
    const typeCounts: Record<string, number> = {}
    for (const node of graph.getAllNodes()) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1
    }
    console.error(`[export-fig] exportFigFile failed: ${err.message}`)
    console.error(`[export-fig] Nodes: ${[...graph.nodes.keys()].length}, types:`, JSON.stringify(typeCounts))
    throw err
  }
}

/**
 * Find all INSTANCE nodes in `target` that reference components not present
 * in `target`, and copy those component trees from `source` (the library).
 */
function mergeReferencedComponents(target: SceneGraph, source: SceneGraph): void {
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

  // Collect missing componentIds
  const missingCompIds = new Set<string>()
  for (const node of target.getAllNodes()) {
    if (node.componentId && !target.nodes.has(node.componentId)) {
      missingCompIds.add(node.componentId)
    }
  }

  if (missingCompIds.size === 0) return

  // Find page-level ancestors in source
  const ancestors = new Set<string>()
  for (const compId of missingCompIds) {
    const anc = findPageLevelAncestor(compId)
    if (anc) ancestors.add(anc)
  }

  // Collect all nodes from ancestor subtrees
  const neededIds = new Set<string>()
  function collectSubtree(id: string) {
    if (neededIds.has(id)) return
    neededIds.add(id)
    const node = source.getNode(id)
    if (!node) return
    if (node.componentId) collectSubtree(node.componentId)
    for (const childId of node.childIds) collectSubtree(childId)
  }
  for (const ancId of ancestors) collectSubtree(ancId)

  // Iterate until stable (nested references)
  let prevSize = 0
  while (neededIds.size !== prevSize) {
    prevSize = neededIds.size
    for (const id of [...neededIds]) {
      const node = source.getNode(id)
      if (node?.componentId && !neededIds.has(node.componentId) && !target.nodes.has(node.componentId)) {
        const anc = findPageLevelAncestor(node.componentId)
        if (anc) collectSubtree(anc)
        else collectSubtree(node.componentId)
      }
    }
  }

  // Get or create the "Components" page in target
  const targetPages = target.getPages(true)
  let compPage = targetPages.find(p => p.name === 'Components' || p.name === 'Internal Only Canvas')
  if (!compPage) {
    compPage = target.createNode('CANVAS', target.rootId, { name: 'Components' })
  }

  // Copy nodes from source into target
  for (const id of neededIds) {
    if (target.nodes.has(id)) continue
    const node = source.getNode(id)
    if (!node) continue
    target.nodes.set(id, structuredClone(node) as SceneNode)
  }

  // Reparent ancestors to the components page
  for (const ancId of ancestors) {
    const node = target.nodes.get(ancId)
    if (node) {
      node.parentId = compPage.id
      if (!compPage.childIds.includes(ancId)) {
        compPage.childIds.push(ancId)
      }
    }
  }

  // Rebuild instance index for new nodes
  for (const id of neededIds) {
    const node = target.nodes.get(id)
    if (node?.componentId) {
      let set = target.instanceIndex.get(node.componentId)
      if (!set) { set = new Set(); target.instanceIndex.set(node.componentId, set) }
      set.add(node.id)
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Catalog formatting for LLM prompt                                  */
/* ------------------------------------------------------------------ */

function formatCatalogForPrompt(catalog: ComponentInfo[]): string {
  const lines: string[] = [
    '# Available UI Components (from design library)',
    '',
    'Use these component names in your response. Each component can be placed with optional text overrides.',
    ''
  ]

  for (const comp of catalog) {
    lines.push(`## ${comp.name}`)
    lines.push(`- Type: ${comp.type}`)
    lines.push(`- Size: ${comp.description}`)
    if (comp.children.length > 0) {
      lines.push('- Children:')
      for (const child of comp.children) {
        const textHint = child.text ? ` (default: "${child.text}")` : ''
        lines.push(`  - ${child.name} (${child.type})${textHint}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/*  HTTP Server                                                        */
/* ------------------------------------------------------------------ */

const PORT = parseInt(process.env.WIREFRAME_SERVICE_PORT || '7610', 10)
const FIG_PATH = process.env.COMPONENT_LIBRARY_PATH || './input/common_only.fig'

async function startServer() {
  console.log(`[wireframe-service] Loading component library from: ${FIG_PATH}`)

  try {
    libraryGraph = await loadDocument(FIG_PATH)
    componentCatalog = extractComponentCatalog(libraryGraph)
    console.log(`[wireframe-service] Loaded ${componentCatalog.length} components:`)
    for (const comp of componentCatalog) {
      console.log(`  - ${comp.name} (${comp.type}, ${comp.description})`)
    }
  } catch (err) {
    console.error(`[wireframe-service] Failed to load component library:`, err)
    process.exit(1)
  }

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)

      // CORS
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        })
      }

      const corsHeaders = { 'Access-Control-Allow-Origin': '*' }

      try {
        // Health check
        if (url.pathname === '/health') {
          return Response.json(
            { status: 'ok', components: componentCatalog.length },
            { headers: corsHeaders }
          )
        }

        // Component catalog (JSON)
        if (url.pathname === '/components' && req.method === 'GET') {
          const format = url.searchParams.get('format')
          if (format === 'prompt') {
            return new Response(formatCatalogForPrompt(componentCatalog), {
              headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
            })
          }
          return Response.json(
            { count: componentCatalog.length, components: componentCatalog },
            { headers: corsHeaders }
          )
        }

        // Render wireframe (returns SceneGraph JSON)
        if (url.pathname === '/render' && req.method === 'POST') {
          const body = await req.json()
          const result = await renderWireframe(body)
          return Response.json(result, { headers: corsHeaders })
        }

        // Export sceneGraph JSON → .fig binary (with component assets)
        if (url.pathname === '/export-fig' && req.method === 'POST') {
          const body = await req.json()
          const sceneGraphJson = body.sceneGraph
          const fileName = body.name || 'wireframe'

          if (!sceneGraphJson || !sceneGraphJson.nodes) {
            return Response.json(
              { error: 'sceneGraph with nodes is required' },
              { status: 400, headers: corsHeaders }
            )
          }

          const figBytes = await exportSceneGraphToFig(sceneGraphJson, fileName)
          return new Response(figBytes, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}.fig"`
            }
          })
        }

        return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders })
      } catch (err: any) {
        console.error(`[wireframe-service] Error:`, err)
        return Response.json(
          { error: err.message || 'Internal server error' },
          { status: 500, headers: corsHeaders }
        )
      }
    }
  })

  console.log(`[wireframe-service] Running on http://localhost:${PORT}`)
  console.log(`  GET  /health       → health check`)
  console.log(`  GET  /components   → component catalog`)
  console.log(`  GET  /components?format=prompt → LLM-ready catalog`)
  console.log(`  POST /render       → generate wireframe SceneGraph`)
  console.log(`  POST /export-fig   → export sceneGraph as .fig file`)
}

startServer()
