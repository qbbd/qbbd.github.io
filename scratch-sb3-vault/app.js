// Scratch sb3 Vault — Solid Pod × Nostr × TurboWarp
// ビルド不要。ESM CDN (esm.sh) からライブラリを読み込みます。

import {
  login,
  handleIncomingRedirect,
  getDefaultSession,
  fetch as solidFetch,
} from "https://esm.sh/@inrupt/solid-client-authn-browser@2?bundle";

import {
  getSolidDataset,
  getContainedResourceUrlAll,
  createContainerAt,
  saveFileInContainer,
  getSourceUrl,
  overwriteFile,
} from "https://esm.sh/@inrupt/solid-client@2?bundle";

import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip19,
} from "https://esm.sh/nostr-tools@2?bundle";

// ---------- 設定 ----------
const CONTAINER_NAME = "scratch-sb3-vault/"; // Pod内の保存先フォルダ
const NOSTR_KIND = 31337; // 30000番台=パラメータ化可能置換イベント。d タグ = プロジェクトID
const APP_TAG = "scratch-sb3-vault";
const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

const pool = new SimplePool();

// ---------- Solid Pod ログイン ----------
const loginBtn = document.getElementById("loginBtn");
const whoami = document.getElementById("whoami");
const fileInput = document.getElementById("fileInput");
const titleInput = document.getElementById("titleInput");
const uploadBtn = document.getElementById("uploadBtn");
const publishBtn = document.getElementById("publishBtn");
const uploadStatus = document.getElementById("uploadStatus");

let session = getDefaultSession();
let lastSavedFileUrl = null;
let lastProjectId = null;

async function initSolid() {
  await handleIncomingRedirect({ restorePreviousSession: true });
  session = getDefaultSession();
  refreshAuthUI();
}

function refreshAuthUI() {
  if (session.info.isLoggedIn) {
    loginBtn.textContent = "ログアウト";
    whoami.textContent = session.info.webId;
    uploadBtn.disabled = !fileInput.files.length;
  } else {
    loginBtn.textContent = "Solid Podでログイン";
    whoami.textContent = "";
    uploadBtn.disabled = true;
  }
}

loginBtn.addEventListener("click", async () => {
  if (session.info.isLoggedIn) {
    await session.logout();
    refreshAuthUI();
    return;
  }
  const issuer = prompt(
    "SolidのIdentity Provider(例: https://solidcommunity.net)を入力してください",
    "https://solidcommunity.net"
  );
  if (!issuer) return;
  await login({
    oidcIssuer: issuer,
    redirectUrl: window.location.href.split("#")[0].split("?")[0],
    clientName: "Scratch sb3 Vault",
  });
});

fileInput.addEventListener("change", () => {
  uploadBtn.disabled = !(session.info.isLoggedIn && fileInput.files.length);
});

// ---------- Podへアップロード ----------
uploadBtn.addEventListener("click", async () => {
  if (!fileInput.files.length) return;
  const file = fileInput.files[0];
  const title = titleInput.value.trim() || file.name.replace(/\.sb3$/i, "");
  uploadStatus.textContent = "Podへアップロード中...";
  try {
    const podRoot = await getPodRoot();
    const containerUrl = podRoot + CONTAINER_NAME;
    await ensureContainer(containerUrl);

    const projectId = crypto.randomUUID();
    const targetUrl = containerUrl + projectId + ".sb3";

    const buf = await file.arrayBuffer();
    await overwriteFile(targetUrl, new Blob([buf], { type: "application/octet-stream" }), {
      contentType: "application/octet-stream",
      fetch: solidFetch,
    });

    lastSavedFileUrl = targetUrl;
    lastProjectId = projectId;
    titleInput.dataset.savedTitle = title;
    uploadStatus.textContent =
      `保存しました。Project ID: ${projectId}\n公開URL: ${targetUrl}\n` +
      `※このURLが公開読み取り可能(CORS: Access-Control-Allow-Origin: *)になるよう、` +
      `Podの ${CONTAINER_NAME} フォルダのACLを「公開読み取り可」に設定してください。`;
    publishBtn.disabled = false;
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "アップロード失敗: " + err.message;
  }
});

async function getPodRoot() {
    const res = await solidFetch(session.info.webId, {
        headers: {
            Accept: "text/turtle",
        },
    });

    const ttl = await res.text();

    const m = ttl.match(
        /<http:\/\/www\.w3\.org\/ns\/pim\/space#storage>\s*<([^>]+)>/
    );

    if (!m) {
        throw new Error("Pod Storageが見つかりません");
    }

    return m[1];
}

async function ensureContainer(containerUrl) {
  try {
    await getSolidDataset(containerUrl, { fetch: solidFetch });
  } catch {
    await createContainerAt(containerUrl, { fetch: solidFetch });
  }
}

