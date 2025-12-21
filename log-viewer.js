const { createApp } = Vue;

createApp({
    data() {
        return {
            // 日志数据
            title: '',
            date: '',
            logs: [],
            chapters: [],
            
            // 设置（从JSON导入）- 完全使用JSON的设置
            fontSettings: null,
            systemSettings: null,
            chapterSettings: null,
            channelRules: {},
            characterRules: {},
            globalChannelSettings: null,
            defaultChannelRule: null,
            defaultCharacterRule: null,
            extendFormats: null,
            
            // 分页
            currentPage: 1,
            pageSize: 50,
            jumpPage: null,
            totalPages: 1,
            viewMode: 'paginated',
            
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
        totalMessages() {
            return this.logs.length;
        },
        
        startIndex() {
            return (this.currentPage - 1) * this.pageSize;
        },
        
        endIndex() {
            return Math.min(this.startIndex + this.pageSize, this.logs.length);
        },
        
        paginatedLogs() {
            let filtered = this.filteredLogs;
            
            if (this.viewMode === 'paginated') {
                return filtered.slice(this.startIndex, this.endIndex);
            }
            
            return filtered;
        },
        
        filteredLogs() {
            let filtered = this.logs;
            
            if (this.selectedCharacters.length > 0) {
                filtered = filtered.filter(msg => 
                    this.selectedCharacters.includes(msg.name)
                );
            }
            
            if (this.selectedChannels.length > 0) {
                filtered = filtered.filter(msg => 
                    this.selectedChannels.includes(msg.channel)
                );
            }
            
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
        
        characterList() {
            const characters = new Set();
            this.logs.forEach(msg => {
                if (msg.name && msg.name.toLowerCase() !== 'system' && !msg.isChapter) {
                    characters.add(msg.name);
                }
            });
            return Array.from(characters).sort();
        },
        
        channelList() {
            const channels = new Set();
            this.logs.forEach(msg => {
                if (msg.channel && !msg.isChapter) {
                    channels.add(msg.channel);
                }
            });
            return Array.from(channels).sort();
        },
        
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
        
        activeFiltersCount() {
            let count = 0;
            if (this.searchQuery) count++;
            count += this.selectedCharacters.length;
            count += this.selectedChannels.length;
            if (this.dateRange.start || this.dateRange.end) count++;
            return count;
        },
        
        isFiltered() {
            return this.activeFiltersCount > 0;
        }
    },
    mounted() {
        this.loadLogData();
        this.setupEventListeners();
    },
    methods: {
        async loadLogData() {
            this.isLoading = true;
            this.errorMessage = '';
            
            try {
                const urlParams = new URLSearchParams(window.location.search);
                let logFile = urlParams.get('log');
                
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
                
                // 直接使用JSON中的所有设置
                this.title = data.title || '未命名模组';
                this.date = data.date || '';
                this.chapters = data.chapters || [];
                
                // 处理日志数组
                if (Array.isArray(data.logs)) {
                    this.logs = this.processLogArray(data.logs);
                } else if (Array.isArray(data)) {
                    this.logs = this.processLogArray(data);
                } else {
                    throw new Error('日志数据格式不正确：缺少logs数组');
                }
                
                // 直接使用JSON中的所有设置，不提供默认值
                this.fontSettings = data.fontSettings || {};
                this.systemSettings = data.systemSettings || {};
                this.chapterSettings = data.chapterSettings || {};
                this.channelRules = data.channelRules || {};
                this.characterRules = data.characterRules || {};
                this.globalChannelSettings = data.globalChannelSettings || {};
                this.defaultChannelRule = data.defaultChannelRule || {};
                this.defaultCharacterRule = data.defaultCharacterRule || {};
                this.extendFormats = data.extendFormats || {};
                
                // 从日志中提取章节信息（如果JSON中没有）
                if (this.chapters.length === 0) {
                    this.extractChaptersFromLogs();
                }
                
                // 计算总页数
                this.totalPages = Math.ceil(this.logs.length / this.pageSize) || 1;
                
                console.log('日志处理完成:', this.logs.length, '条消息');
                console.log('字体设置:', this.fontSettings);
                console.log('角色规则:', this.characterRules);
                console.log('频道规则:', this.channelRules);
                
                this.isLoading = false;
                
            } catch (error) {
                console.error('加载日志失败:', error);
                this.errorMessage = `加载日志失败：${error.message}`;
                this.isLoading = false;
                alert(this.errorMessage);
            }
        },
        
        processLogArray(logArray) {
            return logArray.map((log, index) => {
                // 保持所有原始字段
                return {
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
                    
                    // 图像设置 - 保持原始值
                    nameUseImage: log.nameUseImage,
                    nameBackground: log.nameBackground,
                    nameOpacity: log.nameOpacity,
                    nameImage: log.nameImage,
                    nameImageSize: log.nameImageSize,
                    nameImageOpacity: log.nameImageOpacity,
                    bubbleUseImage: log.bubbleUseImage,
                    bubbleColor: log.bubbleColor,
                    bubbleOpacity: log.bubbleOpacity,
                    bubbleImage: log.bubbleImage,
                    bubbleImageSize: log.bubbleImageSize,
                    bubbleImageOpacity: log.bubbleImageOpacity
                };
            });
        },
        
        extractChaptersFromLogs() {
            const chapters = [];
            
            this.logs.forEach((msg, index) => {
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
        
        getSystemMessageChannel(msg) {
            if (msg.isChapter || msg.channel === '系统') return '系统';
            
            const msgIndex = this.logs.findIndex(log => log.id === msg.id);
            if (msgIndex === -1) return '系统';
            
            for (let i = msgIndex - 1; i >= 0; i--) {
                const prevMsg = this.logs[i];
                if (prevMsg.name.toLowerCase() === 'system' || prevMsg.isChapter) continue;
                
                return prevMsg.channel || '默认频道';
            }
            
            return '系统';
        },
        
        isNonMainChannel(channel) {
            if (!channel) return false;
            
            const otherChannels = ['闲聊', 'other', '其他', '聊天', '杂谈', '闲谈'];
            return otherChannels.some(otherChannel => 
                channel.toLowerCase().includes(otherChannel.toLowerCase()));
        },
        
        // 章节样式 - 完全使用JSON中的设置
        getChapterStyle(chapterMsg) {
            const style = {};
            
            if (this.chapterSettings) {
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
                } else if (this.chapterSettings.backgroundColor) {
                    const opacity = this.chapterSettings.backgroundOpacity || 0.9;
                    style.backgroundColor = this.hexToRgba(this.chapterSettings.backgroundColor, opacity);
                }
            }
            
            // 如果没有设置，使用默认的克苏鲁风格
            if (!style.backgroundColor && !style.backgroundImage) {
                style.background = 'linear-gradient(135deg, rgba(139, 0, 0, 0.1), rgba(26, 26, 46, 0.8))';
                style.border = '1px solid rgba(139, 0, 0, 0.3)';
            }
            
            return style;
        },
        
        jumpToChapter(chapter) {
            const chapterIndex = this.logs.findIndex(msg => msg.id === chapter.id);
            if (chapterIndex !== -1) {
                const targetPage = Math.floor(chapterIndex / this.pageSize) + 1;
                this.currentPage = targetPage;
                this.scrollToTop();
            }
        },
        
        // 频道背景样式 - 优先使用JSON中的设置
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
            
            // 使用默认设置
            if (!style.backgroundColor && !style.backgroundImage && this.defaultChannelRule) {
                if (this.defaultChannelRule.useImage && this.defaultChannelRule.image) {
                    const opacity = this.defaultChannelRule.imageOpacity || 1.0;
                    style.backgroundImage = `url(${this.defaultChannelRule.image})`;
                    style.backgroundSize = this.defaultChannelRule.imageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = this.defaultChannelRule.imageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (this.defaultChannelRule.color) {
                    const opacity = this.defaultChannelRule.opacity || 0.1;
                    style.backgroundColor = this.hexToRgba(this.defaultChannelRule.color, opacity);
                }
            }
            
            // 如果都没有设置，使用默认样式
            if (!style.backgroundColor && !style.backgroundImage) {
                style.backgroundColor = 'rgba(26, 26, 46, 0.3)';
            }
            
            style.border = '1px solid rgba(45, 45, 66, 0.5)';
            style.borderRadius = '8px';
            
            return style;
        },
        
        // 频道名字体样式 - 完全使用JSON中的设置
        getChannelNameStyle(channel) {
            const style = {};
            
            if (this.fontSettings) {
                if (this.fontSettings.channelName) {
                    style.fontFamily = this.fontSettings.channelName;
                }
                if (this.fontSettings.channelNameColor) {
                    style.color = this.fontSettings.channelNameColor;
                }
                if (this.fontSettings.channelNameSize) {
                    style.fontSize = `${this.fontSettings.channelNameSize}px`;
                }
            }
            
            return style;
        },
        
        // 角色名字体样式 - 完全使用JSON中的设置
        getCharacterNameStyle(characterName) {
            const style = {};
            
            if (this.fontSettings) {
                if (this.fontSettings.characterName) {
                    style.fontFamily = this.fontSettings.characterName;
                }
                if (this.fontSettings.characterNameSize) {
                    style.fontSize = `${this.fontSettings.characterNameSize}px`;
                }
            }
            
            // 颜色：优先使用角色规则，然后使用消息本身的颜色
            const rule = this.characterRules[characterName];
            if (rule && rule.nameColor) {
                style.color = rule.nameColor;
            } else {
                // 查找该角色的第一条消息的颜色
                const firstMsg = this.logs.find(msg => msg.name === characterName);
                if (firstMsg && firstMsg.color) {
                    style.color = firstMsg.color;
                }
            }
            
            style.fontWeight = 'bold';
            
            return style;
        },
        
        // 角色名背景样式 - 完全使用JSON中的设置
        getCharacterNameBackgroundStyle(characterName) {
            const style = {};
            const rule = this.characterRules[characterName];
            
            // 优先使用消息级别的设置
            const message = this.logs.find(msg => msg.name === characterName);
            if (message) {
                if (message.nameUseImage && message.nameImage) {
                    const opacity = message.nameImageOpacity || 1.0;
                    style.backgroundImage = `url(${message.nameImage})`;
                    style.backgroundSize = message.nameImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = message.nameImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (message.nameBackground) {
                    const opacity = message.nameOpacity || 0.85;
                    style.backgroundColor = this.hexToRgba(message.nameBackground, opacity);
                }
            }
            
            // 然后使用角色规则
            if (!style.backgroundColor && !style.backgroundImage && rule) {
                if (rule.nameUseImage && rule.nameImage) {
                    const opacity = rule.nameImageOpacity || 1.0;
                    style.backgroundImage = `url(${rule.nameImage})`;
                    style.backgroundSize = rule.nameImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = rule.nameImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (rule.nameBackground) {
                    const opacity = rule.nameOpacity || 0.85;
                    style.backgroundColor = this.hexToRgba(rule.nameBackground, opacity);
                }
            }
            
            // 最后使用默认设置
            if (!style.backgroundColor && !style.backgroundImage && this.defaultCharacterRule) {
                if (this.defaultCharacterRule.nameUseImage && this.defaultCharacterRule.nameImage) {
                    const opacity = this.defaultCharacterRule.nameImageOpacity || 1.0;
                    style.backgroundImage = `url(${this.defaultCharacterRule.nameImage})`;
                    style.backgroundSize = this.defaultCharacterRule.nameImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = this.defaultCharacterRule.nameImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (this.defaultCharacterRule.nameBackground) {
                    const opacity = this.defaultCharacterRule.nameOpacity || 0.85;
                    style.backgroundColor = this.hexToRgba(this.defaultCharacterRule.nameBackground, opacity);
                }
            }
            
            // 通用样式
            if (style.backgroundColor || style.backgroundImage) {
                style.padding = '4px 10px';
                style.borderRadius = '6px';
                style.display = 'inline-block';
                style.marginBottom = '6px';
                style.border = '1px solid rgba(0,0,0,0.05)';
                style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
            }
            
            return style;
        },
        
        // 气泡样式 - 完全使用JSON中的设置
        getBubbleStyle(characterName) {
            const style = {};
            const rule = this.characterRules[characterName];
            
            // 优先使用消息级别的设置
            const message = this.logs.find(msg => msg.name === characterName);
            if (message) {
                if (message.bubbleUseImage && message.bubbleImage) {
                    const opacity = message.bubbleImageOpacity || 1.0;
                    style.backgroundImage = `url(${message.bubbleImage})`;
                    style.backgroundSize = message.bubbleImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = message.bubbleImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (message.bubbleColor) {
                    const opacity = message.bubbleOpacity || 0.85;
                    style.backgroundColor = this.hexToRgba(message.bubbleColor, opacity);
                }
            }
            
            // 然后使用角色规则
            if (!style.backgroundColor && !style.backgroundImage && rule) {
                if (rule.bubbleUseImage && rule.bubbleImage) {
                    const opacity = rule.bubbleImageOpacity || 1.0;
                    style.backgroundImage = `url(${rule.bubbleImage})`;
                    style.backgroundSize = rule.bubbleImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = rule.bubbleImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (rule.bubbleColor) {
                    const opacity = rule.bubbleOpacity || 0.85;
                    style.backgroundColor = this.hexToRgba(rule.bubbleColor, opacity);
                }
            }
            
            // 最后使用默认设置
            if (!style.backgroundColor && !style.backgroundImage && this.defaultCharacterRule) {
                if (this.defaultCharacterRule.bubbleUseImage && this.defaultCharacterRule.bubbleImage) {
                    const opacity = this.defaultCharacterRule.bubbleImageOpacity || 1.0;
                    style.backgroundImage = `url(${this.defaultCharacterRule.bubbleImage})`;
                    style.backgroundSize = this.defaultCharacterRule.bubbleImageSize || 'cover';
                    style.backgroundPosition = 'center';
                    style.backgroundRepeat = this.defaultCharacterRule.bubbleImageSize === 'repeat' ? 'repeat' : 'no-repeat';
                    style.opacity = opacity;
                } else if (this.defaultCharacterRule.bubbleColor) {
                    const opacity = this.defaultCharacterRule.bubbleOpacity || 0.85;
                    style.backgroundColor = this.hexToRgba(this.defaultCharacterRule.bubbleColor, opacity);
                }
            }
            
            // 通用样式
            style.padding = '10px 14px';
            style.borderRadius = '8px';
            style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
            style.position = 'relative';
            style.minHeight = '20px';
            
            return style;
        },
        
        // 对话文本样式 - 完全使用JSON中的设置
        getTextStyle() {
            const style = {};
            
            if (this.fontSettings) {
                if (this.fontSettings.dialogText) {
                    style.fontFamily = this.fontSettings.dialogText;
                }
                if (this.fontSettings.dialogTextColor) {
                    style.color = this.fontSettings.dialogTextColor;
                }
                if (this.fontSettings.dialogTextSize) {
                    style.fontSize = `${this.fontSettings.dialogTextSize}px`;
                }
            }
            
            return style;
        },
        
        // 系统消息样式 - 完全使用JSON中的设置
        getSystemMessageStyle() {
            const style = {};
            
            if (this.systemSettings) {
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
            }
            
            return style;
        },
        
        // 骰子样式 - 完全使用JSON中的设置
        getDiceStyle(msg) {
            const style = {};
            
            // 基础样式
            style.marginTop = '8px';
            style.paddingTop = '8px';
            style.borderTop = '1px dashed #eee';
            
            // 使用基础extend设置
            if (this.fontSettings && this.fontSettings.extendText) {
                style.fontFamily = this.fontSettings.extendText;
            }
            if (this.fontSettings && this.fontSettings.extendTextColor) {
                style.color = this.fontSettings.extendTextColor;
            }
            if (this.fontSettings && this.fontSettings.extendTextSize) {
                style.fontSize = `${this.fontSettings.extendTextSize}px`;
            }
            
            // 根据结果类型应用特殊格式
            const resultType = this.getExtendResultType(msg);
            if (resultType !== 'normal' && this.extendFormats) {
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
        getDiceText(msg) {
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
            const extendText = this.getDiceText(msg);
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
            
            if (text.includes('大失败')) return 'criticalFailure';
            if (text.includes('大成功')) return 'criticalSuccess';
            
            const failureMatch = cleanText.match(/(\d+)[＞>]失败/);
            if (failureMatch) {
                const number = parseInt(failureMatch[1]);
                if (number >= 96) return 'criticalFailure';
            }
            
            const successMatch = cleanText.match(/(\d+)[＞>]极限成功/);
            if (successMatch) {
                const number = parseInt(successMatch[1]);
                if (number <= 5) return 'criticalSuccess';
            }
            
            if (text.trim().endsWith('成功')) return 'success';
            if (text.trim().endsWith('失败')) return 'failure';
            
            return 'normal';
        },
        
        // 获取extend特殊图片
        getExtendImage(msg) {
            const resultType = this.getExtendResultType(msg);
            
            if (resultType === 'criticalFailure' && this.extendFormats && this.extendFormats.criticalFailure && this.extendFormats.criticalFailure.image) {
                return this.extendFormats.criticalFailure.image;
            }
            
            if (resultType === 'criticalSuccess' && this.extendFormats && this.extendFormats.criticalSuccess && this.extendFormats.criticalSuccess.image) {
                return this.extendFormats.criticalSuccess.image;
            }
            
            return null;
        },
        
        isChannelCollapsed(channel) {
            if (this.channelRules[channel] && this.channelRules[channel].collapsed !== undefined) {
                return this.channelRules[channel].collapsed;
            }
            
            if (this.globalChannelSettings && this.globalChannelSettings.collapsedChannels && 
                this.globalChannelSettings.collapsedChannels[channel] !== undefined) {
                return this.globalChannelSettings.collapsedChannels[channel];
            }
            
            if (this.globalChannelSettings && this.globalChannelSettings.autoCollapseOther && this.isNonMainChannel(channel)) {
                return true;
            }
            
            return false;
        },
        
        toggleChannelCollapse(channel) {
            if (!this.collapsedChannels[channel]) {
                this.collapsedChannels[channel] = {};
            }
            
            this.collapsedChannels[channel] = !this.isChannelCollapsed(channel);
        },
        
        isMessageHighlighted(msg) {
            if (!this.searchQuery) return false;
            const query = this.searchQuery.toLowerCase();
            return msg.text.toLowerCase().includes(query) ||
                   msg.name.toLowerCase().includes(query);
        },
        
        toggleCharacterFilter(character) {
            const index = this.selectedCharacters.indexOf(character);
            if (index === -1) {
                this.selectedCharacters.push(character);
            } else {
                this.selectedCharacters.splice(index, 1);
            }
        },
        
        removeCharacterFilter(character) {
            const index = this.selectedCharacters.indexOf(character);
            if (index !== -1) {
                this.selectedCharacters.splice(index, 1);
            }
        },
        
        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
        },
        
        toggleFilterDropdown() {
            this.showFilterPanel = !this.showFilterPanel;
        },
        
        applyFilters() {
            this.currentPage = 1;
            this.showFilterPanel = false;
        },
        
        clearFilters() {
            this.selectedCharacters = [];
            this.selectedChannels = [];
            this.dateRange = { start: '', end: '' };
            this.currentPage = 1;
        },
        
        clearSearch() {
            this.searchQuery = '';
        },
        
        clearAllFilters() {
            this.clearFilters();
            this.clearSearch();
        },
        
        performSearch() {
            this.currentPage = 1;
        },
        
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
        
        previewImage(imageUrl) {
            this.previewImageUrl = imageUrl;
            this.showImagePreview = true;
        },
        
        closeImagePreview() {
            this.showImagePreview = false;
            this.previewImageUrl = '';
        },
        
        scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        
        scrollToBottom() {
            window.scrollTo({ 
                top: document.documentElement.scrollHeight, 
                behavior: 'smooth' 
            });
        },
        
        formatTime(timeString) {
            if (!timeString) return '';
            
            try {
                const date = new Date(timeString);
                if (isNaN(date.getTime())) {
                    return timeString;
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
        
        hexToRgba(hex, opacity) {
            if (!hex) {
                return `rgba(255, 255, 255, ${opacity})`;
            }
            
            if (hex.startsWith('rgba')) {
                return hex;
            }
            
            hex = hex.replace(/^#/, '');
            
            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        },
        
        setupEventListeners() {
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.filter-dropdown')) {
                    this.showFilterPanel = false;
                }
            });
            
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeImagePreview();
                }
            });
        }
    }
}).mount('#app');
