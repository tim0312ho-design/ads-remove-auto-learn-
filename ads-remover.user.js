// ==UserScript==
// @name         智慧廣告攔截器 - 啟發式學習版
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  啟發式自動學習攔截，效能強化、防偵測升級、視覺優化，支援手動排除，新增暫停與復原功能，支援框選區域封鎖
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
        dragOffset: { x: 0, y: 0 },
        isPaused: GM_getValue("isPaused", false),
        undoStack: [],
        redoStack: [],
        // 安全限制設定
        safetyLimits: {
            maxBlocksPerPage: 50,            // 每頁最大封鎖數
            minContentRatio: 0.3,            // 最小內容保留比例
            criticalSelectors: [             // 重要元素選擇器
                'main', 'article', 'header', 'footer', 'nav',
                '[role="main"]', '[role="article"]', '[role="navigation"]'
            ],
            unsafeClasses: [                 // 不安全的類名
                'container', 'wrapper', 'content', 'main', 'page',
                'site-content', 'main-content'
            ]
        }
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
        tooltip: `.tooltip { opacity: 0.8; transition: opacity 0.2s; } .tooltip:hover { opacity: 1; }`,
        selection: `
            .selection-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.1);
                z-index: 999997;
                cursor: crosshair;
                display: none;
            }
            .selection-box {
                position: absolute;
                border: 2px solid #2196F3;
                background: rgba(33, 150, 243, 0.1);
                z-index: 999998;
            }
            .selection-target {
                position: absolute;
                border: 2px solid #4CAF50;
                background: rgba(76, 175, 80, 0.1);
                z-index: 999998;
                pointer-events: none;
            }
        `,
        popup: `
            .popup-window {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 24px;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                z-index: 999999;
                width: 90%;
                max-width: 600px;
                max-height: 90vh;
                overflow-y: auto;
                display: none;
                animation: popupFadeIn 0.3s ease-out;
            }
            @keyframes popupFadeIn {
                from { opacity: 0; transform: translate(-50%, -48%); }
                to { opacity: 1; transform: translate(-50%, -50%); }
            }
            .popup-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 999998;
                display: none;
                opacity: 0;
                transition: opacity 0.3s;
            }
            .popup-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 16px;
                border-bottom: 1px solid #eee;
            }
            .popup-title {
                font-size: 20px;
                font-weight: 600;
                color: #333;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .popup-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                padding: 4px;
                border-radius: 50%;
                transition: background 0.2s;
            }
            .popup-close:hover {
                background: #f5f5f5;
            }
            .popup-section {
                background: #f8f9fa;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
            }
            .popup-section-title {
                font-size: 16px;
                font-weight: 500;
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .stat-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 12px;
                margin-bottom: 16px;
            }
            .stat-item {
                background: white;
                padding: 12px;
                border-radius: 8px;
                text-align: center;
            }
            .stat-value {
                font-size: 24px;
                font-weight: 600;
                color: #2196F3;
                margin-bottom: 4px;
            }
            .stat-label {
                font-size: 12px;
                color: #666;
            }
            .learning-progress {
                width: 100%;
                height: 6px;
                background: #e0e0e0;
                border-radius: 3px;
                overflow: hidden;
                margin: 8px 0;
            }
            .learning-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #4CAF50, #8BC34A);
                transition: width 0.3s ease-out;
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

    // 檢查元素是否安全可封鎖
    function isSafeToBlock(el, selector) {
        // 檢查是否超過每頁封鎖限制
        if (state.blockedCount >= state.safetyLimits.maxBlocksPerPage) {
            showNotification('已達到此頁面的最大封鎖數量限制', 'warning');
            return false;
        }

        // 檢查是否是重要元素
        if (state.safetyLimits.criticalSelectors.some(sel => el.matches(sel))) {
            showNotification('此元素可能是網站的重要部分，已取消封鎖', 'warning');
            return false;
        }

        // 檢查元素大小
        const rect = el.getBoundingClientRect();
        const viewportArea = window.innerWidth * window.innerHeight;
        const elementArea = rect.width * rect.height;
        
        if (elementArea > viewportArea * state.safetyLimits.minContentRatio) {
            // 如果元素過大，顯示確認對話框
            if (!confirm('此元素佔據頁面較大面積，確定要封鎖嗎？這可能會影響網站正常使用。')) {
                return false;
            }
        }

        // 檢查是否包含不安全的類名
        const classList = Array.from(el.classList);
        if (state.safetyLimits.unsafeClasses.some(cls => 
            classList.some(c => c.toLowerCase().includes(cls.toLowerCase())))) {
            if (!confirm('此元素可能包含重要內容，確定要封鎖嗎？')) {
                return false;
            }
        }

        // 檢查是否包含重要子元素
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

            // 檢查是否在排除列表中
            if (state.exclusions[location.hostname]?.includes(selector)) return;

            // 檢查是否安全可封鎖
            if (!isSafeToBlock(el, selector)) return;

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

        learn(el, isAd) {
            if (!el) return;

            // 學習關鍵字模式
            const text = this.extractText(el);
            const words = text.split(/\W+/).filter(w => w.length > 3);
            words.forEach(word => {
                if (isAd) {
                    this.patterns.keywords.add(word.toLowerCase());
                } else {
                    this.patterns.keywords.delete(word.toLowerCase());
                }
            });

            // 學習選擇器模式
            const selector = getSmartSelector(el);
            if (isAd) {
                this.patterns.selectors.add(selector);
            } else {
                this.patterns.selectors.delete(selector);
            }

            // 學習大小模式
            const rect = el.getBoundingClientRect();
            const size = { width: rect.width, height: rect.height };
            if (isAd) {
                this.patterns.sizes.push(size);
                if (this.patterns.sizes.length > 100) {
                    this.patterns.sizes.shift();
                }
            }

            // 學習位置模式
            const position = {
                top: rect.top / window.innerHeight,
                right: rect.right / window.innerWidth
            };
            if (isAd) {
                this.patterns.positions.push(position);
                if (this.patterns.positions.length > 100) {
                    this.patterns.positions.shift();
                }
            }

            // 學習域名模式
            if (el.tagName === 'IFRAME' || el.tagName === 'SCRIPT') {
                try {
                    const src = new URL(el.src);
                    if (isAd) {
                        this.patterns.domains.add(src.hostname);
                    } else {
                        this.patterns.domains.delete(src.hostname);
                    }
                } catch {}
            }

            // 保存學習結果
            GM_setValue('learned_patterns', this.patterns);
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

        calculateConfidence(el) {
            let score = 0;
            let reasons = [];
            
            // 關鍵字評分
            const text = this.extractText(el);
            const words = text.split(/\W+/).filter(w => w.length > 3);
            const matchedKeywords = words.filter(w => 
                this.patterns.keywords.has(w) || 
                KEYWORDS.some(k => w.includes(k))
            );
            if (matchedKeywords.length > 0) {
                const keywordScore = matchedKeywords.length * 0.15;
                score += keywordScore;
                reasons.push(`關鍵字匹配 (${keywordScore.toFixed(2)}): ${matchedKeywords.join(', ')}`);
            }

            // 選擇器評分
            const selector = getSmartSelector(el);
            if (this.patterns.selectors.has(selector)) {
                score += 0.3;
                reasons.push('選擇器模式匹配 (0.30)');
            }

            // 大小評分
            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (this.patterns.sizes.length > 0) {
                const sizeSimilarity = this.patterns.sizes.some(s => 
                    Math.abs(s.width - rect.width) < 50 && 
                    Math.abs(s.height - rect.height) < 50
                );
                if (sizeSimilarity) {
                    score += 0.15;
                    reasons.push('尺寸模式匹配 (0.15)');
                }
            } else if (area > 10000 && area < 200000) {
                score += 0.1;
                reasons.push('典型廣告大小 (0.10)');
            }

            // 位置評分
            const relativePosition = {
                top: rect.top / window.innerHeight,
                right: rect.right / window.innerWidth
            };
            if (this.patterns.positions.length > 0) {
                const positionSimilarity = this.patterns.positions.some(p =>
                    Math.abs(p.top - relativePosition.top) < 0.1 &&
                    Math.abs(p.right - relativePosition.right) < 0.1
                );
                if (positionSimilarity) {
                    score += 0.15;
                    reasons.push('位置模式匹配 (0.15)');
                }
            } else {
                if (rect.top < window.innerHeight * 0.3) {
                    score += 0.05;
                    reasons.push('頂部位置 (0.05)');
                }
                if (rect.right > window.innerWidth * 0.7) {
                    score += 0.05;
                    reasons.push('右側位置 (0.05)');
                }
            }

            // iframe 和腳本評分
            if (el.tagName === 'IFRAME' || el.tagName === 'SCRIPT') {
                try {
                    const src = new URL(el.src);
                    if (this.patterns.domains.has(src.hostname)) {
                        score += 0.3;
                        reasons.push(`已知廣告域名 (0.30): ${src.hostname}`);
                    } else if (DOMAINS.some(d => src.hostname.match(d))) {
                        score += 0.25;
                        reasons.push(`可疑域名 (0.25): ${src.hostname}`);
                    }
                } catch {}

                }

                // 行為模式評分
                const hasClickHandler = el.onclick || el.addEventListener;
                const hasAnimation = getComputedStyle(el).animation !== 'none' ||
                                   getComputedStyle(el).transition !== 'none';
                if (hasClickHandler) {
                    score += 0.1;
                    reasons.push('具有點擊事件 (0.10)');
                }
                if (hasAnimation) {
                    score += 0.05;
                    reasons.push('具有動畫效果 (0.05)');
                }

                return {
                    score: Math.min(score, 1),
                    reasons,
                    isLikelyAd: score >= this.confidence_threshold
                };
            }

            // 反饋處理
            processFeedback(el, wasCorrect) {
                if (wasCorrect) {
                    this.confidence_threshold = Math.max(
                        0.6,
                        this.confidence_threshold - this.learning_rate
                    );
                } else {
                    this.confidence_threshold = Math.min(
                        0.9,
                        this.confidence_threshold + this.learning_rate
                    );
                }
                
                // 更新學習率
                this.learning_rate = Math.max(0.05, this.learning_rate * 0.95);
                
                // 保存新的閾值
                GM_setValue('confidence_threshold', this.confidence_threshold);
            }
    }

    // 初始化學習系統
    const adLearner = new AdPatternLearner();

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
            btn.textContent = `🔍 審核待確認項目 (${count})`;
            if (count > 0) {
                btn.style.display = 'block';
                btn.style.background = '#3498db';
                btn.style.color = 'white';
                btn.style.padding = '12px';
                btn.style.borderRadius = '6px';
                btn.style.cursor = 'pointer';
                btn.style.transition = 'background 0.2s';
                
                // 添加閃爍動畫
                btn.style.animation = 'pulse 2s infinite';
                if (!document.querySelector('.pulse-animation')) {
                    const style = document.createElement('style');
                    style.className = 'pulse-animation';
                    style.textContent = `
                        @keyframes pulse {
                            0% { transform: scale(1); }
                            50% { transform: scale(1.02); }
                            100% { transform: scale(1); }
                        }
                    `;
                    document.head.appendChild(style);
                }
            } else {
                btn.style.display = 'none';
            }
        }
        
        // 更新統計數據
        const statsEl = document.querySelector('.learning-stats');
        if (statsEl) {
            statsEl.textContent = `智能識別: ${count}個待確認`;
        }
    }

    // 切換彈出視窗
    function togglePopup(show) {
        const popup = document.querySelector('.popup-window');
        const overlay = document.querySelector('.popup-overlay');
        
        if (show) {
            overlay.style.display = 'block';
            popup.style.display = 'block';
            // 使用 setTimeout 確保 display 變更後再添加動畫
            setTimeout(() => {
                overlay.style.opacity = '1';
                updateStats();
            }, 10);
        } else {
            overlay.style.opacity = '0';
            popup.style.opacity = '0';
            popup.style.transform = 'translate(-50%, -48%)';
            setTimeout(() => {
                overlay.style.display = 'none';
                popup.style.display = 'none';
                // 重置彈出視窗狀態
                popup.style.opacity = '';
                popup.style.transform = '';
            }, 300);
        }
    }

    // 更新統計數據
    function updateStats() {
        const confidenceEl = document.getElementById('confidence-value');
        const progressEl = document.getElementById('learning-progress');
        
        if (confidenceEl && progressEl) {
            const confidence = Math.round(adLearner.confidence_threshold * 100);
            const progress = Math.round(
                (Object.keys(adLearner.patterns.keywords).length +
                Object.keys(adLearner.patterns.selectors).length +
                Object.keys(adLearner.patterns.domains).length) / 3
            );
            
            confidenceEl.textContent = confidence + '%';
            progressEl.style.width = Math.min(100, progress) + '%';
        }
        
        updateUI();
        updateExclusionsList();
    }

    // 建立現代化 UI
    function createModernUI() {
        // 創建懸浮按鈕
        const fab = document.createElement('div');
        fab.id = IDs.FAB;
        fab.innerHTML = `<div style="font-size:24px">🧠</div>`;
        fab.title = "智慧廣告攔截器";
        fab.onclick = () => togglePopup(true);
        document.body.appendChild(fab);

        // 創建彈出視窗遮罩
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) togglePopup(false);
        };
        document.body.appendChild(overlay);

        // 創建彈出視窗
        const popup = document.createElement('div');
        popup.className = 'popup-window';
        popup.innerHTML = `
            <div class="popup-header">
                <div class="popup-title">
                    <span style="font-size:24px">🧠</span>
                    智慧廣告攔截器
                </div>
                <button class="popup-close" onclick="togglePopup(false)">×</button>
            </div>

            <div class="popup-section">
                <div class="popup-section-title">
                    <span style="font-size:18px">📊</span>
                    運行狀態
                </div>
                <div class="stat-grid">
                    <div class="stat-item">
                        <div class="stat-value" id="${IDs.BADGE}">0</div>
                        <div class="stat-label">已封鎖廣告</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="${IDs.RULE_COUNT}">0</div>
                        <div class="stat-label">學習規則數</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="confidence-value">0%</div>
                        <div class="stat-label">系統置信度</div>
                    </div>
                </div>
            </div>

            <div class="popup-section">
                <div class="popup-section-title">
                    <span style="font-size:18px">🎯</span>
                    智能學習
                </div>
                <div style="margin-bottom:16px">
                    <label class="switch">
                        <input type="checkbox" id="${IDs.TOGGLE}">
                        <span class="slider"></span>
                    </label>
                    <span style="margin-left:8px">啟用啟發式學習</span>
                </div>
                <div class="learning-progress">
                    <div class="learning-progress-bar" id="learning-progress" style="width:0%"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#666">
                    <span>初始學習</span>
                    <span>完整訓練</span>
                </div>
            </div>

            <div class="popup-section">
                <div class="popup-section-title">
                    <span style="font-size:18px">🤖</span>
                    智能學習
                </div>
                <div style="margin-bottom:16px">
                    <label class="switch">
                        <input type="checkbox" id="${IDs.TOGGLE}">
                        <span class="slider"></span>
                    </label>
                    <span style="margin-left:8px">啟用智能學習</span>
                </div>
                <div id="${IDs.REVIEW}" style="display:none" class="action-btn">
                    🔍 審核待確認項目 (0)
                </div>
                <div style="font-size:12px;color:#666;margin-top:8px;padding:8px;background:#f8f9fa;border-radius:6px">
                    智能學習系統會自動識別和標記可疑的廣告元素，等待您的確認。
                </div>
            </div>

            <div class="popup-section">
                <div class="popup-section-title">
                    <span style="font-size:18px">⚙️</span>
                    進階功能
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <button id="${IDs.BLOCK}" class="action-btn">
                        🎯 手動選擇
                    </button>
                    <button id="${IDs.ADD_EXCLUSION}" class="action-btn" style="background:#3498db">
                        ⭐ 添加排除
                    </button>
                </div>
            </div>

            <div class="popup-section">
                <div class="popup-section-title">
                    <span style="font-size:18px">🔄</span>
                    數據管理
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    <button class="action-btn" data-action="export">
                        📤 匯出規則
                    </button>
                    <button class="action-btn" data-action="import">
                        📥 匯入規則
                    </button>
                    <button class="action-btn" data-action="sync">
                        ☁️ 同步數據
                    </button>
                    <button class="action-btn danger-btn" data-action="clear">
                        🗑️ 清空數據
                    </button>
                </div>
            </div>

            <div id="${IDs.EXCLUSIONS}" style="margin-top:16px">
            </div>
        `;
        document.body.appendChild(popup);

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

        // 智能學習開關事件綁定
        const toggleCheckbox = document.getElementById(IDs.TOGGLE);
        if (toggleCheckbox) {
            toggleCheckbox.checked = state.siteSettings[location.hostname]?.heuristic || false;
            toggleCheckbox.onchange = e => {
                const host = location.hostname;
                state.siteSettings[host] = state.siteSettings[host] || {};
                state.siteSettings[host].heuristic = e.target.checked;
                GM_setValue("siteSettings", state.siteSettings);
                
                if (e.target.checked) {
                    showNotification('已開啟智能學習模式', 'success');
                    enhancedHeuristicScan();
                } else {
                    showNotification('已關閉智能學習模式', 'info');
                }
                
                // 更新審核按鈕狀態
                updateReviewButton();
            };
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

        // 框選功能
    function startSelectionMode() {
        const ui = document.getElementById(IDs.UI);
        const popup = document.querySelector('.popup-window');
        let overlay, selectionBox, targetHighlight;
        let startX, startY;
        let isSelecting = false;

        // 隱藏 UI 和彈出視窗
        if (ui) ui.style.display = 'none';
        if (popup) {
            popup.style.display = 'none';
            document.querySelector('.popup-overlay').style.display = 'none';
        }

        // 創建選擇層
        overlay = document.createElement('div');
        overlay.className = 'selection-overlay';
        document.body.appendChild(overlay);
        overlay.style.display = 'block';

        showNotification('請拖曳選擇要封鎖的區域', 'info', 10000);

        function createSelectionBox(x, y) {
            selectionBox = document.createElement('div');
            selectionBox.className = 'selection-box';
            selectionBox.style.left = x + 'px';
            selectionBox.style.top = y + 'px';
            overlay.appendChild(selectionBox);
        }

        function updateSelectionBox(e) {
            if (!isSelecting) return;
            
            const currentX = e.clientX;
            const currentY = e.clientY;
            
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);
            const left = Math.min(currentX, startX);
            const top = Math.min(currentY, startY);
            
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';

            // 高亮顯示框選區域內的元素
            const elements = document.elementsFromPoint(currentX, currentY);
            elements.forEach(el => {
                if (el !== overlay && el !== selectionBox && !el.closest(`#${IDs.UI}`)) {
                    const rect = el.getBoundingClientRect();
                    if (!targetHighlight) {
                        targetHighlight = document.createElement('div');
                        targetHighlight.className = 'selection-target';
                        overlay.appendChild(targetHighlight);
                    }
                    targetHighlight.style.left = rect.left + 'px';
                    targetHighlight.style.top = rect.top + 'px';
                    targetHighlight.style.width = rect.width + 'px';
                    targetHighlight.style.height = rect.height + 'px';
                }
            });
        }

        function endSelection(e) {
            if (!isSelecting) return;
            isSelecting = false;

            const endX = e.clientX;
            const endY = e.clientY;
            const selectedArea = {
                left: Math.min(startX, endX),
                top: Math.min(startY, endY),
                right: Math.max(startX, endX),
                bottom: Math.max(startY, endY)
            };

            // 找出框選區域內的所有元素
            const elements = [];
            document.elementsFromPoint(
                (selectedArea.left + selectedArea.right) / 2,
                (selectedArea.top + selectedArea.bottom) / 2
            ).forEach(el => {
                if (el !== overlay && el !== selectionBox && !el.closest(`#${IDs.UI}`)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.left < selectedArea.right &&
                        rect.right > selectedArea.left &&
                        rect.top < selectedArea.bottom &&
                        rect.bottom > selectedArea.top) {
                        elements.push(el);
                    }
                }
            });

            // 封鎖選中的元素
            elements.forEach(el => {
                const selector = getSmartSelector(el);
                if (selector && !state.rules.includes(selector)) {
                    state.rules.push(selector);
                    GM_setValue("rules", state.rules);
                    blockElement(el, selector);
                    addToUndoStack({
                        type: 'block',
                        selector: selector,
                        timestamp: Date.now()
                    });
                }
            });

            if (elements.length > 0) {
                showNotification(`已封鎖 ${elements.length} 個元素`, 'success');
            }

            // 清理
            overlay.remove();
            if (ui) ui.style.display = 'block';
            document.removeEventListener('mousemove', updateSelectionBox);
            document.removeEventListener('mouseup', endSelection);
        }

        overlay.addEventListener('mousedown', e => {
            startX = e.clientX;
            startY = e.clientY;
            isSelecting = true;
            createSelectionBox(startX, startY);
            document.addEventListener('mousemove', updateSelectionBox);
            document.addEventListener('mouseup', endSelection);
        });
    }

    // 手動選擇按鈕事件
    document.getElementById(IDs.BLOCK).onclick = () => {
        const blockModeSelection = document.createElement('div');
        blockModeSelection.style.position = 'fixed';
        blockModeSelection.style.top = '50%';
        blockModeSelection.style.left = '50%';
        blockModeSelection.style.transform = 'translate(-50%, -50%)';
        blockModeSelection.style.background = 'white';
        blockModeSelection.style.padding = '20px';
        blockModeSelection.style.borderRadius = '12px';
        blockModeSelection.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
        blockModeSelection.style.zIndex = '999999';
        blockModeSelection.innerHTML = `
            <h3 style="margin:0 0 16px;font-size:18px">選擇封鎖模式</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <button class="action-btn" id="singleSelect">
                    🎯 單點選擇
                </button>
                <button class="action-btn" id="areaSelect">
                    ⬚ 框選區域
                </button>
            </div>
        `;
        document.body.appendChild(blockModeSelection);

        document.getElementById('singleSelect').onclick = () => {
            blockModeSelection.remove();
            const ui = document.getElementById(IDs.UI);
            const popup = document.querySelector('.popup-window');
            
            document.body.style.cursor = 'crosshair';
            showNotification('請點擊要封鎖的元素', 'info', 10000);
            
            function clickHandler(e) {
                e.preventDefault();
                e.stopPropagation();
                
                const el = e.target;
                if (el.id === IDs.UI || el.closest(`#${IDs.UI}`)) return;
                
                const selector = getSmartSelector(el);
            if (selector) {
                if (!state.rules.includes(selector)) {
                    state.rules.push(selector);
                    GM_setValue("rules", state.rules);
                    blockElement(el, selector);
                    // 添加到復原堆疊
                    addToUndoStack({
                        type: 'block',
                        selector: selector,
                        timestamp: Date.now()
                    });
                    showNotification('已封鎖元素', 'success');
                }
            }                // 恢復 UI 和游標
                document.body.style.cursor = '';
                if (ui) ui.style.display = 'block';
                document.removeEventListener('click', clickHandler, true);
            }
            
            document.addEventListener('click', clickHandler, true);
        };

        makeElementDraggable(ui);
        updateUI();
    }

    // 復原和重做功能
    function addToUndoStack(action) {
        state.undoStack.push(action);
        state.redoStack = []; // 清空重做堆疊
        if (state.undoStack.length > 50) { // 限制堆疊大小
            state.undoStack.shift();
        }
    }

    function undo() {
        if (state.undoStack.length === 0) {
            showNotification('沒有可以復原的操作', 'info');
            return;
        }

        const action = state.undoStack.pop();
        state.redoStack.push(action);

        if (action.type === 'block') {
            // 恢復被封鎖的元素
            const selector = action.selector;
            document.querySelectorAll('.' + IDs.HIDDEN + ', .' + IDs.HEURISTIC).forEach(el => {
                if (getSmartSelector(el) === selector) {
                    el.classList.remove(IDs.HIDDEN, IDs.HEURISTIC);
                    state.blockedCount = Math.max(0, state.blockedCount - 1);
                }
            });
            // 從規則中移除
            state.rules = state.rules.filter(r => r !== selector);
            GM_setValue("rules", state.rules);
        }

        updateUI();
        showNotification('已復原上一個操作', 'success');
    }

    function redo() {
        if (state.redoStack.length === 0) {
            showNotification('沒有可以重做的操作', 'info');
            return;
        }

        const action = state.redoStack.pop();
        state.undoStack.push(action);

        if (action.type === 'block') {
            // 重新封鎖元素
            const selector = action.selector;
            document.querySelectorAll(selector).forEach(el => {
                blockElement(el, selector);
            });
            // 重新添加規則
            if (!state.rules.includes(selector)) {
                state.rules.push(selector);
                GM_setValue("rules", state.rules);
            }
        }

        updateUI();
        showNotification('已重做操作', 'success');
    }

    // 暫停和恢復功能
    function togglePause() {
        state.isPaused = !state.isPaused;
        GM_setValue("isPaused", state.isPaused);
        
        // 更新所有已封鎖元素的可見性
        document.querySelectorAll('.' + IDs.HIDDEN + ', .' + IDs.HEURISTIC).forEach(el => {
            el.style.display = state.isPaused ? '' : 'none';
        });
        
        showNotification(
            state.isPaused ? '已暫停廣告封鎖' : '已恢復廣告封鎖',
            state.isPaused ? 'warning' : 'success'
        );
        
        updateUI();
    }

    // 初始化
    function initialize() {
        // 註冊 Tampermonkey 選單
        GM_registerMenuCommand('⏪ 復原上一個操作', undo);
        GM_registerMenuCommand('⏩ 重做上一個操作', redo);
        GM_registerMenuCommand(
            state.isPaused ? '▶️ 恢復廣告封鎖' : '⏸️ 暫停廣告封鎖',
            togglePause
        );

        createModernUI();
        
        const observer = new MutationObserver(mutations => {
            if (state.isPaused) return; // 暫停狀態下不處理
            
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
            if (!state.isPaused) {
                applyRules();
                enhancedHeuristicScan();
            }
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