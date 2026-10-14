/* ===================================================
   IA-inch by richi — APPLICATION LOGIC (ICLOUD & MULTI-DOCUMENT)
   =================================================== */

let currentUser = null; // { email: string, name: string }
let currentQuiz = null;
let currentQuestionIndex = 0;
let selectedFiles = []; // Array of File objects
let userResponses = [];
let isReviewingMissedOnly = false;
let originalQuizBackup = null;

let progressInterval = null;
let currentPercent = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Verificar si hay sesión guardada de iCloud
    const savedUser = localStorage.getItem('ia_inch_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            setupUserSession(currentUser);
            showDashboard();
        } catch(e) {
            showAuthScreen();
        }
    } else {
        showAuthScreen();
    }

    // Drag and drop setup
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            dropZone.classList.add('dragover'); 
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFilesSelected(e.dataTransfer.files);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFilesSelected(e.target.files);
                fileInput.value = ''; // Reset input to allow re-selecting same file if desired
            }
        });
    }

    const btnGen = document.getElementById('btn-generate');
    if (btnGen) btnGen.addEventListener('click', generateQuiz);

    const btnNext = document.getElementById('btn-next');
    if (btnNext) btnNext.addEventListener('click', onNextQuestion);

    // Initial sync for distribution
    updateQuestionsDistribution();
});

// ===================================================
// ICLOUD AUTHENTICATION & SESSION MANAGEMENT
// ===================================================

function showAuthScreen() {
    currentUser = null;
    localStorage.removeItem('ia_inch_user');
    const chip = document.getElementById('nav-user-chip');
    if (chip) chip.classList.add('hidden');
    
    showSection('auth-section');
}
window.showAuthScreen = showAuthScreen;

function setupUserSession(user) {
    currentUser = user;
    localStorage.setItem('ia_inch_user', JSON.stringify(user));

    const chip = document.getElementById('nav-user-chip');
    const nameEl = document.getElementById('nav-user-name');
    if (chip && nameEl) {
        nameEl.textContent = user.name || user.email.split('@')[0];
        chip.title = `Conectado como ${user.email} (iCloud)`;
        chip.classList.remove('hidden');
    }

    const libTitle = document.getElementById('library-user-title');
    if (libTitle) {
        libTitle.textContent = `Biblioteca de ${user.name || user.email.split('@')[0]}`;
    }
}

let pendingAuthAccount = null;

function openPasscodeModal(email, name) {
    pendingAuthAccount = { email, name };
    const modal = document.getElementById('passcode-modal');
    const title = document.getElementById('passcode-modal-title');
    const sub = document.getElementById('passcode-modal-sub');
    const input = document.getElementById('passcode-input');
    const errorMsg = document.getElementById('passcode-error');

    if (title) title.textContent = `Biblioteca de ${name}`;
    if (sub) sub.textContent = `Esta cuenta personal de iCloud está protegida. Ingresa el PIN de seguridad (2211).`;
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 80);
    }
    if (errorMsg) errorMsg.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
}
window.openPasscodeModal = openPasscodeModal;

function closePasscodeModal() {
    pendingAuthAccount = null;
    const modal = document.getElementById('passcode-modal');
    const input = document.getElementById('passcode-input');
    const errorMsg = document.getElementById('passcode-error');
    if (input) input.value = '';
    if (errorMsg) errorMsg.classList.add('hidden');
    if (modal) modal.classList.add('hidden');
}
window.closePasscodeModal = closePasscodeModal;

async function submitPasscode(e) {
    if (e) e.preventDefault();
    if (!pendingAuthAccount) return;

    const input = document.getElementById('passcode-input');
    const errorMsg = document.getElementById('passcode-error');
    const passcode = input ? input.value.trim() : '';

    if (!passcode) {
        if (errorMsg) {
            errorMsg.textContent = 'Por favor ingresa el PIN de seguridad.';
            errorMsg.classList.remove('hidden');
        }
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: pendingAuthAccount.email,
                name: pendingAuthAccount.name,
                passcode: passcode
            })
        });

        if (!res.ok) {
            const err = await res.json();
            if (errorMsg) {
                errorMsg.textContent = err.detail || 'Código incorrecto. Intenta de nuevo.';
                errorMsg.classList.remove('hidden');
            }
            if (input) {
                input.value = '';
                input.focus();
            }
            return;
        }

        const data = await res.json();
        closePasscodeModal();
        setupUserSession(data.user);
        showDashboard();
    } catch(err) {
        if (errorMsg) {
            errorMsg.textContent = 'Error de conexión. Intenta de nuevo.';
            errorMsg.classList.remove('hidden');
        }
    }
}
window.submitPasscode = submitPasscode;

