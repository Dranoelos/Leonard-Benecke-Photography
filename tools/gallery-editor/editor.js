let grids = [...document.querySelectorAll('.photo-grid[data-gallery]')];
const status = document.querySelector('#status');
const save = document.querySelector('#save');
const undo = document.querySelector('#undo');
const uploadButton = document.querySelector('#upload');
const fileInput = document.querySelector('#upload-files');
const fileDropOverlay = document.querySelector('#file-drop-overlay');
const newTabButton = document.querySelector('#new-tab');
const galleryDialog = document.querySelector('#gallery-dialog');
const galleryName = document.querySelector('#gallery-name');
const history = [];
const pendingUploads = new Map();
const sdrReplacements = new Map();
const sdrInput = document.querySelector('#sdr-files');
let sdrTarget;
let draft = structuredClone(window.GALLERY_DATA);
let revision;
let savedState = JSON.stringify(draft);
let saving = false;
let preparing = false;
let dragging;
let activeCategory = 'events';
const snapshot = () => JSON.stringify(draft);
const showStatus = text => { status.textContent = text; };
const busy = () => saving || preparing || !revision;
const galleryLabel = category => category === 'events' ? 'Events' : category === 'portraits' ? 'Portraits' : category;

function selectGallery(category) {
  if (!Object.hasOwn(draft, category)) return;
  activeCategory = category;
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.tab === category)));
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== category; });
}

function moveToGallery(figure, destination, activate = false) {
  if (busy() || !Object.hasOwn(draft, destination)) return;
  const source = figure.parentElement.dataset.gallery;
  if (source === destination) return;
  const index = draft[source].findIndex(photo => photo.src === figure.dataset.src);
  if (index < 0) return;
  dragging = null;
  edit(() => {
    draft[destination].push(draft[source].splice(index, 1)[0]);
    if (activate) activeCategory = destination;
  }, `Bild nach ${galleryLabel(destination)} verschoben · noch nicht gespeichert.`);
}

function syncGalleries() {
  const tabs = document.querySelector('.gallery-tabs');
  const panels = document.querySelector('.preview-content');
  // Remove only unsaved tabs that disappeared when undoing their creation.
  document.querySelectorAll('[data-tab], [data-panel]').forEach(element => {
    const category = element.dataset.tab || element.dataset.panel;
    if (!Object.hasOwn(draft, category)) element.remove();
  });
  const tabMap = new Map([...tabs.children].map(tab => [tab.dataset.tab, tab]));
  const panelMap = new Map([...panels.children].map(panel => [panel.dataset.panel, panel]));
  Object.keys(draft).forEach(category => {
    let tab = tabMap.get(category);
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      tab.dataset.tab = category;
      tab.textContent = galleryLabel(category);
      tabs.append(tab);
    }
    if (!tab.dataset.ready) {
      tab.dataset.ready = 'true';
      tab.addEventListener('click', () => selectGallery(category));
      const acceptPhoto = event => {
        if (!dragging || busy() || dragging.parentElement.dataset.gallery === category) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        tab.classList.add('tab-drop-target');
      };
      tab.addEventListener('dragenter', acceptPhoto);
      tab.addEventListener('dragover', acceptPhoto);
      tab.addEventListener('dragleave', () => tab.classList.remove('tab-drop-target'));
      tab.addEventListener('drop', event => {
        tab.classList.remove('tab-drop-target');
        if (!dragging || busy()) return;
        event.preventDefault();
        moveToGallery(dragging, category, true);
      });
    }
    let panel = panelMap.get(category);
    if (!panel) {
      panel = document.createElement('section');
      panel.dataset.panel = category;
      const heading = document.createElement('h2');
      heading.className = 'sr-only';
      heading.textContent = galleryLabel(category);
      const grid = document.createElement('div');
      grid.className = 'photo-grid';
      grid.dataset.gallery = category;
      grid.dataset.showHidden = '';
      panel.append(heading, grid);
      panels.append(panel);
    }
    let empty = panel.querySelector('.empty-gallery');
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'empty-gallery';
      empty.textContent = 'Noch keine Bilder. Bilder hinzufügen oder ein vorhandenes Bild auf diesen Tab ziehen.';
      panel.append(empty);
    }
    empty.hidden = draft[category].length > 0;
  });
  grids = [...document.querySelectorAll('.photo-grid[data-gallery]')];
  if (!Object.hasOwn(draft, activeCategory)) activeCategory = Object.keys(draft)[0];
  selectGallery(activeCategory);
}

