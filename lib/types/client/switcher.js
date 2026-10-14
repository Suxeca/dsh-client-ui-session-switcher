import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The quick-switch palette. Reads the sessions/workspaces snapshot stores
 * directly via useSyncExternalStore (both are subscription stores with
 * cached snapshots). Modes: management (shortcuts, workspace-grouped list
 * mirroring the left sidebar), search (S, typing filters a flat list),
 * rename (R). Opening the palette selects the current conversation by
 * default. Skins (深色/浅色/高对比) cycle through the header button and
 * persist in localStorage; the `data-skin` attribute drives the CSS
 * variable palette in switcher.module.css.
 * @module @suxeca/dsh-client-ui-session-switcher/client/switcher
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SKIN_LABELS, loadSkin, nextSkin, saveSkin } from "./skins.js";
import { UNGROUPED_KEY, archivedSessions, currentSessionId, cycleAnchor, getWorkspaceHue, paletteItems, recencyOrder, relTime, rowIndexOf, timeRecencyLevel, titleOf, turnCountOf, workspaceIdOwning, } from "./utils.js";
import { ACTIONS, ACTION_LABELS, bindingFromEvent, formatBinding, isModifierKey, matchesBinding, } from "./keymap.js";
import css from './switcher.module.css';
/** localStorage flag recording the one-time readiness-toast dismissal. */
const TOAST_KEY = 'dsh.sessionSwitcher.toastSeen';
/** localStorage flag recording whether older/inactive sessions are hidden by default. */
const HIDE_OLD_KEY = 'dsh.sessionSwitcher.hideInactive';
/** Inline keyboard hint chip. */
function Kbd({ children }) {
    return _jsx("kbd", { className: css.kbd, children: children });
}
/**
 * The palette component. Both render branches carry the skin attribute on
 * their root so the toast (closed) and the card (open) share one variable
 * palette.
 */
