# OpenPencil AI 디자인 생성 시스템 아키텍처

## 개요

OpenPencil의 AI 디자인 생성 시스템은 **자연어 요청 → LLM 판단 → Tool 호출 루프 → Scene Graph 변형 → 캔버스 렌더링**의 파이프라인으로 동작한다. 사전 정의된 UI 컴포넌트(버튼, 카드 등)는 없으며, AI가 프리미티브(Frame, Text, Rectangle 등)를 조합하여 모든 디자인을 처음부터 생성한다.

---

## 1. 전체 데이터 흐름

```
사용자: "뉴스 앱 메인 화면 만들어줘"
        │
        ▼
┌─────────────────────────────────┐
│  ChatPanel (⌘J)                 │
│  src/components/ChatPanel.vue   │
└──────────┬──────────────────────┘
           │ submitUserMessage()
           ▼
┌─────────────────────────────────┐
│  useAIChat() 컴포저블           │
│  src/composables/use-chat.ts    │
│                                 │
│  - AI 프로바이더 선택 (OpenAI 등)│
│  - API 키 관리 (localStorage)   │
│  - ToolLoopAgent 생성           │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  ToolLoopAgent (Vercel AI SDK)  │
│                                 │
│  - System Prompt (디자인 규칙)  │
│  - 30개 Core Tools (스키마)     │
│  - 최대 50 스텝 루프            │
└──────────┬──────────────────────┘
           │ AI 모델이 tool_call 결정
           ▼
┌─────────────────────────────────┐
│  Tool Execution Layer           │
│  src/ai/tools.ts                │
│                                 │
│  1. onBeforeExecute: 스냅샷     │
│  2. FigmaAPI로 tool.execute()   │
│  3. onAfterExecute:             │
│     - 폰트 로딩                 │
│     - 레이아웃 계산             │
│     - Undo 스택 기록            │
│     - 렌더러 갱신               │
│  4. 결과를 AI 모델에 반환       │
└──────────┬──────────────────────┘
           │ AI가 결과 확인 후
           │ 추가 tool_call 또는 완료
           ▼
┌─────────────────────────────────┐
│  Scene Graph 변형 완료          │
│  캔버스에 디자인 표시           │
└─────────────────────────────────┘
```

---

## 2. 핵심 컴포넌트 상세

### 2.1 Tool Definition 시스템

모든 도구는 `packages/core/src/tools/schema.ts`의 `defineTool()`로 한 번만 정의되며, 어댑터를 통해 AI Chat(Valibot), MCP(Zod), CLI(Citty)에서 동일하게 사용된다.

```typescript
// packages/core/src/tools/schema.ts
export interface ToolDef {
  name: string                    // 도구 식별자
  description: string             // LLM에게 보여지는 설명
  mutates?: boolean               // Scene Graph 변형 여부
  params: Record<string, ParamDef>  // 파라미터 스키마
  execute: (figma: FigmaAPI, args) => unknown  // 실행 함수
}

// 사용 예: packages/core/src/tools/create.ts
export const render = defineTool({
  name: 'render',
  mutates: true,
  description: 'Render JSX to design nodes...',
  params: {
    jsx:        { type: 'string', required: true, description: 'JSX string' },
    replace_id: { type: 'string', description: '대체할 노드 ID' },
    parent_id:  { type: 'string', description: '부모 노드 ID' },
    x:          { type: 'number', description: 'X 좌표' },
    y:          { type: 'number', description: 'Y 좌표' },
  },
  execute: async (figma, args) => {
    const { renderJSX } = await import('../design-jsx/render.js')
    // JSX → Scene Graph 노드 생성
    return renderJSX(figma.graph, args.jsx, { parentId, x, y })
  }
})
```

### 2.2 AI Adapter (Tool → LLM 연결)

`toolsToAI()` 함수가 ToolDef 배열을 Vercel AI SDK의 `tool()` 객체로 변환한다.

