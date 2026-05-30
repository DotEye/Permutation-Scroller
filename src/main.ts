import './style.css';

const ANIMATION_DURATION = 500;

// BigInt helpers
function bigintSqrt(value: bigint): bigint {
    if (value < 0n) throw new Error('Negative square root');
    if (value < 2n) return value;

    let x0 = value / 2n;
    let x1 = (x0 + value / x0) / 2n;
    while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + value / x0) / 2n;
    }
    return x0;
}

function bigintHash(val: bigint, seed: bigint): bigint {
    let h = val ^ seed ^ 0x517cc1b727220a95n;
    h = (h ^ (h >> 32n)) * 0xd6e8feb86659fd15n;
    h = (h ^ (h >> 29n)) * 0xa22b62058b763a07n;
    h = h ^ (h >> 32n);
    return h & 0xffffffffffffffffn; // Return positive 64-bit bigint
}

// 4-Round Feistel Cipher Shuffler (Bijection mapping on [0, P-1])
class BigIntPermutationShuffler {
    private A: bigint;
    private P: bigint;
    private seed: bigint;

    constructor(P: bigint, seed: bigint) {
        this.P = P;
        this.seed = seed;
        const root = bigintSqrt(P);
        if (root * root === P) {
            this.A = root;
        } else {
            this.A = root + 1n;
        }
    }

    private feistelEncrypt(x: bigint): bigint {
        let L = x % this.A;
        let R = x / this.A;

        for (let round = 0n; round < 4n; ++round) {
            const roundSeed = bigintHash(this.seed, round);
            const f = bigintHash(R, roundSeed) % this.A;
            const nextL = R;
            const nextR = (L + f) % this.A;
            L = nextL;
            R = nextR;
        }

        return L + R * this.A;
    }

    public shuffle(i: bigint): bigint {
        if (this.P <= 1n) return 0n;
        let x = i;
        let count = 0;
        while (true) {
            x = this.feistelEncrypt(x);
            if (x < this.P) {
                return x;
            }
            ++count;
            if (count > 1000) {
                return i % this.P;
            }
        }
    }
}

// Insert spaces back to their original positions for "preserve" mode
function insertPreservedSpaces(word: string, spaceIndices: number[]): string {
    const chars = word.split('');
    for (const index of spaceIndices) {
        chars.splice(index, 0, ' ');
    }
    return chars.join('');
}

// Multiset Permutation Unranking (O(N * U) complexity)
function unrankPermutation(str: string, rank: bigint, totalPermutations: bigint): string {
    const counts: Record<string, number> = {};
    for (const char of str) {
        counts[char] = (counts[char] || 0) + 1;
    }

    const uniqueChars = Object.keys(counts).sort();
    let n = str.length;
    let r = rank;
    let pCurrent = totalPermutations;
    let result = '';

    for (let step = 0; step < str.length; ++step) {
        for (const char of uniqueChars) {
            if (counts[char] === 0) continue;

            const count = (pCurrent * BigInt(counts[char])) / BigInt(n);

            if (r < count) {
                result += char;
                --counts[char];
                --n;
                pCurrent = count;
                break;
            } else {
                r -= count;
            }
        }
    }
    return result;
}

// Calculate unique permutations count of a multiset
function getUniquePermutationsCount(str: string): bigint {
    if (str.length === 0) return 0n;
    const counts: Record<string, number> = {};
    for (const char of str) {
        counts[char] = (counts[char] || 0) + 1;
    }

    let numerator = 1n;
    for (let i = 1; i <= str.length; ++i) {
        numerator *= BigInt(i);
    }

    let denominator = 1n;
    for (const char in counts) {
        let count = counts[char];
        let fact = 1n;
        for (let i = 1; i <= count; ++i) {
            fact *= BigInt(i);
        }
        denominator *= fact;
    }

    return numerator / denominator;
}

// Helper to format bigint with commas
function formatBigInt(val: bigint): string {
    return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// App State
let inputWord = '';
let totalPermutations = 0n;
let currentRank = 0n;
let loadedCount = 0n;
let isFinished = false;
let noDuplicates = false;
let randomOrder = true;
let spacesMode: 'remove' | 'preserve' | 'shuffle' = 'remove';
let spaceIndices: number[] = [];
let seed = 1137n;
let shuffler: BigIntPermutationShuffler | null = null;
let observer: IntersectionObserver | null = null;

const BATCH_SIZE = 150n;

// DOM Elements
const wordInput = document.getElementById('word-input') as HTMLInputElement;
const randomOrderCheckbox = document.getElementById('random-order') as HTMLInputElement;
const noDuplicatesCheckbox = document.getElementById('no-duplicates') as HTMLInputElement;
const spacesSelect = document.getElementById('spaces-select') as HTMLSelectElement;
const casingSelect = document.getElementById('casing-select') as HTMLSelectElement;
const fontSizeSlider = document.getElementById('font-size') as HTMLInputElement;
const fontSizeVal = document.getElementById('font-size-val') as HTMLElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
const totalCountLabel = document.getElementById('total-count-label') as HTMLElement;
const permutationsText = document.getElementById('permutations-text') as HTMLElement;
const sentinel = document.getElementById('scroll-sentinel') as HTMLElement;
const backToTopButton = document.getElementById('back-to-top') as HTMLButtonElement;
const endMessage = document.getElementById('end-message') as HTMLElement;
const helpButton = document.getElementById('help-btn') as HTMLButtonElement;
const helpModal = document.getElementById('help-modal') as HTMLDialogElement;
const closeModalButton = document.getElementById('close-modal') as HTMLButtonElement;

// Theme switcher
function applyTheme(theme: string) {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') {
        root.classList.add('theme-light');
    } else if (theme === 'dark') {
        root.classList.add('theme-dark');
    }
    localStorage.setItem('theme', theme);
}

themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value);
});

// Init Theme
const savedTheme = localStorage.getItem('theme') || 'system';
themeSelect.value = savedTheme;
applyTheme(savedTheme);

// Font Size handling
function updateFontSize(size: string) {
    fontSizeVal.textContent = `${size}px`;
    permutationsText.style.fontSize = `${size}px`;
    // Trigger screen fill check as font size changes could expose the sentinel
    fillScreenIfNeeded();
}

fontSizeSlider.addEventListener('input', () => {
    updateFontSize(fontSizeSlider.value);
});
// Init Font Size
updateFontSize(fontSizeSlider.value);

// Update Stats UI
function updateStatsUI() {
    if (inputWord === '') {
        totalCountLabel.textContent = 'Permutations: 0';
        return;
    }

    const totalStr = formatBigInt(totalPermutations);
    if (noDuplicates) {
        totalCountLabel.textContent = `Permutations: ${totalStr}`;
    } else {
        totalCountLabel.textContent = `Permutations: ${totalStr} (Endless)`;
    }
}

// Load Next Batch of Permutations
function loadNextBatch() {
    if (isFinished || inputWord === '') return;

    const batch: string[] = [];
    let loadedInThisBatch = 0n;

    while (loadedInThisBatch < BATCH_SIZE) {
        if (currentRank >= totalPermutations) {
            if (noDuplicates) {
                isFinished = true;
                break;
            } else {
                // Wrap around for endless scroll
                currentRank = 0n;
                if (randomOrder) {
                    // Re-seed for next pass to generate a new unique random permutation sequence
                    seed = bigintHash(seed, BigInt(Date.now()));
                    shuffler = new BigIntPermutationShuffler(totalPermutations, seed);
                }
            }
        }

        let targetRank = currentRank;
        if (randomOrder && shuffler) {
            targetRank = shuffler.shuffle(currentRank);
        }

        let word = unrankPermutation(inputWord, targetRank, totalPermutations);
        if (spacesMode === 'preserve') {
            word = insertPreservedSpaces(word, spaceIndices);
        }
        batch.push(word);

        ++currentRank;
        ++loadedCount;
        ++loadedInThisBatch;
    }

    if (batch.length > 0) {
        const isFirstBatch = loadedCount - BigInt(batch.length) === 0n;
        // Separate permutations using a centered dot
        const textNode = document.createTextNode((isFirstBatch ? '' : ' · ') + batch.join(' · '));
        permutationsText.appendChild(textNode);
        updateStatsUI();
    }

    if (isFinished && noDuplicates) {
        endMessage.classList.remove('hidden');
    }
}

// Check if more permutations are needed to fill the screen
function fillScreenIfNeeded() {
    if (isFinished || inputWord === '') return;

    const rect = sentinel.getBoundingClientRect();
    const threshold = window.innerHeight + 300; // Load ahead by 300px

    if (rect.top <= threshold) {
        loadNextBatch();
        // Schedule check on next microtask to let the layout recalculate
        setTimeout(fillScreenIfNeeded, 0);
    }
}

// Reset Scroller and regenerate state
function resetScroller() {
    permutationsText.textContent = '';
    endMessage.classList.add('hidden');
    spacesMode = spacesSelect.value as 'remove' | 'preserve' | 'shuffle';
    const casingMode = casingSelect.value as 'preserve' | 'lowercase' | 'uppercase';
    let rawInput = wordInput.value;
    if (casingMode === 'lowercase') {
        rawInput = rawInput.toLowerCase();
    } else if (casingMode === 'uppercase') {
        rawInput = rawInput.toUpperCase();
    }
    spaceIndices = [];

    if (spacesMode === 'remove') {
        inputWord = rawInput.replace(/\s+/g, '');
    } else if (spacesMode === 'preserve') {
        for (let i = 0; i < rawInput.length; ++i) {
            if (rawInput[i] === ' ') {
                spaceIndices.push(i);
            }
        }
        inputWord = rawInput.replace(/\s+/g, '');
    } else {
        // "shuffle"
        inputWord = rawInput;
    }
    totalPermutations = getUniquePermutationsCount(inputWord);
    currentRank = 0n;
    loadedCount = 0n;
    isFinished = false;

    randomOrder = randomOrderCheckbox.checked;
    noDuplicates = noDuplicatesCheckbox.checked;

    if (inputWord !== '') {
        seed = bigintHash(BigInt(Date.now() ^ 0x9e3779b9), 77n);
        shuffler = new BigIntPermutationShuffler(totalPermutations, seed);
        loadNextBatch();
        setTimeout(fillScreenIfNeeded, 0);
    } else {
        shuffler = null;
        updateStatsUI();
    }
}

