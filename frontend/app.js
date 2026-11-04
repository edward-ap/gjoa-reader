import { defaults, applyChrome, settingsDialog, disposeTheme } from './settings.js';
import { t, setLocale, resolveLocale, getLocale } from './i18n/i18n.js';
import { LibraryController } from './library-controller.js';
import { IconButton, ReadonlyText, TextInput, Panel, Layout, Toolbar } from 'taet-ui';
import { HidingSidePanel, EdgeActionLayer, ContextMenu, ToggleIconButton } from 'taet-ui/experimental';
import { edgeHint, observeEdgeHints } from './edge-hints.js';
import './icons.js';
import { ReaderViewHost } from './reader-view-host.js';
import { ReaderState, pageInputIndex } from './reader-state.js';
import { createPageRenderer } from './raster-adapter.js';
import { createProgressWriter } from './progress-store.js';
import { ReaderAnnotations } from './annotations.js';


const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
if (window.__TAURI__) await invoke('prepare_main_window').catch(error => console.warn('Cannot restore window:', error));
const uiSettings = window.__TAURI__ ? await invoke('read_ui_settings').catch(() => null) : null;
let preferences = { ...defaults, ...(window.__TAURI__ ? await invoke('read_settings').catch(() => null) : null) };
setLocale(resolveLocale(preferences.language)); document.documentElement.lang = getLocale(); document.title = t('app.title');
applyChrome(preferences);
let preferredViewMode = ['single', 'facing', 'continuous'].includes(uiSettings?.viewMode) ? uiSettings.viewMode : 'single';
let tutorialCompleted = uiSettings?.tutorialCompleted === true, tutorialAnchor = null, tutorialInteraction = false;
const state = new ReaderState();
state.setViewMode(preferredViewMode);
const screen = new Layout(document.querySelector('#app'), {
  name: 'reader', width: '100%', height: '100%', resizable: false,
  rows: [{ id: 'body', flex: 1, minSize: 0 }, { id: 'status', height: 44 }],
});
screen.disposables.add(disposeTheme);
const body = new Panel({ name: 'readerBody', width: '100%', height: '100%', css: 'reader-body' });
screen.cell('body').add(body);
const workspace = new Panel({ name: 'workspace', width: '100%', height: '100%', scroll: 'hidden', css: 'reader-workspace' });
body.add(workspace);
const left = new Panel({ name: 'leftDockContent', width: '100%', height: '100%', css: 'reader-left-dock' });
const libraryPanel = new HidingSidePanel({ name: 'libraryDock', title: t('library.title'),
  closeLabel: t('reader.libraryClose'), resizeLabel: t('reader.libraryResize'), tabHint: t('reader.libraryTabHint'),
  content: left, panelWidth: uiSettings?.leftWidth ?? 290, opened: !uiSettings?.leftCollapsed,
  side: uiSettings?.libraryPanel?.side ?? 'left', tabPosition: uiSettings?.libraryPanel?.tabPosition ?? 0.35 });
body.add(libraryPanel);
libraryPanel.events.on('widthChange', event => saveLibraryUI({ leftWidth: event.value }));
libraryPanel.events.on('placementChange', event => saveLibraryUI({ libraryPanel: event.value }));
function saveLibraryUI(settings) {
  if (window.__TAURI__) void invoke('save_ui_settings', settings).catch(error => console.warn('Cannot save Library panel:', error));
}
const view = new ReaderViewHost(); workspace.add(view);
const toolbar = new Toolbar({ name: 'readingActions', css: 'reader-statusbar', width: '100%' });
screen.cell('status').add(toolbar);
const pageInput = new TextInput({ name: 'pageNumber', labelWidth: 0, width: 54, value: '',
  maxLength: 9, autocomplete: 'off', onKeyDown: event => {
    if (event.key === 'Enter') { event.nativeEvent.preventDefault(); commitPage(); }
    if (event.key === 'Escape') { event.nativeEvent.preventDefault(); resetPageInput(); pageInput.blur(); }
  }, onBlur: () => resetPageInput() });
