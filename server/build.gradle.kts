plugins {
	kotlin("jvm") version "2.3.21"
	kotlin("plugin.spring") version "2.3.21"
	// JPA 엔티티(AppUser)를 Kotlin final 클래스 그대로 써도 Hibernate가 프록시할 수 있게
	// open 처리 + no-arg 생성자를 자동 생성해준다(구글 로그인, feat/google-login).
	kotlin("plugin.jpa") version "2.3.21"
	id("org.springframework.boot") version "4.1.0"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "com.madcamp"
version = "0.0.1-SNAPSHOT"
description = "dongdaejang PvPvE server"

// 툴체인을 특정 버전에 고정하지 않는다 — Gradle을 실행하는 JDK(17+)를 그대로 쓴다.
// 팀원 로컬 JDK 버전이 서로 달라도(21/24 등) 별도 다운로드/설정 없이 빌드되게 하기 위함.

repositories {
	mavenCentral()
}

dependencies {
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	implementation("org.springframework.boot:spring-boot-starter-websocket")
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	implementation("tools.jackson.module:jackson-module-kotlin")
	// 구글 로그인(feat/google-login) — 유저 계정 영속화(H2 파일 DB) + 구글 ID 토큰 검증(Firebase Admin SDK).
	implementation("org.springframework.boot:spring-boot-starter-data-jpa")
	runtimeOnly("com.h2database:h2")
	// 명예의 전당(라운드 우승 누적 랭킹) — Redis ZSET. 미기동 시 RankingService가 랭킹만 비활성화한다.
	implementation("org.springframework.boot:spring-boot-starter-data-redis")
	implementation("com.google.firebase:firebase-admin:9.4.1")
	testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
	testImplementation("org.springframework.boot:spring-boot-starter-websocket-test")
	testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

tasks.withType<Test> {
	useJUnitPlatform()
}

// ── 배포용 정적 서빙 (plan.md Day 5 "Spring이 클라 정적 빌드를 서빙, 단일 origin") ──
// 기본 bootJar/build/bootRun 경로는 건드리지 않는다 — 매번 npm 빌드가 끼면 느려지고
// 서버만 만지는 사람 머신엔 Node가 없을 수도 있다. 그래서 별도 BootJar 태스크
// (deployJar)를 새로 만들어 그쪽에만 web/dist를 동봉한다. `./gradlew deployJar`로 명시 실행.
val webProjectDir = file("../web")
val webStagingDir = layout.buildDirectory.dir("web-static")

val buildWeb = tasks.register<Exec>("buildWeb") {
	group = "deploy"
	description = "web/ 클라이언트를 프로덕션 빌드한다 (web/dist 생성)"
	workingDir = webProjectDir
	val isWindows = org.gradle.internal.os.OperatingSystem.current().isWindows
	commandLine(if (isWindows) listOf("cmd", "/c", "npm", "run", "build") else listOf("npm", "run", "build"))
}

val syncWebBuild = tasks.register<Copy>("syncWebBuild") {
	group = "deploy"
	description = "web/dist를 배포용 스테이징 디렉터리로 복사한다"
	dependsOn(buildWeb)
	from(webProjectDir.resolve("dist"))
	into(webStagingDir)
}

tasks.register<org.springframework.boot.gradle.tasks.bundling.BootJar>("deployJar") {
	group = "deploy"
	description = "클라 빌드를 동봉한 배포용 jar (build/libs/*-deploy.jar 실행 시 :8080에서 API+화면 모두 서빙)"
	dependsOn(syncWebBuild)
	archiveClassifier.set("deploy")
	mainClass.set("com.madcamp.server.ServerApplicationKt")
	targetJavaVersion.set(JavaVersion.current())
	classpath(sourceSets.main.get().output, configurations.runtimeClasspath)
	from(webStagingDir) { into("static") }
}
