import { firebaseConfig } from "./firebase-config.js";
import { createFirebaseStore, isFirebaseConfigReady } from "./firebase-store.js";

const STORAGE_KEY = "point-diary-v1";
const SPECIAL_QR_CODES = {
  "SPECIAL-100": 100,
  "SPECIAL-50": 50,
  "WELLNESS-20": 20,
};

const state = {
  data: loadData(),
  selectedPoints: 1,
  selectedIconUrl: "./assets/icons/car.png",
  calendarDate: new Date(),
  photoData: "",
  photoFile: null,
  qrStream: null,
  qrTimer: null,
  remote: null,
  unsubscribeRoom: null,
  syncStatus: "Local",
};

const $ = (id) => document.getElementById(id);

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultData() {
  const userId = newId();
  return {
    currentUserId: userId,
    displayName: "あなた",
    currentRoomId: `personal:${userId}`,
    rooms: {
      [`personal:${userId}`]: {
        id: `personal:${userId}`,
        type: "personal",
        title: "個人ルーム",
        passwordHash: "",
        posts: [],
      },
    },
  };
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.rooms ? saved : defaultData();
  } catch {
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function currentRoom() {
  if (!state.data.rooms[state.data.currentRoomId]) {
    state.data.rooms[state.data.currentRoomId] = {
      id: state.data.currentRoomId,
      type: state.data.currentRoomId.startsWith("group:") ? "group" : "personal",
      title: state.data.currentRoomId.replace(/^group:/, "") || "個人ルーム",
      passwordHash: "",
      posts: [],
    };
  }
  return state.data.rooms[state.data.currentRoomId];
}

function roomPosts() {
  return [...currentRoom().posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function hashPassword(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function safeRoomCode(value) {
  return value.trim().replace(/[^\w.-]/g, "-").slice(0, 32);
}

function dateKey(date) {
  const localDate = new Date(date);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

function canDelete(post) {
  const ageMs = Date.now() - new Date(post.createdAt).getTime();
  return post.authorId === state.data.currentUserId && ageMs < 24 * 60 * 60 * 1000;
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

async function initFirebase() {
  if (!isFirebaseConfigReady(firebaseConfig)) {
    state.syncStatus = "Local";
    return;
  }

  try {
    state.syncStatus = "Firebase接続中";
    render();
    state.remote = await createFirebaseStore(firebaseConfig);
    const uid = await state.remote.signIn();
    state.data.currentUserId = uid;
    await state.remote.saveUser(state.data.displayName || "あなた");
    saveData();
    state.syncStatus = "Firebase";
    await ensurePersonalRoom();
  } catch (error) {
    console.error(error);
    state.remote = null;
    state.syncStatus = "Local";
    render();
  }
}

function subscribeCurrentRoom() {
  if (!state.remote) return;
  if (state.unsubscribeRoom) state.unsubscribeRoom();

  state.unsubscribeRoom = state.remote.subscribeRoom(
    state.data.currentRoomId,
    (room) => {
      state.data.rooms[room.id] = {
        id: room.id,
        type: room.type,
        title: room.title,
        passwordHash: room.passwordHash || "",
        posts: room.posts || [],
      };
      saveData();
      render();
    },
    (error) => {
      console.error(error);
      state.syncStatus = "Firebaseエラー";
      render();
    },
  );
}

async function setRoom(roomId) {
  state.data.currentRoomId = roomId;
  saveData();
  subscribeCurrentRoom();
  render();
}

async function ensurePersonalRoom() {
  const id = `personal:${state.data.currentUserId}`;
  const room = {
    id,
    roomCode: id,
    type: "personal",
    title: "個人ルーム",
    passwordHash: "",
    displayName: state.data.displayName || "あなた",
  };

  if (state.remote) await state.remote.joinRoom(room);

  if (!state.data.rooms[id]) {
    state.data.rooms[id] = {
      id,
      type: "personal",
      title: "個人ルーム",
      passwordHash: "",
      posts: [],
    };
  }
  await setRoom(id);
}

async function enterGroup() {
  const code = safeRoomCode($("groupId").value);
  const password = $("groupPassword").value.trim();
  if (!code || !password) return;

  const roomId = `group:${code}`;
  const passwordHash = hashPassword(password);
  const existing = state.data.rooms[roomId];

  if (!state.remote && existing && existing.passwordHash !== passwordHash) {
    $("qrStatus").textContent = "PWが違います";
    return;
  }

  try {
    if (state.remote) {
      await state.remote.joinRoom({
        id: roomId,
        roomCode: code,
        type: "group",
        title: code,
        passwordHash,
        displayName: state.data.displayName || "あなた",
      });
    }

    if (!existing) {
      state.data.rooms[roomId] = {
        id: roomId,
        type: "group",
        title: code,
        passwordHash,
        posts: [],
      };
    }

    await setRoom(roomId);
  } catch (error) {
    $("qrStatus").textContent = error.message === "wrong-password" ? "PWが違います" : "入室エラー";
  }
}

async function addPost(points, kind = "normal", textOverride = "") {
  const text = textOverride || $("postText").value.trim();

  const post = {
    id: newId(),
    authorId: state.data.currentUserId,
    authorName: state.data.displayName || "あなた",
    points: kind === "normal" ? 1 : points,
    text: text || (kind === "qr" ? "QRボーナス" : "アイコン記録"),
    photoData: kind === "normal" ? state.photoData : "",
    iconUrl: kind === "normal" ? state.selectedIconUrl : "",
    kind,
    createdAt: new Date().toISOString(),
  };
  const photoFile = kind === "normal" ? state.photoFile : null;

  if (state.remote) {
    state.syncStatus = "Firebase保存中";
    render();
    try {
      await state.remote.addPost(state.data.currentRoomId, post, photoFile);
      clearComposer();
      state.syncStatus = "Firebase";
    } catch (error) {
      console.error(error);
      state.syncStatus = "Firebaseエラー";
    }
    render();
    return;
  }

  currentRoom().posts.push(post);
  clearComposer();
  saveData();
  render();
}

function clearComposer() {
  $("postText").value = "";
  $("photoInput").value = "";
  $("photoName").textContent = "";
  state.photoData = "";
  state.photoFile = null;
  state.selectedIconUrl = "./assets/icons/car.png";
  renderIconSelection();
}

async function deletePost(postId) {
  const room = currentRoom();
  const post = room.posts.find((item) => item.id === postId);
  if (!post || !canDelete(post)) return;

  if (state.remote) {
    await state.remote.deletePost(state.data.currentRoomId, postId);
    return;
  }

  room.posts = room.posts.filter((item) => item.id !== postId);
  saveData();
  render();
}

async function applyQrCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const points = SPECIAL_QR_CODES[code];
  if (!points) {
    $("qrStatus").textContent = "未登録QR";
    return;
  }
  await addPost(points, "qr", `${code} ボーナス`);
  $("qrStatus").textContent = `${code} +${points}`;
}

async function startQr() {
  if (!navigator.mediaDevices || !window.BarcodeDetector) {
    $("qrStatus").textContent = "手入力で追加";
    return;
  }

  const video = $("qrVideo");
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  state.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  video.srcObject = state.qrStream;
  await video.play();
  $("qrStatus").textContent = "読み取り中";

  state.qrTimer = window.setInterval(async () => {
    if (video.readyState < 2) return;
    const codes = await detector.detect(video);
    if (codes.length) {
      await applyQrCode(codes[0].rawValue);
      stopQr();
    }
  }, 700);
}

function stopQr() {
  if (state.qrTimer) window.clearInterval(state.qrTimer);
  state.qrTimer = null;
  if (state.qrStream) {
    state.qrStream.getTracks().forEach((track) => track.stop());
  }
  state.qrStream = null;
  $("qrVideo").srcObject = null;
}

function totals() {
  const posts = currentRoom().posts;
  const today = dateKey(new Date());
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  return {
    today: posts
      .filter((post) => dateKey(post.createdAt) === today)
      .reduce((sum, post) => sum + post.points, 0),
    month: posts
      .filter((post) => {
        const created = new Date(post.createdAt);
        return created.getFullYear() === year && created.getMonth() === month;
      })
      .reduce((sum, post) => sum + post.points, 0),
    count: posts.length,
  };
}

function renderCalendar() {
  const grid = $("calendarGrid");
  grid.innerHTML = "";

  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  $("calendarTitle").textContent = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
  }).format(state.calendarDate);

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const postsByDate = currentRoom().posts.reduce((map, post) => {
    const key = dateKey(post.createdAt);
    map[key] = map[key] || [];
    map[key].push(post);
    return map;
  }, {});

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const posts = postsByDate[key] || [];
    const cell = document.createElement("button");
    cell.className = "day-cell";
    cell.type = "button";
    if (date.getMonth() !== month) cell.classList.add("outside");
    if (isSameDay(date, new Date())) cell.classList.add("today");
    cell.innerHTML = `
      <span class="date-num">${date.getDate()}</span>
      <div class="author-dots">${posts
        .slice(0, 8)
        .map((post) =>
          post.iconUrl
            ? `<img src="${escapeHtml(post.iconUrl)}" alt="" title="${escapeHtml(post.authorName)}" />`
            : `<span title="${escapeHtml(post.authorName)}"></span>`,
        )
        .join("")}</div>
      <span class="day-points">${posts.length}</span>
    `;
    grid.appendChild(cell);
  }
}

function renderTimeline() {
  const timeline = $("timeline");
  const template = $("postTemplate");
  timeline.innerHTML = "";

  const posts = roomPosts();
  if (!posts.length) {
    timeline.innerHTML = '<p class="muted">まだ投稿がありません。</p>';
    return;
  }

  for (const post of posts) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".post-author").textContent = post.authorName;
    node.querySelector(".post-time").textContent = formatDateTime(post.createdAt);
    const postPoints = node.querySelector(".post-points");
    if (post.iconUrl) {
      postPoints.innerHTML = `<img src="${escapeHtml(post.iconUrl)}" alt="" />`;
    } else {
      postPoints.textContent = `+${post.points}`;
    }
    node.querySelector(".post-text").textContent = post.text;
    if (post.photoData || post.photoUrl) {
      node.querySelector(".post-image").src = post.photoData || post.photoUrl;
    }
    const button = node.querySelector(".delete-post");
    button.disabled = !canDelete(post);
    button.textContent = canDelete(post) ? "削除" : "ロック済み";
    button.addEventListener("click", () => deletePost(post.id));
    timeline.appendChild(node);
  }
}

