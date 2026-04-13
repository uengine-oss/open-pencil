/**
 * 배달의민족 앱 디자인 생성 스크립트 (v2)
 *
 * components.fig의 모든 컴포넌트를 인스턴스로 활용하여
 * 배달의민족 스타일 모바일 앱 화면을 생성한다.
 *
 * 활용 컴포넌트:
 *   - Button/Primary  → 주문/결제 CTA
 *   - Button/Secondary → 보조 액션 (더 담기, 취소 등)
 *   - Tag             → 카테고리 태그, 프로모션 라벨
 *   - Avatar          → 리뷰어 프로필, 배달기사 프로필
 *   - Card            → 맛집 카드, 메뉴 카드, 주문 요약
 *   - Input           → 검색바, 주소 입력, 요청사항
 *   - Badge           → NEW, 할인, 인기 뱃지
 *
 * 사용법:  bun scripts/generate-baemin-app.ts
 * 출력:    output/baemin-app.fig
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import {
  parseFigFile,
  exportFigFile,
  SceneGraph,
  computeAllLayouts,
  renderJSX,
  loadFont
} from '@open-pencil/core'

// ─── 상수 ─────────────────────────────────────────────────

const BAEMIN = '#2AC1BC'
const DARK = '#1E1E1E'
const BG = '#F5F5F5'
const WHITE = '#FFFFFF'
const GRAY = '#999999'
const LGRAY = '#EEEEEE'
const ORANGE = '#FF6F00'
const YELLOW = '#FFD600'

const W = 390
const H = 844
const FONT = 'Noto Sans KR'
const GAP = 60 // 화면 간 간격

// ─── 유틸리티 ─────────────────────────────────────────────

function hex2rgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return { r, g, b, a: 1 }
}

function solidFill(hex: string) {
  return [{ type: 'SOLID' as const, color: hex2rgb(hex), opacity: 1, visible: true, blendMode: 'NORMAL' as const }]
}

/** 컴포넌트 ID → 인스턴스 생성 후 부모에 reparent */
function placeInstance(
  graph: SceneGraph,
  componentId: string,
  parentId: string,
  opts: {
    x?: number
    y?: number
    width?: number
    height?: number
    fills?: any[]
    cornerRadius?: number
    texts?: Record<string, { text?: string; fills?: any[]; fontFamily?: string; fontSize?: number; fontWeight?: number }>
    dotFill?: string
  } = {}
): string {
  // 현재 페이지 찾기 — parentId에서 위로 올라가면서 CANVAS 찾기
  let pageId: string | undefined
  let cur = graph.getNode(parentId)
  while (cur) {
    if (cur.type === 'CANVAS') { pageId = cur.id; break }
    cur = cur.parentId ? graph.getNode(cur.parentId) : null
  }
  if (!pageId) pageId = graph.getPages()[0]?.id

  const inst = graph.createInstance(componentId, pageId!, {
    x: opts.x ?? 0,
    y: opts.y ?? 0
  })
  if (!inst) throw new Error(`Failed to create instance of ${componentId}`)

  // 부모로 이동
  graph.reparentNode(inst.id, parentId)

  // 크기 오버라이드
  if (opts.width !== undefined || opts.height !== undefined) {
    graph.updateNode(inst.id, {
      ...(opts.width !== undefined ? { width: opts.width } : {}),
      ...(opts.height !== undefined ? { height: opts.height } : {})
    })
  }

  // 배경 오버라이드
  if (opts.fills) {
    graph.updateNode(inst.id, { fills: opts.fills })
  }

  // 코너 오버라이드
  if (opts.cornerRadius !== undefined) {
    graph.updateNode(inst.id, { cornerRadius: opts.cornerRadius })
  }

  // 자식 텍스트/도형 오버라이드
  if (opts.texts) {
    const instNode = graph.getNode(inst.id)
    if (instNode) {
      for (const childId of instNode.childIds) {
        const child = graph.getNode(childId)
        if (!child) continue
        const override = opts.texts[child.name]
        if (override) {
          graph.updateNode(childId, {
            ...(override.text !== undefined ? { text: override.text } : {}),
            ...(override.fills ? { fills: override.fills } : {}),
            ...(override.fontFamily ? { fontFamily: override.fontFamily } : {}),
            ...(override.fontSize ? { fontSize: override.fontSize } : {}),
            ...(override.fontWeight ? { fontWeight: override.fontWeight } : {})
          })
        }
      }
    }
  }

  // Badge Dot 색상 오버라이드
  if (opts.dotFill) {
    const instNode = graph.getNode(inst.id)
    if (instNode) {
      for (const childId of instNode.childIds) {
        const child = graph.getNode(childId)
        if (child?.name === 'Dot') {
          graph.updateNode(childId, { fills: solidFill(opts.dotFill) })
        }
      }
    }
  }

  return inst.id
}