async function handleAuthSubmit(e) {
    if (e) e.preventDefault();
    const emailInput = document.getElementById('auth-email');
    const nameInput = document.getElementById('auth-name');

    const email = emailInput ? emailInput.value.trim() : '';
    const name = nameInput ? nameInput.value.trim() : '';

    if (!email) {
        alert('Por favor ingresa tu Apple ID o correo de iCloud.');
        return;
    }

    let cleanEmail = email.toLowerCase();
    if (!cleanEmail.includes('@')) {
        cleanEmail += '@icloud.com';
    }

    // Si intenta entrar como Dani o Ricardo, solicitar el PIN de seguridad
    if (cleanEmail === 'dani@icloud.com' || cleanEmail === 'ricardo@icloud.com') {
        const displayName = cleanEmail === 'dani@icloud.com' ? (name || 'Dani') : (name || 'Ricardo');
        openPasscodeModal(cleanEmail, displayName);
        return;
    }

    await performLogin(cleanEmail, name);
}
window.handleAuthSubmit = handleAuthSubmit;

async function quickLogin(email, name) {
    openPasscodeModal(email, name);
}
window.quickLogin = quickLogin;

async function performLogin(email, name, passcode = null) {
    try {
        const bodyData = { email, name };
        if (passcode) bodyData.passcode = passcode;

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Error al iniciar sesión con iCloud');
        }

        const data = await res.json();
        setupUserSession(data.user);
        showDashboard();
    } catch(err) {
        alert(err.message);
    }
}

function logoutUser(e) {
    if (e) e.stopPropagation();
    if (confirm('¿Deseas cerrar tu sesión de iCloud?')) {
        showAuthScreen();
    }
}
window.logoutUser = logoutUser;

