(function() {
    const bgContainer = document.getElementById('bgWords');
    if (!bgContainer) return;

    const placedWords = [];

    function spawnWord() {
        const word = document.createElement('div');
        word.className = 'bg-word';

        const text = dictionary[Math.floor(Math.random() * dictionary.length)];
        word.textContent = text;

        const size = Math.random() * 1.8 + 1.4;
        const w = text.length * size * 18 + 80;
        const h = size * 50 + 40;

        let x, y, safe = false, tries = 0;

        while (!safe && tries < 500) {
            x = Math.random() * (window.innerWidth - w);
            y = Math.random() * (window.innerHeight - h);
            safe = true;

            for (const p of placedWords) {
                const pad = 60;
                const overlap = !(
                    x + w + pad < p.x ||
                    x > p.x + p.w + pad ||
                    y + h + pad < p.y ||
                    y > p.y + p.h + pad
                );
                if (overlap) {
                    safe = false;
                    break;
                }
            }
            tries++;
        }

        if (!safe) {
            setTimeout(spawnWord, 1500);
            return;
        }

        placedWords.push({ x, y, w, h });

        const rotate = Math.random() * 20 - 10;
        const opacity = Math.random() * 0.03 + 0.03;
        const life = Math.random() * 15000 + 12000;

        word.style.left = x + 'px';
        word.style.top = y + 'px';
        word.style.fontSize = size + 'rem';
        word.style.setProperty('--rotate', rotate + 'deg');
        word.style.setProperty('--opacity', opacity);

        bgContainer.appendChild(word);

        setTimeout(() => {
            word.classList.add('visible');
        }, 80);

        setTimeout(() => {
            word.classList.remove('visible');
            setTimeout(() => {
                word.remove();
                const i = placedWords.findIndex(p => p.x === x && p.y === y);
                if (i !== -1) placedWords.splice(i, 1);
                spawnWord();
            }, 3800);
        }, life);
    }

    for (let i = 0; i < 18; i++) {
        spawnWord();
    }

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            bgContainer.innerHTML = '';
            placedWords.length = 0;
            for (let i = 0; i < 18; i++) {
                spawnWord();
            }
        }, 500);
    });
})();