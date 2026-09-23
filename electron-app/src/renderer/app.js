// App Electron "one-page" (2 écrans : Configuration / Patch physique) — vanilla JS, pas de framework.
// nodeIntegration est activé (voir main.js) donc on peut require() directement les modules Node/coeur.

const fs = require('fs');
const { ipcRenderer } = require('electron');

const M = require('../core/model');
const { allocate } = require('../core/allocator');
const { buildMessages } = require('../core/scenePlanner');
const { buildOscScriptText, buildPatchCsvText } = require('../core/exporter');
const { describeBusMix } = require('../core/describe');
const oscClient = require('../core/oscClient');

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const state = {
  screen: 'config',
  config: M.sportMultiLanguageTemplate(),
  selectedLanguageId: null,
  wingHost: '192.168.1.10',
  wingPort: oscClient.DEFAULT_PORT,
  statusMessage: '',
  plan: null,
  messages: [],
  patchInputCategory: M.WingIoGroup.LOCAL,
  patchOutputCategory: M.WingIoGroup.LOCAL,
};
state.selectedLanguageId = state.config.languages[0]?.id ?? null;

function recompute() {
  state.plan = allocate(state.config);
  state.messages = buildMessages(state.plan);
}

function setStatus(msg) {
  state.statusMessage = msg;
  document.getElementById('status-message').textContent = msg;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function findEntity(entityType, id) {
  switch (entityType) {
    case 'commentator':
      for (const lang of state.config.languages) {
        const c = lang.commentators.find((x) => x.id === id);
        if (c) return c;
      }
      return null;
    case 'mic': return state.config.fieldMics.find((x) => x.id === id) || null;
    case 'pc': return state.config.pcSources.find((x) => x.id === id) || null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function render() {
  recompute();
  renderSidebarSummary();
  renderConfigScreen();
  renderPatchScreen();
}

function renderSidebarSummary() {
  const plan = state.plan;
  const inputsUsed = plan.inputPlan.reduce((sum, i) => sum + i.slotCount, 0);
  const busUsed = plan.busPlan.length;
  const errorCount = plan.errors.length;

  document.getElementById('capacity-summary').innerHTML = `
    <div class="capacity-row"><span>Entrées</span><b>${inputsUsed} / ${M.WING_CAPACITY.inputSlots}</b></div>
    <div class="capacity-row"><span>Bus (Main+Matrix+Bus)</span><b>${busUsed} / ${M.WING_CAPACITY.mainBuses + M.WING_CAPACITY.matrixBuses + M.WING_CAPACITY.buses}</b></div>
    <div class="capacity-row ${errorCount ? 'error' : ''}"><span>Erreurs</span><b>${errorCount}</b></div>
  `;
}

function renderConfigScreen() {
  const cfg = state.config;
  const el = document.getElementById('screen-config');

  el.innerHTML = `
    <h1 class="page-title">Configuration</h1>
    <p class="page-subtitle">Décris ta typologie de production : langues, micros terrain, sources PC.</p>

    ${renderErrorBanner()}

    <section class="card">
      <h2>Typologie</h2>
      <div style="display:flex; gap:16px; flex-wrap:wrap;">
        <div style="flex:1; min-width:220px;">
          <label class="field-label">Nom de la typologie</label>
          <input type="text" data-entity="config" data-field="typologyName" value="${esc(cfg.typologyName)}" />
        </div>
      </div>
      <div style="display:flex; gap:22px; margin-top:14px;">
        <label class="checkbox-row"><input type="checkbox" data-entity="config" data-field="roomMixEnabled" ${cfg.roomMixEnabled ? 'checked' : ''} /> Mix salle (bus Main dédié)</label>
        <label class="checkbox-row"><input type="checkbox" data-entity="config" data-field="recordingMultitrackEnabled" ${cfg.recordingMultitrackEnabled ? 'checked' : ''} /> Multipiste (direct-out)</label>
      </div>
    </section>

    <section class="card">
      <h2>Langues &amp; commentateurs <span class="hint">talkback toujours actif — perso ou commun si bus partagé</span></h2>
      ${renderLanguagesSection()}
    </section>

    <section class="card">
      <h2>Micros terrain</h2>
      ${renderFieldMicsSection()}
    </section>

    <section class="card">
      <h2>Sources PC</h2>
      ${renderPcSourcesSection()}
    </section>

    <section class="card">
      <h2>Plan d'entrées &amp; de bus</h2>
      ${renderPlanTables()}
    </section>
  `;
}

function renderErrorBanner() {
  if (!state.plan.errors.length) return '';
  return state.plan.errors.map((e) => `<div class="error-banner">${esc(e.detail)}</div>`).join('');
}

function renderLanguagesSection() {
  const cfg = state.config;
  if (!cfg.languages.some((l) => l.id === state.selectedLanguageId)) {
    state.selectedLanguageId = cfg.languages[0]?.id ?? null;
  }
  const selected = cfg.languages.find((l) => l.id === state.selectedLanguageId) || null;

  const listHtml = cfg.languages.map((l) => `
    <div class="lang-list-item ${l.id === state.selectedLanguageId ? 'active' : ''}" data-action="select-language" data-id="${l.id}">
      <span>${esc(l.name)}</span>
      <span class="x" data-action="remove-language" data-id="${l.id}" title="Retirer">✕</span>
    </div>
  `).join('') || '<div class="empty-hint">Aucune langue</div>';

  const detailHtml = selected ? `
    <table class="data">
      <thead><tr><th>Nom</th><th>Retour casque + talkback</th><th></th></tr></thead>
      <tbody>
        ${selected.commentators.map((c) => `
          <tr>
            <td><input type="text" data-entity="commentator" data-id="${c.id}" data-field="name" value="${esc(c.name)}" /></td>
            <td>
              <select data-entity="commentator" data-id="${c.id}" data-field="returnMode">
                ${returnModeOptions(c.returnMode)}
              </select>
            </td>
            <td><button class="btn danger" data-action="remove-commentator" data-id="${c.id}" data-lang="${selected.id}">✕</button></td>
          </tr>
        `).join('') || '<tr><td colspan="3" class="empty-hint">Aucun commentateur</td></tr>'}
      </tbody>
    </table>
    <button class="btn small add-row-btn" data-action="add-commentator" data-lang="${selected.id}">+ Commentateur</button>
  ` : '<div class="empty-hint">Sélectionne ou crée une langue à gauche.</div>';

  return `
    <div class="lang-grid">
      <div class="lang-list">
        ${listHtml}
        <div class="side-row" style="margin-top:4px;">
          <input type="text" id="new-lang-name" placeholder="Nouvelle langue" />
          <button class="btn small" data-action="add-language">Ajouter</button>
        </div>
      </div>
      <div class="lang-detail">${detailHtml}</div>
    </div>
  `;
}

function returnModeOptions(current) {
  const options = [
    [M.ReturnMode.NONE, 'Aucun retour'],
    [M.ReturnMode.PERSONAL_MONO, 'Perso — mono'],
    [M.ReturnMode.PERSONAL_STEREO, 'Perso — stéréo'],
    [M.ReturnMode.SHARED_LANGUAGE_BUS, 'Partagé (langue) + talkback commun'],
  ];
  return options.map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`).join('');
}

function renderFieldMicsSection() {
  const mics = state.config.fieldMics;
  const rows = mics.map((m) => `
    <tr>
      <td><input type="text" data-entity="mic" data-id="${m.id}" data-field="name" value="${esc(m.name)}" /></td>
      <td>${formatSelect('mic', m.id, 'format', m.format)}</td>
      <td><label class="checkbox-row"><input type="checkbox" data-entity="mic" data-id="${m.id}" data-field="hasReturn" ${m.hasReturn ? 'checked' : ''} /></label></td>
      <td>${formatSelect('mic', m.id, 'returnFormat', m.returnFormat)}</td>
      <td><label class="checkbox-row"><input type="checkbox" data-entity="mic" data-id="${m.id}" data-field="talkbackEnabled" ${m.talkbackEnabled ? 'checked' : ''} /></label></td>
      <td><button class="btn danger" data-action="remove-mic" data-id="${m.id}">✕</button></td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-hint">Aucun micro terrain</td></tr>';

  return `
    <table class="data">
      <thead><tr><th>Nom</th><th>Format micro</th><th>A un retour</th><th>Format retour</th><th>Talkback</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn small add-row-btn" data-action="add-mic">+ Micro</button>
  `;
}

function renderPcSourcesSection() {
  const sources = state.config.pcSources;
  const rows = sources.map((pc) => `
    <tr>
      <td><input type="text" data-entity="pc" data-id="${pc.id}" data-field="name" value="${esc(pc.name)}" /></td>
      <td>${categorySelect(pc)}</td>
      <td>${formatSelect('pc', pc.id, 'format', pc.format)}</td>
      <td><button class="btn danger" data-action="remove-pc" data-id="${pc.id}">✕</button></td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="empty-hint">Aucune source PC</td></tr>';

  return `
    <table class="data">
      <thead><tr><th>Nom</th><th>Catégorie</th><th>Format</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn small add-row-btn" data-action="add-pc">+ Source PC</button>
    <p class="empty-hint" style="margin-top:8px;">Le mode de connexion (Dante, AES50…) se choisit sur l'écran « Patch physique », comme pour n'importe quelle source.</p>
  `;
}

function formatSelect(entity, id, field, current) {
  return `<select data-entity="${entity}" data-id="${id}" data-field="${field}">
    <option value="${M.ChannelFormat.MONO}" ${current === M.ChannelFormat.MONO ? 'selected' : ''}>Mono</option>
    <option value="${M.ChannelFormat.STEREO}" ${current === M.ChannelFormat.STEREO ? 'selected' : ''}>Stéréo</option>
  </select>`;
}

function categorySelect(pc) {
  const options = [[M.PcSourceCategory.JINGLE, 'Jingle'], [M.PcSourceCategory.VIDEO, 'Vidéo'], [M.PcSourceCategory.AMBIANCE, 'Nappe/ambiance']];
  return `<select data-entity="pc" data-id="${pc.id}" data-field="category">
    ${options.map(([v, l]) => `<option value="${v}" ${v === pc.category ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;
}

function renderPlanTables() {
  const plan = state.plan;
  const inputRows = plan.inputPlan.map((i) => `
    <tr><td>${i.firstSlot}</td><td>${i.slotCount}</td><td>${esc(i.patchLabel)}</td></tr>
  `).join('') || '<tr><td colspan="3" class="empty-hint">Aucune entrée</td></tr>';

  const busRows = plan.busPlan.map((b) => `
    <tr>
      <td>${b.busType}</td><td>${b.busNumber}</td><td>${esc(b.name)}</td><td>${b.format}</td>
      <td>${esc(describeBusMix(b, plan))}</td>
      <td>${esc(b.talkbackNames.join(', ') || '—')}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-hint">Aucun bus</td></tr>';

  return `
    <div style="display:flex; gap:20px;">
      <div style="flex:1;">
        <table class="data">
          <thead><tr><th>Slot</th><th>Nb</th><th>Patch</th></tr></thead>
          <tbody>${inputRows}</tbody>
        </table>
      </div>
      <div style="flex:2;">
        <table class="data">
          <thead><tr><th>Type</th><th>N°</th><th>Nom</th><th>Format</th><th>Mix (sends)</th><th>Talkback</th></tr></thead>
          <tbody>${busRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPatchScreen() {
  const el = document.getElementById('screen-patch');
  const inputItems = getInputPatchItems();
  const outputItems = getOutputPatchItems();

  el.innerHTML = `
    <h1 class="page-title">Patch physique</h1>
    <p class="page-subtitle">Glisse chaque élément sur son entrée/sortie réelle de la console — comme dans Wing-Edit.</p>
    <div class="patch-note">
      ⚠️ Les codes de groupe (LCL/A50A/A50B/A50C/AESEBU/ST/USBA/USBP) sont une estimation basée sur la
      nomenclature standard Wing Rack — non confirmés sur le matériel réel. Le patch de <b>sortie</b>
      (bus/matrix/main → port physique) est en plus expérimental côté envoi OSC : aucune source
      publique ne documente cette adresse, à vérifier en priorité à la connexion.
    </div>

    ${renderPatchSection('input', 'Entrées', inputItems, M.WING_INPUT_GROUPS, state.patchInputCategory)}
    ${renderPatchSection('output', 'Sorties', outputItems, M.WING_OUTPUT_GROUPS, state.patchOutputCategory)}
  `;
}

function renderPatchSection(kind, title, items, groups, currentCategory) {
  return `
    <section class="card patch-section">
      <h2>${title} <span class="hint">glisser-déposer un élément sur une case</span></h2>
      <div class="patch-layout">
        <div class="patch-tray">
          ${items.length
            ? items.map((it) => patchChipHtml(it, groups)).join('')
            : '<div class="empty-hint">Aucun élément à patcher.</div>'}
        </div>
        <div class="patch-grid-area">
          <div class="patch-tabs">
            ${Object.entries(groups).map(([key, meta]) => `
              <button class="btn small patch-tab ${key === currentCategory ? 'active' : ''}"
                data-action="select-patch-category" data-kind="${kind}" data-category="${key}">
                ${esc(meta.label)} <span class="count">${meta.count}</span>
              </button>
            `).join('')}
          </div>
          <div class="patch-cellgrid">
            ${renderPatchCells(groups[currentCategory].count, currentCategory, kind, items)}
          </div>
        </div>
      </div>
    </section>
  `;
}

function patchChipHtml(item, groups) {
  const ref = item.getRef();
  const badge = ref
    ? `${groups[ref.group].label} #${ref.index}${item.stereo ? '–' + (ref.index + 1) : ''}`
    : 'Non patché';
  return `
    <div class="patch-chip ${ref ? 'assigned' : ''}" draggable="true" data-item-key="${item.key}" title="Glisser vers une case">
      <div class="chip-label">${esc(item.label)}</div>
      <div class="chip-badge">${esc(badge)}</div>
    </div>
  `;
}

function renderPatchCells(count, category, kind, items) {
  const byIndex = new Map();
  for (const item of items) {
    const ref = item.getRef();
    if (!ref || ref.group !== category) continue;
    byIndex.set(ref.index, { item, secondary: false });
    if (item.stereo) byIndex.set(ref.index + 1, { item, secondary: true });
  }

  let html = '';
  for (let idx = 1; idx <= count; idx++) {
    const occ = byIndex.get(idx);
    if (occ) {
      html += `
        <div class="patch-cell filled ${occ.secondary ? 'secondary' : ''}" data-kind="${kind}" data-category="${category}" data-cell="${idx}">
          <span class="cellnum">${idx}</span>
          <span class="celllabel" ${occ.secondary ? '' : `draggable="true" data-item-key="${occ.item.key}"`}>${occ.secondary ? '↳' : esc(occ.item.label)}</span>
          ${!occ.secondary ? `<span class="cellclear" data-action="clear-patch" data-id="${occ.item.key}" title="Retirer">✕</span>` : ''}
        </div>`;
    } else {
      html += `<div class="patch-cell empty" data-kind="${kind}" data-category="${category}" data-cell="${idx}"><span class="cellnum">${idx}</span></div>`;
    }
  }
  return html;
}

// ---------------------------------------------------------------------------
// Patch : items déplaçables (entrées = sources, sorties = bus/matrix/main)
// ---------------------------------------------------------------------------

function getInputPatchItems() {
  const bySourceName = new Map(state.plan.inputPlan.map((i) => [i.sourceName, i]));
  const items = [];

  const push = (src) => {
    const input = bySourceName.get(src.name);
    if (!input) return;
    items.push({
      key: `input:${src.id}`,
      label: input.displayName,
      stereo: input.slotCount > 1,
      getRef: () => src.physicalInput,
      setRef: (ref) => { src.physicalInput = ref; },
    });
  };

  for (const lang of state.config.languages) for (const c of lang.commentators) push(c);
  for (const mic of state.config.fieldMics) push(mic);
  for (const pc of state.config.pcSources) push(pc);
  return items;
}

function getOutputPatchItems() {
  return state.plan.busPlan.map((bus) => ({
    key: `output:${bus.busType}:${bus.busNumber}`,
    label: bus.name,
    stereo: bus.format === M.ChannelFormat.STEREO,
    getRef: () => bus.physicalOutput,
    setRef: (ref) => setOwnerOutput(bus.owner, ref),
  }));
}

function setOwnerOutput(owner, ref) {
  if (!owner) return;
  switch (owner.kind) {
    case 'languagePgm': {
      const lang = state.config.languages.find((l) => l.id === owner.id);
      if (lang) lang.pgmOutput = ref;
      break;
    }
    case 'languageSharedReturn': {
      const lang = state.config.languages.find((l) => l.id === owner.id);
      if (lang) lang.sharedReturnOutput = ref;
      break;
    }
    case 'roomMix':
      state.config.roomMixOutput = ref;
      break;
    case 'commentatorReturn': {
      for (const lang of state.config.languages) {
        const c = lang.commentators.find((x) => x.id === owner.id);
        if (c) { c.returnOutput = ref; return; }
      }
      break;
    }
    case 'fieldMicReturn': {
      const mic = state.config.fieldMics.find((m) => m.id === owner.id);
      if (mic) mic.returnOutput = ref;
      break;
    }
  }
}

function findPatchItemByKey(key) {
  return [...getInputPatchItems(), ...getOutputPatchItems()].find((it) => it.key === key) || null;
}

// ---------------------------------------------------------------------------
// Actions (clics)
// ---------------------------------------------------------------------------

const actions = {
  'select-language': (id) => { state.selectedLanguageId = id; render(); },
  'remove-language': (id) => {
    state.config.languages = state.config.languages.filter((l) => l.id !== id);
    render();
  },
  'add-language': () => {
    const input = document.getElementById('new-lang-name');
    const name = (input.value || '').trim();
    if (!name) return;
    const lang = M.createLanguage(name);
    state.config.languages.push(lang);
    state.selectedLanguageId = lang.id;
    render();
  },
  'add-commentator': (_id, el) => {
    const lang = state.config.languages.find((l) => l.id === el.dataset.lang);
    if (!lang) return;
    lang.commentators.push(M.createCommentator(`${lang.name}-Comm${lang.commentators.length + 1}`));
    render();
  },
  'remove-commentator': (id, el) => {
    const lang = state.config.languages.find((l) => l.id === el.dataset.lang);
    if (!lang) return;
    lang.commentators = lang.commentators.filter((c) => c.id !== id);
    render();
  },
  'add-mic': () => {
    state.config.fieldMics.push(M.createFieldMic(`Micro ${state.config.fieldMics.length + 1}`));
    render();
  },
  'remove-mic': (id) => {
    state.config.fieldMics = state.config.fieldMics.filter((m) => m.id !== id);
    render();
  },
  'add-pc': () => {
    state.config.pcSources.push(M.createPcSource(`PC ${state.config.pcSources.length + 1}`));
    render();
  },
  'remove-pc': (id) => {
    state.config.pcSources = state.config.pcSources.filter((p) => p.id !== id);
    render();
  },
  'new-empty': () => {
    state.config = M.createProductionConfig();
    state.selectedLanguageId = null;
    render();
  },
  'load-template-sport': () => {
    state.config = M.sportMultiLanguageTemplate();
    state.selectedLanguageId = state.config.languages[0]?.id ?? null;
    render();
  },
  'save-project': async () => {
    const filePath = await ipcRenderer.invoke('dialog:saveFile', {
      title: 'Enregistrer le projet',
      defaultPath: `${state.config.typologyName || 'projet'}.json`,
      filters: [{ name: 'Projet WingConfigurator', extensions: ['json'] }],
    });
    if (!filePath) return;
    fs.writeFileSync(filePath, JSON.stringify(state.config, null, 2), 'utf8');
    setStatus(`Projet enregistré : ${filePath}`);
  },
  'load-project': async () => {
    const filePath = await ipcRenderer.invoke('dialog:openFile', {
      title: 'Ouvrir un projet',
      filters: [{ name: 'Projet WingConfigurator', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!filePath) return;
    state.config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.selectedLanguageId = state.config.languages[0]?.id ?? null;
    render();
    setStatus(`Projet chargé : ${filePath}`);
  },
  'export-osc-script': async () => {
    const filePath = await ipcRenderer.invoke('dialog:saveFile', {
      title: 'Exporter le script OSC',
      defaultPath: 'wing-scene.txt',
      filters: [{ name: 'Script OSC', extensions: ['txt'] }],
    });
    if (!filePath) return;
    fs.writeFileSync(filePath, buildOscScriptText(state.messages), 'utf8');
    setStatus(`Script OSC exporté : ${filePath}`);
  },
  'export-patch-csv': async () => {
    const filePath = await ipcRenderer.invoke('dialog:saveFile', {
      title: 'Exporter la fiche de patch',
      defaultPath: 'fiche-patch.csv',
      filters: [{ name: 'Fiche de patch CSV', extensions: ['csv'] }],
    });
    if (!filePath) return;
    fs.writeFileSync(filePath, buildPatchCsvText(state.plan), 'utf8');
    setStatus(`Fiche de patch exportée : ${filePath}`);
  },
  'test-connection': async () => {
    setStatus('Test de connexion en cours…');
    const ok = await oscClient.testConnection(state.wingHost, state.wingPort, 2000);
    setStatus(ok ? `Connexion OK avec ${state.wingHost}:${state.wingPort}.` : 'Pas de réponse de la console (vérifie IP/réseau).');
  },
  'select-patch-category': (_id, el) => {
    if (el.dataset.kind === 'input') state.patchInputCategory = el.dataset.category;
    else state.patchOutputCategory = el.dataset.category;
    render();
  },
  'clear-patch': (key) => {
    const item = findPatchItemByKey(key);
    if (item) { item.setRef(null); render(); }
  },
  'send-to-wing': async () => {
    recompute();
    if (state.plan.errors.length > 0) {
      setStatus('Envoi annulé : des erreurs de capacité doivent être corrigées d\'abord.');
      return;
    }
    setStatus('Envoi en cours…');
    try {
      const count = await oscClient.sendAllMessages(state.wingHost, state.wingPort, state.messages);
      setStatus(`${count} messages OSC envoyés à ${state.wingHost}:${state.wingPort}.`);
    } catch (err) {
      setStatus(`Erreur d'envoi : ${err.message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Écoute des événements (délégation)
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = actions[target.dataset.action];
  if (action) action(target.dataset.id, target);
});

document.addEventListener('change', (e) => {
  const t = e.target;

  // Bindings directs sur ProductionConfig (typologie, options).
  if (t.dataset.entity === 'config') {
    const value = t.type === 'checkbox' ? t.checked : t.value;
    state.config[t.dataset.field] = value;
    render();
    return;
  }

  // Bindings sur une entité patchable (commentateur/mic/pc).
  if (t.dataset.entity) {
    const entity = findEntity(t.dataset.entity, t.dataset.id);
    if (!entity) return;
    entity[t.dataset.field] = t.type === 'checkbox' ? t.checked : t.value;
    render();
    return;
  }

  // Sidebar : hôte/port Wing (pas de re-rendu nécessaire, juste l'état).
  if (t.id === 'wing-host') state.wingHost = t.value;
  if (t.id === 'wing-port') state.wingPort = parseInt(t.value, 10) || oscClient.DEFAULT_PORT;
});

// Glisser-déposer sur la grille de patch (entrées/sorties). Délégation sur `document` puisque les
// cases et les puces sont régénérées à chaque render().
document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest('[data-item-key]');
  if (!chip) return;
  e.dataTransfer.setData('text/plain', chip.dataset.itemKey);
  e.dataTransfer.effectAllowed = 'move';
});

document.addEventListener('dragover', (e) => {
  const cell = e.target.closest('.patch-cell');
  if (!cell) return;
  e.preventDefault();
  cell.classList.add('dragover');
});

document.addEventListener('dragleave', (e) => {
  const cell = e.target.closest('.patch-cell');
  if (cell) cell.classList.remove('dragover');
});

document.addEventListener('drop', (e) => {
  const cell = e.target.closest('.patch-cell');
  if (!cell) return;
  e.preventDefault();
  cell.classList.remove('dragover');

  const key = e.dataTransfer.getData('text/plain');
  const item = findPatchItemByKey(key);
  if (!item) return;

  // Un item ne peut être déposé que dans la grille de son propre type (entrée sur entrée, sortie sur sortie).
  if (!key.startsWith(`${cell.dataset.kind}:`)) return;

  item.setRef({ group: cell.dataset.category, index: parseInt(cell.dataset.cell, 10) });
  render();
});

document.querySelectorAll('nav.nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.screen = btn.dataset.nav;
    document.querySelectorAll('nav.nav button').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('screen-config').classList.toggle('active', state.screen === 'config');
    document.getElementById('screen-patch').classList.toggle('active', state.screen === 'patch');
  });
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

document.getElementById('wing-host').value = state.wingHost;
document.getElementById('wing-port').value = state.wingPort;
render();