const pageCount = new ReadonlyText({ name: 'pageCount', text: '/ 0', width: 44, css: 'reader-page-count' });
const status = new ReadonlyText({ name: 'status', role: 'status', text: '', css: 'reader-status' });
const renderLight = new ToggleIconButton({ name: 'renderLight', css: 'reader-render-light', value: true, readOnly: true,
  icon: 'reader.light', checkedText: t('status.ready'), uncheckedText: t('status.rendering'), checkedIconColor: '#25934b', uncheckedIconColor: '#d63e3e' });

let navigation = 0, opening = false, destroyed = false;
let annotations;
let notice = '', lastProgressKey = '';
const progress = createProgressWriter(async (command, args) => { await invoke(command, args); if (state.book?.libraryItemId != null && state.book.documentId === args.documentId) library.updateProgress(state.book.libraryItemId, args.pageIndex); }, (error, documentId) => {
  if (!destroyed && state.book?.documentId === documentId) report(t('error.progress', { detail: error }));
});
function report(error) { if (!destroyed) { notice = String(error?.message ?? error); updateStatus(); } }
function updateNavigationGuidance() {
  const ready = !opening && !!state.book && view.isCurrentViewReady && view.currentView?.pageIndex === state.pageIndex;
  if (!tutorialCompleted && ready && tutorialAnchor?.documentId === state.book.documentId && tutorialInteraction && state.pageIndex !== tutorialAnchor.pageIndex) {
    tutorialCompleted = true;
    library.tutorialEnabled = false;
    importButton.element.classList.remove('reader-import-empty');
    void invoke('save_ui_settings', { tutorialCompleted: true }).catch(error => report(t('error.tutorial', { detail: error })));
  }
  const active = !tutorialCompleted && ready && state.book.pageCount > 1;
  previous.element.classList.toggle('reader-navigation-guide', active);
  next.element.classList.toggle('reader-navigation-guide', active);
  edges.element.classList.toggle('reader-navigation-guide', active);
}
function updateStatus() {
  if (destroyed) return;
  annotations?.sync(state.book, opening);
  updateNavigationGuidance();
  status.setText(notice);
  const busy = opening || view.renderStatus === 'rendering';
  const failed = view.renderStatus === 'error';
  const label = failed ? t('status.failed') : busy ? t('status.rendering') : t('status.ready');
  renderLight.setChecked(!busy && !failed, { silent: true });
  renderLight.getFocusElement().setAttribute('aria-label', label);
  renderLight.getFocusElement().title = t('status.hint');
  renderLight.element.title = t('status.hint');
  if (document.activeElement !== zoomInput.getFocusElement()) zoomInput.value.set(`${Math.round(view.zoom * 100)}%`);

}
function resetPageInput() { if (!destroyed) pageInput.value.set(state.book ? String(state.pageIndex + 1) : ''); }
function updateControls() {
  resetPageInput();
  pageCount.setText(`/ ${state.book?.pageCount ?? 0}`);
  for (const control of pageControls) state.book && !opening ? control.enable() : control.disable();
  single.setPressed(state.requestedViewMode === 'single'); facing.setPressed(state.requestedViewMode === 'facing'); continuous.setPressed(state.requestedViewMode === 'continuous');
  if (!state.book || opening || state.step(-1) === null) previous.disable();
  if (!state.book || opening || state.step(1) === null) next.disable();
  edges.setEdgeEnabled('left', !!state.book && !opening && !annotations?.editing && state.step(-1) !== null);
  edges.setEdgeEnabled('right', !!state.book && !opening && !annotations?.editing && state.step(1) !== null);
}
function saveVisiblePage() {
  if (opening || destroyed || !state.book || !view.isCurrentViewReady || view.currentView?.pageIndex !== state.pageIndex) return;
  const key = `${state.book.documentId}:${state.pageIndex}`;
  if (key === lastProgressKey) return;
  updateNavigationGuidance();
  lastProgressKey = key;
  void progress.save(state.book.documentId, state.pageIndex);
}
function showView(prepared, initial = false) {
  state.navigate(prepared.pageIndex);
  state.setViewMode(prepared.viewMode);
  const documentId = prepared.documentId;
  view.showView(prepared, pageIndex => createPageRenderer(invoke, { documentId, pageIndex, appearance: () => preferences.pageAppearance === 'original' ? {custom:[255,255,255]} : preferences.pageAppearance }), { opening: initial });
  updateControls();
  updateStatus();
  saveVisiblePage();
}
async function openBook(itemId, { preferReader = true, restore = false } = {}) {
  if (opening || destroyed) return;
  opening = true;
  const resumeView = view.suspend();
  const generation = ++navigation;
  state.requestedPage = state.pageIndex;
  state.requestedViewMode = state.viewMode;
  updateControls();
  notice = '';
  updateStatus();
  try {
    await progress.flush();
    const opened = await invoke(restore ? 'restore_last_document' : itemId == null ? 'open_document' : 'open_library_item', itemId == null ? undefined : { itemId, preferReader });
    if (destroyed || generation !== navigation) return;
    if (opened) {
      state.open(opened, preferredViewMode);
      tutorialAnchor = { documentId: opened.documentId, pageIndex: state.pageIndex }; tutorialInteraction = false;
      notice = opened.progressWarning ?? '';
      lastProgressKey = '';
      const prepared = await view.prepareView({ documentId: opened.documentId, pageIndex: state.pageIndex,
        pageCount: opened.pageCount, viewMode: preferredViewMode }, pageIndex =>
          pageIndex === state.pageIndex ? opened.initialPage : invoke('get_page_info', { documentId: opened.documentId, pageIndex }));
      if (destroyed || generation !== navigation) return;
      showView(prepared, true);
      if (opened.libraryItemId != null) await library.opened();
    } else updateStatus();
  } catch (error) { report(error); }
  finally { if (!destroyed) { if (state.book?.documentId === view.currentView?.documentId) resumeView(); opening = false; updateControls(); updateStatus(); saveVisiblePage(); } }
}
async function navigate(index) {
  if (!opening && index != null && index !== state.pageIndex && index >= 0 && index < state.book?.pageCount) tutorialInteraction = true;
  return changeView(index, state.requestedViewMode);
}
async function changeView(index, mode) {
  if (!state.book || opening || destroyed || index === null || index < 0 || index >= state.book.pageCount ||
    (index === state.requestedPage && mode === state.requestedViewMode)) return;
  if (mode !== 'single' && mode !== 'facing' && mode !== 'continuous') return;
  state.requestedPage = index;
  state.requestedViewMode = mode;
  const generation = ++navigation, documentId = state.book.documentId;
  notice = '';
  updateControls();
  try {
    const prepared = await view.prepareView({ documentId, pageIndex: index, pageCount: state.book.pageCount, viewMode: mode },
      pageIndex => invoke('get_page_info', { documentId, pageIndex }));
    if (destroyed || generation !== navigation) return;
    showView(prepared);
    if (preferredViewMode !== mode) {
      preferredViewMode = mode;
      void invoke('save_ui_settings', { viewMode: mode }).catch(error => report(t('error.viewMode', { detail: error })));
    }
  } catch (error) {
    if (!destroyed && generation === navigation) {
      state.requestedPage = state.pageIndex; state.requestedViewMode = state.viewMode;
      updateControls(); report(error);
    }
  }
}
function commitPage() {
  if (!state.book || opening) return;
  const text = pageInput.value.get();
  if (!String(text).trim()) return;
  const index = pageInputIndex(text, state.book.pageCount);
  if (index === null) { report(t('error.pageNumber', { count: state.book.pageCount })); return; }
  void navigate(index);
}
const icon = (name, text, glyph, action) => new IconButton({ name, text, tooltip: text, icon: `reader.${glyph}`, onClick: action });
const settingsButton = icon('settings', t('settings.title'), 'settings', () => {
  if (opening || library.dialog || library.busy) return;
  void settingsDialog(library, preferences, state.book, async next => {
    await invoke('save_settings', { settings: next });
    const recolor = JSON.stringify(next.pageAppearance) !== JSON.stringify(preferences.pageAppearance);
    preferences = next; applyChrome(preferences);
    if (recolor && state.book?.supportsPageAppearance) view.refreshAppearance();
  });
});
const libraryToggle = icon('libraryToggle', t('reader.libraryToggle'), 'library', () => { void toggleLibraryPanel().catch(report); });
const importButton = icon('import', t('import.button'), 'plus', () => library.showImport());
const previous = icon('previous', t('reader.previous'), 'previous', () => navigate(state.step(-1)));
const next = icon('next', t('reader.next'), 'next', () => navigate(state.step(1)));
const zoomOut = icon('zoomOut', t('zoom.out'), 'minus', () => view.zoomBy(0.8));
const zoomIn = icon('zoomIn', t('zoom.in'), 'plus', () => view.zoomBy(1.25));
const single = icon('single', t('view.single'), 'single', () => changeView(state.requestedPage, 'single'));
const facing = icon('facing', t('view.facing'), 'facing', () => changeView(state.requestedPage, 'facing'));
const continuous = icon('continuous', t('view.continuous'), 'continuous', () => changeView(state.requestedPage, 'continuous'));
const zoomInput = new TextInput({ name: 'zoomPercent', width: 65, labelWidth: 0, value: '100%', onKeyDown: event => {
  if (event.key === 'Enter') {
    event.nativeEvent.preventDefault(); const text = String(zoomInput.value.get()).trim().replace(/%$/, '');
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value < 5 || value > 800) { report(t('error.zoom')); return; }
    view.setZoom(value / 100); zoomInput.blur();
  }
  if (event.key === 'Escape') { zoomInput.blur(); updateStatus(); }
}, onBlur: () => updateStatus() });
const zoomMenu = new ContextMenu({ items: [
  ...[['fit', t('zoom.fit')], ['fit-width', t('zoom.fitWidth')], ['actual', t('zoom.actual')]].map(([id, text]) => ({ id, text, onClick: () => view.fit(id) })),
  { type: 'separator' }, ...[50, 75, 100, 125, 150, 200].map(value => ({ id: `zoom${value}`, text: `${value}%`, onClick: () => view.setZoom(value / 100) }))
] });
zoomMenu.mount(document.body); screen.disposables.add(() => zoomMenu.destroy());
const zoomOptions = icon('zoomOptions', t('zoom.options'), 'down', () => { const rect = zoomInput.element.getBoundingClientRect(); zoomMenu.openAt(rect.left, rect.top); });
const annotationButton = icon('annotations', t('annotations.title'), 'palette', () => annotations.toggleMenu());
const pageControls = [pageInput, previous, next, zoomOut, zoomIn, zoomInput, zoomOptions, single, continuous, facing, annotationButton];
toolbar.add(settingsButton, libraryToggle, importButton).addSeparator().add(previous, pageInput, pageCount, next).addSeparator().add(zoomOut, zoomInput, zoomOptions, zoomIn).addSeparator().add(single, continuous, facing).addSeparator().add(annotationButton, status, renderLight);
settingsButton.element.classList.add('reader-settings');
pageInput.getFocusElement()?.setAttribute('aria-label', t('reader.pageNumber'));
zoomInput.getFocusElement()?.setAttribute('aria-label', t('zoom.percentage'));
const edges = new EdgeActionLayer({ parent: workspace, observe: true,
  left: { size: .25, indicator: edgeHint('left'), action: () => navigate(state.step(-1)) },
  right: { size: .25, indicator: edgeHint('right'), action: () => navigate(state.step(1)) } });
