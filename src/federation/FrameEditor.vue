<script setup lang="ts">
/**
 * FrameEditor - Editable editor scoped to a single FRAME.
 * provideEditor() MUST be called synchronously in setup() for child inject() to work.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { provideEditor } from '@open-pencil/vue'
import { SceneGraph, computeAllLayouts } from '@open-pencil/core'
import { createEditorStore, setActiveEditorStore } from '@/stores/editor'
import type { EditorStore } from '@/stores/editor'
import {
  deserializeSceneGraph,
  serializeSceneGraph,
  fixOrphanedFrames,
  type SerializedSceneGraph
} from './bridge/serialize'

import { TooltipProvider } from 'reka-ui'
import EditorCanvas from '@/components/EditorCanvas.vue'
import Toolbar from '@/components/Toolbar.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'

const props = defineProps<{
  sceneData: SerializedSceneGraph
  frameId: string
  onSave?: (data: SerializedSceneGraph) => void
  onPull?: () => void
}>()

const emit = defineEmits<{
  save: [data: SerializedSceneGraph]
}>()

// Build a fully-prepared editor store from serialized scene data. Used by both
// setup() and watch(sceneData) so an in-place refresh after Save & Sync runs the
// SAME pipeline as the initial mount — previously the watch skipped
// fixOrphanedFrames + computeAllLayouts, so a saved frame rebuilt without
// auto-layout looked "reverted/broken" until a tab switch forced a full remount.
function buildStore(sceneData: SerializedSceneGraph | null): EditorStore {
  const graph = sceneData ? deserializeSceneGraph(sceneData) : new SceneGraph()
  // Fix orphaned frames: AI may set parentId to "currentPage" or place frames as root children
  fixOrphanedFrames(graph)
  // Compute auto-layouts so frames have correct height (Hug children).
  // Wrapped in try-catch: component-based wireframes may have incomplete layout data.
  const pages = graph.getPages()
  if (pages.length > 0) {
    try {
      computeAllLayouts(graph, pages[0].id)
    } catch (e) {
      console.warn('[FrameEditor] computeAllLayouts failed (non-fatal):', e)
    }
  }
  return createEditorStore(graph)
}

// Create editor store synchronously in setup() — required for provideEditor/inject chain
const editorStore = buildStore(props.sceneData)
setActiveEditorStore(editorStore)

const store = ref<EditorStore>(editorStore)
const initialized = ref(!!props.sceneData)

// Provide a STABLE proxy that always forwards to the current `store.value`.
// watch(sceneData) swaps store.value for a freshly-deserialized store after
// Save & Sync; with this proxy, useEditor() consumers (Toolbar, PropertiesPanel,
// and the headless canvas/text primitives) resolve to the NEW store
// automatically instead of holding the one injected at setup() time. That
// stale inject is why the host previously had to remount the whole editor
// (visible flash) on every save. Mirrors the global storeProxy in stores/editor.
const editorProxy = new Proxy({} as EditorStore, {
  get(_t, prop) {
    return Reflect.get(store.value as unknown as object, prop)
  },
  set(_t, prop, value) {
    return Reflect.set(store.value as unknown as object, prop, value)
  }
})
provideEditor(editorProxy as any)

// Show properties panel when a node is selected (double-click)
const hasSelection = computed(() => {
  void store.value.state.sceneVersion // reactivity trigger
  return store.value.state.selectedIds.size > 0
})

// Navigate to the target frame's page and select it
function navigateToFrame(s: EditorStore, frameId: string) {
  const pages = s.graph.getPages()
  for (const page of pages) {
    if (page.childIds.includes(frameId)) {
      s.state.currentPageId = page.id
      break
    }
  }
  // Also check root children (AI may place frames as root children)
  if (!pages.some(p => p.childIds.includes(frameId))) {
    const root = s.graph.getNode(s.graph.rootId)
    if (root) {
      for (const cid of root.childIds) {
        const child = s.graph.getNode(cid)
        if (child?.type === 'CANVAS') {
          // Register frame as child of this page
          if (!child.childIds.includes(frameId)) {
            child.childIds.push(frameId)
            const frame = s.graph.getNode(frameId)
            if (frame) frame.parentId = child.id
          }
          s.state.currentPageId = child.id
          break
        }
      }
    }
  }
  s.state.selectedIds = new Set([frameId])
}

// Track teardown so async callbacks (ResizeObserver, setTimeout, etc.) don't
// touch the destroyed editor instance and trigger Vue "Cannot set properties
// of null (setting '__vnode')" / "Cannot destructure 'type' of vnode" errors
// when this component unmounts mid-task (typical when the user opens one UI's
// Design tab and then a different UI's Design tab in quick succession).
let unmounted = false
let zoomTimeoutId: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null

onBeforeUnmount(() => {
  unmounted = true
  if (zoomTimeoutId !== null) {
    clearTimeout(zoomTimeoutId)
    zoomTimeoutId = null
  }
  if (resizeObserver) {
    try { resizeObserver.disconnect() } catch (_e) { /* noop */ }
    resizeObserver = null
  }
})