function refresh() {
  save.disabled = busy() || snapshot() === savedState;
  undo.disabled = busy() || history.length === 0;
  uploadButton.disabled = busy();
  newTabButton.disabled = busy();
  grids.forEach(grid => [...grid.children].forEach((figure, index, list) => {
    const photo = draft[grid.dataset.gallery].find(item => item.src === figure.dataset.src);
    const hidden = photo.hidden === true;
    const rendition = sdrReplacements.get(photo._sdrRevision) || pendingUploads.get(photo.src);
    const hasHDR = Boolean(photo.hdrSrc || rendition?.hdrData);
    figure.classList.toggle('is-hidden', hidden);
    figure.querySelector('.sort-order span').textContent = `${index + 1} · ${photo.src.startsWith('upload:') ? pendingUploads.get(photo.src).name : photo.src.split('/').pop()}`;
    figure.querySelector('[data-move="-1"]').disabled = busy() || index === 0;
    figure.querySelector('[data-move="1"]').disabled = busy() || index === list.length - 1;
    figure.querySelector('[data-action="visibility"]').textContent = hidden ? 'Einblenden' : 'Ausblenden';
    figure.querySelectorAll('[data-action]').forEach(button => { button.disabled = busy(); });
    figure.querySelector('[data-action="sdr"]').hidden = !hasHDR;
    const colorInfo = figure.querySelector('.color-info');
    colorInfo.hidden = !hasHDR;
    const method = rendition?.sdrMethod || photo.sdrMethod;
    colorInfo.textContent = `HDR + SDR · ${method === 'custom-sdr' ? 'eigene SDR-Version' : method === 'embedded-sdr' ? 'SDR aus Original' : 'SDR automatisch'}`;
    const destination = figure.querySelector('.move-gallery');
    const signature = JSON.stringify(Object.keys(draft)) + grid.dataset.gallery;
    if (destination.dataset.options !== signature) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Verschieben nach …';
      const options = Object.keys(draft).filter(category => category !== grid.dataset.gallery).map(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = galleryLabel(category);
        return option;
      });
      destination.replaceChildren(placeholder, ...options);
      destination.dataset.options = signature;
    }
    destination.disabled = busy() || Object.keys(draft).length < 2;
    figure.querySelector('.visibility-label').hidden = !hidden;
    figure.draggable = !busy();
  }));
}

function edit(action, message) {
  if (busy()) return;
  history.push(snapshot());
  action();
  render();
  showStatus(message);
}

function move(figure, targetIndex) {
  const category = figure.parentElement.dataset.gallery;
  const list = draft[category];
  const index = list.findIndex(photo => photo.src === figure.dataset.src);
  targetIndex = Math.max(0, Math.min(list.length - 1, targetIndex));
  if (index === targetIndex) return;
  edit(() => list.splice(targetIndex, 0, list.splice(index, 1)[0]), 'Reihenfolge geändert · noch nicht gespeichert.');
}