```typescript
// packages/core/src/tools/ai-adapter.ts
export function toolsToAI(
  tools: ToolDef[],
  options: AIAdapterOptions,
  deps: { v, valibotSchema, tool }
): Record<string, AITool>

// 변환 과정:
// 1. ParamDef → Valibot 스키마 (타입 검증)
// 2. execute() 래핑:
//    - 실행 전/후 스냅샷 (Undo 지원)
//    - 변경된 노드 ID 추출 → 시각적 플래시 피드백
//    - 남은 스텝 경고 (5스텝 이하 시)
//    - 중복 호출 감지
//    - 에러 핸들링
```

### 2.3 FigmaAPI (Scene Graph 추상화)

도구들이 디자인을 조작할 때 사용하는 API 레이어. Figma Plugin API와 유사한 인터페이스를 제공한다.

```typescript
// packages/core/src/figma-api/
class FigmaAPI {
  readonly graph: SceneGraph        // 씬 그래프 직접 참조

  // 노드 생성
  createFrame(): FigmaNodeProxy
  createRectangle(): FigmaNodeProxy
  createText(): FigmaNodeProxy
  createEllipse(): FigmaNodeProxy

  // 노드 조회
  getNodeById(id: string): FigmaNodeProxy | null

  // 페이지 컨텍스트
  get currentPageId(): string
}

// FigmaNodeProxy — 노드 프로퍼티 getter/setter
node.x = 100
node.y = 200
node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
node.appendChild(child)
node.resize(300, 200)
```

---

## 3. 디자인 생성의 핵심: `render` 도구와 Design JSX

### 3.1 JSX → 디자인 노드 파이프라인

AI가 디자인을 생성할 때 가장 핵심적인 도구는 `render`이다. JSX 문자열을 받아 Scene Graph 노드로 변환한다.

```
JSX 문자열
  │  "< Frame flex='col' gap={16} p={24} bg='#FFF' rounded={16}>..."
  │
  ▼
buildComponent() — packages/core/src/design-jsx/render.ts
  │  sucrase로 JSX → JavaScript 변환
  │  프리미티브 매핑: Frame='frame', Text='text', ...
  │
  ▼
React.createElement() — packages/core/src/design-jsx/mini-react.ts
  │  경량 React 구현으로 Virtual Element Tree 생성
  │
  ▼
resolveToTree() — packages/core/src/design-jsx/tree.ts
  │  Virtual Element → TreeNode 변환
  │
  ▼
renderTree() — packages/core/src/design-jsx/renderer.ts
  │  TreeNode → SceneGraph 노드 생성
  │  각 노드의 속성(위치, 크기, 색상, 레이아웃) 적용
  │
  ▼
Scene Graph에 노드 추가 완료
```

### 3.2 JSX에서 사용 가능한 요소

| 요소 | 용도 | 예시 |
|------|------|------|
| `Frame` | 컨테이너, 카드, 레이아웃 | `<Frame flex="col" gap={16} p={24}>` |
| `Text` | 텍스트 레이블 | `<Text size={18} weight="bold" color="#111">제목</Text>` |
| `Rectangle` | 사각형, 이미지 플레이스홀더 | `<Rectangle w={100} h={100} bg="#EEE" rounded={8} />` |
| `Ellipse` | 원, 타원 | `<Ellipse w={48} h={48} bg="#3B82F6" />` |
| `Line` | 선 | `<Line w={200} stroke="#CCC" />` |
| `Star` | 별 | `<Star w={24} h={24} points={5} bg="#FFD700" />` |
| `Polygon` | 다각형 | `<Polygon w={30} h={30} points={6} bg="#333" />` |
| `Icon` | 벡터 아이콘 (Iconify) | `<Icon name="lucide:heart" size={20} color="#F00" />` |
| `Group` | 그룹 | `<Group name="Header">...</Group>` |
| `Section` | 섹션 | `<Section name="Hero">...</Section>` |
| `Component` | 컴포넌트 정의 | `<Component name="Button">...</Component>` |

### 3.3 JSX Props 전체 목록