onMounted(() => {
  if (props.frameId) {
    navigateToFrame(editorStore, props.frameId)
  }
  // Wait for canvas to get its actual size, then manually set viewport
  const canvasEl = document.querySelector('[data-test-id="canvas-element"]')
  if (canvasEl) {
    const doZoom = () => {
      if (unmounted) return
      const frame = editorStore.graph.getNode(props.frameId)
      if (!frame) return
      const rect = canvasEl.getBoundingClientRect()
      const viewW = rect.width
      const viewH = rect.height
      if (viewW < 10 || viewH < 10) return

      const padding = 40
      const fx = frame.x ?? 0
      const fy = frame.y ?? 0
      const fw = frame.width ?? 400
      const fh = frame.height ?? 300

      const zoom = Math.min(viewW / (fw + padding * 2), viewH / (fh + padding * 2), 1)
      editorStore.state.zoom = zoom
      editorStore.state.panX = (viewW - fw * zoom) / 2 - fx * zoom
      editorStore.state.panY = (viewH - fh * zoom) / 2 - fy * zoom
      editorStore.requestRepaint()
    }
    resizeObserver = new ResizeObserver((entries) => {
      if (unmounted) return
      for (const entry of entries) {
        if (entry.contentRect.height > 200) {
          if (resizeObserver) {
            try { resizeObserver.disconnect() } catch (_e) {}
            resizeObserver = null
          }
          doZoom()
        }
      }
    })
    resizeObserver.observe(canvasEl)
    zoomTimeoutId = setTimeout(() => {
      zoomTimeoutId = null
      if (unmounted) return
      if (resizeObserver) {
        try { resizeObserver.disconnect() } catch (_e) {}
        resizeObserver = null
      }
      doZoom()
    }, 3000)
  }
})

function handleSave() {
  const data = serializeSceneGraph(store.value.graph)
  props.onSave?.(data)
  emit('save', data)
}