// Event Listeners for controls
wordInput.addEventListener('input', resetScroller);
randomOrderCheckbox.addEventListener('change', resetScroller);
noDuplicatesCheckbox.addEventListener('change', resetScroller);
spacesSelect.addEventListener('change', resetScroller);
casingSelect.addEventListener('change', resetScroller);

// Help Modal listeners
helpButton.addEventListener('click', () => {
    helpModal.showModal();
    (helpModal.querySelector('.modal-body') as HTMLElement).scrollTop = 0;
});

closeModalButton.addEventListener('click', () => {
    helpModal.close();
});

helpModal.addEventListener('click', event => {
    if (event.target === helpModal) {
        helpModal.close();
    }
});

const controlsHeader = document.getElementById('controls') as HTMLElement;

// Show/hide Back to Top button when scrolling past controls header
let scrollThrottleTimeout: number | null = null;

// Show/hide Back to Top button when scrolling past controls header, and trigger scroll loading fallback
window.addEventListener(
    'scroll',
    () => {
        if (window.scrollY > controlsHeader.offsetHeight) {
            backToTopButton.classList.remove('hidden');
        } else {
            backToTopButton.classList.add('hidden');
        }

        // Throttled scroll loading fallback to handle fast scrolling
        if (scrollThrottleTimeout === null) {
            scrollThrottleTimeout = window.setTimeout(() => {
                scrollThrottleTimeout = null;
                if (!isFinished && inputWord !== '') {
                    fillScreenIfNeeded();
                }
            }, 100);
        }
    },
    {passive: true},
);

// Smooth scroll to top on button click
backToTopButton.addEventListener('click', () => {
    window.scrollTo({top: 0, behavior: 'smooth'});
});

// Setup IntersectionObserver for scroll loading
function setupScrollObserver() {
    if (observer) {
        observer.disconnect();
    }

    observer = new IntersectionObserver(
        entries => {
            if (entries[0].isIntersecting) {
                if (!isFinished && inputWord !== '') {
                    fillScreenIfNeeded();
                }
            }
        },
        {
            rootMargin: '600px', // Trigger loading 600px before the element enters the viewport
        },
    );

    observer.observe(sentinel);
}

// Header Scramble Animation
function animateHeader() {
    const h1 = document.querySelector('#controls h1');
    if (!h1) return;

    const originalText = h1.textContent || 'Permutation Scroller';

    // Get indices of all non-space characters
    const nonSpaceIndices: number[] = [];
    for (let i = 0; i < originalText.length; ++i) {
        if (originalText[i] !== ' ') {
            nonSpaceIndices.push(i);
        }
    }

    // Extract non-space characters
    const nonSpaceChars = nonSpaceIndices.map(idx => originalText[idx]);

    // Fisher-Yates shuffle to scramble them
    for (let i = nonSpaceChars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nonSpaceChars[i], nonSpaceChars[j]] = [nonSpaceChars[j], nonSpaceChars[i]];
    }

    // Build the initial scrambled array
    const scrambledChars = originalText.split('');
    let scrambledIdx = 0;
    for (let i = 0; i < scrambledChars.length; i++) {
        if (scrambledChars[i] !== ' ') {
            scrambledChars[i] = nonSpaceChars[scrambledIdx++];
        }
    }

    // Apply initial scrambled state immediately to prevent flash of unscrambled text
    h1.textContent = scrambledChars.join('');

    // Determine a random order to reveal the characters back to their original state
    const revealIndices = [...nonSpaceIndices];
    for (let i = revealIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [revealIndices[i], revealIndices[j]] = [revealIndices[j], revealIndices[i]];
    }

    const totalSteps = revealIndices.length;
    const stepInterval = ANIMATION_DURATION / totalSteps;

    let currentStep = 0;
    const revealed = new Set<number>();

    const interval = setInterval(() => {
        if (currentStep >= totalSteps) {
            clearInterval(interval);
            h1.textContent = originalText;
            return;
        }

        revealed.add(revealIndices[currentStep]);
        ++currentStep;

        const currentText = originalText
            .split('')
            .map((char, idx) => {
                if (char === ' ') return ' ';
                if (revealed.has(idx)) return char;
                return scrambledChars[idx];
            })
            .join('');

        h1.textContent = currentText;
    }, stepInterval);
}

// Initialize
animateHeader();
setupScrollObserver();
resetScroller();
