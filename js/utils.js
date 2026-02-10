// Shared Utility Functions and Config

const plotlyConfig = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d', 'autoScale2d', 'hoverClosestCartesian', 'hoverCompareCartesian', 'toggleSpikelines']
};

function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getAnimalForWeight(weight) {
    const baseUrl = "https://storage.googleapis.com/intro_alphatek/animals/";
    if (weight <= 66.2) return { name: "Koala", url: baseUrl + "Koala.png" };
    if (weight <= 99.5) return { name: "Dog", url: baseUrl + "Dog.png" };
    if (weight <= 132.8) return { name: "Kangaroo", url: baseUrl + "Kangaroo.png" };
    if (weight <= 166.2) return { name: "Gazelle", url: baseUrl + "Gazelle.png" };
    if (weight <= 199.5) return { name: "Jaguar", url: baseUrl + "Jaguar.png" };
    if (weight <= 232.8) return { name: "Panda", url: baseUrl + "Panda.png" };
    if (weight <= 266.2) return { name: "Wild Hog", url: baseUrl + "Wild%20Hog.png" };
    if (weight <= 299.5) return { name: "Lion", url: baseUrl + "Lion.png" };
    if (weight <= 332.8) return { name: "Tiger", url: baseUrl + "Tiger.png" };
    if (weight <= 366.2) return { name: "Gorilla", url: baseUrl + "Gorilla.png" };
    if (weight <= 399.5) return { name: "Anaconda", url: baseUrl + "Anaconda(1).png" };
    if (weight <= 432.8) return { name: "Alligator", url: baseUrl + "Alligator.png" };
    if (weight <= 466.2) return { name: "Grizzly", url: baseUrl + "Grizzly.png" };
    if (weight <= 499.5) return { name: "Polar Bear", url: baseUrl + "Polar%20Bear.png" };
    return { name: "The Beast", url: baseUrl + "the_beast.png" };
}

function updateAnimalOverlay(weight, imageArg, textArg) {
    const imageElement = typeof imageArg === 'string' ? document.getElementById(imageArg) : imageArg;
    const textElement = typeof textArg === 'string' ? document.getElementById(textArg) : textArg;

    if (!imageElement || !textElement) return;

    if (weight && weight > 0) {
        const animal = getAnimalForWeight(weight);
        imageElement.src = animal.url;
        textElement.innerHTML = `Du drar ${weight.toFixed(1)} kg<br>Du är en ${animal.name}!`;
        imageElement.style.display = 'block';
        textElement.style.display = 'block';
    } else {
        imageElement.style.display = 'none';
        textElement.style.display = 'none';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Expose to global scope for module access
window.plotlyConfig = plotlyConfig;
window.hexToRgba = hexToRgba;
window.getAnimalForWeight = getAnimalForWeight;
window.updateAnimalOverlay = updateAnimalOverlay;
window.debounce = debounce;