```jsx
// 위치 (auto-layout 바깥에서만)
x={N} y={N}

// 크기
w={N}        // 고정 폭 (px)
h={N}        // 고정 높이 (px)
w="hug"      // 내용에 맞게 축소 (기본값)
w="fill"     // 부모에 맞게 확장 (flex 부모 필요)
grow={1}     // flex-grow (부모가 고정 크기일 때)
minW={N} maxW={N}

// Auto Layout (Flexbox)
flex="row" | "col"         // 방향
gap={N}                    // 자식 간격
wrap                       // 줄바꿈
justify="start"|"center"|"end"|"between"
items="start"|"center"|"end"|"stretch"
p={N} px={N} py={N} pt={N} pr={N} pb={N} pl={N}  // 패딩

// CSS Grid
grid columns="1fr 1fr" rows="1fr"
columnGap={N} rowGap={N}
colStart={N} rowStart={N} colSpan={N} rowSpan={N}

// 외관
bg="#RRGGBB"              // 배경색
stroke="#hex"              // 테두리색
strokeWidth={N}            // 테두리 두께
rounded={N}                // 모서리 반경
roundedTL={N} roundedTR={N} roundedBL={N} roundedBR={N}
opacity={0-1}
rotate={deg}
overflow="hidden"
shadow="offX offY blur #color"
blur={N}

// 텍스트 전용 (<Text>)
size={N}                   // 폰트 크기
weight="bold"|"medium"|{N} // 폰트 두께
color="#hex"               // 텍스트 색상 (필수!)
font="Inter"               // 폰트 패밀리
textAlign="left"|"center"|"right"
lineHeight={N}             // 행간 (px)
letterSpacing={N}          // 자간 (px)
maxLines={N}               // 최대 줄 수
truncate                   // 한 줄 말줄임
textCase="upper"|"lower"|"title"
```

---

## 4. 사전 정의된 컴포넌트는 없다

OpenPencil AI에는 "버튼 컴포넌트", "카드 컴포넌트" 같은 **프리디파인드 템플릿이 없다**. 대신 AI가 프리미티브를 조합하여 모든 것을 처음부터 생성한다.

예를 들어 "버튼"은:

```jsx
// AI가 생성하는 버튼의 예
<Frame name="Button" flex="row" items="center" justify="center"
       gap={8} px={20} py={12} bg="#3B82F6" rounded={10}>
  <Icon name="lucide:plus" size={16} color="#FFF" />
  <Text size={14} weight="bold" color="#FFFFFF">새 항목</Text>
</Frame>
```

System Prompt(`src/ai/system-prompt.md`)가 디자인 규칙과 패턴을 가르치는 역할을 한다:
- 모서리 반경: 카드 16-24, 버튼 8-12, 칩 4-8
- 간격: 4px 그리드 (4, 8, 12, 16, 20, 24, 32, 48)
- 타이포그래피: 6-8단계 (Display 32-40 → Caption 12-13)
- 색상 계층: primary #111827, secondary #6B7280, tertiary #9CA3AF

---

## 5. AI의 다단계 생성 워크플로우

System Prompt가 강제하는 4단계 워크플로우:

### Phase 1: Plan (계획, 텍스트만)

```
AI 응답:
1. NavBar 1440×56 dark background
2. Hero section 1440×500 with gradient
3. 뉴스 카드 그리드 2×2
4. 사이드바 인기 피드
5. Footer
```

### Phase 2: Skeleton (뼈대 렌더링)

```typescript
// AI가 호출하는 tool:
render({
  jsx: `
    <Frame name="NewsApp" w={1440} h={900} flex="col" bg="#F8FAFC">
      <Frame name="NavBar" w="fill" h={56} bg="#1E293B" />
      <Frame name="Hero" w="fill" h={300} bg="#E2E8F0" />
      <Frame name="Content" w="fill" grow={1} flex="row" gap={24} px={48}>
        <Frame name="MainGrid" grow={1} bg="#F1F5F9" />
        <Frame name="Sidebar" w={320} bg="#F1F5F9" />
      </Frame>
      <Frame name="Footer" w="fill" h={80} bg="#1E293B" />
    </Frame>
  `
})

// 구조 검증:
describe({ id: "0:1" })
```

