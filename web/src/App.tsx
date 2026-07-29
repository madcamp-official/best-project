import { useEffect, useRef, useState } from "react";
import "./App.css";
import { MapView } from "./map/MapView";
import { Hud } from "./ui/Hud";
import { JoinScreen } from "./ui/JoinScreen";
import { AuthChoiceScreen } from "./ui/AuthChoiceScreen";
import { LobbyScreen } from "./ui/LobbyScreen";
import { RoomWaitScreen } from "./ui/RoomWaitScreen";
import { ResultsOverlay } from "./ui/ResultsOverlay";
import { BgmPlayer } from "./ui/BgmPlayer";
import { ProfileBadge } from "./ui/ProfileBadge";
import { MyPage } from "./ui/MyPage";
import { FriendsPanel } from "./ui/FriendsPanel";
import { InviteBanner } from "./ui/InviteBanner";
import { loadMapData, DEFAULT_MAP_ID } from "./data/loadMapData";
import type { PreparedMap } from "./data/loadMapData";
import { LocalConnection } from "./net/localConnection";
import { StompConnection } from "./net/stompConnection";
import type { Connection } from "./net/connection";
import { fetchMyProfile, updateNickname, type AccountProfile } from "./auth/api";
import type { FriendPresence, InviteMessage } from "./net/protocol";
import { onIdTokenChanged, signOutGoogle } from "./auth/firebase";
import {
  applyWelcome,
  applyDelta,
  getLeaderboard,
  envCellCount,
  drainDefeat,
  drainVictory,
  world,
} from "./world/worldView";
import { useUIStore } from "./store/uiStore";