// ---------- Nostrへ公開 ----------
function getNostrSigner() {
  // NIP-07拡張機能(nos2xなど)があれば優先使用。無ければローカル鍵を生成/再利用。
  if (window.nostr) {
    return {
      type: "extension",
      getPublicKey: () => window.nostr.getPublicKey(),
      signEvent: (evt) => window.nostr.signEvent(evt),
    };
  }
  let sk = localStorage.getItem("sb3vault_nostr_sk");
  if (!sk) {
    sk = Array.from(generateSecretKey())
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem("sb3vault_nostr_sk", sk);
  }
  const skBytes = Uint8Array.from(sk.match(/.{2}/g).map((h) => parseInt(h, 16)));
  return {
    type: "local",
    getPublicKey: async () => getPublicKey(skBytes),
    signEvent: async (evt) => finalizeEvent(evt, skBytes),
  };
}

publishBtn.addEventListener("click", async () => {
  if (!lastSavedFileUrl || !lastProjectId) return;
  uploadStatus.textContent = "Nostrに公開中...";
  try {
    const signer = getNostrSigner();
    const pubkey = await signer.getPublicKey();
    const title = titleInput.dataset.savedTitle || "無題のプロジェクト";

    const unsigned = {
      kind: NOSTR_KIND,
      created_at: Math.floor(Date.now() / 1000),
      pubkey,
      tags: [
        ["d", lastProjectId],
        ["title", title],
        ["url", lastSavedFileUrl],
        ["t", APP_TAG],
      ],
      content: JSON.stringify({
        title,
        projectId: lastProjectId,
        url: lastSavedFileUrl,
        app: APP_TAG,
      }),
    };

    const signed = await signer.signEvent(unsigned);
    await Promise.any(pool.publish(RELAYS, signed));

    uploadStatus.textContent = `Nostrに公開しました！ Project ID: ${lastProjectId}`;
    loadProjects();
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "公開失敗: " + err.message;
  }
});

// ---------- 一覧取得(Nostrから最新プロジェクトを購読) ----------
const projectList = document.getElementById("projectList");
const relayStatus = document.getElementById("relayStatus");
const refreshBtn = document.getElementById("refreshBtn");

async function loadProjects() {
  projectList.innerHTML = "";
  relayStatus.textContent = "リレーから取得中...";
  const seen = new Map(); // projectId -> event(最新のcreated_atのみ保持)

  const events = await pool.querySync(RELAYS, {
    kinds: [NOSTR_KIND],
    "#t": [APP_TAG],
    limit: 100,
  });

  for (const ev of events) {
    const idTag = ev.tags.find((t) => t[0] === "d");
    const id = idTag ? idTag[1] : ev.id;
    if (!seen.has(id) || seen.get(id).created_at < ev.created_at) {
      seen.set(id, ev);
    }
  }

  const list = Array.from(seen.values()).sort((a, b) => b.created_at - a.created_at);
  relayStatus.textContent = `${list.length}件のプロジェクト`;

  for (const ev of list) {
    let data;
    try {
      data = JSON.parse(ev.content);
    } catch {
      continue;
    }
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    const b = document.createElement("b");
    b.textContent = data.title || "無題";
    const small = document.createElement("small");
    small.textContent = `ID: ${data.projectId} / ${new Date(ev.created_at * 1000).toLocaleString()}`;
    meta.append(b, small);

    const playBtn = document.createElement("button");
    playBtn.textContent = "▶ 実行";
    playBtn.addEventListener("click", () => playProject(data.projectId, data.title, data.url));

    li.append(meta, playBtn);
    projectList.appendChild(li);
  }
}

refreshBtn.addEventListener("click", loadProjects);

// ---------- TurboWarpで再生 ----------
const playerPanel = document.getElementById("playerPanel");
const playerTitle = document.getElementById("playerTitle");
const playerId = document.getElementById("playerId");
const twFrame = document.getElementById("twFrame");
const closePlayer = document.getElementById("closePlayer");

function playProject(projectId, title, sb3Url) {
  playerTitle.textContent = title || "再生中";
  playerId.textContent = projectId;
  // TurboWarp: https://turbowarp.org/?project_url=<CORS対応の直リンク>
  const src = `https://turbowarp.org/?project_url=${encodeURIComponent(sb3Url)}`;
  twFrame.src = src;
  playerPanel.hidden = false;
  playerPanel.scrollIntoView({ behavior: "smooth" });

  // URLにプロジェクトIDを反映(共有しやすいように)
  history.pushState(null, "", `?p=${encodeURIComponent(projectId)}`);
}

closePlayer.addEventListener("click", () => {
  twFrame.src = "about:blank";
  playerPanel.hidden = true;
  history.pushState(null, "", location.pathname);
});

// URLに ?p=projectId が付いていたら該当プロジェクトを自動再生
async function autoPlayFromUrl() {
  const params = new URLSearchParams(location.search);
  const pid = params.get("p");
  if (!pid) return;
  const events = await pool.querySync(RELAYS, {
    kinds: [NOSTR_KIND],
    "#d": [pid],
    limit: 5,
  });
  if (!events.length) return;
  const ev = events.sort((a, b) => b.created_at - a.created_at)[0];
  try {
    const data = JSON.parse(ev.content);
    playProject(data.projectId, data.title, data.url);
  } catch {}
}

// ---------- 初期化 ----------
(async function init() {
  await initSolid();
  await loadProjects();
  await autoPlayFromUrl();
})();
console.log(session.info)
