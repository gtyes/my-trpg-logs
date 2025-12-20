const { createApp } = Vue;

createApp({
    data() {
        return {
            // 日志数据
            logData: null,
            logs: [],
            chapters: [],
            
            // 显示设置
            showChapterNav: true,
            showFilterPanel: false,
            showImageModal: false,
            modalImageUrl: '',
            
            // 分页
            currentPage: 1,
            pageSize: 20,
            
            // 搜索和筛选
            searchKeyword: '',
            filters: {
                characters: [],
                channels: [],
                types: []
            },
            
            // 从URL获取的日志文件名
            logFile: ''
        };
    },
    computed: {
        // 日志信息
        logTitle() {
            return this.logData?.title || 'TRPG跑团日志';
        },
        
        logDate() {
            return this.logData?.date || '';
        },
        
        totalMessages() {
            return this.logs.length;
        },
        
        // 角色和频道列表
        characterList() {
            const characters = new Set();
            this.logs.forEach(log => {
                if (log.name && log.name.toLowerCase() !== 'system' && !log.isChapter) {
                    characters.add(log.name);
                }
            });
            return Array.from(characters).sort();
        },
        
        channelList() {
            const channels = new Set();
            this.logs.forEach(log => {
                if (log.channel) {
                    channels.add(log.channel);
                }
            });
            return Array.from(channels).sort();
        },
        
        // 分页计算
        totalPages() {
            return Math.ceil(this.filteredMessages.length / this.pageSize);
        },
        
        startIndex() {
            return (this.currentPage - 1) * this.pageSize;
        },
        
        endIndex() {
            return this.startIndex + this.pageSize;
        },
        
        // 当前页的消息
        paginatedMessages() {
            return this.filteredMessages.slice(this.startIndex, this.endIndex);
        },
        
        // 按频道分组
        filteredGroups() {
            const groups = [];
            let currentGroup = null;
            
            this.paginatedMessages.forEach(msg => {
                // 处理章节消息
                if (msg.isChapter) {
                    if (currentGroup) {
                        groups.push(currentGroup);
                    }
                    currentGroup = {
                        channel: '系统',
                        messages: [msg]
                    };
                    groups.push(currentGroup);
                    currentGroup = null;
                } else {
                    const channel = msg.channel || '默认频道';
                    
                    if (!currentGroup || channel !== currentGroup.channel) {
                        if (currentGroup) {
                            groups.push(currentGroup);
                        }
                        currentGroup = {
                            channel: channel,
                            messages: [msg]
                        };
                    } else {
                        currentGroup.messages.push(msg);
                    }
                }
            });
            
            if (currentGroup) {
                groups.push(currentGroup);
            }
            
            return groups;
        },
        
        // 筛选后的消息
        filteredMessages() {
            return this.logs.filter(msg => {
                // 搜索筛选
                if (this.searchKeyword) {
                    const keyword = this.searchKeyword.toLowerCase();
                    const textMatch = msg.text?.toLowerCase().includes(keyword);
                    const nameMatch = msg.name?.toLowerCase().includes(keyword);
                    if (!textMatch && !nameMatch) {
                        return false;
                    }
                }
                
                // 角色筛选
                if (this.filters.characters.length > 0 && msg.name) {
                    if (!this.filters.characters.includes(msg.name)) {
                        return false;
                    }
                }
                
                // 频道筛选
                if (this.filters.channels.length > 0 && msg.channel) {
                    if (!this.filters.channels.includes(msg.channel)) {
                        return false;
                    }
                }
                
                // 类型筛选
                if (this.filters.types.length > 0) {
                    const msgType = this.getMessageType(msg);
                    if (!this.filters.types.includes(msgType)) {
                        return false;
                    }
                }
                
                return true;
            });
        },
        
        // 当前章节索引
        currentChapterIndex() {
            if (!this.chapters.length) return 0;
            
            const currentMessageIndex = (this.currentPage - 1) * this.pageSize;
            for (let i = this.chapters.length - 1; i >= 0; i--) {
                if (currentMessageIndex >= this.chapters[i].startIndex) {
                    return i;
                }
            }
            return 0;
        },
        
        // 当前章节
        currentChapter() {
            return this.chapters[this.currentChapterIndex];
        },
        
        // 章节内的页码
        currentPageInChapter() {
            if (!this.currentChapter) return 1;
            
            const chapterStart = this.currentChapter.startIndex;
            const currentIndex = (this.currentPage - 1) * this.pageSize;
            return Math.floor((currentIndex - chapterStart) / this.pageSize) + 1;
        },
        
        // 章节总页数
        chapterTotalPages() {
            if (!this.currentChapter) return 1;
            return Math.ceil(this.currentChapter.messageCount / this.pageSize);
        },
        
        // 活跃筛选数量
        activeFiltersCount() {
            let count = 0;
            count += this.filters.characters.length;
            count += this.filters.channels.length;
            count += this.filters.types.length;
            return count;
        },
        
        // 是否有活跃筛选
        hasActiveFilters() {
            return this.activeFiltersCount > 0 || this.searchKeyword;
        }
    },
    methods: {
        // 初始化
        async init() {
            // 从URL获取日志文件参数
            const urlParams = new URLSearchParams(window.location.search);
            this.logFile = urlParams.get('log') || 'log_001.json';
            
            await this.loadLogData();
            this.processChapters();
        },
        
        // 加载日志数据
        async loadLogData() {
            try {
                const response = await fetch(`data/${this.logFile}`);
                this.logData = await response.json();
                
                // 处理日志数组
                this.logs = this.logData.logs.map((log, index) => ({
                    ...log,
                    id: log.id || `msg-${index}`,
                    // 确保必要的字段存在
                    channel: log.channel || '默认频道',
                    name: log.name || '未知角色',
                    text: log.text || '',
                    isChapter: log.isChapter || false
                }));
                
                console.log(`成功加载 ${this.logs.length} 条消息`);
            } catch (error) {
                console.error('加载日志数据失败:', error);
                alert('无法加载日志数据，请检查文件是否存在');
            }
        },
        
        // 处理章节
        processChapters() {
            this.chapters = [];
            let currentChapter = null;
            let chapterIndex = 0;
            
            // 首先查找所有章节消息
            const chapterMessages = this.logs.filter(msg => msg.isChapter);
            
            // 为每个章节创建章节对象
            chapterMessages.forEach((chapterMsg, index) => {
                const chapter = {
                    id: chapterMsg.id,
                    title: chapterMsg.text.replace('=== ', '').replace(' ===', ''),
                    startIndex: this.logs.findIndex(msg => msg.id === chapterMsg.id),
                    messageCount: 0
                };
                
                // 计算该章节的消息数量
                const nextChapterIndex = chapterMessages[index + 1] ? 
                    this.logs.findIndex(msg => msg.id === chapterMessages[index + 1].id) : 
                    this.logs.length;
                
                chapter.messageCount = nextChapterIndex - chapter.startIndex;
                
                this.chapters.push(chapter);
            });
            
            // 如果没有章节，创建一个默认章节
            if (this.chapters.length === 0) {
                this.chapters.push({
                    id: 'default-chapter',
                    title: '完整的冒险',
                    startIndex: 0,
                    messageCount: this.logs.length
                });
            }
            
            console.log(`识别到 ${this.chapters.length} 个章节`);
        },
        
        // 获取消息类型
        getMessageType(msg) {
            if (msg.name?.toLowerCase() === 'system') return 'system';
            if (msg.dice || msg.extend) return 'dice';
            return 'normal';
        },
        
        // 搜索
        performSearch() {
            this.currentPage = 1;
        },
        
        clearSearch() {
            this.searchKeyword = '';
        },
        
        // 筛选
        toggleFilterPanel() {
            this.showFilterPanel = !this.showFilterPanel;
        },
        
        applyFilters() {
            this.showFilterPanel = false;
            this.currentPage = 1;
        },
        
        resetFilters() {
            this.searchKeyword = '';
            this.filters = {
                characters: [],
                channels: [],
                types: []
            };
            this.currentPage = 1;
        },
        
        removeFilter(filterType) {
            this.filters[filterType] = [];
            this.currentPage = 1;
        },
        
        // 章节导航
        toggleChapterNav() {
            this.showChapterNav = !this.showChapterNav;
        },
        
        jumpToChapter(chapterIndex) {
            if (chapterIndex >= 0 && chapterIndex < this.chapters.length) {
                const chapter = this.chapters[chapterIndex];
                const pageNumber = Math.floor(chapter.startIndex / this.pageSize) + 1;
                this.currentPage = pageNumber;
                
                // 滚动到顶部
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        },
        
        // 分页
        prevPage() {
            if (this.currentPage > 1) {
                this.currentPage--;
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        },
        
        nextPage() {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        },
        
        jumpToPage() {
            if (this.jumpPage >= 1 && this.jumpPage <= this.totalPages) {
                this.currentPage = this.jumpPage;
                window.scrollTo({ top: 0, behavior: 'smooth' });
                this.jumpPage = null;
            }
        },
        
        // 图片处理
        showImageModal(imageUrl) {
            this.modalImageUrl = imageUrl;
            this.showImageModal = true;
        },
        
        closeImageModal() {
            this.showImageModal = false;
            this.modalImageUrl = '';
        },
        
        handleImageError(event) {
            event.target.style.display = 'none';
        },
        
        // 工具函数
        formatTime(timeString) {
            if (!timeString) return '';
            
            try {
                const date = new Date(timeString);
                return date.toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (e) {
                return timeString;
            }
        },
        
        // 获取章节样式（从编辑器导出的设置）
        getChapterStyle(chapterMsg) {
            // 这里可以应用从JSON中加载的章节设置
            if (this.logData?.chapterSettings) {
                const settings = this.logData.chapterSettings;
                const style = {};
                
                if (settings.fontFamily) style.fontFamily = settings.fontFamily;
                if (settings.color) style.color = settings.color;
                if (settings.fontSize) style.fontSize = `${settings.fontSize}px`;
                if (settings.bold) style.fontWeight = 'bold';
                
                // 背景
                if (settings.useImage && settings.image) {
                    style.backgroundImage = `url(${settings.image})`;
                    style.backgroundSize = settings.imageSize || 'cover';
                    style.opacity = settings.imageOpacity || 1;
                } else if (settings.backgroundColor) {
                    style.backgroundColor = settings.backgroundColor;
                    style.opacity = settings.backgroundOpacity || 0.9;
                }
                
                return style;
            }
            
            // 默认样式
            return {
                background: 'linear-gradient(135deg, #3498db, #2c3e50)',
                color: 'white',
                padding: '30px',
                textAlign: 'center',
                fontSize: '24px',
                fontWeight: 'bold',
                borderRadius: '8px',
                marginBottom: '30px'
            };
        }
    },
    
    mounted() {
        this.init();
        
        // 监听URL变化
        window.addEventListener('popstate', () => {
            const urlParams = new URLSearchParams(window.location.search);
            const newLogFile = urlParams.get('log');
            if (newLogFile && newLogFile !== this.logFile) {
                this.logFile = newLogFile;
                this.init();
            }
        });
    }
}).mount('#log-viewer');
