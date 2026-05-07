/**
 * Inspect a .fig file: list node types, components, instances, and their relationships.
 */
import { loadDocument } from './headless'

const FILE_PATH = process.argv[2] || './output/sample-wireframe.fig'

async function main() {
  console.log(`Inspecting: ${FILE_PATH}\n`)
  const graph = await loadDocument(FILE_PATH)

  const stats: Record<string, number> = {}
  const components: { id: string; name: string; parentId: string | null }[] = []
  const instances: { id: string; name: string; componentId: string | null; parentId: string | null }[] = []

  for (const node of graph.getAllNodes()) {
    stats[node.type] = (stats[node.type] || 0) + 1
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      components.push({ id: node.id, name: node.name, parentId: node.parentId })
    }
    if (node.type === 'INSTANCE') {
      instances.push({ id: node.id, name: node.name, componentId: node.componentId, parentId: node.parentId })
    }
  }

  console.log('Node type counts:')
  for (const [type, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log(`\nComponents (${components.length}):`)
  for (const c of components) {
    console.log(`  [${c.id}] ${c.name} (parent: ${c.parentId})`)
  }

  console.log(`\nInstances (${instances.length}):`)
  for (const inst of instances) {
    const comp = components.find(c => c.id === inst.componentId)
    const linked = comp ? `→ "${comp.name}"` : inst.componentId ? `→ MISSING ${inst.componentId}` : '→ (none)'
    console.log(`  [${inst.id}] ${inst.name} ${linked}`)
  }

  // Check: are all instance componentIds resolvable?
  const compIds = new Set(components.map(c => c.id))
  const broken = instances.filter(i => i.componentId && !compIds.has(i.componentId))
  if (broken.length > 0) {
    console.log(`\n⚠ ${broken.length} instances reference missing components:`)
    for (const b of broken) {
      console.log(`  [${b.id}] ${b.name} → MISSING ${b.componentId}`)
    }
  } else {
    console.log(`\n✓ All ${instances.length} instances have their component assets preserved.`)
  }

  // Show page structure
  const pages = graph.getPages()
  console.log(`\nPages:`)
  for (const page of pages) {
    console.log(`  ${page.name} (${page.childIds.length} top-level children)`)
    for (const childId of page.childIds) {
      const child = graph.getNode(childId)
      if (child) {
        console.log(`    ├─ [${child.type}] ${child.name} (${child.width}×${child.height})`)
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