function decorate(figure, grid) {
  const controls = document.createElement('div');
  controls.className = 'sort-controls';
  const order = document.createElement('div');
  order.className = 'sort-order';
  const label = document.createElement('span');
  label.title = figure.dataset.src;
  order.append(label);
  const name = figure.dataset.src.startsWith('upload:') ? pendingUploads.get(figure.dataset.src).name : figure.dataset.src.split('/').pop();
  [-1, 1].forEach(direction => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.move = direction;
    button.textContent = direction === -1 ? '←' : '→';
    button.setAttribute('aria-label', `${name} ${direction === -1 ? 'nach vorne' : 'nach hinten'} verschieben`);
    button.addEventListener('click', () => {
      move(figure, [...grid.children].indexOf(figure) + direction);
      button.focus({preventScroll: true});
    });
    order.append(button);
  });
  const actions = document.createElement('div');
  actions.className = 'sort-actions';
  const visibility = document.createElement('button');
  visibility.type = 'button';
  visibility.dataset.action = 'visibility';
  visibility.addEventListener('click', () => {
    const photo = draft[grid.dataset.gallery].find(item => item.src === figure.dataset.src);
    edit(() => { photo.hidden = !photo.hidden; }, photo.hidden
      ? 'Bild zum Einblenden vorgemerkt · noch nicht gespeichert.'
      : 'Bild ausgeblendet · wird nach dem Speichern aus der Galerie weggelassen. Die Datei bleibt erhalten.');
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Entfernen';
  remove.dataset.action = 'remove';
  remove.addEventListener('click', () => {
    edit(() => {
      draft[grid.dataset.gallery] = draft[grid.dataset.gallery].filter(photo => photo.src !== figure.dataset.src);
    }, 'Zum Entfernen vorgemerkt · beim Speichern wird die Datei in den Papierkorb verschoben. Mit Rückgängig wiederherstellen.');
  });
  actions.append(visibility, remove);
  const sdrButton = document.createElement('button');
  sdrButton.type = 'button';
  sdrButton.dataset.action = 'sdr';
  sdrButton.textContent = 'Eigene SDR-Version …';
  sdrButton.addEventListener('click', () => {
    if (busy()) return;
    sdrTarget = {category: grid.dataset.gallery, src: figure.dataset.src};
    sdrInput.click();
  });
  const colorInfo = document.createElement('p');
  colorInfo.className = 'color-info';
  const destination = document.createElement('select');
  destination.className = 'move-gallery';
  destination.setAttribute('aria-label', `${name} in andere Galerie verschieben`);
  destination.addEventListener('change', () => {
    const category = destination.value;
    destination.value = '';
    if (category) moveToGallery(figure, category);
  });
  controls.append(order, colorInfo, actions, destination, sdrButton);
  controls.addEventListener('dragstart', event => event.preventDefault());
  const badge = document.createElement('span');
  badge.className = 'visibility-label';
  badge.textContent = 'Ausgeblendet';
  figure.append(badge, controls);
  const image = figure.querySelector('img');
  image.draggable = true;
  image.style.aspectRatio = `${image.width} / ${image.height}`;
  if (grid.dataset.gallery === 'events' && !figure.querySelector('figcaption')) {
    const captionText = eventCaptions.find(([key]) => name.toLowerCase().includes(key))?.[1];
    if (captionText) {
      const caption = document.createElement('figcaption');
      caption.textContent = captionText;
      figure.append(caption);
    }
  }
  figure.addEventListener('dragstart', event => {
    if (busy()) return event.preventDefault();
    dragging = figure;
    event.dataTransfer.clearData();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-gallery-photo', figure.dataset.src);
    event.dataTransfer.setData('text/plain', figure.dataset.src);
    figure.classList.add('dragging');
  });
  figure.addEventListener('dragover', event => {
    if (!dragging || dragging === figure || dragging.parentElement !== grid || busy()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    figure.classList.add('drop-target');
  });
  figure.addEventListener('dragleave', () => figure.classList.remove('drop-target'));
  figure.addEventListener('drop', event => {
    event.preventDefault();
    figure.classList.remove('drop-target');
    if (dragging && dragging.parentElement === grid) move(dragging, [...grid.children].indexOf(figure));
  });
  figure.addEventListener('dragend', () => {
    dragging = null;
    document.querySelectorAll('.dragging, .drop-target, .tab-drop-target').forEach(el => el.classList.remove('dragging', 'drop-target', 'tab-drop-target'));
  });
}

function render() {
  syncGalleries();
  grids.forEach(grid => {
    const existing = new Map([...grid.children].map(figure => [figure.dataset.src, figure]));
    const figures = draft[grid.dataset.gallery].map(photo => {
      let figure = existing.get(photo.src);
      const replacement = sdrReplacements.get(photo._sdrRevision);
      const pending = pendingUploads.get(photo.src);
      if (figure && (figure.dataset.rendition || '') !== (photo._sdrRevision || '')) figure = null;
      if (!figure) {
        figure = createGalleryFigure({...photo, src: replacement?.url || pending?.url || photo.src,
          hdrSrc: replacement?.hdrUrl || pending?.hdrUrl || photo.hdrSrc});
        figure.dataset.src = photo.src;
        figure.dataset.rendition = photo._sdrRevision || '';
        const image = figure.querySelector('img');
        loadGalleryImage(image);
      }
      if (!figure.querySelector('.sort-controls')) decorate(figure, grid);
      return figure;
    });
    // Keep unchanged cards attached: clearing the grid collapses the page and
    // makes the browser clamp its scroll position, even when only hiding a photo.
    figures.forEach((figure, index) => {
      const current = grid.children[index];
      if (current !== figure) grid.insertBefore(figure, current || null);
    });
    const retained = new Set(figures);
    [...grid.children].forEach(figure => {
      if (!retained.has(figure)) figure.remove();
    });
  });
  refresh();
  applyPreviewMode();
}

function applyPreviewMode() {
  const media = document.querySelector('#dynamic-range').value === 'sdr' ? 'not all' : '(dynamic-range: high)';
  document.querySelectorAll('.photo-grid picture source, .lightbox picture source').forEach(source => { source.media = media; });
}
document.querySelector('#dynamic-range').addEventListener('change', applyPreviewMode);

undo.addEventListener('click', () => {
  if (busy() || !history.length) return;
  draft = JSON.parse(history.pop());
  render();
  showStatus('Letzte Änderung rückgängig gemacht.');
});

newTabButton.addEventListener('click', () => {
  if (busy()) return;
  if (Object.keys(draft).length >= 50) {
    showStatus('Maximal 50 Tabs sind möglich.');
    return;
  }
  galleryName.value = '';
  document.querySelector('#gallery-error').textContent = '';
  galleryDialog.showModal();
});
document.querySelector('#gallery-cancel').addEventListener('click', () => galleryDialog.close());
document.querySelector('#gallery-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = galleryName.value.trim();
  const invalid = !name || name.length > 60 || /[/\\\x00-\x1f\x7f]/.test(name)
    || ['__proto__', 'constructor', 'prototype', '.', '..'].includes(name);
  const duplicate = Object.keys(draft).some(category => galleryLabel(category).toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'));
  if (invalid || duplicate) {
    document.querySelector('#gallery-error').textContent = duplicate ? 'Ein Tab mit diesem Namen ist bereits vorhanden.' : 'Bitte einen Namen mit höchstens 60 Zeichen ohne Schrägstriche eingeben.';
    return;
  }
  if (busy()) return;
  galleryDialog.close();
  edit(() => {
    draft[name] = [];
    activeCategory = name;
  }, `Tab ${name} angelegt · noch nicht gespeichert.`);
});
document.querySelector('#viewport').addEventListener('change', event => {
  document.querySelector('#preview').style.width = event.target.value === 'auto' ? '100%' : `${event.target.value}px`;
});
document.querySelector('#clean').addEventListener('change', event => document.body.classList.toggle('clean', event.target.checked));
window.addEventListener('beforeunload', event => {
  if (preparing || snapshot() !== savedState) { event.preventDefault(); event.returnValue = ''; }
});

function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

async function prepareImage(file) {
  if (file.size > 60 * 1024 * 1024) throw new Error('Original ist größer als 60 MB.');
  const response = await fetch('/api/prepare', {method: 'POST',
    headers: {'Content-Type': 'application/octet-stream', 'X-Gallery-Token': document.querySelector('meta[name="gallery-token"]').content}, body: file});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Bild konnte nicht farbverwaltet vorbereitet werden.');
  const src = `upload:${crypto.randomUUID()}`;
  return {photo: {src, width: result.width, height: result.height, alt: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')},
    pending: preparedRendition(result, file.name)};
}

function base64Blob(data, type) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], {type});
}
function preparedRendition(result, name) {
  return {name, data: result.data, hdrData: result.hdrData, sdrMethod: result.sdrMethod,
    url: URL.createObjectURL(base64Blob(result.data, result.type)),
    hdrUrl: result.hdrData ? URL.createObjectURL(base64Blob(result.hdrData, 'image/jpeg')) : null};
}
function releaseRendition(rendition) {
  URL.revokeObjectURL(rendition.url);
  if (rendition.hdrUrl) URL.revokeObjectURL(rendition.hdrUrl);
}
const renditionBytes = rendition => rendition ? rendition.data.length + (rendition.hdrData?.length || 0) : 0;
const draftRenditionBytes = exceptSrc => Object.values(draft).flat().reduce((sum, photo) => photo.src === exceptSrc ? sum
  : sum + renditionBytes(sdrReplacements.get(photo._sdrRevision) || pendingUploads.get(photo.src)), 0);

