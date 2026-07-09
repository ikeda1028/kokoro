const FIREBASE_VERSION = "12.15.0";

export function isFirebaseConfigReady(config) {
  return Boolean(
    config &&
      config.apiKey &&
      config.projectId &&
      !String(config.apiKey).startsWith("YOUR_") &&
      !String(config.projectId).startsWith("YOUR_"),
  );
}

export async function createFirebaseStore(config) {
  if (!isFirebaseConfigReady(config)) return null;

  const [{ initializeApp }, authModule, firestoreModule, storageModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-storage.js`),
  ]);

  const app = initializeApp(config);
  const auth = authModule.getAuth(app);
  const db = firestoreModule.getFirestore(app);
  const storage = storageModule.getStorage(app);

  async function signIn() {
    if (!auth.currentUser) {
      await authModule.signInAnonymously(auth);
    }
    return auth.currentUser.uid;
  }

  async function saveUser(displayName) {
    const uid = await signIn();
    await firestoreModule.setDoc(
      firestoreModule.doc(db, "users", uid),
      {
        displayName,
        updatedAt: firestoreModule.serverTimestamp(),
      },
      { merge: true },
    );
    return uid;
  }

  async function joinRoom(room) {
    const uid = await signIn();
    const roomRef = firestoreModule.doc(db, "rooms", room.id);
    const roomSnap = await firestoreModule.getDoc(roomRef);

    if (roomSnap.exists()) {
      const existing = roomSnap.data();
      if (existing.passwordHash && existing.passwordHash !== room.passwordHash) {
        throw new Error("wrong-password");
      }
    } else {
      await firestoreModule.setDoc(roomRef, {
        id: room.id,
        roomCode: room.roomCode,
        title: room.title,
        type: room.type,
        passwordHash: room.passwordHash || "",
        createdBy: uid,
        createdAt: firestoreModule.serverTimestamp(),
        updatedAt: firestoreModule.serverTimestamp(),
      });
    }

    await firestoreModule.setDoc(
      firestoreModule.doc(db, "rooms", room.id, "members", uid),
      {
        userId: uid,
        displayName: room.displayName,
        joinedAt: firestoreModule.serverTimestamp(),
      },
      { merge: true },
    );
  }

  function subscribeRoom(roomId, onChange, onError) {
    const roomRef = firestoreModule.doc(db, "rooms", roomId);
    const postsQuery = firestoreModule.query(
      firestoreModule.collection(db, "rooms", roomId, "posts"),
      firestoreModule.orderBy("createdAt", "desc"),
    );

    let roomData = null;
    let posts = [];
    let heartEvents = [];

    const emit = () => {
      if (!roomData) return;
      onChange({
        ...roomData,
        posts,
        heartEvents,
      });
    };

    const unsubscribeRoom = firestoreModule.onSnapshot(
      roomRef,
      (snapshot) => {
        roomData = snapshot.exists()
          ? snapshot.data()
          : { id: roomId, type: "group", title: roomId, passwordHash: "" };
        emit();
      },
      onError,
    );

    const unsubscribePosts = firestoreModule.onSnapshot(
      postsQuery,
      (snapshot) => {
        posts = snapshot.docs
          .map((postDoc) => {
            const post = postDoc.data();
            return {
              id: postDoc.id,
              authorId: post.authorId,
              authorName: post.authorName,
              points: post.points,
              text: post.text || "",
              photoData: post.photoUrl || "",
              photoUrl: post.photoUrl || "",
              iconUrl: post.iconUrl || "",
              kind: post.kind || "normal",
              createdAt: toIso(post.createdAt),
            };
          })
          .filter((post) => !post.deletedAt);
        emit();
      },
      onError,
    );

    const heartQuery = firestoreModule.query(
      firestoreModule.collection(db, "rooms", roomId, "heartEvents"),
      firestoreModule.orderBy("createdAt", "desc"),
      firestoreModule.limit(80),
    );

    const unsubscribeHearts = firestoreModule.onSnapshot(
      heartQuery,
      (snapshot) => {
        heartEvents = snapshot.docs.map((heartDoc) => {
          const heart = heartDoc.data();
          return {
            id: heartDoc.id,
            authorId: heart.authorId,
            authorName: heart.authorName || "",
            createdAt: toIso(heart.createdAt),
          };
        });
        emit();
      },
      onError,
    );

    return () => {
      unsubscribeRoom();
      unsubscribePosts();
      unsubscribeHearts();
    };
  }

  async function addPost(roomId, post, photoFile) {
    const uid = await signIn();
    let photoUrl = "";

    if (photoFile) {
      const ext = photoFile.name.split(".").pop() || "jpg";
      const path = `rooms/${roomId}/posts/${uid}-${Date.now()}.${ext}`;
      const fileRef = storageModule.ref(storage, path);
      await storageModule.uploadBytes(fileRef, photoFile);
      photoUrl = await storageModule.getDownloadURL(fileRef);
    }

    await firestoreModule.addDoc(firestoreModule.collection(db, "rooms", roomId, "posts"), {
      authorId: uid,
      authorName: post.authorName,
      points: post.points,
      text: post.text,
      photoUrl,
      iconUrl: post.iconUrl || "",
      kind: post.kind,
      createdAt: firestoreModule.serverTimestamp(),
      lockedAt: firestoreModule.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    });
  }

  async function deletePost(roomId, postId) {
    await firestoreModule.deleteDoc(firestoreModule.doc(db, "rooms", roomId, "posts", postId));
  }

  async function sendHeart(roomId, heart) {
    const uid = await signIn();
    await firestoreModule.addDoc(firestoreModule.collection(db, "rooms", roomId, "heartEvents"), {
      authorId: uid,
      authorName: heart.authorName,
      createdAt: firestoreModule.serverTimestamp(),
    });
  }

  return {
    addPost,
    deletePost,
    joinRoom,
    saveUser,
    sendHeart,
    signIn,
    subscribeRoom,
  };
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
