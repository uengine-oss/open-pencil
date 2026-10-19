# open-pencil 와이어프레임 렌더링 서비스.
#
# Architect 백엔드의 와이어프레임 에이전트가 JSX 를 만들어 이 서비스의 `/render`
# 로 넘기면, SerializedSceneGraph 를 돌려준다. **LLM 은 여기서 돌지 않는다** —
# 이 컨테이너에는 모델 키가 필요 없다.
#
# 왜 이미지가 필요한가: 이 서비스가 없으면 와이어프레임 단계가 **조용히 빈다.**
# `wireframe_agent.run_render_agent` 는 서비스가 없으면 `(None, None)` 을 내는데,
# 인제스천 경로는 `on_event=None` 으로 부르므로 오류가 어디에도 안 나온다. UI 노드는
# `sceneGraph=null` 로 만들어지고 화면은 "UI 생성" 이라고 보고한다. 그 뒤 Figma
# 싱크가 UI 마다 "이 UI 노드에는 아직 sceneGraph가 없습니다" 로 실패한다.
# 2026-09-23 실측: 렌더러를 띄우자 같은 입력에서 와이어프레임 29/29, Figma 프레임
# 28/29 가 나왔다 (그 전에는 0/27).
#
# bun 은 로컬 개발(1.4.2)과 같은 1.4 계열로 맞춘다.
FROM oven/bun:1.4-slim

WORKDIR /app

# 의존성 층을 먼저 굳힌다 — 소스만 바뀌면 install 을 다시 하지 않는다.
# 워크스페이스(`packages/*`)라 각 패키지의 manifest 가 있어야 링크가 풀린다.
COPY package.json bun.lock ./
COPY packages/cli/package.json    packages/cli/
COPY packages/core/package.json   packages/core/
COPY packages/docs/package.json   packages/docs/
COPY packages/mcp/package.json    packages/mcp/
COPY packages/vue/package.json    packages/vue/
# 취약점 보정 ⑦ (2026-10-19) — **쓰지 않는 워크스페이스를 안 깐다.**
#
# `--production` 만으로는 뿌리의 devDependency 만 빠진다. 워크스페이스라
# `packages/*` **전부**의 의존이 설치되고, 뿌리의 의존 45개(Tauri·Vue UI·AI SDK·
# canvaskit·yjs·trystero…)도 같이 들어온다. 그래서 운영 이미지에 `vite`·`hono`·
# `ws`(뿌리 devDependency) 와 `@grpc/grpc-js`·`protobufjs`(@ai-sdk/google 경유)·
# `@libp2p/peer-store`(trystero 경유)가 실려 있었다 — 치명·고위험 **40건**.
#
# 이 서비스가 쓰는 것은 아래 COPY 가 말하는 그대로 **cli(진입점) · core(렌더러)**
# 뿐이다. 설치도 거기에 맞춘다. 소스 범위와 설치 범위가 어긋나 있던 것을 맞추는 것이지
# 기능을 줄이는 것이 아니다.
#
# ⚠ manifest 는 **다섯 개를 다 COPY 한 채로 둔다** — 워크스페이스 링크를 풀 때
#   bun 이 참조한다. 지우면 `--frozen-lockfile` 이 잠금과 안 맞다고 문다.
RUN bun install --frozen-lockfile --production \
      --filter='@open-pencil/cli' --filter='@open-pencil/core'

# 서비스가 실제로 쓰는 것만 담는다: cli(진입점·headless) · core(렌더러) ·
# 컴포넌트 라이브러리.
COPY packages/cli/  packages/cli/
COPY packages/core/ packages/core/
COPY docs/components.fig docs/components.fig

ENV WIREFRAME_SERVICE_PORT=7610 \
    COMPONENT_LIBRARY_PATH=/app/docs/components.fig

EXPOSE 7610

# **slim 이미지에는 curl·wget·nc 가 없다.** 넣지 않고 bun 으로 잰다 — 도구를
# 더하면 이미지가 커지고, 무엇보다 검사만 되는데 서비스는 못 하는 상태를 못 가린다.
# `/health` 는 컴포넌트 카탈로그를 실제로 읽은 뒤에야 ok 를 낸다.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+(process.env.WIREFRAME_SERVICE_PORT||7610)+'/health');if(!r.ok)process.exit(1);const j=await r.json();process.exit(j.status==='ok'?0:1)"

CMD ["bun", "packages/cli/src/wireframe-service.ts"]