export function Switcher({ ctx, openStore, keymapStore }) {
    const palette = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot);
    const open = palette.open;
    // The sessions list is an arrow-bound SnapshotStore, so binding is optional;
    // workspaces.list is a ClientWorkspaceModel whose getSnapshot/subscribe are
    // prototype methods — extracting them bare makes React call them with an
    // undefined `this` (throws "reading 'refreshSnapshot'"). Wrap both
    // symmetrically so neither store leaks its receiver.
    const sessionsSnap = useSyncExternalStore((listener) => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot());
    const workspacesSnap = useSyncExternalStore((listener) => ctx.workspaces.list.subscribe(listener), () => ctx.workspaces.list.getSnapshot());
    const keymap = useSyncExternalStore(keymapStore.subscribe, keymapStore.getSnapshot);
    const [query, setQuery] = useState('');
    /** Selection position within the row-only subsequence (headers are skipped). */
    const [index, setIndex] = useState(0);
    const [showArchived, setShowArchived] = useState(false);
    const [searching, setSearching] = useState(false);
    const [renameId, setRenameId] = useState(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [error, setError] = useState(null);
    const [showReadyToast, setShowReadyToast] = useState(() => {
        try {
            return localStorage.getItem(TOAST_KEY) !== '1';
        }
        catch {
            return true;
        }
    });
    const [skinName, setSkinName] = useState(loadSkin);
    const [configuring, setConfiguring] = useState(false);
    const [captureAction, setCaptureAction] = useState(null);
    const [hideOldSessions, setHideOldSessions] = useState(() => {
        try {
            return localStorage.getItem(HIDE_OLD_KEY) !== '0';
        }
        catch {
            return true;
        }
    });
    const [expandedGroups, setExpandedGroups] = useState(() => new Set());
    const inputRef = useRef(null);
    const renameRef = useRef(null);
    const cardRef = useRef(null);
    const listRef = useRef(null);
    const toggleHideOldSessions = () => {
        setHideOldSessions((v) => {
            const next = !v;
            try {
                localStorage.setItem(HIDE_OLD_KEY, next ? '1' : '0');
            }
            catch {
                /* storage unavailable */
            }
            return next;
        });
    };
    const toggleGroupExpand = (groupKey) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupKey))
                next.delete(groupKey);
            else
                next.add(groupKey);
            return next;
        });
    };
    const jumpToPinnedRow = () => {
        const pinnedIdx = items.findIndex((it) => it.kind === 'row' && pinnedSet.has(it.session.id));
        if (pinnedIdx !== -1) {
            const rowIdx = rowPositions.indexOf(pinnedIdx);
            if (rowIdx !== -1)
                setIndex(rowIdx);
        }
    };
    // One-time readiness toast (persisted dismissal), auto-hides.
    useEffect(() => {
        if (!showReadyToast)
            return;
        const timer = setTimeout(() => setShowReadyToast(false), 8000);
        return () => clearTimeout(timer);
    }, [showReadyToast]);
    const dismissToast = () => {
        setShowReadyToast(false);
        try {
            localStorage.setItem(TOAST_KEY, '1');
        }
        catch {
            /* storage unavailable */
        }
    };
    // Transient operation errors auto-clear after 4s.
    useEffect(() => {
        if (error === null)
            return;
        const timer = setTimeout(() => setError(null), 4000);
        return () => clearTimeout(timer);
    }, [error]);
    // The sessions list store exposes `ids` + `byId` (entries carry
    // `id`/`displayTitle`/`parentId`); it has no `items` field. The workspaces
    // store exposes `items`. Both are fallback-guarded until the baselines land.
    const workspaceItems = workspacesSnap.items ?? [];
    const archivedIds = workspacesSnap.archivedSessionIds ?? [];
    const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds]);
    const pinnedIds = workspacesSnap.pinnedSessionIds ?? [];
    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
    const currentId = useMemo(() => currentSessionId(sessionsSnap), [sessionsSnap]);
    /** The workspace owning the current session; falls back to the recent-workspace projection. */
    const currentWorkspaceId = useMemo(() => {
        if (currentId !== undefined) {
            const owner = workspaceIdOwning(workspaceItems, currentId);
            if (owner !== undefined)
                return owner;
        }
        return workspacesSnap.recentWorkspaceId;
    }, [currentId, workspaceItems, workspacesSnap.recentWorkspaceId]);
    /** Sequential index map per workspace to guarantee every distinct workspace has a unique contrasting color. */
    const workspaceColorMap = useMemo(() => {
        const map = new Map();
        let idx = 0;
        for (const w of workspaceItems) {
            if (!map.has(w.workspaceId)) {
                map.set(w.workspaceId, idx++);
            }
        }
        return map;
    }, [workspaceItems]);
    /**
     * The palette list.
     * Search mode presents conversations ordered globally by recency so recent
     * items appear immediately at the top without long scrolls. Older/inactive
     * sessions are folded into an expandable item when hideOldSessions is true
     * (non-empty queries automatically bypass folding to search all conversations).
     * Management mode groups conversations by workspace with section folding.
     */
    const items = useMemo(() => {
        if (searching) {
            const q = query.trim().toLowerCase();
            const rows = paletteItems(sessionsSnap, workspacesSnap, 'flat', {
                sort: 'recency',
                hideStale: q === '' ? hideOldSessions : false,
                currentId,
                expandedGroups,
            }).filter((item) => (item.kind === 'folded' || (item.kind === 'row' && (q === '' || titleOf(item.session).toLowerCase().includes(q)))));
            return rows;
        }
        if (showArchived) {
            return archivedSessions(sessionsSnap, workspacesSnap).map((row) => ({ kind: 'row', ...row }));
        }
        return paletteItems(sessionsSnap, workspacesSnap, 'grouped', {
            hideStale: hideOldSessions,
            currentId,
            expandedGroups,
        });
    }, [sessionsSnap, workspacesSnap, searching, query, showArchived, hideOldSessions, expandedGroups, currentId]);
    /** Item positions holding a session row, in list order. */
    const rowPositions = useMemo(() => items.reduce((acc, item, pos) => {
        if (item.kind === 'row')
            acc.push(pos);
        return acc;
    }, []), [items]);
    const selected = index < rowPositions.length ? items[rowPositions[index]] : null;
    // Reset transient state each time the palette opens; select the current
    // conversation by default and focus the filter.
    useEffect(() => {
        if (!open)
            return;
        setQuery('');
        setShowArchived(false);
        // Default to search mode: the palette opens with the filter focused so
        // typing immediately filters conversations (search-as-you-type).
        setSearching(true);
        setRenameId(null);
        setError(null);
        setConfiguring(false);
        setCaptureAction(null);
        if (keymapStore.getSnapshot().capturing)
            keymapStore.endCapture();
        const initialList = paletteItems(sessionsSnap, workspacesSnap, 'flat', {
            sort: 'recency',
            hideStale: hideOldSessions,
            currentId,
            expandedGroups,
        });
        const anchor = cycleAnchor(recencyOrder(sessionsSnap, workspacesSnap), currentId, sessionsSnap.byId);
        const rowIndex = rowIndexOf(initialList, anchor);
        setIndex(rowIndex === -1 ? 0 : rowIndex);
        cardRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate open-transition snapshot read
    }, [open]);
    // Entering search focuses the filter; rename focuses its editor.
    useEffect(() => {
        if (searching)
            inputRef.current?.focus();
    }, [searching]);
    useEffect(() => {
        if (renameId !== null)
            renameRef.current?.focus();
    }, [renameId]);
    // Clamp the selection when the list shrinks.
    useEffect(() => {
        setIndex((i) => (rowPositions.length === 0 ? 0 : Math.min(i, rowPositions.length - 1)));
    }, [rowPositions.length]);
    // Keep the selected row visible: keyboard navigation (and the open-time
    // jump to the current conversation) can drive the selection past the
    // list's viewport. `block: nearest` scrolls only the list itself.
    useEffect(() => {
        if (!open)
            return;
        const row = listRef.current?.querySelector(`[data-row-index="${index}"]`);
        row?.scrollIntoView({ block: 'nearest' });
    }, [open, index]);
    const openSession = (sessionId) => {
        if (ctx.uiWorkspace?.openSession) {
            ctx.uiWorkspace.openSession(sessionId);
        }
        else if (ctx.sessions.open) {
            ctx.sessions.open(sessionId);
        }
        openStore.close();
    };
    /** Space-preview the selected conversation: switch to it WITHOUT leaving
     *  the palette interaction — Esc restores the previous session and returns
     *  to the card; Enter confirms the switch. Archived sessions work the same
     *  (sessions.open addresses them; only the sidebar hides them). */
    const startPreview = () => {
        if (selected === null)
            return;
        const fromId = currentId;
        openStore.enterPreview(selected.session.id, fromId);
        if (ctx.uiWorkspace?.openSession) {
            ctx.uiWorkspace.openSession(selected.session.id);
        }
        else if (ctx.sessions.open) {
            ctx.sessions.open(selected.session.id);
        }
    };
    const newConversation = () => {
        try {
            if (ctx.uiWorkspace?.startSession) {
                ctx.uiWorkspace.startSession(currentWorkspaceId);
            }
            else if (ctx.workspaces.startSession) {
                ctx.workspaces.startSession(currentWorkspaceId);
            }
            else {
                throw new Error('未提供新建会话功能');
            }
        }
        catch (err) {
            setError(`新建会话失败：${err instanceof Error ? err.message : String(err)}`);
        }
        openStore.close();
    };
    const archiveSession = (sessionId) => {
        const p = ctx.uiWorkspace?.archiveSession
            ? ctx.uiWorkspace.archiveSession(sessionId)
            : ctx.workspaces.archiveSession(sessionId);
        void p.catch((err) => {
            setError(`归档失败：${err instanceof Error ? err.message : String(err)}`);
        });
    };
    const unarchiveSession = (sessionId) => {
        const p = ctx.uiWorkspace?.unarchiveSession
            ? ctx.uiWorkspace.unarchiveSession(sessionId)
            : ctx.workspaces.unarchiveSession(sessionId);
        void p.catch((err) => {
            setError(`取消归档失败：${err instanceof Error ? err.message : String(err)}`);
        });
    };
    const startRename = (sessionId) => {
        const entry = sessionsSnap.byId?.[sessionId];
        setRenameDraft(entry === undefined ? '' : titleOf(entry));
        setRenameId(sessionId);
    };
    const cancelRename = () => {
        setRenameId(null);
        setRenameDraft('');
        cardRef.current?.focus();
    };
    const saveRename = async () => {
        const id = renameId;
        const title = renameDraft.trim();
        cancelRename();
        if (id === null || title === '')
            return;
        try {
            if (typeof ctx.sessions.using === 'function') {
                const result = await ctx.sessions.using(id, { source: 'controllerOperation' }, (ref) => ref.binding.session.rename(title));
                if (!result.ok)
                    throw new Error(result.error?.message ?? '重命名被拒绝');
            }
            else {
                const binding = ctx.sessions.binding(id);
                const session = binding?.session;
                if (session === undefined)
                    throw new Error('会话不在线，无法重命名');
                const result = await session.rename(title);
                if (!result.ok)
                    throw new Error(result.error?.message ?? '重命名被拒绝');
            }
        }
        catch (err) {
            setError(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
        }
    };
    const enterSearch = () => {
        setQuery('');
        setSearching(true);
    };
    const exitSearch = () => {
        setQuery('');
        setSearching(false);
        cardRef.current?.focus();
    };
    const cycleSkin = () => {
        const next = nextSkin(skinName);
        setSkinName(next);
        saveSkin(next);
    };
    const openSettings = () => {
        setConfiguring(true);
        setSearching(false);
        setQuery('');
        cardRef.current?.focus();
    };
    const closeSettings = () => {
        setConfiguring(false);
        setCaptureAction(null);
        cardRef.current?.focus();
    };
    const startCapture = (action) => {
        setCaptureAction(action);
        keymapStore.beginCapture();
        cardRef.current?.focus();
    };
    const cancelCapture = () => {
        setCaptureAction(null);
        keymapStore.endCapture();
        cardRef.current?.focus();
    };
    if (!open) {
        // Closed — or mid preview: hide EVERYTHING (the one-time readiness toast
        // would otherwise float over the conversation being previewed). The
        // Esc/Enter key handling for preview lives in the global keydown handler.
        if (palette.preview || !showReadyToast)
            return null;
        return (_jsx("div", { className: `${css.root} ${css.wrapper}`, "data-skin": skinName, children: _jsx("div", { className: css.toast, onClick: dismissToast, children: "\u4F1A\u8BDD\u5207\u6362\u5668\u5DF2\u5C31\u7EEA \u2014 Ctrl+Shift+K\uFF08Ctrl+K / Alt+K\uFF09\u6253\u5F00\u9762\u677F" }) }));
    }
    const hasArchived = archivedIds.length > 0;
    const renaming = renameId !== null;
    const onKeyDown = (e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229)
            return;
        if (captureAction !== null) {
            // Rebinding: the next non-modifier chord becomes the new binding.
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelCapture();
            }
            else if (!isModifierKey(e.key)) {
                e.preventDefault();
                keymapStore.set(captureAction, bindingFromEvent(e));
                setCaptureAction(null);
            }
            return;
        }
        if (configuring) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSettings();
            }
            return;
        }
        if (renaming) {
            // Rename editor owns the keys: Enter saves, Escape cancels, everything
            // else edits the draft.
            if (e.key === 'Enter') {
                e.preventDefault();
                void saveRename();
            }
            else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, rowPositions.length - 1));
        }
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            if (selected !== null)
                openSession(selected.session.id);
        }
        else if (!searching && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === ' ') {
            // Space previews the selected conversation (suppressed while searching
            // so the filter box can type spaces).
            e.preventDefault();
            startPreview();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            if (searching) {
                if (query !== '')
                    setQuery('');
                else
                    exitSearch();
            }
            else if (showArchived) {
                setShowArchived(false);
            }
            else {
                openStore.close();
            }
        }
        else if (matchesBinding(keymap.bindings.toggle, e)) {
            e.preventDefault();
            openStore.close();
        }
        else if (searching) {
            // Search mode chords: quick actions available without leaving the filter.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                newConversation();
            }
            else if (((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') || e.key === 'F2') {
                e.preventDefault();
                if (selected !== null)
                    startRename(selected.session.id);
            }
            else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                if (selected !== null)
                    archiveSession(selected.session.id);
            }
            else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'h') {
                e.preventDefault();
                toggleHideOldSessions();
            }
            else if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                jumpToPinnedRow();
            }
        }
        else if (!searching && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            // Management mode: single letters are actions, never input.
            const k = e.key.toLowerCase();
            if (k === 's') {
                e.preventDefault();
                enterSearch();
            }
            else if (k === 'n') {
                e.preventDefault();
                newConversation();
            }
            else if (k === 'p') {
                e.preventDefault();
                jumpToPinnedRow();
            }
            else if (k === 'a' && !showArchived) {
                e.preventDefault();
                if (selected !== null)
                    archiveSession(selected.session.id);
            }
            else if (k === 'u' && showArchived) {
                e.preventDefault();
                if (selected !== null)
                    unarchiveSession(selected.session.id);
            }
            else if (k === 't' && (hasArchived || showArchived)) {
                e.preventDefault();
                setShowArchived((v) => !v);
            }
            else if (k === 'r') {
                e.preventDefault();
                if (selected !== null)
                    startRename(selected.session.id);
            }
            else if (k === 'h') {
                e.preventDefault();
                toggleHideOldSessions();
            }
            else if (k === 'k') {
                e.preventDefault();
                openSettings();
            }
        }
    };
    const renderRow = (row, rowIndex) => {
        const session = row.session;
        const wsId = row.workspace?.workspaceId;
        const hue = getWorkspaceHue(wsId, workspaceColorMap);
        const isColored = hue !== null;
        const wsStyle = isColored ? { '--ws-h': hue } : undefined;
        const wsClass = isColored ? `${css.wsTag} ${css.wsTagColored}` : `${css.wsTag} ${css.wsTagUngrouped}`;
        const wsLabel = row.workspace === undefined ? '未分组' : row.workspace.title;
        const turns = turnCountOf(session);
        const timeLevel = timeRecencyLevel(session.updatedAt);
        const timeClassKey = `timeL${timeLevel}`;
        const timeString = relTime(session.updatedAt);
        const isCurrent = session.id === currentId;
        const archived = archivedSet.has(session.id);
        const isPinned = pinnedSet.has(session.id);
        return (_jsxs("div", { "data-row-index": rowIndex, className: rowIndex === index ? `${css.row} ${css.rowSelected}` : css.row, onMouseEnter: () => setIndex(rowIndex), onClick: () => openSession(session.id), children: [_jsx("span", { className: session.running ? css.dot : `${css.dot} ${css.dotIdle}` }), _jsxs("div", { className: css.main, children: [_jsx("div", { className: css.rowTitle, children: titleOf(session) }), _jsxs("div", { className: css.rowMeta, children: [_jsx("span", { className: wsClass, style: wsStyle, children: wsLabel }), turns !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.metaDivider, children: "\u00B7" }), _jsxs("span", { className: css.metaItem, children: [turns, " \u8F6E"] })] })), timeString !== '' && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.metaDivider, children: "\u00B7" }), _jsxs("span", { className: `${css.timeBadge} ${css[timeClassKey]}`, children: [timeLevel <= 1 && _jsx("span", { className: css.liveDot }), timeString] })] }))] })] }), isCurrent && _jsx("span", { className: `${css.tag} ${css.tagCurrent}`, children: "\u5F53\u524D" }), isPinned && _jsx("span", { className: `${css.tag} ${css.tagPinned}`, children: "\uD83D\uDCCC \u7F6E\u9876" }), archived && _jsx("span", { className: css.tag, children: "\u5DF2\u5F52\u6863" }), _jsx("button", { type: "button", className: css.rowAction, onClick: (e) => {
                        e.stopPropagation();
                        startRename(session.id);
                    }, title: "\u91CD\u547D\u540D\u5BF9\u8BDD", children: "\u91CD\u547D\u540D" }), archived ? (_jsx("button", { type: "button", className: css.rowAction, onClick: (e) => {
                        e.stopPropagation();
                        unarchiveSession(session.id);
                    }, children: "\u53D6\u6D88\u5F52\u6863" })) : (_jsx("button", { type: "button", className: `${css.rowAction} ${css.rowActionDanger}`, onClick: (e) => {
                        e.stopPropagation();
                        archiveSession(session.id);
                    }, children: "\u5F52\u6863" }))] }, session.id));
    };
    let body;
    if (configuring) {
        body = (_jsxs("div", { className: css.settings, children: [_jsx("div", { className: css.officialShortcutsBar, children: _jsx("button", { type: "button", className: css.officialShortcutsBtn, onClick: () => {
                            openStore.close();
                            ctx.openOfficialShortcuts?.();
                        }, children: "\u26A1 \u6253\u5F00\u7CFB\u7EDF\u5FEB\u6377\u952E\u8BBE\u7F6E\u4E2D\u5FC3 (Ctrl+/)" }) }), _jsx("div", { className: css.settingsHint, children: "\u4F1A\u8BDD\u9762\u677F\u5FEB\u6377\u952E\u5DF2\u63A5\u5165 DSH \u5B98\u65B9\u547D\u4EE4\u7CFB\u7EDF\uFF0C\u53EF\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u524D\u5F80\u7CFB\u7EDF\u4E2D\u5FC3\u7EDF\u4E00\u4FEE\u6539\u5E76\u68C0\u6D4B\u51B2\u7A81\uFF1B\u4EA6\u53EF\u5728\u4E0B\u65B9\u5FEB\u901F\u8986\u76D6\u9762\u677F\u672C\u5730\u6309\u952E\uFF0CEsc \u53D6\u6D88\u3002" }), ACTIONS.map((action) => {
                    const binding = keymap.bindings[action];
                    const active = captureAction === action;
                    return (_jsxs("div", { className: css.settingsRow, children: [_jsx("span", { className: css.settingsLabel, children: ACTION_LABELS[action] }), active ? (_jsx("span", { className: css.captureHint, children: "\u6309\u4E0B\u65B0\u7EC4\u5408\u952E\u2026\uFF08Esc \u53D6\u6D88\uFF09" })) : (_jsxs(_Fragment, { children: [_jsx("kbd", { className: css.kbd, children: formatBinding(binding) }), _jsx("button", { type: "button", className: css.rowAction, onClick: () => startCapture(action), children: "\u6539\u952E" })] }))] }, action));
                })] }));
    }
    else if (workspacesSnap.phase !== 'ready' || sessionsSnap.phase !== 'ready') {
        body = _jsx("div", { className: css.empty, children: "\u52A0\u8F7D\u4E2D\u2026" });
    }
    else if (rowPositions.length === 0) {
        body = (_jsx("div", { className: css.empty, children: searching
                ? '没有匹配的对话'
                : showArchived
                    ? '没有已归档的对话'
                    : workspaceItems.length === 0
                        ? '还没有工作区 — 按 N 新建，或在侧边栏添加工作区'
                        : '还没有对话 — 按 N 新建' }));
    }
    else {
        let rowCursor = 0;
        body = (_jsx("div", { className: css.list, ref: listRef, children: items.map((item) => {
                if (item.kind === 'header') {
                    const wsId = item.key === UNGROUPED_KEY ? undefined : item.key;
                    const hue = getWorkspaceHue(wsId, workspaceColorMap);
                    const isColored = hue !== null;
                    const wsStyle = isColored ? { '--ws-h': hue } : undefined;
                    const wsClass = isColored ? `${css.wsTag} ${css.wsTagColored}` : `${css.wsTag} ${css.wsTagUngrouped}`;
                    return (_jsxs("div", { className: css.groupHeader, children: [_jsx("span", { className: wsClass, style: wsStyle, children: item.label }), _jsx("span", { className: css.groupCount, children: item.count })] }, item.key));
                }
                if (item.kind === 'folded') {
                    return (_jsxs("div", { className: css.foldedRow, onClick: () => toggleGroupExpand(item.groupKey), title: item.expanded ? '点击收起较早对话' : '点击展开较早对话', children: [_jsx("span", { className: css.foldedIcon, children: item.expanded ? '▼' : '▶' }), _jsx("span", { className: css.foldedLabel, children: item.label })] }, item.key));
                }
                const rowIndex = rowCursor;
                rowCursor += 1;
                return renderRow(item, rowIndex);
            }) }));
    }
    const toggleLabel = formatBinding(keymap.bindings.toggle);
    const hasPinned = pinnedIds.length > 0;
    const hint = configuring ? (_jsx("div", { className: css.footer, children: _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Esc" }), "\u8FD4\u56DE"] }) })) : searching ? (_jsxs("div", { className: css.footer, children: [_jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "\u2191\u2193" }), "\u9009\u62E9", _jsx(Kbd, { children: "Enter" }), "\u6253\u5F00"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Ctrl+N" }), "\u65B0\u5EFA"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Ctrl+R" }), "\u91CD\u547D\u540D"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Alt+A" }), "\u5F52\u6863"] }), hasPinned && _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Alt+P" }), "\u7F6E\u9876"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Alt+H" }), hideOldSessions ? '显示全部' : '只看近期'] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Esc" }), query ? '清空' : '管理模式'] })] })) : (_jsxs("div", { className: css.footer, children: [_jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "\u2191\u2193" }), "\u9009\u62E9", _jsx(Kbd, { children: "Enter" }), "\u6253\u5F00"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "\u7A7A\u683C" }), "\u9884\u89C8"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "S" }), "\u641C\u7D22"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "N" }), "\u65B0\u5EFA"] }), hasPinned && _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "P" }), "\u7F6E\u9876"] }), showArchived ? (_jsxs(_Fragment, { children: [_jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "U" }), "\u53D6\u6D88\u5F52\u6863"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "T" }), "\u8FD4\u56DE\u5217\u8868"] })] })) : (_jsxs(_Fragment, { children: [_jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "A" }), "\u5F52\u6863"] }), hasArchived && _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "T" }), "\u5F52\u6863\u89C6\u56FE"] })] })), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "R" }), "\u91CD\u547D\u540D"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "H" }), hideOldSessions ? '显示全部' : '只看近期'] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "K" }), "\u5FEB\u6377\u952E"] }), _jsxs("span", { className: css.footerAction, children: [_jsx(Kbd, { children: "Esc" }), showArchived ? '返回列表' : '关闭'] }), _jsxs("span", { className: `${css.footerAction} ${css.footerPush}`, children: [_jsx(Kbd, { children: toggleLabel }), "\u5F00\u5173"] })] }));
    const strip = configuring ? null : renaming ? (_jsxs("div", { className: css.renameBar, children: [_jsx("input", { ref: renameRef, className: css.renameInput, value: renameDraft, placeholder: "\u8F93\u5165\u65B0\u6807\u9898\u2026", onChange: (e) => setRenameDraft(e.target.value) }), _jsx("button", { type: "button", className: css.rowAction, onClick: () => void saveRename(), children: "\u4FDD\u5B58" }), _jsx("button", { type: "button", className: css.rowAction, onClick: cancelRename, children: "\u53D6\u6D88" })] })) : searching ? (_jsx("input", { ref: inputRef, className: css.input, placeholder: "\u8F93\u5165\u6807\u9898\u8FC7\u6EE4\u5BF9\u8BDD\u2026\uFF08\u652F\u6301\u5FEB\u6377\u952E\uFF1ACtrl+N\u65B0\u5EFA / Ctrl+R\u91CD\u547D\u540D / Alt+H\u5207\u6362\u8FD1\u671F\uFF09", value: query, onChange: (e) => setQuery(e.target.value) })) : (_jsx("button", { type: "button", className: css.searchStrip, onClick: enterSearch, children: "\u6309 S \u641C\u7D22\u4F1A\u8BDD\u2026" }));
    return (_jsx("div", { className: `${css.root} ${css.overlay}`, "data-skin": skinName, onMouseDown: (e) => {
            if (e.target === e.currentTarget)
                openStore.close();
        }, children: _jsxs("div", { ref: cardRef, tabIndex: -1, className: css.card, onKeyDown: onKeyDown, children: [_jsxs("div", { className: css.header, children: [_jsx("span", { className: css.title, children: "\u5207\u6362\u5BF9\u8BDD" }), showArchived && _jsx("span", { className: css.modeTag, children: "\u5DF2\u5F52\u6863" }), searching && _jsx("span", { className: css.modeTag, children: "\u641C\u7D22" }), renaming && _jsx("span", { className: css.modeTag, children: "\u91CD\u547D\u540D" }), configuring && _jsx("span", { className: css.modeTag, children: "\u5FEB\u6377\u952E" }), _jsx("button", { type: "button", className: `${css.skinButton} ${hideOldSessions ? css.activeButton : ''}`, onClick: toggleHideOldSessions, title: hideOldSessions ? '当前已隐藏 7 天前较早对话（点击查看全部）' : '当前显示全部对话（点击隐藏 7 天前较早对话）', children: hideOldSessions ? '🕒 近期对话' : '🕒 全部对话' }), _jsx("button", { type: "button", className: css.skinButton, onClick: configuring ? closeSettings : openSettings, title: "\u81EA\u5B9A\u4E49\u5FEB\u6377\u952E", children: "\u2699" }), _jsx("button", { type: "button", className: css.skinButton, onClick: cycleSkin, title: "\u5207\u6362\u76AE\u80A4\uFF08\u6DF1\u8272/\u6D45\u8272/\u9AD8\u5BF9\u6BD4\uFF09", children: SKIN_LABELS[skinName] }), _jsx("button", { type: "button", className: css.newButton, onClick: newConversation, children: "+ \u65B0\u5EFA\u5BF9\u8BDD" })] }), strip, body, error !== null && _jsx("div", { className: css.errorLine, children: error }), hint] }) }));
}
