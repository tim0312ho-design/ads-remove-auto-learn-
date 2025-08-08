// ==UserScript==
// @name         智慧廣告攔截器 - 啟發式學習版
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  啟發式自動學習攔截，效能強化、防偵測升級、視覺優化，支援手動排除
// @author       Gemini 疊代優化
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // 隨機字串產生器 (增強混淆)
    const rand = (l, p = '') => p + Math.random().toString(36).substr(2, l);
    const genID = () => rand(12, '_' + Date.now().toString(36).slice(-2));

    // 動態 ID 生成
    const IDs = {
        HIDDEN: genID(),
        HEURISTIC: genID(),
        UI: genID(),
        FAB: genID(),
        REVIEW: genID(),
        BADGE: genID(),
        RULE_COUNT: genID(),
        TOGGLE: genID(),
        BLOCK: genID(),
        EXCLUSIONS: genID(), // 新增：排除列表容器ID
        ADD_EXCLUSION: genID(), // 新增：添加排除按鈕ID
    };

    // 關鍵字動態混淆
    const KEYWORDS = [
        // 基本廣告關鍵字
        'ad', 'ads', 'adv', 'advert', 'sponsor', 'promo', 'banner', 'gg-ad', 'adsbygoogle',
        // 不同語言
        'publicidade', 'werbung', 'reklama', 'publicité', 'annons', 'বিজ্ঞাপন', '広告', '광고',
        // 分析與追蹤
        'analytics', 'tracking', 'stats', 'metric', 'monitor',
        // 錯誤追蹤
        'bugsnag', 'sentry', 'error-track',
        // 社交媒體追蹤
        'pixel', 'social-track', 'share-track'
    ].map(k => k.split('').map(c => c === 'a' ? '@' : c === 'o' ? '0' : c).join(''));

    const DOMAINS = [
        // Google 相關
        'doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'adservice.google.com', 'google-analytics.com',
        // 社交媒體
        'facebook.com', 'ads-twitter.com', 'ads.linkedin.com', 'ads.pinterest.com', 'ads.tiktok.com',
        // 廣告網路
        'adnxs.com', 'criteo.com', 'pubmatic.com', 'rubiconproject.com', 'media.net', 'adcolony.com',
        // 分析服務
        'hotjar.com', 'mouseflow.com', 'freshmarketer.com', 'luckyorange.com',
        // 手機廠商
        'samsungads.com', 'ads.oppomobile.com', 'ad.xiaomi.com', 'api-adservices.apple.com'
    ].map(d => d.replace(/\./g, '\\.'));

    // 全域狀態管理
    const state = {
        rules: GM_getValue("rules", []),
        labels: GM_getValue("labels", {}),
        siteSettings: GM_getValue("siteSettings", {}),
        exclusions: GM_getValue("exclusions", {}),
        heuristicBlocked: new Map(),
        removed: [],
        blockedCount: 0,
        continuousMode: false,
        scanQueue: new Set(),
        lastScan: 0,
        notifications: [],
        uiPosition: GM_getValue("uiPosition", { x: 20, y: 20 }),
        isDragging: false,
        dragOffset: { x: 0, y: 0 }
    };

    // 效能優化工具
    const utils = {
        debounce: (fn, wait, immediate) => {
            let timeout;
            return function(...args) {
                const later = () => {
                    timeout = null;
                    if (!immediate) fn.apply(this, args);
                };
                const callNow = immediate && !timeout;
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
                if (callNow) fn.apply(this, args);
            };
        },
        throttle: (fn, limit) => {
            let inThrottle;
            return function(...args) {
                if (!inThrottle) {
                    fn.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },
        safeQueryAll: (sel, root = document) => {
            try {
                return Array.from(root.querySelectorAll(sel));
            } catch {
                return [];
            }
        },
        batch: (items, size, cb, done) => {
            let index = 0;
            function next() {
                const chunk = items.slice(index, index + size);
                index += size;
                if (chunk.length) {
                    chunk.forEach(item => {
                        try { cb(item); } catch {}
                    });
                    if (index < items.length) {
                        setTimeout(next, 30);
                    } else if (done) {
                        done();
                    }
                }
            }
            next();
        }
    };

    // 智能選擇器生成
    function getSmartSelector(el) {
        if (!(el instanceof Element)) return "";
        
        // ID 選擇器
        if (el.id && utils.safeQueryAll(`#${el.id}`).length === 1) {
            return `#${el.id}`;
        }

        // 類選擇器
        if (el.className) {
            const classes = el.className.split(' ')
                .filter(c => c.trim())
                .filter(c => !c.includes(IDs.HIDDEN) && !c.includes(IDs.HEURISTIC));
            if (classes.length) {
                const selector = '.' + classes.join('.');
                if (utils.safeQueryAll(selector).length <= 3) {
                    return selector;
                }
            }
        }

        // 屬性選擇器
        for (const attr of ['role', 'aria-label', 'data-testid']) {
            if (el.getAttribute(attr)) {
                const selector = `[${attr}="${el.getAttribute(attr)}"]`;
                if (utils.safeQueryAll(selector).length <= 3) {
                    return selector;
                }
            }
        }

        // 路徑選擇器
        const path = [];
        let current = el;
        while (current && current.nodeType === 1) {
            let selector = current.nodeName.toLowerCase();
            if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break;
            }
            const siblings = Array.from(current.parentNode?.children || [])
                .filter(s => s.nodeName === current.nodeName);
            if (siblings.length > 1) {
                selector += `:nth-child(${siblings.indexOf(current) + 1})`;
            }
            path.unshift(selector);
            current = current.parentNode;
            if (path.length >= 4) break;
        }
        return path.join(' > ');
    }

    // UI 樣式
    const styles = {
        hidden: `.${IDs.HIDDEN}, .${IDs.HEURISTIC} { display: none !important; }`,
        review: `.ad-blocked-review { outline: 2px dashed #3498db !important; box-shadow: 0 0 10px #3498db; }`,
        tooltip: `.tooltip { opacity: 0.8; transition: opacity 0.2s; } .tooltip:hover { opacity: 1; }`,
        notification: `
            .notification {
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                font-size: 14px;
                z-index: 999999;
                display: flex;
                align-items: center;
                gap: 8px;
                animation: slideUp 0.3s ease-out;
                max-width: 300px;
            }
            .notification.success { border-left: 4px solid #4CAF50; }
            .notification.info { border-left: 4px solid #2196F3; }
            .notification.warning { border-left: 4px solid #FFC107; }
            .notification.error { border-left: 4px solid #F44336; }
            @keyframes slideUp {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `,
        fab: `
            #${IDs.FAB} {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 999998;
                width: 56px;
                height: 56px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #${IDs.FAB}:hover {
                transform: scale(1.1);
            }
        `,
        ui: `
            #${IDs.UI} {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 999999;
                background: white;
                color: #333;
                padding: 16px;
                border-radius: 12px;
                font-size: 14px;
                box-shadow: 0 8px 30px rgba(0,0,0,0.12);
                min-width: 280px;
                max-width: 320px;
                display: none;
                animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `,
        buttons: `
            .action-btn {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: background 0.2s;
                width: 100%;
                margin: 4px 0;
            }
            .action-btn:hover {
                background: #43A047;
            }
            .danger-btn {
                background: #f44336;
            }
            .danger-btn:hover {
                background: #e53935;
            }
        `,
        modal: `
            .modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 1000000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s;
            }
            .modal-content {
                background: white;
                padding: 24px;
                border-radius: 12px;
                max-width: 480px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
                animation: zoomIn 0.3s;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes zoomIn {
                from { transform: scale(0.95); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
        `,
        switch: `
            .switch {
                position: relative;
                display: inline-block;
                width: 44px;
                height: 24px;
            }
            .switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #ccc;
                transition: .4s;
                border-radius: 24px;
            }
            .slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background-color: white;
                transition: .4s;
                border-radius: 50%;
            }
            input:checked + .slider {
                background-color: #4CAF50;
            }
            input:checked + .slider:before {
                transform: translateX(20px);
            }
        `
    };

    // 註冊所有樣式
    Object.values(styles).forEach(style => GM_addStyle(style));

    // 元素封鎖處理
    function blockElement(el, selector, isHeuristic = false, reason = '') {
        try {
            if (!el || el.classList.contains(IDs.HIDDEN) || el.classList.contains(IDs.HEURISTIC)) return;

            // 檢查是否在排除列表中
            if (state.exclusions[location.hostname]?.includes(selector)) return;

            // 檢查iframe來源
            if (el.tagName === 'IFRAME') {
                try {
                    const src = new URL(el.src);
                    if (DOMAINS.some(d => src.hostname.match(d))) {
                        reason = reason || `可疑的iframe來源: ${src.hostname}`;
                    }
                } catch {}
            }

            if (isHeuristic) {
                el.classList.add(IDs.HEURISTIC);
            } else {
                state.removed.push({
                    element: el.cloneNode(true),
                    parent: el.parentNode,
                    nextSibling: el.nextSibling,
                    selector,
                    reason: reason || '手動封鎖'
                });
                if (state.removed.length > 10) state.removed.shift();
                el.classList.add(IDs.HIDDEN);
            }
            state.blockedCount++;
            updateUI();
        } catch {}
    }

    // 啟發式掃描增強
    function enhancedHeuristicScan() {
        if (!state.siteSettings[location.hostname]?.heuristic) return;

        // 關鍵字掃描優化
        const keywordPatterns = KEYWORDS.map(k => 
            `[class*="${k}"], [id*="${k}"], [role*="${k}"], [aria-label*="${k}"]`
        ).join(',');

        utils.batch(utils.safeQueryAll(keywordPatterns), 30, el => {
            try {
                if (el.closest(`#${IDs.UI}`)) return;
                
                // 智能選擇器
                const selector = getSmartSelector(el);
                if (!state.rules.includes(selector) && !state.heuristicBlocked.has(el)) {
                    const matchedKeyword = KEYWORDS.find(k => 
                        el.className?.includes(k) || 
                        el.id?.includes(k) ||
                        el.getAttribute('role')?.includes(k) ||
                        el.getAttribute('aria-label')?.includes(k)
                    );
                    
                    state.heuristicBlocked.set(el, {
                        reason: `關鍵字匹配 (${matchedKeyword})`,
                        selector,
                        confidence: calculateConfidence(el)
                    });
                    
                    blockElement(el, selector, true);
                }
            } catch {}
        });

        // iframe 掃描優化
        utils.batch(utils.safeQueryAll('iframe'), 10, iframe => {
            try {
                if (!iframe.src) return;
                const url = new URL(iframe.src, location.href);
                if (DOMAINS.some(domain => url.hostname.includes(domain))) {
                    const selector = getSmartSelector(iframe);
                    if (!state.rules.includes(selector) && !state.heuristicBlocked.has(iframe)) {
                        state.heuristicBlocked.set(iframe, {
                            reason: `可疑域名 (${url.hostname})`,
                            selector,
                            confidence: 0.9
                        });
                        blockElement(iframe, selector, true);
                    }
                }
            } catch {}
        });

        updateReviewButton();
    }

    // 計算置信度
    function calculateConfidence(el) {
        let score = 0;
        let reasons = [];
        
        // 關鍵字匹配數
        const text = (el.className + ' ' + el.id + ' ' + 
                     el.getAttribute('role') + ' ' + 
                     el.getAttribute('aria-label') + ' ' +
                     el.getAttribute('data-ad-slot') + ' ' +  // 新增: 檢查廣告相關屬性
                     el.getAttribute('data-ad-client'))
            .toLowerCase();
        const matchedKeywords = KEYWORDS.filter(k => text.includes(k));
        if (matchedKeywords.length > 0) {
            score += matchedKeywords.length * 0.2;
            reasons.push(`關鍵字匹配: ${matchedKeywords.join(', ')}`);
        }

        // 位置評分
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.3) {
            score += 0.1;
            reasons.push('頂部位置');
        }
        if (rect.right > window.innerWidth * 0.7) {
            score += 0.1;
            reasons.push('右側位置');
        }

        // 大小評分
        const area = rect.width * rect.height;
        if (area > 10000 && area < 200000) {
            score += 0.1;
            reasons.push('典型廣告大小');
        }

        // iframe 和腳本評分
        if (el.tagName === 'IFRAME') {
            score += 0.2;
            reasons.push('iframe元素');
            try {
                const src = new URL(el.src);
                if (DOMAINS.some(d => src.hostname.match(d))) {
                    score += 0.3;
                    reasons.push(`可疑域名: ${src.hostname}`);
                }
            } catch {}
        } else if (el.tagName === 'SCRIPT') {
            try {
                const src = new URL(el.src);
                if (DOMAINS.some(d => src.hostname.match(d))) {
                    score += 0.4;
                    reasons.push(`追蹤腳本: ${src.hostname}`);
                }
            } catch {}

        return Math.min(score, 1);
    }

    // 效能優化的規則套用
    const applyRules = utils.throttle(() => {
        state.rules.forEach(selector => {
            try {
                utils.safeQueryAll(selector).forEach(el => blockElement(el, selector));
            } catch {}
        });
    }, 500);

    // 通知系統
    function showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span style="font-size:16px">${
                type === 'success' ? '✅' :
                type === 'info' ? 'ℹ️' :
                type === 'warning' ? '⚠️' :
                type === 'error' ? '❌' : 'ℹ️'
            }</span>
            <span>${message}</span>
        `;
        document.body.appendChild(notification);
        
        state.notifications.push(notification);
        if (state.notifications.length > 3) {
            const oldNotification = state.notifications.shift();
            oldNotification.remove();
        }

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(20px)';
            notification.style.transition = 'all 0.3s ease-out';
            setTimeout(() => {
                notification.remove();
                state.notifications = state.notifications.filter(n => n !== notification);
            }, 300);
        }, duration);

        return notification;
    }

    // 拖曳功能
    function makeElementDraggable(el) {
        const header = el.querySelector('h2') || el;
        
        header.onmousedown = e => {
            if (e.button !== 0) return; // 只處理左鍵點擊
            
            state.isDragging = true;
            state.dragOffset.x = e.clientX - el.offsetLeft;
            state.dragOffset.y = e.clientY - el.offsetTop;
            
            const onMouseMove = e => {
                if (!state.isDragging) return;
                
                let x = e.clientX - state.dragOffset.x;
                let y = e.clientY - state.dragOffset.y;
                
                // 確保不會超出視窗範圍
                x = Math.max(0, Math.min(x, window.innerWidth - el.offsetWidth));
                y = Math.max(0, Math.min(y, window.innerHeight - el.offsetHeight));
                
                el.style.left = x + 'px';
                el.style.top = y + 'px';
                
                state.uiPosition = { x, y };
                GM_setValue('uiPosition', state.uiPosition);
            };
            
            const onMouseUp = () => {
                state.isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        
        // 防止拖曳時選中文字
        header.style.userSelect = 'none';
    }

    // UI 更新
    function updateUI() {
        const badge = document.getElementById(IDs.BADGE);
        if (badge) badge.textContent = `已封鎖: ${state.blockedCount}`;

        const ruleCount = document.getElementById(IDs.RULE_COUNT);
        if (ruleCount) ruleCount.textContent = `規則數: ${state.rules.length}`;
    }

    function updateReviewButton() {
        const btn = document.getElementById(IDs.REVIEW);
        const count = state.heuristicBlocked.size;
        
        if (btn) {
            btn.textContent = `🤖 審核學習 (${count})`;
            btn.style.display = count > 0 ? 'block' : 'none';
            btn.style.background = count > 0 ? '#3498db' : '';
        }
    }

    // 切換UI顯示
    function toggleUI() {
        const ui = document.getElementById(IDs.UI);
        const isVisible = ui.style.display !== 'none';
        
        if (isVisible) {
            ui.style.opacity = '0';
            ui.style.transform = 'translateX(20px)';
            setTimeout(() => ui.style.display = 'none', 300);
        } else {
            ui.style.display = 'block';
            ui.style.left = state.uiPosition.x + 'px';
            ui.style.top = state.uiPosition.y + 'px';
            setTimeout(() => {
                ui.style.opacity = '1';
                ui.style.transform = 'translateX(0)';
            }, 10);
        }
    }

    // 建立現代化 UI
    function createModernUI() {
        const fab = document.createElement('div');
        fab.id = IDs.FAB;
        fab.innerHTML = `<div style="font-size:24px">🧠</div>`;
        fab.title = "智慧廣告攔截器";
        fab.onclick = toggleUI;
        document.body.appendChild(fab);

        const ui = document.createElement('div');
        ui.id = IDs.UI;
        ui.innerHTML = `
            <div style="margin-bottom:16px">
                <h2 style="margin:0 0 8px;font-size:18px">🧠 智慧廣告攔截器</h2>
                <div style="font-size:12px;color:#666">即時保護，智能學習</div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <span>啟發式學習</span>
                <label class="switch">
                    <input type="checkbox" id="${IDs.TOGGLE}">
                    <span class="slider"></span>
                </label>
            </div>

            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <button id="${IDs.BLOCK}" class="action-btn" style="position:relative;padding-left:36px">
                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%)">🎯</span>
                    點擊封鎖
                </button>
                <div class="tooltip" style="background:#f8f9fa;padding:8px;border-radius:6px;font-size:12px;color:#666">
                    點擊此按鈕，然後點選網頁上的廣告元素進行封鎖
                </div>
            </div>

            <div id="${IDs.REVIEW}" style="display:none;margin-top:8px">
                <button class="action-btn" style="position:relative;padding-left:36px">
                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%)">🤖</span>
                    審核學習 (0)
                </button>
                <div class="tooltip" style="background:#f8f9fa;padding:8px;border-radius:6px;font-size:12px;color:#666;margin-top:4px">
                    系統自動識別的廣告，需要您的確認
                </div>
            </div>

            <div style="margin-top:8px">
                <button id="${IDs.ADD_EXCLUSION}" class="action-btn" style="position:relative;padding-left:36px;background:#3498db">
                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%)">⭐</span>
                    添加排除規則
                </button>
                <div class="tooltip" style="background:#f8f9fa;padding:8px;border-radius:6px;font-size:12px;color:#666;margin-top:4px">
                    將特定元素加入白名單，避免被誤封鎖
                </div>
            </div>

            <div style="margin-top:12px;background:#f8f9fa;border-radius:8px;padding:12px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                    <span style="font-weight:500">排除列表</span>
                    <span style="font-size:12px;color:#666">(不會被封鎖的元素)</span>
                </div>
                <div id="${IDs.EXCLUSIONS}" style="max-height:200px;overflow-y:auto">
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px">
                <button class="action-btn" data-action="export">📤 匯出</button>
                <button class="action-btn" data-action="import">📥 匯入</button>
                <button class="action-btn" data-action="sync">☁️ 同步</button>
                <button class="action-btn danger-btn" data-action="clear">🗑️ 清空</button>
            </div>

            <div style="margin-top:16px;padding-top:16px;border-top:1px solid #eee">
                <div id="${IDs.BADGE}" style="font-size:14px">已封鎖: 0</div>
                <div id="${IDs.RULE_COUNT}" style="font-size:14px;margin-top:4px">規則數: 0</div>
                <div style="font-size:12px;color:#666;margin-top:8px">
                    <span style="color:#4CAF50">F1</span>: 連續模式
                    <span style="color:#4CAF50;margin-left:8px">F2</span>: 復原
                </div>
            </div>
        `;

        document.body.appendChild(ui);

        // 事件綁定
        document.getElementById(IDs.TOGGLE).checked = state.siteSettings[location.hostname]?.heuristic || false;
        document.getElementById(IDs.TOGGLE).onchange = e => {
            const host = location.hostname;
            state.siteSettings[host] = state.siteSettings[host] || {};
            state.siteSettings[host].heuristic = e.target.checked;
            GM_setValue("siteSettings", state.siteSettings);
            showNotification(`啟發式引擎已${e.target.checked ? '開啟' : '關閉'}`, 'info');
            if (e.target.checked) enhancedHeuristicScan();
        };

        // 排除按鈕事件
        document.getElementById(IDs.ADD_EXCLUSION).onclick = () => {
            startExclusionMode();
        };

        // 初始化排除列表
        updateExclusionsList();

        // 按鈕事件
        ui.onclick = e => {
            const action = e.target.dataset.action;
            if (action) {
                const actions = {
                    'export': exportExclusions,
                    'import': importExclusions,
                    'sync': syncToCloud,
                    'clear': clearRules
                };
                actions[action]?.();
            }
        };

        makeElementDraggable(ui);
        updateUI();
    }

    // 初始化
    function initialize() {
        createModernUI();
        
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && ['DIV','IFRAME','SECTION'].includes(node.nodeName)) {
                        try {
                            new MutationObserver(() => {
                                if (!state.scanQueue.has(node)) {
                                    state.scanQueue.add(node);
                                    if (Date.now() - state.lastScan > 500) {
                                        processScanQueue();
                                    }
                                }
                            }).observe(node, { childList: true, subtree: true });
                        } catch {}
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            applyRules();
            enhancedHeuristicScan();
        }, 500 + Math.random() * 1000);
    }

    // 掃描佇列處理
    function processScanQueue() {
        if (state.scanQueue.size === 0) return;
        
        state.lastScan = Date.now();
        const nodes = Array.from(state.scanQueue);
        state.scanQueue.clear();

        applyRules();
        if (state.siteSettings[location.hostname]?.heuristic) {
            enhancedHeuristicScan();
        }
    }

    // 排除規則相關函數
    function addExclusion(selector) {
        const hostname = location.hostname;
        state.exclusions[hostname] = state.exclusions[hostname] || [];
        if (!state.exclusions[hostname].includes(selector)) {
            state.exclusions[hostname].push(selector);
            GM_setValue("exclusions", state.exclusions);
            updateExclusionsList();
            showNotification(`已將 ${selector} 添加到排除列表`, 'success');
        }
    }

    function removeExclusion(selector) {
        const hostname = location.hostname;
        if (state.exclusions[hostname]) {
            state.exclusions[hostname] = state.exclusions[hostname].filter(s => s !== selector);
            if (state.exclusions[hostname].length === 0) {
                delete state.exclusions[hostname];
            }
            GM_setValue("exclusions", state.exclusions);
            updateExclusionsList();
            showNotification(`已從排除列表移除 ${selector}`, 'info');
        }
    }

    function updateExclusionsList() {
        const container = document.getElementById(IDs.EXCLUSIONS);
        if (!container) return;

        const hostname = location.hostname;
        const exclusions = state.exclusions[hostname] || [];
        
        if (exclusions.length === 0) {
            container.innerHTML = '<div style="color:#666;font-size:12px;text-align:center;padding:12px">目前沒有排除規則</div>';
            return;
        }

        container.innerHTML = exclusions.map(selector => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;background:white;margin-bottom:4px;border-radius:4px">
                <div style="font-size:12px;word-break:break-all;margin-right:8px">${selector}</div>
                <button class="remove-exclusion" data-selector="${selector}" style="background:none;border:none;cursor:pointer;color:#f44336;padding:4px">
                    ❌
                </button>
            </div>
        `).join('');

        // 綁定移除按鈕事件
        container.querySelectorAll('.remove-exclusion').forEach(btn => {
            btn.onclick = () => removeExclusion(btn.dataset.selector);
        });
    }

    // 點擊添加排除規則
    function startExclusionMode() {
        const ui = document.getElementById(IDs.UI);
        if (ui) ui.style.display = 'none';
        
        document.body.style.cursor = 'crosshair';
        showNotification('請點擊要排除的元素', 'info', 10000);

        const clickHandler = e => {
            e.preventDefault();
            e.stopPropagation();
            
            const el = e.target;
            if (el.id === IDs.UI || el.closest(`#${IDs.UI}`)) return;
            
            const selector = getSmartSelector(el);
            if (selector) {
                addExclusion(selector);
            }
            
            document.body.style.cursor = '';
            document.removeEventListener('click', clickHandler, true);
            if (ui) ui.style.display = 'block';
        };

        document.addEventListener('click', clickHandler, true);
    }

    // 導出排除規則
    function exportExclusions() {
        const hostname = location.hostname;
        const exclusions = state.exclusions[hostname] || [];
        
        if (exclusions.length === 0) {
            showNotification('沒有可導出的排除規則', 'warning');
            return;
        }

        const data = JSON.stringify({ hostname, exclusions }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `ad-exclusions-${hostname}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('排除規則已導出', 'success');
    }

    // 導入排除規則
    function importExclusions() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.hostname && Array.isArray(data.exclusions)) {
                        state.exclusions[data.hostname] = data.exclusions;
                        GM_setValue("exclusions", state.exclusions);
                        updateExclusionsList();
                        showNotification(`已成功導入 ${data.exclusions.length} 條排除規則`, 'success');
                    } else {
                        throw new Error('無效的檔案格式');
                    }
                } catch (err) {
                    showNotification('導入失敗：' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        };
        
        input.click();
    }

    // 初始化延遲
    const initDelay = 500 + Math.random() * 1500;
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, initDelay));
    } else {
        setTimeout(initialize, initDelay);
    }

})();