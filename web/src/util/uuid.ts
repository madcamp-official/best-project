// crypto.randomUUID()는 보안 컨텍스트(HTTPS·localhost)에서만 존재한다. 다른 로컬 서버에 IP+HTTP로
// 접속하면 없어서 던지므로(로드 실패), 비보안 컨텍스트에서도 동작하는 UUID 생성기를 쓴다.
// getRandomValues는 비보안 컨텍스트에서도 되고, 그마저 없으면 Math.random 폴백(브라우저별 고유
// id 용도라 암호학적 품질은 불필요).
export function safeUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
