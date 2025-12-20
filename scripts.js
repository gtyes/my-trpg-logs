// 通用功能脚本

// 首页卡片点击事件
document.addEventListener('DOMContentLoaded', function() {
    // 卡片点击效果
    const cards = document.querySelectorAll('.log-card');
    cards.forEach(card => {
        card.addEventListener('click', function(e) {
            if (!e.target.closest('.card-footer')) {
                const logFile = this.dataset.logFile;
                window.location.href = `log-viewer.html?log=${logFile}`;
            }
        });
    });
    
    // 添加新卡片功能
    const addCard = document.querySelector('.add-new-card');
    if (addCard) {
        addCard.addEventListener('click', function() {
            alert('上传功能开发中...');
            // 未来可以添加文件上传功能
        });
    }
    
    // 卡片悬停效果增强
    cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
            this.style.boxShadow = '0 20px 40px rgba(139, 0, 0, 0.3)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.6)';
        });
    });
});

// 页面加载动画
window.addEventListener('load', function() {
    // 添加淡入效果
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease';
    
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});

// 返回顶部功能
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// 检测滚动显示返回顶部按钮
window.addEventListener('scroll', function() {
    const scrollBtn = document.querySelector('.scroll-to-top');
    if (scrollBtn) {
        if (window.scrollY > 300) {
            scrollBtn.style.display = 'block';
        } else {
            scrollBtn.style.display = 'none';
        }
    }
});