function renderAi() {
  const posts = currentRoom().posts;
  const total = posts.reduce((sum, post) => sum + post.points, 0);
  const bestDay = Object.entries(
    posts.reduce((map, post) => {
      const key = dateKey(post.createdAt);
      map[key] = (map[key] || 0) + post.points;
      return map;
    }, {}),
  ).sort((a, b) => b[1] - a[1])[0];
  const authors = posts.reduce((map, post) => {
    map[post.authorName] = (map[post.authorName] || 0) + post.points;
    return map;
  }, {});
  const topAuthor = Object.entries(authors).sort((a, b) => b[1] - a[1])[0];

  $("aiInsight").innerHTML = `
    <strong>${total ? `合計 ${total} 個` : "記録待ち"}</strong>
    <p>${bestDay ? `いちばん伸びた日は ${bestDay[0]} の ${bestDay[1]} 個。` : "最初の投稿を作ると傾向が出ます。"}</p>
    <p>${topAuthor ? `今のリードは ${escapeHtml(topAuthor[0])} さん。` : "グループでは投稿者ごとの動きも見えます。"}</p>
    <p>${posts.length >= 3 ? "写真や短い日記が混ざるほど、AIコメントの精度を上げやすくなります。" : "3件以上たまると、週次コメントに近い見え方になります。"}</p>
  `;
}

