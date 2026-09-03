<script setup lang="ts">
/**
 * FramePreview - Lightweight DOM-based preview of a SceneGraph frame.
 * Does NOT use CanvasKit — avoids singleton conflicts with FrameEditor.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SerializedSceneGraph } from './bridge/serialize'
import * as styles from './frameStyle'

const props = defineProps<{
  sceneData: SerializedSceneGraph
  frameId: string
  width?: number
  height?: number
}>()

const frame = computed(() => props.sceneData?.nodes?.[props.frameId] || null)

// 호출부가 크기를 주지 않으면 **컨테이너를 실제로 재서** 맞춘다.
//
// 종전에는 400×300 으로 고정돼 있었다. 인스펙터의 스테이지는 그보다 훨씬 큰데
// 미리보기는 그 안에서 400×300 만 차지했고, 그 상자를 넘는 것은 잘렸다.
const host = ref<HTMLElement | null>(null)
const measured = ref({ w: 0, h: 0 })
let ro: ResizeObserver | null = null

onMounted(() => {
  if (!host.value || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(([entry]) => {
    const r = entry.contentRect
    measured.value = { w: Math.round(r.width), h: Math.round(r.height) }
  })
  ro.observe(host.value)
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })

const boxW = computed(() => props.width ?? (measured.value.w || 400))
const boxH = computed(() => props.height ?? (measured.value.h || 300))

const scale = computed(() => {
  const f = frame.value
  if (!f) return 1
  const fw = f.width || 1440
  const fh = f.height || 900
  return Math.min(boxW.value / fw, boxH.value / fh, 1)
})

const { getChildren: children, nodeStyle, textStyle } = styles
const getChildren = (nodeId: string) => children(props.sceneData, nodeId)
</script>

<template>
  <div
    ref="host"
    class="frame-preview"
    :style="width || height ? { width: `${width ?? 400}px`, height: `${height ?? 300}px` } : undefined"
  >
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
.frame-preview { overflow: hidden; background: #f5f5f5; border-radius: 6px; position: relative;
  width: 100%; height: 100%; }
.frame-preview__viewport { position: absolute; top: 0; left: 0; }
.frame-preview__error { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #ff4d4f; font-size: 12px; }
</style>
