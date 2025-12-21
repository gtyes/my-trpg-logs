const { createApp } = Vue;

createApp({
    data() {
        return {
            // 日志数据
            title: '',
            date: '',
            logs: [],
            chapters: [],
            
            // 设置（从JSON导入）
            fontSettings: {},
            systemSettings: {},
            chapterSettings: {},
            channelRules: {},
            characterRules: {},
            globalChannelSettings: {},
            defaultChannelRule: {},
            defaultCharacterRule: {},
            extendFormats: {},
            
            // 分页
            currentPage: 1,
            pageSize: 50,
            jumpPage: null,
            totalPages: 1,
            viewMode: 'paginated', // 'paginated' 或 'continuous'
            
            // 筛选和搜索
            searchQuery: '',
            selectedCharacters: [],
            selectedChannels: [],
            dateRange: {
                start: '',
                end: ''
            },
            showFilterPanel: false,
            
            // 界面状态
            sidebarOpen: true,
            showImagePreview: false,
            previewImageUrl: '',
            
            // 频道折叠状态
            collapsedChannels: {},
            
            // 加载状态
            isLoading: true,
            errorMessage: ''
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
        
        // 当前页的消息（已筛选）
        paginatedLogs() {
            let filtered = this.filteredLogs;
            
            // 分页
            if (this.viewMode === 'paginated') {
                return filtered.slice(this.startIndex, this.endIndex);
            }
            
            return filtered;
        },
        
        // 筛选后的日志（不分页）
        filteredLogs() {
            let filtered = this.logs;
            
            // 应用角色筛选
            if (this.selectedCharacters.length > 0) {
                filtered = filtered.filter(msg => 
                    this.selectedCharacters.includes(msg.name)
                );
            }
            
            // 应用频道筛选
            if (this.selectedChannels.length > 0) {
                filtered = filtered.filter(msg => 
                    this.selectedChannels.includes(msg.channel)
                );
            }
            
            // 应用搜索
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase();
                filtered = filtered.filter(msg => 
                    msg.text.toLowerCase().includes(query) ||
                    msg.name.toLowerCase().includes(query) ||
                    (msg.dice && msg.dice.toLowerCase().includes(query)) ||
                    (msg.extend && typeof msg.extend === 'string' && msg.extend.toLowerCase().includes(query)) ||
                    (msg.extend && typeof msg.extend === 'object' && JSON.stringify(msg.extend).toLowerCase().includes(query))
                );
            }
            
            return filtered;
        },
        
        // 角色列表
        characterList() {
            const characters = new Set();
            this.logs.forEach(msg => {
                if (msg.name && msg.name.toLowerCase() !== 'system' && !msg.isChapter) {
                    characters.add(msg.name);
                }
            });
            return Array.from(characters).sort();
        },
        
        // 频道列表
        channelList() {
            const channels = new Set();
            this.logs.forEach(msg => {
                if (msg.channel && !msg.isChapter) {
                    channels.add(msg.channel);
                }
            });
            return Array.from(channels).sort();
        },
        
        // 频道分组（使用你的编辑器逻辑）
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
        },
        
        // 活跃筛选数量
        activeFiltersCount() {
            let count = 0;
            if (this.searchQuery) count++;
            count += this.selectedCharacters.length;
            count += this.selectedChannels.length;
            if (this.dateRange.start || this.dateRange.end) count++;
            return count;
        },
        
        // 是否有筛选
        isFiltered() {
            return this.activeFiltersCount > 0;
        },
        
        // 角色数量
        characterCount() {
            return this.characterList.length;
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
                
                // 如果没有指定log参数，尝试默认路径
                if (!logFile) {
                    logFile = 'data/log-demo.json';
                }
                
                console.log('正在加载日志文件:', logFile);
                
                const response = await fetch(logFile);
                if (!response.ok) {
                    throw new Error(`HTTP错误 ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                console.log('日志数据加载成功:', data);
                
                // 导入数据 - 兼容不同格式
                this.title = data.title || '未命名模组';
                this.date = data.date || new Date().toISOString().split('T')[0];
                
                // 处理日志数组 - 兼容多种格式
                if (Array.isArray(data.logs)) {
                    this.logs = this.processLogArray(data.logs);
                } else if (Array.isArray(data)) {
                    // 如果data本身就是数组（可能是旧的格式）
                    this.logs = this.processLogArray(data);
                } else {
                    throw new Error('日志数据格式不正确：缺少logs数组');
                }
                
                // 导入设置 - 提供默认值
                this.fontSettings = data.fontSettings || {
                    channelName: '',
                    channelNameColor: '#2c3e50',
                    channelNameSize: 14,
                    characterName: '',
                    characterNameColor: '#000000',
                    characterNameSize: 13,
                    dialogText: '',
                    dialogTextColor: '#000000',
                    dialogTextSize: 14,
                    extendText: 'Consolas, Monaco, monospace',
                    extendTextColor: '#000000',
                    extendTextSize: 13
                };
                
                this.systemSettings = data.systemSettings || {
                    fontFamily: 'Consolas, Monaco, monospace',
                    color: '#7f8c8d',
                    fontSize: 12,
                    italic: false,
                    bold: false,
                    underline: false,
                    prefix: 'system:'
                };
                
                this.chapterSettings = data.chapterSettings || {
                    fontFamily: 'Microsoft YaHei, 微软雅黑',
                    color: '#ffffff',
                    fontSize: 20,
                    useImage: false,
                    image: '',
                    imageSize: 'cover',
                    imageOpacity: 1.0,
                    backgroundColor: '#3498db',
                    backgroundOpacity: 0.9,
                    bold: true,
                    shadow: true
                };
                
                this.channelRules = data.channelRules || {};
                this.characterRules = data.characterRules || {};
                this.globalChannelSettings = data.globalChannelSettings || {
                    autoCollapseOther: false,
                    showCollapseButtons: true,
                    collapsedChannels: {}
                };
                
                this.defaultChannelRule = data.defaultChannelRule || {
                    useImage: false,
                    color: '#2c3e50',
                    opacity: 0.1,
                    image: '',
                    imageSize: 'cover',
                    imageOpacity: 1.0,
                    useMask: false,
                    maskColor: '#cccccc',
                    maskOpacity: 0.3,
                    collapsed: false
                };
                
                this.defaultCharacterRule = data.defaultCharacterRule || {
                    nameColor: '#000000',
                    nameUseImage: false,
                    nameBackground: '#ffffff',
                    nameOpacity: 0.85,
                    nameImage: '',
                    nameImageSize: 'cover',
                    nameImageOpacity: 1.0,
                    bubbleUseImage: false,
                    bubbleColor: '#ffffff',
                    bubbleOpacity: 0.85,
                    bubbleImage: '',
                    bubbleImageSize: 'cover',
                    bubbleImageOpacity: 1.0
                };
                
                this.extendFormats = data.extendFormats || {
                    success: { color: '#27ae60', fontFamily: '', fontSize: 13, bold: true },
                    failure: { color: '#e74c3c', fontFamily: '', fontSize: 13, bold: true },
                    criticalFailure: { color: '#c0392b', fontFamily: '', fontSize: 14, bold: true, image: '', imageOpacity: 1.0 },
                    criticalSuccess: { color: '#f39c12', fontFamily: '', fontSize: 14, bold: true, image: '', imageOpacity: 1.0 }
                };
                
                // 章节数据
                this.chapters = data.chapters || [];
                
                // 处理章节：如果没有章节数据，从日志中提取章节标记
                if (this.chapters.length === 0) {
                    this.extractChaptersFromLogs();
                }
                
                // 计算总页数
                this.totalPages = Math.ceil(this.logs.length / this.pageSize) || 1;
                
                console.log('日志处理完成:', this.logs.length, '条消息');
                this.isLoading = false;
                
            } catch (error) {
                console.error('加载日志失败:', error);
                this.errorMessage = `加载日志失败：${error.message}`;
                this.isLoading = false;
                
                // 显示错误信息
                alert(this.errorMessage + '\n请检查：\n1. JSON文件路径是否正确\n2. JSON文件格式是否正确\n3. 浏览器控制台查看详细错误');
            }
        },
        
        // 处理日志数组
        processLogArray(logArray) {
            return logArray.map((log, index) => {
                // 确保所有必需字段都有默认值
                const processedLog = {
                    id: log.id || `msg-${Date.now()}-${index}`,
                    name: log.name || '未知角色',
                    text: log.text || '',
                    color: log.color || '#000000',
                    channel: log.channel || '默认频道',
                    icon: log.icon || null,
                    dice: log.dice || null,
                    extend: log.extend || null,
                    to: log.to || null,
                    time: log.time || new Date().toISOString(),
                    messageImage: log.messageImage || null,
                    isChapter: log.isChapter || false,
                    
                    // 处理图像设置
                    nameUseImage: log.nameUseImage || false,
                    nameBackground: log.nameBackground || null,
                    nameOpacity: log.nameOpacity !== undefined ? log.nameOpacity : 0.85,
                    nameImage: log.nameImage || '',
                    nameImageSize: log.nameImageSize || 'cover',
                    nameImageOpacity: log.nameImageOpacity !== undefined ? log.nameImageOpacity : 1.0,
                    bubbleUseImage: log.bubbleUseImage || false,
                    bubbleColor: log.bubbleColor || null,
                    bubbleOpacity: log.bubbleOpacity !== undefined ? log.bubbleOpacity : 0.85,
                    bubbleImage: log.bubbleImage || '',
                    bubbleImageSize: log.bubbleImageSize || 'cover',
                    bubbleImageOpacity: log.bubbleImageOpacity !== undefined ? log.bubbleImageOpacity : 1.0
                };
                
                // 如果是章节消息，确保频道为"系统"
                if (processedLog.isChapter) {
                    processedLog.channel = '系统';
                }
                
                return processedLog;
            });
        },
        
        // 从日志中提取章节信息
        extractChaptersFromLogs() {
            const chapters = [];
            
            this.logs.forEach((msg, index) => {
                // 检查是否是章节标记（根据你的编辑器格式）
                if (msg.isChapter || 
                    (msg.name.toLowerCase() === 'system' && 
                     msg.text && 
                     msg.text.startsWith('===') && 
                     msg.text.endsWith('==='))) {
                    
                    const chapterName = msg.text.replace(/===/g, '').trim();
                    
                    chapters.push({
                        id: msg.id || `chapter-${index}`,
                        name: chapterName || `章节 ${chapters.length + 1}`,
                        position: index + 1,
                        page: Math.floor(index / this.pageSize) + 1
                    });
                }
            });
            
            this.chapters = chapters;
        },
        
        // 获取系统消息频道
        getSystemMessageChannel(msg) {
            if (msg.isChapter || msg.channel === '系统') return '系统';
            
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
        
        // 判断是否为非主频道
        isNonMainChannel(channel) {
            if (!channel) return false;
            
            const otherChannels = ['闲聊', 'other', '其他', '聊天', '杂谈', '闲谈'];
            return otherChannels.some(otherChannel => 
                channel.toLowerCase().includes(otherChannel.toLowerCase()));
        },
        
        // 章节样式
        getChapterStyle(chapterMsg) {
            const style = {};
            
            // 应用章节设置
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
            
            // 背景设置
            if (this.chapterSettings.useImage && this.chapterSettings.image) {
                const opacity = this.chapterSettings.imageOpacity || 1.0;
                style.backgroundImage = `url(${this.chapterSettings.image})`;
                style.backgroundSize = this.chapterSettings.imageSize || 'cover';
                style.backgroundPosition = 'center';
                style.backgroundRepeat = this.chapterSettings.imageSize === 'repeat' ? 'repeat' : 'no-repeat';
                style.opacity = opacity;
            } else {
                const opacity = this.chapterSettings.backgroundOpacity || 0.9;
                const bgColor = this.chapterSettings.backgroundColor || '#3498db';
                style.backgroundColor = this.hexToRgba(bgColor, opacity);
            }
            
            return style;
        },
        
        // 跳转到章节
        jumpToChapter(chapter) {
            const chapterIndex = this.logs.findIndex(msg => msg.id === chapter.id);
            if (chapterIndex !== -1) {
                const targetPage = Math.floor(chapterIndex / this.pageSize) + 1;
                this.currentPage = targetPage;
                this.scrollToTop();
            }
        },
        
        // 频道背景样式
        getChannelBackgroundStyle(channel) {
            const rule = this.channelRules[channel];
            let style = {};
            
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
            }
            
            // 默认样式
            if (!style.backgroundColor && !style.backgroundImage) {
                const opacity = this.defaultChannelRule.opacity !== undefined ? this.defaultChannelRule.opacity : 0.1;
                style.backgroundColor = this.hexToRgba(this.defaultChannelRule.color || '#2c3e50', opacity);
            }
            
            // 添加边框
            style.border = '1px solid rgba(45, 45, 66, 0.5)';
            style.borderRadius = '8px';
            
            return style;
        },
        
        // 频道名字体样式
        getChannelNameStyle(channel) {
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
        
        // 角色名字体样式
        getCharacterNameStyle(characterName) {
            const style = {};
            
            if (this.fontSettings.characterName) {
                style.fontFamily = this.fontSettings.characterName;
            }
            if (this.fontSettings.characterNameSize) {
                style.fontSize = `${this.fontSettings.characterNameSize}px`;
            }
            
            // 颜色：从角色规则、消息颜色或默认设置获取
            const rule = this.characterRules[characterName];
            let nameColor = '#e6e6e6'; // 默认浅色
            
            if (rule && rule.nameColor) {
                nameColor = rule.nameColor;
            } else {
                // 查找该角色的第一条消息的颜色
                const firstMsg = this.logs.find(msg => msg.name === characterName);
                if (firstMsg && firstMsg.color && firstMsg.color !== '#000000') {
                    nameColor = firstMsg.color;
                } else if (this.defaultCharacterRule.nameColor) {
                    nameColor = this.defaultCharacterRule.nameColor;
                }
            }
            
            style.color = nameColor;
            style.fontWeight = 'bold';
            
            return style;
        },
        
        // 气泡样式
        getBubbleStyle(characterName) {
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
            
            // 默认样式
            if (!style.backgroundColor && !style.backgroundImage) {
                const opacity = this.defaultCharacterRule.bubbleOpacity !== undefined ? this.defaultCharacterRule.bubbleOpacity : 0.85;
                style.backgroundColor = this.hexToRgba(this.defaultCharacterRule.bubbleColor || '#ffffff', opacity);
            }
            
            // 通用样式
            style.border = '1px solid rgba(45, 45, 66, 0.5)';
            style.borderRadius = '8px';
            style.padding = '1rem';
            style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
            style.maxWidth = '600px';
            
            return style;
        },
        
        // 文字样式
        getTextStyle() {
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
        
        // 骰子样式
        getDiceStyle(msg) {
            const style = {};
            
            // 基础样式
            style.display = 'flex';
            style.alignItems = 'center';
            style.gap = '0.75rem';
            style.marginTop = '1rem';
            style.padding = '0.75rem';
            style.borderRadius = '6px';
            
            // 获取骰子结果类型
            const resultType = this.getExtendResultType(msg);
            const format = this.extendFormats[resultType] || {};
            
            // 根据结果类型设置样式
            switch(resultType) {
                case 'criticalSuccess':
                    style.background = 'rgba(243, 156, 18, 0.1)';
                    style.borderLeft = '3px solid #f39c12';
                    break;
                case 'criticalFailure':
                    style.background = 'rgba(192, 57, 43, 0.1)';
                    style.borderLeft = '3px solid #c0392b';
                    break;
                case 'success':
                    style.background = 'rgba(39, 174, 96, 0.1)';
                    style.borderLeft = '3px solid #27ae60';
                    break;
                case 'failure':
                    style.background = 'rgba(231, 76, 60, 0.1)';
                    style.borderLeft = '3px solid #e74c3c';
                    break;
                default:
                    style.background = 'rgba(0, 0, 0, 0.2)';
                    style.borderLeft = '3px solid #8b0000';
            }
            
            // 应用字体设置
            if (this.fontSettings.extendText) {
                style.fontFamily = this.fontSettings.extendText;
            }
            if (this.fontSettings.extendTextColor && resultType === 'normal') {
                style.color = this.fontSettings.extendTextColor;
            }
            if (this.fontSettings.extendTextSize) {
                style.fontSize = `${this.fontSettings.extendTextSize}px`;
            }
            
            // 应用特殊格式
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
            
            return style;
        },
        
        // 获取骰子文本
        getDiceText(msg) {
            if (msg.extend) {
                // 处理你的编辑器格式：extend可能是字符串或对象
                if (typeof msg.extend === 'string') {
                    try {
                        const parsed = JSON.parse(msg.extend);
                        if (parsed && parsed.roll && parsed.roll.result) {
                            return parsed.roll.result;
                        }
                        return msg.extend;
                    } catch (e) {
                        // 不是JSON，直接返回字符串
                        return msg.extend;
                    }
                } else if (typeof msg.extend === 'object') {
                    // 如果是对象，提取roll.result
                    if (msg.extend.roll && msg.extend.roll.result) {
                        return msg.extend.roll.result;
                    }
                    // 尝试转换为字符串
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
            const extendText = this.getDiceText(msg);
            if (!extendText) return 'normal';
            
            let text = extendText;
            
            // 繁简转换处理
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
            
            // 清理文本（移除空格）
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
        
        // 检查频道是否折叠
        isChannelCollapsed(channel) {
            // 首先检查频道规则中的折叠设置
            if (this.channelRules[channel] && this.channelRules[channel].collapsed !== undefined) {
                return this.channelRules[channel].collapsed;
            }
            
            // 然后检查全局折叠设置
            if (this.globalChannelSettings.collapsedChannels && 
                this.globalChannelSettings.collapsedChannels[channel] !== undefined) {
                return this.globalChannelSettings.collapsedChannels[channel];
            }
            
            // 如果启用了自动折叠other/闲聊频道
            if (this.globalChannelSettings.autoCollapseOther && this.isNonMainChannel(channel)) {
                return true;
            }
            
            return false;
        },
        
        // 切换频道折叠
        toggleChannelCollapse(channel) {
            if (!this.collapsedChannels[channel]) {
                this.collapsedChannels[channel] = {};
            }
            
            this.collapsedChannels[channel] = !this.isChannelCollapsed(channel);
        },
        
        // 检查消息是否高亮（搜索结果）
        isMessageHighlighted(msg) {
            if (!this.searchQuery) return false;
            const query = this.searchQuery.toLowerCase();
            return msg.text.toLowerCase().includes(query) ||
                   msg.name.toLowerCase().includes(query);
        },
        
        // 检查角色是否选中
        isCharacterActive(character) {
            return this.selectedCharacters.includes(character);
        },
        
        // 切换角色筛选
        toggleCharacterFilter(character) {
            const index = this.selectedCharacters.indexOf(character);
            if (index === -1) {
                this.selectedCharacters.push(character);
            } else {
                this.selectedCharacters.splice(index, 1);
            }
        },
        
        // 移除角色筛选
        removeCharacterFilter(character) {
            const index = this.selectedCharacters.indexOf(character);
            if (index !== -1) {
                this.selectedCharacters.splice(index, 1);
            }
        },
        
        // 切换侧边栏
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
        },
        
        // 切换筛选面板
        toggleFilterDropdown() {
            this.showFilterPanel = !this.showFilterPanel;
        },
        
        // 应用筛选
        applyFilters() {
            this.currentPage = 1;
            this.showFilterPanel = false;
        },
        
        // 清空筛选
        clearFilters() {
            this.selectedCharacters = [];
            this.selectedChannels = [];
            this.dateRange = { start: '', end: '' };
            this.currentPage = 1;
        },
        
        // 清空搜索
        clearSearch() {
            this.searchQuery = '';
        },
        
        // 清空所有筛选
        clearAllFilters() {
            this.clearFilters();
            this.clearSearch();
        },
        
        // 执行搜索
        performSearch() {
            this.currentPage = 1;
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
        
        jumpToPage() {
            if (this.jumpPage && this.jumpPage >= 1 && this.jumpPage <= this.totalPages) {
                this.currentPage = this.jumpPage;
                this.scrollToTop();
            }
            this.jumpPage = null;
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
        
        scrollToBottom() {
            window.scrollTo({ 
                top: document.documentElement.scrollHeight, 
                behavior: 'smooth' 
            });
        },
        
        // 格式化时间
        formatTime(timeString) {
            if (!timeString) return '';
            
            try {
                const date = new Date(timeString);
                if (isNaN(date.getTime())) {
                    return timeString; // 如果无法解析，返回原字符串
                }
                
                return date.toLocaleTimeString('zh-CN', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false
                });
            } catch (e) {
                return timeString;
            }
        },
        
        // HEX转RGBA
        hexToRgba(hex, opacity) {
            if (!hex) {
                return `rgba(255, 255, 255, ${opacity})`;
            }
            
            // 如果已经是rgba格式，直接返回
            if (hex.startsWith('rgba')) {
                return hex;
            }
            
            // 处理简写HEX
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
            // 点击外部关闭筛选面板
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.filter-dropdown')) {
                    this.showFilterPanel = false;
                }
            });
            
            // ESC键关闭图片预览
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeImagePreview();
                }
            });
        }
    }
}).mount('#app');