### Phase 3: Fill Content (내용 채우기)

```typescript
// NavBar를 실제 내용으로 교체:
render({
  replace_id: "0:2",  // NavBar 스켈레톤의 ID
  jsx: `
    <Frame name="NavBar" w="fill" h={56} flex="row" items="center"
           justify="between" px={32} bg="#1E293B">
      <Text size={20} weight="bold" color="#FFFFFF">NewsApp</Text>
      <Frame flex="row" gap={24}>
        <Text size={14} color="#94A3B8">홈</Text>
        <Text size={14} color="#94A3B8">정치</Text>
        <Text size={14} color="#94A3B8">경제</Text>
      </Frame>
    </Frame>
  `
})

// 렌더 후 항상 검증:
describe({ id: "0:2" })

// 문제 발견 시 일괄 수정:
batch_update({
  operations: '[
    {"id": "0:5", "props": {"spacing": 8}},
    {"id": "0:6", "props": {"sizing_horizontal": "FILL"}}
  ]'
})
```

### Phase 4: Polish (마무리)

```typescript
// 스톡 사진 일괄 배치:
stock_photo({
  requests: '[
    {"id": "0:30", "query": "technology news"},
    {"id": "0:45", "query": "business meeting"}
  ]'
})

// 최종 검증:
describe({ id: "0:1", depth: 1 })

// 뷰포트 맞춤:
viewport_zoom_to_fit()
```

---

## 6. 전체 도구 목록 (90개)

### CORE_TOOLS (20개) — 기본 세션의 90%+ 커버

| 카테고리 | 도구 | 설명 |
|----------|------|------|
| **읽기** | `get_selection` | 선택된 노드 정보 |
| | `getNode` | ID로 노드 조회 (깊이 설정 가능) |
| | `findNodes` | 이름/타입으로 노드 검색 |
| | `getJsx` | 노드의 JSX 표현 추출 |
| **생성** | `render` | JSX → 디자인 노드 (핵심 도구) |
| **수정** | `updateNode` | 위치/크기/투명도/반경/가시성 일괄 변경 |
| | `setLayout` | Auto Layout(flex) 설정 |
| | `setLayoutChild` | 자식별 레이아웃 제약 |
| | `setRadius` | 모서리 반경 (개별 코너 지원) |
| | `setFill` | 단색/그라디언트 채우기 |
| | `setStroke` | 테두리 스타일 |
| | `setText` | 텍스트 내용 및 속성 |
| | `setTextProperties` | 폰트 크기/두께/패밀리 |
| **구조** | `deleteNode` | 노드 삭제 |
| | `reparentNode` | 부모 변경 |
| | `nodeResize` | 크기 조절 |
| | `batchUpdate` | 여러 노드 일괄 수정 |
| **유틸** | `stockPhoto` | Pexels 이미지 배치 (병렬) |
| | `describe` | 디자인 구조 분석 + 문제 감지 |
| | `calc` | 레이아웃 수치 계산 |
| | `evalCode` | JavaScript 표현식 실행 |
| | `viewportZoomToFit` | 캔버스 자동 맞춤 |

### EXTENDED_TOOLS (57개) — 고급 기능

