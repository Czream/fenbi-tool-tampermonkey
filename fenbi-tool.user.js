// ==UserScript==
// @name         fb复盘优化4.5
// @namespace    http://tampermonkey.net/
// @version      4.5
// @description  粉笔题库解析增强：优化布局-感谢龙龙dragon、评论区获取、用时统计（专项按5题分组/试卷按模块统计）、自定义范围统计，修复试卷模式识别延迟
// @author       creamz
// @supportURL   mailto:czream0519@163.com
// @match        https://*.fenbi.com/*
// @connect      tiku.fenbi.com
// @connect      ke.fenbi.com
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @lastUpdated  2026-08-23
// ==/UserScript==

/*
 * 最后更新时间：2026-08-23
 * 更新说明：性能优化与修复试卷模式识别延迟问题
 * 作者：creamz
 * 问题反馈邮箱：czream0519@163.com
 */

GM_addStyle(`
    .analysis, .parse, .explanation, .specific-unwanted-element, div.member-container.ng-star-inserted { display: none !important; }
    app-result-common section[id^="section-video-"] { display: none !important; }
    app-result-common section[id^="section-keypoint-"] { display: none !important; }
    .floating-ad, .vip-promotion { opacity: 0 !important; height: 0 !important; padding: 0 !important; }
    app-solution-overall {
        padding: 12px 8px !important;
        margin-bottom: 16px !important;
        border-radius: 8px;
        background: #f7f9fc;
    }
`);

// ========== 配置区 ==========
const TIMING_CONFIG = {
    groupSize: 5,
    startQuestionNo: null,
    endQuestionNo: null,
    useDOMOrder: true
};
// ===========================

class FenbiPaperTool {
    constructor() {
        this.state = {
            expandAll: false,
            buttonsWithActive: [],
            questionIds: {},
            episodeMap: {},
            commentExpanded: {},
            questionCosts: {},
            questionCostsFromDOM: {},
            isPaperMode: null,          // 初始未知
            chapterList: [],
            commentsInitialized: false,
            commentStyleInjected: false
        };
        this.bindMethods();
        this.init();
    }

    bindMethods() {
        this.log = this.log.bind(this);
        this.pollForValue = this.pollForValue.bind(this);
        this.processSolutionSection = this.processSolutionSection.bind(this);
        this.createSvgButton = this.createSvgButton.bind(this);
        this.renderComments = this.renderComments.bind(this);
        this.fetchTargetSections = this.fetchTargetSections.bind(this);
        this.toggleComments = this.toggleComments.bind(this);
        this.handleExpandAllClick = this.handleExpandAllClick.bind(this);
        this.handleToggleButtonClick = this.handleToggleButtonClick.bind(this);
        this.hookRequest = this.hookRequest.bind(this);
        this.extractTimeCost = this.extractTimeCost.bind(this);
        this.extractQuestionNo = this.extractQuestionNo.bind(this);
        this.extractTimeFromDOM = this.extractTimeFromDOM.bind(this);
        this.extractChaptersFromDOM = this.extractChaptersFromDOM.bind(this);
        this.detectMode = this.detectMode.bind(this);
        this.calculateMaterialGroups = this.calculateMaterialGroups.bind(this);
        this.calculateChapterGroups = this.calculateChapterGroups.bind(this);
        this.createTimingButton = this.createTimingButton.bind(this);
        this.createExpandAllButton = this.createExpandAllButton.bind(this);
        this.showTimingPanel = this.showTimingPanel.bind(this);
        this.showQuestionCosts = this.showQuestionCosts.bind(this);
        this.formatTime = this.formatTime.bind(this);
        this.parseChineseTime = this.parseChineseTime.bind(this);
        this.debounce = this.debounce.bind(this);
        this.setupObserver = this.setupObserver.bind(this);
    }

    init() {
        this.hookRequest();
        this.setupToggleButtonMonitor();
        this.log('已启动 v4.5 (修复试卷模式识别延迟)');
        this.pollForValue();
    }

    setupToggleButtonMonitor() {
        document.addEventListener('click', (e) => {
            const toggleButton = e.target.closest('.toggle-btn-active');
            if (toggleButton) this.handleToggleButtonClick(toggleButton);
        });
    }

    log(message, type = 'log', data) {
        if (type === 'log' || type === 'error' || type === 'warn') {
            console[type](`[获取评论区工具] ${message}`, data ?? '');
        }
    }