// ─── 컴포넌트 ID 맵 ──────────────────────────────────────

const C = {
  btnPrimary: '0:5',
  btnSecondary: '0:7',
  tag: '0:9',
  avatar: '0:11',
  card: '0:13',
  input: '0:18',
  badge: '0:20'
}

const textOverride = (text: string, color = DARK, size?: number, weight?: number) => ({
  text,
  fills: solidFill(color),
  fontFamily: FONT,
  ...(size ? { fontSize: size } : {}),
  ...(weight ? { fontWeight: weight } : {})
})

// ─── 화면 1: 홈 ──────────────────────────────────────────

async function buildHome(graph: SceneGraph, pageId: string) {
  const r = await renderJSX(graph, `
    <Frame name="홈" w={${W}} h={${H}} flex="col" bg="${BG}">

      {/* 상태바 */}
      <Frame name="StatusBar" w="fill" h={44} flex="row" items="center" justify="between" px={20} bg="${BAEMIN}">
        <Text font="${FONT}" size={14} weight="bold" color="${WHITE}">9:41</Text>
        <Text font="${FONT}" size={13} weight="bold" color="${WHITE}">배달의민족</Text>
        <Frame flex="row" gap={8}>
          <Icon name="lucide:bell" size={18} color="${WHITE}" />
          <Icon name="lucide:shopping-cart" size={18} color="${WHITE}" />
        </Frame>
      </Frame>

      {/* 주소 + 검색 (Input 인스턴스 자리) */}
      <Frame name="SearchArea" w="fill" flex="col" gap={10} px={16} py={14} bg="${WHITE}">
        <Frame flex="row" items="center" gap={4}>
          <Icon name="lucide:map-pin" size={16} color="${BAEMIN}" />
          <Text font="${FONT}" size={14} weight="bold" color="${DARK}">강남구 역삼동</Text>
          <Icon name="lucide:chevron-down" size={14} color="${GRAY}" />
        </Frame>
        {/* Input 인스턴스 삽입 위치 */}
        <Frame name="InputSlot" w="fill" h={38} />
      </Frame>

      {/* 카테고리 (Tag 인스턴스들) */}
      <Frame name="CategoryBar" w="fill" flex="row" gap={8} px={16} py={12} bg="${WHITE}">
        <Frame name="TagSlot1" w={80} h={24} />
        <Frame name="TagSlot2" w={80} h={24} />
        <Frame name="TagSlot3" w={80} h={24} />
        <Frame name="TagSlot4" w={80} h={24} />
      </Frame>

      {/* 프로모션 배너 (Badge 인스턴스 포함) */}
      <Frame name="PromoBanner" w="fill" h={110} flex="col" justify="end" px={20} py={16} bg="${BAEMIN}">
        <Frame name="BadgeSlot" w={50} h={22} />
        <Text font="${FONT}" size={20} weight="bold" color="${WHITE}">첫 주문 3,000원 할인</Text>
        <Text font="${FONT}" size={12} color="${WHITE}CC">신규 가입 후 첫 주문 시 적용</Text>
      </Frame>

      <Rectangle w="fill" h={8} bg="${LGRAY}" />

      {/* 내 주변 맛집 (Card 인스턴스들) */}
      <Frame name="RestaurantSection" w="fill" grow={1} flex="col" gap={0} bg="${WHITE}" overflow="hidden">
        <Frame w="fill" flex="row" items="center" justify="between" px={16} py={14}>
          <Text font="${FONT}" size={17} weight="bold" color="${DARK}">내 주변 맛집</Text>
          <Text font="${FONT}" size={12} color="${GRAY}">더보기</Text>
        </Frame>
        <Frame name="CardRow" w="fill" flex="row" gap={12} px={16} pb={12}>
          <Frame name="CardSlot1" w={170} h={160} />
          <Frame name="CardSlot2" w={170} h={160} />
        </Frame>
      </Frame>

      {/* 하단 탭바 */}
      <Frame name="TabBar" w="fill" h={80} flex="row" items="start" justify="between" px={28} pt={10} pb={28} bg="${WHITE}" stroke="${LGRAY}" strokeWidth={1}>
        {["홈", "검색", "찜", "주문내역", "My배민"].map((label, i) => (
          <Frame key={i} flex="col" items="center" gap={4}>
            <Icon name={["lucide:home","lucide:search","lucide:heart","lucide:clipboard-list","lucide:user"][i]} size={22} color={i===0 ? "${BAEMIN}" : "${GRAY}"} />
            <Text font="${FONT}" size={10} color={i===0 ? "${BAEMIN}" : "${GRAY}"}>{label}</Text>
          </Frame>
        ))}
      </Frame>
    </Frame>
  `, { parentId: pageId, x: 0, y: 0 })

  const homeId = r.id

  // ── Input 인스턴스 → 검색바 ──
  const inputSlot = findByName(graph, homeId, 'InputSlot')!
  placeInstance(graph, C.input, inputSlot, {
    width: W - 32,
    texts: { Placeholder: textOverride('치킨, 피자, 햄버거 검색', GRAY) }
  })

  // ── Tag 인스턴스 → 카테고리 ──
  const tagLabels = [
    { text: '치킨', fill: ORANGE },
    { text: '피자', fill: '#E53935' },
    { text: '한식', fill: '#8D6E63' },
    { text: '분식', fill: '#F4511E' }
  ]
  for (let i = 0; i < tagLabels.length; i++) {
    const slot = findByName(graph, homeId, `TagSlot${i + 1}`)!
    placeInstance(graph, C.tag, slot, {
      fills: solidFill(tagLabels[i].fill + '20'),
      texts: { Label: textOverride(tagLabels[i].text, tagLabels[i].fill, 12, 600) }
    })
  }

  // ── Badge 인스턴스 → 프로모션 뱃지 ──
  const badgeSlot = findByName(graph, homeId, 'BadgeSlot')!
  placeInstance(graph, C.badge, badgeSlot, {
    fills: solidFill(WHITE + '30'),
    texts: { Label: textOverride('EVENT', WHITE, 11, 700) },
    dotFill: YELLOW
  })

  // ── Card 인스턴스 × 2 → 맛집 카드 ──
  const cards = [
    { title: '교촌치킨 강남점', desc: '★ 4.8 · 배달 30~45분', progress: 0.7 },
    { title: '도미노피자 역삼', desc: '★ 4.5 · 배달 25~40분', progress: 0.6 }
  ]
  for (let i = 0; i < cards.length; i++) {
    const slot = findByName(graph, homeId, `CardSlot${i + 1}`)!
    const cardId = placeInstance(graph, C.card, slot, {
      width: 170,
      height: 160,
      texts: {
        Title: textOverride(cards[i].title, DARK, 14, 700),
        Description: textOverride(cards[i].desc, GRAY, 11)
      }
    })
    // Progress bar 색상 변경
    const cardNode = graph.getNode(cardId)
    if (cardNode) {
      for (const cid of cardNode.childIds) {
        const c = graph.getNode(cid)
        if (c?.name === 'Progress') {
          graph.updateNode(cid, {
            fills: solidFill(BAEMIN),
            width: 170 * 0.6 * cards[i].progress
          })
        }
        if (c?.name === 'Progress BG') {
          graph.updateNode(cid, { width: 170 * 0.6 })
        }
      }
    }
  }

  return homeId
}

