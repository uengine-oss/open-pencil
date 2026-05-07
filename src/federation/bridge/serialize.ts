/**
 * Serialization bridge for SceneGraph <-> JSON transport across federation boundary.
 */
import { SceneGraph } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/core'

/** JSON-serializable SceneNode (Uint8Array fields encoded as base64) */
export interface SerializedSceneNode extends Omit<SceneNode, 'fillGeometry' | 'strokeGeometry'> {
  fillGeometry: Array<{ windingRule: string; data: string }>
  strokeGeometry: Array<{ windingRule: string; data: string }>
}

export interface SerializedSceneGraph {
  nodes: Record<string, SerializedSceneNode>
  rootId: string
  images: Record<string, string> // base64-encoded image data
}

/** Restore a base64-encoded data string back to commandsBlob Uint8Array. */
function restoreCommandsBlob(data: string | undefined): Uint8Array {
  if (!data) return new Uint8Array(0)
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

function encodeGeometry(paths: SceneNode['fillGeometry']): SerializedSceneNode['fillGeometry'] {
  if (!paths) return []
  return paths.map((p) => ({
    windingRule: p.windingRule,
    data: p.data
  }))
}

function serializeNode(node: SceneNode): SerializedSceneNode {
  return {
    ...node,
    fillGeometry: encodeGeometry(node.fillGeometry),
    strokeGeometry: encodeGeometry(node.strokeGeometry)
  } as SerializedSceneNode
}

export function serializeSceneGraph(graph: SceneGraph): SerializedSceneGraph {
  const nodes: Record<string, SerializedSceneNode> = {}

  for (const node of graph.getAllNodes()) {
    nodes[node.id] = serializeNode(node)
  }

  const images: Record<string, string> = {}
  for (const [id, data] of graph.images) {
    images[id] = uint8ArrayToBase64(data)
  }

  return {
    nodes,
    rootId: graph.rootId,
    images
  }
}

export function deserializeSceneGraph(data: SerializedSceneGraph): SceneGraph {
  const graph = new SceneGraph()
  if (!data || typeof data !== 'object') return graph

  // Clear default nodes created by constructor
  const defaultNodes = [...graph.nodes.keys()]
  for (const id of defaultNodes) {
    graph.nodes.delete(id)
  }

  // Restore nodes (tolerate missing/null .nodes)
  const nodesMap = data.nodes ?? {}
  for (const [id, serialized] of Object.entries(nodesMap)) {
    const node = {
      ...serialized,
      fillGeometry: serialized.fillGeometry?.map((p) => ({
        windingRule: p.windingRule as 'NONZERO' | 'EVENODD',
        commandsBlob: restoreCommandsBlob(p.data)
      })) ?? [],
      strokeGeometry: serialized.strokeGeometry?.map((p) => ({
        windingRule: p.windingRule as 'NONZERO' | 'EVENODD',
        commandsBlob: restoreCommandsBlob(p.data)
      })) ?? []
    } as SceneNode
    graph.nodes.set(id, node)
  }

  // Set rootId via internal access (preserve constructor default if missing)
  if (data.rootId) {
    ;(graph as any).rootId = data.rootId
  }

  // Restore images (tolerate missing/null .images)
  const imagesMap = data.images ?? {}
  for (const [id, base64] of Object.entries(imagesMap)) {
    graph.images.set(id, base64ToUint8Array(base64))
  }

  return graph
}

/**
 * Extract a subtree containing only the specified frame and its descendants,
 * wrapped in a minimal root -> CANVAS -> frame structure.
 */
export function extractFrameSubgraph(
  graph: SceneGraph,
  frameId: string
): SerializedSceneGraph | null {
  const frame = graph.getNode(frameId)
  if (!frame) return null

  const nodes: Record<string, SerializedSceneNode> = {}

  // Collect frame and all descendants
  function collectNode(id: string) {
    const node = graph.getNode(id)
    if (!node) return
    nodes[id] = serializeNode(node)
    for (const childId of node.childIds) {
      collectNode(childId)
    }
  }
  collectNode(frameId)

  // Find the page (CANVAS) that contains this frame
  const pages = graph.getPages()
  let pageId: string | null = null
  for (const page of pages) {
    if (page.childIds.includes(frameId)) {
      pageId = page.id
      break
    }
  }

  // Create minimal page wrapper if frame is a direct child of a page
  if (pageId) {
    const page = graph.getNode(pageId)!
    nodes[pageId] = serializeNode({
      ...page,
      childIds: [frameId]
    } as SceneNode)
  }

  // Create minimal root
  const root = graph.getNode(graph.rootId)!
  nodes[graph.rootId] = serializeNode({
    ...root,
    childIds: pageId ? [pageId] : [frameId]
  } as SceneNode)

  // Update frame's parentId to point to page or root
  if (nodes[frameId]) {
    nodes[frameId] = {
      ...nodes[frameId],
      parentId: pageId ?? graph.rootId
    }
  }

  // Collect relevant images
  const images: Record<string, string> = {}
  for (const [id, nodeData] of Object.entries(nodes)) {
    for (const fill of nodeData.fills || []) {
      if (fill.type === 'IMAGE' && fill.imageRef && graph.images.has(fill.imageRef)) {
        images[fill.imageRef] = uint8ArrayToBase64(graph.images.get(fill.imageRef)!)
      }
    }
  }

  return {
    nodes,
    rootId: graph.rootId,
    images
  }
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary)
}

/**
 * Fix orphaned frames in a deserialized SceneGraph.
 * AI tools may set parentId to "currentPage" or place FRAME nodes as direct root children
 * instead of as children of a CANVAS page. This function re-parents them correctly.
 */
export function fixOrphanedFrames(graph: SceneGraph): void {
  const root = graph.getNode(graph.rootId)
  if (!root) return

  const pages = graph.getPages()
  if (pages.length === 0) return
  const page = pages[0]

  // Collect FRAME nodes that are root children but not pages
  for (const cid of [...root.childIds]) {
    const child = graph.getNode(cid)
    if (child && child.type === 'FRAME' && cid !== graph.rootId) {
      // Move from root to first page
      root.childIds = root.childIds.filter(id => id !== cid)
      if (!page.childIds.includes(cid)) {
        page.childIds.push(cid)
      }
      child.parentId = page.id
    }
  }

  // Fix nodes with parentId = "currentPage" (string literal from AI render tool)
  for (const node of graph.getAllNodes()) {
    if ((node as any).parentId === 'currentPage') {
      node.parentId = page.id
      if (!page.childIds.includes(node.id)) {
        page.childIds.push(node.id)
      }
    }
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
