import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.0.0";

const METADATA_KEY = "fabula-ultima-hud/party";
const TOKEN_LINK_KEY = "fabula-ultima-hud/linked-char-id";
const CLOCK_META_KEY = "fabula-ultima-hud/clock-data";
const POPOVER_ID = "fabula-ultima-hud/token-popover";
const CLOSE_EVENT = "fabula-ultima-hud/popover-closed";
const BASE_URL = "https://rochel-blezins.github.io/fabula-hud/index.html";
const DEFAULT_AVATAR = "https://placehold.co/150x180/101b3d/e2c07d?text=Hero";

// Detecta se está no modo janela individual de token (?charId=...)
const urlParams = new URLSearchParams(window.location.search);
const focusedCharId = urlParams.get("charId");

if (focusedCharId) {
  document.body.classList.add("token-mode");
}

let partyData = [];
let sceneClocks = [];
let currentOpenCharId = null;

// Elementos DOM
const partyListEl = document.getElementById("party-list");
const clocksListEl = document.getElementById("clocks-list");
const modal = document.getElementById("char-modal");
const form = document.getElementById("char-form");
const btnAdd = document.getElementById("btn-add-char");
const btnCancel = document.getElementById("btn-cancel");

const linkModal = document.getElementById("link-modal");
const linkForm = document.getElementById("link-form");
const heroSelect = document.getElementById("hero-select");
const btnCancelLink = document.getElementById("btn-cancel-link");

const clockModal = document.getElementById("clock-modal");
const clockForm = document.getElementById("clock-form");
const btnAddClock = document.getElementById("btn-add-clock");
const btnCancelClock = document.getElementById("btn-cancel-clock");

OBR.onReady(async () => {
  const metadata = await OBR.room.getMetadata();
  partyData = metadata[METADATA_KEY] || [];
  renderParty();

  // Sincronização em tempo real dos personagens
  OBR.room.onMetadataChange((newMetadata) => {
    partyData = newMetadata[METADATA_KEY] || [];
    renderParty();
  });

  if (!focusedCharId) {
    setupContextMenus();
    setupSelectionListener();
    setupClockSync();

    OBR.broadcast.onMessage(CLOSE_EVENT, () => {
      currentOpenCharId = null;
    });
  }
});

/* ==========================================================================
   SISTEMA DE RELÓGIOS (CLOCKS) ARRASTÁVEIS NO MAPA
   ========================================================================== */

