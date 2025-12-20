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
            collapsedChannels: {}
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
            return this.startIndex + this.pageSize;
        },
        
        // 当前页的消息（已筛选）
        paginatedLogs() {
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
                    (msg.dice && msg.dice.toLowerCase().includes(query))
                );
            }
            
            // 分页
            if (this.viewMode === 'paginated') {
                return filtered.slice(this.startIndex, this.endIndex);
            }
            
            return filtered;
        },
        
        // 角色列表
        characterList() {
            const characters = new Set();
            this.logs.forEach(msg => {
                if (msg.name && msg.name.toLowerCase() !== 'system') {
                    characters.add(msg.name);
                }
            });
            return Array.from(characters).sort();
        },
        
        // 频道列表
        channelList() {
            const channels = new Set();
            this.logs.forEach(msg => {
                if (msg.channel) {
                    channels.add(msg.channel);
                }
            });
            return Array.from(channels).sort();
        },
        
        // 频道分组（保持你原来的逻辑）
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
            const urlParams = new URLSearchParams(window.location.search);
            const logFile = urlParams.get('log') || 'data/log-demo.json';
            
            try {
                const response = await fetch(logFile);
                const data = await response.json();
                
                // 导入数据
                this.title = data.title || '未命名模组';
                this.date = data.date || new Date().toISOString().split('T')[0];
                this.logs = this.processLogArray(data.logs || []);
                
                // 导入设置
                this.fontSettings = data.fontSettings || {};
                this.systemSettings = data.systemSettings || {};
                this.chapterSettings = data.chapterSettings || {};
                this.channelRules = data.channelRules || {};
                this.characterRules = data.characterRules || {};
                this.globalChannelSettings = data.globalChannelSettings || {};
                this.defaultChannelRule = data.defaultChannelRule || {};
                this.defaultCharacterRule = data.defaultCharacterRule || {};
                this.extendFormats = data.extendFormats || {};
                
                // 章节数据
                this.chapters = data.chapters || [];
                
                // 计算总页数
                this.totalPages = Math.ceil(this.logs.length / this.pageSize);
                
                console.log('日志加载成功:', this.logs.length, '条消息');
            } catch (error) {
                console.error('加载日志失败:', error);
                alert('加载日志失败，请检查文件路径和格式');
            }
        },
        
        // 处理日志数组
        processLogArray(logArray) {
            return logArray.map((log, index) => ({
                ...log,
                id: log.id || `msg-${Date.now()}-${index}`,
                channel: log.channel || '默认频道',
                name: log.name || '未知角色',
                isChapter: log.isChapter || false
            }));
        },
        
        // 获取系统消息频道
        getSystemMessageChannel(msg) {
            if (msg.isChapter) return '系统';
            
            const msgIndex = this.logs.findIndex(log => log.id === msg.id);
            if (msgIndex === -1) return '系统';
            
            for (let i = msgIndex - 1; i >= 0; i--) {
                const prevMsg = this.logs[i];
                if (prevMsg.name.toLowerCase() === 'system') continue;
                
                const prevChannel = prevMsg.channel || '默认频道';
                if (!this.isNonMainChannel(prevChannel)) {
                    return prevChannel;
                }
            }
            
            return '系统';
        },
        
        // 判断是否为非主频道
        isNonMainChannel(channel) {
            const otherChannels = ['闲聊', 'other', '其他', '聊天', '杂谈', '闲谈'];
            return otherChannels.some(otherChannel => 
                channel.toLowerCase().includes(otherChannel.toLowerCase()));
        },
        
        // 章节相关方法
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
            
            // 应用克苏鲁风格的章节样式
            style.background = 'linear-gradient(135deg, rgba(139, 0, 0, 0.1), rgba(26, 26, 46, 0.8))';
            style.border = '1px solid rgba(139, 0, 0, 0.3)';
            style.textShadow = '0 0 10px rgba(139, 0, 0, 0.3)';
            
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
            
            // 应用克苏鲁风格的背景
            style.background = rule && rule.color 
                ? `rgba(${this.hexToRgb(rule.color)}, 0.05)`
                : 'rgba(26, 26, 46, 0.3)';
            style.border = '1px solid rgba(45, 45, 66, 0.5)';
            
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
            
            // 克苏鲁风格覆盖
            style.color = style.color || '#e6e6e6';
            style.textShadow = '0 0 5px rgba(139, 0, 0, 0.3)';
            
            return style;
        },
        
        // 角色名字体样式
        getCharacterNameStyle(characterName) {
            const style = {};
            
            if (this.fontSettings.characterName) {
                style.fontFamily = this.fontSettings.characterName;
            }
            
            // 从规则或默认获取颜色
            const rule = this.characterRules[characterName];
            const nameColor = rule && rule.nameColor 
                ? rule.nameColor 
                : (this.defaultCharacterRule.nameColor || '#e6e6e6');
            
            style.color = nameColor;
            
            return style;
        },
        
        // 气泡样式
        getBubbleStyle(characterName) {
            const rule = this.characterRules[characterName];
            const style = {};
            
            if (rule && rule.bubbleColor) {
                style.background = `rgba(${this.hexToRgb(rule.bubbleColor)}, 0.1)`;
                style.border = `1px solid rgba(${this.hexToRgb(rule.bubbleColor)}, 0.3)`;
            } else {
                style.background = 'rgba(26, 26, 46, 0.5)';
                style.border = '1px solid rgba(45, 45, 66, 0.5)';
            }
            
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
            
            return style;
        },
        
        // 骰子样式
        getDiceStyle(msg) {
            const style = {};
            
            // 获取骰子结果类型
            const resultType = this.getExtendResultType(msg);
            
            // 根据结果类型设置颜色
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
            
            return style;
        },
        
        // 获取骰子文本
        getDiceText(msg) {
            if (msg.extend) {
                try {
                    const parsed = JSON.parse(msg.extend);
                    if (parsed && parsed.roll && parsed.roll.result) {
                        return parsed.roll.result;
                    }
                    return msg.extend;
                } catch (e) {
                    return msg.extend;
                }
            }
            return msg.dice || '';
        },
        
        // 获取extend结果类型
        getExtendResultType(msg) {
            const extendText = this.getDiceText(msg);
            if (!extendText) return 'normal';
            
            const text = extendText.toLowerCase();
            
            if (text.includes('大失败')) return 'criticalFailure';
            if (text.includes('大成功')) return 'criticalSuccess';
            if (text.endsWith('成功')) return 'success';
            if (text.endsWith('失败')) return 'failure';
            
            return 'normal';
        },
        
        // 检查频道是否折叠
        isChannelCollapsed(channel) {
            return this.collapsedChannels[channel] || false;
        },
        
        // 切换频道折叠
        toggleChannelCollapse(channel) {
            this.collapsedChannels[channel] = !this.collapsedChannels[channel];
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
            const date = new Date(timeString);
            return date.toLocaleTimeString('zh-CN', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        },
        
        // HEX转RGB
        hexToRgb(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? 
                `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` 
                : '139, 0, 0';
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