| 카테고리 | 도구들 |
|----------|--------|
| **읽기 (고급)** | `getPageTree`, `getCurrentPage`, `listPages`, `selectNodes`, `queryNodes` (XPath), `getComponents`, `switchPage`, `pageBounds`, `listFonts`, `diffJsx` |
| **생성 (고급)** | `createShape`, `searchIconsTool`, `insertIcon`, `fetchIconsTool`, `createComponent`, `createInstance`, `createPage`, `createVector`, `createSlice` |
| **수정 (고급)** | `setEffects` (그림자/블러), `setOpacity`, `setFont`, `setVisible`, `setConstraints`, `setRotation`, `setMinMax`, `setFontRange`, `setTextResize`, `setBlend`, `setLocked`, `setStrokeAlign`, `setImageFill` |
| **구조 (고급)** | `cloneNode`, `nodeMove`, `renameNode`, `groupNodes`, `ungroupNode`, `flattenNodes`, `nodeToComponent`, `nodeBounds`, `nodeAncestors`, `nodeChildren`, `nodeTree`, `nodeBindings`, `nodeReplaceWith`, `arrangeNodes` |
| **변수** | `listVariables`, `listCollections`, `getVariable`, `findVariables`, `createVariable`, `setVariable`, `deleteVariable`, `bindVariable`, `getCollection`, `createCollection`, `deleteCollection` |
| **벡터/내보내기** | `booleanUnion/Subtract/Intersect/Exclude`, `pathGet/Set/Scale/Flip/Move`, `viewportGet/Set`, `exportSvg`, `exportImage` |
| **분석** | `analyzeColors`, `analyzeTypography`, `analyzeSpacing`, `analyzeClusters`, `diffCreate`, `diffShow` |
| **코드 생성** | `designToTokens`, `designToComponentMap` |

---

## 7. `describe` 도구: AI의 "눈"

`describe`는 AI가 자신이 만든 디자인을 검증하는 핵심 도구다. 구조 트리와 함께 **문제점을 자동 감지**한다:

```
describe({ id: "0:1" }) 의 반환 예:

[frame] "Card" 320×auto flex=col gap=16 p=24 bg=#FFF rounded=16
  [text] "제목" 18/bold #111827
  [text] "설명 텍스트..." 14/regular #6B7280 w=fill
  ⚠ [frame] "Actions" flex=row — children overflow parent
  [rectangle] "Image" 320×200 — ⚠ no fill (invisible)
```

감지하는 문제:
- `overflows` — 자식이 부모를 넘침
- `collapses to zero` — 크기가 0으로 축소
- `invisible` — 채우기/텍스트 색상 없음
- `dark on dark` — 배경과 텍스트 대비 부족
- `gap not on 8px grid` — 간격 규칙 위반
- `grow inside HUG parent` — 무효한 레이아웃 조합

---

## 8. SDK 사용법: 외부에서 도구 활용하기

### 8.1 MCP Server (Claude Code, Cursor 등)

```bash
# 설치
bun add -g @open-pencil/mcp

# Claude Code 설정 (~/.claude.json)
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

MCP 서버는 ALL_TOOLS(90개)를 모두 노출하며, 외부 AI 에이전트가 동일한 도구를 사용할 수 있다.

### 8.2 프로그래밍 방식 (Node.js/Bun)

```typescript
import { renderJSX } from '@open-pencil/core'
import { parseFigFileSync, writeFigFile } from '@open-pencil/core'

// 1. .fig 파일 로드
const graph = parseFigFileSync(await readFile('design.fig'))

// 2. JSX로 디자인 노드 생성
const result = await renderJSX(graph, `
  <Frame name="LoginForm" w={400} h="hug" flex="col" gap={16} p={32}
         bg="#FFFFFF" rounded={16} shadow="0 4 24 #00000015">
    <Text size={24} weight="bold" color="#111827">로그인</Text>
    <Frame name="EmailField" w="fill" h={48} flex="row" items="center"
           px={16} bg="#F9FAFB" rounded={8} stroke="#E5E7EB" strokeWidth={1}>
      <Text size={14} color="#9CA3AF">이메일 주소</Text>
    </Frame>
    <Frame name="SubmitBtn" w="fill" h={48} flex="row" items="center"
           justify="center" bg="#3B82F6" rounded={10}>
      <Text size={14} weight="bold" color="#FFFFFF">계속</Text>
    </Frame>
  </Frame>
`, { parentId: pageId, x: 100, y: 100 })