// Gera o SVG do relógio estilo JRPG (círculo dividido + placa com título)
function buildClockSvgDataUrl(title, current, total, fillColor) {
  const cx = 130;
  const cy = 110;
  const r = 82;
  let slicesSvg = "";

  for (let i = 0; i < total; i++) {
    const startAngle = (i * 360) / total - 90;
    const endAngle = ((i + 1) * 360) / total - 90;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const largeArc = 360 / total > 180 ? 1 : 0;
    const isFilled = i < current;
    const sliceFill = isFilled ? fillColor : "#081230";

    const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    slicesSvg += `<path d="${d}" fill="${sliceFill}" stroke="#e2c07d" stroke-width="3" />`;
  }

  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.75"/>
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="#050b21" stroke="#e2c07d" stroke-width="4"/>
        ${slicesSvg}
        <circle cx="${cx}" cy="${cy}" r="12" fill="#050b21" stroke="#e2c07d" stroke-width="3"/>
        <rect x="14" y="206" width="232" height="44" rx="8" fill="#081438" stroke="#e2c07d" stroke-width="3"/>
        <text x="130" y="225" fill="#ffffff" font-family="sans-serif" font-weight="bold" font-size="14" text-anchor="middle">${safeTitle}</text>
        <text x="130" y="242" fill="#e2c07d" font-family="sans-serif" font-weight="bold" font-size="13" text-anchor="middle">${current} / ${total}</text>
      </g>
    </svg>
  `.trim();

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// Monitora todos os relógios existentes na cena atual
async function setupClockSync() {
  const isReady = await OBR.scene.isReady();
  if (isReady) {
    const items = await OBR.scene.items.getItems((item) => Boolean(item.metadata?.[CLOCK_META_KEY]));
    sceneClocks = items;
    renderClocks();
  }

  OBR.scene.onReadyChange(async (ready) => {
    if (ready) {
      const items = await OBR.scene.items.getItems((item) => Boolean(item.metadata?.[CLOCK_META_KEY]));
      sceneClocks = items;
      renderClocks();
    } else {
      sceneClocks = [];
      renderClocks();
    }
  });

  OBR.scene.items.onChange((items) => {
    sceneClocks = items.filter((item) => Boolean(item.metadata?.[CLOCK_META_KEY]));
    renderClocks();
  });
}

// Cria um novo Clock como item arrastável no centro da visão atual do mapa
async function createMapClock(title, total, color) {
  const ready = await OBR.scene.isReady();
  if (!ready) {
    await OBR.notification.show("Abra um mapa/cena antes de criar um Relógio!", "WARNING");
    return;
  }

  const viewportWidth = await OBR.viewport.getWidth();
  const viewportHeight = await OBR.viewport.getHeight();
  const scale = await OBR.viewport.getScale();
  const pos = await OBR.viewport.getPosition();

  const offset = (sceneClocks.length % 4) * 35;
  const worldX = (viewportWidth / 2 - pos.x) / scale + offset;
  const worldY = (viewportHeight / 2 - pos.y) / scale + offset;

  const svgUrl = buildClockSvgDataUrl(title, 0, total, color);
  const playerId = await OBR.player.getId();

  const clockItem = {
    id: crypto.randomUUID(),
    type: "IMAGE",
    name: `Clock: ${title}`,
    position: { x: worldX, y: worldY },
    rotation: 0,
    scale: { x: 1, y: 1 },
    visible: true,
    locked: false,
    layer: "PROP",
    zIndex: Date.now(),
    createdUserId: playerId,
    lastModified: new Date().toISOString(),
    lastModifiedUserId: playerId,
    image: {
      url: svgUrl,
      width: 260,
      height: 260,
      mime: "image/svg+xml",
    },
    grid: {
      dpi: 150,
      offset: { x: 130, y: 130 },
    },
    text: {
      richText: [],
      plainText: "",
      style: {
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeColor: "#000000",
        strokeOpacity: 1,
        strokeWidth: 0,
        textAlign: "CENTER",
        textAlignVertical: "MIDDLE",
        fontFamily: "Roboto",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.2,
        padding: 8,
      },
      type: "PLAIN",
      width: 260,
      height: 260,
    },
    textItemType: "LABEL",
    metadata: {
      [CLOCK_META_KEY]: {
        title,
        current: 0,
        total,
        color,
      },
    },
  };

  await OBR.scene.items.addItems([clockItem]);
  await OBR.notification.show(`Relógio "${title}" adicionado ao mapa! Arraste para posicionar.`, "SUCCESS");
}

// Avança ou retrocede segmentos de um Clock específico
window.adjustClock = async (itemId, delta) => {
  await OBR.scene.items.updateItems([itemId], (items) => {
    for (let item of items) {
      const data = item.metadata[CLOCK_META_KEY];
      if (!data) continue;

      const nextVal = Math.max(0, Math.min(data.total, data.current + delta));
      data.current = nextVal;
      item.image.url = buildClockSvgDataUrl(data.title, nextVal, data.total, data.color);
    }
  });
};

// Remove um Clock do mapa
window.deleteClock = async (itemId) => {
  await OBR.scene.items.deleteItems([itemId]);
};

// Renderiza a lista de Clocks ativos na HUD principal
function renderClocks() {
  if (!clocksListEl) return;

  if (sceneClocks.length === 0) {
    clocksListEl.innerHTML = `<p style="text-align:center; color:#9eb0e0; font-size:0.75rem; padding:6px;">Nenhum relógio ativo. Clique em "+ Clock" para criar.</p>`;
    return;
  }

  clocksListEl.innerHTML = sceneClocks
    .map((item) => {
      const data = item.metadata[CLOCK_META_KEY];
      const miniSvg = buildClockSvgDataUrl("", data.current, data.total, data.color);

      return `
        <div class="clock-item-row">
          <div class="clock-info">
            <img class="clock-mini-preview" src="${miniSvg}" alt="Clock" />
            <div>
              <div class="clock-title">${data.title}</div>
              <div class="clock-count">${data.current} / ${data.total} segmentos</div>
            </div>
          </div>
          <div class="card-controls">
            <div class="step-btns">
              <button onclick="adjustClock('${item.id}', -1)" title="-1 Segmento">-</button>
              <button onclick="adjustClock('${item.id}', 1)" title="+1 Segmento">+</button>
            </div>
            <button class="icon-btn" onclick="deleteClock('${item.id}')" title="Remover Relógio">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// Eventos do Modal de Clock
btnAddClock.addEventListener("click", () => {
  clockForm.reset();
  clockModal.showModal();
});

btnCancelClock.addEventListener("click", () => clockModal.close());

clockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("clock-name").value.trim();
  const total = parseInt(document.getElementById("clock-segments").value, 10);
  const color = document.getElementById("clock-color").value;

  clockModal.close();
  await createMapClock(title, total, color);
});

