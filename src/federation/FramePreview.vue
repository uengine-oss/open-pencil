<script setup lang="ts">
/**
 * FramePreview - Lightweight DOM-based preview of a SceneGraph frame.
 * Does NOT use CanvasKit — avoids singleton conflicts with FrameEditor.
 */
import { computed } from 'vue'
import type { SerializedSceneGraph, SerializedSceneNode } from './bridge/serialize'

const props = defineProps<{
  sceneData: SerializedSceneGraph
  frameId: string
  width?: number
  height?: number
}>()

const frame = computed(() => props.sceneData?.nodes?.[props.frameId] || null)

const scale = computed(() => {
  const f = frame.value
  if (!f) return 1
  const fw = f.width || 1440
  const fh = f.height || 900
  return Math.min((props.width || 400) / fw, (props.height || 300) / fh, 1)
})

function getChildren(nodeId: string): SerializedSceneNode[] {
  return (props.sceneData?.nodes?.[nodeId]?.childIds || [])
    .map(id => props.sceneData.nodes[id]).filter(Boolean)
}

function fillColor(node: SerializedSceneNode): string | undefined {
  const solid = node.fills?.find(f => f.type === 'SOLID' && f.visible !== false)
  if (!solid?.color) return undefined
  const { r, g, b } = solid.color
  return `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${solid.opacity ?? 1})`
}

function nodeStyle(node: SerializedSceneNode): Record<string, string> {
  const n = node as any
  const s: Record<string, string> = {}
  if (!n.visible && n.visible !== undefined) { s.display = 'none'; return s }
  if (n.width) s.width = n.width + 'px'
  if (n.height) s.height = n.height + 'px'
  const layout = n.layoutMode
  if (layout === 'HORIZONTAL') { s.display = 'flex'; s.flexDirection = 'row' }
  else if (layout === 'VERTICAL') { s.display = 'flex'; s.flexDirection = 'column' }
  if (n.itemSpacing) s.gap = n.itemSpacing + 'px'
  if (n.paddingLeft) s.paddingLeft = n.paddingLeft + 'px'
  if (n.paddingRight) s.paddingRight = n.paddingRight + 'px'
  if (n.paddingTop) s.paddingTop = n.paddingTop + 'px'
  if (n.paddingBottom) s.paddingBottom = n.paddingBottom + 'px'
  // Support both Figma API names and SceneNode names
  const primaryAlign = n.primaryAxisAlign || n.primaryAxisAlignItems
  if (primaryAlign === 'CENTER') s.justifyContent = 'center'
  else if (primaryAlign === 'MAX') s.justifyContent = 'flex-end'
  else if (primaryAlign === 'SPACE_BETWEEN') s.justifyContent = 'space-between'
  const counterAlign = n.counterAxisAlign || n.counterAxisAlignItems
  if (counterAlign === 'CENTER') s.alignItems = 'center'
  else if (counterAlign === 'MAX') s.alignItems = 'flex-end'
  // Sizing: SceneNode uses primaryAxisSizing/counterAxisSizing; Figma API uses layoutSizingHorizontal/Vertical
  const hSizing = n.counterAxisSizing || n.layoutSizingHorizontal
  const vSizing = n.primaryAxisSizing || n.layoutSizingVertical
  if (hSizing === 'FILL') s.width = '100%'
  if (vSizing === 'FILL') s.height = '100%'
  if (n.layoutGrow) s.flexGrow = String(n.layoutGrow)
  const bg = fillColor(node)
  if (bg && n.type !== 'TEXT') s.backgroundColor = bg
  if (n.cornerRadius) s.borderRadius = n.cornerRadius + 'px'
  if (n.strokes?.length) {
    const stroke = n.strokes.find((st: any) => st.type === 'SOLID' && st.visible !== false)
    if (stroke?.color) {
      const { r, g, b } = stroke.color
      s.border = `${n.strokeWeight||1}px solid rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${stroke.opacity??1})`
    }
  }
  if (n.clipsContent) s.overflow = 'hidden'
  return s
}

function textStyle(node: SerializedSceneNode): Record<string, string> {
  const s: Record<string, string> = {}
  const seg = node.textSegments?.[0]
  const fontSize = seg?.fontSize || (node as any).fontSize || 14
  const fontWeight = seg?.fontWeight || (node as any).fontWeight || 400
  s.fontSize = fontSize + 'px'
  if (fontWeight !== 400) s.fontWeight = String(fontWeight)
  if (seg?.lineHeightPx) s.lineHeight = seg.lineHeightPx + 'px'
  s.color = fillColor(node) || '#333'
  if (node.textAlignHorizontal === 'CENTER') s.textAlign = 'center'
  else if (node.textAlignHorizontal === 'RIGHT') s.textAlign = 'right'
  if (node.width) s.width = node.width + 'px'
  s.overflow = 'hidden'
  s.wordWrap = 'break-word'
  return s
}
</script>

<template>
  <div class="frame-preview" :style="{ width: `${width ?? 400}px`, height: `${height ?? 300}px` }">
    <div v-if="!frame" class="frame-preview__error">Frame not found</div>
    <div v-else class="frame-preview__viewport" :style="{ transform: `scale(${scale})`, transformOrigin: 'top left' }">
      <div :style="nodeStyle(frame)">
        <template v-for="c1 in getChildren(frameId)" :key="c1.id">
          <span v-if="c1.type === 'TEXT'" :style="{ ...nodeStyle(c1), ...textStyle(c1) }">{{ c1.text || c1.characters }}</span>
          <div v-else :style="nodeStyle(c1)">
            <template v-for="c2 in getChildren(c1.id)" :key="c2.id">
              <span v-if="c2.type === 'TEXT'" :style="{ ...nodeStyle(c2), ...textStyle(c2) }">{{ c2.text || c2.characters }}</span>
              <div v-else :style="nodeStyle(c2)">
                <template v-for="c3 in getChildren(c2.id)" :key="c3.id">
                  <span v-if="c3.type === 'TEXT'" :style="{ ...nodeStyle(c3), ...textStyle(c3) }">{{ c3.text || c3.characters }}</span>
                  <div v-else :style="nodeStyle(c3)">
                    <template v-for="c4 in getChildren(c3.id)" :key="c4.id">
                      <span v-if="c4.type === 'TEXT'" :style="{ ...nodeStyle(c4), ...textStyle(c4) }">{{ c4.text || c4.characters }}</span>
                      <div v-else :style="nodeStyle(c4)">
                        <template v-for="c5 in getChildren(c4.id)" :key="c5.id">
                          <span v-if="c5.type === 'TEXT'" :style="{ ...nodeStyle(c5), ...textStyle(c5) }">{{ c5.text || c5.characters }}</span>
                          <div v-else :style="nodeStyle(c5)"></div>
                        </template>
                      </div>
                    </template>
                  </div>
                </template>
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.frame-preview { overflow: hidden; background: #f5f5f5; border-radius: 6px; position: relative; }
.frame-preview__viewport { position: absolute; top: 0; left: 0; }
.frame-preview__error { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #ff4d4f; font-size: 12px; }
</style>
