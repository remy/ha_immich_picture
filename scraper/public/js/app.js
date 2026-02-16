(() => {
  const templateScript = document.getElementById('templateScript');
  const SCRIPT_TEMPLATE = templateScript?.textContent.trim() || '';
  const scriptForm = document.getElementById('textScriptForm');
  const scriptNameInput = document.getElementById('textScriptName');
  const scriptTextArea = document.getElementById('scriptContent');
  const saveScriptBtn = document.getElementById('saveScriptBtn');
  const runScriptBtn = document.getElementById('runScriptBtn');
  const statusMessage = document.getElementById('statusMessage');
  const templateBtn = document.getElementById('templateBtn');
  const newScriptBtn = document.getElementById('newScriptBtn');
  const scriptList = document.getElementById('scriptList');
  const endpointList = document.getElementById('endpointList');
  const endpointsView = document.getElementById('endpointsView');
  const editorView = document.getElementById('editorView');
  const helpSection = document.getElementById('helpSection');
  const modeButtons = document.querySelectorAll('.mode-button');
  const reloadBtn = document.getElementById('reloadBtn');
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
  const editorLogInfo = document.getElementById('editorLogInfo');
  const editorLogDetails = document.getElementById('editorLogDetails');
  const editorLogPlaceholder = document.getElementById('editorLogPlaceholder');
  const editorLogStatus = document.getElementById('editorLogStatus');
  const editorLogTime = document.getElementById('editorLogTime');
  const editorLogBody = document.getElementById('editorLogBody');
  const apiBasePath =
    (endpointList?.dataset.apiBase || '/api/').replace(/\/+$/, '/') || '/api/';

  const confirmButtonBaseClass = (confirmDeleteBtn?.className || '')
    .split(/\s+/)
    .filter((cls) => cls && cls !== 'danger')
    .join(' ');
  let confirmModalResolve = null;

  const ERROR_VIEWS_STORAGE_KEY = 'scraperKnownErrorViews';
  const normalizeScriptName = (value = '') =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  const getBaseName = (value = '') => value.replace(/\.[^.]+$/, '');
  const relativeTimeFormatter = window.Intl?.RelativeTimeFormat
    ? new window.Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null;

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

  const hideConfirmModal = () => {
    confirmModal?.classList.add('hidden');
  };

  const resolveConfirmModal = (result) => {
    if (confirmModalResolve) {
      const resolver = confirmModalResolve;
      confirmModalResolve = null;
      hideConfirmModal();
      resolver(result);
    } else if (result === false) {
      hideConfirmModal();
    }
  };

  const openConfirmModal = ({
    title = 'Confirm',
    message = '',
    confirmLabel = 'Confirm',
    variant = '',
  } = {}) => {
    if (
      !confirmModal ||
      !confirmTitle ||
      !confirmMessage ||
      !confirmDeleteBtn
    ) {
      const fallback = window.confirm(message || 'Are you sure?');
      return Promise.resolve(fallback);
    }
    return new Promise((resolve) => {
      resolveConfirmModal(false);
      confirmModalResolve = resolve;
      confirmTitle.textContent = title;
      confirmMessage.textContent = message;
      confirmDeleteBtn.textContent = confirmLabel;
      const classes = [
        confirmButtonBaseClass,
        variant === 'danger' ? 'danger' : '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      confirmDeleteBtn.className = classes;
      confirmModal.classList.remove('hidden');
    });
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

  const VALID_MODES = new Set(['endpoints', 'editor']);
  const getModeFromHash = () => {
    const raw = window.location.hash.replace('#', '').trim();
    return VALID_MODES.has(raw) ? raw : '';
  };
  const resolveInitialMode = () => {
    const hashMode = getModeFromHash();
    if (hashMode) return hashMode;
    const stateMode = window.history?.state?.mode;
    return VALID_MODES.has(stateMode) ? stateMode : 'endpoints';
  };
  let currentMode = 'endpoints';

  const syncHistory = (mode, { replace = false } = {}) => {
    if (!window.history?.pushState) return;
    const url = new URL(window.location.href);
    url.hash = mode === 'endpoints' ? '' : `#${mode}`;
    const state = { ...(window.history.state || {}), mode };
    if (replace) {
      window.history.replaceState(state, '', url);
    } else {
      window.history.pushState(state, '', url);
    }
  };

  const setMode = (
    mode,
    { updateHistory = false, replaceHistory = false } = {}
  ) => {
    if (!VALID_MODES.has(mode)) return;
    if (currentMode === mode) {
      if (updateHistory) {
        syncHistory(mode, { replace: replaceHistory });
      }
      return;
    }
    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle('active', isActive);
    });
    endpointsView?.classList.toggle('hidden', mode !== 'endpoints');
    editorView?.classList.toggle('hidden', mode !== 'editor');
    helpSection?.classList.toggle('hidden', mode !== 'endpoints');
    currentMode = mode;
    if (updateHistory) {
      syncHistory(mode, { replace: replaceHistory });
    }
  };

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode) {
        setMode(mode, { updateHistory: true });
      }
    });
  });
  setMode(resolveInitialMode(), { updateHistory: true, replaceHistory: true });
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
        // Handle both old format (string) and new format (object with file, name, schedule)
        const itemFile = typeof item === 'string' ? item : item.file;
        const itemName = typeof item === 'string' ? item.replace(/\.[^.]+$/, '') : item.name;
        const scheduleInfo = typeof item === 'object' ? item.schedule : null;

        const apiHref = makeApiLink(itemFile);
        const safeItem = escapeHTML(itemFile);
        const safeApiHref = escapeHTML(apiHref);
        const baseName = itemName;
        const log = latestLogs[baseName];
        const statusClass = log ? (log.success ? 'success' : 'error') : 'empty';
        const statusLabel = log
          ? log.success
            ? 'Success'
            : 'Error'
          : 'No recent run';
        const timeLabel = formatTimestamp(log?.timestamp);
        const relativeLastRun = formatRelativeTime(log?.timestamp);
        const durationLabel = log?.durationMs ? `${log.durationMs} ms` : '';
        const lastRunText = relativeLastRun || 'Never';
        const lastRunTitle = timeLabel || relativeLastRun || 'No runs yet';
        const logBody = escapeHTML(buildLogBody(log));
        const lastErrorTimestamp = log?.success === false ? log?.timestamp : '';
        const baseNameSafe = escapeHTML(baseName);
        const hasKnownError =
          log?.success === false &&
          hasUnseenError(baseName, lastErrorTimestamp);
        const logButtonClasses = `icon-button log-toggle-button${hasKnownError ? ' has-known-error' : ''
          }`;

        // Format schedule information
        const isScheduled = scheduleInfo?.scheduled;
        const nextRunTime = scheduleInfo?.nextRunTime;
        const scheduleDisplay = isScheduled ? ` <svg class="schedule-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>` : '';
        const nextRunDisplay = isScheduled && nextRunTime ? ` <span class="next-run-time" title="${escapeHTML(formatTimestamp(nextRunTime))}">${escapeHTML(formatRelativeTime(nextRunTime))}</span>` : '';

        return `<li class="endpoint-row">
          <div class="endpoint-header">
            <span class="script-name"><a href="${safeApiHref}" class="plain edit-link" data-action="edit-link" data-file="${safeItem}">${safeItem}</a>${scheduleDisplay}${nextRunDisplay}<span class="last-run-time" title="${escapeHTML(
          lastRunTitle
        )}">${escapeHTML(lastRunText)}</span></span>
            <div class="row-actions">
              <button type="button" class="edit-button cta" data-action="edit" data-file="${safeItem}">Edit</button>
              <a title="Call API" href="${safeApiHref}" target="_blank" rel="noopener" class="button icon-button view-button" data-action="view" data-file="${safeItem}"><img width="16" src="img/view.svg"></a>
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
              ${timeLabel
            ? `<span class="timestamp" title="Last run">${escapeHTML(
              timeLabel
            )}</span>`
            : ''
          }
              ${durationLabel
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
  let pendingRename = '';
  let latestLogs = {};
  const updateRunButtonState = () => {
    if (!runScriptBtn) return;
    const canRun = Boolean(currentFileName);
    runScriptBtn.disabled = !canRun;
    runScriptBtn.title = canRun
      ? 'Run endpoint'
      : 'Save the script to enable running';
  };
  const migrateLogEntryKey = (oldBase = '', newBase = '') => {
    if (!oldBase || !newBase || oldBase === newBase) {
      return;
    }
    if (latestLogs[oldBase]) {
      latestLogs[newBase] = latestLogs[oldBase];
      delete latestLogs[oldBase];
    }
  };

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

    return `export default async function handler(context) {
  const { request, response, browser, cheerio } = context;
${indented}
}`;
  };

  const setStatus = (text, type = '') => {
    if (!statusMessage) return;
    statusMessage.textContent = text;
    statusMessage.className = 'status ' + type;
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

  const formatRelativeTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diffSeconds = (date.getTime() - Date.now()) / 1000;
    const divisions = [
      { amount: 60, unit: 'second' },
      { amount: 60, unit: 'minute' },
      { amount: 24, unit: 'hour' },
      { amount: 7, unit: 'day' },
      { amount: 4.34524, unit: 'week' },
      { amount: 12, unit: 'month' },
      { amount: Number.POSITIVE_INFINITY, unit: 'year' },
    ];
    let duration = diffSeconds;
    for (const division of divisions) {
      if (Math.abs(duration) < division.amount) {
        const rounded = Math.round(duration);
        if (relativeTimeFormatter) {
          return relativeTimeFormatter.format(rounded, division.unit);
        }
        if (Math.abs(rounded) <= 1 && division.unit === 'second') {
          return rounded <= 0 ? 'just now' : 'in a few seconds';
        }
        const absoluteValue = Math.max(Math.abs(rounded), 1);
        const unitLabel =
          absoluteValue === 1 ? division.unit : `${division.unit}s`;
        const suffix = rounded <= 0 ? 'ago' : 'from now';
        return `${absoluteValue} ${unitLabel} ${suffix}`;
      }
      duration /= division.amount;
    }
    return '';
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

  const updateEndpointRowFromLog = (row, baseName, log) => {
    if (!row) return;
    const statusClass = log ? (log.success ? 'success' : 'error') : 'empty';
    const statusLabel = log
      ? log.success
        ? 'Success'
        : 'Error'
      : 'No recent run';
    const timeLabel = formatTimestamp(log?.timestamp);
    const relativeLastRun = formatRelativeTime(log?.timestamp);
    const durationLabel = log?.durationMs ? `${log.durationMs} ms` : '';
    const lastRunText = relativeLastRun || 'Never';
    const lastRunTitle = timeLabel || relativeLastRun || 'No runs yet';
    const logBodyText = buildLogBody(log);

    const lastRunElement = row.querySelector('.last-run-time');
    if (lastRunElement) {
      lastRunElement.textContent = lastRunText;
      lastRunElement.title = lastRunTitle;
    }

    const logElement = row.querySelector('.endpoint-log');
    if (logElement) {
      logElement.classList.remove('success', 'error', 'empty');
      logElement.classList.add(statusClass);
      const meta = logElement.querySelector('.endpoint-log-meta');
      if (meta) {
        const pill = meta.querySelector('.pill');
        if (pill) {
          pill.textContent = statusLabel;
          pill.className = `pill ${statusClass}`;
        }

        let timestampEl = meta.querySelector('.timestamp');
        if (timeLabel) {
          if (!timestampEl) {
            timestampEl = document.createElement('span');
            timestampEl.className = 'timestamp';
            meta.appendChild(timestampEl);
          }
          timestampEl.textContent = timeLabel;
          timestampEl.title = 'Last run';
        } else if (timestampEl) {
          timestampEl.remove();
        }

        let durationEl = meta.querySelector('.duration');
        if (durationLabel) {
          if (!durationEl) {
            durationEl = document.createElement('span');
            durationEl.className = 'duration';
            meta.appendChild(durationEl);
          }
          durationEl.textContent = durationLabel;
        } else if (durationEl) {
          durationEl.remove();
        }
      }

      const logBody = logElement.querySelector('.endpoint-log-body');
      if (logBody) {
        logBody.textContent = logBodyText;
      }
    }

    const logButton = row.querySelector('.log-toggle-button');
    if (logButton) {
      const lastErrorTimestamp = log?.success === false ? log?.timestamp : '';
      logButton.dataset.lastErrorTs = lastErrorTimestamp;
      if (
        log?.success === false &&
        hasUnseenError(baseName, lastErrorTimestamp)
      ) {
        logButton.classList.add('has-known-error');
      } else {
        logButton.classList.remove('has-known-error');
      }
    }
  };

  const showEndpointSpinner = (logElement) => {
    if (!logElement) return null;
    let spinner = logElement.querySelector('.endpoint-log-spinner');
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.className = 'endpoint-log-spinner';
      spinner.innerHTML =
        '<span class="spinner" aria-hidden="true"></span><span class="spinner-text">Running...</span>';
      const logBody = logElement.querySelector('.endpoint-log-body');
      if (logBody?.parentNode) {
        logBody.parentNode.insertBefore(spinner, logBody);
      } else {
        logElement.appendChild(spinner);
      }
    }
    logElement.setAttribute('aria-busy', 'true');
    return spinner;
  };

  const hideEndpointSpinner = (logElement, spinner) => {
    if (spinner) {
      spinner.remove();
    } else {
      logElement?.querySelector('.endpoint-log-spinner')?.remove();
    }
    logElement?.removeAttribute('aria-busy');
  };

  const refreshEndpointLog = async (baseName, row) => {
    if (!baseName) return;
    try {
      const response = await fetch(
        'scripts/logs/' + encodeURIComponent(baseName)
      );
      let log = null;
      if (response.ok) {
        const payload = await response.json();
        log = payload?.log || null;
      } else if (response.status !== 404) {
        return;
      }
      latestLogs[baseName] = log;
      updateEndpointRowFromLog(row, baseName, log);
      if (getBaseName(currentFileName) === baseName) {
        updateEditorLogInfo();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const runEndpoint = async (fileName, row, logElement) => {
    if (!fileName) return;
    const apiHref = makeApiLink(fileName);
    const baseName = getBaseName(fileName);
    const spinner = showEndpointSpinner(logElement);
    try {
      await fetch(apiHref, { method: 'GET' });
    } catch (error) {
      console.error(error);
    } finally {
      await refreshEndpointLog(baseName, row);
      hideEndpointSpinner(logElement, spinner);
    }
  };

  const showEditorLogPlaceholder = () => {
    if (!editorLogInfo) return;
    editorLogInfo.classList.add('dimmed');
    editorLogPlaceholder?.classList.remove('hidden');
    editorLogDetails?.classList.add('hidden');
    if (editorLogStatus) {
      editorLogStatus.textContent = 'No recent run';
      editorLogStatus.className = 'pill empty';
    }
    if (editorLogTime) {
      editorLogTime.textContent = '';
      editorLogTime.title = '';
    }
    if (editorLogBody) {
      editorLogBody.textContent = '';
    }
  };

  const updateEditorLogInfo = () => {
    if (!editorLogInfo) return;
    if (!currentFileName) {
      showEditorLogPlaceholder();
      return;
    }
    const baseName = currentFileName.replace(/\.[^.]+$/, '');
    const log = latestLogs[baseName];
    const statusClass = log ? (log.success ? 'success' : 'error') : 'empty';
    const statusLabel = log
      ? log.success
        ? 'Success'
        : 'Error'
      : 'No recent run';
    const timeLabel = formatTimestamp(log?.timestamp);
    const relativeLastRun = formatRelativeTime(log?.timestamp);
    const timeText = relativeLastRun || timeLabel || 'Never';
    const logBodyText = buildLogBody(log);

    editorLogInfo.classList.remove('dimmed');
    editorLogPlaceholder?.classList.add('hidden');
    editorLogDetails?.classList.remove('hidden');

    if (editorLogStatus) {
      editorLogStatus.textContent = statusLabel;
      editorLogStatus.className = `pill ${statusClass}`;
    }
    if (editorLogTime) {
      editorLogTime.textContent = timeText;
      editorLogTime.title = timeLabel || relativeLastRun || 'No runs yet';
    }
    if (editorLogBody) {
      editorLogBody.textContent = logBodyText;
    }
  };

  const maybeRenameCurrentScript = async (nextName = '') => {
    if (!currentFileName) {
      return true;
    }
    const sanitized = normalizeScriptName(nextName);
    const currentBase = getBaseName(currentFileName);
    if (!sanitized) {
      setStatus(
        'Script name must include letters, numbers, dashes, or underscores.',
        'error'
      );
      if (scriptNameInput) {
        scriptNameInput.value = currentBase;
        scriptNameInput.focus();
      }
      return false;
    }
    if (sanitized === currentBase) {
      if (scriptNameInput) {
        scriptNameInput.value = sanitized;
      }
      return true;
    }
    const confirmed = await openConfirmModal({
      title: 'Rename script',
      message: `Rename "${currentBase}" to "${sanitized}"? This will change its endpoint URL and history.`,
      confirmLabel: 'Rename',
    });
    if (!confirmed) {
      if (scriptNameInput) {
        scriptNameInput.value = currentBase;
        scriptNameInput.focus();
      }
      return false;
    }
    try {
      const response = await fetch('scripts/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalFileName: currentFileName,
          newName: sanitized,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setStatus(payload.error || 'Rename failed.', 'error');
        if (scriptNameInput) {
          scriptNameInput.value = currentBase;
          scriptNameInput.focus();
        }
        return false;
      }
      const newFileName = `${sanitized}.mjs`;
      migrateLogEntryKey(currentBase, sanitized);
      currentFileName = newFileName;
      if (scriptNameInput) {
        scriptNameInput.value = sanitized;
      }
      setStatus(`Renamed to ${newFileName}`, 'success');
      await refreshScripts();
      return true;
    } catch (error) {
      console.error(error);
      setStatus('Rename failed.', 'error');
      if (scriptNameInput) {
        scriptNameInput.value = currentBase;
        scriptNameInput.focus();
      }
      return false;
    }
  };

  const resetForm = () => {
    scriptForm?.reset();
    setEditorValue('');
    currentFileName = '';
    setStatus('Ready for a new script');
    showEditorLogPlaceholder();
    updateRunButtonState();
  };

  const populateFromTemplate = () => {
    setEditorValue(SCRIPT_TEMPLATE);
    setStatus('Template inserted. Customize and save.');
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
      updateEditorLogInfo();
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
      }

      setEditorValue(payload.content || '');
      currentFileName = fileName;
      setStatus(`Loaded ${fileName}`, 'success');
      updateEditorLogInfo();
      updateRunButtonState();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Failed to load script', 'error');
    }
  };

  cancelDeleteBtn?.addEventListener('click', () => resolveConfirmModal(false));
  confirmModal?.addEventListener('click', (event) => {
    if (event.target === confirmModal) {
      resolveConfirmModal(false);
    }
  });
  confirmDeleteBtn?.addEventListener('click', () => resolveConfirmModal(true));

  const openDeleteModal = (fileName) => {
    if (!fileName) return;
    openConfirmModal({
      title: 'Delete script',
      message: `Are you sure you want to delete ${fileName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    }).then((confirmed) => {
      if (confirmed) {
        deleteScript(fileName);
      }
    });
  };

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
    const actionElement = event.target.closest('button, a');
    if (!actionElement) return;
    const fileName = actionElement.dataset.file;
    const action = actionElement.dataset.action;
    if (!fileName || !action) return;

    if (action === 'edit-link') {
      // Check for modifier keys (shift, ctrl/cmd) or non-left-click to allow default link behavior
      if (
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.button !== 0
      ) {
        return; // Let default link behavior handle it
      }
      // Normal left-click: edit the script
      event.preventDefault();
      setMode('editor', { updateHistory: true });
      loadScript(fileName);
    } else if (action === 'edit') {
      if (actionElement.dataset.file) {
        setMode('editor', { updateHistory: true });
        loadScript(fileName);
      }
    } else if (action === 'rename') {
      openRenameModal(fileName);
    } else if (action === 'toggle-log') {
      const logElement = actionElement
        .closest('.endpoint-row')
        ?.querySelector('.endpoint-log');
      if (logElement) {
        logElement.classList.toggle('hidden');
        const isVisible = !logElement.classList.contains('hidden');
        if (isVisible) {
          const scriptBase = actionElement.dataset.scriptBase;
          const lastErrorTimestamp = actionElement.dataset.lastErrorTs;
          markErrorViewed(scriptBase, lastErrorTimestamp, actionElement);
        }
      }
    } else if (action === 'view') {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      const row = actionElement.closest('.endpoint-row');
      const logElement = row?.querySelector('.endpoint-log');
      if (logElement) {
        logElement.classList.remove('hidden');
      }
      await runEndpoint(fileName, row, logElement);
    } else if (action === 'delete') {
      openDeleteModal(fileName);
    }
  });

  templateBtn?.addEventListener('click', populateFromTemplate);
  newScriptBtn?.addEventListener('click', resetForm);
  runScriptBtn?.addEventListener('click', async () => {
    if (!currentFileName) {
      setStatus('Save the script before running it.', 'error');
      return;
    }
    updateEditorLogInfo();
    editorLogPlaceholder?.classList.add('hidden');
    editorLogDetails?.classList.remove('hidden');
    editorLogInfo?.classList.remove('dimmed');
    await runEndpoint(currentFileName, null, editorLogDetails || editorLogInfo);
  });
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if ((event.key || '').toLowerCase() !== 's') return;
    event.preventDefault();
    requestScriptSave();
  });

  window.addEventListener('popstate', (event) => {
    const stateMode = event.state?.mode;
    const hashMode = getModeFromHash();
    const nextMode = VALID_MODES.has(stateMode)
      ? stateMode
      : hashMode || 'endpoints';
    setMode(nextMode);
  });

  reloadBtn?.addEventListener('click', () => {
    window.location.reload();
  });

  scriptForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    let scriptName = scriptNameInput?.value.trim();
    const content = ensureDefaultExport(getEditorValue());

    if (!scriptName) {
      setStatus('Script name is required.', 'error');
      return;
    }

    if (currentFileName) {
      const renamed = await maybeRenameCurrentScript(scriptName);
      if (!renamed) {
        return;
      }
      scriptName = scriptNameInput?.value.trim();
      if (!scriptName) {
        setStatus('Script name is required.', 'error');
        return;
      }
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
      if (scriptNameInput && result.fileName) {
        scriptNameInput.value = getBaseName(result.fileName);
      }
      updateEditorLogInfo();
      updateRunButtonState();
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
  updateRunButtonState();
})();