// ─── 화면 2: 매장 상세 ───────────────────────────────────

async function buildStore(graph: SceneGraph, pageId: string) {
  const r = await renderJSX(graph, `
    <Frame name="매장상세" w={${W}} h={${H}} flex="col" bg="${WHITE}">

      {/* 헤더 이미지 */}
      <Frame name="Header" w="fill" h={200} flex="col" justify="end">
        <Rectangle w="fill" h={200} bg="${LGRAY}" />
        <Frame x={16} y={52} w={36} h={36} flex="row" items="center" justify="center" bg="${WHITE}CC" rounded={18}>
          <Icon name="lucide:arrow-left" size={20} color="${DARK}" />
        </Frame>
      </Frame>

      {/* 매장 정보 + Badge + Tag 인스턴스 */}
      <Frame name="StoreInfo" w="fill" flex="col" gap={8} px={16} py={16} bg="${WHITE}">
        <Frame flex="row" items="center" gap={8}>
          <Text font="${FONT}" size={22} weight="bold" color="${DARK}">교촌치킨 강남점</Text>
          <Frame name="StoreBadgeSlot" w={50} h={22} />
        </Frame>
        <Frame flex="row" items="center" gap={4}>
          <Icon name="lucide:star" size={14} color="${YELLOW}" />
          <Text font="${FONT}" size={14} weight="bold" color="${DARK}">4.8</Text>
          <Text font="${FONT}" size={13} color="${GRAY}">리뷰 2,340개</Text>
        </Frame>
        <Frame flex="row" gap={8}>
          <Text font="${FONT}" size={13} color="${GRAY}">최소주문 15,000원</Text>
          <Text font="${FONT}" size={13} color="${GRAY}">배달 30~45분</Text>
        </Frame>
        <Frame name="PromoTags" flex="row" gap={8} pt={4}>
          <Frame name="PromoTag1" w={80} h={24} />
          <Frame name="PromoTag2" w={80} h={24} />
        </Frame>
      </Frame>

      <Rectangle w="fill" h={8} bg="${BG}" />

      {/* 리뷰 미리보기 (Avatar 인스턴스들) */}
      <Frame name="ReviewPreview" w="fill" flex="col" gap={12} px={16} py={14} bg="${WHITE}">
        <Frame flex="row" items="center" justify="between">
          <Text font="${FONT}" size={16} weight="bold" color="${DARK}">최근 리뷰</Text>
          <Text font="${FONT}" size={12} color="${BAEMIN}">전체보기</Text>
        </Frame>
        <Frame name="ReviewRow" flex="row" gap={12}>
          <Frame name="Review1" flex="row" gap={8} items="start">
            <Frame name="Avatar1Slot" w={40} h={40} />
            <Frame flex="col" gap={2}>
              <Text font="${FONT}" size={13} weight="bold" color="${DARK}">배민**</Text>
              <Frame flex="row" gap={2}>
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
              </Frame>
              <Text font="${FONT}" size={11} color="${GRAY}">바삭하고 맛있어요!</Text>
            </Frame>
          </Frame>
          <Frame name="Review2" flex="row" gap={8} items="start">
            <Frame name="Avatar2Slot" w={40} h={40} />
            <Frame flex="col" gap={2}>
              <Text font="${FONT}" size={13} weight="bold" color="${DARK}">치킨**</Text>
              <Frame flex="row" gap={2}>
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${YELLOW}" />
                <Icon name="lucide:star" size={10} color="${LGRAY}" />
              </Frame>
              <Text font="${FONT}" size={11} color="${GRAY}">배달 빠르고 좋아요</Text>
            </Frame>
          </Frame>
        </Frame>
      </Frame>

      <Rectangle w="fill" h={8} bg="${BG}" />

      {/* 메뉴 리스트 */}
      <Frame name="MenuSection" w="fill" grow={1} flex="col" gap={0} overflow="hidden">
        <Frame w="fill" px={16} py={12}>
          <Text font="${FONT}" size={16} weight="bold" color="${DARK}">인기 메뉴</Text>
        </Frame>
        {[
          { name: "교촌 오리지날", price: "18,000원" },
          { name: "교촌 허니콤보", price: "20,000원" },
          { name: "교촌 레드", price: "18,000원" }
        ].map((m, i) => (
          <Frame key={i} w="fill" flex="row" items="center" justify="between" px={16} py={12} stroke="${LGRAY}" strokeWidth={0.5}>
            <Frame flex="col" gap={2}>
              <Text font="${FONT}" size={14} weight="bold" color="${DARK}">{m.name}</Text>
              <Text font="${FONT}" size={13} color="${DARK}">{m.price}</Text>
            </Frame>
            <Rectangle w={60} h={60} bg="${LGRAY}" rounded={8} />
          </Frame>
        ))}
      </Frame>

      {/* 장바구니 CTA (Button/Primary 인스턴스) */}
      <Frame name="CTABar" w="fill" h={90} flex="row" items="start" px={16} pt={12} pb={34} bg="${WHITE}">
        <Frame name="CTASlot" w="fill" h={44} />
      </Frame>
    </Frame>
  `, { parentId: pageId, x: W + GAP, y: 0 })

  const storeId = r.id

  // Badge → 매장명 옆 "인기"
  const storeBadgeSlot = findByName(graph, storeId, 'StoreBadgeSlot')!
  placeInstance(graph, C.badge, storeBadgeSlot, {
    fills: solidFill('#FFF3E0'),
    texts: { Label: textOverride('인기', ORANGE, 11, 700) },
    dotFill: ORANGE
  })

  // Tag × 2 → 프로모션
  const promoTags = [
    { text: '3,000원 쿠폰', fill: BAEMIN },
    { text: '첫 주문 할인', fill: ORANGE }
  ]
  for (let i = 0; i < promoTags.length; i++) {
    const slot = findByName(graph, storeId, `PromoTag${i + 1}`)!
    placeInstance(graph, C.tag, slot, {
      fills: solidFill(promoTags[i].fill + '18'),
      texts: { Label: textOverride(promoTags[i].text, promoTags[i].fill, 11, 600) }
    })
  }

  // Avatar × 2 → 리뷰어 프로필
  for (let i = 1; i <= 2; i++) {
    const slot = findByName(graph, storeId, `Avatar${i}Slot`)!
    placeInstance(graph, C.avatar, slot, {
      fills: solidFill(i === 1 ? '#E3F2FD' : '#FCE4EC')
    })
  }

  // Button/Primary → 장바구니 담기 CTA
  const ctaSlot = findByName(graph, storeId, 'CTASlot')!
  placeInstance(graph, C.btnPrimary, ctaSlot, {
    width: W - 32,
    height: 44,
    fills: solidFill(BAEMIN),
    cornerRadius: 12,
    texts: { Label: textOverride('장바구니 담기', WHITE, 15, 700) }
  })

  return storeId
}

