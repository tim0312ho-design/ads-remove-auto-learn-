// ==UserScript==
// @name         智慧廣告攔截器 - 優化懸浮視窗版
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  優化懸浮視窗，智能提示排除，右上角還原面板，連續封鎖整合
// @author       Enhanced Version
// @match        *://*/*
// ==UserScript==
// @name         智慧廣告攔截器 - 優化懸浮視窗版
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  程式結構模組化、UI/UX優化、學習系統強化
// @author       Enhanced Version
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // ===== Utils 模組 =====
    const Utils = {
        rand: (l, p = '') => p + Math.random().toString(36).substr(2, l),
        genID: () => Utils.rand(12, '_' + Date.now().toString(36).slice(-2)),
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
    }
    };
    // ...existing code...

    // ===== IDs 模組 =====
    const IDs = {
        HIDDEN: Utils.genID(),
        HEURISTIC: Utils.genID(),
        UI: Utils.genID(),
        FAB: Utils.genID(),
        MINI_PANEL: Utils.genID(),
        REVIEW: Utils.genID(),
        BADGE: Utils.genID(),
        RULE_COUNT: Utils.genID(),
        TOGGLE: Utils.genID(),
        BLOCK: Utils.genID(),
        EXCLUSIONS: Utils.genID(),
        TOOLTIP: Utils.genID(),
        CONTINUOUS: Utils.genID()
    };

    // ===== showNotification（優化版） =====
    function showNotification(message, type = 'info', duration = 3000) {
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 20px;
                z-index: 10001;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.pointerEvents = 'auto';
        notification.style.position = 'relative';
        const icon = type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️';
        notification.innerHTML = `
            <span style="font-size:16px">${icon}</span>
            <span>${message}</span>
            <button style="position:absolute;top:6px;right:8px;background:none;border:none;font-size:16px;cursor:pointer;color:#888;" title="關閉">×</button>
        `;
        notification.querySelector('button').onclick = () => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(20px)';
            notification.style.transition = 'all 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        };
        container.appendChild(notification);
        if (!window.state) window.state = {};
        if (!window.state.notifications) window.state.notifications = [];
        window.state.notifications.push(notification);
        if (window.state.notifications.length > 5) {
            const oldNotification = window.state.notifications.shift();
            oldNotification.remove();
        }
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(20px)';
            notification.style.transition = 'all 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, duration);
        return notification;
    }

    // ...existing code...

    // ===== state 物件 =====
    const state = {
        heuristicBlocked: new Map(),
        removed: [],
        blockedCount: 0,
        continuousMode: GM_getValue("continuousMode", false),
        scanQueue: new Set(),
        lastScan: 0,
        notifications: [],
        uiPosition: GM_getValue("uiPosition", { x: 20, y: 20 }),
        miniPanelVisible: GM_getValue("miniPanelVisible", true),
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        isPaused: GM_getValue("isPaused", false),
        undoStack: [],
        redoStack: [],
        hoveredElement: null,
        tooltipTimeout: null,
        safetyLimits: {
            maxBlocksPerPage: 50,
            minContentRatio: 0.3,
            criticalSelectors: [
                'main', 'article', 'header', 'footer', 'nav',
                '[role="main"]', '[role="article"]', '[role="navigation"]'
            ],
            unsafeClasses: [
                'container', 'wrapper', 'content', 'main', 'page',
                'site-content', 'main-content'
            ]
        }
    };
    // ...existing code...

    // ===== UIManager 模組 =====
    const UIManager = {
        showNotification(message, type = 'info', duration = 3000) {
            // 集中管理通知，堆疊顯示，支援手動關閉
            let container = document.getElementById('notification-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'notification-container';
                container.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    z-index: 10001;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    pointer-events: none;
                `;
                document.body.appendChild(container);
            }
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.style.pointerEvents = 'auto';
            notification.style.position = 'relative';
            notification.innerHTML = `
                <span style="font-size:16px">${type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️'}</span>
                <span>${message}</span>
                <button style="position:absolute;top:6px;right:8px;background:none;border:none;font-size:16px;cursor:pointer;color:#888;" title="關閉">×</button>
            `;
            // 手動關閉
            notification.querySelector('button').onclick = () => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(20px)';
                notification.style.transition = 'all 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            };
            container.appendChild(notification);
            state.notifications.push(notification);
            // 最多顯示 5 則
            if (state.notifications.length > 5) {
                const oldNotification = state.notifications.shift();
                oldNotification.remove();
            }
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(20px)';
                notification.style.transition = 'all 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, duration);
        },
        updateMiniPanel() {
            // Mini Panel 支援自動隱藏
            const panel = document.getElementById(IDs.MINI_PANEL);
            if (!panel) return;
            panel.classList.add('show');
            panel.querySelector('.mini-stat-value').textContent = state.blockedCount;
            panel.querySelector('.mini-stat-label').textContent = '已封鎖';
            if (!state.miniPanelVisible) {
                panel.classList.remove('show');
            }
        },
        toggleMiniPanel() {
            state.miniPanelVisible = !state.miniPanelVisible;
            GM_setValue("miniPanelVisible", state.miniPanelVisible);
            UIManager.updateMiniPanel();
        }
    };

    // ===== AdLearner 模組 =====
    class AdLearner {
        constructor() {
            this.patterns = GM_getValue('learned_patterns', {
                keywords: new Set(),
                selectors: new Set(),
                domains: new Set(),
                sizes: [],
                positions: [],
                behaviors: new Set()
            });
            this.confidence_threshold = GM_getValue('confidence_threshold', 0.75);
            this.learning_rate = 0.1;
        }
        async calculateConfidence(el) {
            let score = 0;
            let reasons = [];
            const text = this.extractText(el);
            const words = text.split(/\W+/).filter(w => w.length > 3);
            const matchedKeywords = words.filter(w => this.patterns.keywords.has(w) || KEYWORDS.some(k => w.includes(k)));
            if (matchedKeywords.length > 0) {
                score += matchedKeywords.length * 0.15;
                reasons.push(`關鍵字匹配: ${matchedKeywords.join(', ')}`);
            }
            const selector = getSmartSelector(el);
            if (this.patterns.selectors.has(selector)) {
                score += 0.3;
                reasons.push('選擇器模式匹配');
            }
            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (this.patterns.sizes.length > 0) {
                const sizeSimilarity = this.patterns.sizes.some(s => Math.abs(s.width - rect.width) < 50 && Math.abs(s.height - rect.height) < 50);
                if (sizeSimilarity) {
                    score += 0.15;
                    reasons.push('尺寸模式匹配');
                }
            } else if (area > 10000 && area < 200000) {
                score += 0.1;
                reasons.push('典型廣告大小');
            }
            if (el.tagName === 'IFRAME' || el.tagName === 'SCRIPT') {
                try {
                    const src = new URL(el.src);
                    if (this.patterns.domains.has(src.hostname)) {
                        score += 0.3;
                        reasons.push(`已知廣告域名: ${src.hostname}`);
                    } else if (DOMAINS.some(d => src.hostname.match(d))) {
                        score += 0.25;
                        reasons.push(`可疑域名: ${src.hostname}`);
                    }
                } catch {}
            }

            // ===== 進階學習模型（TensorFlow.js）接口 =====
            if (window.tf && this.model) {
                // 將 DOM 特徵轉換為模型輸入
                const features = this.domToFeatures(el);
                const input = tf.tensor([features]);
                const prediction = await this.model.predict(input).data();
                score = prediction[0];
                reasons.push('TensorFlow.js 模型預測分數: ' + score.toFixed(2));
            }

            return {
                score: Math.min(score, 1),
                reasons,
                isLikelyAd: score >= this.confidence_threshold
            };
        }

        // 將 DOM 元素特徵轉換為數值向量
        domToFeatures(el) {
            const rect = el.getBoundingClientRect();
            return [
                rect.width,
                rect.height,
                rect.top,
                rect.left,
                el.className.length,
                el.id.length,
                el.tagName === 'IFRAME' ? 1 : 0,
                el.tagName === 'SCRIPT' ? 1 : 0,
                (el.getAttribute('role') || '').length,
                (el.getAttribute('aria-label') || '').length
            ];
        }

        // 載入 TensorFlow.js 模型
        async loadModel(url) {
            if (window.tf) {
                this.model = await tf.loadLayersModel(url);
            }
        }
        extractText(el) {
            return (el.className + ' ' + el.id + ' ' + el.getAttribute('role') + ' ' + el.getAttribute('aria-label') + ' ' + el.getAttribute('data-ad-slot') + ' ' + el.getAttribute('data-ad-client') + ' ' + el.getAttribute('data-ad-layout') + ' ' + el.getAttribute('data-ad-format')).toLowerCase();
        }
        processFeedback(el, wasCorrect) {
            // 用戶反饋微調信心閾值
            if (wasCorrect) {
                this.confidence_threshold = Math.max(0.6, this.confidence_threshold - this.learning_rate);
            } else {
                this.confidence_threshold = Math.min(0.9, this.confidence_threshold + this.learning_rate);
            }
            GM_setValue('confidence_threshold', this.confidence_threshold);
        }
    }

    // ===== 智能選擇器生成 =====
    function getSmartSelector(el) {
        if (!(el instanceof Element)) return "";
        if (el.id && Utils.safeQueryAll(`#${el.id}`).length === 1) {
            return `#${el.id}`;
        }
        if (el.className) {
            const classes = el.className.split(' ').filter(c => c.trim()).filter(c => !c.includes(IDs.HIDDEN) && !c.includes(IDs.HEURISTIC));
            if (classes.length) {
                const selector = '.' + classes.join('.');
                if (Utils.safeQueryAll(selector).length <= 3) {
                    return selector;
                }
            }
        }
        for (const attr of ['role', 'aria-label', 'data-testid']) {
            if (el.getAttribute(attr)) {
                const selector = `[${attr}="${el.getAttribute(attr)}"]`;
                if (Utils.safeQueryAll(selector).length <= 3) {
                    return selector;
                }
            }
        }
        const path = [];
        let current = el;
        while (current && current.nodeType === 1) {
            let selector = current.nodeName.toLowerCase();
            if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break;
            }
            const siblings = Array.from(current.parentNode?.children || []).filter(s => s.nodeName === current.nodeName);
            if (siblings.length > 1) {
                selector += `:nth-child(${siblings.indexOf(current) + 1})`;
            }
            path.unshift(selector);
            current = current.parentNode;
            if (path.length >= 4) break;
        }
        return path.join(' > ');
    }

    // ...existing code...
    const styles = {
        hidden: `.${IDs.HIDDEN}, .${IDs.HEURISTIC} { display: none !important; }`,
        tooltip: `
            .${IDs.TOOLTIP} {
                position: fixed;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                font-size: 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 999999;
                pointer-events: none;
                opacity: 0;
                transform: translateY(-10px);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                max-width: 250px;
                line-height: 1.4;
            }
            .${IDs.TOOLTIP}.show {
                opacity: 1;
                transform: translateY(0);
                pointer-events: auto;
            }
            .${IDs.TOOLTIP} .tooltip-actions {
                display: flex;
                gap: 8px;
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.2);
            }
            .${IDs.TOOLTIP} .tooltip-btn {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
                transition: background 0.2s;
            }
            .${IDs.TOOLTIP} .tooltip-btn:hover {
                background: rgba(255,255,255,0.3);
            }
            .${IDs.TOOLTIP} .tooltip-btn.exclude {
                background: rgba(76, 175, 80, 0.8);
            }
            .${IDs.TOOLTIP} .tooltip-btn.block {
                background: rgba(244, 67, 54, 0.8);
            }
        `,
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
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                border: none;
            }
            #${IDs.FAB}:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 25px rgba(0,0,0,0.4);
            }
            #${IDs.FAB}.active {
                background: linear-gradient(135deg, #4CAF50 0%, #8BC34A 100%);
            }
        `,
        miniPanel: `
            #${IDs.MINI_PANEL} {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 999999;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                color: #333;
                padding: 12px 16px;
                border-radius: 12px;
                font-size: 13px;
                box-shadow: 0 8px 30px rgba(0,0,0,0.12);
                min-width: 200px;
                display: none;
                animation: slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #${IDs.MINI_PANEL}.show {
                display: block;
            }
            #${IDs.MINI_PANEL}.minimized {
                transform: scale(0.8);
                opacity: 0.7;
            }
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .mini-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid #eee;
            }
            .mini-panel-title {
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .mini-panel-controls {
                display: flex;
                gap: 4px;
            }
            .mini-panel-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                font-size: 14px;
                transition: background 0.2s;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .mini-panel-btn:hover {
                background: #f0f0f0;
            }
            .mini-panel-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-bottom: 12px;
            }
            .mini-stat {
                text-align: center;
                padding: 8px;
                background: #f8f9fa;
                border-radius: 6px;
            }
            .mini-stat-value {
                font-size: 16px;
                font-weight: 600;
                color: #2196F3;
                margin-bottom: 2px;
            }
            .mini-stat-label {
                font-size: 11px;
                color: #666;
            }
            .mini-panel-actions {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
            }
            .mini-action-btn {
                background: #f0f0f0;
                border: none;
                padding: 6px 8px;
                border-radius: 6px;
                font-size: 11px;
                cursor: pointer;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
            }
            .mini-action-btn:hover {
                background: #e0e0e0;
            }
            .mini-action-btn.active {
                background: #4CAF50;
                color: white;
            }
        `,
        ui: `
            #${IDs.UI} {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 1000000;
                background: white;
                color: #333;
                padding: 24px;
                border-radius: 16px;
                font-size: 14px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                min-width: 400px;
                max-width: 500px;
                max-height: 80vh;
                overflow-y: auto;
                display: none;
                animation: popupFadeIn 0.3s ease-out;
            }
            @keyframes popupFadeIn {
                from { opacity: 0; transform: translate(-50%, -48%); }
                to { opacity: 1; transform: translate(-50%, -50%); }
            }
            .ui-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 999999;
                display: none;
                opacity: 0;
                transition: opacity 0.3s;
            }
            .ui-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 16px;
                border-bottom: 1px solid #eee;
            }
            .ui-title {
                font-size: 20px;
                font-weight: 600;
                color: #333;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .ui-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                padding: 4px;
                border-radius: 50%;
                transition: background 0.2s;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .ui-close:hover {
                background: #f5f5f5;
            }
        `,
        buttons: `
            .action-btn {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
                width: 100%;
                margin: 4px 0;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            .action-btn:hover {
                background: #43A047;
                transform: translateY(-1px);
            }
            .action-btn.secondary {
                background: #2196F3;
            }
            .action-btn.secondary:hover {
                background: #1976D2;
            }
            .action-btn.danger {
                background: #f44336;
            }
            .action-btn.danger:hover {
                background: #e53935;
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

    // 檢查元素是否安全可封鎖
    function isSafeToBlock(el, selector) {
        if (state.blockedCount >= state.safetyLimits.maxBlocksPerPage) {
            showNotification('已達到此頁面的最大封鎖數量限制', 'warning');
            return false;
        }

        if (state.safetyLimits.criticalSelectors.some(sel => el.matches(sel))) {
            showNotification('此元素可能是網站的重要部分，已取消封鎖', 'warning');
            return false;
        }

        const rect = el.getBoundingClientRect();
        const viewportArea = window.innerWidth * window.innerHeight;
        const elementArea = rect.width * rect.height;
        
        if (elementArea > viewportArea * state.safetyLimits.minContentRatio) {
            if (!confirm('此元素佔據頁面較大面積，確定要封鎖嗎？這可能會影響網站正常使用。')) {
                return false;
            }
        }

        const classList = Array.from(el.classList);
        if (state.safetyLimits.unsafeClasses.some(cls => 
            classList.some(c => c.toLowerCase().includes(cls.toLowerCase())))) {
            if (!confirm('此元素可能包含重要內容，確定要封鎖嗎？')) {
                return false;
            }
        }

        const hasImportantChildren = Array.from(el.children).some(child => 
            state.safetyLimits.criticalSelectors.some(sel => child.matches(sel)));
        
        if (hasImportantChildren) {
            showNotification('此元素包含重要內容，已取消封鎖', 'warning');
            return false;
        }

        return true;
    }

    // 元素封鎖處理
    function blockElement(el, selector, isHeuristic = false, reason = '') {
        try {
            if (!el || el.classList.contains(IDs.HIDDEN) || el.classList.contains(IDs.HEURISTIC)) return;

            if (state.exclusions[location.hostname]?.includes(selector)) return;

            if (!isSafeToBlock(el, selector)) return;

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
            updateMiniPanel();
        } catch {}
    }

    // 廣告模式學習系統
    class AdPatternLearner {
        constructor() {
            this.patterns = GM_getValue('learned_patterns', {
                keywords: new Set(),
                selectors: new Set(),
                domains: new Set(),
                sizes: [],
                positions: [],
                behaviors: new Set()
            });
            this.confidence_threshold = 0.75;
            this.learning_rate = 0.1;
        }

        calculateConfidence(el) {
            let score = 0;
            let reasons = [];
            
            const text = this.extractText(el);
            const words = text.split(/\W+/).filter(w => w.length > 3);
            const matchedKeywords = words.filter(w => 
                this.patterns.keywords.has(w) || 
                KEYWORDS.some(k => w.includes(k))
            );
            if (matchedKeywords.length > 0) {
                const keywordScore = matchedKeywords.length * 0.15;
                score += keywordScore;
                reasons.push(`關鍵字匹配: ${matchedKeywords.join(', ')}`);
            }

            const selector = getSmartSelector(el);
            if (this.patterns.selectors.has(selector)) {
                score += 0.3;
                reasons.push('選擇器模式匹配');
            }

            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (this.patterns.sizes.length > 0) {
                const sizeSimilarity = this.patterns.sizes.some(s => 
                    Math.abs(s.width - rect.width) < 50 && 
                    Math.abs(s.height - rect.height) < 50
                );
                if (sizeSimilarity) {
                    score += 0.15;
                    reasons.push('尺寸模式匹配');
                }
            } else if (area > 10000 && area < 200000) {
                score += 0.1;
                reasons.push('典型廣告大小');
            }

            if (el.tagName === 'IFRAME' || el.tagName === 'SCRIPT') {
                try {
                    const src = new URL(el.src);
                    if (this.patterns.domains.has(src.hostname)) {
                        score += 0.3;
                        reasons.push(`已知廣告域名: ${src.hostname}`);
                    } else if (DOMAINS.some(d => src.hostname.match(d))) {
                        score += 0.25;
                        reasons.push(`可疑域名: ${src.hostname}`);
                    }
                } catch {}
            }

            return {
                score: Math.min(score, 1),
                reasons,
                isLikelyAd: score >= this.confidence_threshold
            };
        }

        extractText(el) {
            return (el.className + ' ' + 
                   el.id + ' ' + 
                   el.getAttribute('role') + ' ' + 
                   el.getAttribute('aria-label') + ' ' +
                   el.getAttribute('data-ad-slot') + ' ' +
                   el.getAttribute('data-ad-client') + ' ' +
                   el.getAttribute('data-ad-layout') + ' ' +
                   el.getAttribute('data-ad-format'))
                .toLowerCase();
        }
    }

    const adLearner = new AdPatternLearner();

    // 啟發式掃描增強
    function enhancedHeuristicScan() {
        if (!state.siteSettings[location.hostname]?.heuristic) return;

        const keywordPatterns = KEYWORDS.map(k => 
            `[class*="${k}"], [id*="${k}"], [role*="${k}"], [aria-label*="${k}"]`
        ).join(',');

        utils.batch(utils.safeQueryAll(keywordPatterns), 30, el => {
            try {
                if (el.closest(`#${IDs.UI}`) || el.closest(`#${IDs.MINI_PANEL}`) || el.closest(`#${IDs.FAB}`)) return;
                
                const selector = getSmartSelector(el);
                if (!state.rules.includes(selector) && !state.heuristicBlocked.has(el)) {
                    const analysis = adLearner.calculateConfidence(el);
                    
                    if (analysis.isLikelyAd) {
                        state.heuristicBlocked.set(el, {
                            reason: analysis.reasons.join('\n'),
                            selector,
                            confidence: analysis.score
                        });
                        
                        blockElement(el, selector, true);
                    }
                }
            } catch {}
        });

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

        updateMiniPanel();
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
        // 通知系統（優化版）
        function showNotification(message, type = 'info', duration = 3000) {
            // 集中管理通知容器
            let container = document.getElementById('notification-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'notification-container';
                container.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    z-index: 10001;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    pointer-events: none;
                `;
                document.body.appendChild(container);
            }
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.style.pointerEvents = 'auto';
            notification.style.position = 'relative';
            const icon = type === 'success' ? '✅' : type === 'info' ? 'ℹ️' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️';
            notification.innerHTML = `
                <span style="font-size:16px">${icon}</span>
                <span>${message}</span>
                <button style="position:absolute;top:6px;right:8px;background:none;border:none;font-size:16px;cursor:pointer;color:#888;" title="關閉">×</button>
            `;
            // 手動關閉
            notification.querySelector('button').onclick = () => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(20px)';
                notification.style.transition = 'all 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            };
            container.appendChild(notification);
            if (!state.notifications) state.notifications = [];
            state.notifications.push(notification);
            // 最多顯示 5 則
            if (state.notifications.length > 5) {
                const oldNotification = state.notifications.shift();
                oldNotification.remove();
            }
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(20px)';
                notification.style.transition = 'all 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, duration);
            return notification;
        }
