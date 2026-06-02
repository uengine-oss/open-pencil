<script setup lang="ts">
/**
 * FramePreviewChat — placeholder for the spec-034 chat-enabled preview.
 *
 * The full chat / Claude-IDE variant (terminal + file panes) from spec 034 has
 * not landed upstream yet. Until it does, this delegates to the read-only
 * FramePreview so the federation import `open-pencil-fed/FramePreviewChat.vue`
 * resolves to a REAL component. Previously the host aliased this name to
 * FramePreview.vue; a bare `import('.../FramePreviewChat.vue')` would otherwise
 * crash vite with "Cannot find module". Same props as FramePreview, and we
 * re-declare the `save` emit the host (InspectorPanel) binds so the contract is
 * explicit — the spec-034 chat→edit flow will use it.
 */
import FramePreview from './FramePreview.vue'
import type { SerializedSceneGraph } from './bridge/serialize'

defineProps<{
  sceneData: SerializedSceneGraph
  frameId: string
  width?: number
  height?: number
}>()

// Reserved for the spec-034 chat→edit flow. FramePreview is read-only and does
// not emit this today, but the host binds @save, so declare it for clarity.
defineEmits<{ save: [data: SerializedSceneGraph] }>()
</script>

<template>
  <FramePreview
    :scene-data="sceneData"
    :frame-id="frameId"
    :width="width"
    :height="height"
  />
</template>