/* ==========================================================================
   MENUS DE CONTEXTO (TOKENS E RELÓGIOS NO MAPA)
   ========================================================================== */

function setupContextMenus() {
  // 1. Abrir manualmente a janela JRPG do token
  OBR.contextMenu.create({
    id: "fabula-ultima-hud/open-status",
    icons: [
      {
        icon: "https://api.iconify.design/game-icons:crystal-shine.svg?color=%23e2c07d",
        label: "Status JRPG",
        filter: {
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", TOKEN_LINK_KEY], operator: "!=", value: undefined },
          ],
        },
      },
    ],
    onClick(context) {
      const token = context.items[0];
      const charId = token.metadata[TOKEN_LINK_KEY];
      if (charId) {
        openTokenPopover(token, charId);
      }
    },
  });

  // 2. Vincular o token a um herói da party
  OBR.contextMenu.create({
    id: "fabula-ultima-hud/link-hero",
    icons: [
      {
        icon: "https://api.iconify.design/game-icons:linked-rings.svg?color=%23e2c07d",
        label: "Vincular Herói (Fabula)",
        filter: {
          every: [{ key: "layer", value: "CHARACTER" }],
        },
      },
    ],
    onClick(context) {
      const token = context.items[0];
      openLinkModal(token);
    },
  });

  // 3. Avançar +1 Segmento direto ao clicar no Relógio no mapa
  OBR.contextMenu.create({
    id: "fabula-ultima-hud/clock-plus",
    icons: [
      {
        icon: "https://api.iconify.design/mdi:clock-plus-outline.svg?color=%23e2c07d",
        label: "+1 Segmento",
        filter: {
          every: [{ key: ["metadata", CLOCK_META_KEY], operator: "!=", value: undefined }],
        },
      },
    ],
    onClick(context) {
      for (const item of context.items) {
        adjustClock(item.id, 1);
      }
    },
  });

  // 4. Voltar -1 Segmento direto ao clicar no Relógio no mapa
  OBR.contextMenu.create({
    id: "fabula-ultima-hud/clock-minus",
    icons: [
      {
        icon: "https://api.iconify.design/mdi:clock-minus-outline.svg?color=%23e2c07d",
        label: "-1 Segmento",
        filter: {
          every: [{ key: ["metadata", CLOCK_META_KEY], operator: "!=", value: undefined }],
        },
      },
    ],
    onClick(context) {
      for (const item of context.items) {
        adjustClock(item.id, -1);
      }
    },
  });
}

/* ==========================================================================
   JANELA FLUTUANTE DE TOKEN E GERENCIAMENTO DE HERÓIS
   ========================================================================== */

function setupSelectionListener() {
  OBR.player.onChange(async (player) => {
    const selection = player.selection;
    if (!selection || selection.length !== 1) return;

    const items = await OBR.scene.items.getItems([selection[0]]);
    if (items.length === 0) return;

    const token = items[0];
    const charId = token.metadata?.[TOKEN_LINK_KEY];

    if (charId && charId !== currentOpenCharId) {
      openTokenPopover(token, charId);
    }
  });
}

async function openTokenPopover(token, charId) {
  const viewportWidth = await OBR.viewport.getWidth();
  const viewportHeight = await OBR.viewport.getHeight();

  currentOpenCharId = charId;

  await OBR.popover.open({
    id: POPOVER_ID,
    url: `${BASE_URL}?charId=${charId}&v=4`,
    height: 155,
    width: 365,
    disableClickAway: true,
    anchorPosition: {
      left: Math.round(viewportWidth / 2),
      top: Math.round(viewportHeight - 82),
    },
    anchorOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
    transformOrigin: { horizontal: "CENTER", vertical: "BOTTOM" },
    marginThreshold: 16,
  });
}