// ROUTING / VIEW MANAGER
function showSection(sectionId) {
    if (!currentUser && sectionId !== 'auth-section') {
        showAuthScreen();
        return;
    }
    ['auth-section', 'dashboard-section', 'create-section', 'quiz-section', 'results-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(sectionId);
    if (target) target.classList.remove('hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showSection = showSection;

function showDashboard() {
    if (!currentUser) {
        showAuthScreen();
        return;
    }
    showSection('dashboard-section');
    fetchQuizzes();
}
window.showDashboard = showDashboard;

// ===================================================
// MULTI-DOCUMENT MANAGEMENT
// ===================================================

function handleFilesSelected(newFiles) {
    for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        // Evitar duplicados por nombre y tamaño
        const exists = selectedFiles.some(f => f.name === file.name && f.size === file.size);
        if (!exists) {
            selectedFiles.push(file);
        }
    }
    renderSelectedFiles();
}

function removeSelectedFile(index) {
    selectedFiles.splice(index, 1);
    renderSelectedFiles();
}
window.removeSelectedFile = removeSelectedFile;

function renderSelectedFiles() {
    const container = document.getElementById('selected-files-list');
    const indicator = document.getElementById('docs-count-indicator');
    const generateBtn = document.getElementById('btn-generate');

    if (selectedFiles.length === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        indicator.classList.add('hidden');
        generateBtn.classList.add('hidden');
        return;
    }

    indicator.textContent = `${selectedFiles.length} documento${selectedFiles.length === 1 ? '' : 's'} listo${selectedFiles.length === 1 ? '' : 's'}`;
    indicator.classList.remove('hidden');
    generateBtn.classList.remove('hidden');
    container.classList.remove('hidden');

    container.innerHTML = '';
    selectedFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = 'file-item-chip';
        
        const sizeFormatted = formatFileSize(file.size);
        chip.innerHTML = `
            <div class="file-chip-left">
                <span style="font-size: 1.1rem;">📄</span>
                <span class="file-chip-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                <span class="file-chip-size">(${sizeFormatted})</span>
            </div>
            <button class="remove-file-btn" title="Quitar archivo" onclick="removeSelectedFile(${idx})">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        container.appendChild(chip);
    });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
}

// ===================================================
// QUESTION DISTRIBUTION MENU (HASTA 50 PREGUNTAS)
// ===================================================

function updateQuestionsDistribution() {
    const closedSlider = document.getElementById('quiz-closed-amount');
    const openSlider = document.getElementById('quiz-open-amount');
    
    let closedVal = parseInt(closedSlider.value) || 0;
    let openVal = parseInt(openSlider.value) || 0;

    // Límite máximo total: 50
    if (closedVal + openVal > 50) {
        if (document.activeElement === closedSlider) {
            closedVal = 50 - openVal;
            closedSlider.value = closedVal;
        } else {
            openVal = 50 - closedVal;
            openSlider.value = openVal;
        }
    }

    // Mínimo 1 en total
    if (closedVal + openVal < 1) {
        closedVal = 1;
        closedSlider.value = 1;
    }

    document.getElementById('closed-count-badge').textContent = closedVal;
    document.getElementById('open-count-badge').textContent = openVal;
    document.getElementById('total-questions-count').textContent = (closedVal + openVal);
}
window.updateQuestionsDistribution = updateQuestionsDistribution;

// ===================================================
// API: DASHBOARD & EXAM CRUD
// ===================================================

async function fetchQuizzes() {
    const list = document.getElementById('quiz-list');
    const countBadge = document.getElementById('quizzes-count-badge');
    
    if (!currentUser) {
        showAuthScreen();
        return;
    }

    try {
        const url = `/api/quizzes?user_email=${encodeURIComponent(currentUser.email)}`;
        const res = await fetch(url);
        const quizzes = await res.json();
        
        countBadge.textContent = `${quizzes.length} examen${quizzes.length === 1 ? '' : 'es'}`;

        if (quizzes.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <p>No tienes exámenes guardados en tu cuenta de iCloud.</p>
                    <button class="apple-btn primary btn-sm" onclick="showSection('create-section')">
                        + Diseñar mi primer examen
                    </button>
                </div>
            `;
            return;
        }

        list.innerHTML = '';
        quizzes.forEach(q => {
            const dateStr = q.date ? new Date(q.date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            const card = document.createElement('div');
            card.className = 'quiz-card';
            card.innerHTML = `
                <div>
                    <div class="quiz-card-header">
                        <h4>${escapeHtml(q.name)}</h4>
                        <button class="delete-quiz-btn" title="Eliminar examen" onclick="event.stopPropagation(); deleteQuiz('${q.id}')">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
                <div class="quiz-card-footer">
                    <div class="quiz-card-meta">
                        <span class="pill-badge">${q.num_questions} preguntas</span>
                        <span>${dateStr}</span>
                    </div>
                    <button class="btn-play-mini">
                        Estudiar
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </button>
                </div>
            `;
            card.onclick = () => loadQuiz(q.id);
            list.appendChild(card);
        });
    } catch(e) {
        list.innerHTML = `<div class="empty-state"><p class="apple-alert error">Error al consultar tus exámenes.</p></div>`;
    }
}

async function deleteQuiz(quizId) {
    if (!confirm('¿Deseas eliminar este examen de tu biblioteca privada?')) return;
    try {
        const url = `/api/quizzes/${quizId}?user_email=${encodeURIComponent(currentUser ? currentUser.email : '')}`;
        const res = await fetch(url, { method: 'DELETE' });
        if (res.ok) fetchQuizzes();
    } catch(e) {
        alert('No fue posible eliminar el examen.');
    }
}
window.deleteQuiz = deleteQuiz;

// ===================================================
// PROGRESS ANIMATION (AZUL APPLE EXCLUSIVO)
// ===================================================

function startProgressAnimation() {
    currentPercent = 0;
    const container = document.getElementById('loading-container');
    const bar = document.getElementById('progress-bar-fill');
    const text = document.getElementById('loading-step-text');
    const num = document.getElementById('loading-percent');

    container.classList.remove('hidden');
    document.getElementById('btn-generate').classList.add('hidden');
    document.getElementById('error-message').classList.add('hidden');

    const m1 = document.getElementById('ms-1');
    const m2 = document.getElementById('ms-2');
    const m3 = document.getElementById('ms-3');
    const m4 = document.getElementById('ms-4');

    [m1, m2, m3, m4].forEach(m => m.className = 'milestone-item');
    m1.classList.add('active');

    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (currentPercent < 95) {
            const step = Math.max(1, Math.floor((96 - currentPercent) / 14));
            currentPercent += step;

            bar.style.width = currentPercent + '%';
            num.textContent = currentPercent + '%';

            if (currentPercent > 20 && currentPercent <= 50) {
                m1.className = 'milestone-item done';
                m2.className = 'milestone-item active';
                text.textContent = `Procesando ${selectedFiles.length} documento${selectedFiles.length === 1 ? '' : 's'}...`;
            } else if (currentPercent > 50 && currentPercent <= 80) {
                m2.className = 'milestone-item done';
                m3.className = 'milestone-item active';
                text.textContent = "Sintetizando conceptos y formulando preguntas...";
            } else if (currentPercent > 80) {
                m3.className = 'milestone-item done';
                m4.className = 'milestone-item active';
                text.textContent = "Generando retroalimentaciones pedagógicas...";
            }
        }
    }, 170);
}

