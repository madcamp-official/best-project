package com.madcamp.server.auth

import com.google.api.client.http.javanet.NetHttpTransport
import com.google.auth.oauth2.GoogleCredentials
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.io.FileInputStream
import java.io.File

/** 구글 로그인으로 확인된 신원 — FirebaseToken에서 우리가 쓰는 필드만 뽑아낸 것. */
data class GoogleIdentity(val uid: String, val email: String, val name: String?)

/** idToken 검증 실패(형식 오류·만료 등) 또는 서버에 Firebase 자격 증명이 없을 때 던진다. */
class GoogleAuthException(message: String) : RuntimeException(message)

/**
 * 프런트가 Firebase(구글) 로그인으로 받은 ID 토큰을 서버가 검증하는 곳.
 * 서비스 계정 키(application.properties의 app.firebase.service-account-path)가 없으면
 * 조용히 비활성 상태로 남는다 — 팀원이 아직 Firebase 콘솔 설정을 안 끝냈어도 나머지(게스트
 * 접속)는 그대로 돌아가야 하기 때문(SessionService는 idToken이 없으면 이 서비스를 아예 안 씀).
 */
@Service
class FirebaseAuthService(
    @Value("\${app.firebase.service-account-path}") private val serviceAccountPath: String,
) {
    private val log = LoggerFactory.getLogger(FirebaseAuthService::class.java)
    private var app: FirebaseApp? = null

    val enabled: Boolean
        get() = app != null

    @PostConstruct
    private fun init() {
        val file = File(serviceAccountPath)
        if (!file.exists()) {
            log.warn(
                "Firebase 서비스 계정 키를 찾을 수 없습니다 ({}) — 구글 로그인은 비활성화되고 게스트 접속만 동작합니다. " +
                    "Firebase 콘솔 > 프로젝트 설정 > 서비스 계정에서 키를 발급받아 그 경로에 두세요.",
                file.absolutePath,
            )
            return
        }
        try {
            val credentials = FileInputStream(file).use { GoogleCredentials.fromStream(it) }
            // HTTP 전송을 NetHttpTransport(순정 HttpURLConnection)로 못박는다.
            // 안 그러면 google-http-client가 클래스패스를 보고 ApacheHttpTransport를 고르는데,
            // Spring Boot가 끌고 오는 Apache HttpClient 4.5는 gzip을 자동으로 풀어주면서
            // Content-Encoding 헤더는 남겨둔다 → google-http-client가 평문을 한 번 더 풀려다
            // "Not in GZIP format"으로 죽고, 구글 공개키를 못 받아 모든 토큰 검증이 401이 된다.
            // (실측: 컨테이너에서 curl·순정 Java는 정상 gzip 수신, 앱 안에서만 실패했다.)
            val options = FirebaseOptions.builder()
                .setCredentials(credentials)
                .setHttpTransport(NetHttpTransport())
                .build()
            app = if (FirebaseApp.getApps().isEmpty()) FirebaseApp.initializeApp(options) else FirebaseApp.getInstance()
            log.info("Firebase Admin 초기화 완료 — 구글 로그인 활성화됨")
        } catch (e: Exception) {
            log.warn("Firebase Admin 초기화 실패 — 구글 로그인이 비활성화됩니다", e)
        }
    }

    /** idToken을 검증해 신원을 반환한다. 비활성 상태거나 토큰이 유효하지 않으면 예외를 던진다. */
    fun verifyIdToken(idToken: String): GoogleIdentity {
        val currentApp = app ?: throw GoogleAuthException("서버에 구글 로그인이 설정되지 않았습니다.")
        try {
            val decoded = FirebaseAuth.getInstance(currentApp).verifyIdToken(idToken)
            return GoogleIdentity(uid = decoded.uid, email = decoded.email ?: "", name = decoded.name)
        } catch (e: Exception) {
            throw GoogleAuthException("구글 로그인 확인에 실패했습니다: ${e.message}")
        }
    }
}