window.closeTokenPopover = async () => {
  await OBR.broadcast.sendMessage(CLOSE_EVENT, {}, { destination: "LOCAL" });
  await OBR.popover.close(POPOVER_ID);
};

async function openLinkModal(token) {
  if (partyData.length === 0) {
    await OBR.notification.show("Crie um herói na HUD Party Status antes de vincular!", "WARNING");
    return;
  }

  document.getElementById("target-token-id").value = token.id;
  heroSelect.innerHTML = partyData
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  await OBR.action.open();
  linkModal.showModal();
}

btnCancelLink.addEventListener("click", () => linkModal.close());

linkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tokenId = document.getElementById("target-token-id").value;
  const selectedHeroId = heroSelect.value;

  await OBR.scene.items.updateItems([tokenId], (items) => {
    for (let item of items) {
      item.metadata[TOKEN_LINK_KEY] = selectedHeroId;
    }
  });

  linkModal.close();
  await OBR.notification.show("Token vinculado com sucesso!", "SUCCESS");
});

async function saveParty(newParty) {
  partyData = newParty;
  renderParty();
  await OBR.room.setMetadata({
    [METADATA_KEY]: newParty,
  });
}

window.adjustStat = (id, field, delta) => {
  const updated = partyData.map((char) => {
    if (char.id !== id) return char;
    let newVal = (char[field] || 0) + delta;

    if (newVal < 0) newVal = 0;
    if (field === "hp" && newVal > char.hpMax) newVal = char.hpMax;
    if (field === "mp" && newVal > char.mpMax) newVal = char.mpMax;
    if (field === "ip" && newVal > char.ipMax) newVal = char.ipMax;

    return { ...char, [field]: newVal };
  });
  saveParty(updated);
};

window.editChar = (id) => {
  const char = partyData.find((c) => c.id === id);
  if (!char) return;

  document.getElementById("modal-title").textContent = "Editar Herói";
  document.getElementById("char-id").value = char.id;
  document.getElementById("char-name").value = char.name;
  document.getElementById("char-img").value = char.img || "";
  document.getElementById("char-hp-max").value = char.hpMax;
  document.getElementById("char-mp-max").value = char.mpMax;
  document.getElementById("char-ip-max").value = char.ipMax;
  document.getElementById("char-def").value = char.def;
  document.getElementById("char-mdef").value = char.mdef;
  document.getElementById("char-fp").value = char.fp;

  modal.showModal();
};

window.deleteChar = (id) => {
  if (!confirm("Remover este personagem da HUD?")) return;
  const updated = partyData.filter((c) => c.id !== id);
  saveParty(updated);
};

btnAdd.addEventListener("click", () => {
  form.reset();
  document.getElementById("char-id").value = "";
  document.getElementById("modal-title").textContent = "Novo Herói";
  modal.showModal();
});

btnCancel.addEventListener("click", () => modal.close());

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("char-id").value;
  const hpMax = parseInt(document.getElementById("char-hp-max").value, 10);
  const mpMax = parseInt(document.getElementById("char-mp-max").value, 10);
  const ipMax = parseInt(document.getElementById("char-ip-max").value, 10);

  const charPayload = {
    id: id || crypto.randomUUID(),
    name: document.getElementById("char-name").value.trim(),
    img: document.getElementById("char-img").value.trim(),
    hpMax,
    mpMax,
    ipMax,
    def: parseInt(document.getElementById("char-def").value, 10),
    mdef: parseInt(document.getElementById("char-mdef").value, 10),
    fp: parseInt(document.getElementById("char-fp").value, 10),
  };

  let updated;
  if (id) {
    updated = partyData.map((c) =>
      c.id === id
        ? {
            ...c,
            ...charPayload,
            hp: Math.min(c.hp, hpMax),
            mp: Math.min(c.mp, mpMax),
            ip: Math.min(c.ip, ipMax),
          }
        : c
    );
  } else {
    updated = [
      ...partyData,
      { ...charPayload, hp: hpMax, mp: mpMax, ip: ipMax },
    ];
  }

  saveParty(updated);
  modal.close();
});

