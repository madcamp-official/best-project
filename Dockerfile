# 단일 오리진 배포 이미지 (README §"배포": Spring이 웹 정적 빌드까지 :8080에서 서빙).
# 1단계에서 웹을 빌드하고, 2단계 deployJar가 그 dist를 동봉한 단일 jar를 만들고,
# 3단계 JRE가 그 jar 하나만 실행한다. GitHub Actions(deploy.yml)와 로컬 docker build 공용.

# ── 1단계: 웹 클라이언트 빌드 ─────────────────────────────
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# 구글 로그인 키(빌드 타임 주입, web/.env.example 참조). 비어 있으면 게스트 전용으로 동작.
ARG VITE_FIREBASE_API_KEY=
ARG VITE_FIREBASE_AUTH_DOMAIN=
ARG VITE_FIREBASE_PROJECT_ID=
ARG VITE_FIREBASE_APP_ID=
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
RUN npm run build

# ── 2단계: 서버 빌드 (deployJar = 웹 dist 동봉 bootJar) ───
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src/server
COPY server/ ./
COPY --from=web /src/web/dist /src/web/dist
# buildWeb(npm 실행)은 1단계가 대신했으므로 건너뛴다(-x). deployJar는 ../web/dist를 집는다.
# gradlew는 Windows 체크아웃에서 실행 비트가 없을 수 있어 sh로 호출한다.
RUN --mount=type=cache,target=/root/.gradle \
    sh ./gradlew deployJar -x buildWeb --no-daemon

# ── 3단계: 실행 ──────────────────────────────────────────
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/server/build/libs/*-deploy.jar app.jar
# /app/data(H2 유저 DB)·/app/secrets(Firebase 서비스 계정)는 볼륨 마운트 대상(deploy/docker-compose.yml).
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
