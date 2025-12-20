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
            errorMessage: '',
            rawJsonText: '' // 用于调试
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
                    msg.name.toLowerCase().includes(query)
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
                
                if (msg.name.toLowerCase() === 'system' && !msg.isChapter) {
                    msgChannel = this.getSystemMessageChannel(msg);
                }
                
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
            return count;
        },
        
        isFiltered() {
            return this.activeFiltersCount > 0;
        },
        
        characterCount() {
            return this.characterList.length;
        }
    },
    mounted() {
        this.loadLogData();
    },
    methods: {
        // 调试方法：显示JSON内容
        showJsonContent() {
            alert('JSON文件内容（前2000字符）：\n\n' + this.rawJsonText.substring(0, 2000));
        },
        
        // 测试本地JSON文件
        testLocalJson() {
            // 尝试不同的可能路径
            const testPaths = [
                'data/log001.json',
                './data/log001.json',
                '/data/log001.json',
                'log001.json',
                './log001.json'
            ];
            
            testPaths.forEach(path => {
                console.log('测试路径:', path);
                fetch(path)
                    .then(response => {
                        console.log(`${path}: ${response.status} ${response.statusText}`);
                        if (response.ok) {
                            return response.text();
                        }
                        return null;
                    })
                    .then(text => {
                        if (text) {
                            console.log(`${path}: 成功加载，长度: ${text.length} 字符`);
                        }
                    })
                    .catch(error => {
                        console.error(`${path}: 加载失败`, error);
                    });
            });
        },
        
        async loadLogData() {
            this.isLoading = true;
            this.errorMessage = '';
            
            try {
                const urlParams = new URLSearchParams(window.location.search);
                let logFile = urlParams.get('log');
                
                // 如果没有指定log参数，使用默认
                if (!logFile) {
                    logFile = 'data/log001.json';
                }
                
                console.log('正在加载日志文件:', logFile);
                
                // 先尝试用text方式获取，方便调试
                const response = await fetch(logFile);
                
                if (!response.ok) {
                    throw new Error(`HTTP错误 ${response.status}: ${response.statusText} - 请检查文件路径是否正确`);
                }
                
                // 获取原始文本内容
                const text = await response.text();
                this.rawJsonText = text;
                
                console.log('JSON文件原始文本长度:', text.length);
                console.log('JSON文件前500字符:', text.substring(0, 500));
                
                if (!text || text.trim().length === 0) {
                    throw new Error('JSON文件为空或内容不正确');
                }
                
                // 尝试解析JSON
                let data;
                try {
                    data = JSON.parse(text);
                } catch (parseError) {
                    console.error('JSON解析错误:', parseError);
                    console.error('问题位置附近的内容:', text.substring(Math.max(0, parseError.message.match(/position (\d+)/)?.[1] - 100 || 0), 200));
                    throw new Error(`JSON解析错误: ${parseError.message}\n请确保文件是完整的JSON格式`);
                }
                
                console.log('JSON解析成功，数据结构:', {
                    hasLogs: Array.isArray(data.logs),
                    logsLength: data.logs ? data.logs.length : '无logs字段',
                    dataKeys: Object.keys(data)
                });
                
                // 导入数据
                this.title = data.title || '未命名模组';
                this.date = data.date || new Date().toISOString().split('T')[0];
                
                // 处理日志数组
                if (Array.isArray(data.logs)) {
                    this.logs = this.processLogArray(data.logs);
                } else if (Array.isArray(data)) {
                    // 如果data本身就是数组
                    this.logs = this.processLogArray(data);
                } else {
                    throw new Error('日志数据格式不正确：找不到logs数组');
                }
                
                // 导入设置
                this.fontSettings = data.fontSettings || this.getDefaultFontSettings();
                this.systemSettings = data.systemSettings || this.getDefaultSystemSettings();
                this.chapterSettings = data.chapterSettings || this.getDefaultChapterSettings();
                this.channelRules = data.channelRules || {};
                this.characterRules = data.characterRules || {};
                this.globalChannelSettings = data.globalChannelSettings || {};
                this.defaultChannelRule = data.defaultChannelRule || this.getDefaultChannelRule();
                this.defaultCharacterRule = data.defaultCharacterRule || this.getDefaultCharacterRule();
                this.extendFormats = data.extendFormats || this.getDefaultExtendFormats();
                
                // 章节数据
                this.chapters = data.chapters || this.extractChaptersFromLogs();
                
                // 计算总页数
                this.totalPages = Math.max(1, Math.ceil(this.logs.length / this.pageSize));
                
                console.log('日志加载成功:', {
                    标题: this.title,
                    日期: this.date,
                    消息数: this.logs.length,
                    页数: this.totalPages,
                    章节数: this.chapters.length,
                    角色数: this.characterList.length,
                    频道数: this.channelList.length
                });
                
                this.isLoading = false;
                
            } catch (error) {
                console.error('加载日志失败详情:', error);
                console.error('错误堆栈:', error.stack);
                
                this.errorMessage = `加载日志失败：${error.message}`;
                this.isLoading = false;
                
                // 显示更详细的错误信息
                setTimeout(() => {
                    alert(`加载失败！\n\n错误：${error.message}\n\n请检查：\n1. 文件路径是否正确\n2. JSON文件是否完整\n3. 打开浏览器控制台(F12)查看详细错误`);
                }, 100);
            }
        },
        
        getDefaultFontSettings() {
            return {
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
        },
        
        getDefaultSystemSettings() {
            return {
                fontFamily: 'Consolas, Monaco, monospace',
                color: '#7f8c8d',
                fontSize: 12,
                italic: false,
                bold: false,
                underline: false,
                prefix: 'system:'
            };
        },
        
        getDefaultChapterSettings() {
            return {
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
        },
        
        getDefaultChannelRule() {
            return {
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
        },
        
        getDefaultCharacterRule() {
            return {
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
        },
        
        getDefaultExtendFormats() {
            return {
                success: { color: '#27ae60', fontFamily: '', fontSize: 13, bold: true },
                failure: { color: '#e74c3c', fontFamily: '', fontSize: 13, bold: true },
                criticalFailure: { color: '#c0392b', fontFamily: '', fontSize: 14, bold: true, image: '', imageOpacity: 1.0 },
                criticalSuccess: { color: '#f39c12', fontFamily: '', fontSize: 14, bold: true, image: '', imageOpacity: 1.0 }
            };
        },
        
        processLogArray(logArray) {
            if (!Array.isArray(logArray)) {
                console.error('logArray不是数组:', logArray);
                return [];
            }
            
            return logArray.map((log, index) => {
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
        
        extractChaptersFromLogs() {
            const chapters = [];
            
            this.logs.forEach((msg, index) => {
                if (msg.isChapter || 
                    (msg.name.toLowerCase() === 'system' && 
                     msg.text && 
                     msg.text.includes('==='))) {
                    
                    const chapterName = msg.text.replace(/===/g, '').trim();
                    
                    chapters.push({
                        id: msg.id || `chapter-${index}`,
                        name: chapterName || `章节 ${chapters.length + 1}`,
                        position: index + 1,
                        page: Math.floor(index / this.pageSize) + 1
                    });
                }
            });
            
            return chapters;
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
        
        getChapterStyle(chapterMsg) {
            const style = {};
            
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
        
        jumpToChapter(chapter) {
            const chapterIndex = this.logs.findIndex(msg => msg.id === chapter.id);
            if (chapterIndex !== -1) {
                const targetPage = Math.floor(chapterIndex / this.pageSize) + 1;
                this.currentPage = targetPage;
                this.scrollToTop();
            }
        },
        
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
            
            if (!style.backgroundColor && !style.backgroundImage) {
                const opacity = this.defaultChannelRule.opacity !== undefined ? this.defaultChannelRule.opacity : 0.1;
                style.backgroundColor = this.hexToRgba(this.defaultChannelRule.color || '#2c3e50', opacity);
            }
            
            style.border = '1px solid rgba(45, 45, 66, 0.5)';
            style.borderRadius = '8px';
            
            return style;
        },
        
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
        
        getCharacterNameStyle(characterName) {
            const style = {};
            
            if (this.fontSettings.characterName) {
                style.fontFamily = this.fontSettings.characterName;
            }
            if (this.fontSettings.characterNameSize) {
                style.fontSize = `${this.fontSettings.characterNameSize}px`;
            }
            
            const rule = this.characterRules[characterName];
            let nameColor = '#e6e6e6';
            
            if (rule && rule.nameColor) {
                nameColor = rule.nameColor;
            } else {
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
            
            if (!style.backgroundColor && !style.backgroundImage) {
                const opacity = this.defaultCharacterRule.bubbleOpacity !== undefined ? this.defaultCharacterRule.bubbleOpacity : 0.85;
                style.backgroundColor = this.hexToRgba(this.defaultCharacterRule.bubbleColor || '#ffffff', opacity);
            }
            
            style.border = '1px solid rgba(45, 45, 66, 0.5)';
            style.borderRadius = '8px';
            style.padding = '1rem';
            style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
            style.maxWidth = '600px';
            
            return style;
        },
        
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
        
        getDiceStyle(msg) {
            const style = {};
            
            style.display = 'flex';
            style.alignItems = 'center';
            style.gap = '0.75rem';
            style.marginTop = '1rem';
            style.padding = '0.75rem';
            style.borderRadius = '6px';
            
            const resultType = this.getExtendResultType(msg);
            const format = this.extendFormats[resultType] || {};
            
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
            
            if (this.fontSettings.extendText) {
                style.fontFamily = this.fontSettings.extendText;
            }
            if (this.fontSettings.extendTextColor && resultType === 'normal') {
                style.color = this.fontSettings.extendTextColor;
            }
            if (this.fontSettings.extendTextSize) {
                style.fontSize = `${this.fontSettings.extendTextSize}px`;
            }
            
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
        
        getExtendResultType(msg) {
            const extendText = this.getDiceText(msg);
            if (!extendText) return 'normal';
            
            let text = extendText;
            
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
        
        isChannelCollapsed(channel) {
            if (this.channelRules[channel] && this.channelRules[channel].collapsed !== undefined) {
                return this.channelRules[channel].collapsed;
            }
            
            if (this.globalChannelSettings.collapsedChannels && 
                this.globalChannelSettings.collapsedChannels[channel] !== undefined) {
                return this.globalChannelSettings.collapsedChannels[channel];
            }
            
            if (this.globalChannelSettings.autoCollapseOther && this.isNonMainChannel(channel)) {
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
        
        isCharacterActive(character) {
            return this.selectedCharacters.includes(character);
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
        }
    }
}).mount('#app');
