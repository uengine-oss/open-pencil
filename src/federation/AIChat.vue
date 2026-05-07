<script setup lang="ts">
/**
 * AIChat - Standalone AI chat panel for design generation.
 * Wraps open-pencil's ChatPanel with an isolated editor context.
 * Supports initialPrompt for auto-triggering AI generation on mount.
 */
import { markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { provideEditor } from '@open-pencil/vue'
import { createEditorStore, setActiveEditorStore } from '@/stores/editor'
import type { EditorStore } from '@/stores/editor'
import { SceneGraph } from '@open-pencil/core'
import { useAIChat } from '@/composables/use-chat'
import {
  deserializeSceneGraph,
  serializeSceneGraph,
  type SerializedSceneGraph
} from './bridge/serialize'

import ChatPanel from '@/components/ChatPanel.vue'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'

const props = defineProps<{
  sceneData?: SerializedSceneGraph
  onUpdate?: (data: SerializedSceneGraph) => void
  onComplete?: (data: SerializedSceneGraph) => void
  initialPrompt?: string
  apiKey?: string
  provider?: string
}>()

const emit = defineEmits<{
  update: [data: SerializedSceneGraph]
  complete: [data: SerializedSceneGraph]
}>()

// Create editor store synchronously in setup() for provideEditor/inject chain
const initialGraph = props.sceneData ? deserializeSceneGraph(props.sceneData) : new SceneGraph()
const editorStore = createEditorStore(initialGraph)
setActiveEditorStore(editorStore)
provideEditor(editorStore as any)

const store = ref<EditorStore>(editorStore)
const initialized = ref(true)
const generating = ref(false)
let changeCheckInterval: ReturnType<typeof setInterval> | null = null

function setupEditor() {
  // Configure AI provider if provided
  if (props.provider) {
    localStorage.setItem('open-pencil:ai-provider', props.provider)
    if (props.apiKey) {
      localStorage.setItem(`open-pencil:ai-key:${props.provider}`, props.apiKey)
    }
  } else if (props.apiKey) {
    const currentProvider = localStorage.getItem('open-pencil:ai-provider') || 'openrouter'
    localStorage.setItem(`open-pencil:ai-key:${currentProvider}`, props.apiKey)
  }

  // Watch for scene changes and emit updates
  let lastVersion = editorStore.state.sceneVersion
  changeCheckInterval = setInterval(() => {
    if (editorStore.state.sceneVersion !== lastVersion) {
      lastVersion = editorStore.state.sceneVersion
      const data = serializeSceneGraph(editorStore.graph)
      props.onUpdate?.(data)
      emit('update', data)
    }
  }, 1000)
}

function cleanup() {
  if (changeCheckInterval) {
    clearInterval(changeCheckInterval)
    changeCheckInterval = null
  }
}

async function autoSendPrompt() {
  if (!props.initialPrompt || !store.value) return

  generating.value = true
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 500))

  try {
    const { ensureChat, isConfigured, providerID, modelID, apiKey } = useAIChat()

    console.log('[AIChat] AI config check:', {
      isConfigured: isConfigured.value,
      provider: providerID.value,
      model: modelID.value,
      hasKey: !!apiKey.value,
      keyLen: apiKey.value?.length
    })

    if (!isConfigured.value) {
      console.error('[AIChat] AI not configured. localStorage state:', {
        provider: localStorage.getItem('open-pencil:ai-provider'),
        model: localStorage.getItem('open-pencil:ai-model'),
        hasOpenaiKey: !!localStorage.getItem('open-pencil:ai-key:openai'),
        hasOpenrouterKey: !!localStorage.getItem('open-pencil:ai-key:openrouter')
      })
      generating.value = false
      // Still emit complete with whatever we have so the panel closes
      if (store.value) {
        const data = serializeSceneGraph(store.value.graph)
        props.onComplete?.(data)
        emit('complete', data)
      }
      return
    }

    const chat = await ensureChat()
    if (!chat) {
      console.error('[AIChat] ensureChat() returned null')
      generating.value = false
      return
    }

    console.log('[AIChat] Sending prompt to AI, length:', props.initialPrompt.length)
    console.log('[AIChat] Chat status before send:', chat.status)
    console.log('[AIChat] Chat messages before send:', chat.messages?.length || 0)

    // sendMessage resolves when the full agent loop (including tool calls) completes
    await chat.sendMessage({ text: props.initialPrompt })

    console.log('[AIChat] AI response complete')
    console.log('[AIChat] Chat messages after send:', chat.messages?.length || 0)
    // Log the last assistant message to see if it used tools
    const msgs = chat.messages || []
    const lastMsg = msgs[msgs.length - 1]
    if (lastMsg) {
      console.log('[AIChat] Last message role:', lastMsg.role)
      const parts = (lastMsg as any).parts || (lastMsg as any).content
      if (Array.isArray(parts)) {
        for (const p of parts.slice(0, 5)) {
          console.log('[AIChat] Part:', p.type || typeof p, typeof p === 'string' ? p.slice(0, 200) : JSON.stringify(p).slice(0, 200))
        }
      } else if (typeof parts === 'string') {
        console.log('[AIChat] Content:', parts.slice(0, 300))
      }
    }

    generating.value = false
    if (store.value) {
      const data = serializeSceneGraph(store.value.graph)
      const nodeCount = Object.keys(data.nodes).length
      console.log('[AIChat] SceneGraph after AI:', { nodeCount, rootId: data.rootId })
      props.onComplete?.(data)
      emit('complete', data)
    }
  } catch (e) {
    console.error('[AIChat] auto-send failed:', e)
    generating.value = false
    // Emit complete with current state so panel closes
    if (store.value) {
      const data = serializeSceneGraph(store.value.graph)
      props.onComplete?.(data)
      emit('complete', data)
    }
  }
}

onMounted(() => {
  setupEditor()
  if (props.initialPrompt) {
    nextTick(autoSendPrompt)
  }
})

onUnmounted(cleanup)

watch(() => props.sceneData, (newData) => {
  cleanup()
  if (newData) {
    const graph = deserializeSceneGraph(newData)
    const newStore = createEditorStore(graph)
    setActiveEditorStore(newStore)
    store.value = newStore
  }
  setupEditor()
})
</script>

<template>
  <div v-if="initialized" class="ai-chat-wrapper">
    <div v-if="generating" class="ai-chat-wrapper__status">
      <div class="ai-chat-wrapper__spinner" />
      <span>Generating wireframe design...</span>
    </div>
    <ChatPanel />
  </div>
  <div v-else class="ai-chat-wrapper__loading">
    <span>Loading AI chat...</span>
  </div>
</template>

<style scoped>
.ai-chat-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  color: #e0e0e0;
}

.ai-chat-wrapper__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  font-size: 12px;
}

.ai-chat-wrapper__status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #2a3a4a;
  color: #7cb3ff;
  font-size: 12px;
  border-bottom: 1px solid #334;
}

.ai-chat-wrapper__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #334;
  border-top-color: #7cb3ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
