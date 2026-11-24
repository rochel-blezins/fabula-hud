import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.0.0";

const METADATA_KEY = "fabula-ultima-hud/party";
const TOKEN_LINK_KEY = "fabula-ultima-hud/linked-char-id";
const POPOVER_ID = "fabula-ultima-hud/token-popover";
const BASE_URL = "https://rochel-blezins.github.io/fabula-hud/index.html";
const DEFAULT_AVATAR = "https://placehold.co/150x180/101b3d/e2c07d?text=Hero";

// Verifica se a página foi aberta em modo "Janela de Token" (?charId=...)
const urlParams = new URLSearchParams(window.location.search);
const focusedCharId = urlParams.get("charId");

if (focusedCharId) {
  document.body.classList.add("token-mode");
}

let partyData = [];

// Elementos DOM
const partyListEl = document.getElementById("party-list");
const modal = document.getElementById("char-modal");
const form = document.getElementById("char-form");
const btnAdd = document.getElementById("btn-add-char");
const btnCancel = document.getElementById("btn-cancel");

const linkModal = document.getElementById("link-modal");
const linkForm = document.getElementById("link-form");
const heroSelect = document.getElementById("hero-select");
const btnCancelLink = document.getElementById("btn-cancel-link");

OBR.onReady(async () => {
  const metadata = await OBR.room.getMetadata();
  partyData = metadata[METADATA_KEY] || [];
  renderParty();

  // Sincronização em tempo real entre a HUD Geral e as Janelas de Token
  OBR.room.onMetadataChange((newMetadata) => {
    partyData = newMetadata[METADATA_KEY] || [];
    renderParty();
  });

  // Só registra os menus de contexto na instância principal (para não duplicar)
  if (!focusedCharId) {
    setupContextMenus();
    setupSelectionListener();
  }
});

// Cria os botões ao clicar com o botão direito em qualquer token no mapa
function setupContextMenus() {
  // 1. Botão para abrir o Status JRPG flutuante do token
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

  // 2. Botão para vincular o token a um herói da party
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
}

let currentOpenCharId = null;

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
    url: `${BASE_URL}?charId=${charId}`,
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

// Fecha a janela flutuante e limpa o estado para permitir reabrir depois
window.closeTokenPopover = async () => {
  await OBR.popover.close(POPOVER_ID);
};


// Abre modal dentro da HUD principal para escolher qual herói pertence ao token
async function openLinkModal(token) {
  if (partyData.length === 0) {
    await OBR.notification.show("Crie um herói na HUD Party Status antes de vincular!", "WARNING");
    return;
  }

  document.getElementById("target-token-id").value = token.id;
  heroSelect.innerHTML = partyData
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  // Abre a janela principal caso esteja fechada e exibe o modal
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

// Salva estado na sala
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
  // Se estiver no modo Token, filtra para mostrar APENAS o personagem daquele token
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
