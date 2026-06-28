(function() {
    const audio = new Audio();
    let isPlaying = false;
    let currentTrackIndex = -1;
    let playlist = [];
    let shuffleMode = false;
    let loopMode = 2; // 0=off, 1=one, 2=all
    let isHidden = false;

    const playBtn = document.getElementById('playBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const rewindBtn = document.getElementById('rewindBtn');
    const forwardBtn = document.getElementById('forwardBtn');
    const shuffleBtn = document.getElementById('shuffleBtn');
    const loopBtn = document.getElementById('loopBtn');
    const loadBtn = document.getElementById('loadBtn');
    const loadMenu = document.getElementById('loadMenu');
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    const progressBar = document.getElementById('progressBar');
    const volumeBar = document.getElementById('volumeBar');
    const trackTitle = document.getElementById('trackTitle');
    const currentTimeEl = document.getElementById('currentTime');
    const durationTimeEl = document.getElementById('durationTime');
    const playlistContainer = document.getElementById('playlistContainer');
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');
    const loopIcon = document.getElementById('loopIcon');
    const shuffleIcon = document.getElementById('shuffleIcon');
    const coverImage = document.getElementById('coverArt');
    const coverPlaceholder = document.getElementById('coverPlaceholder');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalPlaylistContainer = document.getElementById('modalPlaylistContainer');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const eyeBtn = document.getElementById('eyeBtn');
    const eyeIcon = document.getElementById('eyeIcon');

    let audioCtx = null;
    let analyser = null;
    let source = null;
    let animationId = null;

    function loadSettings() {
        try {
            const saved = localStorage.getItem('playerSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.volume !== undefined) {
                    audio.volume = settings.volume;
                    volumeBar.value = settings.volume;
                }
                if (settings.shuffle !== undefined) {
                    shuffleMode = settings.shuffle;
                }
                if (settings.loop !== undefined) {
                    loopMode = settings.loop;
                }
                updateButtons();
            }
        } catch (e) {}
    }

    function saveSettings() {
        try {
            localStorage.setItem('playerSettings', JSON.stringify({
                volume: audio.volume,
                shuffle: shuffleMode,
                loop: loopMode
            }));
        } catch (e) {}
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function extractVideoCover(file) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            const url = URL.createObjectURL(file);
            video.src = url;

            const cleanup = () => {
                video.pause();
                video.src = '';
                video.load();
                URL.revokeObjectURL(url);
            };

            let resolved = false;

            const onLoaded = () => {
                if (resolved) return;
                resolved = true;
                requestAnimationFrame(() => {
                    try {
                        const cv = document.createElement('canvas');
                        cv.width = video.videoWidth || 320;
                        cv.height = video.videoHeight || 180;
                        const c = cv.getContext('2d');
                        c.drawImage(video, 0, 0, cv.width, cv.height);
                        cv.toBlob((blob) => {
                            if (blob) {
                                const coverUrl = URL.createObjectURL(blob);
                                cleanup();
                                resolve(coverUrl);
                            } else {
                                cleanup();
                                resolve(null);
                            }
                        }, 'image/jpeg', 0.8);
                    } catch (e) {
                        cleanup();
                        resolve(null);
                    }
                });
            };

            video.addEventListener('loadeddata', onLoaded, { once: true });
            video.addEventListener('error', () => {
                if (!resolved) { resolved = true; cleanup(); resolve(null); }
            }, { once: true });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(null);
                }
            }, 5000);
        });
    }

    function extractCoverFromFile(file) {
        return new Promise((resolve) => {
            if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|avi|mkv|webm)$/i)) {
                extractVideoCover(file).then(resolve);
                return;
            }

            if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|flac|ogg|wav|m4a|aac)$/i)) {
                jsmediatags.read(file, {
                    onSuccess: (tag) => {
                        const picture = tag.tags.picture;
                        if (!picture || !picture.data || picture.data.length === 0) {
                            resolve(null);
                            return;
                        }

                        let mime = picture.format || 'image/jpeg';
                        if (mime === 'image/jpg') mime = 'image/jpeg';

                        let imageData;
                        try {
                            if (picture.data instanceof ArrayBuffer) {
                                imageData = new Uint8Array(picture.data);
                            } else if (picture.data instanceof Uint8Array) {
                                imageData = picture.data;
                            } else if (Array.isArray(picture.data)) {
                                imageData = new Uint8Array(picture.data);
                            } else {
                                imageData = new Uint8Array(picture.data);
                            }
                        } catch (e) {
                            resolve(null);
                            return;
                        }

                        try {
                            const blob = new Blob([imageData], { type: mime });
                            if (blob.size === 0) {
                                resolve(null);
                                return;
                            }
                            const url = URL.createObjectURL(blob);
                            resolve(url);
                        } catch (e) {
                            try {
                                let binary = '';
                                for (let i = 0; i < imageData.length; i++) {
                                    binary += String.fromCharCode(imageData[i]);
                                }
                                const base64 = btoa(binary);
                                const dataUrl = `data:${mime};base64,${base64}`;
                                resolve(dataUrl);
                            } catch (e2) {
                                resolve(null);
                            }
                        }
                    },
                    onError: () => { resolve(null); }
                });
            } else {
                resolve(null);
            }
        });
    }

    function setCover(url) {
        if (url) {
            coverImage.src = url;
            coverImage.style.display = 'block';
            coverPlaceholder.style.display = 'none';
            coverImage.classList.remove('show', 'fade-in');
            void coverImage.offsetWidth;
            coverImage.classList.add('show', 'fade-in');
            coverImage.onload = () => {};
            coverImage.onerror = () => {
                coverImage.style.display = 'none';
                coverPlaceholder.style.display = 'block';
                coverImage.classList.remove('show', 'fade-in');
            };
        } else {
            coverImage.src = '';
            coverImage.style.display = 'none';
            coverImage.classList.remove('show', 'fade-in');
            coverPlaceholder.style.display = 'block';
        }
    }

    function renderPlaylist() {
        playlistContainer.innerHTML = '';
        if (playlist.length === 0) return;
        let startIdx = currentTrackIndex >= 0 ? currentTrackIndex + 1 : 0;
        if (startIdx >= playlist.length) startIdx = 0;
        const endIdx = Math.min(startIdx + 3, playlist.length);
        for (let i = startIdx; i < endIdx; i++) {
            const track = playlist[i];
            const item = document.createElement('div');
            item.className = 'playlist-item' + (i === currentTrackIndex ? ' active' : '');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = track.name;
            const removeSpan = document.createElement('span');
            removeSpan.className = 'remove-track';
            removeSpan.textContent = '✕';
            removeSpan.onclick = (e) => {
                e.stopPropagation();
                removeTrack(i);
            };
            item.appendChild(nameSpan);
            item.appendChild(removeSpan);
            item.onclick = () => playTrack(i);
            playlistContainer.appendChild(item);
        }
        if (playlist.length > 3) {
            const toggle = document.createElement('div');
            toggle.className = 'playlist-toggle-item';
            toggle.textContent = 'SHOW ALL';
            toggle.onclick = openModal;
            playlistContainer.appendChild(toggle);
        }
    }

    function renderModalPlaylist() {
        modalPlaylistContainer.innerHTML = '';
        if (playlist.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'playlist-item';
            empty.textContent = 'NO TRACKS';
            empty.style.opacity = '0.3';
            modalPlaylistContainer.appendChild(empty);
            return;
        }
        playlist.forEach((track, idx) => {
            const item = document.createElement('div');
            item.className = 'playlist-item' + (idx === currentTrackIndex ? ' active' : '');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = track.name;
            const removeSpan = document.createElement('span');
            removeSpan.className = 'remove-track';
            removeSpan.textContent = '✕';
            removeSpan.onclick = (e) => {
                e.stopPropagation();
                removeTrack(idx);
                renderModalPlaylist();
            };
            item.appendChild(nameSpan);
            item.appendChild(removeSpan);
            item.onclick = () => {
                playTrack(idx);
                closeModal();
            };
            modalPlaylistContainer.appendChild(item);
        });
    }

    function openModal() {
        renderModalPlaylist();
        modalOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modalOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    function removeTrack(index) {
        if (index < 0 || index >= playlist.length) return;
        const wasCurrent = index === currentTrackIndex;
        const track = playlist[index];
        if (track.url) URL.revokeObjectURL(track.url);
        if (track.cover) URL.revokeObjectURL(track.cover);
        playlist.splice(index, 1);
        if (playlist.length === 0) {
            currentTrackIndex = -1;
            audio.pause();
            audio.src = '';
            trackTitle.textContent = 'DROP AUDIO FILE';
            isPlaying = false;
            setPlayIcon(false);
            progressBar.value = 0;
            currentTimeEl.textContent = '00:00';
            durationTimeEl.textContent = '00:00';
            setCover(null);
            if (modalOverlay.classList.contains('open')) renderModalPlaylist();
        } else if (wasCurrent) {
            const newIndex = Math.min(index, playlist.length - 1);
            loadTrack(newIndex);
        } else if (currentTrackIndex > index) {
            currentTrackIndex--;
        }
        renderPlaylist();
        if (modalOverlay.classList.contains('open')) renderModalPlaylist();
        updateButtons();
        saveSettings();
    }

    function addFiles(filesArray) {
        if (!filesArray || filesArray.length === 0) return;
        const fileArray = filesArray.filter(file => {
            return file.type.startsWith('audio/') ||
                   file.type.startsWith('video/') ||
                   file.name.match(/\.(mp4|m4a|mov|avi|mkv|webm)$/i);
        });
        if (fileArray.length === 0) return;

        trackTitle.textContent = 'LOADING...';

        const promises = fileArray.map(file => {
            return new Promise((resolve) => {
                const name = file.name.replace(/\.[^/.]+$/, '').toUpperCase();
                const url = URL.createObjectURL(file);
                extractCoverFromFile(file).then(coverUrl => {
                    resolve({ name, url, cover: coverUrl });
                }).catch(() => resolve({ name, url, cover: null }));
            });
        });

        Promise.all(promises).then(results => {
            playlist.push(...results);
            renderPlaylist();
            if (currentTrackIndex === -1 && playlist.length > 0) {
                loadTrack(0);
            }
            updateButtons();
            if (modalOverlay.classList.contains('open')) renderModalPlaylist();
            saveSettings();
            if (currentTrackIndex >= 0) {
                trackTitle.textContent = playlist[currentTrackIndex].name;
            } else {
                trackTitle.textContent = 'DROP AUDIO FILE';
            }
        });
    }

    function traverseDataTransferItems(items) {
        return new Promise((resolve) => {
            const files = [];
            const readEntry = (entry) => {
                return new Promise((resolveEntry) => {
                    if (entry.isFile) {
                        entry.file(file => { files.push(file); resolveEntry(); }, () => resolveEntry());
                    } else if (entry.isDirectory) {
                        const reader = entry.createReader();
                        const readEntries = () => {
                            reader.readEntries(entries => {
                                if (entries.length === 0) resolveEntry();
                                else Promise.all(entries.map(e => readEntry(e))).then(readEntries);
                            }, () => resolveEntry());
                        };
                        readEntries();
                    } else resolveEntry();
                });
            };
            const promises = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) promises.push(readEntry(entry));
                }
            }
            Promise.all(promises).then(() => resolve(files));
        });
    }

    function loadTrack(index) {
        if (index < 0 || index >= playlist.length) return;
        audio.pause();
        const track = playlist[index];
        currentTrackIndex = index;
        trackTitle.textContent = track.name;
        setCover(track.cover);
        audio.src = track.url;
        audio.load();
        progressBar.value = 0;
        currentTimeEl.textContent = '00:00';
        durationTimeEl.textContent = '00:00';
        isPlaying = false;
        setPlayIcon(false);
        renderPlaylist();
        if (modalOverlay.classList.contains('open')) renderModalPlaylist();
        updateButtons();
        audio.onerror = () => {
            trackTitle.textContent = 'ERROR: ' + track.name;
            console.error('Audio load error:', audio.error);
        };
    }

    function playTrack(index) {
        if (index < 0 || index >= playlist.length) return;
        if (index === currentTrackIndex && audio.src) {
            audio.play().then(() => {
                isPlaying = true;
                setPlayIcon(true);
            }).catch(() => {});
            return;
        }
        loadTrack(index);
        audio.play().then(() => {
            isPlaying = true;
            setPlayIcon(true);
        }).catch(() => {});
    }

    function setPlayIcon(playing) {
        const use = playBtn.querySelector('use');
        use.setAttribute('href', playing ? '#pause' : '#play');
    }

    function togglePlay() {
        if (!audio.src || playlist.length === 0) return;
        if (isPlaying) {
            audio.pause();
            setPlayIcon(false);
            isPlaying = false;
        } else {
            audio.play().then(() => {
                setPlayIcon(true);
                isPlaying = true;
            }).catch(() => {});
        }
    }

    function playNext() {
        if (playlist.length === 0) return;
        let nextIndex;
        if (shuffleMode) {
            if (playlist.length === 1) nextIndex = 0;
            else do { nextIndex = Math.floor(Math.random() * playlist.length); } while (nextIndex === currentTrackIndex);
        } else {
            nextIndex = currentTrackIndex + 1;
            if (nextIndex >= playlist.length) {
                if (loopMode === 2) nextIndex = 0;
                else {
                    isPlaying = false;
                    setPlayIcon(false);
                    progressBar.value = 0;
                    currentTimeEl.textContent = '00:00';
                    return;
                }
            }
        }
        playTrack(nextIndex);
    }

    function playPrev() {
        if (playlist.length === 0) return;
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }
        let prevIndex = currentTrackIndex - 1;
        if (prevIndex < 0) {
            if (loopMode === 2) prevIndex = playlist.length - 1;
            else { audio.currentTime = 0; return; }
        }
        playTrack(prevIndex);
    }

    function updateButtons() {
        shuffleBtn.classList.toggle('active', shuffleMode);
        loopBtn.classList.toggle('active', loopMode > 0);
        updateLoopIcon();
        updateShuffleIcon();
        saveSettings();
    }

    function updateLoopIcon() {
        const use = loopIcon.querySelector('use');
        use.setAttribute('href', ['#loop-off', '#loop-one', '#loop-all'][loopMode]);
    }

    function updateShuffleIcon() {
        const use = shuffleIcon.querySelector('use');
        use.setAttribute('href', shuffleMode ? '#shuffle-on' : '#shuffle-off');
    }

    function toggleHiddenMode() {
        const frame = document.querySelector('.frame');
        isHidden = !isHidden;
        frame.classList.toggle('hidden-mode', isHidden);
        const use = eyeIcon.querySelector('use');
        use.setAttribute('href', isHidden ? '#eye-closed' : '#eye-open');
        eyeBtn.classList.toggle('active', isHidden);
    }

    function disableHiddenMode() {
        if (isHidden) {
            const frame = document.querySelector('.frame');
            isHidden = false;
            frame.classList.remove('hidden-mode');
            const use = eyeIcon.querySelector('use');
            use.setAttribute('href', '#eye-open');
            eyeBtn.classList.remove('active');
        }
    }

    function setupAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source = audioCtx.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(audioCtx.destination);
        }
    }

    function resizeCanvas() {
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = rect.width;
        const h = rect.height;
        if (w > 0 && h > 0) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            canvas._logicalWidth = w;
            canvas._logicalHeight = h;
            canvas._dpr = dpr;
        }
    }

    function drawVisualizer() {
        if (!analyser) return;
        const logicalW = canvas._logicalWidth || 300;
        const logicalH = canvas._logicalHeight || 150;
        const dpr = canvas._dpr || 1;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const barsCount = Math.min(bufferLength, 64);
        const gap = barsCount > 32 ? 2 : 4;
        const drawWidth = Math.max(1, (logicalW - gap * (barsCount - 1)) / barsCount);
        let x = 0;
        for (let i = 0; i < barsCount; i++) {
            const value = dataArray[i];
            const barHeight = (value / 255) * logicalH;
            ctx.fillStyle = '#ff6a00';
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#ff6a00';
            ctx.fillRect(x, logicalH - barHeight, drawWidth, barHeight);
            x += drawWidth + gap;
        }
        animationId = requestAnimationFrame(drawVisualizer);
    }

    function startVisualizer() {
        if (!audioCtx) setupAudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        resizeCanvas();
        if (!animationId) drawVisualizer();
    }

    function stopVisualizer() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    audio.addEventListener('timeupdate', () => {
        if (audio.duration && isFinite(audio.duration)) {
            progressBar.value = (audio.currentTime / audio.duration) * 100;
            currentTimeEl.textContent = formatTime(audio.currentTime);
        }
    });

    audio.addEventListener('loadedmetadata', () => {
        durationTimeEl.textContent = formatTime(audio.duration);
    });

    audio.addEventListener('ended', () => {
        if (loopMode === 1) {
            audio.currentTime = 0;
            audio.play();
        } else {
            playNext();
        }
    });

    audio.addEventListener('play', startVisualizer);
    audio.addEventListener('pause', stopVisualizer);

    progressBar.addEventListener('input', (e) => {
        if (!audio.duration || !isFinite(audio.duration)) return;
        audio.currentTime = (e.target.value / 100) * audio.duration;
    });

    volumeBar.addEventListener('input', (e) => {
        audio.volume = parseFloat(e.target.value);
        saveSettings();
    });

    playBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    rewindBtn.addEventListener('click', () => {
        if (audio.src) audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
    forwardBtn.addEventListener('click', () => {
        if (audio.src) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
    });

    shuffleBtn.addEventListener('click', () => {
        shuffleMode = !shuffleMode;
        updateButtons();
    });

    loopBtn.addEventListener('click', () => {
        loopMode = (loopMode + 1) % 3;
        updateButtons();
    });

    eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHiddenMode();
    });

    document.addEventListener('click', (e) => {
        if (isHidden) {
            if (!eyeBtn.contains(e.target)) {
                disableHiddenMode();
            }
        }
    });

    let menuOpen = false;
    loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
        loadMenu.classList.toggle('open', menuOpen);
    });

    document.addEventListener('click', (e) => {
        if (menuOpen && !loadMenu.contains(e.target) && e.target !== loadBtn) {
            menuOpen = false;
            loadMenu.classList.remove('open');
        }
    });

    document.querySelectorAll('.load-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            if (action === 'files') fileInput.click();
            else if (action === 'folder') folderInput.click();
            menuOpen = false;
            loadMenu.classList.remove('open');
        });
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            addFiles(Array.from(e.target.files));
        }
        fileInput.value = '';
    });

    folderInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            addFiles(Array.from(e.target.files));
        }
        folderInput.value = '';
    });

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (e.dataTransfer.items) {
            const files = await traverseDataTransferItems(e.dataTransfer.items);
            if (files.length) addFiles(files);
        } else if (e.dataTransfer.files.length) {
            addFiles(Array.from(e.dataTransfer.files));
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowLeft': e.preventDefault(); if (audio.src) audio.currentTime = Math.max(0, audio.currentTime - 5); break;
            case 'ArrowRight': e.preventDefault(); if (audio.src) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
            case 'ArrowUp': e.preventDefault(); audio.volume = Math.min(1, audio.volume + 0.05); volumeBar.value = audio.volume; saveSettings(); break;
            case 'ArrowDown': e.preventDefault(); audio.volume = Math.max(0, audio.volume - 0.05); volumeBar.value = audio.volume; saveSettings(); break;
            case 'Escape': if (modalOverlay.classList.contains('open')) closeModal(); else if (isHidden) disableHiddenMode(); break;
        }
    });

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    modalCloseBtn.addEventListener('click', closeModal);

    loadSettings();
    audio.volume = parseFloat(volumeBar.value);

    function initCanvas() {
        resizeCanvas();
        if (isPlaying && !animationId && analyser) {
            drawVisualizer();
        }
    }

    setTimeout(initCanvas, 50);
    window.addEventListener('resize', initCanvas);
    window.addEventListener('load', () => setTimeout(initCanvas, 100));
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => initCanvas());
        ro.observe(canvas.parentElement);
    }
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) initCanvas();
    });

    if (playlist.length === 0) {
        trackTitle.textContent = 'DROP AUDIO FILE';
        setCover(null);
    }
})();
