(() => {
  const templateScript = document.getElementById('templateScript');
  const SCRIPT_TEMPLATE = templateScript?.textContent.trim() || '';
  const scriptForm = document.getElementById('textScriptForm');
  const scriptNameInput = document.getElementById('textScriptName');
  const scriptTextArea = document.getElementById('scriptContent');
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
        return `<li class="endpoint-row">
          <span class="script-name"><a class="api-link" title="Cal API and view results" href="${safeApiHref}" target="_blank" rel="noopener">${safeItem}<img width="16" src="img/view.svg"></a></span>
          <div class="row-actions">
            <button type="button" class="edit-button" data-action="edit" data-file="${safeItem}"><img width="16" src="img/edit.svg"> Edit</button>
            <button type="button" title="Rename endpoint" class="icon-button rename-button" data-action="rename" data-file="${safeItem}"><img width="16" src="img/rename.svg"></button>
            <button type="button" class="icon-button delete-button" title="Delete script" data-action="delete" data-file="${safeItem}"><img width="16" src="img/delete.svg"></button>
          </div>
        </li>`;
      })
      .join('');
  };

  const renderEditorList = (items = []) => {
    if (!scriptList) return;
    if (!items.length) {
      scriptList.innerHTML = '<li>No scripts found yet.</li>';
      return;
    }
    scriptList.innerHTML = items
      .map((item) => {
        const apiHref = makeApiLink(item);
        const safeItem = escapeHTML(item);
        const safeApiHref = escapeHTML(apiHref);
        return `<li>
          <button type="button" class="script-button" data-file="${safeItem}">${safeItem}</button>
          <a class="api-link" href="${safeApiHref}" target="_blank" rel="noopener">API</a>
          <button type="button" class="rename-button" data-action="rename" data-file="${safeItem}">Rename</button>
          <button type="button" class="delete-button" data-action="delete" data-file="${safeItem}">Delete</button>
        </li>`;
      })
      .join('');
  };

  let currentFileName = '';
  let pendingDelete = null;
  let pendingRename = '';

  const ensureRunExport = (content = '') => {
    const pattern = /export\s+(async\s+)?function\s+run/;
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

    return `export async function run(req, res, browser) {
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

  const refreshScripts = async () => {
    try {
      const response = await fetch('scripts/list');
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (!data?.scripts) {
        return;
      }
      renderEndpointList(data.scripts);
      renderEditorList(data.scripts);
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
    } else if (action === 'delete') {
      openDeleteModal(fileName);
    }
  });

  templateBtn?.addEventListener('click', populateFromTemplate);
  newScriptBtn?.addEventListener('click', resetForm);

  scriptForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const scriptName = scriptNameInput?.value.trim();
    const content = ensureRunExport(getEditorValue());

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
