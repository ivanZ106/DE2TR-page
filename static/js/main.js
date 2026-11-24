/* DE²TR — page interactions (adapted from the Academic Project Page Template) */

/* Copy BibTeX to clipboard */
function copyBibTeX() {
    const bibtexElement = document.getElementById('bibtex-code');
    const button = document.querySelector('.copy-bibtex-btn');
    const copyText = button.querySelector('.copy-text');

    if (bibtexElement) {
        navigator.clipboard.writeText(bibtexElement.textContent).then(function () {
            button.classList.add('copied');
            copyText.textContent = 'Cop';
            setTimeout(function () {
                button.classList.remove('copied');
                copyText.textContent = 'Copy';
            }, 2000);
        }).catch(function () {
            // fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = bibtexElement.textContent;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            button.classList.add('copied');
            copyText.textContent = 'Cop';
            setTimeout(function () {
                button.classList.remove('copied');
                copyText.textContent = 'Copy';
            }, 2000);
        });
    }
}

/* Scroll to top */
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Show/hide scroll-to-top button */
window.addEventListener('scroll', function () {
    const scrollButton = document.querySelector('.scroll-to-top');
    if (window.pageYOffset > 300) {
        scrollButton.classList.add('visible');
    } else {
        scrollButton.classList.remove('visible');
    }
});

/* Lightbox: click a qualitative carousel image to view it full-size */
function initLightbox() {
    const imgs = document.querySelectorAll('#results-carousel .item img');
    if (!imgs.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.style.display = 'none';
    const big = document.createElement('img');
    big.alt = 'Enlarged figure';
    const hint = document.createElement('div');
    hint.className = 'lightbox-hint';
    hint.textContent = 'Click anywhere or press ESC to close';
    overlay.appendChild(big);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);

    function close() {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }
    function open(src) {
        big.src = src;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    imgs.forEach(function (img) {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', function () { open(img.src); });
    });
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
    });
}

/* Init carousels once jQuery + bulmaCarousel are ready */
$(document).ready(function () {
    var options = {
        slidesToScroll: 1,
        slidesToShow: 1,
        loop: true,
        infinite: true,
        autoplay: true,
        autoplaySpeed: 5000,
    };
    bulmaCarousel.attach('.carousel', options);
    bulmaSlider.attach();
    initLightbox();
});