function renderParty() {
  const listToRender = focusedCharId
    ? partyData.filter((c) => c.id === focusedCharId)
    : partyData;

  if (listToRender.length === 0) {
    partyListEl.innerHTML = `<p style="text-align:center; color:#9eb0e0; font-size:0.8rem; padding:20px;">${
      focusedCharId
        ? "Herói não encontrado ou removido."
        : 'Nenhum herói na party. Clique em "+ Herói" para adicionar.'
    }</p>`;
    return;
  }

  partyListEl.innerHTML = listToRender
    .map((c) => {
      const hpPct = Math.max(0, Math.min(100, (c.hp / c.hpMax) * 100));
      const mpPct = Math.max(0, Math.min(100, (c.mp / c.mpMax) * 100));
      const isCrisis = c.hp <= Math.floor(c.hpMax / 2);

      return `
        <article class="char-card ${isCrisis ? "in-crisis" : ""}">
          <div class="portrait-box">
            <img class="portrait-img" src="${c.img || DEFAULT_AVATAR}" alt="${c.name}" onerror="this.src='${DEFAULT_AVATAR}'"/>
            ${isCrisis ? `<span class="crisis-badge">CRISE</span>` : ""}
          </div>

          <div class="stats-box">
            <div class="top-row">
              <span class="char-name">${c.name}</span>
              <div class="defenses">
                <span class="def-tag" title="Defesa Física">DEF ${c.def}</span>
                <span class="def-tag" title="Defesa Mágica">M.DEF ${c.mdef}</span>
              </div>
              <div class="card-controls">
                <button class="icon-btn" onclick="editChar('${c.id}')" title="Editar">✎</button>
                ${
                  focusedCharId
                    ? `<button class="icon-btn" onclick="closeTokenPopover()" title="Fechar janela">✕</button>`
                    : `<button class="icon-btn" onclick="deleteChar('${c.id}')" title="Remover">✕</button>`
                }
              </div>
            </div>

            <!-- Barra de PV -->
            <div class="bar-row">
              <div class="bar-label">
                <span style="color: ${isCrisis ? "#ff6b6b" : "#2ecc71"}">PV ${c.hp} / ${c.hpMax}</span>
                <div class="step-btns">
                  <button onclick="adjustStat('${c.id}', 'hp', -5)">-5</button>
                  <button onclick="adjustStat('${c.id}', 'hp', -1)">-</button>
                  <button onclick="adjustStat('${c.id}', 'hp', 1)">+</button>
                  <button onclick="adjustStat('${c.id}', 'hp', 5)">+5</button>
                </div>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${hpPct}%; background: ${isCrisis ? "var(--hp-crisis)" : "var(--hp-color)"};"></div>
              </div>
            </div>

            <!-- Barra de PM -->
            <div class="bar-row">
              <div class="bar-label">
                <span style="color: #5dade2">PM ${c.mp} / ${c.mpMax}</span>
                <div class="step-btns">
                  <button onclick="adjustStat('${c.id}', 'mp', -5)">-5</button>
                  <button onclick="adjustStat('${c.id}', 'mp', -1)">-</button>
                  <button onclick="adjustStat('${c.id}', 'mp', 1)">+</button>
                  <button onclick="adjustStat('${c.id}', 'mp', 5)">+5</button>
                </div>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${mpPct}%; background: var(--mp-color);"></div>
              </div>
            </div>

            <!-- PI e Pontos de Fabula -->
            <div class="bottom-resources">
              <div class="res-pill">
                <span style="color: var(--ip-color)">PI: ${c.ip}/${c.ipMax}</span>
                <div class="step-btns">
                  <button onclick="adjustStat('${c.id}', 'ip', -1)">-</button>
                  <button onclick="adjustStat('${c.id}', 'ip', 1)">+</button>
                </div>
              </div>

              <div class="res-pill">
                <span style="color: #d7bde2">✦ Fabula: ${c.fp}</span>
                <div class="step-btns">
                  <button onclick="adjustStat('${c.id}', 'fp', -1)">-</button>
                  <button onclick="adjustStat('${c.id}', 'fp', 1)">+</button>
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}
