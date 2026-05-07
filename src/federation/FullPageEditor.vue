<script setup lang="ts">
/**
 * FullPageEditor - Full open-pencil editor without router dependency.
 * Shows the complete editor UI (Canvas, Toolbar, Layers, Properties, ChatPanel).
 */
import { onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle, TooltipProvider } from 'reka-ui'
import { useViewportKind, provideEditor } from '@open-pencil/vue'
import { useKeyboard } from '@/composables/use-keyboard'
import { createEditorStore, setActiveEditorStore } from '@/stores/editor'
import type { EditorStore } from '@/stores/editor'
import { SceneGraph } from '@open-pencil/core'
import {
  deserializeSceneGraph,
  serializeSceneGraph,
  type SerializedSceneGraph
} from './bridge/serialize'

import EditorCanvas from '@/components/EditorCanvas.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'
import Toolbar from '@/components/Toolbar.vue'
import TabBar from '@/components/TabBar.vue'

const props = defineProps<{
  sceneData?: SerializedSceneGraph
  onSave?: (data: SerializedSceneGraph) => void
}>()

const emit = defineEmits<{
  save: [data: SerializedSceneGraph]
}>()

const { isMobile } = useViewportKind()

// Create editor store synchronously in setup() for provideEditor/inject chain
const initialGraph = props.sceneData ? deserializeSceneGraph(props.sceneData) : new SceneGraph()
const editorStore = createEditorStore(initialGraph)
setActiveEditorStore(editorStore)
provideEditor(editorStore as any)

const store = ref<EditorStore>(editorStore)
const initialized = ref(true)

function handleSave() {
  const data = serializeSceneGraph(store.value.graph)
  props.onSave?.(data)
  emit('save', data)
}

onMounted(() => {
  useKeyboard()
})

watch(() => props.sceneData, (newData) => {
  if (!newData) return
  const graph = deserializeSceneGraph(newData)
  const newStore = createEditorStore(graph)
  setActiveEditorStore(newStore)
  store.value = newStore
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
  <div v-if="initialized" class="full-page-editor">
    <div class="full-page-editor__top-bar">
      <Toolbar />
      <button class="full-page-editor__save-btn" @click="handleSave" title="Save">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17,21 17,13 7,13 7,21"/>
          <polyline points="7,3 7,8 15,8"/>
        </svg>
        Save
      </button>
    </div>
    <SplitterGroup direction="horizontal" class="full-page-editor__body">
      <SplitterPanel :default-size="20" :min-size="15" class="full-page-editor__layers">
        <LayersPanel />
      </SplitterPanel>
      <SplitterResizeHandle class="full-page-editor__resize-handle" />
      <SplitterPanel :default-size="55" :min-size="30" class="full-page-editor__canvas">
        <EditorCanvas />
      </SplitterPanel>
      <SplitterResizeHandle class="full-page-editor__resize-handle" />
      <SplitterPanel :default-size="25" :min-size="15" class="full-page-editor__properties">
        <PropertiesPanel />
      </SplitterPanel>
    </SplitterGroup>
  </div>
  <div v-else class="full-page-editor__loading">
    <div class="full-page-editor__spinner" />
    <span>Loading editor...</span>
  </div>
  </TooltipProvider>
</template>

<style scoped>
.full-page-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  color: #e0e0e0;
}

.full-page-editor__top-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.full-page-editor__save-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: none;
  background: #2a6;
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.full-page-editor__save-btn:hover {
  background: #3b7;
}

.full-page-editor__body {
  flex: 1;
  overflow: hidden;
}

.full-page-editor__layers,
.full-page-editor__properties {
  overflow-y: auto;
}

.full-page-editor__canvas {
  position: relative;
}

.full-page-editor__resize-handle {
  width: 4px;
  background: #333;
  cursor: col-resize;
}

.full-page-editor__resize-handle:hover {
  background: #555;
}

.full-page-editor__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: #888;
  font-size: 12px;
}

.full-page-editor__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #444;
  border-top-color: #888;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
