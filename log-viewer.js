const { createApp } = Vue;

createApp({
    data() {
        return {
            // 日志数据
            title: '加载中...',
            date: '',
            logs: [],
            chapters: [],
            
            // 设置（完全从JSON导入，不覆盖）
            fontSettings: {},
            systemSettings: {},
            chapterSettings: {},
            channelRules: {},
            characterRules: {},
            defaultChannelRule: {},
            defaultCharacterRule: {},
            extendFormats: {},
            
            // 分页
            currentPage: 1,
            pageSize: 50,
            jumpPage: null,
            totalPages: 1,
            
            // 搜索
            searchQuery: '',
            
            // 界面状态
            sidebarOpen: true,
            showImagePreview: false,
            previewImageUrl: '',
            isLoading: true,
            errorMessage: '',
            
            // 页面背景设置
            pageBackground: '',
            navBackground: '',
            sidebarBackground: ''
        }
    },
    computed: {
        // 总消息数
        totalMessages() {
            return this.logs.length;
        },
        
        // 当前页的起始和结束索引
        startIndex() {
            return (this.currentPage - 1) * this.pageSize;
        },
        
        endIndex() {
            return Math.min(this.startIndex + this.pageSize, this.logs.length);
        },
        
        // 当前页的消息
        paginatedLogs() {
            let filtered = this.logs;
            
            // 应用搜索
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase();
                filtered = filtered.filter(msg => 
                    msg.text.toLowerCase().includes(query) ||
                    msg.name.toLowerCase().includes(query) ||
                    (msg.dice && msg.dice.toLowerCase().includes(query))
                );
            }
            
            return filtered.slice(this.startIndex, this.endIndex);
        },
        
        // 频道分组
        channelGroups() {
            const groups = [];
            let currentGroup = null;
            
            this.paginatedLogs.forEach((msg) => {
                let msgChannel = msg.channel || '默认频道';
                
                // 系统消息处理
                if (msg.name.toLowerCase() === 'system' && !msg.isChapter) {
                    msgChannel = this.getSystemMessageChannel(msg);
                }
                
                // 章节消息
                if (msg.isChapter) {
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    
                    currentGroup = {
                        channel: '系统',
                        messages: [msg]
                    };
                }
                // 新频道组
                else if (!currentGroup || msgChannel !== currentGroup.channel) {
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    
                    currentGroup = {
                        channel: msgChannel,
                        messages: [msg]
                    };
                } else {
                    currentGroup.messages.push(msg);
                }
            });
            
            if (currentGroup) {
                groups.push(currentGroup);
            }
            
            return groups;
        }
    },
    mounted() {
        this.loadLogData();
        this.setupEventListeners();
    },
    methods: {
        // 从URL参数加载日志文件
        async loadLogData() {
            this.isLoading = true;
            this.errorMessage = '';
            
            try {
                const urlParams = new URLSearchParams(window.location.search);
                let logFile = urlParams.get('log');
                
                if (!logFile) {
                    // 如果没有指定，尝试默认路径
                    const cards = document.querySelectorAll('.log-card');
                    if (cards.length > 0) {
                        logFile = cards[0].dataset.logFile;
                    } else {
                        logFile = 'data/log.json';
                    }
                }
                
                console.log('正在加载日志文件:', logFile);
                
                const response = await fetch(logFile);
                if (!response.ok) {
                    throw new Error(`文件加载失败: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('日志数据加载成功', data);
                
                // 设置页面标题
                this.title = data.title || 'TRPG跑团日志';
                document.title = this.title;
                
                // 导入日志数据
                if (Array.isArray(data.logs)) {
                    this.logs = this.processLogArray(data.logs);
                } else if (Array.isArray(data)) {
                    this.logs = this.processLogArray(data);
                } else {
                    throw new Error('日志数据格式不正确');
                }
                
                // 导入所有设置 - 完全按照JSON的，不覆盖
                this.fontSettings = data.fontSettings || {};
                this.systemSettings = data.systemSettings || {};
                this.chapterSettings = data.chapterSettings || {};
                this.channelRules = data.channelRules || {};
                this.characterRules = data.characterRules || {};
                this.defaultChannelRule = data.defaultChannelRule || {};
                this.defaultCharacterRule = data.defaultCharacterRule || {};
                this.extendFormats = data.extendFormats || {};
                
                // 章节数据
                this.chapters = data.chapters || [];
                
                // 如果没有章节数据，从日志中提取
                if (this.chapters.length === 0) {
                    this.extractChaptersFromLogs();
                }
                
                // 计算章节所在的页面
                this.calculateChapterPages();
                
                // 计算总页数
                this.totalPages = Math.ceil(this.logs.length / this.pageSize);
                
                // 应用背景设置（如果JSON中有）
                this.applyBackgroundSettings(data);
                
                this.isLoading = false;
                
            } catch (error) {
                console.error('加载日志失败:', error);
                this.errorMessage = error.message;
                this.isLoading = false;
            }
        },
        
        // 处理日志数组
        processLogArray(logArray) {
            return logArray.map((log, index) => ({
                id: log.id || `msg-${index}`,
                name: log.name || '未知角色',
                text: log.text || '',
                color: log.color || '#000000',
                channel: log.channel || '默认频道',
                icon: log.icon || null, // 没有头像就保持null
                dice: log.dice || null,
                extend: log.extend || null,
                to: log.to || null,
                time: log.time || '',
                messageImage: log.messageImage || null,
                isChapter: log.isChapter || false,
                // 消息级别的设置
                nameUseImage: log.nameUseImage || false,
                nameBackground: log.nameBackground || null,
                nameOpacity: log.nameOpacity,
                nameImage: log.nameImage || '',
                nameImageSize: log.nameImageSize || 'cover',
                nameImageOpacity: log.nameImageOpacity,
                bubbleUseImage: log.bubbleUseImage || false,
                bubbleColor: log.bubbleColor || null,
                bubbleOpacity: log.bubbleOpacity,
                bubbleImage: log.bubbleImage || '',
                bubbleImageSize: log.bubbleImageSize || 'cover',
                bubbleImageOpacity: log.bubbleImageOpacity
            }));
        },
        
        // 从日志中提取章节信息
        extractChaptersFromLogs() {
            const chapters = [];
            
            this.logs.forEach((msg, index) => {
                if (msg.isChapter || 
                    (msg.name === '系统' && 
                     msg.text && 
                     msg.text.startsWith('===') && 
                     msg.text.endsWith('==='))) {
                    
                    const chapterName = msg.text.replace(/===/g, '').trim();
                    
                    chapters.push({
                        id: msg.id || `chapter-${index}`,
                        name: chapterName || `章节 ${chapters.length + 1}`,
                        position: index + 1
                    });
                }
            });
            
            this.chapters = chapters;
        },
        
        // 计算章节所在的页面
        calculateChapterPages() {
            this.chapters.forEach(chapter => {
                const position = chapter.position || 1;
                chapter.page = Math.ceil(position / this.pageSize);
            });
        },
        
        // 应用背景设置
        applyBackgroundSettings(data) {
            // 检查是否有背景设置
            if (data.pageBackground) {
                this.pageBackground = data.pageBackground;
                document.documentElement.style.setProperty('--bg-image', `url(${data.pageBackground})`);
            }
            
            if (data.navBackground) {
                this.navBackground = data.navBackground;
                document.documentElement.style.setProperty('--nav-bg-image', `url(${data.navBackground})`);
            }
            
            if (data.sidebarBackground) {
                this.sidebarBackground = data.sidebarBackground;
                document.documentElement.style.setProperty('--sidebar-bg-image', `url(${data.sidebarBackground})`);
            }
        },
        
        // 获取系统消息频道
        getSystemMessageChannel(msg) {
            if (msg.isChapter) return '系统';
            
            const msgIndex = this.logs.findIndex(log => log.id === msg.id);
            if (msgIndex === -1) return '系统';
            
            // 向前查找最近的非系统消息的频道
            for (let i = msgIndex - 1; i >= 0; i--) {
                const prevMsg = this.logs[i];
                if (prevMsg.name.toLowerCase() === 'system' || prevMsg.isChapter) continue;
                
                return prevMsg.channel || '默认频道';
            }
            
            return '系统';
        },
        
        // 标题样式
        getTitleStyle() {
            const style = {};
            
            if (this.fontSettings.channelName) {
                style.fontFamily = this.fontSettings.channelName;
            }
            if (this.fontSettings.channelNameColor) {
                style.color = this.fontSettings.channelNameColor;
            }
            if (this.fontSettings.channelNameSize) {
                style.fontSize = `${this.fontSettings.channelNameSize}px`;
            }
            
            return style;
        },
        
        // 章节样式
        getChapterStyle(chapterMsg) {
            const style = {};
            
            // 完全按照JSON中的章节设置
            if (this.chapterSettings.fontFamily) {
                style.fontFamily = this.chapterSettings.fontFamily;
            }
            if (this.chapterSettings.color) {
                style.color = this.chapterSettings.color;
            }
            if (this.chapterSettings.fontSize) {
                style.fontSize = `${this.chapterSettings.fontSize}px`;
            }
            if (this.chapterSettings.bold) {
                style.fontWeight = 'bold';
            }
            if (this.chapterSettings.shadow) {
                style.textShadow = '1px 1px 2px rgba(0,0,0,0.3)';
            }
            
            // 背景
            if (this.chapterSettings.useImage && this.chapterSettings.image) {
                const opacity = this.chapterSettings.imageOpacity || 1.0;
                style.backgroundImage = `url(${this.chapterSettings.image})`;
                style.backgroundSize = this.chapterSettings.imageSize || 'cover';
                style.backgroundPosition = 'center';
                style.backgroundRepeat = this.chapterSettings.imageSize === 'repeat' ? 'repeat' : 'no-repeat';
                style.opacity = opacity;
            } else if (this.chapterSettings.backgroundColor) {
                const opacity = this.chapterSettings.backgroundOpacity || 0.9;
                style.backgroundColor = this.hexToRgba(this.chapterSettings.backgroundColor, opacity);
            }
            
            return style;
        },
        
        // 频道背景样式
        getChannelBackgroundStyle(channel) {
            const rule = this.channelRules[channel];
            const style = {};
            
            if (rule) {
                if (rule.useImage && rule.image) {
                    const opacity = rule.imageOpacity !== undefined ? rule.imageOpacity : 1.0;
                    style.backgroundImage = `url(${rule.image})`;
                    style.backgroundSize = rule.imageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = rule.imageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (rule.color) {
                    const opacity = rule.opacity !== undefined ? rule.opacity : 0.1;
                    style.backgroundColor = this.hexToRgba(rule.color, opacity);
                }
            } else if (this.defaultChannelRule.color) {
                const opacity = this.defaultChannelRule.opacity !== undefined ? this.defaultChannelRule.opacity : 0.1;
                style.backgroundColor = this.hexToRgba(this.defaultChannelRule.color, opacity);
            }
            
            return style;
        },
        
        // 频道名字体样式
        getChannelNameStyle(channel) {
            const style = {};
            
            // 使用字体设置
            if (this.fontSettings.channelName) {
                style.fontFamily = this.fontSettings.channelName;
            }
            if (this.fontSettings.channelNameColor) {
                style.color = this.fontSettings.channelNameColor;
            }
            if (this.fontSettings.channelNameSize) {
                style.fontSize = `${this.fontSettings.channelNameSize}px`;
            }
            
            return style;
        },
        
        // 角色名字体样式
        getCharacterNameStyle(characterName) {
            const style = {};
            
            // 使用字体设置
            if (this.fontSettings.characterName) {
                style.fontFamily = this.fontSettings.characterName;
            }
            if (this.fontSettings.characterNameSize) {
                style.fontSize = `${this.fontSettings.characterNameSize}px`;
            }
            
            // 颜色：优先使用角色规则中的颜色
            const rule = this.characterRules[characterName];
            if (rule && rule.nameColor) {
                style.color = rule.nameColor;
            } else {
                // 否则使用消息中的颜色
                const message = this.logs.find(msg => msg.name === characterName);
                if (message && message.color) {
                    style.color = message.color;
                }
            }
            
            return style;
        },
        
        // 角色名背景样式
        getCharacterNameBackgroundStyle(characterName) {
            const rule = this.characterRules[characterName];
            const style = {};
            
            if (rule) {
                if (rule.nameUseImage && rule.nameImage) {
                    const opacity = rule.nameImageOpacity !== undefined ? rule.nameImageOpacity : 1.0;
                    style.backgroundImage = `url(${rule.nameImage})`;
                    style.backgroundSize = rule.nameImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = rule.nameImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (rule.nameBackground) {
                    const opacity = rule.nameOpacity !== undefined ? rule.nameOpacity : 0.85;
                    style.backgroundColor = this.hexToRgba(rule.nameBackground, opacity);
                }
            }
            
            return style;
        },
        
        // 角色气泡背景样式
        getCharacterBubbleBackgroundStyle(characterName) {
            const rule = this.characterRules[characterName];
            const style = {};
            
            if (rule) {
                if (rule.bubbleUseImage && rule.bubbleImage) {
                    const opacity = rule.bubbleImageOpacity !== undefined ? rule.bubbleImageOpacity : 1.0;
                    style.backgroundImage = `url(${rule.bubbleImage})`;
                    style.backgroundSize = rule.bubbleImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = rule.bubbleImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (rule.bubbleColor) {
                    const opacity = rule.bubbleOpacity !== undefined ? rule.bubbleOpacity : 0.85;
                    style.backgroundColor = this.hexToRgba(rule.bubbleColor, opacity);
                }
            }
            
            return style;
        },
        
        // 对话文本样式
        getDialogTextStyle() {
            const style = {};
            
            if (this.fontSettings.dialogText) {
                style.fontFamily = this.fontSettings.dialogText;
            }
            if (this.fontSettings.dialogTextColor) {
                style.color = this.fontSettings.dialogTextColor;
            }
            if (this.fontSettings.dialogTextSize) {
                style.fontSize = `${this.fontSettings.dialogTextSize}px`;
            }
            
            return style;
        },
        
        // 系统消息样式
        getSystemMessageStyle() {
            const style = {};
            
            if (this.systemSettings.fontFamily) {
                style.fontFamily = this.systemSettings.fontFamily;
            }
            if (this.systemSettings.color) {
                style.color = this.systemSettings.color;
            }
            if (this.systemSettings.fontSize) {
                style.fontSize = `${this.systemSettings.fontSize}px`;
            }
            if (this.systemSettings.italic) {
                style.fontStyle = 'italic';
            }
            if (this.systemSettings.bold) {
                style.fontWeight = 'bold';
            }
            if (this.systemSettings.underline) {
                style.textDecoration = 'underline';
            }
            
            return style;
        },
        
        // extend样式
        getExtendStyle(msg) {
            const resultType = this.getExtendResultType(msg);
            const style = {};
            
            // 基础字体设置
            if (this.fontSettings.extendText) {
                style.fontFamily = this.fontSettings.extendText;
            }
            if (this.fontSettings.extendTextColor) {
                style.color = this.fontSettings.extendTextColor;
            }
            if (this.fontSettings.extendTextSize) {
                style.fontSize = `${this.fontSettings.extendTextSize}px`;
            }
            
            // 根据结果类型应用特殊格式
            if (resultType !== 'normal') {
                const format = this.extendFormats[resultType];
                if (format) {
                    if (format.color) {
                        style.color = format.color;
                    }
                    if (format.fontFamily) {
                        style.fontFamily = format.fontFamily;
                    }
                    if (format.fontSize) {
                        style.fontSize = `${format.fontSize}px`;
                    }
                    if (format.bold) {
                        style.fontWeight = 'bold';
                    }
                }
            }
            
            return style;
        },
        
        // 获取骰子文本
        getFormattedExtendText(msg) {
            const extendText = this.formatExtendContent(msg);
            if (!extendText) return '';
            
            const resultType = this.getExtendResultType(msg);
            let text = extendText;
            
            // 繁简转换
            const mapping = {
                '極限': '极限',
                '成功': '成功',
                '失敗': '失败',
                '大成功': '大成功',
                '大失败': '大失败'
            };
            
            for (const [traditional, simple] of Object.entries(mapping)) {
                text = text.replace(new RegExp(traditional, 'g'), simple);
            }
            
            // 根据结果类型进行转换
            if (resultType === 'criticalSuccess') {
                text = text.replace('极限成功', '大成功');
                text = text.replace(/(\d+)\s*[＞>]\s*极限成功/, '大成功');
            } else if (resultType === 'criticalFailure') {
                text = text.replace(/(\d+)\s*[＞>]\s*失败/, (match, number) => {
                    if (parseInt(number) >= 96) {
                        return '大失败';
                    }
                    return match;
                });
            }
            
            return text;
        },
        
        // 格式化extend内容
        formatExtendContent(msg) {
            if (msg.extend) {
                if (typeof msg.extend === 'string') {
                    try {
                        const parsed = JSON.parse(msg.extend);
                        if (parsed && parsed.roll && parsed.roll.result) {
                            return parsed.roll.result;
                        }
                        return msg.extend;
                    } catch (e) {
                        return msg.extend;
                    }
                } else if (typeof msg.extend === 'object') {
                    if (msg.extend.roll && msg.extend.roll.result) {
                        return msg.extend.roll.result;
                    }
                    try {
                        return JSON.stringify(msg.extend);
                    } catch (e) {
                        return String(msg.extend);
                    }
                }
            }
            return msg.dice || '';
        },
        
        // 获取extend结果类型
        getExtendResultType(msg) {
            const extendText = this.formatExtendContent(msg);
            if (!extendText) return 'normal';
            
            let text = extendText;
            
            // 繁简转换
            const mapping = {
                '極限': '极限',
                '成功': '成功',
                '失敗': '失败',
                '大成功': '大成功',
                '大失败': '大失败'
            };
            
            for (const [traditional, simple] of Object.entries(mapping)) {
                text = text.replace(new RegExp(traditional, 'g'), simple);
            }
            
            const cleanText = text.replace(/\s+/g, '');
            
            // 检查大失败
            if (text.includes('大失败')) {
                return 'criticalFailure';
            }
            
            // 检查大成功
            if (text.includes('大成功')) {
                return 'criticalSuccess';
            }
            
            // 检查"{数字}＞失败"且数字≥96
            const failureMatch = cleanText.match(/(\d+)[＞>]失败/);
            if (failureMatch) {
                const number = parseInt(failureMatch[1]);
                if (number >= 96) {
                    return 'criticalFailure';
                }
            }
            
            // 检查"{数字}＞极限成功"且数字≤5
            const successMatch = cleanText.match(/(\d+)[＞>]极限成功/);
            if (successMatch) {
                const number = parseInt(successMatch[1]);
                if (number <= 5) {
                    return 'criticalSuccess';
                }
            }
            
            // 检查普通成功
            if (text.trim().endsWith('成功')) {
                return 'success';
            }
            
            // 检查普通失败
            if (text.trim().endsWith('失败')) {
                return 'failure';
            }
            
            return 'normal';
        },
        
        // 跳转到章节（确保章节在新的一页开始）
        jumpToChapter(chapter) {
            if (!chapter.page) return;
            
            this.currentPage = chapter.page;
            this.sidebarOpen = false;
            this.scrollToTop();
        },
        
        // 切换侧边栏
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
        },
        
        // 执行搜索
        performSearch() {
            this.currentPage = 1;
        },
        
        // 清空搜索
        clearSearch() {
            this.searchQuery = '';
        },
        
        // 分页方法
        prevPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.scrollToTop();
            }
        },
        
        nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.scrollToTop();
            }
        },
        
        // 图片预览
        previewImage(imageUrl) {
            this.previewImageUrl = imageUrl;
            this.showImagePreview = true;
        },
        
        closeImagePreview() {
            this.showImagePreview = false;
            this.previewImageUrl = '';
        },
        
        // 滚动方法
        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        
        // 图片加载错误处理
        handleImageError(event) {
            event.target.style.display = 'none';
        },
        
        // HEX转RGBA
        hexToRgba(hex, opacity) {
            if (!hex) return `rgba(255, 255, 255, ${opacity})`;
            
            if (hex.startsWith('rgba')) return hex;
            
            hex = hex.replace(/^#/, '');
            
            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        },
        
        // 事件监听器设置
        setupEventListeners() {
            // ESC键关闭图片预览
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeImagePreview();
                }
            });
        }
    }
}).mount('#app');
