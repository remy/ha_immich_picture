(() => {
  const templateScript = document.getElementById('templateScript');
  const SCRIPT_TEMPLATE = templateScript?.textContent.trim() || '';
  const scriptForm = document.getElementById('textScriptForm');
  const scriptNameInput = document.getElementById('textScriptName');
  const scriptTextArea = document.getElementById('scriptContent');
  const saveScriptBtn = document.getElementById('saveScriptBtn');
  const statusMessage = document.getElementById('statusMessage');
  const templateBtn = document.getElementById('templateBtn');
  const newScriptBtn = document.getElementById('newScriptBtn');
  const scriptList = document.getElementById('scriptList');
  const endpointList = document.getElementById('endpointList');
  const endpointsView = document.getElementById('endpointsView');
  const editorView = document.getElementById('editorView');
  const modeButtons = document.querySelectorAll('.mode-button');
  const confirmModal = document.getElementById('confirmModal');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const renameModal = document.getElementById('renameModal');
  const renameTitle = document.getElementById('renameTitle');
  const renameMessage = document.getElementById('renameMessage');
  const renameInput = document.getElementById('renameInput');
  const confirmRenameBtn = document.getElementById('confirmRenameBtn');
  const cancelRenameBtn = document.getElementById('cancelRenameBtn');
  const apiBasePath =
    (endpointList?.dataset.apiBase || '/api/').replace(/\/+$/, '/') || '/api/';

  const ERROR_VIEWS_STORAGE_KEY = 'scraperKnownErrorViews';

  const loadViewedErrors = () => {
    if (!window.localStorage) return {};
    try {
      const raw = window.localStorage.getItem(ERROR_VIEWS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  const persistViewedErrors = (state = {}) => {
    if (!window.localStorage) return;
    try {
      window.localStorage.setItem(
        ERROR_VIEWS_STORAGE_KEY,
        JSON.stringify(state)
      );
    } catch {
      // ignore storage errors
    }
  };

  const viewedErrors = loadViewedErrors();

  const hasUnseenError = (scriptBaseName = '', timestamp = '') => {
    if (!scriptBaseName || !timestamp) {
      return false;
    }
    return viewedErrors[scriptBaseName] !== timestamp;
  };

  const markErrorViewed = (
    scriptBaseName = '',
    timestamp = '',
    buttonEl = null
  ) => {
    if (!scriptBaseName || !timestamp) {
      return;
    }
    if (viewedErrors[scriptBaseName] === timestamp) {
      return;
    }
    viewedErrors[scriptBaseName] = timestamp;
    persistViewedErrors(viewedErrors);
    buttonEl?.classList.remove('has-known-error');
  };

  const requestScriptSave = () => {
    if (
      !scriptForm ||
      editorView?.classList.contains('hidden') ||
      saveScriptBtn?.disabled
    ) {
      return;
    }
    if (typeof scriptForm.requestSubmit === 'function') {
      scriptForm.requestSubmit();
    } else {
      const submitEvent = new Event('submit', {
        bubbles: true,
        cancelable: true,
      });
      scriptForm.dispatchEvent(submitEvent);
    }
  };

  const createEditor = () => {
    if (!window.CodeMirror || !scriptTextArea) {
      return null;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const editorInstance = window.CodeMirror.fromTextArea(scriptTextArea, {
      mode: 'javascript',
      theme: media.matches ? 'material-darker' : 'default',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      autoCloseBrackets: true,
    });
    editorInstance.setSize('100%', 360);
    media.addEventListener?.('change', (event) => {
      editorInstance.setOption(
        'theme',
        event.matches ? 'material-darker' : 'default'
      );
    });
    editorInstance.addKeyMap({
      'Cmd-S': () => requestScriptSave(),
      'Ctrl-S': () => requestScriptSave(),
    });
    return editorInstance;
  };

  const editor = createEditor();
  if (editor && scriptTextArea) {
    scriptTextArea.removeAttribute('required');
  }
  const getEditorValue = () =>
    editor ? editor.getValue() : scriptTextArea?.value || '';
  const setEditorValue = (value = '') => {
    if (editor) {
      editor.setValue(value);
      editor.refresh();
    } else if (scriptTextArea) {
      scriptTextArea.value = value;
    }
  };

  const setMode = (mode) => {
    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle('active', isActive);
    });
    endpointsView?.classList.toggle('hidden', mode !== 'endpoints');
    editorView?.classList.toggle('hidden', mode !== 'editor');
  };

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode) {
        setMode(mode);
      }
    });
  });
  setMode('endpoints');
  confirmModal?.classList.add('hidden');

  const makeApiLink = (fileName = '') =>
    apiBasePath + fileName.replace(/\.[^.]+$/, '');

  const renderEndpointList = (items = []) => {
    if (!endpointList) return;
    if (!items.length) {
      endpointList.innerHTML = '<li>No scripts found yet.</li>';
      return;
    }
    endpointList.innerHTML = items
      .map((item) => {
        const apiHref = makeApiLink(item);
        const safeItem = escapeHTML(item);
        const safeApiHref = escapeHTML(apiHref);
        const baseName = item.replace(/\.[^.]+$/, '');
        const log = latestLogs[baseName];
        const statusClass = log ? (log.success ? 'success' : 'error') : 'empty';
        const statusLabel = log
          ? log.success
            ? 'Success'
            : 'Error'
          : 'No recent run';
        const timeLabel = formatTimestamp(log?.timestamp);
        const durationLabel = log?.durationMs ? `${log.durationMs} ms` : '';
        const logBody = escapeHTML(buildLogBody(log));
        const lastErrorTimestamp = log?.lastError?.timestamp || '';
        const baseNameSafe = escapeHTML(baseName);
        const hasKnownError = hasUnseenError(baseName, lastErrorTimestamp);
        const logButtonClasses = `icon-button log-toggle-button${
          hasKnownError ? ' has-known-error' : ''
        }`;

        return `<li class="endpoint-row">
          <div class="endpoint-header">
            <span class="script-name"><a class="api-link" title="Call API and view results" href="${safeApiHref}" target="_blank" rel="noopener">${safeItem}<img width="16" src="img/view.svg"></a></span>
            <div class="row-actions">
              <button type="button" class="edit-button" data-action="edit" data-file="${safeItem}"><img width="16" src="img/edit.svg"> Edit</button>
              <button type="button" title="Rename endpoint" class="icon-button rename-button" data-action="rename" data-file="${safeItem}"><img width="16" src="img/rename.svg"></button>
              <button type="button" title="Toggle log" class="${logButtonClasses}" data-action="toggle-log" data-file="${safeItem}" data-script-base="${baseNameSafe}" data-last-error-ts="${escapeHTML(
          lastErrorTimestamp
        )}"><img width="16" src="img/log.svg"></button>
              <button type="button" class="icon-button delete-button" title="Delete script" data-action="delete" data-file="${safeItem}"><img width="16" src="img/delete.svg"></button>
            </div>
          </div>
          <div class="endpoint-log ${statusClass} hidden">
            <div class="endpoint-log-meta">
              <span class="pill ${statusClass}">${escapeHTML(
          statusLabel
        )}</span>
              ${
                timeLabel
                  ? `<span class="timestamp" title="Last run">${escapeHTML(
                      timeLabel
                    )}</span>`
                  : ''
              }
              ${
                durationLabel
                  ? `<span class="duration">${escapeHTML(durationLabel)}</span>`
                  : ''
              }
            </div>
            <pre class="endpoint-log-body">${logBody}</pre>
          </div>
        </li>`;
      })
      .join('');
  };

  let currentFileName = '';
  let pendingDelete = null;
  let pendingRename = '';
  let latestLogs = {};

  const ensureDefaultExport = (content = '') => {
    const pattern = /export\s+default\s+/;
    if (pattern.test(content)) {
      return content;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return SCRIPT_TEMPLATE;
    }

    const indented = trimmed
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n');

    return `export default async function handler(req, res, browser) {
${indented}
}`;
  };

  const setStatus = (text, type = '') => {
    if (!statusMessage) return;
    statusMessage.textContent = text;
    statusMessage.className = 'status ' + type;
  };

  const resetForm = () => {
    scriptForm?.reset();
    setEditorValue('');
    currentFileName = '';
    if (scriptNameInput) {
      scriptNameInput.readOnly = false;
    }
    setStatus('Ready for a new script');
  };

  const populateFromTemplate = () => {
    setEditorValue(SCRIPT_TEMPLATE);
    setStatus('Template inserted. Customize and save.');
  };

  const stringifyValue = (value) => {
    try {
      if (typeof value === 'string') return value;
      return JSON.stringify(value, null, 2);
    } catch (error) {
      try {
        return String(value);
      } catch (fallbackError) {
        return '[Unserializable value]';
      }
    }
  };

  const formatTimestamp = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  };

  const buildLogBody = (log) => {
    if (!log) return 'No recent execution yet.';

    const lines = [];

    if (log.success === false && log.error) {
      const message = log.error.message || log.error;
      lines.push(`Error: ${stringifyValue(message)}`);
    }

    if (log.result !== undefined) {
      lines.push(stringifyValue(log.result));
    }

    if (log.logs?.length) {
      lines.push('Console logs:');
      log.logs
        .slice(-10)
        .forEach((entry) =>
          lines.push(
            `[${entry.level}] ${entry.message || stringifyValue(entry)}`
          )
        );
    }

    if (!lines.length) {
      return 'No details available.';
    }

    return lines.join('\n');
  };

  const refreshScripts = async () => {
    try {
      const response = await fetch('scripts/list?includeLogs=1');
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (!data?.scripts) {
        return;
      }
      latestLogs = data.logs || {};
      renderEndpointList(data.scripts);
    } catch (error) {
      console.error(error);
    }
  };

  const loadScript = async (fileName) => {
    try {
      const response = await fetch(
        'scripts/content/' + encodeURIComponent(fileName)
      );
      if (!response.ok) {
        throw new Error('Unable to load script');
      }
      const payload = await response.json();
      const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');

      if (scriptNameInput) {
        scriptNameInput.value = nameWithoutExt;
        scriptNameInput.readOnly = true;
      }

      setEditorValue(payload.content || '');
      currentFileName = fileName;
      setStatus(`Loaded ${fileName}`, 'success');
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Failed to load script', 'error');
    }
  };

  const openDeleteModal = (fileName) => {
    if (!confirmModal) return;
    pendingDelete = fileName;
    confirmTitle.textContent = 'Delete script';
    confirmMessage.textContent = `Are you sure you want to delete ${fileName}? This cannot be undone.`;
    confirmModal.classList.remove('hidden');
  };

  const closeDeleteModal = () => {
    pendingDelete = null;
    confirmModal?.classList.add('hidden');
  };

  cancelDeleteBtn?.addEventListener('click', closeDeleteModal);
  confirmModal?.addEventListener('click', (event) => {
    if (event.target === confirmModal) {
      closeDeleteModal();
    }
  });

  const openRenameModal = (fileName) => {
    if (!renameModal || !renameInput) return;
    pendingRename = fileName;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    renameTitle.textContent = 'Rename script';
    renameMessage.textContent = `Rename ${fileName}`;
    renameInput.value = baseName;
    renameModal.classList.remove('hidden');
    requestAnimationFrame(() => {
      renameInput.focus();
      renameInput.select();
    });
  };

  const closeRenameModal = () => {
    pendingRename = '';
    renameModal?.classList.add('hidden');
  };

  const submitRename = async () => {
    if (!pendingRename) {
      return;
    }
    const newName = renameInput?.value.trim();
    if (!newName) {
      setStatus('A new name is required.', 'error');
      renameInput?.focus();
      return;
    }
    try {
      const response = await fetch('scripts/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalFileName: pendingRename,
          newName,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        window.alert(payload.error || 'Rename failed.');
        return;
      }
      await refreshScripts();
      setStatus(`Renamed ${pendingRename}`, 'success');
      closeRenameModal();
    } catch (error) {
      console.error(error);
      window.alert('Rename failed.');
    }
  };

  cancelRenameBtn?.addEventListener('click', closeRenameModal);
  renameModal?.addEventListener('click', (event) => {
    if (event.target === renameModal) {
      closeRenameModal();
    }
  });
  confirmRenameBtn?.addEventListener('click', submitRename);
  renameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitRename();
    }
  });

  const deleteScript = async (fileName) => {
    try {
      const response = await fetch('scripts/' + encodeURIComponent(fileName), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        window.alert(payload.error || 'Delete failed.');
        return;
      }
      await refreshScripts();
      resetForm();
      setStatus(`Deleted ${fileName}`, 'success');
    } catch (error) {
      console.error(error);
      window.alert('Delete failed.');
    } finally {
      closeDeleteModal();
    }
  };

  confirmDeleteBtn?.addEventListener('click', () => {
    if (pendingDelete) {
      deleteScript(pendingDelete);
    }
  });

  scriptList?.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const fileName = button.dataset.file;
    const action = button.dataset.action || 'edit';
    if (!fileName) return;

    if (button.classList.contains('script-button')) {
      loadScript(fileName);
      return;
    }

    if (action === 'rename') {
      openRenameModal(fileName);
    } else if (action === 'delete') {
      openDeleteModal(fileName);
    }
  });

  endpointList?.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const fileName = button.dataset.file;
    const action = button.dataset.action;
    if (!fileName || !action) return;

    if (action === 'edit') {
      if (button.dataset.file) {
        setMode('editor');
        loadScript(fileName);
      }
    } else if (action === 'rename') {
      openRenameModal(fileName);
    } else if (action === 'toggle-log') {
      const logElement = button
        .closest('.endpoint-row')
        ?.querySelector('.endpoint-log');
      if (logElement) {
        logElement.classList.toggle('hidden');
        const isVisible = !logElement.classList.contains('hidden');
        if (isVisible) {
          const scriptBase = button.dataset.scriptBase;
          const lastErrorTimestamp = button.dataset.lastErrorTs;
          markErrorViewed(scriptBase, lastErrorTimestamp, button);
        }
      }
    } else if (action === 'delete') {
      openDeleteModal(fileName);
    }
  });

  templateBtn?.addEventListener('click', populateFromTemplate);
  newScriptBtn?.addEventListener('click', resetForm);
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if ((event.key || '').toLowerCase() !== 's') return;
    event.preventDefault();
    requestScriptSave();
  });

  scriptForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const scriptName = scriptNameInput?.value.trim();
    const content = ensureDefaultExport(getEditorValue());

    if (!scriptName) {
      setStatus('Script name is required.', 'error');
      return;
    }

    try {
      const response = await fetch('scripts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: currentFileName,
          scriptName,
          scriptContent: content,
        }),
      });

      if (!response.ok) {
        throw new Error('Unable to save script');
      }

      const result = await response.json();
      currentFileName = result.fileName;
      if (scriptNameInput) {
        scriptNameInput.readOnly = true;
      }
      setStatus(result.message || 'Saved', 'success');
      await refreshScripts();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Save failed', 'error');
    }
  });

  if (!getEditorValue().trim()) {
    setStatus('Start with the template or paste a script.');
  }

  const escapeHTML = (value = '') =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  refreshScripts();
})();