// plan.md §3 — 클라는 렌더러 + 입력 전송기.
// 데이터 로드 → Connection(기본: 실서버 StompConnection) 생성 → 접속 화면(닉네임) →
// JOIN → WELCOME 스냅샷 반영 → 이후 DELTA로만 갱신.
//
// 서버 없이 렌더링/입력만 확인하고 싶을 때는 `VITE_USE_LOCAL_MOCK=1 npm run dev`로
// 브라우저 내 목 서버(localConnection)를 대신 쓸 수 있다 — Connection 계약이 같아
// 이 스위치 하나로 교체된다(architecture.md §2.3).
function App() {
  const [prepared, setPrepared] = useState<PreparedMap | null>(null);
  const connectionRef = useRef<Connection | null>(null);
  const everConnectedRef = useRef(false); // 재연결 토스트를 최초 연결 때는 안 띄우기 위한 플래그
  // 방마다 지도(mapId)가 다를 수 있어(로비에서 선택) WELCOME을 받고서야 어느 지도를 로드할지
  // 안다 — 지도별로 한 번만 로드해 재사용하는 캐시(같은 지도로 재입장 시 재요청 방지).
  const mapCacheRef = useRef<Map<string, PreparedMap>>(new Map());
  const phase = useUIStore((s) => s.phase);
  const setPhase = useUIStore((s) => s.setPhase);
  // 목업(브라우저 내 목 서버)은 로비가 없어 join()으로 솔로 진행, 실서버는 로비 흐름.
  const isMock = import.meta.env.VITE_USE_LOCAL_MOCK === "1";
  // 구글 로그인(feat/google-login) — AuthChoiceScreen에서 확정되면 채워지고, 로비/방 입장에 실어 보낸다.
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [showMyPage, setShowMyPage] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  // 초대를 눌렀는데 아직 방이 없으면, 방을 만든 뒤(roomJoined) 그 친구에게 초대를 쏜다.
  const pendingInviteRef = useRef<number | null>(null);
  const [friendPresence, setFriendPresence] = useState<FriendPresence[]>([]);
  const [incomingInvite, setIncomingInvite] = useState<InviteMessage | null>(null);
  // 콜백 안에서 최신 idToken을 읽어야 해서 ref로도 들고 있는다(구독은 최초 1회만 걸리므로).
  const idTokenRef = useRef<string | null>(null);
  idTokenRef.current = idToken;
  // 계정 닉네임을 입력칸에 심었는지(로그인당 1회). 토큰 갱신 때마다 사용자가 고친 이름을 덮어쓰지 않기 위함.
  const nicknameSeededRef = useRef(false);
  // 게스트 배지 표시용 — 로그인 유저는 profile.nickname이 우선하고, 게스트는 이 값(로비 입력과 동기화).
  const nickname = useUIStore((s) => s.nickname);
  // 로그인 여부의 기준은 idToken 하나다 — profile(별도 REST 호출)은 실패할 수 있고, 그걸 기준으로
  // 삼으면 "로그인은 됐는데 게스트로 보이는" 상태가 된다. 친구 패널도 idToken만 있으면 동작한다.
  const loggedIn = idToken !== null;

  // 로그인 세션을 App 한 곳에서 구독한다 — (1) 새로고침 뒤 남아 있던 구글 세션 복원,
  // (2) Firebase가 약 1시간마다 토큰을 갱신할 때 자동 반영(만료 토큰이 서버에 거부되는 것 방지).
  // 로그인 관문(AuthChoiceScreen)의 onLoggedIn과 중복 실행돼도 같은 값이라 문제없다.
  useEffect(() => {
    return onIdTokenChanged((auth) => {
      if (!auth) {
        setIdToken(null);
        setProfile(null);
        setPhotoURL(null);
        return;
      }
      setIdToken(auth.idToken);
      setPhotoURL(auth.photoURL);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 목업은 로비가 없어 기본 지도를 즉시 로드해 목 서버 생성에 써야 한다. 실서버는 방에
        // 입장(WELCOME 수신)해야 어느 지도인지 알 수 있으므로 여기서는 로드하지 않는다.
        let connection: Connection;
        if (isMock) {
          const map = await loadMapData(DEFAULT_MAP_ID);
          if (cancelled) return;
          mapCacheRef.current.set(DEFAULT_MAP_ID, map);
          connection = new LocalConnection(map);
        } else {
          connection = new StompConnection();
        }

        // 서버→클라 메시지 배선.
        connection.onWelcome(async (msg) => {
          let map = mapCacheRef.current.get(msg.mapId);
          if (!map) {
            map = await loadMapData(msg.mapId);
            if (cancelled) return;
            mapCacheRef.current.set(msg.mapId, map);
          }
          applyWelcome(msg);
          localStorage.setItem("token", msg.token); // 재접속용
          const st = useUIStore.getState();
          // 첫 LEADERBOARD 메시지(최대 1s 뒤) 전 빈 순위표 깜빡임 방지용 시드.
          st.setLeaderboard(getLeaderboard(), envCellCount(), world.n);
          // 새 라운드 진입 — 지난 라운드의 잔여 UI 상태(결과·패배 오버레이·조준/수송 모드)를 전부 정리.
          // 안 하면 지난 라운드에서 패배한 채 새 라운드를 시작할 때 GAME OVER가 즉시 다시 뜬다.
          st.setRoundResult(null);
          st.setDefeated(false);
          st.setAiming(false);
          st.setTransporting(false);
          // 라운드 타이머: 서버 시각(roundEndsAtMs - serverTimeMs = 남은 시간)을 로컬 시계로 환산.
          st.setRoundEndsAt(msg.roundEndsAtMs > 0 ? Date.now() + (msg.roundEndsAtMs - msg.serverTimeMs) : 0);
          setPrepared(map); // 스냅샷 반영 후 지도 렌더 시작
          setPhase("ready"); // WELCOME = 라운드 진행 중 → 지도로 전환
        });
        connection.onDelta((msg) => {
          applyDelta(msg);
          // 내 영토가 이번 delta에 전부 사라지면(미사일·점령) GAME OVER 오버레이를 띄운다.
          // 재시작은 유저가 오버레이 버튼으로 직접 선택한다(더 이상 자동 재배정 없음).
          if (drainDefeat()) useUIStore.getState().setDefeated(true);
          // 대통령(40%) 우승 오버레이는 라운드가 없는 목업 솔로에서만 — 실서버 라운드는 서버 RoundEnd가
          // 우승(51% 도미네이션/30분)을 판정하므로, 40%에서 오버레이가 조기 발동하지 않게 목업으로 제한한다.
          // (계급 표시상의 "대통령"은 그대로 유지 — computeRank가 담당.) drainVictory는 항상 호출해 플래그를 비운다.
          if (drainVictory() && isMock) useUIStore.getState().setVictorious(true);
        });
        connection.onError((msg) => {
          useUIStore.getState().showToast(msg.message);
          // 입장하려던 방이 사라진 경우(마지막 멤버 이탈로 폐기 등)엔 로비로 돌려보낸다.
          if (msg.code === "ROOM_NOT_FOUND") {
            useUIStore.getState().setCurrentRoom(null);
            setPhase("lobby");
            connection.listRooms();
          }
        });
        connection.onLeaderboard((msg) =>
          useUIStore.getState().setLeaderboard(msg.rows, msg.envCells, msg.totalCells)
        );
        // 로비/방(다중 세션) 이벤트 배선.
        connection.onRoomList((msg) => useUIStore.getState().setRooms(msg.rooms));
        connection.onRoomJoined((msg) => {
          const st = useUIStore.getState();
          st.setCurrentRoom({ roomId: msg.roomId, name: msg.name, state: msg.state, joinCode: msg.joinCode });
          st.setMembers(msg.members);
          st.setIsRoomHost(msg.youAreHost); // 입장 응답이자 방장 승계 통지(방장이 나가면 재전송됨)
          // 초대하려고 만든 방이면, 방이 생긴 지금 그 친구에게 초대를 쏜다(상대 화면에 배너가 뜬다).
          const target = pendingInviteRef.current;
          const tok = idTokenRef.current;
          if (target && tok) {
            pendingInviteRef.current = null;
            connection.sendFriendInvite(tok, target);
          }
          if (st.phase === "lobby") st.setMyReady(false); // 새 입장 — 준비 초기화(승계 통지 땐 유지)
          // 진행 중 방 난입은 곧 WELCOME이 ready로 바꾸고, 결과/게임 화면 중 승계 통지로 화면을 끌어내리지 않는다.
          if (msg.state !== "PLAYING" && (st.phase === "lobby" || st.phase === "room")) setPhase("room");
        });
        connection.onRoomState((msg) => {
          const st = useUIStore.getState();
          st.setMembers(msg.members);
          if (st.currentRoom && st.currentRoom.roomId === msg.roomId) {
            st.setCurrentRoom({ ...st.currentRoom, state: msg.state });
          }
        });
        // 친구 접속 현황(초대·따라가기 버튼이 이 값으로 켜지고 꺼진다).
        connection.onFriendPresence((msg) => setFriendPresence(msg.friends));
        // 친구가 나를 불렀다 — 게임 중(ready)에는 화면을 가리지 않도록 토스트로만 알린다.
        connection.onInvite((msg) => {
          const st = useUIStore.getState();
          if (st.phase === "ready") {
            st.showToast(`${msg.fromNickname}님이 "${msg.roomName}"으로 초대했습니다`);
            return;
          }
          setIncomingInvite(msg);
        });
        connection.onRoundEnd((msg) => {
          const st = useUIStore.getState();
          st.setRoundResult(msg);
          st.setMyReady(false); // 서버가 라운드 종료 시 전원 준비를 리셋 — 로컬 상태도 맞춘다
          setPhase("results");
        });
        // 연결 끊김 → 배너 표시, 재연결 → 배너 해제(+최초 연결이 아니면 재연결 토스트).
        connection.onConnectionChange((connected) => {
          useUIStore.getState().setConnectionLost(!connected);
          if (connected) {
            if (everConnectedRef.current) useUIStore.getState().showToast("서버에 재연결되었습니다");
            everConnectedRef.current = true;
          }
        });
        connectionRef.current = connection;

        // 데이터 준비 완료 → 목업이면 닉네임 접속 화면, 실서버면 로그인/게스트 선택 관문부터.
        if (isMock) {
          setPhase("join");
        } else {
          setPhase("authChoice");
        }
      } catch (err) {
        if (cancelled) return;
        setPhase("error", err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      connectionRef.current?.dispose();
      connectionRef.current = null;
    };
  }, [setPhase, isMock]);

  // 로그인/게스트 선택 관문(AuthChoiceScreen) → 로비로. 게스트는 idToken 없이, 로그인은 프로필까지 받아온다.
  const enterLobby = () => {
    setPhase("lobby");
    connectionRef.current?.listRooms();
  };
  const handleGuest = () => enterLobby();
  const handleLoggedIn = (tok: string, displayName: string | null, photo: string | null) => {
    // 토큰만 세우고 바로 로비로 — 프로필(레벨/전적)은 아래 effect가 토큰을 보고 따로 받아온다.
    // 프로필 응답을 기다리다 실패하면 로그인 자체가 안 된 것처럼 보였던 문제를 이렇게 분리한다.
    setIdToken(tok);
    setPhotoURL(photo);
    if (displayName && !localStorage.getItem("nickname")) {
      localStorage.setItem("nickname", displayName.slice(0, 12));
    }
    enterLobby();
  };

  // 로그인 상태면 서버에 접속을 알린다 — 이게 있어야 로비에 가만히 있어도 친구 초대를 받는다.
  // 주기적으로 다시 보내 친구들의 위치(어느 방인지)도 최신으로 유지한다.
  useEffect(() => {
    if (!idToken || isMock) return;
    const ping = () => connectionRef.current?.sendFriendsHello(idToken);
    ping();
    const timer = setInterval(ping, 15000);
    return () => clearInterval(timer);
  }, [idToken, isMock, phase]);

  // 로그인 토큰이 생기거나 갱신될 때마다 프로필(레벨/전적)을 받아온다. 실패해도 로그인 상태
  // (idToken)는 유지되므로 친구·로그아웃은 그대로 쓸 수 있고, 다음 토큰 갱신 때 자동 재시도된다.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchMyProfile(idToken);
        if (cancelled) return;
        setProfile(p);
        // 계정 닉네임은 "이번 로그인에서 처음 한 번만" 입력칸에 심는다. 매번 덮어쓰면 토큰이
        // 갱신될 때마다(약 1시간 주기, onIdTokenChanged) 사용자가 고쳐 둔 이름이 옛 이름으로
        // 되돌아간다 — "닉네임을 바꿔도 반영이 안 된다"의 원인이었다.
        if (!nicknameSeededRef.current) {
          nicknameSeededRef.current = true;
          useUIStore.getState().setNickname(p.nickname);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("[profile]", e);
        useUIStore.getState().showToast("전적을 불러오지 못했습니다 — 로그인은 유지됩니다");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);
  // 로그아웃 — 구글 세션 종료 + 로그인 상태 초기화 후 선택 관문으로 되돌린다(게스트로 이어할지 다시 고름).
  const handleLogout = async () => {
    await signOutGoogle();
    setIdToken(null);
    setProfile(null);
    setPhotoURL(null);
    setShowMyPage(false);
    setShowFriends(false);
    nicknameSeededRef.current = false; // 다음 로그인 때 그 계정 닉네임을 다시 심어야 한다
    setPhase("authChoice");
  };

  /**
   * 닉네임을 계정에 저장한다(로비 입력칸에서 수정을 끝냈을 때). 저장하면 친구 목록·검색·접속
   * 현황이 전부 새 이름을 쓴다 — 지금까진 방에 입장할 때만 반영돼 로비에서 고쳐도 남지 않았다.
   * 게스트는 계정이 없으므로 localStorage에만 남는다(기존 동작 그대로).
   */
  const handleSaveNickname = async (nickname: string) => {
    const name = nickname.trim().slice(0, 12);
    if (!idToken || !name || name === profile?.nickname) return;
    try {
      const p = await updateNickname(idToken, name);
      setProfile(p);
      useUIStore.getState().setNickname(p.nickname);
      localStorage.setItem("nickname", p.nickname);
      useUIStore.getState().showToast(`닉네임을 "${p.nickname}"으로 변경했습니다`);
      // 접속 현황(친구들이 보는 내 이름)도 바로 갱신되도록 즉시 한 번 알린다.
      connectionRef.current?.sendFriendsHello(idToken);
    } catch (e) {
      console.error("[nickname]", e);
      useUIStore.getState().showToast("닉네임 변경에 실패했습니다");
    }
  };
  // 게스트가 마이페이지의 "구글로 로그인"을 눌렀을 때 — 로그인 관문으로 돌려보낸다.
  const handleLoginPrompt = () => {
    setShowMyPage(false);
    setPhase("authChoice");
  };

  /**
   * 친구 초대. 이미 방에 있으면 그 방으로 바로 부르고, 로비에 있으면 비공개 방을 먼저 만든 뒤
   * (onRoomJoined에서) 초대를 쏜다. 어느 쪽이든 상대 화면에는 알림 배너가 뜬다.
   */
  const handleInviteFriend = (friend: { appUserId: number; nickname: string }) => {
    if (!idToken) return;
    const st = useUIStore.getState();
    if (st.currentRoom) {
      // 이미 방에 있으면 패널을 열어둔 채로 계속 부를 수 있게 한다(정원 8명까지 연속 초대).
      connectionRef.current?.sendFriendInvite(idToken, friend.appUserId);
      st.showToast(`${friend.nickname}님을 초대했습니다`);
      return;
    }
    setShowFriends(false); // 방을 새로 만드는 경우엔 대기실로 넘어가므로 닫는다
    const nick = (profile?.nickname ?? st.nickname).trim() || "player";
    pendingInviteRef.current = friend.appUserId; // 방이 생기면 그때 초대 전송
    connectionRef.current?.createRoom(
      // 처음 부른 친구 이름을 방 이름에 박으면 이후 다른 친구를 더 불렀을 때 이름이 어긋난다
      // (정원 8명) — 로비의 기본 방 이름과 같은 "○○의 방" 관례를 따른다.
      `${nick}의 방`,
      DEFAULT_MAP_ID,
      nick,
      localStorage.getItem("token") ?? undefined,
      idToken,
      true, // 비공개 — 초대받은 친구만 들어온다
    );
  };

  // 친구가 있는 방으로 따라 들어가기.
  const handleFollowFriend = (roomId: string) => {
    const st = useUIStore.getState();
    const nick = (profile?.nickname ?? st.nickname).trim() || "player";
    setShowFriends(false);
    connectionRef.current?.joinRoom(roomId, nick, localStorage.getItem("token") ?? undefined, idToken ?? undefined);
  };

  // 받은 초대 수락 — 비공개 방이면 코드로, 아니면 방 id로 입장한다.
  const handleAcceptInvite = () => {
    const inv = incomingInvite;
    if (!inv) return;
    setIncomingInvite(null);
    const st = useUIStore.getState();
    const nick = (profile?.nickname ?? st.nickname).trim() || "player";
    const token = localStorage.getItem("token") ?? undefined;
    if (inv.joinCode) {
      connectionRef.current?.joinByCode(inv.joinCode, nick, token, idToken ?? undefined);
    } else {
      connectionRef.current?.joinRoom(inv.roomId, nick, token, idToken ?? undefined);
    }
  };

  const handleJoin = (nickname: string) => {
    const token = localStorage.getItem("token") ?? undefined;
    connectionRef.current?.join(nickname, token);
    // 첫 참가자에게만 조작 안내 (한 번 보면 다시 안 뜸).
    if (!localStorage.getItem("onboarded")) {
      localStorage.setItem("onboarded", "1");
      setTimeout(
        () =>
          useUIStore
            .getState()
            .showToast("좌클릭으로 내 동 선택 → 우클릭으로 출정! 야만인을 물리치고 영토를 넓히세요"),
        900
      );
    }
  };

  return (
    <div className="app-root">
      {/* 배경음악 — 화면 전환과 무관하게 상시 재생(하단 중앙 토글 버튼). */}
      <BgmPlayer />
      {prepared && connectionRef.current && (
        <MapView prepared={prepared} connection={connectionRef.current} />
      )}
      <Hud connection={connectionRef.current} isMock={isMock} />
      {phase === "join" && <JoinScreen onJoin={handleJoin} />}
      {phase === "authChoice" && <AuthChoiceScreen onGuest={handleGuest} onLoggedIn={handleLoggedIn} />}
      {phase === "lobby" && connectionRef.current && (
        <LobbyScreen
          connection={connectionRef.current}
          idToken={idToken}
          profile={profile}
          onOpenFriends={() => setShowFriends(true)}
          onlineFriendCount={friendPresence.length}
          onSaveNickname={handleSaveNickname}
        />
      )}
      {phase === "room" && connectionRef.current && (
        <RoomWaitScreen
          connection={connectionRef.current}
          onOpenFriends={idToken ? () => setShowFriends(true) : null}
          onlineFriendCount={friendPresence.length}
        />
      )}
      {phase === "results" && connectionRef.current && <ResultsOverlay connection={connectionRef.current} />}

      {/* 계정 배지 — 로그인 여부와 무관하게(게스트는 기본 아이콘+닉네임) 로비/대기실/결과 화면
          우상단에 띄운다. 게임 화면(ready) 중엔 HUD 우상단 순위표와 겹치므로 숨긴다. */}
      {(phase === "lobby" || phase === "room" || phase === "results") && (
        <ProfileBadge
          nickname={profile?.nickname ?? (nickname || "게스트")}
          photoURL={loggedIn ? photoURL : null}
          onClick={() => setShowMyPage(true)}
        />
      )}
      {showMyPage && (
        <MyPage
          loggedIn={loggedIn}
          profile={profile}
          guestNickname={nickname}
          onClose={() => setShowMyPage(false)}
          onLogout={handleLogout}
          onOpenFriends={() => {
            setShowMyPage(false);
            setShowFriends(true);
          }}
          onLoginPrompt={handleLoginPrompt}
        />
      )}
      {showFriends && idToken && (
        <FriendsPanel
          idToken={idToken}
          onClose={() => setShowFriends(false)}
          onInvite={handleInviteFriend}
          onFollow={handleFollowFriend}
          presence={friendPresence}
        />
      )}
      {incomingInvite && phase !== "ready" && (
        <InviteBanner
          invite={incomingInvite}
          onAccept={handleAcceptInvite}
          onDismiss={() => setIncomingInvite(null)}
        />
      )}
    </div>
  );
}

export default App;
