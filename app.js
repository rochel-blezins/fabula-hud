import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.0.0";

const METADATA_KEY = "fabula-ultima-hud/party";
const TOKEN_LINK_KEY = "fabula-ultima-hud/linked-char-id";
const CLOCK_META_KEY = "fabula-ultima-hud/clock-data";
const CLOCK_PART_KEY = "fabula-ultima-hud/clock-part";
const POPOVER_ID = "fabula-ultima-hud/token-popover";
const CLOSE_EVENT = "fabula-ultima-hud/popover-closed";
const BASE_URL = "https://rochel-blezins.github.io/fabula-hud/index.html";
const DEFAULT_AVATAR = "https://placehold.co/150x180/101b3d/e2c07d?text=Hero";

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
   SISTEMA DE RELÓGIOS (CLOCKS) NATIVOS NO MAPA
   ========================================================================== */

// Miniatura SVG para exibir na lista lateral da HUD
function buildMiniClockSvg(current, total, fillColor) {
  const cx = 30;
  const cy = 30;
  const r = 24;
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
    const sliceFill = i < current ? fillColor : "#081230";

    const d = `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
    slicesSvg += `<path d="${d}" fill="${sliceFill}" stroke="#e2c07d" stroke-width="1.5" />`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="#050b21" stroke="#e2c07d" stroke-width="2"/>${slicesSvg}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// Constrói fatias usando apenas MOVE (0), LINE (1) e CLOSE (3) — 100% compatível com o Owlbear!
function buildPolygonSlices(cx, cy, r, total, startIndex, endIndex) {
  const cmds = [];
  const arcSteps = 14; // Suavidade da curva de cada fatia

  for (let i = startIndex; i < endIndex; i++) {
    const startAngle = (i * 360) / total - 90;
    const endAngle = ((i + 1) * 360) / total - 90;

    cmds.push([0, cx, cy]); // MOVE para o centro

    for (let s = 0; s <= arcSteps; s++) {
      const angle = startAngle + ((endAngle - startAngle) * s) / arcSteps;
      const rad = (angle * Math.PI) / 180;
      const px = cx + r * Math.cos(rad);
      const py = cy + r * Math.sin(rad);
      cmds.push([1, px, py]); // LINE ao longo da borda
    }

    cmds.push([3]); // CLOSE fatia
  }
  return cmds;
}

// Monitora todos os relógios existentes na cena atual
async function setupClockSync() {
  const isReady = await OBR.scene.isReady();
  if (isReady) {
    const items = await OBR.scene.items.getItems(
      (item) => item.metadata?.[CLOCK_PART_KEY] === "BASE"
    );
    sceneClocks = items;
    renderClocks();
  }

  OBR.scene.onReadyChange(async (ready) => {
    if (ready) {
      const items = await OBR.scene.items.getItems(
        (item) => item.metadata?.[CLOCK_PART_KEY] === "BASE"
      );
      sceneClocks = items;
      renderClocks();
    } else {
      sceneClocks = [];
      renderClocks();
    }
  });

  OBR.scene.items.onChange((items) => {
    sceneClocks = items.filter((item) => item.metadata?.[CLOCK_PART_KEY] === "BASE");
    renderClocks();
  });
}

// Cria um Clock composto por Círculo Nativo + Fatias + Texto anexados
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
  const playerId = await OBR.player.getId();

  const offset = (sceneClocks.length % 4) * 40;
  const worldX = (viewportWidth / 2 - pos.x) / scale + offset;
  const worldY = (viewportHeight / 2 - pos.y) / scale + offset;

  const baseId = crypto.randomUUID();
  const gridLinesId = crypto.randomUUID();
  const fillId = crypto.randomUUID();
  const labelId = crypto.randomUUID();
  const r = 72;
  const now = new Date().toISOString();

  const commonProps = {
    rotation: 0,
    scale: { x: 1, y: 1 },
    visible: true,
    locked: false,
    layer: "PROP",
    createdUserId: playerId,
    lastModified: now,
    lastModifiedUserId: playerId,
  };

  // 1. Círculo principal (SHAPE nativo do Owlbear — sempre renderiza!)
  const baseCircle = {
    ...commonProps,
    id: baseId,
    type: "SHAPE",
    shapeType: "CIRCLE",
    name: `Clock: ${title}`,
    position: { x: worldX, y: worldY },
    width: r * 2,
    height: r * 2,
    zIndex: Date.now(),
    style: {
      fillColor: "#081230",
      fillOpacity: 0.96,
      strokeColor: "#e2c07d",
      strokeOpacity: 1,
      strokeWidth: 4,
      strokeDash: [],
    },
    metadata: {
      [CLOCK_PART_KEY]: "BASE",
      [CLOCK_META_KEY]: {
        title,
        current: 0,
        total,
        color,
        fillId,
        gridLinesId,
        labelId,
      },
    },
  };

  // 2. Fatias preenchidas (PATH poligonal anexado ao círculo)
  const fillShape = {
    ...commonProps,
    id: fillId,
    type: "PATH",
    name: `Clock Fill: ${title}`,
    position: { x: worldX, y: worldY },
    attachedTo: baseId,
    disableAttachmentBehavior: ["ROTATION"],
    zIndex: Date.now() + 1,
    commands: [],
    fillRule: "NONZERO",
    style: {
      fillColor: color,
      fillOpacity: 0.95,
      strokeColor: "#e2c07d",
      strokeOpacity: 1,
      strokeWidth: 3,
      strokeDash: [],
    },
    metadata: {
      [CLOCK_PART_KEY]: "FILL",
      parentClockId: baseId,
    },
  };

  // 3. Linhas divisórias das fatias vazias (PATH poligonal anexado ao círculo)
  const gridLinesShape = {
    ...commonProps,
    id: gridLinesId,
    type: "PATH",
    name: `Clock Grid: ${title}`,
    position: { x: worldX, y: worldY },
    attachedTo: baseId,
    disableAttachmentBehavior: ["ROTATION"],
    zIndex: Date.now() + 2,
    commands: buildPolygonSlices(0, 0, r, total, 0, total),
    fillRule: "NONZERO",
    style: {
      fillColor: "#000000",
      fillOpacity: 0,
      strokeColor: "#e2c07d",
      strokeOpacity: 0.85,
      strokeWidth: 2.5,
      strokeDash: [],
    },
    metadata: {
      [CLOCK_PART_KEY]: "GRID",
      parentClockId: baseId,
    },
  };

  // 4. Texto abaixo do círculo (anexado ao círculo)
  const labelItem = {
    ...commonProps,
    id: labelId,
    type: "TEXT",
    name: `Clock Label: ${title}`,
    position: { x: worldX - 110, y: worldY + r + 8 },
    attachedTo: baseId,
    disableAttachmentBehavior: ["ROTATION"],
    zIndex: Date.now() + 3,
    text: {
      richText: [
        {
          type: "paragraph",
          children: [{ text: `${title} (0/${total})` }],
        },
      ],
      plainText: `${title} (0/${total})`,
      style: {
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeColor: "#050b21",
        strokeOpacity: 1,
        strokeWidth: 4,
        textAlign: "CENTER",
        textAlignVertical: "TOP",
        fontFamily: "Cinzel",
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 1.2,
        padding: 4,
      },
      type: "PLAIN",
      width: 220,
      height: 60,
    },
    metadata: {
      [CLOCK_PART_KEY]: "LABEL",
      parentClockId: baseId,
    },
  };

  await OBR.scene.items.addItems([baseCircle, fillShape, gridLinesShape, labelItem]);
  await OBR.notification.show(`Relógio "${title}" criado no mapa!`, "SUCCESS");
}

// Avança ou retrocede segmentos de um Clock específico
window.adjustClock = async (baseId, delta) => {
  const baseItems = await OBR.scene.items.getItems([baseId]);
  if (baseItems.length === 0) return;

  const baseItem = baseItems[0];
  const data = baseItem.metadata?.[CLOCK_META_KEY];
  if (!data) return;

  const nextVal = Math.max(0, Math.min(data.total, data.current + delta));
  const r = 72;
  const newLabelText = `${data.title} (${nextVal}/${data.total})`;

  await OBR.scene.items.updateItems(
    [baseId, data.fillId, data.labelId],
    (items) => {
      for (const item of items) {
        if (item.id === baseId) {
          item.metadata[CLOCK_META_KEY].current = nextVal;
        } else if (item.id === data.fillId) {
          item.commands = buildPolygonSlices(0, 0, r, data.total, 0, nextVal);
        } else if (item.id === data.labelId) {
          item.text.plainText = newLabelText;
          item.text.richText = [
            { type: "paragraph", children: [{ text: newLabelText }] },
          ];
        }
      }
    }
  );
};

// Remove um Clock inteiro do mapa
window.deleteClock = async (baseId) => {
  const baseItems = await OBR.scene.items.getItems([baseId]);
  if (baseItems.length === 0) return;

  const data = baseItems[0].metadata?.[CLOCK_META_KEY];
  const idsToDelete = [baseId];
  if (data?.fillId) idsToDelete.push(data.fillId);
  if (data?.gridLinesId) idsToDelete.push(data.gridLinesId);
  if (data?.labelId) idsToDelete.push(data.labelId);

  await OBR.scene.items.deleteItems(idsToDelete);
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
      const miniSvg = buildMiniClockSvg(data.current, data.total, data.color);

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

  OBR.contextMenu.create({
    id: "fabula-ultima-hud/clock-plus",
    icons: [
      {
        icon: "https://api.iconify.design/mdi:clock-plus-outline.svg?color=%23e2c07d",
        label: "+1 Segmento",
        filter: {
          every: [{ key: ["metadata", CLOCK_PART_KEY], operator: "!=", value: undefined }],
        },
      },
    ],
    onClick(context) {
      for (const item of context.items) {
        const targetId = item.metadata.parentClockId || item.id;
        adjustClock(targetId, 1);
      }
    },
  });

  OBR.contextMenu.create({
    id: "fabula-ultima-hud/clock-minus",
    icons: [
      {
        icon: "https://api.iconify.design/mdi:clock-minus-outline.svg?color=%23e2c07d",
        label: "-1 Segmento",
        filter: {
          every: [{ key: ["metadata", CLOCK_PART_KEY], operator: "!=", value: undefined }],
        },
      },
    ],
    onClick(context) {
      for (const item of context.items) {
        const targetId = item.metadata.parentClockId || item.id;
        adjustClock(targetId, -1);
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
    url: `${BASE_URL}?charId=${charId}&v=6`,
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
    })
    .join("");
}