    debounce(fn, delay = 300) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    hookRequest() {
        if (XMLHttpRequest.prototype._isHooked) return;
        XMLHttpRequest.prototype._isHooked = true;

        const self = this;
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            this._requestMethod = method;
            this._requestUrl = url;
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function (body) {
            const xhr = this;
            const { _requestUrl: url } = xhr;

            if (url && url.includes('/api/gwy/v3/episodes/tiku_episodes_with_multi_type')) {
                const handleResponse = () => {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            if (data && data.data) {
                                self.state.episodeMap = data.data;
                                self.log('✅ 拦截获取到评论前置数据');
                            }
                        } catch (e) {
                            self.log('❌ 解析 episodes 响应失败', 'error', e);
                        }
                    }
                };

                xhr.addEventListener('readystatechange', handleResponse);
                xhr.addEventListener('loadend', () => {
                    xhr.removeEventListener('readystatechange', handleResponse);
                });
            }

            return originalSend.apply(xhr, arguments);
        };
    }

    handleToggleButtonClick(button) {
        const section = button.parentNode.querySelector('section[id^="section-solution-"]');
        if (section) {
            const questionKey = section.id.split('-')[2];
            const commentSection = document.getElementById(`section-comments-${questionKey}`);
            if (commentSection) {
                const toggleBtn = commentSection.querySelector('.solution-title + div');
                if (toggleBtn && !this.state.commentExpanded[questionKey]) {
                    toggleBtn.click();
                }
            }
        }
    }

    httpRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...options,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP错误: ${response.status}`));
                    }
                },
                onerror: (error) => reject(error),
                onabort: () => reject(new Error('请求被中止')),
                timeout: 15000
            });
        });
    }

    async pollForValue() {
        const TARGET_PATH_PREFIXES = ["/ti/exam/solution", "/ti"];
        const currentPath = window.location.pathname;
        if (!TARGET_PATH_PREFIXES.some(prefix => currentPath.startsWith(prefix))) {
            this.log('当前页面不是目标页面，跳过');
            return;
        }

        // 获取题目ID映射
        if (Object.keys(this.state.questionIds).length === 0) {
            this.state.questionIds = await this.getSolution(currentPath.split('/')[4]);
        }

        // 获取评论前置数据
        if (Object.keys(this.state.episodeMap).length === 0) {
            this.state.episodeMap = await this.getEpisodesByIds();
        }

        this.setupObserver();
    }

    setupObserver() {
        const debouncedCheck = this.debounce(() => {
            // 每次检测模式，确保准确
            this.detectMode();

            // 提取用时数据
            this.extractTimeFromDOM();

            // 如果已经确认是试卷模式，则提取章节信息
            if (this.state.isPaperMode === true) {
                this.extractChaptersFromDOM();
            }

            // 初始化评论区（仅一次）
            if (!this.state.commentsInitialized) {
                const targetSections = this.fetchTargetSections();
                if (targetSections.length > 0) {
                    targetSections.forEach(section => this.processSolutionSection(section));
                    this.state.commentsInitialized = true;
                }
            }

            // 确保按钮已创建
            if (!document.getElementById('fenbi-timing-btn')) {
                this.createTimingButton();
                this.createExpandAllButton();
            }
        }, 300);

        const observer = new MutationObserver(debouncedCheck);
        observer.observe(document.body, { childList: true, subtree: true });

        // 立即执行一次
        debouncedCheck();
    }

    detectMode() {
        const headerTitle = document.querySelector('.header-title');
        if (headerTitle) {
            const text = headerTitle.getAttribute('title') || headerTitle.textContent || '';
            const newMode = !text.startsWith('专项智能练习');
            if (this.state.isPaperMode !== newMode) {
                this.state.isPaperMode = newMode;
                this.log(`模式更新为：${newMode ? '试卷' : '专项练习'}`);
                // 如果切换为试卷模式，立即尝试提取章节
                if (newMode) {
                    this.extractChaptersFromDOM();
                }
            }
        } else {
            // 标题尚未加载，保持现状；如果之前未知，则记录等待
            if (this.state.isPaperMode === null) {
                this.log('等待页面标题加载...', 'warn');
            }
        }
    }

    extractTimeFromDOM() {
        const containers = document.querySelectorAll('.question-overall-container');
        if (containers.length === 0) return;

        const result = {};
        containers.forEach((container, index) => {
            const timeEl = container.querySelector('.answer-time');
            if (timeEl) {
                const text = timeEl.textContent.trim();
                const seconds = this.parseChineseTime(text);
                result[index] = seconds !== null ? seconds : 0;
            } else {
                result[index] = 0;
            }
        });

        if (Object.keys(result).length > 0) {
            this.state.questionCosts = result;
            this.state.questionCostsFromDOM = result;
            this.log(`✅ 用时提取成功：共 ${containers.length} 题`);
        }
    }

    extractChaptersFromDOM() {
        const chapterContainers = document.querySelectorAll('.chapter-container');
        if (chapterContainers.length === 0) return;

        const chapters = [];
        chapterContainers.forEach(container => {
            const nameEl = container.querySelector('.chapter-name');
            const numEl = container.querySelector('.chapter-num');
            const name = nameEl ? nameEl.textContent.trim().replace(/\s+/g, '') : '';
            const numText = numEl ? numEl.textContent.trim() : '';
            const countMatch = numText.match(/(\d+)/);
            const count = countMatch ? parseInt(countMatch[1], 10) : 0;
            if (name && count > 0) {
                chapters.push({ name, count });
            }
        });

        if (chapters.length > 0) {
            this.state.chapterList = chapters;
            this.log(`✅ 模块提取成功：共 ${chapters.length} 个模块`);
        }
    }

    parseChineseTime(text) {
        if (!text) return null;
        text = text.replace(/\s/g, '');
        let totalSeconds = 0;
        const hourMatch = text.match(/(\d+)\s*小时/);
        const minuteMatch = text.match(/(\d+)\s*分/);
        const secondMatch = text.match(/(\d+)\s*秒/);
        if (hourMatch) totalSeconds += parseInt(hourMatch[1]) * 3600;
        if (minuteMatch) totalSeconds += parseInt(minuteMatch[1]) * 60;
        if (secondMatch) totalSeconds += parseInt(secondMatch[1]);
        if (!hourMatch && !minuteMatch && !secondMatch) {
            const num = parseFloat(text);
            if (!isNaN(num)) return num;
            return null;
        }
        return totalSeconds;
    }

    async getSolution(exerciseKey) {
        try {
            const response = await this.httpRequest({
                url: `https://tiku.fenbi.com/combine/exercise/getSolution?format=html&key=${exerciseKey}&routecs=xingce&kav=121&av=121&hav=121&app=web`,
                method: 'GET',
                headers: {
                    'Cookie': document.cookie,
                    'Referer': `https://tiku.fenbi.com/xingce/`,
                    'User-Agent': navigator.userAgent
                }
            });
            const data = JSON.parse(response);
            const resultObj = {};
            if (data.data?.userAnswers) {
                Object.entries(data.data.userAnswers).forEach(([prop, raw]) => {
                    const { key, id, prefix } = raw || {};
                    resultObj[prop] = { key, id, prefix };
                });
                this.log(`✅ 获取到 ${Object.keys(resultObj).length} 个题目ID映射`);
            } else {
                this.log('⚠️ getSolution 返回数据中缺少 userAnswers', 'warn');
            }
            return resultObj;
        } catch (error) {
            this.log(`❌ 获取题目失败：${error.message}`, 'error');
            return {};
        }
    }

    async getEpisodesByIds() {
        function extractIds(obj) {
            return Object.values(obj)
                .filter(item => Object.keys(item).length > 0)
                .map(item => item.id);
        }
        const questionIds = extractIds(this.state.questionIds);
        if (questionIds.length === 0) {
            this.log('没有可用的题目ID，无法获取评论前置数据', 'warn');
            return {};
        }
        try {
            const result = await this.httpRequest({
                url: `https://ke.fenbi.com/api/gwy/v3/episodes/tiku_episodes_with_multi_type?tiku_ids=${questionIds.join(',')}&tiku_prefix=xingce&tiku_type=5`,
                method: "GET",
                headers: {
                    'Cookie': document.cookie,
                    'Referer': 'https://ke.fenbi.com/gwy/',
                    'User-Agent': navigator.userAgent
                }
            });
            const data = JSON.parse(result);
            if (data && data.data) {
                this.log('✅ 主动获取评论前置数据成功');
                return data.data;
            }
            this.log('⚠️ 评论前置数据为空', 'warn');
            return {};
        } catch (error) {
            this.log(`❌ 获取评论前置数据失败：${error.message}`, 'error');
            return {};
        }
    }

    createSvgButton(expanded = false) {
        const svgContainer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgContainer.setAttribute("width", "40");
        svgContainer.setAttribute("height", "40");
        svgContainer.setAttribute("viewBox", "0 0 40 40");
        svgContainer.style.cursor = "pointer";

        const clickArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        clickArea.setAttribute("width", "40");
        clickArea.setAttribute("height", "40");
        clickArea.setAttribute("fill", "transparent");
        svgContainer.appendChild(clickArea);

        const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bgRect.setAttribute("x", "2");
        bgRect.setAttribute("y", "2");
        bgRect.setAttribute("width", "36");
        bgRect.setAttribute("height", "36");
        bgRect.setAttribute("rx", "6");
        bgRect.setAttribute("ry", "6");
        bgRect.style.fill = "#ffffffff";
        bgRect.style.stroke = "#0056b3";
        bgRect.style.strokeWidth = "1";

        const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const d = expanded ? "M12 22l8-8 8 8" : "M12 18l8 8 8-8";
        arrowPath.setAttribute("d", d);
        arrowPath.setAttribute("stroke", "black");
        arrowPath.setAttribute("stroke-width", "2");
        arrowPath.setAttribute("stroke-linecap", "round");
        arrowPath.setAttribute("stroke-linejoin", "round");
        arrowPath.setAttribute("fill", "none");

        svgContainer.appendChild(bgRect);
        svgContainer.appendChild(arrowPath);

        svgContainer.addEventListener('click', () => {
            const newState = !expanded;
            const newD = newState ? "M12 18l8 8 8-8" : "M12 22l8-8 8 8";
            arrowPath.setAttribute("d", newD);
        });

        return svgContainer;
    }

    processSolutionSection(solutionSection) {
        const sectionId = solutionSection.id;
        const questionKey = sectionId.split('-')[2];
        const videoElements = solutionSection.parentNode.querySelector(`[id="section-video-${questionKey}"]`);
        if (!videoElements) return;

        this.state.commentExpanded[questionKey] = false;

        const newSection = solutionSection.cloneNode(true);
        newSection.id = `section-comments-${questionKey}`;

        const titleElement = newSection.querySelector('.solution-title');
        if (titleElement) {
            titleElement.textContent = '评论区';
            titleElement.parentNode.style.display = 'flex';
            titleElement.style.flex = 1;
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cursor = 'pointer';
            buttonContainer.title = '展开评论';
            buttonContainer.dataset.questionKey = questionKey;
            buttonContainer.appendChild(this.createSvgButton(false));
            buttonContainer.addEventListener('click', () => {
                const contentContainer = newSection.querySelector('.content');
                this.toggleComments(questionKey, contentContainer, buttonContainer);
            });
            titleElement.parentNode.insertBefore(buttonContainer, titleElement.nextSibling);
        }

        const contentContainer = newSection.querySelector('.content');
        if (contentContainer) contentContainer.innerHTML = '';

        solutionSection.parentNode.insertBefore(newSection, solutionSection.nextSibling);

        const button = solutionSection.parentNode.querySelector('.toggle-btn:not(.toggle-btn-active)');
        if (button) {
            const commentSection = document.getElementById(`section-comments-${questionKey}`);
            if (commentSection) {
                const toggleBtn = commentSection.querySelector('.solution-title + div');
                if (toggleBtn && !this.state.commentExpanded[questionKey]) {
                    toggleBtn.click();
                }
            }
        }
    }

    handleExpandAllClick() {
        this.state.expandAll = !this.state.expandAll;
        this.log(`全部展开状态切换为: ${this.state.expandAll ? '展开' : '收起'}`);

        const targetSections = this.fetchTargetSections();
        targetSections.forEach(section => {
            const questionKey = section.id.split('-')[2];
            let currentActiveBtn = section.parentNode.querySelector('.toggle-btn-active');
            if (currentActiveBtn) {
                if (!this.state.buttonsWithActive.includes(currentActiveBtn)) {
                    this.state.buttonsWithActive[questionKey] = currentActiveBtn;
                }
            } else {
                if (this.state.buttonsWithActive[questionKey]) {
                    currentActiveBtn = this.state.buttonsWithActive[questionKey];
                } else {
                    currentActiveBtn = this.state.expandAll == false && section.parentNode.querySelector('.toggle-btn:not(.toggle-btn-active)');
                }
            }
            if (currentActiveBtn) currentActiveBtn.click();

            const commentSection = document.getElementById(`section-comments-${questionKey}`);
            if (commentSection && this.state.expandAll != this.state.commentExpanded[questionKey]) {
                const toggleBtn = commentSection.querySelector('.solution-title + div');
                if (toggleBtn) toggleBtn.click();
            }
        });

        const expandAllBtn = document.getElementById('fenbi-expand-all-btn');
        if (expandAllBtn) expandAllBtn.textContent = this.state.expandAll ? '全部收起' : '全部展开';
    }

    toggleComments(questionKey, contentContainer, buttonContainer) {
        const isExpanded = this.state.commentExpanded[questionKey];
        if (!isExpanded) {
            contentContainer.innerHTML = '<div class="loading" style="color: #666; padding: 10px;">加载中...</div>';
            const questionId = this.state.questionIds[questionKey]?.id;
            const value = this.state.episodeMap[questionId] ?? {};
            this.getComments(value[0]?.id ?? 0).then(commentRawDatas => {
                const comments = [];
                for (const prop in commentRawDatas) {
                    if (Object.hasOwn(commentRawDatas, prop)) {
                        const { comment, likeCount } = commentRawDatas[prop];
                        comments.push({ comment, likeCount });
                    }
                }
                this.renderComments(contentContainer, comments);
                this.state.commentExpanded[questionKey] = true;
                buttonContainer.innerHTML = '';
                buttonContainer.appendChild(this.createSvgButton(true));
                buttonContainer.title = '收起评论';
            }).catch(error => {
                contentContainer.innerHTML = '<div class="error" style="color: #dc3545; padding: 10px;">加载评论失败</div>';
                this.log('加载评论失败:', 'error', error);
            });
        } else {
            contentContainer.innerHTML = '';
            this.state.commentExpanded[questionKey] = false;
            buttonContainer.innerHTML = '';
            buttonContainer.appendChild(this.createSvgButton(false));
            buttonContainer.title = '展开评论';
        }
    }

    async getComments(episodeId) {
        try {
            if (episodeId === 0) return [];
            const str = await this.httpRequest({
                url: `https://ke.fenbi.com/ipad/gwy/v3/comments/episodes/${episodeId}?system=12.4.7&inhouse=0&app=gwy&ua=iPad&av=44&version=6.11.3&kav=22&kav=1&len=600`,
                method: "GET",
                headers: {
                    'Cookie': document.cookie,
                    'Referer': `https://tiku.fenbi.com/xingce/`,
                    'User-Agent': navigator.userAgent
                }
            });
            let processedDatas = [];
            try {
                const obj = JSON.parse(str);
                if (Array.isArray(obj.datas)) processedDatas.push(...obj.datas);
            } catch (error) {
                this.log('JSON解析失败:', 'error', error);
            }
            return processedDatas
                .filter(i => i.likeCount > 1 && !['?', '？'].some(t => i.comment.includes(t)) && i.comment.length > 8)
                .sort((a, b) => b.likeCount - a.likeCount)
                .slice(0, 10);
        } catch (e) {
            this.log('获取评论失败:', 'error', e);
            return [];
        }
    }

    renderComments(container, comments) {
        if (!this.state.commentStyleInjected) {
            const style = document.createElement('style');
            style.id = 'fenbi-comment-style';
            style.textContent = `
                .no-comments { color: #666; padding: 20px; text-align: center; background-color: #f9f9f9; border-radius: 8px; font-size: 14px; }
                .comments-list { display: flex; flex-direction: column; gap: 12px; }
                .comment-item { background: #fff; display: flex; align-items: center; justify-content: space-between; padding: 10px 15px; border-radius: 8px; border: 1px solid #eee; transition: all 0.2s ease; }
                .comment-item:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
                .comment-content { color: #444; line-height: 1.5; margin-bottom: 10px; font-size: 18px; flex: 1; margin-right: 10px; }
                .comment-like { display: flex; align-items: center; gap: 5px; cursor: pointer; transition: color 0.2s ease; }
                .comment-like:hover { color: #007bff; }
                .like-icon .like-count { font-size: 14px; }
            `;
            document.head.appendChild(style);
            this.state.commentStyleInjected = true;
        }

        if (!comments || comments.length === 0) {
            container.innerHTML = '<div class="no-comments">暂无评论</div>';
            return;
        }

        let html = '<div class="comments-list">';
        comments.forEach(comment => {
            html += `
                <div class="comment-item">
                    <div class="comment-content">${comment.comment}</div>
                    <div class="comment-like">
                        <span class="like-icon">❤</span>
                        <span class="like-count">${comment.likeCount || 0}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    fetchTargetSections() {
        const allSections = Array.from(document.querySelectorAll('section'));
        return allSections.filter(el =>
            el.classList.contains('result-common-section') &&
            el.id.startsWith('section-solution-') &&
            el.classList.contains('ng-star-inserted') &&
            !el.classList.contains('chapter-container')
        );
    }

    calculateMaterialGroups() {
        const { questionCosts } = this.state;
        if (!questionCosts || Object.keys(questionCosts).length === 0) return [];

        let entries = Object.entries(questionCosts)
            .map(([key, cost]) => ({
                index: parseInt(key, 10),
                cost: Number(cost) || 0
            }))
            .sort((a, b) => a.index - b.index);

        const groups = [];
        const groupSize = TIMING_CONFIG.groupSize || 5;
        for (let i = 0; i < entries.length; i += groupSize) {
            const slice = entries.slice(i, i + groupSize);
            const totalCost = slice.reduce((sum, item) => sum + item.cost, 0);
            groups.push({
                index: Math.floor(i / groupSize) + 1,
                items: slice,
                totalCost
            });
        }
        return groups;
    }

    calculateChapterGroups() {
        const { questionCosts, chapterList } = this.state;
        if (!questionCosts || Object.keys(questionCosts).length === 0 || chapterList.length === 0) return [];

        const costsArray = Object.entries(questionCosts)
            .map(([key, cost]) => ({ index: parseInt(key, 10), cost: Number(cost) || 0 }))
            .sort((a, b) => a.index - b.index);

        const groups = [];
        let currentIndex = 0;
        for (let i = 0; i < chapterList.length; i++) {
            const { name, count } = chapterList[i];
            const slice = costsArray.slice(currentIndex, currentIndex + count);
            const totalCost = slice.reduce((sum, item) => sum + item.cost, 0);
            groups.push({
                name,
                count,
                items: slice,
                totalCost
            });
            currentIndex += count;
            if (currentIndex > costsArray.length) {
                this.log('警告：章节题数总和超过实际题目数量', 'warn');
                break;
            }
        }
        return groups;
    }

    createTimingButton() {
        if (document.getElementById('fenbi-timing-btn')) return;

        const button = document.createElement('button');
        button.id = 'fenbi-timing-btn';
        button.textContent = '⏱ 用时统计';
        button.style.position = 'fixed';
        button.style.top = '130px';
        button.style.right = '20px';
        button.style.zIndex = '9999';
        button.style.padding = '10px 20px';
        button.style.backgroundColor = '#007bff';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.fontSize = '14px';
        button.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        button.addEventListener('click', () => this.showTimingPanel());
        document.body.appendChild(button);

        const detailBtn = document.createElement('button');
        detailBtn.id = 'fenbi-detail-btn';
        detailBtn.textContent = '📋 每题用时';
        detailBtn.style.position = 'fixed';
        detailBtn.style.top = '130px';
        detailBtn.style.left = '20px';
        detailBtn.style.zIndex = '9999';
        detailBtn.style.padding = '10px 20px';
        detailBtn.style.backgroundColor = '#17a2b8';
        detailBtn.style.color = 'white';
        detailBtn.style.border = 'none';
        detailBtn.style.borderRadius = '4px';
        detailBtn.style.cursor = 'pointer';
        detailBtn.style.fontSize = '14px';
        detailBtn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        detailBtn.addEventListener('click', () => this.showQuestionCosts());
        document.body.appendChild(detailBtn);
    }

    createExpandAllButton() {
        if (document.getElementById('fenbi-expand-all-btn')) return;
        const button = document.createElement('button');
        button.id = 'fenbi-expand-all-btn';
        button.textContent = this.state.expandAll ? '全部收起' : '全部展开';
        button.style.position = 'fixed';
        button.style.top = '80px';
        button.style.right = '20px';
        button.style.zIndex = '9999';
        button.style.padding = '10px 20px';
        button.style.backgroundColor = '#4CAF50';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.fontSize = '14px';
        button.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        button.addEventListener('click', this.handleExpandAllClick);
        document.body.appendChild(button);
    }

    showTimingPanel() {
        const oldPanel = document.getElementById('fenbi-timing-panel');
        if (oldPanel) {
            oldPanel.remove();
            return;
        }

        // 确保模式已检测
        this.detectMode();

        let groups;
        let tableTitle;

        if (this.state.isPaperMode) {
            // 试卷模式：再次尝试提取章节
            if (this.state.chapterList.length === 0) {
                this.extractChaptersFromDOM();
            }
            if (this.state.chapterList.length === 0) {
                alert('模块信息未加载，暂时按每5题显示');
                groups = this.calculateMaterialGroups();
                tableTitle = '试卷用时统计（按5题分组）';
            } else {
                groups = this.calculateChapterGroups();
                tableTitle = '试卷各模块用时统计';
            }
        } else {
            groups = this.calculateMaterialGroups();
            tableTitle = '用时统计（每5题）';
        }

        if (!groups || groups.length === 0) {
            alert('暂无用时数据，请等待页面加载完成后重试');
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'fenbi-timing-panel';
        panel.style.cssText = `
            position: fixed; top: 80px; right: 70px; z-index: 10000;
            background: #fff; border: 1px solid #ccc; border-radius: 8px;
            padding: 15px; max-height: 80vh; overflow: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 350px;
        `;

        let html = `<h3 style="margin-top:0">${tableTitle}</h3>`;
        html += '<table style="border-collapse:collapse; width:100%; font-size:14px;">';
        html += '<tr style="background:#f2f2f2"><th style="padding:8px; border:1px solid #ddd">模块</th><th style="padding:8px; border:1px solid #ddd">题目范围</th><th style="padding:8px; border:1px solid #ddd">总用时</th></tr>';

        groups.forEach((group, idx) => {
            let range = '';
            if (group.items && group.items.length > 0) {
                const firstIndex = group.items[0].index + 1;
                const lastIndex = group.items[group.items.length - 1].index + 1;
                range = `${firstIndex}-${lastIndex}`;
            }
            const displayName = group.name || `第${idx+1}篇`;
            html += `<tr>
                <td style="padding:8px; border:1px solid #ddd">${displayName}</td>
                <td style="padding:8px; border:1px solid #ddd">${range}</td>
                <td style="padding:8px; border:1px solid #ddd">${this.formatTime(group.totalCost)}</td>
            </tr>`;
        });

        const totalCost = groups.reduce((sum, g) => sum + g.totalCost, 0);
        const totalQuestions = groups.reduce((sum, g) => sum + (g.items?.length || 0), 0);
        html += `<tr style="background:#f9f9f9; font-weight:bold">
            <td style="padding:8px; border:1px solid #ddd">合计</td>
            <td style="padding:8px; border:1px solid #ddd">${totalQuestions}题</td>
            <td style="padding:8px; border:1px solid #ddd">${this.formatTime(totalCost)}</td>
        </tr></table>`;

        html += `
            <div style="margin-top:15px; border-top:1px solid #eee; padding-top:10px;">
                <h4 style="margin:0 0 10px 0; font-size:15px;">自定义范围统计</h4>
                <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                    <span>从第</span>
                    <input type="number" id="custom-start" placeholder="起始题号" min="1" style="width:80px; padding:5px; border:1px solid #ccc; border-radius:4px;">
                    <span>题到第</span>
                    <input type="number" id="custom-end" placeholder="结束题号" min="1" style="width:80px; padding:5px; border:1px solid #ccc; border-radius:4px;">
                    <button id="custom-calc-btn" style="padding:5px 12px; cursor:pointer; background:#28a745; color:white; border:none; border-radius:4px;">计算</button>
                </div>
                <div id="custom-result" style="margin-top:10px; font-weight:bold; color:#d9534f;"></div>
            </div>`;

        panel.innerHTML = html;
        document.body.appendChild(panel);

        const calcBtn = document.getElementById('custom-calc-btn');
        const resultDiv = document.getElementById('custom-result');
        if (calcBtn) {
            calcBtn.addEventListener('click', () => {
                const startInput = document.getElementById('custom-start');
                const endInput = document.getElementById('custom-end');
                const start = parseInt(startInput?.value, 10);
                const end = parseInt(endInput?.value, 10);

                if (isNaN(start) || isNaN(end)) {
                    resultDiv.textContent = '⚠️ 请输入有效的起始和结束题号';
                    return;
                }
                if (start < 1 || end < 1) {
                    resultDiv.textContent = '⚠️ 题号必须大于等于 1';
                    return;
                }
                if (start > end) {
                    resultDiv.textContent = '⚠️ 起始题号不能大于结束题号';
                    return;
                }

                const { questionCosts } = this.state;
                const keys = Object.keys(questionCosts);
                const maxIndex = keys.length > 0 ? Math.max(...keys.map(Number)) : -1;
                if (maxIndex < 0) {
                    resultDiv.textContent = '⚠️ 暂无用时数据';
                    return;
                }

                const startIndex = start - 1;
                const endIndex = end - 1;

                if (startIndex > maxIndex || endIndex > maxIndex) {
                    resultDiv.textContent = `⚠️ 题号超出范围（共 ${maxIndex + 1} 题）`;
                    return;
                }

                let totalSeconds = 0;
                let count = 0;
                for (let i = startIndex; i <= endIndex; i++) {
                    if (questionCosts.hasOwnProperty(i)) {
                        totalSeconds += questionCosts[i];
                        count++;
                    }
                }

                if (count === 0) {
                    resultDiv.textContent = '⚠️ 所选范围内没有找到用时数据';
                } else {
                    resultDiv.textContent = `✅ 第${start}题至第${end}题总用时：${this.formatTime(totalSeconds)}（共${count}题）`;
                }
            });
        }
    }

    showQuestionCosts() {
        const oldPanel = document.getElementById('fenbi-detail-panel');
        if (oldPanel) {
            oldPanel.remove();
            return;
        }

        const { questionCosts } = this.state;
        if (!questionCosts || Object.keys(questionCosts).length === 0) {
            alert('暂无用时数据');
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'fenbi-detail-panel';
        panel.style.cssText = `
            position: fixed; top: 80px; left: 70px; z-index: 10000;
            background: #fff; border: 1px solid #ccc; border-radius: 8px;
            padding: 15px; max-height: 80vh; overflow: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2); min-width: 300px;
        `;

        let html = '<h3 style="margin-top:0">每题用时明细</h3><table style="border-collapse:collapse; width:100%; font-size:14px;">';
        html += '<tr style="background:#f2f2f2"><th style="padding:8px; border:1px solid #ddd">题序</th><th style="padding:8px; border:1px solid #ddd">用时</th></tr>';

        const entries = Object.entries(questionCosts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        entries.forEach(([key, cost]) => {
            const displayKey = `第${parseInt(key)+1}题`;
            html += `<tr><td style="padding:8px; border:1px solid #ddd">${displayKey}</td><td style="padding:8px; border:1px solid #ddd">${this.formatTime(cost)}</td></tr>`;
        });

        html += '</table>';
        panel.innerHTML = html;
        document.body.appendChild(panel);
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0秒';
        const totalSeconds = Math.round(seconds);
        const minutes = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        if (minutes > 0) return `${minutes}分${secs}秒`;
        return `${secs}秒`;
    }

    extractQuestionNo(raw, fallbackKey) {
        if (!raw) return fallbackKey;
        const possibleFields = ['questionNo', 'questionNumber', 'num', 'index', 'order', 'questionIndex', 'sequence'];
        for (const field of possibleFields) {
            const val = raw[field];
            if (val !== undefined && val !== null) return String(val);
        }
        return fallbackKey;
    }

    extractTimeCost(raw) {
        if (!raw) return 0;
        const possibleFields = [
            'cost', 'timeCost', 'elapsedTime', 'spendTime',
            'duration', 'takeTime', 'answerTime', 'time', 'useTime', 'usedTime'
        ];
        for (const field of possibleFields) {
            const val = raw[field];
            if (val === null || val === undefined) continue;
            if (typeof val === 'number') return val > 1000 ? val / 1000 : val;
            if (typeof val === 'string') {
                const num = parseFloat(val);
                if (!isNaN(num) && val.indexOf(':') === -1) return num > 1000 ? num / 1000 : num;
                const parts = val.split(':').map(Number);
                if (parts.length === 2 && parts.every(n => !isNaN(n))) return parts[0] * 60 + parts[1];
                if (parts.length === 3 && parts.every(n => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
        }
        return 0;
    }
}

(function () {
    'use strict';
    new FenbiPaperTool();
})();