watch(() => props.sceneData, (newData) => {
  if (unmounted || !newData) return
  const prev = store.value
  // Same full pipeline as setup() (fixOrphanedFrames + computeAllLayouts) so an
  // in-place refresh renders identically to a remount.
  const newStore = buildStore(newData)
  // Preserve the user's current viewport. Rebuilding the store would otherwise
  // snap zoom/pan back to default on every save (round-trip echo) — a jarring
  // regression once we stopped remounting.
  newStore.state.zoom = prev.state.zoom
  newStore.state.panX = prev.state.panX
  newStore.state.panY = prev.state.panY
  // Continue the version counters from the previous store instead of letting the
  // fresh store restart them at 0. The canvas renderer caches its scene picture
  // keyed by sceneVersion (SkiaRenderer.scenePictureVersion); a reset counter
  // can collide with that cached version, so the renderer redraws the STALE
  // picture until some later graph mutation bumps the version — the "reverts
  // after save until I nudge a node" symptom. Carrying forward + 1 guarantees a
  // strictly-newer version → cache invalidation → the saved content draws now.
  newStore.state.sceneVersion = prev.state.sceneVersion + 1
  newStore.state.renderVersion = prev.state.renderVersion + 1
  setActiveEditorStore(newStore)
  store.value = newStore
  initialized.value = true
  if (props.frameId) navigateToFrame(newStore, props.frameId)
  // The canvas/headless primitives reach the store through stable proxies
  // (storeProxy / editorProxy) so they now resolve to newStore in place — no
  // remount. Nudge a repaint so the freshly-deserialized graph is drawn
  // immediately rather than waiting for the next reactive tick.
  newStore.requestRepaint()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
  <div v-if="initialized" class="frame-editor">
    <div class="frame-editor__toolbar">
      <Toolbar />
      <button v-if="onPull" class="frame-editor__pull-btn" @click="onPull" title="Pull from Figma">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        </svg>
      </button>
      <button class="frame-editor__save-btn" @click="handleSave" title="Save & sync to Figma">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17,21 17,13 7,13 7,21"/>
          <polyline points="7,3 7,8 15,8"/>
        </svg>
      </button>
    </div>
    <div class="frame-editor__body">
      <div class="frame-editor__canvas">
        <EditorCanvas />
      </div>
      <div v-if="hasSelection" class="frame-editor__properties">
        <PropertiesPanel />
      </div>
    </div>
  </div>
  <div v-else class="frame-editor__loading">
    <div class="frame-editor__spinner" />
    <span>Loading editor...</span>
  </div>
  </TooltipProvider>
</template>

<style scoped>
/* Inject open-pencil theme variables for PropertiesPanel (Tailwind) */
.frame-editor {
  --color-panel: #2a2a2a;
  --color-canvas: #1e1e1e;
  --color-border: #3a3a3a;
  --color-hover: #353535;
  --color-accent: #3b82f6;
  --color-surface: #e0e0e0;
  --color-muted: #888888;
  --color-input: #1e1e1e;
  --color-component: #9747ff;

  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--color-canvas);
  color: var(--color-surface);
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 13px;
}

.frame-editor__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border, #333);
  background: var(--color-panel, #2a2a2a);
  flex-shrink: 0;
}

.frame-editor__pull-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--color-accent, #3b82f6);
  color: white;
  border-radius: 6px;
  cursor: pointer;
}

.frame-editor__pull-btn:hover {
  opacity: 0.85;
}

.frame-editor__save-btn {
  margin-left: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: #2a6;
  color: white;
  border-radius: 6px;
  cursor: pointer;
}

.frame-editor__save-btn:hover {
  background: #3b7;
}

.frame-editor__body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.frame-editor__canvas {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.frame-editor__properties {
  width: 260px;
  border-left: 1px solid var(--color-border, #333);
  overflow-y: auto;
  flex-shrink: 0;
  background: var(--color-panel, #2a2a2a);
  color: var(--color-surface, #e0e0e0);
  font-size: 12px;
}

/* Override stray light-mode styles from Tailwind/reka-ui inside the properties panel */
.frame-editor__properties :deep(input),
.frame-editor__properties :deep(select) {
  background: var(--color-input, #1e1e1e);
  color: var(--color-surface, #e0e0e0);
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
  outline: none;
}

.frame-editor__properties :deep(input:focus),
.frame-editor__properties :deep(select:focus) {
  border-color: var(--color-accent, #3b82f6);
}

.frame-editor__properties :deep(button) {
  color: var(--color-surface, #e0e0e0);
}

.frame-editor__properties :deep(label) {
  color: var(--color-muted, #888);
  font-size: 11px;
}

/* Ensure sections have consistent dark styling */
.frame-editor__properties :deep([data-test-id="properties-panel"]) {
  background: var(--color-panel, #2a2a2a);
  border-left: none;
}

.frame-editor__properties :deep(.border-border) {
  border-color: var(--color-border, #3a3a3a);
}

.frame-editor__properties :deep(.bg-panel) {
  background: var(--color-panel, #2a2a2a);
}

.frame-editor__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: #888;
  font-size: 12px;
}

.frame-editor__spinner {
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