// 3. 파일 저장
await writeFigFile(graph, 'design.fig')
```

### 8.3 CLI에서 실행

```bash
# eval로 Figma Plugin API 직접 사용
open-pencil eval design.fig -c "
  const frame = figma.createFrame()
  frame.resize(400, 300)
  frame.name = 'MyCard'
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
" -w

# 실행 중인 앱에 연결하여 조작
open-pencil eval -c "figma.currentPage.children.length"
```

### 8.4 커스텀 AI 에이전트 구축

```typescript
import { CORE_TOOLS, ALL_TOOLS, toolsToAI } from '@open-pencil/core'
import { tool } from 'ai'
import { valibotSchema } from '@ai-sdk/valibot'
import * as v from 'valibot'

// 도구를 Vercel AI SDK 형식으로 변환
const aiTools = toolsToAI(
  CORE_TOOLS,  // 또는 ALL_TOOLS
  {
    getFigma: () => myFigmaAPIInstance,
    onBeforeExecute: (def) => { /* 스냅샷 */ },
    onAfterExecute: async (def) => { /* 레이아웃 재계산 */ },
    onFlashNodes: (ids) => { /* UI 피드백 */ },
    getStepBudget: () => ({ current: 0, max: 50 })
  },
  { v, valibotSchema, tool }
)

// Vercel AI SDK의 generateText/streamText와 함께 사용
const result = await generateText({
  model: openai('gpt-4o'),
  tools: aiTools,
  system: systemPrompt,
  prompt: '로그인 화면을 만들어줘',
  maxSteps: 50
})
```

---

## 9. 아키텍처 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Tool-centric** | 모든 디자인 조작은 도구를 통해서만 수행. UI 직접 조작과 AI 조작이 동일한 경로 |
| **JSX-first** | `render` 도구로 선언적 디자인 생성. 개별 도형 생성보다 효율적 |
| **Schema-agnostic** | ToolDef 한 번 정의 → Valibot(AI), Zod(MCP), Citty(CLI) 어댑터 자동 생성 |
| **No templates** | 프리디파인드 컴포넌트 없음. AI가 프리미티브로 모든 것을 구성 |
| **Snapshot undo** | 매 mutating tool 실행 전후 페이지 스냅샷 → 완전한 실행취소 지원 |
| **Step budgeting** | 50스텝 제한으로 무한 루프 방지. 5스텝 이하 시 경고 |
| **Describe-verify** | 매 render 후 describe로 구조 검증 → 문제 발견 시 batch_update로 수정 |

---

## 10. 주요 파일 참조

| 파일 | 역할 |
|------|------|
| `src/composables/use-chat.ts` | AI 채팅 오케스트레이션, 프로바이더 관리 |
| `src/ai/tools.ts` | 도구 실행 컨텍스트 (스냅샷, 폰트, Undo) |
| `src/ai/system-prompt.md` | AI 시스템 프롬프트 (573줄 디자인 규칙) |
| `packages/core/src/tools/schema.ts` | ToolDef 타입 및 defineTool() |
| `packages/core/src/tools/registry.ts` | CORE_TOOLS, EXTENDED_TOOLS, ALL_TOOLS |
| `packages/core/src/tools/ai-adapter.ts` | ToolDef → Vercel AI SDK 변환 |
| `packages/core/src/tools/create.ts` | render, createShape 등 생성 도구 |
| `packages/core/src/tools/modify.ts` | setFill, setLayout 등 수정 도구 |
| `packages/core/src/tools/describe.ts` | 디자인 분석 + 문제 감지 |
| `packages/core/src/tools/structure.ts` | 노드 구조 조작 도구 |
| `packages/core/src/design-jsx/render.ts` | JSX → Scene Graph 변환 |
| `packages/core/src/design-jsx/renderer.ts` | TreeNode → SceneNode 생성 |
| `packages/core/src/figma-api/` | Figma Plugin API 호환 레이어 |
| `packages/mcp/src/server.ts` | MCP 서버 (외부 AI 에이전트용) |