// ─── 화면 3: 장바구니 ────────────────────────────────────

async function buildCart(graph: SceneGraph, pageId: string) {
  const r = await renderJSX(graph, `
    <Frame name="장바구니" w={${W}} h={${H}} flex="col" bg="${BG}">

      {/* 헤더 */}
      <Frame w="fill" h={52} flex="row" items="center" justify="between" px={16} bg="${WHITE}">
        <Icon name="lucide:arrow-left" size={22} color="${DARK}" />
        <Text font="${FONT}" size={16} weight="bold" color="${DARK}">장바구니</Text>
        <Frame w={22} h={22} />
      </Frame>

      {/* 매장 정보 */}
      <Frame w="fill" flex="row" items="center" gap={8} px={16} py={12} bg="${WHITE}">
        <Frame name="StoreAvatarSlot" w={40} h={40} />
        <Frame flex="col" gap={2} grow={1}>
          <Text font="${FONT}" size={15} weight="bold" color="${DARK}">교촌치킨 강남점</Text>
          <Text font="${FONT}" size={12} color="${GRAY}">배달 30~45분</Text>
        </Frame>
        <Icon name="lucide:chevron-right" size={18} color="${GRAY}" />
      </Frame>

      <Rectangle w="fill" h={8} bg="${BG}" />

      {/* 주문 아이템 (Card 인스턴스 × 2) */}
      <Frame name="CartItems" w="fill" flex="col" gap={8} px={16} py={12} bg="${WHITE}">
        <Text font="${FONT}" size={15} weight="bold" color="${DARK}">주문 메뉴</Text>
        <Frame name="CartCard1Slot" w="fill" h={100} />
        <Frame name="CartCard2Slot" w="fill" h={100} />
      </Frame>

      <Rectangle w="fill" h={8} bg="${BG}" />

      {/* 요청사항 (Input 인스턴스) */}
      <Frame name="RequestSection" w="fill" flex="col" gap={8} px={16} py={12} bg="${WHITE}">
        <Text font="${FONT}" size={14} weight="bold" color="${DARK}">요청사항</Text>
        <Frame name="RequestInputSlot" w="fill" h={38} />
      </Frame>

      <Rectangle w="fill" h={8} bg="${BG}" />

      {/* 쿠폰 (Tag + Badge 인스턴스) */}
      <Frame w="fill" flex="row" items="center" justify="between" px={16} py={14} bg="${WHITE}">
        <Frame flex="row" items="center" gap={8}>
          <Icon name="lucide:ticket" size={18} color="${ORANGE}" />
          <Text font="${FONT}" size={14} color="${DARK}">쿠폰 적용</Text>
          <Frame name="CouponBadgeSlot" w={50} h={22} />
        </Frame>
        <Icon name="lucide:chevron-right" size={16} color="${GRAY}" />
      </Frame>

      <Rectangle w="fill" h={8} bg="${BG}" />

      {/* 결제 요약 */}
      <Frame name="Summary" w="fill" flex="col" gap={10} px={16} py={14} bg="${WHITE}">
        <Frame flex="row" justify="between">
          <Text font="${FONT}" size={13} color="${GRAY}">주문 금액</Text>
          <Text font="${FONT}" size={13} color="${DARK}">38,000원</Text>
        </Frame>
        <Frame flex="row" justify="between">
          <Text font="${FONT}" size={13} color="${GRAY}">배달비</Text>
          <Text font="${FONT}" size={13} color="${DARK}">2,000원</Text>
        </Frame>
        <Frame flex="row" justify="between">
          <Text font="${FONT}" size={13} color="${ORANGE}">쿠폰 할인</Text>
          <Text font="${FONT}" size={13} color="${ORANGE}">-3,000원</Text>
        </Frame>
        <Rectangle w="fill" h={1} bg="${LGRAY}" />
        <Frame flex="row" justify="between">
          <Text font="${FONT}" size={16} weight="bold" color="${DARK}">총 결제 금액</Text>
          <Text font="${FONT}" size={18} weight="bold" color="${BAEMIN}">37,000원</Text>
        </Frame>
      </Frame>

      <Frame grow={1} />

      {/* 하단 버튼 (Button/Primary + Button/Secondary) */}
      <Frame name="BottomCTA" w="fill" h={100} flex="col" gap={8} px={16} pt={10} pb={34} bg="${WHITE}">
        <Frame name="OrderBtnSlot" w="fill" h={44} />
      </Frame>
    </Frame>
  `, { parentId: pageId, x: (W + GAP) * 2, y: 0 })

  const cartId = r.id

  // Avatar → 매장 아이콘
  const storeAvSlot = findByName(graph, cartId, 'StoreAvatarSlot')!
  placeInstance(graph, C.avatar, storeAvSlot, {
    fills: solidFill(BAEMIN + '20')
  })

  // Card × 2 → 주문 아이템 카드
  const cartItems = [
    { title: '교촌 오리지날 × 1', desc: '18,000원', prog: 1.0 },
    { title: '교촌 허니콤보 × 1', desc: '20,000원', prog: 1.0 }
  ]
  for (let i = 0; i < cartItems.length; i++) {
    const slot = findByName(graph, cartId, `CartCard${i + 1}Slot`)!
    const cardId2 = placeInstance(graph, C.card, slot, {
      width: W - 32,
      height: 100,
      texts: {
        Title: textOverride(cartItems[i].title, DARK, 14, 700),
        Description: textOverride(cartItems[i].desc, GRAY, 13)
      }
    })
    // Progress → 수량 표시용 (100% 채움)
    const cn = graph.getNode(cardId2)
    if (cn) {
      for (const cid of cn.childIds) {
        const c = graph.getNode(cid)
        if (c?.name === 'Progress') graph.updateNode(cid, { fills: solidFill(BAEMIN), width: (W - 32) * 0.5 })
        if (c?.name === 'Progress BG') graph.updateNode(cid, { width: (W - 32) * 0.5 })
      }
    }
  }

  // Input → 요청사항 입력
  const reqSlot = findByName(graph, cartId, 'RequestInputSlot')!
  placeInstance(graph, C.input, reqSlot, {
    width: W - 32,
    texts: { Placeholder: textOverride('수저, 포크 빼주세요', GRAY) }
  })

  // Badge → 쿠폰 개수
  const couponSlot = findByName(graph, cartId, 'CouponBadgeSlot')!
  placeInstance(graph, C.badge, couponSlot, {
    fills: solidFill(ORANGE + '18'),
    texts: { Label: textOverride('1장', ORANGE, 11, 700) },
    dotFill: ORANGE
  })

  // Button/Primary → 주문하기
  const orderSlot = findByName(graph, cartId, 'OrderBtnSlot')!
  placeInstance(graph, C.btnPrimary, orderSlot, {
    width: W - 32,
    height: 44,
    fills: solidFill(BAEMIN),
    cornerRadius: 12,
    texts: { Label: textOverride('37,000원 결제하기', WHITE, 15, 700) }
  })

  return cartId
}