sdrInput.addEventListener('change', async () => {
  const file = sdrInput.files[0];
  if (!file || busy() || !sdrTarget) return;
  const photo = draft[sdrTarget.category]?.find(item => item.src === sdrTarget.src);
  if (!photo) return;
  preparing = true;
  refresh();
  showStatus('Eigene SDR-Version wird farbverwaltet vorbereitet und mit HDR verbunden …');
  try {
    if (file.size > 60 * 1024 * 1024) throw new Error('Original ist größer als 60 MB.');
    const rendition = sdrReplacements.get(photo._sdrRevision) || pendingUploads.get(photo.src);
    const hdrBlob = await (await fetch(rendition?.hdrUrl || photo.hdrSrc)).blob();
    const response = await fetch('/api/rebase', {method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Gallery-Token': document.querySelector('meta[name="gallery-token"]').content},
      body: JSON.stringify({data: await asBase64(file), hdrData: await asBase64(hdrBlob)})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Die SDR-Version konnte nicht übernommen werden.');
    if (draftRenditionBytes(photo.src) + result.data.length + (result.hdrData?.length || 0) > 70 * 1024 * 1024) {
      throw new Error('Bitte die bisherigen Änderungen zuerst speichern.');
    }
    const before = snapshot();
    const id = `sdr:${crypto.randomUUID()}`;
    sdrReplacements.set(id, preparedRendition(result, file.name));
    photo._sdrRevision = id;
    history.push(before);
    document.querySelector('#dynamic-range').value = 'sdr';
    showStatus('Eigene SDR-Version übernommen · noch nicht gespeichert. Die Vorschau zeigt jetzt SDR.');
  } catch (error) { showStatus(error.message); }
  finally { preparing = false; sdrInput.value = ''; render(); }
});

uploadButton.addEventListener('click', () => { if (!busy()) fileInput.click(); });
async function addFiles(files) {
  if (!files.length) return;
  if (busy()) {
    showStatus('Bitte warten, bis der laufende Vorgang abgeschlossen ist, und die Bilder erneut hinzufügen.');
    return;
  }
  const category = document.querySelector('[data-tab][aria-pressed="true"]').dataset.tab;
  preparing = true;
  refresh();
  const before = snapshot();
  const errors = [];
  let added = 0;
  for (const file of files) {
    showStatus(`Bild wird vorbereitet: ${file.name} …`);
    try {
      const {photo, pending} = await prepareImage(file);
      const total = draftRenditionBytes();
      if (total + renditionBytes(pending) > 70 * 1024 * 1024) {
        releaseRendition(pending);
        throw new Error('Bitte die bisherigen Uploads zuerst speichern.');
      }
      pendingUploads.set(photo.src, pending);
      draft[category].push(photo);
      added++;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if (added) history.push(before);
  preparing = false;
  render();
  showStatus(`${added} Bild(er) hinzugefügt · noch nicht gespeichert.${errors.length ? ' ' + errors.join(' ') : ''}`);
}

fileInput.addEventListener('change', async () => {
  await addFiles([...fileInput.files]);
  fileInput.value = '';
});

// OS file drops use the same validation/preparation as the picker. Internal
// gallery drags use text/plain and keep their existing sorting behavior.
const carriesFiles = event => {
  const types = [...(event.dataTransfer?.types || [])];
  return types.includes('Files') && !types.includes('application/x-gallery-photo');
};
let fileDragDepth = 0;
function clearFileDrop() {
  fileDragDepth = 0;
  fileDropOverlay.hidden = true;
  document.querySelectorAll('.tab-drop-target').forEach(tab => tab.classList.remove('tab-drop-target'));
}
window.addEventListener('dragenter', event => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  fileDragDepth++;
  if (!busy()) {
    const category = document.querySelector('[data-tab][aria-pressed="true"]').textContent;
    fileDropOverlay.querySelector('span').textContent = `Zur Galerie ${category} hinzufügen · HDR wird erhalten, SDR farbverwaltet vorbereitet`;
    fileDropOverlay.hidden = false;
  }
});
window.addEventListener('dragover', event => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy() ? 'none' : 'copy';
});
window.addEventListener('dragleave', () => {
  if (fileDragDepth > 0 && --fileDragDepth === 0) clearFileDrop();
});
window.addEventListener('drop', event => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  clearFileDrop();
  const targetTab = event.target.closest?.('[data-tab]');
  if (targetTab) selectGallery(targetTab.dataset.tab);
  const files = [...event.dataTransfer.files];
  if (!files.length) {
    showStatus('Bitte Bilddateien hineinziehen. Ordner werden nicht unterstützt.');
    return;
  }
  void addFiles(files);
});
window.addEventListener('dragend', clearFileDrop);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') clearFileDrop();
});