observeEdgeHints(workspace, edges);
annotations = new ReaderAnnotations(view, annotationButton, updateControls, report, body.element);
screen.disposables.addEventListener(workspace.element, 'wheel', event => {
  if (!opening && state.viewMode === 'continuous' && !event.ctrlKey && event.deltaY) tutorialInteraction = true;
}, { passive: true, capture: true });
screen.disposables.addEventListener(workspace.element, 'keydown', event => {
  if (!opening && state.viewMode === 'continuous' && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) tutorialInteraction = true;
}, { capture: true });
// Keep native window geometry under the user's control. Changing both the HWND
// and WebView layout exposed intermediate frames on Windows, even with SetWindowPos.
async function toggleLibraryPanel() {
  libraryPanel.toggle();
}
libraryPanel.events.on('openChange', () => {
  libraryToggle.setPressed(libraryPanel.opened);
  saveLibraryUI({ leftCollapsed: !libraryPanel.opened });
});
libraryToggle.setPressed(libraryPanel.opened);
view.events.on('viewportChange', event => { state.observeViewport(event.newValue); updateStatus(); });
view.events.on('renderStart', updateStatus);
view.events.on('renderComplete', () => { updateStatus(); saveVisiblePage(); });
view.events.on('renderError', event => report(event.error));
view.events.on('pageChange', event => {
  if (opening || state.requestedViewMode !== 'continuous' || state.requestedPage !== state.pageIndex || state.book?.documentId !== event.documentId) return;
  navigation++; state.navigate(event.pageIndex); updateControls(); saveVisiblePage();
});
screen.disposables.addEventListener(window, 'keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'o' && !library.dialog && !event.defaultPrevented) {
    event.preventDefault();
    if (event.shiftKey) void library.importWithHistory(); else if (!library.busy) void openBook();
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'g' && state.book) {
    event.preventDefault(); pageInput.focus(); pageInput.getFocusElement()?.select();
  }
});
const library = new LibraryController(left, invoke, (itemId, options) => openBook(itemId, options), undefined, report);
library.tutorialEnabled = !tutorialCompleted;
library.onEmptyChange = empty => importButton.element.classList.toggle('reader-import-empty', empty && !tutorialCompleted);
library.isOpen = itemId => !opening && state.book?.libraryItemId === itemId;
async function closeBook(itemId) {
  if (opening) throw Error(t('error.waitOpen'));
  if (state.book?.libraryItemId !== itemId) return;
  opening = true; ++navigation;
  const resume = view.suspend(); updateControls();
  try {
    await progress.flush(); await invoke('close_document');
    state.book = null; lastProgressKey = ''; view.clearDocument(); notice = '';
    tutorialAnchor = null; tutorialInteraction = false;
  } catch (error) { resume(); throw error; }
  finally { opening = false; updateControls(); updateStatus(); }
}
library.onClose = closeBook;
library.beforeDelete = async itemIds => {
  if (opening) throw Error(t('error.waitOpen'));
  if (itemIds.includes(state.book?.libraryItemId)) await closeBook(state.book.libraryItemId);
};
library.onRename = (itemId, name) => { if (state.book?.libraryItemId === itemId) state.book.displayName = name; };
const darkMedia = matchMedia('(prefers-color-scheme: dark)');
screen.disposables.addEventListener(darkMedia, 'change', () => {
  // Settings owns its live draft; closing it resolves the current system theme.
  if (!library.dialog?.element.classList.contains('settings-dialog')) applyChrome(preferences);
});
updateControls();
updateStatus();
window.addEventListener('beforeunload', () => {
  destroyed = true; navigation++;
  annotations.destroy();
  screen.destroy();
  // Explicit Close clears the remembered book; process teardown must retain it.
  void progress.flush().catch(() => {});
}, { once: true });
if (window.__TAURI__?.window) {
  const mainWindow = window.__TAURI__.window.getCurrentWindow();
  let closing = false;
  screen.disposables.add(await mainWindow.onCloseRequested(async event => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await annotations.flush(); await progress.flush(); await mainWindow.destroy();
    } catch (error) { closing = false; report(`Cannot close before saving annotations: ${error}`); }
  }));
}
if (window.__TAURI__) {
  // Hidden WebViews may suspend animation frames; readiness must not depend on rAF.
  void Promise.all([library.ready, document.fonts.ready]).then(async () => {
    if (!destroyed && !state.book && !opening && uiSettings?.lastBook) await openBook(undefined, { restore: true });
  }).finally(() => {
    if (!destroyed) void invoke('show_main_window').catch(error => report(error));
  });
}

