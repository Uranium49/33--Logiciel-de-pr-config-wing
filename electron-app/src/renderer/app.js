// App Electron "one-page" (2 écrans : Configuration / Patch physique) — vanilla JS, pas de framework.
// nodeIntegration est activé (voir main.js) donc on peut require() directement les modules Node/coeur.

const fs = require('fs');
const { ipcRenderer } = require('electron');

const M = require('../core/model');
const { allocate } = require('../core/allocator');
const { buildMessages } = require('../core/scenePlanner');
const { buildOscScriptText, buildPatchCsvText } = require('../core/exporter');
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
      <td>${connectionSelect(pc)}</td>
      <td>${formatSelect('pc', pc.id, 'format', pc.format)}</td>
      <td><button class="btn danger" data-action="remove-pc" data-id="${pc.id}">✕</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-hint">Aucune source PC</td></tr>';

  return `
    <table class="data">
      <thead><tr><th>Nom</th><th>Catégorie</th><th>Connexion</th><th>Format</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn small add-row-btn" data-action="add-pc">+ Source PC</button>
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

function connectionSelect(pc) {
  const options = [[M.PcConnectionType.DANTE, 'Dante'], [M.PcConnectionType.ASIO_LOCAL, 'ASIO local']];
  return `<select data-entity="pc" data-id="${pc.id}" data-field="connectionType">
    ${options.map(([v, l]) => `<option value="${v}" ${v === pc.connectionType ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;
}

function renderPlanTables() {
  const plan = state.plan;
  const inputRows = plan.inputPlan.map((i) => `
    <tr><td>${i.firstSlot}</td><td>${i.slotCount}</td><td>${esc(i.patchLabel)}</td></tr>
  `).join('') || '<tr><td colspan="3" class="empty-hint">Aucune entrée</td></tr>';

  const busRows = plan.busPlan.map((b) => `
    <tr><td>${b.busType}</td><td>${b.busNumber}</td><td>${esc(b.name)}</td><td>${b.format}</td></tr>
  `).join('') || '<tr><td colspan="4" class="empty-hint">Aucun bus</td></tr>';

  return `
    <div style="display:flex; gap:20px;">
      <div style="flex:1;">
        <table class="data">
          <thead><tr><th>Slot</th><th>Nb</th><th>Patch</th></tr></thead>
          <tbody>${inputRows}</tbody>
        </table>
      </div>
      <div style="flex:1;">
        <table class="data">
          <thead><tr><th>Type</th><th>N°</th><th>Nom</th><th>Format</th></tr></thead>
          <tbody>${busRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPatchScreen() {
  const el = document.getElementById('screen-patch');
  const sources = [];
  for (const lang of state.config.languages) for (const c of lang.commentators) sources.push(c);
  sources.push(...state.config.fieldMics);
  sources.push(...state.config.pcSources);

  const bySourceName = new Map(state.plan.inputPlan.map((i) => [i.sourceName, i]));

  const cards = sources.map((src) => {
    const input = bySourceName.get(src.name);
    if (!input) return '';
    if (!src.physicalInput) src.physicalInput = M.createPhysicalInput();

    const slotInfo = input.slotCount > 1
      ? `Canaux ${input.firstSlot}-${input.firstSlot + input.slotCount - 1} (stéréo)`
      : `Canal ${input.firstSlot}`;

    return `
      <div class="patch-card">
        <div class="name">${esc(input.displayName)}</div>
        <div class="slots">${slotInfo}</div>
        <div class="field">
          <label class="field-label">Groupe de connexion</label>
          <select data-patch-id="${src.id}" data-patch-field="group">
            ${Object.entries(M.WING_INPUT_GROUPS).map(([key, meta]) =>
              `<option value="${key}" ${key === src.physicalInput.group ? 'selected' : ''}>${meta.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Numéro de canal</label>
          <input type="number" min="1" max="64" data-patch-id="${src.id}" data-patch-field="index" value="${src.physicalInput.index}" />
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <h1 class="page-title">Patch physique</h1>
    <p class="page-subtitle">Assigne chaque source à son entrée physique/réseau réelle sur la Wing.</p>
    <div class="patch-note">
      ⚠️ Les codes de groupe (Local/AES50-A/AES50-B/Carte/USB) sont une estimation basée sur la nomenclature standard Wing — non confirmés sur le matériel réel, à vérifier à la connexion.
    </div>
    <div class="patch-grid">${cards || '<div class="empty-hint">Aucune source à patcher — ajoute des commentateurs/micros/sources PC dans l\'onglet Configuration.</div>'}</div>
  `;
}

// ---------------------------------------------------------------------------
// Entités : source de vérité pour l'attribution des ids
// ---------------------------------------------------------------------------

function findSourceById(id) {
  for (const lang of state.config.languages) {
    const c = lang.commentators.find((x) => x.id === id);
    if (c) return c;
  }
  return state.config.fieldMics.find((x) => x.id === id) || state.config.pcSources.find((x) => x.id === id) || null;
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

  // Bindings sur l'écran de patch physique (groupe/index).
  if (t.dataset.patchId) {
    const src = findSourceById(t.dataset.patchId);
    if (!src) return;
    if (!src.physicalInput) src.physicalInput = M.createPhysicalInput();
    if (t.dataset.patchField === 'group') src.physicalInput.group = t.value;
    if (t.dataset.patchField === 'index') src.physicalInput.index = parseInt(t.value, 10) || 1;
    render();
    return;
  }

  // Sidebar : hôte/port Wing (pas de re-rendu nécessaire, juste l'état).
  if (t.id === 'wing-host') state.wingHost = t.value;
  if (t.id === 'wing-port') state.wingPort = parseInt(t.value, 10) || oscClient.DEFAULT_PORT;
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