// ─── 이름으로 노드 찾기 ──────────────────────────────────

function findByName(graph: SceneGraph, rootId: string, name: string): string | null {
  const node = graph.getNode(rootId)
  if (!node) return null
  if (node.name === name) return rootId
  for (const childId of node.childIds) {
    const found = findByName(graph, childId, name)
    if (found) return found
  }
  return null
}

// ─── 메인 ────────────────────────────────────────────────

async function main() {
  console.log('📦 components.fig 로딩...')
  const buf = await readFile('docs/components.fig')
  const graph = await parseFigFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

  // 컴포넌트 확인 (새 API 사용)
  const grouped = graph.getComponentsGroupedByPage()
  for (const { page, components } of grouped) {
    console.log(`  📄 ${page.name}: ${components.length}개 컴포넌트`)
    for (const c of components) {
      console.log(`     ✓ ${c.name} (${c.id}) ${c.width}×${c.height}`)
    }
  }

  // 한글 폰트 로드
  console.log('\n🔤 폰트 로딩...')
  await loadFont(FONT, 'Regular')
  await loadFont(FONT, 'Bold')

  // 새 페이지
  const pages = graph.getPages()
  const existing = pages.find((p) => p.name === '배달의민족')
  let pid: string
  if (existing) {
    pid = existing.id
    for (const cid of [...existing.childIds]) graph.deleteNode(cid)
    console.log('♻️  기존 페이지 초기화')
  } else {
    pid = graph.addPage('배달의민족').id
    console.log('📄 새 페이지 생성')
  }

  // 3개 화면 생성
  console.log('\n🏠 홈 화면...')
  await buildHome(graph, pid)

  console.log('🍗 매장 상세...')
  await buildStore(graph, pid)

  console.log('🛒 장바구니...')
  await buildCart(graph, pid)

  // 레이아웃
  console.log('\n📐 레이아웃 계산...')
  computeAllLayouts(graph, pid)

  // 인스턴스 통계
  let instanceCount = 0
  const instanceTypes: Record<string, number> = {}
  for (const [, node] of graph.nodes) {
    if (node.type === 'INSTANCE' && node.parentId) {
      const p = graph.getNode(node.parentId)
      // 배달의민족 페이지에 속한 것만 카운트
      let cur = graph.getNode(node.id)
      while (cur && cur.type !== 'CANVAS') {
        cur = cur.parentId ? graph.getNode(cur.parentId) : null
      }
      if (cur?.id === pid) {
        instanceCount++
        instanceTypes[node.name] = (instanceTypes[node.name] || 0) + 1
      }
    }
  }

  // 저장
  await mkdir('output', { recursive: true })
  const data = await exportFigFile(graph)
  await writeFile('output/baemin-app.fig', Buffer.from(data))

  console.log('\n✅ output/baemin-app.fig 생성!')
  console.log(`   화면: 홈 / 매장상세 / 장바구니`)
  console.log(`   컴포넌트 인스턴스: ${instanceCount}개`)
  for (const [name, count] of Object.entries(instanceTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${name}: ${count}개`)
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
