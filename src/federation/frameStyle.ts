/**
 * SceneGraph 노드를 DOM 스타일로 옮기는 규칙.
 *
 * FramePreview 안에 있던 것을 꺼냈다. 이 규칙이 틀리면 미리보기가 잘리는데,
 * 컴포넌트 안에 있으면 실제 장면 데이터로 확인할 방법이 없다. 여기 두면
 * `scripts/verify-ui-preview.mjs` 가 같은 코드를 그대로 불러 검사한다.
 */
import type { SerializedSceneGraph, SerializedSceneNode } from './bridge/serialize'

export function getChildren(sceneData: SerializedSceneGraph, nodeId: string): SerializedSceneNode[] {
  return (sceneData?.nodes?.[nodeId]?.childIds || [])
    .map((id) => sceneData.nodes[id]).filter(Boolean)
}

export function fillColor(node: SerializedSceneNode): string | undefined {
  const solid = node.fills?.find(f => f.type === 'SOLID' && f.visible !== false)
  if (!solid?.color) return undefined
  const { r, g, b } = solid.color
  return `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${solid.opacity ?? 1})`
}

export function nodeStyle(node: SerializedSceneNode): Record<string, string> {
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

export function textStyle(node: SerializedSceneNode): Record<string, string> {
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
  // Figma 의 width/height 는 `textAutoResize` 에 따라 뜻이 다르다.
  //
  //   WIDTH_AND_HEIGHT  글자에 맞춰 **잰** 값이다 — 제약이 아니다
  //   HEIGHT            너비만 고정, 높이는 글자를 따라간다
  //   NONE              둘 다 고정된 상자다
  //
  // 종전에는 셋을 구분하지 않고 너비·높이를 그대로 박고 `overflow: hidden` 을
  // 걸었다. 브라우저 폰트는 Figma 와 자간·줄바꿈이 달라서 한 줄이 두 줄이 되면
  // 그대로 잘렸다. 실측 342개 중 304개가 WIDTH_AND_HEIGHT 다.
  const autoResize = (node as any).textAutoResize || 'NONE'
  if (autoResize === 'NONE') {
    if (node.width) s.width = node.width + 'px'
    s.overflow = 'hidden'
  } else if (autoResize === 'HEIGHT') {
    if (node.width) s.width = node.width + 'px'
    s.height = 'auto'
  } else {
    // 잰 값이므로 최소 너비로만 쓴다 — 좁아서 접히는 일은 막고, 넓어지는 것은
    // 허용한다.
    if (node.width) s.minWidth = node.width + 'px'
    s.width = 'auto'
    s.height = 'auto'
  }
  // 부모가 auto-layout 이면 이 span 은 flex 항목이 되어 블록처럼 동작한다.
  // 그때 줄바꿈이 먹으려면 이것이 필요하다.
  s.whiteSpace = 'pre-wrap'
  s.wordWrap = 'break-word'
  s.flexShrink = '0'
  return s
}
