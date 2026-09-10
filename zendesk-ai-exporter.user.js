// ==UserScript==
// @name         Zendesk AI Exporter
// @namespace    https://github.com/NielsKrejberg/zendesk-ai-exporter
// @version      0.4.0
// @description  Export Zendesk tickets and full conversations into AI-friendly datasets.
// @author       Niels Krejberg
// @homepageURL  https://github.com/NielsKrejberg/zendesk-ai-exporter
// @updateURL    https://raw.githubusercontent.com/NielsKrejberg/zendesk-ai-exporter-dist/main/zendesk-ai-exporter.user.js
// @downloadURL  https://raw.githubusercontent.com/NielsKrejberg/zendesk-ai-exporter-dist/main/zendesk-ai-exporter.user.js
// @match        https://*.zendesk.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const APP_ID = 'zendesk-ai-exporter';
    const COMMENT_CONCURRENCY = 4;
    if (document.getElementById(APP_ID)) return;

    const state = {
        tickets: [],
        selectedTicketIds: new Set(),
        running: false,
        cancelled: false,
        groupCache: new Map()
    };

    const styles = `
        #${APP_ID} {
            position: fixed;
            top: 7.5vh;
            left: 5vw;
            z-index: 2147483646;
            width: 90vw;
            height: 85vh;
            display: none;
            overflow: hidden;
            color: #fff;
            background: rgba(15, 48, 32, 0.88);
            border: 1px solid rgba(148, 210, 168, 0.25);
            border-radius: 10px;
            box-shadow: 0 12px 38px rgba(0, 0, 0, 0.35);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${APP_ID} * { box-sizing: border-box; }
        #${APP_ID} .zae-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid rgba(148, 210, 168, 0.18);
            flex: 0 0 auto;
        }
        #${APP_ID} .zae-title { font-size: 15px; font-weight: 650; }
        #${APP_ID} .zae-subtitle { margin-top: 2px; color: rgba(255,255,255,.60); font-size: 12px; }
        #${APP_ID} .zae-close,
        #${APP_ID} button {
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            padding: 7px 10px;
            cursor: pointer;
        }
        #${APP_ID} button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.14); }
        #${APP_ID} button:disabled { opacity: .42; cursor: default; }
        #${APP_ID} .zae-close { padding: 4px 8px; }
        #${APP_ID} .zae-body {
            height: calc(100% - 58px);
            padding: 14px 16px 16px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        #${APP_ID} .zae-filter-area { flex: 0 0 auto; min-height: max-content; }
        #${APP_ID} .zae-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        #${APP_ID} label { display: grid; gap: 5px; color: rgba(255,255,255,.84); min-width: 0; }
        #${APP_ID} input,
        #${APP_ID} select,
        #${APP_ID} textarea {
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            background: rgba(0, 0, 0, 0.18);
            color: #fff;
            padding: 8px 9px;
            outline: none;
            line-height: 1.4;
        }
        #${APP_ID} input, #${APP_ID} select { min-height: 36px; }
        #${APP_ID} textarea { min-height: 66px; resize: vertical; }
        #${APP_ID} .zae-section { margin-top: 12px; flex: 0 0 auto; min-height: max-content; }
        #${APP_ID} .zae-help { margin-top: 5px; color: rgba(255,255,255,.52); font-size: 11px; }
        #${APP_ID} .zae-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; flex: 0 0 auto; }
        #${APP_ID} .zae-primary { background: rgba(117, 190, 139, .20); border-color: rgba(155, 229, 178, .35); }
        #${APP_ID} .zae-status { margin-top: 10px; padding: 9px 10px; border-radius: 6px; background: rgba(0, 0, 0, .16); color: rgba(255,255,255,.82); flex: 0 0 auto; }
        #${APP_ID} .zae-table-wrap { margin-top: 12px; flex: 1 1 0; min-height: 100px; overflow: auto; border: 1px solid rgba(148, 210, 168, 0.16); border-radius: 7px; }
        #${APP_ID} table { width: 100%; border-collapse: collapse; min-width: 980px; }
        #${APP_ID} th { position: sticky; top: 0; z-index: 1; background: rgba(20, 63, 42, 0.98); text-align: left; }
        #${APP_ID} th, #${APP_ID} td { padding: 8px 9px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
        #${APP_ID} tr:hover td { background: rgba(255,255,255,.035); }
        #${APP_ID} .zae-check { width: auto; min-height: 0; accent-color: #79bd8d; }
        #${APP_ID} .zae-link { color: #d9f5e2; text-decoration: none; font-weight: 600; }
        #${APP_ID} .zae-link:hover { text-decoration: underline; }
        #${APP_ID} .zae-pill { display: inline-block; padding: 2px 6px; border-radius: 999px; background: rgba(125, 200, 148, .15); border: 1px solid rgba(145, 219, 168, .18); }
        #${APP_ID} .zae-comment-count { white-space: nowrap; color: rgba(255,255,255,.72); }
        #${APP_ID}-toggle {
            position: fixed;
            z-index: 2147483645;
            padding: 5px 8px;
            border: 1px solid rgba(145, 219, 168, .24);
            border-radius: 5px;
            background: rgba(20, 63, 42, .75);
            color: #fff;
            backdrop-filter: blur(12px);
            cursor: pointer;
            white-space: nowrap;
        }
        @media (max-width: 760px) {
            #${APP_ID} { top: 2.5vh; left: 2.5vw; width: 95vw; height: 95vh; }
            #${APP_ID} .zae-grid { grid-template-columns: 1fr; }
            #${APP_ID} .zae-body { overflow-y: auto; }
            #${APP_ID} .zae-table-wrap { flex: 0 0 320px; }
        }
    `;

    const style = document.createElement('style');
    style.textContent = styles;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = `${APP_ID}-toggle`;
    toggle.textContent = 'Zendesk AI Export';
    document.body.appendChild(toggle);

    function findReplyTemplatesButton() {
        return [...document.querySelectorAll('button')].find((button) => {
            if (button === toggle) return false;
            const text = (button.textContent || '').trim().toLowerCase();
            return /^(show|hide)( reply)? templates$/.test(text);
        });
    }

    function positionToggle() {
        const templateButton = findReplyTemplatesButton();
        if (templateButton) {
            const rect = templateButton.getBoundingClientRect();
            toggle.style.top = `${Math.round(rect.top)}px`;
            toggle.style.left = `${Math.round(rect.right + 8)}px`;
            toggle.style.right = 'auto';
            return;
        }
        toggle.style.top = '61px';
        toggle.style.left = '790px';
        toggle.style.right = 'auto';
    }

    positionToggle();
    window.addEventListener('resize', positionToggle);
    new MutationObserver(positionToggle).observe(document.body, { childList: true, subtree: true, characterData: true });

    const panel = document.createElement('div');
    panel.id = APP_ID;
    panel.innerHTML = `
        <div class="zae-header">
            <div>
                <div class="zae-title">Zendesk AI Exporter</div>
                <div class="zae-subtitle">Search, select, load conversations and export tickets</div>
            </div>
            <button class="zae-close" type="button">×</button>
        </div>
        <div class="zae-body">
            <div class="zae-filter-area">
                <label>Search terms / Zendesk query
                    <textarea id="zae-query" placeholder='Optional. Examples: checkout error   or   status:solved comment:"payment failed"'></textarea>
                    <div class="zae-help">Leave empty to export only by the structured filters below.</div>
                </label>

                <div class="zae-section zae-grid">
                    <label>From date<input type="date" id="zae-from-date"></label>
                    <label>To date<input type="date" id="zae-to-date"></label>
                    <label>Date field
                        <select id="zae-date-field">
                            <option value="solved">Solved date</option>
                            <option value="created">Created date</option>
                            <option value="updated">Updated date</option>
                        </select>
                    </label>
                    <label>Group
                        <input type="text" id="zae-group" value="Web - Helpdesk" placeholder="Leave empty for any group">
                    </label>
                </div>

                <div class="zae-section zae-grid">
                    <label>Comments in JSONL
                        <select id="zae-comments">
                            <option value="all">Public + internal notes</option>
                            <option value="public">Public only</option>
                        </select>
                    </label>
                    <label>Attachment handling
                        <select id="zae-attachments">
                            <option value="urls">Include attachment URLs</option>
                            <option value="none">Exclude attachments</option>
                        </select>
                    </label>
                </div>
            </div>

            <div class="zae-actions">
                <button id="zae-find" class="zae-primary" type="button">Find matching tickets</button>
                <button id="zae-load-comments" type="button" disabled>Load conversations</button>
                <button id="zae-cancel" type="button" disabled>Cancel</button>
                <button id="zae-select-all" type="button" disabled>Select all</button>
                <button id="zae-select-none" type="button" disabled>Select none</button>
                <button id="zae-export-jsonl" type="button" disabled>Export JSONL</button>
                <button id="zae-export-csv" type="button" disabled>Export CSV</button>
            </div>

            <div class="zae-status" id="zae-status">Ready. No tickets loaded.</div>
            <div class="zae-table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th><input class="zae-check" type="checkbox" id="zae-check-all" disabled></th>
                            <th>ID</th>
                            <th>Date</th>
                            <th>Subject</th>
                            <th>Status</th>
                            <th>Group</th>
                            <th>Conversation</th>
                        </tr>
                    </thead>
                    <tbody id="zae-results"></tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    const $ = (selector) => panel.querySelector(selector);
    const $$ = (selector) => [...panel.querySelectorAll(selector)];

    toggle.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    $('.zae-close').addEventListener('click', () => { panel.style.display = 'none'; });

    $('#zae-find').addEventListener('click', findTickets);
    $('#zae-load-comments').addEventListener('click', loadSelectedConversations);
    $('#zae-cancel').addEventListener('click', () => {
        state.cancelled = true;
        setStatus('Cancellation requested. Finishing active requests...');
    });
    $('#zae-select-all').addEventListener('click', selectAll);
    $('#zae-select-none').addEventListener('click', selectNone);
    $('#zae-check-all').addEventListener('change', (event) => event.target.checked ? selectAll() : selectNone());
    $('#zae-export-jsonl').addEventListener('click', exportSelectedJsonl);
    $('#zae-export-csv').addEventListener('click', () => exportCsv(getSelectedTickets()));

    async function findTickets() {
        if (state.running) return;

        state.running = true;
        state.cancelled = false;
        state.tickets = [];
        state.selectedTicketIds.clear();
        renderResults();
        setRunningUi(true);

        try {
            const rawQuery = $('#zae-query').value.trim().replace(/\btype:ticket\b/gi, '').trim();
            const groupName = $('#zae-group').value.trim();

            let exactGroupId = null;
            let exactGroupName = null;
            let group = null;

            if (groupName) {
                setStatus(`Resolving Zendesk group “${groupName}”...`);
                group = await resolveGroup(groupName);
                if (!group) throw new Error(`Could not find a Zendesk group named “${groupName}”.`);
                exactGroupId = group.id;
                exactGroupName = group.name;
            }

            const query = buildUnifiedQuery(rawQuery, group);
            if (!query) throw new Error('Enter search terms or choose at least one structured filter.');

            setStatus('Searching Zendesk... 0 tickets loaded.');
            const tickets = await searchExportTickets(query, exactGroupId, exactGroupName);

            state.tickets = tickets;
            state.tickets.forEach((ticket) => state.selectedTicketIds.add(ticket.id));
            renderResults();

            setStatus(state.cancelled
                ? `Cancelled. ${tickets.length.toLocaleString()} tickets loaded so far.`
                : `Found ${tickets.length.toLocaleString()} tickets. Select the tickets you want, then load conversations or export JSONL.`);
        } catch (error) {
            console.error('[Zendesk AI Exporter]', error);
            setStatus(`Error: ${error.message}`);
        } finally {
            state.running = false;
            setRunningUi(false);
        }
    }

    function buildUnifiedQuery(rawQuery, group) {
        const field = $('#zae-date-field').value;
        const from = $('#zae-from-date').value;
        const to = $('#zae-to-date').value;
        const parts = [];

        if (rawQuery) parts.push(rawQuery);
        if (group) parts.push(`group:${group.id}`);
        if (from) parts.push(`${field}>=${from}`);
        if (to) parts.push(`${field}<=${to}`);

        return parts.join(' ').trim();
    }

    async function resolveGroup(name) {
        const cacheKey = name.toLowerCase();
        if (state.groupCache.has(cacheKey)) return state.groupCache.get(cacheKey);

        const url = `/api/v2/groups/autocomplete.json?name=${encodeURIComponent(name)}`;
        const data = await apiGet(url);
        const groups = data.groups || [];
        const group = groups.find((item) => (item.name || '').toLowerCase() === cacheKey) || null;
        if (group) state.groupCache.set(cacheKey, group);
        return group;
    }

    async function searchExportTickets(query, exactGroupId, exactGroupName) {
        const tickets = [];
        const seenTicketIds = new Set();
        const seenCursors = new Set();
        let afterCursor = null;
        let page = 0;

        while (!state.cancelled) {
            page += 1;

            const params = new URLSearchParams();
            params.set('query', query);
            params.set('filter[type]', 'ticket');
            params.set('page[size]', '100');
            if (afterCursor) params.set('page[after]', afterCursor);

            const data = await apiGet(`/api/v2/search/export.json?${params.toString()}`);
            const results = Array.isArray(data.results) ? data.results : [];

            for (const ticket of results) {
                if (state.cancelled) break;
                if (exactGroupId && Number(ticket.group_id) !== Number(exactGroupId)) continue;
                if (seenTicketIds.has(ticket.id)) continue;

                seenTicketIds.add(ticket.id);
                tickets.push(normalizeSearchTicket(ticket, exactGroupName));
            }

            state.tickets = tickets;
            setStatus(`Searching Zendesk... ${tickets.length.toLocaleString()} tickets loaded (page ${page}).`);

            const meta = data.meta || {};
            const links = data.links || {};
            const hasMore = meta.has_more === true || meta.has_more === 'true' || meta.has_more === 1 || meta.has_more === '1';
            if (!hasMore) break;

            let nextCursor = meta.after_cursor || meta.after || null;
            if (!nextCursor && links.next) {
                try {
                    const nextUrl = new URL(links.next, location.origin);
                    nextCursor = nextUrl.searchParams.get('page[after]');
                } catch (_) {}
            }

            if (!nextCursor) {
                console.warn('[Zendesk AI Exporter] Zendesk reported more results but returned no next cursor.');
                break;
            }

            if (nextCursor === afterCursor || seenCursors.has(nextCursor)) {
                console.warn('[Zendesk AI Exporter] Repeated pagination cursor detected.');
                break;
            }

            seenCursors.add(nextCursor);
            afterCursor = nextCursor;
        }

        return tickets;
    }

    function normalizeSearchTicket(ticket, groupName) {
        return {
            id: ticket.id,
            created_at: ticket.created_at || null,
            updated_at: ticket.updated_at || null,
            solved_at: ticket.solved_at || null,
            status: ticket.status || '',
            subject: ticket.subject || '',
            description: ticket.description || '',
            group_id: ticket.group_id || null,
            group_name: groupName || '',
            assignee_id: ticket.assignee_id || null,
            requester_id: ticket.requester_id || null,
            submitter_id: ticket.submitter_id || null,
            priority: ticket.priority || null,
            type: ticket.type || null,
            tags: Array.isArray(ticket.tags) ? ticket.tags : [],
            via: ticket.via || null,
            custom_fields: ticket.custom_fields || [],
            ticket_form_id: ticket.ticket_form_id || null,
            brand_id: ticket.brand_id || null,
            conversation: null,
            conversation_loaded: false,
            conversation_error: null,
            url: `${location.origin}/agent/tickets/${ticket.id}`
        };
    }

    async function loadSelectedConversations() {
        if (state.running) return;
        const tickets = getSelectedTickets();
        if (!tickets.length) return;

        state.running = true;
        state.cancelled = false;
        setRunningUi(true);

        try {
            await ensureConversationsLoaded(tickets);
            renderResults();
            const loaded = tickets.filter((ticket) => ticket.conversation_loaded).length;
            const failed = tickets.filter((ticket) => ticket.conversation_error).length;
            setStatus(state.cancelled
                ? `Cancelled. Conversations loaded for ${loaded.toLocaleString()} of ${tickets.length.toLocaleString()} selected tickets.`
                : `Conversations loaded for ${loaded.toLocaleString()} selected tickets${failed ? `; ${failed} failed` : ''}.`);
        } catch (error) {
            console.error('[Zendesk AI Exporter]', error);
            setStatus(`Error loading conversations: ${error.message}`);
        } finally {
            state.running = false;
            setRunningUi(false);
        }
    }

    async function ensureConversationsLoaded(tickets) {
        const pending = tickets.filter((ticket) => !ticket.conversation_loaded && !ticket.conversation_error);
        if (!pending.length) return;

        let completed = tickets.length - pending.length;
        let cursor = 0;

        const workers = Array.from({ length: Math.min(COMMENT_CONCURRENCY, pending.length) }, async () => {
            while (!state.cancelled) {
                const index = cursor++;
                if (index >= pending.length) return;

                const ticket = pending[index];
                try {
                    ticket.conversation = await fetchTicketComments(ticket.id);
                    ticket.conversation_loaded = true;
                    ticket.conversation_error = null;
                } catch (error) {
                    ticket.conversation = [];
                    ticket.conversation_loaded = false;
                    ticket.conversation_error = error.message;
                    console.error(`[Zendesk AI Exporter] Failed to load comments for ticket ${ticket.id}`, error);
                }

                completed += 1;
                setStatus(`Loading conversations... ${completed.toLocaleString()} / ${tickets.length.toLocaleString()} tickets processed.`);
            }
        });

        await Promise.all(workers);
    }

    async function fetchTicketComments(ticketId) {
        const comments = [];
        const users = new Map();
        const seenCursors = new Set();
        let nextUrl = `/api/v2/tickets/${ticketId}/comments.json?include=users&include_inline_images=true&page[size]=100&sort_order=asc`;

        while (nextUrl && !state.cancelled) {
            const data = await apiGet(nextUrl);

            for (const user of data.users || []) {
                users.set(Number(user.id), {
                    id: user.id,
                    name: user.name || '',
                    email: user.email || '',
                    role: user.role || ''
                });
            }

            for (const comment of data.comments || []) {
                const author = users.get(Number(comment.author_id)) || null;
                comments.push(normalizeComment(comment, author));
            }

            const meta = data.meta || {};
            const links = data.links || {};
            const hasMore = meta.has_more === true || meta.has_more === 'true' || meta.has_more === 1 || meta.has_more === '1';
            if (!hasMore) break;

            let candidate = links.next || null;
            if (!candidate) {
                const cursor = meta.after_cursor || meta.after || null;
                if (cursor) {
                    candidate = `/api/v2/tickets/${ticketId}/comments.json?include=users&include_inline_images=true&page[size]=100&sort_order=asc&page[after]=${encodeURIComponent(cursor)}`;
                }
            }

            if (!candidate || seenCursors.has(candidate)) break;
            seenCursors.add(candidate);
            nextUrl = toSameOriginApiPath(candidate);
        }

        return comments;
    }

    function normalizeComment(comment, author) {
        const includeAttachments = $('#zae-attachments').value === 'urls';
        return {
            id: comment.id,
            created_at: comment.created_at || null,
            public: comment.public === true,
            type: comment.type || 'Comment',
            author_id: comment.author_id || null,
            author: author,
            body: comment.plain_body || comment.body || '',
            via: comment.via || null,
            attachments: includeAttachments
                ? (comment.attachments || []).map((attachment) => ({
                    id: attachment.id || null,
                    file_name: attachment.file_name || attachment.name || '',
                    content_type: attachment.content_type || '',
                    size: attachment.size || null,
                    content_url: attachment.content_url || ''
                }))
                : []
        };
    }

    function toSameOriginApiPath(value) {
        try {
            const url = new URL(value, location.origin);
            if (url.origin !== location.origin) throw new Error('Unexpected Zendesk pagination host.');
            return `${url.pathname}${url.search}`;
        } catch (error) {
            if (String(value).startsWith('/')) return value;
            throw error;
        }
    }

    async function exportSelectedJsonl() {
        if (state.running) return;
        const selected = getSelectedTickets();
        if (!selected.length) return;

        state.running = true;
        state.cancelled = false;
        setRunningUi(true);

        try {
            await ensureConversationsLoaded(selected);
            if (state.cancelled) {
                setStatus('Export cancelled before download.');
                return;
            }

            const commentMode = $('#zae-comments').value;
            const exportTickets = selected.map((ticket) => buildExportTicket(ticket, commentMode));
            exportJsonl(exportTickets);
            setStatus(`Exported ${exportTickets.length.toLocaleString()} tickets with conversations.`);
        } catch (error) {
            console.error('[Zendesk AI Exporter]', error);
            setStatus(`Export failed: ${error.message}`);
        } finally {
            state.running = false;
            setRunningUi(false);
        }
    }

    function buildExportTicket(ticket, commentMode) {
        const conversation = Array.isArray(ticket.conversation)
            ? ticket.conversation.filter((comment) => commentMode === 'all' || comment.public)
            : [];

        const publicCount = conversation.filter((comment) => comment.public).length;
        const internalCount = conversation.filter((comment) => !comment.public).length;

        return {
            ...ticket,
            conversation,
            conversation_loaded: ticket.conversation_loaded,
            conversation_error: ticket.conversation_error,
            derived: {
                conversation_length: conversation.length,
                public_comment_count: publicCount,
                internal_note_count: internalCount
            }
        };
    }

    async function apiGet(url, attempt = 0) {
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });

        if (response.status === 429 && attempt < 5) {
            const retryAfter = Math.max(1, Number(response.headers.get('Retry-After')) || 2);
            setStatus(`Zendesk rate limit reached. Retrying in ${retryAfter}s...`);
            await sleep(retryAfter * 1000);
            if (state.cancelled) throw new Error('Cancelled.');
            return apiGet(url, attempt + 1);
        }

        if (!response.ok) {
            let detail = '';
            try {
                const body = await response.json();
                detail = body.description || body.error || body.message || '';
            } catch (_) {}
            throw new Error(`Zendesk API returned ${response.status}${detail ? `: ${detail}` : ''}`);
        }

        return response.json();
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function renderResults() {
        const tbody = $('#zae-results');
        tbody.textContent = '';

        const fragment = document.createDocumentFragment();
        for (const ticket of state.tickets) {
            const tr = document.createElement('tr');
            const displayDate = ticket.solved_at || ticket.updated_at || ticket.created_at || '';
            const conversationText = ticket.conversation_loaded
                ? `${(ticket.conversation || []).length} comments`
                : ticket.conversation_error
                    ? 'Failed'
                    : 'Not loaded';

            tr.innerHTML = `
                <td><input class="zae-check zae-row-check" type="checkbox" data-id="${ticket.id}" ${state.selectedTicketIds.has(ticket.id) ? 'checked' : ''}></td>
                <td><a class="zae-link" href="${escapeHtml(ticket.url)}" target="_blank" rel="noopener">${ticket.id}</a></td>
                <td>${escapeHtml(formatDate(displayDate))}</td>
                <td>${escapeHtml(ticket.subject || '')}</td>
                <td><span class="zae-pill">${escapeHtml(ticket.status || '')}</span></td>
                <td>${escapeHtml(ticket.group_name || ticket.group_id || '')}</td>
                <td class="zae-comment-count">${escapeHtml(conversationText)}</td>
            `;
            fragment.appendChild(tr);
        }
        tbody.appendChild(fragment);

        $$('.zae-row-check').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const id = Number(checkbox.dataset.id);
                checkbox.checked ? state.selectedTicketIds.add(id) : state.selectedTicketIds.delete(id);
                updateSelectionUi();
            });
        });

        updateSelectionUi();
    }

    function selectAll() {
        state.tickets.forEach((ticket) => state.selectedTicketIds.add(ticket.id));
        $$('.zae-row-check').forEach((checkbox) => { checkbox.checked = true; });
        updateSelectionUi();
    }

    function selectNone() {
        state.selectedTicketIds.clear();
        $$('.zae-row-check').forEach((checkbox) => { checkbox.checked = false; });
        updateSelectionUi();
    }

    function updateSelectionUi() {
        const hasTickets = state.tickets.length > 0;
        const selected = state.selectedTicketIds.size;
        $('#zae-load-comments').disabled = !selected || state.running;
        $('#zae-export-jsonl').disabled = !selected || state.running;
        $('#zae-export-csv').disabled = !selected || state.running;
        $('#zae-select-all').disabled = !hasTickets || state.running;
        $('#zae-select-none').disabled = !hasTickets || state.running;
        $('#zae-check-all').disabled = !hasTickets || state.running;
        $('#zae-check-all').checked = hasTickets && selected === state.tickets.length;
        $('#zae-check-all').indeterminate = selected > 0 && selected < state.tickets.length;
    }

    function setRunningUi(running) {
        $('#zae-find').disabled = running;
        $('#zae-cancel').disabled = !running;
        updateSelectionUi();
    }

    function setStatus(message) {
        $('#zae-status').textContent = message;
    }

    function getSelectedTickets() {
        return state.tickets.filter((ticket) => state.selectedTicketIds.has(ticket.id));
    }

    function exportJsonl(tickets) {
        const body = tickets.map((ticket) => JSON.stringify(ticket)).join('\n');
        downloadBlob(body, `zendesk-tickets-${dateStamp()}.jsonl`, 'application/x-ndjson;charset=utf-8');
    }

    function exportCsv(tickets) {
        const headers = ['id', 'created_at', 'updated_at', 'solved_at', 'status', 'subject', 'group_id', 'group_name', 'assignee_id', 'priority', 'type', 'tags', 'conversation_loaded', 'conversation_count', 'url'];
        const rows = [headers.map(csvCell).join(',')];
        for (const ticket of tickets) {
            const values = {
                ...ticket,
                tags: (ticket.tags || []).join(' | '),
                conversation_count: Array.isArray(ticket.conversation) ? ticket.conversation.length : ''
            };
            rows.push(headers.map((key) => csvCell(values[key])).join(','));
        }
        downloadBlob(rows.join('\n'), `zendesk-tickets-${dateStamp()}.csv`, 'text/csv;charset=utf-8');
    }

    function csvCell(value) {
        const str = value == null ? '' : String(value);
        return `"${str.replaceAll('"', '""')}"`;
    }

    function downloadBlob(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function dateStamp() {
        return new Date().toISOString().slice(0, 10);
    }
})();