save.addEventListener('click', async () => {
  if (busy()) return;
  saving = true;
  refresh();
  showStatus('Bilder und Liste werden gesichert und gespeichert …');
  try {
    const galleries = Object.fromEntries(Object.entries(draft).map(([category, photos]) => [category, photos.map(photo => {
      const pending = pendingUploads.get(photo.src);
      const replacement = sdrReplacements.get(photo._sdrRevision);
      const rendition = replacement || pending;
      return {...photo, ...(pending ? {upload: {name: pending.name, data: rendition.data, hdrData: rendition.hdrData, sdrMethod: rendition.sdrMethod}}
        : replacement ? {sdrOverride: {data: replacement.data, hdrData: replacement.hdrData}} : {})};
    })]));
    const response = await fetch('/api/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Gallery-Token': document.querySelector('meta[name="gallery-token"]').content},
      body: JSON.stringify({revision, galleries}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Speichern fehlgeschlagen.');
    revision = result.revision;
    draft = result.galleries;
    savedState = snapshot();
    history.length = 0;
    pendingUploads.forEach(releaseRendition);
    sdrReplacements.forEach(releaseRendition);
    pendingUploads.clear();
    sdrReplacements.clear();
    render();
    showStatus(result.backup ? `Lokal gespeichert · ${result.uploaded} hinzugefügt, ${result.removed} im Papierkorb · Sicherung: ${result.backup}` : 'Änderungen bereits gespeichert.');
  } catch (error) {
    showStatus(`${error.message} Deine Änderungen bleiben in der Vorschau erhalten.`);
  } finally {
    saving = false;
    refresh();
  }
});

render();
fetch('/api/state').then(response => {
  if (!response.ok) throw new Error('Bilderliste nicht erreichbar.');
  return response.json();
}).then(current => {
  if (JSON.stringify(current.galleries) !== JSON.stringify(window.GALLERY_DATA)) throw new Error('Bilderliste hat sich geändert. Bitte neu laden.');
  revision = current.revision;
  showStatus('Bereit · Upload, Ausblenden und Entfernen werden erst beim Speichern übernommen.');
  refresh();
}).catch(error => showStatus(error.message));