function finishProgressAnimation(onComplete) {
    clearInterval(progressInterval);
    const bar = document.getElementById('progress-bar-fill');
    const num = document.getElementById('loading-percent');
    const text = document.getElementById('loading-step-text');

    bar.style.width = '100%';
    num.textContent = '100%';
    text.textContent = "¡Cuestionario listo! Iniciando...";
    
    ['ms-1', 'ms-2', 'ms-3', 'ms-4'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'milestone-item done';
    });

    setTimeout(() => {
        document.getElementById('loading-container').classList.add('hidden');
        onComplete();
    }, 400);
}

async function generateQuiz() {
    if (selectedFiles.length === 0) return;

    let quizName = document.getElementById('quiz-name').value.trim();
    if (!quizName) {
        if (selectedFiles.length === 1) {
            quizName = "Examen de " + selectedFiles[0].name.replace(/\.[^/.]+$/, "");
        } else {
            quizName = `Examen Multidocumento (${selectedFiles.length} archivos)`;
        }
    }

    const closedCount = document.getElementById('quiz-closed-amount').value;
    const openCount = document.getElementById('quiz-open-amount').value;

    const formData = new FormData();
    selectedFiles.forEach(f => {
        formData.append('files', f);
    });
    formData.append('quiz_name', quizName);
    formData.append('num_closed', closedCount);
    formData.append('num_open', openCount);
    if (currentUser && currentUser.email) {
        formData.append('user_email', currentUser.email);
    }

    startProgressAnimation();

    try {
        const res = await fetch('/api/quizzes', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ocurrió un error procesando los documentos.');
        }
        
        currentQuiz = await res.json();
        isReviewingMissedOnly = false;
        originalQuizBackup = JSON.parse(JSON.stringify(currentQuiz));

        finishProgressAnimation(() => {
            startQuiz();
        });
    } catch(e) {
        clearInterval(progressInterval);
        document.getElementById('loading-container').classList.add('hidden');
        document.getElementById('error-message').textContent = e.message;
        document.getElementById('error-message').classList.remove('hidden');
        document.getElementById('btn-generate').classList.remove('hidden');
    }
}

async function loadQuiz(id) {
    try {
        const res = await fetch(`/api/quizzes/${id}`);
        if (!res.ok) throw new Error('No se pudo cargar el examen.');
        currentQuiz = await res.json();
        isReviewingMissedOnly = false;
        originalQuizBackup = JSON.parse(JSON.stringify(currentQuiz));
        startQuiz();
    } catch(e) {
        alert(e.message);
    }
}

// ===================================================
// QUIZ ENGINE
// ===================================================

function startQuiz() {
    if (!currentQuiz || !currentQuiz.questions || currentQuiz.questions.length === 0) {
        alert("El examen no contiene preguntas válidas.");
        return;
    }
    
    currentQuestionIndex = 0;
    userResponses = [];
    document.getElementById('active-quiz-title').textContent = currentQuiz.name;
    showSection('quiz-section');
    renderQuestion();
}