function render() {
  const room = currentRoom();
  const total = totals();
  $("displayName").value = state.data.displayName;
  $("syncStatus").textContent = state.syncStatus;
  $("roomMode").textContent = room.type === "group" ? "Group" : "Personal";
  $("roomTitle").textContent = room.title;
  $("todayPoints").textContent = total.today;
  $("monthPoints").textContent = total.month;
  $("postCount").textContent = total.count;
  $("lockHint").textContent = "投稿から24時間後に削除ロック";
  renderCalendar();
  renderTimeline();
  renderAi();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bindEvents() {
  $("todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
  }).format(new Date());

  $("displayName").addEventListener("input", async (event) => {
    state.data.displayName = event.target.value.trim() || "あなた";
    saveData();
    if (state.remote) await state.remote.saveUser(state.data.displayName);
    render();
  });

  $("personalTab").addEventListener("click", () => {
    $("personalTab").classList.add("active");
    $("groupTab").classList.remove("active");
    $("personalForm").classList.remove("hidden");
    $("groupForm").classList.add("hidden");
  });

  $("groupTab").addEventListener("click", () => {
    $("groupTab").classList.add("active");
    $("personalTab").classList.remove("active");
    $("groupForm").classList.remove("hidden");
    $("personalForm").classList.add("hidden");
  });

  $("enterPersonal").addEventListener("click", () => ensurePersonalRoom());
  $("enterGroup").addEventListener("click", () => enterGroup());
  $("addPost").addEventListener("click", () => addPost(state.selectedPoints));
  $("refreshAi").addEventListener("click", renderAi);
  $("startQr").addEventListener("click", () =>
    startQr().catch(() => {
      $("qrStatus").textContent = "カメラ不可";
    }),
  );
  $("stopQr").addEventListener("click", stopQr);
  $("applyQr").addEventListener("click", () => applyQrCode($("manualQr").value));

  $("prevMonth").addEventListener("click", () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    render();
  });

  $("nextMonth").addEventListener("click", () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    render();
  });

  document.querySelectorAll(".icon-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedIconUrl = button.dataset.icon || "";
      renderIconSelection();
    });
  });

  $("photoInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.photoFile = file;
    $("photoName").textContent = file.name;
    renderIconSelection();
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      state.photoData = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

function renderIconSelection() {
  document.querySelectorAll(".icon-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.icon === state.selectedIconUrl);
  });
}

bindEvents();
render();
initFirebase();