function renderQuestion() {
    const btnNext = document.getElementById('btn-next');
    const container = document.getElementById('question-container');
    const counter = document.getElementById('question-counter');
    const topicPill = document.getElementById('question-topic-pill');
    const linearBar = document.getElementById('quiz-linear-bar');
    
    btnNext.classList.add('hidden');
    container.innerHTML = '';
    
    const total = currentQuiz.questions.length;
    const q = currentQuiz.questions[currentQuestionIndex];

    counter.textContent = `Pregunta ${currentQuestionIndex + 1} de ${total}`;
    topicPill.textContent = q.topic || 'Concepto General';
    const progressPercent = ((currentQuestionIndex) / total) * 100;
    linearBar.style.width = `${progressPercent}%`;

    const heading = document.createElement('h3');
    heading.className = 'question-heading';
    heading.textContent = q.question;
    container.appendChild(heading);

    if (q.type === 'multiple_choice' && q.options && q.options.length > 0) {
        const stack = document.createElement('div');
        stack.className = 'options-stack';
        
        const letters = ['A', 'B', 'C', 'D', 'E'];
        q.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-row';
            btn.innerHTML = `
                <span class="option-letter">${letters[idx] || (idx + 1)}</span>
                <span class="option-text">${escapeHtml(opt.text)}</span>
            `;
            btn.onclick = () => handleMultipleChoiceAnswer(btn, opt.is_correct, stack, q);
            stack.appendChild(btn);
        });
        container.appendChild(stack);
    } else {
        const openBox = document.createElement('div');
        openBox.className = 'open-ended-card';
        
        const textarea = document.createElement('textarea');
        textarea.className = 'apple-textarea';
        textarea.placeholder = "Escribe tu análisis o respuesta...";
        
        const evalBtn = document.createElement('button');
        evalBtn.className = 'apple-btn primary';
        evalBtn.textContent = 'Evaluar Respuesta con IA';
        
        const evalLoading = document.createElement('div');
        evalLoading.className = 'loading-step-text hidden';
        evalLoading.style.textAlign = 'center';
        evalLoading.style.padding = '0.75rem';
        evalLoading.style.color = 'var(--apple-blue)';
        evalLoading.textContent = "Analizando tu respuesta...";
        
        evalBtn.onclick = async () => {
            if (!textarea.value.trim()) return;
            textarea.disabled = true;
            evalBtn.classList.add('hidden');
            evalLoading.classList.remove('hidden');
            
            await handleOpenEndedAnswer(textarea.value.trim(), q.ideal_answer, q.question, q);
            evalLoading.classList.add('hidden');
        };
        
        openBox.appendChild(textarea);
        openBox.appendChild(evalBtn);
        openBox.appendChild(evalLoading);
        container.appendChild(openBox);
    }
}

function handleMultipleChoiceAnswer(selectedBtn, isCorrect, stack, qData) {
    const buttons = stack.querySelectorAll('.option-row');
    buttons.forEach(b => b.disabled = true);

    if (isCorrect) {
        selectedBtn.classList.add('correct');
    } else {
        selectedBtn.classList.add('incorrect');
        const correctIndex = qData.options.findIndex(o => o.is_correct);
        if (correctIndex !== -1 && buttons[correctIndex]) {
            buttons[correctIndex].classList.add('correct');
        }
    }

    userResponses.push({
        questionIndex: currentQuestionIndex,
        isCorrect: isCorrect,
        topic: qData.topic || "General",
        questionText: qData.question,
        explanation: qData.explanation || "Revisa el concepto central en tu documento."
    });

    showMiniFeedback(isCorrect, qData.explanation, null);
    document.getElementById('btn-next').classList.remove('hidden');
}

async function handleOpenEndedAnswer(userAnswer, idealAnswer, questionText, qData) {
    try {
        const res = await fetch('/api/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: questionText, ideal_answer: idealAnswer, user_answer: userAnswer })
        });
        if (!res.ok) throw new Error('Error al evaluar');
        const data = await res.json();
        
        userResponses.push({
            questionIndex: currentQuestionIndex,
            isCorrect: data.is_correct,
            topic: qData.topic || "General",
            questionText: questionText,
            explanation: data.feedback || qData.explanation
        });

        showMiniFeedback(data.is_correct, data.feedback, idealAnswer);
    } catch(e) {
        userResponses.push({
            questionIndex: currentQuestionIndex,
            isCorrect: false,
            topic: qData.topic || "General",
            questionText: questionText,
            explanation: idealAnswer
        });
        showMiniFeedback(false, "No se pudo conectar con el evaluador en este momento.", idealAnswer);
    } finally {
        document.getElementById('btn-next').classList.remove('hidden');
    }
}

function showMiniFeedback(isCorrect, explanationText, idealRef) {
    const callout = document.createElement('div');
    callout.className = `mini-feedback-callout ${isCorrect ? 'correct' : 'incorrect'}`;
    
    let html = `
        <div class="feedback-tag-row">
            <span>${isCorrect ? '✓ ¡Respuesta Correcta!' : '✕ Respuesta Incorrecta'}</span>
        </div>
        <div class="feedback-message-text">
            <strong>💡 Mini Retroalimentación:</strong> ${escapeHtml(explanationText || (isCorrect ? 'Has captado la esencia de este concepto.' : 'Concepto clave a revisar.'))}
        </div>
    `;

    if (idealRef) {
        html += `
            <div class="ideal-reference-box">
                <strong>Respuesta de referencia:</strong>
                ${escapeHtml(idealRef)}
            </div>
        `;
    }

    callout.innerHTML = html;
    document.getElementById('question-container').appendChild(callout);
}

function onNextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < currentQuiz.questions.length) {
        renderQuestion();
    } else {
        renderResultsView();
    }
}

function confirmExitQuiz() {
    if (confirm("¿Deseas salir del examen actual? Tu progreso quedará disponible en la biblioteca.")) {
        showDashboard();
    }
}
window.confirmExitQuiz = confirmExitQuiz;

// ===================================================
// RESULTS & WEAK AREAS
// ===================================================

function renderResultsView() {
    showSection('results-section');

    const total = userResponses.length;
    const correctCount = userResponses.filter(r => r.isCorrect).length;
    const incorrectCount = total - correctCount;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    const ring = document.getElementById('score-ring-container');
    ring.style.setProperty('--score-pct', percentage);
    document.getElementById('results-percentage').textContent = `${percentage}%`;

    document.getElementById('correct-count').textContent = correctCount;
    document.getElementById('incorrect-count').textContent = incorrectCount;

    const headline = document.getElementById('results-headline');
    const subheadline = document.getElementById('results-subheadline');

    if (percentage === 100) {
        headline.textContent = "Dominio Absoluto 🏆";
        subheadline.textContent = "Has contestado todas las preguntas sin ningún error.";
    } else if (percentage >= 80) {
        headline.textContent = "Rendimiento Sobresaliente 👏";
        subheadline.textContent = "Excelente comprensión. Revisa las áreas puntuales para asegurar el 100%.";
    } else if (percentage >= 60) {
        headline.textContent = "Buen Intento 👍";
        subheadline.textContent = "Comprendes las bases principales, pero hay conceptos clave que debes reforzar.";
    } else {
        headline.textContent = "Área de Aprendizaje 📚";
        subheadline.textContent = "Se detectaron conceptos importantes donde necesitas repasar el texto.";
    }

    const improvementList = document.getElementById('improvement-list');
    improvementList.innerHTML = '';

    const missed = userResponses.filter(r => !r.isCorrect);
    const retryMissedBtn = document.getElementById('btn-retry-missed');

    if (missed.length === 0) {
        improvementList.innerHTML = `
            <div class="perfect-score-banner">
                🎉 No tienes áreas débiles detectadas en este examen. ¡Felicidades por tu dominio!
            </div>
        `;
        retryMissedBtn.classList.add('hidden');
    } else {
        retryMissedBtn.classList.remove('hidden');

        const topicMap = {};
        missed.forEach(item => {
            const topic = item.topic || "Conceptos Generales";
            if (!topicMap[topic]) topicMap[topic] = [];
            topicMap[topic].push(item);
        });

        for (const [topic, items] of Object.entries(topicMap)) {
            const card = document.createElement('div');
            card.className = 'topic-gap-card';
            
            const cluesHtml = items.map(it => `
                <div style="margin-top: 0.4rem;">
                    • <em>${escapeHtml(it.questionText)}</em><br>
                    <span style="color: #f5f5f7; font-size: 0.82rem; margin-top:2px; display:inline-block;">↳ <strong>Refuerza:</strong> ${escapeHtml(it.explanation)}</span>
                </div>
            `).join('');

            card.innerHTML = `
                <div class="topic-name">
                    <span>📌</span>
                    <span>Tema: ${escapeHtml(topic)} (${items.length} ${items.length === 1 ? 'error' : 'errores'})</span>
                </div>
                <div class="question-clue">${cluesHtml}</div>
            `;
            improvementList.appendChild(card);
        }
    }
}

function retryMissedQuestions() {
    const missedIndexes = userResponses.filter(r => !r.isCorrect).map(r => r.questionIndex);
    if (!originalQuizBackup || missedIndexes.length === 0) return;

    const filteredQuestions = originalQuizBackup.questions.filter((_, idx) => missedIndexes.includes(idx));
    
    currentQuiz = {
        name: `Repaso de Errores: ${originalQuizBackup.name}`,
        questions: filteredQuestions
    };
    isReviewingMissedOnly = true;
    startQuiz();
}
window.retryMissedQuestions = retryMissedQuestions;

function restartCurrentQuiz() {
    if (originalQuizBackup) {
        currentQuiz = JSON.parse(JSON.stringify(originalQuizBackup));
        isReviewingMissedOnly = false;
        startQuiz();
    }
}
window.restartCurrentQuiz = restartCurrentQuiz;

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}
